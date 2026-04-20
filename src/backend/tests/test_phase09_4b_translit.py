"""
Phase 9.4b bug-fix — transliteration fallback tests.

The operator in Ostrava searches "парк" (UA Cyrillic) against OSM tags in
Latin Czech. Without a transliteration fallback the search returns empty
and the UI shows "No intel matches". These tests cover the char-level
UA 2010 table, the word-level dictionary, and the query-expansion helper.
"""
from __future__ import annotations

from agent.localization.translit import (
    expand_query,
    has_cyrillic,
    has_latin,
    transliterate_latin_to_uk,
    transliterate_uk_to_latin,
)


def test_uk_to_latin_includes_park():
    """The canonical Ostrava case: 'парк' must produce 'park'."""
    out = transliterate_uk_to_latin("парк")
    assert any(v.lower() == "park" for v in out), out


def test_uk_to_latin_preserves_spacing_and_capitals():
    """'кафе на Подолі' → word containing 'cafe na Podoli' (or similar)."""
    out = transliterate_uk_to_latin("кафе на Подолі")
    # At least one candidate must contain the Latin form with proper case.
    assert any("Podoli" in v for v in out), out
    # All forms are Latin-only (no Cyrillic leakage).
    assert all(not has_cyrillic(v) for v in out), out


def test_uk_to_latin_empty_input():
    assert transliterate_uk_to_latin("") == []


def test_uk_to_latin_noop_for_latin():
    """Latin-only input returns empty list — nothing to transliterate."""
    assert transliterate_uk_to_latin("park") == []
    assert transliterate_uk_to_latin("Park Komenského") == []


def test_latin_to_uk_word_dictionary():
    """English place word 'park' should map back to 'парк'."""
    out = transliterate_latin_to_uk("park")
    assert any("парк" in v for v in out), out


def test_latin_to_uk_noop_when_no_dictionary_hit():
    """Latin text with no recognised place words returns empty list."""
    assert transliterate_latin_to_uk("komenskeho") == []


def test_expand_query_empty():
    assert expand_query("") == []
    assert expand_query("   ") == []


def test_expand_query_noop_for_ascii_word():
    """'park' has no Cyrillic → original is returned; dict match adds 'парк'."""
    out = expand_query("park")
    assert out[0] == "park"
    # Dictionary match means Cyrillic form also appears.
    assert any("парк" in v for v in out), out


def test_expand_query_cyrillic_returns_latin():
    """'парк' → ['парк', 'park'] (at minimum)."""
    out = expand_query("парк")
    assert "парк" in out
    assert any(v.lower() == "park" for v in out), out


def test_expand_query_dedup_and_strip():
    """Whitespace-trimmed and deduplicated."""
    out = expand_query("  парк  ")
    assert out[0] == "парк"
    assert len(out) == len(set(v.lower() for v in out))


def test_expand_query_mixed_phrase():
    """Phrase 'кафе на Подолі' expands with Cyrillic and Latin forms."""
    out = expand_query("кафе на Подолі")
    assert "кафе на Подолі" in out
    assert any("Podoli" in v for v in out), out


def test_has_cyrillic_and_has_latin():
    assert has_cyrillic("парк") and not has_latin("парк")
    assert has_latin("park") and not has_cyrillic("park")
    assert has_cyrillic("park/парк") and has_latin("park/парк")


def test_char_level_handles_special_letters():
    """щ, ї, ю, я, ь must map per the UA table."""
    # 'щ' → 'shch'
    assert any("shch" in v.lower() for v in transliterate_uk_to_latin("щось"))
    # 'ї' at word start → 'yi'; inside → 'i'
    assert any(v.lower().startswith("yi") for v in transliterate_uk_to_latin("їжа"))
    # Soft sign is dropped.
    assert any("l" in v.lower() and "ь" not in v for v in transliterate_uk_to_latin("сіль"))
