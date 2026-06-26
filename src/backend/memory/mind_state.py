"""
PHANTOM Mind State — compressed "what I'm thinking between turns".
Stored in DB, always injected first into system prompt.
Updated asynchronously after each chat turn.
"""
from __future__ import annotations

import json
import logging
import time as _time
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

_MIND_STATE_CACHE: dict[str, tuple[dict, float]] = {}  # user_id → (state_dict, expires_at)
_CACHE_TTL_S = 120.0
_LAST_UPDATE_AT: dict[str, float] = {}  # user_id → monotonic timestamp of last update
_UPDATE_DEBOUNCE_S = 30.0  # skip update if called again within 30s

_DEFAULT_STATE: dict[str, Any] = {
    "focus": "",
    "open_loops": [],
    "emotional_thread": "neutral",
    "last_insight": "",
}


async def get_mind_state(db: AsyncSession, user_id: str) -> dict[str, Any]:
    from db.models import PhantomMindState
    cached = _MIND_STATE_CACHE.get(user_id)
    if cached is not None:
        state_dict, expires_at = cached
        if expires_at > _time.monotonic():
            return dict(state_dict)
    try:
        result = await db.execute(
            select(PhantomMindState).where(PhantomMindState.user_id == user_id)
        )
        row = result.scalar_one_or_none()
        if row is None:
            return dict(_DEFAULT_STATE)
        data = json.loads(row.state_json or "{}")
        state = {**_DEFAULT_STATE, **data}
        _MIND_STATE_CACHE[user_id] = (state, _time.monotonic() + _CACHE_TTL_S)
        return state
    except Exception as exc:
        logger.debug("get_mind_state failed: %s", exc)
        return dict(_DEFAULT_STATE)


def format_for_prompt(state: dict[str, Any]) -> str:
    open_loops = state.get("open_loops") or []
    loops_str = " | ".join(str(l) for l in open_loops[:5]) if open_loops else "—"
    focus = state.get("focus") or ""
    thread = state.get("emotional_thread") or "neutral"
    insight = state.get("last_insight") or ""
    if not any([focus, insight, open_loops]):
        return ""
    lines = ["[PHANTOM INTERNAL STATE]"]
    if focus:
        lines.append(f"Focus: {focus}")
    lines.append(f"Open: {loops_str}")
    lines.append(f"Mood thread: {thread}")
    if insight:
        lines.append(f"Last insight: {insight}")
    return "\n".join(lines)


async def update_mind_state(
    db: AsyncSession,
    user_id: str,
    last_user_msg: str,
    last_ai_response: str,
    session_history: list[dict[str, Any]],
) -> None:
    now = _time.monotonic()
    last = _LAST_UPDATE_AT.get(user_id, 0.0)
    if now - last < _UPDATE_DEBOUNCE_S:
        return
    _LAST_UPDATE_AT[user_id] = now

    from config import config
    from ai.hub import ai_hub
    from db.models import PhantomMindState

    recent_turns = session_history[-6:] if len(session_history) > 6 else session_history
    history_text = "\n".join(
        f"{m.get('role', '?').upper()}: {str(m.get('content', ''))[:200]}"
        for m in recent_turns
    )

    synthesis_prompt = (
        'Extract PHANTOM mind-state JSON from this conversation.\n'
        'Return ONLY a JSON object with exactly these fields:\n'
        '{"focus": "1 sentence: what Phantom is focused on re this user",\n'
        ' "open_loops": ["unresolved thread 1", "thread 2"],\n'
        ' "emotional_thread": "tone/mood in 3 words",\n'
        ' "last_insight": "1 sentence: notable observation about user"}\n'
        f'\nConversation:\n{history_text}\n'
        f'Last user: {last_user_msg[:300]}\n'
        f'Last AI: {last_ai_response[:300]}'
    )

    try:
        resp = await ai_hub.dispatch(
            "chat",
            {
                "user_message": synthesis_prompt,
                "system_prompt": "Return only valid JSON. No prose.",
                "history": [],
                "user_id": user_id,
                "model_override": config.ai_background_model,
            },
            provider_hint=config.ai_primary_provider,
        )
        raw = (resp.content or "").strip()
        if raw.startswith("```"):
            parts = raw.split("```")
            raw = parts[1] if len(parts) > 1 else raw
            if raw.startswith("json"):
                raw = raw[4:].strip()
        new_state: dict[str, Any] = json.loads(raw)
        state_dict: dict[str, Any] = {
            "focus": str(new_state.get("focus", ""))[:200],
            "open_loops": [str(l)[:100] for l in (new_state.get("open_loops") or [])[:5]],
            "emotional_thread": str(new_state.get("emotional_thread", "neutral"))[:60],
            "last_insight": str(new_state.get("last_insight", ""))[:200],
        }
    except Exception as exc:
        logger.debug("update_mind_state synthesis failed: %s", exc)
        return

    try:
        from db.database import get_session
        async with get_session() as bg_db:
            result = await bg_db.execute(
                select(PhantomMindState).where(PhantomMindState.user_id == user_id)
            )
            row = result.scalar_one_or_none()
            if row is None:
                row = PhantomMindState(
                    user_id=user_id,
                    state_json=json.dumps(state_dict),
                    updated_at=datetime.now(tz=timezone.utc),
                )
                bg_db.add(row)
            else:
                row.state_json = json.dumps(state_dict)
                row.updated_at = datetime.now(tz=timezone.utc)
            await bg_db.commit()
            _MIND_STATE_CACHE[user_id] = (state_dict, _time.monotonic() + _CACHE_TTL_S)
    except Exception as exc:
        logger.debug("update_mind_state db write failed: %s", exc)
