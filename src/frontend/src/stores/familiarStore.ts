/**
 * familiarStore — global state for the PHANTOM Familiar wisp.
 *
 * One in-flight `currentManifestation` at a time. `manifest()` is the single
 * entry point; it consults the rarity gate + cooldown, materialises a fresh
 * `FamiliarManifestation`, and schedules an auto-dismiss when its lifetime
 * expires. `dismiss()` lets a caller (or the AnimatePresence exit) tear it
 * down early.
 *
 * Rarity gate semantics:
 *   - off    → never appears (test-summon button still works).
 *   - rare   → 1-in-8 attempts pass.
 *   - normal → 1-in-3 attempts pass.
 *   - often  → 1-in-1.5 attempts pass (=> 2/3 of attempts pass).
 *
 * Cooldown:  30 s minimum gap between two consecutive successful summons.
 * AI-summons (`ai-summon`) and operator test summons (`easter-egg`) bypass
 * BOTH the rarity gate and the cooldown — when the operator presses the
 * test button or the AI hands you a `phantom_manifest` scene, the Familiar
 * MUST appear, otherwise the feature feels broken.
 *
 * No external deps beyond `zustand` (already in the bundle).
 */
import { create } from 'zustand';
import {
  DEFAULT_DURATION_FOR_POSE,
  DEFAULT_POSE_FOR_TRIGGER,
  type FamiliarEmotion,
  type FamiliarManifestation,
  type FamiliarPose,
  type FamiliarRarity,
  type FamiliarTarget,
  type ManifestTrigger,
} from '@shared/types';

const COOLDOWN_MS = 30_000;

const RARITY_PASS_RATE: Record<FamiliarRarity, number> = {
  off: 0,
  rare: 1 / 8,
  normal: 1 / 3,
  often: 1 / 1.5, // ≈ 0.667
};

/** Triggers that bypass the rarity gate AND the cooldown. */
const ALWAYS_TRIGGERS: ReadonlyArray<ManifestTrigger> = [
  'ai-summon',
  'easter-egg',
];

export interface ManifestOptions {
  pose?: FamiliarPose;
  emotion?: FamiliarEmotion;
  message?: string;
  durationMs?: number;
  target?: FamiliarTarget;
  /** Skip the rarity gate + cooldown (forced summon). */
  force?: boolean;
  /** Do not start the auto-dismiss timer until startTimer(id) is called. */
  delayTimer?: boolean;
}

interface FamiliarStoreState {
  currentManifestation: FamiliarManifestation | null;
  rarity: FamiliarRarity;
  /** Wall-clock ms of the most recent successful summon, or 0 if none. */
  lastSummonAtMs: number;

  setRarity: (r: FamiliarRarity) => void;

  /**
   * Try to schedule a manifestation. Returns the new manifestation if it
   * passed the gate, or `null` if it was suppressed (rarity / cooldown /
   * already-active). Pure side effect: starts an auto-dismiss timer.
   */
  manifest: (
    trigger: ManifestTrigger,
    opts?: ManifestOptions,
  ) => FamiliarManifestation | null;

  /** Force-dismiss any in-flight manifestation. */
  dismiss: () => void;

  /** Start the auto-dismiss timer for a manifestation (if delayed). */
  startTimer: (id: string) => void;
}

let dismissTimer: ReturnType<typeof setTimeout> | null = null;
let manifestationCounter = 0;

function makeId(): string {
  // ULID-ish: time prefix + monotonic counter. Avoids Math.random() so
  // tests are deterministic when the timer source is mocked.
  manifestationCounter = (manifestationCounter + 1) % 10_000;
  return `fam-${Date.now().toString(36)}-${manifestationCounter
    .toString(36)
    .padStart(3, '0')}`;
}

function rarityRoll(rarity: FamiliarRarity): boolean {
  const rate = RARITY_PASS_RATE[rarity] ?? 0;
  if (rate <= 0) return false;
  if (rate >= 1) return true;
  return Math.random() < rate;
}

export const useFamiliarStore = create<FamiliarStoreState>((set, get) => ({
  currentManifestation: null,
  rarity: 'normal',
  lastSummonAtMs: 0,

  setRarity: (r) => set({ rarity: r }),

  manifest: (trigger, opts = {}) => {
    const state = get();
    const now = Date.now();
    const force = opts.force === true || ALWAYS_TRIGGERS.includes(trigger);

    // Already-active wins (a queued summon mid-flight is ignored to
    // avoid rapid pose flicker).
    if (state.currentManifestation && !force) {
      return null;
    }

    if (!force) {
      // Rarity gate (off → never).
      if (state.rarity === 'off') return null;
      if (!rarityRoll(state.rarity)) return null;

      // Cooldown.
      if (now - state.lastSummonAtMs < COOLDOWN_MS) return null;
    }

    const pose: FamiliarPose = opts.pose ?? DEFAULT_POSE_FOR_TRIGGER[trigger];
    const durationMs =
      opts.durationMs ?? DEFAULT_DURATION_FOR_POSE[pose] ?? 4000;

    const manifestation: FamiliarManifestation = {
      id: makeId(),
      pose,
      emotion: opts.emotion,
      durationMs,
      trigger,
      message: opts.message,
      target: opts.target,
      startedAtMs: now,
    };

    if (!opts.delayTimer) {
      if (dismissTimer) {
        clearTimeout(dismissTimer);
      }
      dismissTimer = setTimeout(() => {
        dismissTimer = null;
        const current = get().currentManifestation;
        if (current && current.id === manifestation.id) {
          set({ currentManifestation: null });
        }
      }, durationMs);
    } else {
      if (dismissTimer) {
        clearTimeout(dismissTimer);
        dismissTimer = null;
      }
    }

    set({ currentManifestation: manifestation, lastSummonAtMs: now });
    return manifestation;
  },

  startTimer: (id: string) => {
    const state = get();
    const current = state.currentManifestation;
    if (!current || current.id !== id) return;

    if (dismissTimer) {
      clearTimeout(dismissTimer);
    }
    
    dismissTimer = setTimeout(() => {
      dismissTimer = null;
      const latest = get().currentManifestation;
      if (latest && latest.id === id) {
        set({ currentManifestation: null });
      }
    }, current.durationMs);
  },

  dismiss: () => {
    if (dismissTimer) {
      clearTimeout(dismissTimer);
      dismissTimer = null;
    }
    set({ currentManifestation: null });
  },
}));

/* ── DevTools handle ─────────────────────────────────────────────────────── */
/* eslint-disable @typescript-eslint/no-explicit-any */
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  (window as any).__phantom = (window as any).__phantom ?? {};
  (window as any).__phantom.familiar = useFamiliarStore;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
