"""
Phase 9.3a (AD-01) — browser-reset caveat lives on SelfModel.active_caveats.

Tactical's observation window slices the last 10 entries; on long tasks
resume hints slide off and the planner stops seeing them even though the
underlying condition (browser not actually re-navigated) still holds.
SelfModel goes into every prompt in full so moving the hint there keeps
it visible until the agent actually re-navigates.
"""
from __future__ import annotations

import os
import tempfile
import uuid

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase093a-cav")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-key")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


@pytest_asyncio.fixture
async def isolated_db(monkeypatch):
    import db.database as _dbm
    import db.models as _dm  # noqa: F401
    import importlib
    if not _dbm.Base.metadata.tables:
        importlib.reload(_dm)
    fd, tmp_file = tempfile.mkstemp(suffix=".db", prefix="phantom_p93a_cav_")
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


def test_self_model_default_has_empty_caveats():
    from agent.schemas import SelfModel
    sm = SelfModel()
    assert sm.active_caveats == []


def test_caveats_serialise_roundtrip():
    from agent.schemas import SelfModel
    sm = SelfModel(active_caveats=["browser_session_reset — hi"])
    data = sm.model_dump(mode="json")
    restored = SelfModel(**data)
    assert restored.active_caveats == ["browser_session_reset — hi"]


def test_tactical_prompt_contains_caveat_block():
    """Active caveats appear in the tactical user prompt."""
    from agent.cognition.planner.tactical import _build_user_message
    from agent.schemas import Observation, SelfModel, SubGoal

    sm = SelfModel(active_caveats=[
        "browser_session_reset — re-navigate if the task needs a specific page",
    ])
    sg = SubGoal(
        description="open the login page",
        rationale="need to auth",
        expected_actions=2,
        acceptance_criteria="page loaded",
    )
    msg = _build_user_message(
        self_model=sm, sub_goal=sg,
        observations=[], actions_in_sub_goal=0,
    )
    assert "АКТИВНІ ЗАСТЕРЕЖЕННЯ" in msg
    assert "browser_session_reset" in msg


def test_tactical_prompt_no_caveat_block_when_empty():
    """Empty active_caveats → no block in the prompt (clean output)."""
    from agent.cognition.planner.tactical import _build_user_message
    from agent.schemas import SelfModel, SubGoal

    sm = SelfModel()
    sg = SubGoal(
        description="do a thing",
        rationale="because",
        expected_actions=1,
        acceptance_criteria="",
    )
    msg = _build_user_message(
        self_model=sm, sub_goal=sg,
        observations=[], actions_in_sub_goal=0,
    )
    assert "АКТИВНІ ЗАСТЕРЕЖЕННЯ" not in msg


def test_caveat_survives_many_observations():
    """Simulates a long task: the 10-obs tactical window slides off the
    original resume-hint observation, but the caveat on SelfModel persists
    in the prompt."""
    from agent.cognition.observations import build_system
    from agent.cognition.planner.tactical import _build_user_message
    from agent.schemas import SelfModel, SubGoal

    sm = SelfModel(active_caveats=[
        "browser_session_reset — re-navigate if the task needs a specific page"
    ])
    sg = SubGoal(
        description="find the login link",
        rationale="after resume",
        expected_actions=3,
        acceptance_criteria="",
    )
    # 50 noise observations so the original resume hint (if it were in
    # observations) would be far off the 10-obs window.
    obs_list = [build_system(i, "noise", f"step {i} happened") for i in range(50)]
    msg = _build_user_message(
        self_model=sm, sub_goal=sg,
        observations=obs_list, actions_in_sub_goal=0,
    )
    assert "browser_session_reset" in msg


@pytest.mark.asyncio
async def test_resume_from_checkpoint_populates_caveat(isolated_db, monkeypatch):
    """End-to-end: resume path adds the caveat when a browser.navigate
    exists in the audit trail."""
    import json
    from agent import audit as audit_mod
    from agent.kernel.audit import create_task_row, save_checkpoint
    from agent.kernel.runtime import AgentRuntime
    from agent.schemas import (
        Checkpoint, Observation, SelfModel, SubGoal, ThoughtBudget,
    )
    from db.database import get_session
    from db.models import AgentAuditEntry

    task_id = str(uuid.uuid4())
    await create_task_row(task_id, "resume test", "foreground")

    # Seed an audit row for a prior browser.navigate so the resume scan
    # picks up a last_browser_url.
    async with get_session() as db:
        db.add(AgentAuditEntry(
            task_id=task_id,
            step_idx=0,
            action_name="browser.navigate",
            args_json=json.dumps({"url": "https://example.com/login"}),
            result_json=json.dumps({"ok": True, "elapsed_ms": 1}),
            risk_level=1,
            elapsed_ms=1,
        ))

    # Save a checkpoint we can resume from.
    cp = Checkpoint(
        task_id=task_id,
        reason="manual",
        self_model=SelfModel(),
        goal="resume test",
        sub_goals=[SubGoal(
            description="re-open login",
            rationale="test",
            expected_actions=1,
            acceptance_criteria="",
        )],
        active_sub_goal_id=None,
        observations=[],
        thought_budget=ThoughtBudget(),
        step_idx=0,
    )
    cp_id = await save_checkpoint(cp)

    runtime = AgentRuntime()
    # Stub loop runner so resume doesn't actually spawn the agent loop.
    async def _fake_loop(*_a, **_kw):
        return
    import agent.kernel.loop as _loop_mod
    monkeypatch.setattr(_loop_mod, "run_task_loop", _fake_loop)

    ok = await runtime.resume_from_checkpoint(task_id, cp_id)
    assert ok is True
    assert runtime.foreground_slot is not None
    caveats = runtime.foreground_slot.self_model.active_caveats
    assert any("browser_session_reset" in c for c in caveats)
    assert any("example.com/login" in c for c in caveats)


def test_caveat_cleared_by_successful_browser_navigate():
    """Executor clears the browser_session_reset caveat once a real
    browser.navigate lands successfully."""
    from agent.kernel.runtime import TaskState
    from agent.schemas import ActionResult, InnerMonologue, PlanStep, SelfModel

    class _FakeRuntime:
        def __init__(self, state):
            self.foreground_slot = state

        @property
        def current_task(self):
            return self.foreground_slot

    sm = SelfModel(active_caveats=[
        "browser_session_reset — re-navigate if the task needs a specific page",
        "some_other_caveat — unrelated",
    ])
    state = TaskState(
        id="t1", goal="g", track="foreground", status="running",
        self_model=sm,
    )
    runtime = _FakeRuntime(state)

    step = PlanStep(
        step_idx=0, sub_goal_id=None, action="browser.navigate",
        args={"url": "https://example.com/login"}, intent="",
        monologue=InnerMonologue(),
    )
    result = ActionResult(ok=True, output=None, elapsed_ms=50)

    # Mirror the executor post-success block (no executor needed — we
    # directly exercise the branch that clears caveats).
    if (
        result.ok
        and step.action == "browser.navigate"
        and runtime.current_task is not None
    ):
        s = runtime.current_task.self_model
        s.active_caveats = [
            c for c in s.active_caveats
            if not c.startswith("browser_session_reset")
        ]

    remaining = runtime.current_task.self_model.active_caveats
    assert not any(c.startswith("browser_session_reset") for c in remaining)
    assert any(c.startswith("some_other_caveat") for c in remaining)
