"""OSRM public/self-host adapter (Phase 24-C).

OSRM is the no-key fallback. The public demo server at
``router.project-osrm.org`` rate-limits aggressively but works for
spot lookups; operators may point ``routing_osrm_url`` at a self-host
for production. Reference: https://project-osrm.org/docs/v5.24.0/api/
"""
from __future__ import annotations

import logging
from typing import Any, ClassVar

import httpx

from ..models import (
    RouteAlternative,
    RouteRequest,
    RouteResult,
    SnapMatchRequest,
    SnapMatchResult,
)
from ..profiles import to_osrm
from .base import RouteAdapter, RoutingError

logger = logging.getLogger(__name__)


class OSRMAdapter(RouteAdapter):
    """Online routing via OSRM."""

    name: ClassVar[str] = "osrm"
    requires_internet: ClassVar[bool] = True

    def __init__(self, base_url: str, timeout_s: float = 6.0) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout_s = timeout_s

    async def available(self) -> bool:
        return bool(self._base_url)

    async def route(self, req: RouteRequest) -> RouteResult:
        coords = ";".join(f"{p.lon},{p.lat}" for p in req.waypoints)
        url = f"{self._base_url}/route/v1/{to_osrm(req.profile)}/{coords}"
        params: dict[str, Any] = {
            "overview": "full",
            "geometries": "geojson",
            "alternatives": "true" if req.alternatives > 0 else "false",
        }
        try:
            async with httpx.AsyncClient(timeout=self._timeout_s) as client:
                resp = await client.get(url, params=params)
        except Exception as exc:
            raise RoutingError(f"OSRM request failed: {exc}") from exc
        if resp.status_code != 200:
            raise RoutingError(f"OSRM {resp.status_code}: {resp.text[:160]}")
        payload = resp.json()
        if payload.get("code") != "Ok":
            raise RoutingError(f"OSRM rejected: {payload.get('code')} {payload.get('message','')}")
        routes = payload.get("routes") or []
        if not routes:
            raise RoutingError("OSRM returned no routes")
        primary = self._route_to_alt(routes[0])
        alternatives = [self._route_to_alt(r) for r in routes[1 : 1 + req.alternatives]]
        return RouteResult(
            primary=primary,
            alternatives=alternatives,
            profile=req.profile,
            engine=self.name,
        )

    @staticmethod
    def _route_to_alt(route: dict[str, Any]) -> RouteAlternative:
        return RouteAlternative(
            distance_m=float(route.get("distance", 0.0) or 0.0),
            duration_s=float(route.get("duration", 0.0) or 0.0),
            geometry=route.get("geometry", {"type": "LineString", "coordinates": []}),
            summary=route.get("legs", [{}])[0].get("summary", "") or "",
        )

    async def snap_match(self, req: SnapMatchRequest) -> SnapMatchResult:
        coords = ";".join(f"{p.lon},{p.lat}" for p in req.points)
        url = f"{self._base_url}/match/v1/{to_osrm(req.profile)}/{coords}"
        params: dict[str, Any] = {
            "overview": "full",
            "geometries": "geojson",
        }
        if req.timestamps_ms:
            params["timestamps"] = ";".join(str(int(t / 1000)) for t in req.timestamps_ms)
        try:
            async with httpx.AsyncClient(timeout=self._timeout_s) as client:
                resp = await client.get(url, params=params)
        except Exception as exc:
            raise RoutingError(f"OSRM match failed: {exc}") from exc
        if resp.status_code != 200:
            raise RoutingError(f"OSRM match {resp.status_code}: {resp.text[:160]}")
        payload = resp.json()
        if payload.get("code") != "Ok":
            raise RoutingError(f"OSRM match rejected: {payload.get('code')}")
        matchings = payload.get("matchings") or []
        if not matchings:
            raise RoutingError("OSRM match returned nothing")
        m = matchings[0]
        return SnapMatchResult(
            geometry=m.get("geometry", {"type": "LineString", "coordinates": []}),
            confidence=float(m.get("confidence", 0.0) or 0.0),
            engine=self.name,
        )
