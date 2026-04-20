"""
Phase 9.4b — BrowserGeolocationSource.

Frontend calls :func:`submit_browser_estimate` via the
``POST /map/geolocation/submit`` endpoint whenever ``navigator.geolocation``
produces a reading. The source reads the most recent submission if it's
within the configured freshness window; past that window the submission
goes stale and the source becomes unavailable (falls through to IP).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from config import config

from ..base import LocationEstimate, LocalizationSource


# Module-level latest submission — single tenant, as PHANTOM is single-user.
_latest: Optional[LocationEstimate] = None


def submit_browser_estimate(
    *,
    lat: float,
    lon: float,
    accuracy_m: Optional[float] = None,
    timestamp: Optional[datetime] = None,
) -> LocationEstimate:
    """Accept a browser geolocation submission. Returns the stored estimate."""
    global _latest
    ts = timestamp or datetime.now(tz=timezone.utc)
    # Confidence scales inversely with declared accuracy. < 30 m → 0.9,
    # 100 m → 0.7, 1000 m → 0.3, unknown → 0.5.
    if accuracy_m is None:
        conf = 0.5
    elif accuracy_m <= 30:
        conf = 0.9
    elif accuracy_m <= 100:
        conf = 0.75
    elif accuracy_m <= 500:
        conf = 0.5
    else:
        conf = 0.3
    estimate = LocationEstimate(
        lat=lat,
        lon=lon,
        source="browser_geolocation",
        confidence=round(conf, 3),
        accuracy_m=accuracy_m,
        timestamp=ts,
        trust_level=70,
    )
    _latest = estimate
    return estimate


def clear_browser_estimate() -> None:
    """Reset the cached submission (tests + sign-out)."""
    global _latest
    _latest = None


def peek_browser_estimate() -> Optional[LocationEstimate]:
    return _latest


class BrowserGeolocationSource(LocalizationSource):
    name = "browser_geolocation"
    trust_level = 70

    def is_available(self) -> bool:
        return self._fresh_estimate() is not None

    def _fresh_estimate(self) -> Optional[LocationEstimate]:
        if _latest is None:
            return None
        freshness_s = float(
            getattr(config, "agent_browser_geolocation_freshness_s", 60.0) or 60.0
        )
        age = (datetime.now(tz=timezone.utc) - _latest.timestamp).total_seconds()
        if age > freshness_s:
            return None
        return _latest

    async def get_position(self) -> Optional[LocationEstimate]:
        return self._fresh_estimate()


__all__ = [
    "BrowserGeolocationSource",
    "submit_browser_estimate",
    "clear_browser_estimate",
    "peek_browser_estimate",
]
