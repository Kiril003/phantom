"""
Orchestrator mode picker — replaces the placeholder hardcode in
`agent/ai/agents/orchestrator.py:decide_mode`.

Decision matrix:
  • user setting `agent_orchestrator_mode` ∈ {auto, single, council, swarm}
    is the upper bound; anything below is auto-derived.
  • In auto mode:
      - kind == 'before_destructive' OR is_destructive(action) → council
      - kind == 'strategic_revise' OR 'quality_gate' OR 'user_invoked' → council
      - kind == 'info_need' → council (we want council to vote on phrasing /
        whether to search-first vs ask)
      - kind == 'low_confidence' AND confidence < 0.5 → council
      - all other cases → single (cheap path)
  • Swarm is reserved for explicit user opt-in (UI tab) — auto never picks it
    because it forks into separate task branches that need merging.
"""
from __future__ import annotations

from typing import Any

from ...schemas import (
    CouncilSituation,
    OrchestratorMode,
)
from .deterministic_personas import is_destructive


_AUTO_COUNCIL_KINDS = frozenset({
    "before_destructive",
    "strategic_revise",
    "quality_gate",
    "user_invoked",
    "info_need",
    # Phase 23-D — risk gate auto-engages Council before phone approval so
    # the deliberation can refuse a destructive ask outright (verdict
    # "abort"/"revise") instead of relying on the operator to catch it.
    "high_risk_action",
})


def pick_orchestrator_mode(
    situation: CouncilSituation,
    *,
    user_setting: str = "auto",
    confidence_threshold: float = 0.5,
) -> OrchestratorMode:
    """Return the mode that should drive the next decision.

    `user_setting` defaults to "auto" so we honour the matrix; "single" forces
    bypass; "council" forces deliberation regardless of cheap/critical heuristic.
    """
    setting = (user_setting or "auto").lower().strip()
    if setting == "single":
        return "single"
    if setting == "council":
        return "council"
    if setting == "swarm":
        return "swarm"

    # Auto path.
    if situation.kind in _AUTO_COUNCIL_KINDS:
        return "council"

    # Confidence-driven escalation.
    if (
        situation.kind == "low_confidence"
        and situation.monologue is not None
        and situation.monologue.confidence < confidence_threshold
    ):
        return "council"

    # Action-content destructive heuristic.
    pa = situation.proposed_action or {}
    if isinstance(pa, dict):
        blob_parts: list[str] = []
        action = pa.get("action")
        if isinstance(action, str):
            blob_parts.append(action)
        args = pa.get("args")
        if isinstance(args, dict):
            for v in args.values():
                if isinstance(v, str):
                    blob_parts.append(v)
        if is_destructive("\n".join(blob_parts)):
            return "council"

    return "single"


__all__ = ["pick_orchestrator_mode"]
