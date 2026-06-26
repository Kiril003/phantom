"""will.status — report what the will is pursuing and what it recently did."""
from __future__ import annotations

import time
from typing import ClassVar

from sqlalchemy.ext.asyncio import AsyncSession

from ..schemas import ActionResult, RiskLevel
from .base import Action, ActionContext
from agent.will import goals
from agent.will.journal import WillJournalWriter


async def will_status(db: AsyncSession, user_id: str) -> dict:
    active = await goals.list_active(db, user_id)
    recent = await WillJournalWriter().recent(db, user_id, n=5)
    return {
        "ok": True,
        "active_goals": len(active),
        "goals": [{"description": g.description, "horizon_level": g.horizon_level,
                   "status": g.status} for g in active],
        "recent_actions": [{"action": r["action"], "outcome": r["outcome"]} for r in recent],
    }


class WillStatus(Action):
    name: ClassVar[str] = "will.status"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE
    reversible: ClassVar[bool] = True

    async def execute(self, ctx: ActionContext) -> ActionResult:
        t0 = time.monotonic()
        from db.database import get_session
        async with get_session() as db:
            out = await will_status(db, ctx.user_id)
        return ActionResult(ok=True, output=out,
                            elapsed_ms=int((time.monotonic() - t0) * 1000))
