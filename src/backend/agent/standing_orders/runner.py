"""
Phase 9.3b — standing orders background runner.
Phase 9.4a — orders fire on the *background* track now, so active user
conversations in the foreground slot never block a scheduled check.

Polls the `standing_orders` table on a cadence (default 10s), evaluates
each enabled order's schedule + condition, and fires matching orders via
`AgentRuntime.start_task(track="background", ...)`.

When the background slot is busy + queue has space, start_task enqueues
the fire; we still record it as a successful fire. When the queue is
full, TrackBusyError is raised — we catch it, leave `last_fired_at`
untouched so the order re-evaluates on the next tick, and log. This
means transient congestion turns into "fire slightly later" instead of
"fire lost" or "crash".

After a fire, emits a STANDING_ORDER_FIRED proactive trigger so the
proactive loop can decide whether to surface the outcome to the user.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from sqlalchemy import select, update

from config import config

from .conditions import evaluate_condition
from .schedules import (
    ConditionalSchedule,
    OneShotSchedule,
    parse_schedule,
    next_fire_time,
)

if TYPE_CHECKING:
    from agent.runtime import AgentRuntime

logger = logging.getLogger(__name__)


def _utcnow() -> datetime:
    return datetime.now(tz=timezone.utc)


class StandingOrderRunner:
    def __init__(self, runtime: "AgentRuntime") -> None:
        self.runtime = runtime
        self._task: asyncio.Task | None = None
        self._stop_event = asyncio.Event()

    async def start(self) -> None:
        if self._task is not None and not self._task.done():
            return
        self._stop_event.clear()
        self._task = asyncio.create_task(self._run(), name="standing_orders_runner")
        logger.info("Standing orders runner started")

    async def stop(self) -> None:
        self._stop_event.set()
        if self._task is None:
            return
        self._task.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await self._task
        self._task = None

    async def _run(self) -> None:
        while not self._stop_event.is_set():
            poll = max(1, int(getattr(config, "agent_standing_orders_poll_s", 10) or 10))
            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=poll)
                break
            except asyncio.TimeoutError:
                pass
            if not getattr(config, "agent_standing_orders_enabled", True):
                continue
            try:
                await self.check_and_fire_due_orders()
            except Exception as exc:
                logger.warning("standing orders tick raised: %s", exc)

    # ── Public: test-surface method ──────────────────────────────────────────

    async def check_and_fire_due_orders(self) -> list[str]:
        """
        Fetch enabled orders, fire those whose schedule + condition are due.
        Returns the list of fired order IDs (useful for tests).
        """
        fired: list[str] = []
        from db.database import get_session
        from db.models import StandingOrder

        async with get_session() as db:
            result = await db.execute(
                select(StandingOrder).where(StandingOrder.enabled.is_(True))
            )
            orders = list(result.scalars())

        now = _utcnow()
        for order in orders:
            try:
                schedule = parse_schedule(order.schedule_json)
            except Exception as exc:
                logger.warning("standing order %s schedule parse failed: %s", order.id, exc)
                continue
            # SQLite DateTime columns come back naive — normalize to UTC
            # before comparing against our tz-aware `now`.
            last_fired = order.last_fired_at
            if last_fired is not None and last_fired.tzinfo is None:
                last_fired = last_fired.replace(tzinfo=timezone.utc)
            due_at = next_fire_time(schedule, now, last_fired)
            if due_at is not None and due_at.tzinfo is None:
                due_at = due_at.replace(tzinfo=timezone.utc)
            if due_at is None or due_at > now:
                continue
            # Conditional — evaluate the guard NOW, after schedule eligibility.
            if isinstance(schedule, ConditionalSchedule):
                try:
                    cond_true = await evaluate_condition(schedule.condition)
                except ValueError as exc:
                    logger.warning(
                        "standing order %s condition invalid: %s",
                        order.id, exc,
                    )
                    continue
                if not cond_true:
                    continue
            # Phase 9.4a — foreground task activity no longer defers an order;
            # we fire on background. The background slot's queue is bounded,
            # so a TrackBusyError ends up a soft skip + retry.

            # One-shot orders should not fire more than once.
            if isinstance(schedule, OneShotSchedule) and order.last_fired_at is not None:
                continue
            ok = await self._fire_order(order)
            if ok:
                fired.append(order.id)
        return fired

    async def _fire_order(self, order) -> bool:
        from agent.errors import TrackBusyError

        try:
            action = json.loads(order.action_json or "{}")
        except json.JSONDecodeError as exc:
            logger.warning("standing order %s action_json invalid: %s", order.id, exc)
            return False
        goal = (action.get("goal") or order.description or "").strip()
        if not goal:
            logger.warning("standing order %s has empty goal — skipping", order.id)
            return False

        # Phase 9.4a — fire on the background track so foreground user
        # conversation is not preempted. When the background queue is
        # saturated, TrackBusyError defers the fire to the next tick
        # without marking last_fired_at.
        try:
            task_id, started = await self.runtime.start_task(
                goal,
                origin="standing_order",
                track="background",
                order_id=order.id,
            )
        except TrackBusyError as exc:
            logger.info(
                "standing order %s deferred — background track full "
                "(queue=%d); will retry next tick",
                order.id, exc.queue_size,
            )
            return False
        except Exception as exc:
            logger.error("standing order %s start_task raised: %s", order.id, exc)
            return False

        # `started=False` on background means the task was queued (not refused)
        # — still a legitimate fire; we just haven't entered the slot yet.
        outcome = f"task={task_id}" if started else f"queued={task_id}"

        # Mark fired AFTER we know the task either started or queued.
        now = _utcnow()
        await self._update_fire_stats(order.id, now, outcome)

        # Emit proactive trigger so the proactive loop can decide whether
        # to surface the outcome to the user once the task finishes. We
        # push the trigger at FIRE time; the loop's LLM decide sees it on
        # its next cycle.
        with contextlib.suppress(Exception):
            from agent.proactive import get_loop
            from agent.proactive_triggers import (
                ProactiveTrigger,
                ProactiveTriggerKind,
            )
            loop = get_loop()
            if loop is not None:
                loop.push_trigger(ProactiveTrigger(
                    kind=ProactiveTriggerKind.STANDING_ORDER_FIRED,
                    context={
                        "order_id": order.id,
                        "description": order.description,
                        "task_id": task_id,
                    },
                    priority=5,
                ))
        return True

    async def _update_fire_stats(self, order_id: str, now: datetime, outcome: str) -> None:
        from db.database import get_session
        from db.models import StandingOrder

        async with get_session() as db:
            await db.execute(
                update(StandingOrder)
                .where(StandingOrder.id == order_id)
                .values(
                    last_fired_at=now,
                    fire_count=StandingOrder.fire_count + 1,
                    last_outcome=outcome[:256] if outcome else None,
                )
            )
            await db.commit()


__all__ = ["StandingOrderRunner"]
