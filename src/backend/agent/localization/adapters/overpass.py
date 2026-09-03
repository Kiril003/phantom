"""
Phase 9.4b — Overpass API adapter.

Queries OpenStreetMap Overpass for amenities/shops/natural features around
a point. Free; Overpass recommends <2 req/s sustained, cache aggressively.
We enforce 1 req/s via :class:`PerSecondRateLimiter` and cache each query
for 24 h keyed on (lat, lon, radius, feature_types).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Optional

import httpx
from cachetools import TTLCache

from agent.localization.base import haversine_km
from config import config

from .. import service_health
from .rate_limiter import PerSecondRateLimiter

# Phase 9.4c audit C2 — bounded cache. 512 slots covers the realistic
# "tiles visited in a day" count many times over; TTL tracks the 24 h
# recommendation from Overpass usage policy.
_CACHE_MAX = 512
_DEFAULT_TTL_S = 24 * 3600

logger = logging.getLogger(__name__)


DEFAULT_FEATURE_TYPES: tuple[str, ...] = (
    "amenity=cafe",
    "amenity=restaurant",
    "amenity=bar",
    "amenity=pharmacy",
    "amenity=hospital",
    "amenity=library",
    "amenity=bank",
    "shop=supermarket",
    "shop=convenience",
    "leisure=park",
    "tourism=attraction",
)


@dataclass(frozen=True)
class OSMFeature:
    osm_id: int
    lat: float
    lon: float
    name: Optional[str]
    type: Optional[str]
    tags: dict = field(default_factory=dict)
    distance_m: int = 0


class OverpassQuery:
    #: Адреса джерела читається з конфігу, а не зашита тут. Літерал означав,
    #: що власник із власним стеком поруч однаково ходить у чуже демо —
    #: змінити це не міг ніхто. `property`, а не поле класу: конфіг
    #: перечитується гаряче, і кешоване на імпорті значення пережило б зміну.
    @property
    def URL(self) -> str:  # noqa: N802 — імʼя лишається тим самим для викликів
        return config.geo_overpass_url

    def __init__(self, rate_limit: Optional[PerSecondRateLimiter] = None) -> None:
        self._rate_limit = rate_limit if rate_limit is not None else PerSecondRateLimiter(1.0)
        ttl = float(getattr(config, "agent_overpass_cache_ttl_s", _DEFAULT_TTL_S) or _DEFAULT_TTL_S)
        self._cache: TTLCache[tuple, list[OSMFeature]] = TTLCache(maxsize=_CACHE_MAX, ttl=ttl)

    def reset_cache(self) -> None:
        self._cache.clear()

    async def features_near(
        self,
        lat: float,
        lon: float,
        *,
        radius_m: int = 500,
        feature_types: Optional[tuple[str, ...]] = None,
    ) -> list[OSMFeature]:
        """Return OSM nodes matching any of ``feature_types`` within radius.

        Results are sorted by distance ascending. Cache hits are free;
        misses burn one Overpass call (rate-limited to 1/s).
        """
        if not getattr(config, "agent_overpass_enabled", True):
            return []
        if radius_m < 10:
            return []
        types = tuple(feature_types) if feature_types else DEFAULT_FEATURE_TYPES
        key = (round(lat, 4), round(lon, 4), int(radius_m), types)
        cached = self._cache.get(key)
        if cached is not None:
            return cached

        filters = "\n".join(
            f'  node[{ft.replace("=", "=\"", 1)}\"](around:{radius_m},{lat},{lon});'
            for ft in types
        )
        query = f"[out:json][timeout:10];\n(\n{filters}\n);\nout tags center;"

        await self._rate_limit.wait()
        # Phase 9.4c.1 hotfix — Overpass's public mirror rejects the
        # default ``python-httpx/*`` User-Agent with HTTP 406. Send a
        # custom UA like the Nominatim adapter already does.
        ua = str(
            getattr(config, "agent_overpass_user_agent", "PHANTOM-OS/0.9")
            or "PHANTOM-OS/0.9"
        )
        try:
            async with httpx.AsyncClient(timeout=15.0, headers={"User-Agent": ua}) as client:
                resp = await client.post(self.URL, data={"data": query})
            resp.raise_for_status()
            data = resp.json()
        except (httpx.HTTPError, ValueError) as exc:
            logger.info("Overpass query failed: %s", exc)
            service_health.mark_failure("overpass", str(exc))
            return []

        features: list[OSMFeature] = []
        for el in data.get("elements", []):
            f_lat = el.get("lat") or el.get("center", {}).get("lat")
            f_lon = el.get("lon") or el.get("center", {}).get("lon")
            if f_lat is None or f_lon is None:
                continue
            tags = el.get("tags") or {}
            ftype = _match_feature_type(tags, types)
            name = tags.get("name") or tags.get("name:uk") or tags.get("name:en")
            d_m = int(round(haversine_km(lat, lon, float(f_lat), float(f_lon)) * 1000.0))
            features.append(OSMFeature(
                osm_id=int(el.get("id") or 0),
                lat=float(f_lat),
                lon=float(f_lon),
                name=name,
                type=ftype,
                tags=tags,
                distance_m=d_m,
            ))

        features.sort(key=lambda f: f.distance_m)
        self._cache[key] = features
        service_health.mark_success("overpass")
        return features


def _match_feature_type(tags: dict, types: tuple[str, ...]) -> Optional[str]:
    for t in types:
        if "=" not in t:
            continue
        k, v = t.split("=", 1)
        if tags.get(k) == v:
            return t
    return None


# ── Singleton ───────────────────────────────────────────────────────────────

_default: Optional[OverpassQuery] = None


def get_default_overpass() -> OverpassQuery:
    global _default
    if _default is None:
        _default = OverpassQuery()
    return _default


def set_default_overpass(q: Optional[OverpassQuery]) -> None:
    global _default
    _default = q


__all__ = [
    "OverpassQuery",
    "OSMFeature",
    "DEFAULT_FEATURE_TYPES",
    "get_default_overpass",
    "set_default_overpass",
]
