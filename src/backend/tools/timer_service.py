"""
Timer service — thin adapter over ``db.tools_repo`` that produces
the exact data the FE timer scene wants.

Semantics:

* ``create_timer(user_id, label, duration_sec, preset)`` — persist a
  ``Timer`` row, return scene data covering label, duration, ETA.
* ``list_timers(user_id)`` — surface the most recent active timer
  (the scene only renders one card — operator-facing UX choice).
* ``cancel_timer(user_id, timer_id)`` — mark ``fired=True`` so the
  scheduler's polling loop skips it; return scene data with
  ``status='cancelled'``.

Time math runs in UTC seconds since epoch, exposed to the FE as
``*_at_ms`` (milliseconds). The scene's ``remaining_sec`` is computed
at snapshot time so a `list` call gives the FE the live countdown.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ai.scenes import TimerSceneData
from db.models import Timer


def _now_utc() -> datetime:
    return datetime.now(tz=timezone.utc)


def _ms(dt: datetime) -> int:
    """Convert a naive-or-aware UTC datetime to wall-clock ms."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp() * 1000)


def _scene_for(timer: Timer, *, status: str, ai_note: Optional[str]) -> TimerSceneData:
    started_at = (timer.created_at or _now_utc())
    if started_at.tzinfo is None:
        started_at = started_at.replace(tzinfo=timezone.utc)
    ends_at = timer.ends_at
    if ends_at.tzinfo is None:
        ends_at = ends_at.replace(tzinfo=timezone.utc)
    remaining_sec = max(0, int((ends_at - _now_utc()).total_seconds()))
    if status in ("done", "cancelled"):
        remaining_sec = 0
    return TimerSceneData(
        timer_id=timer.id,
        label=timer.label,
        duration_sec=int(timer.duration_s),
        remaining_sec=remaining_sec,
        started_at_ms=_ms(started_at),
        ends_at_ms=_ms(ends_at),
        preset=None,
        status=status,  # type: ignore[arg-type]
        ai_note=ai_note,
    )


async def create_timer(
    db: AsyncSession,
    *,
    user_id: str,
    label: str,
    duration_sec: int,
    ai_note: Optional[str] = None,
) -> TimerSceneData:
    if duration_sec <= 0:
        raise ValueError("duration_sec must be > 0")
    if duration_sec > 24 * 3600:
        raise ValueError("duration_sec must be <= 86400 (24h)")
    label = (label or "Timer").strip()[:256]

    started = _now_utc()
    timer = Timer(
        user_id=user_id,
        label=label,
        duration_s=int(duration_sec),
        ends_at=started + timedelta(seconds=duration_sec),
    )
    # Stamp created_at so _scene_for has a real value even before refresh.
    timer.created_at = started
    db.add(timer)
    await db.commit()
    await db.refresh(timer)
    return _scene_for(timer, status="active", ai_note=ai_note)


async def list_timers(
    db: AsyncSession,
    *,
    user_id: str,
    ai_note: Optional[str] = None,
) -> Optional[TimerSceneData]:
    """Return the FRESHEST not-yet-fired timer, or None."""
    stmt = (
        select(Timer)
        .where(Timer.user_id == user_id, Timer.fired.is_(False))
        .order_by(Timer.ends_at.asc())
        .limit(1)
    )
    row = (await db.execute(stmt)).scalar_one_or_none()
    if row is None:
        return None
    return _scene_for(row, status="active", ai_note=ai_note)


async def cancel_timer(
    db: AsyncSession,
    *,
    user_id: str,
    timer_id: str,
    ai_note: Optional[str] = None,
) -> Optional[TimerSceneData]:
    stmt = select(Timer).where(Timer.id == timer_id, Timer.user_id == user_id)
    row = (await db.execute(stmt)).scalar_one_or_none()
    if row is None:
        return None
    await db.execute(update(Timer).where(Timer.id == row.id).values(fired=True))
    await db.commit()
    await db.refresh(row)
    return _scene_for(row, status="cancelled", ai_note=ai_note)


__all__ = ["create_timer", "list_timers", "cancel_timer"]
