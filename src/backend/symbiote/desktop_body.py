"""Пульс самого ПК.

Тіло, яке не відчуває себе, не може бути частиною організму. Досі картка
«Цей комп'ютер» була порожня: заряд, мережа й те, що зараз на екрані,
підставлялись константами. Тут — справжні дані з ядра.

Усе читається без прав root і без зовнішніх пакетів: батарея з sysfs,
мережа з nmcli, активне вікно з композитора. Кожен зонд мовчки віддає
None, коли джерела немає — на настільному ПК немає батареї, під іншим
композитором немає hyprctl, і це не помилка.
"""
from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

_PROBE_TIMEOUT_S = 1.5


def battery() -> tuple[Optional[int], Optional[bool]]:
    base = Path("/sys/class/power_supply")
    if not base.is_dir():
        return None, None
    for entry in sorted(base.glob("BAT*")):
        try:
            pct = int((entry / "capacity").read_text().strip())
            status = (entry / "status").read_text().strip().lower()
        except (OSError, ValueError):
            continue
        return pct, status in ("charging", "full")
    return None, None


def network() -> str:
    nmcli = shutil.which("nmcli")
    if nmcli is None:
        return ""
    try:
        out = subprocess.run(
            [nmcli, "-t", "-f", "TYPE,STATE", "device"],
            capture_output=True, text=True, timeout=_PROBE_TIMEOUT_S,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return ""
    kinds = {
        line.split(":")[0]
        for line in out.splitlines()
        if line.endswith(":connected") and not line.startswith(("bridge", "loopback"))
    }
    for preferred in ("ethernet", "wifi"):
        if preferred in kinds:
            return preferred
    return next(iter(kinds), "offline")


def foreground() -> str:
    """Вікно, у якому оператор просто зараз."""
    hyprctl = shutil.which("hyprctl")
    if hyprctl and os.environ.get("HYPRLAND_INSTANCE_SIGNATURE"):
        try:
            out = subprocess.run(
                [hyprctl, "activewindow", "-j"],
                capture_output=True, text=True, timeout=_PROBE_TIMEOUT_S,
            ).stdout
            data = json.loads(out or "{}")
            return str(data.get("title") or data.get("class") or "")[:64]
        except (OSError, subprocess.SubprocessError, ValueError):
            return ""
    return ""


def pulse() -> dict[str, Any]:
    pct, charging = battery()
    return {
        "battery_pct": pct,
        "charging": charging,
        "network": network(),
        "foreground": foreground(),
    }


__all__ = ["pulse", "battery", "network", "foreground"]
