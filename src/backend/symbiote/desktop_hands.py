"""Руки ПК: те, що телефон може попросити зробити тут."""
from __future__ import annotations

import asyncio
import logging
import os
import shutil
from typing import Any

from input.desktop_control import ControlBackendError, type_text

logger = logging.getLogger(__name__)

_TIMEOUT_S = 5.0


async def _run(cmd: list[str], *, stdin: str | None = None) -> tuple[bool, str]:
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE if stdin is not None else None,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
    except (OSError, FileNotFoundError) as exc:
        return False, f"немає чим: {cmd[0]} ({exc})"
    try:
        _, err = await asyncio.wait_for(
            proc.communicate(stdin.encode() if stdin is not None else None),
            timeout=_TIMEOUT_S,
        )
    except asyncio.TimeoutError:
        proc.kill()
        return False, f"{cmd[0]} завис"
    except (BrokenPipeError, ConnectionResetError):
        err = b""
    if proc.returncode != 0:
        return False, (err or b"")[:160].decode(errors="replace").strip() or "не вдалось"
    return True, ""


async def _run_detached(cmd: list[str]) -> tuple[bool, str]:
    """Для тих, хто лишається жити після роботи (wl-copy тримає виділення)."""
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
    except (OSError, FileNotFoundError) as exc:
        return False, f"немає чим: {cmd[0]} ({exc})"
    try:
        code = await asyncio.wait_for(proc.wait(), timeout=_TIMEOUT_S)
    except asyncio.TimeoutError:
        proc.kill()
        return False, f"{cmd[0]} завис"
    return code == 0, "" if code == 0 else f"{cmd[0]} вийшов з {code}"


async def _type(args: dict[str, Any]) -> tuple[bool, str, dict]:
    text = str(args.get("text") or "")
    if not text:
        return False, "нема що набирати", {}
    try:
        await type_text(text)
    except ControlBackendError as exc:
        return False, str(exc), {}
    return True, f"набрано {len(text)} символів", {}


async def _clipboard(args: dict[str, Any]) -> tuple[bool, str, dict]:
    text = str(args.get("text") or "")
    if not text:
        return False, "нема що класти", {}
    tool = "wl-copy" if os.environ.get("WAYLAND_DISPLAY") and shutil.which("wl-copy") else None
    tool = tool or next((t for t in ("xclip", "xsel") if shutil.which(t)), None)
    if tool is None:
        return False, "немає буфера обміну (wl-copy/xclip)", {}
    if tool == "wl-copy":
        ok, why = await _run_detached(["wl-copy", "--", text])
    else:
        cmd = {
            "xclip": ["xclip", "-selection", "clipboard"],
            "xsel": ["xsel", "--clipboard", "--input"],
        }[tool]
        ok, why = await _run(cmd, stdin=text)
    return ok, "у буфері" if ok else why, {}


async def _open(args: dict[str, Any]) -> tuple[bool, str, dict]:
    target = str(args.get("target") or args.get("url") or "")
    if not target:
        return False, "нема що відкривати", {}
    if not shutil.which("xdg-open"):
        return False, "немає xdg-open", {}
    ok, why = await _run(["xdg-open", target])
    return ok, "відкрито" if ok else why, {}


async def _lock(_args: dict[str, Any]) -> tuple[bool, str, dict]:
    if not shutil.which("loginctl"):
        return False, "немає loginctl", {}
    ok, why = await _run(["loginctl", "lock-session"])
    return ok, "замкнено" if ok else why, {}


async def _notify(args: dict[str, Any]) -> tuple[bool, str, dict]:
    text = str(args.get("text") or "PHANTOM")
    if not shutil.which("notify-send"):
        return False, "немає notify-send", {}
    ok, why = await _run(["notify-send", "PHANTOM", text])
    return ok, "показано" if ok else why, {}


_HANDS = {
    "pc.type": _type,
    "pc.clipboard": _clipboard,
    "pc.open": _open,
    "pc.lock": _lock,
    "pc.notify": _notify,
}


def knows(verb: str) -> bool:
    return verb in _HANDS


async def execute(verb: str, args: dict[str, Any]) -> tuple[bool, str, dict]:
    hand = _HANDS.get(verb)
    if hand is None:
        return False, f"ПК цього ще не вміє: {verb}", {}
    try:
        return await hand(args or {})
    except Exception as exc:  # noqa: BLE001
        logger.warning("symbiote: рука %s зламалась: %r", verb, exc)
        return False, f"не вийшло: {exc or type(exc).__name__}", {}


__all__ = ["execute", "knows"]
