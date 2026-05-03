/**
 * Phase 22 — Apps overlay store.
 *
 * Tracks "last used" timestamp per app tile so the Apps grid can render
 * a subtle "5 хв тому" hint in the corner of recently-touched tiles. This
 * is purely advisory — the section ordering stays fixed, we never reorder
 * by recency (the operator's muscle memory matters more than recency).
 *
 * Persisted to localStorage so the hint survives reloads.
 */
import { create } from 'zustand';

const STORAGE_KEY = 'phantom.apps.last_used.v1';

function loadPersisted(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
      }
      return out;
    }
    return {};
  } catch {
    return {};
  }
}

function persist(map: Record<string, number>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* quota / private mode — best-effort */
  }
}

interface AppsStoreState {
  lastUsed: Record<string, number>;
  markUsed: (id: string) => void;
  /** Returns Ukrainian relative-time string ("5 хв тому") or null. */
  agoLabel: (id: string, now?: number) => string | null;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export function formatAgo(deltaMs: number): string | null {
  if (deltaMs < 0 || !Number.isFinite(deltaMs)) return null;
  if (deltaMs < MIN) return 'щойно';
  if (deltaMs < HOUR) {
    const m = Math.floor(deltaMs / MIN);
    return `${m} хв тому`;
  }
  if (deltaMs < DAY) {
    const h = Math.floor(deltaMs / HOUR);
    return `${h} год тому`;
  }
  const d = Math.floor(deltaMs / DAY);
  if (d <= 7) return `${d} дн тому`;
  return null;
}

export const useAppsStore = create<AppsStoreState>((set, get) => ({
  lastUsed: loadPersisted(),
  markUsed: (id) => {
    const next = { ...get().lastUsed, [id]: Date.now() };
    persist(next);
    set({ lastUsed: next });
  },
  agoLabel: (id, now = Date.now()) => {
    const ts = get().lastUsed[id];
    if (typeof ts !== 'number') return null;
    return formatAgo(now - ts);
  },
}));
