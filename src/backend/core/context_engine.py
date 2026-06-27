"""
ContextEngine — heart of PHANTOM OS.
Collects SensorBatch + system state every 500ms → builds ContextSnapshot.
L1 cache: in-memory dict.  L2+: delegated to memory modules (later phases).
"""
from __future__ import annotations

import asyncio
import logging
import time
from collections import deque
from datetime import datetime, timezone
from typing import Optional

import socket
import psutil

from config import config
from sensors.sensor_parser import SensorBatch, RadarData
from core.event_bus import event_bus

logger = logging.getLogger(__name__)

def _check_internet() -> bool:
    try:
        # Connect to a reliable IP (Google DNS)
        socket.create_connection(("8.8.8.8", 53), timeout=1.0)
        return True
    except (OSError, socket.timeout):
        return False

def _check_wifi() -> bool:
    # On Linux, /proc/net/wireless presence or checking interfaces via psutil
    try:
        addrs = psutil.net_if_addrs()
        # Look for typical wifi interface names or any with wireless stats
        for iface in ["wlan0", "wlp", "wifi0"]:
            if any(iface in name for name in addrs):
                # Simple check: has IP address
                for addr in addrs.get(iface, []):
                    if addr.family == socket.AF_INET:
                        return True
        return False
    except Exception:
        return False

# ── Breathing state thresholds ─────────────────────────────────────────────────
_BREATHING_STATES = [
    (0, 10, "sleep"),
    (10, 14, "sleep"),
    (14, 20, "calm"),
    (20, 24, "normal"),
    (24, 28, "elevated"),
    (28, 999, "stressed"),
]


def _classify_breathing(bpm: Optional[float]) -> str:
    if bpm is None:
        return "normal"
    for lo, hi, state in _BREATHING_STATES:
        if lo <= bpm < hi:
            return state
    return "stressed"


def _stress_from_breathing(bpm: Optional[float]) -> Optional[float]:
    if bpm is None:
        return None
    if bpm < 14:
        return 0.1
    if bpm < 20:
        return 0.15
    if bpm < 24:
        return 0.3
    if bpm < 28:
        return 0.6
    return min(1.0, (bpm - 28) / 20 + 0.7)


# ── Snapshot dict structure (mirrors ContextSnapshot TS interface) ─────────────

def _empty_snapshot() -> dict:
    now = datetime.now(tz=timezone.utc)
    return {
        "timestamp": int(time.time() * 1000),
        "who": {
            "user_id": None,
            "username": None,
            "confidence": 0.0,
            "auth_method": None,
            "role": None,
        },
        "where": {
            "lat": None,
            "lon": None,
            "fix": False,
            "satellites": 0,
            "speed_kmh": 0.0,
            "place_known": False,
            "place_name": None,
            "first_visit": False,
            # Phase 9.4b — provenance carried on every snapshot.
            "source": "none",
            "confidence": 0.0,
            "accuracy_m": None,
        },
        "when": {
            "time": now.strftime("%H:%M"),
            "hour": now.hour,
            "day_of_week": now.strftime("%a").lower(),
            "date": now.strftime("%Y-%m-%d"),
            "work_hours": False,
            "is_night": now.hour >= 23 or now.hour < 6,
        },
        "body": {
            "breathing_bpm": None,
            "breathing_state": "normal",
            "stress_level": None,
            "motion_energy": None,
            "static_energy": None,
            "user_distance_cm": None,
        },
        "env": {
            "temp_c": None,
            "pressure_hpa": None,
            "aqi": None,
            "light_lux": None,
        },
        "presence": {
            "user_detected": False,
            "user_distance_cm": None,
            "other_detected": False,
            "other_distance_cm": None,
        },
        "history": {
            "last_interaction_ago_s": 999,
            "last_state_change_ago_s": 0,
            "mood_trend": "stable",
            "pending_events_1h": 0,
        },
        "last_input_method": "none",
        "memory_hints": [],
        # Phase 9.4c-qw fix #3 — best-effort nearby OSM features cache
        # populated by resolve_localization(). Empty until the resolver
        # has a fix and Overpass returns at least one named feature.
        "nearby": [],
        # Audit-2026-04-28 F-04: GHOST trigger reads these. Populated by
        # _apply_encoder / _apply_buttons; left None until first batch
        # carries encoder/buttons data.
        "encoder": None,
        "buttons": None,
        "system": {
            "state": "SHADOW",
            "uptime_s": 0,
            "cpu_percent": 0.0,
            "ram_percent": 0.0,
            "disk_percent": 0.0,
            "wifi_connected": False,
            "internet_available": False,
            "ai_provider": config.ai_primary_provider,
            "stt_engine": "vosk" if config.voice_stt_mode == "vosk" else "whisper",
        },
    }


class ContextEngine:
    """
    Builds and maintains the current ContextSnapshot.
    Updated every 500ms (or on each incoming SensorBatch).
    """

    def __init__(self) -> None:
        self._snapshot: dict = _empty_snapshot()
        self._history: deque[dict] = deque(maxlen=720)   # 6 min @ 500ms
        self._hearing_buffer: deque[dict] = deque(maxlen=20) # Audio transcripts
        self._start_time = time.monotonic()
        # Audit-2026-04-28 F-05: backdate so first tick reports 999 s idle
        # (matches _empty_snapshot default), letting idle guards trip
        # immediately on cold boot instead of waiting for the first user
        # interaction to advance the clock.
        self._last_interaction_ts = time.monotonic() - 999.0
        self._last_state_change_ts = time.monotonic()
        self._mood_window: deque[float] = deque(maxlen=20)
        self._system_state = "SHADOW"
        self._ai_provider = config.ai_primary_provider
        self._last_voice_activity_ts = time.monotonic() - 999.0
        self._voice_active = False
        self._is_calm = False
        self._calm_delay_s = 8.0
        self._gap_delay_s = 2.0
        self._gap_emitted = True

        # Track "other person" detection with hysteresis
        self._other_detected_count = 0
        self._user_detected_count = 0

        # Phase 9.4c-qw fix #3 — nearby OSM cache (60 s TTL keyed on
        # rounded coords so small GPS jitter doesn't blow the cache).
        self._nearby_cache_ts: float = 0.0
        self._nearby_cache_key: tuple[float, float] | None = None
        self._nearby_cache_data: list[dict] = []

        self._lock = asyncio.Lock()

        # Connectivity & Slow fields state
        self._internet_available = False
        self._wifi_connected = False
        self._pending_events_1h = 0
        self._last_slow_refresh = 0.0

    # ── Public API ─────────────────────────────────────────────────────────────

    async def update(self, batch: SensorBatch) -> dict:
        """Process a SensorBatch and return the updated ContextSnapshot."""
        async with self._lock:
            self._apply_batch(batch)
            self._update_system()
            self._update_time()
            self._update_history_metrics()
            self._snapshot["timestamp"] = int(time.time() * 1000)

            snapshot_copy = dict(self._snapshot)
            self._history.append(snapshot_copy)

        event_bus.emit("context_updated", snapshot_copy)
        return snapshot_copy

    async def tick(self) -> dict:
        """Time-driven update (no new sensor data)."""
        async with self._lock:
            self._update_system()
            self._update_time()
            self._update_history_metrics()
            self._snapshot["timestamp"] = int(time.time() * 1000)
            snapshot_copy = dict(self._snapshot)
            self._history.append(snapshot_copy)

        event_bus.emit("context_updated", snapshot_copy)
        return snapshot_copy

    def get_snapshot(self) -> dict:
        """Return current snapshot without updating."""
        return dict(self._snapshot)

    def get_history(self, minutes: int = 60) -> list[dict]:
        """Return recent snapshots (up to `minutes` minutes back)."""
        cutoff_ms = (time.time() - minutes * 60) * 1000
        return [s for s in self._history if s.get("timestamp", 0) >= cutoff_ms]

    def set_state(self, state: str) -> None:
        old_state = self._system_state
        self._system_state = state
        self._snapshot["system"]["state"] = state
        self._last_state_change_ts = time.monotonic()
        if old_state != state:
            user_id = self._snapshot["who"].get("user_id")
            if user_id:
                try:
                    loop = asyncio.get_running_loop()
                    if loop.is_running():
                        from memory.brain import memory_brain
                        loop.create_task(memory_brain.predictive_warm(user_id, state))
                except RuntimeError:
                    pass

    def set_authenticated_user(
        self,
        user_id: str,
        username: str,
        role: str,
        auth_method: str,
        confidence: float = 1.0,
    ) -> None:
        self._snapshot["who"] = {
            "user_id": user_id,
            "username": username,
            "confidence": confidence,
            "auth_method": auth_method,
            "role": role,
        }

    def record_interaction(self, method: str = "voice") -> None:
        self._last_interaction_ts = time.monotonic()
        self._snapshot["last_input_method"] = method
        self._gap_emitted = False
        if self._is_calm:
            self._is_calm = False
            event_bus.emit("context_signal", {
                "type": "calm_window",
                "name": "calm_window_closed",
                "timestamp": time.time(),
                "payload": {}
            })
            event_bus.emit("calm_window_closed", {})

    def record_voice_activity(self, active: bool) -> None:
        self._voice_active = active
        if active:
            self._last_voice_activity_ts = time.monotonic()
            self._gap_emitted = False
            if self._is_calm:
                self._is_calm = False
                event_bus.emit("context_signal", {
                    "type": "calm_window",
                    "name": "calm_window_closed",
                    "timestamp": time.time(),
                    "payload": {}
                })
                event_bus.emit("calm_window_closed", {})

    def is_calm(self) -> bool:
        return self._is_calm

    def record_heard_speech(self, text: str) -> None:
        if not text:
            return
        now = time.time()
        self._hearing_buffer.append({"text": text.strip(), "ts": now})

    def get_recent_hearing(self, window_s: int = 30) -> list[str]:
        now = time.time()
        return [item["text"] for item in self._hearing_buffer if now - item["ts"] <= window_s]

    def set_ai_provider(self, provider: str) -> None:
        self._ai_provider = provider
        self._snapshot["system"]["ai_provider"] = provider

    def set_memory_hints(self, hints: list[str]) -> None:
        self._snapshot["memory_hints"] = hints[:5]

    def set_env_aqi(self, aqi: float | None) -> None:
        """Inject a location-sourced air-quality index into the snapshot.
        Hardware air sensors (if any) still override via _apply_env."""
        if aqi is not None:
            self._snapshot["env"]["aqi"] = aqi

    # ── Internal update methods ────────────────────────────────────────────────

    def _apply_batch(self, batch: SensorBatch) -> None:
        self._apply_radar(batch)
        self._apply_gps(batch)
        self._apply_env(batch)
        self._apply_encoder(batch)
        self._apply_buttons(batch)

    def _apply_encoder(self, batch: SensorBatch) -> None:
        # Audit-2026-04-28 F-04: lift parsed EncoderData onto the snapshot
        # so state_machine._ghost_trigger and any future encoder consumer
        # can read it. Persists between batches — firmware ships encoder
        # frames only when state changes.
        enc = batch.encoder
        if enc is None:
            return
            
        if enc.delta != 0 or enc.button or enc.long_press:
            self.record_interaction(method="encoder")
            
        self._snapshot["encoder"] = {
            "position": enc.position,
            "delta": enc.delta,
            "button": enc.button,
            "long_press": enc.long_press,
        }

    def _apply_buttons(self, batch: SensorBatch) -> None:
        btns = batch.buttons
        if btns is None:
            return
            
        if btns.any_pressed:
            self.record_interaction(method="touch")
            
        self._snapshot["buttons"] = {
            "rgb_states": list(btns.rgb_states),
            "any_pressed": btns.any_pressed,
        }

    def _apply_radar(self, batch: SensorBatch) -> None:
        r = batch.radar
        if r is None:
            return

        bpm = r.breath_bpm
        breathing_state = _classify_breathing(bpm)
        stress = _stress_from_breathing(bpm)

        self._snapshot["body"].update({
            "breathing_bpm": bpm,
            "breathing_state": breathing_state,
            "stress_level": stress,
            "motion_energy": r.motion_energy,
            "static_energy": r.static_energy,
            "user_distance_cm": r.distance_cm if r.present else None,
        })

        # Track mood trend via stress window (skip unknown stress)
        if stress is not None:
            self._mood_window.append(stress)

        # Presence detection with hysteresis (avoid flickering)
        if r.present:
            self._user_detected_count = min(self._user_detected_count + 1, 5)
        else:
            self._user_detected_count = max(self._user_detected_count - 1, 0)

        user_confirmed = self._user_detected_count >= 2

        # "other person" heuristic: second peak in radar data
        # LD2410 reports one object; if auth user is NOT confirmed but radar detects
        # someone at close range, treat as "other"
        who = self._snapshot["who"]
        authenticated = who.get("user_id") is not None

        if r.present and r.distance_cm < 300:
            if not authenticated:
                self._other_detected_count = min(self._other_detected_count + 1, 5)
            else:
                self._other_detected_count = max(self._other_detected_count - 1, 0)
        else:
            self._other_detected_count = max(self._other_detected_count - 1, 0)

        other_confirmed = self._other_detected_count >= 3

        self._snapshot["presence"].update({
            "user_detected": user_confirmed,
            "user_distance_cm": r.distance_cm if user_confirmed else None,
            "other_detected": other_confirmed,
            "other_distance_cm": r.distance_cm if other_confirmed else None,
        })

    def _apply_gps(self, batch: SensorBatch) -> None:
        g = batch.gps
        if g is None:
            return
        self._snapshot["where"].update({
            "lat": g.lat if g.fix else None,
            "lon": g.lon if g.fix else None,
            "fix": g.fix,
            "satellites": g.satellites,
            "speed_kmh": g.speed_kmh,
        })
        # Direct GPS batch surfaces as the authoritative source until the
        # async resolver tick publishes a richer fix. Preserve prior
        # place_known / place_name fields set by higher layers.
        if g.fix:
            self._snapshot["where"].update({
                "source": "gps_hardware",
                "confidence": 0.9,
                "accuracy_m": 15.0,
            })

    async def _refresh_nearby(self, lat: float, lon: float) -> list[dict]:
        """Phase 9.4c-qw fix #3 — refresh and cache top-5 OSM features near a point.

        60 s TTL keyed on coords rounded to 3 decimals (~110 m). On
        Overpass error returns the prior cache (or empty). Never raises.
        """
        key = (round(lat, 3), round(lon, 3))
        now = time.monotonic()
        if (
            self._nearby_cache_key == key
            and (now - self._nearby_cache_ts) < 60.0
            and self._nearby_cache_data is not None
        ):
            return self._nearby_cache_data
        try:
            from agent.localization.adapters.overpass import (  # noqa: PLC0415
                get_default_overpass,
            )
            overpass = get_default_overpass()
            features = await overpass.features_near(lat, lon, radius_m=500)
        except Exception as exc:  # noqa: BLE001
            logger.debug("nearby fetch failed: %s", exc)
            return self._nearby_cache_data or []
        top5 = [
            {
                "name": f.name,
                "type": f.type or "",
                "distance_m": int(f.distance_m),
            }
            for f in features
            if f.name
        ][:5]
        self._nearby_cache_key = key
        self._nearby_cache_ts = now
        self._nearby_cache_data = top5
        return top5

    async def resolve_localization(self) -> None:
        """Phase 9.4b — pull the latest LocationEstimate from the resolver.

        Called from the tick loop. Writes whichever source won to the
        ``where`` block so the snapshot always carries provenance. When no
        source resolves (offline, no hardware, no IP), the fields stay at
        their initial "none" / 0.0 defaults.
        """
        try:
            from agent.localization import get_resolver  # noqa: PLC0415
        except ImportError:  # pragma: no cover — import guard
            return
        try:
            resolver = get_resolver()
            estimate = await resolver.resolve()
        except Exception as exc:  # noqa: BLE001
            logger.debug("localization resolve failed: %s", exc)
            return

        async with self._lock:
            where = self._snapshot["where"]
            if estimate is None:
                # Clear the provenance fields but leave raw GPS numbers
                # alone — if hardware is pushing updates separately, those
                # stay valid until their own cycle clears them.
                if where.get("source") != "gps_hardware":
                    where["source"] = "none"
                    where["confidence"] = 0.0
                    where["accuracy_m"] = None
                return
            where["source"] = estimate.source
            where["confidence"] = estimate.confidence
            where["accuracy_m"] = estimate.accuracy_m
            # Only overwrite coordinates when the resolver beats the hardware
            # source (or hardware has no fix). Hardware GPS has trust=95 so
            # any browser/IP/user-stated result will only surface here when
            # hardware is unavailable.
            if not where.get("fix") or estimate.source == "gps_hardware":
                where["lat"] = estimate.lat
                where["lon"] = estimate.lon
                where["fix"] = estimate.source == "gps_hardware"
            cur_lat = where.get("lat")
            cur_lon = where.get("lon")

        # Phase 9.4c-qw fix #3 — refresh nearby OSM features outside the
        # snapshot lock; the helper has its own caching + best-effort path.
        if cur_lat is not None and cur_lon is not None:
            nearby = await self._refresh_nearby(float(cur_lat), float(cur_lon))
            async with self._lock:
                self._snapshot["nearby"] = nearby
                if nearby:
                    self._snapshot["where"]["place_name"] = nearby[0]["name"]
                    self._snapshot["where"]["place_known"] = True

    def _apply_env(self, batch: SensorBatch) -> None:
        e = batch.env
        if e is None:
            return
        self._snapshot["env"].update({
            "temp_c": e.temp_c,
            "pressure_hpa": e.pressure_hpa,
            "light_lux": getattr(e, "light_lux", None),
        })
        # Don't clobber an externally-sourced AQI (e.g. location-based) with a
        # None from hardware that has no air sensor; let real readings override.
        if e.aqi is not None:
            self._snapshot["env"]["aqi"] = e.aqi

    def _update_system(self) -> None:
        try:
            cpu = psutil.cpu_percent(interval=None)
            ram = psutil.virtual_memory().percent
            disk = psutil.disk_usage("/").percent
        except (psutil.Error, OSError):
            cpu, ram, disk = 0.0, 0.0, 0.0

        uptime = time.monotonic() - self._start_time
        
        # Day-4 Z-3: consult the router for the truly active responder.
        # This property now polls AIHub for dynamic routing decisions.
        from ai.provider import ai_router
        self._ai_provider = ai_router.active_provider_name
        
        self._snapshot["system"].update({
            "state": self._system_state,
            "uptime_s": int(uptime),
            "cpu_percent": cpu,
            "ram_percent": ram,
            "disk_percent": disk,
            "ai_provider": self._ai_provider,
            "internet_available": self._internet_available,
            "wifi_connected": self._wifi_connected,
        })

    async def refresh_slow_context(self) -> None:
        """Update connectivity and DB-heavy metrics (every 30-60s)."""
        now = time.monotonic()
        if (now - self._last_slow_refresh) < 30.0:
            return

        # 1. Connectivity
        self._internet_available = await asyncio.to_thread(_check_internet)
        self._wifi_connected = _check_wifi()

        # 2. Database lookups (Events in next 1h & First visit)
        try:
            from db.database import get_session
            from db.models import CalendarEvent, User, LocationHistory
            from sqlalchemy import select, and_
            from datetime import datetime, timedelta, timezone

            # Pick first user if not authenticated (common for single-user kiosk)
            user_id = self._snapshot["who"].get("user_id")
            if not user_id:
                async with get_session() as db:
                    stmt = select(User).order_by(User.created_at.asc()).limit(1)
                    u = (await db.execute(stmt)).scalar_one_or_none()
                    user_id = u.id if u else None

            if user_id:
                t0 = datetime.now(tz=timezone.utc)
                t1 = t0 + timedelta(hours=1)

                async with get_session() as db:
                    # Events
                    stmt_ev = select(CalendarEvent).where(
                        and_(
                            CalendarEvent.user_id == user_id,
                            CalendarEvent.start_time >= t0,
                            CalendarEvent.start_time <= t1
                        )
                    )
                    res_ev = await db.execute(stmt_ev)
                    self._pending_events_1h = len(res_ev.scalars().all())

                    # First Visit (bounding box ~500m)
                    lat = self._snapshot["where"].get("lat")
                    lon = self._snapshot["where"].get("lon")
                    if lat is not None and lon is not None:
                        stmt_loc = select(LocationHistory).where(
                            and_(
                                LocationHistory.user_id == user_id,
                                LocationHistory.lat.between(lat - 0.005, lat + 0.005),
                                LocationHistory.lon.between(lon - 0.005, lon + 0.005),
                                LocationHistory.timestamp < (t0 - timedelta(days=1))
                            )
                        ).limit(1)
                        res_loc = await db.execute(stmt_loc)
                        self._snapshot["where"]["first_visit"] = (res_loc.scalar_one_or_none() is None)
        except Exception as exc:
            logger.debug("Slow context DB refresh failed: %s", exc)
            self._pending_events_1h = 0

        self._last_slow_refresh = now

    def _update_time(self) -> None:
        # Use local time for the 'when' block so the AI knows the user's actual time
        now = datetime.now().astimezone()
        work_start = config.tools_work_hours_start  # "09:00"
        work_end = config.tools_work_hours_end       # "18:00"
        try:
            wh, wm = [int(x) for x in work_start.split(":")]
            we_h, we_m = [int(x) for x in work_end.split(":")]
            work_minutes = now.hour * 60 + now.minute
            work_hours = (wh * 60 + wm) <= work_minutes <= (we_h * 60 + we_m)
        except (ValueError, TypeError, AttributeError):
            work_hours = False

        hour = now.hour
        lux = self._snapshot["env"].get("light_lux")
        is_night = (hour >= 22 and (lux is None or lux < 5.0)) or hour < 6

        old_is_night = self._snapshot["when"].get("is_night", False)
        if old_is_night != is_night:
            event_bus.emit("context_signal", {
                "type": "night_mode",
                "name": "night_mode_changed",
                "timestamp": time.time(),
                "payload": {"is_night": is_night, "lux": lux}
            })
            event_bus.emit("night_mode_changed", {"is_night": is_night, "lux": lux})

        self._snapshot["when"].update({
            "time": now.strftime("%H:%M"),
            "hour": hour,
            "day_of_week": now.strftime("%a").lower(),
            "date": now.strftime("%Y-%m-%d"),
            "work_hours": work_hours,
            "is_night": is_night,
        })

    def _update_history_metrics(self) -> None:
        now = time.monotonic()
        interaction_ago = now - self._last_interaction_ts
        state_change_ago = now - self._last_state_change_ts

        # Mood trend from recent stress window
        if len(self._mood_window) >= 4:
            recent = list(self._mood_window)[-4:]
            older = list(self._mood_window)[:-4]
            if older:
                avg_recent = sum(recent) / len(recent)
                avg_older = sum(older) / len(older)
                if avg_recent < avg_older - 0.05:
                    trend = "improving"
                elif avg_recent > avg_older + 0.05:
                    trend = "declining"
                else:
                    trend = "stable"
            else:
                trend = "stable"
        else:
            trend = "stable"

        voice_ago = now - self._last_voice_activity_ts
        is_calm = (
            interaction_ago >= self._calm_delay_s
            and voice_ago >= self._calm_delay_s
            and not self._voice_active
        )

        if is_calm != self._is_calm:
            self._is_calm = is_calm
            if is_calm:
                payload = {
                    "last_interaction_ago_s": interaction_ago,
                    "last_voice_activity_ago_s": voice_ago
                }
                event_bus.emit("context_signal", {
                    "type": "calm_window",
                    "name": "calm_window_opened",
                    "timestamp": time.time(),
                    "payload": payload
                })
                event_bus.emit("calm_window_opened", payload)
            else:
                event_bus.emit("context_signal", {
                    "type": "calm_window",
                    "name": "calm_window_closed",
                    "timestamp": time.time(),
                    "payload": {}
                })
                event_bus.emit("calm_window_closed", {})

        # Speech gap detection:
        if not self._voice_active and self._last_voice_activity_ts > 0:
            gap_elapsed = now - self._last_voice_activity_ts
            if gap_elapsed >= self._gap_delay_s and not self._gap_emitted:
                self._gap_emitted = True
                event_bus.emit("context_signal", {
                    "type": "speech_gap",
                    "name": "gap_detected",
                    "timestamp": time.time(),
                    "payload": {"gap_duration_s": gap_elapsed}
                })

        self._snapshot["history"].update({
            "last_interaction_ago_s": interaction_ago,
            "last_state_change_ago_s": state_change_ago,
            "mood_trend": trend,
            "pending_events_1h": self._pending_events_1h,
        })


# Singleton
context_engine = ContextEngine()
