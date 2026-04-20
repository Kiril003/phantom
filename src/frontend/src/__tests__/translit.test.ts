/**
 * Phase 9.4b bug-fix — transliteration helper tests (frontend mirror of
 * the backend module). Ensures the TacticalMap search filter can match
 * Cyrillic queries against Latin records.
 */
import { describe, it, expect } from 'vitest';
import {
  expandQuery,
  hasCyrillic,
  hasLatin,
  transliterateLatinToUk,
  transliterateUkToLatin,
} from '../services/translit';

describe('transliterateUkToLatin', () => {
  it('maps парк to park', () => {
    const out = transliterateUkToLatin('парк');
    expect(out.some((v) => v.toLowerCase() === 'park')).toBe(true);
  });

  it('preserves case and spacing for "кафе на Подолі"', () => {
    const out = transliterateUkToLatin('кафе на Подолі');
    expect(out.some((v) => v.includes('Podoli'))).toBe(true);
    // No Cyrillic leakage in any candidate.
    for (const v of out) expect(hasCyrillic(v)).toBe(false);
  });

  it('returns empty for empty input', () => {
    expect(transliterateUkToLatin('')).toEqual([]);
  });

  it('is a no-op for Latin input', () => {
    expect(transliterateUkToLatin('park')).toEqual([]);
  });
});

describe('transliterateLatinToUk', () => {
  it('maps park back to парк', () => {
    const out = transliterateLatinToUk('park');
    expect(out.some((v) => v.includes('парк'))).toBe(true);
  });

  it('returns empty when no dictionary word matches', () => {
    expect(transliterateLatinToUk('komenskeho')).toEqual([]);
  });
});

describe('expandQuery', () => {
  it('returns empty for whitespace-only input', () => {
    expect(expandQuery('')).toEqual([]);
    expect(expandQuery('   ')).toEqual([]);
  });

  it('includes original as the first candidate', () => {
    const out = expandQuery('парк');
    expect(out[0]).toBe('парк');
  });

  it('adds Latin form for Cyrillic query', () => {
    const out = expandQuery('парк');
    expect(out.some((v) => v.toLowerCase() === 'park')).toBe(true);
  });

  it('adds Cyrillic form for recognised Latin place-type word', () => {
    const out = expandQuery('park');
    expect(out.some((v) => v.includes('парк'))).toBe(true);
  });

  it('dedupes and trims whitespace', () => {
    const out = expandQuery('  парк  ');
    expect(out[0]).toBe('парк');
    const lowered = out.map((v) => v.toLowerCase());
    expect(new Set(lowered).size).toBe(lowered.length);
  });
});

describe('hasCyrillic / hasLatin', () => {
  it('detects scripts', () => {
    expect(hasCyrillic('парк')).toBe(true);
    expect(hasLatin('парк')).toBe(false);
    expect(hasLatin('park')).toBe(true);
    expect(hasCyrillic('park')).toBe(false);
  });
});
