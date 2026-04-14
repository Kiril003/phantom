"""Map & Wardriving routes."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from db.database import get_db
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(prefix="/map", tags=["map"])


class POICreate(BaseModel):
    user_id: str
    lat: float
    lon: float
    name: str
    category: str = "custom"
    notes: str = ""
    icon: str = "📍"
    is_secret: bool = False


@router.get("/wardriving")
async def get_wardriving(
    bounds: str | None = None,
    since: str | None = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Implemented in Phase 07",
    )


@router.get("/heatmap")
async def get_heatmap(
    bounds: str | None = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Implemented in Phase 07",
    )


@router.get("/pois")
async def get_pois(
    category: str | None = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Implemented in Phase 07",
    )


@router.post("/pois")
async def create_poi(
    poi: POICreate,
    db: AsyncSession = Depends(get_db),
) -> dict:
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Implemented in Phase 07",
    )


@router.get("/track")
async def get_track(
    hours: int = 2,
    db: AsyncSession = Depends(get_db),
) -> dict:
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Implemented in Phase 07",
    )
