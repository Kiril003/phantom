"""Tool families — one file per family, specs built at import."""
from __future__ import annotations

from . import (
    calendar_tools,
    facts,
    files,
    memory,
    studio,
    system,
    terminal,
    timers,
    vault,
    wardriving,
    web,
)

ALL_TOOLS = [
    *memory.TOOLS,
    *system.TOOLS,
    *web.TOOLS,
    *calendar_tools.TOOLS,
    *timers.TOOLS,
    *files.TOOLS,
    *terminal.TOOLS,
    *studio.TOOLS,
    *vault.TOOLS,
    *facts.TOOLS,
    *wardriving.TOOLS,
]

__all__ = ["ALL_TOOLS"]
