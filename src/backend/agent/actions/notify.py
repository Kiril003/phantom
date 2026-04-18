"""notify.desktop — notify-send with WS toast fallback."""
from __future__ import annotations

import asyncio
import shutil
import time
from typing import ClassVar

from pydantic import Field

from ..schemas import ActionResult, RiskLevel
from .base import Action, ActionContext


class NotifyDesktop(Action):
    name: ClassVar[str] = "notify.desktop"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE

    title: str = Field(..., max_length=128)
    message: str = Field(..., max_length=1024)
    urgency: str = Field(default="normal")  # low | normal | critical

    async def execute(self, ctx: ActionContext) -> ActionResult:
        t0 = time.monotonic()
        urgency = self.urgency if self.urgency in {"low", "normal", "critical"} else "normal"
        used_native = False

        if shutil.which("notify-send"):
            try:
                proc = await asyncio.create_subprocess_exec(
                    "notify-send", "-u", urgency, self.title, self.message,
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.DEVNULL,
                )
                await asyncio.wait_for(proc.wait(), timeout=5.0)
                used_native = True
            except Exception:
                used_native = False

        if not used_native:
            try:
                from api.websocket_hub import hub
                await hub.broadcast(
                    "agent.stream", "notification",
                    {"title": self.title, "message": self.message, "urgency": urgency},
                )
            except Exception:
                pass

        return ActionResult(
            ok=True,
            output={"delivered_via": "notify-send" if used_native else "ws_toast"},
            side_effects=[f"notified: {self.title}"],
            elapsed_ms=int((time.monotonic() - t0) * 1000),
        )
