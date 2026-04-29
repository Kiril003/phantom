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
        # Day-4 Wave-2 T-1 (ADR-SOH-002): boot reconciliation. A
        # runner that crashed mid-`start_task` would otherwise leave
        # `in_flight_task_id` pinned forever. Reconcile every stale
        # lease against agent.audit.task_status before the poll loop
        # begins. Best-effort — a failure here logs WARN but never
        # blocks startup (Day-3 lifespan invariant: runner.start must
        # succeed for the rest of the agent runtime).
        try:
            recovered = await self.recover_stale_leases()
            if recovered:
                logger.info(
                    "Standing orders: recovered %d stale lease(s) at boot",
                    recovered,
                )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Standing orders: stale-lease recovery raised at boot "
                "(continuing): %s",
                exc,
            )

        self._stop_event.clear()
        self._task = asyncio.create_task(self._run(), name="standing_orders_runner")
        logger.info("Standing orders runner started")

    async def recover_stale_leases(self) -> int:
        """Day-4 Wave-2 T-1 (ADR-SOH-002): reconcile lingering
        ``StandingOrder.in_flight_task_id`` against reality.

        Selects rows where ``in_flight_task_id IS NOT NULL`` AND
        ``claimed_at < now - lease_ttl``; for each, calls
        ``agent.audit.task_status(task_id)`` and reconciles:

          - ``done | cancelled`` → clear lease columns; set
            ``last_outcome = "recovered:<status>"``.
          - ``error | missing`` → clear lease; the runner re-fires on
            the next tick (idempotent because `last_fired_at` is
            already set).
          - ``running`` → leave as-is (lease still legitimate; only
            stale by clock).

        Returns the number of leases released. Best-effort under load:
        a per-row failure logs WARN and continues to the next row.
        """
        from datetime import datetime, timedelta, timezone
        from sqlalchemy import select

        from agent.audit import task_status
        from db.database import get_session
        from db.models import StandingOrder

        ttl_s = max(
            1,
            int(
                getattr(config, "agent_standing_orders_lease_ttl_s", 300) or 300
            ),
        )
        cutoff = datetime.now(timezone.utc) - timedelta(seconds=ttl_s)
        # SQLAlchemy stores DateTime without TZ on SQLite; the cutoff
        # comparison still works because the persisted column is the
        # `_now` UTC value (db.models._now returns naive UTC).
        cutoff_naive = cutoff.replace(tzinfo=None)

        released = 0
        async with get_session() as db:
            rows = (
                await db.execute(
                    select(StandingOrder).where(
                        StandingOrder.in_flight_task_id.is_not(None),
                        StandingOrder.claimed_at.is_not(None),
                        StandingOrder.claimed_at < cutoff_naive,
                    )
                )
            ).scalars().all()
            for row in rows:
                tid = row.in_flight_task_id
                try:
                    status = await task_status(tid or "")
                except Exception as exc:  # noqa: BLE001
                    logger.warning(
                        "recover_stale_leases: task_status(%s) raised "
                        "(treating as missing): %s",
                        tid,
                        exc,
                    )
                    status = "missing"

                if status == "running":
                    # Live; lease is legitimately old (long-running
                    # task). Leave as-is.
                    continue
                # Reconcile: clear lease columns regardless of failure
                # vs success branch — the runner re-fires on the next
                # tick if status was error/missing.
                row.in_flight_task_id = None
                row.claimed_at = None
                if status in ("done", "cancelled"):
                    row.last_outcome = f"recovered:{status}"
                released += 1
            await db.commit()
        return released

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

        Day-4 Wave-2 T-3 (ADR-SOH-005): emits ``standing_order.tick``
        on the EventBus once per cycle so the dispatch broadcaster
        can fan out live status to the WS hub without short-poll
        endpoints. The payload carries `{cycle_at_iso, evaluated,
        fired, skipped}` per the ADR.
        """
        fired: list[str] = []
        skipped_count = 0
        from datetime import datetime as _datetime

        from core.event_bus import event_bus as _event_bus
        from db.database import get_session
        from db.models import StandingOrder

        cycle_at_iso = _datetime.now(timezone.utc).isoformat()

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
                    skipped_count += 1
                    self._emit_skipped(_event_bus, order, "condition_invalid")
                    continue
                if not cond_true:
                    skipped_count += 1
                    self._emit_skipped(_event_bus, order, "condition_false")
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
                self._emit_fired(_event_bus, order)
            else:
                skipped_count += 1
                self._emit_skipped(_event_bus, order, "dispatch_error")
        # T-3 tick payload — operators see live cycle accounting via
        # WS without short-poll. Fire-and-forget; failure inside the
        # bus emit is contained.
        try:
            _event_bus.emit(
                "standing_order.tick",
                {
                    "cycle_at_iso": cycle_at_iso,
                    "evaluated": len(orders),
                    "fired": len(fired),
                    "skipped": skipped_count,
                },
            )
        except Exception as exc:  # noqa: BLE001
            logger.debug("standing_order.tick emit raised: %s", exc)
        return fired

    @staticmethod
    def _emit_fired(bus, order) -> None:
        """T-3 helper: emit `standing_order.fired` after a successful
        `_fire_order`. action_kind read from the denorm column added in
        T-2; falls back to "task" for legacy rows."""
        from datetime import datetime as _dt

        try:
            bus.emit(
                "standing_order.fired",
                {
                    "order_id": order.id,
                    "action_kind": getattr(order, "action_kind", None) or "task",
                    "task_id": getattr(order, "in_flight_task_id", None),
                    "outcome_summary": "ok",
                    "fired_at_iso": _dt.now(timezone.utc).isoformat(),
                },
            )
        except Exception as exc:  # noqa: BLE001
            logger.debug("standing_order.fired emit raised: %s", exc)

    @staticmethod
    def _emit_skipped(bus, order, reason: str) -> None:
        """T-3 helper: emit `standing_order.skipped` with a closed
        reason vocabulary {condition_false, condition_invalid,
        dispatch_error, lease_conflict, track_busy, cron_no_schedule}.
        See ADR-SOH-005."""
        from datetime import datetime as _dt

        try:
            bus.emit(
                "standing_order.skipped",
                {
                    "order_id": order.id,
                    "action_kind": getattr(order, "action_kind", None) or "task",
                    "reason": reason,
                    "at_iso": _dt.now(timezone.utc).isoformat(),
                },
            )
        except Exception as exc:  # noqa: BLE001
            logger.debug("standing_order.skipped emit raised: %s", exc)

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
