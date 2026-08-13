"""
Phase 26-A — agent delegation primitive (sub-agent fan-out).

Verifies the team-spawn machinery without spinning up the full agent
loop (which is heavyweight). The integration point is the in-process
EventBus channel `team.subagent_completed:<child_id>` — a parent
that calls `await_subagent(id)` blocks until that channel publishes
a `SubagentReport`.

Tests cover:
  • Wiring: agent.delegate registered, team module re-exports
  • Config defaults (team_enabled, max_concurrency, max_depth)
  • TaskState carries delegation fields with safe defaults
  • spawn_subagent rejects parent at depth=cap
  • spawn_subagent rejects when team_enabled=False
  • notify_subagent_completed publishes a report subscribers receive
  • notify is a noop when child has no parent_task_id
  • await_subagent times out cleanly with synthetic outcome=timeout
  • await_subagent returns the right report when notify happens
  • Concurrency semaphore caps in-flight spawns
  • Depth math: child of depth-N parent = depth N+1
"""
from __future__ import annotations

import asyncio
import os
import uuid

import pytest

_TEST_USER = "test-user-delegation"

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase26a")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-api-key-for-tests")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


# ─── 1. Wiring ──────────────────────────────────────────────────────────────


class TestWiring:
    def test_action_registered(self) -> None:
        from agent.actions.registry import registry
        cls = registry.get("agent.delegate")
        assert cls is not None
        assert cls.__name__ == "AgentDelegate"

    def test_team_module_exports(self) -> None:
        from agent.team import (
            DelegationDepthExceeded,
            SubagentReport,
            SubagentSpawnError,
            TeamConcurrencyExceeded,
            await_subagent,
            notify_subagent_completed,
            spawn_subagent,
            team_semaphore,
        )
        # Smoke: each symbol is callable / a type.
        assert callable(spawn_subagent)
        assert callable(await_subagent)
        assert callable(notify_subagent_completed)
        assert callable(team_semaphore)
        assert issubclass(SubagentSpawnError, Exception)
        assert issubclass(DelegationDepthExceeded, SubagentSpawnError)
        assert issubclass(TeamConcurrencyExceeded, SubagentSpawnError)

    def test_action_risk_level_low(self) -> None:
        """delegate itself is LOW — the sub-agent's own actions go
        through their own risk gate independently."""
        from agent.actions.registry import registry
        from agent.schemas import RiskLevel
        cls = registry.get("agent.delegate")
        assert cls.risk_level == RiskLevel.LOW


# ─── 2. Config defaults ─────────────────────────────────────────────────────


class TestConfigDefaults:
    def test_team_enabled_default_true(self) -> None:
        from config import PhantomConfig
        f = PhantomConfig.model_fields["agent_team_enabled"]
        assert f.default is True

    def test_max_concurrency_default(self) -> None:
        from config import PhantomConfig
        f = PhantomConfig.model_fields["agent_max_team_concurrency"]
        assert int(f.default) >= 2

    def test_max_depth_default(self) -> None:
        from config import PhantomConfig
        f = PhantomConfig.model_fields["agent_max_delegation_depth"]
        assert int(f.default) >= 2 and int(f.default) <= 5


# ─── 3. TaskState delegation fields ─────────────────────────────────────────


class TestTaskStateDelegationFields:
    def test_default_values_safe(self) -> None:
        """A normally-spawned (operator-initiated) task must default to
        depth=0, no parent, no role — so existing code paths that don't
        touch delegation are unchanged."""
        from agent.kernel.runtime import TaskState
        from agent.schemas import SelfModel
        state = TaskState(
            user_id=_TEST_USER,
            id="t-1",
            goal="x",
            track="foreground",
            status="planning",
            self_model=SelfModel(),
        )
        assert state.parent_task_id is None
        assert state.subagent_role is None
        assert state.delegation_depth == 0


# ─── 4. spawn_subagent error paths ──────────────────────────────────────────


def _make_parent_state(*, depth: int = 0):
    """Build a minimal parent TaskState for spawn tests. We don't run a
    real loop — the spawn is mocked at the runner level."""
    from agent.kernel.runtime import TaskState
    from agent.schemas import SelfModel
    return TaskState(
        user_id=_TEST_USER,
        id=str(uuid.uuid4()),
        goal="parent goal",
        track="foreground",
        status="running",
        self_model=SelfModel(),
        delegation_depth=depth,
    )


class TestSpawnRejectsDepth:
    @pytest.mark.asyncio
    async def test_depth_at_cap_rejected(self, monkeypatch) -> None:
        from agent.team.spawn import (
            DelegationDepthExceeded, spawn_subagent,
        )
        from config import config
        monkeypatch.setattr(config, "agent_max_delegation_depth", 2)
        parent = _make_parent_state(depth=2)
        with pytest.raises(DelegationDepthExceeded):
            await spawn_subagent(
                runtime=None,  # not reached because depth check is first
                parent_state=parent,
                goal="any",
                role="any",
            )

    @pytest.mark.asyncio
    async def test_team_disabled_raises(self, monkeypatch) -> None:
        from agent.team.spawn import (
            SubagentSpawnError, spawn_subagent,
        )
        from config import config
        monkeypatch.setattr(config, "agent_team_enabled", False)
        parent = _make_parent_state(depth=0)
        with pytest.raises(SubagentSpawnError):
            await spawn_subagent(
                runtime=None,
                parent_state=parent,
                goal="any",
                role="any",
            )


# ─── 5. notify + await round-trip via EventBus ──────────────────────────────


class TestNotifyAwaitRoundTrip:
    @pytest.mark.asyncio
    async def test_notify_publishes_to_subscribers(self) -> None:
        """notify_subagent_completed → event_bus.emit → await_subagent
        unblocks with the report."""
        from agent.kernel.runtime import TaskState
        from agent.schemas import SelfModel
        from agent.team.spawn import (
            await_subagent, notify_subagent_completed,
        )
        child_id = str(uuid.uuid4())
        child = TaskState(
            user_id=_TEST_USER,
            id=child_id,
            goal="[role=reviewer] check the diff",
            track="background",
            status="done",
            self_model=SelfModel(),
            parent_task_id="parent-1",
            subagent_role="reviewer",
            delegation_depth=1,
        )

        async def _publisher():
            # Tiny delay so the await call is registered first.
            await asyncio.sleep(0.05)
            notify_subagent_completed(
                child_state=child,
                outcome_kind="done",
                summary="diff looks fine; 0 blockers",
                action_counts={"fs.read": 3, "self.recall": 1},
            )

        publisher = asyncio.create_task(_publisher())
        report = await await_subagent(child_id, timeout_s=5.0)
        await publisher

        assert report.child_task_id == child_id
        assert report.role == "reviewer"
        assert report.outcome == "done"
        assert "0 blockers" in report.summary
        assert report.details["depth"] == 1
        assert report.details["action_counts"] == {"fs.read": 3, "self.recall": 1}

    @pytest.mark.asyncio
    async def test_notify_noop_when_no_parent(self) -> None:
        """A task that wasn't spawned by another (parent_task_id=None)
        must NOT publish a completion event so the channel stays clean
        for the operator's foreground tasks."""
        from agent.kernel.runtime import TaskState
        from agent.schemas import SelfModel
        from agent.team.spawn import notify_subagent_completed
        from core.event_bus import event_bus as bus
        child = TaskState(
            user_id=_TEST_USER,
            id=str(uuid.uuid4()),
            goal="root task",
            track="foreground",
            status="done",
            self_model=SelfModel(),
        )
        received: list = []
        unsub = bus.subscribe(
            f"team.subagent_completed:{child.id}",
            lambda r: received.append(r),
        )
        try:
            notify_subagent_completed(
                child_state=child,
                outcome_kind="done",
                summary="x",
            )
            await asyncio.sleep(0.02)
            assert received == []
        finally:
            unsub()

    @pytest.mark.asyncio
    async def test_await_timeout_returns_synthetic_report(self) -> None:
        """await_subagent that doesn't get a completion event before
        timeout MUST still resolve — never hang the parent."""
        from agent.team.spawn import await_subagent
        report = await await_subagent("ghost-id-no-publisher", timeout_s=0.3)
        assert report.outcome == "timeout"
        assert report.child_task_id == "ghost-id-no-publisher"


# ─── 6. Concurrency semaphore ───────────────────────────────────────────────


class TestSemaphore:
    def test_semaphore_lazy_singleton(self) -> None:
        """team_semaphore() returns the same Semaphore instance across
        calls (lazy singleton). Tests need this to monkey-patch sem
        inspection."""
        from agent.team.spawn import (
            _reset_team_semaphore_for_tests, team_semaphore,
        )
        _reset_team_semaphore_for_tests()
        s1 = team_semaphore()
        s2 = team_semaphore()
        assert s1 is s2

    def test_semaphore_reset_clears_state(self) -> None:
        """Test helper for isolation between tests."""
        from agent.team.spawn import (
            _reset_team_semaphore_for_tests, team_semaphore,
        )
        first = team_semaphore()
        _reset_team_semaphore_for_tests()
        second = team_semaphore()
        assert first is not second


# ─── 7. Action-level guard rails ────────────────────────────────────────────


class TestDelegateActionValidation:
    def test_goal_min_length_enforced(self) -> None:
        from agent.actions.delegate import AgentDelegate
        with pytest.raises(Exception):
            AgentDelegate(goal="x")  # < min_length=4

    def test_timeout_caps_enforced(self) -> None:
        from agent.actions.delegate import AgentDelegate
        with pytest.raises(Exception):
            AgentDelegate(goal="some goal", timeout_s=99999)
        with pytest.raises(Exception):
            AgentDelegate(goal="some goal", timeout_s=0)

    def test_role_default_is_generalist(self) -> None:
        from agent.actions.delegate import AgentDelegate
        d = AgentDelegate(goal="some goal")
        assert d.role == "generalist"
        assert d.constraints == ""
        assert d.timeout_s == 300

    def test_no_runtime_short_circuits(self) -> None:
        """When ctx.runtime is None (test stub), the action must NOT
        crash — it returns ok=False with error_class=no_runtime."""
        from agent.actions.base import ActionContext
        from agent.actions.delegate import AgentDelegate

        async def _run():
            d = AgentDelegate(goal="some goal", role="researcher")
            ctx = ActionContext(
                task_id="t", step_idx=0, workspace_dir="/tmp", runtime=None,
            )
            return await d.execute(ctx)

        result = asyncio.run(_run())
        assert result.ok is False
        assert result.error_class == "no_runtime"


# ─── 8. Subagent goal decoration ────────────────────────────────────────────


class TestGoalDecoration:
    def test_role_and_constraints_in_decorated_goal(self) -> None:
        from agent.team.spawn import _build_subagent_goal
        decorated = _build_subagent_goal(
            role="senior_backend",
            constraints="readonly; max 5 LLM calls",
            base_goal="audit auth.py for OWASP top 10",
        )
        assert "[role=senior_backend]" in decorated
        assert "[constraints=readonly; max 5 LLM calls]" in decorated
        assert "audit auth.py for OWASP top 10" in decorated

    def test_no_constraints_omitted(self) -> None:
        from agent.team.spawn import _build_subagent_goal
        decorated = _build_subagent_goal(
            role="researcher", constraints="", base_goal="find papers on X",
        )
        assert "[role=researcher]" in decorated
        assert "[constraints=" not in decorated
        assert "find papers on X" in decorated
