"""
Phase 9.4b — GpsHardwareSource.

Reads the current ContextEngine snapshot. When the ESP32 GPS reports a
3-D fix we return it as a high-trust estimate; otherwise the source is
unavailable and the resolver falls through. The source itself is stateless
— ContextEngine owns the live GPS data and this class just publishes a
LocationEstimate view over it.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from ..base import LocationEstimate, LocalizationSource


class GpsHardwareSource(LocalizationSource):
    name = "gps_hardware"
    trust_level = 95

    def __init__(self) -> None:
        # Defer import — ContextEngine imports from many modules and circular
        # import bait is real.
        from core.context_engine import context_engine  # noqa: PLC0415
        self._engine = context_engine

    def _current_where(self) -> dict:
        snap = self._engine.get_snapshot()
        return snap.get("where", {}) or {}

    def is_available(self) -> bool:
        where = self._current_where()
        return bool(where.get("fix")) and where.get("lat") is not None and where.get("lon") is not None

    async def get_position(self) -> Optional[LocationEstimate]:
        where = self._current_where()
        if not where.get("fix"):
            return None
        lat = where.get("lat")
        lon = where.get("lon")
        if lat is None or lon is None:
            return None
        sats = int(where.get("satellites") or 0)
        # Confidence scales with satellite count: 4 sats ~= bare fix (0.7),
        # 8+ sats = solid (0.95). Under 3 shouldn't happen (fix=False) but
        # we floor at 0.5.
        confidence = max(0.5, min(0.95, 0.5 + sats * 0.06))
        # Accuracy estimate: rough heuristic — 2 m per satellite above 4
        # (consumer GPS gets ~5 m in the open with 8+ sats).
        accuracy_m = max(5.0, 30.0 - (sats - 4) * 3.0) if sats else 50.0
        return LocationEstimate(
            lat=float(lat),
            lon=float(lon),
            source=self.name,
            confidence=round(confidence, 3),
            accuracy_m=round(accuracy_m, 1),
            timestamp=datetime.now(tz=timezone.utc),
            trust_level=self.trust_level,
        )


__all__ = ["GpsHardwareSource"]
