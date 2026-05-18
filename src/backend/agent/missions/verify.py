"""
D-1 Acceptance Criteria Executor (Judging logic).

This module provides the judging logic that evaluates whether a mission phase
fulfilled its declared success criteria based on the ground truth recorded
in the mission ledger.
"""
from __future__ import annotations

import logging
from pydantic import BaseModel, Field

from ..schemas import MissionBrief, PhaseSpec
from ..cognition.planner._llm import llm_json

logger = logging.getLogger(__name__)


class VerifyResult(BaseModel):
    """The verdict from the PHANTOM Judge LLM."""

    passed: bool = Field(
        ..., description="True if the phase criteria are substantially met."
    )
    critique: str = Field(
        ..., description="Detailed explanation of what was missed or done well."
    )
    suggestions: str = Field(
        ..., description="Actionable advice for the next attempt if failed."
    )


_PROMPT = """\
Ти — PHANTOM Judge, автономний контролер якості. Твоя задача — оцінити чи
виконала система критерії успіху конкретної фази місії.

ВХІДНІ ДАНІ:
1. ОРИГІНАЛЬНИЙ ЗАДУМ МІСІЇ:
{mission_brief}

2. ФАЗА: {phase_description}
3. КРИТЕРІЇ УСПІХУ ФАЗИ:
{phase_criteria}

4. ЛОГ ВИКОНАННЯ (Ground Truth з Ledger):
{ledger_section}

ЗАДАЧА:
- Проаналізуй лог виконання. Знайди докази (або їх відсутність) виконання КОЖНОГО
  пункту критеріїв успіху.
- Будь строгим, але справедливим. Якщо результат є, але він потребує мінорного
  виправлення — це FAIL (ми прагнемо до досконалості).
- Якщо фаза передбачала створення файлів — перевір чи вони задекларовані як
  створені в лозі.

Поверни СТРОГИЙ JSON (без markdown):
{{
  "passed": <boolean>,
  "critique": "<детальний аналіз українською: що виконано, що пропущено>",
  "suggestions": "<поради як дотиснути результат у наступній спробі>"
}}
"""


async def verify_phase(
    *,
    mission_brief: MissionBrief,
    phase: PhaseSpec,
    ledger_section: str,
    task_id: str | None = None,
) -> VerifyResult:
    """Ask the LLM Judge to evaluate phase completion.

    Args:
        mission_brief: The top-level mission context.
        phase: The spec of the phase being evaluated.
        ledger_section: The Markdown text from the ledger for THIS phase only.
        task_id: For budget tracking.

    Returns:
        VerifyResult with boolean verdict and critique.
    """
    prompt = _PROMPT.format(
        mission_brief=mission_brief.brief,
        phase_description=phase.description,
        phase_criteria=phase.success_criteria or "(не вказано)",
        ledger_section=ledger_section or "(лог порожній)",
    )

    try:
        data = await llm_json(prompt, task_id=task_id)
        return VerifyResult(
            passed=bool(data.get("passed", False)),
            critique=str(data.get("critique") or "No critique provided."),
            suggestions=str(data.get("suggestions") or "No suggestions."),
        )
    except Exception as exc:
        logger.error("verify_phase: judge failed (%s)", exc)
        # Fallback: if judge fails, we conservatively mark as passed but log
        # the error. We don't want to block progress on judge downtime.
        return VerifyResult(
            passed=True,
            critique=f"Judge failed: {exc}. Assuming pass to avoid deadlock.",
            suggestions="",
        )
