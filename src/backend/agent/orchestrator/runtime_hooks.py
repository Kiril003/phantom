"""
Phase 17 — Runtime hooks for the Council.

Tiny adapter that the agent loop can call at decision points without
having to know about Council/Quality-Gate plumbing directly. Two hooks:

  • maybe_consult_council(situation, runtime) — runs the mode picker;
    if it says 'council', spawns Council.run_round, broadcasts the lifecycle
    WS events, and returns a CouncilDecision. Returns None on 'single'.
  • run_quality_gate_for(intent, criteria, producer, runtime, ...) — thin
    wrapper that lets the loop wrap an output-producing closure in the
    Producer→Critic→Verifier loop with WS progress events.

Both hooks are no-op-safe when ai_router is unreachable: Council falls back
to deterministic personas, Quality Gate falls back to regex-based critique.
The runtime never blocks on the LLM here.
"""
from __future__ import annotations

import logging
from typing import Any, Awaitable, Callable

from ..schemas import CouncilDecision, CouncilSituation
from .council import Council, build_default_council_roles
from .modes import pick_orchestrator_mode
from .quality_gate import (
    GateDraft,
    GateResult,
    QualityGate,
    CritiqueReport,
)

logger = logging.getLogger(__name__)


async def maybe_consult_council(
    situation: CouncilSituation,
    *,
    runtime: Any,
    user_setting: str = "auto",
    include_aesthete: bool = False,
) -> CouncilDecision | None:
    """Auto-fire a Council round if the mode picker says it's needed.

    Caller passes the runtime so we can broadcast lifecycle WS events
    without exposing the hub directly.
    """
    mode = pick_orchestrator_mode(situation, user_setting=user_setting)
    if mode != "council":
        return None

    try:
        from ai.provider import ai_router
    except Exception:
        ai_router = None

    async def _on_role_spoke(stmt) -> None:
        try:
            await runtime._broadcast(  # noqa: SLF001
                "council.role_spoke",
                {"task_id": situation.task_id, "statement": stmt.model_dump(mode="json")},
            )
        except Exception:
            pass

    council = Council(
        roles=build_default_council_roles(include_aesthete=include_aesthete),
        ai_router=ai_router,
        on_role_spoke=_on_role_spoke,
    )

    try:
        await runtime._broadcast(  # noqa: SLF001
            "council.round_started",
            {
                "task_id": situation.task_id,
                "kind": situation.kind,
                "summary": (situation.summary or "")[:300],
            },
        )
    except Exception:
        pass

    try:
        decision = await council.run_round(situation, task_id=situation.task_id)
    except Exception as exc:
        logger.debug("council run_round failed: %s", exc)
        return None

    try:
        await runtime._broadcast(  # noqa: SLF001
            "council.consensus_reached",
            {
                "task_id": situation.task_id,
                "decision": decision.model_dump(mode="json"),
            },
        )
    except Exception:
        pass

    return decision


async def run_quality_gate_for(
    *,
    intent: str,
    acceptance_criteria: str,
    producer: Callable[[GateDraft | None, CritiqueReport | None], Awaitable[GateDraft]],
    runtime: Any,
    artefact_kind: str = "text",
    task_id: str | None = None,
    max_revisions: int = 3,
) -> GateResult:
    """Producer-Critic-Verifier wrapper with live FE progress events."""
    try:
        from ai.provider import ai_router
    except Exception:
        ai_router = None

    async def _on_revision(round_idx: int, draft: GateDraft, critique: CritiqueReport) -> None:
        try:
            await runtime._broadcast(  # noqa: SLF001
                "quality_gate.revision_completed",
                {
                    "task_id": task_id,
                    "round": round_idx,
                    "blockers": [i.message for i in critique.issues if i.severity == "blocker"],
                    "warnings_count": sum(1 for i in critique.issues if i.severity == "warning"),
                    "draft_excerpt": (draft.text or "")[:240],
                },
            )
        except Exception:
            pass

    gate = QualityGate(
        ai_router=ai_router,
        max_revisions=max_revisions,
        on_revision=_on_revision,
    )
    try:
        await runtime._broadcast(  # noqa: SLF001
            "quality_gate.revision_started",
            {"task_id": task_id, "intent": intent[:240]},
        )
    except Exception:
        pass

    return await gate.run(
        intent=intent,
        acceptance_criteria=acceptance_criteria,
        producer=producer,
        artefact_kind=artefact_kind,
        task_id=task_id,
    )


__all__ = ["maybe_consult_council", "run_quality_gate_for"]
