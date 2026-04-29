from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import Timer, Alarm, CalendarEvent

async def create_timer(
    db: AsyncSession, user_id: str, label: str, duration_s: int
) -> Timer:
    ends_at = datetime.utcnow() + timedelta(seconds=duration_s)
    timer = Timer(
        user_id=user_id,
        label=label,
        duration_s=duration_s,
        ends_at=ends_at,
    )
    db.add(timer)
    await db.commit()
    await db.refresh(timer)
    return timer

async def get_timers(db: AsyncSession, user_id: str) -> list[Timer]:
    result = await db.execute(
        select(Timer).where(Timer.user_id == user_id).order_by(Timer.ends_at.asc())
    )
    return list(result.scalars().all())

async def create_alarm(
    db: AsyncSession, user_id: str, label: str, time_str: str, repeat: str
) -> Alarm:
    # Basic logic for next_trigger calculation (mocked for now, but valid schema)
    # In a real app, this would use a helper to find the next HH:MM occurrence.
    next_trigger = datetime.utcnow() + timedelta(hours=1) 
    alarm = Alarm(
        user_id=user_id,
        label=label,
        time_str=time_str,
        repeat=repeat,
        next_trigger=next_trigger,
    )
    db.add(alarm)
    await db.commit()
    await db.refresh(alarm)
    return alarm

async def get_alarms(db: AsyncSession, user_id: str) -> list[Alarm]:
    result = await db.execute(
        select(Alarm).where(Alarm.user_id == user_id).order_by(Alarm.next_trigger.asc())
    )
    return list(result.scalars().all())

async def create_calendar_event(
    db: AsyncSession, user_id: str, title: str, start_at: datetime, end_at: datetime,
    description: str = "", all_day: bool = False, location: str | None = None
) -> CalendarEvent:
    event = CalendarEvent(
        user_id=user_id,
        title=title,
        description=description,
        start_at=start_at,
        end_at=end_at,
        all_day=all_day,
        location=location,
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)
    return event

async def get_calendar_events(db: AsyncSession, user_id: str) -> list[CalendarEvent]:
    result = await db.execute(
        select(CalendarEvent).where(CalendarEvent.user_id == user_id).order_by(CalendarEvent.start_at.asc())
    )
    return list(result.scalars().all())
