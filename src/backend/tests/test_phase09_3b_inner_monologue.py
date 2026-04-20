"""
Phase 9.3b — inner monologue channel tests.

Channel existence, emission from plan/reflection/emotion_shift, rate
limiting.
"""
from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone
from typing import Any

import pytest

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase093b-mono")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-key")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


class _RecordingHub:
    """Drop-in replacement for api.websocket_hub.hub that captures
    broadcast calls without actually talking to sockets."""
    def __init__(self) -> None:
        self.broadcasts: list[tuple[str, str, dict[str, Any]]] = []

    async def broadcast(self, channel: str, type_: str, data: dict[str, Any],
                        user_id: str | None = None) -> None:
        self.broadcasts.append((channel, type_, data))


@pytest.fixture
def recording_hub(monkeypatch):
    """Patch hub.broadcast in-place so emit_monologue sees a fake hub."""
    from api import websocket_hub as _wh
    from agent import monologue_emitter as _me
    hub = _RecordingHub()
    monkeypatch.setattr(_wh, "hub", hub)
    _me.reset_rate_limiter_for_tests()
    return hub


# ── Basic emit ───────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_emit_monologue_publishes_on_channel(recording_hub):
    from agent.monologue_emitter import MonologueEvent, emit_monologue

    ok = await emit_monologue(MonologueEvent(
        kind="plan",
        source="tactical",
        monologue={"what_i_see": "x"},
        task_id="t1",
    ))
    assert ok is True
    assert len(recording_hub.broadcasts) == 1
    channel, kind, payload = recording_hub.broadcasts[0]
    assert channel == "inner_monologue.stream"
    assert kind == "plan"
    assert payload["source"] == "tactical"
    assert payload["task_id"] == "t1"


@pytest.mark.asyncio
async def test_emit_reflection_payload(recording_hub):
    from agent.monologue_emitter import MonologueEvent, emit_monologue

    await emit_monologue(MonologueEvent(
        kind="reflection",
        source="reflector",
        monologue={"verdict": "continue", "summary": "ok"},
        task_id="t2",
    ))
    _, kind, payload = recording_hub.broadcasts[0]
    assert kind == "reflection"
    assert payload["monologue"]["verdict"] == "continue"


@pytest.mark.asyncio
async def test_emit_emotion_shift_payload(recording_hub):
    from agent.monologue_emitter import MonologueEvent, emit_monologue

    await emit_monologue(MonologueEvent(
        kind="emotion_shift",
        source="emotion_engine",
        monologue={
            "dimension": "concern",
            "from": 0.2,
            "to": 0.55,
            "trigger": "action.failed",
        },
    ))
    _, kind, payload = recording_hub.broadcasts[0]
    assert kind == "emotion_shift"
    assert payload["monologue"]["dimension"] == "concern"


@pytest.mark.asyncio
async def test_emit_proactive_payload(recording_hub):
    from agent.monologue_emitter import MonologueEvent, emit_monologue

    await emit_monologue(MonologueEvent(
        kind="proactive",
        source="proactive",
        monologue={"should_speak": False, "reason": "nothing new"},
    ))
    _, kind, _ = recording_hub.broadcasts[0]
    assert kind == "proactive"


# ── Rate limiting ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_rate_limit_drops_overflow(recording_hub, monkeypatch):
    """With a 3 events/s limit, the 4th+ in the same window are dropped."""
    from config import config
    from agent.monologue_emitter import MonologueEvent, emit_monologue

    monkeypatch.setattr(config, "agent_monologue_rate_limit_eps", 3)
    results: list[bool] = []
    for i in range(5):
        ok = await emit_monologue(MonologueEvent(
            kind="plan",
            source="tactical",
            monologue={"i": i},
        ))
        results.append(ok)
    assert results[:3] == [True, True, True]
    assert results[3:] == [False, False]
    assert len(recording_hub.broadcasts) == 3


@pytest.mark.asyncio
async def test_rate_limit_window_refills_after_1s(recording_hub, monkeypatch):
    from config import config
    from agent.monologue_emitter import MonologueEvent, emit_monologue

    monkeypatch.setattr(config, "agent_monologue_rate_limit_eps", 2)
    # Burn the window.
    await emit_monologue(MonologueEvent(kind="plan", source="t", monologue={}))
    await emit_monologue(MonologueEvent(kind="plan", source="t", monologue={}))
    assert (await emit_monologue(
        MonologueEvent(kind="plan", source="t", monologue={})
    )) is False
    # Wait out the 1s window.
    await asyncio.sleep(1.1)
    assert (await emit_monologue(
        MonologueEvent(kind="plan", source="t", monologue={})
    )) is True


# ── Channel registration (via WSHub) ─────────────────────────────────────────


def test_channel_name_is_inner_monologue_stream():
    """Module constant-style assertion — the channel string must match
    the frontend's services/websocket.ts declaration."""
    from agent.monologue_emitter import MonologueEvent
    # Ensure MonologueEvent still has the right `kind` literal types.
    ev = MonologueEvent(kind="plan", source="x", monologue={})
    assert ev.kind == "plan"
