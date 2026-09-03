"""Що бачить радіо самого ПК.

Телефон у кишені знає, де він, бо має GNSS. У ноутбука приймача немає, і
досі його місце падало до «за IP ±50 км» — хоча Wi-Fi-модуль у ньому є і
бачить ті самі точки доступу, які телефон уже колись прив'язав до
координат. Тут ми питаємо ядро, що воно бачить; координати до цих MAC
підставляє шар вище з бази спостережень.
"""
from __future__ import annotations

import asyncio
import logging
import shutil
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)

_SCAN_TIMEOUT_S = 6.0

_LEARN_MAX_ACCURACY_M = 100.0


@dataclass(frozen=True)
class SeenAp:
    bssid: str
    ssid: str
    rssi_dbm: int
    freq_mhz: int

    def to_dict(self) -> dict:
        return {
            "bssid": self.bssid,
            "ssid": self.ssid,
            "rssi_dbm": self.rssi_dbm,
            "freq_mhz": self.freq_mhz,
        }


async def learn(db, lat: float, lon: float, accuracy_m: float, seen) -> dict:
    """Прив'язати видимі точки доступу до надійного місця."""
    from datetime import datetime, timezone

    from sqlalchemy import select

    from db.models import WardrivingRecord
    from wardriving.collector import normalize_mac

    if accuracy_m > _LEARN_MAX_ACCURACY_M:
        return {"learned": 0, "reason": "місце надто грубе, щоб чогось учити"}
    if not seen:
        return {"learned": 0, "reason": "радіо мовчить"}

    lat_r, lon_r = round(lat, 4), round(lon, 4)
    learned = 0
    for ap in seen:
        mac = normalize_mac(ap.bssid)
        if not mac:
            continue
        existing = (
            await db.execute(
                select(WardrivingRecord).where(
                    WardrivingRecord.mac == mac,
                    WardrivingRecord.lat_rounded == lat_r,
                    WardrivingRecord.lon_rounded == lon_r,
                )
            )
        ).scalars().first()
        if existing is not None:
            existing.rssi = max(existing.rssi, ap.rssi_dbm)
            existing.seen_count += 1
            existing.last_seen = datetime.now(tz=timezone.utc).replace(tzinfo=None)
            continue
        db.add(
            WardrivingRecord(
                mac=mac,
                ssid=ap.ssid[:256],
                rssi=ap.rssi_dbm,
                encryption="",
                channel=0,
                lat=lat,
                lon=lon,
                lat_rounded=lat_r,
                lon_rounded=lon_r,
            )
        )
        learned += 1
    await db.commit()
    return {"learned": learned, "seen": len(seen)}


def parse_packed(packed: str) -> list[SeenAp]:
    """«bssid,rssi,freq;…» — те, чим телефон пакує побачене."""
    from wardriving.collector import normalize_mac

    out: list[SeenAp] = []
    for chunk in (packed or "").split(";"):
        parts = chunk.split(",")
        if len(parts) != 3 or not parts[0]:
            continue
        mac = normalize_mac(parts[0])
        if not mac:
            continue
        try:
            out.append(
                SeenAp(bssid=mac, ssid="", rssi_dbm=int(parts[1]), freq_mhz=int(parts[2]))
            )
        except ValueError:
            continue
    return out


def _quality_to_dbm(quality: int) -> int:
    """nmcli віддає якість 0..100, а моделі втрат потрібні дБм."""
    return max(-100, min(-30, quality // 2 - 100))


def _parse_nmcli(raw: str) -> list[SeenAp]:
    out: list[SeenAp] = []
    for line in raw.strip().splitlines():
        # BSSID містить екрановані двокрапки: CC\:2D\:21\:...
        fields = [f.replace("\\:", ":") for f in _split_unescaped(line)]
        if len(fields) < 4:
            continue
        bssid, ssid, signal, freq = fields[0], fields[1], fields[2], fields[3]
        if len(bssid.split(":")) != 6:
            continue
        try:
            quality = int(signal)
        except ValueError:
            continue
        try:
            freq_mhz = int(freq.split()[0])
        except (ValueError, IndexError):
            freq_mhz = 2437
        out.append(
            SeenAp(
                bssid=bssid.upper(),
                ssid=ssid,
                rssi_dbm=_quality_to_dbm(quality),
                freq_mhz=freq_mhz,
            )
        )
    return out


def _split_unescaped(line: str) -> list[str]:
    """Ділить рядок nmcli по неекранованих двокрапках."""
    fields: list[str] = []
    buf: list[str] = []
    i = 0
    while i < len(line):
        ch = line[i]
        if ch == "\\" and i + 1 < len(line):
            buf.append(line[i : i + 2])
            i += 2
            continue
        if ch == ":":
            fields.append("".join(buf))
            buf = []
        else:
            buf.append(ch)
        i += 1
    fields.append("".join(buf))
    return fields


async def scan() -> list[SeenAp]:
    """Список видимих точок доступу. Порожній — коли радіо немає або вимкнене."""
    nmcli = shutil.which("nmcli")
    if nmcli is None:
        return []
    try:
        proc = await asyncio.create_subprocess_exec(
            nmcli, "-t", "-f", "BSSID,SSID,SIGNAL,FREQ", "dev", "wifi", "list",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=_SCAN_TIMEOUT_S)
    except (asyncio.TimeoutError, OSError) as exc:
        logger.info("wifi scan failed: %s", exc)
        return []
    return _parse_nmcli(stdout.decode("utf-8", "replace"))


__all__ = ["SeenAp", "scan"]
