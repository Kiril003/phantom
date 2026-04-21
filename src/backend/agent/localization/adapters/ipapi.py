"""
Phase 9.4b — ipapi.co adapter.

Free tier: 1000 req/day, no API key required. We cap at 900 to leave
headroom (operator scripts, health checks, manual probes). Responses are
cached for 10 minutes: IP geolocation rarely changes within a session.

Returns a :class:`LocationEstimate` with ``source="ip_estimate"`` and
``trust_level=30`` (IpEstimateSource reclassifies if needed). Network
errors, parse errors, and rate-limit exhaustion all surface as ``None``
— never raise, so the caller can fall through silently.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

import httpx
from cachetools import TTLCache

from config import config

from .. import service_health
from ..base import LocationEstimate
from .rate_limiter import DailyRateLimiter

# Phase 9.4c audit C3 — replace manual time-based cache with a bounded
# TTLCache. maxsize=4 covers the handful of recent egress-IP estimates we
# ever hold (main + test/mock instances); TTL preserves the 10 min policy.
#
# Phase 9.4c.1 hotfix — cache the raw coordinates tuple, not the
# LocationEstimate itself. The estimate carries its own ``timestamp``
# field, and returning the same object twice made the resolver's sanity
# check see ``dt_s == 0`` and reject every repeat as a replay. By caching
# raw data and minting a fresh estimate on each retrieval we preserve the
# 10-min dedup policy without freezing the timestamp.
_CACHE_MAX = 4
_CURRENT_KEY = "current"

logger = logging.getLogger(__name__)


class IpApiLocator:
    URL = "https://ipapi.co/json/"
    CACHE_TTL_S = 600.0  # 10 min

    def __init__(self, rate_limit: Optional[DailyRateLimiter] = None) -> None:
        cap = int(getattr(config, "agent_ip_locator_rate_per_day", 900) or 900)
        self._rate_limit = rate_limit if rate_limit is not None else DailyRateLimiter(cap)
        self._cache: TTLCache[str, tuple[float, float, float]] = TTLCache(
            maxsize=_CACHE_MAX, ttl=self.CACHE_TTL_S,
        )

    # ── Introspection ────────────────────────────────────────────────────────

    def can_request_or_has_cache(self) -> bool:
        if _CURRENT_KEY in self._cache:
            return True
        return self._rate_limit.can_request()

    def remaining_budget(self) -> int:
        return self._rate_limit.remaining()

    def reset_cache(self) -> None:
        self._cache.clear()

    # ── Lookup ───────────────────────────────────────────────────────────────

    async def locate_current_ip(self) -> Optional[LocationEstimate]:
        """Return a LocationEstimate for the current egress IP, or None.

        Returns the cached value when fresh. Burns a budget slot on cache
        miss. Network/parse failures return None and do not mark the rate
        limiter (so transient outages don't cost budget).
        """
        cached = self._cache.get(_CURRENT_KEY)
        if cached is not None:
            lat, lon, accuracy_m = cached
            return self._build_estimate(lat, lon, accuracy_m)

        if not self._rate_limit.can_request():
            logger.info("ipapi budget exhausted — skipping lookup")
            return None

        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(self.URL)
            resp.raise_for_status()
            data = resp.json()
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning("ipapi lookup network/parse failure: %s", exc)
            service_health.mark_failure("ipapi", str(exc))
            return None

        try:
            lat = float(data["latitude"])
            lon = float(data["longitude"])
        except (KeyError, TypeError, ValueError) as exc:
            logger.warning("ipapi lookup malformed payload: %s", exc)
            return None

        # Some error responses still come back HTTP 200 with an "error" key.
        if data.get("error"):
            logger.info("ipapi lookup error=%s reason=%s", data.get("error"), data.get("reason"))
            return None

        self._rate_limit.mark_request()
        accuracy_m = 50_000.0  # city-level
        self._cache[_CURRENT_KEY] = (lat, lon, accuracy_m)
        service_health.mark_success("ipapi")
        return self._build_estimate(lat, lon, accuracy_m)

    @staticmethod
    def _build_estimate(lat: float, lon: float, accuracy_m: float) -> LocationEstimate:
        return LocationEstimate(
            lat=lat,
            lon=lon,
            source="ip_estimate",
            confidence=0.3,
            accuracy_m=accuracy_m,
            timestamp=datetime.now(tz=timezone.utc),
            trust_level=30,
        )


# ── Singleton ───────────────────────────────────────────────────────────────

_default: Optional[IpApiLocator] = None


def get_default_ipapi() -> IpApiLocator:
    global _default
    if _default is None:
        _default = IpApiLocator()
    return _default


def set_default_ipapi(locator: Optional[IpApiLocator]) -> None:
    global _default
    _default = locator


__all__ = ["IpApiLocator", "get_default_ipapi", "set_default_ipapi"]
