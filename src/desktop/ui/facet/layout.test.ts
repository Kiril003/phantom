import { describe, expect, it } from 'vitest';
import { placeFacet, Viewport } from './layout';
import { Rect, rectsOverlap } from './types';

const VP: Viewport = { w: 1920, h: 1080 };
const LEDGER = { w: 360, h: 236 };

// The Breath Line band + the Sigil corner — the two zones a Facet must dodge.
function reserved(vp: Viewport): Rect[] {
  const bw = Math.min(760, vp.w * 0.6);
  return [
    { x: (vp.w - bw) / 2, y: vp.h * 0.28, w: bw, h: vp.h * 0.46 },
    { x: vp.w - 360, y: vp.h - 168, w: 360, h: 168 },
  ];
}

function within(r: Rect, vp: Viewport): boolean {
  return r.x >= 0 && r.y >= 0 && r.x + r.w <= vp.w && r.y + r.h <= vp.h;
}

describe('facet self-layout', () => {
  it('places a shard inside the viewport, clear of the reserved zones', () => {
    const r = placeFacet(VP, LEDGER, reserved(VP), []);
    expect(within(r, VP)).toBe(true);
    for (const z of reserved(VP)) expect(rectsOverlap(r, z)).toBe(false);
  });

  it('never overlaps an already-placed Facet (constraint 2)', () => {
    const first = placeFacet(VP, LEDGER, reserved(VP), []);
    const second = placeFacet(VP, { w: 300, h: 100 }, reserved(VP), [first]);
    expect(within(second, VP)).toBe(true);
    expect(rectsOverlap(first, second)).toBe(false);
  });

  it('packs several shards with none overlapping each other or reserved', () => {
    const placed: Rect[] = [];
    for (let i = 0; i < 5; i += 1) {
      const r = placeFacet(VP, LEDGER, reserved(VP), placed);
      for (const p of placed) expect(rectsOverlap(r, p)).toBe(false);
      for (const z of reserved(VP)) expect(rectsOverlap(r, z)).toBe(false);
      placed.push(r);
    }
    expect(placed).toHaveLength(5);
  });

  it('still returns an in-bounds rect when the screen is saturated', () => {
    const wall: Rect[] = [{ x: 0, y: 0, w: VP.w, h: VP.h }];
    const r = placeFacet(VP, LEDGER, wall, []);
    expect(within(r, VP)).toBe(true);
  });
});
