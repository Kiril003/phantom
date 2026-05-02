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

from ..long_running import LongRunningSpec
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
            sent = await cs.send_haptic(self.pattern, intensity=self.intensity)
        except Exception as exc:
            return ActionResult(
                ok=False, error=str(exc), error_class=type(exc).__name__, elapsed_ms=0,
            )
        if not sent:
            return ActionResult(
                ok=False, error="ESP32 serial writer not attached (device offline)",
                error_class="SerialDisconnected", elapsed_ms=0,
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
            sent = await cs.send_rgb(self.r, self.g, self.b, duration_ms=self.duration_ms)
        except Exception as exc:
            return ActionResult(
                ok=False, error=str(exc), error_class=type(exc).__name__, elapsed_ms=0,
            )
        if not sent:
            return ActionResult(
                ok=False, error="ESP32 serial writer not attached (device offline)",
                error_class="SerialDisconnected", elapsed_ms=0,
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
            sent = await cs.send_oled_text(self.text, duration_ms=self.duration_ms)
        except Exception as exc:
            return ActionResult(
                ok=False, error=str(exc), error_class=type(exc).__name__, elapsed_ms=0,
            )
        if not sent:
            return ActionResult(
                ok=False, error="ESP32 serial writer not attached (device offline)",
                error_class="SerialDisconnected", elapsed_ms=0,
            )
        return ActionResult(ok=True, output={"chars": len(self.text)}, side_effects=["oled"], elapsed_ms=0)


# ── Long-running headless apps ──────────────────────────────────────────────


class BlenderRun(Action):
    """Run Blender headless with a Python script — for "build a city" /
    procedural-modelling flows. Long-running by design; the loop will
    auto-shift the parent task to the background track when expected_duration
    is large.
    """

    name: ClassVar[str] = "blender.run"
    risk_level: ClassVar[RiskLevel] = RiskLevel.LOW
    reversible: ClassVar[bool] = False

    script_path: str = Field(min_length=1)
    blend_path: str | None = Field(default=None, description="optional .blend to open")
    output_path: str | None = Field(default=None, description="optional render output")
    timeout_s: int = Field(default=1800, ge=10, le=86400)
    args: list[str] = Field(default_factory=list)

    def long_running_spec(self) -> LongRunningSpec | None:
        # Anything bigger than ~5 min — promote so the operator UI is freed.
        # Smaller cube-test scripts stay foreground (cheap to wait through).
        if int(self.timeout_s) <= 300:
            return None
        return LongRunningSpec(
            estimated_duration_s=int(self.timeout_s),
            progress_checkpoint_interval_s=60,
            label="Blender headless render",
        )

    async def execute(self, ctx: ActionContext) -> ActionResult:
        import asyncio
        import shutil
        import time
        if shutil.which("blender") is None:
            return ActionResult(
                ok=False, error="blender binary not in PATH (install blender)",
                error_class="BinaryMissing", elapsed_ms=0,
            )
        cmd = ["blender", "--background"]
        if self.blend_path:
            cmd.append(self.blend_path)
        cmd += ["--python", self.script_path]
        if self.output_path:
            cmd += ["--render-output", self.output_path]
        cmd += list(self.args)
        t0 = time.monotonic()
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            try:
                stdout, stderr = await asyncio.wait_for(
                    proc.communicate(), timeout=self.timeout_s,
                )
            except asyncio.TimeoutError:
                with __import__("contextlib").suppress(Exception):
                    proc.kill()
                return ActionResult(
                    ok=False, error="blender timed out",
                    error_class="TimeoutError",
                    elapsed_ms=int((time.monotonic() - t0) * 1000),
                )
            elapsed = int((time.monotonic() - t0) * 1000)
            if proc.returncode != 0:
                return ActionResult(
                    ok=False,
                    error=(stderr or b"").decode(errors="replace")[:600],
                    error_class="BlenderNonZeroExit",
                    output={"returncode": proc.returncode, "stdout_tail": (stdout or b"")[-400:].decode(errors="replace")},
                    elapsed_ms=elapsed,
                )
            return ActionResult(
                ok=True,
                output={
                    "returncode": 0,
                    "stdout_tail": (stdout or b"")[-400:].decode(errors="replace"),
                    "output_path": self.output_path,
                },
                elapsed_ms=elapsed,
                side_effects=["blender_render"],
            )
        except FileNotFoundError as exc:
            return ActionResult(
                ok=False, error=str(exc), error_class="BinaryMissing", elapsed_ms=0,
            )


class GameInputBurst(Action):
    """High-frequency input sequence — for playing games on the operator's
    behalf. Each step is one of:
      {"kind": "click", "x": int, "y": int, "button"?: "left"|"right"}
      {"kind": "key", "key": str}        # single key (xdotool/ydotool keysym)
      {"kind": "combo", "keys": [str]}    # like ['ctrl', 'shift', 'k']
      {"kind": "type", "text": str}
      {"kind": "wait", "ms": int}
      {"kind": "move", "x": int, "y": int}

    `ms_between` is the default delay between steps that don't carry
    their own timing.
    """

    name: ClassVar[str] = "screen.game_burst"
    risk_level: ClassVar[RiskLevel] = RiskLevel.LOW
    reversible: ClassVar[bool] = False

    steps: list[dict] = Field(min_length=1)
    ms_between: int = Field(default=40, ge=0, le=5000)

    async def execute(self, ctx: ActionContext) -> ActionResult:
        import asyncio
        import time
        from input import desktop_control as dc
        applied: list[dict] = []
        t0 = time.monotonic()
        for step in self.steps:
            try:
                kind = (step.get("kind") or "").lower()
                if kind == "click":
                    await dc.click(int(step["x"]), int(step["y"]),
                                   button=str(step.get("button") or "left"))
                elif kind == "double_click":
                    await dc.double_click(int(step["x"]), int(step["y"]),
                                          button=str(step.get("button") or "left"))
                elif kind == "key":
                    await dc.key_combo([str(step["key"])])
                elif kind == "combo":
                    await dc.key_combo([str(k) for k in (step.get("keys") or [])])
                elif kind == "type":
                    await dc.type_text(str(step.get("text") or ""))
                elif kind == "move":
                    await dc.move(int(step["x"]), int(step["y"]))
                elif kind == "wait":
                    await asyncio.sleep(int(step.get("ms") or 0) / 1000.0)
                else:
                    return ActionResult(
                        ok=False, error=f"unknown game-burst kind: {kind!r}",
                        error_class="ValueError",
                        elapsed_ms=int((time.monotonic() - t0) * 1000),
                    )
                applied.append({"kind": kind})
                if self.ms_between and kind != "wait":
                    await asyncio.sleep(self.ms_between / 1000.0)
            except dc.ControlBackendError as exc:
                return ActionResult(
                    ok=False, error=str(exc), error_class="ControlBackendError",
                    output={"applied": applied},
                    elapsed_ms=int((time.monotonic() - t0) * 1000),
                )
            except Exception as exc:
                return ActionResult(
                    ok=False, error=str(exc), error_class=type(exc).__name__,
                    output={"applied": applied},
                    elapsed_ms=int((time.monotonic() - t0) * 1000),
                )
        return ActionResult(
            ok=True,
            output={"applied": applied, "step_count": len(applied)},
            elapsed_ms=int((time.monotonic() - t0) * 1000),
            side_effects=["game_input"],
        )


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
    "BlenderRun",
    "GameInputBurst",
]
