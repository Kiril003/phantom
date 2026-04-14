"""
Sensor Parser — JSON lines from ESP32 → typed Python dataclasses.
Maps short protocol keys (motion_e, static_e, …) to full names.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)

PROTOCOL_VERSION = 3


# ── Typed dataclasses matching SensorBatch interface ──────────────────────────

@dataclass
class RadarData:
    present: bool
    motion_energy: int      # 0-100
    static_energy: int      # 0-100
    distance_cm: int
    breath_bpm: Optional[float]  # null if indeterminate


@dataclass
class GPSData:
    lat: float
    lon: float
    fix: bool
    satellites: int
    speed_kmh: float
    altitude_m: float
    hdop: float


@dataclass
class EnvData:
    temp_c: float
    pressure_hpa: float
    aqi: int


@dataclass
class RFIDData:
    uid: Optional[str]   # hex string or null
    new_read: bool       # true only on the batch when card is first presented


@dataclass
class EncoderData:
    position: int
    delta: int
    button: bool
    long_press: bool


@dataclass
class ButtonsData:
    rgb_states: tuple[bool, bool, bool]
    any_pressed: bool


@dataclass
class WiFiNetwork:
    mac: str
    ssid: str
    rssi: int
    encryption: int
    channel: int


@dataclass
class SensorBatch:
    version: int
    timestamp_ms: int
    type: str  # "sensor_batch"
    radar: Optional[RadarData] = None
    gps: Optional[GPSData] = None
    env: Optional[EnvData] = None
    rfid: Optional[RFIDData] = None
    encoder: Optional[EncoderData] = None
    buttons: Optional[ButtonsData] = None
    wifi_nets: Optional[list[WiFiNetwork]] = None


@dataclass
class HeartbeatMessage:
    version: int
    timestamp_ms: int
    uptime_ms: int
    free_heap: int
    wifi_rssi: int


@dataclass
class ErrorMessage:
    version: int
    timestamp_ms: int
    sensor: str
    msg: str
    code: int


ParsedMessage = SensorBatch | HeartbeatMessage | ErrorMessage


# ── Parser ────────────────────────────────────────────────────────────────────

class SensorParser:
    """Stateless parser — converts raw JSON bytes/str to typed messages."""

    def parse(self, raw: str | bytes) -> Optional[ParsedMessage]:
        """Parse a single JSON line from ESP32. Returns None on error."""
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            logger.warning("JSON decode error: %s | raw: %r", exc, raw[:120])
            return None

        version = data.get("v", 0)
        timestamp_ms = data.get("ts", 0)
        msg_type = data.get("type", "")

        if version != PROTOCOL_VERSION:
            logger.warning("Unknown protocol version %d, expected %d", version, PROTOCOL_VERSION)

        if msg_type == "sensor_batch":
            return self._parse_batch(data, version, timestamp_ms)
        elif msg_type == "heartbeat":
            return self._parse_heartbeat(data, version, timestamp_ms)
        elif msg_type == "error":
            return self._parse_error(data, version, timestamp_ms)
        else:
            logger.debug("Unknown message type: %s", msg_type)
            return None

    # ── Batch ──────────────────────────────────────────────────────────────────

    def _parse_batch(self, data: dict, version: int, ts: int) -> SensorBatch:
        batch = SensorBatch(version=version, timestamp_ms=ts, type="sensor_batch")

        # Radar
        if (r := data.get("radar")) is not None:
            batch.radar = RadarData(
                present=bool(r.get("present", False)),
                motion_energy=int(r.get("motion_e", 0)),
                static_energy=int(r.get("static_e", 0)),
                distance_cm=int(r.get("dist_cm", 0)),
                breath_bpm=float(r["breath_bpm"]) if r.get("breath_bpm") is not None else None,
            )

        # GPS
        if (g := data.get("gps")) is not None:
            batch.gps = GPSData(
                lat=float(g.get("lat", 0.0)),
                lon=float(g.get("lon", 0.0)),
                fix=bool(g.get("fix", False)),
                satellites=int(g.get("sats", 0)),
                speed_kmh=float(g.get("speed", 0.0)),
                altitude_m=float(g.get("alt", 0.0)),
                hdop=float(g.get("hdop", 99.0)),
            )

        # Environment
        if (e := data.get("env")) is not None:
            batch.env = EnvData(
                temp_c=float(e.get("temp", 0.0)),
                pressure_hpa=float(e.get("press", 1013.25)),
                aqi=int(e.get("aqi", 0)),
            )

        # RFID
        if (rfid := data.get("rfid")) is not None:
            batch.rfid = RFIDData(
                uid=rfid.get("uid"),
                new_read=bool(rfid.get("new", False)),
            )

        # Encoder
        if (enc := data.get("enc")) is not None:
            batch.encoder = EncoderData(
                position=int(enc.get("pos", 0)),
                delta=int(enc.get("delta", 0)),
                button=bool(enc.get("btn", False)),
                long_press=bool(enc.get("long", False)),
            )

        # Buttons
        if (btns := data.get("btns")) is not None:
            if isinstance(btns, list) and len(btns) >= 3:
                states = (bool(btns[0]), bool(btns[1]), bool(btns[2]))
                batch.buttons = ButtonsData(
                    rgb_states=states,
                    any_pressed=any(states),
                )

        # WiFi networks
        if (wifi := data.get("wifi")) is not None and isinstance(wifi, list):
            nets: list[WiFiNetwork] = []
            for net in wifi:
                if not isinstance(net, dict):
                    continue
                nets.append(WiFiNetwork(
                    mac=str(net.get("mac", "")),
                    ssid=str(net.get("ssid", "")),
                    rssi=int(net.get("rssi", -100)),
                    encryption=int(net.get("enc", 0)),
                    channel=int(net.get("ch", 1)),
                ))
            batch.wifi_nets = nets

        return batch

    def _parse_heartbeat(self, data: dict, version: int, ts: int) -> HeartbeatMessage:
        return HeartbeatMessage(
            version=version,
            timestamp_ms=ts,
            uptime_ms=int(data.get("uptime_ms", 0)),
            free_heap=int(data.get("free_heap", 0)),
            wifi_rssi=int(data.get("wifi_rssi", 0)),
        )

    def _parse_error(self, data: dict, version: int, ts: int) -> ErrorMessage:
        return ErrorMessage(
            version=version,
            timestamp_ms=ts,
            sensor=str(data.get("sensor", "unknown")),
            msg=str(data.get("msg", "")),
            code=int(data.get("code", 0)),
        )
