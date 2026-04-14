"""Tools routes — timer, alarm, calendar."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from db.database import get_db
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(prefix="/tools", tags=["tools"])


class TimerCreate(BaseModel):
    duration_s: int
    label: str


class AlarmCreate(BaseModel):
    time: str  # "HH:MM"
    repeat: str  # daily | weekdays | once
    label: str


class CalendarEventCreate(BaseModel):
    title: str
    description: str = ""
    start_at: str
    end_at: str
    all_day: bool = False
    location: str | None = None


@router.post("/timer")
async def create_timer(
    req: TimerCreate,
    db: AsyncSession = Depends(get_db),
) -> dict:
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Implemented in Phase 08",
    )


@router.post("/alarm")
async def create_alarm(
    req: AlarmCreate,
    db: AsyncSession = Depends(get_db),
) -> dict:
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Implemented in Phase 08",
    )


@router.get("/calendar")
async def get_calendar(
    range: str = "week",
    db: AsyncSession = Depends(get_db),
) -> dict:
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Implemented in Phase 08",
    )


@router.post("/calendar/events")
async def create_event(
    event: CalendarEventCreate,
    db: AsyncSession = Depends(get_db),
) -> dict:
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Implemented in Phase 08",
    )
