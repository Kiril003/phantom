"""`docs/design/tools-audit.md` §1a / §8d: five implemented map actions
were never imported into `agent/actions/map/__init__.py::MAP_ACTIONS`,
so the agent could never call them despite the code existing and
working. `map.time_travel` is the cheapest of the five to close: the
action itself was already correct, and the frontend bridge
(`useMapAgentBridge.ts`) has handled `op: "time_travel"` since Phase
24-D — `store.setTemporalDate(iso)` — with nothing on that side to
change. The only gap was the missing import in `MAP_ACTIONS`.

This is "unfinished wiring", not "abandoned idea": closing it required
zero behavioural changes to the action.
"""
from __future__ import annotations

import pytest

from agent.actions.base import ActionContext
from agent.actions.map import MAP_ACTIONS, MapTimeTravel
from agent.actions.registry import registry


def _ctx() -> ActionContext:
    return ActionContext(task_id="t-time-travel", step_idx=0, workspace_dir="/tmp")


def test_time_travel_now_resolves_through_the_registry():
    """Before this fix: `registry.get("map.time_travel")` returned None
    and the model could never select the verb — `MapTimeTravel` existed
    on disk but was not one of the 76 catalog actions."""
    assert MapTimeTravel in MAP_ACTIONS
    assert registry.get("map.time_travel") is not None
    assert "map.time_travel" in registry.names()


@pytest.mark.asyncio
async def test_time_travel_emits_the_op_the_frontend_bridge_already_handles():
    """`useMapAgentBridge.ts` has read `op === 'time_travel'` →
    `store.setTemporalDate(payload.iso_date)` since Phase 24-D — this
    confirms the action's wire shape actually matches what that code
    reads, not just that the action runs without error."""
    res = await MapTimeTravel(iso_date="2024-05-15", layer_id="frontline").execute(_ctx())

    assert res.ok is True
    mutation = res.output["map_mutation"]
    assert mutation["op"] == "time_travel"
    assert mutation["payload"]["iso_date"] == "2024-05-15"
    assert mutation["payload"]["layer_id"] == "frontline"


@pytest.mark.asyncio
async def test_time_travel_rejects_an_unparseable_date():
    res = await MapTimeTravel(iso_date="not-a-date").execute(_ctx())
    assert res.ok is False
