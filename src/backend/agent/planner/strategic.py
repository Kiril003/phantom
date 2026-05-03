"""
Strategic planner — decomposes a goal into 1..7 SubGoals.

Called once at task start, plus when the reflector returns
verdict='revise_strategy'. Output is a StrategicPlan with per-sub-goal
expected_actions estimates that drive the thought-budget.

Phase 9.2: episodic memory (ChromaDB agent_episodes) injects the top-k
similar past episodes so the planner can spot repeated goal shapes.
"""
from __future__ import annotations

import json
import logging

from ..schemas import StrategicPlan, SubGoal, SelfModel
from ._llm import PlannerLLMError, llm_json

logger = logging.getLogger(__name__)


_PROMPT = """\
Ти — стратегічний планувальник PHANTOM. Розділи мету на 1-7 під-цілей,
кожну з яких можна досягти короткою послідовністю дій.

Я СТВОРЕНИЙ РОЗУМІТИ УКРАЇНСЬКУ ТА АНГЛІЙСЬКУ. Технічні терміни (шляхи файлів,
назви команд, JSON, URL) зберігай англійською природно.

SELF:
{self_model_json}

{memory_block}

ДОСТУПНІ КАТЕГОРІЇ ДІЙ:
- filesystem (читання/запис у ~/phantom/workspace)
- shell (sandboxed команди через firejail коли доступний)
- browser (navigate, extract, click_by_description через Playwright)
- network (web.search, ping sweep до /24, tcp порти)
- process (list)
- notification (desktop)
- time (wait, ≤ 60s)
- self (capability check, memory recall — ChromaDB)

МЕТА: {goal}

{revise_note}

Вивід — строгий JSON:
{{
  "sub_goals": [
    {{
      "description": "...",
      "rationale": "чому ця під-ціль наближає до головної",
      "expected_actions": <int>,
      "acceptance_criteria": "який спостережуваний результат означає завершення"
    }}
  ],
  "estimated_total_actions": <sum>,
  "risk_assessment": "коротке речення про максимальний ризик"
}}

Без прози. Без markdown.
"""


async def plan(
    goal: str,
    self_model: SelfModel,
    memory_seeds_summary: str = "",
    revise_note: str = "",
    *,
    task_id: str | None = None,
) -> StrategicPlan:
    # Phase 9.2 — pull top-k similar past episodes from ChromaDB.
    memory_block = ""
    try:
        from ..memory.recall import format_episodes_for_prompt, recall
        episodes = await recall(goal)
        if episodes:
            memory_block = (
                "ПОПЕРЕДНІ СХОЖІ ВИПАДКИ (з пам'яті):\n"
                + format_episodes_for_prompt(episodes)
            )
    except Exception as exc:
        logger.debug("strategic: episodic recall skipped (%s)", exc)

    # Phase 23-G — inject distilled lessons (prescriptive, transferable
    # rules from prior tasks). They sit ABOVE the episodic narrative so
    # the planner reads "do/avoid" guidance before re-deriving it from
    # raw episodes. Best-effort: any failure or empty result silently
    # leaves the memory_block unchanged.
    try:
        from ..memory.lessons import format_lessons_for_prompt, recall_lessons
        lessons = await recall_lessons(goal)
        lesson_block = format_lessons_for_prompt(lessons)
        if lesson_block:
            memory_block = (
                lesson_block + ("\n\n" + memory_block if memory_block else "")
            )
    except Exception as exc:
        logger.debug("strategic: lessons recall skipped (%s)", exc)

    # Back-compat — if caller already passed a synthesized summary string
    # (legacy 9.1 path), surface it alongside the episodic block.
    if memory_seeds_summary:
        prefix = (
            "ОСТАННЄ РЕЗЮМЕ:\n" + memory_seeds_summary.strip()
        )
        memory_block = (memory_block + "\n\n" + prefix).strip() if memory_block else prefix

    prompt = _PROMPT.format(
        self_model_json=json.dumps(self_model.model_dump(mode="json"), ensure_ascii=False),
        memory_block=memory_block or "(пам'ять порожня)",
        goal=goal,
        revise_note=("REVISION NOTE:\n" + revise_note) if revise_note else "",
    )

    try:
        data = await llm_json(prompt, task_id=task_id)
    except PlannerLLMError as exc:
        raise RuntimeError(f"strategic_planner_invalid_json: {exc}") from exc

    raw = data.get("sub_goals") or []
    if not isinstance(raw, list) or not raw:
        raise RuntimeError("strategic_planner_invalid_json: missing/empty sub_goals")

    sub_goals = []
    for item in raw[:7]:
        if not isinstance(item, dict):
            continue
        sub_goals.append(SubGoal(
            description=str(item.get("description", "")).strip(),
            rationale=str(item.get("rationale", "")).strip(),
            expected_actions=max(1, int(item.get("expected_actions", 3))),
            acceptance_criteria=str(item.get("acceptance_criteria", "")).strip(),
        ))
    if not sub_goals:
        raise RuntimeError("strategic_planner_invalid_json: no usable sub_goals after parsing")

    estimated = int(data.get("estimated_total_actions") or sum(sg.expected_actions for sg in sub_goals))
    risk = str(data.get("risk_assessment", "")).strip()

    return StrategicPlan(
        sub_goals=sub_goals,
        estimated_total_actions=estimated,
        risk_assessment=risk,
    )
