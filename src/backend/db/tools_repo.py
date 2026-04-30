"""
db.tools_repo — persistence layer for the conversational tools
(`timer`, `alarm`, `calendar_event`). Used by `api.routes_tools`.

Phase-5 R1 audit-2026-04-30: replaced the alarm `next_trigger` mock
(`utcnow + 1h` regardless of input) with a real HH:MM occurrence
solver that respects the operator's `repeat` policy
(once / daily / weekdays). Added delete helpers and a typed `repeat`
literal so the router-level Pydantic schema can pin the contract.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Literal

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import Alarm, CalendarEvent, Timer

AlarmRepeat = Literal["once", "daily", "weekdays"]


def _now_utc() -> datetime:
    return datetime.now(tz=timezone.utc)


# ── Timers ────────────────────────────────────────────────────────────────


async def create_timer(
    db: AsyncSession, user_id: str, label: str, duration_s: int
) -> Timer:
    ends_at = _now_utc() + timedelta(seconds=int(duration_s))
    timer = Timer(
        user_id=user_id,
        label=label,
        duration_s=int(duration_s),
        ends_at=ends_at,
    )
    db.add(timer)
    await db.commit()
    await db.refresh(timer)
    return timer


async def get_timers(db: AsyncSession, user_id: str) -> list[Timer]:
    """Active timers (not yet fired/cancelled), oldest deadline first."""
    result = await db.execute(
        select(Timer)
        .where(Timer.user_id == user_id, Timer.fired.is_(False))
        .order_by(Timer.ends_at.asc())
    )
    return list(result.scalars().all())


async def get_timer(db: AsyncSession, user_id: str, timer_id: str) -> Timer | None:
    result = await db.execute(
        select(Timer).where(Timer.id == timer_id, Timer.user_id == user_id)
    )
    return result.scalar_one_or_none()


async def cancel_timer(db: AsyncSession, user_id: str, timer_id: str) -> bool:
    """Mark `fired=True` so the scheduler skips it. Returns True iff a row
    was found and updated. Cancel is a soft-set (timer still in history);
    use `delete_timer` for hard removal."""
    timer = await get_timer(db, user_id, timer_id)
    if timer is None:
        return False
    timer.fired = True  # type: ignore[assignment]
    await db.commit()
    return True


async def delete_timer(db: AsyncSession, user_id: str, timer_id: str) -> bool:
    """Hard-delete a timer row. Returns True if a row was removed."""
    timer = await get_timer(db, user_id, timer_id)
    if timer is None:
        return False
    await db.execute(delete(Timer).where(Timer.id == timer_id))
    await db.commit()
    return True


# ── Alarms ────────────────────────────────────────────────────────────────


def _resolve_next_alarm_trigger(time_str: str, repeat: str, now: datetime) -> datetime:
    """Resolve the next concrete UTC datetime for an HH:MM alarm.

    `repeat` policy:
      * once     — the next future HH:MM (today if it's still ahead, else tomorrow).
      * daily    — same as `once`; the row stays alive after firing so it
                   reschedules each day.
      * weekdays — next future HH:MM that lands on Mon..Fri (skips Sat/Sun).

    Replaces the previous `utcnow + 1h` mock that ignored `time_str`
    entirely (audit-2026-04-30 mock-hunt).
    """
    try:
        hh_str, mm_str = time_str.split(":", 1)
        hh = int(hh_str)
        mm = int(mm_str)
        if not (0 <= hh < 24 and 0 <= mm < 60):
            raise ValueError
    except (ValueError, AttributeError):
        # Malformed — fall back to "now + 1 minute" so the row is still
        # actionable instead of silently never firing.
        return now + timedelta(minutes=1)

    candidate = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
    if candidate <= now:
        candidate = candidate + timedelta(days=1)

    if repeat == "weekdays":
        # 0..4 = Mon..Fri; skip Sat (5) + Sun (6).
        while candidate.weekday() >= 5:
            candidate = candidate + timedelta(days=1)

    return candidate


async def create_alarm(
    db: AsyncSession, user_id: str, label: str, time_str: str, repeat: str
) -> Alarm:
    next_trigger = _resolve_next_alarm_trigger(time_str, repeat, _now_utc())
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
    """All alarms for the user (active + inactive), nearest trigger first."""
    result = await db.execute(
        select(Alarm)
        .where(Alarm.user_id == user_id)
        .order_by(Alarm.next_trigger.asc())
    )
    return list(result.scalars().all())


async def get_alarm(db: AsyncSession, user_id: str, alarm_id: str) -> Alarm | None:
    result = await db.execute(
        select(Alarm).where(Alarm.id == alarm_id, Alarm.user_id == user_id)
    )
    return result.scalar_one_or_none()


async def set_alarm_active(
    db: AsyncSession, user_id: str, alarm_id: str, active: bool
) -> bool:
    alarm = await get_alarm(db, user_id, alarm_id)
    if alarm is None:
        return False
    alarm.active = active  # type: ignore[assignment]
    await db.commit()
    return True


async def delete_alarm(db: AsyncSession, user_id: str, alarm_id: str) -> bool:
    alarm = await get_alarm(db, user_id, alarm_id)
    if alarm is None:
        return False
    await db.execute(delete(Alarm).where(Alarm.id == alarm_id))
    await db.commit()
    return True


# ── Calendar events ──────────────────────────────────────────────────────


async def create_calendar_event(
    db: AsyncSession,
    user_id: str,
    title: str,
    start_at: datetime,
    end_at: datetime,
    description: str = "",
    all_day: bool = False,
    location: str | None = None,
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
        select(CalendarEvent)
        .where(CalendarEvent.user_id == user_id)
        .order_by(CalendarEvent.start_at.asc())
    )
    return list(result.scalars().all())


async def get_calendar_event(
    db: AsyncSession, user_id: str, event_id: str
) -> CalendarEvent | None:
    result = await db.execute(
        select(CalendarEvent).where(
            CalendarEvent.id == event_id, CalendarEvent.user_id == user_id
        )
    )
    return result.scalar_one_or_none()


async def update_calendar_event(
    db: AsyncSession,
    user_id: str,
    event_id: str,
    *,
    title: str | None = None,
    description: str | None = None,
    start_at: datetime | None = None,
    end_at: datetime | None = None,
    all_day: bool | None = None,
    location: str | None = None,
) -> CalendarEvent | None:
    event = await get_calendar_event(db, user_id, event_id)
    if event is None:
        return None
    if title is not None:
        event.title = title  # type: ignore[assignment]
    if description is not None:
        event.description = description  # type: ignore[assignment]
    if start_at is not None:
        event.start_at = start_at  # type: ignore[assignment]
    if end_at is not None:
        event.end_at = end_at  # type: ignore[assignment]
    if all_day is not None:
        event.all_day = all_day  # type: ignore[assignment]
    if location is not None:
        event.location = location  # type: ignore[assignment]
    await db.commit()
    await db.refresh(event)
    return event


async def delete_calendar_event(
    db: AsyncSession, user_id: str, event_id: str
) -> bool:
    event = await get_calendar_event(db, user_id, event_id)
    if event is None:
        return False
    await db.execute(delete(CalendarEvent).where(CalendarEvent.id == event_id))
    await db.commit()
    return True
