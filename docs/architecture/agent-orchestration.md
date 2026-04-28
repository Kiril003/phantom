# PHANTOM OS — `agent-orchestration` Cluster Architecture (Day-4 Phase-2)

**Cluster owner**: `chat-orchestrator` + `import-gate-discipline` (PHASE1_CONTEXTS.md:73-87).
**Day-4 blocks**: X-1 (skel), X-2 (must), X-3 (must), X-4 (must) — see PHASE1_BLOCK_ORDER.md:41,62-65.
**Default posture**: feature-flag OFF — `chat_orchestrator_enabled=False`. Day-3 single-turn `chat_pipeline.run` (`src/backend/ai/chat_pipeline.py:82-199`) remains the canonical path.
**Provider gate**: Gemini-only on the orchestrator boundary (TM-17B-S2 inheritance — see `docs/audit-2026-04-30-day3/threat-model-phase17b.md:193,1126`). Ollama fallback path collapses orchestrator → single-turn for that request.
**Threat coverage**: closes U3-ORCH-C1, U3-ORCH-C2, U3-ORCH-C3 (audit cross-check, PHASE1_CONTEXTS.md:177-180); mitigates U3-ORCH-H4 (silent cost explosion).

The cluster lives entirely under `src/backend/ai/agents/` (NEW). It does **not** import from `agent.actions`, `agent.runtime`, `agent.proactive`, `agent.standing_orders`, `agent.mcp` — TM-17B-E4 invariant extended to `ai/agents/**` per ADR-IGD-001.

---

## ADR-ORC-001 — Mode decision is per-call, default OFF, Gemini-only

**Decision**. The chat orchestrator decides `single-turn` vs `parallel-K` at the moment `routes_chat` invokes it. The decision is **stateless** with respect to history — it depends only on:
- `config.chat_orchestrator_enabled` (default `False`).
- The currently-routed provider (the choice respects `AIRouter._available_sequence` from `src/backend/ai/provider.py:661-676`; if Gemini is cooling/quota-locked the orchestrator falls through to single-turn regardless of flag).
- The wall-clock budget surfaced via `config.chat_tool_max_total_ms` (Day-3 default 12 000 ms, see `src/backend/ai/chat_pipeline.py:93-95`).

When the flag is `False` **the orchestrator must call `chat_pipeline.run` unchanged** (back-compat invariant — see §"Back-compat invariants" below). The orchestrator module-level guard short-circuits before any sub-agent allocation.

**Rationale**. Gemini-only is the TM-17B-S2 constraint — the Ollama provider's tool-use path string-concats `FunctionResponse` JSON into the prompt, which re-spawns the TM-17B-S1 nonce-injection threat (`docs/audit-2026-04-30-day3/threat-model-phase17b.md:193-220`). Day-4 ships the orchestrator scaffolding behind a gated flag; Day-5 will harden Ollama parity, after which the gate moves to `provider != "ollama"` instead of `provider == "gemini"`.

**Consequences**.
- One synthetic `task_id` is generated at orchestrator entry (see ADR-ORC-007). The flag-OFF path does **not** allocate it — the existing chat path already passes its own `task_id=None` via `routes_chat`.
- `router_state` snapshot (`src/backend/ai/provider.py:756-772`) gains no new keys; orchestrator fan-out telemetry is owned by `ai/agents/orchestrator.py:_record_dispatch` (NEW) rather than the router.

---

## ADR-ORC-002 — Per-sub-agent nonce; orchestrator-level nonce only at merge envelope

**Decision**. Each sub-agent leaf invocation generates its own `sub_nonce: str = secrets.token_hex(8)` at sub-turn start. The leaf builds its tool-result envelope keyed `_phantom_sub_<sub_idx>_<sub_nonce>` — distinct per leaf. The orchestrator's **merge envelope** (the single envelope handed to the merge LLM call) uses the existing module-level `_PROCESS_NONCE` from `src/backend/ai/chat_pipeline.py:60-61` so the merge LLM cannot forge a leaf-result marker either.

**Rationale**. U3-ORCH-C1 ("per-process nonce" finding, see audit cross-check at PHASE1_CONTEXTS.md:178). With K parallel sub-agents sharing `_PROCESS_NONCE`, leaf-A's tool result becomes guessable from leaf-B's history if the LLM behaves adversarially across siblings. Per-sub-agent nonces force any cross-leaf prompt-injection to guess `8 hex bytes × K` simultaneously, raising the cost from O(1) to O(2^(64K)).

**Implementation contract**.
```python
# ai/agents/nonce.py (NEW)
def fresh_sub_nonce() -> str:
    return secrets.token_hex(8)

def envelope_key_for_sub(sub_idx: int, sub_nonce: str) -> str:
    return f"_phantom_sub_{sub_idx}_{sub_nonce}"
```
Reuses existing `envelope_key()` test seam from `src/backend/ai/chat_pipeline.py:73-76` for the merge envelope so the contract test stays uniform.

**Consequences**.
- `ai/agents/sub_agent.py:run_leaf` accepts `sub_nonce` as a parameter (interface §"Interfaces" below).
- The dispatch path (`chat_tool_dispatcher.dispatch` at `src/backend/ai/chat_tool_dispatcher.py:81-172`) is **unchanged** — the dispatcher does not care about envelope keys. The keying lives entirely on the chat side, between dispatch and the next LLM call.

---

## ADR-ORC-003 — Leaf-then-merge sanitize (defence in depth)

**Decision**. `output_safety.sanitize` (`src/backend/ai/output_safety.py:145-213`) runs **at each leaf** on the leaf's draft text *before* concatenation into the merge LLM history, then **again** at the merge LLM's final output before broadcast.

**Rationale**. U3-ORCH-C2 (cross-agent prompt-injection, PHASE1_CONTEXTS.md:179) — without leaf-side sanitize, sensitive content from leaf-A's `recall_memory_facts` result can flow verbatim into leaf-B's prompt context via the merge concatenation, bypassing the single sanitize gate that Day-3 wired at `routes_chat._build_ai_response` (Block O-6 closure, FINDINGS.md:209-211). With leaf-side sanitize the merge LLM never *sees* a verbatim sensitive quote, so it cannot honestly reproduce one even if the user asks for "summarize what each agent found".

**Implementation contract**.
- `sub_agent.run_leaf` calls `sanitize(text=leaf_draft, user_id=user_id, db=db)` immediately after the leaf's final `ai_router.generate` returns. The leaf-side sanitize crash-rule mirrors `_safe_sanitize` in `src/backend/ai/chat_pipeline.py:254-265` — sanitizer crash returns the original draft, never blocks the leaf.
- `merge.fold` re-runs `sanitize` on the merged final text. This is a separate `examined_facts`-counting pass; the redactions list from the merge pass is the canonical list surfaced on the audit row (leaf redactions are summed into `total_redactions_at_leaves` for telemetry only).

**Consequences**.
- `examined_facts` metric (output_safety.py:131) doubles in volume per parallel-K turn — acceptable: Day-3's 200-row LIMIT in `_load_user_sensitive_facts` (output_safety.py:227-233) is a per-call ceiling, not per-user.
- The leaf-sanitize SQL query (`SELECT MemoryFact WHERE user_id=...` at output_safety.py:227) is read-only, so the K parallel leaves contend only on the SQLite read lock — no write barrier introduced.
- **Fail-open invariant**: a sanitize crash at the merge step still returns the merged text (mirrors chat_pipeline.py:264-265 behaviour). Logged at WARNING.

---

## ADR-ORC-004 — Budget split: per-sub + merge reserve

**Decision**. Total wall-clock budget is `config.chat_tool_max_total_ms` (chat_pipeline.py:93-95 inheritance). Orchestrator splits it as:
```
per_sub_ms     = (chat_tool_max_total_ms - chat_orchestrator_merge_reserve_ms) // K
merge_reserve  = chat_orchestrator_merge_reserve_ms
```
Defaults from PHASE1_CONTEXTS.md:77: `K=3`, `chat_orchestrator_per_subagent_ms=3500`, `chat_orchestrator_merge_reserve_ms=1500`. With `chat_tool_max_total_ms=12000` and `K=3` the live split is `per_sub=3500, reserve=1500` (= 12000 - 3 × 3500). Config keys land in X-4.

**Rationale**. The Day-3 deadline arithmetic at chat_pipeline.py:93-95 is reused — same monotonic clock, same overall ceiling. The merge LLM call is treated as a first-class budget consumer, not "whatever's left over"; without an explicit reserve a single slow leaf (e.g. a `recall_memory_facts` returning 4000 chars) can starve the merge call, which then falls through to the dispatch-fallback text at chat_pipeline.py:244-251 — visible to the operator as a degraded `[tool] ...` reply.

**Interface**.
```python
def budget.split(total_ms: int, K: int, reserve_ms: int) -> tuple[int, int]:
    per_sub = max(500, (total_ms - reserve_ms) // K)
    return per_sub, reserve_ms
```
The 500 ms floor protects the leaf from a config-set `total_ms` that's pathologically small. Below 500 ms the orchestrator must route to single-turn (decided by `decide_mode`).

---

## ADR-ORC-005 — `asyncio.wait(..., return_when=ALL_COMPLETED)` — never `gather + wait_for`

**Decision**. The orchestrator uses
```python
done, pending = await asyncio.wait(
    leaf_tasks,
    timeout=per_sub_ms / 1000.0,
    return_when=asyncio.ALL_COMPLETED,
)
for t in pending:
    t.cancel()  # post-deadline only — survivors that finished in `done` keep their result
```
**Not** `asyncio.gather(*leaves, return_exceptions=True)` wrapped in `asyncio.wait_for(...)` — the latter cancels every survivor when the outer timeout fires, which would discard already-completed leaf results.

**Rationale**. U3-ORCH-H4 ("budget exhaustion" failure mode) — a single slow leaf must not destroy the orchestrator turn. The merge call is allowed to fold whatever subset of leaves *did* complete, augmented by a synthetic `LeafResult(ok=False, reason="leaf_timeout")` for the still-pending ones. This matches the Day-3 chat_pipeline behaviour where a deadline miss surfaces the dispatch-fallback (chat_pipeline.py:155-163) instead of an exception.

**Consequences**.
- Cancelled leaves still bubble up `asyncio.CancelledError`. The orchestrator wraps the cancel call in `with contextlib.suppress(asyncio.CancelledError)` after the wait, mirroring the cleanup pattern at `src/backend/ai/provider.py:8` (the `contextlib` import is already in scope).
- Cancellation on the leaf does *not* cancel the in-flight `chat_tool_dispatcher.dispatch` call — the dispatcher has its own `asyncio.wait_for` ceiling at `src/backend/ai/chat_tool_dispatcher.py:116-119`. The two timeouts compose: leaf budget caps the *orchestrator's* tolerance, dispatcher cap caps the *tool's*.
- `asyncio.shield` is **not** needed — `chat_tool_dispatcher.dispatch` is best-effort and audit-logged via `_audit_dispatch` (chat_tool_dispatcher.py:206-256); a cancelled dispatch row is observable on the audit log as `success=False, error_kind=CancelledError`.

---

## ADR-ORC-006 — Stable join order by `sub_agent_idx`

**Decision**. The merge LLM history concatenates leaf results by `sub_agent_idx` (the original spawn order), **not** by completion order from `done` set returned by `asyncio.wait`.

**Rationale**. Determinism for the merge LLM. Otherwise a 50 ms timing jitter between leaf-1 and leaf-2 produces a different merge prompt, which produces a different merge output, which the user perceives as the assistant "changing its mind on identical input". This also poisons memoisation/replay testing (Day-5 will likely add Gemini response replay at the merge boundary).

**Implementation**. Each `LeafResult` carries `sub_idx: int`. `merge.fold` does `sorted(leaves, key=lambda l: l.sub_idx)` before building the history. Test X-2 pins this with a deterministic seed: spawn K=3 leaves whose simulated work completes in order [2, 0, 1] — the merge history must still read leaves [0, 1, 2].

---

## ADR-ORC-007 — Synthetic chat-orchestrator `task_id`

**Decision**. At orchestrator entry, generate a synthetic `task_id = f"chat-orch-{secrets.token_hex(8)}"`. Pass this `task_id` through every `ai_router.generate` and `ai_router.call_with_tools` invocation made inside the orchestrator (one for each leaf, one for the merge call).

**Rationale**. The router's per-task LLM-call budget guard (`src/backend/ai/provider.py:861-909`, `_runtime_note_llm_call`) calls `agent_runtime.note_llm_call(task_id)`. Without a synthetic id, every parallel-K turn passes `task_id=None`, which currently triggers the WARNING at provider.py:880-885 ("router call invoked without task_id — per-task LLM budget will NOT count this call") and **does not enforce any cap**. K=3 leaves + 1 merge = 4× the LLM cost per turn that the existing `agent_max_llm_calls_per_task` cap would normally bound. U3-ORCH-H4: silent cost explosion.

**Consequences**.
- `agent_runtime.note_llm_call` is asked once per orchestrator-issued LLM call (4× per parallel-K=3 turn). The runtime budget for `chat-orch-*` task ids is configured separately via `config.agent_max_llm_calls_per_task` (existing key) — orchestrator does *not* introduce a new budget knob; it reuses the existing one.
- The synthetic `task_id` is **not** persisted as an `AgentTask` row — the runtime's `note_llm_call` accepts unknown task_ids without raising (verified at provider.py:904-909 — the `try/except` swallows). This is acceptable: the budget-counter side-effect is what we need; the reflective task lifecycle (status, transitions) is not.
- The audit log row written by `_audit_dispatch` (chat_tool_dispatcher.py:240-254) carries the synthetic `task_id`, making the orchestrator turn's tool-calls trivially queryable: `SELECT * FROM ai_tool_use_log WHERE task_id LIKE 'chat-orch-%'`.

---

## ADR-IGD-001 — Import gate extended to `ai/agents/**`

**Decision**. `src/backend/tests/test_chat_import_gate.py` (NEW in X-3) is an AST-walk test that fails if any module under `src/backend/ai/agents/**` imports from any of:

| Forbidden root | Reason |
|---|---|
| `agent.actions` | Side-effect tools (bash, fs, net, notify) — chat must dispatch via `chat_tool_dispatcher` only (TM-17B-E2 invariant inheritance — chat_pipeline.py:1-23 docstring). |
| `agent.runtime` | Tactical task lifecycle. The synthetic-`task_id` budget reuse from ADR-ORC-007 goes through `ai.provider._runtime_note_llm_call`, **not** a direct `agent.runtime` import. |
| `agent.proactive` | Background initiative loop — orthogonal to user-driven chat. |
| `agent.standing_orders` | Schedules/conditions/actions of the persistent task system. Day-4 keeps standing orders on a separate import island (T-1..T-4 cluster). |
| `agent.mcp` | MCP adapter. Tools surface to the chat side via the `chat_tool_dispatcher` allowlist (`src/backend/ai/chat_tool_dispatcher.py:46-52`), never via direct MCP import. |

**Day-4 enforcement**. CI-only. The test fails the pytest run; no runtime metapath finder is installed. Day-5 will add a runtime `sys.meta_path` finder that raises `ImportError` if any of the forbidden roots is dynamically resolved from inside `ai.agents` — that's a separate ADR.

**Implementation sketch** (test only — code is X-3's responsibility):
```python
# src/backend/tests/test_chat_import_gate.py (NEW, ~70 LOC)
import ast
import pathlib
FORBIDDEN_ROOTS = {"agent.actions", "agent.runtime", "agent.proactive",
                   "agent.standing_orders", "agent.mcp"}
def test_ai_agents_does_not_import_agent_internals():
    base = pathlib.Path(__file__).parent.parent / "ai" / "agents"
    for py in base.rglob("*.py"):
        tree = ast.parse(py.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module:
                root = node.module.split(".", 1)[0] + ("." + node.module.split(".")[1]
                       if "." in node.module else "")
                # Match "agent.actions", "agent.actions.bash", "agent.actions.fs", ...
                for forbidden in FORBIDDEN_ROOTS:
                    assert not (node.module == forbidden or node.module.startswith(forbidden + ".")), (
                        f"{py}: forbidden import '{node.module}'"
                    )
```
Test extends the TM-17B-E4 closure already shipped in Day-3 Block-Q for `ai/chat_pipeline.py` (FINDINGS.md:162) — same AST-walk shape, broader path glob.

---

## Interfaces (Python)

All defined in `src/backend/ai/agents/` (NEW).

```python
# ai/agents/orchestrator.py
async def run(
    *,
    user_message: str,
    system_prompt: str,
    history: list[dict],
    user_id: str,
    db: AsyncSession,
) -> AIResponse:
    """Entry point invoked by routes_chat when chat_orchestrator_enabled.
    Falls through to chat_pipeline.run when decide_mode returns 'single-turn'."""

def decide_mode(deadline_ms: int, provider: str) -> Literal["single-turn", "parallel-K"]:
    """Pure function — no I/O. Returns 'single-turn' if any of:
      - chat_orchestrator_enabled is False,
      - provider != 'gemini' (TM-17B-S2 inheritance, ADR-ORC-001),
      - deadline_ms < (K * 500 + chat_orchestrator_merge_reserve_ms),
      - K (chat_orchestrator_max_subagents) <= 1.
    Otherwise 'parallel-K'."""
```

```python
# ai/agents/sub_agent.py
@dataclass(frozen=True)
class LeafResult:
    sub_idx: int
    sub_nonce: str
    ok: bool
    text: str                      # already sanitized at leaf (ADR-ORC-003)
    redactions_at_leaf: int        # count, for merge-side telemetry
    reason: str | None = None      # "leaf_timeout" | "provider_error" | None on success

async def run_leaf(
    *,
    sub_idx: int,
    sub_nonce: str,
    budget_ms: int,
    user_message: str,
    system_prompt: str,
    history: list[dict],
    user_id: str,
    db: AsyncSession,
    task_id: str,                  # synthetic chat-orch-<hex> — ADR-ORC-007
) -> LeafResult:
    """Single leaf turn. Composes ai_router.call_with_tools (Gemini-only),
    chat_tool_dispatcher.dispatch, and output_safety.sanitize.
    Never raises — failure surfaces as LeafResult(ok=False, reason=...)."""
```

```python
# ai/agents/merge.py
async def fold(
    leaves: list[LeafResult],
    merge_reserve_ms: int,
    *,
    user_message: str,
    system_prompt: str,
    history: list[dict],
    user_id: str,
    db: AsyncSession,
    task_id: str,                  # same synthetic id as leaves — ADR-ORC-007
) -> AIResponse:
    """Sort leaves by sub_idx (ADR-ORC-006), build merge history with
    nonced envelopes, call ai_router.generate with merge_reserve_ms cap,
    sanitize merge output (ADR-ORC-003 second pass)."""
```

```python
# ai/agents/budget.py
def split(total_ms: int, K: int, reserve_ms: int) -> tuple[int, int]:
    """Returns (per_sub_ms, merge_reserve_ms) — see ADR-ORC-004."""
```

```python
# ai/agents/nonce.py
def fresh_sub_nonce() -> str: ...
def envelope_key_for_sub(sub_idx: int, sub_nonce: str) -> str: ...
def envelope_key_for_merge() -> str:
    """Reuses chat_pipeline.envelope_key() — single source of truth."""
```

---

## Test plan

### X-1 — orchestrator skeleton (220 LOC, skeleton tier)
- `test_orchestrator_disabled_falls_through` — flag OFF → `chat_pipeline.run` called once, zero allocations under `ai/agents/`.
- `test_decide_mode_pure` — pure-function table test for `decide_mode` covering: flag-off, ollama-active, sub-min-budget, K=1.
- `test_orchestrator_module_imports_clean` — `import ai.agents.orchestrator` doesn't pull `agent.actions`/`runtime`/`proactive`/`standing_orders`/`mcp` (paired with X-3's deeper AST gate).

### X-2 — nonce + sanitize (110 LOC, must)
- `test_per_sub_nonces_unique` — spawn K=3 leaves under a deterministic monkeypatch of `secrets.token_hex` that returns a counter; assert all three `sub_nonce` values differ AND none equals the merge-envelope `_PROCESS_NONCE`.
- `test_leaf_sanitize_runs_even_when_merge_llm_fails` — monkeypatch the merge `ai_router.generate` to raise `RuntimeError`; verify each leaf's `sanitize` was still called by inspecting the audit log row count (`output_safety._load_user_sensitive_facts` patched to count calls).
- `test_leaf_sanitize_redacts_before_concat` — leaf-A returns text containing a sensitive `MemoryFact`; merge LLM is given the leaf history; assert the leaf history visible to the merge LLM contains `[REDACTED]` not the original content. (Pins ADR-ORC-003.)
- `test_merge_sanitize_runs_after_leaves` — sanitize called K+1 times total (K leaves + 1 merge).

### X-3 — import-gate AST test (70 LOC, must)
- `test_ai_agents_does_not_import_agent_actions` — synthetic `ai/agents/orchestrator.py` containing `from agent.actions import bash` (created in tmp-path then ast-parsed) → test asserts FAIL.
- `test_ai_agents_imports_chat_tool_dispatcher_ok` — `ai/agents/sub_agent.py` importing `ai.chat_tool_dispatcher` → test asserts PASS.
- `test_existing_files_pass_gate` — running the gate against the real `src/backend/ai/agents/` tree must pass (regression guard for live commits).

### X-4 — budget split + asyncio.wait (90 LOC, must)
- `test_budget_split_default` — `split(12000, 3, 1500) == (3500, 1500)`.
- `test_budget_split_floor` — `split(600, 3, 100) == (500, 100)` (floor enforcement).
- `test_one_leaf_timeout_does_not_cancel_siblings` — three asyncio.sleep leaves of 100/4000/100 ms with `per_sub_ms=200`; assert `done` set has 2 leaves with valid results, `pending` has 1 (the 4000 ms one) cancelled. Critical regression test for ADR-ORC-005 (the gather+wait_for footgun).
- `test_merge_history_stable_order` — leaves complete in [2, 0, 1] order (controlled via `asyncio.Event`); merge history dict-list contains them in [0, 1, 2] order.
- `test_synthetic_task_id_passed_to_runtime_note_llm_call` — patch `agent.runtime.agent_runtime.note_llm_call`; assert it's called K+1 times with the same `chat-orch-<hex>` id (ADR-ORC-007).

---

## Performance budgets

Measured deltas vs Day-3 single-turn `chat_pipeline.run`:

| Path | p50 | p95 | Notes |
|---|---|---|---|
| **Flag OFF (single-turn fall-through)** | +0–5 ms | +50 ms | Orchestrator entry overhead = `decide_mode` call + one `import` resolution. |
| **Flag ON, parallel-K=3 fires** | +120 ms | +300 ms | Extra: K leaf sanitize passes + merge sanitize + asyncio.wait scheduling + one extra `note_llm_call` per LLM invocation. |

The +300 ms p95 budget is the **net new orchestrator overhead**, not total turn latency. Net turn latency under parallel-K=3 is bounded above by `chat_tool_max_total_ms` (12 s default) — same ceiling as Day-3 single-turn. The orchestrator does not enable turns that would otherwise be impossible; it parallelises tool-fetch-then-generate work across K sub-agents.

**Validation**. The latency Histogram primitive landing in V-6 (PHASE1_BLOCK_ORDER.md:39) gains a `chat_orchestrator_overhead_ms` series. V-6 is in the same Wave 2 — orchestrator can read from the same Histogram class.

---

## Back-compat invariants (CI-enforced)

1. **Default OFF**. `config.chat_orchestrator_enabled` defaults to `False` — operator opt-in only.
2. **Flag OFF → byte-identical to Day-3**. With the flag off, `routes_chat`'s call site reaches `chat_pipeline.run` with the same arguments shape it does today. The orchestrator module is allowed to be `import`-ed (so `routes_chat` can do the flag check at module level), but no allocation under `ai/agents/` happens before `decide_mode` returns `single-turn`.
3. **Day-3 chat suite green**. `tests/test_phase18_chat*.py` (existing) must remain green at every X-* commit. Specifically: `test_chat_with_tools_loop`, `test_chat_pipeline_envelope_nonce`, `test_chat_dispatcher_audit` are the suite's load-bearing tests.
4. **TM-17B-E2 inheritance**. `ai/agents/sub_agent.py` MUST dispatch tools through `chat_tool_dispatcher.dispatch` — never `tool_executor.execute_tool` directly. Enforced by ADR-IGD-001 import-gate AST plus a positive-direction test (`test_existing_files_pass_gate`).
5. **TM-17B-S1 nonce envelope contract**. Every tool-result blob handed to any LLM (leaf OR merge) is envelope-keyed with a nonce — leaf nonces per ADR-ORC-002, merge nonce reusing `chat_pipeline._PROCESS_NONCE`.
6. **AIRouter cooling/quota lock**. Orchestrator never bypasses `AIRouter._is_provider_available` (provider.py:685-701). If the provider returns `BlockedQuotaError`, the orchestrator surfaces it the same way single-turn does today (the agent loop catches it upstream — provider.py:37-48).

---

## Open questions / Day-5+ deferrals

- **Ollama parity** (TM-17B-S2). Day-5 hardens Ollama's tool-use to native FunctionResponse parity; orchestrator gate then changes from `provider == "gemini"` to `provider != "ollama-string-concat"`.
- **Runtime metapath finder for ADR-IGD-001**. Day-5 — runtime `sys.meta_path` finder that raises `ImportError` if `ai.agents.*` ever resolves a forbidden root via dynamic import / pickle / config-driven plugin. Day-4 ships CI-only.
- **Hub-driven sub-agent dispatch** (Z-4 dependency). Day-4 X-* hardcodes leaf provider = primary Gemini. When Z-1..Z-4 land, sub-agents pick provider via `ai.hub.pick(task_class)` — Z-4 explicitly depends on X-1 per PHASE1_BLOCK_ORDER.md:15.
- **Replay/memoisation** of merge LLM calls. Out of Day-4 scope; tracked under chat-perf cluster's W-5 follow-on work.

---

## File map

| Path | Status | Block | LOC budget |
|---|---|---|---|
| `src/backend/ai/agents/__init__.py` | NEW | X-1 | 10 |
| `src/backend/ai/agents/orchestrator.py` | NEW | X-1, X-4 | 110 |
| `src/backend/ai/agents/sub_agent.py` | NEW | X-1, X-2 | 90 |
| `src/backend/ai/agents/merge.py` | NEW | X-1, X-2 | 70 |
| `src/backend/ai/agents/budget.py` | NEW | X-4 | 30 |
| `src/backend/ai/agents/nonce.py` | NEW | X-2 | 25 |
| `src/backend/tests/test_chat_import_gate.py` | NEW | X-3 | 70 |
| `src/backend/tests/test_orchestrator_*.py` | NEW | X-1, X-2, X-4 | ~250 |
| `src/backend/config.py` | EDIT | X-4 | +6 (4 new keys) |
| `src/backend/api/routes_chat.py` | EDIT | X-1 | +12 (orchestrator opt-in branch) |

Total cluster footprint: ~670 LOC of code + tests, fits the X-1+X-2+X-3+X-4 = 490 LOC code budget plus ~250 LOC tests.
