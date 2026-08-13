"""Facts family — the user-fact store behind the behavioural model."""
from __future__ import annotations

from ..spec import ToolSpec, family_specs

TOOLS: list[ToolSpec] = family_specs([
    "list_user_facts",
    "create_user_fact",
    "delete_user_fact",
])

__all__ = ["TOOLS"]
