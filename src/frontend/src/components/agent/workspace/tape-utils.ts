/**
 * Tape — pure dedup / collapse helpers.
 *
 * The Tape strip lives in the right column of OperatorLayout v3 and is the
 * canonical timeline of agent events. The reflector loop can produce
 * dozens of identical entries (e.g. Pro 2.5 400 INVALID_ARGUMENT spam) and
 * the FE collapses runs of identical signatures into a single row with a
 * `repeats` counter so the operator sees `↻N` instead of N stacked cards.
 */

export type TapeRowKind = 'reflection' | 'action' | 'observation' | 'event';

export interface TapeRow {
  /** Stable identity for React keys. */
  id: string;
  kind: TapeRowKind;
  /** ISO-string or epoch-ms — opaque to the dedup logic. */
  ts: string | number;
  /** Reflection verdict, observation kind, etc. */
  verdict?: string | null;
  /** Step index this row belongs to. */
  step_idx?: number | null;
  /** Action name when kind === 'action'. */
  action?: string | null;
  /** Free-form short label rendered as the row body. */
  label?: string;
  /** Number of merged consecutive entries (1 if no dedup). */
  repeats?: number;
}

/** Two rows share a signature iff they would be visually identical. */
export function sameSignature(a: TapeRow, b: TapeRow): boolean {
  return (
    a.kind === b.kind &&
    (a.verdict ?? null) === (b.verdict ?? null) &&
    (a.step_idx ?? null) === (b.step_idx ?? null) &&
    (a.action ?? null) === (b.action ?? null) &&
    (a.label ?? '') === (b.label ?? '')
  );
}

/**
 * Walk `items` in order; when consecutive rows share a signature, merge
 * them into the previous row by bumping `repeats` and adopting the newer
 * timestamp. Returns a new array (input is never mutated).
 */
export function collapseRepeats(items: readonly TapeRow[]): TapeRow[] {
  const out: TapeRow[] = [];
  for (const r of items) {
    const last = out.length > 0 ? out[out.length - 1] : null;
    if (last && sameSignature(last, r)) {
      out[out.length - 1] = {
        ...last,
        ts: r.ts,
        repeats: (last.repeats ?? 1) + 1,
      };
      continue;
    }
    out.push({ ...r, repeats: r.repeats ?? 1 });
  }
  return out;
}
