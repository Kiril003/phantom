"""Context routes — ContextSnapshot, SystemState."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

router = APIRouter(prefix="/context", tags=["context"])


@router.get("/current")
async def get_current_context() -> dict:
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Implemented in Phase 01",
    )


@router.get("/history")
async def get_context_history(minutes: int = 60) -> dict:
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Implemented in Phase 01",
    )


@router.get("/state")
async def get_state() -> dict:
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Implemented in Phase 01",
    )
