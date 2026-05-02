"""
Phase 17 — Multi-agent orchestrator package.

Replaces the placeholder `agent/ai/agents/orchestrator.py:single` hardcode
with a real `Council` of 3-7 AgentRoles that deliberate before the agent
commits to non-trivial decisions. Distinct from `Swarm` (parallel branches —
future scope).

Public surface:
  • `Council` — round-robin debate engine.
  • `AgentRole` — pluggable per-perspective deliberation.
  • `pick_orchestrator_mode` — chooses single / council / swarm based on the
    situation's complexity, risk, and user setting.
  • `quality_gate` — Producer → Critic → Verifier loop wrapping outputs.
"""
from .council import Council
from .modes import pick_orchestrator_mode
from .role import AgentRole, build_default_council_roles
from .quality_gate import QualityGate, run_quality_gate

__all__ = [
    "Council",
    "AgentRole",
    "build_default_council_roles",
    "pick_orchestrator_mode",
    "QualityGate",
    "run_quality_gate",
]
