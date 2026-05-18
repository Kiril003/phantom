"""
7-Horizon Planner — Vision to Action.
Manages the hierarchy of goals and their interconnections.
"""
from __future__ import annotations

import logging
from typing import Any, Optional
from datetime import datetime, timezone

from sqlalchemy import select, update

from db.database import get_session
from db.models import PersistentGoal

logger = logging.getLogger(__name__)

HORIZON_NAMES = ["VISION", "YEAR", "QUARTER", "MONTH", "WEEK", "DAY", "ACTION"]

async def get_horizon_tree(user_id: str) -> list[dict[str, Any]]:
    """Fetch all goals and return them as a hierarchical tree."""
    try:
        async with get_session() as db:
            result = await db.execute(
                select(PersistentGoal)
                .where(PersistentGoal.user_id == user_id)
                .order_by(PersistentGoal.horizon_level.asc(), PersistentGoal.created_at.desc())
            )
            rows = result.scalars().all()
            
            # Map of all goals by ID
            goals_map = {}
            for row in rows:
                g = {
                    "id": row.id,
                    "parent_id": row.parent_id,
                    "horizon_level": row.horizon_level,
                    "horizon_name": HORIZON_NAMES[row.horizon_level] if row.horizon_level < len(HORIZON_NAMES) else f"L{row.horizon_level}",
                    "description": row.description,
                    "status": row.status,
                    "progress": row.progress,
                    "deadline": row.deadline.isoformat() if row.deadline else None,
                    "children": []
                }
                goals_map[row.id] = g
            
            tree = []
            for g in goals_map.values():
                if g["parent_id"] and g["parent_id"] in goals_map:
                    goals_map[g["parent_id"]]["children"].append(g)
                else:
                    # Top-level goals (Vision or orphaned)
                    tree.append(g)
            
            return tree
    except Exception as exc:
        logger.error("horizons.get_horizon_tree failed: %s", exc)
        return []

async def format_horizons_for_prompt(user_id: str) -> str:
    """Format active goals from all horizons for the LLM prompt.
    
    This provides the Agent with context on how the current action
    connects to higher-level goals.
    """
    try:
        async with get_session() as db:
            # We want to see the path from Action to Vision
            # For simplicity, we just fetch all "running" or top-level "active" goals
            result = await db.execute(
                select(PersistentGoal)
                .where(PersistentGoal.user_id == user_id)
                .where(PersistentGoal.status.in_(["running", "active"]))
                .order_by(PersistentGoal.horizon_level.asc())
            )
            rows = result.scalars().all()
            if not rows:
                return ""
            
            lines = ["\nПОТОЧНИЙ КОНТЕКСТ ПЛАНУВАННЯ (7 Горизонтів):"]
            for row in rows:
                name = HORIZON_NAMES[row.horizon_level] if row.horizon_level < len(HORIZON_NAMES) else f"L{row.horizon_level}"
                lines.append(f"- [{name}] {row.description} (Прогрес: {row.progress:.0%})")
            
            lines.append("Кожна твоя дія має наближати нас до Візії через цей ланцюжок.")
            return "\n".join(lines) + "\n"
    except Exception as exc:
        logger.error("horizons.format_horizons_for_prompt failed: %s", exc)
        return ""

async def update_goal_progress(goal_id: str, progress: float) -> None:
    """Update progress of a goal and check for completion."""
    try:
        async with get_session() as db:
            result = await db.execute(select(PersistentGoal).where(PersistentGoal.id == goal_id))
            goal = result.scalar_one_or_none()
            if not goal:
                return
            
            goal.progress = max(0.0, min(1.0, progress))
            if goal.progress >= 1.0:
                goal.status = "done"
                goal.finished_at = datetime.now(tz=timezone.utc)
            
            await db.commit()
    except Exception as exc:
        logger.error("horizons.update_goal_progress failed: %s", exc)
