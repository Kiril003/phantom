from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_db
from db.tools_repo import (
    create_timer, get_timers, cancel_timer, delete_timer,
    create_alarm, get_alarms, set_alarm_active, delete_alarm,
    create_calendar_event, get_calendar_events,
    update_calendar_event, delete_calendar_event,
)
from security.auth import get_current_user
from db.models import User

router = APIRouter(prefix="/tools", tags=["tools"])


class TimerCreate(BaseModel):
    duration_s: int = Field(..., gt=0)
    label: str = Field(..., min_length=1)


class AlarmCreate(BaseModel):
    time: str = Field(..., pattern=r"^\d{2}:\d{2}$")  # "HH:MM"
    repeat: str = "once"  # daily | weekdays | once
    label: str = ""


class CalendarEventCreate(BaseModel):
    title: str
    description: str = ""
    start_at: datetime
    end_at: datetime
    all_day: bool = False
    location: str | None = None


@router.post("/timer", status_code=status.HTTP_201_CREATED)
async def api_create_timer(
    req: TimerCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    timer = await create_timer(db, user.id, req.label, req.duration_s)
    return {"ok": True, "id": timer.id, "ends_at": timer.ends_at.isoformat()}


@router.get("/timer")
async def api_get_timers(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    timers = await get_timers(db, user.id)
    return {"timers": [
        {"id": t.id, "label": t.label, "ends_at": t.ends_at.isoformat(), "fired": t.fired}
        for t in timers
    ]}


@router.post("/alarm", status_code=status.HTTP_201_CREATED)
async def api_create_alarm(
    req: AlarmCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    alarm = await create_alarm(db, user.id, req.label, req.time, req.repeat)
    return {"ok": True, "id": alarm.id, "next_trigger": alarm.next_trigger.isoformat()}


@router.get("/alarm")
async def api_get_alarms(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    alarms = await get_alarms(db, user.id)
    return {"alarms": [
        {"id": a.id, "label": a.label, "time": a.time_str, "repeat": a.repeat, "active": a.active}
        for a in alarms
    ]}


@router.get("/calendar")
async def api_get_calendar(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    events = await get_calendar_events(db, user.id)
    return {"events": [
        {
            "id": e.id, "title": e.title, "description": e.description,
            "start_at": e.start_at.isoformat(), "end_at": e.end_at.isoformat(),
            "all_day": e.all_day, "location": e.location
        }
        for e in events
    ]}


@router.post("/calendar/events", status_code=status.HTTP_201_CREATED)
async def api_create_event(
    req: CalendarEventCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    event = await create_calendar_event(
        db, user.id, req.title, req.start_at, req.end_at,
        req.description, req.all_day, req.location
    )
    return {"ok": True, "id": event.id}


# ── Timer / alarm / calendar mutation endpoints ───────────────────────────
# Phase-5 R1 Task C — added so the new TimerManager FE has a real
# REST surface to act against (was: create + list only).


class TimerCancel(BaseModel):
    """Empty body — `POST /tools/timer/{id}/cancel` toggles `fired=True`
    so the scheduler stops emitting the timer.fired event for it."""


@router.post("/timer/{timer_id}/cancel", response_model=None)
async def api_cancel_timer(
    timer_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    ok = await cancel_timer(db, user.id, timer_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="timer not found")
    return {"ok": True}


@router.delete("/timer/{timer_id}", response_model=None, status_code=status.HTTP_204_NO_CONTENT)
async def api_delete_timer(
    timer_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    ok = await delete_timer(db, user.id, timer_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="timer not found")


class AlarmActiveToggle(BaseModel):
    active: bool


@router.put("/alarm/{alarm_id}/active", response_model=None)
async def api_set_alarm_active(
    alarm_id: str,
    req: AlarmActiveToggle,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    ok = await set_alarm_active(db, user.id, alarm_id, req.active)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="alarm not found")
    return {"ok": True, "active": req.active}


@router.delete("/alarm/{alarm_id}", response_model=None, status_code=status.HTTP_204_NO_CONTENT)
async def api_delete_alarm(
    alarm_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    ok = await delete_alarm(db, user.id, alarm_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="alarm not found")


class CalendarEventUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    start_at: datetime | None = None
    end_at: datetime | None = None
    all_day: bool | None = None
    location: str | None = None


@router.put("/calendar/events/{event_id}", response_model=None)
async def api_update_event(
    event_id: str,
    req: CalendarEventUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    event = await update_calendar_event(
        db, user.id, event_id,
        title=req.title, description=req.description,
        start_at=req.start_at, end_at=req.end_at,
        all_day=req.all_day, location=req.location,
    )
    if event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="event not found")
    return {
        "ok": True,
        "id": event.id,
        "title": event.title,
        "start_at": event.start_at.isoformat(),
        "end_at": event.end_at.isoformat(),
    }


@router.delete("/calendar/events/{event_id}", response_model=None, status_code=status.HTTP_204_NO_CONTENT)
async def api_delete_event(
    event_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    ok = await delete_calendar_event(db, user.id, event_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="event not found")
