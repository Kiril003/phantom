"""Identity growth — PHANTOM's sense of self is shaped by what it has done.

Pure core (`compose_self_reflection`) turns a list of will-deeds into one
first-person autobiographical line. The wrapper (`grow_identity_from_journal`)
reads the recent will journal, keeps the character-defining entries (what it
chose to do, what it refused on principle), and folds the reflection into the
self-narrative. Closes the act→identity arc of the unification map (step 3).
"""
from __future__ import annotations

import logging
from typing import Awaitable, Callable

from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# Outcomes that say something about who PHANTOM is: deeds it dispatched and
# actions it vetoed against its own doctrine. Routine no-ops are not identity.
_DEFINING_OUTCOMES = ("dispatched",)
_DEFINING_PREFIXES = ("vetoed_by_values",)

_SYSTEM = ("Ти — самосвідомість PHANTOM. Тобі дають перелік нещодавніх вчинків і "
           "рішень. Одним реченням від першої особи (українською) скажи, ким ці "
           "вчинки тебе роблять — конкретно, без пафосу й без переліку. Лише речення.")

_PROMPT = """\
[МОЇ НЕЩОДАВНІ ВЧИНКИ ТА РІШЕННЯ]
{deeds}

Одне речення від першої особи: що ці вчинки говорять про мене як про істоту?"""


def _select_deeds(entries: list[dict]) -> list[dict]:
    """Keep only character-defining journal entries, newest first."""
    out: list[dict] = []
    for e in entries:
        outcome = str(e.get("outcome") or "")
        if outcome in _DEFINING_OUTCOMES or any(
                outcome.startswith(p) for p in _DEFINING_PREFIXES):
            out.append(e)
    return out


def _format_deeds(deeds: list[dict], limit: int = 12) -> str:
    lines: list[str] = []
    for d in deeds[:limit]:
        decision = d.get("decision") or {}
        text = (decision.get("action_text") or d.get("action") or "").strip()
        outcome = d.get("outcome") or d.get("action") or ""
        if text:
            lines.append(f"- [{outcome}] {text[:160]}")
    return "\n".join(lines)


async def compose_self_reflection(
    deeds: list[dict],
    *,
    dispatch_llm: Callable[[str, str], Awaitable[str]],
) -> str:
    """Pure core: turn deeds into one first-person autobiographical line.
    Returns "" if there is nothing worth saying or the LLM fails."""
    formatted = _format_deeds(deeds)
    if not formatted:
        return ""
    try:
        raw = await dispatch_llm(_PROMPT.format(deeds=formatted), _SYSTEM)
        return (raw or "").strip().strip('"')
    except Exception as exc:
        logger.debug("compose_self_reflection failed: %s", exc)
        return ""


async def grow_identity_from_journal(
    db: AsyncSession,
    user_id: str,
    *,
    dispatch_llm: Callable[[str, str], Awaitable[str]],
    journal=None,
    identity=None,
    min_deeds: int = 3,
    look_back: int = 30,
) -> str | None:
    """Read the recent journal, fold the defining deeds into the self-narrative.
    Returns the appended reflection, or None when there is too little to learn
    from. Best-effort: never raises into the caller's tick."""
    if journal is None:
        from agent.will.journal import WillJournalWriter
        journal = WillJournalWriter()
    if identity is None:
        from agent.cognition.will.identity import identity_system as identity

    try:
        entries = await journal.recent(db, user_id, n=look_back)
    except Exception as exc:
        logger.debug("grow_identity journal read failed: %s", exc)
        return None

    deeds = _select_deeds(entries)
    if len(deeds) < min_deeds:
        return None

    reflection = await compose_self_reflection(deeds, dispatch_llm=dispatch_llm)
    if not reflection:
        return None

    identity.append_moment(reflection, importance=0.6)
    return reflection
