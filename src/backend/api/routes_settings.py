"""Settings routes — full CRUD for all settings."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from db.database import get_db
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(prefix="/settings", tags=["settings"])


class SetValueRequest(BaseModel):
    value: object


class ResetRequest(BaseModel):
    category: str | None = None


class ImportRequest(BaseModel):
    settings: dict[str, object]


@router.get("")
async def get_all_settings(db: AsyncSession = Depends(get_db)) -> dict:
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Implemented in Phase 03",
    )


@router.get("/{key:path}")
async def get_setting(key: str, db: AsyncSession = Depends(get_db)) -> dict:
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Implemented in Phase 03",
    )


@router.put("/{key:path}")
async def set_setting(
    key: str,
    req: SetValueRequest,
    db: AsyncSession = Depends(get_db),
) -> dict:
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Implemented in Phase 03",
    )


@router.post("/reset")
async def reset_settings(
    req: ResetRequest,
    db: AsyncSession = Depends(get_db),
) -> dict:
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Implemented in Phase 03",
    )


@router.post("/export")
async def export_settings(db: AsyncSession = Depends(get_db)) -> dict:
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Implemented in Phase 03",
    )


@router.post("/import")
async def import_settings(
    req: ImportRequest,
    db: AsyncSession = Depends(get_db),
) -> dict:
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Implemented in Phase 03",
    )
