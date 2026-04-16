"""
Wardriving Heatmap — aggregate wardriving records into weighted grid points.

The algorithm:
  1. Query records within bounds.
  2. Bucket them by (lat_rounded, lon_rounded) at heatmap precision
     (coarser than the ingest cell precision).
  3. For each bucket, compute:
       - weighted RSSI intensity
         (RSSI is in dBm, typically in [-100, -30]. We linearly remap to [0, 1]
         using MIN_RSSI..MAX_RSSI then boost by seen_count.)
       - network_count
       - strongest_rssi
       - cell center (bucket lat/lon)
  4. Return HeatmapPoint[] sorted by descending weight.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, asdict
from typing import Optional

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from config import config
from db.models import WardrivingRecord

MIN_RSSI = -100
MAX_RSSI = -30


@dataclass
class HeatmapPoint:
    lat: float
    lon: float
    weight: float          # 0..1 normalized intensity
    network_count: int
    strongest_rssi: int

    def to_dict(self) -> dict:
        return asdict(self)


def rssi_to_linear(rssi: int) -> float:
    """Map RSSI in dBm to a [0..1] linear scale."""
    clamped = max(MIN_RSSI, min(MAX_RSSI, rssi))
    return (clamped - MIN_RSSI) / (MAX_RSSI - MIN_RSSI)


def round_to_cell(value: float, precision: int) -> float:
    return round(value, precision)


async def generate_heatmap(
    db: AsyncSession,
    *,
    lat_min: Optional[float] = None,
    lon_min: Optional[float] = None,
    lat_max: Optional[float] = None,
    lon_max: Optional[float] = None,
    precision: Optional[int] = None,
    min_weight: float = 0.0,
) -> list[HeatmapPoint]:
    """Return a list of HeatmapPoint within the optional bounds."""
    if precision is None:
        precision = config.wardriving_heatmap_precision

    stmt = select(WardrivingRecord)
    if all(v is not None for v in (lat_min, lon_min, lat_max, lon_max)):
        stmt = stmt.where(
            and_(
                WardrivingRecord.lat >= lat_min,
                WardrivingRecord.lat <= lat_max,
                WardrivingRecord.lon >= lon_min,
                WardrivingRecord.lon <= lon_max,
            )
        )

    result = await db.execute(stmt)
    records = list(result.scalars().all())

    # Bucket records by rounded cell
    buckets: dict[tuple[float, float], dict] = {}
    for r in records:
        key = (round_to_cell(r.lat, precision), round_to_cell(r.lon, precision))
        bucket = buckets.setdefault(key, {
            "lat": key[0],
            "lon": key[1],
            "network_count": 0,
            "strongest_rssi": MIN_RSSI,
            "weighted_sum": 0.0,
        })
        linear = rssi_to_linear(r.rssi)
        # Boost by log(1 + seen_count) so persistently-observed networks outweigh transients
        boost = 1.0 + math.log10(max(1, r.seen_count))
        bucket["weighted_sum"] += linear * boost
        bucket["network_count"] += 1
        if r.rssi > bucket["strongest_rssi"]:
            bucket["strongest_rssi"] = r.rssi

    if not buckets:
        return []

    # Normalize weights: the peak bucket gets 1.0.
    max_weighted = max(b["weighted_sum"] for b in buckets.values())
    if max_weighted <= 0:
        return []

    points: list[HeatmapPoint] = []
    for b in buckets.values():
        weight = b["weighted_sum"] / max_weighted
        if weight < min_weight:
            continue
        points.append(HeatmapPoint(
            lat=b["lat"],
            lon=b["lon"],
            weight=round(weight, 4),
            network_count=b["network_count"],
            strongest_rssi=b["strongest_rssi"],
        ))

    points.sort(key=lambda p: p.weight, reverse=True)
    return points
