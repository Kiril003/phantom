"""
Phase 9.4a — proactive loop action path tests.

Covers the new decide kinds (speak / action / none), pending_action
confirmation flow, affirmative parsing, timeout expiry, TrackBusyError
soft-skip, and the no-race path where decide returns speak AND a
pending action exists.
"""
from __future__ import annotations

import asyncio
import os
from datetime import timedelta

import pytest

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase094a-pro")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-key")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


def _build_runtime():
    from agent.runtime import AgentRuntime
    return AgentRuntime()


class _FakeHub:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, dict]] = []

    async def broadcast(self, channel, type_, payload):
        self.calls.append((channel, type_, payload))


@pytest.fixture
def fake_hub(monkeypatch):
    hub = _FakeHub()
    import api.websocket_hub as _hubmod
    monkeypatch.setattr(_hubmod, "hub", hub)
    return hub


# ── Decide output shape ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_decide_returns_kind_action_populates_goal(monkeypatch, fake_hub):
    """When decide returns kind=action, _maybe_speak dispatches an action."""
    from agent.proactive import ProactiveLoop

    captured_fire: list[dict] = []
    runtime = _build_runtime()

    async def fake_start(goal, **kwargs):
        captured_fire.append({"goal": goal, **kwargs})
        return ("t-auto", True)
    monkeypatch.setattr(runtime, "start_task", fake_start)

    loop = ProactiveLoop(runtime)
    monkeypatch.setattr(loop, "_should_consider_speaking", lambda ctx: True)

    async def fake_decide(ctx):
        return {
            "kind": "action", "action_goal": "перевір диск",
            "confirm_with_user": False, "reason": "free space low",
            "priority": 6,
        }
    monkeypatch.setattr(loop, "_decide", fake_decide)

    await loop._maybe_speak()

    assert len(captured_fire) == 1
    assert captured_fire[0]["track"] == "background"
    assert captured_fire[0]["origin"] == "proactive_auto"
    assert captured_fire[0]["goal"] == "перевір диск"


# ── confirm_with_user=false ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_action_without_confirm_fires_immediately(monkeypatch, fake_hub):
    from agent.proactive import ProactiveLoop

    runtime = _build_runtime()
    fired: list[str] = []

    async def fake_start(goal, **kwargs):
        fired.append(goal)
        return ("tid-1", True)
    monkeypatch.setattr(runtime, "start_task", fake_start)

    loop = ProactiveLoop(runtime)
    monkeypatch.setattr(loop, "_should_consider_speaking", lambda ctx: True)

    async def fake_decide(ctx):
        return {
            "kind": "action", "action_goal": "tail log",
            "confirm_with_user": False, "reason": "ok", "priority": 3,
        }
    monkeypatch.setattr(loop, "_decide", fake_decide)

    await loop._maybe_speak()

    assert fired == ["tail log"]
    # No pending — fired immediately.
    assert loop.has_pending_action() is False
    # WS event emitted for UI.
    kinds = [c[1] for c in fake_hub.calls]
    assert "proactive.action_fired" in kinds


# ── confirm_with_user=true ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_action_with_confirm_parks_pending(monkeypatch, fake_hub):
    from agent.proactive import ProactiveLoop

    runtime = _build_runtime()
    fired: list[str] = []

    async def fake_start(goal, **kwargs):
        fired.append(goal)
        return ("tid", True)
    monkeypatch.setattr(runtime, "start_task", fake_start)

    loop = ProactiveLoop(runtime)
    monkeypatch.setattr(loop, "_should_consider_speaking", lambda ctx: True)
    # _emit_speech would hit DB; stub it.
    emitted: list[str] = []
    async def fake_emit(msg, reason, priority, ctx):
        emitted.append(msg)
    monkeypatch.setattr(loop, "_emit_speech", fake_emit)

    async def fake_decide(ctx):
        return {
            "kind": "action", "action_goal": "backup home",
            "confirm_with_user": True, "reason": "safety", "priority": 7,
        }
    monkeypatch.setattr(loop, "_decide", fake_decide)

    await loop._maybe_speak()

    # Pending intent parked — but no task fired yet.
    assert fired == []
    assert loop.has_pending_action() is True
    pending = loop.peek_pending_action()
    assert pending is not None
    assert pending.action_goal == "backup home"
    assert pending.priority == 7
    # User-facing ask was emitted.
    assert any("backup home" in m for m in emitted)
    # And an agent.stream event for the UI.
    kinds = [c[1] for c in fake_hub.calls]
    assert "proactive.pending_action" in kinds


# ── Affirmative resolves + fires ───────────────────────────────────────────


@pytest.mark.asyncio
async def test_affirmative_reply_fires_pending_action(monkeypatch, fake_hub):
    from agent.proactive import PendingAction, ProactiveLoop, _utcnow

    runtime = _build_runtime()
    fired: list[str] = []
    async def fake_start(goal, **kwargs):
        fired.append(goal)
        return ("tid-confirmed", True)
    monkeypatch.setattr(runtime, "start_task", fake_start)

    loop = ProactiveLoop(runtime)
    loop._pending_action = PendingAction(
        action_goal="перевір ram", reason="r", priority=4,
        created_at=_utcnow(),
    )
    task_id = await loop.resolve_pending_action("так")
    assert task_id == "tid-confirmed"
    assert fired == ["перевір ram"]
    assert loop.has_pending_action() is False


# ── Non-affirmative reply clears without firing ────────────────────────────


@pytest.mark.asyncio
async def test_non_affirmative_reply_clears_pending_no_fire(monkeypatch, fake_hub):
    from agent.proactive import PendingAction, ProactiveLoop, _utcnow

    runtime = _build_runtime()
    fired: list[str] = []
    async def fake_start(goal, **kwargs):
        fired.append(goal)
        return ("bad", True)
    monkeypatch.setattr(runtime, "start_task", fake_start)

    loop = ProactiveLoop(runtime)
    loop._pending_action = PendingAction(
        action_goal="щось", reason="r", priority=4, created_at=_utcnow(),
    )
    result = await loop.resolve_pending_action("ні, потім")
    assert result is None
    assert fired == []
    assert loop.has_pending_action() is False  # cleared


# ── Timeout expiry ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_pending_action_times_out(monkeypatch, fake_hub):
    from agent.proactive import PENDING_ACTION_TIMEOUT_S, PendingAction, ProactiveLoop, _utcnow

    runtime = _build_runtime()
    loop = ProactiveLoop(runtime)
    stale_created = _utcnow() - timedelta(seconds=PENDING_ACTION_TIMEOUT_S + 5)
    loop._pending_action = PendingAction(
        action_goal="stale", reason="r", priority=4, created_at=stale_created,
    )
    # Even an affirmative can't resurrect an expired pending.
    result = await loop.resolve_pending_action("так")
    assert result is None
    assert loop.has_pending_action() is False


# ── TrackBusyError skips without raising ──────────────────────────────────


@pytest.mark.asyncio
async def test_full_background_queue_skips_action(monkeypatch, fake_hub):
    """Proactive is best-effort — a saturated background queue should
    result in a silent skip, not an error."""
    from agent.errors import TrackBusyError
    from agent.proactive import ProactiveLoop

    runtime = _build_runtime()
    async def refuse(goal, **kwargs):
        raise TrackBusyError("background", 20)
    monkeypatch.setattr(runtime, "start_task", refuse)

    loop = ProactiveLoop(runtime)
    monkeypatch.setattr(loop, "_should_consider_speaking", lambda ctx: True)

    async def fake_decide(ctx):
        return {
            "kind": "action", "action_goal": "will be skipped",
            "confirm_with_user": False, "reason": "r", "priority": 2,
        }
    monkeypatch.setattr(loop, "_decide", fake_decide)

    # Must not raise.
    await loop._maybe_speak()
    assert loop.has_pending_action() is False
    # No proactive.action_fired event because no task started.
    kinds = [c[1] for c in fake_hub.calls]
    assert "proactive.action_fired" not in kinds


# ── Speak path still works alongside pending ──────────────────────────────


@pytest.mark.asyncio
async def test_decide_speak_with_prior_pending_does_not_race(monkeypatch, fake_hub):
    """A speak decision while a pending action exists should emit speech
    and NOT accidentally clear the pending intent."""
    from agent.proactive import PendingAction, ProactiveLoop, _utcnow

    runtime = _build_runtime()
    loop = ProactiveLoop(runtime)
    loop._pending_action = PendingAction(
        action_goal="keep me", reason="r", priority=5, created_at=_utcnow(),
    )
    monkeypatch.setattr(loop, "_should_consider_speaking", lambda ctx: True)
    emitted: list[str] = []
    async def fake_emit(msg, reason, priority, ctx):
        emitted.append(msg)
    monkeypatch.setattr(loop, "_emit_speech", fake_emit)
    async def fake_decide(ctx):
        return {
            "kind": "speak", "message": "hello there",
            "reason": "checking in", "priority": 3,
        }
    monkeypatch.setattr(loop, "_decide", fake_decide)

    await loop._maybe_speak()
    assert emitted == ["hello there"]
    # Pending survives an unrelated speak decision.
    assert loop.has_pending_action() is True
    assert loop.peek_pending_action().action_goal == "keep me"


# ── Affirmative regex boundaries ──────────────────────────────────────────


def test_affirmative_regex_boundaries():
    from agent.proactive import AFFIRMATIVE_RX

    for yes in ["так", "Так.", "YES", "ok", "ok!", "давай", "ГО"]:
        assert AFFIRMATIVE_RX.match(yes) is not None, yes
    for no in ["", "ні", "no", "not now", "maybe", "так, але не зараз"]:
        # "так, але не зараз" deliberately treated as NOT affirmative —
        # ambiguity → no-fire.
        assert AFFIRMATIVE_RX.match(no) is None, no
