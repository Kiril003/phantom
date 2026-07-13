/** The six-verb grammar (§2.2) as a pure reducer. Every Facet answers to the
 *  same verbs, so callers (manager.ts) never special-case a kind — they apply a
 *  verb and act on the returned transition. No DOM, no registry: this only
 *  computes next-state, which is what makes the grammar unit-testable. */

import { FacetState, GhostTrace, Plane, Verb } from './types';

export type VerbResult =
  | { kind: 'update'; state: FacetState }
  | { kind: 'dissolve'; ghost: GhostTrace }
  | { kind: 'spawn'; state: FacetState; sibling: FacetState };

let cleaveSeq = 0;

export function applyVerb(
  state: FacetState,
  verb: Verb,
  now: number,
  arg?: unknown,
): VerbResult {
  switch (verb) {
    case Verb.Approach: {
      // Pull one plane closer, capped at the Deep.
      const plane = Math.min(Plane.DEEP, state.plane + 1) as Plane;
      return { kind: 'update', state: { ...state, plane, touchedAt: now } };
    }
    case Verb.Recede: {
      // Push one plane back; never destroyed (Law III). Receding *from* the
      // Film dissolves the shard into a retrievable ghost trace (§2.1).
      if (state.plane > Plane.FILM) {
        const plane = (state.plane - 1) as Plane;
        return { kind: 'update', state: { ...state, plane, touchedAt: now } };
      }
      return {
        kind: 'dissolve',
        ghost: {
          id: `ghost-${state.id}`,
          x: state.rect.x,
          y: state.rect.y,
          w: state.rect.w,
          bornAt: now,
        },
      };
    }
    case Verb.Pin:
      // Promote to / demote from a Fixture.
      return {
        kind: 'update',
        state: { ...state, pinned: !state.pinned, touchedAt: now },
      };
    case Verb.Trace:
      // Reveal / hide the provenance thread.
      return {
        kind: 'update',
        state: { ...state, tracing: !state.tracing, touchedAt: now },
      };
    case Verb.Feed:
      // Give it material — appended if the payload is a list, else replaces.
      return {
        kind: 'update',
        state: { ...state, content: feed(state.content, arg), touchedAt: now },
      };
    case Verb.Cleave: {
      // Split a sub-element into its own sibling Facet.
      const sibling: FacetState = {
        ...state,
        id: `${state.id}~${++cleaveSeq}`,
        content: arg ?? state.content,
        pinned: false,
        tracing: false,
        bornAt: now,
        touchedAt: now,
      };
      return { kind: 'spawn', state: { ...state, touchedAt: now }, sibling };
    }
  }
}

/** Mortality (§2.1): an unpinned Facet with a lifespan recedes after stillness.
 *  The gaze proxy on a pointer-transparent Film is simply time-since-touched —
 *  a Facet is "touched" whenever fresh content lands on it. */
export function isExpired(state: FacetState, now: number): boolean {
  return (
    !state.pinned &&
    state.mortalMs !== null &&
    now - state.touchedAt >= state.mortalMs
  );
}

function feed(content: unknown, material: unknown): unknown {
  if (Array.isArray(content)) return [...content, material];
  return material ?? content;
}
