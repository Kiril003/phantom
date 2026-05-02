"""
Phase 17b — Agent Studio CRUD.

Async wrappers around the `custom_agents` / `custom_agent_runs` SQL tables.
Pydantic models in `models.py` are the canonical contract; we serialise to
JSON strings on the way down to keep the SQL schema stable while card types
evolve.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import desc, select

from db.database import get_session
from db.models import CustomAgentRow, CustomAgentRunRow

from .models import (
    AgentCard,
    AgentCardLink,
    CustomAgent,
    CustomAgentRun,
    Recipient,
    Schedule,
)

logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(tz=timezone.utc)


def _to_row(agent: CustomAgent) -> CustomAgentRow:
    return CustomAgentRow(
        id=agent.id,
        owner_user_id=agent.owner_user_id,
        name=agent.name,
        description=agent.description,
        avatar=agent.avatar,
        tags_json=json.dumps(agent.tags, ensure_ascii=False),
        goal_template=agent.goal_template,
        inputs_schema_json=json.dumps(
            [n.model_dump(mode="json") for n in agent.inputs_schema],
            ensure_ascii=False, default=str,
        ),
        cards_json=json.dumps(
            [c.model_dump(mode="json") for c in agent.cards],
            ensure_ascii=False, default=str,
        ),
        links_json=json.dumps(
            [l.model_dump(mode="json") for l in agent.links],
            ensure_ascii=False, default=str,
        ),
        recipients_json=json.dumps(
            [r.model_dump(mode="json") for r in agent.recipients],
            ensure_ascii=False, default=str,
        ),
        schedule_json=json.dumps(
            agent.schedule.model_dump(mode="json"),
            ensure_ascii=False, default=str,
        ),
        enabled=agent.enabled,
        last_run_at=agent.last_run_at,
        run_count=agent.run_count,
        success_count=agent.success_count,
        created_at=agent.created_at,
        updated_at=agent.updated_at,
    )


def _from_row(row: CustomAgentRow) -> CustomAgent:
    def _maybe(s: str | None, default: Any) -> Any:
        try:
            return json.loads(s) if s else default
        except Exception:
            return default

    cards_raw = _maybe(row.cards_json, [])
    links_raw = _maybe(row.links_json, [])
    recipients_raw = _maybe(row.recipients_json, [])
    inputs_raw = _maybe(row.inputs_schema_json, [])
    schedule_raw = _maybe(row.schedule_json, {})

    return CustomAgent(
        id=row.id,
        owner_user_id=row.owner_user_id,
        name=row.name,
        description=row.description or "",
        avatar=row.avatar,
        tags=_maybe(row.tags_json, []),
        goal_template=row.goal_template or "",
        inputs_schema=[
            n if isinstance(n, dict) else {} for n in inputs_raw
        ],  # type: ignore[arg-type]
        cards=[AgentCard(**c) for c in cards_raw if isinstance(c, dict)],
        links=[AgentCardLink(**l) for l in links_raw if isinstance(l, dict)],
        recipients=[Recipient(**r) for r in recipients_raw if isinstance(r, dict)],
        schedule=Schedule(**schedule_raw) if isinstance(schedule_raw, dict) else Schedule(),
        enabled=row.enabled,
        last_run_at=row.last_run_at,
        run_count=row.run_count,
        success_count=row.success_count,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


# ── CustomAgent CRUD ──────────────────────────────────────────────────────────


async def save_agent(agent: CustomAgent) -> CustomAgent:
    """Insert or update. Returns the persisted shape."""
    agent.updated_at = _now()
    async with get_session() as db:
        existing = await db.get(CustomAgentRow, agent.id)
        if existing is None:
            db.add(_to_row(agent))
        else:
            existing.name = agent.name
            existing.description = agent.description
            existing.avatar = agent.avatar
            existing.tags_json = json.dumps(agent.tags, ensure_ascii=False)
            existing.goal_template = agent.goal_template
            existing.inputs_schema_json = json.dumps(
                [n.model_dump(mode="json") for n in agent.inputs_schema],
                ensure_ascii=False, default=str,
            )
            existing.cards_json = json.dumps(
                [c.model_dump(mode="json") for c in agent.cards],
                ensure_ascii=False, default=str,
            )
            existing.links_json = json.dumps(
                [l.model_dump(mode="json") for l in agent.links],
                ensure_ascii=False, default=str,
            )
            existing.recipients_json = json.dumps(
                [r.model_dump(mode="json") for r in agent.recipients],
                ensure_ascii=False, default=str,
            )
            existing.schedule_json = json.dumps(
                agent.schedule.model_dump(mode="json"),
                ensure_ascii=False, default=str,
            )
            existing.enabled = agent.enabled
            existing.updated_at = agent.updated_at
        await db.commit()
    return agent


async def get_agent(agent_id: str) -> CustomAgent | None:
    async with get_session() as db:
        row = await db.get(CustomAgentRow, agent_id)
        if row is None:
            return None
        return _from_row(row)


async def list_agents(owner_user_id: str | None = None, *, limit: int = 100) -> list[CustomAgent]:
    async with get_session() as db:
        stmt = select(CustomAgentRow)
        if owner_user_id:
            stmt = stmt.where(CustomAgentRow.owner_user_id == owner_user_id)
        stmt = stmt.order_by(desc(CustomAgentRow.updated_at)).limit(limit)
        rows = list((await db.execute(stmt)).scalars().all())
    return [_from_row(r) for r in rows]


async def delete_agent(agent_id: str) -> bool:
    async with get_session() as db:
        row = await db.get(CustomAgentRow, agent_id)
        if row is None:
            return False
        await db.delete(row)
        await db.commit()
    return True


async def increment_run_metrics(agent_id: str, *, success: bool) -> None:
    async with get_session() as db:
        row = await db.get(CustomAgentRow, agent_id)
        if row is None:
            return
        row.run_count = (row.run_count or 0) + 1
        if success:
            row.success_count = (row.success_count or 0) + 1
        row.last_run_at = _now()
        await db.commit()


# ── CustomAgentRun CRUD ───────────────────────────────────────────────────────


async def save_run(run: CustomAgentRun) -> CustomAgentRun:
    async with get_session() as db:
        existing = await db.get(CustomAgentRunRow, run.id)
        if existing is None:
            db.add(CustomAgentRunRow(
                id=run.id,
                agent_id=run.agent_id,
                task_id=run.task_id,
                inputs_json=json.dumps(run.inputs, ensure_ascii=False, default=str),
                status=run.status,
                triggered_by=run.triggered_by,
                started_at=run.started_at,
                finished_at=run.finished_at,
                summary=run.summary,
                error=run.error,
                created_at=_now(),
            ))
        else:
            existing.status = run.status
            existing.started_at = run.started_at or existing.started_at
            existing.finished_at = run.finished_at or existing.finished_at
            existing.summary = run.summary or existing.summary
            existing.error = run.error
        await db.commit()
    return run


async def list_runs(agent_id: str, *, limit: int = 50) -> list[CustomAgentRun]:
    async with get_session() as db:
        stmt = (
            select(CustomAgentRunRow)
            .where(CustomAgentRunRow.agent_id == agent_id)
            .order_by(desc(CustomAgentRunRow.created_at))
            .limit(limit)
        )
        rows = list((await db.execute(stmt)).scalars().all())
    out: list[CustomAgentRun] = []
    for r in rows:
        try:
            inputs = json.loads(r.inputs_json or "{}")
        except Exception:
            inputs = {}
        out.append(CustomAgentRun(
            id=r.id,
            agent_id=r.agent_id,
            task_id=r.task_id,
            inputs=inputs,
            status=r.status,  # type: ignore[arg-type]
            triggered_by=r.triggered_by,  # type: ignore[arg-type]
            started_at=r.started_at,
            finished_at=r.finished_at,
            summary=r.summary or "",
            error=r.error,
        ))
    return out


__all__ = [
    "save_agent",
    "get_agent",
    "list_agents",
    "delete_agent",
    "save_run",
    "list_runs",
    "increment_run_metrics",
]
