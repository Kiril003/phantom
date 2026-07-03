# Phase 9.2.2 Resilience-Real — Acceptance

Run date: 2026-04-19 · branch `autonomous-run` · base tag `v0.9.2.1-resilience`
· final tag `v0.9.2.2-resilience-real`.

This is the surgical follow-up to the Phase 9.0–9.2.1 audit
(`docs/phase-09-audit/README.md`), which surfaced 1 CRITICAL + 8 HIGH + 18
MEDIUM + 11 LOW findings. 9.2.2 closes the 5 highest-severity items that
made the 9.2.1 resilience story real in production: per-task budget
enforcement, `generate()` resilience parity, honest blocked-quota recovery,
non-wedging MCP startup, and truthful checkpoint resume.

## Test counts

| Suite                  | Result                   | Δ vs 9.2.1 |
|------------------------|--------------------------|------------|
| Backend pytest         | **457 passed** in 116 s  | +27        |
| Frontend vitest        | **129 passed**           | +1         |

27 new backend tests land across 5 files:
`test_phase09_2_2_budget_integration.py`,
`test_phase09_2_2_generate_resilience.py`,
`test_phase09_2_2_probe.py`,
`test_phase09_2_2_mcp_isolation.py`,
`test_phase09_2_2_resume_caveat.py`. The one new frontend test is the
resume-caveat banner in `AgentPanel.test.tsx`.

Full-suite stability was restored in commit `40563e5` (test_phase00 reload
GC trap) — an unrelated latent bug that 9.2.2's test additions exposed.
Without that fix, the full suite 102 failed / 66 errored.

## What changed (vs v0.9.2.1-resilience)

### F-01 — per-task LLM-call budget actually enforced

**Commit**: `38375b4` (combined with F-02 — see note below).

- `agent/loop.py` threads `task_id=state.id` to every planner call:
  `strategic.plan`, `reflector.reflect`, `tactical.plan` (was already wired
  from 9.2.1 and stayed), `memory.seeds.compose_summary`.
- `agent/planner/_llm.py::llm_json` accepts `task_id` and forwards to
  `ai_router.generate`. Uses `inspect.signature` shim so 9.1-era tests
  monkey-patching `_call` with a single-arg fake keep working.
- `ai/provider.py::AIRouter.generate` now also bridges via
  `_runtime_note_llm_call(task_id)` — previously only `call_with_tools`
  did, so strategic/reflector/seeds were free.
- `config.agent_require_task_id_for_budget` (default `True`) — when a
  call arrives without `task_id`, the bridge logs a `WARNING` with the
  stack context instead of silently returning True.

**Verified by**:
`tests/test_phase09_2_2_budget_integration.py::TestBudgetThreadThrough::test_budget_cap_fires_from_real_path`
— constructs a real `AgentRuntime` + `TaskState`, runs 51 simulated
tactical-plan calls, asserts call 51 raises `call_budget_exhausted` and
that `runtime.foreground_slot.llm_calls_this_task == 50` (exactly the
configured cap). The pre-9.2.2 suite had no such test.

### F-02 — `generate()` participates in the resilience policy

**Commit**: `38375b4` (combined with F-01).

- `ai/provider.py::AIRouter.generate` rewritten to share the same
  cooling / quota-lock / backoff machinery as `call_with_tools`. The old
  one-shot try/except that fell through to Ollama on any 429 is gone.
- `ai/ollama_provider.py::_classify_ollama_error` added so local Ollama
  exceptions get mapped to `ToolErrorKind` (a 429 here means a paid
  gateway is in front of Ollama, so `RATE_LIMIT` rather than
  `QUOTA_EXHAUSTED`).
- `BlockedQuotaError` moved from `agent/planner/_llm.py` to
  `ai/provider.py` so `llm_json`'s `except JsonResponseError` clause no
  longer swallows it as a parse failure. Strategic / reflector / seeds
  all propagate it untouched now.
- `agent/loop.py::_ensure_strategic_plan` and `_run_reflection` wrap
  their planner calls in a `while True: try: … except BlockedQuotaError:
  enter_blocked_quota; continue` loop — strategic can now park on quota
  exactly like tactical has since 9.2.1. Reflection synthesises an
  `abandon_task` verdict if blocked-quota recovery is aborted.

**Verified by**:
`tests/test_phase09_2_2_generate_resilience.py::TestStrategicQuotaPropagation`
— strategic planner raises `BlockedQuotaError` when both providers are
quota-exhausted, and the loop parks the task on `blocked_quota` rather
than failing. The file's 8 tests cover every `ToolErrorKind` branch on
both `generate()` and `call_with_tools` paths.

### F-03 — blocked-quota probe targets the primary directly

**Commit**: `17f006c`.

- `agent/runtime.py::_probe_provider_recovered` rewritten. Previously it
  went through `ai_router.generate("ping")`, which fell through to the
  healthy-local Ollama and reported False-positive quota recovery every
  time. Now it resolves `ai_router.get_provider(primary_name)` and
  awaits its `provider.generate(...)` directly with a 10s timeout,
  classifying the failure.
- Only `QUOTA_EXHAUSTED` outcomes keep the task parked. Transient kinds
  (`NETWORK`, `TIMEOUT`, `PROVIDER_UNAVAILABLE`) return True so we don't
  deadlock on a flaky probe path.
- `agent/runtime.py::enter_blocked_quota` gains adaptive backoff: the
  first 3 probe failures keep the `agent_blocked_quota_probe_s`-default
  interval; from failure 4 onward the interval grows `× 2^n` up to
  `agent_blocked_quota_probe_max_s`. On the first extension a
  `task.blocked_quota_backoff` WS event is emitted so the UI can show
  "switching to slow-poll" instead of silence.

**Verified by**:
`tests/test_phase09_2_2_probe.py::TestProbeTargetsPrimary` — monkeypatches
both providers' `generate`, asserts the probe only hits the primary
(never the fallback) and returns False when Gemini is still 429. Six
tests cover probe targeting + adaptive backoff + backoff WS emission.

### F-04 — MCP discovery per-server timeout, parallel, isolated

**Commit**: `6d2f4d5`.

- `agent/mcp/adapter.py::McpStdioClient.connect` wraps
  `asyncio.create_subprocess_exec` in `asyncio.wait_for(timeout=10)`,
  raising `McpTimeout` instead of hanging forever.
- `agent/mcp/discovery.py` now runs discovery in parallel via
  `asyncio.gather(..., return_exceptions=True)`. Per-server wall-clock
  ceiling is `_DISCOVER_PER_SERVER_TIMEOUT_S = 10s` regardless of the
  server's own `timeout_s` config. Total startup latency is
  `max(per_server)` instead of `sum(per_server)`.
- One server's failure (timeout, crash, malformed tool, non-zero exit)
  is logged at WARN and the rest keep being registered. Post-discovery
  log line summarises succeeded / failed servers so operators can tell
  at a glance which MCP tools are actually live.

**Verified by**:
`tests/test_phase09_2_2_mcp_isolation.py::TestDiscoveryIsolation` —
spawns three fake servers: one fast, one that sleeps past the timeout,
one that crashes on spawn. The fast one's tools still register, others
fail cleanly. Four tests cover all-fail (graceful `{}` return) and
mixed-outcome cases.

### F-05 — checkpoint resume flags browser-session loss

**Commit**: `5af9ded`.

- `agent/runtime.py::resume_from_checkpoint` scans the audit trail for
  `browser.*` actions. When found, injects a `checkpoint_restore`
  system observation tagged `hint:browser_reset_after_resume` with the
  last known navigation URL. The tactical prompt
  (`planner/tactical.py::_SYSTEM_PROMPT_UA`) grew a new recovery pattern
  that tells the planner to `browser.navigate` to that URL as the first
  action rather than assume the page is still open.
- Emits `agent.resumed_with_caveat` WS event with `caveat:
  "browser_session_lost"` and `last_known_url` so the frontend can
  surface a banner.
- `src/frontend/src/stores/agentStore.ts` subscribes to the new event;
  `AgentPanel.tsx` renders a one-line caveat banner above the chat
  transcript when the caveat is present. Dismissed on next user turn.

**Verified by**:
`tests/test_phase09_2_2_resume_caveat.py::TestResumeWithBrowserHistory`
(3 backend tests for audit scan, observation injection, WS event) and
`src/frontend/src/__tests__/AgentPanel.test.tsx` (1 frontend test for
banner rendering).

## Live resilience test

Deferred. The 9.2.1 acceptance ran a live quota exhaustion on a fresh
Gemini free-tier key; repeating that today requires another fresh key
and would duplicate the 9.2.1 evidence without adding information
— the unit tests for F-02 / F-03 exercise the same code path with
mocked providers, and they assert on exact state transitions rather
than wall-clock behaviour.

## Bonus fix — test_phase00 reload GC trap

**Commit**: `40563e5`.

Not in the audit, but blocking 9.2.2. The full pytest suite was failing
with 102 broken tests because `test_phase00.py::test_db_init_creates_tables`
did `importlib.reload(db.database)` → created a second `Base` class →
after a second `importlib.reload(db.models)` in phase02 fixtures, all
model classes except `User` (held by `security/auth.py`'s module-level
import) got garbage-collected out of SQLAlchemy's
`WeakValueDictionary`-backed class registry. `User.memory_facts` then
could not resolve the string `"MemoryFact"` → the familiar
`InvalidRequestError` seen in 102 tests.

Fix: replace the reload with an isolated in-memory engine using the real
`Base`. 11 insertions / 14 deletions in one file. The 12 reload-
crutch blocks in other test files become dormant (not triggered) but
remain harmless; removal is a separate cleanup commit.

## Acceptance criteria

| Finding | Audit severity | Status       | Verifying test                                                          |
|---------|----------------|--------------|-------------------------------------------------------------------------|
| F-01    | CRITICAL       | **FIXED**    | `test_budget_cap_fires_from_real_path`                                  |
| F-02    | HIGH           | **FIXED**    | `TestStrategicQuotaPropagation` (8 tests across both paths)             |
| F-03    | HIGH           | **FIXED**    | `TestProbeTargetsPrimary`                                               |
| F-04    | HIGH           | **FIXED**    | `TestDiscoveryIsolation`                                                |
| F-05    | HIGH           | **FIXED**    | `TestResumeWithBrowserHistory` + AgentPanel banner test                 |

F-06 through F-27 from the audit (remaining HIGH / MEDIUM / LOW items)
are explicitly out of scope for 9.2.2 and tracked for later phases.

## Commit deviation note

The audit spec had F-01 and F-02 as separate commits. In the actual
stash they are tightly coupled at the source level —
`agent/planner/_llm.py` imports `BlockedQuotaError` from
`ai.provider` (a class move that is part of F-02), and
`agent/loop.py` catches it. Splitting into two commits would have left
an intermediate state with a `NameError` on import. They ship together
in `38375b4` with a combined commit message that cites both audit IDs.
The other three findings commit independently as planned.
