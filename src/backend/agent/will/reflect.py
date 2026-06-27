"""Reflective self-generation — the will proposes its own goals from observation.

Pure core (`propose_goals`) is unit-testable with an injected LLM. The wrapper
(`reflect_and_seed`) gathers observations from mind_state / narrative / recent
journal, then seeds proposed goals with source="self_generated".
"""
from __future__ import annotations

import json
import logging
from typing import Awaitable, Callable

from sqlalchemy.ext.asyncio import AsyncSession

from agent.will.types import Goal
from agent.cognition.planner.horizons import HORIZON_NAMES

logger = logging.getLogger(__name__)

_SYSTEM = ("Ти — рефлексивна воля PHANTOM. На основі спостережень за користувачем "
           "запропонуй до 3 НОВИХ змістовних цілей, що служать його інтересам. "
           "Поверни ЛИШЕ JSON-масив, без прози.")

_PROMPT = """\
[СПОСТЕРЕЖЕННЯ ЗА КОРИСТУВАЧЕМ]
{observations}

[ВЖЕ АКТИВНІ ЦІЛІ — НЕ ДУБЛЮЙ ЇХ]
{existing}

Запропонуй 1-3 нові цілі, яких ще немає. Кожна — на горизонті:
0=VISION 1=YEAR 2=QUARTER 3=MONTH 4=WEEK 5=DAY 6=ACTION.
Цінуй довгострокову користь користувачу, а не дрібну метушню.

Поверни ЛИШЕ JSON-масив:
[{{"description": "...", "horizon_level": 0-6, "rationale": "..."}}]
Якщо нових вартих цілей немає — поверни []."""


def _strip_fence(raw: str) -> str:
    raw = raw.strip()
    if raw.startswith("```"):
        parts = raw.split("```")
        raw = parts[1] if len(parts) > 1 else raw
        if raw.startswith("json"):
            raw = raw[4:]
    return raw.strip()


async def propose_goals(
    observations: str,
    existing: list[Goal],
    *,
    dispatch_llm: Callable[[str, str], Awaitable[str]],
    max_new: int = 3,
) -> list[dict]:
    """Pure proposal step. Returns a list of {description, horizon_level}."""
    existing_lines = "\n".join(
        f"- [{HORIZON_NAMES[g.horizon_level] if g.horizon_level < len(HORIZON_NAMES) else g.horizon_level}] "
        f"{g.description}" for g in existing
    ) or "(немає)"
    prompt = _PROMPT.format(observations=observations or "(немає даних)", existing=existing_lines)
    try:
        raw = await dispatch_llm(prompt, _SYSTEM)
        parsed = json.loads(_strip_fence(raw))
        if not isinstance(parsed, list):
            return []
        out: list[dict] = []
        for item in parsed[:max_new]:
            desc = str(item.get("description", "")).strip()
            if not desc:
                continue
            lvl = item.get("horizon_level", 0)
            try:
                lvl = int(lvl)
            except (TypeError, ValueError):
                lvl = 0
            lvl = max(0, min(6, lvl))
            out.append({"description": desc[:500], "horizon_level": lvl})
        return out
    except Exception as exc:
        logger.debug("propose_goals parse failed: %s", exc)
        return []


async def _gather_observations(db: AsyncSession, user_id: str) -> str:
    """Best-effort context for reflection. Never raises."""
    parts: list[str] = []
    try:
        from memory.mind_state import get_mind_state, format_for_prompt
        ms = await get_mind_state(db, user_id)
        txt = format_for_prompt(ms)
        if txt:
            parts.append(txt)
    except Exception as exc:
        logger.debug("reflect mind_state read failed: %s", exc)
    try:
        from memory.narrative import get_narrative
        narr = await get_narrative(db, user_id)
        if narr:
            parts.append(f"[НАРАТИВ]\n{narr[:800]}")
    except Exception as exc:
        logger.debug("reflect narrative read failed: %s", exc)
    # Self-generated goals must serve the entity's values and current needs,
    # not drift — give reflection the doctrine and the dominant drive.
    try:
        from agent.cognition.will.values import values_system
        doctrine = values_system._load_doctrine()
        if doctrine:
            parts.append(f"[ЦІННОСТІ — ЦІЛІ МАЮТЬ ЇМ СЛУЖИТИ]\n{doctrine[:600]}")
    except Exception as exc:
        logger.debug("reflect values read failed: %s", exc)
    try:
        from agent.cognition.will.drives import drive_system
        drive_system.tick()
        dominant = drive_system.dominant()
        if dominant is not None:
            parts.append(f"[ДОМІНАНТНИЙ ДРАЙВ ЗАРАЗ] {dominant.name} "
                         f"(тиск {dominant.pressure():.2f}) — врахуй цю потребу.")
    except Exception as exc:
        logger.debug("reflect drive read failed: %s", exc)
    return "\n\n".join(parts)


async def reflect_and_seed(
    db: AsyncSession,
    user_id: str,
    *,
    dispatch_llm: Callable[[str, str], Awaitable[str]],
    observations: str | None = None,
) -> list[str]:
    """Gather observations, propose goals, seed them as self_generated.
    Returns the list of created goal ids."""
    from agent.will import goals as goals_repo

    obs = observations if observations is not None else await _gather_observations(db, user_id)
    active = await goals_repo.list_active(db, user_id)
    proposals = await propose_goals(obs, active, dispatch_llm=dispatch_llm)
    created: list[str] = []
    for p in proposals:
        gid = await goals_repo.seed(
            db, user_id, p["description"], p["horizon_level"], source="self_generated")
        created.append(gid)
    return created
