#!/usr/bin/env bash
# Phase 11c.0 — consumer-of-hook gate.
# Fails if any hook in src/frontend/src/hooks/use*.ts has no production
# consumer (counted as: file outside the hook itself, outside __tests__,
# outside *.test.* / *.spec.* that imports the hook by basename).
#
# Catches Phase 11b's dead useVoiceAlwaysOn: a hook that compiled, type-
# checked, and was unit-tested but was never imported into a layout, so
# the always-on path never mounted.
set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOKS_DIR="$REPO_ROOT/src/frontend/src/hooks"
SRC_DIR="$REPO_ROOT/src/frontend/src"

if [ ! -d "$HOOKS_DIR" ]; then
  echo "WARN: $HOOKS_DIR not found, skipping." >&2
  exit 0
fi

failed=0

for hook_file in "$HOOKS_DIR"/use*.ts "$HOOKS_DIR"/use*.tsx; do
  [ -e "$hook_file" ] || continue
  hook_name=$(basename "$hook_file")
  hook_name="${hook_name%.tsx}"
  hook_name="${hook_name%.ts}"

  consumers=$(grep -rln "from ['\"][^'\"]*${hook_name}['\"]" "$SRC_DIR" 2>/dev/null \
    | grep -v "$hook_file" \
    | grep -v "__tests__" \
    | grep -v "\.test\." \
    | grep -v "\.spec\." || true)

  if [ -z "$consumers" ]; then
    echo "FAIL: $hook_name has no production consumer." >&2
    echo "  Defined: $hook_file" >&2
    echo "  Either import it from a component/layout/page, delete it, or move it under /experiments/." >&2
    failed=1
  fi
done

if [ $failed -eq 1 ]; then
  exit 1
fi

echo "OK: every hook has a production consumer."
exit 0
