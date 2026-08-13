"""Studio family — agent studio authoring plus the workbench surface.

Both halves are "compose an artifact then run it": studio_* builds agent
cards, the workbench trio builds and refines generated workbenches.
"""
from __future__ import annotations

from ..spec import ToolSpec, family_specs

TOOLS: list[ToolSpec] = family_specs([
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
    "create_workbench",
    "refine_workbench",
    "list_workbenches",
])

__all__ = ["TOOLS"]
