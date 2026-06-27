"""Goal decomposition — the will breaks a high-horizon goal into the next
horizon down, so the tree always has actionable leaves.

Pure core (`propose_children`) is unit-testable with an injected LLM. The
wrapper (`decompose_goal`) seeds the children under the parent.
"""
from __future__ import annotations

import json
import logging
from typing import Awaitable, Callable

from sqlalchemy.ext.asyncio import AsyncSession

from agent.will.types import Goal
from agent.cognition.planner.horizons import HORIZON_NAMES

logger = logging.getLogger(__name__)

_SYSTEM = ("Ти — планувальна воля PHANTOM. Розбий задану ціль на 2-4 конкретніші "
           "підцілі на наступному (нижчому) горизонті. Поверни ЛИШЕ JSON-масив.")

_PROMPT = """\
[ЦІЛЬ ДЛЯ РОЗБИТТЯ]
[{horizon}] {description}

Розбий її на 2-4 підцілі на горизонті {child_name} (рівень {child_level}).
Кожна підціль — конкретний, перевірюваний крок до батьківської цілі.

Поверни ЛИШЕ JSON-масив рядків-описів:
["підціль 1", "підціль 2", ...]"""


def _strip_fence(raw: str) -> str:
    raw = raw.strip()
    if raw.startswith("```"):
        parts = raw.split("```")
        raw = parts[1] if len(parts) > 1 else raw
        if raw.startswith("json"):
            raw = raw[4:]
    return raw.strip()


async def propose_children(
    goal: Goal,
    *,
    dispatch_llm: Callable[[str, str], Awaitable[str]],
    max_children: int = 4,
) -> list[str]:
    """Pure decomposition. Returns child descriptions, or [] if goal is a leaf."""
    if goal.horizon_level >= 6:  # ACTION is already a leaf
        return []
    child_level = goal.horizon_level + 1
    child_name = HORIZON_NAMES[child_level] if child_level < len(HORIZON_NAMES) else str(child_level)
    parent_name = (HORIZON_NAMES[goal.horizon_level]
                   if goal.horizon_level < len(HORIZON_NAMES) else str(goal.horizon_level))
    prompt = _PROMPT.format(
        horizon=parent_name, description=goal.description,
        child_name=child_name, child_level=child_level,
    )
    try:
        raw = await dispatch_llm(prompt, _SYSTEM)
        parsed = json.loads(_strip_fence(raw))
        if not isinstance(parsed, list):
            return []
        out: list[str] = []
        for item in parsed[:max_children]:
            desc = str(item).strip()
            if desc:
                out.append(desc[:500])
        return out
    except Exception as exc:
        logger.debug("propose_children parse failed: %s", exc)
        return []


async def decompose_goal(
    db: AsyncSession,
    user_id: str,
    goal: Goal,
    *,
    dispatch_llm: Callable[[str, str], Awaitable[str]],
) -> list[str]:
    """Decompose `goal` into next-horizon children, seeding them under it.
    Returns created child goal ids. No-op for ACTION-level goals."""
    from agent.will import goals as goals_repo

    descriptions = await propose_children(goal, dispatch_llm=dispatch_llm)
    created: list[str] = []
    for desc in descriptions:
        gid = await goals_repo.seed(
            db, user_id, desc, goal.horizon_level + 1,
            parent_id=goal.id, source=goal.source)
        created.append(gid)
    return created
