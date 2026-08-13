"""Calendar family — CalendarEvent CRUD.

Named ``calendar_tools`` rather than ``calendar`` so the module never
shadows the stdlib ``calendar`` for anything doing a plain import.
"""
from __future__ import annotations

from ..spec import ToolSpec, family_specs

TOOLS: list[ToolSpec] = family_specs([
    "get_calendar_events",
    "create_calendar_event",
    "update_calendar_event",
    "delete_calendar_event",
])

__all__ = ["TOOLS"]
