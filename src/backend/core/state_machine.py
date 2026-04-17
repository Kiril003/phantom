"""
State Machine — PHANTOM OS FSM.
States: SHADOW, FOCUS, DIALOGUE, SENTINEL, GHOST, DREAM
Evaluates guard conditions from ContextSnapshot and returns StateTransition.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Optional

from core.event_bus import event_bus

logger = logging.getLogger(__name__)


class SystemState:
    SHADOW = "SHADOW"
    FOCUS = "FOCUS"
    DIALOGUE = "DIALOGUE"
    SENTINEL = "SENTINEL"
    GHOST = "GHOST"
    DREAM = "DREAM"

    ALL = {SHADOW, FOCUS, DIALOGUE, SENTINEL, GHOST, DREAM}


@dataclass
class StateTransition:
    from_state: str
    to_state: str
    trigger: str
    timestamp: int   # unix ms
    auto: bool
    priority: int


# ── Guard Conditions ───────────────────────────────────────────────────────────

def _is_night(snap: dict) -> bool:
    hour = snap.get("when", {}).get("hour", 12)
    return hour >= 23 or hour < 6


def _breathing_calm(snap: dict) -> bool:
    body = snap.get("body", {})
    bpm = body.get("breathing_bpm")
    if bpm is None:
        return False
    stress = body.get("stress_level")
    if stress is None:
        return False
    return 12 <= bpm <= 20 and stress < 0.4


def _other_detected(snap: dict) -> bool:
    presence = snap.get("presence", {})
    if not presence.get("other_detected", False):
        return False
    dist = presence.get("other_distance_cm")
    return dist is not None and dist < 300


def _first_visit(snap: dict) -> bool:
    where = snap.get("where", {})
    return where.get("first_visit", False) or not where.get("place_known", True)


def _screen_active(snap: dict) -> bool:
    """Heuristic: user present + interaction within 2 min."""
    presence = snap.get("presence", {})
    history = snap.get("history", {})
    return (
        presence.get("user_detected", False)
        and history.get("last_interaction_ago_s", 999) < 120
    )


def _breathing_sleep(snap: dict) -> bool:
    body = snap.get("body", {})
    bpm = body.get("breathing_bpm")
    return bpm is not None and bpm < 14


def _no_interaction(snap: dict, threshold_s: float = 120.0) -> bool:
    return snap.get("history", {}).get("last_interaction_ago_s", 0) > threshold_s


def _conversation_ended(snap: dict, stt_listening: bool = False, tts_playing: bool = False) -> bool:
    history = snap.get("history", {})
    return (
        history.get("last_interaction_ago_s", 0) > 30
        and not stt_listening
        and not tts_playing
    )


def _threat_detected(snap: dict) -> bool:
    """Threat: other person at close range in unknown/night location."""
    return _other_detected(snap) and (_first_visit(snap) or _is_night(snap))


def _ghost_trigger(snap: dict) -> bool:
    """Secret: encoder long-press + RGB button index 1 simultaneously."""
    enc = snap.get("encoder")
    btns = snap.get("buttons")
    if enc is None or btns is None:
        return False
    return enc.get("long_press", False) and btns.get("rgb_states", [False, False, False])[1]


# ── Transition Candidates ──────────────────────────────────────────────────────

def _get_candidates(
    current: str,
    snap: dict,
    previous: str,
    stt_listening: bool = False,
    tts_playing: bool = False,
    ai_initiative: bool = False,
) -> list[StateTransition]:
    """Return all valid transitions from current state given snapshot."""
    now_ms = int(time.time() * 1000)
    candidates: list[StateTransition] = []

    def add(to: str, trigger: str, priority: int) -> None:
        candidates.append(StateTransition(
            from_state=current,
            to_state=to,
            trigger=trigger,
            timestamp=now_ms,
            auto=True,
            priority=priority,
        ))

    # GHOST toggle — priority 0 (absolute)
    if _ghost_trigger(snap):
        if current == SystemState.GHOST:
            add(SystemState.SHADOW, "ghost_toggle_off", 0)
        else:
            add(SystemState.GHOST, "ghost_toggle_on", 0)
        return candidates  # GHOST toggle short-circuits everything

    # Security — priority 1
    if current != SystemState.SENTINEL and _threat_detected(snap):
        add(SystemState.SENTINEL, "threat_detected", 1)

    if current == SystemState.SHADOW:
        if _screen_active(snap) and _breathing_calm(snap) and snap.get("when", {}).get("work_hours", False):
            add(SystemState.FOCUS, "work_context_active", 5)
        if _breathing_sleep(snap) and _is_night(snap):
            add(SystemState.DREAM, "breathing_sleep_night", 6)
        if _no_interaction(snap, 120):
            pass  # already in SHADOW, no action

    elif current == SystemState.FOCUS:
        if _no_interaction(snap, 120):
            add(SystemState.SHADOW, "no_interaction_timeout", 7)
        if ai_initiative:
            add(SystemState.DIALOGUE, "ai_initiative", 4)
        if _breathing_sleep(snap) and _is_night(snap):
            add(SystemState.DREAM, "breathing_sleep_night", 6)

    elif current == SystemState.DIALOGUE:
        if _conversation_ended(snap, stt_listening, tts_playing):
            if previous == SystemState.FOCUS:
                add(SystemState.FOCUS, "conversation_ended_return_focus", 5)
            else:
                add(SystemState.SHADOW, "conversation_ended", 7)

    elif current == SystemState.SENTINEL:
        if not _threat_detected(snap):
            add(SystemState.SHADOW, "threat_resolved", 7)

    elif current == SystemState.DREAM:
        when = snap.get("when", {})
        body = snap.get("body", {})
        bpm = body.get("breathing_bpm")
        morning = 6 <= when.get("hour", 0) < 9
        woke_up = bpm is not None and bpm > 16
        if woke_up or morning:
            add(SystemState.SHADOW, "dream_ended", 6)

    elif current == SystemState.GHOST:
        pass  # only exit via ghost_toggle

    return candidates


# ── StateMachine ───────────────────────────────────────────────────────────────

class StateMachine:
    def __init__(self) -> None:
        self._current = SystemState.SHADOW
        self._previous = SystemState.SHADOW
        self._last_transition: Optional[StateTransition] = None
        self._stt_listening = False
        self._tts_playing = False
        self._ai_initiative = False

    @property
    def current_state(self) -> str:
        return self._current

    @property
    def previous_state(self) -> str:
        return self._previous

    @property
    def last_transition(self) -> Optional[StateTransition]:
        return self._last_transition

    def set_voice_state(self, stt: bool, tts: bool) -> None:
        self._stt_listening = stt
        self._tts_playing = tts

    def set_ai_initiative(self, has_initiative: bool) -> None:
        self._ai_initiative = has_initiative

    def force_transition(self, to: str, trigger: str) -> StateTransition:
        """Used for user-initiated transitions (touch, encoder, etc.)."""
        t = StateTransition(
            from_state=self._current,
            to_state=to,
            trigger=trigger,
            timestamp=int(time.time() * 1000),
            auto=False,
            priority=4,
        )
        self._apply(t)
        return t

    def evaluate(self, snapshot: dict) -> Optional[StateTransition]:
        """
        Called every 500ms. Evaluates guard conditions and applies best transition.
        Returns the applied transition or None if state unchanged.
        """
        candidates = _get_candidates(
            current=self._current,
            snap=snapshot,
            previous=self._previous,
            stt_listening=self._stt_listening,
            tts_playing=self._tts_playing,
            ai_initiative=self._ai_initiative,
        )
        if not candidates:
            return None

        best = min(candidates, key=lambda t: t.priority)

        # Don't re-apply same state
        if best.to_state == self._current:
            return None

        self._apply(best)
        return best

    def _apply(self, t: StateTransition) -> None:
        logger.info(
            "State transition: %s → %s [%s] (priority=%d, auto=%s)",
            t.from_state, t.to_state, t.trigger, t.priority, t.auto,
        )
        self._previous = self._current
        self._current = t.to_state
        self._last_transition = t
        event_bus.emit("state_changed", t)


# Singleton
state_machine = StateMachine()
