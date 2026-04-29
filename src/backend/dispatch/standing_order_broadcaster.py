"""Day-4 Wave-2 T-3 — standing-order event_bus → WS broadcaster
(ADR-SOH-005).

Three topics emitted by the runner:

  standing_order.tick     — once per poll cycle after
                             `check_and_fire_due_orders()` returns
                             {cycle_at_iso, evaluated, fired, skipped}
  standing_order.fired    — successful dispatch
                             {order_id, action_kind, task_id,
                              outcome_summary, fired_at_iso}
  standing_order.skipped  — skipped (condition false, queue full,
                             lease conflict, dispatch failure)
                             {order_id, action_kind, reason, at_iso}

Each topic flows through the existing `/ws` multiplex envelope as
`{channel: 'standing_orders', type: <topic-suffix>, data: <payload>}`
so the frontend `useStandingOrders` hook can subscribe via the WS
multiplexer for live status without short-poll endpoints.

Pattern mirrors `dispatch/state_broadcaster.py` (Day-3 P-3).
"""
from __future__ import annotations

import logging
from typing import Any, Awaitable, Callable

from core.event_bus import EventBus

logger = logging.getLogger(__name__)


# Type alias for WS hub broadcast — keep the boundary loose so the
# broadcaster module doesn't import the hub directly (testability).
BroadcastFn = Callable[..., Awaitable[Any]]


_TOPIC_TO_TYPE = {
    "standing_order.tick": "tick",
    "standing_order.fired": "fired",
    "standing_order.skipped": "skipped",
}
_CHANNEL = "standing_orders"


def register_standing_order_broadcaster(
    bus: EventBus,
    broadcast: BroadcastFn,
) -> None:
    """Subscribe to three topics and forward each to the WS hub.

    Idempotent at the bus level — `EventBus.subscribe` returns an
    unsubscriber but we don't need it; the runner's lifecycle is
    bound to the lifespan, and the bus singleton lives forever.

    Each handler is `async` so the bus's `emit_async` path delivers
    fire-and-forget without blocking the runner. A handler that
    raises is contained — `EventBus.emit_async` wraps each call
    site in a try/except (per existing event_bus.py contract).
    """

    async def _on_event(topic: str, payload: dict[str, Any]) -> None:
        ws_type = _TOPIC_TO_TYPE.get(topic)
        if ws_type is None:
            return
        try:
            await broadcast(_CHANNEL, ws_type, payload)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "standing_order_broadcaster: WS fan-out for %s raised "
                "(continuing): %s",
                topic,
                exc,
            )

    # The bus's subscribe() takes (event, handler) — wrap with
    # closures that capture the topic so a single handler dispatches
    # by event name.
    for topic in _TOPIC_TO_TYPE:
        async def _make_handler(payload: Any, _t: str = topic) -> None:
            if not isinstance(payload, dict):
                # The runner always emits dicts per ADR-SOH-005 — but
                # be defensive in case a future emitter sends a tuple.
                payload = {"value": payload}
            await _on_event(_t, payload)

        bus.subscribe(topic, _make_handler)
    logger.info(
        "dispatch.standing_order_broadcaster wired (3 topics → ws/%s)",
        _CHANNEL,
    )


def topic_to_ws_type(topic: str) -> str | None:
    """Public test-surface lookup. Returns the WS-message `type` for a
    given event_bus topic, or None for unrecognised topics."""
    return _TOPIC_TO_TYPE.get(topic)


__all__ = [
    "register_standing_order_broadcaster",
    "topic_to_ws_type",
]
