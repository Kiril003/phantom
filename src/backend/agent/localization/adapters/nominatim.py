"""
Phase 9.4b — Nominatim (OpenStreetMap) geocoding adapter.

Usage policy (https://operations.osmfoundation.org/policies/nominatim/):
  * One request per second cap — enforced here.
  * Identifiable User-Agent string required.
  * Cache results; don't re-geocode on every request.

Forward geocode: text → list of candidates (coordinates, display_name).
Reverse geocode: coordinates → address (city, country).

Results are cached for 7 days by default (forward) and 24 h (reverse).
Network failures return `[]` / `None`; they do not raise.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

import httpx
from cachetools import TTLCache

from config import config

from .rate_limiter import PerSecondRateLimiter

# Phase 9.4c audit C1 — bounded caches prevent unbounded memory growth over
# long-running sessions. Capacity keeps the top N hottest queries resident;
# TTL honours Nominatim's "cache aggressively" policy without staleness.
_FWD_CACHE_MAX = 1024
_REV_CACHE_MAX = 1024
_DEFAULT_TTL_S = 7 * 24 * 3600

logger = logging.getLogger(__name__)


# ── Result shapes ───────────────────────────────────────────────────────────


@dataclass(frozen=True)
class GeocodeResult:
    lat: float
    lon: float
    display_name: str
    place_type: Optional[str] = None
    importance: Optional[float] = None


@dataclass(frozen=True)
class ReverseGeocodeResult:
    lat: float
    lon: float
    display_name: str
    country: Optional[str]
    country_code: Optional[str]
    city: Optional[str]
    state: Optional[str]


# ── Adapter ─────────────────────────────────────────────────────────────────


class NominatimGeocoder:
    URL = "https://nominatim.openstreetmap.org"

    def __init__(self, rate_limit: Optional[PerSecondRateLimiter] = None) -> None:
        self._rate_limit = rate_limit if rate_limit is not None else PerSecondRateLimiter(1.0)
        ttl = float(getattr(config, "agent_nominatim_cache_ttl_s", _DEFAULT_TTL_S) or _DEFAULT_TTL_S)
        self._fwd_cache: TTLCache[str, list[GeocodeResult]] = TTLCache(maxsize=_FWD_CACHE_MAX, ttl=ttl)
        self._rev_cache: TTLCache[tuple[int, int], Optional[ReverseGeocodeResult]] = TTLCache(
            maxsize=_REV_CACHE_MAX, ttl=ttl,
        )

    # ── Introspection ────────────────────────────────────────────────────────

    def reset_caches(self) -> None:
        self._fwd_cache.clear()
        self._rev_cache.clear()

    # ── Forward ──────────────────────────────────────────────────────────────

    async def geocode(self, query: str, *, limit: int = 5) -> list[GeocodeResult]:
        """Return up to ``limit`` candidates for ``query`` (text → coords)."""
        if not getattr(config, "agent_nominatim_enabled", True):
            return []
        if not query or not query.strip():
            return []

        key = query.casefold().strip()
        cached = self._fwd_cache.get(key)
        if cached is not None:
            return cached

        await self._rate_limit.wait()
        ua = str(getattr(config, "agent_nominatim_user_agent", "PHANTOM-OS/0.9") or "PHANTOM-OS/0.9")
        try:
            async with httpx.AsyncClient(timeout=10.0, headers={"User-Agent": ua}) as client:
                resp = await client.get(f"{self.URL}/search", params={
                    "q": query,
                    "format": "json",
                    "limit": int(limit),
                    "addressdetails": "0",
                })
            resp.raise_for_status()
            data = resp.json()
        except (httpx.HTTPError, ValueError) as exc:
            logger.info("Nominatim geocode failure for %r: %s", key[:40], exc)
            return []

        results: list[GeocodeResult] = []
        for item in data:
            try:
                results.append(GeocodeResult(
                    lat=float(item["lat"]),
                    lon=float(item["lon"]),
                    display_name=str(item.get("display_name") or ""),
                    place_type=item.get("type"),
                    importance=(
                        float(item["importance"]) if "importance" in item else None
                    ),
                ))
            except (KeyError, TypeError, ValueError):
                continue
        self._fwd_cache[key] = results
        return results

    # ── Reverse ──────────────────────────────────────────────────────────────

    async def reverse(self, lat: float, lon: float) -> Optional[ReverseGeocodeResult]:
        """Return the address at ``(lat, lon)``, or ``None`` on failure.

        Cache key rounds to ~11 m precision (4 decimal places). Good enough
        for "what city am I in"; irrelevant for nearby-memory queries which
        don't touch this function.
        """
        if not getattr(config, "agent_nominatim_enabled", True):
            return None
        key = (int(lat * 1e4), int(lon * 1e4))
        if key in self._rev_cache:
            return self._rev_cache[key]

        await self._rate_limit.wait()
        ua = str(getattr(config, "agent_nominatim_user_agent", "PHANTOM-OS/0.9") or "PHANTOM-OS/0.9")
        try:
            async with httpx.AsyncClient(timeout=10.0, headers={"User-Agent": ua}) as client:
                resp = await client.get(f"{self.URL}/reverse", params={
                    "lat": f"{lat}",
                    "lon": f"{lon}",
                    "format": "json",
                    "addressdetails": "1",
                    "zoom": "14",  # neighbourhood-level
                })
            resp.raise_for_status()
            data = resp.json()
        except (httpx.HTTPError, ValueError) as exc:
            logger.info("Nominatim reverse failure for %.4f,%.4f: %s", lat, lon, exc)
            return None

        if not isinstance(data, dict) or "lat" not in data:
            self._rev_cache[key] = None
            return None
        addr = data.get("address") or {}
        result = ReverseGeocodeResult(
            lat=float(data.get("lat") or lat),
            lon=float(data.get("lon") or lon),
            display_name=str(data.get("display_name") or ""),
            country=addr.get("country"),
            country_code=(addr.get("country_code") or "").upper() or None,
            city=(
                addr.get("city")
                or addr.get("town")
                or addr.get("village")
                or addr.get("hamlet")
            ),
            state=addr.get("state") or addr.get("region"),
        )
        self._rev_cache[key] = result
        return result


# ── Singleton ───────────────────────────────────────────────────────────────

_default: Optional[NominatimGeocoder] = None


def get_default_nominatim() -> NominatimGeocoder:
    global _default
    if _default is None:
        _default = NominatimGeocoder()
    return _default


def set_default_nominatim(geocoder: Optional[NominatimGeocoder]) -> None:
    global _default
    _default = geocoder


__all__ = [
    "NominatimGeocoder",
    "GeocodeResult",
    "ReverseGeocodeResult",
    "get_default_nominatim",
    "set_default_nominatim",
]
