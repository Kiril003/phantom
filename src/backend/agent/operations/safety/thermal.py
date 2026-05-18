"""
Block B — Thermal-aware throttling helpers.

Advisory module — no production call-site requires it yet. Designed for
the planner and a future ProviderRouter to consult before scheduling
heavy work.

All constants are calibrated for Radxa Dragon Q6A (passive heatsink):
  - 75 °C → yellow: start noticing
  - 85 °C → red: start cutting quality hard

Usage::

    from agent.operations.safety.thermal import (
        cpu_temperature_c,
        is_throttling,
        recommended_ollama_context_size,
        recommended_whisper_model,
    )

    temp = await cpu_temperature_c()
    ctx  = recommended_ollama_context_size(temp)   # int
    mdl  = recommended_whisper_model(temp)          # str
"""
from __future__ import annotations

import asyncio
import logging
import os

logger = logging.getLogger(__name__)

# ── Thresholds (Radxa Q6A calibrated) ────────────────────────────────────────
_YELLOW_C: float = 75.0   # above here: reduce quality
_RED_C: float = 85.0      # above here: reduce quality hard

# Sysfs path template
_THERMAL_BASE = "/sys/class/thermal"


def _read_file_sync(path: str) -> str:
    with open(path) as fh:
        return fh.read()


async def cpu_temperature_c() -> float | None:
    """Return max CPU temperature across sysfs thermal zones.

    Returns None on non-Linux hosts or when sysfs is unavailable (CI).
    Never raises — logs and returns None on any error.
    """
    try:
        entries = await asyncio.to_thread(os.listdir, _THERMAL_BASE)
    except OSError:
        return None

    temps: list[float] = []
    for entry in entries:
        if not entry.startswith("thermal_zone"):
            continue
        path = os.path.join(_THERMAL_BASE, entry, "temp")
        try:
            raw = await asyncio.to_thread(_read_file_sync, path)
            temps.append(float(raw.strip()) / 1000.0)
        except Exception as exc:
            logger.debug("thermal: could not read %s: %s", path, exc)

    return max(temps) if temps else None


async def is_throttling() -> bool:
    """Return True when the CPU temperature is above the red threshold.

    Falls back to False when temperature cannot be read.
    """
    temp = await cpu_temperature_c()
    if temp is None:
        return False
    return temp > _RED_C


def recommended_ollama_context_size(temp_c: float | None) -> int:
    """Map current CPU temperature to a recommended Ollama ctx-window.

    Conservative defaults — prefer correctness over throughput under heat:
      - default (or unknown): 4096
      - above 75 °C: 2048
      - above 85 °C: 1024

    Callers are free to ignore this advisory and use their own policy.
    """
    if temp_c is None:
        return 4096
    if temp_c > _RED_C:
        return 1024
    if temp_c > _YELLOW_C:
        return 2048
    return 4096


def recommended_whisper_model(temp_c: float | None) -> str:
    """Map current CPU temperature to a recommended faster-whisper model name.

    Quality vs latency trade-off under thermal pressure:
      - default (or unknown): 'medium'
      - above 75 °C: 'small.en'
      - above 85 °C: 'tiny.en'

    Note: Ukrainian-language tasks should prefer 'small' over 'small.en'
    when practical — this function returns the generic name; caller decides
    the language variant.
    """
    if temp_c is None:
        return "medium"
    if temp_c > _RED_C:
        return "tiny.en"
    if temp_c > _YELLOW_C:
        return "small.en"
    return "medium"
