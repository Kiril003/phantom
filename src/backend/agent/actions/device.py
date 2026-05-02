"""
Phase 18 — Device-control actions.

Wraps `vision.screen_capture`, `vision.screen_ocr` (when available), and
`input.desktop_control` into the Action interface so the agent loop can
plan and execute screen-driven steps.

Every action is offline-safe: if the underlying backend is missing we
return an ActionResult.error with a clear hint rather than crashing.

Risk levels:
  - ScreenCapture / ScreenOCR / WindowFocus: SAFE
  - ScreenClick / ScreenType / ScreenKeyCombo / ScreenScroll: LOW
    (reversible-ish but they touch the user's session — flagged for
    Council review on automated runs).
"""
from __future__ import annotations

import base64
import logging
from typing import Any, ClassVar

from pydantic import Field

from ..schemas import ActionResult, Precondition, RiskLevel
from .base import Action, ActionContext

logger = logging.getLogger(__name__)


# ── Screen capture / OCR ────────────────────────────────────────────────────


class ScreenCapture(Action):
    name: ClassVar[str] = "screen.capture"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE
    reversible: ClassVar[bool] = True

    region: list[int] | None = Field(default=None, description="[x, y, w, h] in pixels")
    return_base64: bool = Field(default=True)

    async def execute(self, ctx: ActionContext) -> ActionResult:
        from vision import screen_capture as sc
        region = None
        if self.region and len(self.region) == 4:
            region = (
                int(self.region[0]),
                int(self.region[1]),
                int(self.region[2]),
                int(self.region[3]),
            )
        res = await sc.capture(region=region)
        if isinstance(res, sc.ScreenCaptureError):
            return ActionResult(
                ok=False,
                error=res.error,
                error_class="ScreenCaptureError",
                output={"tried": res.tried},
                elapsed_ms=0,
            )
        out: dict[str, Any] = {
            "width": res.width,
            "height": res.height,
            "strategy": res.strategy,
            "captured_at": res.captured_at,
            "size_bytes": len(res.png_bytes),
        }
        if self.return_base64:
            out["png_base64"] = base64.b64encode(res.png_bytes).decode("ascii")
        return ActionResult(ok=True, output=out, elapsed_ms=0, sandboxed=True)


class ScreenOCR(Action):
    name: ClassVar[str] = "screen.ocr"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE
    reversible: ClassVar[bool] = True

    region: list[int] | None = Field(default=None)
    languages: str = Field(default="ukr+eng", description="Tesseract -l value")
    min_confidence: float = Field(default=30.0, ge=0.0, le=100.0)

    async def execute(self, ctx: ActionContext) -> ActionResult:
        try:
            from vision import screen_ocr as ocr
        except Exception as exc:
            return ActionResult(
                ok=False, error=f"screen_ocr unavailable: {exc}",
                error_class="ImportError", elapsed_ms=0,
            )
        region = None
        if self.region and len(self.region) == 4:
            region = tuple(int(v) for v in self.region)  # type: ignore[assignment]
        result = await ocr.ocr_screen(
            region=region,  # type: ignore[arg-type]
            languages=self.languages,
            min_confidence=self.min_confidence,
        )
        if isinstance(result, ocr.OCRError):
            return ActionResult(
                ok=False, error=result.error,
                error_class="OCRError",
                output={"tried": result.tried},
                elapsed_ms=0,
            )
        return ActionResult(
            ok=True,
            output={
                "lines": [w.__dict__ for w in result.words],
                "image_width": result.width,
                "image_height": result.height,
                "languages": result.languages,
            },
            elapsed_ms=0,
        )


# ── Desktop input ───────────────────────────────────────────────────────────


class ScreenClick(Action):
    name: ClassVar[str] = "screen.click"
    risk_level: ClassVar[RiskLevel] = RiskLevel.LOW
    reversible: ClassVar[bool] = False
    requires_consent: ClassVar[bool] = False

    x: int
    y: int
    button: str = Field(default="left", pattern=r"^(left|middle|right)$")
    double: bool = False

    async def execute(self, ctx: ActionContext) -> ActionResult:
        from input import desktop_control as dc
        try:
            if self.double:
                ok = await dc.double_click(self.x, self.y, button=self.button)
            else:
                ok = await dc.click(self.x, self.y, button=self.button)
        except dc.ControlBackendError as exc:
            return ActionResult(
                ok=False, error=str(exc), error_class="ControlBackendError", elapsed_ms=0,
            )
        return ActionResult(
            ok=bool(ok),
            output={"x": self.x, "y": self.y, "button": self.button, "double": self.double},
            side_effects=["mouse_click"],
            elapsed_ms=0,
        )


class ScreenType(Action):
    name: ClassVar[str] = "screen.type"
    risk_level: ClassVar[RiskLevel] = RiskLevel.LOW
    reversible: ClassVar[bool] = False

    text: str
    delay_ms: int = Field(default=12, ge=0, le=500)

    async def execute(self, ctx: ActionContext) -> ActionResult:
        from input import desktop_control as dc
        try:
            ok = await dc.type_text(self.text, delay_ms=self.delay_ms)
        except dc.ControlBackendError as exc:
            return ActionResult(
                ok=False, error=str(exc), error_class="ControlBackendError", elapsed_ms=0,
            )
        return ActionResult(
            ok=bool(ok),
            output={"chars": len(self.text)},
            side_effects=["keystrokes"],
            elapsed_ms=0,
        )


class ScreenKeyCombo(Action):
    name: ClassVar[str] = "screen.key_combo"
    risk_level: ClassVar[RiskLevel] = RiskLevel.LOW
    reversible: ClassVar[bool] = False

    keys: list[str]

    async def execute(self, ctx: ActionContext) -> ActionResult:
        from input import desktop_control as dc
        try:
            ok = await dc.key_combo(self.keys)
        except dc.ControlBackendError as exc:
            return ActionResult(
                ok=False, error=str(exc), error_class="ControlBackendError", elapsed_ms=0,
            )
        return ActionResult(
            ok=bool(ok),
            output={"keys": list(self.keys)},
            side_effects=["keystrokes"],
            elapsed_ms=0,
        )


class ScreenScroll(Action):
    name: ClassVar[str] = "screen.scroll"
    risk_level: ClassVar[RiskLevel] = RiskLevel.LOW
    reversible: ClassVar[bool] = True

    direction: str = Field(default="down", pattern=r"^(up|down|left|right)$")
    ticks: int = Field(default=3, ge=1, le=50)

    async def execute(self, ctx: ActionContext) -> ActionResult:
        from input import desktop_control as dc
        try:
            ok = await dc.scroll(self.direction, self.ticks)
        except dc.ControlBackendError as exc:
            return ActionResult(
                ok=False, error=str(exc), error_class="ControlBackendError", elapsed_ms=0,
            )
        return ActionResult(
            ok=bool(ok),
            output={"direction": self.direction, "ticks": self.ticks},
            side_effects=["scroll"],
            elapsed_ms=0,
        )


# ── ESP32 actuator wrappers (Phase 18 partial — uses sensors.command_sender) ──


class ESP32Haptic(Action):
    name: ClassVar[str] = "esp32.haptic"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE

    pattern: str = Field(default="short", pattern=r"^(short|long|double|triple|pulse)$")
    intensity: int = Field(default=120, ge=0, le=255)

    async def execute(self, ctx: ActionContext) -> ActionResult:
        from sensors import command_sender as cs
        if not hasattr(cs, "send_haptic"):
            return ActionResult(
                ok=False, error="ESP32 haptic API not wired", error_class="NotImplemented",
                elapsed_ms=0,
            )
        try:
            await cs.send_haptic(self.pattern, intensity=self.intensity)
        except Exception as exc:
            return ActionResult(
                ok=False, error=str(exc), error_class=type(exc).__name__, elapsed_ms=0,
            )
        return ActionResult(ok=True, output={"pattern": self.pattern}, side_effects=["haptic"], elapsed_ms=0)


class ESP32RGB(Action):
    name: ClassVar[str] = "esp32.rgb"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE

    r: int = Field(ge=0, le=255)
    g: int = Field(ge=0, le=255)
    b: int = Field(ge=0, le=255)
    duration_ms: int = Field(default=400, ge=0, le=60000)

    async def execute(self, ctx: ActionContext) -> ActionResult:
        from sensors import command_sender as cs
        if not hasattr(cs, "send_rgb"):
            return ActionResult(
                ok=False, error="ESP32 RGB API not wired", error_class="NotImplemented",
                elapsed_ms=0,
            )
        try:
            await cs.send_rgb(self.r, self.g, self.b, duration_ms=self.duration_ms)
        except Exception as exc:
            return ActionResult(
                ok=False, error=str(exc), error_class=type(exc).__name__, elapsed_ms=0,
            )
        return ActionResult(
            ok=True, output={"rgb": [self.r, self.g, self.b]},
            side_effects=["rgb"], elapsed_ms=0,
        )


class ESP32OLEDText(Action):
    name: ClassVar[str] = "esp32.oled_text"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE

    text: str = Field(min_length=1, max_length=256)
    duration_ms: int = Field(default=2000, ge=0, le=60000)

    async def execute(self, ctx: ActionContext) -> ActionResult:
        from sensors import command_sender as cs
        if not hasattr(cs, "send_oled_text"):
            return ActionResult(
                ok=False, error="ESP32 OLED API not wired", error_class="NotImplemented",
                elapsed_ms=0,
            )
        try:
            await cs.send_oled_text(self.text, duration_ms=self.duration_ms)
        except Exception as exc:
            return ActionResult(
                ok=False, error=str(exc), error_class=type(exc).__name__, elapsed_ms=0,
            )
        return ActionResult(ok=True, output={"chars": len(self.text)}, side_effects=["oled"], elapsed_ms=0)


__all__ = [
    "ScreenCapture",
    "ScreenOCR",
    "ScreenClick",
    "ScreenType",
    "ScreenKeyCombo",
    "ScreenScroll",
    "ESP32Haptic",
    "ESP32RGB",
    "ESP32OLEDText",
]
