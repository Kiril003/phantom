#!/usr/bin/env python3
"""
PHANTOM OS — out-of-process memory watchdog.

Reads ~/.phantom/daemon.pid every 10 seconds and monitors the daemon's
resident memory. If the daemon's RSS exceeds 80 % of total host RAM for
3 consecutive samples it SIGTERMs the heaviest child process (not the
daemon itself) to shed load.

Install via systemd — see phantom-watchdog.README.md for the unit file.

Hard rule: the watchdog NEVER targets the daemon PID itself.
           `if pid == daemon_pid: continue` is enforced at every kill site.

No FastAPI / uvicorn imports — this script runs as a separate process.
Only stdlib + psutil.
"""
from __future__ import annotations

import json
import logging
import os
import signal
import sys
import time
from pathlib import Path

import psutil

# ── Configuration ─────────────────────────────────────────────────────────────
_PID_FILE = Path.home() / ".phantom" / "daemon.pid"
_LOG_FILE = Path.home() / ".phantom" / "watchdog.log"
_INCIDENT_FILE = Path.home() / ".phantom" / "watchdog-incident.json"

_PROBE_INTERVAL_S: float = 10.0          # seconds between samples
_RAM_THRESHOLD_PCT: float = 80.0         # % of host total RAM
_CONSECUTIVE_SAMPLES_BEFORE_KILL: int = 3
_DAEMON_GONE_TIMEOUT_S: float = 60.0    # seconds before writing incident + exit

# ── Logging setup ─────────────────────────────────────────────────────────────
_LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [watchdog] %(levelname)s: %(message)s",
    handlers=[
        logging.FileHandler(str(_LOG_FILE)),
        logging.StreamHandler(sys.stdout),
    ],
)
logger = logging.getLogger("phantom.watchdog")


# ── Helpers ───────────────────────────────────────────────────────────────────

def _read_daemon_pid() -> int | None:
    """Return daemon PID from the PID file, or None if unavailable."""
    try:
        raw = _PID_FILE.read_text().strip()
        return int(raw)
    except Exception as exc:
        logger.debug("PID file unreadable: %s", exc)
        return None


def _process_alive(pid: int) -> bool:
    """Return True if /proc/<pid> is readable (process is alive)."""
    return Path(f"/proc/{pid}").exists()


def _host_total_ram_mb() -> int:
    """Return host total RAM in MB via psutil."""
    return int(psutil.virtual_memory().total / 1024 / 1024)


def _daemon_rss_mb(daemon_pid: int) -> int | None:
    """Return daemon RSS in MB, or None if the process is gone."""
    try:
        return int(psutil.Process(daemon_pid).memory_info().rss / 1024 / 1024)
    except (psutil.NoSuchProcess, psutil.AccessDenied):
        return None


def _heaviest_child(daemon_pid: int) -> psutil.Process | None:
    """Return the child process with the highest RSS, excluding the daemon itself."""
    try:
        children = psutil.Process(daemon_pid).children(recursive=True)
    except (psutil.NoSuchProcess, psutil.AccessDenied):
        return None
    candidates: list[tuple[int, psutil.Process]] = []
    for child in children:
        if child.pid == daemon_pid:
            # Hard gate: never target the daemon itself.
            continue
        try:
            rss = child.memory_info().rss
            candidates.append((rss, child))
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    if not candidates:
        return None
    candidates.sort(key=lambda t: t[0], reverse=True)
    return candidates[0][1]


def _kill_heaviest_child(daemon_pid: int) -> bool:
    """SIGTERM the heaviest child of the daemon. Returns True if a kill was sent."""
    target = _heaviest_child(daemon_pid)
    if target is None:
        logger.warning("No killable child processes found for daemon pid=%d", daemon_pid)
        return False
    # Final hard gate before sending the signal.
    if target.pid == daemon_pid:
        logger.error(
            "BUG: kill candidate is the daemon itself (pid=%d) — skipping", daemon_pid
        )
        return False
    try:
        rss_mb = int(target.memory_info().rss / 1024 / 1024)
        name = target.name()
    except Exception:
        rss_mb = -1
        name = "unknown"
    logger.warning(
        "Sending SIGTERM to heaviest child: pid=%d name=%s rss=%dMB",
        target.pid, name, rss_mb,
    )
    try:
        os.kill(target.pid, signal.SIGTERM)
        return True
    except (ProcessLookupError, PermissionError) as exc:
        logger.error("SIGTERM failed for pid=%d: %s", target.pid, exc)
        return False


def _write_incident(daemon_pid: int, last_rss_mb: int | None) -> None:
    """Write a watchdog-incident.json file when the daemon disappears."""
    incident = {
        "timestamp_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "daemon_pid": daemon_pid,
        "last_known_rss_mb": last_rss_mb,
        "reason": "daemon_pid_unreadable_60s",
        "action": "watchdog_exiting_rc1",
    }
    try:
        _INCIDENT_FILE.write_text(json.dumps(incident, indent=2))
        logger.error(
            "Incident written to %s — daemon pid=%d has been gone for %.0fs. "
            "Watchdog exiting (rc=1). systemd will restart it if configured.",
            _INCIDENT_FILE, daemon_pid, _DAEMON_GONE_TIMEOUT_S,
        )
    except Exception as exc:
        logger.error("Failed to write incident file: %s", exc)


# ── Main loop ─────────────────────────────────────────────────────────────────

def main() -> int:
    logger.info(
        "PHANTOM watchdog starting. PID file: %s  threshold: %.0f%%  "
        "probe_interval: %.1fs  kill_after: %d consecutive samples",
        _PID_FILE, _RAM_THRESHOLD_PCT, _PROBE_INTERVAL_S,
        _CONSECUTIVE_SAMPLES_BEFORE_KILL,
    )

    # Wait for the PID file to appear (daemon may not have started yet).
    wait_start = time.monotonic()
    daemon_pid: int | None = None
    while daemon_pid is None:
        daemon_pid = _read_daemon_pid()
        if daemon_pid is None:
            if time.monotonic() - wait_start > _DAEMON_GONE_TIMEOUT_S:
                logger.error(
                    "PID file %s never appeared after %.0fs — giving up",
                    _PID_FILE, _DAEMON_GONE_TIMEOUT_S,
                )
                return 1
            time.sleep(_PROBE_INTERVAL_S)

    logger.info("Attached to daemon pid=%d", daemon_pid)

    consecutive_over_threshold: int = 0
    last_rss_mb: int | None = None
    daemon_gone_since: float | None = None

    while True:
        time.sleep(_PROBE_INTERVAL_S)

        # ── Re-read PID file in case the daemon restarted ──────────────────
        fresh_pid = _read_daemon_pid()
        if fresh_pid is not None and fresh_pid != daemon_pid:
            logger.info(
                "Daemon PID changed: %d → %d (restart detected)",
                daemon_pid, fresh_pid,
            )
            daemon_pid = fresh_pid
            consecutive_over_threshold = 0
            daemon_gone_since = None

        # ── Check if daemon is still alive ─────────────────────────────────
        if not _process_alive(daemon_pid):
            if daemon_gone_since is None:
                daemon_gone_since = time.monotonic()
                logger.warning("Daemon pid=%d is gone — waiting %.0fs before incident",
                               daemon_pid, _DAEMON_GONE_TIMEOUT_S)
            elif time.monotonic() - daemon_gone_since >= _DAEMON_GONE_TIMEOUT_S:
                _write_incident(daemon_pid, last_rss_mb)
                return 1
            # Keep sleeping while the grace window ticks down.
            continue

        # Daemon is alive — reset the gone timer.
        daemon_gone_since = None

        # ── Measure daemon RSS ─────────────────────────────────────────────
        rss_mb = _daemon_rss_mb(daemon_pid)
        if rss_mb is None:
            logger.debug("daemon_rss_mb returned None for pid=%d — skipping sample", daemon_pid)
            continue
        last_rss_mb = rss_mb

        total_mb = _host_total_ram_mb()
        rss_pct = (rss_mb / total_mb * 100.0) if total_mb > 0 else 0.0

        logger.debug(
            "probe: daemon_rss=%dMB total_ram=%dMB usage=%.1f%%  consecutive_over=%d",
            rss_mb, total_mb, rss_pct, consecutive_over_threshold,
        )

        if rss_pct > _RAM_THRESHOLD_PCT:
            consecutive_over_threshold += 1
            logger.warning(
                "Daemon RSS %.1f%% > threshold %.1f%% (sample %d/%d)",
                rss_pct, _RAM_THRESHOLD_PCT,
                consecutive_over_threshold, _CONSECUTIVE_SAMPLES_BEFORE_KILL,
            )
            if consecutive_over_threshold >= _CONSECUTIVE_SAMPLES_BEFORE_KILL:
                logger.warning(
                    "Threshold exceeded for %d consecutive samples — killing heaviest child",
                    consecutive_over_threshold,
                )
                killed = _kill_heaviest_child(daemon_pid)
                if killed:
                    # Reset counter so we don't immediately re-kill on the next probe.
                    consecutive_over_threshold = 0
                else:
                    logger.info("No child killed — counter reset to avoid spin-kill")
                    consecutive_over_threshold = 0
        else:
            if consecutive_over_threshold > 0:
                logger.info(
                    "Daemon RSS %.1f%% back below threshold — resetting counter",
                    rss_pct,
                )
            consecutive_over_threshold = 0


if __name__ == "__main__":
    sys.exit(main())
