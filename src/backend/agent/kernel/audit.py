"""
Audit + memory-seed write helpers.

Audit entries persist BEFORE the loop sees the result — if the executor
crashes mid-action, the entry still ends up in the DB so post-mortems are
possible. Memory seeds are composed at task end (one row per task).
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from agent.kernel.runtime import TaskState

from sqlalchemy import select

from db.database import get_session
from db.models import (
    AgentAuditEntry, AgentCheckpoint, AgentFeedback, AgentMemorySeed, AgentTask,
    TeamChatMessage,
)


from ..schemas import (
    ActionResult,
    AuditEntry,
    Checkpoint,
    InnerMonologue,
    PlanStep,
    SubGoal,
    TaskStatus,
    Track,
)

logger = logging.getLogger(__name__)


# ── Task lifecycle ────────────────────────────────────────────────────────────

async def create_task_row(
    user_id: str, task_id: str, goal: str, track: Track = "foreground"
) -> None:
    async with get_session() as db:
        row = AgentTask(
            id=task_id,
            user_id=user_id,
            goal=goal,
            status="planning",
            track=track,
        )
        db.add(row)


async def task_status(task_id: str) -> str:
    """Day-4 Wave-2 T-1 (ADR-SOH-002): read-only sibling of
    `update_task_status`. Used by `recover_stale_leases` to reconcile
    a stranded `in_flight_task_id` against reality.

    Returns one of: ``"running" | "done" | "error" | "cancelled" |
    "missing"``. ``"missing"`` covers the case where the runner crashed
    BEFORE persisting the AgentTask row — the lease must be cleared so
    the next tick can re-fire (idempotent because last_fired_at is
    already set when the runner reaches the dispatch path).

    The DB column is also "blocked_quota" / "planning" / etc., but the
    SOH-002 reconcile only cares about the four life-cycle states; we
    map any non-terminal in-progress status to ``"running"`` so the
    caller treats it as a legitimate live lease.
    """
    if not task_id:
        return "missing"
    async with get_session() as db:
        row = await db.get(AgentTask, task_id)
        if row is None:
            return "missing"
        s = (row.status or "").lower()
        if s in ("done", "error", "cancelled"):
            return s
        return "running"


async def update_task_status(
    task_id: str,
    status: TaskStatus,
    *,
    error: str | None = None,
    paused_reason: str | None = None,
    finished: bool = False,
) -> None:
    async with get_session() as db:
        row = await db.get(AgentTask, task_id)
        if row is None:
            return
        row.status = status
        if error is not None:
            row.error = error
        row.paused_reason = paused_reason
        if finished:
            row.finished_at = datetime.now(tz=timezone.utc)
        # Phase 9.3a (AD-06) — belt-and-suspenders. get_session already
        # commits on context exit, but the live 9.2.3 probe run showed an
        # UPDATE never reaching SQLite during the blocked_quota transition.
        # Explicit commit here ensures the write is durable the moment the
        # function returns, removing any window where a subsequent
        # exception/cancellation could mask the transition.
        await db.commit()


async def persist_task_state(
    task_id: str,
    *,
    sub_goals: list[SubGoal] | None = None,
    observations_json: str | None = None,
    self_model_json: str | None = None,
    thought_budget_json: str | None = None,
) -> None:
    async with get_session() as db:
        row = await db.get(AgentTask, task_id)
        if row is None:
            return
        if sub_goals is not None:
            row.sub_goals_json = json.dumps([sg.model_dump(mode="json") for sg in sub_goals])
        if observations_json is not None:
            row.observations_json = observations_json
        if self_model_json is not None:
            row.self_model_json = self_model_json
        if thought_budget_json is not None:
            row.thought_budget_json = thought_budget_json


async def snapshot_task_state(state: "TaskState") -> None:
    """Block A-1 — persist a full TaskState snapshot for crash recovery.

    Delegates to agent.rehydrate.snapshot_task_state so the heavy
    serialisation logic lives in one place. Best-effort: any failure is
    logged at DEBUG and never propagated.
    """
    try:
        from agent.kernel.rehydrate import snapshot_task_state as _snap
        await _snap(state)
    except Exception as exc:
        logger.debug("audit.snapshot_task_state: failed: %s", exc)


# ── Audit ─────────────────────────────────────────────────────────────────────

async def write_audit_entry(
    *,
    user_id: str,
    task_id: str,
    step: PlanStep,
    result: ActionResult,
    risk_level: int,
) -> int:
    """Persist a single audit entry and return its id."""
    async with get_session() as db:
        entry = AgentAuditEntry(
            user_id=user_id,
            task_id=task_id,
            step_idx=step.step_idx,
            sub_goal_id=step.sub_goal_id,
            action_name=step.action,
            args_json=json.dumps(step.args, ensure_ascii=False, default=str),
            intent=step.intent or None,
            monologue_json=json.dumps(step.monologue.model_dump(mode="json"), ensure_ascii=False),
            result_json=json.dumps(result.model_dump(mode="json"), ensure_ascii=False, default=str),
            risk_level=risk_level,
            elapsed_ms=int(result.elapsed_ms),
            retried_from=step.retried_from,
        )
        db.add(entry)
        await db.flush()
        return int(entry.id)


async def fetch_audit(
    user_id: str, task_id: str | None, limit: int = 50
) -> list[AuditEntry]:
    async with get_session() as db:
        stmt = select(AgentAuditEntry).where(AgentAuditEntry.user_id == user_id)
        if task_id:
            stmt = stmt.where(AgentAuditEntry.task_id == task_id)
        stmt = stmt.order_by(AgentAuditEntry.id.desc()).limit(limit)
        result = await db.execute(stmt)
        rows = list(result.scalars().all())
    out: list[AuditEntry] = []
    for r in rows:
        try:
            args = json.loads(r.args_json or "{}")
        except Exception:
            args = {}
        try:
            mono_raw = json.loads(r.monologue_json or "null")
        except Exception:
            mono_raw = None
        try:
            res_raw = json.loads(r.result_json or "{}")
        except Exception:
            res_raw = {}
        out.append(AuditEntry(
            id=int(r.id),
            task_id=r.task_id,
            step_idx=int(r.step_idx),
            sub_goal_id=r.sub_goal_id,
            action_name=r.action_name,
            args=args,
            intent=r.intent,
            monologue=InnerMonologue(**mono_raw) if isinstance(mono_raw, dict) else None,
            result=ActionResult(**res_raw),
            risk_level=int(r.risk_level),
            elapsed_ms=int(r.elapsed_ms),
            retried_from=r.retried_from,
            timestamp=r.timestamp,
        ))
    return out


# ── Checkpoints ───────────────────────────────────────────────────────────────

async def save_checkpoint(user_id: str, checkpoint: Checkpoint) -> int:
    payload = json.dumps(checkpoint.model_dump(mode="json"), default=str, ensure_ascii=False)
    async with get_session() as db:
        row = AgentCheckpoint(
            user_id=user_id,
            task_id=checkpoint.task_id,
            reason=checkpoint.reason,
            payload_json=payload,
        )
        db.add(row)
        await db.flush()
        return int(row.id)


async def fetch_checkpoint(user_id: str, checkpoint_id: int) -> Checkpoint | None:
    async with get_session() as db:
        row = await db.get(AgentCheckpoint, checkpoint_id)
        if row is None or row.user_id != user_id:
            return None
    try:
        return Checkpoint(**json.loads(row.payload_json))
    except Exception as exc:
        logger.error("checkpoint deserialization failed: %s", exc)
        return None


async def latest_checkpoint(user_id: str, task_id: str) -> Checkpoint | None:
    async with get_session() as db:
        stmt = (
            select(AgentCheckpoint)
            .where(AgentCheckpoint.user_id == user_id)
            .where(AgentCheckpoint.task_id == task_id)
            .order_by(AgentCheckpoint.id.desc())
            .limit(1)
        )
        result = await db.execute(stmt)
        row = result.scalar_one_or_none()
    if row is None:
        return None
    try:
        return Checkpoint(**json.loads(row.payload_json))
    except Exception as exc:
        logger.error("latest_checkpoint deserialization failed: %s", exc)
        return None


# ── Memory seed ───────────────────────────────────────────────────────────────

async def write_memory_seed(
    *,
    # No default. `agent_memory_seeds.user_id` is a NOT NULL FK to users.id and
    # there is no `__system__` user row — the old `= "__system__"` default was a
    # loaded gun that only ever fired in tests, whose throwaway engines skip the
    # foreign_keys pragma. Every caller owns a real user; make them say so.
    user_id: str,
    task_id: str,
    goal: str,
    outcome: str,
    summary: str,
    key_actions: list[tuple[str, int]],
) -> None:
    async with get_session() as db:
        seed = AgentMemorySeed(
            user_id=user_id,
            task_id=task_id,
            goal=goal,
            outcome=outcome,
            summary=summary,
            key_actions=json.dumps(key_actions, ensure_ascii=False),
        )
        db.add(seed)


# ── Feedback ─────────────────────────────────────────────────────────────────

async def write_feedback(
    user_id: str, audit_entry_id: int, rating: str, comment: str | None
) -> int:
    async with get_session() as db:
        row = AgentFeedback(
            user_id=user_id,
            audit_entry_id=audit_entry_id,
            rating=rating,
            comment=comment,
        )
        db.add(row)
        await db.flush()
        return int(row.id)


# ── Recovery ─────────────────────────────────────────────────────────────────

async def mark_orphans_paused(reason: str = "uvicorn_restart") -> int:
    """At startup: any RUNNING/PLANNING task without finished_at → paused."""
    async with get_session() as db:
        stmt = select(AgentTask).where(
            AgentTask.status.in_(["running", "planning"]),
            AgentTask.finished_at.is_(None),
        )
        result = await db.execute(stmt)
        rows = list(result.scalars().all())
        for row in rows:
            row.status = "paused"
            row.paused_reason = reason
        return len(rows)


async def list_tasks(
    user_id: str,
    status: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    async with get_session() as db:
        stmt = select(AgentTask).where(AgentTask.user_id == user_id)
        if status:
            stmt = stmt.where(AgentTask.status == status)
        stmt = stmt.order_by(AgentTask.created_at.desc()).limit(limit)
        result = await db.execute(stmt)
        rows = list(result.scalars().all())
    return [_serialize_task_row(r) for r in rows]


async def get_task(user_id: str, task_id: str) -> dict[str, Any] | None:
    async with get_session() as db:
        row = await db.get(AgentTask, task_id)
        if row is None or row.user_id != user_id:
            return None
        return _serialize_task_row(row)


def _serialize_task_row(row: AgentTask) -> dict[str, Any]:
    def _maybe_json(s: str | None) -> Any:
        if not s:
            return None
        try:
            return json.loads(s)
        except Exception:
            return None
    return {
        "id": row.id,
        "goal": row.goal,
        "status": row.status,
        "track": row.track,
        "paused_reason": row.paused_reason,
        "error": row.error,
        "created_at": row.created_at,
        "finished_at": row.finished_at,
        "sub_goals": _maybe_json(row.sub_goals_json) or [],
        "observations": _maybe_json(row.observations_json) or [],
        "self_model": _maybe_json(row.self_model_json),
        "thought_budget": _maybe_json(row.thought_budget_json),
    }


async def write_team_message(
    *,
    task_id: str,
    sender: str,
    receiver: str,
    message: str,
    message_type: str = "text",
    media: list[dict[str, Any]] | None = None,
    parent_task_id: str | None = None,
) -> None:
    """Log a team chat message in the database and broadcast it to WebSockets."""
    import uuid as _uuid_lib
    media_json = json.dumps(media, ensure_ascii=False) if media else None
    
    async with get_session() as db:
        msg = TeamChatMessage(
            id=str(_uuid_lib.uuid4()),
            task_id=task_id,
            parent_task_id=parent_task_id,
            sender=sender,
            receiver=receiver,
            message=message,
            message_type=message_type,
            media_json=media_json,
        )
        db.add(msg)
        await db.commit()

    from agent.kernel.runtime import agent_runtime
    if agent_runtime is not None:
        try:
            await agent_runtime._broadcast("team.message", {
                "id": msg.id,
                "task_id": task_id,
                "parent_task_id": parent_task_id,
                "sender": sender,
                "receiver": receiver,
                "message": message,
                "message_type": message_type,
                "media": media,
                "created_at": msg.created_at.isoformat() if hasattr(msg.created_at, "isoformat") else str(msg.created_at),
            })
        except Exception as exc:
            logger.debug("write_team_message WS broadcast failed: %s", exc)

