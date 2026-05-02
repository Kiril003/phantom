"""
Phase 17b — Agent Studio HTTP API.

Endpoints:
  GET  /api/v1/studio/cards/catalog
  GET  /api/v1/studio/agents
  POST /api/v1/studio/agents
  GET  /api/v1/studio/agents/{id}
  PATCH /api/v1/studio/agents/{id}
  DELETE /api/v1/studio/agents/{id}
  POST /api/v1/studio/agents/{id}/run
  GET  /api/v1/studio/agents/{id}/runs
  POST /api/v1/studio/agents/{id}/clone
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from agent.studio import (
    AgentCard,
    AgentCardLink,
    CustomAgent,
    Recipient,
    RunSpec,
    Schedule,
)
from agent.studio.catalog import list_catalog
from agent.studio.repository import (
    delete_agent,
    get_agent,
    list_agents,
    list_runs,
    save_agent,
)
from agent.studio.runner import run_custom_agent
from agent.studio.validate import has_blockers, validate_agent
from security.auth import require_auth
from security.jwt_manager import TokenPayload

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/studio", tags=["studio"])


def _now() -> datetime:
    return datetime.now(tz=timezone.utc)


# ── Schemas (request payloads) ───────────────────────────────────────────────


class AgentUpsertPayload(BaseModel):
    """Body for create / update. Same shape as CustomAgent but without server-set fields."""
    id: str | None = None
    name: str = Field(..., min_length=2, max_length=160)
    description: str = Field(default="", max_length=2000)
    avatar: str | None = None
    tags: list[str] = Field(default_factory=list)
    goal_template: str = Field(default="", max_length=4000)
    inputs_schema: list[dict] = Field(default_factory=list)
    cards: list[dict] = Field(default_factory=list)
    links: list[dict] = Field(default_factory=list)
    recipients: list[dict] = Field(default_factory=list)
    schedule: dict = Field(default_factory=dict)
    enabled: bool = True


class AgentRunPayload(BaseModel):
    inputs: dict = Field(default_factory=dict)
    track: str = Field(default="foreground", pattern=r"^(foreground|background)$")
    note: str | None = None


def _payload_to_agent(payload: AgentUpsertPayload, owner_user_id: str, *, agent_id: str | None = None) -> CustomAgent:
    schedule_obj = Schedule(**payload.schedule) if payload.schedule else Schedule()
    cards = [AgentCard(**c) for c in payload.cards if isinstance(c, dict)]
    links = [AgentCardLink(**l) for l in payload.links if isinstance(l, dict)]
    recipients = [Recipient(**r) for r in payload.recipients if isinstance(r, dict)]
    inputs_schema_raw = payload.inputs_schema or []
    return CustomAgent(
        id=agent_id or payload.id or str(uuid.uuid4()),
        owner_user_id=owner_user_id,
        name=payload.name.strip(),
        description=payload.description,
        avatar=payload.avatar,
        tags=payload.tags,
        goal_template=payload.goal_template,
        inputs_schema=inputs_schema_raw,  # type: ignore[arg-type]
        cards=cards,
        links=links,
        recipients=recipients,
        schedule=schedule_obj,
        enabled=payload.enabled,
        updated_at=_now(),
    )


# ── Routes ──────────────────────────────────────────────────────────────────


@router.get("/cards/catalog")
async def get_card_catalog(_: TokenPayload = Depends(require_auth)) -> dict:
    return {"entries": list_catalog()}


@router.get("/agents")
async def list_agents_route(
    token_data: TokenPayload = Depends(require_auth),
    limit: int = Query(default=100, ge=1, le=500),
) -> dict:
    agents = await list_agents(token_data.user_id, limit=limit)
    return {"agents": [a.model_dump(mode="json") for a in agents]}


@router.post("/agents")
async def create_agent_route(
    payload: AgentUpsertPayload,
    token_data: TokenPayload = Depends(require_auth),
) -> dict:
    agent = _payload_to_agent(payload, token_data.user_id)
    issues = validate_agent(agent)
    if has_blockers(issues):
        raise HTTPException(
            status_code=422,
            detail={"issues": [i.__dict__ for i in issues]},
        )
    saved = await save_agent(agent)
    return {
        "agent": saved.model_dump(mode="json"),
        "warnings": [i.__dict__ for i in issues if i.severity == "warning"],
    }


@router.get("/agents/{agent_id}")
async def get_agent_route(
    agent_id: str,
    token_data: TokenPayload = Depends(require_auth),
) -> dict:
    agent = await get_agent(agent_id)
    if agent is None or agent.owner_user_id != token_data.user_id:
        raise HTTPException(status_code=404, detail="agent not found")
    return {"agent": agent.model_dump(mode="json")}


@router.patch("/agents/{agent_id}")
async def update_agent_route(
    agent_id: str,
    payload: AgentUpsertPayload,
    token_data: TokenPayload = Depends(require_auth),
) -> dict:
    existing = await get_agent(agent_id)
    if existing is None or existing.owner_user_id != token_data.user_id:
        raise HTTPException(status_code=404, detail="agent not found")
    updated = _payload_to_agent(payload, existing.owner_user_id, agent_id=agent_id)
    # Preserve counters / created_at.
    updated.created_at = existing.created_at
    updated.run_count = existing.run_count
    updated.success_count = existing.success_count
    updated.last_run_at = existing.last_run_at
    issues = validate_agent(updated)
    if has_blockers(issues):
        raise HTTPException(
            status_code=422,
            detail={"issues": [i.__dict__ for i in issues]},
        )
    saved = await save_agent(updated)
    return {
        "agent": saved.model_dump(mode="json"),
        "warnings": [i.__dict__ for i in issues if i.severity == "warning"],
    }


@router.delete("/agents/{agent_id}")
async def delete_agent_route(
    agent_id: str,
    token_data: TokenPayload = Depends(require_auth),
) -> dict:
    existing = await get_agent(agent_id)
    if existing is None or existing.owner_user_id != token_data.user_id:
        raise HTTPException(status_code=404, detail="agent not found")
    ok = await delete_agent(agent_id)
    return {"deleted": ok}


@router.post("/agents/{agent_id}/run")
async def run_agent_route(
    agent_id: str,
    payload: AgentRunPayload,
    token_data: TokenPayload = Depends(require_auth),
) -> dict:
    agent = await get_agent(agent_id)
    if agent is None or agent.owner_user_id != token_data.user_id:
        raise HTTPException(status_code=404, detail="agent not found")
    issues = validate_agent(agent)
    if has_blockers(issues):
        raise HTTPException(
            status_code=409,
            detail={"issues": [i.__dict__ for i in issues]},
        )
    spec = RunSpec(
        agent_id=agent.id,
        inputs=payload.inputs,
        track=payload.track,  # type: ignore[arg-type]
        note=payload.note,
    )
    task_id, run_id = await run_custom_agent(
        agent, spec,
        triggered_by="manual",
        user_name=getattr(token_data, "username", None),
    )
    return {"task_id": task_id, "run_id": run_id}


@router.get("/agents/{agent_id}/runs")
async def list_agent_runs_route(
    agent_id: str,
    token_data: TokenPayload = Depends(require_auth),
    limit: int = Query(default=50, ge=1, le=500),
) -> dict:
    agent = await get_agent(agent_id)
    if agent is None or agent.owner_user_id != token_data.user_id:
        raise HTTPException(status_code=404, detail="agent not found")
    runs = await list_runs(agent_id, limit=limit)
    return {"runs": [r.model_dump(mode="json") for r in runs]}


# ── Phase 17b — Conversational BuilderSession ───────────────────────────────


class BuilderStartPayload(BaseModel):
    initial_intent: str = Field(default="", max_length=2000)


class BuilderStepPayload(BaseModel):
    draft_id: str = Field(..., min_length=1)
    answer: object | None = None


@router.post("/builder/start")
async def builder_start_route(
    payload: BuilderStartPayload,
    token_data: TokenPayload = Depends(require_auth),
) -> dict:
    from agent.studio.builder import start_builder
    turn = start_builder(
        owner_user_id=token_data.user_id,
        initial_intent=payload.initial_intent,
    )
    return {
        "draft_id": turn.draft_id,
        "step": turn.step,
        "info_need": turn.info_need.model_dump(mode="json") if turn.info_need else None,
        "finished": turn.finished,
    }


@router.post("/builder/step")
async def builder_step_route(
    payload: BuilderStepPayload,
    _: TokenPayload = Depends(require_auth),
) -> dict:
    from agent.studio.builder import advance
    try:
        turn = await advance(draft_id=payload.draft_id, answer=payload.answer)
    except KeyError:
        raise HTTPException(status_code=404, detail="builder draft not found")
    return {
        "draft_id": turn.draft_id,
        "step": turn.step,
        "info_need": turn.info_need.model_dump(mode="json") if turn.info_need else None,
        "finished": turn.finished,
        "saved_agent_id": turn.saved_agent_id,
        "summary": turn.summary,
    }


@router.post("/builder/{draft_id}/cancel")
async def builder_cancel_route(
    draft_id: str,
    _: TokenPayload = Depends(require_auth),
) -> dict:
    from agent.studio.builder import cancel
    return {"cancelled": cancel(draft_id)}


@router.post("/agents/{agent_id}/clone")
async def clone_agent_route(
    agent_id: str,
    token_data: TokenPayload = Depends(require_auth),
) -> dict:
    src = await get_agent(agent_id)
    if src is None or src.owner_user_id != token_data.user_id:
        raise HTTPException(status_code=404, detail="agent not found")
    cloned = src.model_copy(update={
        "id": str(uuid.uuid4()),
        "name": f"{src.name} (копія)",
        "created_at": _now(),
        "updated_at": _now(),
        "last_run_at": None,
        "run_count": 0,
        "success_count": 0,
    })
    saved = await save_agent(cloned)
    return {"agent": saved.model_dump(mode="json")}
