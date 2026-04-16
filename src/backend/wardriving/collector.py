"""
Wardriving Collector — ingest WiFi networks from SensorBatch into SQLite.

Each sighting is keyed by (mac, lat_rounded, lon_rounded). A new mac+cell
entry is inserted on first sight; subsequent sightings update rssi/last_seen
and increment seen_count.

Design notes:
- Cell size is controlled by ``config.wardriving_cell_precision`` decimal digits.
  Default 4 digits ≈ 11 m at the equator (finer-grained than GPS noise floor).
- Insertions use upsert semantics so repeat calls from the sensor loop are idempotent.
- RSSI tracking: we keep the *strongest* RSSI observed for the (mac, cell), since
  that is the value most useful for heatmap amplitude.
- MAC normalization: stored uppercase, colon-separated.
- SSID truncation: 256 chars to match DB schema.
- Encryption: mapped from ESP32 wifi_auth_mode_t integer to a short string label.
"""
from __future__ import annotations

import asyncio
import logging
import re
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable, Optional

from sqlalchemy import and_, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from config import config
from db.database import get_session
from db.models import WardrivingRecord
from sensors.sensor_parser import SensorBatch, WiFiNetwork

logger = logging.getLogger(__name__)


# ── Encryption mapping (ESP32 wifi_auth_mode_t) ───────────────────────────────
#
# 0 = OPEN, 1 = WEP, 2 = WPA_PSK, 3 = WPA2_PSK, 4 = WPA_WPA2_PSK,
# 5 = WPA2_ENTERPRISE, 6 = WPA3_PSK, 7 = WPA2_WPA3_PSK, 8 = WAPI_PSK,
# 9 = OWE
ENCRYPTION_LABELS: dict[int, str] = {
    0: "OPEN",
    1: "WEP",
    2: "WPA",
    3: "WPA2",
    4: "WPA/WPA2",
    5: "WPA2-ENT",
    6: "WPA3",
    7: "WPA2/WPA3",
    8: "WAPI",
    9: "OWE",
}


_MAC_RE = re.compile(r"^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$")


def encryption_label(code: int) -> str:
    return ENCRYPTION_LABELS.get(int(code), f"UNK({int(code)})")


def normalize_mac(mac: str) -> str:
    """Upper-case colon-separated MAC. Returns '' on invalid input."""
    if not mac:
        return ""
    # Accept formats: aa:bb:cc:dd:ee:ff, aa-bb-cc-dd-ee-ff, aabbccddeeff
    cleaned = re.sub(r"[^0-9A-Fa-f]", "", mac)
    if len(cleaned) != 12:
        return ""
    pairs = [cleaned[i:i + 2].upper() for i in range(0, 12, 2)]
    return ":".join(pairs)


def round_coord(value: float, precision: int) -> float:
    return round(value, precision)


@dataclass
class IngestStats:
    seen: int = 0
    inserted: int = 0
    updated: int = 0
    skipped: int = 0


# ── Upsert primitive ──────────────────────────────────────────────────────────

async def upsert_network(
    db: AsyncSession,
    *,
    mac: str,
    ssid: str,
    rssi: int,
    encryption: str,
    channel: int,
    lat: float,
    lon: float,
    precision: Optional[int] = None,
    now: Optional[datetime] = None,
) -> str:
    """
    Upsert a single wardriving sighting. Returns 'inserted' | 'updated'.

    Keyed on (mac, lat_rounded, lon_rounded).
    """
    if precision is None:
        precision = config.wardriving_cell_precision
    if now is None:
        now = datetime.now(tz=timezone.utc)

    lat_r = round_coord(lat, precision)
    lon_r = round_coord(lon, precision)

    stmt = select(WardrivingRecord).where(
        and_(
            WardrivingRecord.mac == mac,
            WardrivingRecord.lat_rounded == lat_r,
            WardrivingRecord.lon_rounded == lon_r,
        )
    )
    result = await db.execute(stmt)
    existing = result.scalar_one_or_none()

    if existing is None:
        record = WardrivingRecord(
            mac=mac,
            ssid=ssid[:256],
            rssi=rssi,
            encryption=encryption,
            channel=channel,
            lat=lat,
            lon=lon,
            lat_rounded=lat_r,
            lon_rounded=lon_r,
            first_seen=now,
            last_seen=now,
            seen_count=1,
        )
        db.add(record)
        await db.flush()
        return "inserted"

    # Existing — update with strongest RSSI and latest metadata
    new_rssi = max(existing.rssi, rssi)
    await db.execute(
        update(WardrivingRecord)
        .where(WardrivingRecord.id == existing.id)
        .values(
            ssid=ssid[:256] if ssid else existing.ssid,
            rssi=new_rssi,
            encryption=encryption or existing.encryption,
            channel=channel if channel > 0 else existing.channel,
            last_seen=now,
            seen_count=existing.seen_count + 1,
        )
    )
    return "updated"


# ── Batch ingestion ───────────────────────────────────────────────────────────

async def ingest_wifi_networks(
    db: AsyncSession,
    *,
    networks: Iterable[WiFiNetwork],
    lat: float,
    lon: float,
    precision: Optional[int] = None,
    now: Optional[datetime] = None,
) -> IngestStats:
    """
    Ingest all WiFi networks observed at (lat, lon) into SQLite.
    Returns statistics about the batch.
    """
    stats = IngestStats()
    for net in networks:
        stats.seen += 1
        mac = normalize_mac(net.mac)
        if not mac:
            stats.skipped += 1
            logger.debug("Skipping invalid MAC: %r", net.mac)
            continue

        encryption = encryption_label(net.encryption)
        status = await upsert_network(
            db,
            mac=mac,
            ssid=net.ssid,
            rssi=net.rssi,
            encryption=encryption,
            channel=net.channel,
            lat=lat,
            lon=lon,
            precision=precision,
            now=now,
        )
        if status == "inserted":
            stats.inserted += 1
        else:
            stats.updated += 1

    return stats


# ── High-level async entrypoint (called from sensor loop) ─────────────────────

class WardrivingCollector:
    """
    Thin wrapper used by the sensor pipeline. Holds a recent-ingest timestamp
    and accumulates coarse stats for observability.
    """

    def __init__(self) -> None:
        self._lifetime = IngestStats()
        self._last_ingest_ts: Optional[float] = None
        self._lock = asyncio.Lock()

    @property
    def stats(self) -> IngestStats:
        return self._lifetime

    async def process_batch(self, batch: SensorBatch) -> IngestStats:
        """
        Entry point invoked per SensorBatch. Writes sightings to DB only if
        batch contains WiFi networks and a valid GPS fix.
        """
        if not config.sensor_wifi_scan_enabled:
            return IngestStats()
        if not batch.wifi_nets:
            return IngestStats()
        if batch.gps is None or not batch.gps.fix:
            logger.debug("Skipping wardriving ingest — no GPS fix")
            return IngestStats()

        lat, lon = batch.gps.lat, batch.gps.lon
        async with self._lock, get_session() as db:
            stats = await ingest_wifi_networks(
                db,
                networks=batch.wifi_nets,
                lat=lat,
                lon=lon,
            )
            # get_session() commits on clean exit; no explicit commit needed.

        self._last_ingest_ts = time.time()
        self._lifetime.seen += stats.seen
        self._lifetime.inserted += stats.inserted
        self._lifetime.updated += stats.updated
        self._lifetime.skipped += stats.skipped

        if stats.seen:
            logger.debug(
                "Wardriving ingested %d nets at (%.5f, %.5f): +%d new, ~%d updated",
                stats.seen, lat, lon, stats.inserted, stats.updated,
            )

        return stats


# Singleton
wardriving_collector = WardrivingCollector()


# ── Query helpers used by routes ──────────────────────────────────────────────

async def query_records_in_bounds(
    db: AsyncSession,
    *,
    lat_min: float,
    lon_min: float,
    lat_max: float,
    lon_max: float,
    since: Optional[datetime] = None,
    limit: int = 5000,
) -> list[WardrivingRecord]:
    stmt = select(WardrivingRecord).where(
        and_(
            WardrivingRecord.lat >= lat_min,
            WardrivingRecord.lat <= lat_max,
            WardrivingRecord.lon >= lon_min,
            WardrivingRecord.lon <= lon_max,
        )
    )
    if since is not None:
        stmt = stmt.where(WardrivingRecord.last_seen >= since)
    stmt = stmt.order_by(WardrivingRecord.last_seen.desc()).limit(limit)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def count_records(db: AsyncSession) -> int:
    result = await db.execute(select(func.count(WardrivingRecord.id)))
    return int(result.scalar_one() or 0)
