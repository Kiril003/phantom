"""
Phase 9.4b bug-fix — Cyrillic <-> Latin transliteration for map search.

Problem: the operator in Ostrava searches "парк" (UA Cyrillic) against
OpenStreetMap data that stores Czech names in Latin ("Park Komenského").
The literal match returns zero results, the UI prints "No intel matches"
and the operator incorrectly concludes PHANTOM does not understand them.

This module is NOT a full NLP system. It provides:

  1. Character-level UA→Latin transliteration using Ukraine's official
     2010 Romanisation table. Covers RU Cyrillic too for robustness.
  2. A tiny word-level translation table for the search terms real users
     actually type ("кафе"/"cafe", "вулиця"/"street", etc.).
  3. An `expand_query` helper that returns a deduplicated list of candidate
     forms (original + transliterations + swapped place-type words) that
     the search layer can OR together.

Wired from the frontend TacticalMap search filter and surfaced here for
any future backend search endpoint.
"""
from __future__ import annotations

import re
import unicodedata


# Ukrainian government Romanisation table (2010).
# Each entry: (lowercase cyrillic, latin at word start, latin elsewhere).
# When start and rest are identical we only use one string.
_UK_CHAR_MAP: dict[str, tuple[str, str]] = {
    "а": ("a", "a"),
    "б": ("b", "b"),
    "в": ("v", "v"),
    "г": ("h", "h"),
    "ґ": ("g", "g"),
    "д": ("d", "d"),
    "е": ("e", "e"),
    "є": ("ye", "ie"),
    "ж": ("zh", "zh"),
    "з": ("z", "z"),
    "и": ("y", "y"),
    "і": ("i", "i"),
    "ї": ("yi", "i"),
    "й": ("y", "i"),
    "к": ("k", "k"),
    "л": ("l", "l"),
    "м": ("m", "m"),
    "н": ("n", "n"),
    "о": ("o", "o"),
    "п": ("p", "p"),
    "р": ("r", "r"),
    "с": ("s", "s"),
    "т": ("t", "t"),
    "у": ("u", "u"),
    "ф": ("f", "f"),
    "х": ("kh", "kh"),
    "ц": ("ts", "ts"),
    "ч": ("ch", "ch"),
    "ш": ("sh", "sh"),
    "щ": ("shch", "shch"),
    "ь": ("", ""),
    "ю": ("yu", "iu"),
    "я": ("ya", "ia"),
    "'": ("", ""),
    "’": ("", ""),
    # Russian letters (for UA/RU mixed input)
    "ё": ("yo", "io"),
    "ъ": ("", ""),
    "ы": ("y", "y"),
    "э": ("e", "e"),
}

# Small place-type dictionary — symmetric. Helps when user types the word
# in the "wrong" language for the current region.
_PLACE_WORD_PAIRS: list[tuple[str, str]] = [
    ("парк", "park"),
    ("вулиця", "street"),
    ("вулиця", "vulytsya"),
    ("площа", "square"),
    ("площа", "ploscha"),
    ("школа", "school"),
    ("магазин", "shop"),
    ("магазин", "store"),
    ("кафе", "cafe"),
    ("ресторан", "restaurant"),
    ("метро", "metro"),
    ("метро", "subway"),
    ("супермаркет", "supermarket"),
    ("аптека", "pharmacy"),
    ("аптека", "apteka"),
    ("банк", "bank"),
    ("готель", "hotel"),
    ("лікарня", "hospital"),
    ("автобус", "bus"),
    ("зупинка", "stop"),
    ("вокзал", "station"),
]

_UK_TO_LATIN_WORDS: dict[str, list[str]] = {}
_LATIN_TO_UK_WORDS: dict[str, list[str]] = {}
for uk_word, lat_word in _PLACE_WORD_PAIRS:
    _UK_TO_LATIN_WORDS.setdefault(uk_word, []).append(lat_word)
    _LATIN_TO_UK_WORDS.setdefault(lat_word, []).append(uk_word)


_CYRILLIC_RX = re.compile(r"[\u0400-\u04FF]")
_LATIN_RX = re.compile(r"[A-Za-z]")


def has_cyrillic(text: str) -> bool:
    return bool(_CYRILLIC_RX.search(text))


def has_latin(text: str) -> bool:
    return bool(_LATIN_RX.search(text))


def _match_case(source: str, target: str) -> str:
    """Preserve the capitalisation of `source` on `target`."""
    if not source or not target:
        return target
    if source.isupper():
        return target.upper()
    if source[0].isupper():
        return target[:1].upper() + target[1:]
    return target


def _transliterate_uk_char_level(text: str) -> str:
    """Convert Cyrillic letters to Latin using the UA 2010 table.

    Keeps non-letter characters (spaces, punctuation, digits) untouched.
    Preserves case per-letter.
    """
    if not text:
        return ""
    out: list[str] = []
    prev_is_letter = False
    for ch in text:
        lower = ch.lower()
        at_word_start = not prev_is_letter
        if lower in _UK_CHAR_MAP:
            start_form, rest_form = _UK_CHAR_MAP[lower]
            latin = start_form if at_word_start else rest_form
            if ch.isupper() and latin:
                latin = latin[:1].upper() + latin[1:]
            out.append(latin)
            prev_is_letter = bool(latin)
        else:
            out.append(ch)
            prev_is_letter = ch.isalpha()
    return "".join(out)


def transliterate_uk_to_latin(text: str) -> list[str]:
    """Return candidate Latin transliterations for a Cyrillic input.

    Returns an empty list when the input contains no Cyrillic letters.
    The list never contains the exact original string (already-Latin
    inputs are a no-op).
    """
    if not text or not has_cyrillic(text):
        return []
    char_level = _transliterate_uk_char_level(text)
    candidates: list[str] = [char_level]

    # Word-level dictionary overrides. Replace recognised Cyrillic words
    # with their Latin counterparts — helps Ostrava-style cases where the
    # char-level translation ("parka") doesn't match the OSM tag ("Park").
    word_rx = re.compile(r"[\w']+", re.UNICODE)

    def _replace_word(mobj: re.Match) -> str:
        w = mobj.group(0)
        lw = w.lower()
        if lw in _UK_TO_LATIN_WORDS:
            return _match_case(w, _UK_TO_LATIN_WORDS[lw][0])
        return w

    word_level = word_rx.sub(_replace_word, text)
    if has_cyrillic(word_level):
        # Some words weren't in the dictionary — fold the rest with char-level.
        word_level = _transliterate_uk_char_level(word_level)
    if word_level and word_level != char_level:
        candidates.append(word_level)

    return _dedup_exclude(candidates, exclude=text)


def transliterate_latin_to_uk(text: str) -> list[str]:
    """Return candidate Cyrillic forms for a Latin input.

    Uses the word-level dictionary only — reverse char-level translit is
    lossy (ts→ц/тс, etc.) and produces false positives. Empty when no
    dictionary word matches.
    """
    if not text or not has_latin(text):
        return []
    word_rx = re.compile(r"[A-Za-z']+")
    matched = False

    def _replace_word(mobj: re.Match) -> str:
        nonlocal matched
        w = mobj.group(0)
        lw = w.lower()
        if lw in _LATIN_TO_UK_WORDS:
            matched = True
            return _match_case(w, _LATIN_TO_UK_WORDS[lw][0])
        return w

    out = word_rx.sub(_replace_word, text)
    return _dedup_exclude([out], exclude=text) if matched else []


def expand_query(text: str) -> list[str]:
    """Return the original query plus every candidate transliteration.

    Used by the search layer to OR-match a user query against records
    stored under a different script. Deduplicated, case-preserved.
    Empty inputs return an empty list.
    """
    norm = unicodedata.normalize("NFKC", text).strip()
    if not norm:
        return []
    results = [norm]
    if has_cyrillic(norm):
        results.extend(transliterate_uk_to_latin(norm))
    if has_latin(norm):
        results.extend(transliterate_latin_to_uk(norm))
    return _dedup_exclude(results, exclude=None)


def _dedup_exclude(items: list[str], exclude: str | None) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for s in items:
        if not s:
            continue
        key = s.lower()
        if exclude is not None and s == exclude:
            continue
        if key in seen:
            continue
        seen.add(key)
        out.append(s)
    return out
