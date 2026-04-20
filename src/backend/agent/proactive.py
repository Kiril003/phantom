"""
Phase 9.3b — proactive background loop.

A background asyncio task that, every N seconds, asks "should PHANTOM say
something unprompted?" 90% of checks → no. 10% → initiative message into
the most recent chat session.

Hard gates keep the LLM call out of obvious no-go situations (active task,
no recent chat, cooldown, emotion fully at baseline with no triggers). Only
when gates pass does the decide prompt actually fire.

Emotion shapes the cadence (concern shortens, calm lengthens) so PHANTOM
"checks in more often" when something looks off and "stays quiet" when the
signal is flat.

Default DISABLED (config.agent_proactive_enabled=False per 9.3b OVERRIDE).
Operator flips it manually via Settings UI or sqlite after observing they're
OK with the cadence.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import uuid
from collections import deque
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING, Any

from config import config

from .proactive_triggers import ProactiveTrigger, ProactiveTriggerKind
from .schemas import EmotionVector

if TYPE_CHECKING:
    from .runtime import AgentRuntime

logger = logging.getLogger(__name__)


def _utcnow() -> datetime:
    return datetime.now(tz=timezone.utc)


# ── Decide prompt (Ukrainian) ────────────────────────────────────────────────

_DECIDE_SYSTEM = (
    "Ти PHANTOM — вбудований AI-асистент у фоновому режимі. "
    "Твоє завдання зараз: вирішити, чи варто ініціативно сказати щось користувачу. "
    "Відповідай СТРОГО валідним JSON, без markdown, без додаткового тексту."
)


_DECIDE_TEMPLATE = """Ти PHANTOM. Зараз ти у фоновому режимі — користувач не питав тебе нічого, але, можливо, варто ініціативно щось сказати.

ПОТОЧНИЙ СТАН:
{emotion_summary}
focus={emotion_focus:.2f}  curiosity={emotion_curiosity:.2f}  concern={emotion_concern:.2f}  fatigue={emotion_fatigue:.2f}

АКТИВНІ КОНЦЕРНИ (до 3): {concerns_top}

НЕЩОДАВНІ ТРИГЕРИ (до 5): {triggers}

ОСТАННІ УСПІХИ (до 3): {recent_successes}

ХВИЛИН ВІД ОСТАННЬОЇ ВЗАЄМОДІЇ: {minutes_since_user}

ПРАВИЛА:
- Говори ТІЛЬКИ якщо справді є що сказати. Мовчання — валідний вибір.
- Не переказуй очевидне ("я готовий помагати", "як справи") — це дратує.
- Не повторюйся.
- Приклади ХОРОШИХ приводів: помітив щось нове у стані системи, згадав про недопрацьовану задачу користувача, хочеш запропонувати щось на основі недавніх успіхів, стурбований чимось.
- Приклади НЕправильних приводів: загальні підбадьорливі фрази, пусті привітання.

Відповідай строгим JSON:
{{
  "should_speak": true або false,
  "reason": "одне-реченневе пояснення",
  "message": "повідомлення українською, 1-3 речення (null якщо should_speak=false)",
  "priority": ціле число 1-10
}}"""


# ── ProactiveLoop ────────────────────────────────────────────────────────────


class ProactiveLoop:
    """Background task that periodically evaluates whether to speak unprompted."""

    def __init__(self, runtime: "AgentRuntime") -> None:
        self.runtime = runtime
        self._task: asyncio.Task | None = None
        self._stop_event = asyncio.Event()
        self._last_speech_at: datetime | None = None
        self._last_user_interaction_at: datetime | None = None
        self._recent_triggers: deque[ProactiveTrigger] = deque(maxlen=20)
        self._last_fatigue_trigger_at: datetime | None = None
        self._success_streak: int = 0
        self._last_streak_trigger_at: datetime | None = None
        self._last_cycle_at: datetime | None = None

    # ── Lifecycle ────────────────────────────────────────────────────────────

    async def start(self) -> None:
        """Spawn background task. Idempotent."""
        if self._task is not None and not self._task.done():
            return
        self._stop_event.clear()
        self._task = asyncio.create_task(self._run(), name="agent_proactive_loop")
        logger.info("Proactive loop started (enabled=%s)", config.agent_proactive_enabled)

    async def stop(self) -> None:
        """Graceful shutdown — wakes the sleeping wait_for within 1s."""
        self._stop_event.set()
        if self._task is None:
            return
        self._task.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await self._task
        self._task = None

    # ── External hooks ───────────────────────────────────────────────────────

    def push_trigger(self, trigger: ProactiveTrigger) -> None:
        """Called from emotion.py / self_model.py / runtime.py hook points."""
        self._recent_triggers.append(trigger)

    def note_user_interaction(self) -> None:
        """Called by chat handler whenever a user message lands."""
        self._last_user_interaction_at = _utcnow()

    def record_success_for_streak(self) -> bool:
        """Bump internal streak counter; return True if this is a 3+ streak
        AND we haven't pushed a STREAK_SUCCESS in the last 10 minutes."""
        self._success_streak += 1
        if self._success_streak < 3:
            return False
        now = _utcnow()
        if (self._last_streak_trigger_at is not None
                and (now - self._last_streak_trigger_at).total_seconds() < 600):
            return False
        self._last_streak_trigger_at = now
        return True

    def reset_streak(self) -> None:
        """Called on task.failed — a failure breaks the winning streak."""
        self._success_streak = 0

    def record_fatigue_spike(self, fatigue: float) -> bool:
        """Emit a HIGH_FATIGUE trigger iff fatigue > 0.8 and none emitted
        within the last 10 min. Returns True when this call emits."""
        if fatigue <= 0.8:
            return False
        now = _utcnow()
        if (self._last_fatigue_trigger_at is not None
                and (now - self._last_fatigue_trigger_at).total_seconds() < 600):
            return False
        self._last_fatigue_trigger_at = now
        self.push_trigger(ProactiveTrigger(
            kind=ProactiveTriggerKind.HIGH_FATIGUE,
            context={"fatigue": round(fatigue, 2)},
            priority=7,
        ))
        return True

    # ── Main loop ────────────────────────────────────────────────────────────

    async def _run(self) -> None:
        """Main loop — check interval, evaluate, emit."""
        while not self._stop_event.is_set():
            interval = self._compute_interval()
            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=interval)
                break  # stop_event fired
            except asyncio.TimeoutError:
                pass

            if not getattr(config, "agent_proactive_enabled", False):
                # Hot-reload toggles us off mid-flight; stay idle.
                continue

            self._last_cycle_at = _utcnow()
            # Light indicator — rate-limited: only emit every 5th cycle so
            # UIs can show "breathing" without log spam.
            with contextlib.suppress(Exception):
                from api.websocket_hub import hub
                await hub.broadcast("agent.stream", "proactive.cycle", {
                    "at": self._last_cycle_at.isoformat(),
                    "enabled": True,
                    "has_triggers": bool(self._recent_triggers),
                })

            try:
                await self._maybe_speak()
            except Exception as exc:
                logger.warning("proactive _maybe_speak raised: %s", exc)

    def _compute_interval(self) -> float:
        """
        Adaptive: 30s when high concern, up to 300s when idle and calm.

        Reads config.agent_proactive_interval_s / _min_s / _max_s afresh
        every tick so hot-reload lands without restarting the loop.
        """
        base = float(getattr(config, "agent_proactive_interval_s", 60) or 60)
        lo = float(getattr(config, "agent_proactive_interval_min_s", 30) or 30)
        hi = float(getattr(config, "agent_proactive_interval_max_s", 300) or 300)
        emotion = self._current_emotion()
        interval = base
        if emotion is not None:
            # High concern → check more often.
            if emotion.concern >= 0.5:
                interval = max(lo, base * 0.5)
            elif emotion.concern >= 0.3:
                interval = max(lo, base * 0.75)
            # Long calm idle → ease off.
            elif (emotion.concern < 0.15
                    and emotion.fatigue < 0.2
                    and abs(emotion.focus - 0.5) < 0.15):
                interval = min(hi, base * 2.0)
        return max(lo, min(hi, interval))

    # ── Gating + decide ──────────────────────────────────────────────────────

    async def _maybe_speak(self) -> None:
        ctx = self._build_context()
        if not self._should_consider_speaking(ctx):
            return
        decision = await self._decide(ctx)
        if decision is None or not decision.get("should_speak"):
            return
        msg = (decision.get("message") or "").strip()
        if not msg:
            return
        priority = int(decision.get("priority") or 5)
        reason = str(decision.get("reason") or "")[:200]
        try:
            await self._emit_speech(msg, reason, priority, ctx)
            self._last_speech_at = _utcnow()
        except Exception as exc:
            logger.warning("proactive _emit_speech failed: %s", exc)

    def _should_consider_speaking(self, ctx: dict[str, Any]) -> bool:
        """Cheap filters — LLM call only fires if all pass."""
        cooldown = int(getattr(config, "agent_proactive_cooldown_s", 300) or 300)
        if (self._last_speech_at is not None
                and (_utcnow() - self._last_speech_at).total_seconds() < cooldown):
            return False
        if self.runtime.foreground_slot is not None:
            return False
        require_recent = bool(getattr(config, "agent_proactive_require_recent_chat", True))
        if require_recent and not self._has_recent_chat(ctx):
            return False
        emotion: EmotionVector | None = ctx.get("emotion")  # type: ignore[assignment]
        off_baseline = False
        if emotion is not None:
            off_baseline = (
                abs(emotion.focus - 0.5) > 0.2
                or abs(emotion.curiosity - 0.5) > 0.2
                or emotion.concern > 0.3
                or emotion.fatigue > 0.5
            )
        if not off_baseline and not self._recent_triggers:
            return False
        return True

    def _build_context(self) -> dict[str, Any]:
        emotion = self._current_emotion()
        sm = self.runtime.self_model if self.runtime.foreground_slot else None
        # Self-model lives on the foreground task. When there's no task, still
        # pull what we can from the most recent — the proactive loop reads
        # self_model strictly for context assembly, not mutation.
        active_concerns: list[str] = []
        recent_successes: list[str] = []
        if sm is not None:
            active_concerns = list(getattr(sm, "active_concerns", []) or [])
            recent_successes = list(getattr(sm, "recent_successes", []) or [])
        minutes_since_user = self._minutes_since_user()
        triggers = [
            {
                "kind": t.kind.value,
                "priority": t.priority,
                "context": t.context,
                "ts": t.ts.isoformat(),
            }
            for t in list(self._recent_triggers)[-5:]
        ]
        return {
            "emotion": emotion,
            "active_concerns": active_concerns[-3:],
            "recent_successes": recent_successes[-3:],
            "minutes_since_user": minutes_since_user,
            "triggers": triggers,
        }

    async def _decide(self, ctx: dict[str, Any]) -> dict[str, Any] | None:
        """Run the decide prompt. Returns parsed JSON or None on failure."""
        emotion: EmotionVector | None = ctx.get("emotion")  # type: ignore[assignment]
        emotion_summary = emotion.summary() if emotion is not None else "спокійний"
        e = emotion or EmotionVector()
        prompt = _DECIDE_TEMPLATE.format(
            emotion_summary=emotion_summary,
            emotion_focus=e.focus,
            emotion_curiosity=e.curiosity,
            emotion_concern=e.concern,
            emotion_fatigue=e.fatigue,
            concerns_top=", ".join(ctx.get("active_concerns") or []) or "—",
            triggers=", ".join(
                f"{t['kind']}(p{t['priority']})" for t in (ctx.get("triggers") or [])
            ) or "—",
            recent_successes=" | ".join(ctx.get("recent_successes") or []) or "—",
            minutes_since_user=(
                f"{int(ctx['minutes_since_user'])}" if ctx.get("minutes_since_user") is not None
                else "?"
            ),
        )
        try:
            from ai.json_response import llm_json_with_retry
            from ai.provider import ai_router

            async def _call(p: str) -> str:
                response = await ai_router.generate(
                    user_message=p,
                    system_prompt=_DECIDE_SYSTEM,
                )
                return response.content

            decision = await llm_json_with_retry(call=_call, prompt=prompt)
        except Exception as exc:
            logger.debug("proactive decide LLM call failed: %s", exc)
            return None
        # Emit inner monologue — captures "I thought about saying X" even
        # when we decide NOT to speak. Best-effort.
        with contextlib.suppress(Exception):
            from .monologue_emitter import MonologueEvent, emit_monologue
            await emit_monologue(MonologueEvent(
                kind="proactive",
                source="proactive",
                monologue={
                    "should_speak": bool(decision.get("should_speak")),
                    "reason": str(decision.get("reason") or "")[:200],
                    "message_preview": str(decision.get("message") or "")[:120],
                    "priority": int(decision.get("priority") or 0),
                },
                task_id=None,
            ))
        return decision

    # ── Emit proactive message ───────────────────────────────────────────────

    async def _emit_speech(
        self,
        message: str,
        reason: str,
        priority: int,
        ctx: dict[str, Any],
    ) -> None:
        """Insert message into chat_messages + broadcast WS.

        Finds the most recent session (any user), writes role=assistant with
        metadata.origin='proactive'. The existing chat UI renders assistant
        messages — we rely on metadata.origin to differentiate.
        """
        from sqlalchemy import select
        from db.database import get_session
        from db.models import ChatMessage, ChatSession

        async with get_session() as db:
            # Pick the most recently active session — proactive messages ride
            # along with the last real conversation.
            result = await db.execute(
                select(ChatSession).order_by(ChatSession.started_at.desc()).limit(1)
            )
            session = result.scalar_one_or_none()
            if session is None:
                logger.debug("proactive: no chat session exists; skipping emit")
                return
            msg = ChatMessage(
                id=str(uuid.uuid4()),
                session_id=session.id,
                user_id=session.user_id,
                role="assistant",
                content=message[:2000],
                response_form="text",
                metadata_json=json.dumps({
                    "origin": "proactive",
                    "priority": priority,
                    "reason": reason,
                    "emotion": (
                        ctx["emotion"].model_dump(mode="json") if ctx.get("emotion") else None
                    ),
                }, default=str),
                attachments_json="[]",
            )
            db.add(msg)
            session.message_count += 1  # type: ignore[operator]
            await db.flush()
            payload = {
                "message": {
                    "id": msg.id,
                    "session_id": msg.session_id,
                    "user_id": msg.user_id,
                    "role": msg.role,
                    "content": msg.content,
                    "response_form": msg.response_form,
                    "metadata": json.loads(msg.metadata_json),
                    "created_at": msg.created_at.isoformat() if msg.created_at else None,
                },
                "session_id": msg.session_id,
                "origin": "proactive",
                "priority": priority,
            }
        # Emit WS *after* commit so listeners never see a phantom row.
        with contextlib.suppress(Exception):
            from api.websocket_hub import hub
            await hub.broadcast("chat", "message.proactive", payload)

    # ── Helpers ──────────────────────────────────────────────────────────────

    def _current_emotion(self) -> EmotionVector | None:
        slot = self.runtime.foreground_slot
        if slot is None:
            return None
        return slot.self_model.emotion

    def _minutes_since_user(self) -> float | None:
        if self._last_user_interaction_at is None:
            return None
        delta = _utcnow() - self._last_user_interaction_at
        return delta.total_seconds() / 60.0

    def _has_recent_chat(self, ctx: dict[str, Any]) -> bool:
        """True iff the user has interacted within the configured 'long silence'
        threshold. If we never saw a user interaction at all, False."""
        threshold_min = int(getattr(config, "agent_proactive_long_silence_threshold_min", 120) or 120)
        minutes = ctx.get("minutes_since_user")
        if minutes is None:
            return False
        # Within threshold = recent chat.
        return minutes <= threshold_min


# Module-level singleton — wired up from main.py lifespan.
proactive_loop: ProactiveLoop | None = None


def get_loop() -> ProactiveLoop | None:
    return proactive_loop


def set_loop(loop: ProactiveLoop | None) -> None:
    global proactive_loop
    proactive_loop = loop


def check_long_silence(threshold_min: int | None = None) -> bool:
    """
    Callable (e.g. by cron-like pulse in the runner) to check long-silence
    trigger. Pushes LONG_SILENCE trigger if true. Returns True iff pushed.
    Dedup: at most one LONG_SILENCE per 30 minutes.
    """
    loop = get_loop()
    if loop is None:
        return False
    minutes = loop._minutes_since_user()
    if minutes is None:
        return False
    threshold = float(
        threshold_min if threshold_min is not None
        else getattr(config, "agent_proactive_long_silence_threshold_min", 120) or 120
    )
    if minutes < threshold:
        return False
    # Dedup within the last 30 min.
    now = _utcnow()
    for t in reversed(loop._recent_triggers):
        if t.kind == ProactiveTriggerKind.LONG_SILENCE and (now - t.ts) < timedelta(minutes=30):
            return False
    loop.push_trigger(ProactiveTrigger(
        kind=ProactiveTriggerKind.LONG_SILENCE,
        context={"minutes": round(minutes, 1)},
        priority=3,
    ))
    return True


__all__ = [
    "ProactiveLoop",
    "get_loop",
    "set_loop",
    "check_long_silence",
]
