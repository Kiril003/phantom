# Phase 6 — Agent Reach + WiFi/BT + Files + Agent Settings

**Origin:** Operator 2026-04-30 — "система(агент) має до всього доступ?
створення і керування подіями тощо? і так, починай наступну сесію.
автономного агенту… має як домовились… налаштувань він немає. за
вайфай/блютуз теж саме, з візуалу логіка не взята."

**Honest answer to the access question:** **NO** — agent has only 8
tools registered in `ai/tool_executor.py:740`:
`search_locationhistory`, `query_temporal_anchors`,
`recall_memory_facts`, `get_system_metrics`, `get_sensor_status`,
`search_web`, `get_calendar_events`, `create_calendar_event`.

Everything else we shipped UI/REST for in phase-5 (timer CRUD, alarm
CRUD, sandbox, wardriving query, audit query, checkpoint create,
file_manager) is **invisible to the agent** — it can't call those
tools, can't act on operator's voice "постав таймер 25 хвилин",
"видали будильник", "знайди файл report.pdf", "сканування wifi навколо".

This phase closes that gap top to bottom.

---

## Goal

The agent has a **complete tool surface** matching every UI feature.
WiFi/BT scanning, file operations, alarm/timer management, audit
queries, sandbox kicks — all callable from chat by name. UI exposes
agent personality + execution settings (currently zero settings).

---

## Tracks

### T1 — Agent tool registry expansion (BE)

**File:** `src/backend/ai/tool_executor.py` (`_HANDLERS` dict at L740).

Register handlers for every UI-exposed action:

| Tool name | Wraps | Acceptance |
|---|---|---|
| `create_timer` | `tools_repo.create_timer` | label + duration_s → confirmed timer |
| `cancel_timer` | `tools_repo.cancel_timer` | timer_id → ok / not_found |
| `delete_timer` | `tools_repo.delete_timer` | timer_id → 204 |
| `list_timers` | `tools_repo.get_timers` | array of active timers |
| `create_alarm` | `tools_repo.create_alarm` | time + repeat + label |
| `set_alarm_active` | `tools_repo.set_alarm_active` | alarm_id + active bool |
| `delete_alarm` | `tools_repo.delete_alarm` | alarm_id |
| `list_alarms` | `tools_repo.get_alarms` | array |
| `update_calendar_event` | `tools_repo.update_calendar_event` | partial update |
| `delete_calendar_event` | `tools_repo.delete_calendar_event` | id |
| `query_audit_log` | new — wraps `agent.audit` | filter + paginate |
| `create_checkpoint` | `agent.audit.save_checkpoint` | reason + goal |
| `query_wardriving` | `tools/wardriving_query.py` | nearby_aps / search by SSID |
| `start_wifi_scan` | NEW — wraps `wardriving/collector` | trigger one-shot scan |
| `start_bt_scan` | NEW — wraps `wardriving/collector` BLE | trigger BLE scan |
| `list_files` | `tools/file_manager.search_files` | path + pattern → list |
| `read_file` | NEW in `file_manager.py` | path → text content (size cap) |
| `start_sandbox_session` | `linux/executor.create_session` | ROOT-gated |
| `kill_sandbox_session` | `linux/executor.kill` | session_id |
| `enroll_rfid` | NEW — listen 10s + hash | wraps RFID reader |

Each handler returns `{"ok": True, ...}` or
`{"error": ..., "error_kind": ...}` per existing contract. Sandbox-kick
+ delete operations are gated to `user_role == 'ROOT'`.

**Acceptance:** every tool registered + smoke-tested via
`pytest tests/test_tool_executor_registry.py` (NEW); operator says "set
a timer" and `tools/timer` row appears in DB.

### T2 — Tool descriptors + AI prompt wiring

**Files:** `src/backend/ai/prompt_builder.py`, `src/backend/ai/gemini_provider.py`.

Each new tool needs an OpenAI/Gemini function-call schema (name,
description, parameters JSON-schema). Today only the 8 legacy tools
are declared; expand to the full set so Gemini actually picks them.

Test: prompt the model with "Постав таймер 25 хвилин на роботу" → it
should pick `create_timer` not `respond_text`.

### T3 — WiFi / BT scanning + UI logic

**Backend:**
- `wardriving/collector.py` already collects when ESP32-S3 streams
  records — but operator-triggered scan is missing. Add `start_scan`
  (band: wifi | bt | both, duration_s) that pushes a command via
  `sensors.command_sender` to ESP32 + flags an in-progress
  `ScanSession` row.
- New REST: `POST /api/v1/wardriving/scan` (start), `GET
  /api/v1/wardriving/scan/{id}` (poll status), `GET
  /api/v1/wardriving/aps?bbox=...&since=...` (query).

**Frontend:**
- `MapLayout` already shows tactical map; ADD a Wardriving overlay
  with live AP markers + signal strength heat dots + per-marker
  detail card. Use the existing `WardrivingScene` chat scene primitive
  for the per-AP card.
- "Сканування" button in FloatingToolbar More menu → opens scan
  dialog (band toggle + duration slider) → fires `start_scan` and
  surfaces progress overlay.

**Acceptance:** operator says "знайди мережі навколо" → agent calls
`start_wifi_scan(60)` → ESP32 scans 60s → results stream into the
WardrivingScene card AND map overlay updates. NO hardcoded BSSID
samples; everything from real `wardriving_records` rows.

### T4 — Files manager (FE+BE)

**Backend:** `src/backend/api/routes_files.py` (NEW). Endpoints:
- `GET /api/v1/files/list?path=...` — directory listing.
- `GET /api/v1/files/read?path=...` — text content (cap 1 MiB; bigger
  → 413).
- `POST /api/v1/files/upload` (multipart) — sandbox-bound write.
- `DELETE /api/v1/files?path=...` — soft-delete to sandbox trash.

All paths sanitized via existing `_normalise_root` so path traversal
is impossible; respect `_allowed_roots()` from `file_manager.py`.

**Frontend:** Files tab in ToolsOverlay → `FileBrowser.tsx` (tree
left, list right, preview pane). Wire to T1's `list_files` /
`read_file` agent tools so chat can also drive it ("покажи звіти за
березень").

### T5 — Agent personality + execution settings

**Files:**
- `src/backend/config.py` — add `agent_*` settings:
  * `agent_default_model: Literal["gemini-2.0-flash", "gemini-2.5-flash-lite", "ollama-fallback"]`
  * `agent_temperature: float = 0.7`
  * `agent_max_tools_per_turn: int = 5`
  * `agent_max_tokens: int = 2048`
  * `agent_voice_first: bool = True` (already partially)
  * `agent_initiative_level: Literal["passive", "responsive", "proactive"]`
  * `agent_intervention_threshold: float = 0.6` (when does it interrupt?)
  * `agent_persona_tone: Literal["formal", "neutral", "playful"]`
  * `agent_response_brevity: Literal["terse", "balanced", "explanatory"]`
  * `agent_localization_enabled: bool = True` (Ukrainian primary)
  * `agent_thinking_visible: bool = false` (show inner monologue?)
  * `agent_auto_followup_seconds: int = 30` (re-engage idle operator?)

- `src/frontend/src/components/settings/SettingsPanel.tsx` — render
  these in a new "Agent" subgroup or expand the existing
  Personality / AI groups.

**Acceptance:** every setting persists via `routes_settings`,
`prompt_builder.py` reads them when assembling the system prompt,
`gemini_provider.py` reads model + temperature + max-tokens before
each call.

### T6 — Verification + tests

- `pytest tests/test_tool_executor_registry.py` — every tool registered
  + invariant `_HANDLERS` keys ⊇ schema declared in `prompt_builder`.
- Live smoke: spin a fresh ChromaDB + SQLite, run a scripted "Постав
  таймер 5 хвилин на роботу. Тепер видали" sequence through the chat
  endpoint, assert the row appears + disappears.
- `npx vitest run` for new FE pieces.

---

## Execution order

1. T1 tool registry expansion (BE) + T6 registry test
2. T2 prompt wiring so Gemini sees the new tools
3. T5 agent settings (smaller, tightens contract for T1)
4. T3 WiFi/BT scan (BE + FE)
5. T4 Files manager (BE + FE)
6. Final smoke + commit + push instructions update

**Honest cap for ONE session on this hardware:** T1 + T2 + half of T5
realistic. T3 needs ESP32 firmware co-design — likely follow-up. T4 ~1h
solo if backend file_manager primitives stay as they are.

---

## Out of scope

- LLM agent SDK / Claude integration replacement: **no**. Agent stays
  Gemini → Ollama fallback per CLAUDE.md. We are NOT replacing the
  brain, only widening its hands.
- Multi-tenant cloud SaaS: tracked separately in
  `docs/PHASE_SAAS_PIVOT.md`.
- Recurrence (RRULE) in calendar: deferred to Phase 7.
- Multi-modal RFID enrollment UI: deferred to Phase 7.

---

## Carry-forward (still open from phase-5)

- Files BE REST endpoints (T4 above closes this)
- Audit log panel UI (T1 backend ready, T4 follow-up adds the panel)
- QA-VISUAL Playwright re-run when system idle
- DB cleanup script residual fixture patterns
- Whisper warm-up bug
- respond_terminal exec wiring
- H-WK-6 voice always-on permission gate
- H-WK-4 map → FOCUS state collision
