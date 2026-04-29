"""Linux execution & sandbox routes.

`/execute` + `/resources` predate the sandbox redesign and stay scoped
to OPERATOR — they wrap the legacy `agent.actions.bash.BashRun` flow.

`/sandbox/*` is the phase-5-R3-BE-SBX surface — ROOT-only, rlimit-bound,
WS-streamed via `sandbox.<session_id>` channel, audited per
CONTRACTS_R1 §SandboxEvent.
"""
from __future__ import annotations

import asyncio
import os

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from agent.actions.bash import BashRun
from agent.actions.base import ActionContext
from config import config
from db.models import User
from linux import dangerous_patterns
from linux.executor import session_registry
from linux.resource_monitor import snapshot as resource_snapshot
from security.permissions import require_operator, require_root

router = APIRouter(prefix="/linux", tags=["linux"])


# ── Legacy operator-grade execute / resources ────────────────────────────────


class ExecuteRequest(BaseModel):
    command: str
    timeout_s: int = 30
    confirmed: bool = False


@router.post("/execute")
async def execute_command(
    req: ExecuteRequest,
    _current_user: User = Depends(require_operator),
) -> dict:
    """Phase 9.5 — execute a sandboxed shell command via legacy BashRun.

    If `config.security_dangerous_cmd_confirm` is enabled, commands
    containing dangerous patterns (rm, chmod, etc.) require
    `confirmed=True`.
    """
    cmd = req.command.strip()
    if not cmd:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Empty command")

    legacy_dangerous = ["rm ", "chmod ", "chown ", "mv ", "> /", ">> /", "fuser -k"]
    is_dangerous = any(p in cmd for p in legacy_dangerous)

    if is_dangerous and config.security_dangerous_cmd_confirm and not req.confirmed:
        return {
            "ok": False,
            "needs_confirmation": True,
            "message": f"Command {cmd!r} contains dangerous patterns. Proceed with confirmation?",
        }

    action = BashRun(cmd=cmd, timeout_s=req.timeout_s)
    ws_dir = os.path.expanduser(config.agent_workspace_dir)
    if not os.path.exists(ws_dir):
        try:
            os.makedirs(ws_dir, exist_ok=True)
        except Exception:
            ws_dir = "/tmp"

    ctx = ActionContext(task_id="terminal_manual", step_idx=0, workspace_dir=ws_dir)
    result = await action.execute(ctx)
    return result.model_dump()


@router.get("/resources")
async def get_resources(
    _current_user: User = Depends(require_operator),
) -> dict:
    """Phase 9.5 — host resource monitoring."""
    return resource_snapshot()


# ── ROOT-gated sandbox surface (phase-5-R3-BE-SBX) ───────────────────────────


class SandboxCreateRequest(BaseModel):
    cmd: str = Field(..., min_length=1, max_length=4096)
    timeout_s: int = Field(default=30, ge=1, le=120)
    wait: bool = Field(
        default=False,
        description="Block until process completes (or timeout). For tests + simple CLI clients.",
    )


@router.post("/sandbox/session")
async def sandbox_create_session(
    req: SandboxCreateRequest,
    current_user: User = Depends(require_root),
) -> dict:
    """Create a sandbox session. ROOT-only. Streams events on
    `sandbox.<session_id>` WS channel."""
    cmd = req.cmd.strip()
    if not cmd:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Empty command")

    violation = dangerous_patterns.find_violation(cmd)
    session = await session_registry.create_session(
        cmd,
        user_id=current_user.id,
        timeout_s=req.timeout_s,
        is_root=True,
    )

    response: dict = {
        "session_id": session.session_id,
        "channel": session.channel,
        "cwd": str(session.cwd),
        "started_at": session.started_at,
        "blocked": violation is not None,
        "blocked_pattern": violation,
    }

    if violation is not None:
        return response

    if req.wait:
        await session_registry.wait(session.session_id, timeout=req.timeout_s + 5)
        response["exit_code"] = session.exit_code
        response["killed_by"] = session.killed_by
        response["stdout"] = list(session.stdout_buf)
        response["stderr"] = list(session.stderr_buf)

    return response


@router.post("/sandbox/{session_id}/kill")
async def sandbox_kill(
    session_id: str,
    _current_user: User = Depends(require_root),
) -> dict:
    """Operator-initiated kill. ROOT-only. Emits `session.killed` with by=operator."""
    killed = await session_registry.kill(session_id, by="operator")
    if not killed:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found or already finished",
        )
    return {"ok": True, "session_id": session_id, "by": "operator"}


@router.post("/sandbox/{session_id}/checkpoint")
async def sandbox_checkpoint(
    session_id: str,
    _current_user: User = Depends(require_root),
) -> dict:
    """Persist a checkpoint snapshot of stdout + cwd path."""
    session = session_registry.get(session_id)
    if session is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Session not found")
    if session.is_running():
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="Session still running — kill or wait before checkpoint.",
        )
    cp_id = await session_registry.checkpoint(session_id)
    if cp_id is None:
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Checkpoint save failed",
        )
    return {"ok": True, "session_id": session_id, "checkpoint_id": cp_id}


@router.get("/sandbox/sessions")
async def sandbox_list_sessions(
    _current_user: User = Depends(require_root),
) -> dict:
    """Live registry — handy for the operator UI."""
    return {"sessions": session_registry.list_active()}


@router.delete("/sandbox/{session_id}")
async def sandbox_purge(
    session_id: str,
    _current_user: User = Depends(require_root),
) -> dict:
    """Kill (if running) + remove the cwd jail + drop from the registry."""
    if session_registry.get(session_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Session not found")
    await session_registry.purge(session_id)
    return {"ok": True, "session_id": session_id}
