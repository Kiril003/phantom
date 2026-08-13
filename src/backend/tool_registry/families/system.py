"""System family — ContextEngine reads, the audit ledger, and the agent verb.

``agent.delegate`` lives here rather than in the agent bridge: the bridge
derives specs from Action classes for the *agent* view, while this is the
chat-facing handler that hands work to the kernel runtime.
"""
from __future__ import annotations

from ..spec import ToolSpec, family_specs

TOOLS: list[ToolSpec] = family_specs([
    "get_system_metrics",
    "get_sensor_status",
    "get_internal_state",
    "get_my_location",
    "get_recent_hearing",
    "query_audit_log",
    "create_checkpoint",
    "agent.delegate",
])

__all__ = ["TOOLS"]
