from __future__ import annotations

import json
import time
import uuid
from dataclasses import asdict

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import WillJournal
from agent.will.types import WillDecision


class WillJournalWriter:
    async def record(self, db: AsyncSession, user_id: str, decision: WillDecision,
                     *, task_id: str | None = None, outcome: str = "",
                     budget_delta: dict | None = None) -> None:
        db.add(WillJournal(
            id=str(uuid.uuid4()), user_id=user_id, ts=time.time(),
            decision_json=json.dumps(asdict(decision), ensure_ascii=False),
            action=decision.kind, task_id=task_id, outcome=outcome,
            budget_delta_json=json.dumps(budget_delta or {}, ensure_ascii=False),
        ))
        await db.flush()

    async def recent(self, db: AsyncSession, user_id: str, n: int = 10) -> list[dict]:
        res = await db.execute(
            select(WillJournal)
            .where(WillJournal.user_id == user_id)
            .order_by(WillJournal.ts.desc())
            .limit(n)
        )
        out = []
        for r in res.scalars().all():
            out.append({
                "ts": r.ts, "action": r.action, "task_id": r.task_id,
                "outcome": r.outcome,
                "decision": json.loads(r.decision_json or "{}"),
                "budget_delta": json.loads(r.budget_delta_json or "{}"),
            })
        return out
