"""
Phase 9.2.2 — F-05 resume-from-checkpoint browser caveat.

Verifies the resume path adds a system observation + WS event when prior
browser actions exist, and the tactical prompt knows about the hint.
"""
from __future__ import annotations

import json
import os
import tempfile

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase09-2-2-resume")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-api-key-for-tests")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


@pytest_asyncio.fixture
async def isolated_db(monkeypatch):
    import db.database as _dbm
    import db.models as _dm  # noqa: F401
    import importlib
    if not _dbm.Base.metadata.tables:
        importlib.reload(_dm)
    fd, tmp_file = tempfile.mkstemp(suffix=".db", prefix="phantom_p922r_")
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


async def _seed_task_with_checkpoint(task_id="t-resume", with_browser=True):
    """Insert a task row + checkpoint + optional browser audit row."""
    from agent.checkpoints import build as build_cp
    from agent.audit import (
        create_task_row, write_audit_entry, save_checkpoint, update_task_status,
    )
    from agent.schemas import (
        ActionResult, InnerMonologue, PlanStep, SelfModel, SubGoal, ThoughtBudget,
    )

    await create_task_row(task_id, "navigate to example", "foreground")
    await update_task_status(task_id, "paused", paused_reason="user_paused")

    if with_browser:
        nav_step = PlanStep(
            step_idx=0,
            sub_goal_id=None,
            action="browser.navigate",
            args={"url": "https://example.com/dashboard"},
            intent="open dashboard",
            monologue=InnerMonologue(
                what_i_see="initial state", what_i_plan="open page",
                why_this_works="navigate", what_could_fail="404",
                confidence=0.9,
            ),
        )
        nav_result = ActionResult(ok=True, output={"loaded": True}, elapsed_ms=42)
        await write_audit_entry(task_id=task_id, step=nav_step, result=nav_result, risk_level=1)

    self_model = SelfModel()
    sub = SubGoal(description="d", rationale="r", expected_actions=1, acceptance_criteria="")
    cp = build_cp(
        task_id=task_id,
        reason="manual",
        self_model=self_model,
        goal="navigate to example",
        sub_goals=[sub],
        active_sub_goal_id=sub.id,
        observations=[],
        thought_budget=ThoughtBudget(),
        last_reflection=None,
        step_idx=1,
    )
    cp_id = await save_checkpoint(cp)
    return task_id, cp_id


# ═════════════════════════════════════════════════════════════════════════════
# 1. Resume with browser history adds caveat observation + WS event
# ═════════════════════════════════════════════════════════════════════════════


class TestResumeWithBrowserHistory:
    @pytest.mark.asyncio
    async def test_resume_adds_observation_and_emits_event(self, isolated_db, monkeypatch):
        from agent.runtime import AgentRuntime

        rt = AgentRuntime()
        # Don't actually start the loop.
        async def fake_create_task(coro, name=None):
            coro.close()
            return None
        monkeypatch.setattr("asyncio.create_task", fake_create_task)
        broadcasts: list[tuple[str, dict]] = []
        async def fake_broadcast(t, p):
            broadcasts.append((t, p))
        monkeypatch.setattr(rt, "_broadcast", fake_broadcast)

        task_id, cp_id = await _seed_task_with_checkpoint(with_browser=True)
        ok = await rt.resume_from_checkpoint(task_id, cp_id)
        assert ok is True

        assert rt.foreground_slot is not None
        observations = rt.foreground_slot.observations
        # Find a system observation tagged with browser_reset.
        hits = [o for o in observations if "hint:browser_reset_after_resume" in o.entities]
        assert hits, f"expected a browser-reset observation; got {observations}"
        assert "example.com/dashboard" in hits[0].content

        caveats = [e for e in broadcasts if e[0] == "agent.resumed_with_caveat"]
        assert caveats, f"expected resumed_with_caveat event; got {broadcasts}"
        assert caveats[0][1]["caveat"] == "browser_session_lost"
        assert "example.com/dashboard" in caveats[0][1]["last_known_url"]


# ═════════════════════════════════════════════════════════════════════════════
# 2. Resume without browser history — no caveat
# ═════════════════════════════════════════════════════════════════════════════


class TestResumeWithoutBrowserHistory:
    @pytest.mark.asyncio
    async def test_resume_no_caveat_when_no_browser_actions(self, isolated_db, monkeypatch):
        from agent.runtime import AgentRuntime

        rt = AgentRuntime()
        async def fake_create_task(coro, name=None):
            coro.close()
            return None
        monkeypatch.setattr("asyncio.create_task", fake_create_task)
        broadcasts: list[tuple[str, dict]] = []
        async def fake_broadcast(t, p):
            broadcasts.append((t, p))
        monkeypatch.setattr(rt, "_broadcast", fake_broadcast)

        task_id, cp_id = await _seed_task_with_checkpoint(
            task_id="t-no-browser", with_browser=False
        )
        ok = await rt.resume_from_checkpoint(task_id, cp_id)
        assert ok is True
        observations = rt.foreground_slot.observations
        hits = [o for o in observations if "hint:browser_reset_after_resume" in o.entities]
        assert not hits, "should NOT add caveat for tasks without browser history"
        caveats = [e for e in broadcasts if e[0] == "agent.resumed_with_caveat"]
        assert not caveats


# ═════════════════════════════════════════════════════════════════════════════
# 3. Tactical prompt includes the recovery pattern
# ═════════════════════════════════════════════════════════════════════════════


class TestTacticalPromptResumeHint:
    def test_prompt_mentions_browser_reset_pattern(self):
        from agent.planner.tactical import _SYSTEM_PROMPT_UA
        assert "hint:browser_reset_after_resume" in _SYSTEM_PROMPT_UA
        assert "browser.navigate" in _SYSTEM_PROMPT_UA
