"""Точка на дроті: kind='geo:point', тіло {lat, lon, at, acc?, label?}.

`at` — час ВИМІРУ на вузлі відправника (мілісекунди epoch), не час доставки.
Скринька везе саме його: точка з минулого не має вдягати живий бейдж, навіть
якщо доїхала за секунду.

Розбирає точку і вузол-відправник (перед відправкою), і вузол-одержувач (перед
тим, як покласти в стрічку). Пів-точка в стрічці гірша за відсутню: показати
широту без довготи означає намалювати людину не там, де вона є.
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass
from typing import Optional

__all__ = ["GeoPoint", "parse_point"]

#: Довший підпис у стрічку не лізе, а різати його після приїзду вже пізно.
LABEL_LIMIT = 120


@dataclass(frozen=True)
class GeoPoint:
    lat: float
    lon: float
    #: Час виміру, мілісекунди epoch.
    at_ms: int
    accuracy_m: Optional[float] = None
    label: Optional[str] = None


def _number(raw: object) -> Optional[float]:
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        return None
    value = float(raw)
    return value if math.isfinite(value) else None


def parse_point(body: str) -> Optional[GeoPoint]:
    """Тіло кадру → точка. Неповне або несхоже на координати — None."""
    try:
        raw = json.loads(body or "")
    except (TypeError, ValueError):
        return None
    if not isinstance(raw, dict):
        return None

    lat = _number(raw.get("lat"))
    lon = _number(raw.get("lon"))
    at = _number(raw.get("at"))
    if lat is None or lon is None or at is None:
        return None
    if not -90.0 <= lat <= 90.0 or not -180.0 <= lon <= 180.0 or at <= 0:
        return None

    accuracy = _number(raw.get("acc"))
    label = raw.get("label")
    return GeoPoint(
        lat=lat,
        lon=lon,
        at_ms=int(at),
        accuracy_m=accuracy if accuracy is not None and accuracy >= 0 else None,
        label=label.strip()[:LABEL_LIMIT] if isinstance(label, str) and label.strip() else None,
    )
