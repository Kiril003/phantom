"""alarms.in.ua adapter — Phase 24-F.

Polls the public alerts feed (https://api.alarms.in.ua/v3/alerts/active.json)
on a schedule the live tasker controls. Returns a typed list of
:class:`AlarmsUAAlert` records keyed by oblast id; every alert is
enriched with the oblast centroid (lat/lon + name) so the renderer
can drop a marker without a second round-trip.

The adapter NEVER raises into the tasker — failure modes (no key,
HTTP error, malformed JSON) all return an empty list and log a
warning. This keeps the live loop quiet during outages.

Manifest: `src/backend/geo/layer_registry/manifests/air_raid_ua.yaml`.
"""
from __future__ import annotations

import logging
import os
import threading
from dataclasses import dataclass
from typing import Any, ClassVar, Optional

import httpx

from ..oblast_centroids import OblastCentroid, lookup

logger = logging.getLogger(__name__)


_DEFAULT_URL = "https://api.alarms.in.ua/v3/alerts/active.json"
_DEFAULT_TIMEOUT = 4.0


@dataclass(frozen=True)
class AlarmsUAAlert:
    """One active alert, enriched with the oblast centroid."""

    oblast_id: str
    oblast_name_ua: str
    oblast_name_en: str
    iso: str
    lat: float
    lon: float
    started_at: Optional[str]
    alert_type: str

    def to_geojson_feature(self) -> dict[str, Any]:
        return {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [self.lon, self.lat]},
            "properties": {
                "oblast_id": self.oblast_id,
                "oblast_name_ua": self.oblast_name_ua,
                "oblast_name_en": self.oblast_name_en,
                "iso": self.iso,
                "started_at": self.started_at,
                "alert_type": self.alert_type,
            },
        }


# Map of alarms.in.ua oblast slugs → our internal ids. Their feed
# uses several historical spellings — keep a small alias table so
# operator updates upstream don't silently drop oblasts.
_OBLAST_ALIASES = {
    # Upstream → internal canonical
    "kyiv_oblast": "kyiv",
    "kyivska": "kyiv",
    "kyiv": "kyiv",
    "kyiv_city": "kyiv-city",
    "ivano_frankivsk": "ivano-frankivsk",
    "ivano-frankivsk": "ivano-frankivsk",
    "dnipropetrovsk": "dnipro",
    "ar_crimea": "crimea",
}


def _normalize_oblast_id(raw: str) -> str:
    key = (raw or "").strip().lower().replace("-oblast", "").replace("oblast_", "")
    return _OBLAST_ALIASES.get(key, key)


class AlarmsUAAdapter:
    """REST poller for alarms.in.ua."""

    name: ClassVar[str] = "alarms_ua"

    def __init__(
        self,
        api_key: str,
        url: str = _DEFAULT_URL,
        timeout_s: float = _DEFAULT_TIMEOUT,
    ) -> None:
        self._api_key = api_key
        self._url = url
        self._timeout_s = timeout_s

    def configured(self) -> bool:
        """Adapter is callable — i.e. an API key is present."""
        return bool(self._api_key)

    async def fetch(self) -> list[AlarmsUAAlert]:
        """Hit the upstream once. Failures return an empty list."""
        if not self._api_key:
            return []
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Accept": "application/json",
            "User-Agent": "PHANTOM-OS/0.9 (alarms_ua)",
        }
        try:
            async with httpx.AsyncClient(timeout=self._timeout_s) as client:
                resp = await client.get(self._url, headers=headers)
        except Exception as exc:
            logger.info("alarms.in.ua request failed: %s", exc)
            return []
        if resp.status_code != 200:
            logger.info(
                "alarms.in.ua returned %s: %s",
                resp.status_code,
                resp.text[:120],
            )
            return []
        try:
            payload = resp.json()
        except ValueError as exc:
            logger.warning("alarms.in.ua non-JSON response: %s", exc)
            return []
        return self._parse(payload)

    def _parse(self, payload: Any) -> list[AlarmsUAAlert]:
        # The active.json payload is `{"alerts": [...]}` per their v3
        # docs. Each alert has at least `location_oblast_uid`,
        # `location_oblast`, `started_at`, `alert_type`. Be liberal with
        # missing fields — log a warning, skip the row.
        if not isinstance(payload, dict):
            return []
        rows = payload.get("alerts")
        if not isinstance(rows, list):
            return []
        out: list[AlarmsUAAlert] = []
        seen: set[str] = set()
        for row in rows:
            if not isinstance(row, dict):
                continue
            raw_id = (
                row.get("location_oblast_uid")
                or row.get("oblast")
                or row.get("location_oblast")
                or ""
            )
            normalized = _normalize_oblast_id(str(raw_id))
            centroid = lookup(normalized)
            if centroid is None:
                logger.debug("alarms.in.ua: unknown oblast %r", raw_id)
                continue
            if centroid.id in seen:
                continue
            seen.add(centroid.id)
            alert_type = str(row.get("alert_type") or "air_raid")
            started_at = row.get("started_at")
            out.append(
                AlarmsUAAlert(
                    oblast_id=centroid.id,
                    oblast_name_ua=centroid.name_ua,
                    oblast_name_en=centroid.name_en,
                    iso=centroid.iso,
                    lat=centroid.lat,
                    lon=centroid.lon,
                    started_at=str(started_at) if started_at else None,
                    alert_type=alert_type,
                )
            )
        return out


# ── Singleton helper ──────────────────────────────────────────────────────


_lock = threading.Lock()
_default: Optional[AlarmsUAAdapter] = None


def get_default_alarms_ua() -> AlarmsUAAdapter:
    """Build (or return) the process-wide adapter using env config."""
    global _default
    if _default is not None:
        return _default
    with _lock:
        if _default is None:
            api_key = os.environ.get("ALARMS_UA_KEY", "")
            _default = AlarmsUAAdapter(api_key)
    return _default


def reset_alarms_ua_for_tests(adapter: Optional[AlarmsUAAdapter] = None) -> AlarmsUAAdapter:
    global _default
    with _lock:
        _default = adapter or AlarmsUAAdapter("")
    return _default
