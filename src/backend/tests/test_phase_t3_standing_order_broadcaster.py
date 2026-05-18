"""Day-4 Wave-2 T-3 — standing-order event_bus → WS broadcaster
(ADR-SOH-005). Closes the chat-liveness path for plan-scenes (D-1
in DAY4_BACKLOG_EXTENSIONS.md): once the runner emits, the frontend
ChatScene plan-step panel can render live status from a WS topic.

Coverage:

1. topic_to_ws_type maps the 3 ADR topics to WS message types
   (tick/fired/skipped); unknown topics return None.
2. register_standing_order_broadcaster subscribes to all 3 topics.
3. emit on each topic forwards through to the broadcast callable
   with channel="standing_orders" + correct type + payload pass-thru.
4. broadcast failure inside the handler is contained (logged WARN,
   does not raise into the bus emit path).
5. Runner.check_and_fire_due_orders emits a `standing_order.tick`
   even when zero orders are configured (defensive heartbeat).
6. Runner emits `standing_order.skipped` with reason="condition_false"
   when a conditional schedule's guard returns False.
7. Tick payload shape pinned: cycle_at_iso + evaluated + fired +
   skipped fields.
"""
from __future__ import annotations

import asyncio
import logging
from unittest.mock import AsyncMock

import pytest


# ─────────────────────────────────────────── topic ↔ ws-type mapping ──


class TestTopicMap:
    def test_known_topics_map_to_short_types(self):
        from dispatch import topic_to_ws_type

        assert topic_to_ws_type("standing_order.tick") == "tick"
        assert topic_to_ws_type("standing_order.fired") == "fired"
        assert topic_to_ws_type("standing_order.skipped") == "skipped"

    def test_unknown_topic_returns_none(self):
        from dispatch import topic_to_ws_type

        assert topic_to_ws_type("standing_order.exploded") is None
        assert topic_to_ws_type("not_even_a_standing_order_topic") is None


# ─────────────────────────────────────── broadcaster fan-out (in-process) ──


class TestBroadcasterFanOut:
    @pytest.mark.asyncio
    async def test_tick_forwards_to_ws_broadcast(self):
        from core.event_bus import EventBus
        from dispatch import register_standing_order_broadcaster

        bus = EventBus()
        broadcast = AsyncMock()
        register_standing_order_broadcaster(bus, broadcast)

        await bus.emit_async(
            "standing_order.tick",
            {"cycle_at_iso": "2026-05-02T00:00:00+00:00",
             "evaluated": 3, "fired": 1, "skipped": 2},
        )
        # event_bus emit_async fires async handlers — at least one
        # call should land on the broadcast mock.
        broadcast.assert_called()
        channel, ws_type, payload = broadcast.call_args.args
        assert channel == "standing_orders"
        assert ws_type == "tick"
        assert payload["evaluated"] == 3
        assert payload["fired"] == 1
        assert payload["skipped"] == 2

    @pytest.mark.asyncio
    async def test_fired_and_skipped_topics_distinguished(self):
        from core.event_bus import EventBus
        from dispatch import register_standing_order_broadcaster

        bus = EventBus()
        broadcast = AsyncMock()
        register_standing_order_broadcaster(bus, broadcast)

        await bus.emit_async(
            "standing_order.fired",
            {"order_id": "o-1", "action_kind": "task"},
        )
        await bus.emit_async(
            "standing_order.skipped",
            {"order_id": "o-2", "action_kind": "task",
             "reason": "condition_false"},
        )
        types = [c.args[1] for c in broadcast.call_args_list]
        assert "fired" in types
        assert "skipped" in types

    @pytest.mark.asyncio
    async def test_broadcast_failure_contained(self, caplog):
        """A WS broadcast that raises must NOT bubble up into the bus
        emit. The runner's tick fire-path is otherwise corrupted."""
        from core.event_bus import EventBus
        from dispatch import register_standing_order_broadcaster

        bus = EventBus()
        broadcast = AsyncMock(side_effect=RuntimeError("ws down"))
        register_standing_order_broadcaster(bus, broadcast)

        with caplog.at_level(logging.WARNING):
            # Should NOT raise:
            await bus.emit_async("standing_order.tick", {})
        assert any(
            "WS fan-out for standing_order.tick raised" in rec.message
            for rec in caplog.records
        )


# ────────────────────────────────────── runner emits per ADR-SOH-005 ──


class TestRunnerEmits:
    @pytest.mark.asyncio
    async def test_zero_orders_still_emits_tick(self, monkeypatch):
        """Even with no orders configured, the tick payload fires once
        per cycle so operators see a heartbeat in /metrics + WS."""
        from agent.operations.standing_orders.runner import StandingOrderRunner
        from agent.kernel.runtime import AgentRuntime
        from core import event_bus as ebmod

        captured: list[tuple[str, dict]] = []

        def _spy_emit(topic, data=None):
            captured.append((topic, data or {}))

        monkeypatch.setattr(ebmod.event_bus, "emit", _spy_emit)

        # Disable the existing standing-orders DB writes by clearing
        # the table is heavy; instead just call the method which will
        # find zero new rows for our user. The tick fires regardless.
        runner = StandingOrderRunner(AgentRuntime())
        await runner.check_and_fire_due_orders()

        ticks = [c for c in captured if c[0] == "standing_order.tick"]
        assert len(ticks) >= 1
        payload = ticks[-1][1]
        assert "cycle_at_iso" in payload
        assert "evaluated" in payload
        assert "fired" in payload
        assert "skipped" in payload

    @pytest.mark.asyncio
    async def test_conditional_false_emits_skipped(self, auth_root_user, monkeypatch):
        """A conditional order whose guard returns False fires
        `standing_order.skipped` with reason=condition_false."""
        import uuid

        from sqlalchemy import delete

        from agent.kernel.runtime import AgentRuntime
        from agent.operations.standing_orders.runner import StandingOrderRunner
        from core import event_bus as ebmod
        from db.database import get_session
        from db.models import StandingOrder

        # Force evaluate_condition to False so we hit the skip path
        # without computing real metrics.
        from agent.operations.standing_orders import conditions as cmod

        async def _always_false(_: str) -> bool:
            return False

        monkeypatch.setattr(cmod, "evaluate_condition", _always_false)
        # The runner imports evaluate_condition from agent.operations.standing_orders.conditions
        # via `from .conditions import ...` — also patch the runner's
        # local reference so our stub is the one called.
        from agent.operations.standing_orders import runner as rmod
        monkeypatch.setattr(rmod, "evaluate_condition", _always_false)

        # Seed a conditional order. claimed_at NULL; check-and-fire
        # picks it up because `enabled=True` + due immediately.
        order_id = str(uuid.uuid4())
        async with get_session() as db:
            db.add(
                StandingOrder(
                    id=order_id,
                    user_id=auth_root_user.id,
                    description=f"t3-cond-{order_id[:8]}",
                    kind="conditional",
                    schedule_json='{"kind": "conditional", "check_every_s": 60, '
                                  '"condition": "cpu_percent > 9999"}',
                    action_json='{"goal": "noop"}',
                )
            )
            await db.commit()

        captured: list[tuple[str, dict]] = []

        def _spy_emit(topic, data=None):
            captured.append((topic, data or {}))

        monkeypatch.setattr(ebmod.event_bus, "emit", _spy_emit)

        try:
            runner = StandingOrderRunner(AgentRuntime())
            await runner.check_and_fire_due_orders()
        finally:
            async with get_session() as db:
                await db.execute(
                    delete(StandingOrder).where(StandingOrder.id == order_id)
                )
                await db.commit()

        # Find the skipped emission for OUR order.
        skipped = [
            payload
            for (topic, payload) in captured
            if topic == "standing_order.skipped"
            and payload.get("order_id") == order_id
        ]
        assert skipped, (
            f"T-3: condition_false skip MUST fire standing_order.skipped "
            f"for the order id; captured={captured!r}"
        )
        assert skipped[0]["reason"] == "condition_false"
