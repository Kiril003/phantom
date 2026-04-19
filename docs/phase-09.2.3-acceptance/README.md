# Phase 9.2.3 — Partial Acceptance (Session 1 Recovery)

- **Date:** 2026-04-19
- **Branch:** `autonomous-run`
- **Base tag:** `v0.9.2.2-resilience-real` (b8ee745)
- **Target tag:** `v0.9.2.3-partial`
- **Status:** **PARTIAL** — previous session crashed mid-work. This commit set restores the four code changes that were on disk via stash and locks them in with regression tests. Parts 2–4 of the original 9.2.3 plan are deferred to session 2.

## Fixes included this session

| ID | Title | Commit | Type |
|---|---|---|---|
| F-07 | `time.wait` polls `runtime.controls.{emergency_stop,pause_event}` (was reading non-existent direct attrs, so Pause/STOP never interrupted a wait) | 8f4f154 | impl + 3 tests |
| F-06 | Regression lock-in: `strategic.plan` propagates `BlockedQuotaError` untouched (class-hierarchy guarantee from 9.2.2 F-02) | 8f4f154 | test-only |
| F-11 | Thread `task_id` through `tactical._legacy_plan` so non-native-tool-calling path participates in per-task LLM-call budget | 8f4f154 | impl + 1 test |
| F-08 | `ControlsBar` keeps STOP + Intervene reachable when status is `blocked_quota` (was hiding every button, stranding operator) | 3fbc873 | impl + 1 test |

## Test delta

| Suite | Baseline (v0.9.2.2) | This session | Delta |
|---|---|---|---|
| Backend (pytest) | 457 | **462 passed** | +5 |
| Frontend (vitest) | 129 | **130 passed** | +1 |

All green, no flakes observed during the session.

## Verification

- `cd src/backend && .venv/bin/pytest tests/test_phase09_2_3_time_wait.py -v` → 5 passed
- `cd src/backend && .venv/bin/pytest -q` → 462 passed in 122.49s
- `cd src/frontend && npx vitest run src/__tests__/ControlsBar.test.tsx` → 4 passed
- `cd src/frontend && npx vitest run` → 130 passed in 32.21s

## Deferred to session 2

### Audit HIGH not addressed
- F-09 (MED): `cancel_step` no-op for in-flight actions
- F-10 (MED): dual-write inconsistency
- F-12 (MED): `_request` not safe for concurrent
- F-13 (MED): already fixed in 9.2.2 F-04 — no action planned, but row needs status update in audit README

### Original 9.2.3 parts not executed
- **Part 2** — Live resilience verification (quota-probe live run with Ukrainian goal)
- **Part 3** — Focused 9.2.2 mini-audit (6 questions, `docs/phase-09.2.3-audit-delta/README.md`)
- **Part 4** — 2–3 MEDIUM findings touching 9.3 (M-14 blocked_quota substate, M-15 audit row for call_budget_exhausted, M-17 consent timeout — candidates, not started)
- **Final tag** `v0.9.2.3-cleanup` replaced with partial tag `v0.9.2.3-partial`

## Reason for split

Previous autonomous session hit a file-write failure and crashed with partial work in git stash. This recovery extracted the stashed work, verified it behaves as audited, landed the tests that were missing from the stash, and committed in logical chunks — without expanding scope. Session 2 will pick up at Part 2 (live quota probe) against a clean base.

## Hard-don'ts honoured

- No new findings introduced beyond the stash contents.
- No live-API test run (min_interval not touched — no settings to reset).
- No refactoring or 9.3 scope.
- No tag named `v0.9.2.3-cleanup` — reserved for the session that completes all parts.
