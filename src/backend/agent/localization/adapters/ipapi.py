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
import time
from datetime import datetime, timezone
from typing import Optional

import httpx

from config import config

from ..base import LocationEstimate
from .rate_limiter import DailyRateLimiter

logger = logging.getLogger(__name__)


class IpApiLocator:
    URL = "https://ipapi.co/json/"
    CACHE_TTL_S = 600.0  # 10 min

    def __init__(self, rate_limit: Optional[DailyRateLimiter] = None) -> None:
        cap = int(getattr(config, "agent_ip_locator_rate_per_day", 900) or 900)
        self._rate_limit = rate_limit if rate_limit is not None else DailyRateLimiter(cap)
        self._cache_value: Optional[LocationEstimate] = None
        self._cache_at: float = 0.0

    # ── Introspection ────────────────────────────────────────────────────────

    def can_request_or_has_cache(self) -> bool:
        if self._cache_value is not None and (time.time() - self._cache_at) < self.CACHE_TTL_S:
            return True
        return self._rate_limit.can_request()

    def remaining_budget(self) -> int:
        return self._rate_limit.remaining()

    def reset_cache(self) -> None:
        self._cache_value = None
        self._cache_at = 0.0

    # ── Lookup ───────────────────────────────────────────────────────────────

    async def locate_current_ip(self) -> Optional[LocationEstimate]:
        """Return a LocationEstimate for the current egress IP, or None.

        Returns the cached value when fresh. Burns a budget slot on cache
        miss. Network/parse failures return None and do not mark the rate
        limiter (so transient outages don't cost budget).
        """
        now = time.time()
        if self._cache_value is not None and (now - self._cache_at) < self.CACHE_TTL_S:
            return self._cache_value

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
        estimate = LocationEstimate(
            lat=lat,
            lon=lon,
            source="ip_estimate",
            confidence=0.3,
            accuracy_m=50_000.0,  # city-level
            timestamp=datetime.now(tz=timezone.utc),
            trust_level=30,
        )
        self._cache_value = estimate
        self._cache_at = now
        return estimate


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
