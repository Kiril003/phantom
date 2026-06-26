from __future__ import annotations

import time
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import WillBudgetLedger
from agent.will.types import Budget
from config import config


def _today() -> str:
    return datetime.now().astimezone().strftime("%Y-%m-%d")


class BudgetGovernor:
    async def _row(self, db: AsyncSession, user_id: str, day: str) -> WillBudgetLedger:
        res = await db.execute(
            select(WillBudgetLedger).where(
                WillBudgetLedger.user_id == user_id,
                WillBudgetLedger.ledger_date == day,
            )
        )
        row = res.scalar_one_or_none()
        if row is None:
            row = WillBudgetLedger(user_id=user_id, ledger_date=day,
                                   llm_calls=0, tokens=0, updated_at=time.time())
            db.add(row)
            await db.flush()
        return row

    async def remaining(self, db: AsyncSession, user_id: str, *, today: str | None = None) -> Budget:
        row = await self._row(db, user_id, today or _today())
        return Budget(
            calls_used=row.llm_calls, tokens_used=row.tokens,
            calls_cap=config.will_daily_llm_calls, tokens_cap=config.will_daily_token_cap,
        )

    async def note_spend(self, db: AsyncSession, user_id: str, calls: int, tokens: int,
                         *, today: str | None = None) -> None:
        row = await self._row(db, user_id, today or _today())
        row.llm_calls += int(calls)
        row.tokens += int(tokens)
        row.updated_at = time.time()

    async def can_spend(self, db: AsyncSession, user_id: str, *, today: str | None = None) -> bool:
        return (await self.remaining(db, user_id, today=today)).ok
