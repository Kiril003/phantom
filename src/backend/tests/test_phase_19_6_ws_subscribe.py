"""Phase 19-6 — WS hub channel subscription protocol.

Per `docs/MOBILE_COMPANION.md` §6, the phone needs a way to opt out of
high-volume channels (`agent.stream` raw step logs, `inner_monologue.
stream`, etc.) while still receiving the ones it cares about (`sensor`,
`state`, `pair`, `familiar`). Without this filter every paired phone
pays the bandwidth + battery cost of the entire desktop fan-out.

These tests exercise the unit-level pieces directly:

  • `WSClient.wants(channel)` — predicate the broadcast loop checks.
  • `WSClient.channels` — None for legacy clients (default), set for
    mobile clients.
  • `WebSocketHub._handle_control` — applies subscribe / unsubscribe /
    subscribe_all and persists the result on the client.
  • `WebSocketHub.broadcast` — skips clients whose `wants` returns
    False, sends to everyone else.

We avoid spinning up a real FastAPI WebSocket here — `_handle_control`
takes the parsed message dict directly, and `broadcast` only needs the
WSClient.send hook. A tiny stand-in keeps the test below ~1 s runtime.
"""
from __future__ import annotations

import json

import pytest

from api.websocket_hub import WebSocketHub, WSClient


class _FakeWS:
    """Minimal stand-in for fastapi.WebSocket — captures sent text."""

    def __init__(self) -> None:
        self.sent: list[str] = []

    async def send_text(self, text: str) -> None:
        self.sent.append(text)

    async def close(self) -> None:
        pass


def _make_client(ws: _FakeWS, client_id: str = "c1", user_id: str = "u1") -> WSClient:
    return WSClient(ws=ws, client_id=client_id, user_id=user_id)


def test_legacy_client_wants_every_channel() -> None:
    """Channel filter defaults to None → wants() always True. This is
    the contract that protects the desktop UI from regressions."""
    c = _make_client(_FakeWS())
    assert c.channels is None
    for ch in ("sensor", "state", "agent.stream", "anything", ""):
        assert c.wants(ch), f"legacy client should accept channel {ch!r}"


def test_subscribe_narrows_filter() -> None:
    c = _make_client(_FakeWS())
    c.channels = {"sensor", "pair"}
    assert c.wants("sensor")
    assert c.wants("pair")
    assert not c.wants("agent.stream")
    assert not c.wants("inner_monologue.stream")


@pytest.mark.asyncio
async def test_handle_control_subscribe_then_unsubscribe() -> None:
    hub = WebSocketHub()
    ws = _FakeWS()
    c = _make_client(ws)

    # subscribe — narrows from None to a concrete set
    await hub._handle_control(
        c, "subscribe", {"control": "subscribe", "channels": ["sensor", "pair"]}
    )
    assert c.channels == {"sensor", "pair"}

    # subscribe again — additive (does not replace)
    await hub._handle_control(
        c, "subscribe", {"control": "subscribe", "channels": ["state"]}
    )
    assert c.channels == {"sensor", "pair", "state"}

    # unsubscribe — removes only listed channels
    await hub._handle_control(
        c, "unsubscribe", {"control": "unsubscribe", "channels": ["pair"]}
    )
    assert c.channels == {"sensor", "state"}

    # subscribe_all — back to legacy default
    await hub._handle_control(c, "subscribe_all", {"control": "subscribe_all"})
    assert c.channels is None
    assert c.wants("agent.stream")

    # Each control msg also produced an ack on `_meta/subscribed`.
    assert len(ws.sent) == 4
    last = json.loads(ws.sent[-1])
    assert last["channel"] == "_meta"
    assert last["type"] == "subscribed"
    assert last["data"]["channels"] is None  # subscribe_all → None


@pytest.mark.asyncio
async def test_handle_control_ignores_unknown_verb() -> None:
    hub = WebSocketHub()
    c = _make_client(_FakeWS())
    c.channels = {"sensor"}
    await hub._handle_control(c, "frobulate", {"control": "frobulate"})
    # Unchanged.
    assert c.channels == {"sensor"}


@pytest.mark.asyncio
async def test_broadcast_skips_unsubscribed_clients() -> None:
    hub = WebSocketHub()
    ws_legacy = _FakeWS()
    ws_mobile = _FakeWS()
    legacy = _make_client(ws_legacy, client_id="desktop")
    mobile = _make_client(ws_mobile, client_id="phone")
    mobile.channels = {"sensor", "pair"}

    async with hub._lock:
        hub._clients["desktop"] = legacy
        hub._clients["phone"] = mobile

    # `agent.stream` — legacy gets it, mobile does not.
    await hub.broadcast("agent.stream", "step", {"x": 1})
    assert len(ws_legacy.sent) == 1
    assert len(ws_mobile.sent) == 0

    # `sensor` — both get it.
    await hub.broadcast("sensor", "snapshot", {"snapshot": {}})
    assert len(ws_legacy.sent) == 2
    assert len(ws_mobile.sent) == 1

    # `pair` — both get it (mobile subscribed; legacy is wildcard).
    await hub.broadcast("pair", "claimed", {"device_id": "x"})
    assert len(ws_legacy.sent) == 3
    assert len(ws_mobile.sent) == 2


@pytest.mark.asyncio
async def test_broadcast_user_filter_still_works() -> None:
    """Pre-existing user_id filter (used by routes_pair `pair/claimed`
    broadcast) keeps working alongside the new channel filter."""
    hub = WebSocketHub()
    ws_a = _FakeWS()
    ws_b = _FakeWS()
    ca = _make_client(ws_a, client_id="a", user_id="user-a")
    cb = _make_client(ws_b, client_id="b", user_id="user-b")
    ca.channels = {"pair"}
    cb.channels = {"pair"}

    async with hub._lock:
        hub._clients["a"] = ca
        hub._clients["b"] = cb

    await hub.broadcast("pair", "claimed", {"device_id": "x"}, user_id="user-a")

    assert len(ws_a.sent) == 1
    assert len(ws_b.sent) == 0  # filtered out by user_id


@pytest.mark.asyncio
async def test_subscribe_with_malformed_channels_field() -> None:
    """Robustness: if a buggy client sends `channels` as something
    other than a list of strings, treat it as an empty set rather
    than crashing the receive loop. Forces hostile-input safety."""
    hub = WebSocketHub()
    c = _make_client(_FakeWS())
    await hub._handle_control(
        c, "subscribe", {"control": "subscribe", "channels": "not-a-list"}
    )
    assert c.channels == set()  # narrowed to empty (effectively muted)
    await hub._handle_control(
        c, "subscribe", {"control": "subscribe", "channels": [None, 42, "sensor"]}
    )
    assert c.channels == {"sensor"}  # only the valid string survived
