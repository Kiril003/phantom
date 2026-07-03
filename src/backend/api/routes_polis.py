"""ПОЛІС routes — missions, gates, KeyVault."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from security.auth import TokenPayload, require_auth
from agent.fabric.service import get_polis
from agent.fabric.pipelines import PIPELINES
from ai.keyvault import get_vault

router = APIRouter(prefix="/polis", tags=["polis"])


class CreateMissionRequest(BaseModel):
    brief: str = Field(min_length=3, max_length=20_000)
    pipeline: str = "generic"
    title: str | None = None


class GateDecision(BaseModel):
    approved: bool


class AddKeyRequest(BaseModel):
    provider: str = Field(min_length=2, max_length=32)
    label: str = ""
    secret: str = Field(min_length=8, max_length=512)
    priority: int = 100


class KeyStateRequest(BaseModel):
    state: str = Field(pattern="^(active|disabled)$")


@router.get("/state")
async def polis_state(_: TokenPayload = Depends(require_auth)) -> dict:
    return await get_polis().snapshot()


@router.get("/pipelines")
async def polis_pipelines(_: TokenPayload = Depends(require_auth)) -> dict:
    return {"pipelines": [{"id": k, "domain": v} for k, v in PIPELINES.items()]}


@router.post("/missions")
async def create_mission(
    body: CreateMissionRequest,
    token: TokenPayload = Depends(require_auth),
) -> dict:
    if body.pipeline not in PIPELINES:
        raise HTTPException(400, f"unknown pipeline {body.pipeline!r}")
    mission = await get_polis().create_mission(
        token.sub, body.brief, body.pipeline, body.title
    )
    return {"mission": mission.to_dict()}


@router.get("/missions/{mission_id}")
async def get_mission(
    mission_id: str, _: TokenPayload = Depends(require_auth)
) -> dict:
    m = get_polis().missions.get(mission_id)
    if m is None:
        raise HTTPException(404, "mission not found")
    return {"mission": m.to_dict()}


@router.post("/missions/{mission_id}/pause")
async def pause_mission(
    mission_id: str, _: TokenPayload = Depends(require_auth)
) -> dict:
    if not get_polis().pause_mission(mission_id):
        raise HTTPException(404, "mission not found")
    return {"ok": True}


@router.post("/missions/{mission_id}/resume")
async def resume_mission(
    mission_id: str, _: TokenPayload = Depends(require_auth)
) -> dict:
    if not get_polis().resume_mission(mission_id):
        raise HTTPException(404, "mission not found")
    return {"ok": True}


@router.post("/missions/{mission_id}/kill")
async def kill_mission(
    mission_id: str, _: TokenPayload = Depends(require_auth)
) -> dict:
    if not await get_polis().kill_mission(mission_id):
        raise HTTPException(404, "mission not found")
    return {"ok": True}


@router.post("/gates/{gate_id}")
async def resolve_gate(
    gate_id: str,
    body: GateDecision,
    _: TokenPayload = Depends(require_auth),
) -> dict:
    if not await get_polis().resolve_gate(gate_id, body.approved):
        raise HTTPException(404, "gate not found")
    return {"ok": True}


# ── KeyVault ─────────────────────────────────────────────────────────────


@router.get("/keys")
async def list_keys(_: TokenPayload = Depends(require_auth)) -> dict:
    return {"keys": await get_vault().list_keys()}


@router.post("/keys")
async def add_key(
    body: AddKeyRequest, _: TokenPayload = Depends(require_auth)
) -> dict:
    key_id = await get_vault().add_key(
        provider=body.provider,
        label=body.label,
        secret=body.secret,
        priority=body.priority,
    )
    return {"id": key_id}


@router.patch("/keys/{key_id}")
async def set_key_state(
    key_id: str,
    body: KeyStateRequest,
    _: TokenPayload = Depends(require_auth),
) -> dict:
    if not await get_vault().set_state(key_id, body.state):
        raise HTTPException(404, "key not found")
    return {"ok": True}


@router.delete("/keys/{key_id}")
async def delete_key(
    key_id: str, _: TokenPayload = Depends(require_auth)
) -> dict:
    if not await get_vault().remove_key(key_id):
        raise HTTPException(404, "key not found")
    return {"ok": True}
