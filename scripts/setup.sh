#!/usr/bin/env bash
# PHANTOM OS — Full Environment Setup
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== PHANTOM OS Setup ==="
echo "Root: $ROOT"

# ── Frontend ─────────────────────────────────────────────────────────────────
echo ""
echo "--- Frontend: npm install ---"
cd "$ROOT/src/frontend"
npm install

# ── Backend ───────────────────────────────────────────────────────────────────
echo ""
echo "--- Backend: Python venv + pip install ---"
cd "$ROOT/src/backend"

if [ ! -d ".venv" ]; then
    python3 -m venv .venv
fi

source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

echo ""
echo "--- Backend: DB init ---"
python -c "
import asyncio
import sys
sys.path.insert(0, '.')
from db.database import init_db
asyncio.run(init_db())
print('DB initialized')
"

deactivate

# ── Data dirs ─────────────────────────────────────────────────────────────────
echo ""
echo "--- Creating data directories ---"
mkdir -p /data
mkdir -p "$ROOT/chroma_data"
mkdir -p "$ROOT/ghost_data"

echo ""
echo "=== Setup complete ==="
echo ""
echo "Start dev: ./scripts/dev.sh"
echo "Flash ESP32: cd src/firmware && pio run -t upload"
