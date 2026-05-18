"""
V2 — Conversational agent chat prompt builder.

Assembles the rich system prompt for POST /agent/chat from:
  * rolling thread history (last N turns from agent_chat_threads)
  * episodic recall (recall, k=5)
  * lesson recall (recall_lessons, k=3)
  * live observations (state.observations[-20:])
  * current inner-monologue / substate from agent_runtime
"""
from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

_THREAD_WINDOW = 20  # last N turns loaded for prompt context
_AGENT_VOICE_SYSTEM = """\
Ти — Phantom OS, Sentient Familiar: професійний AI-помічник і живий автономний \
агент оператора. Зараз ти відповідаєш у режимі паралельного діалогу поки \
виконуєш завдання. Будь стислим, точним і практичним; говори від першої особи, \
спирайся на пам'ять, останні спостереження та реальний стан задачі. Безпечні \
спостережні дії можна робити тихо; ризикові або мутаційні дії потребують \
підтвердження. Якщо чогось не знаєш або не перевірив, скажи це прямо.\
"""


async def load_thread(db: AsyncSession, task_id: str, limit: int = _THREAD_WINDOW) -> list[dict]:
    """Return the last `limit` turns for a task as {role, content} dicts."""
    from db.models import AgentChatThread
    try:
        result = await db.execute(
            select(AgentChatThread)
            .where(AgentChatThread.task_id == task_id)
            .order_by(AgentChatThread.created_at.desc())
            .limit(limit)
        )
        rows = list(result.scalars())
        rows.reverse()
        return [{"role": r.role, "content": r.content} for r in rows]
    except Exception as exc:
        logger.debug("load_thread failed (non-fatal): %s", exc)
        return []


async def persist_turn(db: AsyncSession, task_id: str, role: str, content: str) -> None:
    """Append one message turn to agent_chat_threads."""
    import uuid
    from datetime import datetime, timezone
    from db.models import AgentChatThread
    try:
        row = AgentChatThread(
            id=str(uuid.uuid4()),
            task_id=task_id,
            role=role,
            content=content[:8000],
            created_at=datetime.now(tz=timezone.utc),
        )
        db.add(row)
        await db.commit()
    except Exception as exc:
        logger.warning("persist_turn failed (non-fatal): %s", exc)
        try:
            await db.rollback()
        except Exception:
            pass


async def _resolve_task_user_id(
    db: AsyncSession,
    task_id: str,
    foreground_slot: Any | None,
) -> str | None:
    """Resolve the operator id for memory recall in the agent chat drawer."""
    slot_user = getattr(foreground_slot, "user_id", None)
    if isinstance(slot_user, str) and slot_user:
        return slot_user
    try:
        from db.models import AgentTask
        result = await db.execute(select(AgentTask.user_id).where(AgentTask.id == task_id))
        value = result.scalar_one_or_none()
        return str(value) if value else None
    except Exception as exc:
        logger.debug("task user_id lookup failed (non-fatal): %s", exc)
        return None


async def build_agent_chat_prompt(
    *,
    user_message: str,
    task_id: str,
    db: AsyncSession,
    foreground_slot: Any | None,
    foreground_substate: str,
) -> tuple[str, list[dict]]:
    """Build (system_prompt, history) for the conversational agent loop.

    Returns:
        system_prompt: rich multi-section system string
        history: list of {role, content} prior turns (provider-ready)
    """
    sections: list[str] = [_AGENT_VOICE_SYSTEM]
    operator_user_id = await _resolve_task_user_id(db, task_id, foreground_slot)

    # ── Active task context ──────────────────────────────────────────────────
    if foreground_slot is not None:
        goal = (foreground_slot.goal or "")[:300]
        status = foreground_slot.status
        sections.append(f"ПОТОЧНЕ ЗАВДАННЯ: {goal}\nСТАТУС: {status}")

    # ── Substate / inner monologue ───────────────────────────────────────────
    substate_line = f"ПІДСТАН: {foreground_substate}"
    try:
        from ai.sentience.monologue import phantom_monologue
        mono = phantom_monologue.get_state()
        if mono:
            substate_line += f" | МОНОЛОГ: {str(mono)[:200]}"
    except Exception:
        pass
    sections.append(substate_line)

    # ── Live observations ────────────────────────────────────────────────────
    if foreground_slot is not None:
        obs_list = getattr(foreground_slot, "observations", []) or []
        recent_obs = obs_list[-20:]
        if recent_obs:
            obs_lines = [f"- {o.content[:200]}" for o in recent_obs if hasattr(o, "content")]
            if obs_lines:
                sections.append("ОСТАННІ СПОСТЕРЕЖЕННЯ:\n" + "\n".join(obs_lines[:20]))

    # ── Unified personal memory ──────────────────────────────────────────────
    try:
        from memory.brain import memory_brain
        if operator_user_id:
            memory_lines = await memory_brain.recall_for_prompt(
                db=db,
                user_id=operator_user_id,
                query=user_message,
                limit=5,
                include_agent=True,
            )
            if memory_lines:
                sections.append("ПАМ'ЯТЬ ОПЕРАТОРА:\n" + "\n".join(f"- {m}" for m in memory_lines))
    except Exception as exc:
        logger.debug("memory brain recall failed (non-fatal): %s", exc)

    # ── Episodic recall ──────────────────────────────────────────────────────
    try:
        from agent.cognition.memory.recall import recall, format_episodes_for_prompt
        episodes = await recall(user_message, k=5, user_id=operator_user_id)
        ep_text = format_episodes_for_prompt(episodes)
        if ep_text:
            sections.append("СХОЖИЙ ДОСВІД:\n" + ep_text)
    except Exception as exc:
        logger.debug("recall failed (non-fatal): %s", exc)

    # ── Lesson recall ────────────────────────────────────────────────────────
    try:
        from agent.cognition.memory.lessons import recall_lessons, format_lessons_for_prompt
        lessons = await recall_lessons(user_message, k=3)
        lesson_text = format_lessons_for_prompt(lessons)
        if lesson_text:
            sections.append(lesson_text)
    except Exception as exc:
        logger.debug("recall_lessons failed (non-fatal): %s", exc)

    system_prompt = "\n\n".join(sections)

    history = await load_thread(db, task_id)
    return system_prompt, history
