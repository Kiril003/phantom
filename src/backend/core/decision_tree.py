"""
DecisionTree — priority-based autonomous decisions.
Evaluates ContextSnapshot and decides if AI should initiate dialogue,
send actuator commands, or emit alerts.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Optional

from config import config
from core.event_bus import event_bus

logger = logging.getLogger(__name__)


@dataclass
class DecisionAction:
    priority: int          # lower = higher priority
    kind: str              # "ai_speak" | "actuator" | "alert" | "state_change"
    payload: dict = field(default_factory=dict)
    reason: str = ""


class DecisionTree:
    """
    Evaluates the current ContextSnapshot and enqueues actions.
    Called every 500ms from the main loop.
    """

    def __init__(self) -> None:
        self._pending: list[DecisionAction] = []
        self._last_initiative_ts = 0.0
        self._ai_initiative_pending = False

    # ── Public API ─────────────────────────────────────────────────────────────

    def evaluate(self, snapshot: dict) -> list[DecisionAction]:
        """
        Evaluate snapshot and return sorted list of actions.
        Side-effects: emits events via EventBus.
        """
        actions: list[DecisionAction] = []

        actions.extend(self._check_health(snapshot))
        actions.extend(self._check_environment(snapshot))
        actions.extend(self._check_calendar(snapshot))
        actions.extend(self._check_ai_initiative(snapshot))
        actions.extend(self._check_actuators(snapshot))

        # Sort by priority
        actions.sort(key=lambda a: a.priority)

        # Update initiative flag for state machine
        self._ai_initiative_pending = any(
            a.kind == "ai_speak" for a in actions
        )

        # Emit high-priority alerts
        for action in actions:
            if action.priority <= 2:
                event_bus.emit("decision_action", action)

        self._pending = actions
        return actions

    def has_pending_initiative(self) -> bool:
        return self._ai_initiative_pending

    def consume_initiative(self) -> Optional[DecisionAction]:
        """Pop first ai_speak action."""
        for i, action in enumerate(self._pending):
            if action.kind == "ai_speak":
                self._pending.pop(i)
                self._ai_initiative_pending = any(
                    a.kind == "ai_speak" for a in self._pending
                )
                return action
        return None

    # ── Decision rules ─────────────────────────────────────────────────────────

    def _check_health(self, snap: dict) -> list[DecisionAction]:
        actions: list[DecisionAction] = []
        body = snap.get("body", {})
        stress = body.get("stress_level", 0.0)
        bpm = body.get("breathing_bpm")
        state = snap.get("system", {}).get("state", "SHADOW")

        # High stress + fast breathing → health alert
        if stress > 0.7 and bpm is not None and bpm > 28:
            actions.append(DecisionAction(
                priority=2,
                kind="alert",
                payload={"level": 2, "title": "Підвищений стрес", "body": f"Дихання {bpm:.0f} bpm"},
                reason="high_stress_breathing",
            ))

        # Suggest breathing exercise if in FOCUS with elevated stress
        if state in ("FOCUS", "DIALOGUE") and stress > 0.6:
            if self._can_initiate():
                actions.append(DecisionAction(
                    priority=3,
                    kind="ai_speak",
                    payload={"prompt_hint": "suggest_breathing_exercise"},
                    reason="elevated_stress",
                ))

        return actions

    def _check_environment(self, snap: dict) -> list[DecisionAction]:
        actions: list[DecisionAction] = []
        env = snap.get("env", {})
        aqi = env.get("aqi")

        if aqi is not None and aqi > 150:
            actions.append(DecisionAction(
                priority=2,
                kind="alert",
                payload={"level": 2, "title": "Погана якість повітря", "body": f"AQI {aqi}"},
                reason="high_aqi",
            ))

        return actions

    def _check_calendar(self, snap: dict) -> list[DecisionAction]:
        actions: list[DecisionAction] = []
        history = snap.get("history", {})
        pending = history.get("pending_events_1h", 0)

        if pending > 0 and self._can_initiate():
            actions.append(DecisionAction(
                priority=3,
                kind="ai_speak",
                payload={"prompt_hint": "remind_upcoming_event"},
                reason="calendar_reminder",
            ))

        return actions

    def _check_ai_initiative(self, snap: dict) -> list[DecisionAction]:
        """Periodic AI initiative — speak if idle long enough."""
        if not config.ai_initiative_enabled:
            return []

        actions: list[DecisionAction] = []
        state = snap.get("system", {}).get("state", "SHADOW")
        history = snap.get("history", {})
        idle_s = history.get("last_interaction_ago_s", 0)

        if state not in ("FOCUS",):
            return []

        cooldown = config.ai_initiative_cooldown_s
        if idle_s > cooldown and self._can_initiate():
            actions.append(DecisionAction(
                priority=5,
                kind="ai_speak",
                payload={"prompt_hint": "check_in"},
                reason="idle_initiative",
            ))

        return actions

    def _check_actuators(self, snap: dict) -> list[DecisionAction]:
        """Drive OLED and RGB based on state."""
        actions: list[DecisionAction] = []
        state = snap.get("system", {}).get("state", "SHADOW")
        body = snap.get("body", {})

        if state == "SENTINEL":
            actions.append(DecisionAction(
                priority=1,
                kind="actuator",
                payload={"type": "rgb", "id": 0, "color": "FF0000", "mode": "pulse", "speed_ms": 500},
                reason="sentinel_alert",
            ))
        elif state == "DREAM":
            actions.append(DecisionAction(
                priority=6,
                kind="actuator",
                payload={"type": "rgb", "id": 0, "color": "9B00D4", "mode": "breathe", "speed_ms": 4000},
                reason="dream_ambience",
            ))
        elif state == "GHOST":
            actions.append(DecisionAction(
                priority=0,
                kind="actuator",
                payload={"type": "rgb", "id": 0, "color": "000000", "mode": "off"},
                reason="ghost_dark",
            ))

        return actions

    def _can_initiate(self) -> bool:
        """Respect cooldown between initiatives."""
        elapsed = time.monotonic() - self._last_initiative_ts
        if elapsed >= config.ai_initiative_cooldown_s:
            self._last_initiative_ts = time.monotonic()
            return True
        return False


# Singleton
decision_tree = DecisionTree()
