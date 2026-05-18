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
    OPERATOR = "OPERATOR"

    ALL = {SHADOW, FOCUS, DIALOGUE, SENTINEL, GHOST, DREAM, OPERATOR}


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
    time_in_state_ms: int = 0,
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
        # 2026-05-09 — DIALOGUE auto-exit removed. Both the 30 s grace
        # (c28f0cd) and the record_interaction wiring (f3b9831) still
        # could not stop the bouncing because the operator types for
        # longer than the predicate's window. Real ad-hoc conversations
        # have arbitrary pauses; an idle-clock kick is the wrong
        # signal. DIALOGUE now exits only via:
        #   • explicit POST /context/state from the UI / hotkey,
        #   • SENTINEL pre-emption (threat detected, priority 1),
        #   • GHOST toggle (priority 0),
        # …all of which are evaluated above this branch. A future
        # sensor-driven exit (operator walked away — radar empty +
        # camera lost face for 5 min) can be added back here without
        # reintroducing the chat-typing race.
        pass

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
        # Phase 9.1 — OPERATOR substate, broadcast alongside the main state.
        self._operator_substate: str = "idle"
        # Snapshot of state we were in BEFORE entering OPERATOR. Restored on
        # task.completed / task.failed so the user sees the same surface they
        # left when the agent finishes. task.stopped routes to SHADOW (safety
        # default). NB: kept separate from `_previous` because that one tracks
        # the immediately-prior state for transition guards (e.g. DIALOGUE
        # returning to FOCUS), and we don't want OPERATOR exits to clobber it.
        self._pre_operator_state: Optional[str] = None

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

    @property
    def operator_substate(self) -> str:
        return self._operator_substate

    def set_operator_substate(self, sub: str) -> None:
        self._operator_substate = sub

    def enter_operator(self, trigger: str) -> StateTransition:
        if self._current != SystemState.OPERATOR:
            self._pre_operator_state = self._current
        return self.force_transition(SystemState.OPERATOR, trigger)

    def exit_operator(self, trigger: str, *, to_safe: bool = False) -> StateTransition | None:
        if self._current != SystemState.OPERATOR:
            return None
        target = SystemState.SHADOW if to_safe else (self._pre_operator_state or SystemState.SHADOW)
        self._pre_operator_state = None
        self._operator_substate = "idle"
        return self.force_transition(target, trigger)

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
        now_ms = int(time.time() * 1000)
        last_ts_ms = (
            self._last_transition.timestamp if self._last_transition else now_ms
        )
        time_in_state_ms = max(0, now_ms - last_ts_ms)

        candidates = _get_candidates(
            current=self._current,
            snap=snapshot,
            previous=self._previous,
            stt_listening=self._stt_listening,
            tts_playing=self._tts_playing,
            ai_initiative=self._ai_initiative,
            time_in_state_ms=time_in_state_ms,
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
