#!/usr/bin/env bash
# The backend gate. Creates the venv it needs, then runs the suite.
#
# Why this exists: the documented gate is `.venv/bin/python -m pytest`, and the
# venv it means lives at src/backend/.venv — not at the repo root, where it is
# easy to look, fail to find one, and conclude there is none. It also needs
# PHANTOM_SKIP_G2_WARMUP=1 and PYTHONPATH set, neither of which is written down
# anywhere. Run it wrong and you get failures that look like defects.
#
# None of which was the real problem: the suite ran fine and nobody ran it. A
# moved splash file, a planner silently downgraded to a weak model and a licence
# test guarding a route that never existed all sat red for a day. One command
# with no arguments and no setup is the point.
#
#   ./scripts/test.sh                 # whole suite
#   ./scripts/test.sh tests/test_x.py # one file, same environment
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/src/backend"
VENV="$BACKEND/.venv"

# pydantic 2.8.2 ships no wheel for 3.13+ and its Rust core will not build
# without a toolchain; the project targets 3.11. Refusing loudly beats a venv
# that installs and then fails 46 tests for reasons that look like defects.
find_python() {
  for c in python3.11 python3.12 python3; do
    p="$(command -v "$c" 2>/dev/null)" || continue
    "$p" -c 'import sys; sys.exit(0 if (3,11) <= sys.version_info < (3,13) else 1)' 2>/dev/null && { echo "$p"; return 0; }
  done
  return 1
}

if [ ! -x "$VENV/bin/python" ]; then
  PY="$(find_python)" || {
    echo "потрібен Python 3.11 або 3.12 — знайдено лише $(python3 -V 2>&1)" >&2
    echo "  pydantic 2.8.2 не збирається під 3.13+, а проєкт цілиться в 3.11" >&2
    exit 1
  }
  echo "→ створюю $VENV ($("$PY" -V 2>&1)) — перший запуск довгий, там ML-стек"
  "$PY" -m venv "$VENV" || exit 1
  "$VENV/bin/pip" install -q --upgrade pip
  "$VENV/bin/pip" install -r "$BACKEND/requirements.txt" || {
    echo "встановлення залежностей не пройшло — venv лишаю для розбору" >&2
    exit 1
  }
fi

cd "$BACKEND" || exit 1
# G2 warms models on import and costs minutes the suite does not need.
exec env PHANTOM_SKIP_G2_WARMUP=1 PYTHONPATH="$BACKEND" \
  "$VENV/bin/python" -m pytest "${@:-tests/}" -q
