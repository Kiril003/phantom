"""
ToolSpec — the ONE tool contract (G1.1, PHANTOM_FORGE_PLAN).

Every capability PHANTOM exposes to any LLM surface is declared exactly
once as a ToolSpec: JSON schema for the model, gate tier for the
permission layer, audit template for the ledger, node tag for mesh
capability honesty (phantom_node.toml, f0.3). Chat and the agent loop
are two *views* over the same registry — never two arsenals.
"""
from __future__ import annotations

from typing import Any, Awaitable, Callable

from pydantic import BaseModel, ConfigDict, Field

from agent.schemas import RiskLevel

Handler = Callable[[dict[str, Any], str], Awaitable[dict[str, Any]]]


class ToolSpec(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True, frozen=True)

    name: str
    description: str = ""
    parameters: dict[str, Any] = Field(
        default_factory=lambda: {"type": "object", "properties": {}, "required": []}
    )
    gate: RiskLevel = RiskLevel.SAFE
    audit: str = "invoked tool={name} user={user} args={args}"
    node: str = "forge"
    # Views: "data" — advertised to the chat LLM catalog; "chat" — allowed
    # through the chat dispatcher (TM-17B-S2 allowlist); "agent" — an agent
    # verb executed by the kernel via its Action class.
    views: frozenset[str] = frozenset()
    handler: Handler | None = None
    action_cls: Any | None = None
    timeout_s: float | None = None

    def declaration(self) -> dict[str, Any]:
        """Provider-facing function declaration (chat_tools wire shape)."""
        return {
            "name": self.name,
            "description": self.description,
            "parameters": self.parameters,
        }


# ── Policy tables ─────────────────────────────────────────────────────────────
# The chat-safe allowlist — mirrors ai/chat_tool_dispatcher._CHAT_SAFE_TOOL_NAMES
# (TM-17B-S2). The dispatcher remains the enforcement point and is still the
# authoritative copy; this one drives the registry's "chat" view. They are
# pinned identical by test_tool_registry_parity.py — the first copy of this
# list had already drifted 4 names behind (the Atelier workbench trio and
# show_image) before that test existed. Collapsing the two into one read is
# the next G1.1 step, once the dispatcher's own tests stop pinning its tuple.
CHAT_SAFE_TOOL_NAMES: frozenset[str] = frozenset({
    "search_nearby_places",
    "search_locationhistory",
    "query_temporal_anchors",
    "recall_memory_facts",
    "get_system_metrics",
    "get_sensor_status",
    "get_my_location",
    "get_internal_state",
    "create_alarm",
    "set_alarm_active",
    "delete_alarm",
    "list_alarms",
    "create_timer",
    "cancel_timer",
    "list_timers",
    "create_calendar_event",
    "update_calendar_event",
    "delete_calendar_event",
    "get_calendar_events",
    "search_web",
    "studio_list_agents",
    "studio_get_agent",
    "studio_create_agent",
    "studio_run_agent",
    "studio_delete_agent",
    "studio_card_catalog",
    "studio_update_agent",
    "studio_add_card",
    "studio_remove_card",
    "studio_link_cards",
    "studio_add_recipient",
    "studio_remove_recipient",
    "studio_set_inputs_schema",
    "vault_list",
    "vault_get",
    "vault_create",
    "vault_update",
    "vault_delete",
    "vault_restore",
    "vault_reveal",
    "run_terminal_command",
    "map.plan_route",
    "agent.delegate",
    # Atelier Chat W1-W2 — multi-file living creations with the seeing loop.
    "create_workbench",
    "refine_workbench",
    "list_workbenches",
    # Images inline in chat.
    "show_image",
})

# Gate tiers. Reads default to SAFE; state writes are LOW; irreversible /
# outward-facing writes are MEDIUM; plaintext-secret + shell are HIGH.
# Declarative in G1.1 — enforcement point stays the dispatcher allowlist
# until the kernel gate consumes these tiers.
GATES: dict[str, RiskLevel] = {
    "run_terminal_command": RiskLevel.HIGH,
    "vault_reveal": RiskLevel.HIGH,
    "write_file": RiskLevel.MEDIUM,
    "make_directory": RiskLevel.MEDIUM,
    "create_checkpoint": RiskLevel.MEDIUM,
    "agent.delegate": RiskLevel.MEDIUM,
    "vault_create": RiskLevel.MEDIUM,
    "vault_update": RiskLevel.MEDIUM,
    "vault_delete": RiskLevel.MEDIUM,
    "vault_restore": RiskLevel.MEDIUM,
    "studio_create_agent": RiskLevel.MEDIUM,
    "studio_run_agent": RiskLevel.MEDIUM,
    "studio_delete_agent": RiskLevel.MEDIUM,
    "studio_update_agent": RiskLevel.MEDIUM,
    "studio_add_card": RiskLevel.MEDIUM,
    "studio_remove_card": RiskLevel.MEDIUM,
    "studio_link_cards": RiskLevel.MEDIUM,
    "studio_add_recipient": RiskLevel.MEDIUM,
    "studio_remove_recipient": RiskLevel.MEDIUM,
    "studio_set_inputs_schema": RiskLevel.MEDIUM,
    "create_user_fact": RiskLevel.LOW,
    "delete_user_fact": RiskLevel.LOW,
    "create_calendar_event": RiskLevel.LOW,
    "update_calendar_event": RiskLevel.LOW,
    "delete_calendar_event": RiskLevel.LOW,
    "create_timer": RiskLevel.LOW,
    "cancel_timer": RiskLevel.LOW,
    "create_alarm": RiskLevel.LOW,
    "delete_alarm": RiskLevel.LOW,
    "set_alarm_active": RiskLevel.LOW,
}

# Per-tool wall-clock overrides — empty on purpose.
#
# The old PER_TOOL_TIMEOUT_S is keyed by names ("web_search"/"web_fetch"/
# "transcribe") that match no handler — the real tool is `search_web` — so the
# Day-5 "give network IO more room" bump has never once fired. That much the
# first draft of this table got right.
#
# What it got wrong: it re-keyed the bump as `search_web: 25.0` while the
# surrounding default had since risen from 10s to TOOL_TIMEOUT_S = 30s. A 25s
# "bump" under a 30s default is a 5s *cut* — so the correctly-keyed override
# would have quietly tightened the one tool it meant to loosen, and only once
# the registry became the live dispatch path.
#
# Every tool therefore resolves to the 30s default, exactly as today. Pinned by
# test_tool_registry_parity.test_effective_timeouts_match_legacy. If network IO
# genuinely needs more than 30s, raise it here deliberately — above the default,
# and with the parity test updated in the same commit.
TIMEOUTS: dict[str, float] = {}


def build_specs(
    *,
    handlers: dict[str, Handler],
    declarations: list[dict[str, Any]],
) -> list[ToolSpec]:
    """Zip a family's handlers with its provider declarations into ToolSpecs."""
    decl_by_name = {d["name"]: d for d in declarations}
    specs: list[ToolSpec] = []
    for name, fn in handlers.items():
        d = decl_by_name.get(name)
        views = set()
        if d is not None:
            views.add("data")
        if name in CHAT_SAFE_TOOL_NAMES:
            views.add("chat")
        specs.append(ToolSpec(
            name=name,
            description=(d or {}).get("description", (fn.__doc__ or "").strip()),
            parameters=(d or {}).get(
                "parameters", {"type": "object", "properties": {}, "required": []}
            ),
            gate=GATES.get(name, RiskLevel.SAFE),
            views=frozenset(views),
            handler=fn,
            timeout_s=TIMEOUTS.get(name),
        ))
    return specs


def family_specs(names: list[str]) -> list[ToolSpec]:
    """Build one family's ToolSpecs from the live handler table.

    G1.1 stages the split: the *index* moves here now, the handler bodies
    stay in ``ai/tool_executor.py`` until a family is migrated wholesale.
    The specs therefore wrap the very same function objects the legacy
    dispatcher calls — one arsenal with a typed index, never two.

    Imports are lazy so importing ``tool_registry`` never forces the chat
    stack (and its provider imports) at module-import time.

    Raises KeyError if a name has no handler or no declaration — a family
    listing a tool that does not exist is a build error, not a silent gap.
    """
    from ai.chat_tools import CHAT_DATA_TOOLS
    from ai.tool_executor import _HANDLERS as _LEGACY_HANDLERS

    decl_by_name = {d["name"]: d for d in CHAT_DATA_TOOLS}

    handlers: dict[str, Handler] = {}
    unknown: list[str] = []
    undeclared: list[str] = []
    for name in names:
        fn = _LEGACY_HANDLERS.get(name)
        if fn is None:
            unknown.append(name)
            continue
        if name not in decl_by_name:
            undeclared.append(name)
            continue
        handlers[name] = fn
    if unknown or undeclared:
        raise KeyError(
            f"family_specs: no handler for {unknown}; no declaration for {undeclared}"
        )

    return build_specs(
        handlers=handlers,
        declarations=[decl_by_name[n] for n in handlers],
    )


__all__ = [
    "Handler",
    "ToolSpec",
    "CHAT_SAFE_TOOL_NAMES",
    "GATES",
    "TIMEOUTS",
    "build_specs",
    "family_specs",
]
