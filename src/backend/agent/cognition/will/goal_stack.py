"""
Persistent Goal Stack (Will Engine v1).
Manages multi-horizon goals across sessions with priority-based sorting.
"""
from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from pydantic import BaseModel, Field
from sqlalchemy import select, update

from db.database import get_session
from db.models import PersistentGoal

logger = logging.getLogger(__name__)


class Goal(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    parent_id: Optional[str] = None
    horizon_level: int = 6  # 0=Vision, 1=Year, 2=Quarter, 3=Month, 4=Week, 5=Day, 6=Action
    description: str
    owner_agent: str = "CEO"
    kpi: Optional[str] = None
    deadline: Optional[datetime] = None
    blockers: list[str] = Field(default_factory=list)
    status: str = "pending"
    
    # Priority components
    value_alignment: float = 1.0
    drive_pull: float = 1.0
    urgency: float = 0.5
    tractability: float = 0.5
    progress: float = 0.0

    created_at: datetime = Field(default_factory=lambda: datetime.now(tz=timezone.utc))

    def priority(self) -> float:
        """Calculate overall priority score."""
        return (
            self.value_alignment * 
            self.drive_pull * 
            self.urgency * 
            self.tractability
        )


class PersistentGoalStack:
    """Heap-priority stack for long-term autonomous goals."""

    async def push(self, goal: Goal) -> None:
        """Add a new goal to the stack and persist it."""
        try:
            async with get_session() as db:
                row = PersistentGoal(
                    id=goal.id,
                    user_id=goal.user_id,
                    parent_id=goal.parent_id,
                    horizon_level=goal.horizon_level,
                    description=goal.description,
                    owner_agent=goal.owner_agent,
                    kpi=goal.kpi,
                    deadline=goal.deadline,
                    blockers_json=json.dumps(goal.blockers),
                    status=goal.status,
                    value_alignment=goal.value_alignment,
                    drive_pull=goal.drive_pull,
                    urgency=goal.urgency,
                    tractability=goal.tractability,
                    progress=goal.progress,
                )
                db.add(row)
                await db.commit()
                logger.info("GoalStack: pushed goal %s: %s", goal.id[:8], goal.description[:60])
        except Exception as exc:
            logger.error("GoalStack.push failed: %s", exc)

    async def peek_highest(self) -> Optional[Goal]:
        """Return the highest priority pending goal WITHOUT marking it as running."""
        try:
            async with get_session() as db:
                result = await db.execute(
                    select(PersistentGoal).where(PersistentGoal.status == "pending")
                )
                rows = result.scalars().all()
                if not rows:
                    return None
                goals = [self._row_to_goal(r) for r in rows]
                return max(goals, key=lambda g: g.priority())
        except Exception as exc:
            logger.error("GoalStack.peek_highest failed: %s", exc)
            return None

    async def pop_highest(self) -> Optional[Goal]:
        """Return the highest priority pending goal and mark it as 'running'."""
        try:
            async with get_session() as db:
                # Calculate priority in SQL if possible, or just fetch all pending
                # and sort in memory for now (Phase 28 simplicity).
                result = await db.execute(
                    select(PersistentGoal).where(PersistentGoal.status == "pending")
                )
                rows = result.scalars().all()
                if not rows:
                    return None
                
                # Convert to Pydantic and sort
                goals = [self._row_to_goal(r) for r in rows]
                highest = max(goals, key=lambda g: g.priority())
                
                # Mark as running
                await db.execute(
                    update(PersistentGoal)
                    .where(PersistentGoal.id == highest.id)
                    .values(status="running", updated_at=datetime.now(tz=timezone.utc))
                )
                await db.commit()
                highest.status = "running"
                return highest
        except Exception as exc:
            logger.error("GoalStack.pop_highest failed: %s", exc)
            return None

    async def mark_done(self, goal_id: str, summary: str = "") -> None:
        """Mark a goal as completed."""
        try:
            async with get_session() as db:
                now = datetime.now(tz=timezone.utc)
                await db.execute(
                    update(PersistentGoal)
                    .where(PersistentGoal.id == goal_id)
                    .values(
                        status="done",
                        finished_at=now,
                        updated_at=now
                    )
                )
                await db.commit()
                logger.info("GoalStack: marked goal %s as done", goal_id[:8])
        except Exception as exc:
            logger.error("GoalStack.mark_done failed: %s", exc)

    async def snooze(self, goal_id: str, until: datetime) -> None:
        """Snooze a goal (Phase 28: just mark as snoozed)."""
        try:
            async with get_session() as db:
                await db.execute(
                    update(PersistentGoal)
                    .where(PersistentGoal.id == goal_id)
                    .values(status="snoozed", updated_at=datetime.now(tz=timezone.utc))
                )
                await db.commit()
        except Exception as exc:
            logger.error("GoalStack.snooze failed: %s", exc)

    async def list_by_horizon(self, horizon: int) -> list[Goal]:
        """List all goals for a specific horizon level."""
        try:
            async with get_session() as db:
                result = await db.execute(
                    select(PersistentGoal)
                    .where(PersistentGoal.horizon_level == horizon)
                    .order_by(PersistentGoal.created_at.desc())
                )
                rows = result.scalars().all()
                return [self._row_to_goal(r) for r in rows]
        except Exception as exc:
            logger.error("GoalStack.list_by_horizon failed: %s", exc)
            return []

    def _row_to_goal(self, row: PersistentGoal) -> Goal:
        return Goal(
            id=row.id,
            user_id=row.user_id,
            parent_id=row.parent_id,
            horizon_level=row.horizon_level,
            description=row.description,
            owner_agent=row.owner_agent,
            kpi=row.kpi,
            deadline=row.deadline,
            blockers=json.loads(row.blockers_json),
            status=row.status,
            value_alignment=row.value_alignment,
            drive_pull=row.drive_pull,
            urgency=row.urgency,
            tractability=row.tractability,
            progress=row.progress,
            created_at=row.created_at.replace(tzinfo=timezone.utc),
        )


# Singleton
goal_stack = PersistentGoalStack()
