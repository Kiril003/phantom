"""bash.run — sandboxed (when firejail is on PATH) shell command runner."""
from __future__ import annotations

import asyncio
import time
from typing import ClassVar

from pydantic import Field

from ..safety.sandbox import wrap_shell_cmd
from ..schemas import ActionResult, RiskLevel
from .base import Action, ActionContext

_HARD_TIMEOUT_S = 120
_OUTPUT_LIMIT_BYTES = 16 * 1024


class BashRun(Action):
    name: ClassVar[str] = "bash.run"
    risk_level: ClassVar[RiskLevel] = RiskLevel.MEDIUM

    cmd: str = Field(..., description="Shell command (run via /bin/sh -c)")
    timeout_s: int = Field(default=30, ge=1, le=_HARD_TIMEOUT_S)
    sandboxed: bool = Field(default=True)

    async def execute(self, ctx: ActionContext) -> ActionResult:
        t0 = time.monotonic()
        argv, sandbox_active = wrap_shell_cmd(self.cmd, self.sandboxed)
        timeout = min(self.timeout_s, _HARD_TIMEOUT_S)

        proc: asyncio.subprocess.Process | None = None
        try:
            proc = await asyncio.create_subprocess_exec(
                *argv,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            try:
                stdout_b, stderr_b = await asyncio.wait_for(proc.communicate(), timeout=timeout)
            except asyncio.TimeoutError:
                proc.terminate()
                try:
                    await asyncio.wait_for(proc.wait(), timeout=2.0)
                except asyncio.TimeoutError:
                    proc.kill()
                    await proc.wait()
                return ActionResult(
                    ok=False,
                    error=f"timeout after {timeout}s",
                    error_class="timeout",
                    elapsed_ms=int((time.monotonic() - t0) * 1000),
                    sandboxed=sandbox_active,
                )
        except asyncio.CancelledError:
            if proc and proc.returncode is None:
                try:
                    proc.terminate()
                except ProcessLookupError:
                    pass
            raise
        except FileNotFoundError as exc:
            return ActionResult(
                ok=False, error=f"shell_unavailable: {exc}",
                error_class="shell_unavailable",
                elapsed_ms=int((time.monotonic() - t0) * 1000),
                sandboxed=sandbox_active,
            )

        stdout = stdout_b[:_OUTPUT_LIMIT_BYTES].decode("utf-8", errors="replace")
        stderr = stderr_b[:_OUTPUT_LIMIT_BYTES].decode("utf-8", errors="replace")
        truncated = len(stdout_b) > _OUTPUT_LIMIT_BYTES or len(stderr_b) > _OUTPUT_LIMIT_BYTES

        rc = proc.returncode if proc.returncode is not None else -1
        ok = rc == 0
        elapsed_ms = int((time.monotonic() - t0) * 1000)
        return ActionResult(
            ok=ok,
            output={
                "stdout": stdout,
                "stderr": stderr,
                "return_code": rc,
                "truncated": truncated,
            },
            error=None if ok else f"non_zero_exit: rc={rc}",
            error_class=None if ok else "non_zero_exit",
            elapsed_ms=elapsed_ms,
            sandboxed=sandbox_active,
            side_effects=[f"ran shell command (rc={rc})"],
        )
