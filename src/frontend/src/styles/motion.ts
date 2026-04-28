/** PHANTOM OS — Motion Presets
 * Framer Motion 11 animation presets.
 * All durations are multiplied by CSS --motion-scale at usage site.
 */

export const EASE_PHANTOM = [0.16, 1, 0.3, 1] as const;

export const motion = {
  fadeIn: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    duration: 200,
  },
  slideUp: {
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    duration: 280,
  },
  slideOver: {
    initial: { x: '100%' },
    animate: { x: 0 },
    duration: 400,
  },
  stateTransition: {
    duration: 600,
    ease: EASE_PHANTOM,
  },
  pulse: {
    animate: { opacity: [0.4, 1, 0.4] },
    duration: 2000,
    repeat: Infinity,
  },
  heartbeat: {
    animate: { scale: [1, 1.06, 1] },
    duration: 1400,
    repeat: Infinity,
  },
  alarm: {
    animate: { scale: [1, 1.1, 1] },
    duration: 600,
    repeat: Infinity,
  },
} as const;

/** Get duration adjusted by motion scale (read from CSS var).
 *
 * Combines the state-driven multiplier (--motion-scale) with the per-user
 * setting (--motion-scale-user, from Settings › Theme › Швидкість анімацій)
 * so both axes compose naturally — a SENTINEL spike stays fast even when a
 * user has globally dialled motion down.
 */
export function getScaledDuration(baseMs: number): number {
  if (typeof document === 'undefined') return baseMs;
  const rootStyle = getComputedStyle(document.documentElement);
  const stateScale = parseFloat(rootStyle.getPropertyValue('--motion-scale') || '1') || 1;
  const userScale = parseFloat(rootStyle.getPropertyValue('--motion-scale-user') || '1') || 1;
  const combined = stateScale * userScale;
  return baseMs * (1 / (combined || 1));
}

/** Framer Motion transition with phantom easing */
export function phantomTransition(durationMs: number) {
  return {
    duration: durationMs / 1000,
    ease: EASE_PHANTOM as unknown as number[],
  };
}

// ─── Day-4 Block W-2b — phantomVariants motion vocab (ADR-CP-001) ─────────────
//
// Single named export that every chat-cluster (and wider) animation site
// MUST consume via `getPhantomTransition(key)`. Closes U2-ANIM-G1 / H1 / M1
// (dialect drift) by giving Framer Motion call sites exactly one vocabulary,
// and wires `getScaledDuration` everywhere — `--motion-scale` (state) and
// `--motion-scale-user` (settings) both compose at every animation.
//
// W-2 Wave-2 will replace inline `transition={{ duration, ease }}` literals
// across the chat surface; W-2b ships the helpers + a smoke migration so the
// vocab is provably reachable. Adding a new variant = explicit edit here +
// `as const` constrains every call site to a known key (TS catches misuse at
// compile time, vitest catches drift at run time).

export interface PhantomVariant {
  /** Optional initial Framer state. Omit for repeating-only animations. */
  initial?: Record<string, number | number[]>;
  /** Animate-to state (or keyframe array for repeat animations). */
  animate?: Record<string, number | number[]>;
  /** Optional exit state for AnimatePresence. */
  exit?: Record<string, number | number[]>;
  /** Base duration in milliseconds, scaled at call time via getScaledDuration. */
  baseMs: number;
  /** Pass-through to Framer's `transition.repeat`. */
  repeat?: number;
  /** Stagger between sequential children, in ms. Used by panel-reveal sites. */
  stagger?: number;
}

/** Closed motion vocabulary. New variants require an edit + ADR amendment. */
export const phantomVariants = {
  /** Chat MessageBubble entry (replaces inline `{ duration: 0.24, ease: ... }`). */
  bubbleEnter: {
    initial: { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0 },
    baseMs: 240,
  },
  /** ChatScene panel reveal (W-2 composer per-panel). */
  panelReveal: {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    baseMs: 280,
  },
  /** Stagger between sequential ChatScene panels. */
  panelStagger: {
    baseMs: 280,
    stagger: 80,
  },
  /** AnimatePresence in/out for ChatScene mount/unmount. */
  scenePresence: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    baseMs: 200,
  },
  /** System-row notice + ghost preview reveal. */
  ghostPreview: {
    initial: { opacity: 0, y: 4 },
    animate: { opacity: 1, y: 0 },
    baseMs: 220,
  },
  /** Streaming "thinking" pulse. */
  thinkingPulse: {
    animate: { opacity: [0.3, 1, 0.3] },
    baseMs: 1000,
    repeat: Infinity,
  },
  /** Sentinel ping dot. */
  pingDot: {
    animate: { opacity: [0.2, 1, 0.2] },
    baseMs: 1000,
    repeat: Infinity,
  },
  /** Streaming caret blink. */
  cursorBlink: {
    animate: { opacity: [0.3, 1, 0.3] },
    baseMs: 1000,
    repeat: Infinity,
  },
} as const;

export type PhantomVariantKey = keyof typeof phantomVariants;

/** Framer transition for a named variant. Honours `--motion-scale` ×
 * `--motion-scale-user` automatically. */
export function getPhantomTransition(key: PhantomVariantKey) {
  const v = phantomVariants[key];
  return phantomTransition(getScaledDuration(v.baseMs));
}
