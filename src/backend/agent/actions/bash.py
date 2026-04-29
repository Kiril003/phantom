"""bash.run — sandboxed (bwrap when on PATH) shell command runner.

Day-4 Wave-2 Y-2 (ADR-SBX-002 / ADR-SBX-003): the legacy
``wrap_shell_cmd`` shim is replaced by direct ``wrap_argv`` calls
under the ``compute`` profile + the centralised ``clean_env`` allow-
list (start-from-empty, never ``os.environ.copy()``). The
defence-in-depth ``assert_env_safe`` catches a future allowlist
drift before it can leak ``JWT_SECRET_KEY`` / ``AI_GEMINI_API_KEY``
into a child process.
"""
from __future__ import annotations

import asyncio
import time
from typing import ClassVar

from pydantic import Field

from ..safety.sandbox import (
    SandboxProfile,
    assert_env_safe,
    clean_env,
    wrap_argv,
)
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
        # Day-4 Y-2: wrap argv via the closed `compute` profile when
        # `sandboxed=True`. The bwrap base flags (--unshare-net,
        # --cap-drop ALL, --tmpfs /tmp, --ro-bind /usr|/etc, etc.) come
        # from `_BWRAP_BASE_FLAGS` in agent.safety.sandbox so callers
        # never hand-assemble flags (cluster invariant U4-SEC-G1).
        if self.sandboxed:
            argv, sandbox_active = wrap_argv(
                SandboxProfile.compute,
                ["/bin/sh", "-c", self.cmd],
                workspace_dir=ctx.workspace_dir,
            )
        else:
            argv, sandbox_active = ["/bin/sh", "-c", self.cmd], False
        timeout = min(self.timeout_s, _HARD_TIMEOUT_S)

        # Audit-2026-04-28 F-10c + Day-4 Y-2 (ADR-SBX-003): scrub
        # environment so the spawned shell cannot read JWT_SECRET_KEY /
        # AI_GEMINI_API_KEY / etc. inherited from the daemon process.
        # `clean_env` is the start-from-empty allowlist (PATH/HOME/
        # LANG/LC_ALL/TERM); `assert_env_safe` is the defence-in-depth
        # invariant that fires if a future refactor widens the
        # allowlist.
        scrubbed_env = clean_env(workspace_dir=ctx.workspace_dir)
        assert_env_safe(scrubbed_env)

        proc: asyncio.subprocess.Process | None = None
        try:
            proc = await asyncio.create_subprocess_exec(
                *argv,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=scrubbed_env,
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
