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

from ...schemas import StrategicPlan, SubGoal, SelfModel
from ._llm import PlannerLLMError, llm_json

logger = logging.getLogger(__name__)


_PROMPT = """\
Ти — стратегічний архітектор PHANTOM. Твоє завдання — розбити складну мету на послідовність із 1–7 під-цілей (SubGoals).

{role_block}

МЕТА: {goal}

КОНТЕКСТ ПАМ'ЯТІ ТА СТАНУ:
{memory_block}

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
  "risk_assessment": "коротке речення про максимальний ризик",
  "architectural_rationale": "обґрунтування обраного технічного підходу (ADR-lite)",
  "required_capabilities": ["list", "of", "required", "tools", "or", "packages"]
}}

ПРАВИЛА:
1. Тільки технічні кроки.
2. Кожна під-ціль повинна мати чіткі критерії приймання (acceptance_criteria).

Без прози. Без markdown.
"""


def _format_resource_block_strategic() -> str:
    """Block B — render current system pressure for the strategic planner.

    Shorter than the tactical variant — just pressure label + hint so
    the strategic decomposition can avoid scheduling heavy sub-goals
    when RAM is tight. Omitted on green to keep the prompt cache-stable.
    """
    try:
        from core.system_monitor import system_monitor
        snap = system_monitor.current()
    except Exception:
        return ""
    if snap is None or snap.pressure_label == "green":
        return ""
    hint = (
        "Уникай важких під-цілей (browser/vision/voice/blender) — обирай "
        "легкі альтернативи або відклади їх на пізніше."
        if snap.pressure_label == "red"
        else "Тиск підвищений — при плануванні надавай перевагу легким під-цілям."
    )
    return (
        f"СИСТЕМНИЙ ТИСК: {snap.pressure_label.upper()} "
        f"(RAM доступно: {snap.ram_available_mb} MB, "
        f"диск: {snap.disk_free_gb:.1f} GB). {hint}"
    )


def _format_will_block_strategic() -> str:
    """Day-NN — Will Engine motivation block for the strategic planner.

    Strategic decomposition is the right layer to consult drives: by the
    time we get to tactical, the sub-goal is already chosen and we can
    only colour the action selection. Here, drives can influence WHICH
    sub-goals get spawned at all.
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
    lines = ["МОТИВАЦІЙНИЙ СТАН (Will Engine — стратегічний шар):"]
    for d in ranked:
        lines.append(
            f"- {d.name}: pressure={d.pressure():.2f}"
        )
    lines.append(
        f"Домінуючий драйв: {dominant.name}. Розглянь чи можна під-цілі "
        f"спрямувати так, щоб попутно задовольнити цей драйв "
        f"(не на шкоду головній меті)."
    )
    return "\n".join(lines)


async def plan(
    goal: str,
    self_model: SelfModel,
    memory_seeds_summary: str = "",
    revise_note: str = "",
    *,
    task_id: str | None = None,
    user_id: str | None = None,
) -> StrategicPlan:
    # Phase 9.2 — pull top-k similar past episodes from ChromaDB.
    memory_block = ""
    episodic_recalled = False
    try:
        from ..memory.recall import format_episodes_for_prompt, recall
        episodes = await recall(goal, user_id=user_id)
        if episodes:
            episodic_recalled = True
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
        lessons = await recall_lessons(goal, user_id=user_id)
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

    # Day-NN — auto-recall top-k operator facts through the unified
    # MemoryBrain. Best-effort; silent on any error.
    if user_id:
        try:
            from memory.brain import memory_brain
            facts = await memory_brain.recall_for_prompt(
                db=None,
                user_id=user_id,
                query=goal,
                limit=3,
                include_agent=False,
            )
            if facts:
                facts_block = "ВІДНОВЛЕНІ ФАКТИ З ПАМ'ЯТІ:\n" + "\n".join(
                    f"- {(f[:240] + '…') if len(f) > 240 else f}"
                    for f in facts
                )
                memory_block = (
                    facts_block + ("\n\n" + memory_block if memory_block else "")
                )
        except Exception as exc:
            logger.debug("strategic: strategic memory recall skipped (%s)", exc)

    # Block B — surface resource pressure so the strategic planner avoids
    # scheduling heavy sub-goals when the system is under RAM pressure.
    # Prepended before the Will block so operator-visible signals appear
    # in a stable order. Omitted on green (keeps the prompt cache-stable).
    resource_block_str = _format_resource_block_strategic()
    if resource_block_str:
        memory_block = (
            resource_block_str + ("\n\n" + memory_block if memory_block else "")
        )

    # Day-NN — surface the dominant drive at the strategic layer so the
    # decomposition can shape sub-goals around what PHANTOM currently
    # wants (audit-flagged: Will Engine was sidecar-only).
    will_block_str = _format_will_block_strategic()
    if will_block_str:
        memory_block = (
            will_block_str + ("\n\n" + memory_block if memory_block else "")
        )

    # Phase 29 — surface the 7-horizon planning context.
    try:
        from .horizons import format_horizons_for_prompt
        horizons_block = await format_horizons_for_prompt(user_id or "")
        if horizons_block:
            memory_block = (
                horizons_block + ("\n\n" + memory_block if memory_block else "")
            )
    except Exception as exc:
        logger.debug("strategic: horizons context skipped (%s)", exc)

    # Phase 32-KO — surface Knowledge Objects (Hard Facts)
    try:
        from ..knowledge import project_kb
        kb_block = project_kb.get_all_formatted()
        if kb_block:
            memory_block = (
                kb_block + ("\n\n" + memory_block if memory_block else "")
            )
    except Exception as exc:
        logger.debug("strategic: KB context skipped (%s)", exc)

    if not episodic_recalled:
        empty_episode_note = "ЕПІЗОДИЧНА пам'ять порожня"
        memory_block = (
            memory_block + "\n\n" + empty_episode_note
        ).strip() if memory_block else empty_episode_note

    # Phase 30 — Org-Chart Role context
    role_block = ""
    if self_model.agent_role_context:
        ctx = self_model.agent_role_context
        role_block = (
            f"ПОТОЧНА РОЛЬ: {ctx.get('name')} ({ctx.get('description')})\n"
            f"ПОСТІЙНІ ПОРЯДКИ: {ctx.get('standing_orders')}\n"
            f"ІНСТРУКЦІЇ РОЛІ: {ctx.get('system_prompt_extension')}\n"
        )

    prompt = _PROMPT.format(
        role_block=role_block,
        memory_block=memory_block or "(пам'ять порожня)",
        goal=goal,
        revise_note=("REVISION NOTE:\n" + revise_note) if revise_note else "",
    )
    
    # Phase 28-STABILITY — inject dead ends block if not empty.
    # Strategic planner MUST strictly avoid these paths.
    dead_ends_block = ""
    dead_ends = getattr(self_model, "dead_ends", []) # Use getattr for safety if schemas haven't fully reloaded
    if dead_ends:
        dead_ends_block = "\n\nШЛЯХИ, ЩО ПРИЗВЕЛИ ДО ПРОВАЛУ (DEAD ENDS - НЕ ПОВТОРЮВАТИ):\n"
        for de in dead_ends:
            dead_ends_block += f"- {de}\n"
        prompt = prompt.replace("МЕТА:", dead_ends_block + "\nМЕТА:")

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
    rationale = str(data.get("architectural_rationale", "")).strip()
    req_caps = list(data.get("required_capabilities") or [])

    return StrategicPlan(
        sub_goals=sub_goals,
        estimated_total_actions=estimated,
        risk_assessment=risk,
        architectural_rationale=rationale,
        required_capabilities=req_caps,
    )
