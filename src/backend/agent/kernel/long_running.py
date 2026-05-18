"""
Phase 18-COMPLETE — long-running action specs + foreground→background promotion.

The agent loop dispatches actions on the foreground track by default. For
actions that we KNOW will take minutes-to-hours (Blender renders, large
training jobs, multi-stage research crawls) the operator UI shouldn't be
held hostage — the task should slide onto the background track so the
operator regains the foreground for new goals while progress checkpoints
keep flowing on a side channel.

This module provides:
  * `LongRunningSpec` — declarative dataclass attached to an Action class
  * `should_promote(spec, state)` — single decision predicate
  * `ProgressTracker` — fire-and-forget asyncio task that broadcasts
    `task.progress` events at `progress_checkpoint_interval_s` cadence

The Action base class exposes `long_running_spec(self) -> LongRunningSpec | None`
that returns None by default; concrete actions override it to opt in.
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)

# Threshold below which we don't bother flipping tracks — small enough that
# the operator wouldn't notice the foreground hold anyway.
PROMOTION_THRESHOLD_S = 300  # 5 minutes


@dataclass(frozen=True)
class LongRunningSpec:
    """Per-action declaration of long-running behaviour.

    Attributes:
      estimated_duration_s: best-guess wall time for the action; used
        both for the promotion decision and as a UI ETA seed.
      progress_checkpoint_interval_s: how often the ProgressTracker
        broadcasts a heartbeat while the action is in flight.
      label: short human-readable tag the FE shows on the
        LongRunningTaskCard (e.g. "Building scene in Blender").
    """

    estimated_duration_s: int
    progress_checkpoint_interval_s: int = 60
    label: str = "Long-running task"


def should_promote(spec: LongRunningSpec | None, current_track: str) -> bool:
    """Decide whether to flip a task from foreground → background.

    We only promote if the spec exists, the task is currently on the
    foreground track, and the estimated duration is over the threshold.
    Re-entry from background → foreground is a separate user-initiated
    operation; this predicate is one-way.
    """
    if spec is None:
        return False
    if current_track != "foreground":
        return False
    return int(spec.estimated_duration_s) > PROMOTION_THRESHOLD_S


@dataclass
class ProgressCheckpoint:
    """One progress heartbeat. Stored on TaskState so the
    `GET /tasks/{id}/progress` endpoint can replay history."""

    at: float                  # epoch seconds
    label: str
    percent: float | None = None
    extra: dict[str, Any] = field(default_factory=dict)


class ProgressTracker:
    """Periodic heartbeat for a long-running action.

    Spawned by the executor right before `await action.execute(ctx)` and
    cancelled in the executor's finally block. Each tick:
      1. Appends a ProgressCheckpoint to `state.progress_checkpoints`
      2. Broadcasts a `task.progress` WS event with the checkpoint payload

    The tracker is intentionally dumb — it doesn't try to estimate
    completion percentage from logs. Real percent values come from the
    action itself when it has signal (Blender %, training epoch, etc.);
    plain heartbeats just keep the FE alive without LLM involvement (П-1).
    """

    def __init__(
        self,
        runtime: Any,
        task_id: str,
        spec: LongRunningSpec,
        action_name: str,
    ) -> None:
        self._runtime = runtime
        self._task_id = task_id
        self._spec = spec
        self._action_name = action_name
        self._task: asyncio.Task | None = None
        self._started_at: float = time.time()

    @property
    def started_at(self) -> float:
        return self._started_at

    async def _loop(self) -> None:
        interval = max(5, int(self._spec.progress_checkpoint_interval_s))
        while True:
            try:
                await asyncio.sleep(interval)
            except asyncio.CancelledError:
                return
            elapsed = time.time() - self._started_at
            eta_remaining = max(0, int(self._spec.estimated_duration_s - elapsed))
            checkpoint = ProgressCheckpoint(
                at=time.time(),
                label=self._spec.label,
                percent=None,
                extra={
                    "action": self._action_name,
                    "elapsed_s": int(elapsed),
                    "eta_remaining_s": eta_remaining,
                },
            )
            self._record(checkpoint)
            await self._broadcast(checkpoint)

    def _record(self, ck: ProgressCheckpoint) -> None:
        state = self._runtime._state_for_task(self._task_id) if self._runtime else None
        if state is None:
            return
        bucket = getattr(state, "progress_checkpoints", None)
        if bucket is None:
            return
        bucket.append(ck)
        # Keep the in-memory list bounded — the DB / audit trail is the
        # authoritative log; this is just for the live FE poll.
        max_len = 240
        if len(bucket) > max_len:
            del bucket[: len(bucket) - max_len]

    async def _broadcast(self, ck: ProgressCheckpoint) -> None:
        if self._runtime is None or not hasattr(self._runtime, "_broadcast"):
            return
        try:
            await self._runtime._broadcast(
                "task.progress",
                {
                    "task_id": self._task_id,
                    "kind": "checkpoint",
                    "label": ck.label,
                    "percent": ck.percent,
                    "at": ck.at,
                    "extra": ck.extra,
                },
            )
        except Exception:
            logger.warning("ProgressTracker: broadcast failed", exc_info=True)

    def start(self) -> None:
        if self._task is not None:
            return
        self._task = asyncio.create_task(
            self._loop(), name=f"progress-tracker-{self._task_id[:8]}"
        )

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        try:
            await self._task
        except (asyncio.CancelledError, Exception):
            pass
        self._task = None


__all__ = [
    "PROMOTION_THRESHOLD_S",
    "LongRunningSpec",
    "ProgressCheckpoint",
    "ProgressTracker",
    "should_promote",
]
