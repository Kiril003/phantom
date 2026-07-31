"""`team.message` must describe traffic that genuinely happened: a goal going
down to a spawned specialist, and its report coming back."""
from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass
from typing import Any

import pytest

os.environ.setdefault("JWT_SECRET_KEY", "test-team-traffic")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


@dataclass
class FakeParent:
    id: str = "root-1"
    delegation_depth: int = 0
    subagent_role: str | None = None


@dataclass
class FakeRuntime:
    current_task: Any = None


@pytest.fixture
def messages(monkeypatch):
    sent: list[dict[str, Any]] = []

    async def fake_write(**kwargs):
        sent.append(kwargs)

    import agent.kernel.audit as _audit
    monkeypatch.setattr(_audit, "write_team_message", fake_write)
    return sent


@pytest.fixture
def spawn_mod(monkeypatch):
    """Real spawn path, child runner replaced by one that reports at once."""
    from agent.team import spawn as mod

    mod._reset_team_semaphore_for_tests()

    async def fake_runner(*, child_id, role, **_kw):
        try:
            await asyncio.sleep(0)
            from core.event_bus import event_bus
            event_bus.emit(mod._channel(child_id), mod.SubagentReport(
                child_task_id=child_id, role=role, outcome="done",
                summary="переклав файл",
            ))
        finally:
            mod.team_semaphore().release()

    monkeypatch.setattr(mod, "_run_subagent", fake_runner)
    yield mod
    mod._reset_team_semaphore_for_tests()


class TestDelegationHandover:
    @pytest.mark.asyncio
    async def test_spawn_announces_work_going_down(self, spawn_mod, messages):
        parent = FakeParent(subagent_role="team_lead_engineering")
        child_id = await spawn_mod.spawn_subagent(
            runtime=FakeRuntime(),
            parent_state=parent,
            goal="полагодь парсер логів",
            role="senior_backend",
        )

        assert len(messages) == 1
        msg = messages[0]
        assert msg["message_type"] == "delegate"
        assert msg["sender"] == "team_lead_engineering"
        assert msg["receiver"] == "senior_backend"
        assert msg["message"] == "полагодь парсер логів"
        # task_id names the receiver, parent_task_id the sender.
        assert msg["task_id"] == child_id
        assert msg["parent_task_id"] == parent.id

    @pytest.mark.asyncio
    async def test_operator_task_is_the_sender_when_it_has_no_role(
        self, spawn_mod, messages,
    ):
        await spawn_mod.spawn_subagent(
            runtime=FakeRuntime(),
            parent_state=FakeParent(),
            goal="збери дані",
            role="domain_researcher",
        )
        assert messages[0]["sender"] == "operator"

    @pytest.mark.asyncio
    async def test_refused_spawn_announces_nothing(self, spawn_mod, messages, monkeypatch):
        from config import config
        monkeypatch.setattr(config, "agent_max_delegation_depth", 1)

        with pytest.raises(spawn_mod.DelegationDepthExceeded):
            await spawn_mod.spawn_subagent(
                runtime=FakeRuntime(),
                parent_state=FakeParent(delegation_depth=1),
                goal="занадто глибоко",
                role="senior_backend",
            )
        assert messages == []


class TestReportHandover:
    @pytest.mark.asyncio
    async def test_report_announces_work_coming_back(self, spawn_mod, messages):
        parent = FakeParent(subagent_role="team_lead_qa")
        report = spawn_mod.SubagentReport(
            child_task_id="child-9", role="senior_test",
            outcome="done", summary="20 тестів зелені",
        )
        await spawn_mod.announce_subagent_report(parent_state=parent, report=report)

        assert len(messages) == 1
        msg = messages[0]
        assert msg["message_type"] == "report"
        assert msg["sender"] == "senior_test"
        assert msg["receiver"] == "team_lead_qa"
        assert "20 тестів зелені" in msg["message"]
        assert msg["task_id"] == parent.id
        assert msg["parent_task_id"] == "child-9"

    @pytest.mark.asyncio
    async def test_failed_child_still_reports(self, spawn_mod, messages):
        report = spawn_mod.SubagentReport(
            child_task_id="child-9", role="senior_backend",
            outcome="failed", summary="не знайшов файл",
        )
        await spawn_mod.announce_subagent_report(
            parent_state=FakeParent(), report=report,
        )
        assert messages[0]["message"].startswith("failed:")

    @pytest.mark.asyncio
    async def test_synthetic_timeout_is_not_traffic(self, spawn_mod, messages):
        report = await spawn_mod.await_subagent("ghost-id", timeout_s=0.05)
        assert report.outcome == "timeout"
        assert report.role == "unknown"

        await spawn_mod.announce_subagent_report(
            parent_state=FakeParent(), report=report,
        )
        assert messages == []


class TestDelegateAction:
    @pytest.mark.asyncio
    async def test_delegate_emits_exactly_one_handover_each_way(
        self, spawn_mod, messages,
    ):
        from agent.actions.base import ActionContext
        from agent.actions.delegate import AgentDelegate

        parent = FakeParent(id="root-7")
        ctx = ActionContext(
            task_id="root-7", step_idx=0, workspace_dir="/tmp",
            runtime=FakeRuntime(current_task=parent),
        )
        result = await AgentDelegate(
            goal="напиши тести для парсера", role="senior_test", timeout_s=10,
        ).execute(ctx)

        assert result.ok is True
        assert [m["message_type"] for m in messages] == ["delegate", "report"]
        assert messages[0]["task_id"] == result.output["child_task_id"]
        assert messages[1]["parent_task_id"] == result.output["child_task_id"]
        assert messages[1]["task_id"] == "root-7"

    @pytest.mark.asyncio
    async def test_delegate_refusal_emits_nothing(self, spawn_mod, messages, monkeypatch):
        from agent.actions.base import ActionContext
        from agent.actions.delegate import AgentDelegate
        from config import config

        monkeypatch.setattr(config, "agent_team_enabled", False)
        ctx = ActionContext(
            task_id="root-8", step_idx=0, workspace_dir="/tmp",
            runtime=FakeRuntime(current_task=FakeParent(id="root-8")),
        )
        result = await AgentDelegate(goal="нічого", role="translator").execute(ctx)

        assert result.ok is False
        assert messages == []


class TestAssembleTeamAction:
    @pytest.mark.asyncio
    async def test_every_member_is_announced_both_ways(self, spawn_mod, messages):
        from agent.actions.base import ActionContext
        from agent.actions.team_assemble import AgentAssembleTeam

        parent = FakeParent(id="root-11")
        ctx = ActionContext(
            task_id="root-11", step_idx=0, workspace_dir="/tmp",
            runtime=FakeRuntime(current_task=parent),
            unsafe_mode=True,
        )
        result = await AgentAssembleTeam(
            goal="перевір реліз",
            mode="explicit",
            roles=["senior_test", "pen_tester"],
            timeout_s=30,
        ).execute(ctx)

        assert result.output["total_members"] == 2
        kinds = [m["message_type"] for m in messages]
        assert kinds.count("delegate") == 2
        assert kinds.count("report") == 2
        receivers = {m["receiver"] for m in messages if m["message_type"] == "delegate"}
        assert receivers == {"senior_test", "pen_tester"}
        senders = {m["sender"] for m in messages if m["message_type"] == "report"}
        assert senders == {"senior_test", "pen_tester"}


class TestBroadcastReaches:
    @pytest.mark.asyncio
    async def test_team_message_from_a_subagent_reaches_background_channel(
        self, monkeypatch,
    ):
        """A team lead re-delegating runs on the background track."""
        from agent.kernel.runtime import (
            _BACKGROUND_OBSERVER_EVENTS, AgentRuntime, current_track,
        )

        assert "team.message" in _BACKGROUND_OBSERVER_EVENTS

        captured: list[tuple[str, str, dict]] = []

        class FakeHub:
            async def broadcast(self, channel, type_, payload):
                captured.append((channel, type_, payload))

        import api.websocket_hub as _hubmod
        monkeypatch.setattr(_hubmod, "hub", FakeHub())

        async def _no_emotion(*_a, **_k):
            return None

        import agent.cognition.emotion as _emo
        monkeypatch.setattr(_emo, "update_emotion_on_event", _no_emotion)

        rt = AgentRuntime()
        token = current_track.set("background")
        try:
            await rt._broadcast("team.message", {
                "id": "m1", "task_id": "child-1", "parent_task_id": "lead-1",
                "sender": "team_lead_engineering", "receiver": "senior_backend",
                "message": "візьми парсер", "message_type": "delegate",
            })
        finally:
            current_track.reset(token)

        assert [(c, t) for c, t, _p in captured] == [
            ("background_events", "team.message"),
        ]
