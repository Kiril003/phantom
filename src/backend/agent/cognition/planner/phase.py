"""
Phase planner — decomposes a single Phase into a StrategicPlan (list of SubGoals).

This is a thin wrapper around the existing strategic.plan() that enriches the
goal string with phase-level context: the mission brief, phase index/total,
and the mission ledger summary so the planner has ground truth on what already
happened before this phase started.

Calling pattern mirrors how loop.py calls strategic.plan() for flat tasks, so
the returned StrategicPlan drops directly into state.sub_goals without any
conversion.
"""
from __future__ import annotations

import logging

from ...schemas import SelfModel, StrategicPlan
from . import strategic

logger = logging.getLogger(__name__)


async def plan_phase(
    *,
    user_id: str,
    mission: object,
    phase: object,
    self_model: SelfModel,
    revise_note: str = "",
    task_id: str | None = None,
) -> StrategicPlan:
    """Decompose a Phase into 1-7 SubGoals.

    This calls strategic.plan() with a synthesised goal string that combines:
      - The Phase.description and Phase.success_criteria (the 'what')
      - The Phase.rationale (the 'why')
      - The Phase index out of total (context for the planner)
      - The Mission.brief (the original operator ask)
      - The mission ledger summary (compressed history up to this point)

    Args:
        user_id: Used for strategic memory recall inside strategic.plan().
        mission: db.models.Mission ORM row (reads .brief, .ledger_path, .id).
        phase: db.models.Phase ORM row (reads .idx, .description,
               .success_criteria, .rationale).
        self_model: Current PHANTOM self-model.
        revise_note: Revision instructions when re-planning a failed phase.
        task_id: Optional parent task id for LLM budget tracking.

    Returns:
        StrategicPlan ready to be installed into TaskState.sub_goals.
    """
    # Extract fields duck-typed so tests can pass simple namespaces.
    phase_idx: int = getattr(phase, "idx", 0)
    phase_description: str = getattr(phase, "description", "")
    phase_success_criteria: str = getattr(phase, "success_criteria", "")
    phase_rationale: str = getattr(phase, "rationale", "")

    mission_brief: str = getattr(mission, "brief", "")
    ledger_path: str = getattr(mission, "ledger_path", "")

    # Count total phases to give the planner positional context.
    total_phases = _count_phases_for_mission(mission)
    phase_position = f"Phase {phase_idx + 1} of {total_phases}"

    # Pull ledger summary — best-effort, silent on failure.
    ledger_summary = ""
    if ledger_path:
        try:
            from ...missions.ledger import LedgerReader
            reader = LedgerReader(ledger_path)
            ledger_summary = await reader.mission_summary(max_chars=1500)
        except Exception as exc:
            logger.debug("plan_phase: ledger summary failed (%s)", exc)

    # Synthesise the goal string for the strategic planner.
    goal_parts = [phase_description]
    if phase_success_criteria:
        goal_parts.append(f"Acceptance: {phase_success_criteria}")
    if phase_rationale:
        goal_parts.append(f"Rationale: {phase_rationale}")
    goal = "\n".join(goal_parts)

    # Build revise_note that includes phase context so the strategic planner
    # has the full picture alongside any operator-supplied revision text.
    context_lines = [f"MISSION CONTEXT ({phase_position}):"]
    if mission_brief:
        context_lines.append(
            f"Original operator brief: {mission_brief[:400]}"
            + ("…" if len(mission_brief) > 400 else "")
        )
    if ledger_summary:
        context_lines.append("\nMISSION LEDGER SUMMARY:\n" + ledger_summary)
    context_block = "\n".join(context_lines)

    combined_revise = (
        context_block + ("\n\nREVISION NOTE:\n" + revise_note if revise_note else "")
    )

    return await strategic.plan(
        goal=goal,
        self_model=self_model,
        revise_note=combined_revise,
        task_id=task_id,
        user_id=user_id,
    )


def _count_phases_for_mission(mission: object) -> int:
    """Count phases for the given mission via DB — best-effort, returns 0 on error."""
    # We perform a synchronous best-effort count: if the ORM relationship is
    # loaded (e.g. in tests via eager load), use it. Otherwise fall back to a
    # heuristic of "unknown" rendered as "?" which the planner handles as prose.
    phases_rel = getattr(mission, "phases", None)
    if phases_rel is not None:
        try:
            return len(phases_rel)
        except Exception:
            pass
    return 0
