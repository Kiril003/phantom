/**
 * Phase 9.4b bug-fix — Cyrillic <-> Latin transliteration for map search.
 *
 * Mirrors `src/backend/agent/localization/translit.py`. See the Python
 * module's docstring for the why. This frontend copy exists because the
 * map search filter runs client-side (`TacticalMap.tsx`); duplicating
 * the tiny tables is cheaper than a round-trip for every keystroke.
 */

// UA 2010 Romanisation table (lowercase Cyrillic → [start-of-word, elsewhere]).
const UK_CHAR_MAP: Record<string, [string, string]> = {
  'а': ['a', 'a'],
  'б': ['b', 'b'],
  'в': ['v', 'v'],
  'г': ['h', 'h'],
  'ґ': ['g', 'g'],
  'д': ['d', 'd'],
  'е': ['e', 'e'],
  'є': ['ye', 'ie'],
  'ж': ['zh', 'zh'],
  'з': ['z', 'z'],
  'и': ['y', 'y'],
  'і': ['i', 'i'],
  'ї': ['yi', 'i'],
  'й': ['y', 'i'],
  'к': ['k', 'k'],
  'л': ['l', 'l'],
  'м': ['m', 'm'],
  'н': ['n', 'n'],
  'о': ['o', 'o'],
  'п': ['p', 'p'],
  'р': ['r', 'r'],
  'с': ['s', 's'],
  'т': ['t', 't'],
  'у': ['u', 'u'],
  'ф': ['f', 'f'],
  'х': ['kh', 'kh'],
  'ц': ['ts', 'ts'],
  'ч': ['ch', 'ch'],
  'ш': ['sh', 'sh'],
  'щ': ['shch', 'shch'],
  'ь': ['', ''],
  'ю': ['yu', 'iu'],
  'я': ['ya', 'ia'],
  "'": ['', ''],
  '’': ['', ''],
  'ё': ['yo', 'io'],
  'ъ': ['', ''],
  'ы': ['y', 'y'],
  'э': ['e', 'e'],
};

const PLACE_WORD_PAIRS: Array<[string, string]> = [
  ['парк', 'park'],
  ['вулиця', 'street'],
  ['вулиця', 'vulytsya'],
  ['площа', 'square'],
  ['школа', 'school'],
  ['магазин', 'shop'],
  ['магазин', 'store'],
  ['кафе', 'cafe'],
  ['ресторан', 'restaurant'],
  ['метро', 'metro'],
  ['супермаркет', 'supermarket'],
  ['аптека', 'pharmacy'],
  ['банк', 'bank'],
  ['готель', 'hotel'],
  ['лікарня', 'hospital'],
  ['зупинка', 'stop'],
  ['вокзал', 'station'],
];

const UK_TO_LATIN_WORDS: Record<string, string[]> = {};
const LATIN_TO_UK_WORDS: Record<string, string[]> = {};
for (const [uk, lat] of PLACE_WORD_PAIRS) {
  (UK_TO_LATIN_WORDS[uk] ||= []).push(lat);
  (LATIN_TO_UK_WORDS[lat] ||= []).push(uk);
}

const CYRILLIC_RX = /[\u0400-\u04FF]/;
const LATIN_RX = /[A-Za-z]/;

export function hasCyrillic(text: string): boolean {
  return CYRILLIC_RX.test(text);
}

export function hasLatin(text: string): boolean {
  return LATIN_RX.test(text);
}

function matchCase(source: string, target: string): string {
  if (!source || !target) return target;
  if (source === source.toUpperCase() && source !== source.toLowerCase()) {
    return target.toUpperCase();
  }
  if (source[0] === source[0].toUpperCase() && source[0] !== source[0].toLowerCase()) {
    return target.slice(0, 1).toUpperCase() + target.slice(1);
  }
  return target;
}

function transliterateCharLevel(text: string): string {
  if (!text) return '';
  const out: string[] = [];
  let prevIsLetter = false;
  for (const ch of text) {
    const lower = ch.toLowerCase();
    const atWordStart: boolean = !prevIsLetter;
    const mapping = UK_CHAR_MAP[lower];
    if (mapping !== undefined) {
      const [startForm, restForm] = mapping;
      let latin: string = atWordStart ? startForm : restForm;
      if (ch !== lower && latin) {
        latin = latin.slice(0, 1).toUpperCase() + latin.slice(1);
      }
      out.push(latin);
      prevIsLetter = latin.length > 0;
    } else {
      out.push(ch);
      prevIsLetter = /[\p{L}]/u.test(ch);
    }
  }
  return out.join('');
}

export function transliterateUkToLatin(text: string): string[] {
  if (!text || !hasCyrillic(text)) return [];
  const charLevel = transliterateCharLevel(text);
  const candidates: string[] = [charLevel];

  // Word-level overrides with char-level for the rest.
  const wordLevel = text.replace(/[\p{L}']+/gu, (w) => {
    const lw = w.toLowerCase();
    if (UK_TO_LATIN_WORDS[lw]) {
      return matchCase(w, UK_TO_LATIN_WORDS[lw][0]);
    }
    return w;
  });
  const folded = hasCyrillic(wordLevel) ? transliterateCharLevel(wordLevel) : wordLevel;
  if (folded && folded !== charLevel) candidates.push(folded);

  return dedupExclude(candidates, text);
}

export function transliterateLatinToUk(text: string): string[] {
  if (!text || !hasLatin(text)) return [];
  let matched = false;
  const out = text.replace(/[A-Za-z']+/g, (w) => {
    const lw = w.toLowerCase();
    if (LATIN_TO_UK_WORDS[lw]) {
      matched = true;
      return matchCase(w, LATIN_TO_UK_WORDS[lw][0]);
    }
    return w;
  });
  if (!matched) return [];
  return dedupExclude([out], text);
}

export function expandQuery(text: string): string[] {
  const norm = text.normalize('NFKC').trim();
  if (!norm) return [];
  const results: string[] = [norm];
  if (hasCyrillic(norm)) results.push(...transliterateUkToLatin(norm));
  if (hasLatin(norm)) results.push(...transliterateLatinToUk(norm));
  return dedupExclude(results, null);
}

function dedupExclude(items: string[], exclude: string | null): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of items) {
    if (!s) continue;
    const key = s.toLowerCase();
    if (exclude !== null && s === exclude) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}
