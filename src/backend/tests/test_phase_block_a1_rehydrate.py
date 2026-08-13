"""
Block A-1 — Crash recovery + action idempotency tests.

Covers:
  Snapshot round-trip:
    test_snapshot_task_state_round_trip
    test_snapshot_preserves_mission_bindings
    test_snapshot_wall_clock_started_at

  Rehydrate:
    test_rehydrate_terminal_status_returns_none
    test_rehydrate_in_flight_action_marked_cancelled_by_crash
    test_rehydrate_advances_step_idx_past_cancelled_action
    test_rehydrate_legacy_path_when_snapshot_missing
    test_rehydrate_missing_task_returns_none

  Boot resume:
    test_resume_live_tasks_on_boot_mounts_foreground_slot
    test_resume_live_tasks_on_boot_only_one_per_track
    test_resume_emits_resumed_from_crash_ws_event

  Mission resume:
    test_mission_resume_continues_from_current_phase_id
    test_mission_resume_planning_incomplete_replans

  Idempotency helpers:
    test_idempotency_key_deterministic_across_processes
    test_fs_write_idempotent_when_content_identical
    test_bash_run_caches_result_with_sentinel
    test_bash_run_force_rerun_bypasses_cache
    test_bash_run_cache_prunes_when_over_limit
    test_blender_run_skips_when_output_fresh
"""
from __future__ import annotations

import asyncio
import json
import os
import tempfile
import time
import uuid
from datetime import datetime, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

# Bootstrap env before any PHANTOM import.
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-block-a1")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-api-key-block-a1")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


# ── DB fixture ────────────────────────────────────────────────────────────────


@pytest_asyncio.fixture
async def isolated_db(monkeypatch, tmp_path):
    """In-memory SQLite with all PHANTOM tables, session factory patched."""
    import db.database as _dbm
    import db.models as _dm  # noqa: F401
    import importlib

    if not _dbm.Base.metadata.tables:
        importlib.reload(_dm)

    db_file = tmp_path / "phantom_a1.db"
    url = f"sqlite+aiosqlite:///{db_file}"
    engine = create_async_engine(url, echo=False, connect_args={"check_same_thread": False})
    async with engine.begin() as conn:
        await conn.run_sync(_dbm.Base.metadata.create_all)

    factory = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(_dbm, "engine", engine)
    monkeypatch.setattr(_dbm, "AsyncSessionLocal", factory)

    yield factory

    await engine.dispose()


def _uid() -> str:
    return str(uuid.uuid4())


def _make_task_state(
    *,
    task_id: str | None = None,
    user_id: str | None = None,
    goal: str = "test goal",
    status: str = "running",
    step_idx: int = 3,
    mission_id: str | None = None,
    current_phase_id: str | None = None,
) -> Any:
    """Build a minimal TaskState for testing."""
    from agent.kernel.runtime import TaskState
    from agent.schemas import SelfModel, ThoughtBudget

    sm = SelfModel(
        capabilities=["fs.read", "bash.run"],
        active_caveats=[],
        recent_task_summary="",
        # `confidence` is not a SelfModel field; it was silently dropped, so
        # the snapshot round-trip below never actually carried it.
    )
    state = TaskState(
        id=task_id or _uid(),
        user_id=user_id or _uid(),
        goal=goal,
        track="foreground",
        status=status,
        self_model=sm,
        step_idx=step_idx,
        mission_id=mission_id,
        current_phase_id=current_phase_id,
    )
    return state


async def _insert_task_row(factory, user_id: str, task_id: str,
                            status: str = "running", track: str = "foreground",
                            snapshot_json: str | None = None,
                            mission_id: str | None = None) -> None:
    """Insert a minimal agent_tasks row."""
    from db.models import AgentTask
    async with factory() as db:
        row = AgentTask(
            id=task_id,
            user_id=user_id,
            goal="test goal",
            status=status,
            track=track,
        )
        if snapshot_json is not None:
            row.runtime_snapshot_json = snapshot_json
        if mission_id is not None:
            row.mission_id = mission_id
        db.add(row)
        await db.commit()


async def _insert_audit_row(factory, user_id: str, task_id: str,
                             step_idx: int, has_result: bool = True) -> None:
    """Insert an audit entry.  has_result=False simulates a crash mid-action."""
    from db.models import AgentAuditEntry
    result_json = json.dumps({"ok": True, "output": {}}) if has_result else "{}"
    async with factory() as db:
        row = AgentAuditEntry(
            user_id=user_id,
            task_id=task_id,
            step_idx=step_idx,
            action_name="bash.run",
            args_json=json.dumps({"cmd": "echo hi"}),
            result_json=result_json,
            risk_level=3,
            elapsed_ms=100,
        )
        db.add(row)
        await db.commit()


# ── Snapshot round-trip ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_snapshot_task_state_round_trip(isolated_db):
    """Write a snapshot and read it back — TaskState fields survive the round-trip."""
    user_id = _uid()
    task_id = _uid()
    await _insert_task_row(isolated_db, user_id, task_id)

    state = _make_task_state(task_id=task_id, user_id=user_id, step_idx=7)

    from agent.kernel.rehydrate import snapshot_task_state, _state_to_snapshot, _snapshot_to_state
    snapshot_json = _state_to_snapshot(state)
    blob = json.loads(snapshot_json)

    restored = _snapshot_to_state(blob)
    assert restored.id == state.id
    assert restored.user_id == state.user_id
    assert restored.goal == state.goal
    assert restored.step_idx == 7
    assert restored.track == "foreground"
    assert restored.status == "running"


@pytest.mark.asyncio
async def test_snapshot_preserves_mission_bindings(isolated_db):
    """Mission/phase IDs survive the snapshot round-trip."""
    mission_id = _uid()
    phase_id = _uid()
    state = _make_task_state(
        mission_id=mission_id,
        current_phase_id=phase_id,
        step_idx=42,
    )
    from agent.kernel.rehydrate import _state_to_snapshot, _snapshot_to_state
    blob = json.loads(_state_to_snapshot(state))
    restored = _snapshot_to_state(blob)
    assert restored.mission_id == mission_id
    assert restored.current_phase_id == phase_id
    assert restored.step_idx == 42


@pytest.mark.asyncio
async def test_snapshot_wall_clock_started_at(isolated_db):
    """started_at_iso in snapshot is a parseable UTC ISO string."""
    state = _make_task_state()
    from agent.kernel.rehydrate import _state_to_snapshot
    blob = json.loads(_state_to_snapshot(state))
    iso = blob.get("started_at_iso")
    assert iso is not None
    dt = datetime.fromisoformat(iso)
    assert dt.tzinfo is not None


# ── Rehydrate ─────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["done", "failed", "stopped", "timeout", "cancelled"])
async def test_rehydrate_terminal_status_returns_none(isolated_db, status):
    """Terminal tasks are not resumed."""
    user_id = _uid()
    task_id = _uid()
    await _insert_task_row(isolated_db, user_id, task_id, status=status)

    runtime = MagicMock()
    from agent.kernel.rehydrate import rehydrate_task
    result = await rehydrate_task(runtime, user_id, task_id)
    assert result is None


@pytest.mark.asyncio
async def test_rehydrate_in_flight_action_marked_cancelled_by_crash(isolated_db):
    """An audit row with no 'ok' key (in-flight) gets a synthetic cancel row."""
    user_id = _uid()
    task_id = _uid()
    state = _make_task_state(task_id=task_id, user_id=user_id, step_idx=5)
    from agent.kernel.rehydrate import _state_to_snapshot
    snap = _state_to_snapshot(state)
    await _insert_task_row(isolated_db, user_id, task_id, snapshot_json=snap)
    # Insert an in-flight audit row (no 'ok' in result_json).
    await _insert_audit_row(isolated_db, user_id, task_id, step_idx=5, has_result=False)

    runtime = MagicMock()
    from agent.kernel.rehydrate import rehydrate_task
    # Patch write_audit_entry so we can verify it's called.
    with patch("agent.kernel.rehydrate._write_audit_entry_for_crash") as mock_write:
        result = await rehydrate_task(runtime, user_id, task_id)

    assert result is not None
    # The step_idx should have been advanced past the cancelled step.
    assert result.step_idx >= 5

    # The mock was created and never inspected, which let the synthetic row's
    # contents rot unnoticed: its `InnerMonologue` was built with
    # `thought=`/`plan=`/`criticism=`, none of which are fields on the model,
    # so Pydantic dropped all three and the recovery step reached the planner
    # and the UI with a completely blank monologue.
    assert mock_write.call_count == 1
    step = mock_write.call_args.kwargs["step"]
    assert step.action == "__crash_recovery__"
    mono = step.monologue
    assert "crashed" in mono.what_i_see.lower(), mono
    # The half-applied-side-effects warning is the one thing the agent most
    # needs after a crash — it must actually be carried, not defaulted away.
    assert "side" in mono.what_could_fail.lower(), mono
    assert mono.confidence == 0.0

    result_arg = mock_write.call_args.kwargs["result"]
    assert result_arg.ok is False
    assert result_arg.error_class == "cancelled_by_crash"


@pytest.mark.asyncio
async def test_rehydrate_advances_step_idx_past_cancelled_action(isolated_db):
    """After rehydrate with an in-flight step, step_idx > the crashed step."""
    user_id = _uid()
    task_id = _uid()
    # State says step_idx=3 but audit has an in-flight row at step 3.
    state = _make_task_state(task_id=task_id, user_id=user_id, step_idx=3)
    from agent.kernel.rehydrate import _state_to_snapshot
    snap = _state_to_snapshot(state)
    await _insert_task_row(isolated_db, user_id, task_id, snapshot_json=snap)
    await _insert_audit_row(isolated_db, user_id, task_id, step_idx=3, has_result=False)

    runtime = MagicMock()
    from agent.kernel.rehydrate import rehydrate_task
    result = await rehydrate_task(runtime, user_id, task_id)
    assert result is not None
    assert result.step_idx >= 4


@pytest.mark.asyncio
async def test_rehydrate_legacy_path_when_snapshot_missing(isolated_db):
    """When runtime_snapshot_json is NULL, rehydrate uses the legacy column blobs."""
    user_id = _uid()
    task_id = _uid()
    from agent.schemas import SubGoal
    sub = SubGoal(description="do thing", rationale="", expected_actions=2, acceptance_criteria="")
    sub_goals_json = json.dumps([sub.model_dump(mode="json")])

    from db.models import AgentTask
    async with isolated_db() as db:
        row = AgentTask(
            id=task_id,
            user_id=user_id,
            goal="legacy test",
            status="running",
            track="foreground",
            sub_goals_json=sub_goals_json,
        )
        # runtime_snapshot_json left NULL (legacy row)
        db.add(row)
        await db.commit()

    runtime = MagicMock()
    from agent.kernel.rehydrate import rehydrate_task
    result = await rehydrate_task(runtime, user_id, task_id)
    assert result is not None
    assert result.goal == "legacy test"
    assert len(result.sub_goals) == 1
    assert result.sub_goals[0].description == "do thing"


@pytest.mark.asyncio
async def test_rehydrate_missing_task_returns_none(isolated_db):
    """Non-existent task returns None."""
    runtime = MagicMock()
    from agent.kernel.rehydrate import rehydrate_task
    result = await rehydrate_task(runtime, _uid(), _uid())
    assert result is None


# ── Boot resume ───────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_resume_live_tasks_on_boot_mounts_foreground_slot(isolated_db):
    """One running foreground task gets mounted into foreground_slot."""
    user_id = _uid()
    task_id = _uid()
    state_obj = _make_task_state(task_id=task_id, user_id=user_id, step_idx=2)
    from agent.kernel.rehydrate import _state_to_snapshot
    snap = _state_to_snapshot(state_obj)
    await _insert_task_row(isolated_db, user_id, task_id, status="running",
                           track="foreground", snapshot_json=snap)

    from agent.kernel.runtime import AgentRuntime
    runtime = AgentRuntime()

    broadcasts = []

    async def _fake_broadcast(type_, payload):
        broadcasts.append((type_, payload))

    runtime._broadcast = _fake_broadcast

    with patch("agent.kernel.loop.run_task_loop", new_callable=AsyncMock) as mock_loop:
        mock_loop.return_value = None
        counts = await runtime.resume_live_tasks_on_boot()

    assert counts["foreground"] >= 1
    assert runtime.foreground_slot is not None
    assert runtime.foreground_slot.id == task_id


@pytest.mark.asyncio
async def test_resume_live_tasks_on_boot_only_one_per_track(isolated_db):
    """When multiple foreground tasks are live, only the newest wins; others paused."""
    user_id = _uid()
    task_id_old = _uid()
    task_id_new = _uid()

    state_old = _make_task_state(task_id=task_id_old, user_id=user_id, step_idx=1)
    state_new = _make_task_state(task_id=task_id_new, user_id=user_id, step_idx=5)

    from agent.kernel.rehydrate import _state_to_snapshot

    # Insert old task first (created_at will be earlier).
    await _insert_task_row(isolated_db, user_id, task_id_old, status="running",
                           track="foreground", snapshot_json=_state_to_snapshot(state_old))
    # Small sleep to ensure distinct timestamps.
    await asyncio.sleep(0.01)
    await _insert_task_row(isolated_db, user_id, task_id_new, status="running",
                           track="foreground", snapshot_json=_state_to_snapshot(state_new))

    from agent.kernel.runtime import AgentRuntime
    runtime = AgentRuntime()
    runtime._broadcast = AsyncMock()

    with patch("agent.kernel.loop.run_task_loop", new_callable=AsyncMock):
        counts = await runtime.resume_live_tasks_on_boot()

    # Exactly one foreground task mounted.
    assert counts["foreground"] == 1
    assert runtime.foreground_slot is not None

    # The old (loser) task should now be paused_by_crash_recovery in DB.
    from db.models import AgentTask
    async with isolated_db() as db:
        old_row = await db.get(AgentTask, task_id_old)
        # old row should be paused
        if old_row and old_row.id != runtime.foreground_slot.id:
            assert old_row.status == "paused"
            assert old_row.paused_reason == "paused_by_crash_recovery"


@pytest.mark.asyncio
async def test_resume_emits_resumed_from_crash_ws_event(isolated_db):
    """A task resumed on boot emits task.resumed_from_crash on the WS."""
    user_id = _uid()
    task_id = _uid()
    state_obj = _make_task_state(task_id=task_id, user_id=user_id, step_idx=1)
    from agent.kernel.rehydrate import _state_to_snapshot
    snap = _state_to_snapshot(state_obj)
    await _insert_task_row(isolated_db, user_id, task_id, status="running",
                           track="foreground", snapshot_json=snap)

    from agent.kernel.runtime import AgentRuntime
    runtime = AgentRuntime()

    emitted = []

    async def _capture_broadcast(type_, payload):
        emitted.append(type_)

    runtime._broadcast = _capture_broadcast

    with patch("agent.kernel.loop.run_task_loop", new_callable=AsyncMock):
        await runtime.resume_live_tasks_on_boot()

    assert "task.resumed_from_crash" in emitted


# ── Mission resume ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_mission_resume_continues_from_current_phase_id(isolated_db):
    """run_mission_loop skips completed phases and starts from current_phase_id."""
    from agent.missions.store import create_mission, create_phase, update_phase_status
    from agent.schemas import MissionBrief
    from agent.cognition.planner.mission import PhaseSpec

    user_id = _uid()
    brief = MissionBrief(brief="build a city", quality_bar="ok")
    mission = await create_mission(user_id, brief)

    # Create 3 phases.
    spec1 = PhaseSpec(
        description="Phase 1",
        rationale="r",
        success_criteria="s",
        expected_duration_h=1.0,
        artifacts=[],
    )
    spec2 = PhaseSpec(
        description="Phase 2",
        rationale="r",
        success_criteria="s",
        expected_duration_h=1.0,
        artifacts=[],
    )
    spec3 = PhaseSpec(
        description="Phase 3",
        rationale="r",
        success_criteria="s",
        expected_duration_h=1.0,
        artifacts=[],
    )
    from agent.missions.store import create_phase as _cp
    ph1 = await _cp(mission.id, spec1, idx=0)
    ph2 = await _cp(mission.id, spec2, idx=1)
    ph3 = await _cp(mission.id, spec3, idx=2)

    # Mark phase 1 as done.
    await update_phase_status(mission.id, ph1.id, "done",
                              finished_at=datetime.now(timezone.utc))

    # Build a TaskState pointing at phase 2 (crash-resume scenario).
    state = _make_task_state(
        user_id=user_id,
        mission_id=mission.id,
        current_phase_id=ph2.id,
        status="running",
    )

    from agent.kernel.runtime import AgentRuntime
    runtime = AgentRuntime()
    runtime._broadcast = AsyncMock()
    runtime._set_slot("foreground", state)

    phases_executed = []

    # Mirrors `agent.cognition.planner.phase.plan_phase` exactly — keyword-only,
    # including `revise_note`, which production added for revise/retry rounds.
    # The old positional signature raised "unexpected keyword argument
    # 'revise_note'" inside the loop's own try/except, which logged it and
    # marked the phase failed, so the resume path never ran.
    async def _fake_plan_phase(
        *, user_id, mission, phase, self_model, revise_note="", task_id=None,
    ):
        phases_executed.append(phase.id)
        from agent.schemas import StrategicPlan, SubGoal
        sg = SubGoal(description="sg", rationale="", expected_actions=1, acceptance_criteria="")
        return StrategicPlan(sub_goals=[sg], estimated_total_actions=1, risk_assessment="low")

    async def _fake_run_phase_subgoals(runtime, state):
        # Simulate phase success.
        state.status = "done"

    with patch("agent.kernel.loop.plan_phase", side_effect=_fake_plan_phase), \
         patch("agent.kernel.loop._run_phase_subgoals", side_effect=_fake_run_phase_subgoals), \
         patch("agent.missions.store.update_phase_status", new_callable=AsyncMock), \
         patch("agent.missions.store.update_mission_status", new_callable=AsyncMock), \
         patch("agent.missions.ledger.LedgerWriter.append_phase_start", new_callable=AsyncMock), \
         patch("agent.missions.ledger.LedgerWriter.mark_phase_done", new_callable=AsyncMock), \
         patch("agent.missions.ledger.LedgerWriter.append_phase_lesson", new_callable=AsyncMock), \
         patch("agent.kernel.runtime.AgentRuntime.finalize_task", new_callable=AsyncMock):
        from agent.kernel.loop import run_mission_loop
        await run_mission_loop(runtime, state)

    # Phase 1 (already done) should NOT be executed.
    assert ph1.id not in phases_executed
    # Phase 2 and 3 should be executed.
    assert ph2.id in phases_executed
    assert ph3.id in phases_executed


@pytest.mark.asyncio
async def test_mission_resume_planning_incomplete_replans(isolated_db):
    """When current_phase_id is None on resume, rehydrate infers the first non-done phase."""
    from agent.missions.store import create_mission
    from agent.schemas import MissionBrief
    from agent.cognition.planner.mission import PhaseSpec

    user_id = _uid()
    brief = MissionBrief(brief="half-planned mission", quality_bar="")
    mission = await create_mission(user_id, brief)

    spec = PhaseSpec(
        description="Phase A",
        rationale="r",
        success_criteria="s",
        expected_duration_h=0.5,
        artifacts=[],
    )
    from agent.missions.store import create_phase as _cp
    ph = await _cp(mission.id, spec, idx=0)

    state = _make_task_state(
        user_id=user_id,
        mission_id=mission.id,
        current_phase_id=None,   # Not set — planning was incomplete.
        status="running",
    )
    from agent.kernel.rehydrate import _verify_mission_resumable
    result = await _verify_mission_resumable(state)
    assert result is not None
    # current_phase_id should be inferred as ph.id (first non-done phase).
    assert result.current_phase_id == ph.id


# ── Idempotency helpers ───────────────────────────────────────────────────────


def test_idempotency_key_deterministic_across_processes():
    """Same inputs always produce the same key."""
    from agent.actions._idempotency import idempotency_key
    args = {"cmd": "apt install vim", "profile": "compute"}
    k1 = idempotency_key(task_id="abc", step_idx=3, action_name="bash.run", args=args)
    k2 = idempotency_key(task_id="abc", step_idx=3, action_name="bash.run", args=args)
    # Different args → different key.
    k3 = idempotency_key(task_id="abc", step_idx=3, action_name="bash.run",
                          args={"cmd": "apt install tmux", "profile": "compute"})
    assert k1 == k2
    assert k1 != k3
    # Case and whitespace normalised.
    k4 = idempotency_key(task_id="abc", step_idx=3, action_name="bash.run",
                          args={"cmd": "APT INSTALL VIM ", "profile": "COMPUTE"})
    assert k1 == k4


@pytest.mark.asyncio
async def test_fs_write_idempotent_when_content_identical(tmp_path):
    """fs.write returns ok=True + skipped=idempotent when file already has same content."""
    target = tmp_path / "test.txt"
    content = "hello world"
    target.write_text(content, encoding="utf-8")

    from agent.actions.fs import FsWrite
    from agent.actions.base import ActionContext

    action = FsWrite(path=str(target), content=content)
    ctx = ActionContext(
        task_id=_uid(),
        step_idx=0,
        workspace_dir=str(tmp_path),
        runtime=MagicMock(),
    )
    result = await action.execute(ctx)
    assert result.ok is True
    assert isinstance(result.output, dict)
    assert result.output.get("skipped") == "idempotent"
    # Verify file was NOT rewritten (mtime unchanged).
    mtime_before = target.stat().st_mtime
    result2 = await action.execute(ctx)
    assert result2.ok is True
    assert target.stat().st_mtime == mtime_before


@pytest.mark.asyncio
async def test_bash_run_caches_result_with_sentinel(tmp_path):
    """bash.run persists sentinel on first run and returns cached result on second."""
    from agent.actions.bash import BashRun
    from agent.actions.base import ActionContext
    from agent.schemas import ActionResult

    action = BashRun(cmd="echo hello_idempotent", timeout_s=5, sandboxed=False)
    ctx = ActionContext(
        task_id="task-123",
        step_idx=1,
        workspace_dir=str(tmp_path),
        runtime=MagicMock(),
    )

    call_count = 0
    original_exec = asyncio.create_subprocess_exec

    async def _counted_exec(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        return await original_exec(*args, **kwargs)

    with patch("asyncio.create_subprocess_exec", side_effect=_counted_exec):
        result1 = await action.execute(ctx)

    assert result1.ok is True
    assert call_count == 1

    # Second run — should be served from cache (no subprocess).
    call_count2 = 0
    with patch("asyncio.create_subprocess_exec", side_effect=_counted_exec):
        result2 = await action.execute(ctx)

    # call_count should not have increased.
    assert call_count2 == 0
    assert result2.ok is True


@pytest.mark.asyncio
async def test_bash_run_force_rerun_bypasses_cache(tmp_path):
    """force_rerun=True ignores sentinel and always runs the command."""
    from agent.actions.bash import BashRun
    from agent.actions.base import ActionContext

    # First run without force_rerun to populate cache.
    action = BashRun(cmd="echo cache_me", timeout_s=5, sandboxed=False)
    ctx = ActionContext(
        task_id="task-force",
        step_idx=2,
        workspace_dir=str(tmp_path),
        runtime=MagicMock(),
    )

    original_exec = asyncio.create_subprocess_exec
    call_count = 0

    async def _counted_exec(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        return await original_exec(*args, **kwargs)

    with patch("asyncio.create_subprocess_exec", side_effect=_counted_exec):
        await action.execute(ctx)

    assert call_count == 1

    # Now run with force_rerun=True — must NOT use cache.
    action_force = BashRun(cmd="echo cache_me", timeout_s=5, sandboxed=False,
                           force_rerun=True)
    with patch("asyncio.create_subprocess_exec", side_effect=_counted_exec):
        result = await action_force.execute(ctx)

    assert call_count == 2  # subprocess was called again
    assert result.ok is True


def test_bash_run_cache_prunes_when_over_limit(tmp_path):
    """Sentinel directory is pruned to <= limit when over _SENTINEL_MAX_ENTRIES."""
    from agent.actions._idempotency import (
        _SENTINEL_MAX_ENTRIES,
        _prune_if_needed,
        sentinel_cache_dir,
    )
    import json

    cache_dir = sentinel_cache_dir(str(tmp_path))
    # Write _SENTINEL_MAX_ENTRIES + 50 fake sentinel files.
    n = _SENTINEL_MAX_ENTRIES + 50
    for i in range(n):
        p = os.path.join(cache_dir, f"fake{i:05d}.json")
        with open(p, "w") as fh:
            json.dump({"ok": True}, fh)
        # Set incrementally older mtimes so LRU ordering is deterministic.
        os.utime(p, (time.time() - (n - i), time.time() - (n - i)))

    _prune_if_needed(cache_dir)

    remaining = [f for f in os.listdir(cache_dir) if f.endswith(".json")]
    assert len(remaining) <= _SENTINEL_MAX_ENTRIES


@pytest.mark.asyncio
async def test_blender_run_skips_when_output_fresh(tmp_path):
    """blender.run returns skipped=output_already_fresh when output is newer than script."""
    script = tmp_path / "city.py"
    script.write_text("# blender script")
    output = tmp_path / "render.png"
    output.write_bytes(b"\x89PNG")

    # Ensure output mtime > script mtime.
    script_mtime = script.stat().st_mtime
    os.utime(str(output), (script_mtime + 10, script_mtime + 10))

    from agent.actions.device import BlenderRun
    from agent.actions.base import ActionContext

    action = BlenderRun(
        script_path=str(script),
        output_path=str(output),
        timeout_s=30,
    )
    ctx = ActionContext(
        task_id=_uid(),
        step_idx=0,
        workspace_dir=str(tmp_path),
        runtime=MagicMock(),
    )

    with patch("shutil.which", return_value="/usr/bin/blender"):
        result = await action.execute(ctx)

    assert result.ok is True
    assert isinstance(result.output, dict)
    assert result.output.get("skipped") == "output_already_fresh"
    assert result.output.get("output_path") == str(output)
