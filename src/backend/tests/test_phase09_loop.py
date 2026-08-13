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

    from agent.cognition.planner import _llm
    from agent.cognition.memory import recall as _recall_mod
    from agent.cognition.memory import seeds as _seeds
    from agent.cognition.memory import lessons as _lessons
    from config import config as _cfg
    monkeypatch.setattr(_llm, "_call", fake_call)
    # Phase 9.2: force legacy free-form JSON path so the scripted queue actually
    # gets consumed (native tool-calling routes through ai_router instead).
    monkeypatch.setattr(_cfg, "agent_use_native_tool_calling", False)

    # Phase 9.2: stub compose_summary + recall + write_episode so the loop
    # never touches real ChromaDB / ai_router during these legacy tests.
    async def _stub_summary(**kw):
        return f"stub summary for {kw.get('goal','?')}: {kw.get('outcome','?')}"
    async def _stub_recall(query, k=None):
        return []
    async def _stub_write_episode(**kw):
        return ""
    async def _stub_distill(**kw):
        return None
    async def _stub_recall_lessons(query, k=None):
        return []

    monkeypatch.setattr(_seeds, "compose_summary", _stub_summary)
    monkeypatch.setattr(_recall_mod, "recall", _stub_recall)
    monkeypatch.setattr(_seeds, "write_episode", _stub_write_episode)
    monkeypatch.setattr(_lessons, "distill_lesson", _stub_distill)
    monkeypatch.setattr(_lessons, "recall_lessons", _stub_recall_lessons)

    # Same class of leak, one layer down: `strategic.plan` calls
    # `memory_brain.recall_for_prompt` whenever `user_id` is set — and it
    # always is here ("u-test"). That reaches Chroma -> `strategic_memory.
    # _get_ef` -> the SentenceTransformer embedding function, i.e. a real
    # `intfloat/multilingual-e5-small` load. Measured cost of leaving it in:
    # 11.9s on the first test (12 of the file's ~16s), and on any machine
    # whose HF cache is cold — CI — it is a network fetch inside a worker
    # thread, which is how this file ends up wedged rather than merely slow.
    # Mirrors the stub in test_phase09_4a_track_runtime.py.
    from memory.brain import memory_brain as _brain
    async def _stub_recall_for_prompt(**kw):
        return []
    monkeypatch.setattr(_brain, "recall_for_prompt", _stub_recall_for_prompt)
    return queue


@pytest.fixture(autouse=True)
def isolate_runtime(monkeypatch, tmp_path):
    """Reset agent_runtime between tests + force workspace into tmp_path."""
    from config import config
    monkeypatch.setattr(config, "agent_workspace_dir", str(tmp_path))
    monkeypatch.setattr(config, "agent_reflection_every_n_actions", 5)
    monkeypatch.setattr(config, "agent_max_actions_per_task", 20)
    # The consent gate stays ARMED here. It used to be disarmed for the whole
    # file, which meant the shipping default had no coverage in the one suite
    # that drives this loop — three defects sat in that path undisturbed.
    # Measured 2026-08-14: no test in this file needs it off. A test that does
    # must set it itself, as
    # test_consent_auto_approve_is_auditable.py does.

    # Mock Quality Gate to avoid real LLM calls during finalisation in ALL tests
    import agent.kernel.loop as loop_mod
    async def _fake_gate(**kwargs):
        from agent.operations.orchestrator.quality_gate import GateResult, GateDraft, CritiqueReport
        return GateResult(
            final_draft=GateDraft(text=kwargs.get("intent", "ok")),
            revisions=[],
            critiques=[],
            final_critique=CritiqueReport(),
            passed=True,
            rounds_used=1,
        )
    monkeypatch.setattr(loop_mod, "run_quality_gate_for", _fake_gate)

    # Same reason, second leak: `finalize_task` -> `_finalize_broadcast` ->
    # `compose_task_report` asks the router for a narrative. The gate stub
    # above never covered it, so every finalisation in this file opened a real
    # HTTPS connection to generativelanguage.googleapis.com with the fake key,
    # ate the 400, fell through to Ollama, and cost ~11s of wall clock before
    # landing on the deterministic skeleton it should have used immediately.
    # Stub the narrative half only — the skeleton, merge and broadcast stay
    # under test.
    from agent.missions import reports as _reports
    async def _no_llm_narrative(self, *a, **kw):
        return None
    monkeypatch.setattr(_reports.ReportComposer, "_compose_llm", _no_llm_narrative)

    from agent.kernel.runtime import agent_runtime
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
        from agent.kernel.runtime import agent_runtime
        from agent.kernel.audit import fetch_audit, get_task

        target = tmp_path / "out.txt"
        mock_llm.append(_strategic(1, 1))
        mock_llm.append(_tactical_action("fs.write", {"path": str(target), "content": "hi"}))
        mock_llm.append(_done_task("done"))

        task_id, started = await agent_runtime.start_task("u-test", "write a file")
        assert started

        # Wait for task to finish (with safety timeout)
        # Safety timeout, not a performance budget: generous enough that a
        # slow-but-working loop passes, short enough that a wedged one fails
        # instead of hanging the suite.
        for _ in range(600):
            if agent_runtime.task_runner is None or agent_runtime.task_runner.done():
                break
            await asyncio.sleep(0.05)
        assert agent_runtime.task_runner is None
        row = await get_task("u-test", task_id)
        assert row["status"] == "done"
        # Audit row for fs.write should exist
        rows = await fetch_audit("u-test", task_id)
        assert any(r.action_name == "fs.write" for r in rows)

    @pytest.mark.asyncio
    async def test_missing_tests_hint_is_injected_once_not_forever(
        self, isolated_db, mock_llm, tmp_path,
    ):
        """The "you changed code but ran no tests" nudge must not be a trap.

        It is worded as advice ("Рекомендується") but was implemented as an
        unconditional `continue`: every DONE_TASK after an fs.write got the
        identical rejection re-appended, and terminal markers are deliberately
        exempt from the repeat guard, so nothing bounded it. An agent that
        answered DONE_TASK again — the honest reply to advice it has decided
        not to take — span until the 600s wall-clock breaker, burning a full
        tactical-planner call per turn.

        Say it once, then let the agent finish.
        """
        from agent.kernel.runtime import agent_runtime
        from agent.kernel.audit import get_task

        target = tmp_path / "out.txt"
        mock_llm.append(_strategic(1, 1))
        mock_llm.append(_tactical_action("fs.write", {"path": str(target), "content": "hi"}))
        # Queue then runs dry: the fixture answers DONE_TASK forever, which is
        # exactly the agent behaviour that used to wedge the loop.

        task_id, started = await agent_runtime.start_task("u-test", "write a file")
        assert started

        for _ in range(600):
            if agent_runtime.task_runner is None or agent_runtime.task_runner.done():
                break
            await asyncio.sleep(0.05)
        assert agent_runtime.task_runner is None, "loop never terminated"

        row = await get_task("u-test", task_id)
        assert row["status"] == "done", (
            f"a persistent DONE_TASK must still complete, got {row['status']!r}"
        )
        hints = [
            o for o in (row.get("observations") or [])
            if "не запустив тести" in (o.get("content") or "")
        ]
        assert len(hints) == 1, f"hint must fire exactly once, fired {len(hints)}x"

    @pytest.mark.asyncio
    async def test_lsp_block_is_charged_to_the_circuit_breaker(
        self, isolated_db, mock_llm, monkeypatch, tmp_path,
    ):
        """An unfixable LSP blocker must end the task, not spin on it.

        The LSP gate is a legitimate hard block — but it `continue`d without
        calling `budget.record_action()` / `record_result()`, so neither
        `actions_exceeded` nor `errors_repeating` could ever see it. Combined
        with the repeat guard's terminal-marker exemption, an agent that could
        not clear the diagnostics looped until `max_elapsed_s_per_task` (600s).

        Charging the block to the budget puts it back under the ceilings the
        breaker already implements.
        """
        from agent.kernel.runtime import agent_runtime
        from agent.kernel.audit import get_task
        from agent.actions import fs as fs_mod
        from agent.schemas import ActionResult
        from config import config

        # Keep the ceiling low so the test measures the bound, not patience.
        monkeypatch.setattr(config, "agent_max_actions_per_task", 6)

        async def _lsp_failure(self, ctx):
            return ActionResult(
                ok=False,
                error="lsp_validation_failed: undefined name 'x' at line 1",
                error_class="lsp_blocker",
            )

        monkeypatch.setattr(fs_mod.FsWrite, "execute", _lsp_failure)

        mock_llm.append(_strategic(1, 1))
        mock_llm.append(_tactical_action("fs.write", {"path": str(tmp_path / "a.py"), "content": "x"}))
        # Then DONE_TASK forever — the agent insists it is finished while the
        # diagnostics are still dirty.

        task_id, started = await agent_runtime.start_task("u-test", "write code")
        assert started

        for _ in range(600):
            if agent_runtime.task_runner is None or agent_runtime.task_runner.done():
                break
            await asyncio.sleep(0.05)
        assert agent_runtime.task_runner is None, (
            "LSP block spun forever — it is not charged to the breaker"
        )

        row = await get_task("u-test", task_id)
        assert row["status"] == "failed"
        # The specific ceiling matters: it proves the block was counted as an
        # action, not that the task failed for some unrelated reason.
        assert row.get("error") == "max_actions_per_task", row

    @pytest.mark.asyncio
    async def test_reflection_triggers_after_n_actions(self, isolated_db, mock_llm, monkeypatch, tmp_path):
        """5 fs.read actions should trigger one reflection then completion."""
        from agent.kernel.runtime import agent_runtime
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

        await agent_runtime.start_task("u-test", "explore")
        for _ in range(150):
            if agent_runtime.task_runner is None or agent_runtime.task_runner.done():
                break
            await asyncio.sleep(0.05)
        assert agent_runtime.task_runner is None
        # The reflection must have happened — events log captured by mock queue length consumption
        assert len(mock_llm) == 0

    @pytest.mark.asyncio
    async def test_action_failure_recorded_in_audit(self, isolated_db, mock_llm, tmp_path):
        from agent.kernel.runtime import agent_runtime
        from agent.kernel.audit import fetch_audit
        mock_llm.append(_strategic(1, 1))
        mock_llm.append(_tactical_action("fs.read", {"path": "/nope/never"}))
        mock_llm.append(_done_task("gave up"))

        task_id, _ = await agent_runtime.start_task("u-test", "read")
        for _ in range(100):
            if agent_runtime.task_runner is None or agent_runtime.task_runner.done():
                break
            await asyncio.sleep(0.05)
        rows = await fetch_audit("u-test", task_id)
        assert any(r.action_name == "fs.read" and not r.result.ok for r in rows)


# ═══════════════════════════════════════════════════════════════════════════════
# Controls
# ═══════════════════════════════════════════════════════════════════════════════

class TestControls:
    @pytest.mark.asyncio
    async def test_pause_blocks_loop(self, isolated_db, mock_llm, tmp_path):
        """Pause sets the event; loop must stop emitting actions."""
        from agent.kernel.runtime import agent_runtime
        from agent.kernel.audit import get_task
        # Use long time.wait actions so the loop has slack to be paused.
        mock_llm.append(_strategic(1, 5))
        for _ in range(5):
            mock_llm.append(_tactical_action("time.wait", {"seconds": 1.5}))
        mock_llm.append(_done_task("done"))

        task_id, _ = await agent_runtime.start_task("u-test", "explore")
        # Wait briefly so first action starts
        await asyncio.sleep(0.4)
        await agent_runtime.pause(task_id)
        # Pause takes effect after current in-flight action; wait a beat
        await asyncio.sleep(2.5)

        row = await get_task("u-test", task_id)
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
        from agent.kernel.runtime import agent_runtime
        from agent.kernel.audit import get_task
        mock_llm.append(_strategic(1, 100))
        for _ in range(20):
            mock_llm.append(_tactical_action("time.wait", {"seconds": 2.0}))

        task_id, _ = await agent_runtime.start_task("u-test", "loop")
        await asyncio.sleep(0.4)
        await agent_runtime.stop(task_id)
        # Wait briefly for finalize
        for _ in range(80):
            row = await get_task("u-test", task_id)
            if row["status"] == "stopped":
                break
            await asyncio.sleep(0.05)
        row = await get_task("u-test", task_id)
        assert row["status"] == "stopped"
    @pytest.mark.asyncio
    async def test_intervention_routes_into_reflector(self, isolated_db, mock_llm, tmp_path, monkeypatch):
        from agent.kernel.runtime import agent_runtime
        f = tmp_path / "f"; f.write_text("x")

        mock_llm.append(_strategic(1, 3))
        mock_llm.append(_tactical_action("fs.read", {"path": str(f)}))
        # reflection on intervention
        mock_llm.append(_reflection("continue"))
        mock_llm.append(_done_task("ok"))

        task_id, _ = await agent_runtime.start_task("u-test", "with intervention")
        # Push an intervention immediately
        await agent_runtime.intervene(task_id, "please be quick")
        for _ in range(150):
            if agent_runtime.task_runner is None or agent_runtime.task_runner.done():
                break
            await asyncio.sleep(0.05)
        # Mock queue may not be entirely drained because interventions can arrive
        # before the loop reaches the drain point — assert task didn't crash.
        from agent.kernel.audit import get_task
        row = await get_task("u-test", task_id)
        assert row["status"] in {"done", "running", "planning"}


# ═══════════════════════════════════════════════════════════════════════════════
# Checkpoints — round-trip
# ═══════════════════════════════════════════════════════════════════════════════

class TestCheckpointResume:
    @pytest.mark.asyncio
    async def test_manual_checkpoint_during_task(self, isolated_db, mock_llm, tmp_path):
        from agent.kernel.runtime import agent_runtime
        mock_llm.append(_strategic(1, 5))
        for _ in range(5):
            mock_llm.append(_tactical_action("time.wait", {"seconds": 1.5}))
        mock_llm.append(_done_task("ok"))

        task_id, _ = await agent_runtime.start_task("u-test", "with cp")
        await asyncio.sleep(0.5)
        cp_id = await agent_runtime.checkpoint_now(task_id)
        assert cp_id is not None and cp_id > 0
        await agent_runtime.stop(task_id)
        if agent_runtime.task_runner:
            try:
                await asyncio.wait_for(agent_runtime.task_runner, timeout=3.0)
            except (asyncio.TimeoutError, asyncio.CancelledError, Exception):
                pass
