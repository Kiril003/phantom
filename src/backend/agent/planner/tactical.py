"""
Tactical planner — picks the SINGLE next PlanStep for the active sub-goal.

Enforces the devil's-buddy rule: any MEDIUM+ risk action MUST carry a populated
monologue.objection. Missing → forced replan with a stricter prompt.
"""
from __future__ import annotations

import json
import logging

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


_PROMPT = """\
You are PHANTOM's tactical planner. The current sub-goal is active.
Output the SINGLE next action as strict JSON.

SELF:
{self_model_json}

CURRENT SUB-GOAL:
{sub_goal_description}
Acceptance: {acceptance}
Rationale: {rationale}
Expected actions: {expected_actions} | Used in this sub-goal: {actions_in_sub_goal}

OBSERVATIONS (last 10):
{observations_block}

AVAILABLE ACTIONS (with signatures):
{actions_catalog_json}

{stricter_note}

Output strict JSON with FULL structure:
{{
  "action": "<name>",
  "args": {{...}},
  "intent": "one sentence: what I am trying to achieve with this step",
  "monologue": {{
    "what_i_see": "summary of current state (1-2 sentences)",
    "what_i_plan": "what this action does",
    "why_this_works": "reasoning from observations to chosen action",
    "what_could_fail": "anticipated failure modes",
    "objection": "<MUST be filled for risk MEDIUM/HIGH actions; else null>",
    "confidence": <0.0..1.0>
  }}
}}

If sub-goal is complete: action="DONE_SUBGOAL", args={{"summary": "<what was achieved>"}}.
If sub-goal is impossible or unsafe: action="DONE_SUBGOAL", args={{"summary": "<why abandoning>"}}.
If the whole task is complete: action="DONE_TASK", args={{"summary": "<overall outcome>"}}.

No prose outside JSON, no markdown fences.
"""


_TERMINAL_ACTIONS = {"DONE_SUBGOAL", "DONE_TASK", "REFLECT"}


def _build_step(step_idx: int, sub_goal_id: str | None, data: dict) -> PlanStep:
    raw_mono = data.get("monologue") or {}
    monologue = InnerMonologue(
        what_i_see=str(raw_mono.get("what_i_see", "")),
        what_i_plan=str(raw_mono.get("what_i_plan", "")),
        why_this_works=str(raw_mono.get("why_this_works", "")),
        what_could_fail=str(raw_mono.get("what_could_fail", "")),
        objection=raw_mono.get("objection") if raw_mono.get("objection") not in ("", None, "null") else None,
        confidence=float(raw_mono.get("confidence", 0.5)),
    )
    return PlanStep(
        step_idx=step_idx,
        sub_goal_id=sub_goal_id,
        action=str(data.get("action", "")).strip(),
        args=data.get("args") or {},
        intent=str(data.get("intent", "")).strip(),
        monologue=monologue,
    )


def _required_objection_missing(step: PlanStep, registry_: ActionRegistry) -> bool:
    if step.action in _TERMINAL_ACTIONS:
        return False
    cls = registry_.get(step.action)
    if cls is None:
        return False
    if int(cls.risk_level) >= int(RiskLevel.MEDIUM):
        return not (step.monologue.objection and step.monologue.objection.strip())
    return False


async def plan(
    *,
    step_idx: int,
    sub_goal: SubGoal,
    self_model: SelfModel,
    observations: list[Observation],
    actions_in_sub_goal: int,
    registry_: ActionRegistry | None = None,
) -> PlanStep:
    reg = registry_ or default_registry

    base_prompt = _PROMPT.format(
        self_model_json=json.dumps(self_model.model_dump(mode="json"), ensure_ascii=False),
        sub_goal_description=sub_goal.description,
        acceptance=sub_goal.acceptance_criteria,
        rationale=sub_goal.rationale,
        expected_actions=sub_goal.expected_actions,
        actions_in_sub_goal=actions_in_sub_goal,
        observations_block=format_for_llm(observations, limit=10),
        actions_catalog_json=json.dumps(reg.catalog(), ensure_ascii=False),
        stricter_note="",
    )

    data = await llm_json(base_prompt)
    step = _build_step(step_idx, sub_goal.id, data)

    if _required_objection_missing(step, reg):
        logger.info("tactical: forcing replan — MEDIUM+ action without objection (%s)", step.action)
        stricter = _PROMPT.format(
            self_model_json=json.dumps(self_model.model_dump(mode="json"), ensure_ascii=False),
            sub_goal_description=sub_goal.description,
            acceptance=sub_goal.acceptance_criteria,
            rationale=sub_goal.rationale,
            expected_actions=sub_goal.expected_actions,
            actions_in_sub_goal=actions_in_sub_goal,
            observations_block=format_for_llm(observations, limit=10),
            actions_catalog_json=json.dumps(reg.catalog(), ensure_ascii=False),
            stricter_note=(
                "STRICT: For MEDIUM or HIGH risk actions you must fill 'objection' "
                "with a real concern. The previous attempt left it empty — try again."
            ),
        )
        data = await llm_json(stricter)
        step = _build_step(step_idx, sub_goal.id, data)

    return step


async def plan_safe(**kwargs) -> tuple[PlanStep | None, str | None]:
    """Wrapper that converts PlannerLLMError to (None, error_message)."""
    try:
        return (await plan(**kwargs), None)
    except PlannerLLMError as exc:
        return (None, str(exc))
