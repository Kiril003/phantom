"""What reaches `background_events` — the only channel a spawned specialist
is visible on."""
from __future__ import annotations

import os

import pytest

os.environ.setdefault("JWT_SECRET_KEY", "test-bg-observer")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


@pytest.fixture
def hub_spy(monkeypatch):
    captured: list[tuple[str, str, dict]] = []

    class FakeHub:
        async def broadcast(self, channel, type_, payload):
            captured.append((channel, type_, payload))

    import api.websocket_hub as _hubmod
    monkeypatch.setattr(_hubmod, "hub", FakeHub())
    return captured


@pytest.fixture
def bg_runtime(monkeypatch):
    from agent.kernel.runtime import AgentRuntime, current_task_id, current_track

    rt = AgentRuntime()
    track_token = current_track.set("background")
    id_token = current_task_id.set("spec-1")

    async def _no_emotion(*_a, **_k):
        return None

    import agent.cognition.emotion as _emo
    monkeypatch.setattr(_emo, "update_emotion_on_event", _no_emotion)

    yield rt
    current_track.reset(track_token)
    current_task_id.reset(id_token)


def types_on(captured, channel="background_events"):
    return [t for c, t, _p in captured if c == channel]


def payload_of(captured, type_):
    for _c, t, p in captured:
        if t == type_:
            return p
    raise AssertionError(f"{type_} never broadcast")


class TestObserverAllowlist:
    @pytest.mark.asyncio
    async def test_state_events_reach_background_channel(self, bg_runtime, hub_spy):
        for type_, payload in [
            ("substate.changed", {"task_id": "spec-1", "substate": "thinking"}),
            ("thinking.started", {"task_id": "spec-1", "planner": "tactical", "step_idx": 3}),
            ("thinking.completed", {"task_id": "spec-1", "planner": "tactical", "step_idx": 3}),
            ("action.started", {"task_id": "spec-1", "step_idx": 3, "action": "fs.read"}),
            ("tool.selected", {"task_id": "spec-1", "step_idx": 3, "action": "fs.read", "risk_level": 1}),
            ("sub_goal.started", {"task_id": "spec-1", "sub_goal_id": "sg1", "description": "розібрати лог"}),
            ("sub_goal.done", {"task_id": "spec-1", "sub_goal_id": "sg1", "summary": "готово"}),
            ("sub_goal.abandoned", {"task_id": "spec-1", "sub_goal_id": "sg1", "reason": "no_progress"}),
        ]:
            await bg_runtime._broadcast(type_, payload)

        got = types_on(hub_spy)
        assert got == [
            "substate.changed", "thinking.started", "thinking.completed",
            "action.started", "tool.selected",
            "sub_goal.started", "sub_goal.done", "sub_goal.abandoned",
        ]
        assert types_on(hub_spy, "agent.stream") == []

    @pytest.mark.asyncio
    async def test_blocked_and_waiting_states_reach_channel(self, bg_runtime, hub_spy):
        await bg_runtime._broadcast("task.paused", {"task_id": "spec-1", "reason": "operator"})
        await bg_runtime._broadcast(
            "task.waiting_user", {"task_id": "spec-1", "prompt_to_user": "approve?"},
        )
        await bg_runtime._broadcast(
            "task.blocked_quota", {"task_id": "spec-1", "reason": "429", "probe_interval_s": 60},
        )
        await bg_runtime._broadcast("task.resumed", {"task_id": "spec-1", "reason": "quota_recovered"})

        assert types_on(hub_spy) == [
            "task.paused", "task.waiting_user", "task.blocked_quota", "task.resumed",
        ]

    @pytest.mark.asyncio
    async def test_team_message_reaches_channel(self, bg_runtime, hub_spy):
        await bg_runtime._broadcast("team.message", {
            "id": "m1",
            "task_id": "child-1",
            "parent_task_id": "spec-1",
            "sender": "team_lead_engineering",
            "receiver": "senior_backend",
            "message": "візьми парсер",
            "message_type": "delegate",
            "media": [{"type": "file", "path": "/big.bin"}],
        })
        assert types_on(hub_spy) == ["team.message"]
        assert payload_of(hub_spy, "team.message")["receiver"] == "senior_backend"
        assert "media" not in payload_of(hub_spy, "team.message")

    @pytest.mark.asyncio
    async def test_content_events_stay_out(self, bg_runtime, hub_spy):
        await bg_runtime._broadcast("observation.added", {
            "task_id": "spec-1", "observation": {"content": "x" * 5000},
        })
        await bg_runtime._broadcast("plan.step_created", {
            "task_id": "spec-1", "step": {"monologue": {"reasoning": "y" * 5000}},
        })
        await bg_runtime._broadcast("strategic_plan.created", {"task_id": "spec-1"})
        await bg_runtime._broadcast("checkpoint.created", {"task_id": "spec-1"})
        assert hub_spy == []

    def test_every_observer_event_declares_its_fields(self):
        from agent.kernel.runtime import (
            _BACKGROUND_ALLOWED_EVENTS, _BACKGROUND_OBSERVER_EVENTS,
            _LIFECYCLE_FIELDS, _OBSERVER_FIELDS,
        )
        assert set(_OBSERVER_FIELDS) == set(_BACKGROUND_OBSERVER_EVENTS)
        assert set(_LIFECYCLE_FIELDS) == set(_BACKGROUND_ALLOWED_EVENTS)
        assert not (_BACKGROUND_OBSERVER_EVENTS & _BACKGROUND_ALLOWED_EVENTS)


class TestPayloadSize:
    @pytest.mark.asyncio
    async def test_long_text_is_capped(self, bg_runtime, hub_spy):
        from agent.kernel.runtime import _OBSERVER_TEXT_CAP

        await bg_runtime._broadcast("sub_goal.started", {
            "task_id": "spec-1", "sub_goal_id": "sg1", "description": "д" * 4000,
        })
        assert len(payload_of(hub_spy, "sub_goal.started")["description"]) == _OBSERVER_TEXT_CAP

    @pytest.mark.asyncio
    async def test_unknown_keys_are_dropped(self, bg_runtime, hub_spy):
        await bg_runtime._broadcast("thinking.started", {
            "task_id": "spec-1", "planner": "tactical", "step_idx": 1,
            "prompt": "the whole prompt text",
        })
        assert payload_of(hub_spy, "thinking.started") == {
            "task_id": "spec-1", "planner": "tactical", "step_idx": 1,
        }

    @pytest.mark.asyncio
    async def test_task_started_drops_self_model_keeps_lineage(self, bg_runtime, hub_spy):
        await bg_runtime._broadcast("task.started", {
            "task_id": "spec-1",
            "goal": "[role=senior_backend] полагодь парсер",
            "track": "background",
            "resumed": False,
            "self_model": {"capabilities": ["a"] * 500},
            "parent_task_id": "root-1",
            "subagent_role": "senior_backend",
            "delegation_depth": 1,
        })
        payload = payload_of(hub_spy, "task.started")
        assert "self_model" not in payload
        assert payload["goal"] == "[role=senior_backend] полагодь парсер"
        assert payload["parent_task_id"] == "root-1"
        assert payload["subagent_role"] == "senior_backend"


class TestRateLimit:
    @pytest.mark.asyncio
    async def test_burst_is_throttled_but_latest_state_survives(self, bg_runtime, hub_spy):
        from agent.kernel.runtime import _OBSERVER_BURST

        for i in range(int(_OBSERVER_BURST) + 40):
            await bg_runtime._broadcast("action.started", {
                "task_id": "spec-1", "step_idx": i, "action": f"a{i}",
            })
        sent = types_on(hub_spy)
        assert len(sent) <= int(_OBSERVER_BURST) + 2

        await bg_runtime._broadcast("task.completed", {
            "task_id": "spec-1", "track": "background", "summary": "ok", "error": None,
        })
        flushed = [p for _c, t, p in hub_spy if t == "action.started"]
        assert flushed[-1]["step_idx"] == int(_OBSERVER_BURST) + 39
        assert types_on(hub_spy)[-1] == "task.completed"

    @pytest.mark.asyncio
    async def test_lifecycle_is_never_throttled(self, bg_runtime, hub_spy):
        for i in range(200):
            await bg_runtime._broadcast("action.started", {
                "task_id": "spec-1", "step_idx": i, "action": "spin",
            })
        before = len(hub_spy)
        await bg_runtime._broadcast("task.failed", {
            "task_id": "spec-1", "track": "background", "summary": "", "error": "boom",
        })
        assert "task.failed" in types_on(hub_spy)[before:]

    @pytest.mark.asyncio
    async def test_buckets_are_per_task(self, bg_runtime, hub_spy):
        from agent.kernel.runtime import _OBSERVER_BURST

        for i in range(int(_OBSERVER_BURST) + 20):
            await bg_runtime._broadcast("action.started", {
                "task_id": "noisy", "step_idx": i, "action": "spin",
            })
        await bg_runtime._broadcast("action.started", {
            "task_id": "quiet", "step_idx": 0, "action": "fs.read",
        })
        quiet = [p for _c, t, p in hub_spy if t == "action.started" and p["task_id"] == "quiet"]
        assert len(quiet) == 1


class TestSubstateIdentity:
    @pytest.mark.asyncio
    async def test_substate_carries_the_subagent_task_id(self, bg_runtime, hub_spy):
        from agent.kernel.runtime import current_task_id

        token = current_task_id.set("child-77")
        try:
            await bg_runtime.set_substate("thinking")
        finally:
            current_task_id.reset(token)

        assert payload_of(hub_spy, "substate.changed") == {
            "task_id": "child-77", "substate": "thinking",
        }

    @pytest.mark.asyncio
    async def test_concurrent_subagents_do_not_swallow_each_others_substate(
        self, bg_runtime, hub_spy,
    ):
        from agent.kernel.runtime import current_task_id

        for task_id in ("child-a", "child-b"):
            token = current_task_id.set(task_id)
            try:
                await bg_runtime.set_substate("thinking")
            finally:
                current_task_id.reset(token)

        seen = [p["task_id"] for _c, t, p in hub_spy if t == "substate.changed"]
        assert seen == ["child-a", "child-b"]

    @pytest.mark.asyncio
    async def test_repeat_substate_is_still_deduped(self, bg_runtime, hub_spy):
        from agent.kernel.runtime import current_task_id

        token = current_task_id.set("child-c")
        try:
            await bg_runtime.set_substate("thinking")
            await bg_runtime.set_substate("thinking")
            await bg_runtime.set_substate("acting")
        finally:
            current_task_id.reset(token)

        assert [p["substate"] for _c, t, p in hub_spy if t == "substate.changed"] == [
            "thinking", "acting",
        ]
