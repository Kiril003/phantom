"""`docs/design/tools-audit.md` §1a / §8c / §8d: `map.get_elevation_profile`
was fully implemented and never imported into `MAP_ACTIONS` — one of the
five orphaned map actions. Unlike `create_geofence`/`list_geofences`
(left unwired: they import `from db.database import SessionLocal`, a
name that does not exist there either — see the audit's note on this
being the same shipped-then-discovered-broken pattern as
`map.add_marker`), and `add_layer` (left unwired: its `op: "add_layer"`
mutation has no frontend renderer, so wiring it would let the agent
claim "додав шар" with nothing appearing — a fresh instance of exactly
the silent-success defect this pass exists to remove), this one is
clean: read-only, no `map_mutation`, same shape as the already-reachable
`MapQueryNearby`, and its own error path is the codebase's established
honest-refusal pattern (`ElevationUnavailable` instead of fabricated
numbers — see `geo/elevation.py`'s comment about the sin/cos placeholder
that used to ship here).
"""
from __future__ import annotations

import pytest

from agent.actions.base import ActionContext
from agent.actions.map import MAP_ACTIONS, MapGetElevationProfile
from agent.actions.registry import registry


def _ctx() -> ActionContext:
    return ActionContext(task_id="t-elevation", step_idx=0, workspace_dir="/tmp")


def test_get_elevation_profile_now_resolves_through_the_registry():
    assert MapGetElevationProfile in MAP_ACTIONS
    assert registry.get("map.get_elevation_profile") is not None
    assert "map.get_elevation_profile" in registry.names()


@pytest.mark.asyncio
async def test_get_elevation_profile_honestly_refuses_without_a_dem_source():
    """No DEM source is registered anywhere in this codebase (grepped:
    no `ElevationService(source=...)` call exists) — this must behave
    exactly like the pre-existing `/map/elevation/profile` HTTP route
    already does: refuse with a named reason, never invent a number."""
    res = await MapGetElevationProfile(
        points=[[50.45, 30.52], [50.46, 30.53]],
    ).execute(_ctx())

    assert res.ok is False
    assert res.error_class == "ElevationUnavailable"
