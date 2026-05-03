"""Two-tier planner — strategic (decompose) + tactical (next step) + reflector.

Phase 23-F — public surface lifted to the package so consumers (loop, agent
studio, future MCP adapters, tests) can import the canonical entry points
without reaching into the submodule layout.

Stable contract — these names are what other modules should import:

    from agent.planner import (
        strategic_plan,         # async — decompose a goal into sub-goals
        tactical_plan,          # async — pick the next PlanStep
        tactical_plan_safe,     # async — wraps tactical_plan; never raises
        reflect,                # async — produce a ReflectionResult
        PlannerLLMError,        # raised when the planner LLM cannot answer
        BlockedQuotaError,      # raised when the provider quota is exhausted
    )

Importing the submodules directly (`from agent.planner import strategic`)
remains supported for advanced call sites that want the rest of the
module surface (private helpers, prompt strings). The submodules are the
implementation detail; the names above are the contract.
"""
from __future__ import annotations

from ._llm import BlockedQuotaError, PlannerLLMError
from .reflector import reflect
from .strategic import plan as strategic_plan
from .tactical import plan as tactical_plan
from .tactical import plan_safe as tactical_plan_safe

__all__ = [
    "strategic_plan",
    "tactical_plan",
    "tactical_plan_safe",
    "reflect",
    "PlannerLLMError",
    "BlockedQuotaError",
]
