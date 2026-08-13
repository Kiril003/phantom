"""Timers family — countdown timers and wall-clock alarms."""
from __future__ import annotations

from ..spec import ToolSpec, family_specs

TOOLS: list[ToolSpec] = family_specs([
    "create_timer",
    "cancel_timer",
    "list_timers",
    "create_alarm",
    "delete_alarm",
    "set_alarm_active",
    "list_alarms",
])

__all__ = ["TOOLS"]
