"""
Mission planner — decomposes a MissionBrief into a MissionPlan.

Produces a MissionPlan with:
  - success_criteria: top-level acceptance bar for the whole mission
  - phases: list[PhaseSpec] with 3-12 phases (each with declared artifacts)

Pattern mirrors strategic.py: Will Engine drives + Strategic Memory recall are
injected as best-effort context blocks, silent on failure.
"""
from __future__ import annotations

import json
import logging

from ...schemas import MissionBrief, MissionPlan, PhaseSpec, SelfModel
from ._llm import BlockedQuotaError, PlannerLLMError, llm_json

logger = logging.getLogger(__name__)

_MAX_PHASES = 12
_MAX_SUCCESS_CRITERIA_CHARS = 800

_PROMPT = """\
Ти — стратегічний планувальник PHANTOM рівня місії. Розклади операторський задум
на послідовність фаз, кожна з яких має чіткі критерії успіху і задекларовані артефакти.

Я СТВОРЕНИЙ РОЗУМІТИ УКРАЇНСЬКУ ТА АНГЛІЙСЬКУ. Технічні терміни (шляхи файлів,
назви інструментів, JSON, URL) зберігай англійською природно.

SELF:
{self_model_json}

{memory_block}

ОПЕРАТОРСЬКИЙ ЗАДУМ: {brief}

ПЛАНКА ЯКОСТІ: {quality_bar}

ДЕДЛАЙН: {deadline_at}

ОБМЕЖЕННЯ БЮДЖЕТУ: {budget_constraints}

Поверни СТРОГИЙ JSON (без markdown, без прози):
{{
  "success_criteria": "<рядок ≤ {max_sc_chars} символів — що доводить, що МІСІЯ досягнута>",
  "phases": [
    {{
      "description": "<коротка назва фази>",
      "rationale": "<чому ця фаза потрібна і в цьому порядку>",
      "success_criteria": "<що треба виконати щоб фаза вважалась завершеною>",
      "expected_duration_h": <оцінка в годинах, float>,
      "artifacts": [
        {{"path": "<шлях із {{workspace}} плейсхолдером>", "kind": "<тип файлу>", "produced": false}}
      ]
    }}
  ],
  "risk_assessment": "<одне речення про найбільший ризик місії>"
}}

ВИМОГИ:
- phases: мінімум 3, максимум {max_phases}. Типові обсяги:
    * Рефакторинг коду → 3-5 фаз
    * Генерація 3D-сцени → 7-10 фаз
    * Побудова API + frontend → 5-7 фаз
- Кожна фаза ПОВИННА мати хоча б один артефакт у списку artifacts
  (наприклад файл, звіт, модуль, документ).
- Плейсхолдер {{workspace}} позначає базову директорію; залишай його літерально.
- Якщо дедлайн/бюджет не вказані — ігноруй.
- success_criteria місії — це верхньорівнева умова, окрема від фазових критеріїв.

{revise_note}
"""


def _format_will_block_mission() -> str:
    """Surface the dominant Will Engine drive for the mission planner.

    At the mission planning layer, drives can shape WHICH phases get spawned
    and in what order. Same lazy-import pattern as strategic.py.
    """
    try:
        from ..will.drives import drive_system
    except Exception:
        return ""
    try:
        dominant = drive_system.dominant()
        ranked = sorted(
            drive_system.drives.values(),
            key=lambda d: d.pressure(),
            reverse=True,
        )[:3]
    except Exception:
        return ""
    lines = ["МОТИВАЦІЙНИЙ СТАН (Will Engine — місійний шар):"]
    for d in ranked:
        lines.append(f"- {d.name}: pressure={d.pressure():.2f}")
    lines.append(
        f"Домінуючий драйв: {dominant.name}. Розглянь чи можна послідовність фаз "
        f"спрямувати так, щоб попутно задовольнити цей драйв "
        f"(не на шкоду головній меті)."
    )
    return "\n".join(lines)


async def plan_mission(
    *,
    user_id: str,
    brief: MissionBrief,
    self_model: SelfModel,
    task_id: str | None = None,
    revise_note: str = "",
) -> MissionPlan:
    """Decompose a MissionBrief into a MissionPlan with ordered PhaseSpecs.

    Args:
        user_id: Authenticated operator — used for Strategic Memory recall.
        brief: The operator's mission brief (verbatim + quality bar + optional deadline/budget).
        self_model: Current PHANTOM self-model, injected into the prompt.
        task_id: Optional parent task id for LLM call budget tracking.
        revise_note: Optional revision instructions if replanning.

    Returns:
        MissionPlan with success_criteria and 3-12 PhaseSpecs.

    Raises:
        RuntimeError: When the LLM cannot produce a valid MissionPlan.
        BlockedQuotaError: When both AI providers are quota-exhausted (propagates
            to the caller for parking/retry logic).
    """
    memory_block = ""

    # Pull distilled lessons relevant to the mission brief.
    try:
        from ..memory.lessons import format_lessons_for_prompt, recall_lessons
        lessons = await recall_lessons(brief.brief, user_id=user_id)
        lesson_block = format_lessons_for_prompt(lessons)
        if lesson_block:
            memory_block = lesson_block
    except Exception as exc:
        logger.debug("mission_planner: lessons recall skipped (%s)", exc)

    # Pull top-k episodic memory similar to the mission brief.
    try:
        from ..memory.recall import format_episodes_for_prompt, recall
        episodes = await recall(brief.brief, user_id=user_id)
        if episodes:
            episode_block = (
                "ПОПЕРЕДНІ СХОЖІ МІСІЇ (з пам'яті):\n"
                + format_episodes_for_prompt(episodes)
            )
            memory_block = (
                (memory_block + "\n\n" + episode_block).strip()
                if memory_block
                else episode_block
            )
    except Exception as exc:
        logger.debug("mission_planner: episodic recall skipped (%s)", exc)

    # Pull Strategic Memory facts relevant to the brief.
    try:
        from memory.brain import memory_brain
        facts = await memory_brain.recall_for_prompt(
            db=None,
            user_id=user_id,
            query=brief.brief,
            limit=3,
            include_agent=False,
        )
        if facts:
            facts_block = "ВІДНОВЛЕНІ ФАКТИ З ПАМ'ЯТІ:\n" + "\n".join(
                f"- {(f[:240] + '…') if len(f) > 240 else f}" for f in facts
            )
            memory_block = (
                facts_block + ("\n\n" + memory_block if memory_block else "")
            )
    except Exception as exc:
        logger.debug("mission_planner: strategic memory recall skipped (%s)", exc)

    # Will Engine drives.
    will_block = _format_will_block_mission()
    if will_block:
        memory_block = (
            will_block + ("\n\n" + memory_block if memory_block else "")
        )

    # Serialize optional fields for the prompt.
    deadline_str = brief.deadline_at.isoformat() if brief.deadline_at else "(не вказано)"
    budget_str = "(не вказано)"
    if brief.budget_constraints is not None:
        budget_str = json.dumps(
            brief.budget_constraints.model_dump(mode="json"), ensure_ascii=False
        )

    prompt = _PROMPT.format(
        self_model_json=json.dumps(self_model.model_dump(mode="json"), ensure_ascii=False),
        memory_block=memory_block or "(пам'ять порожня)",
        brief=brief.brief,
        quality_bar=brief.quality_bar or "(не вказано)",
        deadline_at=deadline_str,
        budget_constraints=budget_str,
        max_sc_chars=_MAX_SUCCESS_CRITERIA_CHARS,
        max_phases=_MAX_PHASES,
        revise_note=("REVISION NOTE:\n" + revise_note) if revise_note else "",
    )

    try:
        data = await llm_json(prompt, task_id=task_id)
    except BlockedQuotaError:
        raise
    except PlannerLLMError as exc:
        raise RuntimeError(f"mission_planner_invalid_json: {exc}") from exc

    # Validate and normalise success_criteria.
    raw_sc = str(data.get("success_criteria") or "").strip()
    if not raw_sc:
        raise RuntimeError(
            "mission_planner_invalid_json: missing success_criteria"
        )
    if len(raw_sc) > _MAX_SUCCESS_CRITERIA_CHARS:
        raw_sc = raw_sc[:_MAX_SUCCESS_CRITERIA_CHARS]

    # Validate and normalise phases.
    raw_phases = data.get("phases")
    if not isinstance(raw_phases, list) or not raw_phases:
        raise RuntimeError(
            "mission_planner_invalid_json: missing/empty phases"
        )

    if len(raw_phases) > _MAX_PHASES:
        logger.warning(
            "mission_planner: LLM returned %d phases, capping at %d",
            len(raw_phases), _MAX_PHASES,
        )
        raw_phases = raw_phases[:_MAX_PHASES]

    phase_specs: list[PhaseSpec] = []
    for item in raw_phases:
        if not isinstance(item, dict):
            continue

        description = str(item.get("description") or "").strip()
        if not description:
            continue  # Skip invalid phases silently.

        rationale = str(item.get("rationale") or "").strip()
        success_criteria = str(item.get("success_criteria") or "").strip()

        try:
            expected_duration_h = float(item.get("expected_duration_h") or 0.0)
        except (TypeError, ValueError):
            expected_duration_h = 0.0

        raw_artifacts = item.get("artifacts")
        artifacts: list[dict] = []
        if isinstance(raw_artifacts, list):
            for a in raw_artifacts:
                if isinstance(a, dict):
                    entry = {
                        "path": str(a.get("path") or ""),
                        "kind": str(a.get("kind") or "file"),
                        "produced": bool(a.get("produced", False)),
                    }
                    if entry["path"]:
                        artifacts.append(entry)

        # Every phase must declare at least one artifact — synthesize a
        # placeholder if the LLM skipped them so the ledger always has
        # something to reference.
        if not artifacts:
            safe_name = description[:40].replace(" ", "_").lower()
            artifacts = [
                {
                    "path": f"{{workspace}}/phase_{len(phase_specs):02d}_{safe_name}.output",
                    "kind": "file",
                    "produced": False,
                }
            ]

        phase_specs.append(PhaseSpec(
            description=description,
            rationale=rationale,
            success_criteria=success_criteria,
            expected_duration_h=expected_duration_h,
            artifacts=artifacts,
        ))

    if len(phase_specs) < 1:
        raise RuntimeError(
            "mission_planner_invalid_json: no usable phases after parsing"
        )

    risk_assessment = str(data.get("risk_assessment") or "").strip()

    return MissionPlan(
        success_criteria=raw_sc,
        phases=phase_specs,
        risk_assessment=risk_assessment,
    )
