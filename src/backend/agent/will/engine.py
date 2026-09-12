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
from agent.will.self_growth import grow_identity_from_journal
from agent.will.decompose import decompose_goal
from agent.will.arbitration import intent_mutex, IntentBusy
from agent.will.types import WillTickResult, WillDecision

logger = logging.getLogger(__name__)


async def _default_dispatch_llm(prompt: str, system: str) -> tuple[str, int]:
    """Returns (text, tokens_used). The token count is what the provider
    actually reported — every adapter fills AIResponse.tokens_used
    (ollama_provider.py:148, anthropic_provider.py:186, gemini_provider.py:366).
    Returning it beside the text is the whole reason the will can bill a real
    number; discarding it here is what made the token ledger read 0 forever."""
    from ai.hub import ai_hub
    resp = await ai_hub.dispatch(
        "chat",
        {"user_message": prompt, "system_prompt": system, "history": [],
         "user_id": "will", "model_override": config.ai_reasoning_model},
        provider_hint=config.ai_primary_provider,
    )
    return (resp.content or ""), int(getattr(resp, "tokens_used", 0) or 0)


class _TokenMeter:
    """Wraps a dispatch_llm and keeps the usage the planning helpers drop.

    The helpers (reflect/decompose/decide/self_growth) are typed to receive
    `(prompt, system) -> str`, so anything the provider reported alongside the
    text is lost at that seam. The meter unwraps a (text, tokens) pair, keeps
    the count, and hands the helper the plain string it expects — so no helper
    signature changes. A stub that returns a bare str bills 0, which is correct:
    it made no provider call."""

    def __init__(self, inner: Callable[[str, str], Awaitable]) -> None:
        self._inner = inner
        self.tokens = 0
        self.calls = 0

    async def __call__(self, prompt: str, system: str) -> str:
        out = await self._inner(prompt, system)
        self.calls += 1
        if isinstance(out, tuple):
            text, tokens = out
            self.tokens += int(tokens or 0)
            return text
        return out


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

        # The tree has a ceiling for decomposition (below); reflection used to
        # ignore it and seed up to 3 more roots a day regardless, which is how
        # a tree pinned at the ceiling still grew.
        if should_reflect and len(active) >= config.will_max_active_goals:
            should_reflect = False
            notes.append("reflect_skipped:at_ceiling")

        if should_reflect and await self.governor.can_spend(db, user_id):
            meter = _TokenMeter(self.dispatch_llm)
            try:
                created = await reflect_and_seed(db, user_id, dispatch_llm=meter)
                if created:
                    notes.append(f"reflected:{len(created)}")
            except Exception as exc:
                logger.debug("orient reflect failed: %s", exc)
            await self.governor.note_spend(
                db, user_id, calls=meter.calls, tokens=meter.tokens)
            # Identity grows from deeds — fold the recent journal into the
            # self-narrative once per reflection, so who PHANTOM is reflects
            # what it has actually done. Budget-gated, best-effort.
            if await self.governor.can_spend(db, user_id):
                meter = _TokenMeter(self.dispatch_llm)
                try:
                    grew = await grow_identity_from_journal(
                        db, user_id, dispatch_llm=meter)
                    if grew:
                        notes.append("grew_identity")
                except Exception as exc:
                    logger.debug("orient identity growth failed: %s", exc)
                await self.governor.note_spend(
                    db, user_id, calls=meter.calls, tokens=meter.tokens)

        active2 = await goals_repo.list_active(db, user_id)
        target = None
        # Anti-sprawl: stop deepening once the tree is large enough so budget
        # flows to action (decide) instead of endless planning. Without this the
        # will decomposes a childless goal every tick until the daily budget is
        # exhausted and it never acts (observed on the first live wake).
        if len(active2) < config.will_max_active_goals:
            for g in sorted(active2, key=lambda x: x.horizon_level):
                if g.horizon_level < 6:
                    kids = await goals_repo.children(db, user_id, g.id)
                    if not kids:
                        target = g
                        break
        if target is not None and await self.governor.can_spend(db, user_id):
            meter = _TokenMeter(self.dispatch_llm)
            try:
                created = await decompose_goal(db, user_id, target, dispatch_llm=meter)
                if created:
                    notes.append(f"decomposed:{len(created)}")
            except Exception as exc:
                logger.debug("orient decompose failed: %s", exc)
            await self.governor.note_spend(
                db, user_id, calls=meter.calls, tokens=meter.tokens)

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
        decide_meter = _TokenMeter(self.dispatch_llm)
        decision = await decide_next(snapshot, active, budget,
                                     dispatch_llm=decide_meter, motivation=motivation)
        await self.governor.note_spend(
            db, user_id, calls=decide_meter.calls, tokens=decide_meter.tokens)

        if decision.kind == "noop":
            return WillTickResult(decision, note="noop")

        dispatched = False
        task_id = None
        outcome = decision.kind
        try:
            async with intent_mutex.hold("will"):
                # Value gate — effectful decisions are checked against the
                # values doctrine; a confident rejection vetoes the action.
                if decision.kind in ("start_task", "standing_order"):
                    verdict = await self.evaluate_values(decision.action_text)
                    # tokens=0 here is NOT metered, unlike the four sites above.
                    # values_system.evaluate goes through llm_json → _call →
                    # ai_router.generate_raw, which is typed `-> str`
                    # (ai/provider.py:191) and drops the provider's usage before
                    # it is reachable. Counting this honestly means changing
                    # generate_raw, which every planner shares. Left uncounted
                    # and named rather than guessed.
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
                    # `started` False with a task_id means the runtime put the
                    # goal on an in-memory deque (runtime.py:622-633) or handed
                    # back the id of a task already occupying the slot — no row
                    # in agent_tasks, nothing survives a restart. Reporting that
                    # as "dispatched" is the lie; it is a queue admission.
                    dispatched = bool(started)
                    outcome = "dispatched" if started else (
                        f"queued_in_memory:{task_id}" if task_id else "start_task_refused")
                    # A goal is only running once a task actually runs for it.
                    if started and decision.goal_id:
                        await goals_repo.set_status(db, decision.goal_id, "running")
                elif decision.kind == "proactive_seed":
                    # This is NOT a dispatch. The only consumer is the chat
                    # route (api/routes_chat.py:454-461), which reads the queue
                    # when the owner next types; the queue is a process-local
                    # dict that dies with the process. There is no durable
                    # non-chat destination for a conversational seed in this
                    # tree, so the will says what it did instead of claiming
                    # delivery.
                    outcome = "seed_refused"
                    try:
                        from agent.consciousness_stream import consciousness_stream
                        consciousness_stream.push_insight(user_id, decision.action_text)
                        outcome = "seeded_for_next_chat_turn"
                    except Exception as exc:
                        logger.debug("proactive_seed failed: %s", exc)
                    dispatched = False
                elif decision.kind == "standing_order":
                    dispatched, outcome, _ = await self._file_standing_order(
                        db, user_id, decision)
        except IntentBusy:
            return WillTickResult(decision, dispatched=False, note="intent_busy")

        await self.journal.record(
            db, user_id, decision, task_id=task_id, outcome=outcome,
            budget_delta={"calls": 1},
        )
        return WillTickResult(decision, dispatched=dispatched, task_id=task_id,
                              note=outcome)

    async def _file_standing_order(self, db: AsyncSession, user_id: str,
                                   decision: WillDecision) -> tuple[bool, str, str | None]:
        """Put a standing-order decision into the standing_orders table, which
        StandingOrderRunner polls every `agent_standing_orders_poll_s` seconds
        (wired at main.py:704-711). That is a durable destination with a live
        reader — unlike the chat seed queue.

        Refuses rather than inventing: a rule with no cadence is not a rule, and
        guessing one would schedule work the will never asked for."""
        if not config.agent_standing_orders_enabled:
            return (False, "standing_order_refused:runner_disabled", None)
        if not decision.schedule:
            return (False, "standing_order_refused:no_schedule", None)
        from agent.operations.standing_orders.schedules import parse_schedule
        try:
            payload = dict(decision.schedule)
            schedule = parse_schedule(payload)
        except Exception as exc:
            logger.debug("will standing_order schedule rejected: %s", exc)
            return (False, "standing_order_refused:invalid_schedule", None)

        import json as _json
        from db.models import StandingOrder
        row = StandingOrder(
            user_id=user_id,
            description=(decision.rationale or decision.action_text)[:256],
            kind=schedule.kind,
            schedule_json=_json.dumps(payload, ensure_ascii=False),
            action_json=_json.dumps({"kind": "task", "goal": decision.action_text[:512]},
                                    ensure_ascii=False),
            action_kind="task",
            enabled=True,
        )
        db.add(row)
        await db.flush()
        if decision.goal_id:
            await goals_repo.set_status(db, decision.goal_id, "running")
        return (True, f"standing_order_filed:{row.id}", row.id)

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
