#!/usr/bin/env bash
# PHANTOM OS — Start Dev Environment (frontend + backend)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== PHANTOM OS Dev ==="

# Check for tmux / run in background
if command -v tmux &>/dev/null && [ -z "${TMUX:-}" ]; then
    echo "Starting in tmux session 'phantom-dev'..."
    tmux new-session -d -s phantom-dev -n backend \
        "cd $ROOT/src/backend && source .venv/bin/activate && uvicorn main:app --reload --host 0.0.0.0 --port 8000 2>&1 | tee $ROOT/backend.log"
    tmux new-window -t phantom-dev -n frontend \
        "cd $ROOT/src/frontend && npm run dev 2>&1 | tee $ROOT/frontend.log"
    tmux attach -t phantom-dev
else
    # Fallback: run backend in background, frontend in foreground
    echo "Starting backend (background)..."
    cd "$ROOT/src/backend"
    if [ -d ".venv" ]; then
        source .venv/bin/activate
    fi
    uvicorn main:app --reload --host 0.0.0.0 --port 8000 &
    BACKEND_PID=$!
    echo "Backend PID: $BACKEND_PID"

    echo "Starting frontend..."
    cd "$ROOT/src/frontend"
    npm run dev

    # Cleanup on exit
    kill $BACKEND_PID 2>/dev/null || true
fi
