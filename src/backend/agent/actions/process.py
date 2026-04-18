"""process.list — psutil-backed process inspection."""
from __future__ import annotations

import time
from typing import ClassVar

import psutil
from pydantic import Field

from ..schemas import ActionResult, RiskLevel
from .base import Action, ActionContext


class ProcessList(Action):
    name: ClassVar[str] = "process.list"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE

    filter_substr: str | None = Field(default=None)
    max_rows: int = Field(default=50, ge=1, le=500)

    async def execute(self, ctx: ActionContext) -> ActionResult:
        t0 = time.monotonic()
        needle = (self.filter_substr or "").lower()
        rows: list[dict] = []
        for proc in psutil.process_iter(["pid", "name", "username", "cpu_percent", "memory_info", "cmdline"]):
            try:
                info = proc.info
                name = info.get("name") or ""
                cmdline = " ".join(info.get("cmdline") or [])
                if needle and needle not in name.lower() and needle not in cmdline.lower():
                    continue
                rss_mb = (info.get("memory_info").rss / 1_048_576) if info.get("memory_info") else 0.0
                rows.append({
                    "pid": info.get("pid"),
                    "name": name,
                    "username": info.get("username") or "",
                    "cpu_pct": float(info.get("cpu_percent") or 0.0),
                    "rss_mb": round(rss_mb, 1),
                    "cmdline": cmdline[:100],
                })
                if len(rows) >= self.max_rows:
                    break
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue

        return ActionResult(
            ok=True,
            output={"rows": rows, "count": len(rows), "filter": self.filter_substr},
            elapsed_ms=int((time.monotonic() - t0) * 1000),
        )
