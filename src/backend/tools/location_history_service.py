"""
Location-history service — turns the last-24h ``LocationHistory`` rows
into the FE's mini-map scene.

Distance math uses the Haversine formula. Walking time is approximated
as ``segments_under_walking_speed / 1.4 m·s⁻¹`` — anything over
8 km/h is treated as transit and excluded from the walking estimate.
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ai.scenes import LocationSceneData, LocationStop
from db.models import LocationHistory


_EARTH_R_M = 6_371_000.0
_WALKING_MAX_MPS = 2.2  # ~8 km/h cap


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * _EARTH_R_M * math.asin(min(1.0, math.sqrt(a)))


def _kind_for(place_name: Optional[str], category_hint: Optional[str]) -> str:
    if not place_name:
        return "other"
    name = place_name.lower()
    if category_hint == "home" or "дім" in name or "home" in name:
        return "home"
    if category_hint == "work" or "офіс" in name or "office" in name or "work" in name:
        return "work"
    if any(token in name for token in ("кафе", "cafe", "restaurant", "ресторан", "food")):
        return "food"
    if any(token in name for token in ("транзит", "transit", "metro", "bus", "train")):
        return "transit"
    return "other"


def _walking_display(seconds: int) -> str:
    if seconds <= 0:
        return "0 хв"
    if seconds < 3600:
        return f"{seconds // 60} хв"
    hours = seconds // 3600
    minutes = (seconds % 3600) // 60
    if minutes == 0:
        return f"{hours}h"
    return f"{hours}h {minutes}m"


def _distance_display(metres: float) -> str:
    if metres < 1_000:
        return f"{int(metres)} м"
    return f"{metres / 1_000:.1f} км"


async def last_24h(
    db: AsyncSession,
    *,
    user_id: str,
    hours_ago: int = 24,
    ai_note: Optional[str] = None,
) -> LocationSceneData:
    if hours_ago <= 0:
        raise ValueError("hours_ago must be > 0")
    hours_ago = min(hours_ago, 24 * 30)
    cutoff = datetime.now(tz=timezone.utc) - timedelta(hours=hours_ago)

    stmt = (
        select(LocationHistory)
        .where(
            LocationHistory.user_id == user_id,
            LocationHistory.timestamp >= cutoff.replace(tzinfo=None),
        )
        .order_by(LocationHistory.timestamp.asc())
    )
    rows = list((await db.execute(stmt)).scalars().all())

    total_distance = 0.0
    walking_seconds = 0
    for prev, curr in zip(rows, rows[1:]):
        d = _haversine_m(prev.lat, prev.lon, curr.lat, curr.lon)
        total_distance += d
        prev_ts = prev.timestamp
        if prev_ts.tzinfo is None:
            prev_ts = prev_ts.replace(tzinfo=timezone.utc)
        curr_ts = curr.timestamp
        if curr_ts.tzinfo is None:
            curr_ts = curr_ts.replace(tzinfo=timezone.utc)
        dt_seconds = max(1.0, (curr_ts - prev_ts).total_seconds())
        speed = d / dt_seconds
        if speed <= _WALKING_MAX_MPS:
            walking_seconds += int(dt_seconds)

    # Project rows onto a 0..100 viewport for the mini-map.
    if rows:
        lat_min = min(r.lat for r in rows)
        lat_max = max(r.lat for r in rows)
        lon_min = min(r.lon for r in rows)
        lon_max = max(r.lon for r in rows)
        if lat_max - lat_min < 1e-6:
            lat_max = lat_min + 1e-6
        if lon_max - lon_min < 1e-6:
            lon_max = lon_min + 1e-6
    else:
        lat_min = lat_max = lon_min = lon_max = 0.0

    stops: list[LocationStop] = []
    unknowns = 0
    seen_labels: set[str] = set()
    # Take the 6 most recent distinct stops so the FE card stays tidy.
    for row in reversed(rows):
        label = row.place_name or "Невідомо"
        if not row.place_name:
            unknowns += 1
        if label in seen_labels:
            continue
        seen_labels.add(label)
        ts = row.timestamp
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        local = ts.astimezone()
        x_pct = (
            (row.lon - lon_min) / (lon_max - lon_min) * 100.0
            if lon_max > lon_min else 50.0
        )
        y_pct = (
            (1.0 - (row.lat - lat_min) / (lat_max - lat_min)) * 100.0
            if lat_max > lat_min else 50.0
        )
        stops.append(
            LocationStop(
                stop_id=row.id,
                x_pct=round(max(0.0, min(100.0, x_pct)), 2),
                y_pct=round(max(0.0, min(100.0, y_pct)), 2),
                time_display=local.strftime("%H:%M"),
                ts_ms=int(ts.timestamp() * 1000),
                label=label,
                kind=_kind_for(row.place_name, None),  # type: ignore[arg-type]
            )
        )
        if len(stops) >= 6:
            break

    return LocationSceneData(
        window_display=f"LAST {hours_ago}H" if hours_ago < 24 else "LAST 24H",
        total_distance_display=_distance_display(total_distance),
        total_distance_m=round(total_distance, 1),
        stops=stops,
        walking_display=_walking_display(walking_seconds),
        walking_seconds=int(walking_seconds),
        unknowns=int(unknowns),
        ai_note=ai_note,
    )


__all__ = ["last_24h"]
