"""
Phase 9.3a — emotion event engine.

Event-driven updates of the EmotionVector carried on SelfModel. Rules are
intentionally simple deltas per event type, clamped to [0, 1]. A decay loop
drifts each axis toward a baseline so single events don't stick forever.

Emotion colours reasoning (prompt tone) but MUST NOT drive decisions: the
tactical prompt says so explicitly. This module just keeps the axes honest.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from config import config

from .schemas import EmotionVector

if TYPE_CHECKING:
    from .runtime import AgentRuntime

logger = logging.getLogger(__name__)


# Baseline — where each axis drifts toward in the absence of events.
_BASELINE = {
    "focus": 0.5,
    "curiosity": 0.5,
    "concern": 0.1,
    "fatigue": 0.0,
}


# Deltas applied per event_type. Positive = increase, negative = decrease.
# Values picked conservatively so no single event saturates an axis; only
# sustained patterns do.
_DELTAS: dict[str, dict[str, float]] = {
    "task.started":                        {"focus":  0.10, "curiosity":  0.00, "concern":  0.00, "fatigue":  0.00},
    "task.completed":                      {"focus": -0.10, "curiosity":  0.05, "concern": -0.20, "fatigue":  0.10},
    "task.failed":                         {"focus": -0.20, "curiosity":  0.00, "concern":  0.30, "fatigue":  0.15},
    "action.completed":                    {"focus":  0.00, "curiosity":  0.00, "concern":  0.00, "fatigue":  0.02},
    "action.failed":                       {"focus": -0.05, "curiosity":  0.00, "concern":  0.05, "fatigue":  0.03},
    "reflection.completed:continue":       {"focus":  0.05, "curiosity":  0.00, "concern":  0.00, "fatigue":  0.05},
    "reflection.completed:revise":         {"focus":  0.00, "curiosity":  0.10, "concern":  0.10, "fatigue":  0.08},
    "reflection.completed:abandon":        {"focus": -0.10, "curiosity":  0.00, "concern":  0.15, "fatigue":  0.20},
    "blocked_quota.entered":               {"focus": -0.10, "curiosity":  0.00, "concern":  0.20, "fatigue":  0.05},
    "user.interrupted":                    {"focus": -0.05, "curiosity":  0.05, "concern":  0.05, "fatigue":  0.00},
    "user.praise":                         {"focus":  0.10, "curiosity":  0.05, "concern": -0.10, "fatigue": -0.05},
}


def _apply_delta(current: EmotionVector, delta: dict[str, float]) -> EmotionVector:
    """Pure function: return a new EmotionVector with delta applied + clamped."""
    new = EmotionVector(
        focus=current.focus + float(delta.get("focus", 0.0)),
        curiosity=current.curiosity + float(delta.get("curiosity", 0.0)),
        concern=current.concern + float(delta.get("concern", 0.0)),
        fatigue=current.fatigue + float(delta.get("fatigue", 0.0)),
        updated_at=datetime.now(tz=timezone.utc),
    )
    return new.clamp()


def _decay_toward_baseline(current: EmotionVector, rate: float) -> EmotionVector:
    """Pure function: move each axis `rate` of the way toward its baseline."""
    rate = max(0.0, min(1.0, float(rate)))
    def _drift(axis: str, value: float) -> float:
        target = _BASELINE[axis]
        return value + (target - value) * rate
    new = EmotionVector(
        focus=_drift("focus", current.focus),
        curiosity=_drift("curiosity", current.curiosity),
        concern=_drift("concern", current.concern),
        fatigue=_drift("fatigue", current.fatigue),
        updated_at=datetime.now(tz=timezone.utc),
    )
    return new.clamp()


def resolve_event_key(event_type: str, payload: dict | None = None) -> str | None:
    """
    Translate a runtime broadcast event type (plus optional payload) into a
    delta key. Returns None when the event is irrelevant to emotion.

    `reflection.completed` branches on payload.verdict so 'continue'/'revise'/
    'abandon' produce distinct deltas without exploding the caller's surface.
    """
    if event_type == "reflection.completed":
        verdict = ((payload or {}).get("verdict") or "").lower()
        if verdict == "continue":
            return "reflection.completed:continue"
        if verdict in {"revise_subgoal", "revise_strategy"}:
            return "reflection.completed:revise"
        if verdict == "abandon_task":
            return "reflection.completed:abandon"
        return None
    if event_type in _DELTAS:
        return event_type
    # Direct mapping for some aliases used by the runtime.
    if event_type == "task.blocked_quota":
        return "blocked_quota.entered"
    if event_type == "task.intervention_received":
        return "user.interrupted"
    return None


async def update_emotion_on_event(
    runtime: "AgentRuntime",
    event_type: str,
    payload: dict | None = None,
) -> None:
    """
    Main entry point — called by runtime._broadcast after the WS emit.

    Side effects: mutates runtime.self_model.emotion in-place and broadcasts
    `emotion.updated` on `agent.stream`. Silent no-op when:
      - there is no foreground task (self_model unavailable)
      - the event has no mapped delta
      - config.agent_emotion_enabled is False
    """
    if not getattr(config, "agent_emotion_enabled", True):
        return
    if runtime.foreground_slot is None:
        return
    key = resolve_event_key(event_type, payload)
    if key is None:
        return
    delta = _DELTAS.get(key)
    if delta is None:
        return
    sm = runtime.foreground_slot.self_model
    current = sm.emotion or EmotionVector()
    new_emotion = _apply_delta(current, delta)
    sm.emotion = new_emotion
    try:
        from api.websocket_hub import hub
        await hub.broadcast("agent.stream", "emotion.updated", {
            "task_id": runtime.foreground_slot.id,
            "trigger": event_type,
            "emotion": new_emotion.model_dump(mode="json"),
        })
    except Exception as exc:
        logger.debug("emotion.updated broadcast failed: %s", exc)


async def decay_loop(runtime: "AgentRuntime", stop_event: asyncio.Event) -> None:
    """
    Background task — drifts the foreground task's emotion toward baseline on
    `agent_emotion_decay_interval_s` cadence. Exits when stop_event fires or
    when emotion is globally disabled.

    Each tick reads the config *afresh* so hot-reload (AD-02) takes effect
    without restarting the loop. When there's no foreground task, the loop
    idles but stays alive so the next task picks up automatically.
    """
    while not stop_event.is_set():
        interval = int(getattr(config, "agent_emotion_decay_interval_s", 60) or 60)
        interval = max(1, interval)
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=interval)
            break  # stop_event set
        except asyncio.TimeoutError:
            pass

        if not getattr(config, "agent_emotion_enabled", True):
            continue
        if runtime.foreground_slot is None:
            continue
        rate = float(getattr(config, "agent_emotion_decay_rate", 0.05) or 0.05)
        sm = runtime.foreground_slot.self_model
        current = sm.emotion or EmotionVector()
        sm.emotion = _decay_toward_baseline(current, rate)
        # No broadcast — decay is ambient; listeners that care read the next
        # `emotion.updated` on the next real event (avoids log spam).


__all__ = [
    "update_emotion_on_event",
    "decay_loop",
    "resolve_event_key",
]
