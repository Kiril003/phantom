"""
Phase 9.4b — place entity extraction from chat messages.

Primary backend: spaCy NER (``en_core_web_sm`` + optional
``uk_core_news_sm``). When spaCy or a language model is unavailable we
fall back to a conservative regex that captures Title-Cased tokens
adjacent to Ukrainian location prepositions ("у Києві", "в Одесі",
"біля Львова"). The regex is intentionally narrow — false positives
here become stray geocode lookups, which waste Nominatim budget.

Public surface:
  PlaceEntity       — dataclass {text, kind, start, end}
  StatedLocation    — dataclass {text, lat_hint, kind=self_location}
  GeoExtractor      — .extract(text, lang) -> list[PlaceEntity]
                      .detect_self_location(text) -> str | None
  get_extractor()   — module singleton

The module NEVER raises on a missing model or missing library — tests
and dev environments without spaCy installed still get the regex
fallback.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Optional

from config import config

logger = logging.getLogger(__name__)


# ── Dataclasses ─────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class PlaceEntity:
    text: str
    kind: str  # "GPE" | "LOC" | "FAC" | "regex"
    start: int
    end: int


# ── Regex fallback ──────────────────────────────────────────────────────────


# Ukrainian + English "I am / was / arrived in/at X".
#   я (в|у|на) {Place}          — "я в Одесі", "я у Києві"
#   зараз (в|у|на) {Place}      — "зараз у Львові"
#   прибув (в|у|на|до) {Place}
#   i'm in {Place} / arrived in {Place}
# The captured group is just the place text; final geocoding normalises
# Ukrainian locative case (Києві → Kyiv).
_STATED_LOCATION_RX = re.compile(
    r"(?:"
    r"(?:^|\s)(?:я|зараз|тут|прибув(?:ла)?|приїхав(?:ла)?|в|у|на)\s+"
    r"(?:я\s+)?(?:у|в|на|до)\s+"
    r"([A-Za-zА-ЯҐЄІЇа-яґєії][A-Za-zА-ЯҐЄІЇа-яґєії\-'']{2,50})"
    r"|"
    r"(?:^|\s)(?:i(?:'m|\s+am)|i\s+was|arrived|i\s+just\s+got)\s+"
    r"(?:in|at|to)\s+"
    r"([A-Z][A-Za-z\-'']{2,50})"
    r")",
    re.IGNORECASE | re.UNICODE,
)

# Plain regex for mentions — captures any standalone Title-Cased noun
# chain, language-agnostic. Used only when spaCy is unavailable.
_MENTION_RX = re.compile(
    r"\b([A-ZА-ЯҐЄІЇ][A-Za-zА-ЯҐЄІЇа-яґєії\-'']{2,50}"
    r"(?:\s+[A-ZА-ЯҐЄІЇ][A-Za-zА-ЯҐЄІЇа-яґєії\-'']{2,50}){0,2})\b",
    re.UNICODE,
)


# ── Extractor ───────────────────────────────────────────────────────────────


_STOPWORDS = {
    "I", "PHANTOM", "Okay", "Ok", "Hi", "Hello", "Thanks",
    "Привіт", "Дякую", "Так", "Ні", "Добре", "Гаразд", "Тоді",
    "Що", "Як", "Де", "Коли", "Чому",
}


class GeoExtractor:
    """Lightweight NER wrapper — spaCy if available, regex otherwise."""

    def __init__(self) -> None:
        self._nlp_en = None
        self._nlp_uk = None
        self._spacy_loaded = False
        self._load_spacy_best_effort()

    def _load_spacy_best_effort(self) -> None:
        try:
            import spacy  # type: ignore[import-untyped]  # noqa: PLC0415
        except ImportError:
            logger.info("spaCy not installed — GeoExtractor will use regex fallback")
            return
        try:
            self._nlp_en = spacy.load("en_core_web_sm")
        except Exception as exc:  # noqa: BLE001
            logger.info("spaCy en_core_web_sm unavailable: %s", exc)
        try:
            self._nlp_uk = spacy.load("uk_core_news_sm")
        except Exception:  # noqa: BLE001
            # Ukrainian model is optional — English handles most place names.
            self._nlp_uk = None
        self._spacy_loaded = self._nlp_en is not None or self._nlp_uk is not None

    # ── Public ──

    def extract(self, text: str, lang: str = "uk") -> list[PlaceEntity]:
        """Return a list of PlaceEntity for text-span hits."""
        if not text or not text.strip():
            return []
        min_len = int(getattr(config, "agent_geo_extractor_min_entity_length", 3) or 3)
        entities: list[PlaceEntity] = []
        nlp = None
        if self._spacy_loaded:
            if lang == "uk" and self._nlp_uk is not None:
                nlp = self._nlp_uk
            elif self._nlp_en is not None:
                nlp = self._nlp_en
        if nlp is not None:
            try:
                doc = nlp(text)
                for ent in doc.ents:
                    if ent.label_ not in ("GPE", "LOC", "FAC"):
                        continue
                    if len(ent.text) < min_len:
                        continue
                    if ent.text in _STOPWORDS:
                        continue
                    entities.append(PlaceEntity(
                        text=ent.text,
                        kind=ent.label_,
                        start=ent.start_char,
                        end=ent.end_char,
                    ))
                return _dedupe_by_text(entities)
            except Exception as exc:  # noqa: BLE001
                logger.debug("spaCy NER raised, falling back to regex: %s", exc)

        # Regex fallback — capture Title-Cased tokens that look like places.
        for match in _MENTION_RX.finditer(text):
            span = match.group(1).strip()
            if not span or span in _STOPWORDS or len(span) < min_len:
                continue
            entities.append(PlaceEntity(
                text=span,
                kind="regex",
                start=match.start(1),
                end=match.end(1),
            ))
        return _dedupe_by_text(entities)

    def detect_self_location(self, text: str) -> Optional[str]:
        """Return the place name the user claims to be at RIGHT NOW, or None.

        Only fires for explicit "я в/у/на {Place}" / "I'm in {Place}" — not
        generic mentions. Used by Part 2 to set UserStatedSource.
        """
        if not text:
            return None
        match = _STATED_LOCATION_RX.search(text)
        if not match:
            return None
        return (match.group(1) or match.group(2) or "").strip() or None


def _dedupe_by_text(entities: list[PlaceEntity]) -> list[PlaceEntity]:
    seen: set[str] = set()
    unique: list[PlaceEntity] = []
    for e in entities:
        key = e.text.casefold()
        if key in seen:
            continue
        seen.add(key)
        unique.append(e)
    return unique


# ── Singleton ───────────────────────────────────────────────────────────────

_extractor: Optional[GeoExtractor] = None


def get_extractor() -> GeoExtractor:
    global _extractor
    if _extractor is None:
        _extractor = GeoExtractor()
    return _extractor


def reset_extractor() -> None:
    """Tests: force a fresh GeoExtractor on next get_extractor()."""
    global _extractor
    _extractor = None


__all__ = ["PlaceEntity", "GeoExtractor", "get_extractor", "reset_extractor"]
