"""will.seed_goal — operator seeds a top-horizon goal for the will to pursue."""
from __future__ import annotations

import time
from typing import ClassVar

from pydantic import Field
from sqlalchemy.ext.asyncio import AsyncSession

from ..schemas import ActionResult, RiskLevel
from .base import Action, ActionContext
from agent.will import goals


async def seed_goal(db: AsyncSession, user_id: str, *, description: str,
                    horizon_level: int = 0, kpi: str | None = None) -> dict:
    gid = await goals.seed(db, user_id, description, int(horizon_level),
                           kpi=kpi, source="seeded")
    return {"ok": True, "goal_id": gid, "horizon_level": int(horizon_level)}


class WillSeedGoal(Action):
    name: ClassVar[str] = "will.seed_goal"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE
    reversible: ClassVar[bool] = True

    description: str = Field(..., min_length=1)
    horizon_level: int = Field(default=0, ge=0, le=6)
    kpi: str | None = None

    async def execute(self, ctx: ActionContext) -> ActionResult:
        t0 = time.monotonic()
        from db.database import get_session
        async with get_session() as db:
            out = await seed_goal(db, ctx.user_id, description=self.description,
                                  horizon_level=self.horizon_level, kpi=self.kpi)
            await db.commit()
        return ActionResult(ok=True, output=out,
                            elapsed_ms=int((time.monotonic() - t0) * 1000))
