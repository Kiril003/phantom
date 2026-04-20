"""
Phase 9.4b — UserStatedSource.

When the user says "я в Одесі" / "I'm in Kyiv", Part 2's chat handler
geocodes the place and calls :func:`set_user_stated` with the coordinates.
We trust the user more than IP (they know where they are) but less than
hardware GPS (they could be wrong, lie, or have cached an old location).

Cache TTL defaults to 24 h: a stated location becomes stale if the user
hasn't referred to it again for a day.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from config import config

from ..base import LocationEstimate, LocalizationSource


_cache: Optional[LocationEstimate] = None


def set_user_stated(
    *,
    lat: float,
    lon: float,
    place_name: Optional[str] = None,  # noqa: ARG001 — stored indirectly
    confidence: float = 0.7,
    accuracy_m: Optional[float] = 2000.0,
    timestamp: Optional[datetime] = None,
) -> LocationEstimate:
    """Record a user-stated current location. Overwrites any prior value."""
    global _cache
    ts = timestamp or datetime.now(tz=timezone.utc)
    est = LocationEstimate(
        lat=lat,
        lon=lon,
        source="user_stated",
        confidence=round(confidence, 3),
        accuracy_m=accuracy_m,
        timestamp=ts,
        trust_level=80,
    )
    _cache = est
    return est


def clear_user_stated() -> None:
    global _cache
    _cache = None


def peek_user_stated() -> Optional[LocationEstimate]:
    return _cache


class UserStatedSource(LocalizationSource):
    name = "user_stated"
    trust_level = 80

    def is_available(self) -> bool:
        return self._fresh() is not None

    def _fresh(self) -> Optional[LocationEstimate]:
        if _cache is None:
            return None
        ttl_s = float(
            getattr(config, "agent_user_stated_ttl_s", 24 * 3600) or 24 * 3600
        )
        age = (datetime.now(tz=timezone.utc) - _cache.timestamp).total_seconds()
        if age > ttl_s:
            return None
        return _cache

    async def get_position(self) -> Optional[LocationEstimate]:
        return self._fresh()


__all__ = [
    "UserStatedSource",
    "set_user_stated",
    "clear_user_stated",
    "peek_user_stated",
]
