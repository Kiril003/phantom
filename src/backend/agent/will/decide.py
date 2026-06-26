from __future__ import annotations

import json
import logging
from typing import Awaitable, Callable

from agent.will.types import Goal, Budget, WillDecision
from agent.cognition.planner.horizons import HORIZON_NAMES

logger = logging.getLogger(__name__)

_SYSTEM = ("Ти — воля PHANTOM. Обери РІВНО ОДНУ найцінніщу наступну дію до цілей. "
           "Поверни ЛИШЕ JSON, без прози.")

_PROMPT = """\
[ЧАС/КОНТЕКСТ]
{ctx}

[АКТИВНІ ЦІЛІ ПО ГОРИЗОНТАХ]
{goals}

[БЮДЖЕТ НА СЬОГОДНІ]
викликів лишилось: {calls_left}, токенів: {tokens_left}

Обери ОДНУ дію, що найбільше просуває найважливішу ціль зараз. Види дій:
- start_task: запустити фонову задачу (велика робота)
- standing_order: створити повторюване правило
- proactive_seed: підготувати репліку користувачу
- noop: зараз діяти не варто

Поверни ЛИШЕ JSON:
{{"kind": "...", "goal_id": "<id або null>", "action_text": "...", "rationale": "..."}}"""


def _strip_fence(raw: str) -> str:
    raw = raw.strip()
    if raw.startswith("```"):
        parts = raw.split("```")
        raw = parts[1] if len(parts) > 1 else raw
        if raw.startswith("json"):
            raw = raw[4:]
    return raw.strip()


async def decide_next(
    snapshot: dict,
    goals: list[Goal],
    budget: Budget,
    *,
    dispatch_llm: Callable[[str, str], Awaitable[str]],
) -> WillDecision:
    if not goals:
        return WillDecision(kind="noop", rationale="no active goals")

    goal_lines = "\n".join(
        f"- [{HORIZON_NAMES[g.horizon_level] if g.horizon_level < len(HORIZON_NAMES) else g.horizon_level}] "
        f"{g.description} (id={g.id}, status={g.status})"
        for g in goals
    )
    prompt = _PROMPT.format(
        ctx=json.dumps(snapshot.get("when", {}), ensure_ascii=False),
        goals=goal_lines,
        calls_left=budget.calls_cap - budget.calls_used,
        tokens_left=budget.tokens_cap - budget.tokens_used,
    )
    try:
        raw = await dispatch_llm(prompt, _SYSTEM)
        parsed = json.loads(_strip_fence(raw))
        kind = str(parsed.get("kind", "noop"))
        if kind not in ("start_task", "standing_order", "proactive_seed", "noop"):
            kind = "noop"
        return WillDecision(
            kind=kind,  # type: ignore[arg-type]
            goal_id=parsed.get("goal_id") or None,
            action_text=str(parsed.get("action_text", ""))[:500],
            rationale=str(parsed.get("rationale", ""))[:500],
        )
    except Exception as exc:
        logger.debug("decide_next parse failed: %s", exc)
        return WillDecision(kind="noop", rationale="decide parse failure")
