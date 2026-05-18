import { describe, it, expect } from 'vitest';
import {
  collapseRepeats,
  sameSignature,
  type TapeRow,
} from '../components/agent/workspace/tape-utils';

const reflection = (
  id: string,
  step: number,
  verdict: string,
  ts = Date.now(),
): TapeRow => ({
  id,
  kind: 'reflection',
  ts,
  step_idx: step,
  verdict,
});

const action = (id: string, step: number, name: string, ts = Date.now()): TapeRow => ({
  id,
  kind: 'action',
  ts,
  step_idx: step,
  action: name,
});

describe('tape-utils.sameSignature', () => {
  it('matches identical reflections on the same step', () => {
    expect(sameSignature(reflection('a', 0, 'revise_strategy'), reflection('b', 0, 'revise_strategy'))).toBe(true);
  });
  it('rejects different verdicts', () => {
    expect(sameSignature(reflection('a', 0, 'revise_strategy'), reflection('b', 0, 'continue'))).toBe(false);
  });
  it('rejects different step_idx', () => {
    expect(sameSignature(reflection('a', 0, 'revise_strategy'), reflection('b', 1, 'revise_strategy'))).toBe(false);
  });
  it('rejects different kinds', () => {
    expect(sameSignature(reflection('a', 0, 'revise_strategy'), action('b', 0, 'noop'))).toBe(false);
  });
});

describe('tape-utils.collapseRepeats', () => {
  it('returns empty for empty input', () => {
    expect(collapseRepeats([])).toEqual([]);
  });

  it('keeps single non-repeating rows untouched', () => {
    const items = [
      reflection('a', 0, 'continue', 1),
      reflection('b', 1, 'continue', 2),
      reflection('c', 2, 'continue', 3),
    ];
    const out = collapseRepeats(items);
    expect(out).toHaveLength(3);
    expect(out.every((r) => (r.repeats ?? 1) === 1)).toBe(true);
  });

  it('collapses 10 identical reflections into 1 row with ↻10', () => {
    const items: TapeRow[] = [];
    for (let i = 0; i < 10; i++) {
      items.push(reflection(`r-${i}`, 0, 'revise_strategy', 1000 + i));
    }
    const out = collapseRepeats(items);
    expect(out).toHaveLength(1);
    expect(out[0].repeats).toBe(10);
    expect(out[0].ts).toBe(1009); // adopts newest timestamp
  });

  it('does not merge across different verdicts', () => {
    const items = [
      reflection('a', 0, 'revise_strategy', 1),
      reflection('b', 0, 'revise_strategy', 2),
      reflection('c', 0, 'continue', 3),
      reflection('d', 0, 'revise_strategy', 4),
    ];
    const out = collapseRepeats(items);
    expect(out.map((r) => [r.verdict, r.repeats])).toEqual([
      ['revise_strategy', 2],
      ['continue', 1],
      ['revise_strategy', 1],
    ]);
  });

  it('does not mutate the input', () => {
    const items = [
      reflection('a', 0, 'revise_strategy', 1),
      reflection('b', 0, 'revise_strategy', 2),
    ];
    const snapshot = JSON.parse(JSON.stringify(items));
    collapseRepeats(items);
    expect(items).toEqual(snapshot);
  });

  it('treats two actions with the same name on the same step as duplicates', () => {
    const items = [
      action('a', 3, 'shell.run', 100),
      action('b', 3, 'shell.run', 101),
      action('c', 3, 'shell.run', 102),
    ];
    const out = collapseRepeats(items);
    expect(out).toHaveLength(1);
    expect(out[0].repeats).toBe(3);
  });
});
