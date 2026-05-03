"""
Phase 26-B — Specialist picker.

The decision-maker that says, given a goal + context, WHICH specialists
to spawn AND HOW MANY copies. Two surfaces:

  • LLM-driven `pick_specialists(goal, context, budget)` — strategic
    planner reads the catalog (name + dept + description + tools +
    risk_ceiling + personality) and proposes a structured plan:
        [{role, count, sub_goal, constraints, timeout_s}]
    Capped by `agent_max_team_concurrency` and a per-call `budget`.

  • Deterministic fallback `heuristic_pick(goal)` — when LLM is
    offline. Uses keyword matching against role descriptions to make
    a sensible suggestion (e.g. "audit auth" → senior_security +
    pen_tester; "write README" → documentation_writer).

Output is ALWAYS a `TeamPlan` dataclass — the planner / team-lead
pulls each entry through `agent.delegate` (Phase 26-A) one by one
or in parallel via asyncio.gather.
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any

from config import config

from .specialists import (
    Specialist, all_specialists, get_specialist, specialist_catalog,
)

logger = logging.getLogger(__name__)


# ─── Output types ────────────────────────────────────────────────────────────


@dataclass
class TeamMemberRequest:
    """One specialist instance the planner wants to spawn."""
    role: str
    count: int = 1                      # how many parallel copies
    sub_goal: str = ""                  # bare goal for THIS specialist
    constraints: str = ""
    timeout_s: int = 300


@dataclass
class TeamPlan:
    """The full proposal the LLM (or heuristic) returned."""
    rationale: str = ""                 # why this team shape
    members: list[TeamMemberRequest] = field(default_factory=list)
    generation_strategy: str = "deterministic"   # "llm" | "deterministic"

    def total_spawns(self) -> int:
        return sum(m.count for m in self.members)


# ─── LLM picker ──────────────────────────────────────────────────────────────


_PICK_PROMPT_UA = """\
Ти — staff engineer що формує склад команди для виконання задачі.
Прочитай мету + контекст і обери який підмножина наявних спеціалістів
потрібна. Можна викликати ОДНОГО спеціаліста кілька разів паралельно
(count > 1) коли робота природно паралелиться (3 окремі модулі для review,
3 паралельних дослідження).

МЕТА:
{goal}

КОНТЕКСТ:
{context}

КАТАЛОГ СПЕЦІАЛІСТІВ:
{catalog}

БЮДЖЕТ: максимум {budget} спавнів за весь plan.

Поверни строго JSON:
{{
  "rationale": "<≤300 символів — чому саме ця команда>",
  "members": [
    {{
      "role": "<exactly one of the role names above>",
      "count": <1..5>,
      "sub_goal": "<що саме РОБИТЬ цей спеціаліст — concrete, ≤300 символів>",
      "constraints": "<≤200 символів або \\"\\">",
      "timeout_s": <60..1800>
    }}
  ]
}}

Без прози поза JSON. Без markdown. Якщо задача проста і не потребує
команди — повертай порожній members[].
"""


async def pick_specialists(
    *,
    goal: str,
    context: str = "",
    budget: int | None = None,
    task_id: str | None = None,
) -> TeamPlan:
    """LLM-driven team composition. Best-effort: any failure returns
    `heuristic_pick(goal)` so the planner still gets a plan."""
    if not bool(getattr(config, "agent_team_enabled", True)):
        return TeamPlan(
            rationale="agent_team_enabled=False; team picker skipped",
            members=[],
            generation_strategy="deterministic",
        )

    cap = budget if budget is not None else int(
        getattr(config, "agent_max_team_concurrency", 8)
    )

    try:
        from ai.json_response import JsonResponseError
        from ai.provider import ai_router
        catalog_text = "\n".join(
            f"  • {row['name']} (dept={row['department']}, "
            f"risk≤{row['risk_ceiling']}): {row['description']}"
            for row in specialist_catalog()
        )
        prompt = _PICK_PROMPT_UA.format(
            goal=goal[:600],
            context=(context or "(none)")[:600],
            catalog=catalog_text,
            budget=cap,
        )
        response = await ai_router.generate(
            user_message=prompt,
            system_prompt=(
                "Ти стислий staff engineer. Відповідаєш чистим JSON."
            ),
            history=[],
            task_id=task_id,
        )
        raw = (response.content or "").strip()
        if raw.startswith("```"):
            raw = raw.strip("`").lstrip("json").strip()
        data = json.loads(raw)
        plan = _coerce_plan(data, budget=cap)
        plan.generation_strategy = "llm"
        return plan
    except (json.JSONDecodeError, JsonResponseError) as exc:
        logger.debug("pick_specialists JSON parse failed: %s", exc)
    except Exception as exc:
        logger.debug("pick_specialists LLM failed: %s", exc)

    return heuristic_pick(goal=goal, budget=cap)


def _coerce_plan(data: Any, *, budget: int) -> TeamPlan:
    """Validate + sanitise the LLM's JSON. Drops members with unknown
    roles. Caps total spawns at budget, slicing FIFO so the LLM-implied
    priority order survives. Numeric fields clamped to safe ranges."""
    if not isinstance(data, dict):
        return TeamPlan(rationale="LLM returned non-dict", members=[])

    rationale = str(data.get("rationale") or "").strip()[:300]
    raw_members = data.get("members") or []
    if not isinstance(raw_members, list):
        return TeamPlan(rationale=rationale, members=[])

    members: list[TeamMemberRequest] = []
    seen_total = 0
    for item in raw_members:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role") or "").strip()
        if get_specialist(role) is None:
            continue  # silently drop unknown roles
        try:
            count = int(item.get("count") or 1)
        except (TypeError, ValueError):
            count = 1
        count = max(1, min(5, count))
        if seen_total + count > budget:
            count = max(0, budget - seen_total)
            if count == 0:
                break
        sub_goal = str(item.get("sub_goal") or "").strip()[:300]
        constraints = str(item.get("constraints") or "").strip()[:200]
        try:
            timeout_s = int(item.get("timeout_s") or 300)
        except (TypeError, ValueError):
            timeout_s = 300
        timeout_s = max(60, min(1800, timeout_s))
        members.append(TeamMemberRequest(
            role=role, count=count, sub_goal=sub_goal,
            constraints=constraints, timeout_s=timeout_s,
        ))
        seen_total += count
    return TeamPlan(rationale=rationale, members=members)


# ─── Deterministic fallback ─────────────────────────────────────────────────


# Keyword → recommended specialist set. Order matters — first hit wins
# but every match contributes one entry. Tuned to be conservative so an
# offline planner suggests SOME team rather than nothing.
_KEYWORD_RULES: list[tuple[str, list[str]]] = [
    # security
    (r"\b(audit|security|owasp|cve|vulnerab|sandbox|injection|auth)\b",
     ["senior_security", "pen_tester"]),
    # backend
    (r"\b(api|fastapi|backend|sqlalchemy|database|schema|router)\b",
     ["senior_backend"]),
    # frontend
    (r"\b(ui|react|component|tailwind|frontend|panel|css|tsx)\b",
     ["senior_frontend"]),
    # tests
    (r"\b(test|coverage|pytest|vitest|regression|fixture)\b",
     ["senior_test"]),
    # docs
    (r"\b(readme|doc|adr|spec|runbook|markdown|документ)\b",
     ["documentation_writer"]),
    # research
    (r"\b(research|find papers|state of the art|sota|review the field|"
     r"досл|новин|трендах|порівняй технолог)",
     ["domain_researcher"]),
    # data
    (r"\b(query|aggregate|chart|trend|data|sql|metric|історія|статистик)",
     ["data_analyst"]),
    # incident
    (r"\b(incident|outage|crash|broken|fail|paging|debug now)\b",
     ["incident_responder"]),
    # design
    (r"\b(design|visual|layout|motion|animation|accessibility|wcag)\b",
     ["designer"]),
    # ux
    (r"\b(ux|user flow|friction|onboarding)\b",
     ["ux_researcher"]),
    # architecture
    (r"\b(architecture|adr|trade-off|module boundary|design doc)\b",
     ["senior_architect"]),
    # devops
    (r"\b(deploy|systemd|docker|ci|cd|packaging|release)\b",
     ["senior_devops"]),
    # perf
    (r"\b(perf|performance|bottleneck|profile|latency|slow)\b",
     ["senior_perf"]),
    # translation
    (r"\b(translate|переклад|localiz)\b",
     ["translator"]),
]


def heuristic_pick(*, goal: str, budget: int) -> TeamPlan:
    """Keyword-driven fallback. Used when the LLM is offline OR when
    the caller wants a cheap baseline plan they can compare LLM output
    against. Always returns at most `budget` spawns total."""
    g = (goal or "").lower()
    chosen: dict[str, int] = {}
    for pattern, roles in _KEYWORD_RULES:
        if re.search(pattern, g, flags=re.IGNORECASE):
            for r in roles:
                chosen[r] = chosen.get(r, 0) + 1
    if not chosen:
        # Catch-all: spawn one generalist by way of no specialist —
        # caller can decide to do the work itself.
        return TeamPlan(
            rationale="no keywords matched; deterministic picker punts",
            members=[],
            generation_strategy="deterministic",
        )
    members: list[TeamMemberRequest] = []
    total = 0
    for role in chosen:
        if total >= budget:
            break
        members.append(TeamMemberRequest(
            role=role,
            count=1,
            sub_goal=goal[:300],
            constraints="",
            timeout_s=300,
        ))
        total += 1
    return TeamPlan(
        rationale=(
            f"deterministic keyword match — {len(chosen)} role(s); "
            f"budget cap {budget}"
        ),
        members=members,
        generation_strategy="deterministic",
    )


__all__ = [
    "TeamMemberRequest",
    "TeamPlan",
    "pick_specialists",
    "heuristic_pick",
]
