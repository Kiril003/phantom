"""
Block A-1 — Task rehydration: rebuild TaskState from persisted audit + snapshot.

rehydrate_task(runtime, user_id, task_id)
  → TaskState ready to be set_slot()'d, or None if terminal.

resume_live_tasks_on_boot(runtime)
  → dict[str, int] count summary for logging.
"""
from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

from sqlalchemy import select

from db.database import get_session
from db.models import AgentAuditEntry, AgentTask

from agent.schemas import (
    Observation,
    SelfModel,
    StrategicPlan,
    SubGoal,
    TaskStatus,
    ThoughtBudget,
    Track,
)

if TYPE_CHECKING:
    from agent.kernel.runtime import AgentRuntime, TaskState

logger = logging.getLogger(__name__)


def _write_audit_entry_for_crash(*args: Any, **kwargs: Any) -> Any:
    """Module-level shim so tests can patch 'agent.rehydrate._write_audit_entry_for_crash'.

    At runtime this delegates to audit.write_audit_entry.  The indirection is
    intentional: it gives tests a stable patch target without coupling them to
    the audit module's internal structure.
    """
    from agent.kernel.audit import write_audit_entry
    return write_audit_entry(*args, **kwargs)

# Statuses that mean the task is finished — do not resume.
_TERMINAL_STATUSES: frozenset[str] = frozenset(
    {"done", "failed", "stopped", "timeout", "cancelled"}
)

# Statuses that are resumable on boot.
_RESUMABLE_STATUSES: frozenset[str] = frozenset(
    {"planning", "running", "paused", "awaiting_user", "blocked_quota"}
)


# ── Snapshot round-trip helpers ───────────────────────────────────────────────


def _state_to_snapshot(state: "TaskState") -> str:
    """Serialize the full TaskState to a JSON string for DB storage.

    `started_at` is stored as a wall-clock ISO string so it survives
    process restarts (monotonic clocks don't cross process boundaries).
    """
    # Convert monotonic started_at → wall clock for cross-process portability.
    # The approximation: now_wall - (now_mono - started_at_mono).
    wall_started_at: str | None = None
    try:
        mono_offset = time.monotonic() - state.started_at
        wall_dt = datetime.now(timezone.utc).timestamp() - mono_offset
        wall_started_at = datetime.fromtimestamp(wall_dt, tz=timezone.utc).isoformat()
    except Exception:
        wall_started_at = datetime.now(timezone.utc).isoformat()

    blob: dict[str, Any] = {
        "id": state.id,
        "user_id": state.user_id,
        "goal": state.goal,
        "track": state.track,
        "status": state.status,
        "sub_goals": [sg.model_dump(mode="json") for sg in state.sub_goals],
        "observations": [o.model_dump(mode="json") for o in state.observations[-50:]],
        "active_sub_goal_id": state.active_sub_goal_id,
        "step_idx": state.step_idx,
        "thought_budget": state.thought_budget.model_dump(mode="json"),
        "self_model": state.self_model.model_dump(mode="json"),
        "strategic_plan": state.strategic_plan.model_dump(mode="json") if state.strategic_plan else None,
        "error": state.error,
        "paused_reason": state.paused_reason,
        "mission_id": state.mission_id,
        "current_phase_id": state.current_phase_id,
        "unsafe_mode": state.unsafe_mode,
        "parent_task_id": state.parent_task_id,
        "subagent_role": state.subagent_role,
        "delegation_depth": state.delegation_depth,
        "origin": state.origin,
        "order_id": state.order_id,
        "timeout_s": state.timeout_s,
        "llm_calls_this_task": state.llm_calls_this_task,
        "started_at_iso": wall_started_at,
        "promoted_to_background_at": state.promoted_to_background_at,
        "progress_checkpoints": list(state.progress_checkpoints)[-20:],
        "quality_gate_failures": state.quality_gate_failures,
    }
    return json.dumps(blob, default=str)


def _snapshot_to_state(blob: dict[str, Any]) -> "TaskState":
    """Rebuild a TaskState from a snapshot dict.  Missing keys fall back to
    defaults so old snapshots that predate new fields are still loadable."""
    from agent.kernel.runtime import TaskState as _TaskState

    sub_goals = [SubGoal(**sg) for sg in (blob.get("sub_goals") or [])]
    observations = [Observation(**o) for o in (blob.get("observations") or [])]

    thought_budget_raw = blob.get("thought_budget") or {}
    try:
        thought_budget = ThoughtBudget(**thought_budget_raw)
    except Exception:
        thought_budget = ThoughtBudget()

    self_model_raw = blob.get("self_model") or {}
    try:
        self_model = SelfModel(**self_model_raw)
    except Exception:
        # `confidence` is not a field on SelfModel — it was silently dropped.
        # Every other keyword here is already the model's own default, so this
        # fallback is exactly an empty SelfModel; keep it explicit for intent.
        self_model = SelfModel(
            capabilities=[],
            active_caveats=[],
            recent_task_summary="",
        )

    # Convert wall-clock ISO string back to a monotonic approximation.
    # The approximation is: started_at_mono ≈ now_mono - (now_wall - started_at_wall)
    started_at_mono = time.monotonic()
    started_at_iso = blob.get("started_at_iso")
    if started_at_iso:
        try:
            started_wall = datetime.fromisoformat(started_at_iso).timestamp()
            elapsed = datetime.now(timezone.utc).timestamp() - started_wall
            started_at_mono = time.monotonic() - elapsed
        except Exception:
            pass

    # Phase 28-IDEAL
    sp_raw = blob.get("strategic_plan")
    strategic_plan = StrategicPlan(**sp_raw) if sp_raw else None

    return _TaskState(
        id=blob["id"],
        user_id=blob["user_id"],
        goal=blob["goal"],
        track=blob.get("track", "foreground"),
        status=blob.get("status", "running"),
        self_model=self_model,
        strategic_plan=strategic_plan,
        sub_goals=sub_goals,

        observations=observations,
        active_sub_goal_id=blob.get("active_sub_goal_id"),
        step_idx=int(blob.get("step_idx", 0)),
        thought_budget=thought_budget,
        error=blob.get("error"),
        paused_reason=blob.get("paused_reason"),
        mission_id=blob.get("mission_id"),
        current_phase_id=blob.get("current_phase_id"),
        # Missing key in an old checkpoint blob must rehydrate leashed —
        # a resumed task should never acquire a waiver it was not started
        # with just because the field predates the checkpoint.
        unsafe_mode=bool(blob.get("unsafe_mode", False)),
        parent_task_id=blob.get("parent_task_id"),
        subagent_role=blob.get("subagent_role"),
        delegation_depth=int(blob.get("delegation_depth", 0)),
        origin=blob.get("origin", "user"),
        order_id=blob.get("order_id"),
        timeout_s=blob.get("timeout_s"),
        llm_calls_this_task=int(blob.get("llm_calls_this_task", 0)),
        started_at=started_at_mono,
        promoted_to_background_at=blob.get("promoted_to_background_at"),
        progress_checkpoints=list(blob.get("progress_checkpoints") or []),
        quality_gate_failures=int(blob.get("quality_gate_failures", 0)),
    )


# ── DB persistence helpers ────────────────────────────────────────────────────


async def snapshot_task_state(state: "TaskState") -> None:
    """Persist a full TaskState snapshot to agent_tasks.runtime_snapshot_json.

    Called after each completed step, at every Council-engaged moment,
    and on every set_substate to awaiting_user / paused / blocked_quota.
    Best-effort: any failure is logged but never propagates.
    """
    try:
        snapshot_json = _state_to_snapshot(state)
        async with get_session() as db:
            row = await db.get(AgentTask, state.id)
            if row is None:
                return
            row.runtime_snapshot_json = snapshot_json  # type: ignore[attr-defined]
            await db.commit()
    except Exception as exc:
        logger.debug("snapshot_task_state: failed for task %s: %s", state.id[:8], exc)


# ── Core rehydrate logic ──────────────────────────────────────────────────────


async def rehydrate_task(
    runtime: "AgentRuntime",
    user_id: str,
    task_id: str,
) -> "TaskState | None":
    """Rebuild TaskState from persisted audit + snapshot.

    Returns None if the task is finished/cancelled or not found.
    The caller mounts the returned TaskState into the appropriate slot
    and resumes the loop.

    Strategy:
      1. Load agent_tasks row. Terminal status → return None.
      2. If runtime_snapshot_json exists, decode it → TaskState.
      3. Else: rebuild from the column-level fields (legacy path).
      4. If mission_id is set, verify the mission is resumable and load
         current_phase_id from the mission store if missing.
      5. Mark any in-flight action as cancelled_by_crash.
      6. Return the TaskState ready to be set_slot()'d.
    """
    async with get_session() as db:
        row = await db.get(AgentTask, task_id)
        if row is None or row.user_id != user_id:
            return None

        status = row.status or ""
        if status in _TERMINAL_STATUSES:
            logger.debug(
                "rehydrate_task: task %s is terminal (%s), skipping", task_id[:8], status
            )
            return None

        # ── Step 2: snapshot path ────────────────────────────────────────────
        snapshot_json: str | None = getattr(row, "runtime_snapshot_json", None)
        if snapshot_json:
            try:
                blob = json.loads(snapshot_json)
                state = _snapshot_to_state(blob)
                logger.debug(
                    "rehydrate_task: loaded from snapshot (task=%s step=%d)",
                    task_id[:8], state.step_idx,
                )
            except Exception as exc:
                logger.warning(
                    "rehydrate_task: snapshot decode failed (%s), falling back", exc
                )
                state = await _rehydrate_from_columns(row)
        else:
            # ── Step 3: legacy column path ───────────────────────────────────
            state = await _rehydrate_from_columns(row)
            logger.debug(
                "rehydrate_task: loaded from legacy columns (task=%s)", task_id[:8]
            )

    # ── Step 4: mission verification ─────────────────────────────────────────
    if state.mission_id:
        state = await _verify_mission_resumable(state)
        if state is None:
            return None

    # ── Step 5: mark in-flight actions as cancelled_by_crash ─────────────────
    state = await _mark_inflight_cancelled(user_id, task_id, state)

    # Always set status to a runnable state after rehydrate.
    if state.status in ("running", "planning"):
        state.status = "running"
    elif state.status in ("paused", "awaiting_user", "blocked_quota"):
        # Keep the paused state so the loop gate re-engages correctly.
        pass
    else:
        state.status = "running"

    return state


async def _rehydrate_from_columns(row: AgentTask) -> "TaskState":
    """Build a minimal TaskState from the legacy per-column blobs."""
    from agent.kernel.runtime import TaskState as _TaskState

    def _load_json(s: str | None, default: Any) -> Any:
        if not s:
            return default
        try:
            return json.loads(s)
        except Exception:
            return default

    sub_goals_raw = _load_json(row.sub_goals_json, [])
    observations_raw = _load_json(row.observations_json, [])
    self_model_raw = _load_json(row.self_model_json, {})
    thought_budget_raw = _load_json(row.thought_budget_json, {})

    sub_goals = []
    for sg in sub_goals_raw:
        try:
            sub_goals.append(SubGoal(**sg))
        except Exception:
            pass

    observations = []
    for o in observations_raw:
        try:
            observations.append(Observation(**o))
        except Exception:
            pass

    try:
        self_model = SelfModel(**self_model_raw)
    except Exception:
        # `confidence` is not a field on SelfModel — it was silently dropped.
        # Every other keyword here is already the model's own default, so this
        # fallback is exactly an empty SelfModel; keep it explicit for intent.
        self_model = SelfModel(
            capabilities=[],
            active_caveats=[],
            recent_task_summary="",
        )

    try:
        thought_budget = ThoughtBudget(**thought_budget_raw)
    except Exception:
        thought_budget = ThoughtBudget()

    return _TaskState(
        id=row.id,
        user_id=row.user_id,
        goal=row.goal,
        track=row.track or "foreground",
        status=row.status or "running",
        self_model=self_model,
        sub_goals=sub_goals,
        observations=observations,
        thought_budget=thought_budget,
        paused_reason=row.paused_reason,
        error=row.error,
    )


async def _verify_mission_resumable(state: "TaskState") -> "TaskState | None":
    """Verify the mission exists + is resumable.  If current_phase_id is
    missing, try to infer it from the first non-done phase."""
    try:
        from agent.missions.store import get_mission, list_phases

        mission = await get_mission(state.user_id, state.mission_id)
        if mission is None:
            logger.warning(
                "rehydrate_task: mission %s not found for task %s",
                state.mission_id[:8], state.id[:8],
            )
            return state  # Let the loop handle the missing mission gracefully.

        if mission.status in _TERMINAL_STATUSES:
            logger.info(
                "rehydrate_task: mission %s is terminal (%s), task %s won't resume",
                state.mission_id[:8], mission.status, state.id[:8],
            )
            return None

        if not state.current_phase_id:
            # Planning was incomplete — find the first non-done phase.
            phases = await list_phases(state.mission_id)
            for ph in phases:
                if ph.status not in ("done", "failed", "abandoned"):
                    state.current_phase_id = ph.id
                    logger.debug(
                        "rehydrate_task: inferred current_phase_id=%s for task %s",
                        ph.id[:8], state.id[:8],
                    )
                    break
    except Exception as exc:
        logger.warning("rehydrate_task: mission verification failed: %s", exc)
    return state


async def _mark_inflight_cancelled(
    user_id: str,
    task_id: str,
    state: "TaskState",
) -> "TaskState":
    """Scan audit rows for actions that started but never completed/failed.
    For each, write a synthetic cancelled_by_crash audit row and advance
    state.step_idx past it.
    """
    try:
        from agent.schemas import ActionResult, InnerMonologue, PlanStep

        async with get_session() as db:
            stmt = (
                select(AgentAuditEntry)
                .where(AgentAuditEntry.task_id == task_id)
                .where(AgentAuditEntry.user_id == user_id)
                .order_by(AgentAuditEntry.id.asc())
            )
            result = await db.execute(stmt)
            rows = list(result.scalars().all())

        # Find steps that have a row but no completed result (ok=None or no ok key).
        # We look for the highest step_idx seen and check if a completion row exists.
        step_to_rows: dict[int, list[AgentAuditEntry]] = {}
        for r in rows:
            step_to_rows.setdefault(int(r.step_idx), []).append(r)

        cancelled_steps: list[int] = []
        for step_idx, step_rows in step_to_rows.items():
            # A step is "in-flight" if the only audit row for it has no result
            # (result_json is '{}' or result is missing ok=True/False).
            has_completed = False
            for r in step_rows:
                try:
                    res = json.loads(r.result_json or "{}")
                    if "ok" in res:
                        has_completed = True
                        break
                except Exception:
                    pass
            if not has_completed and step_rows:
                cancelled_steps.append(step_idx)

        for step_idx in cancelled_steps:
            logger.info(
                "rehydrate_task: step %d appears in-flight at crash for task %s — "
                "marking cancelled_by_crash",
                step_idx, task_id[:8],
            )
            synthetic_step = PlanStep(
                step_idx=step_idx,
                action="__crash_recovery__",
                args={},
                intent="auto-cancelled by crash recovery",
                sub_goal_id=state.active_sub_goal_id,
                monologue=InnerMonologue(
                    # `thought`/`plan`/`criticism` are not fields on this model
                    # — Pydantic dropped all three, so the recovery step
                    # carried a completely blank monologue into both the
                    # planner context and the UI. The one thing the agent most
                    # needs to know after a crash (a step may have half-applied)
                    # was the thing that never arrived.
                    what_i_see="Process crashed while this step was in flight.",
                    what_i_plan="Step auto-cancelled by crash recovery.",
                    what_could_fail=(
                        "The interrupted step may have applied some of its side "
                        "effects before the crash — verify before retrying."
                    ),
                    confidence=0.0,
                ),
            )
            synthetic_result = ActionResult(
                ok=False,
                error="cancelled_by_crash",
                error_class="cancelled_by_crash",
                elapsed_ms=0,
            )
            try:
                await _write_audit_entry_for_crash(
                    user_id=user_id,
                    task_id=task_id,
                    step=synthetic_step,
                    result=synthetic_result,
                    risk_level=1,
                )
            except Exception as exc:
                logger.debug("_mark_inflight_cancelled: write failed: %s", exc)

            # Advance step_idx past the cancelled step.
            if state.step_idx <= step_idx:
                state.step_idx = step_idx + 1

    except Exception as exc:
        logger.warning("_mark_inflight_cancelled: failed: %s", exc)

    return state


# ── Boot-time resume ──────────────────────────────────────────────────────────


async def resume_live_tasks_on_boot(runtime: "AgentRuntime") -> dict[str, int]:
    """At daemon startup: find every task in a resumable status across all
    users, rehydrate, mount into slot, spawn its loop.

    Foreground slot has capacity 1, background slot has capacity 1.
    If multiple tasks are in a live status (from a crash), the most-recently-
    progressing one wins the slot; the rest become paused_by_crash_recovery in
    DB so the operator can manually resume.

    Returns a count dict: {'foreground': N, 'background': M, 'mission_resumes': K}
    """
    import asyncio as _asyncio

    counts: dict[str, int] = {"foreground": 0, "background": 0, "mission_resumes": 0}

    try:
        async with get_session() as db:
            stmt = select(AgentTask).where(
                AgentTask.status.in_(list(_RESUMABLE_STATUSES)),
                AgentTask.finished_at.is_(None),
            )
            result = await db.execute(stmt)
            rows = list(result.scalars().all())
    except Exception as exc:
        logger.error("resume_live_tasks_on_boot: DB scan failed: %s", exc)
        return counts

    if not rows:
        logger.info("resume_live_tasks_on_boot: no resumable tasks found")
        return counts

    logger.info(
        "resume_live_tasks_on_boot: found %d resumable task(s)", len(rows)
    )

    # Group by track.
    fg_rows = [r for r in rows if (r.track or "foreground") == "foreground"]
    bg_rows = [r for r in rows if (r.track or "foreground") == "background"]

    # For each track: pick the most-recently-created winner, park the rest.
    async def _mount_winner(
        track_rows: list[AgentTask], track: Track
    ) -> int:
        if not track_rows:
            return 0
        # Sort by created_at desc; most-recent wins the slot.
        sorted_rows = sorted(
            track_rows,
            key=lambda r: r.created_at or datetime.min,
            reverse=True,
        )
        winner = sorted_rows[0]
        losers = sorted_rows[1:]

        # Park losers.
        for loser in losers:
            try:
                async with get_session() as db:
                    row = await db.get(AgentTask, loser.id)
                    if row:
                        row.status = "paused"
                        row.paused_reason = "paused_by_crash_recovery"
                        await db.commit()
                logger.info(
                    "resume_live_tasks_on_boot: parked task %s (paused_by_crash_recovery)",
                    loser.id[:8],
                )
            except Exception as exc:
                logger.warning("resume_live_tasks_on_boot: park failed: %s", exc)

        # Rehydrate + mount winner.
        try:
            state = await rehydrate_task(runtime, winner.user_id, winner.id)
        except Exception as exc:
            logger.error(
                "resume_live_tasks_on_boot: rehydrate failed for %s: %s",
                winner.id[:8], exc,
            )
            return 0

        if state is None:
            logger.info(
                "resume_live_tasks_on_boot: rehydrate returned None for %s (terminal)",
                winner.id[:8],
            )
            return 0

        # Override track to match the slot we're mounting into.
        state.track = track

        # Check if slot is already occupied (shouldn't happen at boot, but be safe).
        if runtime._slot_for(track) is not None:
            logger.warning(
                "resume_live_tasks_on_boot: %s slot already occupied, parking %s",
                track, state.id[:8],
            )
            try:
                async with get_session() as db:
                    row = await db.get(AgentTask, state.id)
                    if row:
                        row.status = "paused"
                        row.paused_reason = "paused_by_crash_recovery"
                        await db.commit()
            except Exception:
                pass
            return 0

        runtime._set_slot(track, state)
        runtime.controls.reset()

        # Update DB status.
        try:
            from agent.kernel.audit import update_task_status
            await update_task_status(state.id, "running", paused_reason=None)
        except Exception as exc:
            logger.warning("resume_live_tasks_on_boot: status update failed: %s", exc)

        # Emit WS event for crash resume.
        try:
            await runtime._broadcast("task.resumed_from_crash", {
                "task_id": state.id,
                "track": track,
                "step_idx": state.step_idx,
                "mission_id": state.mission_id,
            })
        except Exception:
            pass

        # Spawn the loop.
        from agent.kernel.loop import run_task_loop
        runner = _asyncio.create_task(
            run_task_loop(runtime, state, resumed=True),
            name=f"agent_task_{state.id}_resumed",
        )
        if track == "foreground":
            runtime.task_runner = runner
        else:
            runtime.background_runner = runner

        logger.info(
            "resume_live_tasks_on_boot: resumed task %s on %s track (step=%d)",
            state.id[:8], track, state.step_idx,
        )
        return 1

    fg_count = await _mount_winner(fg_rows, "foreground")
    bg_count = await _mount_winner(bg_rows, "background")

    counts["foreground"] = fg_count
    counts["background"] = bg_count

    # Count mission resumes.
    for track_rows in (fg_rows[:1], bg_rows[:1]):
        for r in track_rows:
            if r.mission_id:  # type: ignore[attr-defined]
                counts["mission_resumes"] += 1

    return counts
