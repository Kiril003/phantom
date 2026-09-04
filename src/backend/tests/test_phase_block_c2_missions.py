"""
Block C-2 — Mission planner + phase planner + runtime + loop + REST tests.

Covers:
  Planner:
    test_plan_mission_returns_phases_with_artifacts
    test_plan_mission_caps_phases_at_twelve
    test_plan_phase_calls_strategic_plan_with_phase_context

  Runtime:
    test_start_mission_creates_mission_and_phases_in_db
    test_start_mission_rejects_when_foreground_busy
    test_start_mission_writes_initial_ledger_header

  Loop:
    test_mission_loop_advances_phases_in_order
    test_mission_loop_marks_mission_done_when_all_phases_complete
    test_mission_loop_marks_mission_failed_on_phase_failure
    test_legacy_task_path_unchanged

  REST:
    test_rest_post_mission_returns_ids
    test_rest_get_missions_isolates_per_user

LLM is mocked at the llm_json / ai_router.generate boundary so real planner
code runs while no network calls are made.
"""
from __future__ import annotations

import asyncio
import json
import os
import tempfile
import types
import uuid
from datetime import datetime, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

# Bootstrap env before any PHANTOM import.
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-block-c2")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-api-key-block-c2")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


# ── DB fixture ─────────────────────────────────────────────────────────────────


@pytest_asyncio.fixture
async def isolated_db(monkeypatch):
    """In-memory SQLite with all PHANTOM tables, session factory patched."""
    import db.database as _dbm
    import db.models as _dm  # noqa: F401
    import importlib

    if not _dbm.Base.metadata.tables:
        importlib.reload(_dm)

    fd, tmp_file = tempfile.mkstemp(suffix=".db", prefix="phantom_c2_")
    os.close(fd)
    url = f"sqlite+aiosqlite:///{tmp_file}"
    engine = create_async_engine(
        url, echo=False, connect_args={"check_same_thread": False}
    )
    async with engine.begin() as conn:
        await conn.run_sync(_dbm.Base.metadata.create_all)

    factory = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(_dbm, "engine", engine)
    monkeypatch.setattr(_dbm, "AsyncSessionLocal", factory)

    yield factory

    await engine.dispose()
    try:
        os.unlink(tmp_file)
    except OSError:
        pass


def _uid() -> str:
    return str(uuid.uuid4())


# ── LLM mock helpers ───────────────────────────────────────────────────────────


def _make_mission_plan_json(n_phases: int = 4) -> dict:
    """Return a valid MissionPlan-shaped dict the mock LLM will return."""
    phases = []
    for i in range(n_phases):
        phases.append({
            "description": f"Phase {i + 1}",
            "rationale": f"Rationale for phase {i + 1}",
            "success_criteria": f"Criteria {i + 1}",
            "expected_duration_h": float(i + 1),
            "artifacts": [
                {
                    "path": f"{{workspace}}/phase_{i:02d}/output.txt",
                    "kind": "file",
                    "produced": False,
                }
            ],
        })
    return {
        "success_criteria": "All phases complete and output verified.",
        "phases": phases,
        "risk_assessment": "Low risk overall.",
    }


def _make_strategic_plan_json(n_subgoals: int = 2) -> dict:
    """Return a valid StrategicPlan-shaped dict the mock LLM will return."""
    sgs = []
    for i in range(n_subgoals):
        sgs.append({
            "description": f"Sub-goal {i + 1}",
            "rationale": f"Because we need sub-goal {i + 1}",
            "expected_actions": 2,
            "acceptance_criteria": f"Sub-goal {i + 1} done",
        })
    return {
        "sub_goals": sgs,
        "estimated_total_actions": n_subgoals * 2,
        "risk_assessment": "Low.",
    }


# ══════════════════════════════════════════════════════════════════════════════
# 1. Mission planner
# ══════════════════════════════════════════════════════════════════════════════


class TestPlanMission:

    async def test_plan_mission_returns_phases_with_artifacts(self):
        """plan_mission must return a MissionPlan where every phase has artifacts."""
        from agent.cognition.planner.mission import plan_mission
        from agent.schemas import MissionBrief, SelfModel

        brief = MissionBrief(brief="Build a procedural city in Blender.")
        self_model = SelfModel()

        plan_data = _make_mission_plan_json(n_phases=5)

        with patch("agent.cognition.planner.mission.llm_json", new=AsyncMock(return_value=plan_data)):
            result = await plan_mission(
                user_id=_uid(),
                brief=brief,
                self_model=self_model,
                task_id="test-task-1",
            )

        assert result.success_criteria == "All phases complete and output verified."
        assert len(result.phases) == 5
        for phase_spec in result.phases:
            assert len(phase_spec.artifacts) >= 1, (
                f"Phase '{phase_spec.description}' has no artifacts"
            )
            for artifact in phase_spec.artifacts:
                assert "path" in artifact
                assert "kind" in artifact
                assert artifact.get("produced") is False

    async def test_plan_mission_caps_phases_at_twelve(self):
        """plan_mission must cap phase count at 12 and warn (not raise)."""
        from agent.cognition.planner.mission import plan_mission, _MAX_PHASES
        from agent.schemas import MissionBrief, SelfModel

        brief = MissionBrief(brief="Mega-mission with too many phases.")
        self_model = SelfModel()

        # LLM returns 20 phases — planner must cap at 12.
        plan_data = _make_mission_plan_json(n_phases=20)

        with patch("agent.cognition.planner.mission.llm_json", new=AsyncMock(return_value=plan_data)):
            result = await plan_mission(
                user_id=_uid(),
                brief=brief,
                self_model=self_model,
            )

        assert len(result.phases) == _MAX_PHASES
        assert len(result.phases) <= 12

    async def test_plan_mission_raises_on_missing_success_criteria(self):
        """plan_mission must raise RuntimeError when success_criteria is absent."""
        from agent.cognition.planner.mission import plan_mission
        from agent.schemas import MissionBrief, SelfModel

        brief = MissionBrief(brief="Mission without criteria.")
        self_model = SelfModel()

        bad_data = {"success_criteria": "", "phases": [
            {"description": "phase", "rationale": "r", "artifacts": [
                {"path": "{workspace}/f.txt", "kind": "file", "produced": False}
            ]}
        ]}

        with patch("agent.cognition.planner.mission.llm_json", new=AsyncMock(return_value=bad_data)):
            with pytest.raises(RuntimeError, match="success_criteria"):
                await plan_mission(
                    user_id=_uid(),
                    brief=brief,
                    self_model=self_model,
                )

    async def test_plan_mission_synthesizes_artifact_when_llm_omits_it(self):
        """plan_mission must synthesize a placeholder artifact for phases with empty list."""
        from agent.cognition.planner.mission import plan_mission
        from agent.schemas import MissionBrief, SelfModel

        brief = MissionBrief(brief="Mission where LLM forgets artifacts.")
        self_model = SelfModel()

        plan_data = {
            "success_criteria": "Done.",
            "phases": [
                {
                    "description": "no artifacts phase",
                    "rationale": "r",
                    "success_criteria": "done",
                    "expected_duration_h": 1.0,
                    "artifacts": [],  # Empty — planner must synthesize one.
                }
            ],
            "risk_assessment": "low",
        }

        with patch("agent.cognition.planner.mission.llm_json", new=AsyncMock(return_value=plan_data)):
            result = await plan_mission(
                user_id=_uid(),
                brief=brief,
                self_model=self_model,
            )

        assert len(result.phases) == 1
        assert len(result.phases[0].artifacts) == 1
        assert "{workspace}" in result.phases[0].artifacts[0]["path"]


# ══════════════════════════════════════════════════════════════════════════════
# 2. Phase planner
# ══════════════════════════════════════════════════════════════════════════════


class TestPlanPhase:

    async def test_plan_phase_calls_strategic_plan_with_phase_context(self):
        """plan_phase must call strategic.plan with the phase description and mission context."""
        from agent.cognition.planner.phase import plan_phase
        from agent.schemas import SelfModel, StrategicPlan, SubGoal

        user_id = _uid()
        self_model = SelfModel()

        mission = types.SimpleNamespace(
            id=_uid(),
            brief="Build a city.",
            ledger_path="",
            phases=[object(), object(), object()],  # len=3 → "Phase 2 of 3"
        )
        phase = types.SimpleNamespace(
            id=_uid(),
            idx=1,
            description="Road network generation",
            success_criteria="All roads connected.",
            rationale="Roads connect terrain to buildings.",
        )

        captured_goals: list[str] = []
        captured_revise_notes: list[str] = []

        async def _mock_strategic_plan(
            goal: str,
            self_model,
            memory_seeds_summary: str = "",
            revise_note: str = "",
            task_id=None,
            user_id=None,
        ):
            captured_goals.append(goal)
            captured_revise_notes.append(revise_note)
            return StrategicPlan(
                sub_goals=[SubGoal(
                    description="sg1",
                    rationale="r",
                    expected_actions=2,
                    acceptance_criteria="done",
                )],
                estimated_total_actions=2,
                risk_assessment="low",
            )

        with patch("agent.cognition.planner.phase.strategic.plan", new=_mock_strategic_plan):
            result = await plan_phase(
                user_id=user_id,
                mission=mission,
                phase=phase,
                self_model=self_model,
                task_id="test-task-2",
            )

        assert len(result.sub_goals) == 1
        assert len(captured_goals) == 1
        # The goal string must contain the phase description.
        assert "Road network generation" in captured_goals[0]
        # The revise_note must carry mission context.
        assert captured_revise_notes[0]
        assert "Build a city." in captured_revise_notes[0]


# ══════════════════════════════════════════════════════════════════════════════
# 3. Runtime — start_mission
# ══════════════════════════════════════════════════════════════════════════════


class TestStartMission:

    async def test_start_mission_creates_mission_and_phases_in_db(
        self, isolated_db, tmp_path, monkeypatch
    ):
        """start_mission must create a Mission row + Phase rows in the DB."""
        from agent.missions.store import get_mission, list_phases
        from agent.kernel.runtime import AgentRuntime
        from agent.schemas import MissionBrief, SelfModel, StrategicPlan, SubGoal

        user_id = _uid()
        runtime = AgentRuntime()

        plan_data = _make_mission_plan_json(n_phases=3)

        # Patch plan_mission so no LLM call is made.
        async def _mock_plan_mission(*, user_id, brief, self_model, task_id=None, revise_note=""):
            from agent.schemas import MissionPlan, PhaseSpec
            return MissionPlan(
                success_criteria="City is built.",
                phases=[
                    PhaseSpec(
                        description=p["description"],
                        rationale=p["rationale"],
                        success_criteria=p["success_criteria"],
                        expected_duration_h=p["expected_duration_h"],
                        artifacts=p["artifacts"],
                    )
                    for p in plan_data["phases"]
                ],
                risk_assessment="Low.",
            )

        # Patch the loop so it doesn't actually run.
        async def _mock_loop(r, s, **kwargs):
            pass

        monkeypatch.setattr(
            "agent.cognition.planner.mission.plan_mission",
            _mock_plan_mission,
        )

        with patch("agent.kernel.runtime.AgentRuntime.start_mission") as _m:
            # We need the REAL start_mission — use it directly.
            pass

        # Patch the loop import inside runtime.
        with patch("agent.kernel.loop.run_task_loop", new=AsyncMock(side_effect=_mock_loop)):
            with patch(
                "agent.cognition.planner.mission.plan_mission",
                new=AsyncMock(side_effect=_mock_plan_mission),
            ):
                mission_id, task_id = await runtime.start_mission(
                    user_id=user_id,
                    brief=MissionBrief(brief="Build a city."),
                )

        assert mission_id
        assert task_id

        # Verify DB rows.
        mission = await get_mission(user_id, mission_id)
        assert mission is not None
        assert mission.status == "running"
        assert mission.brief == "Build a city."

        phases = await list_phases(mission_id)
        assert len(phases) == 3
        assert [p.idx for p in phases] == [0, 1, 2]

    async def test_start_mission_rejects_when_foreground_busy(self, isolated_db):
        """start_mission must raise RuntimeError when the foreground slot is active."""
        from agent.kernel.runtime import AgentRuntime, TaskState
        from agent.schemas import MissionBrief, SelfModel

        runtime = AgentRuntime()

        # Inject a fake busy task into the foreground slot.
        fake_state = TaskState(
            id=_uid(),
            user_id=_uid(),
            goal="existing task",
            track="foreground",
            status="running",
            self_model=SelfModel(),
        )
        runtime.foreground_slot = fake_state

        with pytest.raises(RuntimeError, match="foreground_busy"):
            await runtime.start_mission(
                user_id=_uid(),
                brief=MissionBrief(brief="New mission."),
            )

    async def test_start_mission_writes_initial_ledger_header(
        self, isolated_db, tmp_path
    ):
        """start_mission must write a ledger file with the mission header."""
        from agent.kernel.runtime import AgentRuntime
        from agent.schemas import MissionBrief

        user_id = _uid()
        runtime = AgentRuntime()

        async def _mock_plan_mission(*, user_id, brief, self_model, task_id=None, revise_note=""):
            from agent.schemas import MissionPlan, PhaseSpec
            return MissionPlan(
                success_criteria="Done.",
                phases=[
                    PhaseSpec(
                        description="only phase",
                        rationale="r",
                        success_criteria="crit",
                        artifacts=[{"path": "{workspace}/out.txt", "kind": "file", "produced": False}],
                    )
                ],
            )

        with patch("agent.kernel.loop.run_task_loop", new=AsyncMock()):
            with patch(
                "agent.cognition.planner.mission.plan_mission",
                new=AsyncMock(side_effect=_mock_plan_mission),
            ):
                mission_id, task_id = await runtime.start_mission(
                    user_id=user_id,
                    brief=MissionBrief(brief="Ledger header test."),
                )

        # The ledger directory + file must have been created.
        from agent.missions.store import get_mission
        mission = await get_mission(user_id, mission_id)
        assert mission is not None
        assert mission.ledger_path
        assert os.path.isfile(mission.ledger_path), (
            f"Ledger file not found at {mission.ledger_path}"
        )
        content = open(mission.ledger_path, encoding="utf-8").read()
        assert "# Mission:" in content
        assert "Ledger header test." in content


# ══════════════════════════════════════════════════════════════════════════════
# 4. Loop — mission path
# ══════════════════════════════════════════════════════════════════════════════


class TestMissionLoop:
    """Tests for run_mission_loop and the _run_task_loop_impl guard."""

    def _make_state(
        self,
        runtime,
        user_id: str,
        mission_id: str,
        goal: str = "test mission",
    ):
        from agent.kernel.runtime import TaskState
        from agent.schemas import SelfModel

        state = TaskState(
            id=_uid(),
            user_id=user_id,
            goal=goal,
            track="foreground",
            status="planning",
            self_model=SelfModel(),
            mission_id=mission_id,
        )
        runtime.foreground_slot = state
        return state

    async def test_mission_loop_advances_phases_in_order(
        self, isolated_db, monkeypatch
    ):
        """run_mission_loop must execute phases in idx order."""
        from agent.missions.store import (
            create_mission, create_phase, get_phase, list_phases,
        )
        from agent.schemas import MissionBrief, PhaseSpec
        from agent.kernel.loop import run_mission_loop
        from agent.kernel.runtime import AgentRuntime

        user_id = _uid()
        runtime = AgentRuntime()

        # Create a 3-phase mission.
        mission = await create_mission(user_id, MissionBrief(brief="Three-phase test."))
        for i in range(3):
            await create_phase(
                mission.id,
                PhaseSpec(
                    description=f"phase-{i}",
                    rationale="r",
                    success_criteria="done",
                    artifacts=[{"path": f"{{workspace}}/out{i}.txt", "kind": "file", "produced": False}],
                ),
                idx=i,
            )

        state = self._make_state(runtime, user_id, mission.id)

        executed_phases: list[str] = []

        async def _mock_plan_phase(*, user_id, mission, phase, self_model, revise_note="", task_id=None):
            from agent.schemas import StrategicPlan, SubGoal
            executed_phases.append(phase.description)
            return StrategicPlan(
                sub_goals=[SubGoal(
                    description="sub",
                    rationale="r",
                    expected_actions=1,
                    acceptance_criteria="done",
                    status="done",  # Mark done immediately.
                )],
                estimated_total_actions=1,
            )

        async def _mock_run_phase_subgoals(runtime_, state_):
            # Simulate successful sub-goal completion.
            state_.status = "done"

        async def _mock_finalize(state_, outcome, summary, error=None):
            state_.status = outcome

        with patch("agent.kernel.loop.plan_phase", new=AsyncMock(side_effect=_mock_plan_phase)):
            with patch("agent.kernel.loop._run_phase_subgoals", new=AsyncMock(side_effect=_mock_run_phase_subgoals)):
                with patch.object(runtime, "finalize_task", new=AsyncMock(side_effect=_mock_finalize)):
                    with patch.object(runtime, "_broadcast", new=AsyncMock()):
                        with patch("agent.kernel.loop.update_task_status", new=AsyncMock()):
                            await run_mission_loop(runtime, state)

        assert executed_phases == ["phase-0", "phase-1", "phase-2"]

    async def test_mission_loop_marks_mission_done_when_all_phases_complete(
        self, isolated_db
    ):
        """run_mission_loop must mark the Mission 'done' after all phases succeed."""
        from agent.missions.store import (
            create_mission, create_phase, get_mission,
        )
        from agent.schemas import MissionBrief, PhaseSpec
        from agent.kernel.loop import run_mission_loop
        from agent.kernel.runtime import AgentRuntime

        user_id = _uid()
        runtime = AgentRuntime()

        mission = await create_mission(user_id, MissionBrief(brief="Done test."))
        await create_phase(
            mission.id,
            PhaseSpec(
                description="only phase",
                rationale="r",
                success_criteria="done",
                artifacts=[{"path": "{workspace}/out.txt", "kind": "file", "produced": False}],
            ),
            idx=0,
        )

        state = self._make_state(runtime, user_id, mission.id)

        async def _mock_plan_phase(**kwargs):
            from agent.schemas import StrategicPlan, SubGoal
            return StrategicPlan(
                sub_goals=[SubGoal(description="s", rationale="r", expected_actions=1, acceptance_criteria="ok")],
                estimated_total_actions=1,
            )

        async def _mock_run_phase_subgoals(runtime_, state_):
            state_.status = "done"

        finalized_outcomes: list[str] = []

        async def _mock_finalize(state_, outcome, summary, error=None):
            state_.status = outcome
            finalized_outcomes.append(outcome)

        with patch("agent.kernel.loop.plan_phase", new=AsyncMock(side_effect=_mock_plan_phase)):
            with patch("agent.kernel.loop._run_phase_subgoals", new=AsyncMock(side_effect=_mock_run_phase_subgoals)):
                with patch.object(runtime, "finalize_task", new=AsyncMock(side_effect=_mock_finalize)):
                    with patch.object(runtime, "_broadcast", new=AsyncMock()):
                        with patch("agent.kernel.loop.update_task_status", new=AsyncMock()):
                            await run_mission_loop(runtime, state)

        assert "done" in finalized_outcomes

        # DB row must be updated.
        from agent.missions.store import get_mission
        refreshed = await get_mission(user_id, mission.id)
        assert refreshed is not None
        assert refreshed.status == "done"

    async def test_mission_loop_marks_mission_failed_on_phase_failure(
        self, isolated_db
    ):
        """run_mission_loop must mark Mission 'failed' when a phase fails."""
        from agent.missions.store import create_mission, create_phase, get_mission
        from agent.schemas import MissionBrief, PhaseSpec
        from agent.kernel.loop import run_mission_loop
        from agent.kernel.runtime import AgentRuntime

        user_id = _uid()
        runtime = AgentRuntime()

        mission = await create_mission(user_id, MissionBrief(brief="Failure test."))
        await create_phase(
            mission.id,
            PhaseSpec(
                description="failing phase",
                rationale="r",
                success_criteria="done",
                artifacts=[{"path": "{workspace}/x.txt", "kind": "file", "produced": False}],
            ),
            idx=0,
        )

        state = self._make_state(runtime, user_id, mission.id)

        async def _mock_plan_phase(**kwargs):
            from agent.schemas import StrategicPlan, SubGoal
            return StrategicPlan(
                sub_goals=[SubGoal(description="s", rationale="r", expected_actions=1, acceptance_criteria="ok")],
                estimated_total_actions=1,
            )

        async def _mock_run_phase_subgoals_fail(runtime_, state_):
            # Simulate the sub-goal driver hitting a failure.
            state_.status = "failed"

        async def _mock_finalize(state_, outcome, summary, error=None):
            state_.status = outcome

        with patch("agent.kernel.loop.plan_phase", new=AsyncMock(side_effect=_mock_plan_phase)):
            with patch("agent.kernel.loop._run_phase_subgoals", new=AsyncMock(side_effect=_mock_run_phase_subgoals_fail)):
                with patch.object(runtime, "finalize_task", new=AsyncMock(side_effect=_mock_finalize)):
                    with patch.object(runtime, "_broadcast", new=AsyncMock()):
                        with patch("agent.kernel.loop.update_task_status", new=AsyncMock()):
                            await run_mission_loop(runtime, state)

        from agent.missions.store import get_mission
        refreshed = await get_mission(user_id, mission.id)
        assert refreshed is not None
        assert refreshed.status == "failed"

    async def test_legacy_task_path_unchanged(self):
        """A TaskState with mission_id=None must run the legacy loop unchanged.

        This regression test verifies that the guard at the top of
        _run_task_loop_impl does NOT fire for non-mission tasks, and that
        run_mission_loop is never called.
        """
        from agent.kernel.loop import _run_task_loop_impl
        from agent.kernel.runtime import AgentRuntime, TaskState
        from agent.schemas import SelfModel

        runtime = AgentRuntime()
        state = TaskState(
            id=_uid(),
            user_id=_uid(),
            goal="legacy flat task",
            track="foreground",
            status="planning",
            self_model=SelfModel(),
            # mission_id deliberately left at default None
        )
        assert state.mission_id is None

        mission_loop_called = []

        async def _spy_mission_loop(r, s):
            mission_loop_called.append(True)

        # Patch the strategic planner + executor so the loop completes quickly.
        async def _instant_plan(*args, **kwargs):
            from agent.schemas import StrategicPlan, SubGoal
            return StrategicPlan(
                sub_goals=[SubGoal(
                    description="done",
                    rationale="r",
                    expected_actions=1,
                    acceptance_criteria="ok",
                )],
                estimated_total_actions=1,
            )

        with patch("agent.kernel.loop.run_mission_loop", new=AsyncMock(side_effect=_spy_mission_loop)):
            with patch("agent.cognition.planner.strategic.plan", new=AsyncMock(side_effect=_instant_plan)):
                with patch("agent.kernel.loop.tactical.plan") as mock_tactical:
                    # Make tactical return DONE_TASK immediately.
                    from agent.schemas import PlanStep, InnerMonologue
                    mock_tactical.return_value = PlanStep(
                        step_idx=0,
                        action="DONE_TASK",
                        args={"summary": "legacy task done"},
                        monologue=InnerMonologue(),
                    )
                    with patch("agent.kernel.loop.update_task_status", new=AsyncMock()):
                        with patch.object(runtime, "_broadcast", new=AsyncMock()):
                            with patch.object(runtime, "finalize_task", new=AsyncMock()):
                                with patch("agent.kernel.loop.execute_action") as mock_exec:
                                    # Shouldn't reach execute — DONE_TASK is terminal.
                                    await _run_task_loop_impl(runtime, state)

        assert not mission_loop_called, (
            "run_mission_loop must NOT be called for non-mission tasks"
        )


# ══════════════════════════════════════════════════════════════════════════════
# 5. REST endpoints
# ══════════════════════════════════════════════════════════════════════════════


class TestRestMissionEndpoints:

    def _make_token(self, user_id: str):
        """Build a minimal TokenPayload-like namespace."""
        return types.SimpleNamespace(user_id=user_id)

    async def test_rest_post_mission_returns_ids(self, isolated_db):
        """POST /agent/mission must return mission_id and task_id when started."""
        import main as _main_mod
        from security.auth import require_auth
        from httpx import AsyncClient, ASGITransport

        app = _main_mod.create_app()

        from agent.kernel.runtime import agent_runtime

        user_id = _uid()
        token = self._make_token(user_id)

        async def _mock_start_mission(*, user_id, brief, unsafe_mode=False):
            return (_uid(), _uid())

        def _fake_auth():
            return token

        app.dependency_overrides[require_auth] = _fake_auth

        try:
            with patch.object(agent_runtime, "start_mission", new=AsyncMock(side_effect=_mock_start_mission)):
                async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                    response = await client.post(
                        "/api/v1/agent/mission",
                        json={"brief": "Build something.", "quality_bar": ""},
                        headers={"Authorization": "Bearer fake-token"},
                    )
        finally:
            app.dependency_overrides.clear()

        assert response.status_code == 200
        data = response.json()
        assert "mission_id" in data
        assert "task_id" in data
        assert data["started"] is True

    async def test_rest_get_missions_isolates_per_user(self, isolated_db):
        """GET /agent/missions must only return missions for the authenticated user."""
        from agent.missions.store import create_mission
        from agent.schemas import MissionBrief
        from security.auth import require_auth
        import main as _main_mod
        from httpx import AsyncClient, ASGITransport

        user_a = _uid()
        user_b = _uid()

        # Create missions for both users.
        m_a1 = await create_mission(user_a, MissionBrief(brief="User A mission 1"))
        m_a2 = await create_mission(user_a, MissionBrief(brief="User A mission 2"))
        m_b1 = await create_mission(user_b, MissionBrief(brief="User B mission 1"))

        app = _main_mod.create_app()

        # Query as user_a.
        token_a = self._make_token(user_a)
        app.dependency_overrides[require_auth] = lambda: token_a
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                resp_a = await client.get(
                    "/api/v1/agent/missions",
                    headers={"Authorization": "Bearer fake-token"},
                )
        finally:
            app.dependency_overrides.clear()

        assert resp_a.status_code == 200
        missions_a = resp_a.json()["missions"]
        ids_a = {m["id"] for m in missions_a}

        assert m_a1.id in ids_a
        assert m_a2.id in ids_a
        assert m_b1.id not in ids_a, "User A must not see User B's missions"

        # Query as user_b.
        token_b = self._make_token(user_b)
        app.dependency_overrides[require_auth] = lambda: token_b
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                resp_b = await client.get(
                    "/api/v1/agent/missions",
                    headers={"Authorization": "Bearer fake-token"},
                )
        finally:
            app.dependency_overrides.clear()

        assert resp_b.status_code == 200
        missions_b = resp_b.json()["missions"]
        ids_b = {m["id"] for m in missions_b}

        assert m_b1.id in ids_b
        assert m_a1.id not in ids_b
        assert m_a2.id not in ids_b
