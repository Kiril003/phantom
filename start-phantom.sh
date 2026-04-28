#!/bin/bash
# Restart PHANTOM backend + frontend with latest code
# Usage: ./start-phantom.sh

set -e
PROJECT="$HOME/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os"

echo "==> Stopping old processes..."
pkill -9 -f "uvicorn main:app" 2>/dev/null || true
pkill -9 -f "vite" 2>/dev/null || true
pkill -9 -f "npm.*dev" 2>/dev/null || true
sleep 3

echo "==> Verifying clean..."
pgrep -af uvicorn && echo "WARN: uvicorn still running" || echo "OK: uvicorn stopped"
pgrep -af vite && echo "WARN: vite still running" || echo "OK: vite stopped"

echo "==> Starting backend..."
cd "$PROJECT/src/backend"
nohup .venv/bin/uvicorn main:app > /tmp/phantom-backend.log 2>&1 &
BACKEND_PID=$!
echo "Backend PID: $BACKEND_PID"

echo "==> Waiting for backend (15s)..."
sleep 15

echo "==> Verifying backend health..."
curl -s http://127.0.0.1:8000/health | head -c 100
echo ""

echo "==> Starting frontend (vite)..."
cd "$PROJECT/src/frontend"
nohup npm run dev > /tmp/phantom-frontend.log 2>&1 &
FRONTEND_PID=$!
echo "Frontend PID: $FRONTEND_PID"

echo "==> Waiting for vite (10s)..."
sleep 10

echo "==> Done."
echo ""
echo "Backend:  http://127.0.0.1:8000"
echo "Frontend: http://localhost:5173 (or :5174 if 5173 busy)"
echo ""
echo "Logs:"
echo "  tail -f /tmp/phantom-backend.log"
echo "  tail -f /tmp/phantom-frontend.log"
echo ""
echo "Current commit:"
cd "$PROJECT" && git log --oneline -1
