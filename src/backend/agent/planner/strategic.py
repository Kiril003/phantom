"""
Strategic planner — decomposes a goal into 1..7 SubGoals.

Called once at task start, plus when the reflector returns
verdict='revise_strategy'. Output is a StrategicPlan with per-sub-goal
expected_actions estimates that drive the thought-budget.
"""
from __future__ import annotations

import json
import logging

from ..schemas import StrategicPlan, SubGoal, SelfModel
from ._llm import PlannerLLMError, llm_json

logger = logging.getLogger(__name__)


_PROMPT = """\
You are PHANTOM's strategic planner. Decompose the goal into 1-7 sub-goals
that can each be achieved by a short sequence of actions.

SELF:
{self_model_json}

PAST RELEVANT EPISODES (if any):
{memory_seeds_summary}

AVAILABLE ACTION CATEGORIES:
- filesystem (read/write within ~/phantom/workspace)
- shell (sandboxed commands via firejail when available)
- browser (navigate, extract via Playwright chromium)
- network (ping sweep up to /24, tcp port check)
- process (list)
- notification (desktop)
- time (wait, ≤ 60s)
- self (capability check, memory recall — SQL LIKE for now)

GOAL: {goal}

{revise_note}

Output strict JSON:
{{
  "sub_goals": [
    {{
      "description": "...",
      "rationale": "why this sub-goal advances the main goal",
      "expected_actions": <int>,
      "acceptance_criteria": "what observable outcome means this sub-goal is done"
    }}
  ],
  "estimated_total_actions": <sum>,
  "risk_assessment": "brief sentence on max risk involved"
}}

No prose, no markdown fences.
"""


async def plan(
    goal: str,
    self_model: SelfModel,
    memory_seeds_summary: str = "",
    revise_note: str = "",
) -> StrategicPlan:
    prompt = _PROMPT.format(
        self_model_json=json.dumps(self_model.model_dump(mode="json"), ensure_ascii=False),
        memory_seeds_summary=memory_seeds_summary or "(none)",
        goal=goal,
        revise_note=("REVISION NOTE:\n" + revise_note) if revise_note else "",
    )

    try:
        data = await llm_json(prompt)
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
