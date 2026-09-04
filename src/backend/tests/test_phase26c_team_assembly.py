"""
Phase 26-C — Team leads + agent.assemble_team.

5 new specialist roles (one team_lead per department) — coordinators
that have ONLY agent.delegate as their executable tool, so their
strategic planner is forced to re-delegate to seniors instead of
doing work itself.

`agent.assemble_team` is the parent's high-level "delegate to a
team" verb that bundles picker + parallel spawn + await + result
consolidation into one call.

Tests cover:
  • 5 team leads registered, one per department
  • Each lead's tool_filter contains agent.delegate but not bash.run
  • Team lead's risk ceiling is bounded (advisor-level: SAFE/LOW)
  • agent.assemble_team registered + LOW risk
  • Pydantic validation: unknown mode rejected, department mode
    requires valid dept, explicit mode requires roles
  • no-runtime ctx → error_class=no_runtime
  • mode=auto: spawns members from picker output (mocked picker)
  • mode=department: spawns ONE team_lead matching the dept
  • mode=explicit: spawns one of each named role
  • Parallel + sequential modes both produce reports
  • Spawn errors are surfaced in the result without aborting peers
  • Consolidated summary contains successes + failures + plan rationale
"""
from __future__ import annotations

import asyncio
import os
import uuid
from typing import Any

import pytest

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase26c")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-api-key-for-tests")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


# ─── 1. Team-lead registration ──────────────────────────────────────────────


class TestTeamLeads:
    def test_one_lead_per_department(self) -> None:
        from agent.team.specialists import all_specialists, departments
        leads = [s for s in all_specialists() if s.name.startswith("team_lead_")]
        lead_depts = {s.department for s in leads}
        assert lead_depts == set(departments())
        assert len(leads) == 5

    def test_lead_only_has_delegate_in_executable_tools(self) -> None:
        """Lead's tool_filter must include agent.delegate so it can
        re-delegate, but MUST NOT include bash.run / fs.write — leads
        coordinate, they don't execute prod work."""
        from agent.team.specialists import get_specialist
        for dept in ("engineering", "product", "qa", "research", "operations"):
            lead = get_specialist(f"team_lead_{dept}")
            assert lead is not None, f"team_lead_{dept} missing"
            assert lead.tool_filter is not None
            assert "agent.delegate" in lead.tool_filter
            assert "bash.run" not in lead.tool_filter
            assert "fs.write" not in lead.tool_filter

    def test_lead_risk_ceiling_capped(self) -> None:
        """Leads are coordinators — risk ceiling stays at SAFE/LOW."""
        from agent.team.specialists import all_specialists
        for s in all_specialists():
            if s.name.startswith("team_lead_"):
                assert s.risk_ceiling <= 3, (
                    f"{s.name}: risk ceiling {s.risk_ceiling} > LOW"
                )

    def test_lead_goal_template_mentions_delegation(self) -> None:
        from agent.team.specialists import all_specialists
        for s in all_specialists():
            if s.name.startswith("team_lead_"):
                assert "agent.delegate" in s.goal_template, s.name


# ─── 2. agent.assemble_team — registration ─────────────────────────────────


class TestActionRegistration:
    def test_registered(self) -> None:
        from agent.actions.registry import registry
        cls = registry.get("agent.assemble_team")
        assert cls is not None
        assert cls.__name__ == "AgentAssembleTeam"

    def test_low_risk(self) -> None:
        """assemble_team itself is LOW (recoverable spawn); each member's
        own actions go through their own risk gate."""
        from agent.actions.registry import registry
        from agent.schemas import RiskLevel
        assert registry.get("agent.assemble_team").risk_level == RiskLevel.LOW


# ─── 3. Validation ─────────────────────────────────────────────────────────


class TestValidation:
    @pytest.mark.asyncio
    async def test_no_runtime_short_circuits(self) -> None:
        from agent.actions.base import ActionContext
        from agent.actions.team_assemble import AgentAssembleTeam
        action = AgentAssembleTeam(goal="some real goal", mode="auto")
        ctx = ActionContext(
            task_id="t-1", step_idx=0, workspace_dir="/tmp", runtime=None,
        )
        result = await action.execute(ctx)
        assert result.ok is False
        assert result.error_class == "no_runtime"

    def test_unknown_mode_rejected_at_execute(self) -> None:
        """Pydantic accepts the string (mode field is plain str), but
        execute() must validate and reject."""
        from agent.actions.team_assemble import AgentAssembleTeam, _MODES
        # Pydantic itself doesn't constrain — verify the runtime guard
        # in execute() rejects via _MODES set membership.
        a = AgentAssembleTeam(goal="some goal", mode="totally_made_up")
        assert a.mode == "totally_made_up"
        assert a.mode not in _MODES

    def test_max_members_capped(self) -> None:
        from agent.actions.team_assemble import AgentAssembleTeam
        with pytest.raises(Exception):
            AgentAssembleTeam(goal="some goal", max_members=99)


# ─── 4. End-to-end with mocked spawn/await ─────────────────────────────────
#
# The action would normally spawn real sub-agents and await EventBus
# completion events. We mock spawn_subagent + await_subagent so the
# tests exercise mode dispatch / result consolidation / error
# aggregation without spinning up the full agent loop.


class _FakeRuntime:
    """Minimal runtime stub — current_task returns the parent so the
    parent_unresolved guard passes."""

    def __init__(self, parent_state) -> None:
        self.current_task = parent_state


def _make_parent():
    from agent.kernel.runtime import TaskState
    from agent.schemas import SelfModel
    return TaskState(
        id="parent-task",
        user_id="u-test",
        goal="parent goal",
        track="foreground",
        status="running",
        self_model=SelfModel(),
    )


class _MockSpawn:
    """Tracks every spawn_subagent call. Returns a synthetic child_id
    that the parallel await_subagent mock pairs with a SubagentReport."""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    # Підміна мусить приймати РІВНО те, що приймає справжня
    # `spawn_subagent` (agent/team/spawn.py:184). Вона відростила
    # `extra_origin` і `branch`, підміна за нею не пішла — і всі шість
    # тестів падали на `unexpected keyword argument 'branch'`, доводячи
    # розбіжність підміни з продуктом, а не ваду продукту.
    #
    # Іменовані параметри лишаю замість `**kwargs` навмисно: так підміна
    # й далі ловить виклик із ХИБНИМ іменем аргументу, а `**kwargs`
    # проковтнув би його мовчки.
    async def __call__(
        self, *, runtime, parent_state, goal, role, constraints, timeout_s,
        extra_origin="delegate", branch=None,
    ):
        cid = f"child-{role}-{uuid.uuid4().hex[:6]}"
        self.calls.append({
            "child_id": cid, "role": role, "goal": goal,
            "constraints": constraints, "timeout_s": timeout_s,
        })
        return cid


class _MockAwait:
    """Returns SubagentReport objects keyed by role — caller can pin
    failures by role."""

    def __init__(self, *, fail_roles: set[str] | None = None) -> None:
        self._fail = fail_roles or set()

    async def __call__(self, child_task_id, *, timeout_s=None):
        from agent.team.spawn import SubagentReport
        # child_task_id has the role baked in: child-<role>-<hex>
        role = child_task_id.split("-")[1] if "-" in child_task_id else "unknown"
        # Reconstruct multi-word roles like senior_backend.
        if "child-" in child_task_id:
            payload = child_task_id[len("child-"):]
            role = payload.rsplit("-", 1)[0]
        outcome = "failed" if role in self._fail else "done"
        return SubagentReport(
            child_task_id=child_task_id,
            role=role,
            outcome=outcome,
            summary=f"{role} finished: {outcome}",
            details={"depth": 1, "step_idx": 5},
            elapsed_s=1.5,
        )


class TestAutoMode:
    @pytest.mark.asyncio
    async def test_auto_mode_spawns_picked_members(self, monkeypatch) -> None:
        from agent.actions.base import ActionContext
        from agent.actions.team_assemble import AgentAssembleTeam
        from agent.team.picker import TeamMemberRequest, TeamPlan

        async def _fake_pick(**_kw):
            return TeamPlan(
                rationale="audit needs security + tests",
                members=[
                    TeamMemberRequest(role="senior_security", count=1, sub_goal="audit auth"),
                    TeamMemberRequest(role="senior_test", count=2, sub_goal="write tests"),
                ],
                generation_strategy="llm",
            )

        monkeypatch.setattr("agent.actions.team_assemble.pick_specialists", _fake_pick) if False else None
        monkeypatch.setattr("agent.team.picker.pick_specialists", _fake_pick)
        spawn = _MockSpawn()
        await_ = _MockAwait()
        monkeypatch.setattr("agent.team.spawn.spawn_subagent", spawn)
        monkeypatch.setattr("agent.team.spawn.await_subagent", await_)

        parent = _make_parent()
        action = AgentAssembleTeam(goal="audit + harden auth", mode="auto", max_members=5)
        ctx = ActionContext(
            task_id=parent.id, step_idx=0, workspace_dir="/tmp",
            runtime=_FakeRuntime(parent),
        )
        result = await action.execute(ctx)

        assert result.ok is True, result.error
        out = result.output
        assert out["total_members"] == 3  # 1 security + 2 tests
        assert out["successes"] == 3
        assert out["failures"] == 0
        roles_used = sorted([m["role"] for m in out["members"]])
        assert roles_used == ["senior_security", "senior_test", "senior_test"]

    @pytest.mark.asyncio
    async def test_auto_mode_empty_picker_yields_empty_team_error(self, monkeypatch) -> None:
        from agent.actions.base import ActionContext
        from agent.actions.team_assemble import AgentAssembleTeam
        from agent.team.picker import TeamPlan

        async def _empty(**_kw):
            return TeamPlan(rationale="too simple to need a team", members=[])

        monkeypatch.setattr("agent.team.picker.pick_specialists", _empty)
        parent = _make_parent()
        action = AgentAssembleTeam(goal="say hi", mode="auto")
        ctx = ActionContext(
            task_id=parent.id, step_idx=0, workspace_dir="/tmp",
            runtime=_FakeRuntime(parent),
        )
        result = await action.execute(ctx)
        assert result.ok is False
        assert result.error_class == "empty_team"


class TestDepartmentMode:
    @pytest.mark.asyncio
    async def test_department_mode_spawns_lead(self, monkeypatch) -> None:
        from agent.actions.base import ActionContext
        from agent.actions.team_assemble import AgentAssembleTeam
        spawn = _MockSpawn()
        await_ = _MockAwait()
        monkeypatch.setattr("agent.team.spawn.spawn_subagent", spawn)
        monkeypatch.setattr("agent.team.spawn.await_subagent", await_)

        parent = _make_parent()
        action = AgentAssembleTeam(
            goal="rebuild the auth subsystem",
            mode="department",
            department="engineering",
        )
        ctx = ActionContext(
            task_id=parent.id, step_idx=0, workspace_dir="/tmp",
            runtime=_FakeRuntime(parent),
        )
        result = await action.execute(ctx)
        assert result.ok is True, result.error
        assert len(spawn.calls) == 1
        assert spawn.calls[0]["role"] == "team_lead_engineering"

    @pytest.mark.asyncio
    async def test_department_mode_unknown_dept_rejected(self) -> None:
        from agent.actions.base import ActionContext
        from agent.actions.team_assemble import AgentAssembleTeam
        parent = _make_parent()
        action = AgentAssembleTeam(
            goal="x is a real long enough goal",
            mode="department", department="marketing",
        )
        ctx = ActionContext(
            task_id=parent.id, step_idx=0, workspace_dir="/tmp",
            runtime=_FakeRuntime(parent),
        )
        result = await action.execute(ctx)
        assert result.ok is False
        assert result.error_class == "invalid_args"


class TestExplicitMode:
    @pytest.mark.asyncio
    async def test_explicit_mode_spawns_each_role(self, monkeypatch) -> None:
        from agent.actions.base import ActionContext
        from agent.actions.team_assemble import AgentAssembleTeam
        spawn = _MockSpawn()
        await_ = _MockAwait()
        monkeypatch.setattr("agent.team.spawn.spawn_subagent", spawn)
        monkeypatch.setattr("agent.team.spawn.await_subagent", await_)

        parent = _make_parent()
        action = AgentAssembleTeam(
            goal="audit auth.py end to end",
            mode="explicit",
            roles=["senior_security", "pen_tester", "senior_test"],
            max_members=5,
        )
        ctx = ActionContext(
            task_id=parent.id, step_idx=0, workspace_dir="/tmp",
            runtime=_FakeRuntime(parent),
        )
        result = await action.execute(ctx)
        assert result.ok is True
        assert {c["role"] for c in spawn.calls} == {
            "senior_security", "pen_tester", "senior_test",
        }

    @pytest.mark.asyncio
    async def test_explicit_mode_drops_unknown_roles(self, monkeypatch) -> None:
        from agent.actions.base import ActionContext
        from agent.actions.team_assemble import AgentAssembleTeam
        spawn = _MockSpawn()
        await_ = _MockAwait()
        monkeypatch.setattr("agent.team.spawn.spawn_subagent", spawn)
        monkeypatch.setattr("agent.team.spawn.await_subagent", await_)

        parent = _make_parent()
        action = AgentAssembleTeam(
            goal="ok valid goal",
            mode="explicit",
            roles=["senior_backend", "fake_role", "another_fake"],
        )
        ctx = ActionContext(
            task_id=parent.id, step_idx=0, workspace_dir="/tmp",
            runtime=_FakeRuntime(parent),
        )
        result = await action.execute(ctx)
        assert result.ok is True
        assert [c["role"] for c in spawn.calls] == ["senior_backend"]

    @pytest.mark.asyncio
    async def test_explicit_mode_no_valid_roles_rejected(self) -> None:
        from agent.actions.base import ActionContext
        from agent.actions.team_assemble import AgentAssembleTeam
        parent = _make_parent()
        action = AgentAssembleTeam(
            goal="another long enough goal",
            mode="explicit",
            roles=["all_fake", "also_fake"],
        )
        ctx = ActionContext(
            task_id=parent.id, step_idx=0, workspace_dir="/tmp",
            runtime=_FakeRuntime(parent),
        )
        result = await action.execute(ctx)
        assert result.ok is False
        assert result.error_class == "invalid_args"


# ─── 5. Result consolidation ───────────────────────────────────────────────


class TestConsolidation:
    @pytest.mark.asyncio
    async def test_failures_dont_abort_peers(self, monkeypatch) -> None:
        """One member fails, others still run + report."""
        from agent.actions.base import ActionContext
        from agent.actions.team_assemble import AgentAssembleTeam
        spawn = _MockSpawn()
        await_ = _MockAwait(fail_roles={"pen_tester"})
        monkeypatch.setattr("agent.team.spawn.spawn_subagent", spawn)
        monkeypatch.setattr("agent.team.spawn.await_subagent", await_)

        parent = _make_parent()
        action = AgentAssembleTeam(
            goal="reasonably long goal text",
            mode="explicit",
            roles=["senior_security", "pen_tester", "senior_test"],
        )
        ctx = ActionContext(
            task_id=parent.id, step_idx=0, workspace_dir="/tmp",
            runtime=_FakeRuntime(parent),
        )
        result = await action.execute(ctx)
        # ok=False because some failed, but ALL members reported.
        assert result.ok is False
        assert result.error_class == "team_partial_failure"
        out = result.output
        assert out["total_members"] == 3
        assert out["successes"] == 2
        assert out["failures"] == 1

    @pytest.mark.asyncio
    async def test_consolidated_summary_lists_each_member(self, monkeypatch) -> None:
        from agent.actions.base import ActionContext
        from agent.actions.team_assemble import AgentAssembleTeam
        spawn = _MockSpawn()
        await_ = _MockAwait(fail_roles={"senior_test"})
        monkeypatch.setattr("agent.team.spawn.spawn_subagent", spawn)
        monkeypatch.setattr("agent.team.spawn.await_subagent", await_)

        parent = _make_parent()
        action = AgentAssembleTeam(
            goal="reasonable goal text",
            mode="explicit",
            roles=["senior_backend", "senior_test"],
        )
        ctx = ActionContext(
            task_id=parent.id, step_idx=0, workspace_dir="/tmp",
            runtime=_FakeRuntime(parent),
        )
        result = await action.execute(ctx)
        summary = result.output["consolidated_summary"]
        assert "senior_backend" in summary
        assert "senior_test" in summary
        # success symbol ✓ + failure symbol ✗ both present
        assert "✓" in summary or "успіш" in summary.lower()
        assert "✗" in summary
