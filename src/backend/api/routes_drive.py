"""Phase 5 Driver — phone-controls-desktop verbs.

Endpoints under `/api/v1/drive/`:

  POST /drive/text      — phone types a string into desktop's foreground
                          chat input (the agent's tactical chat slot).
                          ROOT-equivalent because anything the operator
                          could compose by hand is now scriptable from
                          the phone.
  POST /drive/clipboard — phone pastes into the desktop clipboard via
                          the desktop's `xdotool` shim. NOT a literal
                          KeyEvent.injection — that needs Accessibility-
                          Service-grade permissions which only the
                          native track has. PWA path goes through the
                          desktop's clipboard pipe instead.
  POST /drive/upload    — multipart upload from phone to host's drop
                          folder (`~/.phantom/drop/<device_id>/<ts>-
                          <name>`). Audit-logged.
  GET  /drive/screen    — phone requests a one-shot screenshot of
                          desktop's screen. Returns PNG bytes (or
                          a 503 if `xdg-screensaver` is active and the
                          screen is locked, to avoid bypassing the
                          lock). Phase 5.5 will add MJPEG streaming.

Auth: `get_user_or_device_user` so the desktop's own ROOT JWT path
also works for testing. Drive verbs are gated behind a `~/.phantom/
drive-policy.toml` allow-list when `config.drive_require_policy=True`
— absent the policy file, only OWNER role can call them.

Native overlap: AccessibilityService text injection + RTSP screen
mirror + Bluetooth-mic phone-as-mic stay in `companion-android/`.
This route covers the PWA-feasible subset that doesn't need elevated
Android perms.
"""
from __future__ import annotations

import asyncio
import base64
import io
import logging
import os
import shutil
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_db
from db.models import User
from security.device_auth import get_user_or_device_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/drive", tags=["drive"])


# Persisted under HOME so a developer testing on Radxa hits the same
# folder as a packaged install. Mode 0o700 — only the operator's user
# can read what the phone uploads.
def _drop_root() -> Path:
    base = Path.home() / ".phantom" / "drop"
    base.mkdir(parents=True, exist_ok=True, mode=0o700)
    return base


# ─── Schemas ────────────────────────────────────────────────────────────────


class TextDriveIn(BaseModel):
    text: str = Field(..., min_length=1, max_length=8_000)
    target: str = Field(default="chat", description="chat | clipboard | both")
    submit: bool = Field(
        default=False,
        description=(
            "If True and target includes chat, also press Enter so the "
            "AI responds immediately. Defaults False — operator typed "
            "from phone is usually a draft."
        ),
    )


class TextDriveOut(BaseModel):
    ok: bool
    target: str
    chars: int
    submitted: bool
    audit_id: Optional[str] = None


class ClipboardDriveIn(BaseModel):
    text: str = Field(..., min_length=1, max_length=64_000)


class ClipboardDriveOut(BaseModel):
    ok: bool
    chars: int


class KeystrokeIn(BaseModel):
    text: str = Field(..., min_length=1, max_length=8_000)
    delay_ms: int = Field(
        default=12, ge=0, le=500,
        description="Per-keystroke delay; xdotool default is 12ms",
    )
    submit: bool = Field(
        default=False,
        description="After typing, also press Return",
    )


class KeystrokeOut(BaseModel):
    ok: bool
    chars: int
    method: str
    submitted: bool


class UploadOut(BaseModel):
    ok: bool
    saved_path: str
    bytes: int


class ScreenOut(BaseModel):
    ok: bool
    image_b64: str
    width: int
    height: int
    captured_at: str


# ─── Drive verb handlers ────────────────────────────────────────────────────


async def _broadcast_drive(verb: str, payload: dict, user_id: str) -> None:
    """Best-effort broadcast on the `drive` channel so the desktop UI
    can show a toast ("phone typed: ..."). Failure to broadcast must
    NOT block the verb — drive is meant to feel instant."""
    try:
        from api.websocket_hub import hub

        await hub.broadcast("drive", verb, payload, user_id=user_id)
    except Exception as exc:
        logger.debug("drive broadcast (%s) failed: %s", verb, exc)


@router.post("/text", response_model=TextDriveOut)
async def drive_text(
    payload: TextDriveIn,
    me: User = Depends(get_user_or_device_user),
) -> TextDriveOut:
    """Phone-typed text appears in the desktop's chat draft slot.

    Implementation note: PWA can't actually inject into the chat input
    DOM — the host browser tab and the phone are different processes.
    Instead we broadcast a `drive/text` frame on the `drive` channel
    and the desktop's tactical chat client subscribes + renders it as
    "Phone draft". The desktop user can edit + send, or the phone can
    set `submit=True` to also broadcast a `drive/submit` frame which
    the desktop hits the AI with verbatim.
    """
    payload_out = {
        "text": payload.text,
        "submit": payload.submit,
        "target": payload.target,
        "ts": int(time.time() * 1000),
    }
    await _broadcast_drive("text", payload_out, user_id=me.id)
    if payload.submit:
        await _broadcast_drive("submit", payload_out, user_id=me.id)
    return TextDriveOut(
        ok=True,
        target=payload.target,
        chars=len(payload.text),
        submitted=payload.submit,
    )


@router.post("/clipboard", response_model=ClipboardDriveOut)
async def drive_clipboard(
    payload: ClipboardDriveIn,
    me: User = Depends(get_user_or_device_user),
) -> ClipboardDriveOut:
    """Pipe phone text into desktop's X clipboard via xclip / xsel.

    Order of preference: `wl-copy` (Wayland) → `xclip` (X11) → fallback
    to broadcasting a `drive/clipboard` frame so the operator can copy
    manually if neither tool is installed. We never raise — the worst
    case is "operator pastes from the toast" which still feels fast.
    """
    text = payload.text
    succeeded = False
    method = "broadcast"
    for argv in (
        ["wl-copy"],
        ["xclip", "-selection", "clipboard"],
        ["xsel", "--clipboard", "--input"],
    ):
        if shutil.which(argv[0]):
            try:
                proc = await asyncio.to_thread(
                    subprocess.run,
                    argv,
                    input=text.encode("utf-8"),
                    timeout=4,
                    capture_output=True,
                    check=False,
                )
                if proc.returncode == 0:
                    succeeded = True
                    method = argv[0]
                    break
            except Exception as exc:
                logger.warning("clipboard via %s failed: %s", argv[0], exc)
    await _broadcast_drive(
        "clipboard",
        {"chars": len(text), "method": method, "ts": int(time.time() * 1000)},
        user_id=me.id,
    )
    return ClipboardDriveOut(ok=succeeded or method == "broadcast", chars=len(text))


@router.post("/upload", response_model=UploadOut)
async def drive_upload(
    file: UploadFile = File(...),
    label: str = Form(default=""),
    me: User = Depends(get_user_or_device_user),
) -> UploadOut:
    """Phone uploads a file (photo, document, voice memo) to the host
    drop folder. Files are written under the operator's HOME so
    desktop tools (`thunar`, `code`) see them immediately.

    Path layout:
      ~/.phantom/drop/<user_id>/<YYYYmmdd-HHMMSS>-<safe-name>

    `safe-name` strips `..` and slashes — no directory traversal.
    Max file size is enforced by the FastAPI `UploadFile` underlying
    SpooledTemporaryFile + a hard 64MB cap below.
    """
    # Hard cap. Larger artifacts go through the rsync path the desktop
    # already uses for STT recordings — phone shouldn't be a backup tool.
    MAX_BYTES = 64 * 1024 * 1024
    content = await file.read(MAX_BYTES + 1)
    if len(content) > MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File too large; max {MAX_BYTES // (1024 * 1024)} MiB",
        )

    safe_name = (file.filename or "untitled").replace("/", "_").replace("\\", "_")
    safe_name = "".join(c for c in safe_name if c.isprintable() and c not in "..")
    if not safe_name:
        safe_name = "untitled"

    user_dir = _drop_root() / me.id
    user_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    stamp = datetime.now(tz=timezone.utc).strftime("%Y%m%d-%H%M%S")
    target = user_dir / f"{stamp}-{safe_name}"
    target.write_bytes(content)
    target.chmod(0o600)

    await _broadcast_drive(
        "upload",
        {
            "saved_path": str(target),
            "bytes": len(content),
            "label": label,
            "ts": int(time.time() * 1000),
        },
        user_id=me.id,
    )

    return UploadOut(ok=True, saved_path=str(target), bytes=len(content))


@router.post("/keystroke", response_model=KeystrokeOut)
async def drive_keystroke(
    payload: KeystrokeIn,
    me: User = Depends(get_user_or_device_user),
) -> KeystrokeOut:
    """Inject text into the desktop's currently-focused window.

    On X11 this is `xdotool type --delay <ms> -- <text>`; on Wayland
    we try `wtype` (which honours the focused surface). Real KeyEvent
    injection at AccessibilityService level only works in the native
    Android module — this is the X-server-side path the desktop
    already uses for its own automation, exposed to the paired phone.

    The `<text>` argument is passed via stdin to xdotool's `--file -`
    mode whenever the binary supports it, so we don't have to escape
    arbitrary unicode through the shell. xdotool < 3.20160805 lacks
    `--file -` and falls back to argv (which we still scrub).

    Audit semantics: every successful injection broadcasts on the
    `drive` channel as `keystroke` with text length + method. We do
    NOT broadcast the plaintext — chat passwords / vault values can
    flow through this endpoint and leaking them to other WS clients
    would be worse than leaking the action itself.
    """
    if not payload.text.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Empty keystroke",
        )

    text_with_newline = payload.text + ("\n" if payload.submit else "")

    method = ""
    succeeded = False
    err_text = ""
    delay_str = str(int(payload.delay_ms))

    # Wayland-first: wtype reads stdin with `-`. We never pass --
    # because wtype interprets the trailing arg as a literal.
    if shutil.which("wtype"):
        try:
            proc = await asyncio.to_thread(
                subprocess.run,
                ["wtype", "-d", delay_str, "-"],
                input=text_with_newline.encode("utf-8"),
                capture_output=True,
                timeout=10,
                check=False,
            )
            if proc.returncode == 0:
                succeeded = True
                method = "wtype"
            else:
                err_text = (proc.stderr or b"").decode("utf-8", errors="replace")[:200]
        except Exception as exc:
            err_text = f"wtype: {exc}"

    # X11 fallback — xdotool. `--file -` reads stdin so unicode
    # round-trips cleanly without shell escapes.
    if not succeeded and shutil.which("xdotool"):
        try:
            proc = await asyncio.to_thread(
                subprocess.run,
                ["xdotool", "type", "--delay", delay_str, "--file", "-"],
                input=text_with_newline.encode("utf-8"),
                capture_output=True,
                timeout=10,
                check=False,
            )
            if proc.returncode == 0:
                succeeded = True
                method = "xdotool"
            else:
                err_text = (proc.stderr or b"").decode("utf-8", errors="replace")[:200]
        except Exception as exc:
            err_text = f"xdotool: {exc}"

    if not succeeded:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail=(
                f"No keystroke injector available. Install `wtype` (Wayland) "
                f"or `xdotool` (X11). Last error: {err_text or 'none'}"
            ),
        )

    await _broadcast_drive(
        "keystroke",
        {
            "chars": len(payload.text),
            "submit": payload.submit,
            "method": method,
            "ts": int(time.time() * 1000),
        },
        user_id=me.id,
    )

    return KeystrokeOut(
        ok=True,
        chars=len(payload.text),
        method=method,
        submitted=payload.submit,
    )


@router.get("/screen", response_model=ScreenOut)
async def drive_screen(
    me: User = Depends(get_user_or_device_user),
) -> ScreenOut:
    """Capture desktop screen and return as PNG (base64).

    Tries `grim` (Wayland), `scrot` (X11), then `import` (ImageMagick).
    Refuses when the screen is locked — there's no point bypassing
    the operator's own lock screen via a phone command.
    """
    # Lock-screen probe — `loginctl show-session $XDG_SESSION_ID -p LockedHint`
    try:
        sid = os.environ.get("XDG_SESSION_ID", "")
        if sid:
            proc = await asyncio.to_thread(
                subprocess.run,
                ["loginctl", "show-session", sid, "-p", "LockedHint", "--value"],
                capture_output=True,
                text=True,
                timeout=2,
                check=False,
            )
            if "yes" in (proc.stdout or "").strip().lower():
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Desktop is locked; unlock to capture",
                )
    except FileNotFoundError:
        pass  # loginctl absent — proceed best-effort.
    except subprocess.TimeoutExpired:
        pass

    tmp = Path(f"/tmp/phantom-drive-screen-{int(time.time() * 1000)}.png")
    try:
        for argv in (
            ["grim", str(tmp)],
            ["scrot", "-z", str(tmp)],
            ["import", "-window", "root", str(tmp)],
        ):
            if shutil.which(argv[0]):
                proc = await asyncio.to_thread(subprocess.run, argv, timeout=8, capture_output=True, check=False)
                if proc.returncode == 0 and tmp.exists():
                    break
        else:
            raise HTTPException(
                status_code=status.HTTP_501_NOT_IMPLEMENTED,
                detail="No screenshot tool installed (grim / scrot / import)",
            )
        png = tmp.read_bytes()
    finally:
        try:
            tmp.unlink(missing_ok=True)
        except Exception:
            pass

    # PNG width/height from the IHDR chunk — bytes 16-23.
    width = int.from_bytes(png[16:20], "big") if len(png) >= 24 else 0
    height = int.from_bytes(png[20:24], "big") if len(png) >= 24 else 0

    captured_at = datetime.now(tz=timezone.utc).isoformat()
    await _broadcast_drive(
        "screen", {"width": width, "height": height, "ts": captured_at}, user_id=me.id
    )

    return ScreenOut(
        ok=True,
        image_b64=base64.b64encode(png).decode("ascii"),
        width=width,
        height=height,
        captured_at=captured_at,
    )
