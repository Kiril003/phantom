"""
OLED face animator — emits "oled" WebSocket frames at ~30 Hz.

In production these same frames flow over serial to two SH1106 OLEDs driven
by the ESP32. For Phase 08 the consumer is a tiny SVG preview embedded in
the StatusBar, so the backend is authoritative about WHICH eye state to
show at any given moment — the browser just renders it.

Eye state is derived from three inputs, in priority order:
  1. System state       — SHADOW/DREAM sleepy, FOCUS tracking,
                          SENTINEL alert, GHOST off, DIALOGUE thinking.
  2. Voice activity     — `voice_listening` pushes "surprised" for ~500ms
                          on wake, steady "thinking" while listening.
  3. Face X             — normalised (-1..1); tracking eyes dart to match.

State transitions are smoothed by `oled_animation_speed` (higher = faster).
"""
from __future__ import annotations

import asyncio
import logging
import math
import time
from dataclasses import dataclass, field
from typing import Any

from config import config

logger = logging.getLogger(__name__)


EyeState = str  # "idle" | "tracking" | "surprised" | "sleepy" | "thinking" | "alert" | "off"


VALID_EYE_STATES = frozenset({
    "idle", "tracking", "surprised", "sleepy", "thinking", "alert", "off",
})


# System state → default eye state mapping.
_STATE_TO_EYES: dict[str, EyeState] = {
    "SHADOW":   "sleepy",
    "FOCUS":    "tracking",
    "SENTINEL": "alert",
    "GHOST":    "off",
    "DREAM":    "sleepy",
    "DIALOGUE": "thinking",
}


@dataclass
class _Inputs:
    """Thread-unsafe view of the live inputs — mutated by `push_*` methods
    from anywhere in the app and read once per frame by the animator task."""
    system_state: str = "SHADOW"
    face_x: float = 0.0          # -1..1 (left..right); 0 = centre
    face_present: bool = False
    voice_listening: bool = False
    voice_speaking: bool = False
    # "surprised" pulse expiry — monotonic seconds.
    surprise_until: float = 0.0


@dataclass
class OledFrame:
    eye_state: EyeState
    eye_l: dict[str, float]      # {cx, cy, rx, ry, opacity}
    eye_r: dict[str, float]
    brightness: int              # 0-255 UI preview dimming
    ts_ms: int
    system_state: str = "SHADOW"
    mood: str = "idle"

    def to_dict(self) -> dict[str, Any]:
        return {
            "eye_state": self.eye_state,
            "eye_l": self.eye_l,
            "eye_r": self.eye_r,
            "brightness": self.brightness,
            "ts_ms": self.ts_ms,
            "system_state": self.system_state,
            "mood": self.mood,
        }


class OledAnimator:
    """Singleton — started from main.lifespan and stopped on shutdown."""

    def __init__(self) -> None:
        self._inputs = _Inputs()
        self._task: asyncio.Task[None] | None = None
        self._stop_evt = asyncio.Event()
        self._last_emit: OledFrame | None = None
        # Smoothed eye offset so head-pose tracking doesn't visibly jitter.
        self._smoothed_x: float = 0.0
        self._tick = 0

    # ── Input push API ────────────────────────────────────────────────────

    def set_system_state(self, state: str) -> None:
        self._inputs.system_state = state

    def set_face(self, present: bool, face_x: float = 0.0) -> None:
        # Clamp in case a caller feeds raw pixel deltas.
        self._inputs.face_present = present
        self._inputs.face_x = max(-1.0, min(1.0, float(face_x)))

    def pulse_surprised(self, duration_s: float = 0.6) -> None:
        self._inputs.surprise_until = time.monotonic() + duration_s

    def set_voice(self, listening: bool = False, speaking: bool = False) -> None:
        self._inputs.voice_listening = listening
        self._inputs.voice_speaking = speaking

    # ── Lifecycle ─────────────────────────────────────────────────────────

    async def start(self) -> None:
        if self._task is not None and not self._task.done():
            return
        self._stop_evt.clear()
        self._task = asyncio.create_task(self._run(), name="oled_animator")

    async def stop(self) -> None:
        self._stop_evt.set()
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass
            self._task = None

    # ── Main loop ─────────────────────────────────────────────────────────

    async def _run(self) -> None:
        # Imported lazily so tests can replace the hub without a monkeypatch
        # at module import time.
        from api.websocket_hub import hub

        while not self._stop_evt.is_set():
            hz = max(1, min(60, int(config.oled_frame_hz)))
            interval = 1.0 / hz
            try:
                frame = self.compute_frame()
                self._last_emit = frame
                if config.oled_animation_enabled:
                    await hub.broadcast("oled", "frame", frame.to_dict())
            except Exception as exc:
                logger.debug("oled animator tick error: %s", exc)
            await asyncio.sleep(interval)

    # ── Pure frame math (no I/O — unit-testable) ──────────────────────────

    def compute_frame(self) -> OledFrame:
        self._tick += 1
        now = time.monotonic()

        # 1) Default state from system state.
        eye_state = _STATE_TO_EYES.get(self._inputs.system_state, "idle")

        # 2) Voice overrides system default when talking or listening — the
        # eyes should visibly respond to speech even if state is SHADOW.
        if self._inputs.voice_listening or self._inputs.voice_speaking:
            eye_state = "thinking"

        # 3) Surprise pulse wins over both for its short window.
        if now < self._inputs.surprise_until:
            eye_state = "surprised"

        # GHOST is never overridable — privacy.
        if self._inputs.system_state == "GHOST":
            eye_state = "off"

        speed = max(0.1, min(3.0, float(config.oled_animation_speed)))
        # Smooth the pupil X offset; closer to 1.0 = snappier.
        alpha = min(1.0, 0.25 * speed)
        target_x = self._inputs.face_x if self._inputs.face_present else 0.0
        self._smoothed_x += (target_x - self._smoothed_x) * alpha

        brightness = max(0, min(255, int(config.oled_brightness)))
        frame = _render_eyes(
            eye_state,
            smoothed_x=self._smoothed_x,
            tick=self._tick,
            hz=max(1, min(60, int(config.oled_frame_hz))),
            brightness=brightness,
            system_state=self._inputs.system_state,
        )
        return frame


def _render_eyes(
    eye_state: EyeState,
    *,
    smoothed_x: float,
    tick: int,
    hz: int,
    brightness: int,
    system_state: str,
) -> OledFrame:
    """
    Pure function: eye_state + dynamics → frame. 100x56 virtual canvas
    (same aspect ratio as two SH1106 128x64 displays side-by-side).
    """
    # Breathing (subtle pulse) frequency in Hz.
    breath_hz = 0.2
    pulse = 0.5 + 0.5 * math.sin(2 * math.pi * breath_hz * tick / hz)

    # Shared params.
    base_rx, base_ry = 14.0, 14.0
    cy_base = 28.0
    cx_l, cx_r = 28.0, 72.0
    opacity = 1.0

    # eye_state-specific deformations.
    if eye_state == "off":
        return OledFrame(
            eye_state="off",
            eye_l={"cx": cx_l, "cy": cy_base, "rx": 0.0, "ry": 0.0, "opacity": 0.0},
            eye_r={"cx": cx_r, "cy": cy_base, "rx": 0.0, "ry": 0.0, "opacity": 0.0},
            brightness=0,
            ts_ms=int(time.time() * 1000),
            system_state=system_state,
            mood="off",
        )

    if eye_state == "sleepy":
        # Slits — eyes almost closed, drifting down.
        ry = 3.0 + 0.5 * pulse
        rx = 13.0
        cy = cy_base + 3.0
        opacity = 0.85
        mood = "sleepy"
    elif eye_state == "surprised":
        # Big round eyes.
        rx = 16.0
        ry = 16.0
        cy = cy_base - 1.0
        mood = "surprised"
    elif eye_state == "alert":
        # Narrow tall — fierce.
        rx = 11.0
        ry = 15.0
        cy = cy_base
        mood = "alert"
    elif eye_state == "thinking":
        # Asymmetric tilt — right eye raised like a questioning brow.
        rx = 13.0
        ry = 13.0
        cy = cy_base
        mood = "thinking"
    elif eye_state == "tracking":
        rx = base_rx
        ry = base_ry
        cy = cy_base
        mood = "tracking"
    else:  # idle
        rx = base_rx
        ry = base_ry - 1.0 + 0.8 * pulse
        cy = cy_base
        mood = "idle"

    # Pupil offset — tracking eyes move eyes toward face_x.
    dx = 0.0
    if eye_state in {"tracking", "surprised", "alert", "thinking"}:
        dx = 6.0 * smoothed_x

    eye_l = {
        "cx": cx_l + dx,
        "cy": cy + (1.0 if eye_state == "thinking" else 0.0),
        "rx": rx,
        "ry": ry,
        "opacity": opacity,
    }
    eye_r = {
        "cx": cx_r + dx,
        "cy": cy - (1.5 if eye_state == "thinking" else 0.0),
        "rx": rx,
        "ry": ry,
        "opacity": opacity,
    }
    return OledFrame(
        eye_state=eye_state,
        eye_l=eye_l,
        eye_r=eye_r,
        brightness=brightness,
        ts_ms=int(time.time() * 1000),
        system_state=system_state,
        mood=mood,
    )


# Singleton
oled_animator = OledAnimator()
