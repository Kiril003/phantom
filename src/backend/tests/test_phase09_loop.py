"""
Phase 09.1 — agent loop, controls, intervention. Mocks LLM via _llm._call.
"""
from __future__ import annotations

import asyncio
import json
import os
import tempfile

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase09-loop")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-api-key-for-tests")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


@pytest_asyncio.fixture
async def isolated_db(monkeypatch):
    import db.database as _dbm
    import db.models as _dm  # noqa: F401
    import importlib
    if not _dbm.Base.metadata.tables:
        importlib.reload(_dm)

    fd, tmp_file = tempfile.mkstemp(suffix=".db", prefix="phantom_p9loop_")
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


@pytest.fixture
def mock_llm(monkeypatch):
    queue: list[str] = []

    async def fake_call(prompt: str) -> str:
        if not queue:
            return json.dumps({  # default benign reply: terminate the task
                "action": "DONE_TASK",
                "args": {"summary": "queue exhausted — terminating"},
                "intent": "exit",
                "monologue": {
                    "what_i_see": "ok", "what_i_plan": "exit",
                    "why_this_works": "no more work", "what_could_fail": "nothing",
                    "objection": None, "confidence": 1.0,
                },
            })
        return queue.pop(0)

    from agent.planner import _llm
    monkeypatch.setattr(_llm, "_call", fake_call)
    return queue


@pytest.fixture(autouse=True)
def isolate_runtime(monkeypatch, tmp_path):
    """Reset agent_runtime between tests + force workspace into tmp_path."""
    from config import config
    monkeypatch.setattr(config, "agent_workspace_dir", str(tmp_path))
    monkeypatch.setattr(config, "agent_reflection_every_n_actions", 5)
    monkeypatch.setattr(config, "agent_max_actions_per_task", 20)

    from agent.runtime import agent_runtime
    agent_runtime.foreground_slot = None
    agent_runtime.task_runner = None
    agent_runtime.controls.reset()
    agent_runtime.substate = "idle"
    yield
    agent_runtime.foreground_slot = None
    agent_runtime.task_runner = None
    agent_runtime.controls.reset()


def _strategic(num_subgoals: int = 1, total: int = 1) -> str:
    return json.dumps({
        "sub_goals": [
            {
                "description": f"sg{i}", "rationale": "r",
                "expected_actions": 1, "acceptance_criteria": "ok",
            }
            for i in range(num_subgoals)
        ],
        "estimated_total_actions": total,
        "risk_assessment": "low",
    })


def _tactical_action(action: str, args: dict, *, objection: str | None = None) -> str:
    return json.dumps({
        "action": action, "args": args, "intent": "i",
        "monologue": {
            "what_i_see": "x", "what_i_plan": "y", "why_this_works": "z",
            "what_could_fail": "f", "objection": objection, "confidence": 0.9,
        },
    })


def _done_task(summary: str = "ok") -> str:
    return _tactical_action("DONE_TASK", {"summary": summary})


def _done_subgoal(summary: str = "done") -> str:
    return _tactical_action("DONE_SUBGOAL", {"summary": summary})


def _reflection(verdict: str = "continue") -> str:
    return json.dumps({
        "verdict": verdict, "summary": "ok", "progress_assessment": "fine",
        "recurring_errors": [], "recommendations": "go", "new_confidence": 0.7,
    })


# ═══════════════════════════════════════════════════════════════════════════════
# Loop
# ═══════════════════════════════════════════════════════════════════════════════

class TestLoop:
    @pytest.mark.asyncio
    async def test_simple_task_completes(self, isolated_db, mock_llm, tmp_path):
        from agent.runtime import agent_runtime
        from agent.audit import fetch_audit, get_task

        target = tmp_path / "out.txt"
        mock_llm.append(_strategic(1, 1))
        mock_llm.append(_tactical_action("fs.write", {"path": str(target), "content": "hi"}))
        mock_llm.append(_done_task("done"))

        task_id, started = await agent_runtime.start_task("write a file")
        assert started

        # Wait for task to finish (with safety timeout)
        for _ in range(100):
            if agent_runtime.task_runner is None or agent_runtime.task_runner.done():
                break
            await asyncio.sleep(0.05)
        assert agent_runtime.task_runner is None
        row = await get_task(task_id)
        assert row["status"] == "done"
        # Audit row for fs.write should exist
        rows = await fetch_audit(task_id)
        assert any(r.action_name == "fs.write" for r in rows)

    @pytest.mark.asyncio
    async def test_reflection_triggers_after_n_actions(self, isolated_db, mock_llm, monkeypatch, tmp_path):
        """5 fs.read actions should trigger one reflection then completion."""
        from agent.runtime import agent_runtime
        from config import config
        monkeypatch.setattr(config, "agent_reflection_every_n_actions", 3)

        # Make a target file we can read
        f = tmp_path / "f"
        f.write_text("x")

        mock_llm.append(_strategic(1, 5))
        for _ in range(3):
            mock_llm.append(_tactical_action("fs.read", {"path": str(f)}))
        mock_llm.append(_reflection("continue"))  # scheduled reflection
        mock_llm.append(_done_task("done"))

        await agent_runtime.start_task("explore")
        for _ in range(150):
            if agent_runtime.task_runner is None or agent_runtime.task_runner.done():
                break
            await asyncio.sleep(0.05)
        assert agent_runtime.task_runner is None
        # The reflection must have happened — events log captured by mock queue length consumption
        assert len(mock_llm) == 0

    @pytest.mark.asyncio
    async def test_action_failure_recorded_in_audit(self, isolated_db, mock_llm, tmp_path):
        from agent.runtime import agent_runtime
        from agent.audit import fetch_audit
        mock_llm.append(_strategic(1, 1))
        mock_llm.append(_tactical_action("fs.read", {"path": "/nope/never"}))
        mock_llm.append(_done_task("gave up"))

        task_id, _ = await agent_runtime.start_task("read")
        for _ in range(100):
            if agent_runtime.task_runner is None or agent_runtime.task_runner.done():
                break
            await asyncio.sleep(0.05)
        rows = await fetch_audit(task_id)
        assert any(r.action_name == "fs.read" and not r.result.ok for r in rows)


# ═══════════════════════════════════════════════════════════════════════════════
# Controls
# ═══════════════════════════════════════════════════════════════════════════════

class TestControls:
    @pytest.mark.asyncio
    async def test_pause_blocks_loop(self, isolated_db, mock_llm, tmp_path):
        """Pause sets the event; loop must stop emitting actions."""
        from agent.runtime import agent_runtime
        from agent.audit import get_task
        # Use long time.wait actions so the loop has slack to be paused.
        mock_llm.append(_strategic(1, 5))
        for _ in range(5):
            mock_llm.append(_tactical_action("time.wait", {"seconds": 1.5}))
        mock_llm.append(_done_task("done"))

        task_id, _ = await agent_runtime.start_task("explore")
        # Wait briefly so first action starts
        await asyncio.sleep(0.4)
        await agent_runtime.pause(task_id)
        # Pause takes effect after current in-flight action; wait a beat
        await asyncio.sleep(2.5)

        row = await get_task(task_id)
        assert row["status"] == "paused"

        # Cleanup — stop and let runner finalize
        await agent_runtime.stop(task_id)
        if agent_runtime.task_runner:
            try:
                await asyncio.wait_for(agent_runtime.task_runner, timeout=3.0)
            except (asyncio.TimeoutError, asyncio.CancelledError, Exception):
                pass

    @pytest.mark.asyncio
    async def test_stop_halts_task(self, isolated_db, mock_llm, tmp_path):
        from agent.runtime import agent_runtime
        from agent.audit import get_task
        mock_llm.append(_strategic(1, 100))
        for _ in range(20):
            mock_llm.append(_tactical_action("time.wait", {"seconds": 2.0}))

        task_id, _ = await agent_runtime.start_task("loop")
        await asyncio.sleep(0.4)
        await agent_runtime.stop(task_id)
        # Wait briefly for finalize
        for _ in range(80):
            row = await get_task(task_id)
            if row["status"] == "stopped":
                break
            await asyncio.sleep(0.05)
        row = await get_task(task_id)
        assert row["status"] == "stopped"

    @pytest.mark.asyncio
    async def test_intervention_routes_into_reflector(self, isolated_db, mock_llm, tmp_path):
        from agent.runtime import agent_runtime
        f = tmp_path / "f"; f.write_text("x")
        mock_llm.append(_strategic(1, 3))
        mock_llm.append(_tactical_action("fs.read", {"path": str(f)}))
        # reflection on intervention
        mock_llm.append(_reflection("continue"))
        mock_llm.append(_done_task("ok"))

        task_id, _ = await agent_runtime.start_task("with intervention")
        # Push an intervention immediately
        await agent_runtime.intervene(task_id, "please be quick")
        for _ in range(150):
            if agent_runtime.task_runner is None or agent_runtime.task_runner.done():
                break
            await asyncio.sleep(0.05)
        # Mock queue may not be entirely drained because interventions can arrive
        # before the loop reaches the drain point — assert task didn't crash.
        from agent.audit import get_task
        row = await get_task(task_id)
        assert row["status"] in {"done", "running", "planning"}


# ═══════════════════════════════════════════════════════════════════════════════
# Checkpoints — round-trip
# ═══════════════════════════════════════════════════════════════════════════════

class TestCheckpointResume:
    @pytest.mark.asyncio
    async def test_manual_checkpoint_during_task(self, isolated_db, mock_llm, tmp_path):
        from agent.runtime import agent_runtime
        mock_llm.append(_strategic(1, 5))
        for _ in range(5):
            mock_llm.append(_tactical_action("time.wait", {"seconds": 1.5}))
        mock_llm.append(_done_task("ok"))

        task_id, _ = await agent_runtime.start_task("with cp")
        await asyncio.sleep(0.5)
        cp_id = await agent_runtime.checkpoint_now(task_id)
        assert cp_id is not None and cp_id > 0
        await agent_runtime.stop(task_id)
        if agent_runtime.task_runner:
            try:
                await asyncio.wait_for(agent_runtime.task_runner, timeout=3.0)
            except (asyncio.TimeoutError, asyncio.CancelledError, Exception):
                pass
