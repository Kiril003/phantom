"""
PHANTOM OS — 1 Hz CPU sampler (Day-2 D2-D-cpu / PERF-17b).

The chat-tool dispatcher's ``get_system_metrics`` handler used to call
``psutil.cpu_percent(interval=0.05)`` per chat turn. With Phase 17b's
4-iteration ``call_with_tools`` loop that adds up to ~200 ms of
event-loop block per turn (``cpu_percent`` releases the GIL but the
asyncio thread it runs on still pauses for the interval).

H-5's consolidation switched to ``cpu_percent(interval=None)``, which
is non-blocking — but reads since-last-call delta. On the first call
in a fresh interpreter that's always 0.0; subsequent calls reflect a
delta over whatever wall-clock elapsed, which can range from "a few
seconds" to "minutes" depending on traffic. Neither is what the
operator expects from a "CPU now" gauge.

This sampler runs a 1 Hz background task that calls
``cpu_percent(interval=None)`` at a fixed cadence and stashes the
result. ``get_cpu_percent()`` returns the latest sample. Idempotent
``start()`` so re-importing or hot-reloading doesn't double-spawn.

The sampler is hooked into the FastAPI lifespan in ``main.py`` and
read by ``tool_executor._tool_get_system_metrics``.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Optional

logger = logging.getLogger(__name__)


_cached_cpu_pct: float = 0.0
_sampler_task: Optional[asyncio.Task] = None
_stop_event: Optional[asyncio.Event] = None


_SAMPLE_INTERVAL_S: float = 1.0


def get_cpu_percent() -> float:
    """Return the most recent 1 Hz CPU sample. Returns 0.0 before the
    sampler has primed (lifespan startup hasn't completed) — callers
    should treat 0.0 as "not yet available" rather than "idle"."""
    return _cached_cpu_pct


def is_running() -> bool:
    return _sampler_task is not None and not _sampler_task.done()


async def _sample_loop() -> None:
    import psutil

    # Prime the counter so the very first interval=None call has a
    # baseline. cpu_percent(interval=0.0) is documented as "non-blocking,
    # returns the value since the last call". We discard this read.
    try:
        psutil.cpu_percent(interval=None)
    except Exception as exc:  # noqa: BLE001
        logger.warning("cpu sampler prime failed: %s", exc)
        return

    assert _stop_event is not None
    while not _stop_event.is_set():
        try:
            value = float(psutil.cpu_percent(interval=None))
        except Exception as exc:  # noqa: BLE001
            logger.debug("cpu_percent read failed: %s", exc)
            value = _cached_cpu_pct
        _set_cached(value)
        try:
            # `wait_for(_stop_event.wait, timeout)` lets shutdown break
            # the cadence promptly instead of waiting up to 1 s.
            await asyncio.wait_for(
                _stop_event.wait(), timeout=_SAMPLE_INTERVAL_S
            )
        except asyncio.TimeoutError:
            continue


def _set_cached(value: float) -> None:
    global _cached_cpu_pct
    _cached_cpu_pct = value


async def start() -> None:
    """Start the 1 Hz sampler. Idempotent — repeated calls are no-ops
    while the prior task is still running."""
    global _sampler_task, _stop_event
    if is_running():
        return
    _stop_event = asyncio.Event()
    _sampler_task = asyncio.create_task(
        _sample_loop(), name="phantom_cpu_sampler"
    )
    logger.info("CPU sampler started (1 Hz)")


async def stop() -> None:
    """Signal the sampler to exit and await its shutdown. Idempotent."""
    global _sampler_task, _stop_event
    if _stop_event is not None:
        _stop_event.set()
    task = _sampler_task
    if task is not None:
        try:
            await asyncio.wait_for(task, timeout=2.0)
        except (asyncio.TimeoutError, asyncio.CancelledError):
            task.cancel()
        except Exception as exc:  # noqa: BLE001
            logger.debug("cpu sampler stop swallowed: %s", exc)
    _sampler_task = None
    _stop_event = None


def _reset_for_tests() -> None:
    """Test helper — clear sampler state so successive tests don't
    inherit a running task or stale value."""
    global _sampler_task, _stop_event, _cached_cpu_pct
    _sampler_task = None
    _stop_event = None
    _cached_cpu_pct = 0.0


__all__ = ["start", "stop", "get_cpu_percent", "is_running", "_reset_for_tests"]
