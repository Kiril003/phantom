"""
Phase 9.3b — proactive trigger types.

Lightweight records pushed into ProactiveLoop._recent_triggers by hook points
scattered through the runtime/emotion/self_model modules. The proactive loop's
decision gate reads them as "something happened that might be worth saying",
then passes the top-N into the decide prompt for LLM judgement.

No behaviour lives here — this module is pure data shapes so the rest of the
system can import it without pulling the ProactiveLoop into its module graph.
"""
from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


def _utcnow() -> datetime:
    return datetime.now(tz=timezone.utc)


class ProactiveTriggerKind(str, Enum):
    CONCERN_ADDED = "concern_added"
    STREAK_SUCCESS = "streak_success"
    HIGH_FATIGUE = "high_fatigue"
    LONG_SILENCE = "long_silence"
    RESUMED_TASK = "resumed_task"
    SYSTEM_STATE = "system_state"
    STANDING_ORDER_FIRED = "standing_order_fired"
    # Phase 9.4b — spatial intelligence triggers.
    REGION_CHANGED = "region_changed"          # user moved to a new country
    NEAR_REMEMBERED_PLACE = "near_remembered_place"  # within N m of a place in memory


class ProactiveTrigger(BaseModel):
    kind: ProactiveTriggerKind
    ts: datetime = Field(default_factory=_utcnow)
    context: dict[str, Any] = Field(default_factory=dict)
    priority: int = 5  # 1=low urgency, 10=high urgency


__all__ = ["ProactiveTriggerKind", "ProactiveTrigger"]
