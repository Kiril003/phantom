"""The chat `map.*` tools must actually dispatch.

Both wrappers in `ai/tool_executor.py` were written against an API that does
not exist and could not have run even once:

* ``from agent.base import ActionContext`` — there is no ``agent.base``
  module (it is ``agent.actions.base``). A lazy import inside the function, so
  it raised only when the tool was invoked, which no test did.
* ``MapPlanRoute(destination=, origin=, mode=, user_id=)`` — the action's
  fields are ``waypoints``/``profile``/``alternatives``/``language``. Pydantic
  dropped all four keywords and then failed on the missing required
  ``waypoints``.
* ``ActionContext(session_id=, message_id=, step=)`` — none of those are
  fields; ``task_id``/``step_idx``/``workspace_dir`` are required and absent.
* ``_ok(res.output)`` — ``_ok`` is keyword-only, so the success path raised
  TypeError.
* the schema advertises ``mode="walk"``, but ``RoutingProfile`` spells it
  ``foot``, so the most common handheld request came back ``bad_profile``.

These tests drive the wrappers the way the model does — through
``execute_tool`` — with the two network adapters stubbed.
"""
from __future__ import annotations

import os

import pytest

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-chat-map-tools")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


class _Geo:
    """Nominatim stand-in: every query resolves to a distinct point."""

    def __init__(self, hits: dict[str, tuple[float, float]] | None = None) -> None:
        self.hits = hits if hits is not None else {}
        self.queries: list[str] = []

    async def geocode(self, query: str, *, limit: int = 5):
        from agent.localization.adapters.nominatim import GeocodeResult

        self.queries.append(query)
        pt = self.hits.get(query)
        if pt is None:
            return []
        return [GeocodeResult(lat=pt[0], lon=pt[1], display_name=f"{query} (stub)")]


@pytest.fixture
def geo(monkeypatch):
    stub = _Geo({"Львів": (49.84, 24.03), "Київ": (50.45, 30.52)})
    import ai.tool_executor  # noqa: F401  (ensure module is imported)
    from agent.localization.adapters import nominatim as nom

    monkeypatch.setattr(nom, "get_default_nominatim", lambda: stub)
    return stub


@pytest.fixture
def captured_route(monkeypatch):
    """Capture what MapPlanRoute is actually constructed with."""
    from agent.actions.map import plan_route as pr
    from agent.schemas import ActionResult

    seen: dict = {}
    real_init = pr.MapPlanRoute.__init__

    def _init(self, **kwargs):
        seen.update(kwargs)
        real_init(self, **kwargs)

    async def _execute(self, ctx):
        seen["ctx"] = ctx
        return ActionResult(ok=True, output={"narrative": "Маршрут побудовано", "distance_km": 12.3})

    monkeypatch.setattr(pr.MapPlanRoute, "__init__", _init)
    monkeypatch.setattr(pr.MapPlanRoute, "execute", _execute)
    return seen


@pytest.mark.asyncio
async def test_plan_route_dispatches_and_geocodes(geo, captured_route):
    from ai.tool_executor import execute_tool

    result = await execute_tool(
        "map.plan_route",
        {"destination": "Львів", "origin": "Київ", "mode": "car"},
        user_id="u1",
    )

    assert result.get("ok") is True, result
    # Place names became coordinates, in origin → destination order.
    assert captured_route["waypoints"] == [[50.45, 30.52], [49.84, 24.03]]
    assert captured_route["profile"] == "car"
    # And the context carries the fields the action actually requires.
    ctx = captured_route["ctx"]
    assert ctx.task_id and ctx.step_idx == 0 and ctx.workspace_dir
    assert ctx.user_id == "u1"


@pytest.mark.asyncio
async def test_walk_is_translated_to_the_foot_profile(geo, captured_route):
    """`walk` is what people say; `foot` is what the router accepts."""
    from geo.routing import RoutingProfile
    from ai.tool_executor import execute_tool

    result = await execute_tool(
        "map.plan_route",
        {"destination": "Львів", "origin": "Київ", "mode": "walk"},
        user_id="u1",
    )

    assert result.get("ok") is True, result
    assert captured_route["profile"] == "foot"
    # The translated value must be a profile the engine really has.
    assert captured_route["profile"] in {p.value for p in RoutingProfile}


@pytest.mark.asyncio
async def test_missing_origin_falls_back_to_current_location(
    geo, captured_route, monkeypatch,
):
    """The schema promises "порожньо → поточна локація"."""
    from agent.localization import resolver as res_mod
    from agent.localization.base import LocationEstimate
    from ai.tool_executor import execute_tool

    class _Resolver:
        async def resolve(self):
            return LocationEstimate(
                lat=46.48, lon=30.73, source="stub", confidence=0.9, trust_level=3
            )

    monkeypatch.setattr(res_mod, "get_resolver", lambda: _Resolver())

    result = await execute_tool(
        "map.plan_route", {"destination": "Львів"}, user_id="u1",
    )

    assert result.get("ok") is True, result
    assert captured_route["waypoints"][0] == [46.48, 30.73]
    assert geo.queries == ["Львів"], "origin must not be geocoded when omitted"


@pytest.mark.asyncio
async def test_unknown_destination_is_reported_not_raised(geo, captured_route):
    from ai.tool_executor import execute_tool

    result = await execute_tool(
        "map.plan_route", {"destination": "Атлантида"}, user_id="u1",
    )

    assert result.get("ok") is not True
    assert result.get("error_kind") == "geocode_failed"


@pytest.mark.asyncio
async def test_search_nearby_places_dispatches(monkeypatch):
    """Same broken import and context; lat/lon stay None on purpose so the
    action resolves the device's own position."""
    from agent.actions.map import query_nearby as qn
    from agent.schemas import ActionResult
    from ai.tool_executor import execute_tool

    seen: dict = {}

    async def _execute(self, ctx):
        seen["lat"] = self.lat
        seen["lon"] = self.lon
        seen["radius_m"] = self.radius_m
        seen["ctx"] = ctx
        return ActionResult(ok=True, output={"features": []})

    monkeypatch.setattr(qn.MapQueryNearby, "execute", _execute)

    result = await execute_tool(
        "search_nearby_places", {"query": "кав'ярня", "radius_m": 500}, user_id="u1",
    )

    assert result.get("ok") is True, result
    assert seen["radius_m"] == 500
    assert seen["lat"] is None and seen["lon"] is None
    ctx = seen["ctx"]
    assert ctx.task_id and ctx.step_idx == 0 and ctx.workspace_dir
