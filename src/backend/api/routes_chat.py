"""
Chat routes — messages, sessions, AI response pipeline.
Phase 3: full implementation with AI provider, memory, streaming.
"""
from __future__ import annotations

import json
import logging
import time
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from config import config
from db.database import get_db
from db.models import ChatMessage, ChatSession
from security.auth import get_current_user, require_auth
from security.jwt_manager import TokenPayload
from ai.provider import ai_router

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["chat"])


# ── Schemas ────────────────────────────────────────────────────────────────────

class SendMessageRequest(BaseModel):
    content: str
    input_method: str = "text"  # voice | text | encoder
    session_id: str | None = None


# ── Helpers ────────────────────────────────────────────────────────────────────

def _serialize_message(msg: ChatMessage) -> dict[str, Any]:
    meta = {}
    attachments = []
    try:
        meta = json.loads(msg.metadata_json or "{}")
    except Exception:
        pass
    try:
        attachments = json.loads(msg.attachments_json or "[]")
    except Exception:
        pass
    return {
        "id": msg.id,
        "session_id": msg.session_id,
        "user_id": msg.user_id,
        "role": msg.role,
        "content": msg.content,
        "response_form": msg.response_form,
        "metadata": meta,
        "attachments": attachments,
        "created_at": msg.created_at.isoformat(),
    }


def _serialize_session(session: ChatSession) -> dict[str, Any]:
    state_history = []
    try:
        state_history = json.loads(session.state_history_json or "[]")
    except Exception:
        pass
    return {
        "id": session.id,
        "user_id": session.user_id,
        "started_at": session.started_at.isoformat(),
        "ended_at": session.ended_at.isoformat() if session.ended_at else None,
        "message_count": session.message_count,
        "summary": session.summary,
        "state_history": state_history,
    }


async def _get_or_create_session(
    db: AsyncSession,
    user_id: str,
    session_id: str | None,
) -> ChatSession:
    if session_id:
        result = await db.execute(
            select(ChatSession).where(
                ChatSession.id == session_id,
                ChatSession.user_id == user_id,
            )
        )
        session = result.scalar_one_or_none()
        if session:
            return session
    # Create a new session
    session = ChatSession(
        id=str(uuid.uuid4()),
        user_id=user_id,
        state_history_json="[]",
    )
    db.add(session)
    await db.flush()
    return session


async def _build_ai_response(
    user_message: str,
    session_id: str,
    user: Any,
    db: AsyncSession,
) -> tuple[str, str, list[dict], str, int]:
    """
    Run the full AI pipeline:
      1. Retrieve memory hints (ChromaDB)
      2. Build system prompt
      3. Get session history
      4. Generate AI response (primary → fallback)
      5. Post: extract/store facts, update behavioral model
    Returns (content, response_form, attachments, provider, tokens_used).
    """
    from ai.prompt_builder import build_system_prompt, build_history_messages
    from memory.session_memory import session_memory
    from memory.strategic_memory import retrieve_relevant, extract_and_store_facts
    from memory.user_model import (
        get_behavioral_model, save_behavioral_model,
        update_trust, update_vocabulary, update_language_stats,
        Interaction,
    )
    from core.context_engine import context_engine

    snapshot = context_engine.get_snapshot()
    behavioral_model = await get_behavioral_model(db, user.id)

    # 1. Retrieve memory hints
    hints = await retrieve_relevant(
        user_id=user.id,
        query=user_message,
        top_k=config.memory_top_k,
    )
    context_engine.set_memory_hints(hints)
    snapshot["memory_hints"] = hints

    # 2. Build user dict for prompt builder
    user_dict: dict[str, Any] = {
        "username": user.username,
        "role": user.role,
        "preferences": json.loads(user.preferences_json or "{}"),
    }

    # 3. Build system prompt
    system_prompt = build_system_prompt(
        snapshot=snapshot,
        user_dict=user_dict,
        behavioral_model=behavioral_model.to_dict(),
        memory_hints=hints,
    )

    # 4. Get history from session memory (already in RAM from this session)
    history = session_memory.get_history_dicts(session_id, max_turns=20)

    # 5. Generate AI response
    ai_response = await ai_router.generate(
        user_message=user_message,
        system_prompt=system_prompt,
        history=history,
    )

    # 6. Post-turn: vocabulary + language stats update
    update_vocabulary(behavioral_model, user_message)
    update_language_stats(behavioral_model, user_message)
    interaction = Interaction(
        followed_advice=False,
        cancelled_or_ignored=False,
    )
    update_trust(behavioral_model, interaction)
    await save_behavioral_model(db, user.id, behavioral_model)

    # 7. Async background: extract facts from new assistant message
    try:
        combined_text = f"{user_message} {ai_response.content}"
        await extract_and_store_facts(
            user_id=user.id,
            session_id=session_id,
            conversation_summary=combined_text,
            db=db,
        )
    except Exception as exc:
        logger.debug("Fact extraction failed (non-critical): %s", exc)

    return (
        ai_response.content,
        ai_response.response_form,
        ai_response.attachments,
        ai_response.provider,
        ai_response.tokens_used,
    )


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.post("/message")
async def send_message(
    req: SendMessageRequest,
    token_data: TokenPayload = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> dict:
    from security.auth import get_current_user as _get_user
    from core.context_engine import context_engine

    # Resolve user
    from sqlalchemy import select as _select
    from db.models import User as _User
    result = await db.execute(_select(_User).where(_User.id == token_data.user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Get or create session
    session = await _get_or_create_session(db, user.id, req.session_id)

    # Record user message in session RAM cache
    from memory.session_memory import session_memory
    session_memory.add_message(session.id, "user", req.content)

    # Store user message in DB
    user_msg = ChatMessage(
        id=str(uuid.uuid4()),
        session_id=session.id,
        user_id=user.id,
        role="user",
        content=req.content,
        response_form="text",
        metadata_json=json.dumps({
            "input_method": req.input_method,
            "state_at_time": context_engine.get_snapshot().get("system", {}).get("state", "SHADOW"),
        }),
        attachments_json="[]",
    )
    db.add(user_msg)
    await db.flush()

    # Record interaction in context engine
    context_engine.record_interaction()

    t_start = time.monotonic()

    # Generate AI response
    try:
        content, response_form, attachments, provider, tokens_used = \
            await _build_ai_response(req.content, session.id, user, db)
    except Exception as exc:
        logger.error("AI generation failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"AI unavailable: {exc}",
        )

    latency_ms = int((time.monotonic() - t_start) * 1000)
    snap = context_engine.get_snapshot()

    # Store assistant message in DB
    tone_desc = ""
    try:
        from ai.personality import calculate_tone
        from memory.user_model import get_behavioral_model as _gbm
        # Reload after _build_ai_response may have updated the model
        bmodel_fresh = await _gbm(db, user.id)
        tone_desc = calculate_tone(snap, bmodel_fresh.to_dict()).description
    except Exception:
        pass

    assistant_msg = ChatMessage(
        id=str(uuid.uuid4()),
        session_id=session.id,
        user_id=user.id,
        role="assistant",
        content=content,
        response_form=response_form,
        metadata_json=json.dumps({
            "state_at_time": snap.get("system", {}).get("state", "SHADOW"),
            "context_snapshot_id": str(snap.get("timestamp", "")),
            "ai_provider": provider,
            "latency_ms": latency_ms,
            "tokens_used": tokens_used,
            "tone": tone_desc,
            "input_method": req.input_method,
        }),
        attachments_json=json.dumps(attachments),
    )
    db.add(assistant_msg)

    # Update session message count
    session.message_count += 2  # type: ignore[operator]
    await db.flush()

    # Cache assistant response in session memory
    session_memory.add_message(
        session.id, "assistant", content,
        response_form=response_form,
        attachments=attachments,
    )

    # Create TemporalAnchor — "what was happening at this moment"
    try:
        from db.models import TemporalAnchor
        import re as _re
        # Derive mood from tone description
        mood = tone_desc or "neutral"
        anchor_summary = f"Розмова: «{req.content[:80]}»"
        anchor = TemporalAnchor(
            id=str(uuid.uuid4()),
            user_id=user.id,
            lat=snap.get("where", {}).get("lat"),
            lon=snap.get("where", {}).get("lon"),
            place_name=snap.get("where", {}).get("place_name"),
            activity_summary=anchor_summary,
            state=snap.get("system", {}).get("state", "SHADOW"),
            mood=mood,
        )
        db.add(anchor)
        await db.flush()
    except Exception as exc:
        logger.debug("TemporalAnchor creation failed (non-critical): %s", exc)

    # Push to WebSocket chat channel (streaming is separate; this is the final message)
    try:
        from api.websocket_hub import hub
        await hub.broadcast("chat", "message", {
            "message": _serialize_message(assistant_msg),
            "session_id": session.id,
        })
    except Exception:
        pass

    return {
        "message": _serialize_message(assistant_msg),
        "session_id": session.id,
    }


@router.get("/sessions")
async def list_sessions(
    limit: int = 20,
    offset: int = 0,
    token_data: TokenPayload = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> dict:
    stmt = (
        select(ChatSession)
        .where(ChatSession.user_id == token_data.user_id)
        .order_by(ChatSession.started_at.desc())
        .limit(limit)
        .offset(offset)
    )
    result = await db.execute(stmt)
    sessions = result.scalars().all()

    total_result = await db.execute(
        select(func.count(ChatSession.id)).where(ChatSession.user_id == token_data.user_id)
    )
    total = total_result.scalar_one() or 0

    return {
        "sessions": [_serialize_session(s) for s in sessions],
        "total": total,
    }


@router.get("/sessions/{session_id}/messages")
async def get_messages(
    session_id: str,
    token_data: TokenPayload = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> dict:
    # Verify session belongs to user
    result = await db.execute(
        select(ChatSession).where(
            ChatSession.id == session_id,
            ChatSession.user_id == token_data.user_id,
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Session not found")

    msgs_result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at.asc())
    )
    messages = msgs_result.scalars().all()
    return {"messages": [_serialize_message(m) for m in messages]}


@router.delete("/sessions/{session_id}")
async def delete_session(
    session_id: str,
    token_data: TokenPayload = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> dict:
    result = await db.execute(
        select(ChatSession).where(
            ChatSession.id == session_id,
            ChatSession.user_id == token_data.user_id,
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    await db.delete(session)
    await db.flush()

    # Clear from RAM cache
    from memory.session_memory import session_memory
    session_memory.clear_session(session_id)

    return {"ok": True}
