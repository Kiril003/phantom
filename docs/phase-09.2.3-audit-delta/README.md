# Phase 9.2.3 — 9.2.2 Mini-Audit (Session 2, Part 3)

Read-only focused audit of the ~3,600 lines that 9.2.2 added across
resilience extraction, MCP hardening, budget threading, blocked_quota
probe rework. Guiding question: does 9.2.2 introduce anything that 9.3
(proactive, emotion vector, standing orders, inner monologue channel)
will build on unsafely?

Time spent: ~35 minutes. Scope: the 6 questions in the session spec,
plus one additional finding surfaced by the live resilience run.

## Scope recap

Commits: `38375b4`, `17f006c`, `6d2f4d5`, `5af9ded` (F-01..F-05) +
`b8ee745` (9.2.2 acceptance).

Files re-read:
- `ai/provider.py` (577 lines — biggest change)
- `ai/ollama_provider.py` (classification additions)
- `agent/loop.py` (task_id threading, blocked_quota catches)
- `agent/planner/{_llm,strategic,reflector,tactical}.py`
- `agent/runtime.py` (F-03 probe, F-05 resume caveat)
- `agent/mcp/{discovery,adapter}.py`
- `config.py` (new keys)
- Frontend `agentStore.ts`, `AgentPanel.tsx`, `StatusBar.tsx`

## Findings

All six questions + one run-log observation. Severity conservative:
MEDIUM = worth a row in the main audit; LOW = worth a comment; CLEAN =
no action.

### AD-01 (LOW) — F-05 hint observation can slide off tactical window

**Location:** `agent/runtime.py:~432` (build_system hint) ↔
`agent/planner/tactical.py` observation window slicing.

**Problem:** Resume-from-checkpoint injects a synthetic system
observation "browser session was reset, re-navigate if needed". That
observation is appended at the tail of `state.observations`. Tactical's
prompt builder passes `observations[-N:]` where N is effectively the
last ~10 entries. On a task with many observations post-resume, the
hint slides off the window and the planner stops seeing it. Meanwhile
the browser actually IS reset — a later step asking for
`browser.extract` still fails with `no_active_page`.

**Why it matters for 9.3:** proactive tasks will often be long-lived
and resume from checkpoint; this regression is latent today but
concerning for long-running standing-order work.

**Recommendation:** either (a) hoist the hint into SelfModel's
`active_connections` list (which IS in every prompt), or (b) duplicate
the hint once per strategic re-plan until the operator confirms
re-navigation happened.

**Severity:** LOW (rarely hit today, known constraint).

### AD-02 (MEDIUM) — Settings table writes not hot-reloaded into config

**Location:** `db/settings_repo.py` ↔ `config.py`.

**Problem:** `config.apply_overrides(...)` is only called at startup
(`main.py:145`). A write to the `settings` SQLite table at runtime
(e.g., the Settings UI, or live-test tooling like this session's
`ai_call_min_interval_ms` tweak) does NOT propagate to the `config`
singleton. The backend must be restarted to see the change. Config
read sites use `config.X` / `getattr(config, "X", default)` which always
hit the in-memory singleton, so the DB write is dead weight without a
reload.

This session noticed it while prepping the live resilience run — the
`ai_call_min_interval_ms = 500` override only took effect because we
restarted the backend afterwards. Silently this was correct. If the UI
changes min_interval live, it won't stick without restart.

**Severity:** MEDIUM (foundational — 9.3 will add more live-tunable
knobs like emotion decay rate, proactive cooldown).

**Recommendation:** add a `config.reload_from_db()` helper called from
the settings-save POST handler.

### AD-03 (LOW) — McpStdioClient.close() has no `kill()` fallback

**Location:** `agent/mcp/adapter.py:73-83`.

**Problem:** `close()` calls `terminate()` then `wait_for(wait, 2.0)`.
If the subprocess ignores SIGTERM (e.g., a Python script with broken
signal handlers), the wait times out, the exception is suppressed, and
the subprocess leaks. No follow-up `kill()` (SIGKILL).

**Severity:** LOW (normal MCP servers exit cleanly on SIGTERM; pathological
subprocess hang would leak a process but not corrupt state).

**Recommendation:** after the 2s wait_for timeout, call
`self._proc.kill()` and `await self._proc.wait()`.

### AD-04 (LOW) — Ollama classifier substring false-positive risk

**Location:** `ai/ollama_provider.py:24-46`.

**Problem:** Classification by `msg = str(exc).lower()` substring. `"500" in
msg` would false-positive on error messages that happen to contain the
string "500" elsewhere (e.g., "timeout after 2500ms"). Same for "429"
matching RTT numbers, etc. Today it's mostly safe because real exception
strings don't often include such numbers in-line.

**Severity:** LOW (low prevalence, but a sharp edge).

**Recommendation:** narrow to specific HTTP status string patterns
(" 500", " 502" or regex `\b(500|502|503|504)\b`). Already partially
done — the code already prefixes with space (e.g., `" 500 "`). Good.

### AD-05 (LOW) — `asyncio.sleep(interval)` in blocked_quota loop not interruptible

**Location:** `agent/runtime.py:~283`.

**Problem:** `enter_blocked_quota`'s `while True` checks
`emergency_stop` before and after the sleep, but the sleep itself
blocks for `interval` seconds (default 60s; grows to 600s). If the
operator hits STOP mid-sleep, the loop won't see it until the sleep
completes. Up to 10 minutes of delay in the adaptive-backoff case.

**Severity:** LOW (there's an upper bound, and the task is otherwise
idle — no user-visible damage; just a laggy STOP).

**Recommendation:** replace `asyncio.sleep(interval)` with a
`controls.emergency_stop.wait_interruptible(timeout=interval)`
pattern using `asyncio.wait` or a wait_for on the event itself.

### AD-06 (MEDIUM · **observed live**) — `update_task_status("blocked_quota", ...)` not persisted to DB during live parking

**Location:** `agent/runtime.py:262-264` ↔ `agent/audit.py:49-66`.

**Problem:** During the live resilience run this session (see
`live-resilience-run.md`), the task entered blocked_quota in memory
(the ~12-minute silent window after the 429 is consistent with the
probe-loop cadence) but the `agent_tasks.status` column was never
updated in SQLite — still showed `running` when we stopped the task
manually. No `UPDATE agent_tasks SET status=?` statement for the
blocked_quota transition appeared in the SQL echo log at the expected
timestamp.

`update_task_status` uses `async with get_session() as db: row =
await db.get(AgentTask, task_id); row.status = status` and relies on
`get_session`'s implicit commit on exit. The code path looks correct
in isolation. Speculative root cause: the AsyncSession in the loop
task's context may be shadowed by a later read from the same task_id
in a different session that predates the status change, so the commit
lands but the read sees the previous version. Needs real
investigation.

**Effect:** frontend `refreshTask` polls REST and sees stale
`running`; operator cannot tell from the UI that the task is parked.
WS path (`task.blocked_quota` broadcast) is unaffected, so live
clients DO see it — but a late-joining UI or one that hits the REST
endpoint will be misled.

**Severity:** MEDIUM. Core promise of blocked_quota visibility is
partially broken.

**Recommendation:** add `await db.commit()` explicitly inside
`update_task_status` (or at least `await db.flush()`) to force the
UPDATE out immediately; re-run the live probe to confirm the UPDATE
now appears.

## Triage

| Finding | Severity | Fix this session? | Defer rationale |
|---|---|---|---|
| AD-01 | LOW | no | latent; 9.3 should fix as part of observation-window redesign |
| AD-02 | MEDIUM | no | small fix but needs settings-panel write path (9.3 scope) |
| AD-03 | LOW | no | cosmetic defensive improvement, MCP not in production |
| AD-04 | LOW | no | cosmetic; current spacing prevents the false-positive anyway |
| AD-05 | LOW | no | laggy-stop only, not user-damaging |
| AD-06 | MEDIUM | no | live-verified but root cause needs real async-session debugging; don't poke blindly |

**Zero fixes this session.** All six findings are MEDIUM or LOW and
none fit the ≤30-LoC-with-clear-test bar. Documented here, to be
triaged alongside 9.3's own discovery.

## Verdict

9.2.2 is sound enough for 9.3 to build on. The three biggest claims
(F-01 budget enforcement end-to-end, F-02 uniform `generate()`
resilience, F-03 probe targets primary) are verified either by unit
tests or by this session's live behaviour. Known rough edges are all
LOW or MEDIUM; none block 9.3.

**Proceed to 9.3 with awareness of AD-02 and AD-06.**
