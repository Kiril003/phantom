"""
Phase 18 — Screen capture.

Cascade of strategies, picked at call time so the same backend works on
Wayland (Radxa default), X11 desktops, and headless CI:

  1. `mss` Python lib if installed — pure-Python, works on X11 and Wayland
     under XWayland, supports per-monitor + region capture.
  2. `grim` subprocess (Wayland-native).
  3. `scrot` subprocess (X11).
  4. `import` (ImageMagick) subprocess (X11 fallback).

Returns PNG bytes. Region capture honoured by all strategies that support it
(mss + grim); for the others we capture full frame and crop in Pillow.

This module never raises on a missing strategy — `capture()` returns None
with `error` text so the caller (action) can surface a clean
ActionResult(ok=False) instead of crashing the loop.
"""
from __future__ import annotations

import asyncio
import io
import logging
import os
import shutil
import subprocess
import time
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class ScreenFrame:
    png_bytes: bytes
    width: int
    height: int
    region: tuple[int, int, int, int] | None  # (x, y, w, h) in pixels
    strategy: str
    captured_at: float


@dataclass
class ScreenCaptureError:
    error: str
    tried: list[str]


def _detect_session() -> str:
    """Best-effort: 'wayland' | 'x11' | 'unknown'."""
    if os.environ.get("WAYLAND_DISPLAY"):
        return "wayland"
    if os.environ.get("DISPLAY"):
        return "x11"
    if (os.environ.get("XDG_SESSION_TYPE") or "").lower() == "wayland":
        return "wayland"
    if (os.environ.get("XDG_SESSION_TYPE") or "").lower() == "x11":
        return "x11"
    return "unknown"


def _has(cmd: str) -> bool:
    return shutil.which(cmd) is not None


async def _mss_capture(region: tuple[int, int, int, int] | None) -> bytes | None:
    try:
        import mss  # type: ignore
        from PIL import Image  # type: ignore
    except Exception:
        return None

    def _run() -> bytes:
        with mss.mss() as sct:
            monitors = sct.monitors
            if not monitors:
                raise RuntimeError("mss reports no monitors")
            # monitors[0] = combined virtual screen; monitors[1] = primary.
            mon = monitors[1] if len(monitors) > 1 else monitors[0]
            if region:
                x, y, w, h = region
                target = {"left": mon["left"] + x, "top": mon["top"] + y, "width": w, "height": h}
            else:
                target = mon
            shot = sct.grab(target)
            img = Image.frombytes("RGB", shot.size, shot.bgra, "raw", "BGRX")
            buf = io.BytesIO()
            img.save(buf, format="PNG", optimize=True)
            return buf.getvalue()

    return await asyncio.to_thread(_run)


async def _subprocess_capture(
    cmd: list[str],
    *,
    out_path: str | None = None,
    timeout_s: float = 5.0,
) -> bytes | None:
    """Run a screen-capture binary; return PNG bytes from stdout or path."""
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout_s)
        except asyncio.TimeoutError:
            with __import__("contextlib").suppress(Exception):
                proc.kill()
            return None
        if proc.returncode != 0:
            logger.debug("%s failed rc=%s stderr=%r", cmd[0], proc.returncode, (stderr or b'')[:120])
            return None
        if out_path:
            try:
                with open(out_path, "rb") as fh:
                    return fh.read()
            finally:
                with __import__("contextlib").suppress(Exception):
                    os.remove(out_path)
        return stdout or None
    except FileNotFoundError:
        return None
    except Exception as exc:
        logger.debug("%s subprocess failed: %s", cmd[0], exc)
        return None


async def _grim_capture(region: tuple[int, int, int, int] | None) -> bytes | None:
    if not _has("grim"):
        return None
    args = ["grim"]
    if region:
        x, y, w, h = region
        args += ["-g", f"{x},{y} {w}x{h}"]
    args.append("-")  # stdout
    return await _subprocess_capture(args)


async def _scrot_capture(region: tuple[int, int, int, int] | None) -> bytes | None:
    if not _has("scrot"):
        return None
    # scrot dumps to a path; use a temp file then read it back.
    import tempfile
    tmp = tempfile.NamedTemporaryFile(prefix="phantom_scrot_", suffix=".png", delete=False)
    tmp.close()
    args = ["scrot", "-o"]
    if region:
        x, y, w, h = region
        args += ["-a", f"{x},{y},{w},{h}"]
    args.append(tmp.name)
    return await _subprocess_capture(args, out_path=tmp.name)


async def _import_capture(region: tuple[int, int, int, int] | None) -> bytes | None:
    if not _has("import"):
        return None
    args = ["import", "-window", "root"]
    if region:
        x, y, w, h = region
        args += ["-crop", f"{w}x{h}+{x}+{y}"]
    args.append("png:-")
    return await _subprocess_capture(args)


_STRATEGIES = [
    ("mss", _mss_capture),
    ("grim", _grim_capture),
    ("scrot", _scrot_capture),
    ("import", _import_capture),
]


async def capture(
    *,
    region: tuple[int, int, int, int] | None = None,
    timeout_s: float = 5.0,
) -> ScreenFrame | ScreenCaptureError:
    """Capture a frame using the first strategy that yields PNG bytes."""
    tried: list[str] = []
    started = time.monotonic()
    session = _detect_session()
    # Prefer grim before mss on Wayland sessions to avoid mss surprising
    # operators on compositors that don't expose XWayland.
    order = list(_STRATEGIES)
    if session == "wayland":
        order.sort(key=lambda kv: 0 if kv[0] == "grim" else (1 if kv[0] == "mss" else 2))

    for name, fn in order:
        if (time.monotonic() - started) > timeout_s:
            break
        tried.append(name)
        try:
            blob = await fn(region)
        except Exception as exc:
            logger.debug("strategy %s threw: %s", name, exc)
            blob = None
        if blob:
            try:
                from PIL import Image
                with Image.open(io.BytesIO(blob)) as img:
                    width, height = img.size
            except Exception:
                width = height = 0
            return ScreenFrame(
                png_bytes=blob,
                width=width,
                height=height,
                region=region,
                strategy=name,
                captured_at=time.time(),
            )
    return ScreenCaptureError(error="no screen-capture backend available", tried=tried)


# ── Throttle helper ──────────────────────────────────────────────────────────


_LAST_CAPTURE_AT = 0.0
_THROTTLE_MIN_S = 0.18  # ~5 FPS default


async def capture_throttled(
    *, region: tuple[int, int, int, int] | None = None
) -> ScreenFrame | ScreenCaptureError:
    """Soft throttle so callers don't hammer the GPU on rapid loops."""
    global _LAST_CAPTURE_AT
    now = time.monotonic()
    delta = now - _LAST_CAPTURE_AT
    if delta < _THROTTLE_MIN_S:
        await asyncio.sleep(_THROTTLE_MIN_S - delta)
    _LAST_CAPTURE_AT = time.monotonic()
    return await capture(region=region)


__all__ = [
    "ScreenFrame",
    "ScreenCaptureError",
    "capture",
    "capture_throttled",
]
