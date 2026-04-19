"""
Reflector — assesses progress, never picks actions.

Triggered every N actions, on repeated identical errors, when thought-budget
runs out, or on user intervention. Verdict drives the loop's next move.
"""
from __future__ import annotations

import json
import logging

from ..observations import format_for_llm
from ..schemas import (
    Observation,
    ReflectionResult,
    ReflectionVerdict,
    SubGoal,
    ThoughtBudget,
)
from ._llm import PlannerLLMError, llm_json

logger = logging.getLogger(__name__)

_VERDICTS: set[str] = {
    "continue", "revise_subgoal", "revise_strategy", "abandon_task", "wait_user",
}


_PROMPT = """\
Ти — рефлектор PHANTOM. Ти НЕ обираєш дій — ти оцінюєш прогрес.

Я СТВОРЕНИЙ РОЗУМІТИ УКРАЇНСЬКУ ТА АНГЛІЙСЬКУ. Технічні терміни (шляхи файлів,
назви команд, JSON, URL) зберігай англійською природно.

ПІД-ЦІЛЬ: {sub_goal_description}
Acceptance: {acceptance}

ДІЇ З МОМЕНТУ ОСТАННЬОЇ РЕФЛЕКСІЇ:
{recent_actions_block}

СПОСТЕРЕЖЕННЯ:
{observations_block}

THOUGHT BUDGET: використано {used} з {estimated} оцінених дій. Рефлексій було: {reflections}.

ВТРУЧАННЯ КОРИСТУВАЧА (якщо є): {intervention}

Вивід — строгий JSON:
{{
  "verdict": "<continue|revise_subgoal|revise_strategy|abandon_task|wait_user>",
  "summary": "...",
  "progress_assessment": "...",
  "recurring_errors": [...],
  "recommendations": "...",
  "new_confidence": <0.0..1.0>
}}
Без прози. Без markdown.
"""


async def reflect(
    *,
    active_sub_goal: SubGoal,
    observations: list[Observation],
    recent_actions_summary: str,
    thought_budget: ThoughtBudget,
    intervention: str | None = None,
    task_id: str | None = None,
) -> ReflectionResult:
    prompt = _PROMPT.format(
        sub_goal_description=active_sub_goal.description,
        acceptance=active_sub_goal.acceptance_criteria,
        recent_actions_block=recent_actions_summary or "(none)",
        observations_block=format_for_llm(observations, limit=15),
        used=thought_budget.actions_used,
        estimated=thought_budget.estimated_actions,
        reflections=thought_budget.reflections_done,
        intervention=intervention or "(none)",
    )

    try:
        data = await llm_json(prompt, task_id=task_id)
    except PlannerLLMError as exc:
        # Reflection that can't parse falls back to 'continue' so the agent
        # keeps making forward progress; the failure is logged and surfaced
        # in the recommendations field for the audit trail.
        logger.warning("reflector parse failure → continue with logged note: %s", exc)
        return ReflectionResult(
            verdict="continue",
            summary="reflector_parse_failure",
            progress_assessment="unknown — reflector LLM did not return valid JSON",
            recurring_errors=[],
            recommendations=str(exc)[:300],
            new_confidence=0.4,
        )

    verdict_raw = str(data.get("verdict") or "continue").lower()
    if verdict_raw not in _VERDICTS:
        verdict_raw = "continue"

    return ReflectionResult(
        verdict=verdict_raw,  # type: ignore[arg-type]
        summary=str(data.get("summary", "")),
        progress_assessment=str(data.get("progress_assessment", "")),
        recurring_errors=[str(x) for x in (data.get("recurring_errors") or [])][:8],
        recommendations=str(data.get("recommendations", "")),
        new_confidence=float(data.get("new_confidence", 0.5)),
    )


__all__ = ["reflect", "ReflectionVerdict"]
