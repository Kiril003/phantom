"""
Command Sender — typed ActuatorCommand → JSON → Serial TX.
Uses short protocol keys from protocol.h.

TODO(phase-01/firmware): several Settings fields persist but don't reach
the ESP32 yet because the firmware doesn't accept these `cfg` commands:
  - sensor_radar_sensitivity        → cfg key "radar_sens"
  - sensor_radar_max_distance_cm    → cfg key "radar_max"
  - sensor_breathing_detection      → cfg key "breath_on"
  - sensor_gps_enabled              → cfg key "gps_on"
  - sensor_wifi_scan_interval_s     → cfg key "wifi_ival"
  - sensor_oled_brightness          → cfg key "oled_bri"
Settings UI marks them [soon] via routes_settings.UNIMPLEMENTED_KEYS.
Implementation path: send CMD_TYPE_CFG with the key above on settings PUT
AND on serial reconnect (so a freshly-booted ESP32 picks up persisted
overrides).
"""
from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import asyncio

logger = logging.getLogger(__name__)


def serialize_command(cmd: dict) -> bytes:
    """
    Convert a command dict (matching ActuatorCommand union) to a JSON line.
    Maps long field names to short protocol keys.
    """
    cmd_type = cmd.get("type", "")

    if cmd_type == "servo":
        payload = {
            "type": "servo",
            "pan": int(cmd.get("pan_delta", 0)),
            "tilt": int(cmd.get("tilt_delta", 0)),
        }
    elif cmd_type == "haptic":
        payload = {
            "type": "haptic",
            "pat": cmd.get("pattern", "single"),
            "ms": int(cmd.get("duration_ms", 200)),
        }
    elif cmd_type == "oled":
        payload: dict = {"type": "oled", "mode": cmd.get("mode", "clear")}
        if "lines" in cmd:
            payload["lines"] = cmd["lines"]
        if "menu_idx" in cmd:
            payload["idx"] = int(cmd["menu_idx"])
        if "animation_id" in cmd:
            payload["anim"] = cmd["animation_id"]
    elif cmd_type == "rgb":
        payload = {
            "type": "rgb",
            "id": int(cmd.get("id", 0)),
            "color": str(cmd.get("color", "000000")),
            "mode": cmd.get("mode", "solid"),
        }
        if "speed_ms" in cmd:
            payload["spd"] = int(cmd["speed_ms"])
    elif cmd_type == "buzzer":
        payload = {
            "type": "buzz",
            "freq": int(cmd.get("freq_hz", 1000)),
            "ms": int(cmd.get("duration_ms", 200)),
        }
    elif cmd_type == "config":
        payload = {
            "type": "cfg",
            "key": str(cmd.get("key", "")),
            "val": cmd.get("value", 0),
        }
    else:
        raise ValueError(f"Unknown command type: {cmd_type!r}")

    return (json.dumps(payload, separators=(",", ":")) + "\n").encode("utf-8")


class CommandSender:
    """
    Wraps the serial writer and provides typed send methods.
    writer is an asyncio.StreamWriter from pyserial-asyncio.
    """

    def __init__(self) -> None:
        self._writer: "asyncio.StreamWriter | None" = None

    def set_writer(self, writer: "asyncio.StreamWriter | None") -> None:
        self._writer = writer

    async def send(self, cmd: dict) -> bool:
        """Serialize and send a command. Returns True on success."""
        if self._writer is None:
            logger.warning("CommandSender: no writer, dropping command %s", cmd.get("type"))
            return False
        try:
            data = serialize_command(cmd)
            self._writer.write(data)
            await self._writer.drain()
            return True
        except ValueError as exc:
            logger.error("serialize_command error: %s", exc)
            return False
        except Exception as exc:
            logger.error("Serial write error: %s", exc)
            self._writer = None
            return False

    async def servo(self, pan_delta: int, tilt_delta: int) -> bool:
        return await self.send({"type": "servo", "pan_delta": pan_delta, "tilt_delta": tilt_delta})

    async def haptic(self, pattern: str = "single", duration_ms: int = 200) -> bool:
        return await self.send({"type": "haptic", "pattern": pattern, "duration_ms": duration_ms})

    async def oled_text(self, lines: list[str]) -> bool:
        return await self.send({"type": "oled", "mode": "text", "lines": lines})

    async def oled_clear(self) -> bool:
        return await self.send({"type": "oled", "mode": "clear"})

    async def oled_status(self, lines: list[str]) -> bool:
        return await self.send({"type": "oled", "mode": "status", "lines": lines})

    async def rgb(self, led_id: int, color: str, mode: str = "solid", speed_ms: int | None = None) -> bool:
        cmd: dict = {"type": "rgb", "id": led_id, "color": color, "mode": mode}
        if speed_ms is not None:
            cmd["speed_ms"] = speed_ms
        return await self.send(cmd)

    async def buzzer(self, freq_hz: int = 1000, duration_ms: int = 200) -> bool:
        return await self.send({"type": "buzzer", "freq_hz": freq_hz, "duration_ms": duration_ms})

    async def config(self, key: str, value: str | int) -> bool:
        return await self.send({"type": "config", "key": key, "value": value})


# Singleton
command_sender = CommandSender()
