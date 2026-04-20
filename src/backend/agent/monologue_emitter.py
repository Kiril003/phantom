"""
Phase 9.3b — inner monologue channel emitter.

Streams PHANTOM's ongoing thinking on a dedicated WS channel
(`inner_monologue.stream`) so the main `agent.stream` doesn't get clogged
with per-step reasoning.

Inner monologue is ALREADY captured in PlanStep.monologue (from 9.1) and
ReflectionResult fields — this module just broadcasts them. Proactive
decisions also emit here, including when they chose NOT to speak.

Rate-limited to `agent_monologue_rate_limit_eps` events per second (default
10). Excess is dropped with a single log warning per burst.
"""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field

from config import config

logger = logging.getLogger(__name__)


def _utcnow() -> datetime:
    return datetime.now(tz=timezone.utc)


MonologueKind = Literal["plan", "reflection", "proactive", "emotion_shift"]


class MonologueEvent(BaseModel):
    kind: MonologueKind
    source: str  # "tactical", "reflector", "proactive", "emotion_engine"
    monologue: dict[str, Any] = Field(default_factory=dict)
    ts: datetime = Field(default_factory=_utcnow)
    task_id: str | None = None


class _RateLimiter:
    """Token-bucket-ish: allow N events per second; drop overflow."""

    def __init__(self) -> None:
        self._window_start: float = 0.0
        self._count: int = 0
        self._dropped_since_warn: int = 0

    def allow(self, eps_limit: int) -> bool:
        now = time.monotonic()
        # Reset window every 1s.
        if now - self._window_start >= 1.0:
            if self._dropped_since_warn > 0:
                logger.warning(
                    "inner monologue: dropped %d event(s) in last window",
                    self._dropped_since_warn,
                )
                self._dropped_since_warn = 0
            self._window_start = now
            self._count = 0
        if self._count >= eps_limit:
            self._dropped_since_warn += 1
            return False
        self._count += 1
        return True


_limiter = _RateLimiter()
_lock = asyncio.Lock()


async def emit_monologue(event: MonologueEvent) -> bool:
    """
    Publish a monologue event to the `inner_monologue.stream` WS channel.

    Returns True when sent, False when rate-limited. Never raises — failure
    to emit must not break the caller's path.
    """
    eps = int(getattr(config, "agent_monologue_rate_limit_eps", 10) or 10)
    async with _lock:
        if not _limiter.allow(eps):
            return False
    try:
        from api.websocket_hub import hub
        await hub.broadcast(
            "inner_monologue.stream",
            event.kind,
            event.model_dump(mode="json"),
        )
        return True
    except Exception as exc:
        logger.debug("monologue broadcast failed: %s", exc)
        return False


def reset_rate_limiter_for_tests() -> None:
    """Test helper — reset limiter state between tests."""
    global _limiter
    _limiter = _RateLimiter()


__all__ = [
    "MonologueEvent",
    "MonologueKind",
    "emit_monologue",
    "reset_rate_limiter_for_tests",
]
