"""vision.see_screen — agent-initiated visual context.

Phase 23-B: until now the agent could not look at anything by its own
choice. Phase 18 shipped ``ScreenCapture`` (returns raw PNG bytes for
the operator) and Phase 18-COMPLETE shipped ``ScreenOCR`` (text
extraction), but neither produces a *describing* observation the
planner can reason over. ``vision.see_screen`` closes that gap by
piping a fresh screen capture through Gemini's multimodal endpoint
and returning a structured JSON description::

    {
      "summary": "operator looking at the Settings panel; Voice
                  category is open",
      "people_present": ["operator (centre, looking at screen)"],
      "objects": ["browser window", "clock", "status bar"],
      "lighting": "daylight, indoor",
      "notable_text": ["Voice", "STT mode"]
    }

The action is deliberately scoped to **screen** capture (which the
backend already implements). A future ``vision.see_camera`` will land
once a camera-frame pipeline exists; we don't ship a stub for it.

Quietness contract:
* SAFE risk — purely observational, no side effects.
* Requires Gemini API key (``ai_gemini_api_key``). Without it we fail
  fast with ``ok=False, reason=no_api_key`` so the planner can pick a
  different approach instead of waiting for a confused error.
* Requires a working screen-capture backend on the host. ``ScreenFrame``
  errors propagate as ``ok=False, reason=capture_failed``.
"""
from __future__ import annotations

import base64
import json
import logging
import time
from typing import Any, ClassVar

from pydantic import Field

from ..schemas import ActionResult, RiskLevel
from .base import Action, ActionContext

logger = logging.getLogger(__name__)


# Default focus question used when the caller doesn't supply one. Keeps
# the response stable / cacheable across "default" calls; a custom
# `focus` widens or narrows the description for a specific subgoal
# (e.g. "are there hands visible on the keyboard?" or "what time does
# the clock in the corner show?").
_DEFAULT_FOCUS = (
    "Describe what is currently on the screen so an autonomous agent "
    "can decide its next action. Identify any people visible (position, "
    "what they appear to be doing), salient UI elements, on-screen "
    "text fragments worth surfacing, lighting / ambient cues, and "
    "anything unexpected."
)


# JSON schema we ask Gemini to fill. Kept to flat keys so tests + the
# planner can rely on field shape without recursing.
_RESPONSE_SCHEMA_HINT = (
    'Respond with a single JSON object. Required keys: '
    '"summary" (1-2 sentence string), '
    '"people_present" (array of short strings, may be empty), '
    '"objects" (array of short strings), '
    '"lighting" (single short string), '
    '"notable_text" (array of short strings, OCR-style highlights). '
    "Do not wrap the JSON in markdown fences."
)


async def _call_gemini_vision(
    image_bytes: bytes,
    prompt: str,
    *,
    model: str,
    api_key: str,
) -> dict[str, Any]:
    """Single-call Gemini vision wrapper.

    Kept as a module-level function (not a method) so tests can
    monkeypatch ``agent.actions.vision._call_gemini_vision`` without
    needing to import the SDK or hit the real network.
    """
    # Lazy import — environments without google-genai installed (CI for
    # text-only tests, dev workstations) never pay the import cost.
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=api_key)

    image_part = types.Part.from_bytes(data=image_bytes, mime_type="image/png")
    text_part = types.Part.from_text(text=prompt)

    response = await client.aio.models.generate_content(
        model=model,
        contents=[types.Content(role="user", parts=[image_part, text_part])],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            temperature=0.2,
        ),
    )
    raw = (response.text or "").strip()
    if not raw:
        return {
            "summary": "",
            "people_present": [],
            "objects": [],
            "lighting": "",
            "notable_text": [],
        }
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        logger.warning("vision: Gemini returned invalid JSON: %s", exc)
        return {
            "summary": raw[:240],
            "people_present": [],
            "objects": [],
            "lighting": "",
            "notable_text": [],
        }
    if not isinstance(parsed, dict):
        return {
            "summary": str(parsed)[:240],
            "people_present": [],
            "objects": [],
            "lighting": "",
            "notable_text": [],
        }
    # Normalise so the planner gets a stable shape.
    return {
        "summary": str(parsed.get("summary", "")),
        "people_present": [str(x) for x in parsed.get("people_present", []) if x],
        "objects": [str(x) for x in parsed.get("objects", []) if x],
        "lighting": str(parsed.get("lighting", "")),
        "notable_text": [str(x) for x in parsed.get("notable_text", []) if x],
    }


class SeeScreen(Action):
    """Capture the current screen and describe it via Gemini vision."""

    name: ClassVar[str] = "vision.see_screen"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE
    requires_consent: ClassVar[bool] = False
    reversible: ClassVar[bool] = True  # observational

    # Block B — resource declarations.
    estimated_peak_ram_mb: ClassVar[int] = 600
    requires_network: ClassVar[bool] = True
    estimated_wall_seconds: ClassVar[int] = 15

    focus: str = Field(
        default="",
        description=(
            "Optional focus question. Empty uses the default 'describe "
            "everything an autonomous agent should know' prompt; otherwise "
            "the prompt narrows to this question."
        ),
    )
    region: tuple[int, int, int, int] | None = Field(
        default=None,
        description=(
            "Optional capture region as (x, y, width, height). None = "
            "full primary display."
        ),
    )
    include_image_b64: bool = Field(
        default=False,
        description=(
            "If True, return the captured PNG as base64 alongside the "
            "description so an operator-facing UI can display it. "
            "Defaults to False to keep observations small in the agent "
            "context window."
        ),
    )

    async def execute(self, ctx: ActionContext) -> ActionResult:
        t0 = time.monotonic()

        # --- credentials gate -------------------------------------------------
        from config import config as cfg

        api_key = (cfg.ai_gemini_api_key or "").strip()
        model = (cfg.ai_gemini_model or "").strip()
        if not api_key:
            return ActionResult(
                ok=False,
                output={
                    "reason": "no_api_key",
                    "hint": (
                        "vision.see_screen needs ai_gemini_api_key set in "
                        "settings — only Gemini supports vision so far."
                    ),
                },
                side_effects=[],
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )
        if not model:
            return ActionResult(
                ok=False,
                output={"reason": "no_model", "hint": "ai_gemini_model is empty"},
                side_effects=[],
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        # --- capture ----------------------------------------------------------
        try:
            from vision.screen_capture import (
                ScreenCaptureError,
                ScreenFrame,
                capture as screen_capture,
            )
            frame = await screen_capture(region=self.region)
        except Exception as exc:
            logger.warning("vision: screen capture import/run failed: %s", exc)
            return ActionResult(
                ok=False,
                output={"reason": "capture_failed", "error": str(exc)},
                side_effects=[],
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        if isinstance(frame, ScreenCaptureError):
            return ActionResult(
                ok=False,
                output={
                    "reason": "capture_failed",
                    "error": frame.error,
                    "tried": frame.tried,
                },
                side_effects=[],
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )
        # Defensive: future ScreenFrame variants we don't recognise.
        if not isinstance(frame, ScreenFrame):
            return ActionResult(
                ok=False,
                output={"reason": "capture_unknown_type"},
                side_effects=[],
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        # --- prompt + vision call --------------------------------------------
        focus_question = self.focus.strip() or _DEFAULT_FOCUS
        prompt = f"{focus_question}\n\n{_RESPONSE_SCHEMA_HINT}"

        try:
            description = await _call_gemini_vision(
                frame.png_bytes, prompt, model=model, api_key=api_key,
            )
        except Exception as exc:
            logger.warning("vision: Gemini call failed: %s", exc)
            return ActionResult(
                ok=False,
                output={"reason": "vision_call_failed", "error": str(exc)},
                side_effects=[],
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        out: dict[str, Any] = {
            "description": description,
            "frame": {
                "width": frame.width,
                "height": frame.height,
                "strategy": frame.strategy,
                "captured_at": frame.captured_at,
            },
            "model": model,
        }
        if self.include_image_b64:
            out["image_b64"] = base64.b64encode(frame.png_bytes).decode("ascii")
            out["image_mime"] = "image/png"

        # Side-effect line summarises the perception for the audit log.
        side = (description.get("summary") or "").strip()
        side = side[:120] + ("…" if len(side) > 120 else "")
        side_effects = [f"saw screen: {side}"] if side else ["saw screen (empty summary)"]

        return ActionResult(
            ok=True,
            output=out,
            side_effects=side_effects,
            elapsed_ms=int((time.monotonic() - t0) * 1000),
        )


class SeeCamera(Action):
    """Capture a frame from the physical camera and describe it via Gemini.

    Day-NN — closes the audit-flagged Level-4 gap: until now agent
    vision was limited to the desktop screen. `vision.see_camera`
    grabs a single PNG frame off the host USB/MIPI camera (OpenCV
    backend) and runs it through the same multimodal pipeline as
    `vision.see_screen`, returning the same `{summary, people_present,
    objects, lighting, notable_text}` shape.

    Privacy contract is the same as the rest of the camera surface:
    capture is on-demand and one-shot — we never hold the camera
    between calls, so the operator's video apps + the face-tracking
    pipeline keep working.
    """

    name: ClassVar[str] = "vision.see_camera"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE
    requires_consent: ClassVar[bool] = False
    reversible: ClassVar[bool] = True  # observational

    # Block B — resource declarations.
    estimated_peak_ram_mb: ClassVar[int] = 600
    requires_network: ClassVar[bool] = True
    estimated_wall_seconds: ClassVar[int] = 15

    focus: str = Field(
        default="",
        description=(
            "Optional focus question. Empty uses the default "
            "'describe-everything' prompt; otherwise narrows the "
            "description to this question (e.g. 'who is in frame?')."
        ),
    )
    device_index: int = Field(
        default=0,
        ge=0,
        le=9,
        description=(
            "Camera device index (0 = default webcam). Bump to 1+ if "
            "the host has multiple cameras and you want a specific one."
        ),
    )
    warmup_frames: int = Field(
        default=3,
        ge=1,
        le=10,
        description=(
            "How many frames to read before keeping one — most webcams "
            "ship a black/auto-exposure-adjusting frame or two right "
            "after open(). Three is the safe default."
        ),
    )
    include_image_b64: bool = Field(
        default=False,
        description=(
            "If True, return the captured PNG as base64 alongside the "
            "description so an operator-facing UI can display it."
        ),
    )

    async def execute(self, ctx: ActionContext) -> ActionResult:
        t0 = time.monotonic()

        # --- credentials gate -------------------------------------------------
        from config import config as cfg

        api_key = (cfg.ai_gemini_api_key or "").strip()
        model = (cfg.ai_gemini_model or "").strip()
        if not api_key:
            return ActionResult(
                ok=False,
                output={
                    "reason": "no_api_key",
                    "hint": (
                        "vision.see_camera needs ai_gemini_api_key set in "
                        "settings — only Gemini supports vision so far."
                    ),
                },
                side_effects=[],
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )
        if not model:
            return ActionResult(
                ok=False,
                output={"reason": "no_model", "hint": "ai_gemini_model is empty"},
                side_effects=[],
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        # --- camera capture ---------------------------------------------------
        try:
            from vision.camera_capture import (
                CameraCaptureError,
                CameraFrame,
                capture as camera_capture,
            )
            frame = await camera_capture(
                device_index=self.device_index,
                warmup_frames=self.warmup_frames,
            )
        except Exception as exc:
            logger.warning("vision: camera capture import/run failed: %s", exc)
            return ActionResult(
                ok=False,
                output={"reason": "capture_failed", "error": str(exc)},
                side_effects=[],
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        if isinstance(frame, CameraCaptureError):
            return ActionResult(
                ok=False,
                output={
                    "reason": "capture_failed",
                    "error": frame.error,
                    "tried": frame.tried,
                },
                side_effects=[],
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )
        if not isinstance(frame, CameraFrame):
            return ActionResult(
                ok=False,
                output={"reason": "capture_unknown_type"},
                side_effects=[],
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        # --- prompt + vision call --------------------------------------------
        focus_question = self.focus.strip() or _DEFAULT_FOCUS
        prompt = f"{focus_question}\n\n{_RESPONSE_SCHEMA_HINT}"

        try:
            description = await _call_gemini_vision(
                frame.png_bytes, prompt, model=model, api_key=api_key,
            )
        except Exception as exc:
            logger.warning("vision: Gemini call failed (camera): %s", exc)
            return ActionResult(
                ok=False,
                output={"reason": "vision_call_failed", "error": str(exc)},
                side_effects=[],
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        out: dict[str, Any] = {
            "description": description,
            "frame": {
                "width": frame.width,
                "height": frame.height,
                "strategy": frame.strategy,
                "captured_at": frame.captured_at,
            },
            "model": model,
            "source": "camera",
        }
        if self.include_image_b64:
            out["image_b64"] = base64.b64encode(frame.png_bytes).decode("ascii")
            out["image_mime"] = "image/png"

        side = (description.get("summary") or "").strip()
        side = side[:120] + ("…" if len(side) > 120 else "")
        side_effects = [f"saw camera: {side}"] if side else ["saw camera (empty summary)"]

        return ActionResult(
            ok=True,
            output=out,
            side_effects=side_effects,
            elapsed_ms=int((time.monotonic() - t0) * 1000),
        )
