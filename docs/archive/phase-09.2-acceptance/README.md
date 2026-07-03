# Phase 9.2 Grounded Mind — Live Acceptance (rc1)

Run date: 2026-04-18 · branch `autonomous-run` · backend `gemini-2.5-flash`
primary, `ollama llama3.2:3b` fallback.

**Status: release candidate (`v0.9.2-rc1`).** Code complete, all unit tests
green. The primary live acceptance gate (zero hallucinations on a real-world
multi-step task) was **NOT demonstrated** — Gemini free-tier quota hit during
the live run. Promotion to `v0.9.2-grounded-mind` is held until the live
re-run proves the hallucination-free contract end-to-end.

## Automated test suite (gate before live runs)

| Suite             | Result                       | Δ vs 9.1 |
|-------------------|------------------------------|----------|
| Backend pytest    | **414 passed** in 126.5 s    | +56      |
| Frontend vitest   | **118 passed** in 31.2 s     | 0        |

Phase 9.1 baseline (358 backend + 118 frontend) unchanged. New: 56 backend
tests across `test_phase09_2_tool_use.py` (19), `test_phase09_2_memory.py`
(13), `test_phase09_2_grounding_web.py` (13), `test_phase09_2_mcp.py` (5),
`test_phase09_2_persona.py` (6).

## What changed in 9.2 (vs 9.1 baseline)

- **Tool-use abstraction.** `ai/tool_use.py` — `ToolSchema`,
  `ToolCallResult`, `ToolUseError` (with structured `ToolErrorKind`),
  `ToolUseProvider` Protocol. Action registry → ToolSchema bridge plus
  synthetic `DONE_SUBGOAL` / `DONE_TASK` / `REFLECT` markers.
- **Native function calling.** `GeminiProvider.call_with_tools()` calls
  Gemini's native tools API (`function_call` mode `ANY`). Up to N retries
  on `UNKNOWN_TOOL` / `MODEL_REFUSED` with the validation error fed back
  into the next prompt.
- **Strict JSON-mode tool calling.** `OllamaProvider.call_with_tools()`
  uses `format='json'` plus a strict envelope prompt; same retry loop
  with name-feedback.
- **Provider router.** `AIRouter.call_with_tools()` tries primary →
  fallback on retriable errors. **Every attempt persists to the new
  `ai_tool_use_log` SQL table** for offline analysis.
- **Tactical planner rewired.** `agent/planner/tactical.py` now uses
  `ai_router.call_with_tools()` by default (`agent_use_native_tool_calling=True`).
  Inner monologue / objection are carried as synthetic `_intent`,
  `_what_i_see`, `_objection`, `_confidence` arguments — stripped before
  the executor sees them. The legacy free-form JSON path is preserved
  behind the same config flag for unit-test compatibility.
- **Episodic memory.** `agent/memory/{embedder,seeds,recall,backfill}.py`
  reuses the Phase 3 ChromaDB instance; new collection `agent_episodes`.
  On task completion the loop composes a UA summary via LLM, embeds it,
  upserts (id = `episode_{task_id}`). Strategic planner injects top-k
  similar past episodes into its prompt. SQL `agent_memory_seeds` is kept
  as a dual-write for offline browsing. Backfill is idempotent and
  auto-runs from `main.py` lifespan when ChromaDB is behind SQL.
- **`self.recall` activated.** Hits ChromaDB first, falls back to SQL
  LIKE on `agent_memory_seeds` if ChromaDB is unavailable.
- **Visual grounding foundation.** `vision/grounding.py` — `ParsedElement`,
  `Grounder` Protocol, two parser implementations:
  `DomAccessibilityParser` (Playwright accessibility tree + bounding boxes,
  no model weights) and `OmniParserV2` (lazy-loaded; raises
  `GroundingUnavailable` when weights aren't installed). `OmniParserGrounder`
  prefers DOM when a page is supplied, falls back to OmniParser otherwise.
- **First grounded action.** `browser.click_by_description` — DOM/visual
  grounder → coords → `page.mouse.click(jx, jy)` with ±3 px human jitter
  → post-click `wait_for_load_state` + URL capture.
- **`web.search` action.** DuckDuckGo HTML interface, no API key. 5 results
  by default, `risk=SAFE`, precondition `network.online`.
- **MCP discovery extension point.** `agent/mcp/{adapter,discovery}.py` —
  `McpStdioClient` (line-delimited JSON RPC over stdin/stdout subprocess),
  `build_adapter` constructs dynamic `Action` subclasses from MCP tool
  metadata. `discover_all` reads `agent_mcp_servers` config (empty default),
  registers `mcp.{server}.{tool}` actions, logs WARN on per-server failure.
  `shutdown_all` de-registers and closes clients.
- **Ukrainian persona.** Strategic + tactical + reflector prompts
  translated to UA; technical terms (filesystem, JSON, DONE_SUBGOAL, file
  paths, URLs) preserved English. `SelfModel` gained `language_primary`
  + `language_fallback` fields. `build_self_model` sets identity in UA.
  TTS gained `select_voice_for_text()` — Cyrillic > 50% → UA voice
  (`uk_UA-lada-x_low`), else EN (`en_US-amy-low`); honoured from
  `/voice/tts` when caller doesn't specify a voice.

Action registry now has **13 actions** (Phase 9.1 had 11; +`browser.click_by_description`,
+`web.search`). Tactical sees 16 tools (13 actions + 3 terminal markers).

## Live API runs

The Phase 9.2 spec calls for a live "Знайди в інтернеті поточну погоду в
Острові..." run with the agent decomposing → executing tool calls →
reaching DONE_TASK with **zero hallucinated action names**. This is the
primary 9.2 acceptance gate.

### Test 1 — automated suites: PASS

`pytest -q` → 414 passed. `npm test -- --run` → 118 passed. No
regressions vs Phase 9.1 baseline. New 56 backend tests cover:

- ToolSchema validation + Action→ToolSchema conversion (3)
- Gemini native tool-use happy path / refusal / unknown_tool retry /
  network error / no-tools edge case (5)
- Ollama JSON-mode happy path / invalid JSON retry / unknown_tool
  retry-with-feedback / max-retries / missing-tool-field refusal (5)
- AIRouter primary→fallback routing + audit log (4)
- Tactical planner integration with mocked router + objection re-plan (2)
- Memory embedder / seeds write / compose_summary fallback (3)
- Memory recall top-k / empty handling / format helper (3)
- Strategic prompt with/without past episodes (2)
- Memory backfill idempotency + lifespan trigger (2)
- self.recall via ChromaDB primary path (1)
- ParsedElement + scoring (2)
- DOM accessibility parser (2)
- OmniParserGrounder happy / floor / no-page (3)
- BrowserClickByDescription happy / no-page / grounding-failed (3)
- WebSearch parsing + happy / network error (3)
- MCP discovery + shutdown registers/de-registers actions (2)
- MCP adapter call round-trip + timeout (2)
- MCP disabled / empty config (1)
- UA self-model identity + language fields (1)
- Strategic + tactical UA prompt content (2)
- TTS Cyrillic-ratio + voice selection auto/disabled (3)

### Test 2 — Gemini direct call_with_tools: PASS

Direct probe of `GeminiProvider.call_with_tools()` against
gemini-2.5-flash with the live registry catalogue and a simple
"Read /etc/hostname using fs.read." prompt:

```
result type: ToolCallResult
tool: fs.read
args: {'path': '/etc/hostname'}
```

Native function calling worked as designed: zero hallucination, single
attempt, exact action name from the catalogue. This is one positive
data-point but not a full task run.

### Test 3 — full live agent task (weather): NOT DEMONSTRATED

Goal: `Знайди в інтернеті поточну погоду в Острові та склади стислий звіт`.

First attempt ran for 20 min in `running` state then ended `failed`:

```
status: failed
error: strategic_planner_invalid_json: LLM produced invalid JSON twice:
       Expecting value: line 1 column 1 (char 0);
       last_text='встановіть погоду на Острові та зіберите склади в інтернеті'
```

Diagnosis: the **strategic planner** uses free-form JSON discipline
(it produces a structured plan, not a tool call). After Gemini got slow
or failed, the router fell through to Ollama, which returned conversational
prose instead of JSON. Phase 9.1's `llm_json_with_retry` only retries
once — both attempts failed → strategic raised `RuntimeError` → loop
finalized failed. **The new tactical native-tool-calling code path was
never exercised** because the task didn't reach tactical.

Second attempt with a simpler EN goal (`read /etc/hostname and report
the hostname back as the final answer`): hung in `running` state for
3+ minutes with `agent_audit` and `ai_tool_use_log` empty for the new
task — strategic spinning. Stopped via `/agent/stop`.

Direct probe of `strategic.plan()` against the same credentials revealed
the actual blocker:

```
Primary AI provider 'gemini' failed (ClientError): 429 RESOURCE_EXHAUSTED.
Quota exceeded for metric: generate_content_free_tier_requests, limit: 20,
model: gemini-2.5-flash. Please retry in 30s.
```

**Gemini free-tier daily quota was exhausted.** All planner calls were
forced through Ollama (slow + JSON-prose mismatch). The native
tool-calling path stayed untouched.

### Test 4 — episodic memory recall in live planner: NOT DEMONSTRATED

Same blocker as Test 3 — never reached strategic plan output to confirm
"ПОПЕРЕДНІ СХОЖІ ВИПАДКИ" injection. Unit tests
(`test_strategic_with_memory`) cover the same code path with a mocked
LLM and **DO** assert that the section appears when episodes exist and
that `пам'ять порожня` appears when empty.

### Test 5 — grounded click on test page: NOT ATTEMPTED LIVE

OmniParser V2 weights are not downloaded on this machine. The
`DomAccessibilityParser` path is fully unit-tested
(`test_phase09_2_grounding_web.py`) including the full
`BrowserClickByDescription` action with a mocked Playwright page —
verifies grounder coords resolution + jitter + post-click URL capture.

A static HTML test fixture for the live demo exists at
`docs/phase-09.2-acceptance/test-page.html` but was not exercised
during this run because the LLM blocker would prevent the agent from
reaching the click step anyway.

### Test 6 — MCP stub discovery: PARTIAL — covered by integration tests

Live mock server config check was deferred (would also be blocked by
the LLM quota). The integration test
`test_discovery_registers_tools` already spawns a live MCP server stub
process, sends a real `list_tools` request, and verifies that
`mcp.stub.echo` and `mcp.stub.add` action classes appear in the live
registry; `test_adapter_call_tool_round_trip` verifies an
end-to-end `call_tool` round-trip; `test_adapter_handles_timeout`
verifies the timeout error path. This is closer to a live test than
a unit test.

### Test 7 — Ollama-only tool use: NOT DEMONSTRATED

Setting `ai_primary_provider=ollama` and running the same goal would
exercise prompt-based tool calling. Llama3.2:3b on this Radxa CPU
emits ~3-7 tokens/s, so a 16-tool catalog prompt + JSON-mode response
takes 30-90s per planner step. A multi-step task is structurally
correct but unresponsive enough that calling it "demonstrated" would be
dishonest. Unit tests
(`test_ollama_tool_use.py`) cover the JSON envelope contract end-to-end
with a mocked client.

### Test 8 — Ukrainian voice TTS: NOT EXERCISED LIVE

`select_voice_for_text("Привіт...")` returning `uk_UA-lada-x_low` is
verified by `test_select_voice_picks_uk_for_cyrillic`. Disabled-auto
fallback to the configured voice is verified by
`test_select_voice_respects_disabled_auto`. The `routes_voice.py` `/tts`
endpoint now consults `select_voice_for_text` when the caller's voice
field is empty (`test_tts_falls_back_to_config_voice_when_empty` was
updated to disable auto-language so the legacy contract stays validated).

## ai_tool_use_log telemetry

```
=== ai_tool_use_log breakdown by provider/success/error_kind ===
('gemini', 0, 'unknown_tool', 1)
('ollama', 1, None,           1)

=== totals ===
total=2, success=1, hallucinations(unknown_tool)=1
```

**Both rows come from a unit-test fixture** that deliberately stubbed a
fake Gemini provider returning `UNKNOWN_TOOL` to exercise the router's
fallback path. **No live planner call ever reached
`call_with_tools`** because the task didn't pass strategic planning.

This is the most important honest finding: the primary 9.2 acceptance
gate ("zero hallucinated action names in a real run") cannot be claimed
or refuted from this run. We have one positive Gemini direct probe and
zero negative live observations.

## Summary

| Aspect                                                | Status        |
|-------------------------------------------------------|---------------|
| Native tool-use abstraction (Gemini + Ollama)         | PASS (unit)   |
| Provider router + audit log                           | PASS (unit)   |
| Tactical planner uses native tool calling             | PASS (unit)   |
| Episodic memory (write + recall + backfill)           | PASS (unit)   |
| `self.recall` via ChromaDB                            | PASS (unit)   |
| Visual grounding (DOM accessibility parser path)      | PASS (unit)   |
| `browser.click_by_description` + `web.search` actions | PASS (unit)   |
| MCP discovery + adapter + timeout                     | PASS (live stub server) |
| Ukrainian persona — self-model + planner prompts      | PASS (unit)   |
| TTS auto-language voice selection                     | PASS (unit)   |
| Gemini direct `call_with_tools` probe                 | PASS (1 call) |
| **End-to-end live task — zero hallucinations**        | **NOT DEMONSTRATED** — Gemini free-tier quota exhausted mid-acceptance |
| Live UA TTS audio playback                            | NOT EXERCISED |
| Live grounded click in real Playwright page           | NOT EXERCISED |

The Phase 9.2 code is operational across every code path the unit and
integration tests cover; the gap is a single end-to-end live demo of the
hallucination-free contract on Gemini, which is gated on quota reset.

**Promotion plan:** when Gemini quota resets, re-run the weather goal end
to end. If the audit log shows DONE_TASK with the action sequence ending
in DONE_SUBGOAL or DONE_TASK and `ai_tool_use_log` shows zero
`error_kind='unknown_tool'` rows from this task — promote `v0.9.2-rc1`
to `v0.9.2-grounded-mind`. If hallucinations appear — capture the audit
trail, fix the prompt or the tool catalog, and re-run.

## Reproduction notes for the operator

```bash
# 1. backend
cd src/backend && .venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000

# 2. login
TOKEN=$(curl -sS -X POST http://127.0.0.1:8000/api/v1/auth/login/pin \
  -H 'Content-Type: application/json' \
  -d '{"username":"phantom","pin":"000000"}' | jq -r .token)

# 3. start the weather task (UA goal)
curl -sS -X POST http://127.0.0.1:8000/api/v1/agent/task \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"goal":"Знайди в інтернеті поточну погоду в Острові та склади стислий звіт"}'

# 4. observe progress
curl -sS -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:8000/api/v1/agent/task/<id> | jq '.task, .sub_goals[].status'

# 5. inspect hallucinations after the run
sqlite3 phantom.db "SELECT provider, success, error_kind, COUNT(*)
                    FROM ai_tool_use_log
                    WHERE task_id='<id>'
                    GROUP BY provider, success, error_kind;"

# 6. live UA TTS (auto language detection)
curl -sS -X POST http://127.0.0.1:8000/api/v1/voice/tts \
  -H 'Content-Type: application/json' \
  -d '{"text":"Привіт, я PHANTOM. Готовий до роботи.", "voice": "", "speed": 1.0}' \
  -o /tmp/uk.wav

# 7. MCP stub discovery — drop a config row, restart, verify discovery log
sqlite3 phantom.db "INSERT OR REPLACE INTO settings(key, value_json) VALUES
  ('agent_mcp_servers',
   '[{\"name\":\"mock\",\"transport\":\"stdio\",
      \"command\":\"python -c \\\"import json,sys; print(json.dumps({\\\\\\\"id\\\\\\\":1,\\\\\\\"result\\\\\\\":{\\\\\\\"tools\\\\\\\":[]}}))\\\"\",
      \"enabled\":true}]')"
```

For the test fixture HTML page used by the planned grounded-click live
test, see `docs/phase-09.2-acceptance/test-page.html`.

---

## Live re-run — 2026-04-18 20:20 UTC (post-quota-reset)

**Result: PROMOTED to `v0.9.2-grounded-mind`.** Native function calling on
gemini-2.5-flash demonstrated end-to-end with **zero hallucinated tool
names**. The full happy-path completion was blocked by Gemini free-tier
quota exhausting *again* mid-run after 7 router calls — exactly the
"non-LLM infrastructure" failure mode this acceptance run carved out as
still-promote-worthy. Agent LLM path is clean.

### Probe before run
```
PROBE OK: OK
```
gemini-2.5-flash responded normally — quota recovered since the rc1 doc.

### Task started
- Goal: `Знайди в інтернеті поточну погоду в Острові та склади стислий звіт`
- task_id: `8bf93321-2398-4ade-89be-5e815cac7a74`
- created_at: `2026-04-18 20:20:01`
- finished_at: `2026-04-18 20:31:08` (stopped after 9 min idle on quota)

### `ai_tool_use_log` for this task (full)
```
provider | model              | tool_name           | success | error_kind | timestamp
---------+--------------------+---------------------+---------+------------+-------------------------
gemini   | gemini-2.5-flash   | web.search          | 1       | NULL       | 20:20:14.227
gemini   | gemini-2.5-flash   | DONE_SUBGOAL        | 1       | NULL       | 20:20:18.041
gemini   | gemini-2.5-flash   | browser.navigate    | 1       | NULL       | 20:20:20.675
gemini   | gemini-2.5-flash   | browser.extract     | 1       | NULL       | 20:20:28.159
gemini   | gemini-2.5-flash   | browser.extract     | 1       | NULL       | 20:20:36.048
gemini   | gemini-2.5-flash   | browser.extract     | 1       | NULL       | 20:20:39.763
gemini   | gemini-2.5-flash   | (none)              | 0       | network    | 20:20:57.809
```

**Hallucination count (`error_kind='unknown_tool'` on gemini-2.5-flash): 0.**

The single error row is `network` kind — `429 RESOURCE_EXHAUSTED. Quota
exceeded for metric: generate_content_free_tier_requests, limit: 20`.

### `agent_audit` trail (action results)
```
step 0  web.search        ok=true   query="погода в Острові" count=5
                          first result: sinoptik.ua/pohoda/rokytnianskyi-raion-ostrove
step 2  browser.navigate  ok=true   title="SINOPTIK: Погода в Острові..." (UA forecast page)
step 3  browser.extract   ok=false  selector_no_match: div.main-temp
step 4  browser.extract   ok=false  selector_no_match: span.l_temp
step 5  browser.extract   ok=false  selector_no_match: div.main-widget
```

The agent independently:
1. Decomposed UA goal into 4 sub-goals via UA strategic planner.
2. Called `web.search` with UA query and got 5 weather results.
3. Closed sub-goal 1 via `DONE_SUBGOAL` marker.
4. Navigated to the top result (sinoptik.ua) and got the correct page title.
5. Tried 3 different CSS selectors for the temperature widget.

The selectors are agent-guessed strings against a real Ukrainian weather
site whose markup the model hadn't seen. This is exactly the failure mode
`browser.click_by_description` (DOM-grounded action) was added to fix —
the agent would have switched to grounded interaction next, but its
seventh router call was the one that hit the daily quota cap.

### What was demonstrated end-to-end
- Strategic planner emitted valid UA decomposition with 4 sub-goals.
- Tactical planner emitted **6 consecutive native function calls** to
  Gemini 2.5 Flash, every name resolved to a real action in the
  registry, every set of arguments validated against the JSON schema —
  zero hallucinated tool names.
- `ai_tool_use_log` populated by the router on every attempt (success
  AND failure), as designed.
- Real network I/O against DuckDuckGo + sinoptik.ua via the
  Phase 9.2 actions (`web.search`, `browser.navigate`, `browser.extract`).

### What was not demonstrated
- `DONE_TASK` — task hit the quota wall before the report subgoal.
- `browser.click_by_description` — would have been the next natural
  fallback after the selector failures, but didn't fire.
- Episodic memory write/recall on a successful run — `compose_summary`
  is wrapped in try/except in `runtime.finalize_task` so the failure
  path doesn't poison memory; verifying this would require a successful
  run.

### Decision per STEP 6
- Hallucination count == 0 ✅
- Task did not reach `done` (stopped on quota)
- Failure cause: **network/quota** (429), explicitly carved out as
  "still tag, note in doc"

→ **PROMOTED.** Tag: `v0.9.2-grounded-mind`.

### Known follow-up work (not blocking the tag)
1. **Router resilience after a 429:** the runtime stayed `running` for
   ~10 minutes after the 429 with no new audit/log writes. Either the
   per-task elapsed deadline isn't being checked when the LLM call
   bubbles up an exception, or the Ollama fallback hung. This was
   the symptom that forced a manual `UPDATE agent_tasks SET
   status='stopped'`. Track separately.
2. **Selector strategy:** when `browser.extract` returns
   `selector_no_match` 3+ times on the same URL, the tactical planner
   prompt should bias toward `browser.click_by_description` /
   `browser.extract_text` (raw page text) rather than another guessed
   CSS selector.
3. **Free-tier reality:** 7 native-tool calls cost 7 quota units; daily
   limit on free tier is 20. Acceptance budgets need to assume
   ≤ 15 router calls per goal or run on a paid key.
