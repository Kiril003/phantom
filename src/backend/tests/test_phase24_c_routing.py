"""Phase 24-C — RouterFacade + adapter chain tests."""
from __future__ import annotations

from typing import Any

import pytest

from geo.routing import (
    IsochroneRequest,
    IsochroneResult,
    MatrixRequest,
    MatrixResult,
    RouteAlternative,
    RouteRequest,
    RouteResult,
    RoutingProfile,
    SnapMatchRequest,
    SnapMatchResult,
    reset_router_for_tests,
)
from geo.routing.adapters import RouteAdapter, RoutingError
from geo.routing.profiles import to_brouter, to_ors, to_osrm
from geo.routing.router_facade import RouterFacade


# ── Fakes ─────────────────────────────────────────────────────────────────


class _FakeAdapter(RouteAdapter):
    name = "fake"

    def __init__(
        self,
        *,
        name: str = "fake",
        available_flag: bool = True,
        route_result: RouteResult | None = None,
        isochrone_result: IsochroneResult | None = None,
        matrix_result: MatrixResult | None = None,
        snap_result: SnapMatchResult | None = None,
        raise_with: Exception | None = None,
    ) -> None:
        self.name = name  # type: ignore[assignment]
        self._avail = available_flag
        self._route = route_result
        self._iso = isochrone_result
        self._mat = matrix_result
        self._snap = snap_result
        self._raise = raise_with
        self.calls: list[str] = []

    async def available(self) -> bool:
        return self._avail

    async def route(self, req):
        self.calls.append("route")
        if self._raise is not None:
            raise self._raise
        if self._route is None:
            raise RoutingError(f"{self.name}: no route configured")
        return self._route

    async def isochrone(self, req):
        self.calls.append("isochrone")
        if self._raise is not None:
            raise self._raise
        if self._iso is None:
            raise RoutingError(f"{self.name}: no isochrone configured")
        return self._iso

    async def matrix(self, req):
        self.calls.append("matrix")
        if self._raise is not None:
            raise self._raise
        if self._mat is None:
            raise RoutingError(f"{self.name}: no matrix configured")
        return self._mat

    async def snap_match(self, req):
        self.calls.append("snap")
        if self._raise is not None:
            raise self._raise
        if self._snap is None:
            raise RoutingError(f"{self.name}: no snap configured")
        return self._snap


def _route_result(engine: str = "fake", km: float = 5.0, minutes: float = 10.0) -> RouteResult:
    return RouteResult(
        primary=RouteAlternative(
            distance_m=km * 1000.0,
            duration_s=minutes * 60.0,
            geometry={"type": "LineString", "coordinates": [[30, 50], [30.1, 50.1]]},
        ),
        alternatives=[],
        profile=RoutingProfile.CAR,
        engine=engine,
    )


def _route_req() -> RouteRequest:
    return RouteRequest(
        waypoints=[{"lat": 50.0, "lon": 30.0}, {"lat": 50.1, "lon": 30.1}],
        profile=RoutingProfile.CAR,
    )


# ── Profile mapping ───────────────────────────────────────────────────────


def test_profile_mapping_covers_all_enum_members():
    for p in RoutingProfile:
        assert isinstance(to_brouter(p), str) and to_brouter(p)
        assert isinstance(to_ors(p), str) and to_ors(p)
        assert isinstance(to_osrm(p), str) and to_osrm(p)


# ── Facade strategy ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_facade_uses_first_available_adapter():
    primary = _FakeAdapter(name="primary", route_result=_route_result("primary"))
    fallback = _FakeAdapter(name="fallback", route_result=_route_result("fallback"))
    facade = RouterFacade([primary, fallback])
    result = await facade.route(_route_req())
    assert result.engine == "primary"
    assert primary.calls == ["route"]
    assert fallback.calls == []


@pytest.mark.asyncio
async def test_facade_skips_unavailable_adapters():
    offline = _FakeAdapter(name="offline", available_flag=False)
    online = _FakeAdapter(name="online", route_result=_route_result("online"))
    facade = RouterFacade([offline, online])
    result = await facade.route(_route_req())
    assert result.engine == "online"
    assert offline.calls == []  # never called .route() because availability was False
    assert online.calls == ["route"]


@pytest.mark.asyncio
async def test_facade_falls_through_on_routing_error():
    flaky = _FakeAdapter(name="flaky", raise_with=RoutingError("upstream 502"))
    good = _FakeAdapter(name="good", route_result=_route_result("good"))
    facade = RouterFacade([flaky, good])
    result = await facade.route(_route_req())
    assert result.engine == "good"


@pytest.mark.asyncio
async def test_facade_raises_when_every_adapter_fails():
    a = _FakeAdapter(name="a", raise_with=RoutingError("a down"))
    b = _FakeAdapter(name="b", raise_with=RoutingError("b down"))
    facade = RouterFacade([a, b])
    with pytest.raises(RoutingError):
        await facade.route(_route_req())


@pytest.mark.asyncio
async def test_facade_raises_when_no_adapter_available():
    a = _FakeAdapter(name="a", available_flag=False)
    facade = RouterFacade([a])
    with pytest.raises(RoutingError):
        await facade.route(_route_req())


@pytest.mark.asyncio
async def test_facade_wraps_unexpected_exceptions_as_routing_errors():
    flaky = _FakeAdapter(name="flaky", raise_with=ValueError("bad json"))
    good = _FakeAdapter(name="good", route_result=_route_result("good"))
    facade = RouterFacade([flaky, good])
    out = await facade.route(_route_req())
    assert out.engine == "good"


@pytest.mark.asyncio
async def test_facade_isochrone_fallthrough():
    no_iso = _FakeAdapter(name="no_iso")  # raises NotImplemented-equivalent RoutingError
    yes_iso = _FakeAdapter(
        name="yes_iso",
        isochrone_result=IsochroneResult(
            geometry={"type": "Polygon", "coordinates": []},
            profile=RoutingProfile.FOOT,
            time_minutes=15,
            engine="yes_iso",
        ),
    )
    facade = RouterFacade([no_iso, yes_iso])
    out = await facade.isochrone(IsochroneRequest(center={"lat": 50, "lon": 30}, time_minutes=15))
    assert out.engine == "yes_iso"


@pytest.mark.asyncio
async def test_facade_matrix_returns_engine():
    yes = _FakeAdapter(
        name="yes_mat",
        matrix_result=MatrixResult(
            durations_s=[[0, 60], [60, 0]],
            distances_m=[[0, 1000], [1000, 0]],
            profile=RoutingProfile.CAR,
            engine="yes_mat",
        ),
    )
    facade = RouterFacade([yes])
    mat = await facade.matrix(MatrixRequest(points=[{"lat": 50, "lon": 30}, {"lat": 50.1, "lon": 30.1}]))
    assert mat.engine == "yes_mat"


@pytest.mark.asyncio
async def test_facade_snap_fallthrough():
    no_snap = _FakeAdapter(name="no_snap")
    yes_snap = _FakeAdapter(
        name="yes_snap",
        snap_result=SnapMatchResult(
            geometry={"type": "LineString", "coordinates": []},
            confidence=0.85,
            engine="yes_snap",
        ),
    )
    facade = RouterFacade([no_snap, yes_snap])
    out = await facade.snap_match(
        SnapMatchRequest(points=[{"lat": 50, "lon": 30}, {"lat": 50.1, "lon": 30.1}]),
    )
    assert out.engine == "yes_snap"
    assert out.confidence == pytest.approx(0.85)


# ── Default chain composition ─────────────────────────────────────────────


def test_default_chain_includes_brouter_and_osrm_with_no_ors_key():
    # Reset + default factory honours config; ORS gated on api_key.
    facade = reset_router_for_tests(None)
    # The builder is invoked through the singleton path; ensure
    # `get_router()` returns a populated chain.
    from geo.routing import get_router
    from geo.routing.router_facade import _build_default_chain  # type: ignore[attr-defined]

    chain = _build_default_chain()
    names = [a.name for a in chain]
    assert "brouter" in names
    assert "osrm" in names
    # ORS is NOT in the default chain because no API key is configured
    # in the test environment (config defaults `routing_ors_api_key=""`).
    assert "openrouteservice" not in names
