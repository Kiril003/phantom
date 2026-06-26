"""
PHANTOM NARRATIVE — a living, continuously updated story about the user.

Unlike raw facts or memory hints, this is interpretive: what's happening in
this person's life, what patterns Phantom has noticed, what matters to them now.
Updated every 10 chat turns or at session end. Persists in DB.
Max 400 words. Always human and specific, never generic.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import config

logger = logging.getLogger(__name__)


async def get_narrative(db: AsyncSession, user_id: str) -> str:
    """Load current narrative text for a user. Returns empty string if none."""
    from db.models import PhantomNarrative
    result = await db.execute(
        select(PhantomNarrative).where(PhantomNarrative.user_id == user_id)
    )
    row = result.scalar_one_or_none()
    return (row.narrative_text or "") if row else ""


async def update_narrative_if_due(
    db: AsyncSession,
    user_id: str,
    session_history: list[dict],
    mind_state: dict,
    memory_hints: list[str],
    every_n_turns: int = 10,
) -> bool:
    """Increment turn counter; synthesize and persist narrative every N turns.

    Returns True when the narrative was regenerated.
    Uses a separate DB session so it can be safely called from background tasks.
    """
    from db.models import PhantomNarrative

    result = await db.execute(
        select(PhantomNarrative).where(PhantomNarrative.user_id == user_id)
    )
    row = result.scalar_one_or_none()

    if row is None:
        row = PhantomNarrative(user_id=user_id, turn_count=0, narrative_text="")
        db.add(row)
        await db.flush()

    row.turn_count = (row.turn_count or 0) + 1

    if row.turn_count % every_n_turns != 0:
        await db.commit()
        return False

    try:
        text = await _synthesize_narrative(
            session_history=session_history,
            mind_state=mind_state,
            memory_hints=memory_hints,
        )
        if text:
            row.narrative_text = text
            row.updated_at = datetime.now(tz=timezone.utc)
    except Exception as exc:
        logger.debug("narrative synthesis failed (non-fatal): %s", exc)

    await db.commit()
    return True


async def _synthesize_narrative(
    *,
    session_history: list[dict],
    mind_state: dict,
    memory_hints: list[str],
) -> str:
    """Call the background model to synthesize a 3-paragraph narrative."""
    from ai.provider import ai_router

    excerpt_turns = session_history[-20:] if len(session_history) > 20 else session_history
    excerpt = "\n".join(
        f"{m.get('role', '?').upper()}: {str(m.get('content', ''))[:200]}"
        for m in excerpt_turns
    )

    hints_text = "\n".join(f"- {h}" for h in (memory_hints or [])[:10])
    mind_text = (
        f"focus={mind_state.get('focus', '')}, "
        f"open_loops={mind_state.get('open_loops', [])}, "
        f"emotional_thread={mind_state.get('emotional_thread', '')}"
    ) if mind_state else "(no mind state)"

    prompt = (
        "Given these conversation excerpts, current mind state, and key memories — "
        "write a 3-paragraph living narrative about who this person is RIGHT NOW.\n\n"
        "Paragraph 1: who they are and what they're focused on.\n"
        "Paragraph 2: patterns you've noticed.\n"
        "Paragraph 3: what they might need next.\n\n"
        "Be specific. Use 'you' voice (talking to Phantom about the user). Max 300 words.\n\n"
        f"CONVERSATION EXCERPT:\n{excerpt or '(none)'}\n\n"
        f"MIND STATE: {mind_text}\n\n"
        f"KEY MEMORIES:\n{hints_text or '(none)'}"
    )

    model = config.ai_background_model
    response = await ai_router.generate_raw(
        system_prompt=(
            "Ти аналітик, що пише живий наратив про користувача для AI-компаньйона. "
            "Відповідай тільки текстом, без markdown."
        ),
        user_message=prompt,
        model=model,
        max_output_tokens=400,
        temperature=0.7,
    )
    return (response or "").strip()[:1800]


def format_narrative_for_prompt(narrative: str) -> str:
    """Format as compact prompt block. Returns empty string if narrative is empty."""
    if not narrative:
        return ""
    return f"\n[LIVING NARRATIVE — who this user is right now]\n{narrative[:600]}\n"


__all__ = ["get_narrative", "update_narrative_if_due", "format_narrative_for_prompt"]
