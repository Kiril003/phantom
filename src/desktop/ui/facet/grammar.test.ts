import { describe, expect, it } from 'vitest';
import { applyVerb, isExpired } from './grammar';
import { FacetState, Plane, Verb } from './types';

function base(over: Partial<FacetState> = {}): FacetState {
  return {
    id: 'f1',
    kind: 'ledger',
    plane: Plane.FILM,
    pinned: false,
    tracing: false,
    mortalMs: 1_000,
    bornAt: 0,
    touchedAt: 0,
    rect: { x: 10, y: 20, w: 100, h: 80 },
    content: [] as unknown[],
    ...over,
  };
}

describe('facet grammar — the six verbs', () => {
  it('Approach pulls one plane closer, capped at the Deep', () => {
    let r = applyVerb(base(), Verb.Approach, 5);
    expect(r).toMatchObject({ kind: 'update' });
    if (r.kind !== 'update') throw new Error('unreachable');
    expect(r.state.plane).toBe(Plane.FOCUS);
    r = applyVerb(base({ plane: Plane.DEEP }), Verb.Approach, 5);
    if (r.kind !== 'update') throw new Error('unreachable');
    expect(r.state.plane).toBe(Plane.DEEP);
  });

  it('Recede above the Film steps back a plane; never destroys', () => {
    const r = applyVerb(base({ plane: Plane.FOCUS }), Verb.Recede, 7);
    expect(r.kind).toBe('update');
    if (r.kind !== 'update') throw new Error('unreachable');
    expect(r.state.plane).toBe(Plane.FILM);
  });

  it('Recede from the Film dissolves into a ghost trace at its former edge', () => {
    const r = applyVerb(base({ plane: Plane.FILM }), Verb.Recede, 9);
    expect(r.kind).toBe('dissolve');
    if (r.kind !== 'dissolve') throw new Error('unreachable');
    expect(r.ghost).toMatchObject({ x: 10, y: 20, w: 100, bornAt: 9 });
  });

  it('Pin and Trace toggle their flags', () => {
    const pinned = applyVerb(base(), Verb.Pin, 1);
    if (pinned.kind !== 'update') throw new Error('unreachable');
    expect(pinned.state.pinned).toBe(true);
    const traced = applyVerb(base(), Verb.Trace, 1);
    if (traced.kind !== 'update') throw new Error('unreachable');
    expect(traced.state.tracing).toBe(true);
  });

  it('Feed appends to a list payload and replaces a scalar one', () => {
    const appended = applyVerb(base({ content: ['a'] }), Verb.Feed, 1, 'b');
    if (appended.kind !== 'update') throw new Error('unreachable');
    expect(appended.state.content).toEqual(['a', 'b']);
    const replaced = applyVerb(base({ content: 'x' }), Verb.Feed, 1, 'y');
    if (replaced.kind !== 'update') throw new Error('unreachable');
    expect(replaced.state.content).toBe('y');
  });

  it('Cleave spawns a distinct, unpinned sibling', () => {
    const r = applyVerb(base({ pinned: true }), Verb.Cleave, 1, 'shard');
    expect(r.kind).toBe('spawn');
    if (r.kind !== 'spawn') throw new Error('unreachable');
    expect(r.sibling.id).not.toBe('f1');
    expect(r.sibling.pinned).toBe(false);
    expect(r.sibling.content).toBe('shard');
  });
});

describe('facet mortality', () => {
  it('pinned Fixtures are immortal', () => {
    expect(isExpired(base({ pinned: true, touchedAt: 0 }), 10_000)).toBe(false);
  });
  it('mortalMs null is immortal', () => {
    expect(isExpired(base({ mortalMs: null, touchedAt: 0 }), 10_000)).toBe(false);
  });
  it('expires only once the stillness meets its lifespan', () => {
    expect(isExpired(base({ touchedAt: 0, mortalMs: 1_000 }), 999)).toBe(false);
    expect(isExpired(base({ touchedAt: 0, mortalMs: 1_000 }), 1_000)).toBe(true);
  });
});
