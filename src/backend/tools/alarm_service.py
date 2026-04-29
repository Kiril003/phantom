"""
Alarm service — turns the existing ``Alarm`` row into the AlarmSceneData
shape consumed by the FE alarm card.

The pre-existing repo helper (``db.tools_repo.create_alarm``) already
parses `HH:MM` strings and computes a ``next_trigger`` UTC datetime; this
adapter computes the cosmetic display fields (Ukrainian month names,
weekday acronyms, ms-precision fires_in) and emits the typed scene.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ai.scenes import AlarmSceneData
from db.models import Alarm


_WEEKDAY_MAP: tuple[str, ...] = ("MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN")
_WEEKDAY_SHORT_UA: tuple[str, ...] = ("пн", "вт", "ср", "чт", "пт", "сб", "нд")
_MONTH_UA: tuple[str, ...] = (
    "січня", "лютого", "березня", "квітня", "травня", "червня",
    "липня", "серпня", "вересня", "жовтня", "листопада", "грудня",
)


def _now_utc() -> datetime:
    return datetime.now(tz=timezone.utc)


def _ms(dt: datetime) -> int:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp() * 1000)


def _next_trigger_for(time_str: str, repeat: str, *, now: Optional[datetime] = None) -> datetime:
    """Compute the next UTC datetime that matches ``HH:MM`` (interpreted
    as the user's local wall clock, since the device is colocated with
    the user). ``repeat`` ∈ {once, daily, weekdays} is honoured by the
    runtime poll-loop; this function always returns the closest future
    occurrence regardless of repeat policy.
    """
    if now is None:
        now = _now_utc()
    hh_str, mm_str = time_str.strip().split(":")
    hh, mm = int(hh_str), int(mm_str)
    if not (0 <= hh < 24 and 0 <= mm < 60):
        raise ValueError(f"invalid HH:MM: {time_str!r}")
    local_now = now.astimezone()
    candidate = local_now.replace(hour=hh, minute=mm, second=0, microsecond=0)
    if candidate <= local_now:
        candidate = candidate + timedelta(days=1)
    return candidate.astimezone(timezone.utc)


def _scene_for(alarm: Alarm, *, ai_note: Optional[str]) -> AlarmSceneData:
    fire_at = alarm.next_trigger
    if fire_at.tzinfo is None:
        fire_at = fire_at.replace(tzinfo=timezone.utc)
    local = fire_at.astimezone()
    weekday_idx = local.weekday()
    fires_in_ms = int((fire_at - _now_utc()).total_seconds() * 1000)
    return AlarmSceneData(
        alarm_id=alarm.id,
        fire_at_ms=_ms(fire_at),
        weekday=_WEEKDAY_MAP[weekday_idx],  # type: ignore[arg-type]
        display_time=local.strftime("%H:%M"),
        display_date=f"{local.day} {_MONTH_UA[local.month - 1]}",
        display_weekday_short=_WEEKDAY_SHORT_UA[weekday_idx],
        sound=alarm.label or "Sunrise",
        sound_waveform=None,
        repeat_daily=alarm.repeat in ("daily", "weekdays"),
        fires_in_ms=fires_in_ms,
        ai_note=ai_note,
    )


async def create_alarm(
    db: AsyncSession,
    *,
    user_id: str,
    label: str,
    time_str: str,
    repeat: str = "once",
    ai_note: Optional[str] = None,
) -> AlarmSceneData:
    if repeat not in ("once", "daily", "weekdays"):
        raise ValueError("repeat must be one of: once, daily, weekdays")
    next_trigger = _next_trigger_for(time_str, repeat)
    alarm = Alarm(
        user_id=user_id,
        label=(label or "Alarm").strip()[:256],
        time_str=time_str,
        repeat=repeat,
        next_trigger=next_trigger.replace(tzinfo=None),  # legacy schema = naive UTC
        active=True,
    )
    db.add(alarm)
    await db.commit()
    await db.refresh(alarm)
    # When fetching back, re-attach UTC tz for math.
    alarm.next_trigger = alarm.next_trigger.replace(tzinfo=timezone.utc)
    return _scene_for(alarm, ai_note=ai_note)


async def list_alarms(
    db: AsyncSession,
    *,
    user_id: str,
    ai_note: Optional[str] = None,
) -> Optional[AlarmSceneData]:
    stmt = (
        select(Alarm)
        .where(Alarm.user_id == user_id, Alarm.active.is_(True))
        .order_by(Alarm.next_trigger.asc())
        .limit(1)
    )
    row = (await db.execute(stmt)).scalar_one_or_none()
    if row is None:
        return None
    return _scene_for(row, ai_note=ai_note)


async def cancel_alarm(
    db: AsyncSession,
    *,
    user_id: str,
    alarm_id: str,
    ai_note: Optional[str] = None,
) -> Optional[AlarmSceneData]:
    stmt = select(Alarm).where(Alarm.id == alarm_id, Alarm.user_id == user_id)
    row = (await db.execute(stmt)).scalar_one_or_none()
    if row is None:
        return None
    await db.execute(update(Alarm).where(Alarm.id == row.id).values(active=False))
    await db.commit()
    await db.refresh(row)
    return _scene_for(row, ai_note=ai_note)


__all__ = ["create_alarm", "list_alarms", "cancel_alarm"]
