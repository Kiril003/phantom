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
from typing import Any

from ai.provider import ai_router
from ai.tool_use import (
    ToolCallResult,
    ToolErrorKind,
    ToolSchema,
    ToolUseError,
    all_tactical_tools,
)
from config import config

from ..actions.registry import ActionRegistry, registry as default_registry
from ..observations import format_for_llm
from ..schemas import (
    InnerMonologue,
    Observation,
    PlanStep,
    RiskLevel,
    SelfModel,
    SubGoal,
)
from ._llm import PlannerLLMError, llm_json

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
Ти — тактичний планувальник PHANTOM. Поточна під-ціль активна.
Обери ОДНУ наступну дію через native function calling.

Я СТВОРЕНИЙ РОЗУМІТИ УКРАЇНСЬКУ ТА АНГЛІЙСЬКУ. Технічні терміни (шляхи файлів,
назви команд, JSON, URL) зберігай англійською природно.

Правила:
- Обери рівно ОДИН інструмент із доступного каталогу.
- Кожен інструмент має звичайні аргументи + синтетичні `_intent`,
  `_what_i_see`, `_what_i_plan`, `_why_this_works`, `_what_could_fail`,
  `_objection`, `_confidence` для внутрішнього монологу.
- Для MEDIUM+ ризику (3+) `_objection` має бути заповнений реальним сумнівом.
- Для under-summarize / present / explain / respond / answer під-цілей
  ЗАВЖДИ використовуй DONE_SUBGOAL (або DONE_TASK) — у `summary` поклади
  готову відповідь користувачу. Немає інструмента respond_text / answer.
"""


_USER_TEMPLATE = """\
SELF:
{self_model_json}

ПОТОЧНА ПІД-ЦІЛЬ:
{sub_goal_description}
Acceptance: {acceptance}
Rationale: {rationale}
Очікувана к-сть дій: {expected_actions} | Використано в цій під-цілі: {actions_in_sub_goal}

ОСТАННІ СПОСТЕРЕЖЕННЯ (до 10):
{observations_block}

{stricter_note}
"""


def _inject_synth_args(tool: ToolSchema) -> ToolSchema:
    """Return a copy of `tool` with synthetic monologue args added to params."""
    new_params = deepcopy(tool.parameters or {"type": "object", "properties": {}, "required": []})
    new_params.setdefault("type", "object")
    new_params.setdefault("properties", {})
    new_params.setdefault("required", [])
    props = new_params["properties"]
    props.setdefault("_intent", {"type": "string", "description": "what this step achieves (one sentence)"})
    props.setdefault("_what_i_see", {"type": "string", "description": "current state summary (1-2 sentences)"})
    props.setdefault("_what_i_plan", {"type": "string", "description": "what this action does"})
    props.setdefault("_why_this_works", {"type": "string", "description": "reasoning from observations to chosen action"})
    props.setdefault("_what_could_fail", {"type": "string", "description": "anticipated failure modes"})
    props.setdefault("_objection", {"type": "string", "description": "devil's-buddy objection — REQUIRED for MEDIUM+ risk"})
    props.setdefault("_confidence", {"type": "number", "description": "0..1 confidence in this choice"})
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


def _required_objection_missing(action_name: str, monologue: InnerMonologue,
                                registry_: ActionRegistry) -> bool:
    if action_name in {"DONE_SUBGOAL", "DONE_TASK", "REFLECT"}:
        return False
    cls = registry_.get(action_name)
    if cls is None:
        return False
    if int(cls.risk_level) >= int(RiskLevel.MEDIUM):
        return not (monologue.objection and monologue.objection.strip())
    return False


def _build_user_message(
    *,
    self_model: SelfModel,
    sub_goal: SubGoal,
    observations: list[Observation],
    actions_in_sub_goal: int,
    stricter_note: str = "",
) -> str:
    return _USER_TEMPLATE.format(
        self_model_json=json.dumps(self_model.model_dump(mode="json"), ensure_ascii=False),
        sub_goal_description=sub_goal.description,
        acceptance=sub_goal.acceptance_criteria,
        rationale=sub_goal.rationale,
        expected_actions=sub_goal.expected_actions,
        actions_in_sub_goal=actions_in_sub_goal,
        observations_block=format_for_llm(observations, limit=10),
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
) -> PlanStep:
    prompt = _LEGACY_PROMPT.format(
        self_model_json=json.dumps(self_model.model_dump(mode="json"), ensure_ascii=False),
        sub_goal_description=sub_goal.description,
        acceptance=sub_goal.acceptance_criteria,
        rationale=sub_goal.rationale,
        observations_block=format_for_llm(observations, limit=10),
        actions_catalog_json=json.dumps(registry_.catalog(), ensure_ascii=False),
        stricter_note=stricter_note,
    )
    data = await llm_json(prompt)
    return _build_legacy_step(step_idx, sub_goal.id, data)


# ── Public entry ──────────────────────────────────────────────────────────────


async def plan(
    *,
    step_idx: int,
    sub_goal: SubGoal,
    self_model: SelfModel,
    observations: list[Observation],
    actions_in_sub_goal: int,
    registry_: ActionRegistry | None = None,
    task_id: str | None = None,
) -> PlanStep:
    reg = registry_ or default_registry

    if not config.agent_use_native_tool_calling:
        # Operator opted out — keep the prompt-based path alive.
        step = await _legacy_plan(
            step_idx=step_idx, sub_goal=sub_goal, self_model=self_model,
            observations=observations, actions_in_sub_goal=actions_in_sub_goal,
            registry_=reg,
        )
        if _required_objection_missing(step.action, step.monologue, reg):
            step = await _legacy_plan(
                step_idx=step_idx, sub_goal=sub_goal, self_model=self_model,
                observations=observations, actions_in_sub_goal=actions_in_sub_goal,
                registry_=reg,
                stricter_note=(
                    "STRICT: For MEDIUM/HIGH risk actions you MUST fill 'objection' "
                    "with a real concern. Try again."
                ),
            )
        return step

    # Native tool-use path.
    tools = [_inject_synth_args(t) for t in all_tactical_tools(reg)]
    user_msg = _build_user_message(
        self_model=self_model, sub_goal=sub_goal,
        observations=observations, actions_in_sub_goal=actions_in_sub_goal,
    )

    outcome = await ai_router.call_with_tools(
        system_prompt=_SYSTEM_PROMPT_UA,
        user_message=user_msg,
        tools=tools,
        task_id=task_id,
        step_idx=step_idx,
    )

    if isinstance(outcome, ToolUseError):
        # Bubble up as PlannerLLMError so the loop's existing handler catches it
        # and turns it into a reflection trigger instead of a task crash.
        raise PlannerLLMError(
            f"tactical tool-use failed: kind={outcome.kind} provider={outcome.provider} "
            f"msg={outcome.message[:200]}"
        )

    step = _result_to_step(step_idx=step_idx, sub_goal_id=sub_goal.id, result=outcome)

    if _required_objection_missing(step.action, step.monologue, reg):
        logger.info("tactical: forcing replan — MEDIUM+ action without objection (%s)", step.action)
        stricter_msg = user_msg + (
            "\n\nSTRICT: Your previous attempt picked a MEDIUM+ risk action without "
            "filling `_objection`. Try again with a real, concrete concern — not 'none'."
        )
        outcome2 = await ai_router.call_with_tools(
            system_prompt=_SYSTEM_PROMPT_UA,
            user_message=stricter_msg,
            tools=tools,
            task_id=task_id,
            step_idx=step_idx,
        )
        if isinstance(outcome2, ToolCallResult):
            step = _result_to_step(step_idx=step_idx, sub_goal_id=sub_goal.id, result=outcome2)

    return step


async def plan_safe(**kwargs) -> tuple[PlanStep | None, str | None]:
    """Wrapper that converts PlannerLLMError to (None, error_message)."""
    try:
        return (await plan(**kwargs), None)
    except PlannerLLMError as exc:
        return (None, str(exc))
