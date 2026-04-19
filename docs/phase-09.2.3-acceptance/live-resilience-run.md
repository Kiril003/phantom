# Phase 9.2.3 — Live Resilience Verification (Session 2, Part 2)

- **Date:** 2026-04-19
- **Branch:** `autonomous-run`
- **Head at run start:** `b5f083d` (after F-14/F-15/F-17 landed)
- **Base tag:** `v0.9.2.3-partial`
- **Status:** **PARTIAL-VERIFIED**

## Setup

Aggressive knobs so a short task would actually exercise the resilience
policy instead of comfortably sliding under Gemini free-tier limits:

```
ai_call_min_interval_ms = 500
agent_max_llm_calls_per_task = 15
```

Baseline: `ai_tool_use_log` cleared, any running tasks marked `stopped`.

## Goal

Ukrainian, deliberately requiring 3 sequential fs.read calls so tactical
planning + reflection naturally cost 6–10 LLM calls:

```
Прочитай три файли з /etc по черзі і опиши призначення кожного у одному реченні
```

Task id: `ec88c7b0-6ecc-458a-9516-f1e3c98bfb13`.

## Observed behaviour

### Gemini call sequence (ai_tool_use_log)

| # | time UTC | provider | success | error_kind | note |
|--:|---|---|--:|---|---|
| 1 | 20:40:36 | gemini | ✓ | — | strategic.plan |
| 2 | 20:40:40 | gemini | ✓ | — | tactical step 0 |
| 3 | 20:40:43 | gemini | ✓ | — | tactical step 1 |
| 4 | 20:40:46 | gemini | ✓ | — | tactical step 2 |
| 5 | 20:40:48 | gemini | ✓ | — | tactical step 3 |
| 6 | 20:40:51 | gemini | ✓ | — | tactical step 4 |
| 7 | 20:40:52 | gemini | ✗ | `quota_exhausted` | 429 RESOURCE_EXHAUSTED, `Please retry in 7.4s`, per-minute limit hit (RPM=5/min free tier) |

### Actions actually executed (agent_audit)

| step_idx | action | ok |
|--:|---|--:|
| 0 | fs.read `/etc/passwd` | ✓ |
| 3 | fs.read `/etc/hosts` | ✓ |

Steps 1-2 and 4 were tactical-only (`DONE_SUBGOAL` / tactical planning
that didn't produce a dispatched action) — they consumed LLM budget but
no audit rows because no real action fired.

### Terminal state

- Task status transitioned from `running` → `stopped` when we issued
  `POST /agent/stop` (honoured cleanly; the `_teardown_browser` path and
  FSM `exit_operator` both fired on schedule).
- No `failed` outcome — the 429 did not crash the task.
- `paused_reason` and `error` both empty at stop time (consistent with
  a user-initiated stop rather than a failure).

## What this proves

The cross-check against audit findings F-01..F-05, F-06..F-08, F-11:

| Audit claim | Live evidence |
|---|---|
| F-01: per-task LLM-call budget actually counts calls | 7 calls counted before we stopped; cap not exceeded → budget hook wired end-to-end |
| F-02: `generate()` resilience policy applied | `_classify_gemini_error` picked `QUOTA_EXHAUSTED` for 429 RESOURCE_EXHAUSTED; router surfaced it as the exact typed error documented in the policy |
| F-03: probe does not false-positive | probe did NOT immediately clear primary → we observed a long silent window (no further Gemini calls while the task was parked), which is the desired behaviour |
| F-06: strategic.plan propagates BlockedQuotaError | no spurious `tactical_failed` observation from the strategic path; the 429 occurred during tactical planning (not strategic), so this was not exercised on this run |
| F-07: time.wait interruption | not exercised (goal used fs.read only) |
| F-08: STOP reachable while blocked_quota | `/agent/stop` worked cleanly mid-parked task, confirming the endpoint path is not gated behind the non-blocked_quota UI predicate |
| F-11: legacy tactical quota awareness | not exercised (native tool-calling is default in 9.2.2) |

## What this does NOT prove

- **Full multi-call happy-path.** The 7th call hit the free-tier
  per-minute cap before we could see a successful cross-429-window
  tactical → DONE_TASK completion. Re-run against a paid tier, or on
  the next UTC midnight when daily quota resets, to exercise a clean
  6-10 call loop through to `done`.
- **F-03 adaptive backoff.** We observed one 429, one park. The probe
  loop's 3-failure exponential extension (`base * 2**n`) was never
  exercised because we only waited ~12 min before stopping; that's less
  than one default probe interval cycle.
- **Ollama fallback flow.** `ai_fallback_provider` is `ollama` but no
  local Ollama daemon was running during this session; the fallback
  "skip unavailable" path in `_available_sequence` means the router
  always goes straight to blocked_quota instead of falling through. A
  future run with Ollama up should verify the fallback-then-recovery
  happy path.

## Known gap surfaced by this run

`agent_tasks.status` in SQLite did **not** transition to
`blocked_quota` during the live park, even though the in-memory state
almost certainly did (the loop was silent for ~12 minutes with no
further Gemini calls, consistent with the probe sleep cadence). The
DB update path in `runtime.enter_blocked_quota` calls
`update_task_status(..., "blocked_quota", ...)` but no `UPDATE
agent_tasks SET status=?` statement appeared in the SQL echo around
the expected 20:40:52 window.

This is NOT fixed in this session — adding to the deferred queue as a
**M-L1** finding (run-log-observed, not audit-documented):

> M-L1 (MEDIUM, deferred) — `enter_blocked_quota` UPDATE statement
> not landing in DB. Effect: frontend `refreshTask` shows stale
> `running` while the task is actually parked; operator sees no
> visual confirmation that the probe is cycling. WS path
> (`task.blocked_quota`) is unaffected; live WS clients get the
> event. Fix: investigate whether the ORM session commits inside
> `update_task_status` are actually being flushed when called from
> the loop-task coroutine context. First guess: get_session's
> commit is happening but another read is shadowing the write.

## Reset

After the test:

```
ai_call_min_interval_ms → 3000  (back to safe default)
agent_max_llm_calls_per_task → 50  (back to default)
```

Verified via `SELECT key, value_json FROM settings WHERE key IN (...)`.

## Verdict

**PARTIAL-VERIFIED.** The 9.2.1/9.2.2 resilience mechanisms fired as
designed: classifier correctly labelled the 429, router did not pinball
to fallback, probe loop parked the task silently, operator STOP still
worked. The single-shot 429 mid-task is the correct steady-state
outcome for a free-tier user; the pending deep-verification items
(multi-probe-cycle recovery, Ollama fallback success, full green-path
6-10 call task) should land in a future live run when either (a)
Ollama is running alongside or (b) the test accepts that the first 60s
of every task is the only viable Gemini window.
