# PHANTOM OS Watchdog

Out-of-process memory watchdog for the PHANTOM daemon (`uvicorn main:app`).

Runs as a separate process (ideally via systemd). Reads `~/.phantom/daemon.pid`
every 10 seconds and monitors the daemon's RSS. If the daemon exceeds 80 % of
host total RAM for 3 consecutive samples it SIGTERMs the heaviest child process
to shed load. The watchdog **never** targets the daemon process itself.

## Requirements

```
pip install psutil   # already in requirements.txt
```

## Files

| Path | Purpose |
|------|---------|
| `~/.phantom/daemon.pid` | Written by the daemon on startup (main.py lifespan) |
| `~/.phantom/watchdog.log` | Watchdog activity log (rotated manually or via logrotate) |
| `~/.phantom/watchdog-incident.json` | Written when the daemon disappears for >60 s |

## systemd unit

Create `/etc/systemd/system/phantom-watchdog.service`:

```ini
[Unit]
Description=PHANTOM OS Memory Watchdog
After=phantom.service
BindsTo=phantom.service

[Service]
Type=simple
User=radxa
ExecStart=/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/.venv/bin/python \
    /home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/scripts/phantom-watchdog.py
Restart=on-failure
RestartSec=5s
StandardOutput=append:/home/radxa/.phantom/watchdog.log
StandardError=append:/home/radxa/.phantom/watchdog.log

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now phantom-watchdog.service
sudo systemctl status phantom-watchdog.service
```

## Tuning

Edit the constants at the top of `phantom-watchdog.py`:

| Constant | Default | Meaning |
|----------|---------|---------|
| `_PROBE_INTERVAL_S` | 10 | Seconds between RSS samples |
| `_RAM_THRESHOLD_PCT` | 80 | Daemon RSS % of host total RAM to trigger kill |
| `_CONSECUTIVE_SAMPLES_BEFORE_KILL` | 3 | How many samples above threshold before killing |
| `_DAEMON_GONE_TIMEOUT_S` | 60 | Seconds without a readable `/proc/<pid>` before writing incident + exiting |

## Troubleshooting

**Watchdog exits immediately with rc=1:**
The daemon PID file was not written. Check that `~/.phantom/daemon.pid` exists
after starting the daemon. The lifespan hook in `main.py` writes it; if the
daemon crashes before reaching that point, fix the daemon startup error first.

**`watchdog-incident.json` appeared:**
The daemon process disappeared for more than 60 seconds. Check `journalctl -u
phantom.service` for the crash reason. The watchdog exits with rc=1 so systemd
restarts it (after the daemon restarts and re-writes the PID file).

**`SIGTERM failed for pid=... PermissionError`:**
The watchdog is running as a different user than the child process. Run both
under the same system user, or grant the watchdog `CAP_KILL` via the systemd
unit (`AmbientCapabilities=CAP_KILL`).

**High CPU from watchdog:**
The watchdog sleeps between probes — idle CPU should be below 0.1 %. If it is
higher, check that `psutil.Process.children(recursive=True)` is not iterating
a very large process tree (unlikely on Radxa but possible if Blender renders
spawn many workers).
