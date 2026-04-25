#!/usr/bin/env bash
# Phase 11c.0 — dist freshness gate.
# Fails if src/frontend/dist/ is older than the latest commit touching
# src/frontend/src/. Catches the Phase 11b failure mode where a stale
# dist masked unbuilt code in production.
set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="$REPO_ROOT/src/frontend/dist"
SRC_DIR="$REPO_ROOT/src/frontend/src"

if [ ! -d "$DIST_DIR" ]; then
  echo "FAIL: $DIST_DIR does not exist." >&2
  echo "  Run: cd src/frontend && npm run build (or: npx vite build)" >&2
  exit 2
fi

DIST_MTIME=$(find "$DIST_DIR" -type f -printf '%T@\n' 2>/dev/null | sort -n | tail -1)
if [ -z "$DIST_MTIME" ]; then
  echo "FAIL: no files found in $DIST_DIR." >&2
  exit 2
fi
DIST_MTIME_INT=${DIST_MTIME%.*}

LAST_SRC_COMMIT=$(git -C "$REPO_ROOT" log -1 --format=%ct -- src/frontend/src 2>/dev/null || true)
if [ -z "$LAST_SRC_COMMIT" ]; then
  echo "WARN: no commits found touching src/frontend/src. Assuming OK." >&2
  exit 0
fi

if [ "$DIST_MTIME_INT" -lt "$LAST_SRC_COMMIT" ]; then
  DIST_DATE=$(date -d "@${DIST_MTIME_INT}" '+%Y-%m-%d %H:%M:%S')
  COMMIT_DATE=$(date -d "@${LAST_SRC_COMMIT}" '+%Y-%m-%d %H:%M:%S')
  echo "FAIL: dist/ is stale." >&2
  echo "  dist last build:      $DIST_DATE" >&2
  echo "  last frontend commit: $COMMIT_DATE" >&2
  echo "  Run: cd src/frontend && npm run build (or: npx vite build)" >&2
  exit 1
fi

echo "OK: dist/ is fresh."
exit 0
