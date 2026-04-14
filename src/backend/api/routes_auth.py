"""Authentication routes — RFID, PIN, JWT."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from db.database import get_db
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(prefix="/auth", tags=["auth"])


class RFIDLoginRequest(BaseModel):
    uid_hash: str


class PINLoginRequest(BaseModel):
    username: str
    pin: str


class AuthResponse(BaseModel):
    user: dict
    token: str
    expires_at: str


class RefreshResponse(BaseModel):
    token: str
    expires_at: str


@router.post("/login/rfid", response_model=AuthResponse)
async def login_rfid(
    req: RFIDLoginRequest,
    db: AsyncSession = Depends(get_db),
) -> AuthResponse:
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Implemented in Phase 02",
    )


@router.post("/login/pin", response_model=AuthResponse)
async def login_pin(
    req: PINLoginRequest,
    db: AsyncSession = Depends(get_db),
) -> AuthResponse:
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Implemented in Phase 02",
    )


@router.post("/refresh", response_model=RefreshResponse)
async def refresh_token() -> RefreshResponse:
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Implemented in Phase 02",
    )


@router.get("/me")
async def get_me() -> dict:
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Implemented in Phase 02",
    )


@router.post("/logout")
async def logout() -> dict:
    return {"ok": True}
