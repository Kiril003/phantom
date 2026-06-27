from __future__ import annotations

import asyncio
import logging
from typing import Awaitable, Callable

from sqlalchemy.ext.asyncio import AsyncSession

from config import config
from agent.will import goals as goals_repo
from agent.will.budget import BudgetGovernor
from agent.will.journal import WillJournalWriter
from agent.will.decide import decide_next
from agent.will.reflect import reflect_and_seed
from agent.will.decompose import decompose_goal
from agent.will.arbitration import intent_mutex, IntentBusy
from agent.will.types import WillTickResult, WillDecision

logger = logging.getLogger(__name__)


async def _default_dispatch_llm(prompt: str, system: str) -> str:
    from ai.hub import ai_hub
    resp = await ai_hub.dispatch(
        "chat",
        {"user_message": prompt, "system_prompt": system, "history": [],
         "user_id": "will", "model_override": config.ai_reasoning_model},
        provider_hint=config.ai_primary_provider,
    )
    return resp.content or ""


async def _default_start_task(**kwargs) -> tuple[str, bool]:
    from agent.kernel.runtime import agent_runtime
    return await agent_runtime.start_task(**kwargs)


async def _default_evaluate_values(action_text: str):
    """Best-effort value check. Returns a ValueVerdict, or None on failure
    (fail-open — a broken values subsystem must not freeze the will)."""
    try:
        from agent.cognition.will.values import values_system
        return await values_system.evaluate(action_text)
    except Exception as exc:
        logger.debug("values evaluate failed: %s", exc)
        return None


class WillEngine:
    def __init__(self) -> None:
        self.governor = BudgetGovernor()
        self.journal = WillJournalWriter()
        self.dispatch_llm: Callable[[str, str], Awaitable[str]] = _default_dispatch_llm
        self.start_task: Callable[..., Awaitable[tuple[str, bool]]] = _default_start_task
        self.evaluate_values: Callable[[str], Awaitable] = _default_evaluate_values
        self._task: asyncio.Task | None = None
        self._stop = asyncio.Event()
        self._last_reflect: dict[str, str] = {}  # user_id → YYYY-MM-DD of last reflection

    def _motivation(self) -> str:
        """Compose 'who I am + what drives me now' from the motivational layer.
        Best-effort: the conductor stays coherent with PHANTOM's identity, but
        never fails a tick if the drives/identity subsystems are unavailable."""
        parts: list[str] = []
        try:
            from agent.cognition.will.identity import identity_system
            summary = identity_system.summary(max_words=40)
            if summary:
                parts.append(summary)
        except Exception as exc:
            logger.debug("motivation identity read failed: %s", exc)
        try:
            from agent.cognition.will.drives import drive_system
            drive_system.tick()
            dominant = drive_system.dominant()
            if dominant is not None:
                parts.append(f"Домінантний драйв зараз: {dominant.name} "
                             f"(тиск {dominant.pressure():.2f}).")
        except Exception as exc:
            logger.debug("motivation drive read failed: %s", exc)
        return " ".join(parts)

    async def orient(self, db: AsyncSession, user_id: str, active, *, now=None) -> str:
        """Deepen the goal tree (decompose) and self-generate goals (reflect).
        Budget-gated; at most one decompose + one reflect per tick. Returns a note."""
        from datetime import datetime
        notes: list[str] = []

        should_reflect = not active
        if active:
            n = now or datetime.now().astimezone()
            today = n.strftime("%Y-%m-%d")
            if n.hour == config.will_reflect_hour_local and self._last_reflect.get(user_id) != today:
                should_reflect = True
                self._last_reflect[user_id] = today

        if should_reflect and await self.governor.can_spend(db, user_id):
            try:
                created = await reflect_and_seed(db, user_id, dispatch_llm=self.dispatch_llm)
                await self.governor.note_spend(db, user_id, calls=1, tokens=0)
                if created:
                    notes.append(f"reflected:{len(created)}")
            except Exception as exc:
                logger.debug("orient reflect failed: %s", exc)

        active2 = await goals_repo.list_active(db, user_id)
        target = None
        for g in sorted(active2, key=lambda x: x.horizon_level):
            if g.horizon_level < 6:
                kids = await goals_repo.children(db, user_id, g.id)
                if not kids:
                    target = g
                    break
        if target is not None and await self.governor.can_spend(db, user_id):
            try:
                created = await decompose_goal(db, user_id, target, dispatch_llm=self.dispatch_llm)
                await self.governor.note_spend(db, user_id, calls=1, tokens=0)
                if created:
                    notes.append(f"decomposed:{len(created)}")
            except Exception as exc:
                logger.debug("orient decompose failed: %s", exc)

        return ",".join(notes)

    async def run_once(self, db: AsyncSession, user_id: str, *, snapshot: dict,
                       now=None) -> WillTickResult:
        if not config.will_enabled:
            return WillTickResult(WillDecision(kind="noop"), note="disabled")

        if not await self.governor.can_spend(db, user_id):
            return WillTickResult(WillDecision(kind="noop"), note="budget_exhausted")

        active = await goals_repo.list_active(db, user_id)
        # ORIENT — deepen the tree + self-generate goals before deciding.
        await self.orient(db, user_id, active, now=now)
        active = await goals_repo.list_active(db, user_id)
        budget = await self.governor.remaining(db, user_id)
        motivation = self._motivation()
        decision = await decide_next(snapshot, active, budget,
                                     dispatch_llm=self.dispatch_llm, motivation=motivation)
        await self.governor.note_spend(db, user_id, calls=1, tokens=0)

        if decision.kind == "noop":
            return WillTickResult(decision, note="noop")

        dispatched = False
        task_id = None
        try:
            async with intent_mutex.hold("will"):
                # Value gate — effectful decisions are checked against the
                # values doctrine; a confident rejection vetoes the action.
                if decision.kind in ("start_task", "standing_order"):
                    verdict = await self.evaluate_values(decision.action_text)
                    await self.governor.note_spend(db, user_id, calls=1, tokens=0)
                    if (verdict is not None and not getattr(verdict, "aligned", True)
                            and getattr(verdict, "confidence", 0.0) >= 0.5):
                        conflicts = ", ".join(getattr(verdict, "conflicts", []) or [])
                        await self.journal.record(
                            db, user_id, decision, outcome=f"vetoed_by_values:{conflicts}",
                            budget_delta={"calls": 2})
                        return WillTickResult(decision, dispatched=False,
                                              note="vetoed_by_values")

                if decision.kind == "start_task":
                    task_id, started = await self.start_task(
                        user_id=user_id, goal=decision.action_text,
                        origin="will", track="background",
                    )
                    dispatched = bool(started or task_id)
                    if decision.goal_id:
                        await goals_repo.set_status(db, decision.goal_id, "running")
                elif decision.kind == "proactive_seed":
                    try:
                        from agent.consciousness_stream import consciousness_stream
                        consciousness_stream._pending_insights.setdefault(user_id, []).append(
                            decision.action_text)
                        dispatched = True
                    except Exception as exc:
                        logger.debug("proactive_seed failed: %s", exc)
                elif decision.kind == "standing_order":
                    # Executive arm handled in a later sub-project; record intent now.
                    dispatched = False
        except IntentBusy:
            return WillTickResult(decision, dispatched=False, note="intent_busy")

        await self.journal.record(
            db, user_id, decision, task_id=task_id,
            outcome="dispatched" if dispatched else decision.kind,
            budget_delta={"calls": 1},
        )
        return WillTickResult(decision, dispatched=dispatched, task_id=task_id,
                              note="dispatched" if dispatched else decision.kind)

    async def start(self) -> None:
        if self._task is not None and not self._task.done():
            return
        self._stop.clear()
        self._task = asyncio.create_task(self._run(), name="will_engine")
        logger.info("Will engine started (enabled=%s)", config.will_enabled)

    async def stop(self) -> None:
        self._stop.set()
        if self._task is not None:
            self._task.cancel()
            self._task = None

    async def _run(self) -> None:
        from db.database import get_session
        from core.context_engine import context_engine
        from db.models import User
        from sqlalchemy import select
        while not self._stop.is_set():
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=config.will_tick_interval_s)
                break
            except asyncio.TimeoutError:
                pass
            if not config.will_enabled:
                continue
            try:
                snapshot = context_engine.get_snapshot()
                async with get_session() as db:
                    uid_rows = (await db.execute(select(User.id))).scalars().all()
                for uid in uid_rows:
                    async with get_session() as db:
                        await self.run_once(db, uid, snapshot=snapshot)
                        await db.commit()
            except Exception as exc:
                logger.debug("will tick error: %s", exc)


will_engine = WillEngine()
