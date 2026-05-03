"""Phase 24-C — agent action contract tests for routing verbs."""
from __future__ import annotations

import pytest

from agent.actions.base import ActionContext
from agent.actions.map import (
    MapIsochrone,
    MapOptimizeVisit,
    MapPlanRoute,
    MapSnapTrack,
)
from agent.actions.registry import registry
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


def _ctx() -> ActionContext:
    return ActionContext(task_id="t", step_idx=0, workspace_dir="/tmp")


class _Stub(RouteAdapter):
    name = "stub"

    def __init__(self, **kwargs) -> None:
        self.kwargs = kwargs

    async def available(self) -> bool:
        return True

    async def route(self, req):
        return self.kwargs.get("route") or _route_ok()

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


def _route_ok() -> RouteResult:
    return RouteResult(
        primary=RouteAlternative(
            distance_m=12_345.0,
            duration_s=678.0,
            geometry={"type": "LineString", "coordinates": [[30, 50], [30.1, 50.1]]},
            summary="primary",
        ),
        alternatives=[
            RouteAlternative(
                distance_m=14_000.0,
                duration_s=720.0,
                geometry={"type": "LineString", "coordinates": []},
                summary="alt-1",
            ),
        ],
        profile=RoutingProfile.CAR,
        engine="stub",
    )


# ── Registry wiring ────────────────────────────────────────────────────────


def test_24c_verbs_registered():
    expected = {"map.plan_route", "map.optimize_visit", "map.isochrone", "map.snap_track"}
    actual = {n for n in registry.names() if n in expected}
    assert expected == actual


# ── plan_route ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_plan_route_emits_route_artifact():
    reset_router_for_tests([_Stub(route=_route_ok())])
    res = await MapPlanRoute(
        waypoints=[[50.0, 30.0], [50.1, 30.1]],
        profile="car",
        alternatives=1,
    ).execute(_ctx())
    assert res.ok is True
    artifact_labels = [a["label"] for a in res.output["artifacts"]]
    assert "primary" in artifact_labels
    assert "alt_1" in artifact_labels
    assert res.output["extras"]["engine"] == "stub"


@pytest.mark.asyncio
async def test_plan_route_rejects_bad_profile():
    reset_router_for_tests([_Stub(route=_route_ok())])
    res = await MapPlanRoute(waypoints=[[50, 30], [50.1, 30.1]], profile="rocket").execute(_ctx())
    assert res.ok is False
    assert res.output["reason"] == "bad_profile"


@pytest.mark.asyncio
async def test_plan_route_returns_no_route_when_facade_fails():
    class _Bad(RouteAdapter):
        name = "bad"
        async def available(self): return True
        async def route(self, req): raise RoutingError("upstream")
    reset_router_for_tests([_Bad()])
    res = await MapPlanRoute(waypoints=[[50, 30], [50.1, 30.1]]).execute(_ctx())
    assert res.ok is False
    assert res.output["reason"] == "no_route"


# ── isochrone ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_isochrone_returns_geometry():
    iso = IsochroneResult(
        geometry={"type": "Polygon", "coordinates": [[[30, 50], [30.1, 50], [30.1, 50.1], [30, 50]]]},
        profile=RoutingProfile.FOOT,
        time_minutes=15,
        engine="stub",
    )
    reset_router_for_tests([_Stub(isochrone=iso)])
    res = await MapIsochrone(lat=50.0, lon=30.0, time_minutes=15, profile="foot").execute(_ctx())
    assert res.ok is True
    assert res.output["map_mutation"]["op"] == "route"
    assert res.output["artifacts"][0]["payload"]["geometry"]["type"] == "Polygon"


# ── optimize_visit ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_optimize_visit_orders_stops_via_matrix():
    # Deliberately asymmetric matrix: from 0, nearest is 2 (60 s),
    # then from 2 nearest is 1 (50 s).
    mat = MatrixResult(
        durations_s=[
            [0,  120,  60],
            [120,   0,  50],
            [60,   50,   0],
        ],
        distances_m=[
            [0, 1000, 500],
            [1000, 0, 400],
            [500, 400, 0],
        ],
        profile=RoutingProfile.CAR,
        engine="stub",
    )
    reset_router_for_tests([_Stub(matrix=mat)])
    res = await MapOptimizeVisit(
        stops=[[50, 30], [50.1, 30.1], [50.05, 30.05]],
        profile="car",
    ).execute(_ctx())
    assert res.ok is True
    assert res.output["extras"]["order"] == [0, 2, 1]
    # 60 + 50 = 110
    assert res.output["extras"]["total_duration_s"] == pytest.approx(110.0)


@pytest.mark.asyncio
async def test_optimize_visit_with_return_to_start():
    mat = MatrixResult(
        durations_s=[
            [0, 100],
            [100, 0],
        ],
        distances_m=[[0, 1], [1, 0]],
        profile=RoutingProfile.CAR,
        engine="stub",
    )
    reset_router_for_tests([_Stub(matrix=mat)])
    res = await MapOptimizeVisit(
        stops=[[50, 30], [50.1, 30.1]],
        return_to_start=True,
    ).execute(_ctx())
    assert res.ok is True
    assert res.output["extras"]["order"] == [0, 1, 0]
    # 100 (out) + 100 (return)
    assert res.output["extras"]["total_duration_s"] == pytest.approx(200.0)


# ── snap_track ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_snap_track_returns_geometry_and_confidence():
    snap = SnapMatchResult(
        geometry={"type": "LineString", "coordinates": [[30, 50], [30.1, 50.1]]},
        confidence=0.93,
        engine="stub",
    )
    reset_router_for_tests([_Stub(snap=snap)])
    res = await MapSnapTrack(
        points=[[50, 30], [50.05, 30.05], [50.1, 30.1]],
    ).execute(_ctx())
    assert res.ok is True
    assert res.output["extras"]["confidence"] == pytest.approx(0.93)


@pytest.mark.asyncio
async def test_snap_track_rejects_timestamp_mismatch():
    reset_router_for_tests([_Stub()])
    res = await MapSnapTrack(
        points=[[50, 30], [50.1, 30.1]],
        timestamps_ms=[1000, 2000, 3000],  # length mismatch
    ).execute(_ctx())
    assert res.ok is False
    assert res.output["reason"] == "timestamp_mismatch"
