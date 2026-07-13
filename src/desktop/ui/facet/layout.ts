/** Self-layout solver (§2.1: "placed by the layout engine, never by the
 *  operator"). Given the viewport, the reserved zones (the Breath Line, the
 *  Sigil corner) and the already-placed Facets, it finds a home for a new
 *  shard that overlaps *none* of them — Law V's periphery first, then a scan,
 *  then a least-crowded fallback so it always returns somewhere. Pure geometry;
 *  unit-tested against the two hard guarantees (no reserved overlap, no
 *  facet-facet overlap). */

import { Rect, clampToViewport, overlapArea, rectsOverlap } from './types';

export interface Viewport {
  w: number;
  h: number;
}

export interface PlaceOptions {
  margin?: number;
}

/** Ordered periphery anchors (top-left of the facet). Bottom-center (Breath
 *  Line) and bottom-right (Sigil) are never anchors here — they arrive as
 *  reserved rects and are avoided by the collision test. */
function anchors(vp: Viewport, w: number, h: number, m: number): Rect[] {
  const right = vp.w - m - w;
  const bottom = vp.h - m - h;
  const midY = Math.round((vp.h - h) / 2);
  const upperThird = Math.round(vp.h / 3);
  const centerX = Math.round((vp.w - w) / 2);
  return [
    { x: right, y: m, w, h }, // top-right
    { x: m, y: m, w, h }, // top-left
    { x: right, y: upperThird, w, h }, // right, upper third
    { x: m, y: upperThird, w, h }, // left, upper third
    { x: centerX, y: m, w, h }, // top-center
    { x: right, y: midY, w, h }, // right, middle
    { x: m, y: midY, w, h }, // left, middle
    { x: m, y: bottom, w, h }, // bottom-left
  ];
}

function collides(r: Rect, blockers: Rect[], gap: number): boolean {
  return blockers.some((b) => rectsOverlap(r, b, gap));
}

export function placeFacet(
  vp: Viewport,
  size: { w: number; h: number },
  reserved: Rect[],
  occupied: Rect[],
  opts: PlaceOptions = {},
): Rect {
  const m = opts.margin ?? 24;
  const w = Math.min(size.w, vp.w - 2 * m);
  const h = Math.min(size.h, vp.h - 2 * m);
  const blockers = [...reserved, ...occupied];

  // 1) Periphery anchors — the symbiote owns the edges.
  for (const a of anchors(vp, w, h, m)) {
    const r = clampToViewport(a, vp.w, vp.h, m);
    if (!collides(r, blockers, m)) return r;
  }

  // 2) Coarse grid scan, top→bottom, left→right.
  const step = Math.max(24, Math.round(m));
  for (let y = m; y <= vp.h - h - m; y += step) {
    for (let x = m; x <= vp.w - w - m; x += step) {
      const r = { x, y, w, h };
      if (!collides(r, blockers, m)) return r;
    }
  }

  // 3) Screen is full — the least-crowded cell (top-right bias on ties).
  let best = clampToViewport({ x: vp.w - m - w, y: m, w, h }, vp.w, vp.h, m);
  let bestScore = Infinity;
  for (let y = m; y <= vp.h - h - m; y += step) {
    for (let x = m; x <= vp.w - w - m; x += step) {
      const r = { x, y, w, h };
      const score = blockers.reduce((s, b) => s + overlapArea(r, b), 0);
      if (score < bestScore) {
        bestScore = score;
        best = r;
      }
    }
  }
  return best;
}
