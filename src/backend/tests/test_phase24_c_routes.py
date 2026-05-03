"""Phase 24-C — HTTP endpoint contract tests for routing."""
from __future__ import annotations

import pytest

from geo.routing import (
    IsochroneResult,
    MatrixResult,
    RouteAlternative,
    RouteResult,
    RoutingProfile,
    SnapMatchResult,
    reset_router_for_tests,
)
from geo.routing.adapters import RouteAdapter, RoutingError


class _Stub(RouteAdapter):
    name = "stub"

    def __init__(self, **kwargs) -> None:
        self.kwargs = kwargs

    async def available(self) -> bool:
        return True

    async def route(self, req):
        if "route" in self.kwargs:
            return self.kwargs["route"]
        raise RoutingError("no route configured")

    async def isochrone(self, req):
        if "isochrone" in self.kwargs:
            return self.kwargs["isochrone"]
        raise RoutingError("no iso")

    async def matrix(self, req):
        if "matrix" in self.kwargs:
            return self.kwargs["matrix"]
        raise RoutingError("no matrix")

    async def snap_match(self, req):
        if "snap" in self.kwargs:
            return self.kwargs["snap"]
        raise RoutingError("no snap")


def _route() -> RouteResult:
    return RouteResult(
        primary=RouteAlternative(
            distance_m=10_000.0,
            duration_s=600.0,
            geometry={"type": "LineString", "coordinates": [[30, 50], [30.1, 50.1]]},
        ),
        alternatives=[],
        profile=RoutingProfile.CAR,
        engine="stub",
    )


def test_post_route_returns_full_result(auth_root_client):
    reset_router_for_tests([_Stub(route=_route())])
    resp = auth_root_client.post(
        "/api/v1/map/route",
        json={"waypoints": [[50.0, 30.0], [50.1, 30.1]], "profile": "car"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["engine"] == "stub"
    assert body["profile"] == "car"
    assert body["primary"]["distance_m"] == 10_000.0


def test_post_route_rejects_bad_profile(auth_root_client):
    reset_router_for_tests([_Stub(route=_route())])
    resp = auth_root_client.post(
        "/api/v1/map/route",
        json={"waypoints": [[50.0, 30.0], [50.1, 30.1]], "profile": "rocket"},
    )
    assert resp.status_code == 400


def test_post_route_returns_502_when_facade_empty(auth_root_client):
    class _Bad(RouteAdapter):
        name = "bad"
        async def available(self): return True
        async def route(self, req): raise RoutingError("upstream")
    reset_router_for_tests([_Bad()])
    resp = auth_root_client.post(
        "/api/v1/map/route",
        json={"waypoints": [[50.0, 30.0], [50.1, 30.1]]},
    )
    assert resp.status_code == 502


def test_post_isochrone_returns_geometry(auth_root_client):
    iso = IsochroneResult(
        geometry={"type": "Polygon", "coordinates": [[[30, 50], [30.1, 50], [30.1, 50.1], [30, 50]]]},
        profile=RoutingProfile.FOOT,
        time_minutes=15,
        engine="stub",
    )
    reset_router_for_tests([_Stub(isochrone=iso)])
    resp = auth_root_client.post(
        "/api/v1/map/isochrone",
        json={"lat": 50.0, "lon": 30.0, "time_minutes": 15, "profile": "foot"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["geometry"]["type"] == "Polygon"
    assert body["engine"] == "stub"


def test_post_optimize_visit_returns_order(auth_root_client):
    mat = MatrixResult(
        durations_s=[[0, 60], [60, 0]],
        distances_m=[[0, 100], [100, 0]],
        profile=RoutingProfile.CAR,
        engine="stub",
    )
    reset_router_for_tests([_Stub(matrix=mat)])
    resp = auth_root_client.post(
        "/api/v1/map/route/optimize",
        json={"stops": [[50.0, 30.0], [50.1, 30.1]], "profile": "car"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["order"] == [0, 1]
    assert body["engine"] == "stub"


def test_post_snap_track_returns_geometry(auth_root_client):
    snap = SnapMatchResult(
        geometry={"type": "LineString", "coordinates": [[30, 50], [30.1, 50.1]]},
        confidence=0.9,
        engine="stub",
    )
    reset_router_for_tests([_Stub(snap=snap)])
    resp = auth_root_client.post(
        "/api/v1/map/snap",
        json={"points": [[50.0, 30.0], [50.05, 30.05]], "profile": "car"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["confidence"] == 0.9


def test_post_snap_track_rejects_timestamp_mismatch(auth_root_client):
    reset_router_for_tests([_Stub()])
    resp = auth_root_client.post(
        "/api/v1/map/snap",
        json={
            "points": [[50.0, 30.0], [50.05, 30.05]],
            "timestamps_ms": [1000, 2000, 3000],
        },
    )
    assert resp.status_code == 400


def test_routing_endpoints_require_auth(unauth_client):
    resp = unauth_client.post(
        "/api/v1/map/route",
        json={"waypoints": [[50.0, 30.0], [50.1, 30.1]]},
    )
    assert resp.status_code in (401, 403)
