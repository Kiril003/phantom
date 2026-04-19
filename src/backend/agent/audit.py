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
from typing import Any

from sqlalchemy import select

from db.database import get_session
from db.models import (
    AgentAuditEntry, AgentCheckpoint, AgentFeedback, AgentMemorySeed, AgentTask,
)

from .schemas import (
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

async def create_task_row(task_id: str, goal: str, track: Track = "foreground") -> None:
    async with get_session() as db:
        row = AgentTask(
            id=task_id,
            goal=goal,
            status="planning",
            track=track,
        )
        db.add(row)


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


# ── Audit ─────────────────────────────────────────────────────────────────────

async def write_audit_entry(
    *,
    task_id: str,
    step: PlanStep,
    result: ActionResult,
    risk_level: int,
) -> int:
    """Persist a single audit entry and return its id."""
    async with get_session() as db:
        entry = AgentAuditEntry(
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


async def fetch_audit(task_id: str | None, limit: int = 50) -> list[AuditEntry]:
    async with get_session() as db:
        stmt = select(AgentAuditEntry)
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

async def save_checkpoint(checkpoint: Checkpoint) -> int:
    payload = json.dumps(checkpoint.model_dump(mode="json"), default=str, ensure_ascii=False)
    async with get_session() as db:
        row = AgentCheckpoint(
            task_id=checkpoint.task_id,
            reason=checkpoint.reason,
            payload_json=payload,
        )
        db.add(row)
        await db.flush()
        return int(row.id)


async def fetch_checkpoint(checkpoint_id: int) -> Checkpoint | None:
    async with get_session() as db:
        row = await db.get(AgentCheckpoint, checkpoint_id)
        if row is None:
            return None
    try:
        return Checkpoint(**json.loads(row.payload_json))
    except Exception as exc:
        logger.error("checkpoint deserialization failed: %s", exc)
        return None


async def latest_checkpoint(task_id: str) -> Checkpoint | None:
    async with get_session() as db:
        stmt = (
            select(AgentCheckpoint)
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
    task_id: str,
    goal: str,
    outcome: str,
    summary: str,
    key_actions: list[tuple[str, int]],
) -> None:
    async with get_session() as db:
        seed = AgentMemorySeed(
            task_id=task_id,
            goal=goal,
            outcome=outcome,
            summary=summary,
            key_actions=json.dumps(key_actions, ensure_ascii=False),
        )
        db.add(seed)


# ── Feedback ─────────────────────────────────────────────────────────────────

async def write_feedback(audit_entry_id: int, rating: str, comment: str | None) -> int:
    async with get_session() as db:
        row = AgentFeedback(
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
    status: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    async with get_session() as db:
        stmt = select(AgentTask)
        if status:
            stmt = stmt.where(AgentTask.status == status)
        stmt = stmt.order_by(AgentTask.created_at.desc()).limit(limit)
        result = await db.execute(stmt)
        rows = list(result.scalars().all())
    return [_serialize_task_row(r) for r in rows]


async def get_task(task_id: str) -> dict[str, Any] | None:
    async with get_session() as db:
        row = await db.get(AgentTask, task_id)
        if row is None:
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
