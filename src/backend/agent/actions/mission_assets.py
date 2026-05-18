"""
Vertical V10 — mission.snapshot action.

Lets the agent capture a visual snapshot at any moment during a mission and
attach it to the active phase section of the ledger.

Sources:
  screen   — uses vision.screen_capture (same backend as SeeScreen)
  camera   — uses vision.camera_capture (same backend as SeeCamera)
  blender  — reads a PNG produced by BlenderRun at file_path
  file     — reads any PNG from an explicit file_path

If describe=True (default), pipes the PNG through Gemini multimodal to get
a one-sentence caption. Caption is embedded in the ledger bullet.

Requires ctx.runtime AND ctx.runtime.foreground_slot.mission_id to be set.
Returns ok=False, reason="no_active_mission" when called outside a mission.
"""
from __future__ import annotations

import base64
import logging
import os
import time
from typing import Any, ClassVar, Literal

from pydantic import Field

from ..schemas import ActionResult, RiskLevel
from .base import Action, ActionContext

logger = logging.getLogger(__name__)


class MissionSnapshot(Action):
    """Capture a visual snapshot and attach it to the active mission ledger."""

    name: ClassVar[str] = "mission.snapshot"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE
    requires_consent: ClassVar[bool] = False
    reversible: ClassVar[bool] = True  # purely observational + file write

    # Block B — resource declarations.
    estimated_peak_ram_mb: ClassVar[int] = 600
    requires_network: ClassVar[bool] = True   # Gemini describe pass optional
    estimated_wall_seconds: ClassVar[int] = 20

    label: str = Field(..., description="Human-readable label for the snapshot")
    source: Literal["screen", "camera", "blender", "file"] = Field(
        default="screen",
        description=(
            "Where to obtain the PNG. 'screen'/'camera' capture live; "
            "'blender'/'file' read from file_path."
        ),
    )
    file_path: str | None = Field(
        default=None,
        description=(
            "Required when source='file' or 'blender'. "
            "Absolute path to an existing PNG file."
        ),
    )
    describe: bool = Field(
        default=True,
        description=(
            "Run Gemini multimodal describe pass to generate a one-sentence "
            "caption. Set False to skip network call and just store the PNG."
        ),
    )

    async def execute(self, ctx: ActionContext) -> ActionResult:
        t0 = time.monotonic()

        # ── Mission gate ─────────────────────────────────────────────────────
        mission_id = self._resolve_mission_id(ctx)
        if mission_id is None:
            return ActionResult(
                ok=False,
                output={"reason": "no_active_mission"},
                side_effects=[],
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        # ── Capture PNG ──────────────────────────────────────────────────────
        png_bytes, capture_error = await self._capture(ctx)
        if capture_error:
            return ActionResult(
                ok=False,
                output={"reason": "capture_failed", "error": capture_error},
                side_effects=[],
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )
        if not png_bytes:
            return ActionResult(
                ok=False,
                output={"reason": "empty_capture"},
                side_effects=[],
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        # ── Optional Gemini describe ─────────────────────────────────────────
        caption = ""
        if self.describe:
            caption = await self._describe(png_bytes)

        # ── Store in asset directory ─────────────────────────────────────────
        from agent.missions.visual_assets import asset_store_for_mission

        store = asset_store_for_mission(mission_id)
        safe_label = self.label.lower().replace(" ", "-")[:40]
        ts_suffix = str(int(time.time()))
        asset_name = f"{safe_label}-{ts_suffix}"
        try:
            rel_path = await store.store_png(png_bytes, asset_name)
        except Exception as exc:
            logger.warning("mission.snapshot: store_png failed: %s", exc)
            return ActionResult(
                ok=False,
                output={"reason": "store_failed", "error": str(exc)},
                side_effects=[],
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        # ── Append to ledger ─────────────────────────────────────────────────
        await self._append_to_ledger(mission_id, rel_path, caption)

        # ── Result ───────────────────────────────────────────────────────────
        out: dict[str, Any] = {
            "label": self.label,
            "rel_path": rel_path,
            "source": self.source,
            "size_bytes": len(png_bytes),
        }
        if caption:
            out["caption"] = caption

        side_effect = f"snapshot '{self.label}' → {rel_path}"
        if caption:
            side_effect += f" — {caption[:80]}"

        return ActionResult(
            ok=True,
            output=out,
            side_effects=[side_effect],
            elapsed_ms=int((time.monotonic() - t0) * 1000),
        )

    # ── Internal helpers ──────────────────────────────────────────────────────

    @staticmethod
    def _resolve_mission_id(ctx: ActionContext) -> str | None:
        """Extract mission_id from ctx.runtime.foreground_slot, if present."""
        runtime = getattr(ctx, "runtime", None)
        if runtime is None:
            return None
        slot = getattr(runtime, "foreground_slot", None)
        if slot is None:
            return None
        # TaskState carries mission_id only when spawned from a mission loop.
        return getattr(slot, "mission_id", None)

    async def _capture(self, ctx: ActionContext) -> tuple[bytes | None, str | None]:
        """Return (png_bytes, error_str). One of them is always None."""
        if self.source == "screen":
            return await self._capture_screen()
        if self.source == "camera":
            return await self._capture_camera()
        if self.source in ("blender", "file"):
            return self._read_file()
        return None, f"unknown source: {self.source}"

    async def _capture_screen(self) -> tuple[bytes | None, str | None]:
        try:
            from vision.screen_capture import ScreenFrame, ScreenCaptureError
            from vision.screen_capture import capture as screen_capture
            frame = await screen_capture()
        except Exception as exc:
            return None, f"screen_capture import/run: {exc}"
        if isinstance(frame, ScreenCaptureError):
            return None, frame.error
        if not isinstance(frame, ScreenFrame):
            return None, "capture_unknown_type"
        return frame.png_bytes, None

    async def _capture_camera(self) -> tuple[bytes | None, str | None]:
        try:
            from vision.camera_capture import CameraFrame, CameraCaptureError
            from vision.camera_capture import capture as camera_capture
            frame = await camera_capture()
        except Exception as exc:
            return None, f"camera_capture import/run: {exc}"
        if isinstance(frame, CameraCaptureError):
            return None, frame.error
        if not isinstance(frame, CameraFrame):
            return None, "capture_unknown_type"
        return frame.png_bytes, None

    def _read_file(self) -> tuple[bytes | None, str | None]:
        if not self.file_path:
            return None, "file_path required for source='blender'/'file'"
        try:
            with open(self.file_path, "rb") as fh:
                return fh.read(), None
        except Exception as exc:
            return None, f"read_file: {exc}"

    async def _describe(self, png_bytes: bytes) -> str:
        """One-sentence Gemini caption. Empty string on any failure."""
        try:
            from config import config as cfg
            api_key = (cfg.ai_gemini_api_key or "").strip()
            model = (cfg.ai_gemini_model or "").strip()
            if not api_key or not model:
                return ""
            from agent.actions.vision import _call_gemini_vision
            result = await _call_gemini_vision(
                png_bytes,
                (
                    "Describe this image in one sentence from the perspective of "
                    "an autonomous engineering agent logging mission progress. "
                    "Be specific and factual. No markdown.\n\n"
                    'Respond with a single JSON object: {"summary": "one sentence"}'
                ),
                model=model,
                api_key=api_key,
            )
            return (result.get("summary") or "").strip()[:200]
        except Exception as exc:
            logger.debug("mission.snapshot: describe failed: %s", exc)
            return ""

    async def _append_to_ledger(
        self, mission_id: str, rel_path: str, caption: str
    ) -> None:
        """Append a Snapshot block to the active phase ledger section."""
        try:
            from agent.missions.store import get_mission
            from agent.missions.ledger import _append_to_file

            # We don't have user_id here; use ledger path from filesystem convention.
            mission_dir = os.path.join(
                os.path.expanduser("~/.phantom"), "missions", mission_id
            )
            ledger_path = os.path.join(mission_dir, "ledger.md")

            label_line = f"### Snapshot: {self.label}\n"
            image_line = f"![{self.label}]({rel_path})\n"
            caption_line = f"_{caption}_\n" if caption else ""
            block = f"\n{label_line}{image_line}{caption_line}"
            await _append_to_file(ledger_path, block)
        except Exception as exc:
            # Non-fatal — snapshot is stored even if ledger append fails.
            logger.warning("mission.snapshot: ledger append failed: %s", exc)


__all__ = ["MissionSnapshot"]
