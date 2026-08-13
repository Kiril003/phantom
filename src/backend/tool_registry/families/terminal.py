"""Terminal family — sandboxed shell execution (HIGH gate)."""
from __future__ import annotations

from ..spec import ToolSpec, family_specs

TOOLS: list[ToolSpec] = family_specs([
    "run_terminal_command",
])

__all__ = ["TOOLS"]
