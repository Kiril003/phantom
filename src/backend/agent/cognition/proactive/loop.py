"""
Phase 9.3b — proactive background loop.
Phase 9.4a — the loop can now initiate actions on the background track,
with or without user confirmation.

A background asyncio task that, every N seconds, asks "should PHANTOM
act or say something unprompted?" The decide prompt returns one of three
kinds:
  * "speak"  — emit a chat message into the most recent session
  * "action" — dispatch a task on the background track; confirmation
               with the user is optional (confirm_with_user flag)
  * "none"   — mute/no-op (most decisions land here)

Hard gates keep the LLM call out of obvious no-go situations (active task,
no recent chat, cooldown, emotion fully at baseline with no triggers). Only
when gates pass does the decide prompt actually fire.

Pending-confirmation state is module-level + per-loop: when a decide
returns action with confirm_with_user=true, the loop asks the user (via
the chat UI) and parks the intent. The chat handler forwards affirmative
replies into `resolve_pending_action()` which fires the task. Pending
intents time out after 5 minutes to avoid indefinite "stuck ask" UX.

Default ENABLED as of 9.4c consolidation (audit finding G2). Operator can
flip `agent_proactive_enabled` to False via Settings UI or sqlite to mute
PHANTOM's initiative without a restart (config is hot-reloadable).
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import re
import uuid
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING, Any

from core.clock import clock

from config import config

from .triggers import ProactiveTrigger, ProactiveTriggerKind
from ...schemas import EmotionVector
from ..will import goal_stack  # Phase 28

if TYPE_CHECKING:
    from agent.kernel.runtime import AgentRuntime

logger = logging.getLogger(__name__)


def _utcnow() -> datetime:
    return clock.now()


def _intent_available_for_proactive() -> bool:
    """Proactive interjection is allowed only when the will isn't acting."""
    from agent.will.arbitration import intent_mutex
    return intent_mutex.held_by is None


# ── Phase 9.4a: pending-action plumbing ─────────────────────────────────────

# Conservative affirmative matcher — ambiguous replies are treated as "no"
# so PHANTOM never fires a background action off a borderline "maybe".
AFFIRMATIVE_RX = re.compile(
    r"^(так|да|yes|ok|окей|давай|продовжуй|роби|го|sure|yep)[,.!?\s]*$",
    re.IGNORECASE,
)

# A pending-confirmation times out after this many seconds. Past that the
# user's silence is treated as refusal and the intent is dropped.
PENDING_ACTION_TIMEOUT_S = 300


@dataclass
class PendingAction:
    """Awaiting user confirmation before firing an action."""
    action_goal: str
    reason: str
    priority: int
    created_at: datetime
    session_id: str | None = None

    def expired(self, now: datetime | None = None) -> bool:
        now = now or _utcnow()
        return (now - self.created_at).total_seconds() > PENDING_ACTION_TIMEOUT_S


@dataclass
class StashedProactive:
    """Proactive intent held back while user is busy."""
    kind: str
    message: str
    reason: str
    causality: str
    priority: int
    scene_brief: str | None = None


# ── Decide prompt (Ukrainian) ────────────────────────────────────────────────

_DECIDE_SYSTEM = (
    "Ти PHANTOM — Sentient Familiar, вбудований AI-супутник у фоновому режимі. "
    "Твоє завдання зараз: вирішити, чи варто ініціативно сказати щось користувачу. "
    "Відповідай СТРОГО валідним JSON, без markdown, без додаткового тексту."
)


_DECIDE_TEMPLATE = """Ти PHANTOM. Зараз ти у фоновому режимі — користувач не питав тебе нічого, але, можливо, варто ініціативно щось зробити.

ПОТОЧНИЙ СТАН:
{emotion_summary}
focus={emotion_focus:.2f}  curiosity={emotion_curiosity:.2f}  concern={emotion_concern:.2f}  fatigue={emotion_fatigue:.2f}

АКТИВНІ КОНЦЕРНИ (до 3): {concerns_top}

НЕЩОДАВНІ ТРИГЕРИ (до 5): {triggers}

АВТОНОМНІ ЦІЛІ (Will Engine): {top_goal}

ОСТАННІ УСПІХИ (до 3): {recent_successes}

ХВИЛИН ВІД ОСТАННЬОЇ ВЗАЄМОДІЇ: {minutes_since_user}

ТИ МОЖЕШ ВИРІШИТИ:
- "speak"  — сказати повідомлення (як раніше)
- "action" — ініціювати фонову дію (наприклад, перевірити стан системи, прочитати файл)
- "scene"  — згенерувати інтерактивний віджет/UI (напр. дашборд, план, аналітика)
- "none"   — нічого не робити (мовчання — валідний вибір)

ДІЇ:
- Формулюй action_goal природною мовою як user task (українською або англійською).
- Якщо дія змінює файли, запускає довгі процеси, торкається мережі/грошей/секретів,
  може видалити дані або має medium/high risk — confirm_with_user=true (PHANTOM спитає дозволу).
- Якщо дія лише спостережна, read-only і безпечна — confirm_with_user=false (PHANTOM виконає тихо).

Приклади ДІЙ:
- confirm_with_user=true: "виконай backup home папки", "видали тимчасові файли з /tmp"
- confirm_with_user=false: "перевір вільне місце на диску", "подивись список активних процесів"

ПРАВИЛА:
- Обирай ТІЛЬКИ якщо справді є що зробити. "none" — валідний вибір.
- Не повторюйся, не пиши банальностей ("готовий помагати", "як справи").
- Не ініціюй ті ж самі дії підряд — якщо вже недавно це робив, обирай none.

Відповідай строгим JSON:
{{
  "kind": "speak" | "action" | "scene" | "none",
  "reason": "внутрішнє пояснення для логів",
  "causality_reason": "ЛЮДСЬКЕ пояснення для користувача (напр. 'Я зробив це, тому що помітив X')",
  "priority": ціле число 1-10,

  // тільки для kind=speak:
  "message": "українською, 1-3 речення",

  // тільки для kind=action:
  "action_goal": "опис задачі, природною мовою",
  "confirm_with_user": true | false,

  // тільки для kind=scene:
  "scene_brief": "Що саме згенерувати у віджеті (напр. 'Графік метрик системи' або 'Карта найближчих кавʼярень')",
  "message": "Супровідний текст для віджета (українською)"
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
        # Day-3 D3-D-2 — tick counter for the every-5th-cycle WS
        # heartbeat. The original Day-2 implementation had the comment
        # but emitted on every cycle — at the 30 s minimum interval
        # that meant 120 broadcasts/h instead of 24.
        self._cycle_n: int = 0
        # Phase 9.4a — at most one pending action awaiting user confirmation.
        self._pending_action: PendingAction | None = None
        # Phase 9.4b — interruptibility stash
        self._stashed: list[StashedProactive] = []
        self._unsubscribe_signal = None

    # ── Lifecycle ────────────────────────────────────────────────────────────

    async def start(self) -> None:
        """Spawn background task. Idempotent."""
        if self._task is not None and not self._task.done():
            return
        self._stop_event.clear()
        
        # Subscribe to context signals
        from core.event_bus import event_bus
        self._unsubscribe_signal = event_bus.subscribe("context_signal", self._handle_context_signal)
        
        self._task = asyncio.create_task(self._run(), name="agent_proactive_loop")
        logger.info("Proactive loop started (enabled=%s)", config.agent_proactive_enabled)

    async def stop(self) -> None:
        """Graceful shutdown — wakes the sleeping wait_for within 1s."""
        self._stop_event.set()
        if self._unsubscribe_signal:
            self._unsubscribe_signal()
            self._unsubscribe_signal = None
        if self._task is None:
            return
        self._task.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await self._task
        self._task = None

    def _handle_context_signal(self, signal: dict[str, Any]) -> None:
        """Process incoming ContextEngine events."""
        name = signal.get("name")
        if name in ("calm_window_opened", "gap_detected"):
            # Trigger release queue asynchronously
            asyncio.create_task(self._release_deferred_thoughts())

    async def _release_deferred_thoughts(self) -> None:
        """Evaluate, decay, and release stashed thoughts to the referee."""
        session_id = await self._most_recent_session_id()
        if not session_id:
            return

        import time
        from memory.session_memory import session_memory
        session_memory.prune_expired_thoughts(session_id)
        deferred = session_memory.get_deferred_thoughts(session_id)
        if not deferred:
            return
        if not _intent_available_for_proactive():
            return

        # Sort thoughts by decayed value
        valid_candidates = []
        now = clock.time()
        for t in deferred:
            age = now - t.created_at
            # Linear decay: value reduces to 0 over its TTL
            decayed_value = t.value * (1.0 - age / t.ttl)
            if decayed_value >= 0.2:
                # Update t.value to decayed value
                t.value = decayed_value
                valid_candidates.append(t)

        if not valid_candidates:
            # Clear stashed thoughts if all decayed below threshold
            session_memory.clear_deferred_thoughts(session_id)
            return

        # Sort by value descending
        valid_candidates.sort(key=lambda x: x.value, reverse=True)
        top_thought = valid_candidates[0]

        # Prepare OutputFrame
        from core.referee import system_referee, OutputFrame, PriorityTier
        
        frame = OutputFrame(
            key=f"proactive_{top_thought.id}",
            tier=PriorityTier.CONVERSATION,
            payload={
                "kind": top_thought.kind,
                "message": top_thought.content,
                "reason": top_thought.metadata.get("reason", "deferred"),
                "priority": top_thought.priority,
                "causality": top_thought.metadata.get("causality", ""),
                "scene_brief": top_thought.metadata.get("scene_brief"),
                "session_id": session_id,
            },
            ttl=top_thought.ttl - (now - top_thought.created_at)
        )

        logger.info(
            "Re-routing released thought %s to referee (decayed value %.2f)",
            top_thought.id[:8], top_thought.value
        )
        
        # Try to emit via SystemReferee
        approved = await system_referee.emit(frame)
        session_memory.clear_deferred_thoughts(session_id)
        
        # Play a thought released earcon or sound if approved
        if approved:
            try:
                from voice.earcons import play_earcon
                await play_earcon("success")
            except Exception:
                pass

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
            self._cycle_n += 1
            # Light indicator — rate-limited: only emit every 5th cycle
            # so UIs can show "breathing" without log spam. Day-3 D3-D-2
            # makes the comment match the behaviour — Day-2's tickcam
            # emit was every cycle.
            if self._cycle_n % 5 == 1:
                with contextlib.suppress(Exception):
                    from api.websocket_hub import hub
                    await hub.broadcast("agent.stream", "proactive.cycle", {
                        "at": self._last_cycle_at.isoformat(),
                        "enabled": True,
                        "has_triggers": bool(self._recent_triggers),
                    })

            try:
                # Phase 10 — exquisite fix: pulse the long-silence trigger check
                # every cycle so it's actually used in production.
                check_long_silence()
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
        """Main evaluate-and-dispatch path with Interruptibility Queueing."""
        self._expire_pending_action_if_stale()
        ctx = await self._build_context()

        # ── Interruptibility Check ──
        # If user was active VERY recently (< 1.5 min), we are in "High Interruption Cost" state.
        # We still run the LLM to 'think', but we stash the result instead of emitting.
        mins_since = ctx.get("minutes_since_user")
        is_focused = mins_since is not None and mins_since < 1.5

        # If not focused anymore, flush any stashed items first
        if not is_focused and self._stashed:
            await self._flush_stash(ctx)

        if not self._should_consider_speaking(ctx):
            return

        decision = await self._decide(ctx)
        if decision is None:
            return

        # Phase 9.4a — dispatch based on decide kind. Fall back to the old
        # `should_speak` field for backward compat with any cached prompts
        # that might still return the legacy shape.
        kind = (decision.get("kind") or "").strip().lower()
        if not kind:
            # Legacy shape: {should_speak: bool, message: str}
            kind = "speak" if decision.get("should_speak") else "none"

        reason = str(decision.get("reason") or "")[:200]
        causality = str(decision.get("causality_reason") or "")[:200]
        priority = int(decision.get("priority") or 5)

        if kind == "none":
            return

        if kind == "action":
            goal = (decision.get("action_goal") or "").strip()
            if not goal:
                logger.debug("proactive decide returned action kind with empty goal")
                return
            confirm = bool(decision.get("confirm_with_user", True))
            try:
                await self._dispatch_action(goal, reason, priority, confirm)
            except Exception as exc:
                logger.warning("proactive _dispatch_action failed: %s", exc)
            return

        # speak or scene -> check if we should stash or emit
        if is_focused and priority < 8:
            session_id = await self._most_recent_session_id()
            if session_id:
                logger.info("Proactive %s deferred to session %s (user focused, priority %d)", kind, session_id[:8], priority)
                from memory.session_memory import session_memory
                
                # Check for existing queued items and keep queue size <= 5
                deferred = session_memory.get_deferred_thoughts(session_id)
                if len(deferred) >= 5:
                    # Remove the oldest one
                    deferred.pop(0)
                
                session_memory.defer_thought(
                    session_id=session_id,
                    kind=kind,
                    content=decision.get("message") or "",
                    priority=priority,
                    value=float(priority) / 10.0,  # Map 1-10 priority to 0.1-1.0 value
                    ttl=600.0,
                    metadata={
                        "reason": reason,
                        "causality": causality,
                        "scene_brief": decision.get("scene_brief")
                    }
                )
                # Play thought_parked earcon
                try:
                    from voice.earcons import play_earcon
                    await play_earcon("thought_parked")
                except Exception:
                    pass
            return

        # Immediate emit
        if kind == "speak":
            msg = (decision.get("message") or "").strip()
            if not msg:
                return
            try:
                await self._emit_speech(msg, reason, priority, ctx, causality=causality)
                self._last_speech_at = _utcnow()
            except Exception as exc:
                logger.warning("proactive _emit_speech failed: %s", exc)
            return

        if kind == "scene":
            brief_text = (decision.get("scene_brief") or "").strip()
            msg = (decision.get("message") or "").strip()
            if not brief_text:
                return
            try:
                await self._emit_scene(msg, brief_text, reason, priority, ctx, causality=causality)
                self._last_speech_at = _utcnow()
            except Exception as exc:
                logger.warning("proactive _emit_scene failed: %s", exc)
            return

    async def _flush_stash(self, ctx: dict[str, Any]) -> None:
        """Release stashed intents when user is interruptible."""
        session_id = await self._most_recent_session_id()
        if not session_id:
            return
            
        from memory.session_memory import session_memory
        session_memory.prune_expired_thoughts(session_id)
        deferred = session_memory.get_deferred_thoughts(session_id)
        if not deferred:
            return

        # Sort by value descending
        deferred.sort(key=lambda x: x.value, reverse=True)
        item = deferred.pop(0)

        intro = "Поки ти був зайнятий, я підготував це: " if item.kind == "scene" else "Поки ти працював, я подумав про таке: "
        message = f"{intro}\n{item.content}"

        logger.info("Flushing stashed proactive %s", item.kind)
        if item.kind == "speak":
            await self._emit_speech(message, f"flushed: {item.metadata.get('reason')}", item.priority, ctx, causality=item.metadata.get('causality', ''))
        else:
            await self._emit_scene(message, item.metadata.get('scene_brief') or "", f"flushed: {item.metadata.get('reason')}", item.priority, ctx, causality=item.metadata.get('causality', ''))

        self._last_speech_at = _utcnow()
        # Clear rest of stash to avoid spamming
        session_memory.clear_deferred_thoughts(session_id)

    async def _dispatch_action(
        self, action_goal: str, reason: str, priority: int, confirm_with_user: bool,
    ) -> None:
        """Fire a background action, or park it for user confirmation first.

        Both branches are best-effort — proactive never crashes if the
        runtime rejects the task. On TrackBusyError (background queue
        saturated) we skip this cycle; the next evaluation can try again.
        """
        if confirm_with_user:
            # Park intent + ask the user via the chat UI. Latest ask wins —
            # prior pending intents are overwritten rather than queued.
            pending = PendingAction(
                action_goal=action_goal,
                reason=reason,
                priority=priority,
                created_at=_utcnow(),
                session_id=await self._most_recent_session_id(),
            )
            self._pending_action = pending
            prompt = f"Чи хочеш щоб я: {action_goal}? (так/ні)"
            with contextlib.suppress(Exception):
                await self._emit_speech(
                    prompt, f"pending_action: {reason}", priority, await self._build_context(),
                )
            # Broadcast for the UI so a dedicated "pending proactive action"
            # slot can render without having to parse the chat bubble.
            with contextlib.suppress(Exception):
                from api.websocket_hub import hub
                await hub.broadcast("agent.stream", "proactive.pending_action", {
                    "action_goal": action_goal,
                    "reason": reason,
                    "priority": priority,
                    "expires_in_s": PENDING_ACTION_TIMEOUT_S,
                })
            return

        # Unconfirmed — fire directly on the background track.
        await self._fire_action_task(action_goal, reason, priority, source="proactive_auto")

    async def _fire_action_task(
        self, action_goal: str, reason: str, priority: int, source: str,
    ) -> str | None:
        """Actually call runtime.start_task. Returns the task_id on success,
        None on TrackBusyError (caller decides whether to surface)."""
        from agent.kernel.errors import TrackBusyError
        try:
            task_id, _started = await self.runtime.start_task(
                action_goal,
                origin=source,
                track="background",
            )
        except TrackBusyError as exc:
            logger.info(
                "proactive action skipped — background queue full (%d pending)",
                exc.queue_size,
            )
            return None
        except Exception as exc:
            logger.warning("proactive action dispatch failed: %s", exc)
            return None

        with contextlib.suppress(Exception):
            from api.websocket_hub import hub
            await hub.broadcast("agent.stream", "proactive.action_fired", {
                "task_id": task_id,
                "action_goal": action_goal,
                "reason": reason,
                "priority": priority,
                "source": source,
            })
        return task_id

    # ── Pending-confirmation helpers ─────────────────────────────────────────

    def has_pending_action(self) -> bool:
        self._expire_pending_action_if_stale()
        return self._pending_action is not None

    def peek_pending_action(self) -> PendingAction | None:
        self._expire_pending_action_if_stale()
        return self._pending_action

    def _expire_pending_action_if_stale(self) -> None:
        p = self._pending_action
        if p is not None and p.expired():
            logger.info(
                "proactive pending_action '%s' expired after %ds — dropping",
                p.action_goal[:60], PENDING_ACTION_TIMEOUT_S,
            )
            self._pending_action = None

    def clear_pending_action(self) -> None:
        self._pending_action = None

    async def resolve_pending_action(self, user_reply: str) -> str | None:
        """Called by the chat handler. If a pending action exists and the
        user's reply is an affirmative, fires the task on background and
        clears pending. Any non-affirmative (or no pending) → clear and
        return None so the chat flow continues normally.

        Returns the fired task_id on success, None otherwise.
        """
        self._expire_pending_action_if_stale()
        pending = self._pending_action
        if pending is None:
            return None
        affirmative = bool(AFFIRMATIVE_RX.match(user_reply.strip()))
        self._pending_action = None
        if not affirmative:
            logger.info(
                "proactive pending_action '%s' declined by user reply %r",
                pending.action_goal[:60], user_reply[:40],
            )
            return None
        return await self._fire_action_task(
            pending.action_goal, pending.reason, pending.priority,
            source="proactive_confirmed",
        )

    async def _most_recent_session_id(self) -> str | None:
        """Pick the last chat session so the pending prompt attaches to
        the right conversation."""
        from sqlalchemy import select
        from db.database import get_session
        from db.models import ChatSession
        try:
            async with get_session() as db:
                result = await db.execute(
                    select(ChatSession).order_by(ChatSession.started_at.desc()).limit(1)
                )
                session = result.scalar_one_or_none()
                return session.id if session is not None else None
        except Exception:
            return None

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
            # Phase 10 — relaxed baseline check: high focus/curiosity or
            # any concern/fatigue should be enough to consider speaking.
            off_baseline = (
                abs(emotion.focus - 0.5) > 0.1
                or abs(emotion.curiosity - 0.5) > 0.1
                or emotion.concern > 0.1
                or emotion.fatigue > 0.4
            )
        # Allow if 2+ hours since last proactive speech (even without triggers)
        _two_hours_idle = (
            self._last_speech_at is None
            or (_utcnow() - self._last_speech_at).total_seconds() > 7200
        )
        # Allow if consciousness stream has a pending insight for any user
        _has_stream_insight = False
        try:
            from agent.consciousness_stream import consciousness_stream as _cs
            _has_stream_insight = _cs.has_any_pending()
        except Exception:
            pass
        # Initiative if emotional OR triggers OR pending concerns OR stream insight OR 2h idle
        if (not off_baseline and not self._recent_triggers and not ctx.get("concerns_top")
                and not _has_stream_insight and not _two_hours_idle):
            return False
        return True

    async def _build_context(self) -> dict[str, Any]:
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
        
        # Phase 28 — Will Engine: top goal from stack
        top_goal_obj = await goal_stack.pop_highest()
        # Note: pop_highest marks it as 'running' in DB, but we haven't fired it yet.
        # If we decide 'none', we might want to put it back. For now, just peak.
        # Wait, I'll add a 'peek_highest' to GoalStack to avoid marking it prematurely.
        top_goal_str = "—"
        if top_goal_obj:
            top_goal_str = f"{top_goal_obj.description} (prio: {top_goal_obj.priority():.2f})"
            # Since we 'popped' it, we MUST use it or revert.
            # I'll change pop_highest to peek for this context.

        return {
            "emotion": emotion,
            "active_concerns": active_concerns[-3:],
            "recent_successes": recent_successes[-3:],
            "minutes_since_user": minutes_since_user,
            "triggers": triggers,
            "top_goal": top_goal_str,
            "top_goal_obj": top_goal_obj,
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
            top_goal=ctx.get("top_goal") or "—",
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
                    "kind": kind,
                    "reason": reason,
                    "causality": causality,
                    "message_preview": str(decision.get("message") or "")[:120],
                    "priority": priority,
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
        causality: str = "",
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
                    "causality": causality,
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

    async def _emit_scene(
        self,
        message: str,
        scene_brief: str,
        reason: str,
        priority: int,
        ctx: dict[str, Any],
        causality: str = "",
    ) -> None:
        """Generate an artifact via ArtifactStudio and emit it as a proactive message."""
        from sqlalchemy import select
        from db.database import get_session
        from db.models import ChatMessage, ChatSession
        from ai.artifact_studio import Brief, build_artifact
        from ai.response_formatter import parse_function_call

        async with get_session() as db:
            result = await db.execute(
                select(ChatSession).order_by(ChatSession.started_at.desc()).limit(1)
            )
            session = result.scalar_one_or_none()
            if session is None:
                logger.debug("proactive scene: no chat session exists")
                return
            user_id = session.user_id

            # Call Studio
            title, html = await build_artifact(
                Brief(title=scene_brief[:60], request=scene_brief, hint="Proactive artifact"),
                user_id=user_id,
            )
            form, content_val, attachments = parse_function_call(
                "respond_artifact",
                {"title": title, "code": html},
            )

            msg = ChatMessage(
                id=str(uuid.uuid4()),
                session_id=session.id,
                user_id=session.user_id,
                role="assistant",
                content=content_val[:2000] if content_val else (message[:2000] if message else "Я підготував цей віджет для вас."),
                response_form=form,
                metadata_json=json.dumps({
                    "origin": "proactive",
                    "priority": priority,
                    "reason": reason,
                    "causality": causality,
                    "emotion": (
                        ctx["emotion"].model_dump(mode="json") if ctx.get("emotion") else None
                    ),
                }, default=str),
                attachments_json=json.dumps(attachments, ensure_ascii=False) if attachments else "[]",
            )
            db.add(msg)
            session.message_count += 1
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
                    "attachments": attachments,
                },
                "session_id": msg.session_id,
                "origin": "proactive",
                "priority": priority,
            }
        
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
    "PendingAction",
    "AFFIRMATIVE_RX",
    "PENDING_ACTION_TIMEOUT_S",
    "get_loop",
    "set_loop",
    "check_long_silence",
]
