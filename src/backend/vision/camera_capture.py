"""Camera frame capture — async, threaded, OpenCV-backed.

Mirrors `vision.screen_capture` (same shape: returns CameraFrame or
CameraCaptureError) so the `vision.see_camera` agent action can reuse
the exact Gemini-vision plumbing. The audit flagged that physical
camera vision was the one Level-4 capability genuinely missing — this
closes the gap.

Strategy:
  1. Try `cv2.VideoCapture(device_index)` (the universal Linux path).
  2. PNG-encode the frame in the worker thread so the agent loop never
     blocks on JPEG/PNG codec work.
  3. Release the capture immediately — we never hold the camera
     between calls, so the user's video conferencing apps / face-track
     loop keep working.

OpenCV is heavyweight (~200ms import). It is imported lazily inside
`capture()` so module load stays free in unit tests that don't touch
camera capture.
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from typing import Union

logger = logging.getLogger(__name__)


@dataclass
class CameraFrame:
    png_bytes: bytes
    width: int
    height: int
    strategy: str  # "opencv:dev=0" / "opencv:dev=2" / …
    captured_at: float


@dataclass
class CameraCaptureError:
    error: str
    tried: list[str]


def _sync_capture(device_index: int, warmup_frames: int) -> Union[CameraFrame, CameraCaptureError]:
    """Blocking capture path — runs in a worker thread.

    Warmup frames are needed because most USB / MIPI webcams ship a
    couple of black / auto-exposure-adjusting frames after `open()`.
    Three reads is the smallest count that reliably gives a usable
    frame on the Q6A's MIPI camera.
    """
    tried: list[str] = [f"opencv:dev={device_index}"]
    try:
        import cv2  # type: ignore
    except Exception as exc:
        return CameraCaptureError(
            error=f"opencv import failed: {exc}", tried=tried,
        )

    cap = cv2.VideoCapture(device_index)
    if not cap.isOpened():
        return CameraCaptureError(
            error=f"VideoCapture({device_index}) failed to open",
            tried=tried,
        )

    try:
        frame = None
        for _ in range(max(1, warmup_frames)):
            ok, frame = cap.read()
            if not ok or frame is None:
                continue
        if frame is None:
            return CameraCaptureError(
                error="camera opened but never returned a frame",
                tried=tried,
            )
        ok, png = cv2.imencode(".png", frame)
        if not ok:
            return CameraCaptureError(
                error="cv2.imencode failed", tried=tried,
            )
        h, w = frame.shape[:2]
        return CameraFrame(
            png_bytes=bytes(png),
            width=int(w),
            height=int(h),
            strategy=f"opencv:dev={device_index}",
            captured_at=time.time(),
        )
    finally:
        cap.release()


async def capture(
    *,
    device_index: int = 0,
    warmup_frames: int = 3,
) -> Union[CameraFrame, CameraCaptureError]:
    """Capture a single PNG frame from the host camera."""
    return await asyncio.to_thread(_sync_capture, device_index, warmup_frames)
