"""BRouter offline adapter (Phase 24-C).

The Radxa runs BRouter in a sidecar Docker container with the UA RD5
bundle. The HTTP API is GET-based with a single ``lonlats`` query and
an output format flag. We always request GeoJSON so the response is
ready to render straight onto MapLibre.

Reference: https://github.com/abrensch/brouter
"""
from __future__ import annotations

import logging
from typing import Any, ClassVar

import httpx

from ..models import RouteAlternative, RouteRequest, RouteResult
from ..profiles import to_brouter
from .base import RouteAdapter, RoutingError

logger = logging.getLogger(__name__)


class BRouterAdapter(RouteAdapter):
    """Offline routing via a local BRouter HTTP server."""

    name: ClassVar[str] = "brouter"
    requires_internet: ClassVar[bool] = False

    def __init__(self, base_url: str, timeout_s: float = 5.0) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout_s = timeout_s

    async def available(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=2.0) as client:
                resp = await client.get(self._base_url + "/")
            return resp.status_code in (200, 404)  # 404 from root is fine; server is up
        except Exception as exc:
            logger.debug("BRouter health probe failed: %s", exc)
            return False

    async def route(self, req: RouteRequest) -> RouteResult:
        lonlats = "|".join(f"{p.lon},{p.lat}" for p in req.waypoints)
        params: dict[str, Any] = {
            "lonlats": lonlats,
            "profile": to_brouter(req.profile),
            "alternativeidx": 0,
            "format": "geojson",
        }
        try:
            async with httpx.AsyncClient(timeout=self._timeout_s) as client:
                resp = await client.get(self._base_url + "/brouter", params=params)
        except Exception as exc:
            raise RoutingError(f"brouter request failed: {exc}") from exc
        if resp.status_code != 200:
            raise RoutingError(
                f"brouter returned {resp.status_code}: {resp.text[:120]}"
            )
        try:
            payload = resp.json()
        except ValueError as exc:
            raise RoutingError(f"brouter non-JSON response: {exc}") from exc
        feature = (payload.get("features") or [{}])[0]
        props = feature.get("properties", {}) or {}
        try:
            distance_m = float(props.get("track-length", 0.0))
            duration_s = float(props.get("total-time", 0.0))
        except (TypeError, ValueError) as exc:
            raise RoutingError(f"brouter response missing metrics: {exc}") from exc
        primary = RouteAlternative(
            distance_m=distance_m,
            duration_s=duration_s,
            geometry=feature.get("geometry", {"type": "LineString", "coordinates": []}),
            summary=props.get("description", "") or "",
            extras={k: props.get(k) for k in ("filtered-ascend", "plain-ascend") if props.get(k) is not None},
        )
        return RouteResult(
            primary=primary,
            alternatives=[],
            profile=req.profile,
            engine=self.name,
        )
