"""
Calendar service — reads the existing ``CalendarEvent`` table and
projects it onto the FE's week-strip scene shape.

Each event is bucketed into a 0..6 day index (Mon..Sun), then placed
inside the day column with ``y_pct`` (start of day at 06:00 → 0.0,
24:00 → 100.0; events before 06:00 clamp to 0). Categories rotate
through {work, personal, amber, coral} based on a deterministic hash of
the event title so colours stay stable across reloads.
"""
from __future__ import annotations

from datetime import date, datetime, time as dtime, timedelta, timezone
from hashlib import blake2s
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ai.scenes import CalendarSceneData, CalendarSceneEvent
from db.models import CalendarEvent


_CATEGORY_ROTATION: tuple[str, ...] = ("work", "personal", "amber", "coral")
_WEEKDAY_LABELS_UA: tuple[str, str, str, str, str, str, str] = (
    "ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "НД",
)


def _now_utc() -> datetime:
    return datetime.now(tz=timezone.utc)


def _ms(dt: datetime) -> int:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp() * 1000)


def _category_for(title: str) -> str:
    digest = blake2s(title.encode("utf-8"), digest_size=2).digest()
    return _CATEGORY_ROTATION[digest[0] % len(_CATEGORY_ROTATION)]


def _week_bounds(today_local: date) -> tuple[date, date]:
    monday = today_local - timedelta(days=today_local.weekday())
    sunday = monday + timedelta(days=6)
    return monday, sunday


def _y_h_pct(start_local: datetime, end_local: datetime) -> tuple[float, float]:
    """Map [start..end] inside a day to (y_pct, h_pct).

    Vertical scale: 06:00 = 0%, 24:00 = 100%. Anything before 06:00 is
    clamped to 0. Events that span past midnight are clipped at 100%.
    """
    day_start = start_local.replace(hour=6, minute=0, second=0, microsecond=0)
    day_end = day_start + timedelta(hours=18)
    span_seconds = (day_end - day_start).total_seconds()  # 18h

    def to_pct(dt: datetime) -> float:
        offset = (dt - day_start).total_seconds()
        return max(0.0, min(100.0, (offset / span_seconds) * 100.0))

    y = to_pct(start_local)
    end_pct = to_pct(end_local)
    h = max(2.0, end_pct - y)  # min visual height of 2%
    return round(y, 2), round(h, 2)


async def calendar_week(
    db: AsyncSession,
    *,
    user_id: str,
    week_anchor_iso: Optional[str] = None,
    ai_suggestion: Optional[str] = None,
) -> CalendarSceneData:
    """Return the calendar scene for the operator's week.

    ``week_anchor_iso`` — any YYYY-MM-DD inside the requested week. When
    omitted, defaults to the user's local "today".
    """
    local_tz = datetime.now().astimezone().tzinfo
    if week_anchor_iso:
        try:
            anchor = date.fromisoformat(week_anchor_iso)
        except ValueError as exc:
            raise ValueError(f"week_anchor_iso must be YYYY-MM-DD, got {week_anchor_iso!r}") from exc
    else:
        anchor = datetime.now(tz=local_tz).date()

    monday, sunday = _week_bounds(anchor)
    week_start_local = datetime.combine(monday, dtime.min).replace(tzinfo=local_tz)
    week_end_local = datetime.combine(sunday, dtime.max).replace(tzinfo=local_tz)
    start_utc = week_start_local.astimezone(timezone.utc)
    end_utc = week_end_local.astimezone(timezone.utc)

    stmt = (
        select(CalendarEvent)
        .where(
            CalendarEvent.user_id == user_id,
            CalendarEvent.start_at >= start_utc.replace(tzinfo=None),
            CalendarEvent.start_at <= end_utc.replace(tzinfo=None),
        )
        .order_by(CalendarEvent.start_at.asc())
    )
    rows = (await db.execute(stmt)).scalars().all()

    events: list[CalendarSceneEvent] = []
    for row in rows:
        start_dt = row.start_at
        if start_dt.tzinfo is None:
            start_dt = start_dt.replace(tzinfo=timezone.utc)
        end_dt = row.end_at
        if end_dt.tzinfo is None:
            end_dt = end_dt.replace(tzinfo=timezone.utc)
        start_local = start_dt.astimezone(local_tz)
        end_local = end_dt.astimezone(local_tz)
        day_index = (start_local.date() - monday).days
        if not (0 <= day_index <= 6):
            # Spans outside the requested week — skip.
            continue
        y_pct, h_pct = _y_h_pct(start_local, end_local)
        events.append(
            CalendarSceneEvent(
                event_id=row.id,
                day_index=day_index,  # type: ignore[arg-type]
                y_pct=y_pct,
                h_pct=h_pct,
                category=_category_for(row.title),  # type: ignore[arg-type]
                label=row.title,
                starts_at_ms=_ms(start_dt),
                ends_at_ms=_ms(end_dt),
            )
        )

    today_local = datetime.now(tz=local_tz).date()
    date_labels = tuple(  # noqa: C414
        str((monday + timedelta(days=i)).day) for i in range(7)
    )

    return CalendarSceneData(
        week_start_iso=monday.isoformat(),
        today_iso=today_local.isoformat(),
        weekday_labels=_WEEKDAY_LABELS_UA,
        date_labels=date_labels,  # type: ignore[arg-type]
        events=events,
        total_count=len(events),
        ai_suggestion=ai_suggestion,
    )


async def add_event(
    db: AsyncSession,
    *,
    user_id: str,
    title: str,
    start_at_iso: str,
    end_at_iso: Optional[str] = None,
    description: str = "",
    location: Optional[str] = None,
    ai_suggestion: Optional[str] = None,
) -> CalendarSceneData:
    """Insert a single event then return the freshly recomputed week scene
    centred on the event's date — so the FE card shows the new chip in
    context."""
    start_dt = datetime.fromisoformat(start_at_iso)
    if start_dt.tzinfo is None:
        start_dt = start_dt.replace(tzinfo=timezone.utc)
    if end_at_iso:
        end_dt = datetime.fromisoformat(end_at_iso)
        if end_dt.tzinfo is None:
            end_dt = end_dt.replace(tzinfo=timezone.utc)
    else:
        end_dt = start_dt + timedelta(hours=1)
    if end_dt < start_dt:
        raise ValueError("end_at_iso must be >= start_at_iso")

    event = CalendarEvent(
        user_id=user_id,
        title=title.strip()[:256],
        description=description,
        start_at=start_dt.replace(tzinfo=None),
        end_at=end_dt.replace(tzinfo=None),
        all_day=False,
        location=location,
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)
    anchor_iso = start_dt.astimezone().date().isoformat()
    return await calendar_week(
        db, user_id=user_id, week_anchor_iso=anchor_iso, ai_suggestion=ai_suggestion,
    )


__all__ = ["calendar_week", "add_event"]
