/**
 * useFamiliarTriggers — wires real-world events to the familiarStore.
 *
 * Mounted once at App-level (alongside `<PhantomFamiliar />`). Subscribes
 * to four sources:
 *
 *  1. `uiStore.systemState`  — every state transition is a candidate
 *     `state-transition` summon.
 *  2. Idle timer            — 5 minutes without user input (chat send,
 *     voice activity, settings interaction, route change) → a
 *     `idle-timeout` summon (sleeping pose).
 *  3. First-feature open     — `localStorage['phantom-familiar-hints-seen']`
 *     records which features have already been hinted; the first time a
 *     feature is opened, it gets a `first-feature-hint` summon (pointing
 *     pose) at the relevant DOM anchor.
 *  4. Authentication         — the moment `authenticated` flips false→true
 *     fires a `greeting` (waving pose).
 *
 * Each source calls `familiarStore.manifest(trigger, opts)`; the store
 * then applies the rarity gate / cooldown — this hook never decides
 * itself whether the Familiar appears.
 */
import { useEffect, useRef } from 'react';
import { useSystemStore } from '../stores/systemStore';
import { useFamiliarStore } from '../stores/familiarStore';
import { FAMILIAR_STATE_BEHAVIOR, type SystemState } from '@shared/types';

const HINTS_LS_KEY = 'phantom-familiar-hints-seen';
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const USER_INPUT_EVENTS: ReadonlyArray<keyof DocumentEventMap> = [
  'pointerdown',
  'pointermove',
  'keydown',
  'wheel',
  'touchstart',
];

interface HintsState {
  seen: Record<string, true>;
}

function loadHints(): HintsState {
  if (typeof window === 'undefined') return { seen: {} };
  try {
    const raw = window.localStorage.getItem(HINTS_LS_KEY);
    if (!raw) return { seen: {} };
    const parsed = JSON.parse(raw) as HintsState;
    return parsed.seen ? parsed : { seen: {} };
  } catch {
    return { seen: {} };
  }
}

function saveHints(state: HintsState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(HINTS_LS_KEY, JSON.stringify(state));
  } catch {
    /* quota — ignore */
  }
}

/**
 * Mark a feature as "first-time opened" and, if it was the very first
 * time, schedule a `first-feature-hint` summon. The optional `selector`
 * tells the Familiar what to point at — when omitted the wisp simply
 * arrives at the home anchor and waves.
 */
export function markFeatureOpened(
  featureKey: string,
  selector?: string,
): void {
  const hints = loadHints();
  if (hints.seen[featureKey]) return;
  hints.seen[featureKey] = true;
  saveHints(hints);
  useFamiliarStore.getState().manifest('first-feature-hint', {
    target: selector ? { selector } : undefined,
  });
}

/**
 * Erase the persisted hint state. Exposed for tests + the `Reset onboarding`
 * action a future Settings entry might want to add.
 */
export function resetFamiliarHints(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(HINTS_LS_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * The one-shot React hook that wires triggers. Mount in App.tsx (or any
 * always-mounted root) right next to `<PhantomFamiliar />`. Multiple
 * mounts are safe — the idle-timer + state subscriber are local to this
 * effect closure.
 */
export function useFamiliarTriggers(): void {
  const systemState = useSystemStore((s) => s.state);
  const previousState = useSystemStore((s) => s.previousState);
  const authenticated = useSystemStore((s) => s.authenticated);
  const lastAuthRef = useRef<boolean>(authenticated);
  const lastStateRef = useRef<SystemState | null>(null);

  // ── State-transition trigger ──────────────────────────────────────────
  useEffect(() => {
    if (lastStateRef.current !== null && lastStateRef.current !== systemState) {
      // Skip the very first paint (lastStateRef.current === null) so the
      // initial mount doesn't always fire a summon.
      const behavior = FAMILIAR_STATE_BEHAVIOR[systemState];
      useFamiliarStore.getState().manifest('state-transition', {
        pose: behavior.pose,
        emotion: behavior.emotion,
        message: behavior.message,
      });
    }
    lastStateRef.current = systemState;
    // previousState is included only as a refresh trigger for systems
    // that derive transitions from the pair (from, to).
    void previousState;
  }, [systemState, previousState]);

  // ── Greeting trigger ──────────────────────────────────────────────────
  useEffect(() => {
    if (!lastAuthRef.current && authenticated) {
      // Force=true so the rarity gate doesn't suppress the welcome wave.
      // delayTimer=true so the timer doesn't start until the 47MB 3D model loads.
      useFamiliarStore.getState().manifest('greeting', { force: true, delayTimer: true });
    }
    lastAuthRef.current = authenticated;
  }, [authenticated]);

  // ── Idle timer ────────────────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;

    const reset = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        // Only summon if no manifestation is already in flight.
        const cur = useFamiliarStore.getState().currentManifestation;
        if (!cur) {
          useFamiliarStore.getState().manifest('idle-timeout');
        }
      }, IDLE_TIMEOUT_MS);
    };

    USER_INPUT_EVENTS.forEach((evt) =>
      window.addEventListener(evt, reset, { passive: true }),
    );
    reset();

    return () => {
      if (idleTimer) clearTimeout(idleTimer);
      USER_INPUT_EVENTS.forEach((evt) =>
        window.removeEventListener(evt, reset),
      );
    };
  }, []);
}
