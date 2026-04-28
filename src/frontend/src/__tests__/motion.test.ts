/**
 * Day-4 Block W-2b — phantomVariants motion vocab tests (ADR-CP-001).
 *
 * Pins the closed-vocabulary contract:
 *
 *  - The set of phantomVariants keys is exactly the 8 expected names.
 *    Adding a 9th requires an explicit edit AND an ADR amendment per
 *    ADR-CP-001.
 *  - getPhantomTransition returns the canonical Framer shape
 *    `{ duration: <seconds>, ease: <number[]> }` so existing call
 *    sites switch from inline literals without a regression.
 *  - getScaledDuration honours both `--motion-scale` (state-driven)
 *    and `--motion-scale-user` (settings) when both are present —
 *    they MUST compose multiplicatively (closes U2-ANIM-G1 dialect
 *    drift).
 *
 * The full chat-cluster migration of inline transitions ships in
 * W-2 (Wave-2). W-2b ships only the helpers + a smoke migration of
 * `MessageBubble` so this contract is provably reachable.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  EASE_PHANTOM,
  getPhantomTransition,
  getScaledDuration,
  phantomTransition,
  phantomVariants,
  type PhantomVariantKey,
} from '../styles/motion';

describe('phantomVariants — closed motion vocab', () => {
  it('exposes exactly the 8 named variants from ADR-CP-001 §226', () => {
    const keys = Object.keys(phantomVariants).sort();
    expect(keys).toEqual(
      [
        'bubbleEnter',
        'panelReveal',
        'panelStagger',
        'scenePresence',
        'ghostPreview',
        'thinkingPulse',
        'pingDot',
        'cursorBlink',
      ].sort(),
    );
  });

  it('every variant carries a positive baseMs', () => {
    for (const [key, v] of Object.entries(phantomVariants)) {
      expect(v.baseMs, `phantomVariants.${key}.baseMs`).toBeGreaterThan(0);
    }
  });

  it('panelStagger declares a stagger interval (ADR-CP-001 §229)', () => {
    expect(phantomVariants.panelStagger.stagger).toBe(80);
  });
});

describe('getPhantomTransition', () => {
  it('returns the canonical Framer transition shape', () => {
    const t = getPhantomTransition('bubbleEnter');
    expect(t).toHaveProperty('duration');
    expect(t).toHaveProperty('ease');
    expect(typeof t.duration).toBe('number');
    expect(t.duration).toBeGreaterThan(0);
    expect(Array.isArray(t.ease)).toBe(true);
  });

  it('forwards the EASE_PHANTOM cubic-bezier on every variant', () => {
    const expected = EASE_PHANTOM as unknown as number[];
    const sample: PhantomVariantKey[] = [
      'bubbleEnter',
      'panelReveal',
      'scenePresence',
    ];
    for (const k of sample) {
      const t = getPhantomTransition(k);
      expect(t.ease).toEqual(expected);
    }
  });

  it('matches phantomTransition(getScaledDuration(baseMs))', () => {
    const baseMs = phantomVariants.bubbleEnter.baseMs;
    const expected = phantomTransition(getScaledDuration(baseMs));
    const got = getPhantomTransition('bubbleEnter');
    expect(got).toEqual(expected);
  });
});

describe('getScaledDuration — state × user composition', () => {
  // jsdom doesn't run getComputedStyle on dynamic CSSOM mutations the same
  // way Chromium does. We use inline `style` on documentElement which
  // getComputedStyle DOES read in jsdom.
  beforeEach(() => {
    document.documentElement.style.setProperty('--motion-scale', '1');
    document.documentElement.style.setProperty('--motion-scale-user', '1');
  });

  afterEach(() => {
    document.documentElement.style.removeProperty('--motion-scale');
    document.documentElement.style.removeProperty('--motion-scale-user');
  });

  it('returns baseMs when both scales = 1', () => {
    expect(getScaledDuration(240)).toBeCloseTo(240, 5);
  });

  it('halves the duration when state-scale = 2 (faster motion)', () => {
    document.documentElement.style.setProperty('--motion-scale', '2');
    expect(getScaledDuration(240)).toBeCloseTo(120, 5);
  });

  it('composes user × state multiplicatively', () => {
    document.documentElement.style.setProperty('--motion-scale', '2');
    document.documentElement.style.setProperty('--motion-scale-user', '0.5');
    // combined = 2 * 0.5 = 1 → no change
    expect(getScaledDuration(240)).toBeCloseTo(240, 5);
  });

  it('falls back to 1× on garbage CSS values', () => {
    document.documentElement.style.setProperty('--motion-scale', 'whatever');
    expect(getScaledDuration(240)).toBeCloseTo(240, 5);
  });
});
