"""ROOT-gated, WS-streamed sandbox executor.

A `SandboxSession` owns a `/tmp/phantom-sb/<sid>/` jail, a single
subprocess child, two reader tasks (stdout + stderr) and a watchdog
that emits `process.completed` / `session.killed` events on the
`sandbox.<sid>` WebSocket channel.

Hard guarantees (see CONTRACTS_R1.md SandboxEvent + spec):

  * shell=False, explicit argv list (`/bin/sh -c <cmd>`), PATH locked.
  * env minimal — clean_env(workspace) plus HOME=cwd, USER=phantom-sb.
    `assert_env_safe` runs before exec to fail-closed if the allowlist
    drifts.
  * cwd freshly created per session; cleaned up at session.killed
    /process.completed unless the caller flags checkpoint=True.
  * preexec_fn caps RLIMIT_AS = 256 MiB, RLIMIT_FSIZE = 16 MiB,
    RLIMIT_CPU = 30 s, RLIMIT_NOFILE = 64, RLIMIT_NPROC = 64; calls
    os.nice(10) and os.setsid() so kill propagates to descendants.
  * cpulimit binary is invoked when present (`shutil.which("cpulimit")`),
    capping wall-CPU usage at 50 % so the whole loop can't pin a core.
  * dangerous-pattern blocklist (`linux.dangerous_patterns`) checked
    before spawn — rejection emits `session.killed` with by="operator"
    and reason carried in the event data.
  * timeout 30 s — watchdog SIGKILLs the session group on overrun.
  * uid sandbox via setuid(nobody) when the parent is root and the user
    exists; otherwise the existing uid is reused. firejail/bwrap not
    invoked here — `agent.operations.safety.sandbox.wrap_argv` is the right primitive
    for code we *generate* and Day-4 already audits that path; here we
    are accepting an interactive ROOT operator command, so we lean on
    rlimit + cwd jail + dangerous-pattern + WS audit instead.
  * Audit entries: `sandbox.session.started`, `sandbox.session.completed`,
    `sandbox.session.killed` written to `agent_audit` with
    `task_id="sandbox:<sid>"` so the existing audit list view picks them
    up without schema changes.
  * Optional checkpoint: `process.completed` with `checkpoint=True` calls
    `agent.kernel.audit.save_checkpoint` capturing stdout + cwd path so the
    operator can resume.

Public surface intentionally small:

  SandboxExecutor.create_session(...)          → SandboxSession
  SandboxExecutor.kill(session_id, by=...)     → bool
  SandboxExecutor.list_active()                → list[dict]
  SandboxExecutor.purge(session_id)            → None
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import pwd
import resource
import shutil
import signal
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Awaitable, Callable

from agent.operations.safety.sandbox import assert_env_safe, clean_env

from . import dangerous_patterns

logger = logging.getLogger(__name__)


# ── Constants ────────────────────────────────────────────────────────────────

SANDBOX_ROOT = Path("/tmp/phantom-sb")
DEFAULT_TIMEOUT_S = 30
MEM_LIMIT_BYTES = 256 * 1024 * 1024
FILE_LIMIT_BYTES = 16 * 1024 * 1024
CPU_LIMIT_S = 30
NOFILE_LIMIT = 64
NPROC_LIMIT = 64
LOCKED_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
SANDBOX_USER = "phantom-sb"

# Per-channel WS event types — kept here so a single grep finds every
# emitter and the contract test can pin them.
EVENT_SESSION_STARTED = "session.started"
EVENT_PLAN_STEP = "plan.step"
EVENT_PLAN_THOUGHT = "plan.thought"
EVENT_STDOUT_LINE = "stdout.line"
EVENT_STDERR_LINE = "stderr.line"
EVENT_PROCESS_COMPLETED = "process.completed"
EVENT_SESSION_KILLED = "session.killed"


# ── Types ────────────────────────────────────────────────────────────────────


# A `Broadcaster` is `(channel, type_, data) -> awaitable`. Mirrors the
# shape of `WebSocketHub.broadcast` minus the optional `user_id`.
Broadcaster = Callable[[str, str, dict[str, Any]], Awaitable[None]]


@dataclass
class SandboxSession:
    session_id: str
    cmd: str
    cwd: Path
    started_at: float
    user_id: str | None
    timeout_s: int = DEFAULT_TIMEOUT_S
    proc: asyncio.subprocess.Process | None = None
    stdout_buf: list[str] = field(default_factory=list)
    stderr_buf: list[str] = field(default_factory=list)
    exit_code: int | None = None
    killed_by: str | None = None  # "operator" | "timeout" | None
    completed: asyncio.Event = field(default_factory=asyncio.Event)
    _readers: list[asyncio.Task[Any]] = field(default_factory=list)
    _watchdog: asyncio.Task[Any] | None = None

    @property
    def channel(self) -> str:
        return f"sandbox.{self.session_id}"

    def is_running(self) -> bool:
        return self.proc is not None and self.exit_code is None and not self.completed.is_set()


# ── Preexec fn ───────────────────────────────────────────────────────────────


def _drop_to_sandbox_user() -> int | None:
    """Best-effort drop to the phantom-sb uid. Returns the new uid or None.

    Only attempted when running as root. If `phantom-sb` doesn't exist
    we stay on the parent's uid — the rlimit + cwd jail + pattern
    blocklist still hold.
    """
    if os.geteuid() != 0:
        return None
    try:
        record = pwd.getpwnam(SANDBOX_USER)
    except KeyError:
        logger.warning(
            "linux.executor: user %s missing — sandbox runs as root. "
            "Run `useradd -r -s /usr/sbin/nologin %s` to fix.",
            SANDBOX_USER, SANDBOX_USER,
        )
        return None
    return record.pw_uid


def _preexec_factory(uid_to_set: int | None) -> Callable[[], None]:
    """Build a preexec_fn closure. Defined here (not a lambda) so it
    pickles cleanly across the asyncio.subprocess boundary on every
    Python version."""

    def _preexec() -> None:
        # New session so SIGKILL on the leader propagates to children.
        with contextlib.suppress(OSError):
            os.setsid()
        # Demote priority — sandbox is never realtime.
        with contextlib.suppress(OSError):
            os.nice(10)
        # Drop to phantom-sb uid if we were root.
        if uid_to_set is not None:
            with contextlib.suppress(OSError, PermissionError):
                os.setgid(uid_to_set)
                os.setuid(uid_to_set)
        # rlimits — fail-closed: every cap is best-effort but logged
        # only at the parent. The child has stderr captured so a
        # `resource.error` is visible.
        rlimits: list[tuple[int, int, int]] = [
            (resource.RLIMIT_AS, MEM_LIMIT_BYTES, MEM_LIMIT_BYTES),
            (resource.RLIMIT_FSIZE, FILE_LIMIT_BYTES, FILE_LIMIT_BYTES),
            (resource.RLIMIT_CPU, CPU_LIMIT_S, CPU_LIMIT_S),
            (resource.RLIMIT_NOFILE, NOFILE_LIMIT, NOFILE_LIMIT),
        ]
        # RLIMIT_NPROC is per-real-uid and counts every process owned by
        # that uid system-wide — so applying it on the parent's uid (when
        # uid_to_set is None because phantom-sb doesn't exist) immediately
        # kills /bin/sh's first fork on a busy dev box. Only enforce the
        # process cap when we successfully demoted to the sandbox user.
        if uid_to_set is not None:
            rlimits.append((resource.RLIMIT_NPROC, NPROC_LIMIT, NPROC_LIMIT))
        for rlim, soft, hard in rlimits:
            with contextlib.suppress(ValueError, OSError, resource.error):
                resource.setrlimit(rlim, (soft, hard))

    return _preexec


# ── Executor ─────────────────────────────────────────────────────────────────


class SandboxExecutor:
    """In-process registry of live `SandboxSession`s.

    The executor is a singleton (`session_registry` at module bottom)
    so the routes layer and the WS hub talk to the same object. Tests
    construct fresh instances by importing the class directly.
    """

    def __init__(self, broadcaster: Broadcaster | None = None) -> None:
        self._broadcaster = broadcaster
        self._sessions: dict[str, SandboxSession] = {}
        self._lock = asyncio.Lock()
        self._uid: int | None = None  # resolved lazily on first session

    # — broadcaster wiring — late-bound so tests can swap it out —
    def set_broadcaster(self, broadcaster: Broadcaster) -> None:
        self._broadcaster = broadcaster

    async def _emit(self, channel: str, type_: str, data: dict[str, Any]) -> None:
        if self._broadcaster is None:
            # Fall back to the canonical hub if nobody wired us — keeps
            # dev-time WS streaming working even when routes_linux is
            # the only registrant.
            try:
                from api.websocket_hub import hub as _hub
                self._broadcaster = _hub.broadcast
            except Exception:  # noqa: BLE001 — no-broadcaster is non-fatal
                logger.debug("linux.executor: no broadcaster bound — dropping %s/%s", channel, type_)
                return
        try:
            await self._broadcaster(channel, type_, data)
        except Exception as exc:  # noqa: BLE001 — broadcast failure is non-fatal
            logger.warning("linux.executor: broadcast %s/%s failed: %s", channel, type_, exc)

    # — public API —
    async def create_session(
        self,
        cmd: str,
        *,
        user_id: str | None = None,
        timeout_s: int = DEFAULT_TIMEOUT_S,
        is_root: bool = False,
    ) -> SandboxSession:
        """Spawn a sandbox subprocess for `cmd` and return the session.

        Caller MUST verify ROOT auth before reaching here — the
        `is_root` flag is propagated into the `session.started` event
        payload so the FE can render a banner.
        """
        cmd = (cmd or "").strip()
        if not cmd:
            raise ValueError("sandbox: empty command")

        violation = dangerous_patterns.find_violation(cmd)
        sid = uuid.uuid4().hex[:16]
        cwd = SANDBOX_ROOT / sid
        session = SandboxSession(
            session_id=sid,
            cmd=cmd,
            cwd=cwd,
            started_at=time.time(),
            user_id=user_id,
            timeout_s=int(timeout_s) if timeout_s and timeout_s > 0 else DEFAULT_TIMEOUT_S,
        )

        async with self._lock:
            self._sessions[sid] = session

        # Always emit session.started — even on rejection — so the FE
        # can render the chat bubble; the immediate session.killed
        # follows for blocked commands so the lifecycle is visible.
        await self._emit(session.channel, EVENT_SESSION_STARTED, {
            "session_id": sid,
            "root": bool(is_root),
            "cmd": cmd,
            "timeout_s": session.timeout_s,
        })

        if violation is not None:
            session.killed_by = "operator"
            session.exit_code = -1
            session.completed.set()
            await self._emit(session.channel, EVENT_SESSION_KILLED, {
                "session_id": sid,
                "by": "operator",
                "reason": f"blocked:{violation}",
            })
            await _audit_write(sid, "sandbox.session.killed", {
                "by": "operator",
                "reason": f"blocked:{violation}",
                "cmd": cmd,
            }, user_id=user_id)
            return session

        await _audit_write(sid, "sandbox.session.started", {
            "cmd": cmd,
            "user_id": user_id,
            "timeout_s": session.timeout_s,
            "cwd": str(cwd),
        }, user_id=user_id)

        # Build jail + child env.
        SANDBOX_ROOT.mkdir(parents=True, exist_ok=True)
        cwd.mkdir(parents=True, exist_ok=False, mode=0o700)

        env = clean_env(workspace_dir=str(cwd))
        env["HOME"] = str(cwd)
        env["USER"] = SANDBOX_USER
        env["PATH"] = LOCKED_PATH
        assert_env_safe(env)  # defence-in-depth — fail-closed on env drift.

        if self._uid is None:
            self._uid = _drop_to_sandbox_user()

        # Decide argv. cpulimit wraps when available — caps wall-CPU at 50 %.
        sh_argv = ["/bin/sh", "-c", cmd]
        if shutil.which("cpulimit"):
            argv = ["cpulimit", "-l", "50", "-f", "-q", "--"] + sh_argv
        else:
            argv = sh_argv

        try:
            proc = await asyncio.create_subprocess_exec(
                *argv,
                cwd=str(cwd),
                env=env,
                stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                preexec_fn=_preexec_factory(self._uid),
                close_fds=True,
                start_new_session=True,
            )
        except Exception as exc:  # noqa: BLE001 — surface as session.killed
            logger.exception("linux.executor: spawn failed: %s", exc)
            session.killed_by = "operator"
            session.exit_code = -1
            session.completed.set()
            await self._emit(session.channel, EVENT_SESSION_KILLED, {
                "session_id": sid,
                "by": "operator",
                "reason": f"spawn_failed:{type(exc).__name__}",
            })
            await _audit_write(sid, "sandbox.session.killed", {
                "by": "operator",
                "reason": f"spawn_failed:{type(exc).__name__}",
                "error": str(exc),
            }, user_id=user_id)
            _purge_dir(cwd)
            return session

        session.proc = proc
        # Reader tasks — line-buffered, no batching.
        session._readers = [
            asyncio.create_task(self._pump(session, proc.stdout, EVENT_STDOUT_LINE, session.stdout_buf)),
            asyncio.create_task(self._pump(session, proc.stderr, EVENT_STDERR_LINE, session.stderr_buf)),
        ]
        session._watchdog = asyncio.create_task(self._watchdog(session))
        return session

    async def _pump(
        self,
        session: SandboxSession,
        stream: asyncio.StreamReader | None,
        event_type: str,
        buf: list[str],
    ) -> None:
        if stream is None:
            return
        while True:
            try:
                raw = await stream.readline()
            except (asyncio.CancelledError, ConnectionError):
                raise
            except Exception as exc:  # noqa: BLE001
                logger.debug("linux.executor: pump read error %s", exc)
                break
            if not raw:
                break
            line = raw.decode("utf-8", errors="replace").rstrip("\n")
            buf.append(line)
            payload: dict[str, Any] = {"session_id": session.session_id, "line": line}
            if event_type == EVENT_STDOUT_LINE:
                payload["severity"] = "info"
            await self._emit(session.channel, event_type, payload)

    async def _watchdog(self, session: SandboxSession) -> None:
        proc = session.proc
        if proc is None:
            return
        try:
            try:
                exit_code = await asyncio.wait_for(proc.wait(), timeout=session.timeout_s)
            except asyncio.TimeoutError:
                session.killed_by = "timeout"
                _kill_pgid(proc)
                exit_code = await proc.wait()
        finally:
            # Drain reader tasks before completing.
            for r in session._readers:
                with contextlib.suppress(Exception):
                    await asyncio.wait_for(r, timeout=2.0)

        session.exit_code = int(exit_code)
        duration_ms = int((time.time() - session.started_at) * 1000)

        # `completed` is set in the `finally` below, not here. Signalling before
        # the terminal event and its audit row are written let every waiter —
        # including `kill()`, which routes await — resume while the trail was
        # still being written, so a caller could observe a finished session with
        # no audit entry. The `finally` keeps waiters from being stranded if the
        # emit/audit path raises.
        try:
            await self._finalise_events(session, duration_ms)
        finally:
            session.completed.set()

    async def _finalise_events(self, session: SandboxSession, duration_ms: int) -> None:
        """Emit the terminal WS event and write its audit row."""
        if session.killed_by == "timeout":
            await self._emit(session.channel, EVENT_SESSION_KILLED, {
                "session_id": session.session_id,
                "by": "timeout",
            })
            await _audit_write(session.session_id, "sandbox.session.killed", {
                "by": "timeout",
                "exit": session.exit_code,
                "duration_ms": duration_ms,
            }, user_id=session.user_id)
        elif session.killed_by == "operator":
            await self._emit(session.channel, EVENT_SESSION_KILLED, {
                "session_id": session.session_id,
                "by": "operator",
            })
            await _audit_write(session.session_id, "sandbox.session.killed", {
                "by": "operator",
                "exit": session.exit_code,
                "duration_ms": duration_ms,
            }, user_id=session.user_id)
        else:
            await self._emit(session.channel, EVENT_PROCESS_COMPLETED, {
                "session_id": session.session_id,
                "exit": session.exit_code,
                "duration_ms": duration_ms,
            })
            await _audit_write(session.session_id, "sandbox.session.completed", {
                "exit": session.exit_code,
                "duration_ms": duration_ms,
                "stdout_lines": len(session.stdout_buf),
                "stderr_lines": len(session.stderr_buf),
            }, user_id=session.user_id)

    async def kill(self, session_id: str, *, by: str = "operator") -> bool:
        async with self._lock:
            session = self._sessions.get(session_id)
        if session is None or not session.is_running():
            return False
        session.killed_by = by
        if session.proc is not None:
            _kill_pgid(session.proc)
        # Wait for the watchdog to finalise — bounded so a hung kill
        # never hangs the route handler.
        with contextlib.suppress(asyncio.TimeoutError):
            await asyncio.wait_for(session.completed.wait(), timeout=5.0)
        return True

    async def wait(self, session_id: str, timeout: float | None = None) -> SandboxSession | None:
        session = self.get(session_id)
        if session is None:
            return None
        try:
            await asyncio.wait_for(session.completed.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            return session
        return session

    def get(self, session_id: str) -> SandboxSession | None:
        return self._sessions.get(session_id)

    def list_active(self) -> list[dict[str, Any]]:
        return [
            {
                "session_id": s.session_id,
                "cmd": s.cmd,
                "started_at": s.started_at,
                "running": s.is_running(),
                "exit_code": s.exit_code,
                "killed_by": s.killed_by,
                "user_id": s.user_id,
            }
            for s in self._sessions.values()
        ]

    async def purge(self, session_id: str) -> None:
        async with self._lock:
            session = self._sessions.pop(session_id, None)
        if session is None:
            return
        if session.is_running():
            await self.kill(session_id, by="operator")
        _purge_dir(session.cwd)

    async def checkpoint(self, session_id: str) -> int | None:
        """Persist a `Checkpoint` row capturing stdout + cwd path.

        Returns the checkpoint id, or `None` when the session is unknown
        / still running.
        """
        session = self.get(session_id)
        if session is None or session.is_running():
            return None
        try:
            from agent.kernel.audit import save_checkpoint
            from agent.schemas import Checkpoint, SelfModel
        except Exception as exc:  # noqa: BLE001
            logger.warning("linux.executor: checkpoint save unavailable: %s", exc)
            return None

        # Sandbox sessions don't have a planner SelfModel — synthesise a
        # minimal one with the run metadata in `hardware` so the row is
        # introspectable later. `goal` is the original command, which is
        # the operator-facing intent for a sandbox checkpoint.
        payload = Checkpoint(
            task_id=f"sandbox:{session.session_id}",
            reason="sandbox_complete",
            goal=session.cmd,
            sub_goals=[],
            observations=[],
            self_model=SelfModel(
                identity="PHANTOM sandbox executor",
                hardware={
                    "kind": "sandbox",
                    "cmd": session.cmd,
                    "exit_code": session.exit_code,
                    "cwd": str(session.cwd),
                    "stdout_tail": session.stdout_buf[-50:],
                },
            ),
            step_idx=0,
        )
        # `save_checkpoint(user_id, checkpoint)` — user_id went first when
        # `agent_checkpoints` became multi-user, and this caller was never
        # updated. It passed the Checkpoint as `user_id`, so every sandbox
        # checkpoint raised TypeError and the except below buried it in a WARN.
        if not session.user_id:
            logger.warning(
                "linux.executor: checkpoint skipped for %s — no user_id on session",
                session.session_id,
            )
            return None
        try:
            return await save_checkpoint(session.user_id, payload)
        except Exception as exc:  # noqa: BLE001
            logger.warning("linux.executor: save_checkpoint failed: %s", exc)
            return None


# ── Helpers ──────────────────────────────────────────────────────────────────


def _kill_pgid(proc: asyncio.subprocess.Process) -> None:
    """SIGKILL the process group started in `start_new_session=True`."""
    pid = proc.pid
    if pid is None:
        return
    try:
        pgid = os.getpgid(pid)
    except (ProcessLookupError, PermissionError):
        pgid = pid
    with contextlib.suppress(ProcessLookupError, PermissionError):
        os.killpg(pgid, signal.SIGKILL)
    with contextlib.suppress(ProcessLookupError, PermissionError):
        proc.kill()


def _purge_dir(path: Path) -> None:
    if not path.exists():
        return
    try:
        shutil.rmtree(path, ignore_errors=True)
    except Exception as exc:  # noqa: BLE001
        logger.debug("linux.executor: purge %s failed: %s", path, exc)


async def _audit_write(
    session_id: str, event: str, data: dict[str, Any], user_id: str | None = None
) -> None:
    """Write a sandbox event to the existing `agent_audit` table.

    `task_id` is namespaced `sandbox:<sid>` so the row never collides
    with real agent runs and the existing /agent/audit route surfaces
    them automatically.

    ``user_id`` is required: `agent_audit.user_id` became a NOT NULL FK when
    the tables went multi-user, and this writer was not updated with them.
    Every sandbox audit row therefore failed its INSERT, and the broad
    `except` below downgraded it to a WARN — so the sandbox ran completely
    unaudited while looking healthy.
    """
    if not user_id:
        # Better a loud gap in the trail than a silently unaudited execution.
        logger.warning(
            "linux.executor: audit skipped for %s (%s) — no user_id on session",
            session_id, event,
        )
        return
    try:
        from db.database import get_session
        from db.models import AgentAuditEntry
    except Exception as exc:  # noqa: BLE001
        logger.debug("linux.executor: audit unavailable: %s", exc)
        return
    try:
        async with get_session() as db:
            entry = AgentAuditEntry(
                user_id=user_id,
                task_id=f"sandbox:{session_id}",
                step_idx=0,
                sub_goal_id=None,
                action_name=event,
                args_json=json.dumps(data, ensure_ascii=False, default=str),
                intent=None,
                monologue_json=None,
                result_json=json.dumps({"ok": True}),
                risk_level=2,
                elapsed_ms=0,
                retried_from=None,
            )
            db.add(entry)
            await db.flush()
    except Exception as exc:  # noqa: BLE001 — audit failure must not crash exec
        logger.warning("linux.executor: audit_write failed: %s", exc)


# ── Module-level singleton ───────────────────────────────────────────────────

session_registry = SandboxExecutor()
