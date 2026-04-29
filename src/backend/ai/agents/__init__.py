"""Day-4 Wave-2 X-1 — chat orchestrator scaffold (ADR-ORC-001..005).

Public surface:

  decide_mode(...)        — pure decision: 'single' | 'parallel-K'.
  run_orchestrator(...)   — entry point routes_chat invokes when the
                            chat_orchestrator_enabled flag is ON AND
                            the active provider is Gemini.

Day-4 ships the SCAFFOLD only:
  - flag default OFF.
  - Gemini-only gate (Ollama always falls through).
  - X-1 always returns mode='single' regardless of input — actual
    parallel-K fan-out lands in X-3/X-4.

The cluster lives entirely under `src/backend/ai/agents/`. It does NOT
import from `agent.actions`, `agent.runtime`, `agent.proactive`,
`agent.standing_orders`, `agent.mcp` — TM-17B-E4 invariant extended
to `ai/agents/**` per ADR-IGD-001 (X-3 enforces this with an AST gate
that's already shipped at tests/test_phase_x3_ai_agents_import_gate.py).
"""
from .budget import (
    BudgetSplit,
    LeafTimeout,
    PER_SUB_FLOOR_MS,
    gather_with_deadline,
    split,
)
from .nonce import (
    envelope_key_for_sub,
    fresh_sub_nonce,
    merge_envelope_key,
    sanitize_leaf_draft,
)
from .orchestrator import (
    OrchestratorMode,
    decide_mode,
    run_orchestrator,
)

__all__ = [
    "BudgetSplit",
    "LeafTimeout",
    "OrchestratorMode",
    "PER_SUB_FLOOR_MS",
    "decide_mode",
    "envelope_key_for_sub",
    "fresh_sub_nonce",
    "gather_with_deadline",
    "merge_envelope_key",
    "run_orchestrator",
    "sanitize_leaf_draft",
    "split",
]
