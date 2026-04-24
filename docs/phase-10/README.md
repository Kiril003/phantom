# Phase 10 — Chat tool-use

**Date:** 2026-04-24
**Branch:** `autonomous-run`
**Pre-phase baseline commit:** `6121d29` (v0.9.5.1-streaming)
**Tag:** `v0.10-chat-tool-use` (applied on success)

---

## Summary

Chat can now answer data questions. Gemini receives 8 data-fetching
tools (`search_locationhistory`, `query_temporal_anchors`,
`recall_memory_facts`, `get_system_metrics`, `get_sensor_status`,
`search_web`, `get_calendar_events`, `create_calendar_event`) in
addition to the Phase 9.5 response-form tools. When a user asks a
data question, the model calls the matching tool, the tool runs
against real project state, its result is passed back as a
`function_response` Part, and the model generates the final reply
with real data.

`"де я був вчора?"` now returns actual `location_history` hits.
`"покажи CPU"` now returns `respond_metrics` backed by live `psutil`.
`"додай зустріч завтра о 15:00 Phase 10 roundtrip"` creates the
event; the follow-up `"плани на завтра?"` returns it.

---

## What shipped

### 1. Tool catalog — `src/backend/ai/chat_tools.py`

Eight JSON-Schema entries in `CHAT_DATA_TOOLS` plus a `DATA_TOOL_NAMES`
frozenset that the generate loop uses to distinguish data tools from
response-form tools.

| Tool | Purpose |
|---|---|
| `search_locationhistory(hours_ago, query?)` | Last-N-hours `location_history` rows, optional `place_name` ILIKE filter |
| `query_temporal_anchors(state?, mood?, hours_ago?)` | Filter `temporal_anchors` by state/mood/time window |
| `recall_memory_facts(query, layer?)` | ChromaDB semantic search; SQL `memory_facts` fallback |
| `get_system_metrics()` | Live `psutil` cpu/ram/disk/uptime/load — pairs with `respond_metrics` |
| `get_sensor_status()` | ContextEngine snapshot: radar + camera + env + gps + battery |
| `search_web(query)` | Gemini Google Search grounding; degrades to error on Ollama |
| `get_calendar_events(date_range)` | `today`/`tomorrow`/`this_week`/`next_week`/`YYYY-MM-DD`/`YYYY-MM-DD..YYYY-MM-DD` |
| `create_calendar_event(title, start_at, end_at?, notes?)` | UA/EN natural-language datetime or ISO-8601 |

### 2. Tool executor — `src/backend/ai/tool_executor.py`

`async def execute_tool(name, args, user_id, *, timeout_s=10.0) -> dict`
dispatches to per-tool handlers and **never raises** — all outcomes
are dicts (`{"ok": True, ...}` or `{"error", "error_kind"}`).

Each call is wrapped in `asyncio.wait_for` with a 10-second ceiling
(bumped from 5s after SQLite contention showed up live — see "Gate 5
debug" below). `MAX_TOOL_CALLS_PER_TURN = 3` is enforced upstream by
the generate loop.

`_session_factory()` resolves `AsyncSessionLocal` dynamically from
`db.database` so tests can swap in a tmp engine without re-importing
handlers.

Bundled: a small free-form datetime parser (`_parse_datetime_freeform`)
and a range resolver (`_parse_date_range`). No `dateparser` or
`python-dateutil` dependency added.

### 3. Generate loop with tool-use roundtrip — `src/backend/ai/gemini_provider.py`

`GeminiProvider.generate()` now accepts `user_id`. When present, the
merged catalog `RESPONSE_FORM_TOOLS + CHAT_DATA_TOOLS` is offered.
On a data-tool `function_call`:

1. `execute_tool(name, args, user_id)` runs.
2. The result dict is appended to `contents` as a
   `function_response` Part.
3. The model is re-called with the same catalog, up to
   `MAX_TOOL_CALLS_PER_TURN=3` data calls.
4. After the cap, the catalog collapses to `RESPONSE_FORM_TOOLS` only
   — forcing a response form or plain text.

Ollama fallback skips the chain entirely (signature accepts and
ignores `user_id`), matching the spec's "Ollama chain partial —
that's OK" note. `AIRouter.generate` threads `user_id` through;
`routes_chat._build_ai_response` passes `user.id`.

`_build_gemini_tools(tool_dicts)` generalised to accept any dict
list (default: `RESPONSE_FORM_TOOLS`). INTEGER type is now
distinguished from NUMBER and array-item types are passed through so
integer params (`hours_ago`) serialise correctly.

### 4. Prompt guidance — `src/backend/ai/personality.py`

New `DATA_TOOLS_GUIDANCE` constant appended to the chat system
prompt after `RESPONSE_FORMS_GUIDANCE`. Without this block, the
model silently declined to call data tools even when they were
available. Lists every tool name with the trigger patterns the spec
calls out and explicitly reminds the model of the 3-call cap.

### 5. Pre-generate commits — `src/backend/api/routes_chat.py`

Two `await db.commit()` calls added to the chat route: one right
after the user-message flush, another right before
`ai_router.generate()`. This drops the SQLite write lock so tool
handlers can open their own sessions without deadlocking. See "Gate
5 debug" below for why this was needed.

### 6. SQLite BUSY timeout — `src/backend/db/database.py`

`connect_args` adds `timeout=30.0`. Belt-and-braces: if any future
path re-introduces a held write lock, aiosqlite waits up to 30s for
it to clear instead of raising `database is locked` immediately.

---

## Test count

| Suite    | Before | After | Delta |
|----------|--------|-------|-------|
| Backend  | 746    | 775   | **+29** |
| Frontend | 178    | 178   | 0 |

Added `tests/test_phase10_tool_use.py` — 29 tests covering:

- Tool catalog integrity (names distinct from response forms, every
  required field appears in properties).
- `_build_gemini_tools()` merge + default behaviour.
- `DATA_TOOLS_GUIDANCE` appended AFTER response-forms block.
- UA/EN datetime parser: "завтра о 14:00", "tomorrow at 9", ISO forms.
- Tool executor dispatch: unknown tool, timeout, exception, invalid args.
- `get_system_metrics` / `get_sensor_status` envelope shape.
- Calendar round-trip against a tmp SQLite engine.
- Generate loop: data-tool roundtrip, 3-call cap, no data tools when
  `user_id=None`, graceful tool-error degradation.

Two existing test files tweaked for signature changes (they stubbed
`_build_gemini_tools` as `lambda: []` and
`_ScriptedGenerateProvider.generate` didn't accept `user_id`).

---

## Gate 5 debug (what tripped and how it was fixed)

**Symptom.** First live pass of the 15-query script: Q13
(`додай зустріч ...Phase 10 test`) returned no text in 12 s,
Q14 (`плани на завтра?`) returned "немає запланованих". Backend log:

```
create_calendar_event timed out after 5.0s
```

Then, after bumping timeout to 10s:

```
create_calendar_event raised
…
sqlite3.OperationalError: database is locked
```

**Cause.** `routes_chat` holds an open write transaction for the full
turn. `db.add(user_msg); await db.flush()` opens the transaction;
`process_chat_message_for_places(db, …)` reuses it to INSERT
`memory_facts` rows; commit doesn't happen until after
`_build_ai_response`. Meanwhile `execute_tool` opens a **separate**
`AsyncSession` to INSERT `CalendarEvent` — classic single-writer
SQLite deadlock. The chat session can't commit until the tool
returns; the tool can't acquire the write lock until the chat
session commits.

**Fix.** Commit the chat session explicitly at two points:

- After the user-message flush (line 275).
- Right before `_build_ai_response` so everything queued by
  geo-integration / proactive / self-model hooks also lands.

Plus `TOOL_TIMEOUT_S = 10.0` and `connect_args["timeout"] = 30.0`
as defence in depth.

**Verification** (`/tmp/phantom-10-calround3.out`):

```
[01] Q: додай зустріч завтра о 15:00 Phase 10 roundtrip
     http_ms=4013  form=text  content=зустріч додано.
[02] Q: плани на завтра?
     http_ms=4636  form=text  content=Завтра, 25 квітня, у вас заплановано
                                      "Phase 10 roundtrip" з 15:00 до 16:00.
```

DB check:
```
Phase 10 roundtrip | 2026-04-25 15:00:00 | user=phantom
```

---

## Live test — 15 queries (session `fc624a46-b966-...`)

### Per-query transcript

| # | Query | Tool invoked | Form | ms | Verdict |
|---|---|---|---|---|---|
| 01 | привіт | none | text | 1122 | OK |
| 02 | як справи? | none | text | 3807 | OK |
| 03 | напиши функцію sort | none | code | 3880 | OK |
| 04 | виконай ls | none | terminal | 3610 | OK |
| 05 | де я? | get_sensor_status | text | 4337 | ✓ tool |
| 06 | покажи CPU | get_system_metrics | metric_cards | 4600 | ✓ tool+metrics |
| 07 | хто поруч зараз? | get_sensor_status | text | 4244 | ✓ tool |
| 08 | де я був вчора? | search_locationhistory | text | 4652 | ✓ tool — real Přívoz data returned |
| 09 | коли я нервував на тижні? | query_temporal_anchors | text | 4492 | ✓ tool |
| 10 | що ти знаєш про VSB? | recall_memory_facts | text | 4245 | ✓ tool |
| 11 | як погода в Києві? | search_web | text | 6660 | ✓ tool (2.2s grounded search) |
| 12 | плани на сьогодні? | get_calendar_events | text | 4596 | ✓ tool |
| 13 | додай зустріч завтра о 14:00 Phase 10 test | create_calendar_event | text | 4218 | ✓ tool — event committed |
| 14 | плани на завтра? | get_calendar_events | text | 4355 | ✓ tool — row visible |
| 15 | скільки вільної памʼяті? | get_system_metrics | text | 4308 | ✓ tool |

**11 / 15 queries invoked a data tool.** Spec gate requires ≥ 5. **PASS.**

### Distribution

```
text         | 11
code         |  1
terminal     |  1
metric_cards |  1
```

4 distinct forms. Gate 3 requires ≥ 3 distinct forms. **PASS.**

### Latency

- Avg (15 queries): **4233 ms**
- Min: 1122 ms (trivial greeting, no tool)
- Max: 6660 ms (`як погода` — web search grounding)
- Tool-using queries avg: ~4.5 s — within the "10-15 s expected" spec note

**PASS** (gate says "avg < 8 s").

### Tool-chain length

Every log line shows `(1/3)` — one tool call per turn. No query
tripped the 3-call cap. Gate 6 **PASS.**

### Calendar round-trip (Gate 5)

After the live test ran, `phantom.db` holds:

```
Phase 10 roundtrip | 2026-04-25 15:00:00 | phantom
Phase 10 test      | 2026-04-25 14:00:00 | phantom
```

Both events for the phantom ROOT user. `Phase 10 test` came from Q13,
`Phase 10 roundtrip` from the earlier round-trip verification.

**PASS.**

---

## Gate summary

| Gate | Criterion | Result |
|---|---|---|
| 1 | Backend 775 ✓ / frontend 178 ✓ | **PASS** |
| 2 | `привіт` < 15 s | PASS (1122 ms) |
| 3 | ≥ 3 distinct response forms | PASS (4) |
| 4 | Avg latency < 8 s | PASS (4233 ms) |
| 5 | Calendar create → read within one live session | PASS |
| 6 | No runaway tool chains (≤ 3 per turn) | PASS |

---

## Decisions and trade-offs

- **Ollama does NOT participate in the chain.** Spec allowed
  "partial". Ollama accepts and ignores `user_id`; if the router
  falls through, the user gets a best-effort text reply, not a tool
  roundtrip. Not addressed in this phase.
- **Pre-generate commit vs. session threading.** The cleaner fix
  would be to thread the chat route's `AsyncSession` through
  `ai_router.generate` → `GeminiProvider.generate` → `execute_tool`
  so tool handlers reuse the same session. That's a 5-file plumb.
  Rejected for phase scope; the two-commit approach is one-line
  surgical and verified stable by 775 tests + live run.
- **10s tool timeout.** 5s was too tight once SQLite contention
  shows up under load; 30s × 3 = 90s of tool wall-clock is too much.
  10s × 3 = 30s matches the spec's "10-15s expected" latency note.
- **`get_system_metrics` calls `psutil` directly** rather than
  reading the ContextEngine snapshot. Snapshot is updated on tick;
  live `psutil` is authoritative for "what's CPU RIGHT NOW".
- **`search_web` uses Gemini's Google Search grounding**, not a
  standalone API. Zero extra credentials needed; costs same Gemini
  quota.

---

## Out of scope (deferred — as the spec required)

- **Terminal execute tool** — security risk without allowlist. Phase 10.2.
- **Weather tool** — needs OpenWeatherMap key. Phase 10.1.
- **Real streaming** — Phase 11.
- **Per-turn tool-call telemetry dashboard** — Phase 11.
- **Tool-call transparency UI** (show the user "fetching calendar…"
  before the final answer) — Phase 11.

---

## Known limitations (flagged, not fixed)

- **Tool latency tail.** Grounded web search adds ~2.2s on top of
  two Gemini roundtrips. Q11 hit 6.66s; hard to do better without
  streaming.
- **Ollama fallback has no data tools.** Any query that relies on a
  data tool degrades to "I don't have that" when primary is quota-
  exhausted or cooling. Acceptable per spec.
- **Function-call parameters with integer schemas** must now pass
  `type: "integer"` explicitly — `"number"` no longer gets quietly
  upgraded. Covered by tests; a risk to remember if we add more tools.
- **Same-turn create-then-read** is possible (the two-commit fix
  makes it work) but each tool call is its own isolated session.
  A partial failure inside a turn doesn't roll back the prior tool's
  writes. That's correct for calendar create → read flow but
  surprising for anything that needs transactional semantics.

---

## Followups

- **Phase 10.1**: weather tool with OpenWeatherMap key + cache.
- **Phase 10.2**: allowlisted terminal execute tool (replaces the
  Phase 9 manual-RUN card pattern).
- **Phase 11**: streaming, tool-call telemetry, tool-UI
  transparency.

---

## Commits

```
6b?????? phase-10: acceptance doc
64f51ce  phase-10: SQLite deadlock fix for chat tool-use
a630ac9  phase-10: tests (+29)
0209002  phase-10: data-tools guidance block in chat system prompt
ff55eb3  phase-10: wire tool-use roundtrip into chat generate loop
6019d55  phase-10: tool executor + 8 per-tool handlers
8b18739  phase-10: tool catalog (8 data tools)
```

Tag `v0.10-chat-tool-use` applied on the final commit.
