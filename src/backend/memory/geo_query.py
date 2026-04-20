"""
Phase 9.4b — "memories near here" query.

Combines a cheap bounding-box pre-filter (index-friendly) with a precise
haversine pass so we return only facts that are actually within the
radius. Works on the geo columns added by migration ``002``.
"""
from __future__ import annotations

import math
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agent.localization.base import haversine_km


async def find_memories_near(
    db: AsyncSession,
    user_id: str,
    lat: float,
    lon: float,
    radius_km: float = 1.0,
    limit: int = 20,
    include_sealed: bool = False,
) -> list[dict[str, Any]]:
    """Return up to ``limit`` memories with ``place_lat/lon`` inside ``radius_km``.

    The result shape mirrors :func:`tactical_memory.get_recent_facts` with
    the geo columns added so callers can feed results straight back into
    prompts / UIs.
    """
    from db.models import MemoryFact  # local import avoids circular import

    # Bounding-box pre-filter.
    lat_delta = radius_km / 111.0
    lon_delta = radius_km / max(1e-6, 111.0 * math.cos(math.radians(lat)))

    stmt = (
        select(MemoryFact)
        .where(
            MemoryFact.user_id == user_id,
            MemoryFact.place_lat.is_not(None),
            MemoryFact.place_lon.is_not(None),
            MemoryFact.place_lat.between(lat - lat_delta, lat + lat_delta),
            MemoryFact.place_lon.between(lon - lon_delta, lon + lon_delta),
        )
        .order_by(MemoryFact.created_at.desc())
    )
    if not include_sealed:
        stmt = stmt.where(MemoryFact.is_sealed == False)  # noqa: E712

    result = await db.execute(stmt)
    candidates = list(result.scalars().all())

    hits: list[tuple[MemoryFact, float]] = []
    for fact in candidates:
        if fact.place_lat is None or fact.place_lon is None:
            continue
        d_km = haversine_km(lat, lon, float(fact.place_lat), float(fact.place_lon))
        if d_km <= radius_km:
            hits.append((fact, d_km))

    hits.sort(key=lambda t: t[1])
    hits = hits[:limit]

    return [
        {
            "id": fact.id,
            "content": fact.content,
            "category": fact.category,
            "importance": fact.importance,
            "place_name": fact.place_name,
            "place_lat": fact.place_lat,
            "place_lon": fact.place_lon,
            "place_source": fact.place_source,
            "place_confidence": fact.place_confidence,
            "distance_m": int(round(d_km * 1000)),
            "created_at": fact.created_at.isoformat(),
        }
        for fact, d_km in hits
    ]


__all__ = ["find_memories_near"]
