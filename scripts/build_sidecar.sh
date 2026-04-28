#!/usr/bin/env bash
# PHANTOM OS — sidecar build helper (Day-4 Wave-2 V-1 stub).
#
# Per ADR-DSH-001 (`docs/architecture/desktop-shell.md`):
# the Tauri shell expects an external binary at
# `src/frontend/src-tauri/binaries/phantom-backend-<target-triple>` (Tauri's
# convention for `bundle.externalBin`). This script drives PyInstaller
# `--onedir` over `src/backend/main.py:766-778` and copies the output to
# the expected slot. Day-5 takes over signing.
#
# Usage:
#   scripts/build_sidecar.sh                      # auto-detect host triple
#   scripts/build_sidecar.sh aarch64-unknown-linux-gnu

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-$(rustc -vV 2>/dev/null | sed -n 's/host: //p' || echo "x86_64-unknown-linux-gnu")}"
DEST="${ROOT}/src/frontend/src-tauri/binaries"

echo "[V-1 sidecar] target triple: ${TARGET}"
echo "[V-1 sidecar] destination:   ${DEST}/phantom-backend-${TARGET}"
mkdir -p "${DEST}"

# Day-5 will plumb pyinstaller here. Day-4 ships a placeholder so the
# manifest is parseable without a build dependency on PyInstaller.
PLACEHOLDER="${DEST}/phantom-backend-${TARGET}"
if [ ! -f "${PLACEHOLDER}" ]; then
  printf '#!/bin/sh\nexec uvicorn main:app --host 127.0.0.1 --port 8000\n' > "${PLACEHOLDER}"
  chmod +x "${PLACEHOLDER}"
  echo "[V-1 sidecar] wrote dev placeholder (replace with PyInstaller bundle on Day-5)"
fi
