"""Source adapters for live OmniMap layers (Phase 24-F+).

Each adapter is a thin, typed HTTP client + parser that returns
typed dataclasses. Adapters never broadcast directly — that's the
``geo.live_tasker``'s responsibility, so an adapter can be pytest-ed
in isolation without dragging in the WebSocket or event-bus stack.
"""
from __future__ import annotations

from .alarms_ua import (
    AlarmsUAAdapter,
    AlarmsUAAlert,
    get_default_alarms_ua,
)

__all__ = [
    "AlarmsUAAdapter",
    "AlarmsUAAlert",
    "get_default_alarms_ua",
]
