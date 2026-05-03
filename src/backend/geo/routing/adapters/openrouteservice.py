"""OpenRouteService adapter (Phase 24-C).

ORS supports route + isochrone + matrix in a single hosted API. The
adapter stays online-only (the facade gates internet usage) and
respects the operator-supplied API key from the existing settings
panel. Reference: https://openrouteservice.org/dev/#/api-docs
"""
from __future__ import annotations

import logging
from typing import Any, ClassVar

import httpx

from ..models import (
    IsochroneRequest,
    IsochroneResult,
    MatrixRequest,
    MatrixResult,
    RouteAlternative,
    RouteRequest,
    RouteResult,
)
from ..profiles import to_ors
from .base import RouteAdapter, RoutingError

logger = logging.getLogger(__name__)

_ORS_BASE = "https://api.openrouteservice.org/v2"


class ORSAdapter(RouteAdapter):
    """Online routing via OpenRouteService."""

    name: ClassVar[str] = "openrouteservice"
    requires_internet: ClassVar[bool] = True

    def __init__(self, api_key: str, timeout_s: float = 6.0) -> None:
        self._api_key = api_key
        self._timeout_s = timeout_s

    @property
    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": self._api_key,
            "Content-Type": "application/json",
            "Accept": "application/geo+json, application/json",
        }

    async def available(self) -> bool:
        return bool(self._api_key)

    async def route(self, req: RouteRequest) -> RouteResult:
        url = f"{_ORS_BASE}/directions/{to_ors(req.profile)}/geojson"
        body: dict[str, Any] = {
            "coordinates": [[p.lon, p.lat] for p in req.waypoints],
            "language": req.language,
        }
        if req.alternatives > 0:
            body["alternative_routes"] = {
                "share_factor": 0.6,
                "target_count": req.alternatives,
            }
        try:
            async with httpx.AsyncClient(timeout=self._timeout_s) as client:
                resp = await client.post(url, json=body, headers=self._headers)
        except Exception as exc:
            raise RoutingError(f"ORS request failed: {exc}") from exc
        if resp.status_code != 200:
            raise RoutingError(f"ORS returned {resp.status_code}: {resp.text[:160]}")
        try:
            payload = resp.json()
        except ValueError as exc:
            raise RoutingError(f"ORS non-JSON: {exc}") from exc
        features = payload.get("features") or []
        if not features:
            raise RoutingError("ORS returned no features")
        primary = self._feature_to_alt(features[0])
        alternatives = [self._feature_to_alt(f) for f in features[1:]]
        return RouteResult(
            primary=primary,
            alternatives=alternatives,
            profile=req.profile,
            engine=self.name,
        )

    @staticmethod
    def _feature_to_alt(feature: dict[str, Any]) -> RouteAlternative:
        props = feature.get("properties", {}) or {}
        summary = props.get("summary", {}) or {}
        return RouteAlternative(
            distance_m=float(summary.get("distance", 0.0) or 0.0),
            duration_s=float(summary.get("duration", 0.0) or 0.0),
            geometry=feature.get("geometry", {"type": "LineString", "coordinates": []}),
            summary=props.get("description", "") or "",
        )

    async def isochrone(self, req: IsochroneRequest) -> IsochroneResult:
        url = f"{_ORS_BASE}/isochrones/{to_ors(req.profile)}"
        body = {
            "locations": [[req.center.lon, req.center.lat]],
            "range": [req.time_minutes * 60],
            "range_type": "time",
        }
        try:
            async with httpx.AsyncClient(timeout=self._timeout_s) as client:
                resp = await client.post(url, json=body, headers=self._headers)
        except Exception as exc:
            raise RoutingError(f"ORS isochrone failed: {exc}") from exc
        if resp.status_code != 200:
            raise RoutingError(f"ORS isochrone {resp.status_code}: {resp.text[:160]}")
        payload = resp.json()
        features = payload.get("features") or []
        if not features:
            raise RoutingError("ORS isochrone returned no features")
        return IsochroneResult(
            geometry=features[0].get("geometry", {}),
            profile=req.profile,
            time_minutes=req.time_minutes,
            engine=self.name,
        )

    async def matrix(self, req: MatrixRequest) -> MatrixResult:
        url = f"{_ORS_BASE}/matrix/{to_ors(req.profile)}"
        body = {
            "locations": [[p.lon, p.lat] for p in req.points],
            "metrics": ["duration", "distance"],
            "units": "m",
        }
        try:
            async with httpx.AsyncClient(timeout=self._timeout_s) as client:
                resp = await client.post(url, json=body, headers=self._headers)
        except Exception as exc:
            raise RoutingError(f"ORS matrix failed: {exc}") from exc
        if resp.status_code != 200:
            raise RoutingError(f"ORS matrix {resp.status_code}: {resp.text[:160]}")
        payload = resp.json()
        return MatrixResult(
            durations_s=[[float(v or 0.0) for v in row] for row in payload.get("durations", [])],
            distances_m=[[float(v or 0.0) for v in row] for row in payload.get("distances", [])],
            profile=req.profile,
            engine=self.name,
        )
