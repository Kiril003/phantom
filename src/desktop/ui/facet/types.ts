/** AEGIS Facet engine — the unit of materialized content (§2). Pure types and
 *  geometry only; the grammar and the self-layout solver stay DOM-free so they
 *  are unit-testable, and the render layer (manager.ts) is the only part that
 *  touches the Film. Nothing here ever creates or resizes a window — Facets are
 *  DOM inside the click-through Film, which is why they cannot steal focus. */

/** The four planes of the Z-axis ontology (Law I). Blur/scale encode depth. */
export const Plane = { REALITY: 0, FILM: 1, FOCUS: 2, DEEP: 3 } as const;
export type Plane = (typeof Plane)[keyof typeof Plane];

/** `ledger`/`weather` are born from ANIMA's labor; `answer`/`dossier`/`monitor`
 *  are promoted into being by the operator from the Breath Line (§4.2). */
export type FacetKind = 'ledger' | 'weather' | 'answer' | 'dossier' | 'monitor';

/** The six universal verbs (§2.2) — learning one Facet is learning all. */
export enum Verb {
  Approach = 'approach',
  Recede = 'recede',
  Pin = 'pin',
  Feed = 'feed',
  Cleave = 'cleave',
  Trace = 'trace',
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FacetState {
  id: string;
  kind: FacetKind;
  plane: Plane;
  /** A pinned Facet is a Fixture (§2.1): immortal, persists on the Film. */
  pinned: boolean;
  /** Trace (⌘/) revealed — provenance thread shown behind the shard. */
  tracing: boolean;
  /** ms of stillness after which an unpinned Facet self-recedes (§2.1
   *  mortality). null = immortal while its condition holds (e.g. Weather
   *  while labor continues). */
  mortalMs: number | null;
  bornAt: number;
  touchedAt: number;
  rect: Rect;
  /** Opaque per-kind payload (ledger rows, weather intensity, …). */
  content: unknown;
}

export interface GhostTrace {
  id: string;
  /** The 2px luminous filament sits at the receded Facet's former top edge. */
  x: number;
  y: number;
  w: number;
  bornAt: number;
}

/** Axis-aligned overlap test, optionally inflated by a `gap` so placements keep
 *  breathing room and never kiss edges. */
export function rectsOverlap(a: Rect, b: Rect, gap = 0): boolean {
  return (
    a.x < b.x + b.w + gap &&
    a.x + a.w + gap > b.x &&
    a.y < b.y + b.h + gap &&
    a.y + a.h + gap > b.y
  );
}

/** Area of the intersection of two rects (0 if disjoint). */
export function overlapArea(a: Rect, b: Rect): number {
  const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return ox * oy;
}

/** Keep a rect fully inside the viewport with a uniform margin. */
export function clampToViewport(r: Rect, vw: number, vh: number, m = 0): Rect {
  return {
    x: Math.max(m, Math.min(r.x, vw - r.w - m)),
    y: Math.max(m, Math.min(r.y, vh - r.h - m)),
    w: r.w,
    h: r.h,
  };
}
