"""psutil host snapshot helper for the sandbox subsystem.

Light wrapper kept here (rather than inlined in routes_linux) so the
sandbox executor and the existing /linux/resources route share one
source of truth.
"""
from __future__ import annotations

import time
from typing import Any

import psutil


def snapshot() -> dict[str, Any]:
    """Return a CPU/RAM/disk/uptime snapshot suitable for direct JSON return."""
    cpu = psutil.cpu_percent(interval=None)
    mem = psutil.virtual_memory()
    disk = psutil.disk_usage("/")
    boot_time = psutil.boot_time()
    return {
        "cpu_percent": float(cpu),
        "ram_total": int(mem.total),
        "ram_used": int(mem.used),
        "ram_free": int(mem.available),
        "disk_total": int(disk.total),
        "disk_used": int(disk.used),
        "disk_free": int(disk.free),
        "uptime_s": int(time.time() - boot_time),
    }
