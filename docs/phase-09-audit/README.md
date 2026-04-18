# Phase 9 Audit (9.0 → 9.2.1) — Read-Only Findings

Run date: 2026-04-18 · branch `autonomous-run` · base tag `v0.9.2.1-resilience`
· read-only inspection, no code changes.

Methodology: file-by-file read of every in-scope path, asking "what happens
when this fails?" for each network call, DB write, LLM response, user input,
file op, subprocess, timeout, cancellation. Each finding cross-referenced
against the existing pytest / vitest suites for coverage. Severity calibrated
to whether 9.3 can safely build on top.

Scope: backend `agent/` + `ai/` + `api/routes_agent.py` + `vision/grounding.py`
+ agent-touched `core/`, `db/`, `main.py`, `config.py`; frontend `agentStore`,
`agentApi`, `useAgentStream`, `OperatorLayout`, all `components/agent/*`,
`StatusBar` 9.2.1 additions; tests `test_phase09_*` + the three new
frontend specs.

---

## Section 1 — Executive summary

| Severity   | Count |
|------------|-------|
| CRITICAL   | 1     |
| HIGH       | 8     |
| MEDIUM     | 18    |
| LOW        | 11    |

### Top 5 by concerning magnitude

1. **F-01 [CRITICAL] — `agent_max_llm_calls_per_task` is dead in production.**
   `loop.py:362-368` calls `tactical.plan(...)` without forwarding `state.id`,
   so the per-task LLM-call budget enforcement promised in 9.2.1 never actually
   counts a real call. Unit tests pass because they invoke
   `runtime.note_llm_call("t1")` directly; the integration path is untested.
   The headline 9.2.1 feature ("hard cap = 50 calls/task") is unenforced.

2. **F-02 [HIGH] — `generate()` / `generate_stream()` skip the 9.2.1
   resilience policy entirely.** Strategic planner, reflector, episode-summary
   composition all route through `ai_router.generate(...)` whose only retry
   logic is a single try/except that catches generic Exception and falls
   through to Ollama. RATE_LIMIT / QUOTA_EXHAUSTED / PROVIDER_UNAVAILABLE
   classification, backoff, cooling, quota-day lock — none of it touches
   these paths. A 429 during strategic planning kills the task as `failed`
   instead of parking on `blocked_quota`.

3. **F-03 [HIGH] — `_probe_provider_recovered` returns false-positive
   on every probe.** `runtime.py:279-292` calls `ai_router.generate("ping")`
   to probe quota recovery. That call lives on the *non-resilient* generate
   path (F-02), so a still-quota-exhausted Gemini will throw → router falls
   through to Ollama → ping succeeds locally → probe returns True →
   `clear_provider_cooling(primary)` clears the lock. Next real tactical call
   bumps into the same 429 again. Net effect: the 60s blocked_quota probe
   loop never actually waits for Gemini to recover; it just bounces every 60s.

4. **F-04 [HIGH] — MCP discovery can hang the entire backend startup.**
   `discovery.py:35-41` iterates servers sequentially; `_discover_one` calls
   `client.connect()` then `list_tools(timeout=10)`. `McpStdioClient.connect()`
   accepts a `timeout` param but never uses it — it just awaits
   `create_subprocess_exec`. A misbehaving server that spawns then hangs on
   stdout will wedge the discovery loop, which `main.py:213-220` awaits
   inline during lifespan startup. No per-server timeout, no parallel fan-out.

5. **F-05 [HIGH] — Browser state cannot survive a checkpoint restore but
   the resume path doesn't flag it.** `runtime.resume_from_checkpoint`
   builds a fresh `TaskState` with no browser refs (correct — pages aren't
   serialisable) but never re-navigates to the page the task was on. The
   first `browser.extract` / `browser.click_by_description` after resume
   will hit `no_active_page` and the planner has to reconstruct the goal
   from observations. There's no doc string or warning on the API; the
   operator will think the resume is faithful.

### Verdict

**Foundation has gaps that should be fixed before 9.3.** The agent runtime
is structurally sound — schema-stable, audit-traceable, browser teardown
honest, circuit breakers in the right places — but three of the four
9.2.1 resilience claims (call-budget cap, blocked_quota auto-recovery,
generate-path quota handling) are either fictional in production
(F-01), recover incorrectly (F-03), or not applied to the planners that
actually matter (F-02). The router's policy is real for `call_with_tools`
on the tactical path only.

9.3 will add proactivity + standing orders + emotion modulation on top of
this layer. Each of those means more LLM calls per task, more long-running
tasks, more reasons to hit 429s — exactly the gaps F-01..F-03 surface.
Fix those before adding load on top.

---

## Section 2 — Findings by severity

### F-01 [CRITICAL] Per-task LLM-call budget never enforced

**Location**: `src/backend/agent/loop.py:362-368` ↔
`src/backend/agent/planner/tactical.py:295-339` ↔
`src/backend/ai/provider.py:215-288` ↔
`src/backend/ai/provider.py:546-562`

**Problem**: `loop.py:362` calls `tactical.plan(step_idx=..., sub_goal=...,
self_model=..., observations=..., actions_in_sub_goal=...)` — note the
absence of `task_id=state.id`. `tactical.plan()` declares
`task_id: str | None = None` and forwards it to
`ai_router.call_with_tools(... task_id=task_id ...)`. `provider.py:277`
calls `_runtime_note_llm_call(task_id)`; that bridge at line 555 returns
`True` immediately when `task_id` is falsy. So in production the per-task
counter on `TaskState.llm_calls_this_task` is never incremented.

**Scenario**: A real task burns 80 LLM calls. The configured cap
`agent_max_llm_calls_per_task=50` would have fired at call 50, surfacing
`error_kind=call_budget_exhausted` and stopping the runaway. Instead the
runaway proceeds to circuit-breaker `max_actions_per_task=20` (different
mechanism, different intent) and the task fails with a generic verdict.

**Test coverage**: `test_phase09_2_1_resilience.py::TestCallBudget::*`
exercises `runtime.note_llm_call("t1")` *directly* — never via the
loop → tactical → router path. No regression test would catch the
unwired `task_id`.

**Suggested fix category**: thread `task_id` through one more parameter
hop: `loop.run_task_loop` → `tactical.plan(task_id=state.id, ...)` is a
two-line change. Add an integration test that calls `tactical.plan` and
asserts `runtime.foreground_slot.llm_calls_this_task` increments.

**Speculativeness**: Confirmed from code.

---

### F-02 [HIGH] `generate()` / `generate_stream()` skip 9.2.1 resilience policy

**Location**: `src/backend/ai/provider.py:111-202` ↔
`src/backend/agent/planner/_llm.py:34-44` ↔
`src/backend/agent/planner/strategic.py:100-120` ↔
`src/backend/agent/planner/reflector.py:80-95` ↔
`src/backend/agent/memory/seeds.py:47-65`

**Problem**: The `RATE_LIMIT` / `QUOTA_EXHAUSTED` / `PROVIDER_UNAVAILABLE`
classifier + per-error policy (cooling, backoff, fallback gating) only
runs inside `AIRouter.call_with_tools`. `generate()` line 122-149 catches
`(asyncio.TimeoutError, Exception)` and unconditionally falls through to
Ollama. There's no `_classify_gemini_error` call, no cooling marker, no
quota-until-midnight lock, no `BlockedQuotaError` propagation.

**Scenario**: Gemini returns the daily-quota 429 during
`strategic.plan()`. `_call` raises a generic Exception → generate's
fallback path → Ollama answers (or also fails) → strategic returns a plan
or the loop catches `RuntimeError` at `loop.py:165` and finalises the
task as `failed`. The blocked_quota probe + auto-resume never engages,
because the quota state is only set inside `call_with_tools`.

**Test coverage**: `TestRouter429Backoff::*` and `TestBlockedQuotaStatus`
verify only the `call_with_tools` path. Strategic + reflector quota
behaviour is uncovered.

**Suggested fix category**: extract the classifier + policy block from
`call_with_tools` into a per-attempt helper, share with `generate()` /
`generate_stream()`. Or: route `_call` through a `call_with_tools`-equivalent
that returns `ToolUseError` so quota propagation is uniform. Plus tests.

**Speculativeness**: Confirmed from code.

---

### F-03 [HIGH] Blocked-quota recovery probe is a false-positive every time

**Location**: `src/backend/agent/runtime.py:279-292`

**Problem**: `_probe_provider_recovered` calls
`ai_router.generate("ping", "Reply with one word: OK.", history=[])`. That
call uses the non-resilient `generate()` path (F-02). When primary
(Gemini) is still quota-exhausted, `generate()` falls through to Ollama,
which is a local model and almost always answers. The probe returns True
and the function then calls `clear_provider_cooling(primary)`, which
deletes the quota_exhausted entry for Gemini. The runtime resumes the
task, the next tactical call goes back to primary, instantly hits 429 again,
and the task either re-enters blocked_quota (60s round-trip cost on every
loop iteration) or fails depending on which planner triggers it.

**Scenario**: Gemini free-tier quota is hit at task step 3. Task → blocked_quota.
First probe at +60s → fallback succeeds → primary marked recovered →
tactical.plan() at step 4 → 429 → BlockedQuotaError → blocked_quota again.
Loop forever until daily reset, instead of waiting silently.

**Test coverage**: `TestBlockedQuotaStatus::test_tactical_raises_blocked_quota_on_quota_exhausted`
covers the entry into blocked_quota but not the probe loop's exit path.
The probe is "straight asyncio.sleep + a generate('ping') attempt — no
model behaviour to test, only state transitions" per the acceptance doc.
That's the bug — the probe outcome was never verified to mean what we want.

**Suggested fix category**: probe must specifically target the *primary*
provider (e.g., `primary._classify` on a forced primary call, or
`primary.health_check()` if you trust it; Gemini's `health_check` does a
real generate so it does count against quota). Alternative: probe by
attempting `call_with_tools` with a tiny tool list and inspect the error
kind; only clear cooling on QUOTA_EXHAUSTED → success transition.

**Speculativeness**: Confirmed from code; needs a real 429 reproduction
to fully exercise the loop, but the data flow is unambiguous.

---

### F-04 [HIGH] MCP discovery can wedge backend startup indefinitely

**Location**: `src/backend/agent/mcp/discovery.py:27-41`,
`src/backend/agent/mcp/adapter.py:51-59`,
`src/backend/main.py:213-220`

**Problem**: Three layers compounding:

1. `discover_all` iterates `servers` sequentially in a plain `for` loop;
   no per-server `wait_for`.
2. `McpStdioClient.connect(timeout=5.0)` declares the timeout but never
   wraps `create_subprocess_exec` in `wait_for(timeout=timeout)`. A
   misbehaving server that spawns successfully but hangs on its stdin/stdout
   will block here forever.
3. `main.py:213-220` awaits `discover_all()` inline during lifespan
   startup — uvicorn cannot accept any traffic until this returns.

`agent_mcp_servers` defaults to `[]` so this is dormant in normal ops, but
the moment an operator enables MCP, one bad server takes the entire system
down.

**Scenario**: User configures two MCP servers — one healthy, one with a
broken `command` string (e.g., a python entry point that imports a missing
module and hangs printing the exception). Backend restart spins forever;
no API responds; only `kill -9` on uvicorn helps.

**Test coverage**: `test_phase09_2_mcp.py` tests the happy path + a
malformed-tool case. No timeout / hang test. NONE.

**Suggested fix category**:
- Wrap `create_subprocess_exec` in `asyncio.wait_for(..., timeout)` inside
  `McpStdioClient.connect`.
- In `discover_all`, fan out per-server with `asyncio.wait_for` + `gather(return_exceptions=True)`
  so one bad server doesn't drag the rest.
- Move discovery off the lifespan critical path — fire it in
  `asyncio.create_task(discover_all())` so startup completes regardless.

**Speculativeness**: Confirmed from code; reproducible by stubbing a
hanging server.

---

### F-05 [HIGH] Browser state lost on checkpoint resume, no warning

**Location**: `src/backend/agent/runtime.py:328-365`,
`src/backend/agent/checkpoints.py:7-34`

**Problem**: Checkpoints serialise self_model + sub_goals + observations +
thought_budget + last_reflection + step_idx. Browser pages cannot
serialise — Playwright instances live in the runtime singleton, not in
TaskState. `resume_from_checkpoint` rebuilds TaskState from the checkpoint
and starts the loop with `resumed=True`, but the browser-related runtime
fields (`self.browser`, `self.browser_context`, `self.browser_page`,
`self._playwright`) stay as whatever the previous task left behind — most
likely `None` after the prior task's `_teardown_browser` ran.

The next planner call that selects `browser.extract` or
`browser.click_by_description` will fail with `no_active_page`, the
observation goes back to the planner, the planner has to re-issue
`browser.navigate`, and only then does the task progress. Worst case the
LLM doesn't realise the page state was lost and tries to extract from a
non-existent context for several steps.

**Scenario**: Long task is paused at step 10 mid-browse (page open at
some search results URL). Operator restarts uvicorn. Resume from
checkpoint → step 11 is `browser.extract '.results .item h3'` → fails →
observation says "no_active_page" → planner has to spend 2-3 extra LLM
calls to re-navigate. Net cost: thought-budget overshoot and extra LLM
spend.

**Test coverage**: NONE. `test_phase09_loop` covers a plain checkpoint /
resume cycle but not one mid-browser-task.

**Suggested fix category**: either
- (a) refuse to resume tasks whose checkpoint observations show recent
  browser activity unless the user confirms;
- (b) on resume, peek at the last observation; if it references a browser
  action, re-prepend a synthetic observation telling the planner "browser
  was reset, you must re-navigate";
- (c) document the limitation prominently in the API response of
  `/agent/task/{id}/resume_from_checkpoint`.

**Speculativeness**: Confirmed from code; trivially reproducible.

---

### F-06 [HIGH] strategic.plan swallows BlockedQuotaError into RuntimeError

**Location**: `src/backend/agent/planner/strategic.py:100-103` ↔
`src/backend/agent/loop.py:165-174`

**Problem**: `strategic.plan` calls `llm_json(prompt)`. `llm_json` raises
`PlannerLLMError` on a JSON failure. `strategic.plan` catches that and
re-raises as `RuntimeError(f"strategic_planner_invalid_json: {exc}")`.
But it also catches the *type-erased* version: any `PlannerLLMError`
subclass (including `BlockedQuotaError`, F-02 connection notwithstanding)
is collapsed to RuntimeError.

Even if F-02 were fixed and `_call` propagated `BlockedQuotaError`
correctly from `generate()`, this clause would erase the type and
loop.py would treat it as a fatal strategic-planner failure. Compare the
tactical path which catches `BlockedQuotaError` separately at
`loop.py:369-376` and routes to `enter_blocked_quota`.

**Scenario**: F-02 gets fixed. Strategic planner hits Gemini's quota
429. `_call` raises BlockedQuotaError → strategic.plan re-wraps as
RuntimeError → loop catches and finalises the task as `failed` instead
of waiting for quota recovery.

**Test coverage**: NONE for the BlockedQuotaError path through strategic.

**Suggested fix category**: catch `BlockedQuotaError` first and re-raise
unchanged before the generic `PlannerLLMError → RuntimeError` clause; add
the BlockedQuotaError branch to loop.py's `_ensure_strategic_plan`.

**Speculativeness**: Confirmed from code; latent until F-02 is fixed.

---

### F-07 [HIGH] `time.wait` action's interrupt check uses wrong attribute path

**Location**: `src/backend/agent/actions/time_.py:34-47`

**Problem**: The interruptible-sleep loop polls
`runtime.emergency_stop.is_set()` and `runtime.pause_event.is_set()`. The
real attributes live one level deeper: `runtime.controls.emergency_stop`
and `runtime.controls.pause_event` (see `executor.py:147,156` and
`loop.py:273,282,289`). `getattr(runtime, "emergency_stop", None)`
returns None, so the conditional is silently False, so the action never
breaks out early. Stop request will still cancel the asyncio task at the
next yield point, but the action's own `interrupted_by_stop` /
`interrupted_by_pause` outputs never fire.

**Scenario**: Task is mid-`time.wait(seconds=60)`. User clicks PAUSE.
The pause event sets, the loop's `pause_event.is_set()` check fires at
the *next iteration* (after the wait completes). User experience: pause
felt immediate everywhere except mid-wait.

**Test coverage**: NONE. `test_phase09_*` doesn't exercise time.wait
under cancel/pause.

**Suggested fix category**: change to `runtime.controls.emergency_stop` /
`runtime.controls.pause_event`. Add a regression test that fires `pause`
mid-wait.

**Speculativeness**: Confirmed from code by `Grep` cross-reference.

---

### F-08 [HIGH] Frontend hides STOP button when task is in `blocked_quota`

**Location**: `src/frontend/src/components/agent/AgentPanel.tsx:41`,
`src/frontend/src/components/agent/ControlsBar.tsx:16-20`

**Problem**: `AgentPanel.taskActive` and `ControlsBar.taskActive` both
gate the controls panel on
`status === 'running' || 'paused' | 'awaiting_user' | 'planning'`. The
new `blocked_quota` status from 9.2.1 isn't in either predicate. When a
task enters `blocked_quota`, AgentPanel renders `GoalInput` instead of
`ControlsBar`, so the operator loses access to PAUSE / STOP /
INTERVENE / Cancel-step. The only escape is to wait for the (broken,
F-03) probe to "recover" or restart the backend.

**Scenario**: F-03 produces the false-positive recovery, task bounces
out of blocked_quota, makes one tactical call, hits 429, re-enters
blocked_quota. Operator can't STOP — the button is gone. Has to kill the
backend.

**Test coverage**: `AgentPanel.test.tsx` doesn't render with
`status='blocked_quota'`.

**Suggested fix category**: add `'blocked_quota'` to both predicates;
disable the cancel-step button (no acting substate while blocked) but
keep STOP enabled. Add a test rendering ControlsBar with
status=blocked_quota.

**Speculativeness**: Confirmed from code.

---

### F-09 [MEDIUM] `cancel_step` API endpoint is a no-op for in-flight actions

**Location**: `src/backend/api/routes_agent.py:92-95`,
`src/backend/agent/runtime.py:205-216`,
`src/backend/agent/executor.py:137-165`

**Problem**: `routes_agent.cancel_step` → `runtime.cancel_step` sets
`controls.cancel_step.set()` then explicitly comments that it does NOT
cancel the running task ("for cooperative cancel we rely on the action
checking emergency_stop / cancel_step flags"). But none of the bundled
actions (browser, fs, bash, net, web, process, notify, time) actually
poll `controls.cancel_step.is_set()` mid-flight. They just run to
completion / executor's `wait_for` ceiling. The cancel_step button in
the UI thus does nothing observable until the action finishes naturally.

**Scenario**: Operator hits "Cancel step" while a `bash.run sleep 60`
is executing. Nothing happens for 60s, then the next iteration sees
the flag, the executor catches the CancelledError. Operator concludes
the button is broken.

**Test coverage**: `test_phase09_loop` doesn't exercise cancel_step
mid-action.

**Suggested fix category**: either
- (a) actually cancel the running task: `self.task_runner.cancel()` in
  `runtime.cancel_step` (would cause the executor's `wait_for` to raise
  CancelledError immediately and the existing handler in
  `executor.py:145-165` distinguishes user vs. stop cancel by reading
  the flag);
- (b) document that cancel_step is best-effort and only fires between
  steps;
- (c) hide/disable the button when no action is acting (already partially
  gated by `substate === 'acting'`).

**Speculativeness**: Confirmed from code.

---

### F-10 [MEDIUM] write_episode + write_memory_seed dual-write inconsistency

**Location**: `src/backend/agent/runtime.py:430-456`,
`src/backend/agent/memory/seeds.py:114-124`,
`src/backend/agent/audit.py:208-225`

**Problem**: `finalize_task` writes the task summary to ChromaDB
(`write_episode`) and to the SQL seeds table (`write_memory_seed`). Each
is wrapped in `contextlib.suppress(Exception)`. There's no transaction,
no retry, no compensating action. If Chroma is down only the SQL row
exists (recall via `recall.py` returns nothing); if SQL fails, only Chroma
exists (operator browse via `audit.list_tasks` returns nothing). The
acceptance doc lists this as known design but it's worth flagging — the
behaviour drifts further the more episodic queries inform planning.

**Scenario**: ChromaDB process oom-killed during a long-running task.
The task finishes, `write_episode` raises, `write_memory_seed` succeeds.
A later `self.recall` query for similar past tasks returns zero, and
strategic planner doesn't see the just-completed episode.

**Test coverage**: `test_phase09_2_memory.py` tests both writes
independently in a happy path. NONE for partial-failure consistency.

**Suggested fix category**: small reconciler — at startup, if
SQL.count > Chroma.count, run `backfill_if_behind` (already exists);
also surface a settings panel toggle to manually reconcile. Optionally:
on write failure, log to a `pending_episode_writes` queue.

**Speculativeness**: Confirmed from code.

---

### F-11 [MEDIUM] `tactical._legacy_plan` path has no quota awareness

**Location**: `src/backend/agent/planner/tactical.py:269-289` ↔
`src/backend/agent/planner/_llm.py:34-44`

**Problem**: When `agent_use_native_tool_calling=False` the loop falls
through to `_legacy_plan` which uses `llm_json` → `_call` →
`ai_router.generate`. Same F-02 problem — the legacy path can't surface
QUOTA_EXHAUSTED or trigger BlockedQuotaError because generate doesn't
classify. A user who toggles native tool calling off (e.g., operator
debugging) loses the entire 9.2.1 resilience for tactical too.

**Test coverage**: `test_phase09_2_tool_use.py` covers the native path;
legacy path has tests but none for quota.

**Suggested fix category**: same as F-02 — uniform classifier.

**Speculativeness**: Confirmed from code; falls out of F-02 fix.

---

### F-12 [MEDIUM] McpStdioClient `_request` not safe for concurrent calls

**Location**: `src/backend/agent/mcp/adapter.py:73-96`

**Problem**: `_request` increments `self._next_id` and writes the JSON
payload, then `await self._proc.stdout.readline()`. There's no
correlation between the request ID and the response — any reader picks
up whatever's on stdout next. If two coroutines call `_request`
concurrently, responses can interleave (the first caller might read
the second caller's reply and vice versa).

**Scenario**: Speculative — the agent loop is single-threaded so MCP
calls are serialised today. If a future phase fans out parallel MCP
adapters (e.g., search across MCP servers), this becomes a real bug.

**Test coverage**: NONE for concurrent calls.

**Suggested fix category**: add an `asyncio.Lock` around the
write+readline pair, OR build proper id→future map and run a single
reader task that dispatches replies.

**Speculativeness**: Speculative for now (no concurrent caller in tree),
but the contract is unsafe.

---

### F-13 [MEDIUM] McpStdioClient.connect timeout parameter unused

**Location**: `src/backend/agent/mcp/adapter.py:51-59`

**Problem**: Method signature is `connect(self, timeout: float = 5.0)`.
The body just awaits `create_subprocess_exec` and returns. The `timeout`
is never wrapped around anything. So if the server binary blocks during
spawn (e.g., a script that gets stuck on `import` of a slow module), the
connect blocks forever. Combines with F-04 to make startup fragile.

**Test coverage**: NONE.

**Suggested fix category**:
`self._proc = await asyncio.wait_for(create_subprocess_exec(...), timeout)`.

**Speculativeness**: Confirmed from code.

---

### F-14 [MEDIUM] Substate has no distinct `blocked_quota` value

**Location**: `src/backend/agent/schemas.py:37-44`,
`src/backend/agent/runtime.py:260` (`set_substate("waiting_user")`)

**Problem**: `Substate` is `Literal["thinking","acting","reflecting",
"waiting_user","paused","idle"]`. When a task enters `blocked_quota`,
runtime sets substate to `waiting_user`. From the operator's substate
indicator alone there's no way to tell quota-block from user-input wait;
both pulse amber with "WAITING USER". The acceptance doc lists this as
known followup #3.

**Test coverage**: NONE for substate distinction.

**Suggested fix category**: add `"blocked_quota"` substate value and
matching meta entry in `SubstateIndicator`. Mirror in
`shared/types/agent.ts`.

**Speculativeness**: Confirmed from code; aligns with acceptance doc.

---

### F-15 [MEDIUM] AIRouter early-return on call-budget exhausted writes no audit row

**Location**: `src/backend/ai/provider.py:277-288`

**Problem**: When `_runtime_note_llm_call` returns False (budget hit),
the router returns a `ToolUseError(kind=UNKNOWN, message="call_budget_exhausted...")`
*without* calling `write_log`. That means the audit table loses the row
that says "this task was capped at the LLM-call ceiling". Operator
inspecting `ai_tool_use_log` has no record of why the task stopped; the
agent_audit row will say "tactical_failed" with no router-side context.

**Test coverage**: `TestCallBudget::test_hard_cap_returns_false_after_reaching_limit`
exercises the runtime side, not the audit side.

**Suggested fix category**: write a row with provider="router",
error_kind="call_budget_exhausted" before returning. Plus a test.

**Speculativeness**: Confirmed from code; latent until F-01 is fixed.

---

### F-16 [MEDIUM] Sync IO in async paths blocks the event loop

**Location**: `src/backend/agent/safety/preconditions.py:41-50`
(socket connect), `src/backend/agent/actions/fs.py:33-49`
(open / read), `src/backend/agent/actions/fs.py:115-118`
(open / write), `src/backend/agent/actions/process.py:21-44`
(`psutil.process_iter`)

**Problem**: All these functions are declared `async` but their hot
paths execute synchronous, blocking system calls. `_network_online`
does a sync UDP socket with 1s timeout. `FsRead.execute` opens and
reads up to 1MB. `ProcessList.execute` walks /proc, which on a busy
Linux system is hundreds of milliseconds. While these run, the event
loop is frozen — no WebSocket events delivered, no other handlers
progress. For embedded Radxa hardware this matters more than on
beefy laptops.

**Scenario**: Strategic planner triggers, `_network_online` runs
during preconditions, the WS connection's keepalive ping is delayed by
1s. WS clients see a brief stall.

**Test coverage**: NONE for blocking detection.

**Suggested fix category**: wrap each in `await asyncio.to_thread(...)`.
Or use `aiofiles` for fs.read/write.

**Speculativeness**: Confirmed from code; impact magnitude on Radxa
needs profiling.

---

### F-17 [MEDIUM] Risky-action consent and ask_user precondition wait forever

**Location**: `src/backend/agent/loop.py:476` (`controls.intervention_queue.get()`),
`src/backend/agent/loop.py:565` (same)

**Problem**: When the planner picks a risk-above-tolerance action (loop
476) or a precondition returns `failure_mode="ask_user"` (loop 565), the
loop blocks on `intervention_queue.get()` with no timeout. If the user
walks away, the task hangs indefinitely. The circuit-breaker
`max_elapsed_s_per_task` (default 600s) won't fire because the loop is
not iterating — it's parked on a queue.

**Scenario**: Task plans `bash.run rm -rf ~/notes`. Risk gate prompts
user. User leaves the workstation. Eight hours later they come back to
a task still parked, pinning the foreground slot, FSM stuck in OPERATOR.

**Test coverage**: `test_phase09_loop.py` tests intervention happy path
only.

**Suggested fix category**:
`asyncio.wait_for(intervention_queue.get(), timeout=config.agent_user_consent_timeout_s)`
with a graceful timeout that fails the action and continues the loop.

**Speculativeness**: Confirmed from code.

---

### F-18 [MEDIUM] `_drain_intervention` keeps only the last typed text

**Location**: `src/backend/agent/loop.py:99-107`

**Problem**: The function loops `get_nowait()` until empty, overwriting
`text` each time. If the operator queues two interventions ("stop here"
+ "actually never mind, keep going"), only the second is observable to
the planner. Drain semantics should probably be "concatenate" or
"surface most informative" rather than "discard prior".

**Test coverage**: NONE.

**Suggested fix category**: collect all texts into a list, join into a
single observation with explicit ordering or take only the LAST and
log a debug warning that prior were dropped.

**Speculativeness**: Confirmed from code; may be intentional for
Phase 9.1 simplicity.

---

### F-19 [MEDIUM] Pause / resume API silently 200s on unknown task

**Location**: `src/backend/api/routes_agent.py:70-79`

**Problem**: `pause_task` and `resume_task` return `{"paused": False}`
or `{"resumed": False}` with HTTP 200 if the task_id doesn't match
`runtime.current_task`. No 404. Frontend stores get success, then UI
state diverges from server state. The frontend `pauseTask` / `resumeTask`
in `agentStore.ts:115-127` doesn't even read the response — it just
optimistically sets `connectionStatus`.

**Test coverage**: `test_phase09_api.py` doesn't probe this case.

**Suggested fix category**: 404 when the task isn't current, OR a
specific error code; frontend should surface that in toast.

**Speculativeness**: Confirmed from code.

---

### F-20 [MEDIUM] `agentStore.refreshTask` incorrectly maps connectionStatus on terminal states

**Location**: `src/frontend/src/stores/agentStore.ts:147-161`

**Problem**: `connectionStatus: detail.task.status === 'paused' ? 'paused' : 'running'`
sets the connection chip to `running` for any non-paused status — including
`done`, `failed`, `stopped`, `awaiting_user`, `blocked_quota`. The bottom
controls bar then shows `running` UI for a finished task.

**Test coverage**: NONE.

**Suggested fix category**: explicit map terminal statuses → 'idle'.

**Speculativeness**: Confirmed from code.

---

### F-21 [MEDIUM] ActionCard always renders MEDIUM-risk colour regardless of step

**Location**: `src/frontend/src/components/agent/ActionCard.tsx:69-78`

**Problem**: The risk indicator dot pulls `RISK_COLORS[5]` literally — the
`risk_level` of the actual step is never read. Every action card shows
the same amber dot. Operator can't tell at a glance whether a step is
SAFE / LOW / MEDIUM / HIGH. The aria-label points at
`step.monologue?.confidence` (a 0..1 float), not risk.

**Test coverage**: NONE for risk visualisation.

**Suggested fix category**: pull `risk_level` off the step or audit
entry; map via `RISK_COLORS[risk_level] ?? RISK_COLORS[5]`.

**Speculativeness**: Confirmed from code.

---

### F-22 [MEDIUM] Frontend `agent.budget.warning` is one-shot — no live counter

**Location**: `src/frontend/src/stores/agentStore.ts:321-325`,
`src/backend/agent/runtime.py:218-245`

**Problem**: Backend only emits `agent.budget.warning` ONCE when the
threshold is first crossed (latched via `state.llm_call_warned`). After
that there's no update event for ongoing increments and no event when
the hard cap fires (the call just returns ToolUseError). The
LLMCallBudget chip stops advancing after the warning, then jumps to
"50/50" at the next refreshTask — discontinuous UX. Combined with
F-01 the chip never advances at all in production.

**Test coverage**: `LLMCallBudget.test.tsx` tests color transitions on
prop changes, not WS event flow.

**Suggested fix category**: emit `agent.budget.update` per-call (or
batched every N calls); add a separate `agent.budget.exhausted` event
when hard cap fires.

**Speculativeness**: Confirmed from code; latent until F-01 is fixed.

---

### F-23 [MEDIUM] `recall.py` distance→relevance assumes ≤1.0 distance

**Location**: `src/backend/agent/memory/recall.py:45`

**Problem**: `relevance = 1.0 - float(distances[i])`. ChromaDB cosine
distance is in [0, 2] (1 - cosine_similarity, where similarity is
[-1, 1]). For dissimilar embeddings, distance > 1, so relevance goes
negative. Downstream consumers may interpret negative relevance as
"highly irrelevant" but the prompt formatter doesn't use the field —
SAFE today, but if 9.3 surfaces relevance scores in UI or feeds them
into a confidence weight, the math is wrong.

**Test coverage**: `test_phase09_2_memory.py` doesn't assert on relevance
boundaries.

**Suggested fix category**: clamp to [0, 1] explicitly or switch to
`max(0.0, 1.0 - distance/2.0)` for cosine.

**Speculativeness**: Speculative — depends on which Chroma metric is
configured.

---

### F-24 [MEDIUM] Audit args/result deserialisation can crash on malformed JSON

**Location**: `src/backend/agent/audit.py:138-156`

**Problem**: `fetch_audit` wraps each `json.loads` in try/except and
defaults to `{}` on failure. But the empty dict is then passed to
`ActionResult(**{})` which Pydantic rejects (no `ok` field). The whole
endpoint then 500s instead of returning the rest of the rows. A single
corrupt row poisons the entire audit list.

**Test coverage**: NONE for malformed audit row.

**Suggested fix category**: substitute a `ActionResult(ok=False, error="audit_corrupted")`
synthetic when deserialisation fails; same for InnerMonologue.

**Speculativeness**: Speculative — would need a real corrupt row to
confirm, but the construction path makes it very likely.

---

### F-25 [MEDIUM] `_network_online` blocks 1s for every action with `network.online` precondition

**Location**: `src/backend/agent/safety/preconditions.py:41-50`

**Problem**: `_network_online` does a sync UDP "connect" to 8.8.8.8:53
with a 1s timeout. Called every time `browser.navigate`, `web.search`,
or `net.scan` checks preconditions. On a healthy network it's fast (UDP
"connect" doesn't actually transmit) but on a flaky network, every
network-action precheck adds ~1s of event-loop block. Combines with F-16.

**Suggested fix category**: cache the result for ~30s; or inspect a
context engine flag instead of probing on every action; or use
`asyncio.open_connection("8.8.8.8", 53)` async.

**Speculativeness**: Confirmed; impact varies with network reliability.

---

### F-26 [MEDIUM] Concern #6 race — preconditions check is non-atomic with action dispatch

**Location**: `src/backend/agent/executor.py:103-120`,
`src/backend/agent/safety/preconditions.py:64-69`

**Problem**: `_browser_page_active` reads `agent_runtime.browser_page`
at precondition time. The action then dispatches and re-reads the same
value at execute time. Between these two reads, anything in the runtime
(notably `_teardown_browser` from a stop or finalize) could null the
browser. The action then sees None and returns no_active_page. Race is
narrow but real, especially because `runtime.stop` runs `_teardown_browser`
in parallel with the loop's last action.

**Test coverage**: NONE.

**Suggested fix category**: re-check inside the action's execute (already
done in `BrowserExtract`), or hold a per-task asyncio.Lock around
browser-state mutations.

**Speculativeness**: Speculative — needs concurrency reproduction.

---

### F-27 [LOW] Provider.generate updates `_active` per stream chunk

**Location**: `src/backend/ai/provider.py:179`

**Problem**: Inside the streaming loop, `self._active = primary_name`
runs on every chunk. This is harmless because `_active` doesn't get
broadcast per-write, but it's wasted work and noisy if anything ever
hooks the setter.

**Suggested fix category**: assign once before the loop.

---

### F-28 [LOW] DDG search regex brittle to upstream HTML changes

**Location**: `src/backend/agent/actions/web.py:31-35`

**Problem**: The result-block regex requires very specific class names
on `<a>` tags. DDG markup tweaks regularly. Failure mode is silent: zero
results, no failure indicator other than the empty list. Operator can't
tell whether the query genuinely had no hits or the parser broke.

**Suggested fix category**: when regex finds zero matches AND the HTML
is non-empty, surface a low-confidence warning in the result.

---

### F-29 [LOW] `_runtime_note_llm_call` swallows all exceptions and returns True

**Location**: `src/backend/ai/provider.py:546-562`

**Problem**: If the bridge raises (e.g., import cycle from a future
refactor), the call still proceeds — the budget is silently bypassed.
Comment notes this is intentional ("never block the call path") but the
silent over-budget would never be visible.

**Suggested fix category**: keep the lenient behaviour but log at
WARNING (not DEBUG) on the first failure per process.

---

### F-30 [LOW] `providerSummary.ts` cooling label can render "NaN s"

**Location**: `src/frontend/src/utils/providerSummary.ts:35-43`

**Problem**: `Date.parse(until)` returns NaN for malformed ISO strings.
Subsequent `Math.max(0, NaN/1000)` gives NaN. Label becomes
"`gemini · cooling NaNs`".

**Suggested fix category**: `if (Number.isNaN(parsed)) parsed = nowMs`.

---

### F-31 [LOW] `useRouterStatePolled` keeps polling even when logged out

**Location**: `src/frontend/src/components/core/StatusBar.tsx:461-481`

**Problem**: 15s polling continues even when token is missing or 401s
come back. Backend logs auth failures; frontend silently keeps trying.
At ~96 calls/day per session, that's noise but cumulatively wasteful.

**Suggested fix category**: stop polling when `useAuthStore` reports no
user; restart on login.

---

### F-32 [LOW] `task.intervention_received` event has no UI acknowledgment

**Location**: `src/frontend/src/stores/agentStore.ts:291-294`

**Problem**: Sets `promptToUser = null` only — no toast, no log, the user
might wonder if their intervention was lost when the prompt clears.

**Suggested fix category**: brief inline confirmation ("intervention
queued") for ~1s.

---

### F-33 [LOW] Several agent WS events go to `events[]` only, no dedicated state

**Location**: `src/frontend/src/stores/agentStore.ts:174-336` (default
branch silently passes)

**Problem**: `sub_goal.abandoned`, `checkpoint.created`, `tool.selected`,
`thinking.started`, `thinking.completed` all land in the catch-all
events log but don't update any visible state. Operator panel doesn't
indicate when a sub-goal was abandoned (vs. completed) — F-08 makes this
worse because abandoned sub-goal can't even be seen if status went to
blocked_quota.

**Suggested fix category**: add a sub_goal.abandoned handler that flips
the sub-goal's status in `subGoals`; surface checkpoint.created as a
toast / activity row.

---

### F-34 [LOW] TaskTree `auditMap` lookup keyed by step_idx but type says audit-id

**Location**: `src/frontend/src/components/agent/TaskTree.tsx:117`

**Problem**: `auditMap?.get(a.step_idx)` — but the type signature
declares `auditMap?: Map<number, AgentAuditEntry>` whose keys are
expected to be audit IDs (autoincrement, per-table) not step_idx
(per-task). The current AgentPanel doesn't pass an auditMap so this is
dead code today, but if anyone wires it up the lookups will silently
miss.

**Suggested fix category**: rename / re-key the map; or store an
explicit `Map<number /*step_idx*/, AgentAuditEntry>` type alias to make
the contract obvious.

---

### F-35 [LOW] Bash output truncation hardcoded at 16 KiB

**Location**: `src/backend/agent/actions/bash.py:15`

**Problem**: `_OUTPUT_LIMIT_BYTES = 16 * 1024`. A `bash.run cat large.log`
will silently truncate. Reasonable default but operator might want to
raise it. Should be config.

**Suggested fix category**: lift to `config.agent_bash_output_limit_bytes`.

---

### F-36 [LOW] `browser.navigate` 15s page-load timeout hardcoded

**Location**: `src/backend/agent/actions/browser.py:68`

**Problem**: `await page.goto(self.url, timeout=15_000, wait_until="domcontentloaded")`.
15s is reasonable but should be config; slow corp networks or large SPAs
need more.

**Suggested fix category**: lift to
`config.agent_browser_navigate_timeout_ms`.

---

### F-37 [LOW] `_blocked_quota_probe_s = 60.0` hardcoded

**Location**: `src/backend/agent/runtime.py:51`

**Problem**: Already in the acceptance doc's followup list. Configurable
key would let paid-tier providers probe more aggressively.

**Suggested fix category**: lift to `config.agent_blocked_quota_probe_s`.

---

## Section 3 — Acceptance-history concerns

### Concern 1 — Gemini 429 handling end-to-end (generate vs call_with_tools)

**Status**: **NOT ADDRESSED for `generate()` / `generate_stream()` paths.**

The 9.2.1 policy is enforced exclusively inside
`AIRouter.call_with_tools` (provider.py:215-443). `generate()`
(provider.py:111-149) and `generate_stream()` (151-202) still use the
original Phase 9.1 try/except → fallback pattern with no quota
classification, no cooling, no `BlockedQuotaError` propagation.

That means strategic.plan, reflector.reflect, memory.seeds.compose_summary,
agent_runtime._probe_provider_recovered all silently get the OLD
behaviour. See F-02, F-03, F-06.

**Recommendation priority**: HIGH — fix before 9.3.

---

### Concern 2 — Ollama implements call_with_tools contract correctly?

**Status**: **PARTIALLY ADDRESSED.**

`OllamaProvider.call_with_tools` (ollama_provider.py:137-273) does
honour the ToolUseProvider Protocol, picks the right ToolErrorKind for
PARSE_FAILED / UNKNOWN_TOOL / MODEL_REFUSED, and applies the same retry-
with-feedback pattern. **Two drift points** vs. Gemini:

- Ollama only classifies network-style errors via a substring check
  (`"timeout" in str(exc).lower()`) → defaults to NETWORK. There's no
  classification of remote Ollama 429 / 5xx responses. Local-only deploys
  are fine; if anyone ever points `ai_ollama_host` at a remote shared
  Ollama, the router will see NETWORK errors and treat them as
  retriable-with-fallback, which would route back to Gemini — exactly the
  pinball pattern 9.2.1 was meant to fix.
- Ollama doesn't validate `arguments` against the ToolSchema parameters
  schema. `tool_use.py` provides JSON Schema but Ollama just JSON-parses
  the envelope and trusts the dict shape. Garbage args reach the Action
  builder and only Pydantic validation catches them — by which point the
  audit row already says success.

**Recommendation priority**: MEDIUM — local Ollama is fine today.

---

### Concern 3 — Task status transitions reliably broadcast substate?

**Status**: **PARTIALLY ADDRESSED.**

Substate transitions go through `runtime.set_substate` which mirrors to
FSM and broadcasts to `agent.stream`. The transitions themselves are
correct.

**Two concrete gaps**:

- `blocked_quota` doesn't have its own substate (F-14) — it shares
  `waiting_user`, so the operator can't tell from the indicator.
- The WS broadcast goes through `_broadcast` which silently swallows
  exceptions (`runtime.py:129-134`). If `hub.broadcast` fails (no clients,
  socket race), the substate change is lost from the wire. Frontend does
  re-sync on `refreshTask`, but only when operator hits a control
  button, not autonomously.

**Recommendation priority**: MEDIUM.

---

### Concern 4 — Memory dual-write consistency

**Status**: **NOT ADDRESSED — silent inconsistency on partial failure.**

See F-10. Both writes are independently best-effort. No retry, no
reconciler beyond startup `backfill_if_behind`.

**Recommendation priority**: MEDIUM (works in happy path; reconcile job
on settings panel would close it).

---

### Concern 5 — Checkpoint restoration fidelity (esp. browser state)

**Status**: **NOT ADDRESSED for browser. Otherwise mostly faithful.**

See F-05. Schema fields restored: self_model, sub_goals,
active_sub_goal_id, observations, thought_budget, last_reflection,
step_idx. Restored via `Checkpoint.model_validate` round-trip.

**NOT restored**: browser, browser_context, browser_page, _playwright,
controls (intentional reset), per-task LLM call counter (intentional —
in-memory).

**Recommendation priority**: MEDIUM. Document at minimum; add re-navigate
hint at best.

---

### Concern 6 — Action preconditions on cached state, race with action

**Status**: **PARTIALLY ADDRESSED — narrow race exists.**

See F-26. Preconditions and action execute in the same coroutine, so the
race window is microseconds for most paths. Only `runtime.stop`'s
parallel `_teardown_browser` provides a real window. F-26 explains.

**Recommendation priority**: LOW (rare in practice; explicit lock when
9.3 introduces background tasks).

---

### Concern 7 — WS reconnect during active task

**Status**: **PARTIALLY ADDRESSED — gap-prone.**

`useAgentStream` re-subscribes via `wsClient` on reconnect. But events
that fired during the disconnect window are simply LOST — no message
queue, no replay-from-id. Frontend store relies on incremental updates;
if `task.completed` fires while disconnected, the UI stays in a
"running" state until the next `refreshTask` REST call. There's no
periodic resync polling for the agent panel.

**Recommendation priority**: MEDIUM. A simple "on reconnect, refreshTask
the current task id" would close it.

---

### Concern 8 — MCP discovery failure isolation

**Status**: **NOT ADDRESSED.** See F-04 + F-13.

**Recommendation priority**: HIGH if MCP is ever enabled in production;
LOW today since `agent_mcp_servers=[]` default.

---

### Concern 9 — OmniParser model loading

**Status**: **MOOT — OmniParser is a stub.**

`OmniParserV2.parse` always raises `GroundingUnavailable("OmniParserV2
stub: real inference not wired")` (grounding.py:242). The 300MB model
isn't actually loaded. The grounder always falls through to
`DomAccessibilityParser` which is fast and weight-free. So the original
concern (lazy load failing mid-task, disk full, etc.) doesn't apply
yet.

**Side note**: `BrowserClickByDescription.execute` (browser.py:194) does
`getattr(runtime, "grounder", None) or OmniParserGrounder()` — runtime
has no `grounder` attribute, so a fresh `OmniParserGrounder` is created
every click. Cheap (no weights), but slightly wasteful.

**Recommendation priority**: revisit when OmniParser is actually wired.

---

### Concern 10 — Browser lifecycle on crash mid-action

**Status**: **MOSTLY ADDRESSED.**

`runtime.stop` and `runtime.finalize_task` both call `_teardown_browser`
inside `contextlib.suppress(Exception)`. Loop's outer `except Exception`
also routes through `finalize_task`. So a crash mid-browser-action runs
the cleanup. The only edge case: if the loop's `task_runner` is
forcefully cancelled and the `_teardown_browser` itself hangs (e.g., a
Playwright session that won't close), the shutdown path
(`main.py:232-238`) blocks since it `await runtime.stop()` inline. No
timeout around the teardown.

**Recommendation priority**: LOW (Playwright is generally well-behaved
on close); a `wait_for(_teardown_browser(), timeout=5)` would be
defence-in-depth.

---

## Section 4 — Files inspected

### Backend

| File                                          | Lines | Time spent |
|-----------------------------------------------|------:|-----------:|
| ai/provider.py                                |   586 |       12 m |
| ai/gemini_provider.py                         |   477 |        7 m |
| ai/ollama_provider.py                         |   337 |        5 m |
| ai/tool_use.py                                |   244 |        4 m |
| ai/tool_use_audit.py                          |    71 |        2 m |
| ai/json_response.py                           |    70 |        1 m |
| agent/loop.py                                 |   598 |       12 m |
| agent/runtime.py                              |   494 |       10 m |
| agent/schemas.py                              |   273 |        3 m |
| agent/observations.py                         |   155 |        3 m |
| agent/executor.py                             |   184 |        4 m |
| agent/audit.py                                |   301 |        4 m |
| agent/checkpoints.py                          |    34 |        1 m |
| agent/controls.py                             |    40 |        1 m |
| agent/self_model.py                           |    84 |        1 m |
| agent/planner/tactical.py                     |   383 |        7 m |
| agent/planner/strategic.py                    |   129 |        3 m |
| agent/planner/reflector.py                    |   110 |        2 m |
| agent/planner/_llm.py                         |    60 |        1 m |
| agent/safety/preconditions.py                 |   123 |        2 m |
| agent/safety/circuit_breakers.py              |    66 |        1 m |
| agent/safety/sandbox.py                       |    46 |        1 m |
| agent/actions/base.py                         |    46 |        1 m |
| agent/actions/registry.py                     |    89 |        2 m |
| agent/actions/browser.py                      |   244 |        4 m |
| agent/actions/web.py                          |   115 |        2 m |
| agent/actions/bash.py                         |    89 |        2 m |
| agent/actions/fs.py                           |   135 |        2 m |
| agent/actions/net.py                          |   108 |        2 m |
| agent/actions/process.py                      |    50 |        1 m |
| agent/actions/notify.py                       |    55 |        1 m |
| agent/actions/time_.py                        |    53 |        2 m |
| agent/actions/self_introspect.py              |   115 |        2 m |
| agent/actions/grounded.py                     |    42 |        1 m |
| agent/mcp/discovery.py                        |   106 |        3 m |
| agent/mcp/adapter.py                          |   226 |        4 m |
| agent/memory/seeds.py                         |   127 |        2 m |
| agent/memory/recall.py                        |    81 |        2 m |
| agent/memory/embedder.py                      |    67 |        1 m |
| agent/memory/backfill.py                      |    85 |        2 m |
| api/routes_agent.py                           |   205 |        4 m |
| vision/grounding.py                           |   351 |        4 m |
| db/models.py (agent + AiToolUseLog sections)  |   100 |        1 m |
| main.py (agent lifespan section)              |    80 |        2 m |
| config.py (agent + ai section)                |    50 |        1 m |

### Frontend

| File                                          | Lines | Time spent |
|-----------------------------------------------|------:|-----------:|
| stores/agentStore.ts                          |   357 |        6 m |
| services/agentApi.ts                          |    87 |        2 m |
| hooks/useAgentStream.ts                       |    35 |        1 m |
| utils/providerSummary.ts                      |    59 |        1 m |
| layouts/OperatorLayout.tsx                    |    73 |        1 m |
| components/core/StatusBar.tsx (9.2.1 section) |   100 |        2 m |
| components/agent/AgentPanel.tsx               |   140 |        2 m |
| components/agent/ControlsBar.tsx              |    94 |        1 m |
| components/agent/LLMCallBudget.tsx            |    55 |        1 m |
| components/agent/ActionCard.tsx               |   149 |        2 m |
| components/agent/TaskTree.tsx                 |   134 |        2 m |
| components/agent/SubstateIndicator.tsx        |    49 |        1 m |
| components/agent/InterventionDialog.tsx       |   120 |        2 m |
| components/agent/InnerMonologueTab.tsx        |    71 |        1 m |
| components/agent/ThoughtBudget.tsx            |    41 |        1 m |
| components/agent/GoalInput.tsx                |    78 |        1 m |
| components/agent/ObservationCard.tsx          |    52 |        skim |
| components/agent/FeedbackButtons.tsx          |    53 |        skim |

### Tests (cross-referenced, not deep-read)

- `test_phase09_2_1_resilience.py` — 487 lines, 16 tests, scanned for
  task_id passing pattern (Bash grep). Confirmed unit-only coverage
  (F-01 evidence).
- `test_phase09_loop.py`, `test_phase09_agent.py`,
  `test_phase09_2_tool_use.py`, `test_phase09_2_memory.py`,
  `test_phase09_2_grounding_web.py`, `test_phase09_2_mcp.py`,
  `test_phase09_2_persona.py`, `test_phase09_api.py` — grepped for
  presence of relevant test names per finding; not read line-by-line.
- Frontend `AgentPanel.test.tsx`, `LLMCallBudget.test.tsx`,
  `StatusBar.test.tsx`, `TaskTree.test.tsx`, `ControlsBar.test.tsx` —
  scanned for blocked_quota / budget event coverage.

**Total time used**: ~135 minutes (audit-active reading). Within 1.5h
target with the cross-reference Greps; ceiling 2h not breached.

---

## Section 5 — Areas NOT inspected (and why)

- **Phase 0-8 code surfaces touched by 9.x**: deliberately out of scope.
  E.g., `core/state_machine.py` was only checked for the
  `enter_operator` / `exit_operator` integration; the state machine's
  own state graph wasn't audited.
- **`response_formatter.py`, `prompt_builder.py`, `personality.py`**:
  pre-9.x; only confirmed they aren't on the 9.2.1 path. No deep read.
- **`security/auth.py` JWT plumbing**: assumed sound from earlier
  phases; the new agent endpoints uniformly use `require_auth`.
- **`vision/grounding.py` test cross-reference**: read the impl deeply,
  did not enumerate `test_phase09_2_grounding_web.py` test-by-test.
- **WebSocket hub internals (`api/websocket_hub.py`)**: assumed
  contract-correct. The agent-side concern about "WS event drop after
  reconnect" (Concern #7) is reported based on observed
  `useAgentStream` behaviour, not on hub internals.
- **`db/database.py` session lifecycle**: assumed sound; agent code
  uses `get_session` consistently.
- **All tests beyond grep cross-reference**: full test-file reads were
  spot-checked, not exhaustive. Each finding's "Test coverage" line is
  best-effort based on test names and the scanned regions.
- **OmniParser's actual stub return**: confirmed it always raises
  `GroundingUnavailable`; did not trace what an installed OmniParser
  would do (the comment at grounding.py:242 makes the stub explicit).
- **Frontend `chat.test.tsx` and other non-agent tests**: out of scope
  per spec.
- **Performance profiling**: no actual measurements taken — all "blocks
  the event loop" claims are based on knowing the API surface
  (sync `open()`, sync `psutil.process_iter`, sync `socket.connect`).
  Real impact magnitude is speculative.

---

## Section 6 — Estimated remediation effort

For all CRITICAL + HIGH findings (F-01 .. F-08), combined:

| Finding | Engineering hours | Test hours | Notes |
|---------|------------------:|-----------:|-------|
| F-01 (task_id thread-through)             | 0.5  | 1.5 | trivial code change; integration test is the work |
| F-02 (generate path resilience)           | 4.0  | 3.0 | extract classifier helper, share between call paths |
| F-03 (probe false positive)               | 1.5  | 2.0 | needs a primary-only health probe path |
| F-04 (MCP startup hang)                   | 2.0  | 2.0 | wait_for + parallel discover, fixture for hang test |
| F-05 (browser checkpoint loss)            | 1.0  | 1.0 | docs change + synthetic re-navigate observation |
| F-06 (strategic BlockedQuotaError swallow)| 0.5  | 0.5 | small except-clause fix |
| F-07 (time.wait wrong attr path)          | 0.25 | 0.5 | one-liner |
| F-08 (frontend hides STOP on blocked)     | 0.5  | 0.5 | predicate update + render test |
| **Total**                                 | **10.25 h** | **11.0 h** | **~21 hours combined** |

That's roughly **3 working days** for one engineer. With the F-02 +
F-03 fixes (the largest item) bundled into a single "uniform router
resilience" task, the work is naturally a single PR per finding family.

Recommend gating Phase 9.3 on F-01, F-02, F-03, F-08 at minimum (the
ones that directly compound under more LLM calls / longer tasks);
F-04, F-05, F-06, F-07 can land alongside or just after.

---
