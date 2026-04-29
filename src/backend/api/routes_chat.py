"""
Chat routes — messages, sessions, AI response pipeline.
Phase 3: full implementation with AI provider, memory.
Phase 5: adds WebSocket stream broadcasting (chat channel) and WS-initiated
messages for the ChatWindow component.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from config import config
from db.database import get_db, get_session
from db.models import ChatMessage, ChatSession
from security.auth import get_current_user, require_auth
from security.jwt_manager import TokenPayload
from ai.provider import ai_router

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["chat"])


# ── Schemas ────────────────────────────────────────────────────────────────────

_ALLOWED_INPUT_METHODS = ("text", "voice", "encoder")
_ALLOWED_VOICE_SOURCES = ("wake", "continuation")


class SendMessageRequest(BaseModel):
    content: str
    input_method: str = "text"  # voice | text | encoder
    session_id: str | None = None
    # Phase 11b — always-on voice pipeline. Populated only when
    # input_method == "voice". voice_source distinguishes the first
    # post-wake utterance from subsequent utterances in the cooldown
    # continuation window so we can telemeter / debug which gate fired.
    voice_source: str | None = None
    voice_confidence: float | None = None

    @field_validator("input_method")
    @classmethod
    def _validate_input_method(cls, v: str) -> str:
        if v not in _ALLOWED_INPUT_METHODS:
            raise ValueError(
                f"input_method must be one of {_ALLOWED_INPUT_METHODS}"
            )
        return v

    @field_validator("voice_source")
    @classmethod
    def _validate_voice_source(cls, v: str | None) -> str | None:
        if v is None:
            return v
        if v not in _ALLOWED_VOICE_SOURCES:
            raise ValueError(
                f"voice_source must be one of {_ALLOWED_VOICE_SOURCES}"
            )
        return v


# ── Helpers ────────────────────────────────────────────────────────────────────

_PROMPT_SECTION_MARKERS: tuple[tuple[str, str], ...] = (
    ("identity", "PHANTOM"),
    ("state", "CURRENT STATE:"),
    ("tone", "TONE:"),
    ("user", "USER:"),
    ("memory", "RELEVANT MEMORY:"),
    ("recent_places", "RECENT PLACES"),
    ("nearby", "NEARBY"),
    ("emotion", "INNER STATE:"),
    ("body", "BODY:"),
    ("env", "ENV:"),
    ("system_meta", "SYSTEM:"),
)


def _detect_prompt_sections(prompt: str) -> str:
    """Phase 16 (audit-2026-04-28 step 4) — derive section-flag string from
    a built system prompt. Used for ops correlation: "responses got vague
    after we stopped including RECENT PLACES" is observable from the log
    table without re-running the prompt builder.
    """
    if not prompt:
        return ""
    return ",".join(name for name, marker in _PROMPT_SECTION_MARKERS if marker in prompt)


def _serialize_message(msg: ChatMessage) -> dict[str, Any]:
    # Audit-2026-04-28 F-66: previously these blocks swallowed JSON parse
    # errors silently, masking corrupted rows as empty bubbles. Log at
    # WARNING with the offending message id so future schema bugs are
    # observable instead of degrading the UI invisibly.
    meta: dict[str, Any] = {}
    attachments: list[Any] = []
    try:
        meta = json.loads(msg.metadata_json or "{}")
    except Exception as exc:
        logger.warning(
            "chat.serialize: metadata_json corrupt for msg=%s — %s",
            msg.id, exc,
        )
    try:
        attachments = json.loads(msg.attachments_json or "[]")
    except Exception as exc:
        logger.warning(
            "chat.serialize: attachments_json corrupt for msg=%s — %s",
            msg.id, exc,
        )
    # Day-4 W-1 (ADR-CS-002): the scene envelope rides as a single
    # attachment of `type: 'scene'`. Promote it to a top-level
    # `message.scene` key so the frontend ChatScene composer (W-2)
    # consumes the contract from `src/shared/types/chat.ts`. The
    # underlying attachment is stripped from the published list so
    # legacy renderers don't double-handle it. Absent → no `scene`
    # key on the wire (back-compat invariant ADR-CS-002 §117).
    scene: dict[str, Any] | None = None
    surfaced_attachments: list[Any] = []
    for att in attachments:
        if (
            isinstance(att, dict)
            and att.get("type") == "scene"
            and isinstance(att.get("data"), dict)
        ):
            # ADR-CS-002: Day-4 closed contract — one scene per
            # message. Subsequent scene attachments are silently
            # consumed (NOT re-classified as legacy attachments,
            # which would crash the frontend's typed renderer).
            if scene is None:
                scene = att["data"]
            continue
        surfaced_attachments.append(att)
    out: dict[str, Any] = {
        "id": msg.id,
        "session_id": msg.session_id,
        "user_id": msg.user_id,
        "role": msg.role,
        "content": msg.content,
        "response_form": msg.response_form,
        "metadata": meta,
        "attachments": surfaced_attachments,
        "created_at": msg.created_at.isoformat(),
    }
    if scene is not None:
        out["scene"] = scene
    return out


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
    from ai.prompt_builder import (
        build_system_prompt,
        build_history_messages,
        fetch_recent_places,
    )
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

    # 1b. Recent places — Phase 9.4c-qw fix #2 ("де я був вчора?")
    recent_places = await fetch_recent_places(db, user.id, hours=24, limit=5)

    # 1c. Emotion — Phase 9.4c-qw fix #5. Best-effort: only populated
    # when an agent task currently owns the foreground slot. Mirrors the
    # gating already used by the 9.3a self-model hook above.
    emotion_dict: dict | None = None
    try:
        from agent.runtime import agent_runtime  # noqa: PLC0415
        slot = agent_runtime.foreground_slot
        if slot is not None and slot.self_model is not None:
            emo = getattr(slot.self_model, "emotion", None)
            if emo is not None:
                emotion_dict = {
                    "focus": float(emo.focus),
                    "curiosity": float(emo.curiosity),
                    "concern": float(emo.concern),
                    "fatigue": float(emo.fatigue),
                }
    except Exception as exc:
        logger.debug("emotion fetch failed (non-critical): %s", exc)

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
        recent_places=recent_places,
        emotion=emotion_dict,
    )

    # 4. Get history from session memory (already in RAM from this session)
    history = session_memory.get_history_dicts(
        session_id, max_turns=config.chat_max_session_history
    )

    # 5. Generate AI response
    #
    # Day-3 Q-2 (audit-2026-04-30 Phase 17b): when the operator opts
    # into chat tool-use, route through `ai.chat_pipeline.run` for a
    # bounded tool-use turn (read-only catalog only, nonced envelope,
    # output_safety sanitize, wall-clock + depth caps). Default flag
    # stays False — operators flip it on per deploy after reading
    # docs/phases/PHASE_17_CHAT_TOOLS.md (D2-I2 multi-tenant
    # invariant gates this).
    # `is True` (not truthy) so legacy tests that patch `config` with a
    # MagicMock — whose default attribute access returns a truthy Mock
    # — don't accidentally route through chat_pipeline. The real
    # PhantomConfig field is `bool = False`; production deploys flip it
    # to `True` explicitly via Settings UI.
    if config.chat_tools_enabled is True:
        from ai.chat_pipeline import run as chat_pipeline_run
        ai_response = await chat_pipeline_run(
            user_message=user_message,
            system_prompt=system_prompt,
            history=history,
            user_id=user.id,
            db=db,
        )
    else:
        ai_response = await ai_router.generate(
            user_message=user_message,
            system_prompt=system_prompt,
            history=history,
            user_id=user.id,
        )

    # 5b. Phase 16 (audit-2026-04-28 step 4) — best-effort prompt
    # observability. Off by default; when enabled, write one row to
    # ai_tool_use_log with the truncated system prompt + AI response +
    # which sections fired. Truncation honours
    # chat_prompt_excerpt_max_chars so we never persist full content
    # against the operator's privacy expectation.
    if config.chat_prompt_logging_enabled:
        try:
            from ai.tool_use_audit import write_log as _write_chat_log
            max_chars = max(0, int(config.chat_prompt_excerpt_max_chars))
            await _write_chat_log(
                task_id=None,
                step_idx=None,
                provider=ai_response.provider or "unknown",
                model="",
                tool_name=f"chat:{ai_response.response_form}",
                success=True,
                error_kind=None,
                error_message=None,
                elapsed_ms=0,
                retry_count=1,
                user_id=user.id,
                prompt_excerpt=(system_prompt or "")[:max_chars] if max_chars else None,
                response_excerpt=(ai_response.content or "")[:max_chars] if max_chars else None,
                prompt_sections=_detect_prompt_sections(system_prompt or ""),
            )
        except Exception as exc:
            logger.debug("chat prompt logging failed (non-critical): %s", exc)

    # Phase 18 E-5 — chat counters surface in /metrics.
    try:
        from observability import chat_messages_total
        chat_messages_total.inc(role="user")
        chat_messages_total.inc(role="assistant")
    except Exception:  # noqa: BLE001 — observability never blocks chat
        pass

    # 6. Post-turn: vocabulary + language stats update
    update_vocabulary(behavioral_model, user_message)
    update_language_stats(behavioral_model, user_message)
    interaction = Interaction(
        followed_advice=False,
        cancelled_or_ignored=False,
    )
    update_trust(behavioral_model, interaction)
    await save_behavioral_model(db, user.id, behavioral_model)

    # 7. Async background: extract facts from this turn.
    #
    # Day-2 D2-T2 (audit-2026-04-29): only the user's own utterance is
    # persisted into the memory layer. The assistant's response can
    # legitimately quote a tool-result verbatim (locationhistory rows,
    # recall_memory hits, sensor snapshot fields), and persisting that
    # back into ChromaDB creates a self-poisoning loop — the next turn's
    # retrieve_relevant() pulls back the AI's own paraphrase as a "fact"
    # and the LLM treats it as ground truth. Until the D2-I1 output-
    # safety classifier lands, the safe default is "store user words
    # only". Operator-stated facts are recoverable; tool-echo facts are
    # not separable from genuine assistant inferences without the
    # classifier.
    try:
        await extract_and_store_facts(
            user_id=user.id,
            session_id=session_id,
            conversation_summary=user_message,
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
            **(
                {
                    "voice_source": req.voice_source,
                    "voice_confidence": req.voice_confidence,
                }
                if req.input_method == "voice"
                else {}
            ),
        }),
        attachments_json="[]",
    )
    db.add(user_msg)
    await db.flush()
    # Phase 10 — commit the user-message write now so SQLite drops the write
    # lock BEFORE we call ai_router.generate(), whose data-tool handlers open
    # their own sessions. Otherwise tool INSERTs block on the chat session's
    # open transaction and SQLite deadlocks inside one request.
    await db.commit()

    # Record interaction in context engine
    context_engine.record_interaction()

    # Phase 9.3a — heuristic concern extraction + relationship tracking.
    # Only touches SelfModel when an agent task is currently active so an
    # idle chat doesn't carry residual state between tasks. Best-effort:
    # any failure here must NOT block chat reply.
    try:
        from agent.runtime import agent_runtime
        from agent.self_model import (
            maybe_add_concern_from_user_text,
            note_interaction,
        )
        if agent_runtime.foreground_slot is not None:
            sm = agent_runtime.foreground_slot.self_model
            note_interaction(sm, user.id)
            maybe_add_concern_from_user_text(sm, req.content)
    except Exception as exc:
        logger.debug("9.3a chat self-model hook failed: %s", exc)
    # Phase 9.3b — tell the proactive loop a real user message landed so
    # it can reset its silence clock. Independent of whether a task is
    # active — proactive respects "no recent chat" across tasks.
    try:
        from agent.proactive import get_loop
        ploop = get_loop()
        if ploop is not None:
            ploop.note_user_interaction()
    except Exception as exc:
        logger.debug("9.3b proactive note_user_interaction failed: %s", exc)

    # Phase 9.4a — if PHANTOM previously asked "Чи хочеш щоб я X? (так/ні)"
    # and the user's reply is an affirmative, fire that pending action on
    # the background track before generating the AI reply. Non-affirmative
    # replies clear the pending intent silently so the chat continues
    # normally (we don't want to hold the user hostage to a confirmation
    # they've implicitly abandoned).
    pending_fired_task_id: str | None = None
    try:
        from agent.proactive import get_loop as _get_loop_p94a
        ploop4a = _get_loop_p94a()
        if ploop4a is not None and ploop4a.has_pending_action():
            pending_fired_task_id = await ploop4a.resolve_pending_action(req.content)
    except Exception as exc:
        logger.debug("9.4a pending-action resolve failed: %s", exc)

    # Phase 9.4b — memory-to-geo bridge. Extract + geocode place mentions,
    # pick up "я в Одесі" style self-location statements, emit REGION_CHANGED
    # triggers. Entirely best-effort.
    try:
        from memory.geo_integration import process_chat_message_for_places
        await process_chat_message_for_places(
            db, user_id=user.id, session_id=session.id, message_text=req.content,
        )
    except Exception as exc:
        logger.debug("9.4b geo ingest failed (non-critical): %s", exc)

    t_start = time.monotonic()

    # Phase 10 — final commit before handing off to generate(). Any writes
    # queued by the pre-generate steps (memory facts from geo_integration,
    # proactive state, etc.) must settle before tool-executor handlers try
    # to open their own sessions, or SQLite single-writer deadlocks.
    await db.commit()

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
    # Day-4 V-6 (ADR-RTP-002): chat response latency histogram. Wired
    # here (after the AI provider returns + the response forms compute)
    # so the bucket reflects the full /chat/messages POST budget the
    # operator promises in the SLO. Failure to record never raises.
    try:
        from observability import chat_response_latency_ms
        chat_response_latency_ms.observe(float(latency_ms))
    except Exception:  # noqa: BLE001
        pass
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

    # Push to WebSocket chat channel — simulated stream deltas + final message
    try:
        from api.websocket_hub import hub
        serialized = _serialize_message(assistant_msg)
        await _broadcast_message_stream(hub, user.id, serialized, session.id)
    except Exception as exc:
        logger.debug("WS chat broadcast failed (non-critical): %s", exc)

    # Phase 11b — tell the frontend to auto-play TTS for voice-originated
    # turns. Text/encoder turns keep the current opt-in behaviour.
    auto_tts = (
        req.input_method == "voice"
        and config.voice_tts_enabled
    )

    return {
        "message": _serialize_message(assistant_msg),
        "session_id": session.id,
        "auto_tts": auto_tts,
    }


async def _broadcast_message_stream(hub: Any, user_id: str, message: dict, session_id: str) -> None:
    """
    Broadcast an assistant message as a short series of WS stream events
    followed by a final 'message' broadcast.  Front-end dedupes via message_id.

    When `config.ai_streaming` is disabled the per-chunk deltas are skipped
    and clients receive only the final message — this matches the UX the
    setting promises ("turn streaming off and get the full reply at once").
    """
    message_id = message["id"]
    content = message.get("content") or ""
    # Stream the content in word-ish chunks to preserve UX parity with a true streaming provider.
    if content and config.ai_streaming:
        chunks = _chunk_content(content, chunk_size=config.chat_stream_chunk_chars)
        for chunk in chunks:
            await hub.broadcast(
                "chat", "stream",
                {"message_id": message_id, "delta": chunk, "done": False},
                user_id=user_id,
            )
            await asyncio.sleep(config.chat_stream_delay_s)

    await hub.broadcast(
        "chat", "stream",
        {"message_id": message_id, "delta": "", "done": True, "message": message},
        user_id=user_id,
    )
    await hub.broadcast(
        "chat", "message",
        {"message": message, "session_id": session_id},
        user_id=user_id,
    )


def _chunk_content(text: str, chunk_size: int = 24) -> list[str]:
    if chunk_size <= 0:
        return [text] if text else []
    # Audit-2026-04-28 F-43: chunk_stream_chunk_chars is operator-tunable;
    # values < 4 produce visible half-syllable cuts and break multi-byte
    # boundaries on Cyrillic. Clamp the lower bound so the streaming
    # smoothness stays usable regardless of the configured value.
    chunk_size = max(chunk_size, 4)
    chunks: list[str] = []
    cursor = 0
    while cursor < len(text):
        end = min(cursor + chunk_size, len(text))
        # Try to end chunks at a whitespace boundary when possible
        if end < len(text):
            space = text.rfind(" ", cursor, end)
            if space > cursor + chunk_size // 2:
                end = space + 1
        chunks.append(text[cursor:end])
        cursor = end
    return chunks


async def _ws_chat_handler(type_: str, data: dict, client: Any) -> None:
    """
    Handle client → server chat WS messages.
    Currently supports:
      - type='message': triggers the full send flow and streams the response
        via the chat channel back to this user.
    """
    if type_ != "message":
        return

    if not client.user_id:
        await client.send("chat", "error", {"detail": "Not authenticated"})
        return

    content = str(data.get("content", "")).strip()
    if not content:
        return

    input_method = str(data.get("input_method", "text"))
    session_id = data.get("session_id") or None

    try:
        async with get_session() as db:
            from sqlalchemy import select as _select
            from db.models import User as _User
            user_result = await db.execute(
                _select(_User).where(_User.id == client.user_id)
            )
            user = user_result.scalar_one_or_none()
            if not user:
                await client.send("chat", "error", {"detail": "User not found"})
                return

            session = await _get_or_create_session(db, user.id, session_id)

            # Session cache + user DB message
            from memory.session_memory import session_memory
            from core.context_engine import context_engine
            session_memory.add_message(session.id, "user", content)

            user_msg = ChatMessage(
                id=str(uuid.uuid4()),
                session_id=session.id,
                user_id=user.id,
                role="user",
                content=content,
                response_form="text",
                metadata_json=json.dumps({
                    "input_method": input_method,
                    "state_at_time": context_engine.get_snapshot().get("system", {}).get("state", "SHADOW"),
                }),
                attachments_json="[]",
            )
            db.add(user_msg)
            await db.flush()
            context_engine.record_interaction()

            # Phase 9.3b — mirror the REST path's self-model + proactive hooks
            # so WS chat updates the loop's silence clock too.
            try:
                from agent.runtime import agent_runtime
                from agent.self_model import (
                    maybe_add_concern_from_user_text,
                    note_interaction,
                )
                if agent_runtime.foreground_slot is not None:
                    sm = agent_runtime.foreground_slot.self_model
                    note_interaction(sm, user.id)
                    maybe_add_concern_from_user_text(sm, content)
            except Exception as exc:
                logger.debug("9.3a chat self-model hook (ws) failed: %s", exc)
            try:
                from agent.proactive import get_loop
                ploop = get_loop()
                if ploop is not None:
                    ploop.note_user_interaction()
            except Exception as exc:
                logger.debug("9.3b proactive note_user_interaction (ws) failed: %s", exc)

            # Phase 9.4b — WS parity with REST path.
            try:
                from memory.geo_integration import process_chat_message_for_places
                await process_chat_message_for_places(
                    db, user_id=user.id, session_id=session.id, message_text=content,
                )
            except Exception as exc:
                logger.debug("9.4b geo ingest (ws) failed (non-critical): %s", exc)

            # Broadcast confirmed user message
            from api.websocket_hub import hub as _hub
            await _hub.broadcast(
                "chat", "message",
                {"message": _serialize_message(user_msg), "session_id": session.id},
                user_id=user.id,
            )

            t_start = time.monotonic()
            try:
                ai_content, response_form, attachments, provider, tokens_used = \
                    await _build_ai_response(content, session.id, user, db)
            except Exception as exc:
                logger.error("WS chat AI generation failed: %s", exc)
                await client.send("chat", "error", {"detail": f"AI unavailable: {exc}"})
                await db.commit()
                return

            latency_ms = int((time.monotonic() - t_start) * 1000)
            # Day-4 V-6 (ADR-RTP-002): chat response latency histogram —
            # WS path mirror of the REST observation point above so a
            # client using either transport contributes to the same SLO.
            try:
                from observability import chat_response_latency_ms
                chat_response_latency_ms.observe(float(latency_ms))
            except Exception:  # noqa: BLE001
                pass
            snap = context_engine.get_snapshot()

            tone_desc = ""
            try:
                from ai.personality import calculate_tone
                from memory.user_model import get_behavioral_model as _gbm
                bmodel_fresh = await _gbm(db, user.id)
                tone_desc = calculate_tone(snap, bmodel_fresh.to_dict()).description
            except Exception:
                pass

            assistant_msg = ChatMessage(
                id=str(uuid.uuid4()),
                session_id=session.id,
                user_id=user.id,
                role="assistant",
                content=ai_content,
                response_form=response_form,
                metadata_json=json.dumps({
                    "state_at_time": snap.get("system", {}).get("state", "SHADOW"),
                    "context_snapshot_id": str(snap.get("timestamp", "")),
                    "ai_provider": provider,
                    "latency_ms": latency_ms,
                    "tokens_used": tokens_used,
                    "tone": tone_desc,
                    "input_method": input_method,
                }),
                attachments_json=json.dumps(attachments),
            )
            db.add(assistant_msg)
            session.message_count += 2  # type: ignore[operator]
            await db.flush()

            session_memory.add_message(
                session.id, "assistant", ai_content,
                response_form=response_form,
                attachments=attachments,
            )

            serialized = _serialize_message(assistant_msg)
            await _broadcast_message_stream(_hub, user.id, serialized, session.id)
            await db.commit()
    except Exception as exc:
        logger.error("WS chat handler error: %s", exc)
        try:
            await client.send("chat", "error", {"detail": str(exc)})
        except Exception:
            pass


def register_ws_handlers() -> None:
    """Called once at app startup to wire up chat WS channel handler."""
    from api.websocket_hub import hub
    hub.on("chat", _ws_chat_handler)


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
