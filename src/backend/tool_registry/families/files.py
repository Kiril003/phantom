"""Files family — sandboxed filesystem reads, writes, and image display.

``write_file`` / ``make_directory`` carry MEDIUM gates and are absent from
CHAT_SAFE_TOOL_NAMES, so they register with the "data" view but not "chat".
"""
from __future__ import annotations

from ..spec import ToolSpec, family_specs

TOOLS: list[ToolSpec] = family_specs([
    "list_files",
    "read_file",
    "search_files",
    "write_file",
    "make_directory",
    "show_image",
])

__all__ = ["TOOLS"]
