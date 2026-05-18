"""
Agent-layer error types.

These are used by the runtime + orchestration code only. Planner/LLM errors
live in `agent.planner._llm`; action-level errors live in
`agent.actions.errors`. Keep this module lean — only cross-cutting control
flow signals belong here.
"""
from __future__ import annotations


class AgentError(Exception):
    """Base class for agent orchestration errors."""


class TrackBusyError(AgentError):
    """Raised by AgentRuntime.start_task when the target track's queue is full.

    Carries the track name + current queue depth so callers (standing-orders
    runner, proactive loop) can log meaningfully and defer/skip.
    """

    def __init__(self, track: str, queue_size: int) -> None:
        super().__init__(f"Track {track!r} queue full ({queue_size} pending)")
        self.track = track
        self.queue_size = queue_size


class BackgroundTimeoutError(AgentError):
    """Raised internally when a background task exceeds its wall-clock timeout.

    Loop.py wraps the background task body in `asyncio.wait_for`; on TimeoutError
    we re-raise as this typed exception so `finalize_task` can tag status='timeout'
    cleanly instead of the generic 'failed'.
    """


__all__ = ["AgentError", "TrackBusyError", "BackgroundTimeoutError"]
