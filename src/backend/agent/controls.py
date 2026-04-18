"""
Control surface for the runtime — pause/resume/intervene/cancel-step/stop.

Lives separately from runtime.py so the API can import only this slim module
without dragging the planners + browser into the import graph.
"""
from __future__ import annotations

import asyncio
import logging

logger = logging.getLogger(__name__)


class ControlBus:
    """Wraps the asyncio events the loop polls between iterations."""

    def __init__(self) -> None:
        self.emergency_stop = asyncio.Event()
        self.pause_event = asyncio.Event()
        self.resume_event = asyncio.Event()
        self.cancel_step = asyncio.Event()
        self.intervention_queue: asyncio.Queue[str] = asyncio.Queue()

    def reset(self) -> None:
        self.emergency_stop.clear()
        self.pause_event.clear()
        self.resume_event.clear()
        self.cancel_step.clear()
        # Drain any leftover interventions
        while True:
            try:
                self.intervention_queue.get_nowait()
            except asyncio.QueueEmpty:
                break

    async def wait_until_resumed(self, poll_s: float = 0.2) -> None:
        """Block until pause is cleared OR emergency stop fires."""
        while self.pause_event.is_set() and not self.emergency_stop.is_set():
            await asyncio.sleep(poll_s)
