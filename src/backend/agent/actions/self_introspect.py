"""self.capability + self.recall — agent introspection."""
from __future__ import annotations

import time
from typing import ClassVar

from pydantic import Field

from ..schemas import ActionResult, RiskLevel
from .base import Action, ActionContext


class SelfCapability(Action):
    name: ClassVar[str] = "self.capability"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE

    query: str = Field(default="")

    async def execute(self, ctx: ActionContext) -> ActionResult:
        t0 = time.monotonic()
        runtime = ctx.runtime
        self_model = None
        if runtime is not None:
            self_model = getattr(runtime, "self_model", None)

        capabilities: list[str] = []
        hardware: dict = {}
        risk_tolerance = 5
        if self_model is not None:
            capabilities = list(self_model.capabilities)
            hardware = dict(self_model.hardware)
            risk_tolerance = int(self_model.risk_tolerance)

        needle = (self.query or "").lower()
        match = [c for c in capabilities if needle in c.lower()] if needle else capabilities
        answer = (
            f"Capable of {len(match)} matching action(s). "
            f"Risk tolerance is {risk_tolerance} (1=SAFE / 3=LOW / 5=MEDIUM / 7=HIGH)."
        )
        return ActionResult(
            ok=True,
            output={
                "query": self.query,
                "answer": answer,
                "available_actions": match,
                "hardware_summary": hardware,
                "risk_tolerance": risk_tolerance,
            },
            elapsed_ms=int((time.monotonic() - t0) * 1000),
        )


class SelfRecall(Action):
    """
    Phase 9.2: ChromaDB similarity search over agent_episodes. Falls back to
    SQL LIKE on agent_memory_seeds when ChromaDB is unavailable so the action
    never crashes the loop on a clean install.
    """

    name: ClassVar[str] = "self.recall"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE

    query: str = Field(default="")
    limit: int = Field(default=3, ge=1, le=20)

    async def execute(self, ctx: ActionContext) -> ActionResult:
        t0 = time.monotonic()
        episodes: list[dict] = []
        try:
            from ..memory.recall import recall as episodic_recall
            episodes = await episodic_recall(self.query or "(any)", k=self.limit)
        except Exception:
            episodes = []

        if not episodes:
            episodes = await self._sql_fallback()

        return ActionResult(
            ok=True,
            output={
                "query": self.query,
                "matches": episodes,
                "count": len(episodes),
                "source": "chromadb" if episodes and "relevance" in episodes[0]
                          else "sql_fallback",
            },
            elapsed_ms=int((time.monotonic() - t0) * 1000),
        )

    async def _sql_fallback(self) -> list[dict]:
        from sqlalchemy import select
        from db.database import get_session
        from db.models import AgentMemorySeed
        like = f"%{self.query}%" if self.query else "%"
        seeds: list[dict] = []
        try:
            async with get_session() as db:
                stmt = (
                    select(AgentMemorySeed)
                    .where(AgentMemorySeed.summary.like(like))
                    .order_by(AgentMemorySeed.created_at.desc())
                    .limit(self.limit)
                )
                result = await db.execute(stmt)
                for seed in result.scalars().all():
                    seeds.append({
                        "task_id": seed.task_id,
                        "goal": seed.goal,
                        "outcome": seed.outcome,
                        "summary": seed.summary,
                        "created_at": seed.created_at.isoformat(),
                    })
        except Exception:
            return []
        return seeds
