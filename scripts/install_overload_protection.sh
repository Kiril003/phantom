#!/usr/bin/env bash
# Overload protection for PHANTOM OS on Radxa Dragon Q6A.
#
# Why: Linux kernel OOM-killer is too slow on ARM SBCs — when RAM runs
# out the system freezes hard enough that the watchdog reboots the
# board. This script installs three counter-measures:
#
#   1. earlyoom   — graceful userspace killer that fires before kernel
#                   OOM, preventing the freeze entirely.
#   2. Ollama     — systemd drop-in caps memory + auto-unloads models
#                   60s after last fallback request.
#   3. phantom-backend.service (optional, NOT enabled by default) —
#                   provides MemoryHigh/MemoryMax cgroups for prod;
#                   dev workflow via `scripts/dev.sh` is unaffected.
#
# Run: sudo bash scripts/install_overload_protection.sh
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Re-running with sudo..." >&2
  exec sudo -E bash "$0" "$@"
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
echo ">> repo: $REPO_ROOT"

# ── 1. earlyoom ─────────────────────────────────────────────────────────────
echo ">> [1/3] earlyoom"
if ! command -v earlyoom >/dev/null; then
  apt-get update -qq
  apt-get install -y earlyoom
fi

# Tune: kill at 8% free RAM or 10% free swap, retry every 60s.
# Avoid killing init / systemd / sshd. Prefer killing Ollama / Whisper /
# Chrome / Firefox before the backend itself.
cat >/etc/default/earlyoom <<'EARLYOOM_CONF'
EARLYOOM_ARGS="-m 8 -s 10 -r 60 --avoid ^(init|systemd|sshd|uvicorn|python)$ --prefer ^(ollama|whisper|gemma|chrome|firefox|node)$"
EARLYOOM_CONF

systemctl enable earlyoom >/dev/null 2>&1 || true
systemctl restart earlyoom
echo "   earlyoom: $(systemctl is-active earlyoom)"

# ── 2. Ollama drop-in ───────────────────────────────────────────────────────
echo ">> [2/3] ollama drop-in"
mkdir -p /etc/systemd/system/ollama.service.d
cat >/etc/systemd/system/ollama.service.d/phantom-tuning.conf <<'OLLAMA_CONF'
[Service]
# Drop the cached model 60s after last call (Gemma 4 27B = ~4 GB).
# Backend uses Ollama only as Gemini fallback so keep-alive is short.
Environment=OLLAMA_KEEP_ALIVE=60s
Environment=OLLAMA_MAX_LOADED_MODELS=1
Environment=OLLAMA_NUM_PARALLEL=1

# Hard cap so a runaway inference cannot starve the rest of the system.
MemoryHigh=4G
MemoryMax=5G
OLLAMA_CONF

systemctl daemon-reload
systemctl restart ollama
echo "   ollama: $(systemctl is-active ollama)"

# ── 3. phantom-backend.service (optional) ───────────────────────────────────
echo ">> [3/3] phantom-backend.service (installed, NOT enabled — start manually with: systemctl start phantom-backend)"
cat >/etc/systemd/system/phantom-backend.service <<UNIT
[Unit]
Description=PHANTOM OS backend (FastAPI + ContextEngine)
After=network-online.target ollama.service
Wants=network-online.target

[Service]
Type=simple
User=radxa
Group=radxa
WorkingDirectory=$REPO_ROOT/src/backend
ExecStart=$REPO_ROOT/src/backend/.venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000
Restart=on-failure
RestartSec=5

# Memory budget — total RAM is 11G, leave 3G for OS + Ollama spikes.
MemoryHigh=6G
MemoryMax=8G

# Slightly higher OOM score so earlyoom prefers backend over ollama
# only as a last resort (ollama's huge resident set is killed first).
OOMScoreAdjust=100

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
echo "   phantom-backend.service: installed (run: sudo systemctl enable --now phantom-backend)"

# ── Summary ────────────────────────────────────────────────────────────────
echo ""
echo ">> done. State:"
echo "   earlyoom         : $(systemctl is-active earlyoom)"
echo "   ollama           : $(systemctl is-active ollama)"
echo "   phantom-backend  : $(systemctl is-active phantom-backend 2>/dev/null || echo inactive)"
echo ""
echo ">> verify earlyoom is watching:"
echo "   journalctl -u earlyoom -n 20 --no-pager"
echo ""
echo ">> if you want backend under cgroup limits too:"
echo "   sudo systemctl enable --now phantom-backend"
