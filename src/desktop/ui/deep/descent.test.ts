import { describe, expect, it } from 'vitest';
import {
  ascend,
  Depth,
  depthOf,
  descend,
  DIVE_MS,
  floorOpacity,
  initial,
  inTransit,
  surfaceOpacity,
  tick,
} from './descent';

/** Run the camera until it settles, as rAF would. */
function settle(s = initial(), steps = 40, dt = DIVE_MS / 10) {
  let cur = s;
  for (let i = 0; i < steps && inTransit(cur); i += 1) cur = tick(cur, dt);
  return cur;
}

describe('the descent', () => {
  it('starts on the Surface with no camera depth', () => {
    const s = initial();
    expect(s.phase).toBe('surface');
    expect(s.camera.z).toBe(0);
    expect(depthOf(s.camera.z)).toBe(Depth.SURFACE);
  });

  it('dives from the Surface to the ATLAS floor and arrives exactly once', () => {
    const dived = settle(descend(initial(), 'ledger-1'));
    expect(dived.phase).toBe('atlas');
    expect(dived.camera.z).toBe(1);
    expect(depthOf(dived.camera.z)).toBe(Depth.ATLAS);
    // Ticking at the floor is inert — no overshoot, no re-arrival.
    expect(tick(dived, 500)).toEqual(dived);
  });

  it('passes through the Constellation band on the way down', () => {
    const mid = tick(descend(initial(), null), DIVE_MS / 2);
    expect(mid.phase).toBe('descending');
    expect(depthOf(mid.camera.z)).toBe(Depth.CONSTELLATION);
    expect(inTransit(mid)).toBe(true);
  });

  it('surfaces back to exactly where it left (Law III: reversible)', () => {
    const back = settle(ascend(settle(descend(initial(), 'ledger-1'))));
    expect(back.phase).toBe('surface');
    expect(back.camera.z).toBe(0);
    expect(inTransit(back)).toBe(false);
  });

  it('hands the aim back intact — focus survives the dive', () => {
    const dived = settle(descend(initial(), 'monitor-7'));
    expect(dived.camera.anchor).toBe('monitor-7');
    const back = settle(ascend(dived));
    expect(back.restoreTarget).toBe('monitor-7');
  });

  it('is interruptible: reversing mid-dive turns around where the camera is', () => {
    const mid = tick(descend(initial(), 'a'), DIVE_MS / 2);
    const turning = ascend(mid);
    expect(turning.phase).toBe('ascending');
    // It resumes from where it actually is, not from the floor it was heading to.
    expect(turning.camera.z).toBeCloseTo(0.5, 5);
    expect(settle(turning).phase).toBe('surface');
  });

  it('reversing an ascent does not clobber the aim being restored', () => {
    const mid = tick(ascend(settle(descend(initial(), 'ledger-1'))), DIVE_MS / 2);
    const redived = descend(mid, null);
    expect(redived.phase).toBe('descending');
    expect(redived.restoreTarget).toBe('ledger-1');
  });

  it('never double-fires a dive already under way', () => {
    const diving = descend(initial(), 'a');
    expect(descend(diving, 'b')).toBe(diving);
    const floor = settle(diving);
    expect(descend(floor, 'c')).toBe(floor);
  });

  it('ascending from the Surface is inert', () => {
    const s = initial();
    expect(ascend(s)).toBe(s);
  });

  it('fades the Surface out and rises the floor to meet you', () => {
    const s = initial();
    expect(surfaceOpacity(s)).toBe(1);
    expect(floorOpacity(s)).toBe(0);

    const floor = settle(descend(s, null));
    expect(surfaceOpacity(floor)).toBe(0);
    expect(floorOpacity(floor)).toBe(1);

    // The floor stays absent early in the dive — it rises, never switches on.
    const early = tick(descend(s, null), DIVE_MS * 0.2);
    expect(floorOpacity(early)).toBe(0);
    expect(surfaceOpacity(early)).toBeGreaterThan(0);
  });
});
