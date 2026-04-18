"""time.wait — interruptible asyncio.sleep with hard 60s ceiling."""
from __future__ import annotations

import asyncio
import time
from typing import ClassVar

from pydantic import Field

from ..schemas import ActionResult, RiskLevel
from .base import Action, ActionContext


class TimeWait(Action):
    name: ClassVar[str] = "time.wait"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE

    seconds: float = Field(..., ge=0.0, le=60.0)

    async def execute(self, ctx: ActionContext) -> ActionResult:
        t0 = time.monotonic()
        target_s = min(max(self.seconds, 0.0), 60.0)
        runtime = ctx.runtime

        # Poll emergency_stop / pause every 200ms so /agent/stop and Pause feel
        # responsive even mid-wait.
        deadline = t0 + target_s
        while True:
            now = time.monotonic()
            if now >= deadline:
                break
            slice_s = min(0.2, deadline - now)
            await asyncio.sleep(slice_s)
            if runtime is not None:
                if getattr(runtime, "emergency_stop", None) and runtime.emergency_stop.is_set():
                    return ActionResult(
                        ok=False,
                        error="interrupted_by_stop",
                        error_class="interrupted",
                        elapsed_ms=int((time.monotonic() - t0) * 1000),
                    )
                if getattr(runtime, "pause_event", None) and runtime.pause_event.is_set():
                    return ActionResult(
                        ok=True,
                        output={"slept_s": time.monotonic() - t0, "interrupted_by": "pause"},
                        elapsed_ms=int((time.monotonic() - t0) * 1000),
                    )

        return ActionResult(
            ok=True,
            output={"slept_s": target_s},
            elapsed_ms=int((time.monotonic() - t0) * 1000),
        )
