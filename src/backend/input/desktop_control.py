"""
Phase 18 — Desktop input automation.

Cascade strategies, picked at call time:
  • ydotool (Wayland-native, needs ydotoold daemon)
  • xdotool (X11)
  • wtype (Wayland — text input only)

Each helper returns True on success or raises `ControlBackendError` with a
message that tells the operator which dependency to install. The agent
runtime catches the error and emits it as ActionResult.error.

NOTE: every helper is async because we shell out — the agent loop is
asyncio-driven and we don't want to block the event loop on a 50ms click.
"""
from __future__ import annotations

import asyncio
import logging
import os
import shutil
from typing import Iterable

logger = logging.getLogger(__name__)


class ControlBackendError(RuntimeError):
    """Raised when no desktop-control backend is available for the request."""


def _has(cmd: str) -> bool:
    return shutil.which(cmd) is not None


def _session() -> str:
    if os.environ.get("WAYLAND_DISPLAY"):
        return "wayland"
    if os.environ.get("DISPLAY"):
        return "x11"
    if (os.environ.get("XDG_SESSION_TYPE") or "").lower() == "wayland":
        return "wayland"
    return "x11"


async def _run(cmd: list[str], *, timeout_s: float = 5.0) -> bool:
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            _, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout_s)
        except asyncio.TimeoutError:
            with __import__("contextlib").suppress(Exception):
                proc.kill()
            raise ControlBackendError(f"{cmd[0]} timed out")
        if proc.returncode != 0:
            raise ControlBackendError(
                f"{cmd[0]} exit={proc.returncode} stderr={(stderr or b'')[:160].decode(errors='replace')}",
            )
        return True
    except FileNotFoundError as exc:
        raise ControlBackendError(f"binary {cmd[0]} not found ({exc})") from exc


# ── Atomic helpers ──────────────────────────────────────────────────────────


_BUTTON_MAP_X11 = {"left": "1", "middle": "2", "right": "3"}
_BUTTON_MAP_YDOTOOL = {"left": "0xC0", "middle": "0xC2", "right": "0xC1"}


async def click(x: int, y: int, *, button: str = "left") -> bool:
    if _session() == "wayland" and _has("ydotool"):
        await _run(["ydotool", "mousemove", "--absolute", str(int(x)), str(int(y))])
        return await _run(["ydotool", "click", _BUTTON_MAP_YDOTOOL.get(button, "0xC0")])
    if _has("xdotool"):
        return await _run([
            "xdotool", "mousemove", "--sync", str(int(x)), str(int(y)),
            "click", _BUTTON_MAP_X11.get(button, "1"),
        ])
    raise ControlBackendError("no input backend (install ydotool or xdotool)")


async def double_click(x: int, y: int, *, button: str = "left") -> bool:
    if _has("xdotool"):
        return await _run([
            "xdotool", "mousemove", "--sync", str(int(x)), str(int(y)),
            "click", "--repeat", "2", "--delay", "60",
            _BUTTON_MAP_X11.get(button, "1"),
        ])
    if _session() == "wayland" and _has("ydotool"):
        await click(x, y, button=button)
        await asyncio.sleep(0.06)
        await click(x, y, button=button)
        return True
    raise ControlBackendError("no input backend for double_click")


async def move(x: int, y: int) -> bool:
    if _session() == "wayland" and _has("ydotool"):
        return await _run(["ydotool", "mousemove", "--absolute", str(int(x)), str(int(y))])
    if _has("xdotool"):
        return await _run(["xdotool", "mousemove", "--sync", str(int(x)), str(int(y))])
    raise ControlBackendError("no input backend for move")


async def type_text(text: str, *, delay_ms: int = 12) -> bool:
    if not text:
        return True
    if _session() == "wayland" and _has("wtype"):
        # wtype reads from argv; pass after `--`.
        return await _run(["wtype", "--", text])
    if _has("xdotool"):
        return await _run(["xdotool", "type", "--delay", str(int(delay_ms)), "--", text])
    if _session() == "wayland" and _has("ydotool"):
        return await _run(["ydotool", "type", "--key-delay", str(int(delay_ms)), "--", text])
    raise ControlBackendError("no input backend for type_text (install wtype/xdotool/ydotool)")


async def key_combo(keys: Iterable[str]) -> bool:
    keys_list = [k.strip() for k in keys if k and k.strip()]
    if not keys_list:
        return True
    if _has("xdotool"):
        return await _run(["xdotool", "key", "+".join(keys_list)])
    if _session() == "wayland" and _has("ydotool"):
        # ydotool wants raw keysyms separated by '+'.
        return await _run(["ydotool", "key", "--", "+".join(keys_list)])
    raise ControlBackendError("no input backend for key_combo")


async def scroll(direction: str = "down", ticks: int = 3) -> bool:
    direction = direction.lower()
    if direction not in {"up", "down", "left", "right"}:
        raise ControlBackendError(f"unknown scroll direction {direction!r}")
    if _has("xdotool"):
        button = {"up": "4", "down": "5", "left": "6", "right": "7"}[direction]
        return await _run([
            "xdotool", "click", "--repeat", str(int(ticks)), "--delay", "30", button,
        ])
    raise ControlBackendError("no scroll backend (install xdotool)")


# ── Convenience class wrapper for runtime registration ──────────────────────


class DesktopController:
    """Stateless aggregator — instances are cheap; method names mirror helpers."""

    async def click(self, x: int, y: int, *, button: str = "left") -> bool:
        return await click(x, y, button=button)

    async def double_click(self, x: int, y: int, *, button: str = "left") -> bool:
        return await double_click(x, y, button=button)

    async def move(self, x: int, y: int) -> bool:
        return await move(x, y)

    async def type_text(self, text: str, *, delay_ms: int = 12) -> bool:
        return await type_text(text, delay_ms=delay_ms)

    async def key_combo(self, keys: Iterable[str]) -> bool:
        return await key_combo(keys)

    async def scroll(self, direction: str = "down", ticks: int = 3) -> bool:
        return await scroll(direction, ticks)


__all__ = [
    "ControlBackendError",
    "DesktopController",
    "click",
    "double_click",
    "move",
    "type_text",
    "key_combo",
    "scroll",
]
