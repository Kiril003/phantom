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


@router.get("/status")
async def get_agent_status(_: TokenPayload = Depends(require_auth)) -> dict:
    """
    Phase 9.4a — multi-track runtime status.

    Reports per-track slot state + queue depth so UIs can show "PHANTOM
    is watching N things in the background" without racing the WS
    background_events channel. Substate is foreground-canonical (the
    StatusBar already shows it); background substate is included but
    may be stale since it's log-only.
    """
    def _slot_view(state, substate):
        if state is None:
            return {"active": False, "task_id": None, "substate": substate,
                    "goal": None, "origin": None}
        return {
            "active": True,
            "task_id": state.id,
            "substate": substate,
            "goal": (state.goal or "")[:200],
            "origin": getattr(state, "origin", "user"),
            "status": state.status,
        }

    return {
        "foreground": {
            **_slot_view(agent_runtime.foreground_slot, agent_runtime.foreground_substate),
            "queue_size": agent_runtime.queue_size("foreground"),
        },
        "background": {
            **_slot_view(agent_runtime.background_slot, agent_runtime.background_substate),
            "queue_size": agent_runtime.queue_size("background"),
        },
    }


@router.get("/router_state")
async def get_router_state(_: TokenPayload = Depends(require_auth)) -> dict:
    """
    Phase 9.2.1 — exposes AIRouter cooling / quota / last-call state so the
    StatusBar can show a live provider indicator and the operator can spot
    why a task parked on `blocked_quota`.
    """
    from ai.provider import ai_router
    return ai_router.router_state_snapshot()


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


# ── Standing orders (Phase 9.3b) ─────────────────────────────────────────────


class StandingOrderCreate(BaseModel):
    description: str = Field(..., min_length=1, max_length=256)
    kind: str = Field(..., pattern=r"^(interval|cron|conditional|one_shot_future)$")
    schedule: dict = Field(...)
    action: dict = Field(...)
    enabled: bool = True


class StandingOrderPatch(BaseModel):
    enabled: bool | None = None
    description: str | None = Field(default=None, max_length=256)
    schedule: dict | None = None
    action: dict | None = None


def _so_to_dict(row) -> dict:
    import json as _json
    return {
        "id": row.id,
        "user_id": row.user_id,
        "description": row.description,
        "kind": row.kind,
        "schedule": _json.loads(row.schedule_json),
        "action": _json.loads(row.action_json),
        "enabled": row.enabled,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "last_fired_at": row.last_fired_at.isoformat() if row.last_fired_at else None,
        "fire_count": row.fire_count,
        "last_outcome": row.last_outcome,
    }


@router.post("/standing_orders")
async def create_standing_order(
    req: StandingOrderCreate,
    token_data: TokenPayload = Depends(require_auth),
) -> dict:
    import json as _json
    from sqlalchemy import select
    from agent.standing_orders.schedules import parse_schedule
    from agent.standing_orders.conditions import evaluate_condition  # noqa: F401
    from agent.standing_orders.schedules import ConditionalSchedule
    from db.database import get_session
    from db.models import StandingOrder as _SO

    # Validate schedule early — rejecting at write time is better than at
    # fire time.
    payload = dict(req.schedule)
    payload.setdefault("kind", req.kind)
    try:
        schedule = parse_schedule(payload)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"invalid schedule: {exc}")
    # Validate condition DSL up-front so bad conditions fail at creation.
    if isinstance(schedule, ConditionalSchedule):
        import re as _re
        if not _re.match(
            r"^\s*[a-z_]+\s*(==|>=|<=|>|<)\s*-?\d+(\.\d+)?\s*$",
            schedule.condition,
        ):
            raise HTTPException(status_code=422, detail="invalid condition DSL")
        # Also assert metric is known.
        from agent.standing_orders.conditions import KNOWN_CONDITIONS
        metric = schedule.condition.split()[0]
        if metric not in KNOWN_CONDITIONS:
            raise HTTPException(
                status_code=422,
                detail=f"unknown metric {metric!r}; supported: {sorted(KNOWN_CONDITIONS)}",
            )

    async with get_session() as db:
        row = _SO(
            user_id=token_data.user_id,
            description=req.description,
            kind=req.kind,
            schedule_json=_json.dumps(payload),
            action_json=_json.dumps(req.action),
            enabled=req.enabled,
        )
        db.add(row)
        await db.commit()
        result = await db.execute(select(_SO).where(_SO.id == row.id))
        fresh = result.scalar_one()
    return {"order": _so_to_dict(fresh)}


@router.get("/standing_orders")
async def list_standing_orders(
    token_data: TokenPayload = Depends(require_auth),
) -> dict:
    from sqlalchemy import select
    from db.database import get_session
    from db.models import StandingOrder as _SO

    async with get_session() as db:
        result = await db.execute(
            select(_SO).where(_SO.user_id == token_data.user_id)
            .order_by(_SO.created_at.desc())
        )
        rows = list(result.scalars())
    return {"orders": [_so_to_dict(r) for r in rows]}


@router.patch("/standing_orders/{order_id}")
async def patch_standing_order(
    order_id: str,
    req: StandingOrderPatch,
    token_data: TokenPayload = Depends(require_auth),
) -> dict:
    import json as _json
    from sqlalchemy import select
    from db.database import get_session
    from db.models import StandingOrder as _SO

    async with get_session() as db:
        result = await db.execute(select(_SO).where(_SO.id == order_id))
        row = result.scalar_one_or_none()
        if row is None or row.user_id != token_data.user_id:
            raise HTTPException(status_code=404, detail="standing order not found")
        if req.enabled is not None:
            row.enabled = req.enabled
        if req.description is not None:
            row.description = req.description
        if req.schedule is not None:
            from agent.standing_orders.schedules import parse_schedule
            payload = dict(req.schedule)
            payload.setdefault("kind", row.kind)
            try:
                parse_schedule(payload)
            except Exception as exc:
                raise HTTPException(status_code=422, detail=f"invalid schedule: {exc}")
            row.schedule_json = _json.dumps(payload)
        if req.action is not None:
            row.action_json = _json.dumps(req.action)
        await db.commit()
        fresh_result = await db.execute(select(_SO).where(_SO.id == order_id))
        fresh = fresh_result.scalar_one()
    return {"order": _so_to_dict(fresh)}


@router.delete("/standing_orders/{order_id}")
async def delete_standing_order(
    order_id: str,
    token_data: TokenPayload = Depends(require_auth),
) -> dict:
    from sqlalchemy import delete, select
    from db.database import get_session
    from db.models import StandingOrder as _SO

    async with get_session() as db:
        result = await db.execute(select(_SO).where(_SO.id == order_id))
        row = result.scalar_one_or_none()
        if row is None or row.user_id != token_data.user_id:
            raise HTTPException(status_code=404, detail="standing order not found")
        await db.execute(delete(_SO).where(_SO.id == order_id))
        await db.commit()
    return {"deleted": True, "id": order_id}


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
