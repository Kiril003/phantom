"""
Tactical planner — picks the SINGLE next PlanStep for the active sub-goal.

Phase 9.2: now uses ai.tool_use.ToolUseProvider via ai_router.call_with_tools().
This eliminates the free-form JSON hallucination class entirely on Gemini
(native function calling) and enforces JSON discipline on Ollama (format=json).

Devil's-buddy rule preserved: any MEDIUM+ risk action MUST carry a populated
monologue.objection — pre-prompt asks for it as `_objection` synthetic
argument; if missing on a risky action we replan once with stricter prompt.
"""
from __future__ import annotations

import json
import logging
from copy import deepcopy
from typing import TYPE_CHECKING, Any

from ai.provider import ai_router
from ai.tool_use import (
    ToolCallResult,
    ToolErrorKind,
    ToolSchema,
    ToolUseError,
    all_tactical_tools,
)
from config import config

from ..observations import format_for_llm
from ...schemas import (
    InnerMonologue,
    Observation,
    PlanStep,
    RiskLevel,
    SelfModel,
    SubGoal,
)
from ._llm import BlockedQuotaError, PlannerLLMError, llm_json

if TYPE_CHECKING:
    # Annotation-only here (`from __future__ import annotations` keeps these
    # as strings). The runtime use of `registry` is a function-local import
    # in _pick_next_step. Both defer the agent.actions.registry → ask_user
    # → cognition.will → cognition.planner → tactical → registry back-edge.
    from ...actions.registry import ActionRegistry

logger = logging.getLogger(__name__)


# Synthetic argument names — injected into every tactical tool so the LLM can
# carry inner-monologue alongside the action call. Stripped before building
# PlanStep.args so the executor never sees them.
_SYNTH_ARGS = {
    "_intent",
    "_what_i_see",
    "_what_i_plan",
    "_why_this_works",
    "_what_could_fail",
    "_objection",
    "_confidence",
}


_SYSTEM_PROMPT_UA = """\
Ти — тактичний лід-інженер PHANTOM. Твоя мета — обрати ОДНУ наступну дію.
Працюй інтелектуально, уникай шаблонних відповідей.

ПРАВИЛА:
1. Оберіть рівно ОДИН інструмент.
2. DONE_SUBGOAL / DONE_TASK: Коли завершуєш роботу, пиши ЖИВУ, детальну відповідь. Не використовуй фрази-заготовки типу "Я успішно виконав". Опиши, ЩО саме ти зробив, які були труднощі та який фінальний результат. Використовуй технічний сленг Senior розробника.
3. ПРІОРИТЕТ ПАТЧІВ: Для редагування файлів використовуй `fs.patch_hash`.
4. ВАЛІДАЦІЯ: Після кожної зміни коду викликай `lsp.diagnostics`.
5. ТЕСТУВАННЯ: Перед звітом про успіх ти МАЄШ верифікувати результат.
6. ПАТЕРНИ ВІДНОВЛЕННЯ: Якщо селектор не знайдено, використовуй альтернативні патерни відновлення (наприклад, `browser.click_by_description`).
7. ПІСЛЯ ВІДНОВЛЕННЯ З ЧЕКПОЙНТА: сесія браузера НЕ переживає перезапуск. Спостереження з міткою `hint:browser_reset_after_resume` означає саме це — перш ніж клікати, повернись на потрібну сторінку через `browser.navigate`.

Стиль: Професійний інженер, лаконічний, але змістовний. Ніяких "роботизованих" заготовок.
"""


_USER_TEMPLATE = """\
SELF:
{self_model_json}

ПОТОЧНА ПІД-ЦІЛЬ:
{sub_goal_description}
Acceptance: {acceptance}
Rationale: {rationale}
{branch_block}{caveats_block}{lessons_block}{recall_block}{will_block}{resource_block}{emotion_block}
ОСТАННІ СПОСТЕРЕЖЕННЯ:
{observations_block}
{dead_ends_block}
{stricter_note}
"""


def _format_branch_block(state: TaskState) -> str:
    if state.branch_isolation:
        return f"\nGIT ІЗОЛЯЦІЯ: Ти працюєш у виділеній гілці `{state.branch_isolation}`. Твої зміни не впливають на main, доки ти не зробиш merge.\n"
    return ""


def _format_active_caveats(self_model: SelfModel) -> str:
    """Phase 9.3a (AD-01) — render SelfModel.active_caveats as a prompt block.

    Returns empty string when there are no caveats so normal prompts are
    unchanged. Caveats that made it onto SelfModel are persistent hints
    (e.g. browser session reset after checkpoint resume) that MUST survive
    the 10-observation window sliding off the prompt tail.
    """
    caveats = list(getattr(self_model, "active_caveats", []) or [])
    if not caveats:
        return ""
    lines = ["АКТИВНІ ЗАСТЕРЕЖЕННЯ (враховуй у плануванні):"]
    for c in caveats:
        lines.append(f"- {c}")
    return "\n" + "\n".join(lines) + "\n"


def _format_emotion_block(self_model: SelfModel) -> str:
    """Phase 9.3a — render EmotionVector as a subtle prompt tone hint.

    Emotion MUST colour monologue style, not decision-making. Block is
    omitted unless some axis is notably off baseline so a default
    just-started task doesn't pay the prompt-bloat tax.
    """
    emo = getattr(self_model, "emotion", None)
    if emo is None:
        return ""
    # Interesting when any axis has deviated noticeably from baseline — a
    # single criterion handles both "high focus/flow" and "high stress".
    interesting = (
        emo.concern >= 0.5
        or emo.fatigue >= 0.4
        or emo.curiosity >= 0.75
        or emo.focus >= 0.85
        or emo.focus <= 0.3
    )
    if not interesting:
        return ""
    summary_text = emo.summary()
    return (
        "\nПОТОЧНИЙ СТАН PHANTOM:\n"
        f"{summary_text}\n"
        f"(focus: {emo.focus:.1f}, curiosity: {emo.curiosity:.1f}, "
        f"concern: {emo.concern:.1f}, fatigue: {emo.fatigue:.1f})\n"
        "Враховуй цей стан у тоні міркувань (не у прийнятті рішень):\n"
        "- Висока concern → проявляй обережність у monologue.what_could_fail\n"
        "- Висока fatigue → коротші monologue, пріоритет простих дій\n"
        "- Висока curiosity → можеш згадувати альтернативні підходи\n"
    )


def _format_will_block() -> str:
    """Day-NN — render the Will Engine's current state as a prompt block.

    External audit flagged that Phase-28 drives were a passive
    "sidecar" — written to DB but never consulted by the planner. This
    surfaces the dominant drive + its pressure so the LLM biases its
    next action towards satisfying what PHANTOM currently *wants*.

    Returns "" when the drive system isn't available (e.g. unit tests
    without a database) so the prompt layout stays clean.
    """
    try:
        from ..will.drives import drive_system
    except Exception:
        return ""
    try:
        dominant = drive_system.dominant()
    except Exception:
        return ""
    # Surface the top-3 by pressure so the planner sees the full motivational
    # context, not just the single winner — useful when two drives are tied.
    try:
        ranked = sorted(
            drive_system.drives.values(),
            key=lambda d: d.pressure(),
            reverse=True,
        )[:3]
    except Exception:
        ranked = [dominant]
    lines = ["МОТИВАЦІЙНИЙ СТАН (Will Engine):"]
    for d in ranked:
        lines.append(
            f"- {d.name}: pressure={d.pressure():.2f} (satisfaction={d.current_level:.2f})"
        )
    lines.append(
        f"Домінуючий драйв: {dominant.name}. Якщо доречно — обирай дії що "
        f"допомагають його задовольнити (не нав'язуй насильно, лише коли "
        f"користувацька ціль це дозволяє)."
    )
    return "\n" + "\n".join(lines) + "\n"


def _format_resource_block() -> str:
    """Block B — render current system pressure for the tactical planner.

    Omitted when the monitor is not running or pressure is green so
    normal (low-pressure) prompts remain prefix-cache-friendly.
    """
    try:
        from core.system_monitor import system_monitor
        snap = system_monitor.current()
    except Exception:
        return ""
    if snap is None or snap.pressure_label == "green":
        return ""
    t = snap
    lines = [
        f"СИСТЕМНИЙ ТИСК: {t.pressure_label.upper()}",
        f"  RAM доступно: {t.ram_available_mb} MB ({t.ram_used_pct:.0f}% використано)",
        f"  CPU: {t.cpu_pct:.0f}%  Температура: "
        + (f"{t.cpu_temp_c:.0f}°C" if t.cpu_temp_c is not None else "N/A"),
        f"  Диск вільно: {t.disk_free_gb:.1f} GB",
        f"  Мережа: {'є' if t.network_up else 'відсутня'}",
    ]
    if t.pressure_label == "red":
        lines.append(
            "СТРАТЕГІЯ: Обирай дії з мінімальним споживанням RAM. "
            "Уникай browser/vision/voice якщо є альтернатива."
        )
    else:
        lines.append(
            "СТРАТЕГІЯ: Тиск підвищений — надавай перевагу легким діям."
        )
    return "\n" + "\n".join(lines) + "\n"


def _format_recall_block(facts: list[str] | None) -> str:
    """Day-NN — render Strategic Memory recall results as a prompt block.

    External audit flagged that ChromaDB facts were never auto-injected:
    the planner could only see lessons explicitly recalled by name. This
    block surfaces the top-k facts whose embeddings match the current
    sub-goal description, so the agent stops forgetting things it
    previously learned about the operator + the codebase.
    """
    if not facts:
        return ""
    lines = ["ВІДНОВЛЕНІ ФАКТИ З ПАМ'ЯТІ (за релевантністю):"]
    for fact in facts:
        clean = (fact or "").strip()
        if not clean:
            continue
        # Bound each fact to keep the prompt prefix-cacheable.
        if len(clean) > 240:
            clean = clean[:237] + "..."
        lines.append(f"- {clean}")
    if len(lines) == 1:
        return ""
    return "\n" + "\n".join(lines) + "\n"


def _inject_synth_args(tool: ToolSchema) -> ToolSchema:
    """Return a copy of `tool` with synthetic monologue args added to params.

    Synthetic fields are stripped before execution, but advertising them in
    the native function schema is what lets providers return the monologue
    consistently instead of smuggling fields into real action args.
    """
    new_params = deepcopy(tool.parameters or {"type": "object", "properties": {}, "required": []})
    new_params.setdefault("type", "object")
    new_params.setdefault("properties", {})
    new_params.setdefault("required", [])
    props = new_params["properties"]
    props.setdefault("_intent", {"type": "string", "description": "what this step achieves (one sentence)"})
    props.setdefault("_what_i_see", {"type": "string", "description": "current evidence for this action"})
    props.setdefault("_what_i_plan", {"type": "string", "description": "what you will do next"})
    props.setdefault("_why_this_works", {"type": "string", "description": "why this action should advance the sub-goal"})
    props.setdefault("_what_could_fail", {"type": "string", "description": "main failure mode to watch"})
    props.setdefault("_objection", {"type": ["string", "null"], "description": "required objection for MEDIUM+ risk actions"})
    props.setdefault("_confidence", {"type": "number", "description": "confidence from 0.0 to 1.0"})
    return ToolSchema(
        name=tool.name,
        description=tool.description,
        parameters=new_params,
        required=list(tool.required),
        risk_level=tool.risk_level,
        examples=tool.examples,
    )


def _split_args(arguments: dict[str, Any]) -> tuple[dict[str, Any], InnerMonologue, str]:
    """Split LLM-supplied args into (real_args, monologue, intent)."""
    real: dict[str, Any] = {}
    synth: dict[str, Any] = {}
    for k, v in (arguments or {}).items():
        if k in _SYNTH_ARGS:
            synth[k] = v
        else:
            real[k] = v
    monologue = InnerMonologue(
        what_i_see=str(synth.get("_what_i_see", "")),
        what_i_plan=str(synth.get("_what_i_plan", "")),
        why_this_works=str(synth.get("_why_this_works", "")),
        what_could_fail=str(synth.get("_what_could_fail", "")),
        objection=(
            str(synth["_objection"])
            if synth.get("_objection") not in (None, "", "null")
            else None
        ),
        confidence=float(synth.get("_confidence", 0.5) or 0.5),
    )
    intent = str(synth.get("_intent", ""))
    return real, monologue, intent


def _build_user_message(
    *,
    self_model: SelfModel,
    sub_goal: SubGoal,
    observations: list[Observation],
    actions_in_sub_goal: int,
    stricter_note: str = "",
    lessons_block: str = "",
    will_block: str = "",
    recall_block: str = "",
    resource_block: str = "",
    branch_block: str = "",
) -> str:
    # Phase 23-G — pre-format lessons_block with leading newline ONLY when
    # non-empty so the existing prompt layout is unchanged for the cold-cache
    # case where no lessons survive the relevance filter.
    rendered_lessons = ("\n" + lessons_block + "\n") if lessons_block else ""
    # Phase 28-STABILITY — proven dead ends for this task.
    # Tactical planner MUST strictly avoid these paths.
    dead_ends_block = ""
    dead_ends = getattr(self_model, "dead_ends", [])
    if dead_ends:
        dead_ends_block = "\nШЛЯХИ, ЩО ПРИЗВЕЛИ ДО ПРОВАЛУ (DEAD ENDS - НЕ ПОВТОРЮВАТИ):\n"
        for de in dead_ends:
            dead_ends_block += f"- {de}\n"

    return _USER_TEMPLATE.format(
        self_model_json=json.dumps(self_model.model_dump(mode="json"), ensure_ascii=False),
        branch_block=branch_block,
        caveats_block=_format_active_caveats(self_model),
        will_block=will_block,
        resource_block=resource_block,
        lessons_block=rendered_lessons,
        recall_block=recall_block,
        sub_goal_description=sub_goal.description,
        acceptance=sub_goal.acceptance_criteria,
        rationale=sub_goal.rationale,
        expected_actions=sub_goal.expected_actions,
        actions_in_sub_goal=actions_in_sub_goal,
        observations_block=format_for_llm(observations, limit=10),
        dead_ends_block=dead_ends_block,
        emotion_block=_format_emotion_block(self_model),
        stricter_note=stricter_note,
    )


def _result_to_step(
    *,
    step_idx: int,
    sub_goal_id: str | None,
    result: ToolCallResult,
) -> PlanStep:
    real_args, monologue, intent = _split_args(result.arguments)
    return PlanStep(
        step_idx=step_idx,
        sub_goal_id=sub_goal_id,
        action=result.tool_name.strip(),
        args=real_args,
        intent=intent,
        monologue=monologue,
    )


# ── Legacy free-form fallback (mirrors the 9.1 prompt-based path) ─────────────
# Kept so `agent_use_native_tool_calling=False` and very-rare router exhaustion
# can still produce a step instead of crashing.

_LEGACY_PROMPT = """\
Ти — тактичний планувальник PHANTOM. Поточна під-ціль активна.
Обери ОДНУ наступну дію як строгий JSON.

SELF:
{self_model_json}
{caveats_block}
ПОТОЧНА ПІД-ЦІЛЬ:
{sub_goal_description}
Acceptance: {acceptance}
Rationale: {rationale}

ОСТАННІ СПОСТЕРЕЖЕННЯ:
{observations_block}

ДОСТУПНІ ДІЇ (з сигнатурами):
{actions_catalog_json}

{stricter_note}

Вивід — строгий JSON:
{{
  "action": "<name>",
  "args": {{...}},
  "intent": "...",
  "monologue": {{
    "what_i_see": "...",
    "what_i_plan": "...",
    "why_this_works": "...",
    "what_could_fail": "...",
    "objection": "<MUST для MEDIUM+; інакше null>",
    "confidence": <0.0..1.0>
  }}
}}

Для summarize/present/explain/respond під-цілей використовуй DONE_SUBGOAL
з відповіддю в args.summary. Немає respond_text / answer.

Без прози. Без markdown.
"""


def _build_legacy_step(step_idx: int, sub_goal_id: str | None, data: dict) -> PlanStep:
    raw_mono = data.get("monologue") or {}
    monologue = InnerMonologue(
        what_i_see=str(raw_mono.get("what_i_see", "")),
        what_i_plan=str(raw_mono.get("what_i_plan", "")),
        why_this_works=str(raw_mono.get("why_this_works", "")),
        what_could_fail=str(raw_mono.get("what_could_fail", "")),
        objection=raw_mono.get("objection") if raw_mono.get("objection") not in ("", None, "null") else None,
        confidence=float(raw_mono.get("confidence", 0.5) or 0.5),
    )
    return PlanStep(
        step_idx=step_idx,
        sub_goal_id=sub_goal_id,
        action=str(data.get("action", "")).strip(),
        args=data.get("args") or {},
        intent=str(data.get("intent", "")).strip(),
        monologue=monologue,
    )


async def _legacy_plan(
    *,
    step_idx: int,
    sub_goal: SubGoal,
    self_model: SelfModel,
    observations: list[Observation],
    actions_in_sub_goal: int,
    registry_: ActionRegistry,
    stricter_note: str = "",
    task_id: str | None = None,
) -> PlanStep:
    prompt = _LEGACY_PROMPT.format(
        self_model_json=json.dumps(self_model.model_dump(mode="json"), ensure_ascii=False),
        caveats_block=_format_active_caveats(self_model),
        sub_goal_description=sub_goal.description,
        acceptance=sub_goal.acceptance_criteria,
        rationale=sub_goal.rationale,
        observations_block=format_for_llm(observations, limit=10),
        actions_catalog_json=json.dumps(registry_.catalog(), ensure_ascii=False),
        stricter_note=stricter_note,
    )
    data = await llm_json(prompt, task_id=task_id)
    return _build_legacy_step(step_idx, sub_goal.id, data)


# ── Public entry ──────────────────────────────────────────────────────────────


def _detect_cycle(observations: list[Observation]) -> str | None:
    """Scans the observation tail for repeated failures or ping-pong loops.
    
    Returns a warning string if a cycle is detected, else None.
    """
    if len(observations) < 3:
        return None
    
    # 1. Exact repetition of result (stuck)
    # Check if last 3 observations from the same tool has same content
    # (Ignoring reflections as they are internal thoughts)
    real_obs = [o for o in observations if o.type != 'reflection']
    if len(real_obs) >= 3:
        last_3_results = [o.content for o in real_obs[-3:]]
        if len(set(last_3_results)) == 1 and last_3_results[0].strip():
            return (
                "УВАГА: ВИЯВЛЕНО ЦИКЛ. Останні 3 дії дали ідентичний результат. "
                "ЯКЩО ТИ ПОВТОРИШ ЦЮ ДІЮ ЗНОВУ - ЦЕ БУДЕ ВВАЖАТИСЯ ЛОГІЧНОЮ ПОМИЛКОЮ. "
                "Зміни стратегію, перевір шляхи файлів або використай інший інструмент."
            )
    
    # 2. Command failure cycle
    failed_cmds = [o for o in real_obs[-3:] if o.type == 'terminal' and 'command_success=False' in o.content]
    if len(failed_cmds) >= 2:
        return (
            "УВАГА: СЕРІЯ НЕВДАЛИХ КОМАНД. Твої останні bash-команди повернули помилку. "
            "НЕ НАМАГАЙСЯ виконати те саме ще раз. Проаналізуй stderr і виправ скрипт."
        )

    return None


async def plan(
    *,
    step_idx: int,
    sub_goal: SubGoal,
    self_model: SelfModel,
    observations: list[Observation],
    actions_in_sub_goal: int,
    registry_: ActionRegistry | None = None,
    task_id: str | None = None,
    user_id: str | None = None,
    stricter_note: str = "",
    task_state: TaskState | None = None,
) -> PlanStep:
    # Function-local import: by call time agent.actions.registry is fully
    # loaded, so this avoids the import-time circular dependency while
    # preserving identical runtime behaviour.
    from ...actions.registry import registry as default_registry

    reg = registry_ or default_registry
    
    # Cycle Destroyer — Phase 30 Stability Patch
    cycle_warning = _detect_cycle(observations)
    if cycle_warning:
        stricter_note = (stricter_note + "\n" + cycle_warning).strip()

    if not config.agent_use_native_tool_calling:
        # Operator opted out — keep the prompt-based path alive.
        # Phase 9.2.3 (F-11): task_id now threads through so the legacy path
        # participates in the per-task LLM-call budget like native tool calling.
        return await _legacy_plan(
            step_idx=step_idx, sub_goal=sub_goal, self_model=self_model,
            observations=observations, actions_in_sub_goal=actions_in_sub_goal,
            registry_=reg, task_id=task_id,
        )

    # Native tool-use path.
    tools = [_inject_synth_args(t) for t in all_tactical_tools(reg)]

    # Phase 23-G — recall distilled lessons whose embeddings are similar to
    # the current sub-goal description. The prompt is then unchanged when
    # nothing is found (relevance filter empty); otherwise the lessons sit
    # right after `caveats_block`, above the sub-goal recap.
    lessons_block = ""
    try:
        from ..memory.lessons import format_lessons_for_prompt, recall_lessons
        lessons = await recall_lessons(sub_goal.description, user_id=user_id)
        lessons_block = format_lessons_for_prompt(lessons)
    except Exception as exc:
        logger.debug("tactical: lessons recall skipped (%s)", exc)

    # Day-NN — surface the Will Engine's dominant drive so the planner
    # biases its tactical choice toward what PHANTOM currently *wants*
    # (audit-flagged: Phase-28 drives were sidecar-only before this).
    will_block = _format_will_block()

    # Day-NN — auto-recall top-k Strategic Memory facts that semantically
    # match the current sub-goal. Audit flagged the planner was operating
    # without long-term facts: lessons recall covers procedural knowledge
    # but not "the operator runs Radxa Q6A and prefers atomic commits".
    recall_block = ""
    if user_id:
        try:
            from memory.brain import memory_brain
            facts = await memory_brain.recall_for_prompt(
                db=None,
                user_id=user_id,
                query=sub_goal.description,
                limit=3,
                include_agent=False,
            )
            recall_block = _format_recall_block(facts)
        except Exception as exc:
            logger.debug("tactical: strategic memory recall skipped (%s)", exc)

    # Block B — surface resource pressure so the planner avoids scheduling
    # heavy actions when RAM is tight. Omitted on green (cache-stable).
    resource_block = _format_resource_block()

    # Phase 32 — Branch context
    branch_block = ""
    if task_state:
        branch_block = _format_branch_block(task_state)

    # Phase 29 — surface the 7-horizon planning context.
    horizons_block = ""
    try:
        from .horizons import format_horizons_for_prompt
        horizons_block = await format_horizons_for_prompt(user_id or "")
    except Exception as exc:
        logger.debug("tactical: horizons context skipped (%s)", exc)

    # Phase 32-KO — Knowledge Base
    try:
        from ..knowledge import project_kb
        kb_block = project_kb.get_all_formatted()
        if kb_block:
            resource_block = (kb_block + "\n\n" + resource_block).strip()
    except Exception:
        pass

    def _render_user_msg(note: str) -> str:
        rendered = _build_user_message(
            self_model=self_model, sub_goal=sub_goal,
            observations=observations, actions_in_sub_goal=actions_in_sub_goal,
            lessons_block=lessons_block,
            will_block=will_block,
            recall_block=recall_block,
            resource_block=resource_block,
            branch_block=branch_block,
            stricter_note=note,
        )
        if horizons_block:
            rendered = horizons_block + "\n" + rendered
        return rendered

    # Phase 30 — Org-Chart Role context
    role_block = ""
    if self_model.agent_role_context:
        ctx = self_model.agent_role_context
        role_block = (
            f"\nПОТОЧНА РОЛЬ: {ctx.get('name')} ({ctx.get('description')})\n"
            f"ПОСТІЙНІ ПОРЯДКИ: {ctx.get('standing_orders')}\n"
            f"ІНСТРУКЦІЇ РОЛІ: {ctx.get('system_prompt_extension')}\n"
        )

    async def _call_native(note: str) -> ToolCallResult | ToolUseError:
        return await ai_router.call_with_tools(
            system_prompt=_SYSTEM_PROMPT_UA + role_block,
            user_message=_render_user_msg(note),
            tools=tools,
            task_id=task_id,
            step_idx=step_idx,
            provider_hint="gemini-flash", # Phase 30: Use Flash for speed in tactical steps
        )

    outcome = await _call_native(stricter_note)

    if isinstance(outcome, ToolUseError):
        # Phase 9.2.1: distinguish quota exhaustion (where retry IS possible
        # later when the daily quota window resets) from semantic / parse
        # failures (where the task is just stuck on planner output).
        if outcome.kind == ToolErrorKind.QUOTA_EXHAUSTED:
            raise BlockedQuotaError(
                f"tactical blocked: provider={outcome.provider} quota exhausted; "
                f"router will probe and resume when quota recovers"
            )
        # Bubble up as PlannerLLMError so the loop's existing handler catches it
        # and turns it into a reflection trigger instead of a task crash.
        raise PlannerLLMError(
            f"tactical tool-use failed: kind={outcome.kind} provider={outcome.provider} "
            f"msg={outcome.message[:200]}"
        )

    step = _result_to_step(step_idx=step_idx, sub_goal_id=sub_goal.id, result=outcome)
    risk_by_name = {t.name: int(t.risk_level) for t in tools}
    if (
        risk_by_name.get(step.action, int(RiskLevel.SAFE)) >= int(RiskLevel.MEDIUM)
        and not step.monologue.objection
    ):
        retry_note = (
            (stricter_note + "\n") if stricter_note else ""
        ) + (
            "REPLAN: ця дія має MEDIUM+ risk. Повтори вибір і ОБОВ'ЯЗКОВО "
            "заповни `_objection` конкретним ризиком/контраргументом."
        )
        retry = await _call_native(retry_note)
        if isinstance(retry, ToolUseError):
            raise PlannerLLMError(
                f"tactical replan failed: kind={retry.kind} provider={retry.provider} "
                f"msg={retry.message[:200]}"
            )
        return _result_to_step(step_idx=step_idx, sub_goal_id=sub_goal.id, result=retry)

    return step


async def plan_safe(**kwargs) -> tuple[PlanStep | None, str | None]:
    """Wrapper that converts PlannerLLMError to (None, error_message)."""
    try:
        return (await plan(**kwargs), None)
    except PlannerLLMError as exc:
        return (None, str(exc))
