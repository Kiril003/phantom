#!/usr/bin/env bash
# The Memory Covenant — start/stop/status the local-inference guard.
#
# The backend talks to :11435 (this proxy), never to Ollama's :11434 directly.
# Every request that could pull weights into RAM is rewritten to unload the model
# the instant it finishes, with a hard ceiling on the context window.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/src/ollama-covenant/target/release/ollama-covenant"
LOG="/tmp/ollama-covenant.log"

export COVENANT_BIND="${COVENANT_BIND:-127.0.0.1:11435}"
export COVENANT_UPSTREAM="${COVENANT_UPSTREAM:-http://127.0.0.1:11434}"
# 4096 fits a 3B model's KV cache comfortably on an 11 GB board.
export COVENANT_NUM_CTX="${COVENANT_NUM_CTX:-4096}"
export COVENANT_KEEP_ALIVE_S="${COVENANT_KEEP_ALIVE_S:-0}"
export COVENANT_IDLE_GRACE_MS="${COVENANT_IDLE_GRACE_MS:-10000}"
export COVENANT_SWEEP_MS="${COVENANT_SWEEP_MS:-5000}"

pid_of() { pgrep -x ollama-covenant 2>/dev/null | head -1; }

case "${1:-start}" in
  start)
    if [ -n "$(pid_of)" ]; then echo "covenant already bound (pid $(pid_of))"; exit 0; fi
    [ -x "$BIN" ] || { echo "not built — cargo build --release in src/ollama-covenant" >&2; exit 1; }
    setsid "$BIN" >"$LOG" 2>&1 </dev/null &
    sleep 1
    echo "covenant bound on $COVENANT_BIND → $COVENANT_UPSTREAM (pid $(pid_of)); log: $LOG"
    ;;
  stop)
    PID="$(pid_of)"
    [ -n "$PID" ] && kill "$PID" && echo "covenant released (pid $PID)" || echo "covenant not running"
    ;;
  status)
    curl -s -m 3 "http://${COVENANT_BIND}/covenant/status" | python3 -m json.tool 2>/dev/null \
      || echo "covenant not answering on $COVENANT_BIND"
    ;;
  *)
    echo "usage: $0 {start|stop|status}" >&2; exit 2
    ;;
esac
