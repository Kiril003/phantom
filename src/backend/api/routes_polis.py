"""ПОЛІС routes — missions, gates, KeyVault.

Interface layer only: every boundary input is validated here (ids,
briefs, artifact names), RBAC is enforced here (OPERATOR commands the
city, ROOT touches provider keys), execution lives in the fabric
service and the vault.
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from pydantic import BaseModel, Field, field_validator

from security.auth import TokenPayload, require_auth
from security.permissions import require_operator, require_root
from agent.fabric.service import get_polis
from agent.fabric.pipelines import PIPELINES
from ai.keyvault import get_vault

router = APIRouter(
    prefix="/polis", tags=["polis"], dependencies=[Depends(require_operator)]
)

# Every server-minted id is uuid4().hex[:12]; anything else in a path is
# either a client bug or a traversal probe — reject at the boundary.
MissionId = Annotated[str, Path(pattern=r"^[0-9a-f]{6,40}$")]
NodeId = Annotated[str, Path(pattern=r"^[0-9a-f]{6,40}$")]
GateId = Annotated[str, Path(pattern=r"^[0-9a-f]{6,40}$")]
KeyId = Annotated[str, Path(pattern=r"^[0-9a-fA-F\-]{6,64}$")]
CitizenRole = Annotated[str, Path(pattern=r"^[A-Za-z0-9_\-]{1,64}$")]


class CreateMissionRequest(BaseModel):
    brief: str = Field(min_length=3, max_length=20_000)
    pipeline: str = Field(default="generic", max_length=64)
    title: str | None = Field(default=None, max_length=200)

    @field_validator("brief")
    @classmethod
    def _brief_has_substance(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 3:
            raise ValueError("бриф закороткий")
        return v

    @field_validator("title")
    @classmethod
    def _title_stripped(cls, v: str | None) -> str | None:
        return (v or "").strip() or None


class GateDecision(BaseModel):
    approved: bool


class MissionChatRequest(BaseModel):
    text: str = Field(min_length=1, max_length=8000)


class AddKeyRequest(BaseModel):
    provider: str = Field(min_length=2, max_length=32)
    label: str = Field(default="", max_length=120)
    secret: str = Field(min_length=8, max_length=512)
    priority: int = Field(default=100, ge=0, le=10_000)


class KeyStateRequest(BaseModel):
    state: str = Field(pattern="^(active|disabled)$")


@router.get("/state")
async def polis_state(_: TokenPayload = Depends(require_auth)) -> dict:
    return await get_polis().snapshot()


@router.get("/pipelines")
async def polis_pipelines(_: TokenPayload = Depends(require_auth)) -> dict:
    return {"pipelines": [{"id": k, "domain": v} for k, v in PIPELINES.items()]}


@router.get("/citizens")
async def polis_citizens(_: TokenPayload = Depends(require_auth)) -> dict:
    from agent.fabric.citizens import get_population
    pop = get_population()
    await pop.load()
    return {"citizens": pop.census()}


@router.get("/citizens/{role}")
async def polis_citizen(
    role: CitizenRole, _: TokenPayload = Depends(require_auth)
) -> dict:
    from agent.fabric.citizens import get_population
    pop = get_population()
    await pop.load()
    return {"citizen": pop.dossier(role)}


@router.post("/missions")
async def create_mission(
    body: CreateMissionRequest,
    token: TokenPayload = Depends(require_auth),
) -> dict:
    if body.pipeline not in PIPELINES:
        raise HTTPException(400, f"unknown pipeline {body.pipeline!r}")
    mission = await get_polis().create_mission(
        token.user_id, body.brief, body.pipeline, body.title
    )
    return {"mission": mission.to_dict()}


@router.get("/missions/{mission_id}")
async def get_mission(
    mission_id: MissionId, _: TokenPayload = Depends(require_auth)
) -> dict:
    m = get_polis().missions.get(mission_id)
    if m is None:
        raise HTTPException(404, "mission not found")
    return {"mission": m.to_dict(), "chat": m.chat[-100:]}


@router.post("/missions/{mission_id}/chat")
async def mission_chat(
    mission_id: MissionId,
    body: MissionChatRequest,
    _: TokenPayload = Depends(require_auth),
) -> dict:
    try:
        reply = await get_polis().chat(mission_id, body.text)
    except KeyError:
        raise HTTPException(404, "mission not found") from None
    return {"reply": reply}


@router.get("/missions/{mission_id}/artifacts")
async def mission_artifacts(
    mission_id: MissionId, _: TokenPayload = Depends(require_auth)
) -> dict:
    return {"artifacts": get_polis().list_artifacts(mission_id)}


@router.get("/missions/{mission_id}/artifact")
async def mission_artifact(
    mission_id: MissionId,
    name: Annotated[str, Query(min_length=1, max_length=512)],
    _: TokenPayload = Depends(require_auth),
) -> dict:
    content = get_polis().read_artifact(mission_id, name)
    if content is None:
        raise HTTPException(404, "artifact not found")
    return {"name": name, "content": content}


@router.get("/missions/{mission_id}/workers")
async def mission_workers(
    mission_id: MissionId, _: TokenPayload = Depends(require_auth)
) -> dict:
    return {"workers": get_polis().workers(mission_id)}


@router.get("/missions/{mission_id}/workers/{node_id}")
async def worker_transcript(
    mission_id: MissionId, node_id: NodeId, _: TokenPayload = Depends(require_auth)
) -> dict:
    return {
        "node_id": node_id,
        "transcript": get_polis().worker_transcript(mission_id, node_id),
    }


@router.post("/missions/{mission_id}/pause")
async def pause_mission(
    mission_id: MissionId, _: TokenPayload = Depends(require_auth)
) -> dict:
    if not get_polis().pause_mission(mission_id):
        raise HTTPException(404, "mission not found")
    return {"ok": True}


@router.post("/missions/{mission_id}/resume")
async def resume_mission(
    mission_id: MissionId, _: TokenPayload = Depends(require_auth)
) -> dict:
    if not get_polis().resume_mission(mission_id):
        raise HTTPException(404, "mission not found")
    return {"ok": True}


@router.post("/missions/{mission_id}/kill")
async def kill_mission(
    mission_id: MissionId, _: TokenPayload = Depends(require_auth)
) -> dict:
    if not await get_polis().kill_mission(mission_id):
        raise HTTPException(404, "mission not found")
    return {"ok": True}


@router.delete("/missions/{mission_id}")
async def delete_mission(
    mission_id: MissionId, _: TokenPayload = Depends(require_auth)
) -> dict:
    if not await get_polis().delete_mission(mission_id):
        raise HTTPException(404, "mission not found")
    return {"ok": True}


@router.post("/gates/{gate_id}")
async def resolve_gate(
    gate_id: GateId,
    body: GateDecision,
    _: TokenPayload = Depends(require_auth),
) -> dict:
    if not await get_polis().resolve_gate(gate_id, body.approved):
        raise HTTPException(404, "gate not found")
    return {"ok": True}


# ── KeyVault — provider secrets; mutations are ROOT-only ─────────────────


@router.get("/keys")
async def list_keys(_: TokenPayload = Depends(require_auth)) -> dict:
    return {"keys": await get_vault().list_keys()}


@router.post("/keys", dependencies=[Depends(require_root)])
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


@router.patch("/keys/{key_id}", dependencies=[Depends(require_root)])
async def set_key_state(
    key_id: KeyId,
    body: KeyStateRequest,
    _: TokenPayload = Depends(require_auth),
) -> dict:
    if not await get_vault().set_state(key_id, body.state):
        raise HTTPException(404, "key not found")
    return {"ok": True}


@router.delete("/keys/{key_id}", dependencies=[Depends(require_root)])
async def delete_key(
    key_id: KeyId, _: TokenPayload = Depends(require_auth)
) -> dict:
    if not await get_vault().remove_key(key_id):
        raise HTTPException(404, "key not found")
    return {"ok": True}
