"""Memory family — recall over the strategic/tactical stores and anchors."""
from __future__ import annotations

from ..spec import ToolSpec, family_specs

TOOLS: list[ToolSpec] = family_specs([
    "recall_memory_facts",
    "query_temporal_anchors",
    "search_locationhistory",
])

__all__ = ["TOOLS"]
