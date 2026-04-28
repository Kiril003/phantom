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
