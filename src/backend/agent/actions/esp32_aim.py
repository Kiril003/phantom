"""esp32.servo_aim + esp32.buzzer_alert — Phase 23-C.

Phase 18 added agent actions for the ESP32's haptic motor, RGB LED,
and OLED text. The servo (pan / tilt) and buzzer (PWM tone)
handlers were wired in firmware + ``sensors.command_sender`` but
remained operator-only — accessed by hand via ``command_sender.servo``
or ``command_sender.buzzer`` rather than as planner-visible actions.

Phase 23-C surfaces both as agent actions so the planner can request
"look at the operator" or "alert chime when timer ends" the same way
it requests ``notify.desktop`` or ``vision.see_screen``.

Scope decisions (see `~/.claude/plans/vast-marinating-scone.md`):

* **Servo deltas only.** Firmware tracks pan/tilt state but does NOT
  echo it back over serial, so absolute positioning would require a
  firmware extension. We accept incremental deltas (matches the
  firmware contract) and document the limitation in the docstring.
* **Buzzer patterns are Python-side.** Firmware exposes a single
  ``tone(freq, duration_ms)`` primitive. We sequence multiple buzzer
  commands from the Radxa side to produce chirp / ack / alert / siren
  patterns — no firmware change needed.
* **No motor_pulse action.** The vibration motor on GPIO21 is
  already exposed via the existing ``ESP32Haptic`` action; adding a
  dedicated motor action would just shadow it.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import ClassVar, Literal

from pydantic import Field

from ..schemas import ActionResult, RiskLevel
from .base import Action, ActionContext

logger = logging.getLogger(__name__)


# ── Servo ────────────────────────────────────────────────────────────────────


class ESP32ServoAim(Action):
    """Pan / tilt the ESP32 servo by an incremental delta."""

    name: ClassVar[str] = "esp32.servo_aim"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE
    requires_consent: ClassVar[bool] = False
    reversible: ClassVar[bool] = True  # send the inverse delta to undo

    pan_delta: int = Field(
        default=0, ge=-90, le=90,
        description=(
            "Degrees to pan (negative = left, positive = right). "
            "Firmware clamps the resulting absolute pan to [0, 180]."
        ),
    )
    tilt_delta: int = Field(
        default=0, ge=-60, le=60,
        description=(
            "Degrees to tilt (negative = down, positive = up). "
            "Firmware clamps the resulting absolute tilt to [30, 150]."
        ),
    )
    hold_ms: int = Field(
        default=0, ge=0, le=5000,
        description=(
            "Optional pause after the move so a follow-up capture / OCR "
            "sees the new viewpoint settled. 0 = return immediately."
        ),
    )

    async def execute(self, ctx: ActionContext) -> ActionResult:
        t0 = time.monotonic()

        if self.pan_delta == 0 and self.tilt_delta == 0:
            return ActionResult(
                ok=False,
                output={
                    "reason": "no_delta",
                    "hint": "at least one of pan_delta / tilt_delta must be non-zero",
                },
                error="zero-zero servo move is a no-op",
                error_class="BadArgs",
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        from sensors import command_sender as cs

        if not hasattr(cs, "command_sender") or not hasattr(cs.command_sender, "servo"):
            return ActionResult(
                ok=False,
                error="ESP32 servo API not wired",
                error_class="NotImplemented",
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        try:
            sent = await cs.command_sender.servo(self.pan_delta, self.tilt_delta)
        except Exception as exc:
            logger.warning("servo_aim failed: %s", exc)
            return ActionResult(
                ok=False,
                error=str(exc),
                error_class=type(exc).__name__,
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        if not sent:
            return ActionResult(
                ok=False,
                output={"reason": "serial_disconnected"},
                error="ESP32 serial writer not attached (device offline)",
                error_class="SerialDisconnected",
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        if self.hold_ms > 0:
            await asyncio.sleep(self.hold_ms / 1000)

        pan_sign = "+" if self.pan_delta >= 0 else ""
        tilt_sign = "+" if self.tilt_delta >= 0 else ""
        return ActionResult(
            ok=True,
            output={
                "pan_delta": self.pan_delta,
                "tilt_delta": self.tilt_delta,
                "hold_ms": self.hold_ms,
            },
            side_effects=[
                f"servo: pan{pan_sign}{self.pan_delta}° tilt{tilt_sign}{self.tilt_delta}°"
            ],
            elapsed_ms=int((time.monotonic() - t0) * 1000),
        )


# ── Buzzer ───────────────────────────────────────────────────────────────────


# Each entry is a list of (freq_hz, duration_ms, pause_ms) tuples that
# play one pattern. ``freq_hz=None`` means "use the action's freq_hz
# argument" (so chirp / ack / alert can be re-tuned by the caller while
# siren stays a sweep on its own freq schedule).
_BUZZER_PATTERNS: dict[str, list[tuple[int | None, int, int]]] = {
    "chirp":  [(None, 120, 0)],
    "ack":    [(None,  80, 60), (None, 80, 0)],
    "alert":  [(None, 150, 100), (None, 150, 100), (None, 150, 0)],
    "siren":  [(800, 200, 0), (1200, 200, 0), (800, 200, 0)],
}


class ESP32BuzzerAlert(Action):
    """Play a Python-sequenced pattern on the ESP32 buzzer."""

    name: ClassVar[str] = "esp32.buzzer_alert"
    # LOW because it produces audible output the operator's environment
    # may not expect (someone else could overhear). Mirrors voice.say.
    risk_level: ClassVar[RiskLevel] = RiskLevel.LOW
    requires_consent: ClassVar[bool] = False
    reversible: ClassVar[bool] = False  # sound has already left the room

    pattern: Literal["chirp", "ack", "alert", "siren"] = Field(
        default="chirp",
        description=(
            "Named pattern. chirp=single beep, ack=two short, alert=three "
            "longer, siren=800→1200→800 Hz sweep."
        ),
    )
    freq_hz: int = Field(
        default=1000, ge=200, le=4000,
        description=(
            "Base frequency for patterns that use a single tone (chirp, "
            "ack, alert). Ignored by siren (it has its own sweep)."
        ),
    )
    repeat: int = Field(
        default=1, ge=1, le=5,
        description="How many times to play the pattern back-to-back.",
    )

    async def execute(self, ctx: ActionContext) -> ActionResult:
        t0 = time.monotonic()

        from sensors import command_sender as cs

        if not hasattr(cs, "command_sender") or not hasattr(cs.command_sender, "buzzer"):
            return ActionResult(
                ok=False,
                error="ESP32 buzzer API not wired",
                error_class="NotImplemented",
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        steps = _BUZZER_PATTERNS[self.pattern]
        total_ms = 0

        for _ in range(self.repeat):
            for freq, ms, pause_ms in steps:
                actual_freq = freq if freq is not None else self.freq_hz
                try:
                    sent = await cs.command_sender.buzzer(
                        freq_hz=actual_freq, duration_ms=ms,
                    )
                except Exception as exc:
                    logger.warning("buzzer_alert failed: %s", exc)
                    return ActionResult(
                        ok=False,
                        error=str(exc),
                        error_class=type(exc).__name__,
                        elapsed_ms=int((time.monotonic() - t0) * 1000),
                    )
                if not sent:
                    return ActionResult(
                        ok=False,
                        output={"reason": "serial_disconnected"},
                        error="ESP32 serial writer not attached (device offline)",
                        error_class="SerialDisconnected",
                        elapsed_ms=int((time.monotonic() - t0) * 1000),
                    )
                # Serialize on the Radxa side: firmware tone() is non-blocking,
                # so back-to-back commands would clobber each other.
                await asyncio.sleep((ms + pause_ms) / 1000)
                total_ms += ms + pause_ms

        return ActionResult(
            ok=True,
            output={
                "pattern": self.pattern,
                "repeat": self.repeat,
                "freq_hz": self.freq_hz,
                "total_ms": total_ms,
            },
            side_effects=[f"buzzer: {self.pattern} ×{self.repeat}"],
            elapsed_ms=int((time.monotonic() - t0) * 1000),
        )
