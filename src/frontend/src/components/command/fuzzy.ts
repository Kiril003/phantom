/**
 * fuzzy — нечіткий пошук для командної палітри (Ф1).
 *
 * Підпослідовний матч без залежностей: кожна літера запиту має
 * зустрітись у цілі в тому ж порядку. Бали: старт слова і суцільні
 * прогони цінніші за розсип; коротша ціль при рівному матчі — вища.
 */

export interface FuzzyResult {
  score: number;
  /** Індекси збіглих символів цілі — для підсвітки. */
  indices: number[];
}

const WORD_START_BONUS = 8;
const CONSECUTIVE_BONUS = 5;
const START_OF_TARGET_BONUS = 10;
const GAP_PENALTY = 1;

function isWordStart(target: string, i: number): boolean {
  if (i === 0) return true;
  const prev = target[i - 1];
  return prev === ' ' || prev === '-' || prev === '_' || prev === '.' || prev === ':';
}

/**
 * null — запит не є підпослідовністю цілі. Порожній запит матчить усе
 * з нульовим балом (палітра без фільтра показує повний список).
 */
export function fuzzyMatch(query: string, target: string): FuzzyResult | null {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (q.length === 0) return { score: 0, indices: [] };
  if (q.length > t.length) return null;

  const indices: number[] = [];
  let score = 0;
  let ti = 0;
  let prevMatched = -2;

  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    let found = -1;
    while (ti < t.length) {
      if (t[ti] === ch) {
        found = ti;
        break;
      }
      ti++;
    }
    if (found === -1) return null;

    score += 1;
    if (found === 0) score += START_OF_TARGET_BONUS;
    if (isWordStart(t, found)) score += WORD_START_BONUS;
    if (found === prevMatched + 1) score += CONSECUTIVE_BONUS;
    if (prevMatched >= 0) score -= Math.min(found - prevMatched - 1, 3) * GAP_PENALTY;

    indices.push(found);
    prevMatched = found;
    ti = found + 1;
  }

  // Коротша ціль — точніший збіг.
  score -= Math.floor((t.length - q.length) / 8);
  return { score, indices };
}

/**
 * Найкращий бал серед назви і ключових слів. Індекси підсвітки — лише
 * коли переміг матч по назві (по ключовому слову підсвічувати нічого).
 */
export function fuzzyBest(
  query: string,
  title: string,
  keywords: readonly string[] = [],
): FuzzyResult | null {
  let best = fuzzyMatch(query, title);
  for (const kw of keywords) {
    const m = fuzzyMatch(query, kw);
    if (m && (!best || m.score > best.score)) best = { score: m.score, indices: [] };
  }
  return best;
}
