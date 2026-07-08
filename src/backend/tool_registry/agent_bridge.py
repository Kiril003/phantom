"""
Agent-view bridge (G1.1): every agent Action appears in the ONE registry.

An Action is declared once (its class carries name, pydantic args schema,
risk_level); this bridge derives its ToolSpec so provider adapters and
introspection see chat tools and agent verbs through the same contract.
Execution of agent verbs stays with the kernel executor — the Action
class rides on the spec, the registry does not run it.

Imports are lazy: the agent world imports ai.provider at module level,
so an eager import here would re-create the import cycle this phase
exists to kill. See G1.2.
"""
from __future__ import annotations

from .spec import ToolSpec


def agent_specs() -> list[ToolSpec]:
    from agent.actions.registry import registry as action_registry
    from ai.tool_use import action_to_tool_schema

    specs: list[ToolSpec] = []
    for cls in action_registry.all():
        ts = action_to_tool_schema(cls)
        specs.append(ToolSpec(
            name=ts.name,
            description=ts.description,
            parameters=ts.parameters,
            gate=cls.risk_level,
            views=frozenset({"agent"}),
            action_cls=cls,
        ))
    return specs


def register_agent_view() -> int:
    """Idempotently register all agent verbs into the default registry.

    Returns the number of specs now carrying the "agent" view.
    """
    from .registry import register_specs, registry

    register_specs(agent_specs())
    return len(registry().specs("agent"))


__all__ = ["agent_specs", "register_agent_view"]
