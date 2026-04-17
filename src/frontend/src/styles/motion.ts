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
