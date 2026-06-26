from __future__ import annotations

import json
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import PersistentGoal
from agent.will.types import Goal

_ACTIVE = ("pending", "running", "snoozed")


def _to_goal(row: PersistentGoal) -> Goal:
    return Goal(
        id=row.id, user_id=row.user_id, parent_id=row.parent_id,
        horizon_level=row.horizon_level, description=row.description,
        status=row.status, kpi=row.kpi, deadline=row.deadline,
        blockers=json.loads(row.blockers_json or "[]"),
        source=getattr(row, "source", "seeded"),
    )


async def seed(db: AsyncSession, user_id: str, description: str, horizon_level: int,
               *, parent_id: str | None = None, kpi: str | None = None,
               source: str = "seeded") -> str:
    gid = str(uuid.uuid4())
    db.add(PersistentGoal(
        id=gid, user_id=user_id, parent_id=parent_id, horizon_level=horizon_level,
        description=description, kpi=kpi, status="pending", source=source,
    ))
    await db.flush()
    return gid


async def list_active(db: AsyncSession, user_id: str) -> list[Goal]:
    res = await db.execute(
        select(PersistentGoal)
        .where(PersistentGoal.user_id == user_id, PersistentGoal.status.in_(_ACTIVE))
        .order_by(PersistentGoal.horizon_level.asc())
    )
    return [_to_goal(r) for r in res.scalars().all()]


async def children(db: AsyncSession, user_id: str, parent_id: str) -> list[Goal]:
    res = await db.execute(
        select(PersistentGoal).where(
            PersistentGoal.user_id == user_id, PersistentGoal.parent_id == parent_id)
    )
    return [_to_goal(r) for r in res.scalars().all()]


async def set_status(db: AsyncSession, goal_id: str, status: str) -> None:
    res = await db.execute(select(PersistentGoal).where(PersistentGoal.id == goal_id))
    row = res.scalar_one_or_none()
    if row is not None:
        row.status = status


async def add_blocker(db: AsyncSession, goal_id: str, text: str) -> None:
    res = await db.execute(select(PersistentGoal).where(PersistentGoal.id == goal_id))
    row = res.scalar_one_or_none()
    if row is not None:
        blockers = json.loads(row.blockers_json or "[]")
        blockers.append(text)
        row.blockers_json = json.dumps(blockers, ensure_ascii=False)


async def pick_next_action(db: AsyncSession, user_id: str) -> Goal | None:
    res = await db.execute(
        select(PersistentGoal)
        .where(PersistentGoal.user_id == user_id, PersistentGoal.status.in_(_ACTIVE))
        .order_by(PersistentGoal.horizon_level.desc(), PersistentGoal.deadline.asc().nullslast())
    )
    row = res.scalars().first()
    return _to_goal(row) if row is not None else None
