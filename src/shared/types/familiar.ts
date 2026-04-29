/**
 * PHANTOM Familiar — typed envelope for the in-house wisp character.
 *
 * The Familiar is a small spirit-like creature that occasionally manifests on
 * top of the UI. It points at things, drifts across the screen, peeks from
 * edges, sleeps, waves and vanishes. Manifestations are scheduled by the
 * frontend `familiarStore` (subject to a rarity gate + cooldown), or pushed
 * by the backend through the `familiar.manifestation` WS event when the AI
 * explicitly summons the creature inside a chat reply.
 *
 * Phase-5 R1-FAMILIAR-1 (signature feature). The shape is shared between
 * the frontend store, the chat scene `phantom_manifest`, and the backend
 * route `/familiar/manifest`. Adding a pose or trigger requires touching:
 *   1. this file (the closed unions),
 *   2. `frontend/src/components/familiar/FamiliarSVG.tsx` (the visual),
 *   3. `frontend/src/stores/familiarStore.ts` (rarity gate / cooldown),
 *   4. `backend/api/routes_familiar.py` (the request schema mirror),
 *   5. `backend/ai/scenes.py` (the AI tool registry mirror),
 *   6. `docs/PHANTOM_FAMILIAR.md` (the design batch-3 prompt).
 */

/**
 * Closed enum of poses the Familiar can settle into. The visual file
 * provides one `<g>` group per pose; AnimatePresence cross-fades between
 * them. New poses require a new `<g>` plus a new entry here.
 */
export type FamiliarPose =
  | 'idle'
  | 'floating'
  | 'pointing'
  | 'peeking'
  | 'sleeping'
  | 'waving'
  | 'vanishing';

/**
 * Closed enum of reasons the Familiar appears. Each trigger has a
 * conventional default pose (see `DEFAULT_POSE_FOR_TRIGGER` in
 * `familiarStore.ts`) but callers can override per-manifestation.
 */
export type ManifestTrigger =
  | 'state-transition'
  | 'first-feature-hint'
  | 'idle-timeout'
  | 'ai-summon'
  | 'easter-egg'
  | 'greeting';

/**
 * How often the Familiar is allowed to appear, set per-operator from
 * Settings › Personality. The store consults this to decide whether a
 * candidate manifestation passes the rarity gate.
 *   - `off`    → never appears (test-summon button still works).
 *   - `rare`   → 1-in-8 attempts pass.
 *   - `normal` → 1-in-3 attempts pass.
 *   - `often`  → 1-in-1.5 attempts pass.
 * AI summons (`ai-summon`) and operator test summons (`easter-egg`)
 * bypass the gate so the Familiar never goes silent on demand.
 */
export type FamiliarRarity = 'off' | 'rare' | 'normal' | 'often';

/**
 * Optional anchor for `pointing` pose: either a CSS selector that resolves
 * to a single DOM node (the Familiar will hover-and-point at its bounding
 * rect), or a literal viewport coordinate. The renderer recomputes the
 * anchor on `resize` so the tendril stays correct on layout changes.
 */
export interface FamiliarTarget {
  selector?: string;
  /** Viewport-coordinate fallback (CSS pixels). */
  x?: number;
  y?: number;
}

/**
 * One in-flight manifestation. Persisted only inside the store — the AKG
 * timeline records {trigger, pose, durationMs} as a tiny event for replay,
 * not the full instance. `id` is a ULID-shaped string so the renderer can
 * key its `<AnimatePresence>` element without `Math.random()` churn.
 */
export interface FamiliarManifestation {
  id: string;
  pose: FamiliarPose;
  /** Total wall-clock lifetime in ms. The store auto-dismisses on expiry. */
  durationMs: number;
  trigger: ManifestTrigger;
  /** Optional caption rendered next to the creature for `ai-summon` etc. */
  message?: string;
  /** Anchor for `pointing`; ignored for other poses. */
  target?: FamiliarTarget;
  /** Wall-clock ms when the manifestation began (Date.now()). */
  startedAtMs: number;
}

/**
 * Default pose ↔ trigger mapping. Centralised so backend (route_familiar.py)
 * and frontend (`familiarStore`) can stay in sync without duplicating
 * heuristics across languages. Front-of-mind copy: idle-timeout is the
 * "yawn moment", first-feature-hint is the explanatory point, greeting is
 * the wave.
 */
export const DEFAULT_POSE_FOR_TRIGGER: Record<ManifestTrigger, FamiliarPose> = {
  'state-transition': 'floating',
  'first-feature-hint': 'pointing',
  'idle-timeout': 'sleeping',
  'ai-summon': 'waving',
  'easter-egg': 'waving',
  'greeting': 'waving',
};

/**
 * Default lifetime per pose, ms. Picked so the creature never overstays its
 * welcome on a 7" device — the long ones are floating + sleeping (drift /
 * idle) and the short ones are pointing + waving (gestural).
 */
export const DEFAULT_DURATION_FOR_POSE: Record<FamiliarPose, number> = {
  idle: 4500,
  floating: 6500,
  pointing: 4000,
  peeking: 3500,
  sleeping: 8000,
  waving: 3000,
  vanishing: 1200,
};

/**
 * `ChatScene` arm for AI-summoned Familiars (the `phantom_manifest` kind)
 * lives in `./chat.ts` to avoid a circular re-export — `chat.ts` already
 * imports `FamiliarPose`/`FamiliarTarget` from this module.
 */
