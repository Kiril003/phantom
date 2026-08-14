/**
 * capabilityStore — the T0/T1/T2 render-tier verdict, run once per session.
 *
 * `ensureCapabilityProbed()` is the single entry point: called from
 * `main.tsx` at boot and again (idempotently) from `TacticalMap` so the
 * map never blocks on it but always eventually has a verdict. Whichever
 * caller arrives first does the work; everyone else awaits the same
 * promise or reads the cached result — the probe never runs twice
 * concurrently, and never re-runs within a tab session (sessionStorage
 * cache) or a page's lifetime (in-memory `inflight` guard).
 *
 * See `src/frontend/src/lib/capabilityProbe.ts` for what is actually
 * measured and how it is classified.
 */
import { create } from 'zustand';
import { runCapabilityProbe, type ProbeResult, type RenderTier } from '../lib/capabilityProbe';

export type { RenderTier, ProbeResult };

const CACHE_KEY = 'phantom.capabilityProbe.v1';

interface CapabilityStoreState {
  status: 'idle' | 'probing' | 'done';
  result: ProbeResult | null;
}

export const useCapabilityStore = create<CapabilityStoreState>(() => ({
  status: 'idle',
  result: null,
}));

function isRenderTier(value: unknown): value is RenderTier {
  return value === 'T0' || value === 'T1' || value === 'T2';
}

function readCache(): ProbeResult | null {
  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ProbeResult>;
    if (isRenderTier(parsed.tier) && typeof parsed.reason === 'string') {
      return parsed as ProbeResult;
    }
    return null;
  } catch {
    return null;
  }
}

function writeCache(result: ProbeResult): void {
  try {
    window.sessionStorage.setItem(CACHE_KEY, JSON.stringify(result));
  } catch {
    // sessionStorage unavailable (private mode / disabled) — the probe
    // just re-runs on the next reload; not worth failing the caller over.
  }
}

function logVerdict(result: ProbeResult, source: 'cached' | 'measured'): void {
  // English on purpose — a debug-only classification label, never shown
  // to an operator (see the shipping report's Ukrainian-first rule).
  console.info(`[capability-probe] tier=${result.tier} (${source}) ${result.reason}`);
}

let inflight: Promise<ProbeResult> | null = null;

export function ensureCapabilityProbed(): Promise<ProbeResult> {
  if (inflight) return inflight;

  const cached = readCache();
  if (cached) {
    useCapabilityStore.setState({ status: 'done', result: cached });
    logVerdict(cached, 'cached');
    inflight = Promise.resolve(cached);
    return inflight;
  }

  useCapabilityStore.setState({ status: 'probing' });
  inflight = runCapabilityProbe().then((result) => {
    writeCache(result);
    useCapabilityStore.setState({ status: 'done', result });
    logVerdict(result, 'measured');
    return result;
  });
  return inflight;
}
