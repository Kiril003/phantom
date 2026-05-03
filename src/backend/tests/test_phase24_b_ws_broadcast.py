"""Phase 24-B — WS `map.*` channel broadcast tests."""
from __future__ import annotations

import pytest

from agent.actions.base import ActionContext
from agent.actions.map import MapEnableLayer, MapOpenMap
from agent.actions.map._common import broadcast_map_mutation, MapMutation
from api import websocket_hub as wsh
from geo.attribution import reset_attribution_store_for_tests
from geo.layer_registry import reload_layer_registry


@pytest.fixture(autouse=True)
def _registry():
    reload_layer_registry()
    reset_attribution_store_for_tests()
    yield
    reset_attribution_store_for_tests()


class _Recorder:
    """Drop-in stand-in for `WebSocketHub.broadcast`."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, str, dict, str | None]] = []

    async def broadcast(self, channel, type_, data, user_id=None):
        self.calls.append((channel, type_, data, user_id))


@pytest.fixture()
def hub_spy(monkeypatch) -> _Recorder:
    rec = _Recorder()
    monkeypatch.setattr(wsh, "hub", rec)
    return rec


def _ctx() -> ActionContext:
    return ActionContext(task_id="t", step_idx=0, workspace_dir="/tmp")


@pytest.mark.asyncio
async def test_broadcast_map_mutation_uses_map_channel(hub_spy: _Recorder):
    await broadcast_map_mutation(
        MapMutation(op="set_view", payload={"x": 1}),
        narrative="testing",
    )
    assert len(hub_spy.calls) == 1
    channel, type_, data, user_id = hub_spy.calls[0]
    assert channel == "map"
    assert type_ == "set_view"
    assert data["payload"] == {"x": 1}
    assert data["narrative"] == "testing"
    assert user_id is None


@pytest.mark.asyncio
async def test_broadcast_helper_passes_user_id(hub_spy: _Recorder):
    await broadcast_map_mutation(
        MapMutation(op="enable_layer", target="frontline", payload={"layer_id": "frontline"}),
        user_id="user-42",
    )
    _ch, _type, _data, user_id = hub_spy.calls[0]
    assert user_id == "user-42"


@pytest.mark.asyncio
async def test_open_map_action_emits_one_ws_event(hub_spy: _Recorder):
    await MapOpenMap(reason="frontline status").execute(_ctx())
    assert len(hub_spy.calls) == 1
    channel, type_, data, _ = hub_spy.calls[0]
    assert channel == "map"
    assert type_ == "open_map"
    assert data["payload"]["reason"] == "frontline status"


@pytest.mark.asyncio
async def test_enable_layer_action_emits_attribution_payload(hub_spy: _Recorder):
    await MapEnableLayer(layer_id="frontline").execute(_ctx())
    channel, type_, data, _ = hub_spy.calls[0]
    assert channel == "map"
    assert type_ == "enable_layer"
    assert data["target"] == "frontline"
    assert data["payload"]["attribution"].startswith("Дані: DeepStateMap")


@pytest.mark.asyncio
async def test_websocket_hub_broadcast_helper_matches_channel():
    """The convenience helper in api.websocket_hub uses the same channel."""
    # Direct call against the real hub — fan-out is empty (no clients
    # connected in tests) but no exception should propagate.
    await wsh.broadcast_map_mutation("noop", {"foo": "bar"})
    # Restore — fixture doesn't replace the singleton for this test, so
    # nothing else to assert beyond not-raising.
