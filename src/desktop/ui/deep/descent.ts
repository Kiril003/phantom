/** The Deep — Z-axis descent (Stratum 3 scaffold, Law IV).
 *
 *  Semantic zoom is the only navigation: the Surface (Facets on the Film) and
 *  the ATLAS floor are one continuum at different magnifications, not two
 *  screens. This is the state machine for the dive — pure, DOM-free, and
 *  unit-tested, so the descent can be proven correct before a single isometric
 *  triangle is rendered.
 *
 *  Camera invariants the dive must honour:
 *   - **Reversible.** Every descent can be un-dived; `ascend()` from any phase
 *     returns to exactly the Surface it left (Law III: nothing is closed).
 *   - **Interruptible.** Reversing mid-dive does not snap or double-fire; the
 *     camera resumes from where it actually is, not from where it was going.
 *   - **Anchored.** The attended Facet is the anchor: the camera descends
 *     *through* it, and surfacing restores it as the aim. Focus survives the
 *     dive — that is the whole point of the scaffold.
 *   - **Focus-safe.** No phase of the dive touches an OS window: the Deep is
 *     DOM inside the same click-through Film, so the host keeps its keyboard.
 */

/** Magnification bands (§Law IV). The Deep is not a screen — it is a depth. */
export const Depth = {
  /** Facets on the Film: Stratum 1/2. */
  SURFACE: 0,
  /** Mid-dive: the Surface recedes, the floor has not yet resolved. */
  CONSTELLATION: 1,
  /** The ATLAS floor. */
  ATLAS: 2,
} as const;
export type Depth = (typeof Depth)[keyof typeof Depth];

export type Phase = 'surface' | 'descending' | 'atlas' | 'ascending';

export interface Camera {
  /** 0 = Surface, 1 = ATLAS floor. Continuous, so the render can interpolate. */
  z: number;
  /** Where the dive is pointed: the anchor Facet's id, if any. */
  anchor: string | null;
}

export interface DeepState {
  phase: Phase;
  camera: Camera;
  /** The aim held on the Surface, restored verbatim on surfacing. */
  restoreTarget: string | null;
}

/** Seconds-free: the dive advances by normalised progress, so the caller owns
 *  the clock (rAF in the app, explicit ticks in tests). */
export const DIVE_MS = 900;

export function initial(): DeepState {
  return { phase: 'surface', camera: { z: 0, anchor: null }, restoreTarget: null };
}

export function depthOf(z: number): Depth {
  if (z <= 0.001) return Depth.SURFACE;
  if (z >= 0.999) return Depth.ATLAS;
  return Depth.CONSTELLATION;
}

/** Begin the dive. The attended Facet becomes the anchor and is remembered so
 *  the aim can be handed back intact when we surface. Diving while already
 *  descending or below is a no-op — the camera never double-fires. */
export function descend(s: DeepState, anchor: string | null): DeepState {
  if (s.phase === 'descending' || s.phase === 'atlas') return s;
  return {
    phase: 'descending',
    camera: { z: s.camera.z, anchor: anchor ?? s.camera.anchor },
    // Only capture the Surface aim on the way down from the Surface itself;
    // reversing an ascent must not overwrite what we are returning to.
    restoreTarget: s.phase === 'surface' ? anchor : s.restoreTarget,
  };
}

/** Reverse the dive. Interruptible: from mid-descent the camera simply turns
 *  around at its current z rather than snapping to the floor first. */
export function ascend(s: DeepState): DeepState {
  if (s.phase === 'surface' || s.phase === 'ascending') return s;
  return { ...s, phase: 'ascending' };
}

/** Advance the camera by `dt` ms. Returns the next state; phases resolve at the
 *  ends of the travel, so `atlas`/`surface` are only ever reached by arriving. */
export function tick(s: DeepState, dt: number): DeepState {
  const step = dt / DIVE_MS;

  if (s.phase === 'descending') {
    const z = Math.min(1, s.camera.z + step);
    return {
      ...s,
      phase: z >= 1 ? 'atlas' : 'descending',
      camera: { ...s.camera, z },
    };
  }

  if (s.phase === 'ascending') {
    const z = Math.max(0, s.camera.z - step);
    if (z <= 0) {
      // Surfaced: the aim is handed back exactly as it was left.
      return {
        phase: 'surface',
        camera: { z: 0, anchor: null },
        restoreTarget: s.restoreTarget,
      };
    }
    return { ...s, camera: { ...s.camera, z } };
  }

  return s;
}

/** True while the camera is between bands — the Surface must dim and the floor
 *  must not yet accept verbs. */
export function inTransit(s: DeepState): boolean {
  return s.phase === 'descending' || s.phase === 'ascending';
}

/** The Surface's opacity as the camera falls away from it: full at the Surface,
 *  gone by the floor. Rendered by CSS; computed here so it is testable. */
export function surfaceOpacity(s: DeepState): number {
  return Math.max(0, 1 - s.camera.z * 1.25);
}

/** The ATLAS floor resolves only in the last third of the dive — it should feel
 *  like something rising to meet you, not a screen being switched on. */
export function floorOpacity(s: DeepState): number {
  return Math.max(0, Math.min(1, (s.camera.z - 0.35) / 0.65));
}
