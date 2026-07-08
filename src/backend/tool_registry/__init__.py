"""
tool_registry — the ONE tool world (G1.1, PHANTOM_FORGE_PLAN).

Replaces ai/tool_executor.py + ai/chat_tools.py. One typed ToolSpec per
capability (schema + gate tier + audit + node tag), one dispatch surface
(execute_tool), families under tool_registry/families/, and the agent
verbs bridged in as the "agent" view (agent_bridge). Chat and agent are
two views on this registry — never two arsenals.
"""
from __future__ import annotations

from typing import Any

from .agent_bridge import agent_specs, register_agent_view
from .common import (
    _args_snippet,
    _err,
    _local_to_utc,
    _local_tz,
    _ok,
    _parse_date_range,
    _parse_datetime_freeform,
    _safe_int,
    _safe_query_str,
    _session_factory,
    _today_local,
)
from .registry import (
    MAX_TOOL_CALLS_PER_TURN,
    TOOL_TIMEOUT_S,
    ToolRegistry,
    _HANDLERS,
    execute_tool,
    register_specs,
    registry,
)
from .spec import CHAT_SAFE_TOOL_NAMES, GATES, TIMEOUTS, Handler, ToolSpec, build_specs

# Wire-compat catalog (ai/chat_tools.py contract): every spec that carries
# the "data" view, in registration order.
CHAT_DATA_TOOLS: list[dict[str, Any]] = registry().declarations("data")
DATA_TOOL_NAMES: frozenset[str] = frozenset(d["name"] for d in CHAT_DATA_TOOLS)


def get_tool_schema(name: str) -> dict[str, Any] | None:
    """Return the declaration dict for a tool by name, or None if unknown."""
    spec = registry().get(name)
    if spec is None or "data" not in spec.views:
        return None
    return spec.declaration()


__all__ = [
    "ToolRegistry",
    "ToolSpec",
    "Handler",
    "build_specs",
    "registry",
    "register_specs",
    "execute_tool",
    "agent_specs",
    "register_agent_view",
    "CHAT_DATA_TOOLS",
    "DATA_TOOL_NAMES",
    "CHAT_SAFE_TOOL_NAMES",
    "GATES",
    "TIMEOUTS",
    "get_tool_schema",
    "TOOL_TIMEOUT_S",
    "MAX_TOOL_CALLS_PER_TURN",
]
