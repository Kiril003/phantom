"""
Agent API — task control + read endpoints + feedback. All require JWT auth.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field

from agent.audit import (
    fetch_audit,
    fetch_checkpoint,
    get_task as fetch_task_row,
    list_tasks as audit_list_tasks,
    write_feedback,
)
from agent.runtime import agent_runtime
from security.auth import require_auth
from security.jwt_manager import TokenPayload

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/agent", tags=["agent"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class StartTaskRequest(BaseModel):
    goal: str = Field(..., min_length=1, max_length=2000)


class InterveneRequest(BaseModel):
    instruction: str = Field(..., min_length=1, max_length=4000)


class StopRequest(BaseModel):
    task_id: str | None = None


class ResumeFromCheckpointRequest(BaseModel):
    checkpoint_id: int


class FeedbackRequest(BaseModel):
    audit_entry_id: int
    rating: str = Field(..., pattern=r"^(up|down|comment)$")
    comment: str | None = Field(default=None, max_length=2000)


# ── Routes ───────────────────────────────────────────────────────────────────

@router.post("/task")
async def start_task(
    req: StartTaskRequest,
    response: Response,
    _: TokenPayload = Depends(require_auth),
) -> dict:
    task_id, started = await agent_runtime.start_task(req.goal)
    if not started:
        response.status_code = 409
        return {
            "task_id": task_id,
            "started": False,
            "detail": "Foreground slot busy — pause/stop the running task first.",
        }
    return {"task_id": task_id, "started": True}


@router.post("/task/{task_id}/pause")
async def pause_task(task_id: str, _: TokenPayload = Depends(require_auth)) -> dict:
    paused = await agent_runtime.pause(task_id)
    return {"paused": paused}


@router.post("/task/{task_id}/resume")
async def resume_task(task_id: str, _: TokenPayload = Depends(require_auth)) -> dict:
    resumed = await agent_runtime.resume(task_id)
    return {"resumed": resumed}


@router.post("/task/{task_id}/intervene")
async def intervene_task(
    task_id: str,
    req: InterveneRequest,
    _: TokenPayload = Depends(require_auth),
) -> dict:
    queued = await agent_runtime.intervene(task_id, req.instruction)
    return {"queued": queued}


@router.post("/task/{task_id}/cancel_step")
async def cancel_step(task_id: str, _: TokenPayload = Depends(require_auth)) -> dict:
    cancelled = await agent_runtime.cancel_step(task_id)
    return {"cancelled": cancelled}


@router.post("/stop")
async def stop_task(req: StopRequest, _: TokenPayload = Depends(require_auth)) -> dict:
    stopped = await agent_runtime.stop(req.task_id)
    return {"stopped": stopped}


@router.post("/task/{task_id}/checkpoint")
async def create_checkpoint(task_id: str, _: TokenPayload = Depends(require_auth)) -> dict:
    cp_id = await agent_runtime.checkpoint_now(task_id)
    if cp_id is None:
        raise HTTPException(status_code=404, detail="task not active")
    return {"checkpoint_id": cp_id}


@router.post("/task/{task_id}/resume_from_checkpoint")
async def resume_from_checkpoint(
    task_id: str,
    req: ResumeFromCheckpointRequest,
    _: TokenPayload = Depends(require_auth),
) -> dict:
    cp = await fetch_checkpoint(req.checkpoint_id)
    if cp is None:
        raise HTTPException(status_code=404, detail="checkpoint not found")
    if cp.task_id != task_id:
        raise HTTPException(status_code=400, detail="checkpoint belongs to a different task")
    ok = await agent_runtime.resume_from_checkpoint(task_id, req.checkpoint_id)
    if not ok:
        raise HTTPException(status_code=409, detail="cannot resume — slot busy or task already running")
    return {"resumed": True}


@router.get("/tasks")
async def list_tasks(
    status: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
    _: TokenPayload = Depends(require_auth),
) -> dict:
    rows = await audit_list_tasks(status=status, limit=limit)
    return {"tasks": [_serialize_task(r) for r in rows]}


@router.get("/task/{task_id}")
async def get_task(task_id: str, _: TokenPayload = Depends(require_auth)) -> dict:
    row = await fetch_task_row(task_id)
    if row is None:
        raise HTTPException(status_code=404, detail="task not found")
    last_audit = await fetch_audit(task_id, limit=50)
    return {
        "task": _serialize_task(row),
        "sub_goals": row.get("sub_goals") or [],
        "self_model": row.get("self_model"),
        "observations": row.get("observations") or [],
        "thought_budget": row.get("thought_budget"),
        "last_audit": [a.model_dump(mode="json") for a in reversed(last_audit)],
    }


@router.get("/audit")
async def get_audit(
    task_id: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
    _: TokenPayload = Depends(require_auth),
) -> dict:
    rows = await fetch_audit(task_id, limit=limit)
    return {"audit": [a.model_dump(mode="json") for a in rows]}


@router.get("/self_model")
async def get_self_model(_: TokenPayload = Depends(require_auth)) -> dict:
    sm = agent_runtime.self_model
    if sm is None:
        # Build an ad-hoc one for inspection
        from agent.actions.registry import registry as _reg
        from agent.self_model import build_self_model
        sm = await build_self_model(_reg)
    return {"self_model": sm.model_dump(mode="json"), "substate": agent_runtime.substate}


@router.post("/feedback")
async def submit_feedback(
    req: FeedbackRequest,
    _: TokenPayload = Depends(require_auth),
) -> dict:
    fb_id = await write_feedback(req.audit_entry_id, req.rating, req.comment)
    return {"id": fb_id}


def _serialize_task(row: dict) -> dict:
    out = dict(row)
    for key in ("created_at", "finished_at"):
        v = out.get(key)
        if v is not None and hasattr(v, "isoformat"):
            out[key] = v.isoformat()
    # Drop heavy blobs from list views (callers can hit /task/{id} for them).
    for k in ("observations", "self_model", "thought_budget", "sub_goals"):
        out.pop(k, None)
    return out
