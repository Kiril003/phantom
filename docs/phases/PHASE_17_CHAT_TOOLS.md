# PHASE 17 — Chat Tool-Use Loop

**Driver:** [audit-2026-04-28 FINDINGS](../audit-2026-04-28/FINDINGS.md) F-01 — *the single biggest leverage point* in the codebase. The chat path advertises `CHAT_DATA_TOOLS` to the LLM in the system prompt but never passes them to the API call, so every tool call the model emits is silently discarded.

The phase ships in two atomic commits:

- **17a** — Dispatcher + handlers + config flag (this commit). Catalog handlers ship behind a default-off flag; `routes_chat` does NOT yet route through `call_with_tools`. Status: ✅ shipped.
- **17b** — `routes_chat._build_ai_response` switches to `ai_router.call_with_tools` when `chat_tools_enabled`; max-iteration cap; per-tool dispatch via the 17a dispatcher; telemetry. Tag: `v0.17.0-chat-tools` lands here. Status: pending.

## 17a — Dispatcher (shipped)

### Files

- `src/backend/ai/chat_tool_dispatcher.py` — single async `dispatch(name, args, user_id, db)` entry-point + 5 registered handlers.
- `src/backend/config.py` — 4 new keys: `chat_tools_enabled`, `chat_tool_locationhistory_limit`, `chat_tool_anchors_limit`, `chat_tool_max_calls_per_turn`.
- `src/backend/tests/test_phase17a_chat_tool_dispatcher.py` — 15 cases.

### Tools shipped

| Tool name | Reads | Notes |
|---|---|---|
| `search_locationhistory` | `LocationHistory` ORM | distinct places in last N hours, optional substring filter, limit `chat_tool_locationhistory_limit` |
| `query_temporal_anchors` | `TemporalAnchor` ORM | filter by `state`, `mood`, time window |
| `recall_memory_facts` | ChromaDB via `memory.strategic_memory.retrieve_relevant` | semantic search |
| `get_system_metrics` | `psutil` | live CPU / RAM / disk / load / uptime |
| `get_sensor_status` | `core.context_engine.get_snapshot()` | sanitised radar / GPS / env summary |

### Tools deferred to 17b (security or integration)

| Tool name | Reason for deferral |
|---|---|
| `search_web` | Audit F-11 — clean exfiltration path through Google Search grounding combined with `recall_memory_facts`. Needs query-provenance check + chain-depth cap before it ships. |
| `get_calendar_events` | Calendar service hookup not yet plumbed. |
| `create_calendar_event` | Mutating tool — needs operator confirmation UI. |

`supported_tools()` returns only the 5 shipped handlers, so the future Phase 17b wiring filters the catalog passed to the LLM accordingly. The `unknown_tool` fallback in `dispatch()` covers any drift.

### Acceptance (17a)

- ✅ `pytest src/backend/tests/test_phase17a_chat_tool_dispatcher.py` — 15 / 15.
- ✅ Full backend pytest: **1079 / 1079** (+15 from 1064 after Phase 16).
- ✅ Dispatcher tolerates synthetic handler exceptions — `ok: False, error: ...` shape.
- ✅ Argument clamping: `hours_ago` outside `[1, 720]` collapses to defaults; `query` substring trimmed to ≤ 200 chars.
- ✅ Distinct places — same `place_name` collapses via SQL `GROUP BY`; verified at 6 inserts → 3 result rows.
- ✅ Substring filter is case-insensitive (`ilike '%VSB%'`).
- ✅ Default `chat_tools_enabled` is `False` — no behavior change for existing operators.
- ✅ `chat_tool_max_calls_per_turn` default is in `[1, 8]` — Audit F-11 chain-depth gate is ready to wire.

## 17b — `call_with_tools` wiring (pending)

The dispatcher is the LEGO piece; 17b is the assembly:

1. `routes_chat._build_ai_response`: when `chat_tools_enabled`, replace the single `ai_router.generate(...)` call with a bounded loop:
   - Pass `tools=[t for t in CHAT_DATA_TOOLS if t["name"] in supported_tools()]`.
   - On `ToolCallResult`, dispatch each tool via `chat_tool_dispatcher.dispatch`, collect results, re-prompt with `[tool, result]` history.
   - Cap iterations at `chat_tool_max_calls_per_turn`.
   - On `ToolUseError(SEMANTIC)`, fall back to plain `generate(...)` (model hallucinated a tool name).
2. Telemetry: each dispatched tool writes a row to `ai_tool_use_log` via existing `tool_use_audit.write_log` (already supports the `tool_name`, `success`, `elapsed_ms` fields the audit needs).
3. Settings UI surfaces the toggle automatically via `routes_settings.py` category metadata (no extra wiring required).
4. Acceptance: a fresh chat session asking "де я був вчора?" produces `[search_locationhistory(hours_ago=24)]` → result rows → answer mentioning concrete `place_name`s.

Tag `v0.17.0-chat-tools` lands on 17b commit.

## Block D budget note

Block D's wall-clock window in `docs/AUTONOMOUS_DAY_PLAN.md` was 90 min (08:00 → 09:30 CEST). Phase 17a took ~30 min including tests. Phase 17b is the productisation-blocking work, so it should land before Block E even if it pushes the SaaS layer's allocated start.

## Day-2 (audit-2026-04-29) hardening — invariants 17b MUST honour

The Day-2 audit's threat model (`docs/audit-2026-04-29-day2/FINDINGS.md`) constrained Phase 17b's wiring with three hard invariants. Tier C closed the supporting code (input validation, dispatcher timeout, audit columns, output classifier, CPU sampler); Phase 17b's commit MUST NOT relax these.

### Invariant 1 — Multi-tenant deploy is forbidden until per-tenant ContextEngine lands (D2-I2)

`chat_tool_dispatcher`'s `get_sensor_status` handler reads `core.context_engine.get_snapshot()` — a process-global. In a multi-tenant cloud deploy, every tenant would read every other tenant's sensors. Until per-tenant ContextEngine wiring exists, **PHANTOM OS daemons MUST run single-tenant**. The README + OPERATIONS doc carry the operational rule; Phase 17b's commit message must restate it. The audit calls this a deferred-architecture item — when per-tenant ContextEngine ships, retire this invariant.

### Invariant 2 — Phase 17b ships only the 5 read-only tools (D2-E1)

The dispatcher's `_HANDLERS` and `supported_tools()` are the choke point. As of Day-2 H-5 the dispatcher delegates each name to `tool_executor.execute_tool`; the production `tool_executor` knows about additional tools (`search_web`, `create_calendar_event`, `get_calendar_events`) that the dispatcher deliberately hides. Phase 17b MUST NOT add those names to `chat_tool_dispatcher._CHAT_SAFE_TOOL_NAMES` until:

1. `create_calendar_event` — per-tool consent flow (operator UI confirm before any mutating call), mutating-tool risk gate (mirroring `agent_risk_tolerance`), and an unconditional audit row even on dispatcher failure;
2. `search_web` — query-provenance check + chain-depth cap (audit F-11 prompt-injection exfil chain);
3. `get_calendar_events` — read path is safe; ships once the calendar service hook lands.

Tier C's drift contract test (`TestDelegationContract.test_no_handler_drift_with_executor`) freezes the chat-side name set; widening it requires an explicit code change a reviewer will see.

### Invariant 3 — `bash.run` is NEVER reachable from chat (D2-E2)

`agent/actions/bash.py` is exposed to the agent runtime via the agent's `tool_executor` catalog. The chat path's `chat_tool_dispatcher` MUST NOT register a delegate for any name that resolves to `bash.run` or any subprocess-launching handler. This invariant is permanent — there is no future phase where the chat user gets shell access.

The dispatcher's `_CHAT_SAFE_TOOL_NAMES` constant is the enforcement point. A reviewer who sees `bash`, `shell`, `subprocess`, `exec`, or `run` in that tuple should immediately revert the change.

### Pre-flight checklist for the Phase 17b commit

The Tier D plan in the audit calls these out as gates before tagging `v0.19.0-jarvis-online`:

- `tool_config_mode: Literal["AUTO","ANY"]` threaded through `AIProvider.call_with_tools` (closes audit F-52). Chat passes `"AUTO"`; the agent's tactical planner keeps `"ANY"`.
- Tool-result envelope: every dispatcher result wrapped in `{"_phantom_tool": "<name>", "ok": bool, "content": ...}` so the LLM cannot fake a tool-result marker by quoting one in plain text.
- `phantom_chat_tool_calls_total{tool=...,ok=...}` counter integrated.
- Output classifier (`ai/output_safety.sanitize`) called exactly once between final LLM response and `chat_broadcast` / TTS.
- `chat_tool_max_total_ms` per-turn ceiling honoured by the loop; abort to last-good response on overrun.
- `extract_and_store_facts` continues to receive `user_message` only — the AI-echo persistence path (D2-T2) stays closed.
