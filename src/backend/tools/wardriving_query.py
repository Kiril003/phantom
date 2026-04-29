"""
Wardriving query — projects ``WardrivingRecord`` rows into the FE's
heatmap scene.

The heatmap is a small (≤8×6) grid normalised 0..1. Cells are bucketed
by lat/lon strides centred on the user's recent fix; intensity is
``min(1, max(rssi+90)/45)`` so a -90 dBm cell renders as 0 and -45 dBm
caps at 1.

Top-AP list shows the 5 strongest APs (by best RSSI), MAC truncated to
the OUI-prefix triplet ("a4:f7:db") because the full BSSID is privacy-
sensitive and the FE never displays it.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ai.scenes import (
    WardrivingHotspot,
    WardrivingSceneData,
    WardrivingTopAp,
)
from db.models import WardrivingRecord


_GRID_ROWS = 6
_GRID_COLS = 8


def _security_bucket(label: str) -> Optional[str]:
    """Map the encryption label stored on the row to one of the FE's
    three security buckets — anything else is dropped from the pill row."""
    label = (label or "").upper()
    if label == "OPEN":
        return "open"
    if "WPA3" in label:
        return "wpa3"
    if "WPA2" in label or label == "WPA":
        return "wpa2"
    return None


def _normalise_intensity(rssi: int) -> float:
    """Map [-90, -45] dBm → [0, 1]. Outside the band clamps."""
    if rssi <= -90:
        return 0.0
    if rssi >= -45:
        return 1.0
    return (rssi + 90.0) / 45.0


def _mac_prefix(mac: str) -> str:
    parts = mac.split(":")
    return ":".join(parts[:3]).lower() if len(parts) >= 3 else mac.lower()


async def query_wardriving(
    db: AsyncSession,
    *,
    hours_ago: int = 24,
    ai_note: Optional[str] = None,
) -> WardrivingSceneData:
    if hours_ago <= 0:
        raise ValueError("hours_ago must be > 0")
    hours_ago = min(hours_ago, 24 * 30)
    cutoff = datetime.now(tz=timezone.utc) - timedelta(hours=hours_ago)

    stmt = (
        select(WardrivingRecord)
        .where(WardrivingRecord.last_seen >= cutoff.replace(tzinfo=None))
        .order_by(WardrivingRecord.last_seen.desc())
        .limit(2000)
    )
    rows = list((await db.execute(stmt)).scalars().all())

    grid: list[list[float]] = [[0.0] * _GRID_COLS for _ in range(_GRID_ROWS)]
    if rows:
        lat_min = min(r.lat for r in rows)
        lat_max = max(r.lat for r in rows)
        lon_min = min(r.lon for r in rows)
        lon_max = max(r.lon for r in rows)
        # Pad for single-row case so dividers don't collapse to zero.
        if lat_max - lat_min < 1e-6:
            lat_max += 1e-6
        if lon_max - lon_min < 1e-6:
            lon_max += 1e-6
        for r in rows:
            row_idx = min(
                _GRID_ROWS - 1,
                int((r.lat - lat_min) / (lat_max - lat_min) * (_GRID_ROWS - 1)),
            )
            col_idx = min(
                _GRID_COLS - 1,
                int((r.lon - lon_min) / (lon_max - lon_min) * (_GRID_COLS - 1)),
            )
            grid[row_idx][col_idx] = max(
                grid[row_idx][col_idx],
                _normalise_intensity(int(r.rssi)),
            )

    # Top APs by strongest RSSI (max-aggregated per MAC).
    best_per_mac: dict[str, WardrivingRecord] = {}
    for r in rows:
        existing = best_per_mac.get(r.mac)
        if existing is None or r.rssi > existing.rssi:
            best_per_mac[r.mac] = r
    sorted_aps = sorted(best_per_mac.values(), key=lambda r: r.rssi, reverse=True)
    top_aps: list[WardrivingTopAp] = [
        WardrivingTopAp(
            bssid_prefix=_mac_prefix(r.mac),
            best_rssi=int(r.rssi),
            count=int(r.seen_count),
        )
        for r in sorted_aps[:5]
    ]

    # Hotspots — pick the two highest cells, place inside heatmap viewport.
    hotspots: list[WardrivingHotspot] = []
    if rows:
        cells = sorted(
            ((grid[r][c], r, c) for r in range(_GRID_ROWS) for c in range(_GRID_COLS)),
            reverse=True,
        )
        for label, (intensity, r_idx, c_idx) in zip(("Дім", "Офіс"), cells[:2]):
            if intensity <= 0.0:
                break
            hotspots.append(
                WardrivingHotspot(
                    label=label,
                    x_pct=round((c_idx + 0.5) / _GRID_COLS * 100.0, 2),
                    y_pct=round((r_idx + 0.5) / _GRID_ROWS * 100.0, 2),
                )
            )

    counts = {"open": 0, "wpa2": 0, "wpa3": 0}
    for r in rows:
        bucket = _security_bucket(r.encryption)
        if bucket is not None:
            counts[bucket] += 1

    return WardrivingSceneData(
        window_display=f"{hours_ago}H" if hours_ago < 24 else f"{hours_ago // 24}D",
        area_display=f"{len(rows)} APs",
        heatmap=grid,
        hotspots=hotspots,
        top_aps=top_aps,
        security_counts=counts,  # type: ignore[arg-type]
        ai_note=ai_note,
    )


__all__ = ["query_wardriving"]
