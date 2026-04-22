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
from datetime import datetime, timedelta, timezone
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

# Phase 9.4c-qw-hotfix — circuit-breaker thresholds. Without this, every
# context_engine tick (~500 ms) that found no cache + budget remaining
# fired another HTTP GET, got 429 from ipapi.co, returned None without
# burning the daily budget, and re-fired on the next tick. Result: log
# spam at 1-2 lines/sec for hours. Backoff stages live as a sorted list
# of (consecutive_failures_required, cooldown_seconds) so the policy is
# tweakable without touching the trip logic.
_BREAKER_BACKOFF_STAGES: tuple[tuple[int, int], ...] = (
    (10, 60 * 60),   # 10+ failures → 60 min
    (6, 30 * 60),    # 6-9 failures → 30 min
    (3, 10 * 60),    # 3-5 failures → 10 min
)

logger = logging.getLogger(__name__)


def _cooldown_for_failures(consecutive_failures: int) -> int:
    """Return cooldown in seconds for the given failure streak. 0 = don't trip yet."""
    for threshold, seconds in _BREAKER_BACKOFF_STAGES:
        if consecutive_failures >= threshold:
            return seconds
    return 0


class IpApiLocator:
    URL = "https://ipapi.co/json/"
    CACHE_TTL_S = 600.0  # 10 min

    def __init__(self, rate_limit: Optional[DailyRateLimiter] = None) -> None:
        cap = int(getattr(config, "agent_ip_locator_rate_per_day", 900) or 900)
        self._rate_limit = rate_limit if rate_limit is not None else DailyRateLimiter(cap)
        self._cache: TTLCache[str, tuple[float, float, float]] = TTLCache(
            maxsize=_CACHE_MAX, ttl=self.CACHE_TTL_S,
        )
        # Phase 9.4c-qw-hotfix — circuit breaker state.
        self._consecutive_failures: int = 0
        self._disabled_until: Optional[datetime] = None

    # ── Introspection ────────────────────────────────────────────────────────

    def can_request_or_has_cache(self) -> bool:
        if _CURRENT_KEY in self._cache:
            return True
        if self._circuit_open():
            return False
        return self._rate_limit.can_request()

    def remaining_budget(self) -> int:
        return self._rate_limit.remaining()

    def reset_cache(self) -> None:
        self._cache.clear()

    def reset_breaker(self) -> None:
        """Tests / operator action: clear the circuit-breaker state."""
        self._consecutive_failures = 0
        self._disabled_until = None

    def breaker_state(self) -> tuple[int, Optional[datetime]]:
        """Introspection helper for tests + diagnostics."""
        return (self._consecutive_failures, self._disabled_until)

    # ── Circuit breaker ─────────────────────────────────────────────────────

    def _circuit_open(self) -> bool:
        """True while the breaker is in its cooldown window."""
        if self._disabled_until is None:
            return False
        if datetime.now(tz=timezone.utc) >= self._disabled_until:
            # Cooldown elapsed; let exactly one retry through. Caller
            # mutates state again on success or further failure.
            return False
        return True

    def _record_failure(self, exc: Exception) -> None:
        """Increment the failure streak and arm the breaker if past a threshold."""
        self._consecutive_failures += 1
        cooldown_s = _cooldown_for_failures(self._consecutive_failures)
        if cooldown_s > 0:
            self._disabled_until = datetime.now(tz=timezone.utc) + timedelta(seconds=cooldown_s)
            logger.warning(
                "IpApiLocator circuit breaker OPEN: %d consecutive failures, "
                "disabled for %d min. Last error: %s",
                self._consecutive_failures, cooldown_s // 60, exc,
            )
        else:
            logger.debug(
                "IpApiLocator transient failure %d/3: %s",
                self._consecutive_failures, exc,
            )

    def _record_success(self) -> None:
        """Clear breaker state after a successful API call."""
        if self._consecutive_failures or self._disabled_until is not None:
            logger.info(
                "IpApiLocator circuit breaker CLOSED after %d failures",
                self._consecutive_failures,
            )
        self._consecutive_failures = 0
        self._disabled_until = None

    # ── Lookup ───────────────────────────────────────────────────────────────

    async def locate_current_ip(self) -> Optional[LocationEstimate]:
        """Return a LocationEstimate for the current egress IP, or None.

        Returns the cached value when fresh. Burns a budget slot on cache
        miss. Network/parse failures return None and do not mark the rate
        limiter (so transient outages don't cost budget). Repeated failures
        trip a circuit breaker so the resolver stops re-firing each tick.
        """
        cached = self._cache.get(_CURRENT_KEY)
        if cached is not None:
            lat, lon, accuracy_m = cached
            return self._build_estimate(lat, lon, accuracy_m)

        # Phase 9.4c-qw-hotfix — bail out fast when the breaker is open.
        # Without this, a 429-returning ipapi.co would keep getting hit
        # at every snapshot tick and spam the log.
        if self._circuit_open():
            logger.debug("ipapi circuit breaker open — skipping lookup")
            return None

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
            self._record_failure(exc)
            return None

        try:
            lat = float(data["latitude"])
            lon = float(data["longitude"])
        except (KeyError, TypeError, ValueError) as exc:
            logger.warning("ipapi lookup malformed payload: %s", exc)
            self._record_failure(exc)
            return None

        # Some error responses still come back HTTP 200 with an "error" key.
        if data.get("error"):
            logger.info("ipapi lookup error=%s reason=%s", data.get("error"), data.get("reason"))
            self._record_failure(RuntimeError(str(data.get("reason") or data.get("error"))))
            return None

        self._rate_limit.mark_request()
        accuracy_m = 50_000.0  # city-level
        self._cache[_CURRENT_KEY] = (lat, lon, accuracy_m)
        service_health.mark_success("ipapi")
        self._record_success()
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
