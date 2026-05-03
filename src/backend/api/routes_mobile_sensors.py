"""Phase 19 Mobile Companion — mobile sensor relay.

POST /api/v1/sensors/mobile_batch  device JWT — phone uploads a batch of
                                  GPS / IMU / mic_rms / body (BPM, HRV) /
                                  BLE / WiFi observations.

Persists one `MobileSensorBatch` row, updates `PairedDevice.last_seen_at`,
opportunistically forwards each WiFi observation through the existing
`wardriving.collector.upsert_network` path (when GPS is fixed in the same
batch), and emits a `sensor` channel WS broadcast tagged
`type="mobile_batch"` so the desktop UI can render the moving dot on the
tactical map without reading the DB.

Heavy compute (LLM, STT, TTS, ContextEngine) stays on the desktop per
design pillar §2 ("Phantom is the brain, phone is a sense organ"). This
route is intentionally cheap — it is the network of nerves, not the
brain-stem. ContextEngine integration (so the snapshot pipeline sees
`mobile_gps`, `mobile_motion_class`, etc.) is a follow-up commit; this
file persists everything needed to enable that without changing the
schema later.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from api.websocket_hub import hub
from db.database import get_db
from db.models import MobileSensorBatch, PairedDevice
from security.device_auth import get_current_device
from security.device_token import DeviceTokenPayload

logger = logging.getLogger(__name__)

router = APIRouter(tags=["mobile_sensors"])


# ── Pydantic shapes ──────────────────────────────────────────────────────────


class MobileGPS(BaseModel):
    lat: float
    lon: float
    accuracy_m: Optional[float] = None


class MobileBody(BaseModel):
    bpm: Optional[float] = None
    hrv: Optional[float] = None


class MobileBLEObservation(BaseModel):
    mac: Optional[str] = None
    name: Optional[str] = None
    rssi: int


class MobileWiFiObservation(BaseModel):
    mac: str
    ssid: str = ""
    rssi: int = -100
    encryption: str = "unknown"
    channel: int = 0


class MobileSensorBatchIn(BaseModel):
    device_ts_ms: int = 0
    gps: Optional[MobileGPS] = None
    motion_class: Optional[str] = Field(
        default=None,
        description="walking|still|driving|cycling|...; phone-side classifier",
    )
    mic_rms: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    body: Optional[MobileBody] = None
    ble: list[MobileBLEObservation] = Field(default_factory=list)
    wifi: list[MobileWiFiObservation] = Field(default_factory=list)


class MobileSensorBatchOut(BaseModel):
    ok: bool = True
    batch_id: int
    received_at: str
    wardriving_inserted: int = 0
    wardriving_updated: int = 0


# ── Route ────────────────────────────────────────────────────────────────────


@router.post("/sensors/mobile_batch", response_model=MobileSensorBatchOut)
async def post_mobile_batch(
    body: MobileSensorBatchIn,
    db: AsyncSession = Depends(get_db),
    auth: tuple[PairedDevice, DeviceTokenPayload] = Depends(get_current_device),
) -> MobileSensorBatchOut:
    device, _payload = auth

    now = datetime.now(tz=timezone.utc)

    row = MobileSensorBatch(
        device_id=device.id,
        user_id=device.user_id,
        received_at=now,
        device_ts_ms=int(body.device_ts_ms or 0),
        gps_lat=(body.gps.lat if body.gps else None),
        gps_lon=(body.gps.lon if body.gps else None),
        gps_accuracy_m=(body.gps.accuracy_m if body.gps else None),
        motion_class=body.motion_class,
        mic_rms=body.mic_rms,
        body_bpm=(body.body.bpm if body.body else None),
        body_hrv=(body.body.hrv if body.body else None),
        ble_json=json.dumps([b.model_dump() for b in body.ble]),
        wifi_json=json.dumps([w.model_dump() for w in body.wifi]),
    )
    db.add(row)
    device.last_seen_at = now
    await db.commit()
    await db.refresh(row)

    inserted = 0
    updated = 0
    # Opportunistic wardriving — only with a fix. Mobile WiFi sweeps are
    # a major reason this device exists; keep them flowing into the same
    # SQLite path the ESP32 uses so the heatmap is one merged dataset.
    if body.gps and body.wifi:
        try:
            from wardriving.collector import upsert_network

            for w in body.wifi:
                if not w.mac:
                    continue
                outcome = await upsert_network(
                    db,
                    mac=w.mac,
                    ssid=w.ssid,
                    rssi=int(w.rssi),
                    encryption=w.encryption,
                    channel=int(w.channel),
                    lat=float(body.gps.lat),
                    lon=float(body.gps.lon),
                    now=now,
                )
                if outcome == "inserted":
                    inserted += 1
                else:
                    updated += 1
            await db.commit()
        except Exception as exc:
            # Wardriving forwarding is best-effort. Failure to upsert WiFi
            # rows MUST NOT prevent the batch from being acknowledged —
            # the phone keeps shipping batches, the wardriving heatmap
            # just misses one window.
            logger.warning("wardriving forward failed: %s", exc)

    # Notify desktop UI on the existing `sensor` channel so the tactical
    # map dot updates without an extra subscription. Filter by user_id so
    # other tenants on the same hub never see another phone's path.
    payload = {
        "source": "mobile",
        "device_id": device.id,
        "device_name": device.device_name,
        "received_at": row.received_at.isoformat(),
        "device_ts_ms": row.device_ts_ms,
        "gps": (
            {"lat": row.gps_lat, "lon": row.gps_lon, "accuracy_m": row.gps_accuracy_m}
            if row.gps_lat is not None and row.gps_lon is not None
            else None
        ),
        "motion_class": row.motion_class,
        "body": (
            {"bpm": row.body_bpm, "hrv": row.body_hrv}
            if row.body_bpm is not None or row.body_hrv is not None
            else None
        ),
    }
    try:
        await hub.broadcast(
            "sensor", "mobile_batch", payload, user_id=device.user_id
        )
    except Exception as exc:
        logger.debug("WS broadcast (mobile_batch) failed: %s", exc)

    return MobileSensorBatchOut(
        ok=True,
        batch_id=row.id,
        received_at=row.received_at.isoformat(),
        wardriving_inserted=inserted,
        wardriving_updated=updated,
    )
