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
from security.device_auth import get_user_or_device_user
from security.jwt_manager import TokenPayload
from ai.hub import ai_hub

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["chat"])

# Day-4/5: keep a reference to fire-and-forget background tasks so they
# aren't garbage collected before they finish.
_BACKGROUND_TASKS: set[asyncio.Task] = set()


def _track_task(task: asyncio.Task) -> None:
    _BACKGROUND_TASKS.add(task)
    task.add_done_callback(_BACKGROUND_TASKS.discard)


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

class UpdateSessionRequest(BaseModel):
    summary: str


class ArtifactActionRequest(BaseModel):
    tool: str
    args: dict = {}


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
    except Exception as exc:
        logger.warning(
            "chat.serialize: state_history_json corrupt for session=%s — %s",
            session.id, exc,
        )
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


async def _hydrate_session_memory_from_db(
    db: AsyncSession,
    *,
    user_id: str,
    session_id: str,
) -> None:
    """Warm the in-RAM chat history from persisted messages.

    ``session_memory`` is process-local, so reopening an old session after a
    backend restart used to give the model zero conversational history even
    though the UI showed the transcript from SQLite. Hydrate once before
    appending the current user turn.
    """
    from memory.session_memory import session_memory

    if session_memory.session_exists(session_id):
        return

    limit = max(2, min(200, int(config.chat_max_session_history) * 2))
    result = await db.execute(
        select(ChatMessage)
        .where(
            ChatMessage.session_id == session_id,
            ChatMessage.user_id == user_id,
        )
        .order_by(ChatMessage.created_at.desc())
        .limit(limit)
    )
    rows = list(reversed(result.scalars().all()))
    for msg in rows:
        attachments: list[dict[str, Any]] = []
        try:
            loaded = json.loads(msg.attachments_json or "[]")
            if isinstance(loaded, list):
                attachments = [a for a in loaded if isinstance(a, dict)]
        except Exception as exc:
            logger.debug(
                "chat hydrate: attachments_json corrupt for msg=%s — %s",
                msg.id, exc,
            )
        session_memory.add_message(
            session_id,
            msg.role,
            msg.content or "",
            response_form=msg.response_form or "text",
            attachments=attachments,
        )


async def _build_ai_response(
    user_message: str,
    session_id: str,
    user: Any,
    db: AsyncSession,
    *,
    on_delta: Any = None,
) -> tuple[str, str, list[dict], str, int]:
    # ... imports ...
    from ai.prompt_builder import (
        build_system_prompt,
        build_history_messages,
        fetch_recent_places,
    )
    from memory.brain import memory_brain
    from memory.session_memory import session_memory
    from memory.strategic_memory import extract_and_store_facts
    from memory.user_model import (
        get_behavioral_model, save_behavioral_model,
        update_trust, update_vocabulary, update_language_stats,
        Interaction,
    )
    from core.context_engine import context_engine

    # ── Fast Path Detection ──────────────────────────────────────────────
    clean_msg = user_message.strip().lower().strip("?!. ")
    is_greeting = clean_msg in {
        "привіт", "здоров", "хай", "ку", "вітаю", "добрий день", "добрий вечір", "доброго ранку",
        "hi", "hello", "hey", "yo", "greeting", "morning", "evening",
        "як справи", "як ти", "що робиш", "how are you", "what's up", "як воно",
    }
    is_fast_track = is_greeting or len(user_message) < 4
    
    snapshot = context_engine.get_snapshot()
    behavioral_model = await get_behavioral_model(db, user.id)

    # 0. Endocrine Stimuli — Phase 14
    # ... (remains for consistency) ...
    from ai.sentience.endocrine import endocrine_system
    endocrine_system.update(300) 
    endocrine_system.stimulus(cortisol_delta=0.01 if is_fast_track else 0.0)
    hormones = endocrine_system.state.model_dump()

    # 1. Memory & Location (SKIP IF FAST TRACK)
    hints = []
    recent_places = []
    if not is_fast_track:
        where = snapshot.get("where", {})
        lat = where.get("lat")
        lon = where.get("lon")
        try:
            from memory.tom_service import affect_match_retrieve
            user_prosody = {
                "valence": 0.5,
                "arousal": 0.5,
                "fatigue": 0.0,
                "hesitation": 0.0
            }
            hints = await affect_match_retrieve(
                db=db,
                user_id=user.id,
                query=user_message,
                query_prosody=user_prosody,
                k=config.memory_top_k
            )
        except Exception as exc:
            logger.debug("ToM affect_match_retrieve failed: %s", exc)
            hints = []
        try:
            recent_places = await fetch_recent_places(db, user.id, hours=24, limit=5)
        except Exception:
            recent_places = []

    context_engine.set_memory_hints(hints)
    snapshot["memory_hints"] = hints

    # 1c. Emotion (Skip heavy fetch if fast track)
    emotion_dict: dict | None = None
    if not is_fast_track:
        try:
            from agent.kernel.runtime import agent_runtime
            slot = agent_runtime.foreground_slot
            if slot and slot.self_model:
                emo = getattr(slot.self_model, "emotion", None)
                if emo:
                    emotion_dict = {"focus": float(emo.focus), "curiosity": float(emo.curiosity), "concern": float(emo.concern), "fatigue": float(emo.fatigue)}
        except Exception: pass

    # 2. Build user dict
    user_dict = {
        "username": user.username,
        "role": user.role,
        "preferences": json.loads(user.preferences_json or "{}"),
    }

    # 2b. Fetch Core Narrative context
    core_narrative_context = ""
    try:
        from memory.core_narrative import inject_core_narrative_context
        core_narrative_context = await inject_core_narrative_context(db, user.id)
    except Exception as exc:
        logger.debug("Failed to fetch core narrative context: %s", exc)

    # 3. Build system prompt — full personality always; skip heavy context for short turns
    _is_short_turn = len(user_message) < 80 and "\n" not in user_message
    _model_hint = config.ai_conversational_model if _is_short_turn else config.ai_reasoning_model

    # PMState — load and inject as leading context block
    mind_state_block = ""
    _mind_state: dict = {}
    try:
        from memory.mind_state import get_mind_state, format_for_prompt as _fmt_mind
        _mind_state = await get_mind_state(db, user.id)
        mind_state_block = _fmt_mind(_mind_state)
    except Exception as _ms_exc:
        logger.debug("PMState load failed: %s", _ms_exc)

    # Tactical memory injection — only for non-short turns
    if not _is_short_turn:
        try:
            from memory.tactical_memory import get_recent_facts
            _tactical_facts = await get_recent_facts(db, user.id, limit=5)
            if _tactical_facts:
                _tactical_hints = [f"[тактична: {f.get('content', '')}]" for f in _tactical_facts]
                hints = _tactical_hints + (hints or [])
        except Exception as _tac_exc:
            logger.debug("tactical facts: %s", _tac_exc)

    system_prompt = build_system_prompt(
        snapshot=snapshot,
        user_dict=user_dict,
        behavioral_model=behavioral_model.to_dict(),
        memory_hints=[] if _is_short_turn else hints,
        recent_places=None if _is_short_turn else recent_places,
        emotion=emotion_dict,
        hormones=hormones,
        minimal_mode=False,
        core_narrative=None if _is_short_turn else core_narrative_context,
    )

    # Inject PMState as first contextual block after base system prompt
    if mind_state_block:
        system_prompt = system_prompt + "\n\n" + mind_state_block

    # Theory of Mind injection — skip for short turns to keep latency low
    if not _is_short_turn:
        try:
            from memory.tom_service import get_tom_prompt_context
            tom_context = await get_tom_prompt_context(db, user.id)
            tom_block = (
                f"\n\n[USER MODEL - THEORY OF MIND]\n"
                f"Твоя поточна модель користувача (ToM):\n{tom_context['tom_beliefs_with_band_tags']}\n\n"
                f"Відкриті петлі зобов'язань користувача:\n{tom_context['open_loops']}\n\n"
                f"[AGENDA / INTERRUPTION PROBES]\n"
                f"Якщо є природний момент, перевір наступне:\n{tom_context['active_probes']}"
            )
            system_prompt += tom_block
        except Exception as exc:
            logger.debug("ToM prompt context injection failed: %s", exc)

    # Living narrative injection — only for complex turns to avoid prompt bloat
    if not _is_short_turn:
        try:
            from memory.narrative import get_narrative, format_narrative_for_prompt
            _narrative_text = await get_narrative(db, user.id)
            _narrative_block = format_narrative_for_prompt(_narrative_text)
            if _narrative_block:
                system_prompt += _narrative_block
        except Exception as _narr_exc:
            logger.debug("narrative load failed: %s", _narr_exc)

    # Always-on minimal temporal/state context (~20 tokens, even for short turns)
    _snap_sys = snapshot.get("system", {}) if snapshot else {}
    _snap_when = snapshot.get("when", {}) if snapshot else {}
    system_prompt += (
        f"\n[NOW: {_snap_when.get('time', '?')} | "
        f"{_snap_when.get('day_name', '?')} | "
        f"state={_snap_sys.get('state', 'SHADOW')}]"
    )

    # Consciousness stream pending thought
    try:
        from agent.consciousness_stream import consciousness_stream as _cstream
        _pending = _cstream.get_pending_insight(user.id)
        if _pending:
            system_prompt += (
                f"\n\n[PHANTOM STREAM — pending thought]\n{_pending}\n"
                "If it fits naturally, weave this into your response. Don't force it."
            )
    except Exception:
        pass

    # 4. History — always keep full session history; short turns don't need less context
    history = session_memory.get_history_dicts(
        session_id, max_turns=config.chat_max_session_history
    )
    if history and history[-1]["role"] == "user" and history[-1]["content"] == user_message:
        history.pop()

    # 5. Generate
    if config.chat_tools_enabled is True:
        # Full Agentic Path
        from ai.chat_pipeline import run as chat_pipeline_run
        from ai.agents.orchestrator import run_orchestrator
        _prefer = "remote" if config.ai_primary_provider == "gemini" else "local"
        handle = ai_hub.pick("chat", prefer=_prefer)
        ai_response = await run_orchestrator(
            user_text=user_message,
            provider=handle.capability.provider,
            chat_pipeline_run=chat_pipeline_run,
            user_message=user_message,
            system_prompt=system_prompt,
            history=history,
            user_id=user.id,
            db=db,
            model_override=_model_hint,
            on_delta=on_delta,
        )
    else:
        # Fast Text Path
        ai_response = await ai_hub.dispatch(
            "chat",
            {
                "user_message": user_message,
                "system_prompt": system_prompt,
                "history": history,
                "user_id": user.id,
                "model_override": _model_hint,
            },
            provider_hint=config.ai_primary_provider,
        )

    # 6. Post-turn (Skip heavy background tasks if fast track)
    if not is_fast_track:
        update_vocabulary(behavioral_model, user_message)
        update_language_stats(behavioral_model, user_message)

        async def _bg_extract_facts() -> None:
            try:
                from db.database import get_session as _get_bg_session
                async with _get_bg_session() as bg_db:
                    await extract_and_store_facts(user_id=user.id, session_id=session_id, conversation_summary=user_message, db=bg_db)
            except Exception: pass
        _track_task(asyncio.create_task(_bg_extract_facts()))

    # Narrative background update — every N turns synthesizes a living portrait
    if not is_fast_track:
        _narrative_history = history
        _narrative_hints = hints if not is_fast_track else []
        _narrative_mind = _mind_state
        async def _bg_update_narrative() -> None:
            try:
                from db.database import get_session as _get_bg_narr_session
                from memory.narrative import update_narrative_if_due
                async with _get_bg_narr_session() as bg_narr_db:
                    await update_narrative_if_due(
                        db=bg_narr_db,
                        user_id=user.id,
                        session_history=_narrative_history,
                        mind_state=_narrative_mind,
                        memory_hints=_narrative_hints,
                    )
            except Exception:
                pass
        _track_task(asyncio.create_task(_bg_update_narrative()))

    # PMState background update — always fire, even on fast-track short turns
    _ai_resp_text = ai_response.content if ai_response else ""
    async def _bg_update_mind_state() -> None:
        try:
            from memory.mind_state import update_mind_state as _update_ms
            from db.database import get_session as _get_bg_ms_session
            async with _get_bg_ms_session() as bg_ms_db:
                await _update_ms(
                    db=bg_ms_db,
                    user_id=user.id,
                    last_user_msg=user_message,
                    last_ai_response=_ai_resp_text,
                    session_history=history,
                )
        except Exception: pass
    _track_task(asyncio.create_task(_bg_update_mind_state()))

    await save_behavioral_model(db, user.id, behavioral_model)

    return (
        ai_response.content,
        ai_response.response_form,
        ai_response.attachments,
        ai_response.provider,
        ai_response.tokens_used,
        hormones,
    )



# ── Routes ─────────────────────────────────────────────────────────────────────

@router.post("/artifact-action")
async def artifact_action(
    req: ArtifactActionRequest,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_user_or_device_user),
) -> dict:
    # Thin proxy — RBAC/audit/dangerous-pattern checks live in the dispatcher.
    from ai.chat_tool_dispatcher import dispatch as chat_dispatch
    return await chat_dispatch(req.tool, req.args, user_id=user.id, db=db)


@router.post("/message")
async def send_message(
    req: SendMessageRequest,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_user_or_device_user),
) -> dict:

    """Phase 4 — accepts user JWT (desktop) OR device JWT (paired phone).

    `get_user_or_device_user` resolves both audiences to the same User
    row. The body downstream only needs `user.id`, so the dual-auth
    swap is local to the dependency line — no other changes needed in
    this handler.
    """
    from core.context_engine import context_engine
    try:
        from agent.consciousness_stream import consciousness_stream as _cs
        _cs.notify_user_activity()
    except Exception:
        pass

    # Reset the idle clock the moment a chat message lands. Without this
    # the state machine's `_conversation_ended` predicate (idle > 30 s)
    # fires while the operator is reading the AI reply and bounces them
    # out of DIALOGUE back to SHADOW. record_interaction() existed but
    # was wired only in tests prior to 2026-05-09.
    context_engine.record_interaction()

    # Get or create session
    session = await _get_or_create_session(db, user.id, req.session_id)

    # Apply PII Guard (Cognitive Immunity Pre-write Guard)
    try:
        from security.pii_guard import pii_guard
        req.content = await pii_guard(db, user.id, req.content)
    except Exception as exc:
        logger.error("PII Guard pre-write execution failed: %s", exc)

    # ToM check active probes and log user episode
    try:
        from memory.tom_service import check_active_probes, log_episode
        user_prosody = {
            "valence": 0.5,
            "arousal": 0.6 if req.input_method == "voice" else 0.5,
            "fatigue": 0.0,
            "hesitation": 0.0
        }
        await check_active_probes(db, user.id, req.content)
        await log_episode(
            db=db,
            session_id=session.id,
            role="user",
            content=req.content,
            prosody=user_prosody,
            context_snap=context_engine.get_snapshot()
        )
    except Exception as exc:
        logger.debug("ToM hot-path check/log user episode failed: %s", exc)

    # Record user message in session RAM cache
    from memory.session_memory import session_memory
    await _hydrate_session_memory_from_db(
        db, user_id=user.id, session_id=session.id,
    )
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
        from agent.kernel.runtime import agent_runtime
        from agent.cognition.self_model import (
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
        from agent.cognition.proactive.loop import get_loop
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
        from agent.cognition.proactive.loop import get_loop as _get_loop_p94a
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

    # Day-5 — true live streaming: pre-generate a stable assistant
    # message_id, broadcast each generate_stream chunk via WS as it
    # arrives, then save the assembled text to DB and broadcast the
    # final 'message' event. Operator perceives sub-500ms TTFT instead
    # of waiting for the full reply before seeing anything.
    assistant_msg_id = str(uuid.uuid4())
    streaming_active = False

    async def _send_delta(chunk: str) -> None:
        nonlocal streaming_active
        streaming_active = True
        try:
            from api.websocket_hub import hub as _hub
            await _hub.broadcast(
                "chat", "stream",
                {"message_id": assistant_msg_id, "delta": chunk, "done": False, "session_id": session.id},
                user_id=user.id,
            )
        except Exception as exc:  # noqa: BLE001
            logger.debug("WS chunk broadcast failed: %s", exc)

    # Generate AI response (streaming when on_delta is set + tools off)
    try:
        content, response_form, attachments, provider, tokens_used, hormones = \
            await _build_ai_response(
                req.content, session.id, user, db, on_delta=_send_delta,
            )
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
        # Day-5 streaming: use the pre-generated id we've been
        # broadcasting deltas under so the frontend can dedupe the
        # final 'message' event against the in-flight bubble.
        id=assistant_msg_id,
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
            "streamed": streaming_active,
            "hormones": hormones,
        }),
        attachments_json=json.dumps(attachments),
    )
    db.add(assistant_msg)

    # ToM log assistant episode
    try:
        from memory.tom_service import log_episode
        await log_episode(
            db=db,
            session_id=session.id,
            role="assistant",
            content=content
        )
    except Exception as exc:
        logger.debug("ToM hot-path log assistant episode failed: %s", exc)

    # Update session message count
    session.message_count += 2  # type: ignore[operator]
    await db.flush()

    # Cache assistant response in session memory
    session_memory.add_message(
        session.id, "assistant", content,
        response_form=response_form,
        attachments=attachments,
    )

    # Phase 19: Auto-summarize session if it's new
    if session.message_count == 2 and not session.summary:
        async def _bg_summarize_session() -> None:
            try:
                from db.database import get_session as _get_bg_session
                from sqlalchemy import select as _bg_select
                async with _get_bg_session() as bg_db:
                    res = await bg_db.execute(
                        _bg_select(ChatSession).where(ChatSession.id == session.id)
                    )
                    bg_session = res.scalar_one_or_none()
                    if bg_session:
                        summary_resp = await ai_hub.dispatch(
                            "chat_subtask",
                            {
                                "user_message": "Summarize this chat in 2-4 words maximum, capitalize it like a title. Return ONLY the title and nothing else.",
                                "system_prompt": "You are an AI generating very brief, 2-4 word chat titles.",
                                "history": [{"role": "user", "content": req.content}, {"role": "assistant", "content": content}],
                                "user_id": user.id,
                            },
                            provider_hint=config.ai_primary_provider,
                        )
                        if summary_resp.content:
                            title = summary_resp.content.replace("\"", "").strip()
                            if len(title) > 0:
                                bg_session.summary = title
                                await bg_db.commit()
            except Exception as exc:
                logger.debug("Background session summarize failed: %s", exc)

        _track_task(asyncio.create_task(_bg_summarize_session()))


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

    # Push to WebSocket chat channel — when the response was streamed
    # live, skip the per-chunk simulation (deltas already arrived) and
    # only broadcast the final 'message' event for dedupe + scene
    # envelope replacement. Non-streamed turns keep the legacy
    # chunked-simulation behaviour.
    try:
        from api.websocket_hub import hub
        serialized = _serialize_message(assistant_msg)
        await _broadcast_message_stream(
            hub, user.id, serialized, session.id,
            already_streamed=streaming_active,
        )
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


async def _synthesize_session_end(user_id: str, session_id: str) -> None:
    """On session end, summarize and store in strategic memory."""
    try:
        from db.database import get_session as _gs
        from db.models import ChatMessage as _CM
        from sqlalchemy import select as _sel
        async with _gs() as bg_db:
            result = await bg_db.execute(
                _sel(_CM)
                .where(_CM.session_id == session_id, _CM.user_id == user_id)
                .order_by(_CM.created_at.asc())
                .limit(30)
            )
            msgs = result.scalars().all()
        if len(msgs) < 4:
            return
        turns_text = "\n".join(
            f"{m.role.upper()}: {(m.content or '')[:200]}" for m in msgs[-20:]
        )
        prompt = (
            "Summarize this conversation in 2-3 sentences. "
            "What was discussed? What was important? What should be remembered?\n\n"
            + turns_text
        )
        resp = await ai_hub.dispatch(
            "chat",
            {
                "user_message": prompt,
                "system_prompt": "You extract key facts from conversations for long-term memory. Be specific and factual.",
                "history": [],
                "user_id": user_id,
                "model_override": config.ai_background_model,
            },
            provider_hint=config.ai_primary_provider,
        )
        if resp and resp.content:
            from memory.strategic_memory import store_fact
            await store_fact(
                user_id=user_id,
                fact_id=str(uuid.uuid4()),
                content=resp.content,
                category="session_synthesis",
                importance=0.6,
            )
    except Exception as exc:
        logger.debug("session end synthesis failed: %s", exc)


async def _broadcast_message_stream(
    hub: Any,
    user_id: str,
    message: dict,
    session_id: str,
    *,
    already_streamed: bool = False,
) -> None:
    """
    Broadcast an assistant message as a short series of WS stream events
    followed by a final 'message' broadcast.  Front-end dedupes via message_id.

    When `config.ai_streaming` is disabled the per-chunk deltas are skipped
    and clients receive only the final message — this matches the UX the
    setting promises ("turn streaming off and get the full reply at once").

    Day-5 — when ``already_streamed=True`` the chat handler has already
    pushed real deltas to the user's WS channel during generation. We
    skip the post-hoc chunk simulation entirely and emit only the
    final done=True + message events so the frontend can finalise the
    bubble (and replace it with a scene envelope if response_form is
    structured).
    """
    message_id = message["id"]
    content = message.get("content") or ""
    # Stream the content in word-ish chunks to preserve UX parity with a true streaming provider.
    if content and config.ai_streaming and not already_streamed:
        chunks = _chunk_content(content, chunk_size=config.chat_stream_chunk_chars)
        for chunk in chunks:
            await hub.broadcast(
                "chat", "stream",
                {"message_id": message_id, "delta": chunk, "done": False, "session_id": session_id},
                user_id=user_id,
            )
            # Day-4 W-5 (audit U8-PERF-C2): skip the inter-chunk sleep
            # when the operator left the new 0.0 default in place.
            # Calling asyncio.sleep(0) is a yield-point that costs an
            # event-loop hop per chunk (5-10 hops × ~1 ms = 5-10 ms);
            # the strict-positive guard avoids that on every turn.
            if config.chat_stream_delay_s > 0:
                await asyncio.sleep(config.chat_stream_delay_s)

    await hub.broadcast(
        "chat", "stream",
        {"message_id": message_id, "delta": "", "done": True, "message": message, "session_id": session_id},
        user_id=user_id,
    )
    import logging
    logging.getLogger(__name__).warning("BROADCASTING FINAL MESSAGE: %r", message)
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
            await _hydrate_session_memory_from_db(
                db, user_id=user.id, session_id=session.id,
            )
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
                from agent.kernel.runtime import agent_runtime
                from agent.cognition.self_model import (
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
                from agent.cognition.proactive.loop import get_loop
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
                ai_content, response_form, attachments, provider, tokens_used, hormones = \
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
                    "hormones": hormones,
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
    # Auto-clean empty/failed sessions (message_count == 0 or contains fallback error)
    try:
        from sqlalchemy import delete
        # Find empty sessions (message_count == 0)
        empty_stmt = select(ChatSession.id).where(
            ChatSession.user_id == token_data.user_id,
            ChatSession.message_count == 0
        )
        empty_ids = set((await db.execute(empty_stmt)).scalars().all())

        # Find sessions with message_count <= 2 where assistant message is fallback error
        failed_msg_stmt = select(ChatMessage.session_id).where(
            ChatMessage.user_id == token_data.user_id,
            ChatMessage.role == "assistant",
            ChatMessage.content == "Не встиг сформулювати — перепитай?"
        )
        failed_session_ids = (await db.execute(failed_msg_stmt)).scalars().all()
        
        to_delete = list(empty_ids)
        if failed_session_ids:
            count_stmt = select(ChatSession.id).where(
                ChatSession.id.in_(failed_session_ids),
                ChatSession.message_count <= 2
            )
            to_delete.extend((await db.execute(count_stmt)).scalars().all())

        if to_delete:
            # Delete messages first to prevent foreign key errors
            await db.execute(
                delete(ChatMessage).where(ChatMessage.session_id.in_(to_delete))
            )
            # Delete the sessions themselves
            await db.execute(
                delete(ChatSession).where(ChatSession.id.in_(to_delete))
            )
            await db.commit()
    except Exception as exc:
        logger.warning("Failed to auto-clean empty/failed sessions: %s", exc)


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

    # Synthesize session before deleting (background, uses own DB session)
    _track_task(asyncio.create_task(
        _synthesize_session_end(token_data.user_id, session_id)
    ))

    await db.delete(session)
    await db.flush()

    # Clear from RAM cache
    from memory.session_memory import session_memory
    session_memory.clear_session(session_id)

    return {"ok": True}


@router.put("/sessions/{session_id}")
async def update_session(
    session_id: str,
    req: UpdateSessionRequest,
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

    session.summary = req.summary.strip()
    await db.flush()

    return {"session": _serialize_session(session)}
