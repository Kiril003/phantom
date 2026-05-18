"""bash.run — sandboxed (bwrap when on PATH) shell command runner.

Day-4 Wave-2 Y-2 (ADR-SBX-002 / ADR-SBX-003): the legacy
``wrap_shell_cmd`` shim is replaced by direct ``wrap_argv`` calls
under the ``compute`` profile + the centralised ``clean_env`` allow-
list (start-from-empty, never ``os.environ.copy()``). The
defence-in-depth ``assert_env_safe`` catches a future allowlist
drift before it can leak ``JWT_SECRET_KEY`` / ``AI_GEMINI_API_KEY``
into a child process.

Day-NN: a third graduated tier `read_host` is exposed via the
``profile`` Pydantic field — `compute` (default, hermetic) for raw
computation, `read_host` for system introspection (dpkg/apt/journalctl
work, network retained, read-only /var, /opt, /home), `unsafe_mode` on
the task waives bwrap entirely.
"""
from __future__ import annotations

import asyncio
import time
from typing import ClassVar, Literal

from pydantic import Field

from ..operations.safety.sandbox import (
    SandboxProfile,
    assert_env_safe,
    clean_env,
    host_env_unsafe,
    wrap_argv,
)
from config import config

from ..schemas import ActionResult, RiskLevel
from .base import Action, ActionContext

# V1 limitless — caps are config-driven; `<=0` means UNBOUND (no
# wall-clock ceiling beyond the caller's timeout_s; no output truncation).
def _bash_timeout_cap() -> int:
    return int(getattr(config, "agent_bash_timeout_s", 120))


def _bash_output_cap() -> int:
    return int(getattr(config, "agent_bash_output_cap_bytes", 16384))


_HEAVY_INSTALL_PATTERNS = (
    "apt install",
    "apt-get install",
    "pip install",
    "npm install",
    "yarn install",
    "cargo build",
    "cargo install",
    "make install",
)
_HEAVY_RAM_MB = 1500
_HEAVY_WALL_S = 300


class BashRun(Action):
    name: ClassVar[str] = "bash.run"
    risk_level: ClassVar[RiskLevel] = RiskLevel.MEDIUM

    # Block B — defaults fine for most shell commands. Heavy install
    # commands are detected at runtime via expected_peak_ram_mb() below.

    cmd: str = Field(..., description="Shell command (run via /bin/sh -c)")
    timeout_s: int = Field(default=30, ge=1)
    sandboxed: bool = Field(default=True)
    # Day-NN — graduated sandbox profile. `compute` is the hermetic
    # default (no net, no /var, no /home — for raw scripting). Pick
    # `read_host` for ANY system-introspection command (`dpkg-query`,
    # `apt list`, `journalctl`, `systemctl status`, `which`, reading
    # `~/.config/*` or `/etc/*` content beyond what `compute` exposes,
    # network probes like `curl`/`ping`). `read_host` keeps caps
    # dropped + tmpfs writes + clearenv — it just widens what the
    # process can READ on the host.
    profile: Literal["compute", "read_host"] = Field(
        default="compute",
        description=(
            "Sandbox tier: 'compute' (hermetic, no net, no /var) or "
            "'read_host' (read-only /var /opt /home + network — pick this "
            "for dpkg/apt/journalctl/systemctl/which/curl/etc.)"
        ),
    )
    # Block A-1 — bypass the idempotency sentinel cache and always re-run.
    # Use when the command intentionally produces different results each time
    # (e.g. `date`, `git pull`, `apt update`) AND the caller needs fresh output.
    # Default False: use the cache when available.
    force_rerun: bool = Field(
        default=False,
        description=(
            "When True, bypass the idempotency sentinel cache and always "
            "execute the command.  Use for commands that are intentionally "
            "non-idempotent."
        ),
    )

    def expected_peak_ram_mb(self) -> int:
        """Block B — instance override: heavy install commands (apt/pip/npm/cargo/make)
        spike RAM significantly beyond the default 50 MB shell budget. Heuristic
        based on the command text so the gate can defer these on a low-RAM device.
        """
        cmd_lower = self.cmd.lower()
        for pattern in _HEAVY_INSTALL_PATTERNS:
            if pattern in cmd_lower:
                return _HEAVY_RAM_MB
        return type(self).estimated_peak_ram_mb

    async def execute(self, ctx: ActionContext) -> ActionResult:
        t0 = time.monotonic()

        # Block A-1 — idempotency sentinel cache.
        # Check BEFORE sandbox setup to avoid any subprocess overhead on hits.
        # Skipped when: force_rerun=True, command is heuristically non-idempotent,
        # or the cache lookup itself raises.
        _idem_cache_dir: str | None = None
        _idem_key: str | None = None
        try:
            from ._idempotency import (
                idempotency_key,
                is_non_idempotent_command,
                load_cached_result,
                sentinel_cache_dir,
            )
            if not self.force_rerun and not is_non_idempotent_command(self.cmd):
                _idem_key = idempotency_key(
                    task_id=ctx.task_id,
                    step_idx=ctx.step_idx,
                    action_name="bash.run",
                    args={"cmd": self.cmd, "profile": self.profile},
                )
                _idem_cache_dir = sentinel_cache_dir(ctx.workspace_dir)
                cached = load_cached_result(_idem_cache_dir, _idem_key)
                if cached is not None:
                    return ActionResult(**{k: v for k, v in cached.items() if k in ActionResult.model_fields})
        except Exception:
            # Idempotency failure is non-fatal; proceed with execution.
            _idem_key = None
            _idem_cache_dir = None

        # Day-NN "no-leash": when the operator has flipped `unsafe_mode`
        # on for this task, override whatever the LLM asked for and run
        # raw against the host shell. This unlocks `/var/lib/dpkg`,
        # network, full /usr write, signals — capabilities the closed
        # compute sandbox deliberately denies.
        effective_sandboxed = self.sandboxed and not ctx.unsafe_mode
        # Day-4 Y-2: wrap argv via the closed `compute` profile when
        # `sandboxed=True`. The bwrap base flags (--unshare-net,
        # --cap-drop ALL, --tmpfs /tmp, --ro-bind /usr|/etc, etc.) come
        # from `_BWRAP_BASE_FLAGS` in agent.operations.safety.sandbox so callers
        # never hand-assemble flags (cluster invariant U4-SEC-G1).
        if effective_sandboxed:
            sandbox_profile = (
                SandboxProfile.read_host
                if self.profile == "read_host"
                else SandboxProfile.compute
            )
            argv, sandbox_active = wrap_argv(
                sandbox_profile,
                ["/bin/sh", "-c", self.cmd],
                workspace_dir=ctx.workspace_dir,
            )
        else:
            argv, sandbox_active = ["/bin/sh", "-c", self.cmd], False
        _tcap = _bash_timeout_cap()
        timeout = self.timeout_s if _tcap <= 0 else min(self.timeout_s, _tcap)

        # Audit-2026-04-28 F-10c + Day-4 Y-2 (ADR-SBX-003): scrub
        # environment so the spawned shell cannot read JWT_SECRET_KEY /
        # AI_GEMINI_API_KEY / etc. inherited from the daemon process.
        # `clean_env` is the start-from-empty allowlist (PATH/HOME/
        # LANG/LC_ALL/TERM); `assert_env_safe` is the defence-in-depth
        # invariant that fires if a future refactor widens the
        # allowlist.
        #
        # Day-NN "no-leash": closed `clean_env` makes the host shell
        # near-useless because the host PATH override (nvm/pyenv),
        # HOME, USER, SHELL, XDG_*, SSH_AUTH_SOCK, DBUS_*, GPG_TTY are
        # all stripped — npm/pip/git/cargo/ssh stop working. When the
        # operator has waived the leash for this task, fall through
        # to `host_env_unsafe` which inverts the policy: copy the host
        # env, then DROP only the secret deny-list. `assert_env_safe`
        # still catches any drift either way.
        if ctx.unsafe_mode:
            scrubbed_env = host_env_unsafe()
        else:
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

        _ocap = _bash_output_cap()
        if _ocap <= 0:
            stdout = stdout_b.decode("utf-8", errors="replace")
            stderr = stderr_b.decode("utf-8", errors="replace")
            truncated = False
        else:
            stdout = stdout_b[:_ocap].decode("utf-8", errors="replace")
            stderr = stderr_b[:_ocap].decode("utf-8", errors="replace")
            truncated = len(stdout_b) > _ocap or len(stderr_b) > _ocap

        rc = proc.returncode if proc.returncode is not None else -1
        # A shell command that runs to completion is "ok" from an execution
        # standpoint — including rc=1 (grep no match, dpkg-query not installed,
        # `command -v` absent, `test` condition false). The return_code +
        # stdout/stderr is the *answer*, not a failure. Treating rc=1 as
        # failure made the LLM trigger revise_strategy on every introspection
        # probe and burn the budget without ever reading the result.
        # Only signal kills (rc < 0) are genuine execution failures here;
        # timeout + shell_unavailable are handled in the except branches
        # above and already return ok=False from there.
        #
        # `command_success` is a separate, explicit signal for the
        # reflector/planner that distinguishes "the shell ran the
        # command to completion" (ok) from "the command itself reported
        # success" (rc==0). External audit flagged that without this
        # split the reflector cannot tell apart `grep` finding no match
        # (ok+rc=1) from `apt install foo` failing (also ok+rc!=0 but
        # genuinely a problem).
        ok = rc >= 0
        command_success = rc == 0
        elapsed_ms = int((time.monotonic() - t0) * 1000)
        # Phase 28-IDEAL — Root Cause Analyzer.
        # Extract the most meaningful error line from stderr to speed up debugging.
        root_cause = ""
        if not command_success and stderr:
            lines = [l.strip() for l in stderr.splitlines() if l.strip()]
            keywords = ["error:", "failed:", "no such", "not found", "permission denied", "invalid"]
            for l in reversed(lines):
                if any(k in l.lower() for k in keywords):
                    root_cause = l
                    break
            if not root_cause and lines:
                root_cause = lines[-1]

        result = ActionResult(
            ok=ok,
            output={
                "stdout": stdout,
                "stderr": stderr,
                "return_code": rc,
                "truncated": truncated,
                "command_success": command_success,
                "root_cause": root_cause,
            },
            error=None if ok else f"signal_kill: rc={rc}",
            error_class=None if ok else "signal_kill",
            elapsed_ms=elapsed_ms,
            sandboxed=sandbox_active,
            side_effects=[f"ran shell command (rc={rc})"],
        )
        # Block A-1 — persist the result as a sentinel so retries return
        # the cached outcome without re-executing the command.
        if _idem_key is not None and _idem_cache_dir is not None and ok:
            try:
                from ._idempotency import save_cached_result
                save_cached_result(_idem_cache_dir, _idem_key, result.model_dump(mode="json"))
            except Exception:
                pass
        return result
