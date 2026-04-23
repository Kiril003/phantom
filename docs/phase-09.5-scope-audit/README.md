# PHANTOM OS — Phase 9.5 Scope Audit

Date: 2026-04-23
Branch: `autonomous-run`
HEAD: post `v0.9.4c.1-hotfix` (latest: `e95769d` — breaker rationale doc)
Mode: READ-ONLY documentation. No code changes.

---

## Executive summary

Three findings in one line each:

1. **Sidebar is not 10 buttons — it's 14** (5 primary + More + 8 in secondary). All 14 route to real components or state transitions. Nothing is dead code. Two are semantically redundant: **Voice duplicates Dialogue**, **System-core duplicates Home→FOCUS**.
2. **Chat response forms are 100% wired end-to-end** (backend tool catalog, Gemini + Ollama function-calling, frontend renderers). User sees only plain text because `chat_messages.response_form` is `text` for **25/25 (100%)** of assistant rows in DB — LLM chose text every time. Pipeline works; the LLM just wasn't nudged to use structured forms.
3. **Roadmap 9.5/10/11 proposed:** 9.5 = UI consolidation + response-form activation (≈4–6h, low risk). 10 = chat tool-use (6–8h, unblocks "де я вчора був", tactical/chat parity). 11 = spatial memory + voice EN + latency (6–10h).

---

# Section 1 — Sidebar / Dock audit

The user's "sidebar" is actually the **FloatingToolbar** — a bottom-centre glass pill rendered in every authenticated layout (Shadow, Focus, Dialogue, Sentinel, Operator, Map; Ghost + Dream suppress it intentionally).

**File:** `src/frontend/src/components/core/FloatingToolbar.tsx` (458 lines)
**Store:** `src/frontend/src/stores/uiStore.ts` (`windows`, `moreMenuOpen`, overlay toggles)
**State store:** `src/frontend/src/stores/systemStore.ts` (SystemState FSM)

**Structure:** 5 always-visible primary icons + an ellipsis "More" button that expands an 8-item secondary menu above the pill. Long-press on Home also opens the secondary menu. Total **14 distinct actions.**

Routes referenced (from `App.tsx`):
- `/` — `StateRouter` (renders one of the state-driven layouts)
- `/map` — `MapLayout`
- `/settings` — `SettingsPanel`
- No other top-level routes exist.

---

## Primary row (always visible)

### Button 1 — Home

**Location in code:** `FloatingToolbar.tsx:118-125` (definition), `72-75` (handler)
**Route/view it opens:** `/` + sets `SystemState.SHADOW`
**Component rendered:** `ShadowLayout` (via `StateRouter` in `App.tsx:26-34`)
**Backend endpoints hit:** None directly. ShadowLayout reads context via the already-open websocket.
**User-visible behavior today:** Returns to minimal-ambient home screen (avatar + status). Long-press opens the secondary menu.
**Status:** ✓ working
**Recommendation:** keep as-is

### Button 2 — Dialogue

**Location in code:** `FloatingToolbar.tsx:126-132` (definition), `76-79` (handler)
**Route/view it opens:** `/` + sets `SystemState.DIALOGUE`
**Component rendered:** `DialogueLayout` (chat window + chat pill + voice controls)
**Backend endpoints hit:** Chat WS channel on mount (`routes_chat.py:448`); `POST /chat/message` (`routes_chat.py:207`) on send.
**User-visible behavior today:** Opens full chat surface with history, input pill, mic button.
**Status:** ✓ working
**Recommendation:** keep as-is

### Button 3 — Map

**Location in code:** `FloatingToolbar.tsx:133-139` (definition), `80-83` (handler)
**Route/view it opens:** `/map` + sets `SystemState.FOCUS`
**Component rendered:** `MapLayout`
**Backend endpoints hit:** `routes_map.py` endpoints (layers, markers, tactical positions); wardriving records from `wardriving/*`.
**User-visible behavior today:** Full-screen MapLibre tactical map with layers (friend/foe markers, wardriving RSSI heatmap).
**Status:** ✓ working
**Recommendation:** keep as-is — post-9.4 the map is explicitly "done and stable."

### Button 4 — Voice ⚠️ REDUNDANT

**Location in code:** `FloatingToolbar.tsx:140-146` (definition), `114-116` (handler)
**Route/view it opens:** Same as Dialogue — it just calls `goDialogue()` if state isn't already DIALOGUE.
**Component rendered:** `DialogueLayout` (same as Button 2)
**Backend endpoints hit:** Same as Dialogue.
**User-visible behavior today:** Clicking this is indistinguishable from clicking Dialogue. The comment at `FloatingToolbar.tsx:112` acknowledges this: "Voice entry point: route user to DIALOGUE where the chat pill's mic is the single, authoritative voice control. No separate floating pill."
**Status:** ⚠️ partial (exists, does something, but duplicates Button 2)
**Recommendation:** **needs work** — either (a) remove the icon (saves a slot, no loss), or (b) make it actually open the mic directly (auto-trigger the pill's mic button on mount if input came via this entry). Option (b) preserves muscle memory for voice-first users.

### Button 5 — Settings

**Location in code:** `FloatingToolbar.tsx:147-153` (definition + inline handler)
**Route/view it opens:** `/settings`
**Component rendered:** `SettingsPanel`
**Backend endpoints hit:** `routes_settings.py` (`GET /settings`, `PATCH /settings`, profile endpoints).
**User-visible behavior today:** Full settings UI (tabs per subsystem). Known to work — user edits preferences here.
**Status:** ✓ working
**Recommendation:** keep as-is

### Button 6 — More

**Location in code:** `FloatingToolbar.tsx:337-345` (always-appended trailing icon)
**Route/view it opens:** Toggles the secondary menu above the pill.
**User-visible behavior today:** 8-item vertical glass menu slides up; outside-click closes.
**Status:** ✓ working
**Recommendation:** keep as-is — this is the intentional discoverability-by-progressive-disclosure pattern.

---

## Secondary menu (opens via "More" or long-press on Home)

### Button 7 — Agent (Cpu icon)

**Location in code:** `FloatingToolbar.tsx:157-166` (definition), `99-105` (handler)
**Route/view it opens:** `/` + sets `SystemState.OPERATOR`
**Component rendered:** `OperatorLayout` → `AgentPanel` (`components/agent/AgentPanel.tsx` + 13 sibling components: TaskTree, GoalInput, InnerMonologueStream, LLMCallBudget, ThoughtBudget, EmotionIndicator, SubstateIndicator, ObservationCard, ActionCard, InterventionDialog, ControlsBar, FeedbackButtons, InnerMonologueTab).
**Backend endpoints hit:** `/agent/*` routes, `agent.loop` WebSocket stream via `useAgentStream`.
**User-visible behavior today:** Opens the full agent surface — goal input, live task tree, inner monologue stream, budgets, substates. This is **everything Phase 9.1–9.3 built.** Click again to exit back to previous state.
**Status:** ✓ working — very feature-rich
**Recommendation:** keep as-is. This button is the crown jewel of the secondary menu.

### Button 8 — Terminal

**Location in code:** `FloatingToolbar.tsx:167-176`
**Route/view it opens:** Toggles `terminal` overlay via `uiStore.toggleOverlay('terminal')`.
**Component rendered:** Terminal overlay (floating draggable/minimisable window from `components/core/Overlays.tsx:130` — dispatches on `windowId === 'terminal'`).
**Backend endpoints hit:** `routes_linux.py` (sandboxed exec + live stream).
**User-visible behavior today:** Floating terminal widget overlays current layout — user can run Linux commands in the sandbox.
**Status:** ✓ working (phase 6/linux)
**Recommendation:** keep as-is

### Button 9 — Sentinel

**Location in code:** `FloatingToolbar.tsx:177-187`, `88-92` (handler)
**Route/view it opens:** `/` + sets `SystemState.SENTINEL` (toggle: re-click returns to previous state).
**Component rendered:** `SentinelLayout` (256 lines — threat/anomaly view).
**Backend endpoints hit:** Context snapshot WS (threat flags from ContextEngine).
**User-visible behavior today:** Red-accented layout showing active threats/anomalies. Button tints `signal-alert` when SENTINEL is active.
**Status:** ✓ working
**Recommendation:** keep as-is — this is the sensor-triggered state made manually accessible for demos/drills.

### Button 10 — Ghost (ROOT only)

**Location in code:** `FloatingToolbar.tsx:188-198`, `93-98` (handler), disabled for non-ROOT via `disabled: !isRoot`
**Route/view it opens:** `/` + sets `SystemState.GHOST` (toggle).
**Component rendered:** `GhostLayout` (67 lines — intentionally near-empty: 3px blinking dot + ultra-faint uptime readout).
**Backend endpoints hit:** GHOST mode backend still records sensors + encrypts via `security/crypto.py` AES-256, but **UI is intentionally dark** — no active endpoints from layout.
**User-visible behavior today:** Screen goes nearly black; tiny pulsing dot bottom-right; near-invisible uptime clock centre-bottom. Per `SECRET_FEATURES.md`/CLAUDE.md principle 6 ("secret features — native behaviour").
**Status:** ✓ working (by design — minimal UI is the feature)
**Recommendation:** keep as-is. Consider whether the label "Ghost (root only)" when disabled leaks the feature to guests — arguably yes. Could hide the item entirely for non-ROOT to stay true to "no documentation in UI" principle.

### Button 11 — System core (Grid3x3 icon) ⚠️ REDUNDANT

**Location in code:** `FloatingToolbar.tsx:199-208`, `84-87` (handler)
**Route/view it opens:** `/` + sets `SystemState.FOCUS`.
**Component rendered:** `FocusLayout` (442 lines — CPU/RAM/net charts, processes, system status grid).
**Backend endpoints hit:** `/context/snapshot` WS, process enumeration endpoints.
**User-visible behavior today:** Dashboard view of system internals — widgets for load, mem, processes, uptime.
**Status:** ✓ working but **partially redundant** with the Map button (Map also sets FOCUS) and with sensor-driven auto-FOCUS transitions.
**Recommendation:** defer decision. The content is legit and separate from Map, but the path is confusing: "Map" sets FOCUS + navigates `/map`, "System core" sets FOCUS + navigates `/`. User may not realise that FOCUS manifests differently depending on current route. Possible cleanup: rename to "System" and ensure it always lands on `/` (it does), or move it to a distinct state like `SYSTEM`.

### Button 12 — Camera

**Location in code:** `FloatingToolbar.tsx:209-218`
**Route/view it opens:** Toggles `camera` overlay.
**Component rendered:** Camera overlay (`Overlays.tsx:134`, ~180 lines: live feed, face-bbox overlay, permission handling).
**Backend endpoints hit:** None in browser mode (uses `getUserMedia`). Backend `vision/face_tracker.py` is for Radxa-side CV, not this overlay.
**User-visible behavior today:** Floating window with live webcam feed + tracked face bounding box. Respects master camera-enable flag and forces off in GHOST.
**Status:** ✓ working
**Recommendation:** keep as-is

### Button 13 — Networks (Wifi icon)

**Location in code:** `FloatingToolbar.tsx:219-228`
**Route/view it opens:** Toggles `wardriving` overlay.
**Component rendered:** Wardriving overlay (`Overlays.tsx` around line 243 — WiFi/BLE scan list with RSSI, encryption, MAC).
**Backend endpoints hit:** `wardriving/collector.py` endpoints (scan results from ESP32).
**User-visible behavior today:** Sliding list of nearby networks, RSSI-sorted, encryption marked. Part of Phase 7 wardriving.
**Status:** ✓ working
**Recommendation:** keep as-is

### Button 14 — Sign out (Power icon)

**Location in code:** `FloatingToolbar.tsx:229-238`, `106-111` (handler)
**Route/view it opens:** Clears auth store, closes all overlays, navigates `/` → triggers `LoginScreen`.
**Backend endpoints hit:** None on click (JWT just dropped client-side). Next request fails → 401.
**User-visible behavior today:** Returns to login (PIN / RFID).
**Status:** ✓ working
**Recommendation:** keep as-is

---

## Sidebar verdict

| Category | Count | Buttons |
|---|---|---|
| ✓ Working as intended | 11 | Home, Dialogue, Map, Settings, More, Agent, Terminal, Sentinel, Ghost, Camera, Networks, Sign out (12 if counting each) |
| ⚠️ Redundant/confusing | 2 | **Voice** (duplicates Dialogue), **System core** (FOCUS overlap with Map) |
| 🚧 Stub | 0 | — |
| ❌ Dead | 0 | — |

User remembered "10 sidebar buttons" but actual count is **14**. Likely explanation: user counted primary (5) + More + ~4 of the secondary that stick in memory. No action needed on count mismatch — the buttons are all real.

**Recommended cleanup (optional, cheap):**
- (a) remove/repurpose Voice icon (30 min, one file)
- (b) clarify System-core naming or fold into Agent (30 min)

Neither is urgent. Both are pure UX polish.

---

# Section 2 — Chat UI response forms audit

Goal: figure out why user sees only plain text despite the response-form infrastructure being shipped in phases 3–4.

## 2a — Backend: what forms are defined?

**File:** `src/backend/ai/response_formatter.py` (391 lines)

`RESPONSE_FORM_TOOLS` is an **8-entry tool catalog** (provider-agnostic JSON schema) used by both Gemini and Ollama. `_FORM_MAP` translates the function name returned by the LLM into the `response_form` string stored on `ChatMessage.response_form`.

| fn_name | response_form | Attachment type + shape | DB usage (90d) |
|---|---|---|---|
| `respond_text` | `text` | none (content only) | 25 / 25 (100%) |
| `respond_chart` | `chart` | `chart_data` → `{chart_type, data[], title, x_key, y_keys[]}` | 0 |
| `respond_map` | `map` | `map_markers` → `{markers[{lat,lon,label,color?}], center, zoom}` | 0 |
| `respond_terminal` | `terminal` | `terminal_output` → `{command, explanation}` | 0 |
| `respond_code` | `code` | `code_block` → `{language, code}` | 0 |
| `respond_metrics` | `metric_cards` | `metric_card` → `{metrics[{label,value,unit?,trend}]}` | 0 |
| `respond_diagram` | `diagram` | `chart_data` → `{diagram: {kind, title, nodes[], links[]}}` | 0 |
| `respond_mixed` | `mixed` | combination of above in one message | 0 |

**SQL used:**

```sql
SELECT response_form, COUNT(*) FROM chat_messages
WHERE role='assistant' GROUP BY response_form ORDER BY COUNT(*) DESC;
```

**Result (live `src/backend/phantom.db`):**

```
text|25
```

Date range of assistant rows: `2026-04-17 23:07:46` → `2026-04-22 22:58:14`. 100% of assistant replies in DB are plain `text`. **Every other form has never been emitted.**

There is also a fallback path `parse_plain_text()` (`response_formatter.py:372-390`) that heuristically classifies unfenced markdown as `markdown` and fenced blocks as `code`. This has also never fired for a non-`text` result, implying the LLM's replies are pure prose without even markdown-looking headings/bullets.

## 2b — LLM: does chat actually receive the tools?

**This is where the hypothesis from the behaviour audit (#2 — "Chat has no tools") needs correction.**

### Finding: chat DOES pass tools. Both Gemini and Ollama.

**Gemini** (`src/backend/ai/gemini_provider.py:162-237`): the `generate()` method — called by chat — builds `tools = _build_gemini_tools()` at line 172 and passes them into `GenerateContentConfig` at line 180:

```python
gen_config = types.GenerateContentConfig(
    system_instruction=system_prompt,
    ...
    tools=tools,
    tool_config=types.ToolConfig(
        function_calling_config=types.FunctionCallingConfig(mode="AUTO"),
    ),
    ...
)
```

So Gemini is told about all 8 tools, with `mode=AUTO` (model picks when to call). Response parsing at `gemini_provider.py:200-229` handles both function-call and plain-text outcomes, routing through `parse_function_call` / `parse_plain_text`.

**Ollama** (`src/backend/ai/ollama_provider.py:102-108`): same — `_build_ollama_tools()` is converted to OpenAI-compatible tool spec and passed in the chat request.

**Chat routes** (`src/backend/api/routes_chat.py:196`): `_build_ai_response` calls `ai_router.generate(user_message, system_prompt, history)` with **no explicit `tools=` kwarg** — but the tools are configured *inside each provider's generate()*, not at the router level. So chat DOES get the catalog.

### System-prompt hint: one line

`src/backend/ai/personality.py:18`, inside `PHANTOM_IDENTITY`:

```
Ти сам вибираєш форму відповіді (text/chart/map/terminal/code/mixed).
```

That's **the entire guidance** the LLM gets about structured forms. No examples. No "when the user asks X, emit Y". No trigger vocabulary. The tool descriptions in `RESPONSE_FORM_TOOLS` are terse Ukrainian one-liners ("Дані з динамікою або порівнянням — Recharts графік"). Gemini 2.0 Flash in AUTO mode, given 8 equally-weighted tools and conversational user queries, defaults overwhelmingly to `respond_text` (since `respond_text` is also a tool in the catalog, indistinguishable from "plain text" in model-chosen behaviour).

### Observed user messages

Sample of recent `chat_messages.content WHERE role='user'`:
`котра година?`, `де я?`, `браузер відериєш?`, `як справи?`, `Привіт`, `де я вчора був?`, `дякую`, `пам'ятаєш мене?`, `я вчора був у вшб`, `як погода?`, `я в остраві`, `що ти вмієш`, `ау`.

These are conversational. Arguably `як погода?` could plausibly invoke `respond_metrics`, `де я?` could invoke `respond_map`, `котра година?` could invoke `respond_metrics` — but in AUTO mode with a one-line hint, the LLM picks text every time. This is model behaviour, not a wiring gap.

**Tools wired for chat: YES.** Root cause of text-only output: **prompt bias, not plumbing.**

## 2c — Frontend: does rendering work?

**File:** `src/frontend/src/components/chat/ResponseRenderer.tsx` (144 lines)

Switch on `message.response_form` at `ResponseRenderer.tsx:45-142`:
- `text` / `markdown` → `MarkdownResponse` ✓
- `code` → `MarkdownResponse(content) + CodeBlock(code_block attachment)` ✓
- `chart` → `ChartResponse` (skipped in streaming mode) ✓
- `diagram` → `DiagramResponse` (from chart_data.diagram nested shape) ✓
- `map` → `MapResponse` (map_markers attachment) ✓
- `terminal` → `TerminalResponse` (terminal_output) ✓
- `metric_cards` → `MetricCards` (metric_card attachment) ✓
- `mixed` → composes metrics + chart + code + map + terminal in order ✓
- `default` → falls back to `MarkdownResponse` ✓

Attachments are parsed via `attachmentByType<T>(attachments, type)` which finds first attachment with matching `type` string. Shapes match backend output in `response_formatter.parse_function_call`. I could not find a switch-case omission or prop-name mismatch. `MessageBubble` (`chat/MessageBubble.tsx:97`) passes `message` + `streaming` flag through to `ResponseRenderer` correctly.

**Frontend: works. It simply never gets invoked with a non-text form because backend never produces one.**

## 2d — Verdict

> The infrastructure exists end-to-end. Backend has 8 response forms defined and the tool catalog is correctly wired into both Gemini and Ollama `generate()`. Frontend has 7 dedicated renderers plus a mixed composer and a default text fallback. In the ~5 days of chat history in the live DB, `response_form` distribution was **text = 25/25 = 100%**; every other form has zero occurrences. The reason the user sees only text is that **the system prompt contains a single Ukrainian sentence mentioning the forms exist, with no examples, no trigger vocabulary, and no bias — and Gemini 2.0 Flash in `mode=AUTO` reliably picks `respond_text` for conversational Ukrainian prompts.** The fix size is small: **15–30 min** — add a prompt block with 3–5 explicit examples ("якщо юзер питає про погоду/час/CPU → `respond_metrics`", "якщо про місцезнаходження → `respond_map`", etc.) and consider tightening `FunctionCallingConfig` to `ANY` only when the user message matches a trigger set. No code changes to providers, renderers, or the catalog itself.

This is meaningfully smaller than the 4–6h tool-use estimate from the behaviour audit, because those 4–6h cover **data-fetching tools** (search_locationhistory, query_temporal_anchors, etc.) — a different class of tool entirely. **Response forms and data tools are orthogonal and can be tackled independently.**

---

# Bugs / oddities discovered during audit (NOT fixed)

1. **Voice button is a soft-duplicate of Dialogue.** `FloatingToolbar.tsx:112-116`. Not a bug per se, intentional per comment, but user-visible redundancy.
2. **Ghost button label leaks feature existence for non-ROOT.** `FloatingToolbar.tsx:190-191` — reads `"Ghost (root only)"` in the label when disabled. Per CLAUDE.md rule #6 "secret features — native behaviour", this arguably should be hidden entirely for non-ROOT users.
3. **System-core (Grid3x3) button and Map button both set SystemState.FOCUS** but land on different routes (`/` vs `/map`). The FOCUS state is overloaded — its meaning depends on route. FocusLayout is the system dashboard; MapLayout is the map. Could cause confusion if someone expects "FOCUS active" to mean one thing.
4. **`respond_text` is itself a tool**, same as `respond_chart`. This may bias AUTO mode toward text since the model can "pick" text as a tool call and still satisfy the tool_config. Consider removing `respond_text` from the catalog (leaving plain-text as the no-tool-call path) so `AUTO` only fires on genuinely structured needs. Needs testing before changing.
5. **`parse_plain_text` detects markdown by string heuristic** (`response_formatter.py:387`: `if any(marker in stripped for marker in ("#", "**", "- ", "1. ", "| "))`). A user message containing `#hashtag` bouncing back in the reply would trigger `markdown` classification. Minor; hasn't been observed.

---

# Section 3 — Roadmap 9.5 / 10 / 11

Three phases proposed. User chooses order and scope. Estimates are optimistic — add 30% for unknowns.

## Phase 9.5 — UI + prompt polish ("make what exists feel complete")

**Goal:** every chat answer chooses the right visual form; every sidebar button has a clear purpose.

**Scope:**
- Remove or repurpose the Voice sidebar icon (pick one: delete, or auto-trigger mic on click) — 30 min
- Clarify "System core" button (rename / re-route / move to a distinct state) — 30 min
- Audit Ghost-button disabled-label leak — 15 min
- Add a **response-form guidance block** to the chat system prompt (3–5 examples: "погода → respond_metrics", "де я → respond_map", "покажи код → respond_code", etc.) — 30–60 min
- Consider dropping `respond_text` from the tool catalog so AUTO only fires for structured needs — 15 min + testing (potentially revert)
- Test by sending 10 diverse chat queries and verifying the distribution shifts away from 100% text. Gate on: ≥ 3 distinct forms observed in the first 20 queries post-fix.

**Estimate:** 4–6h including testing and one regression pass.
**Dependencies:** none.
**Why this phase:** user paid for 7 renderers and 8 tools across phases 3–4, gets 0% utilisation in production. This is the lowest-effort, highest-visibility win available. It also closes the audit feedback loop ("is chat using its forms yet?") with a live test.
**Exit criteria:** `SELECT response_form, COUNT(*) FROM chat_messages WHERE created_at > :after_fix GROUP BY response_form` shows at least 3 distinct forms across 20 post-fix assistant messages; sidebar has no redundant buttons.

## Phase 10 — Chat tool-use ("unlock 'де я вчора був?'")

**Goal:** chat can answer questions it currently can't, by calling data-fetching tools — bringing chat to parity with the tactical planner.

**Scope:**
- Import the existing tactical tools (search_locationhistory, query_temporal_anchors, spatial_memory_recall, nearby_places) into the chat code path
- Extend `routes_chat.py:_build_ai_response` to use `ai_router.call_with_tools(...)` branch when the user message hits a tool-triggering heuristic OR always (test both)
- Merge tool results into the prompt or feed them into a second-pass `generate()` call
- Add the inner-monologue / tool-call trace to the `metadata` on the assistant message so it's inspectable in the chat meta-line
- Hit the behaviour-audit findings B#2, B#3, B#6 directly

**Estimate:** 6–8h. Higher risk of regressions because this touches the single `_build_ai_response` function used by both REST and WS chat paths.
**Dependencies:** Phase 9.5's prompt block is a useful preceding step (tool instructions extend form instructions). Can technically be done first, but the two compound nicely.
**Why this phase:** user's #1 frustration from the behaviour audit — "LLM says 'не маю доступу' when I know the data is in the DB". Fix the capability, not just the cosmetics.
**Exit criteria:** live test — "де я вчора був?" returns an answer citing specific places from `location_history` with a `respond_map` attachment. Tactical and chat call the same underlying tool catalog.

## Phase 11 — Voice, spatial memory, latency ("full-body polish")

**Goal:** voice feels complete, memory recall is spatial-aware, chat latency is human-conversation fast.

**Scope (pick 2 of 3 based on remaining budget):**
- **Spatial memory recall (behaviour audit B#3):** replace "top-5 semantic-similar hints" with "nearest-in-space + top-5 semantic", so recently-stored geo facts surface when the user asks "що ти знаєш про це місце?" without having to say the place name. 2–3h
- **Latency optimisation (behaviour audit B#4, deferred from 9.4c):** profile chat round-trip, target <1200ms p50 (currently unknown, feels ~2s). Candidates: smaller prompt, parallel memory + nearby fetch, Gemini flash-lite for non-tool turns. 1.5–2h
- **EN Piper voice install (from voice setup):** ship the second voice so the system has uk + en TTS even without StyleTTS. 1h
- **Prompt observability (behaviour audit B#8):** log the full chat system_prompt to a new table `chat_prompt_log` with a 7-day TTL, so every surprising reply is inspectable in-system. 1.5h

**Estimate:** 6–10h total. Pick 2–3 of the above based on pain-priority at the time. Each item is independent.
**Dependencies:** None of these depend on 9.5 or 10. If 9.5 reveals a specific form that flakes out, absorb that here.
**Why this phase:** accumulated rough edges. Voice feels incomplete, latency feels laggy, memory sometimes forgets, and we're debugging blind without prompt logs. This phase is the "quality pass" that makes the system feel shippable.
**Exit criteria:** chat p50 latency measured and < target; `en` voice confirmed installed; at least one B-tier behaviour audit item closed.

---

## Ordering recommendation

**9.5 first (lowest risk, highest visibility)** → then **10 (highest capability upside)** → then **11 (quality pass)**. User may swap 10 and 11 if today's frustration is specifically latency / voice, or fold 9.5 and 10 together if the prompt block + tool block feel like one piece of work (which they are, spiritually).

---

## Time log

- Section 1 sidebar: ~25 min (direct read of FloatingToolbar + App.tsx + spot-check layouts)
- Section 2 chat UI: ~30 min (response_formatter + provider + routes_chat + prompt_builder + personality + 1 DB query)
- Section 3 roadmap: ~15 min
- Writing: ~10 min
- Total: ~80 min (within 60–90 target)
