"""
Phase 9.4b — chat-handler hook for memory-to-geo bridge.

:func:`process_chat_message_for_places` is called from the chat handler
after the user message lands. It:

  1. Extracts place entities via :class:`GeoExtractor` (spaCy + regex
     fallback).
  2. Detects explicit "I'm at X" statements and calls
     :func:`set_user_stated` so the LocalizationResolver picks up the
     user-stated source on the next tick.
  3. Forward-geocodes each unique place via Nominatim (rate-limited,
     cached) and stores each hit as a :class:`MemoryFact` with the
     ``place_*`` columns filled.
  4. Emits a :class:`ProactiveTrigger` of kind ``REGION_CHANGED`` when
     the user's country changes across two stated-location events.

All work is best-effort. Any exception is logged and swallowed so chat
replies never hang on geocoding.
"""
from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from config import config

logger = logging.getLogger(__name__)


# ── Module state for region-change detection ────────────────────────────────

_last_country: Optional[str] = None


def _utcnow() -> datetime:
    return datetime.now(tz=timezone.utc)


@dataclass(frozen=True)
class PlaceIngestResult:
    places_extracted: int
    facts_stored: int
    self_location_set: Optional[str]
    region_transition: Optional[tuple[str, str]]  # (from_country, to_country)


async def process_chat_message_for_places(
    db: AsyncSession,
    *,
    user_id: str,
    session_id: str,
    message_text: str,
) -> PlaceIngestResult:
    """Top-level hook. Never raises — returns a report."""
    extracted = 0
    stored = 0
    stated_place: Optional[str] = None
    transition: Optional[tuple[str, str]] = None

    if not getattr(config, "agent_geo_extractor_enabled", True):
        return PlaceIngestResult(0, 0, None, None)

    try:
        from memory.geo_extractor import get_extractor  # noqa: PLC0415
        extractor = get_extractor()
    except Exception as exc:  # noqa: BLE001
        logger.debug("geo extractor unavailable: %s", exc)
        return PlaceIngestResult(0, 0, None, None)

    # ── 1. Explicit "I'm at X" ──────────────────────────────────────────────
    try:
        stated_raw = extractor.detect_self_location(message_text)
    except Exception as exc:  # noqa: BLE001
        logger.debug("detect_self_location raised: %s", exc)
        stated_raw = None

    from agent.localization.adapters.nominatim import get_default_nominatim
    geocoder = get_default_nominatim()

    if stated_raw:
        try:
            results = await geocoder.geocode(stated_raw, limit=1)
            if results:
                top = results[0]
                from agent.localization.sources.user_stated import set_user_stated
                set_user_stated(
                    lat=top.lat,
                    lon=top.lon,
                    place_name=top.display_name or stated_raw,
                    confidence=0.75,
                    accuracy_m=2000.0,
                )
                stated_place = stated_raw
                # Region-change detection: reverse-geocode to get country.
                try:
                    rev = await geocoder.reverse(top.lat, top.lon)
                    new_country = rev.country if rev is not None else None
                    transition = _maybe_emit_region_transition(new_country)
                except Exception as exc:  # noqa: BLE001
                    logger.debug("region reverse lookup failed: %s", exc)
        except Exception as exc:  # noqa: BLE001
            logger.debug("stated-location geocode failed: %s", exc)

    # ── 2. General place mentions ──────────────────────────────────────────
    try:
        entities = extractor.extract(message_text, lang=_guess_lang(message_text))
    except Exception as exc:  # noqa: BLE001
        logger.debug("NER extract raised: %s", exc)
        entities = []
    extracted = len(entities)

    # Cap at 3 to avoid geocoding spam on a single message.
    for ent in entities[:3]:
        try:
            results = await geocoder.geocode(ent.text, limit=1)
            if not results:
                continue
            top = results[0]
            await _store_place_fact(
                db,
                user_id=user_id,
                session_id=session_id,
                place_text=ent.text,
                display_name=top.display_name,
                lat=top.lat,
                lon=top.lon,
                source="ner_extracted",
                confidence=0.6,
            )
            stored += 1
        except Exception as exc:  # noqa: BLE001
            logger.debug("geocode/store place %r failed: %s", ent.text, exc)
            continue

    return PlaceIngestResult(
        places_extracted=extracted,
        facts_stored=stored,
        self_location_set=stated_place,
        region_transition=transition,
    )


# ── Helpers ─────────────────────────────────────────────────────────────────


def _guess_lang(text: str) -> str:
    # Cheap: any Cyrillic → "uk"; else "en".
    for ch in text:
        if 0x0400 <= ord(ch) <= 0x04FF:
            return "uk"
    return "en"


async def _store_place_fact(
    db: AsyncSession,
    *,
    user_id: str,
    session_id: str,
    place_text: str,
    display_name: str,
    lat: float,
    lon: float,
    source: str,
    confidence: float,
) -> None:
    from db.models import MemoryFact
    fact = MemoryFact(
        id=str(uuid.uuid4()),
        user_id=user_id,
        layer="tactical",
        category="location_reference",
        content=f"Згадано місце: {place_text}",
        importance=0.4,
        source_session_id=session_id,
        place_name=(display_name or place_text)[:256],
        place_lat=float(lat),
        place_lon=float(lon),
        place_source=source,
        place_confidence=round(float(confidence), 3),
    )
    db.add(fact)
    await db.flush()


def _maybe_emit_region_transition(new_country: Optional[str]) -> Optional[tuple[str, str]]:
    """Compare against last-seen country. If changed, emit REGION_CHANGED."""
    global _last_country
    if not new_country:
        return None
    prev = _last_country
    if prev and prev != new_country:
        _emit_region_changed(prev, new_country)
        _last_country = new_country
        return (prev, new_country)
    _last_country = new_country
    return None


def _emit_region_changed(from_country: str, to_country: str) -> None:
    try:
        from agent.cognition.proactive.loop import get_loop  # noqa: PLC0415
        from agent.cognition.proactive.triggers import (  # noqa: PLC0415
            ProactiveTrigger,
            ProactiveTriggerKind,
        )
    except Exception:
        return
    loop = get_loop()
    if loop is None:
        return
    try:
        loop.push_trigger(ProactiveTrigger(
            kind=ProactiveTriggerKind.REGION_CHANGED,
            priority=6,
            context={"from": from_country, "to": to_country, "at": _utcnow().isoformat()},
        ))
    except Exception as exc:  # noqa: BLE001
        logger.debug("push REGION_CHANGED trigger failed: %s", exc)


def reset_region_memory() -> None:
    """Tests: clear the last-country cache."""
    global _last_country
    _last_country = None


__all__ = [
    "PlaceIngestResult",
    "process_chat_message_for_places",
    "reset_region_memory",
]
