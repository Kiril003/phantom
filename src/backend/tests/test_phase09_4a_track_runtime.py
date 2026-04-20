"""
Phase 9.4a — multi-track runtime tests.

Covers:
  * Track-aware start_task dispatch + queueing
  * TrackBusyError when background queue is full
  * Background timeout → finalize with status='timeout'
  * Background broadcast discipline: substate suppressed, boundaries go
    to the `background_events` WS channel
  * Background LLM budget uses
    agent_max_llm_calls_per_background_task (tighter cap)
  * Shared SelfModel + emotion across concurrent foreground + background
"""
from __future__ import annotations

import asyncio
import json
import os
import tempfile

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase094a-track")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-api-key-for-tests")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


# ── Fixtures ────────────────────────────────────────────────────────────────


@pytest_asyncio.fixture
async def isolated_db(monkeypatch):
    import db.database as _dbm
    import db.models as _dm  # noqa: F401
    import importlib
    if not _dbm.Base.metadata.tables:
        importlib.reload(_dm)

    fd, tmp_file = tempfile.mkstemp(suffix=".db", prefix="phantom_p94a_")
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


@pytest.fixture(autouse=True)
def isolate_runtime(monkeypatch, tmp_path):
    """Reset the singleton runtime state between tests."""
    from config import config
    monkeypatch.setattr(config, "agent_workspace_dir", str(tmp_path))
    monkeypatch.setattr(config, "agent_reflection_every_n_actions", 5)
    monkeypatch.setattr(config, "agent_max_actions_per_task", 20)

    from agent.runtime import agent_runtime
    agent_runtime.foreground_slot = None
    agent_runtime.background_slot = None
    agent_runtime.task_runner = None
    agent_runtime.background_runner = None
    agent_runtime._track_queues["foreground"].clear()
    agent_runtime._track_queues["background"].clear()
    agent_runtime.controls.reset()
    agent_runtime.foreground_substate = "idle"
    agent_runtime.background_substate = "idle"
    yield
    agent_runtime.foreground_slot = None
    agent_runtime.background_slot = None
    agent_runtime.task_runner = None
    agent_runtime.background_runner = None
    agent_runtime._track_queues["foreground"].clear()
    agent_runtime._track_queues["background"].clear()
    agent_runtime.controls.reset()


@pytest.fixture
def mock_llm(monkeypatch):
    """Script the LLM — produces a benign DONE_TASK if queue runs dry."""
    queue: list[str] = []

    async def fake_call(prompt: str) -> str:
        if not queue:
            return json.dumps({
                "action": "DONE_TASK",
                "args": {"summary": "queue exhausted"},
                "intent": "exit",
                "monologue": {
                    "what_i_see": "ok", "what_i_plan": "exit",
                    "why_this_works": "done", "what_could_fail": "nothing",
                    "objection": None, "confidence": 1.0,
                },
            })
        return queue.pop(0)

    from agent.planner import _llm
    from agent.memory import recall as _recall_mod
    from agent.memory import seeds as _seeds
    from config import config as _cfg
    monkeypatch.setattr(_llm, "_call", fake_call)
    monkeypatch.setattr(_cfg, "agent_use_native_tool_calling", False)

    async def _stub_summary(**kw):
        return f"stub-{kw.get('goal','?')}"
    async def _stub_recall(query, k=None):
        return []
    async def _stub_write_episode(**kw):
        return ""
    monkeypatch.setattr(_seeds, "compose_summary", _stub_summary)
    monkeypatch.setattr(_recall_mod, "recall", _stub_recall)
    monkeypatch.setattr(_seeds, "write_episode", _stub_write_episode)
    return queue


def _strategic(num_subgoals: int = 1) -> str:
    return json.dumps({
        "sub_goals": [
            {"description": f"sg{i}", "rationale": "r",
             "expected_actions": 1, "acceptance_criteria": "ok"}
            for i in range(num_subgoals)
        ],
        "estimated_total_actions": num_subgoals,
        "risk_assessment": "low",
    })


def _tactical(action: str, args: dict | None = None) -> str:
    return json.dumps({
        "action": action, "args": args or {}, "intent": "i",
        "monologue": {
            "what_i_see": "x", "what_i_plan": "y",
            "why_this_works": "z", "what_could_fail": "f",
            "objection": None, "confidence": 0.9,
        },
    })


def _done(summary: str = "ok") -> str:
    return _tactical("DONE_TASK", {"summary": summary})


async def _wait_for_done(slot_getter, timeout=3.0):
    """Spin until the slot releases (task finalized)."""
    start = asyncio.get_event_loop().time()
    while slot_getter() is not None:
        if asyncio.get_event_loop().time() - start > timeout:
            raise AssertionError("task did not finalize within timeout")
        await asyncio.sleep(0.02)


# ── 1. Backward compat: track=foreground default ───────────────────────────


class TestForegroundDefault:
    @pytest.mark.asyncio
    async def test_start_task_defaults_to_foreground(self, isolated_db, mock_llm):
        from agent.runtime import agent_runtime as rt
        mock_llm.extend([_strategic(1), _done()])

        task_id, started = await rt.start_task("hello world")
        assert started is True
        assert task_id
        # Immediately after spawn, the slot should be populated on the
        # foreground side and background should still be empty.
        assert rt.foreground_slot is not None
        assert rt.foreground_slot.track == "foreground"
        assert rt.background_slot is None
        await _wait_for_done(lambda: rt.foreground_slot)

    @pytest.mark.asyncio
    async def test_foreground_busy_refuses_instead_of_queuing(self, isolated_db, mock_llm):
        """Preserve Phase 9.1 contract: foreground refuses while busy."""
        from agent.runtime import agent_runtime as rt
        mock_llm.extend([_strategic(1), _done(), _strategic(1), _done()])

        id1, started1 = await rt.start_task("first")
        assert started1 is True
        id2, started2 = await rt.start_task("second")
        # Second foreground call returns the existing id, started=False, and
        # does NOT queue.
        assert started2 is False
        assert id2 == id1
        assert len(rt._track_queues["foreground"]) == 0
        await _wait_for_done(lambda: rt.foreground_slot)


# ── 2. Background track ─────────────────────────────────────────────────────


class TestBackgroundTrack:
    @pytest.mark.asyncio
    async def test_background_task_runs_on_background_slot(self, isolated_db, mock_llm):
        from agent.runtime import agent_runtime as rt
        mock_llm.extend([_strategic(1), _done("bg-ok")])

        task_id, started = await rt.start_task("bg goal", track="background")
        assert started is True
        assert rt.background_slot is not None
        assert rt.background_slot.track == "background"
        assert rt.foreground_slot is None
        await _wait_for_done(lambda: rt.background_slot)

    @pytest.mark.asyncio
    async def test_concurrent_foreground_and_background(self, isolated_db, mock_llm):
        """Both tracks run independently."""
        from agent.runtime import agent_runtime as rt
        # Queue both plans + terminals. Order doesn't matter — each
        # task pulls from the same scripted queue; as long as there are 4
        # responses, the order interleaves naturally.
        mock_llm.extend([_strategic(1), _strategic(1), _done("fg"), _done("bg")])

        fg_id, fg_started = await rt.start_task("foreground")
        bg_id, bg_started = await rt.start_task("background", track="background")
        assert fg_started is True
        assert bg_started is True
        assert fg_id != bg_id
        assert rt.foreground_slot is not None
        assert rt.background_slot is not None
        await _wait_for_done(lambda: rt.foreground_slot, timeout=4.0)
        await _wait_for_done(lambda: rt.background_slot, timeout=4.0)


# ── 3. Queue behavior ───────────────────────────────────────────────────────


class TestBackgroundQueue:
    @pytest.mark.asyncio
    async def test_background_busy_queues(self, isolated_db):
        """When background slot is occupied, new start_task queues the work."""
        from agent.runtime import agent_runtime as rt
        from agent.runtime import TaskState
        from agent.self_model import build_self_model
        from agent.actions.registry import registry

        # Plant a long-running background task directly on the slot so
        # new start_task calls hit the queueing branch without spinning
        # the loop.
        sm = await build_self_model(registry)
        rt.background_slot = TaskState(
            id="occupier", goal="occupy", track="background",
            status="running", self_model=sm,
        )
        try:
            id_a, started_a = await rt.start_task("bg a", track="background")
            id_b, started_b = await rt.start_task("bg b", track="background")
            assert started_a is False  # queued, not started
            assert started_b is False
            assert len(rt._track_queues["background"]) == 2
            queued_ids = [q.task_id for q in rt._track_queues["background"]]
            assert id_a in queued_ids and id_b in queued_ids
        finally:
            rt.background_slot = None
            rt._track_queues["background"].clear()

    @pytest.mark.asyncio
    async def test_background_queue_full_raises(self, isolated_db, monkeypatch):
        from agent.runtime import agent_runtime as rt
        from agent.runtime import TaskState, QueuedTask
        from agent.errors import TrackBusyError
        from agent.self_model import build_self_model
        from agent.actions.registry import registry

        sm = await build_self_model(registry)
        rt.background_slot = TaskState(
            id="occupier", goal="occupy", track="background",
            status="running", self_model=sm,
        )
        # Fill the queue to its maxlen directly.
        q = rt._track_queues["background"]
        maxlen = q.maxlen
        for i in range(maxlen):
            q.append(QueuedTask(
                task_id=f"t{i}", goal=f"g{i}", origin="test",
                track="background", order_id=None, timeout_s=None,
            ))
        try:
            with pytest.raises(TrackBusyError) as exc_info:
                await rt.start_task("overflow", track="background")
            assert exc_info.value.track == "background"
            assert exc_info.value.queue_size == maxlen
        finally:
            rt.background_slot = None
            q.clear()


# ── 4. Background timeout ──────────────────────────────────────────────────


class TestBackgroundTimeout:
    @pytest.mark.asyncio
    async def test_background_timeout_finalizes_as_timeout(
        self, isolated_db, mock_llm, monkeypatch,
    ):
        """Override per-task timeout to 1s; a never-terminating script exceeds."""
        from agent.runtime import agent_runtime as rt
        from agent.audit import get_task

        # Plan has 1 sub-goal but we make tactical sleep forever by returning
        # action that the real executor doesn't know — loop will keep
        # looping. Simpler approach: set up tactical to return an action
        # that reflects (infinite reflect loop) — but cleaner: stub the
        # tactical plan to sleep.
        mock_llm.extend([_strategic(1)])

        from agent.planner import tactical as _tactical_mod
        async def _slow_plan(**kw):
            await asyncio.sleep(10.0)
            raise RuntimeError("should not reach")
        monkeypatch.setattr(_tactical_mod, "plan", _slow_plan)

        task_id, started = await rt.start_task(
            "slow bg", track="background", timeout_s=1,
        )
        assert started is True
        # Wait up to 3s for the timeout path to finalize.
        await _wait_for_done(lambda: rt.background_slot, timeout=4.0)
        row = await get_task(task_id)
        assert row is not None
        assert row["status"] == "timeout"


# ── 5. Background LLM budget ───────────────────────────────────────────────


class TestBackgroundBudget:
    @pytest.mark.asyncio
    async def test_note_llm_call_uses_background_cap(self, isolated_db, monkeypatch):
        """Background tasks hit the tighter per-task cap."""
        from config import config
        from agent.runtime import agent_runtime as rt, TaskState
        from agent.self_model import build_self_model
        from agent.actions.registry import registry

        monkeypatch.setattr(config, "agent_max_llm_calls_per_background_task", 3)
        monkeypatch.setattr(config, "agent_warn_llm_calls_per_background_task", 2)

        sm = await build_self_model(registry)
        rt.background_slot = TaskState(
            id="bgcap", goal="g", track="background",
            status="running", self_model=sm,
        )
        try:
            # 1st and 2nd calls OK; 3rd hits cap → False.
            assert await rt.note_llm_call("bgcap") is True
            assert await rt.note_llm_call("bgcap") is True
            assert await rt.note_llm_call("bgcap") is False
        finally:
            rt.background_slot = None


# ── 6. Broadcast discipline ────────────────────────────────────────────────


class TestBroadcastDiscipline:
    @pytest.mark.asyncio
    async def test_background_substate_not_broadcast(self, monkeypatch):
        """set_substate on background logs only — no WS emission."""
        from agent.runtime import agent_runtime as rt, current_track

        # Capture hub broadcasts.
        captured: list[tuple[str, str, dict]] = []

        class FakeHub:
            async def broadcast(self, channel, type_, payload):
                captured.append((channel, type_, payload))

        import api.websocket_hub as _hubmod
        monkeypatch.setattr(_hubmod, "hub", FakeHub())

        token = current_track.set("background")
        try:
            await rt.set_substate("thinking")
            await rt.set_substate("acting")
        finally:
            current_track.reset(token)

        # No agent.stream channel emission for background substate changes.
        agent_stream = [c for c in captured if c[0] == "agent.stream"]
        assert agent_stream == []
        # But internal state tracks it.
        assert rt.background_substate == "acting"

    @pytest.mark.asyncio
    async def test_background_boundary_routes_to_background_events(self, monkeypatch):
        """task.started/completed/failed for bg go to `background_events` channel."""
        from agent.runtime import agent_runtime as rt, current_track

        captured: list[tuple[str, str, dict]] = []

        class FakeHub:
            async def broadcast(self, channel, type_, payload):
                captured.append((channel, type_, payload))

        import api.websocket_hub as _hubmod
        monkeypatch.setattr(_hubmod, "hub", FakeHub())

        token = current_track.set("background")
        try:
            await rt._broadcast("task.started", {"task_id": "bgx"})
            await rt._broadcast("task.completed", {"task_id": "bgx"})
            # Non-boundary event is silenced entirely.
            await rt._broadcast("observation.added", {"task_id": "bgx"})
        finally:
            current_track.reset(token)

        channels = [c[0] for c in captured]
        assert "background_events" in channels
        # Observation.added on bg must not escape.
        types_ = [c[1] for c in captured]
        assert "observation.added" not in types_

    @pytest.mark.asyncio
    async def test_foreground_broadcast_still_uses_agent_stream(self, monkeypatch):
        from agent.runtime import agent_runtime as rt, current_track

        captured: list[tuple[str, str, dict]] = []

        class FakeHub:
            async def broadcast(self, channel, type_, payload):
                captured.append((channel, type_, payload))

        import api.websocket_hub as _hubmod
        monkeypatch.setattr(_hubmod, "hub", FakeHub())

        token = current_track.set("foreground")
        try:
            await rt._broadcast("task.started", {"task_id": "fgx"})
            await rt._broadcast("observation.added", {"task_id": "fgx"})
        finally:
            current_track.reset(token)

        channels = {c[0] for c in captured}
        assert channels == {"agent.stream"}


# ── 7. Shared state across tracks ──────────────────────────────────────────


class TestSharedState:
    @pytest.mark.asyncio
    async def test_self_model_shared_semantics(self, isolated_db, mock_llm):
        """Foreground + background each get a SelfModel built from the same
        registry; emotion/capabilities/etc. reflect the same environment."""
        from agent.runtime import agent_runtime as rt
        mock_llm.extend([_strategic(1), _strategic(1), _done(), _done()])

        await rt.start_task("fg", track="foreground")
        await rt.start_task("bg", track="background")
        assert rt.foreground_slot is not None
        assert rt.background_slot is not None
        # Both SelfModels reference the same registry/capabilities. We don't
        # require object identity (each task gets a fresh build) but the
        # *shape* must match.
        fg_caps = sorted(str(c) for c in rt.foreground_slot.self_model.capabilities)
        bg_caps = sorted(str(c) for c in rt.background_slot.self_model.capabilities)
        assert fg_caps == bg_caps
        await _wait_for_done(lambda: rt.foreground_slot, timeout=4.0)
        await _wait_for_done(lambda: rt.background_slot, timeout=4.0)
