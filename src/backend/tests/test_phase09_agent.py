"""
Phase 09.1 — agent cognitive seed: schemas, actions, preconditions, planners,
checkpoints, audit. Mocks LLM via monkey-patching agent.planner._llm._call.
"""
from __future__ import annotations

import asyncio
import json
import os
import tempfile
from typing import Any

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase09")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-api-key-for-tests")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


@pytest_asyncio.fixture
async def isolated_db(monkeypatch):
    import db.database as _dbm
    import db.models as _dm  # noqa: F401 — registers tables
    import importlib

    if not _dbm.Base.metadata.tables:
        importlib.reload(_dm)

    fd, tmp_file = tempfile.mkstemp(suffix=".db", prefix="phantom_p9_")
    os.close(fd)
    url = f"sqlite+aiosqlite:///{tmp_file}"
    engine = create_async_engine(url, echo=False, connect_args={"check_same_thread": False})
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


# ═══════════════════════════════════════════════════════════════════════════════
# 1. Schemas
# ═══════════════════════════════════════════════════════════════════════════════

class TestSchemas:
    def test_risk_level_ordering(self):
        from agent.schemas import RiskLevel
        assert int(RiskLevel.SAFE) < int(RiskLevel.LOW) < int(RiskLevel.MEDIUM) < int(RiskLevel.HIGH)

    def test_subgoal_defaults(self):
        from agent.schemas import SubGoal
        sg = SubGoal(description="d", rationale="r", expected_actions=2, acceptance_criteria="ac")
        assert sg.status == "pending"
        assert sg.actions_used == 0
        assert sg.id  # auto uuid

    def test_planstep_inner_monologue_defaults(self):
        from agent.schemas import PlanStep, InnerMonologue
        s = PlanStep(step_idx=0, action="x", monologue=InnerMonologue(confidence=0.9))
        assert s.monologue.objection is None
        assert s.monologue.confidence == 0.9
        assert s.retried_from is None

    def test_observation_defaults(self):
        from agent.schemas import Observation
        o = Observation(step_idx=1, type="result", source="x", content="c")
        assert o.entities == []
        assert o.confidence == 1.0

    def test_action_result_round_trip(self):
        from agent.schemas import ActionResult
        ar = ActionResult(ok=False, error="e", error_class="ec", elapsed_ms=42)
        d = ar.model_dump()
        assert ActionResult(**d).error_class == "ec"

    def test_grounded_param_resolver_required(self):
        from agent.actions.grounded import GroundedParam
        gp = GroundedParam(description="login", expected_type="button")
        with pytest.raises(NotImplementedError):
            asyncio.run(gp.resolve(None))

    def test_grounded_param_resolves_with_callable(self):
        from agent.actions.grounded import GroundedParam
        gp = GroundedParam(description="ok", expected_type="button")

        async def grounder(p):
            return "RESOLVED"

        result = asyncio.run(gp.resolve(grounder))
        assert result == "RESOLVED"
        assert gp.resolved_value == "RESOLVED"


# ═══════════════════════════════════════════════════════════════════════════════
# 2. Actions
# ═══════════════════════════════════════════════════════════════════════════════

class _StubRuntime:
    """Minimal duck-typed runtime — actions only need browser_page + controls."""
    def __init__(self):
        self.browser = None
        self.browser_context = None
        self.browser_page = None
        from agent.controls import ControlBus
        self.controls = ControlBus()
        self.self_model = None


@pytest.fixture
def workspace(tmp_path):
    return str(tmp_path)


@pytest.fixture
def ctx(workspace):
    from agent.actions.base import ActionContext
    return ActionContext(task_id="t", step_idx=0, workspace_dir=workspace, runtime=_StubRuntime())


class TestActions:
    @pytest.mark.asyncio
    async def test_fs_read_ok(self, ctx, tmp_path):
        from agent.actions.fs import FsRead
        p = tmp_path / "hello.txt"
        p.write_text("hello world")
        res = await FsRead(path=str(p)).execute(ctx)
        assert res.ok and res.output["content"] == "hello world"

    @pytest.mark.asyncio
    async def test_fs_read_missing(self, ctx, tmp_path):
        from agent.actions.fs import FsRead
        res = await FsRead(path=str(tmp_path / "nope")).execute(ctx)
        assert not res.ok and res.error_class == "not_found"

    @pytest.mark.asyncio
    async def test_fs_read_binary_detected(self, ctx, tmp_path):
        from agent.actions.fs import FsRead
        p = tmp_path / "binary"
        p.write_bytes(b"AB\x00CD")
        res = await FsRead(path=str(p)).execute(ctx)
        assert not res.ok and res.error_class == "binary_detected"

    @pytest.mark.asyncio
    async def test_fs_write_in_workspace(self, ctx, workspace):
        from agent.actions.fs import FsWrite
        target = os.path.join(workspace, "out.txt")
        res = await FsWrite(path=target, content="hi").execute(ctx)
        assert res.ok
        assert open(target).read() == "hi"

    @pytest.mark.asyncio
    async def test_fs_write_blocks_outside_workspace(self, ctx, tmp_path):
        from agent.actions.fs import FsWrite
        outside = "/tmp/phantom_test_evil_outside.sh"
        # confirm=True is supplied by LLM but executor MUST override to False.
        res = await FsWrite(path=outside, content="x", confirm=True).execute(ctx)
        assert not res.ok and res.error_class == "requires_confirm"

    @pytest.mark.asyncio
    async def test_bash_run_basic(self, ctx):
        from agent.actions.bash import BashRun
        res = await BashRun(cmd="echo hi", timeout_s=5, sandboxed=False).execute(ctx)
        assert res.ok
        assert "hi" in res.output["stdout"]
        assert res.sandboxed is False

    @pytest.mark.asyncio
    async def test_bash_run_timeout(self, ctx):
        from agent.actions.bash import BashRun
        res = await BashRun(cmd="sleep 5", timeout_s=1, sandboxed=False).execute(ctx)
        assert not res.ok and res.error_class == "timeout"

    @pytest.mark.asyncio
    async def test_bash_run_sandboxed_falls_back_when_firejail_missing(self, ctx, monkeypatch):
        from agent.safety import sandbox as sb
        from agent.actions.bash import BashRun
        monkeypatch.setattr(sb, "firejail_available", lambda: False)
        res = await BashRun(cmd="echo OK", timeout_s=5, sandboxed=True).execute(ctx)
        assert res.ok
        assert res.sandboxed is False  # honest report

    @pytest.mark.asyncio
    async def test_process_list_filter(self, ctx):
        from agent.actions.process import ProcessList
        res = await ProcessList(filter_substr="python", max_rows=5).execute(ctx)
        assert res.ok and isinstance(res.output["rows"], list)

    @pytest.mark.asyncio
    async def test_time_wait_short(self, ctx):
        from agent.actions.time_ import TimeWait
        import time as _t
        t0 = _t.monotonic()
        res = await TimeWait(seconds=0.3).execute(ctx)
        assert res.ok and (_t.monotonic() - t0) >= 0.25

    @pytest.mark.asyncio
    async def test_self_capability_lists_actions(self, ctx):
        from agent.actions.self_introspect import SelfCapability
        from agent.schemas import SelfModel, RiskLevel
        ctx.runtime.self_model = SelfModel(capabilities=["fs.read", "bash.run"], risk_tolerance=RiskLevel.MEDIUM)
        res = await SelfCapability(query="bash").execute(ctx)
        assert res.ok and "bash.run" in res.output["available_actions"]

    @pytest.mark.asyncio
    async def test_net_scan_rejects_too_wide(self, ctx):
        from agent.actions.net import NetScan
        res = await NetScan(subnet="10.0.0.0/16", mode="basic").execute(ctx)
        assert not res.ok and res.error_class == "too_wide"

    @pytest.mark.asyncio
    async def test_browser_navigate_rejects_invalid_scheme(self, ctx):
        from agent.actions.browser import BrowserNavigate
        res = await BrowserNavigate(url="file:///etc/passwd").execute(ctx)
        assert not res.ok and res.error_class == "invalid_scheme"


# ═══════════════════════════════════════════════════════════════════════════════
# 3. Preconditions
# ═══════════════════════════════════════════════════════════════════════════════

class TestPreconditions:
    @pytest.mark.asyncio
    async def test_path_exists_pass(self, tmp_path):
        from agent.safety.preconditions import check_preconditions
        from agent.schemas import Precondition
        p = tmp_path / "f"
        p.write_text("x")
        result = await check_preconditions([Precondition(key="path.exists", required=str(p))])
        assert result.ok

    @pytest.mark.asyncio
    async def test_path_exists_fail(self):
        from agent.safety.preconditions import check_preconditions
        from agent.schemas import Precondition
        result = await check_preconditions([
            Precondition(key="path.exists", required="/no/such/path", failure_mode="abandon"),
        ])
        assert not result.ok and result.failures[0].failure_mode == "abandon"

    @pytest.mark.asyncio
    async def test_unknown_precondition_marks_failure(self):
        from agent.safety.preconditions import check_preconditions
        from agent.schemas import Precondition
        result = await check_preconditions([Precondition(key="who.knows", required=None)])
        assert not result.ok

    @pytest.mark.asyncio
    async def test_failure_mode_propagates(self):
        from agent.safety.preconditions import check_preconditions
        from agent.schemas import Precondition
        r = await check_preconditions([
            Precondition(key="path.exists", required="/no", failure_mode="reflect"),
        ])
        assert not r.ok and r.failures[0].failure_mode == "reflect"

    @pytest.mark.asyncio
    async def test_workspace_writable_creates_dir(self, tmp_path):
        from agent.safety.preconditions import check_preconditions
        from agent.schemas import Precondition
        new_dir = tmp_path / "newdir"
        r = await check_preconditions([Precondition(key="workspace.writable", required=str(new_dir))])
        assert r.ok and new_dir.is_dir()


# ═══════════════════════════════════════════════════════════════════════════════
# 4. Planner — mocked LLM
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.fixture
def mock_llm(monkeypatch):
    """Patch agent.planner._llm._call with a scripted queue."""
    queue: list[str] = []

    async def fake_call(prompt: str) -> str:
        if not queue:
            raise RuntimeError("test_mock_llm queue exhausted")
        return queue.pop(0)

    from agent.planner import _llm
    monkeypatch.setattr(_llm, "_call", fake_call)
    return queue


class TestPlanner:
    @pytest.mark.asyncio
    async def test_strategic_plan_decomposes(self, mock_llm):
        from agent.planner import strategic
        from agent.schemas import SelfModel
        mock_llm.append(json.dumps({
            "sub_goals": [
                {"description": "list files", "rationale": "first", "expected_actions": 1, "acceptance_criteria": "got list"},
                {"description": "summarize", "rationale": "second", "expected_actions": 1, "acceptance_criteria": "summary"},
            ],
            "estimated_total_actions": 2,
            "risk_assessment": "low",
        }))
        plan = await strategic.plan(goal="explore", self_model=SelfModel())
        assert len(plan.sub_goals) == 2
        assert plan.estimated_total_actions == 2

    @pytest.mark.asyncio
    async def test_strategic_plan_retries_on_invalid_json(self, mock_llm):
        from agent.planner import strategic
        from agent.schemas import SelfModel
        mock_llm.append("not json at all")
        mock_llm.append(json.dumps({
            "sub_goals": [{"description": "x", "rationale": "y", "expected_actions": 1, "acceptance_criteria": "z"}],
            "estimated_total_actions": 1,
            "risk_assessment": "ok",
        }))
        plan = await strategic.plan(goal="test", self_model=SelfModel())
        assert len(plan.sub_goals) == 1

    @pytest.mark.asyncio
    async def test_strategic_plan_fails_after_two_invalid(self, mock_llm):
        from agent.planner import strategic
        from agent.schemas import SelfModel
        mock_llm.append("nope")
        mock_llm.append("still nope")
        with pytest.raises(RuntimeError):
            await strategic.plan(goal="x", self_model=SelfModel())

    @pytest.mark.asyncio
    async def test_tactical_step_picks_action(self, mock_llm):
        from agent.planner import tactical
        from agent.schemas import SelfModel, SubGoal
        mock_llm.append(json.dumps({
            "action": "fs.read",
            "args": {"path": "/etc/hostname"},
            "intent": "read hostname",
            "monologue": {
                "what_i_see": "no obs", "what_i_plan": "read",
                "why_this_works": "available", "what_could_fail": "permission",
                "objection": None, "confidence": 0.9,
            },
        }))
        step = await tactical.plan(
            step_idx=0,
            sub_goal=SubGoal(description="d", rationale="r", expected_actions=1, acceptance_criteria=""),
            self_model=SelfModel(capabilities=["fs.read"]),
            observations=[],
            actions_in_sub_goal=0,
        )
        assert step.action == "fs.read"
        assert step.monologue.confidence == 0.9

    @pytest.mark.asyncio
    async def test_tactical_forces_objection_for_medium_risk(self, mock_llm):
        """MEDIUM+ risk action without objection → loop forces a stricter retry."""
        from agent.planner import tactical
        from agent.schemas import SelfModel, SubGoal
        # First call: bash.run (MEDIUM) without objection
        mock_llm.append(json.dumps({
            "action": "bash.run",
            "args": {"cmd": "ls", "timeout_s": 2, "sandboxed": False},
            "intent": "list",
            "monologue": {
                "what_i_see": "x", "what_i_plan": "ls",
                "why_this_works": "duh", "what_could_fail": "denied",
                "objection": None, "confidence": 0.9,
            },
        }))
        # Second call: same shape but with objection populated
        mock_llm.append(json.dumps({
            "action": "bash.run",
            "args": {"cmd": "ls", "timeout_s": 2, "sandboxed": False},
            "intent": "list",
            "monologue": {
                "what_i_see": "x", "what_i_plan": "ls",
                "why_this_works": "duh", "what_could_fail": "denied",
                "objection": "could expose paths", "confidence": 0.9,
            },
        }))
        step = await tactical.plan(
            step_idx=0,
            sub_goal=SubGoal(description="d", rationale="r", expected_actions=1, acceptance_criteria=""),
            self_model=SelfModel(),
            observations=[],
            actions_in_sub_goal=0,
        )
        assert step.action == "bash.run"
        assert step.monologue.objection == "could expose paths"

    @pytest.mark.asyncio
    async def test_reflector_returns_continue(self, mock_llm):
        from agent.planner import reflector
        from agent.schemas import SubGoal, ThoughtBudget
        mock_llm.append(json.dumps({
            "verdict": "continue", "summary": "fine",
            "progress_assessment": "good", "recurring_errors": [],
            "recommendations": "keep going", "new_confidence": 0.7,
        }))
        out = await reflector.reflect(
            active_sub_goal=SubGoal(description="d", rationale="r", expected_actions=1, acceptance_criteria=""),
            observations=[],
            recent_actions_summary="",
            thought_budget=ThoughtBudget(estimated_actions=3),
        )
        assert out.verdict == "continue" and out.new_confidence == 0.7

    @pytest.mark.asyncio
    async def test_reflector_falls_back_to_continue_on_invalid(self, mock_llm):
        from agent.planner import reflector
        from agent.schemas import SubGoal, ThoughtBudget
        mock_llm.append("nope")
        mock_llm.append("still nope")
        out = await reflector.reflect(
            active_sub_goal=SubGoal(description="d", rationale="r", expected_actions=1, acceptance_criteria=""),
            observations=[],
            recent_actions_summary="",
            thought_budget=ThoughtBudget(),
        )
        assert out.verdict == "continue"  # safe fallback


# ═══════════════════════════════════════════════════════════════════════════════
# 5. Audit + Checkpoints
# ═══════════════════════════════════════════════════════════════════════════════

class TestAuditAndCheckpoints:
    @pytest.mark.asyncio
    async def test_write_audit_persists(self, isolated_db):
        from agent.audit import create_task_row, write_audit_entry, fetch_audit
        from agent.schemas import ActionResult, InnerMonologue, PlanStep
        await create_task_row("T1", "goal")
        step = PlanStep(step_idx=0, action="fs.read", args={"path": "x"}, intent="i",
                        monologue=InnerMonologue(confidence=0.9))
        result = ActionResult(ok=True, output={"path": "x"}, elapsed_ms=10)
        aid = await write_audit_entry(task_id="T1", step=step, result=result, risk_level=1)
        assert aid > 0
        rows = await fetch_audit("T1")
        assert len(rows) == 1
        assert rows[0].action_name == "fs.read"
        assert rows[0].monologue is not None and rows[0].monologue.confidence == 0.9

    @pytest.mark.asyncio
    async def test_save_and_fetch_checkpoint(self, isolated_db):
        from agent.audit import save_checkpoint, fetch_checkpoint, latest_checkpoint
        from agent.checkpoints import build
        from agent.schemas import SelfModel, ThoughtBudget
        cp = build(
            task_id="T2", reason="manual", self_model=SelfModel(),
            goal="g", sub_goals=[], active_sub_goal_id=None,
            observations=[], thought_budget=ThoughtBudget(),
            last_reflection=None, step_idx=3,
        )
        cp_id = await save_checkpoint(cp)
        loaded = await fetch_checkpoint(cp_id)
        assert loaded is not None and loaded.step_idx == 3
        latest = await latest_checkpoint("T2")
        assert latest is not None and latest.step_idx == 3

    @pytest.mark.asyncio
    async def test_mark_orphans_paused(self, isolated_db):
        from agent.audit import create_task_row, mark_orphans_paused, list_tasks, update_task_status
        await create_task_row("T3", "running goal")
        await update_task_status("T3", "running")
        await create_task_row("T4", "another")
        await update_task_status("T4", "done", finished=True)
        n = await mark_orphans_paused("uvicorn_restart")
        assert n == 1
        tasks = await list_tasks(status="paused")
        assert any(t["id"] == "T3" and t["paused_reason"] == "uvicorn_restart" for t in tasks)


# ═══════════════════════════════════════════════════════════════════════════════
# 6. Safety
# ═══════════════════════════════════════════════════════════════════════════════

class TestSafety:
    def test_circuit_breaker_actions(self):
        from agent.safety.circuit_breakers import TaskBudget, evaluate
        b = TaskBudget()
        b.actions_run = 1000
        v = evaluate(b)
        assert v.fail_now and v.reason == "max_actions_per_task"

    def test_circuit_breaker_consecutive_errors_force_reflect(self):
        from agent.safety.circuit_breakers import TaskBudget, evaluate
        b = TaskBudget()
        for _ in range(3):
            b.record_result(False, "same_err")
        v = evaluate(b)
        assert v.force_reflect

    def test_sandbox_wraps_only_when_firejail(self, monkeypatch):
        from agent.safety import sandbox
        monkeypatch.setattr(sandbox, "firejail_available", lambda: False)
        argv, sb = sandbox.wrap_shell_cmd("echo a", True)
        assert sb is False and argv[:2] == ["/bin/sh", "-c"]

        monkeypatch.setattr(sandbox, "firejail_available", lambda: True)
        argv, sb = sandbox.wrap_shell_cmd("echo a", True)
        assert sb is True and argv[0] == "firejail"

    @pytest.mark.asyncio
    async def test_executor_blocks_risk_above_tolerance(self, isolated_db, monkeypatch, workspace):
        from agent.executor import execute
        from agent.schemas import InnerMonologue, PlanStep
        from agent.audit import create_task_row
        from config import config
        monkeypatch.setattr(config, "agent_risk_tolerance", 1)  # SAFE only
        await create_task_row("Trisk", "g")
        step = PlanStep(step_idx=0, action="bash.run", args={"cmd": "ls", "timeout_s": 1, "sandboxed": False},
                        intent="i", monologue=InnerMonologue())
        result, _ = await execute(task_id="Trisk", step=step, runtime=_StubRuntime(), workspace_dir=workspace)
        assert not result.ok and result.error_class == "risk_above_tolerance"
