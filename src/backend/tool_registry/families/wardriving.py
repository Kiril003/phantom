"""Wardriving family — queries over the collected WiFi/BLE observations."""
from __future__ import annotations

from ..spec import ToolSpec, family_specs

TOOLS: list[ToolSpec] = family_specs([
    "query_wardriving",
])

__all__ = ["TOOLS"]
