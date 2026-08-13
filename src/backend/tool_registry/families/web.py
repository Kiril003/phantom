"""Web family — outbound network lookups (search, places, routing).

``search_web`` carries the 25s timeout override from TIMEOUTS; the old
PER_TOOL_TIMEOUT_S keyed it as "web_search" and so never fired.
"""
from __future__ import annotations

from ..spec import ToolSpec, family_specs

TOOLS: list[ToolSpec] = family_specs([
    "search_web",
    "search_nearby_places",
    "map.plan_route",
])

__all__ = ["TOOLS"]
