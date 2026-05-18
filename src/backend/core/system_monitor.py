"""
Block B — Resource Governance: SystemMonitor daemon.

Samples RAM/CPU/disk/temperature every ``system_monitor_interval_s`` seconds
(default 5.0). Publishes each snapshot to the EventBus under topic
``"resource.snapshot"`` and maintains a bounded ring-buffer history.

Usage::

    from core.system_monitor import system_monitor
    await system_monitor.start()     # idempotent
    snap = system_monitor.current()  # ResourceSnapshot | None
    pressure = system_monitor.pressure()  # 'green' | 'yellow' | 'red' | 'unknown'
    await system_monitor.stop()

Design constraints (Block B brief):
- No syscalls at import time — sampling starts only after ``start()``.
- Fail-open: if psutil / sysfs raise, we log and skip — never block the agent.
- Temperature via sysfs (thermal_zone*/temp). Fallback: None on non-Linux / CI.
- Network probe via ``asyncio.open_connection`` to 1.1.1.1:443 — no DNS.
  Cached for 30 s so it doesn't appear in the 5 s hot path.
- History bounded to 720 samples (1 h at 5 s interval).

Pressure thresholds (calibrated for Radxa Dragon Q6A with 16 GB RAM):
  RED  : ram_used_pct > 90  OR  swap_used_pct > 50  OR  cpu_throttling
         OR  disk_free_gb < 1.0
  YELLOW: ram_used_pct > 75  OR  cpu_pct > 80  OR  cpu_temp_c > 75
          OR  disk_free_gb < 5.0
  GREEN : otherwise

Operator tuning: change the constants in the ``_THRESHOLDS`` dict below.
"""
from __future__ import annotations

import asyncio
import collections
import logging
import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable

import psutil

logger = logging.getLogger(__name__)

# ── Operator-tunable thresholds (Radxa Q6A calibrated) ───────────────────────
_THRESHOLDS: dict[str, Any] = {
    "red_ram_pct":       90.0,   # % used
    "red_swap_pct":      50.0,   # % used
    "red_disk_free_gb":   1.0,   # GB free
    "red_temp_c":        80.0,   # °C  (throttling heuristic)
    "red_load_factor":    2.0,   # load_1m / cpu_count multiplier
    "yellow_ram_pct":    75.0,
    "yellow_cpu_pct":    80.0,
    "yellow_temp_c":     75.0,
    "yellow_disk_free_gb": 5.0,
}

# How long to cache the network-probe result (seconds).
_NET_PROBE_CACHE_S: float = 30.0
# History ring-buffer depth: 720 × 5 s = 3600 s = 1 h.
_HISTORY_MAXLEN: int = 720
# Target for the asyncio.open_connection network probe (IP, no DNS).
_NET_PROBE_HOST: str = "1.1.1.1"
_NET_PROBE_PORT: int = 443
_NET_PROBE_TIMEOUT_S: float = 1.0


@dataclass(frozen=True)
class ResourceSnapshot:
    """Immutable snapshot captured by SystemMonitor at one sample point."""

    ts: float                       # monotonic time of capture
    captured_at_iso: str            # wall-clock ISO-8601
    ram_total_mb: int
    ram_available_mb: int
    ram_used_pct: float
    swap_used_pct: float
    cpu_pct: float                  # 1-sample % (seeded on start())
    cpu_load_1m: float              # /proc/loadavg first field
    cpu_temp_c: float | None        # max across thermal zones; None on CI/non-Linux
    cpu_throttling: bool            # temp > red_temp_c OR load > cpu_count * factor
    disk_free_gb: float             # workspace volume (/)
    disk_used_pct: float
    network_up: bool                # cached probe to 1.1.1.1:443
    pressure_label: str             # 'green' | 'yellow' | 'red'


def _derive_pressure(
    ram_used_pct: float,
    swap_used_pct: float,
    cpu_pct: float,
    cpu_temp_c: float | None,
    cpu_throttling: bool,
    disk_free_gb: float,
) -> str:
    t = _THRESHOLDS
    if (
        ram_used_pct > t["red_ram_pct"]
        or swap_used_pct > t["red_swap_pct"]
        or cpu_throttling
        or disk_free_gb < t["red_disk_free_gb"]
    ):
        return "red"
    if (
        ram_used_pct > t["yellow_ram_pct"]
        or cpu_pct > t["yellow_cpu_pct"]
        or (cpu_temp_c is not None and cpu_temp_c > t["yellow_temp_c"])
        or disk_free_gb < t["yellow_disk_free_gb"]
    ):
        return "yellow"
    return "green"


async def _read_cpu_temp() -> float | None:
    """Read max temperature from sysfs thermal zones.

    Returns None when sysfs is unavailable (CI / non-Linux).
    Uses asyncio.to_thread so the file IO doesn't block the event loop.
    """
    thermal_base = "/sys/class/thermal"
    try:
        entries = await asyncio.to_thread(os.listdir, thermal_base)
    except OSError:
        return None

    temps: list[float] = []
    for entry in entries:
        if not entry.startswith("thermal_zone"):
            continue
        path = os.path.join(thermal_base, entry, "temp")
        try:
            raw = await asyncio.to_thread(_read_file, path)
            temps.append(float(raw.strip()) / 1000.0)
        except Exception:
            continue

    return max(temps) if temps else None


def _read_file(path: str) -> str:
    with open(path) as fh:
        return fh.read()


async def _probe_network() -> bool:
    """Probe 1.1.1.1:443 with a 1-second TCP connect timeout.

    Pure IP — no DNS lookup in the snapshot path.
    """
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(_NET_PROBE_HOST, _NET_PROBE_PORT),
            timeout=_NET_PROBE_TIMEOUT_S,
        )
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass
        return True
    except Exception:
        return False


class SystemMonitor:
    """Async-friendly singleton that samples host resources on a fixed interval.

    Typical lifecycle::

        await system_monitor.start()   # schedules sample loop task
        ...
        snap = system_monitor.current()
        ...
        await system_monitor.stop()    # cancels task, drains history
    """

    def __init__(self) -> None:
        self._history: collections.deque[ResourceSnapshot] = collections.deque(
            maxlen=_HISTORY_MAXLEN
        )
        self._task: asyncio.Task | None = None
        self._started: bool = False
        self._subscribers: list[Callable[[ResourceSnapshot], None]] = []
        # Network probe cache
        self._net_cache: bool = True
        self._net_cache_ts: float = 0.0  # monotonic time of last probe
        # CPU % seeding: psutil.cpu_percent(interval=None) needs a prior call.
        self._cpu_seeded: bool = False

    # ── Public API ────────────────────────────────────────────────────────────

    async def start(self) -> None:
        """Start the background sample loop. Idempotent."""
        if self._started and self._task is not None and not self._task.done():
            return
        # Seed the CPU sampler before the first real sample.
        try:
            psutil.cpu_percent(interval=None)
            self._cpu_seeded = True
        except Exception as exc:
            logger.warning("system_monitor: cpu_percent seeding failed: %s", exc)
        self._started = True
        self._task = asyncio.create_task(self._sample_loop(), name="system_monitor")
        logger.info("SystemMonitor: started (interval=%.1fs)", self._interval_s())

    async def stop(self) -> None:
        """Cancel the sample loop and drain history."""
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass
            self._task = None
        self._history.clear()
        self._started = False
        logger.info("SystemMonitor: stopped")

    def current(self) -> ResourceSnapshot | None:
        """Return the most-recent snapshot, or None if the loop hasn't run yet."""
        return self._history[-1] if self._history else None

    def history(self, last_n: int = 60) -> list[ResourceSnapshot]:
        """Return up to ``last_n`` most-recent snapshots (oldest first)."""
        snaps = list(self._history)
        return snaps[-last_n:] if last_n < len(snaps) else snaps

    def pressure(self) -> str:
        """Convenience: current pressure label, or 'unknown' when monitor is off."""
        snap = self.current()
        return snap.pressure_label if snap is not None else "unknown"

    def subscribe(self, cb: Callable[[ResourceSnapshot], None]) -> Callable[[], None]:
        """Register a synchronous callback that fires on every new snapshot.

        Returns an unsubscribe callable.
        """
        self._subscribers.append(cb)

        def _unsub() -> None:
            try:
                self._subscribers.remove(cb)
            except ValueError:
                pass

        return _unsub

    # ── Internal ──────────────────────────────────────────────────────────────

    @staticmethod
    def _interval_s() -> float:
        try:
            from config import config
            return float(getattr(config, "system_monitor_interval_s", 5.0))
        except Exception:
            return 5.0

    async def _sample_loop(self) -> None:
        while True:
            try:
                snap = await self._capture()
                self._history.append(snap)
                # Publish to EventBus
                try:
                    from core.event_bus import event_bus
                    event_bus.emit("resource.snapshot", snap)
                except Exception as exc:
                    logger.debug("system_monitor: event_bus emit failed: %s", exc)
                # Synchronous subscriber callbacks
                for cb in list(self._subscribers):
                    try:
                        cb(snap)
                    except Exception as exc:
                        logger.debug("system_monitor: subscriber callback raised: %s", exc)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("system_monitor: sample error (non-fatal): %s", exc)

            await asyncio.sleep(self._interval_s())

    async def _capture(self) -> ResourceSnapshot:
        now_mono = time.monotonic()
        now_iso = datetime.now(tz=timezone.utc).isoformat()

        # RAM
        mem = psutil.virtual_memory()
        ram_total_mb = int(mem.total / 1024 / 1024)
        ram_available_mb = int(mem.available / 1024 / 1024)
        ram_used_pct = float(mem.percent)

        # Swap
        try:
            swap = psutil.swap_memory()
            swap_used_pct = float(swap.percent)
        except Exception:
            swap_used_pct = 0.0

        # CPU %
        try:
            cpu_pct = float(psutil.cpu_percent(interval=None))
        except Exception:
            cpu_pct = 0.0

        # Load average (1 min)
        try:
            cpu_load_1m = float(psutil.getloadavg()[0])
        except Exception:
            cpu_load_1m = 0.0

        # Disk
        try:
            disk = psutil.disk_usage("/")
            disk_free_gb = disk.free / (1024 ** 3)
            disk_used_pct = disk.percent
        except Exception:
            disk_free_gb = 999.0
            disk_used_pct = 0.0

        # Temperature (async sysfs, may be None)
        cpu_temp_c = await _read_cpu_temp()

        # Throttling heuristic
        try:
            cpu_count = psutil.cpu_count(logical=True) or 1
        except Exception:
            cpu_count = 1
        t = _THRESHOLDS
        cpu_throttling = (
            (cpu_temp_c is not None and cpu_temp_c > t["red_temp_c"])
            or (cpu_load_1m > cpu_count * t["red_load_factor"])
        )

        # Network probe (cached)
        network_up = await self._check_network(now_mono)

        pressure_label = _derive_pressure(
            ram_used_pct=ram_used_pct,
            swap_used_pct=swap_used_pct,
            cpu_pct=cpu_pct,
            cpu_temp_c=cpu_temp_c,
            cpu_throttling=cpu_throttling,
            disk_free_gb=disk_free_gb,
        )

        return ResourceSnapshot(
            ts=now_mono,
            captured_at_iso=now_iso,
            ram_total_mb=ram_total_mb,
            ram_available_mb=ram_available_mb,
            ram_used_pct=ram_used_pct,
            swap_used_pct=swap_used_pct,
            cpu_pct=cpu_pct,
            cpu_load_1m=cpu_load_1m,
            cpu_temp_c=cpu_temp_c,
            cpu_throttling=cpu_throttling,
            disk_free_gb=disk_free_gb,
            disk_used_pct=float(disk_used_pct),
            network_up=network_up,
            pressure_label=pressure_label,
        )

    async def _check_network(self, now_mono: float) -> bool:
        if (now_mono - self._net_cache_ts) >= _NET_PROBE_CACHE_S:
            try:
                self._net_cache = await _probe_network()
            except Exception:
                self._net_cache = False
            self._net_cache_ts = now_mono
        return self._net_cache


# Module-level singleton. Import never triggers IO — call start() explicitly.
system_monitor = SystemMonitor()
