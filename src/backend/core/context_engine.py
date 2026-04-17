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

import psutil

from config import config
from sensors.sensor_parser import SensorBatch, RadarData
from core.event_bus import event_bus

logger = logging.getLogger(__name__)

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
            "active_timers": 0,
            "pending_events_1h": 0,
        },
        "memory_hints": [],
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
        self._start_time = time.monotonic()
        self._last_interaction_ts = time.monotonic()
        self._last_state_change_ts = time.monotonic()
        self._mood_window: deque[float] = deque(maxlen=20)
        self._system_state = "SHADOW"
        self._ai_provider = config.ai_primary_provider

        # Track "other person" detection with hysteresis
        self._other_detected_count = 0
        self._user_detected_count = 0

        self._lock = asyncio.Lock()

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
        self._system_state = state
        self._snapshot["system"]["state"] = state
        self._last_state_change_ts = time.monotonic()

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

    def record_interaction(self) -> None:
        self._last_interaction_ts = time.monotonic()

    def set_ai_provider(self, provider: str) -> None:
        self._ai_provider = provider
        self._snapshot["system"]["ai_provider"] = provider

    def set_memory_hints(self, hints: list[str]) -> None:
        self._snapshot["memory_hints"] = hints[:5]

    # ── Internal update methods ────────────────────────────────────────────────

    def _apply_batch(self, batch: SensorBatch) -> None:
        self._apply_radar(batch)
        self._apply_gps(batch)
        self._apply_env(batch)

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

    def _apply_env(self, batch: SensorBatch) -> None:
        e = batch.env
        if e is None:
            return
        self._snapshot["env"].update({
            "temp_c": e.temp_c,
            "pressure_hpa": e.pressure_hpa,
            "aqi": e.aqi,
        })

    def _update_system(self) -> None:
        try:
            cpu = psutil.cpu_percent(interval=None)
            ram = psutil.virtual_memory().percent
            disk = psutil.disk_usage("/").percent
        except Exception:
            cpu, ram, disk = 0.0, 0.0, 0.0

        uptime = time.monotonic() - self._start_time
        # Reconcile the cached provider with the live config each tick so a
        # Settings → AI primary change propagates to the snapshot (and thus
        # the StatusBar) within one 500 ms broadcast cycle. AIRouter still
        # calls set_ai_provider() after a response, which briefly surfaces
        # the actual responder (useful when primary failed and fallback
        # answered); the next tick converges back to the configured primary.
        configured = config.ai_primary_provider
        if self._ai_provider != configured:
            self._ai_provider = configured
        self._snapshot["system"].update({
            "state": self._system_state,
            "uptime_s": int(uptime),
            "cpu_percent": cpu,
            "ram_percent": ram,
            "disk_percent": disk,
            "ai_provider": self._ai_provider,
        })

    def _update_time(self) -> None:
        now = datetime.now(tz=timezone.utc)
        work_start = config.tools_work_hours_start  # "09:00"
        work_end = config.tools_work_hours_end       # "18:00"
        try:
            wh, wm = [int(x) for x in work_start.split(":")]
            we_h, we_m = [int(x) for x in work_end.split(":")]
            work_minutes = now.hour * 60 + now.minute
            work_hours = (wh * 60 + wm) <= work_minutes <= (we_h * 60 + we_m)
        except Exception:
            work_hours = False

        self._snapshot["when"].update({
            "time": now.strftime("%H:%M"),
            "hour": now.hour,
            "day_of_week": now.strftime("%a").lower(),
            "date": now.strftime("%Y-%m-%d"),
            "work_hours": work_hours,
            "is_night": now.hour >= 23 or now.hour < 6,
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

        self._snapshot["history"].update({
            "last_interaction_ago_s": interaction_ago,
            "last_state_change_ago_s": state_change_ago,
            "mood_trend": trend,
        })


# Singleton
context_engine = ContextEngine()
