"""
Phase 24-I — Map Geofence routes.
"""
from __future__ import annotations

import json
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_db
from db.models import Geofence
from security.auth import require_auth
from security.jwt_manager import TokenPayload

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/map/geofences", tags=["map", "geofences"])

class GeofenceCreate(BaseModel):
    label: str = Field(..., min_length=1, max_length=160)
    kind: str = Field(default="circle") # circle | polygon
    geometry: dict = Field(...)
    on_enter: List[dict] = Field(default_factory=list)
    on_exit: List[dict] = Field(default_factory=list)

class GeofenceResponse(BaseModel):
    id: str
    label: str
    kind: str
    geometry: dict
    is_active: bool
    on_enter: List[dict]
    on_exit: List[dict]
    created_at: str

@router.post("/", response_model=GeofenceResponse)
async def create_geofence(
    payload: GeofenceCreate,
    auth: TokenPayload = Depends(require_auth),
    db: AsyncSession = Depends(get_db)
):
    """Register a new geofence."""
    gf = Geofence(
        user_id=auth.user_id,
        label=payload.label,
        kind=payload.kind,
        geometry_json=json.dumps(payload.geometry),
        on_enter_json=json.dumps(payload.on_enter),
        on_exit_json=json.dumps(payload.on_exit),
    )
    db.add(gf)
    await db.commit()
    await db.refresh(gf)
    
    return GeofenceResponse(
        id=gf.id,
        label=gf.label,
        kind=gf.kind,
        geometry=payload.geometry,
        is_active=gf.is_active,
        on_enter=payload.on_enter,
        on_exit=payload.on_exit,
        created_at=gf.created_at.isoformat()
    )

@router.get("/", response_model=List[GeofenceResponse])
async def list_geofences(
    auth: TokenPayload = Depends(require_auth),
    db: AsyncSession = Depends(get_db)
):
    """List user geofences."""
    result = await db.execute(
        select(Geofence).where(Geofence.user_id == auth.user_id)
    )
    gfs = result.scalars().all()
    return [
        GeofenceResponse(
            id=gf.id,
            label=gf.label,
            kind=gf.kind,
            geometry=json.loads(gf.geometry_json),
            is_active=gf.is_active,
            on_enter=json.loads(gf.on_enter_json),
            on_exit=json.loads(gf.on_exit_json),
            created_at=gf.created_at.isoformat()
        ) for gf in gfs
    ]

@router.delete("/{geofence_id}")
async def delete_geofence(
    geofence_id: str,
    auth: TokenPayload = Depends(require_auth),
    db: AsyncSession = Depends(get_db)
):
    """Remove a geofence."""
    await db.execute(
        delete(Geofence).where(
            Geofence.id == geofence_id, 
            Geofence.user_id == auth.user_id
        )
    )
    await db.commit()
    return {"ok": True}
