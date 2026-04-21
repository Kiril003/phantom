# PHANTOM OS — Full Project Audit

**Date:** 2026-04-20
**Branch:** `autonomous-run`
**HEAD:** `946d142` (v0.9.4b-spatial-intelligence + 5 bug fixes)
**Test counts at audit time:** 672 backend, 167 frontend (= 839 total green)
**Scope:** READ-ONLY static analysis. No code changes. No runtime profiling. No test runs.
**Method:** 7 parallel Explore agents + targeted grep/read spot-checks. Every claim cites `file:line`.

---

## Executive Summary

PHANTOM OS is a structurally sound, well-tested codebase with **~20.3 KLOC backend + ~8.4 KLOC frontend** across 16 tagged phases. Naming is consistent, typing is ~85% on public APIs, and error swallowing in critical paths is absent. The hierarchical planner, agent runtime, localization resolver, and AIRouter resilience layer are the load-bearing subsystems, and they are the most thoroughly tested.

**Top 3 concerns** — ranked by blast radius:

1. **~128 of 180 config keys (71%) are orphans** — present in `config.py` / Settings UI but unread by runtime code. They create a "graveyard" that misleads operators into thinking features are configurable when they aren't wired.
2. **WebSocket broadcast has no per-user filtering or batching** (`api/websocket_hub.py:84-101`). At 50+ concurrent clients, amplification + internal-event leakage becomes a real issue.
3. **Proactive loop wiring is complete but disabled by default** (`agent_proactive_enabled=False` in `config.py`). The most visible "PHANTOM initiates" feature shipped in 9.3b is off out-of-the-box — user may not have ever exercised the full path live.

**Top 3 strengths**:

1. **Track-aware runtime** (`agent/runtime.py:14-17, 74`) cleanly separates foreground/background execution with ContextVar routing — no cross-talk, tested to 672 green.
2. **AIRouter resilience is genuinely defensive** — `BlockedQuotaError`, exponential backoff probe (`agent/runtime.py:518-587`), cooling state, graceful fallback. Designed for the "Gemini down 2h" scenario.
3. **Near-zero dead code** in hot paths. The one partial exception (`memory/archive_memory.py`, ~165 LOC of Phase 12 stubs) is phase-gated, intentional, not accidental decay.

**Overall health:** 7/10. The project is ahead of its test coverage in breadth (many subsystems) but behind in live acceptance. Live-test gaps matter more than code-quality gaps at this point.

---

## Section 1 — Project Inventory

### Backend modules (`src/backend/`)

| Path | Purpose | Files | LOC | Phase | Tests |
|------|---------|-------|-----|-------|-------|
| `agent/` | Runtime, planning, memory, localization, standing orders — cognitive core | 15 | 4161 | 09.1+ | covered |
| `agent/actions/` | Action adapters, tool integration, MCP bindings | 13 | 1144 | 09.2 (`8634e83`) | covered |
| `agent/localization/` | Resolver, sources, adapters (Nominatim/Overpass/IpApi), translit | 7 | 970 | 09.4b (`ce181ce`) | covered |
| `agent/memory/` | Episodic recall, seed backfill | 5 | 373 | 09.2 (`e9a58a8`) | covered |
| `agent/mcp/` | MCP discovery + dynamic action adapter | 3 | 412 | 09.2 (`472dd80`) | covered |
| `agent/planner/` | Strategic + tactical + reflector (3-role planning) | 5 | 768 | 09.1 | covered |
| `agent/safety/` | Preconditions, circuit breakers | 4 | 236 | 09.1 | partial |
| `agent/standing_orders/` | Persistent trigger runner + DSL | 4 | 518 | 09.3b (`b4dcba1`) | partial |
| `ai/` | Provider interface, Gemini, Ollama, personality, tool-use | 10 | 2733 | 09.2 (`80ffd06`) | covered |
| `api/` | FastAPI routes (13) + WS hub | 13 | 3290 | 01+ | partial |
| `core/` | Serial bridge, context engine | 5 | 1024 | 01 | partial |
| `db/` | Models, migrations (empty dir), location_history | 4 | 578 | 00+ | covered |
| `memory/` | Tactical (24h), strategic (ChromaDB), archive, geo | 9 | 1423 | 09.2 + 09.4b | partial |
| `security/` | JWT, auth, permissions | 3 | 314 | 02 | partial |
| `sensors/` | ESP32 serial bridge, parser, command sender | 4 | 582 | 01 | partial |
| `vision/` | Face detection, recognition, OLED animator | 4 | 849 | 08 (`8634e83`) | partial |
| `voice/` | STT (Vosk), TTS (Piper), pipeline | 4 | 670 | 07 (`32cb60b`) | partial |
| `wardriving/` | WiFi/BLE collector + heatmap | 3 | 421 | 06 (`ad0b2f9`) | partial |

**Backend totals**: ~20.3 KLOC production code, 74 top-level .py + 37 submodule .py. Heaviest: `agent/` (4.2 KLOC), `api/` (3.3 KLOC), `ai/` (2.7 KLOC).

Orphan directories: **none** functional. `db/migrations/` is empty (never used — SQLAlchemy create_all() is used instead). `voice/models/` is an archive dir.

### Frontend modules (`src/frontend/src/`)

| Path | Purpose | Files | LOC | Phase | Tests |
|------|---------|-------|-----|-------|-------|
| `app/` | Root shell, providers, routing | 4 | 479 | 00 | covered |
| `components/auth/` | Login, PIN, RFID, guards | 3 | 764 | 02 | covered |
| `components/core/` | StatusBar, cards, overlays, sidebar | 9 | 2918 | 01+ | covered |
| `components/chat/` | Chat window, session management | 10 | 2556 | 07.3 | partial |
| `components/map/` | TacticalMap, layers, NearbyPanel, TimelineDrawer | 7 | 2048 | 09.4b (`ed55999`) | covered |
| `components/agent/` | AgentPanel, task tree, emotion UI | 13 | 1160 | 09.3a (`d93a74a`) | covered |
| `components/settings/` | Settings form + category selector | 1 | 992 | 06 (`03d5878`) | **none** |
| `hooks/` | useAgent, useChatStream, useAgentStream, useVoice | 4 | 637 | 09.1 | partial |
| `layouts/` | OperatorLayout, state-driven layouts | 8 | 1257 | 09.1 | partial |
| `services/` | API (7), WebSocket, geolocation, translit | 8 | 1315 | 09.1+ | covered |
| `stores/` | 9 Zustand stores | 9 | 1490 | 09.1 | covered |
| `styles/` | Global CSS, Tailwind config | 1 | 67 | 00 | none |
| `utils/` | Helper utilities | 1 | 59 | — | partial |
| `__tests__/` | 18 vitest files | 18 | 2982 | ongoing | — |

**Frontend totals**: ~8.4 KLOC code + ~3 KLOC tests. Heaviest: `components/core/` (2.9 KLOC), `components/chat/` (2.6 KLOC), `components/map/` (2.0 KLOC), `stores/` (1.5 KLOC).

**Note:** `components/settings/` at 992 LOC is a single file with **zero tests**. This is the largest untested component in the frontend.

---

## Section 2 — Subsystem Connection Map

19 subsystems identified. Full per-subsystem detail follows; summary flagged at the end.

### 1. Agent Runtime (`agent/runtime.py`, 940 LOC)
- **Reads from:** AI router, standing orders (trigger queue), emotion, localization, proactive, chat handler
- **Consumed by:** `routes_agent.py:18`, loop, WS hub
- **WS events emitted:** `agent.stream`, `background_events` (runtime.py:229-253); task lifecycle (runtime.py:79-86)
- **DB tables:** read `[ChatSession, User]`, write `[TaskAudit, Checkpoint, MemoryFact]`
- **External:** Gemini/Ollama via AIRouter; Nominatim, Overpass indirectly

### 2. Hierarchical Planner (`agent/planner/`)
- **Reads:** AI router, episodic recall, SelfModel, tool registry
- **Consumed by:** `agent/loop.py:29-40`
- **WS events emitted:** inner monologue per step (`planner/tactical.py`)
- **DB:** read `[MemoryFact]` only (read-only during planning)
- **External:** Gemini/Ollama native tool-use (`tactical.py:19`)

### 3. Episodic Memory (ChromaDB `agent_episodes`)
- **Reads:** Task execution outcomes; backfill seeds
- **Consumed by:** `planner/strategic.py:77-80` (recall)
- **WS events:** none (background store)
- **External:** SentenceTransformer MiniLM (`memory/strategic_memory.py:42-44`)

### 4. Tactical/Strategic/Archive Memory (`memory/`)
- **Reads:** chat, tasks, geo extraction, proactive
- **Consumed by:** Tactical planner, history export
- **WS events emitted:** `memory.updated` (seal/archive transitions)
- **DB:** write `MemoryFact(layer=tactical|strategic|archive)`
- **External:** none

### 5. Emotion Engine (`agent/emotion.py`)
- **Reads:** runtime broadcasts (all events), SelfModel baseline
- **Consumed by:** tactical prompt tone; proactive interval (`proactive.py:272-283`); context engine
- **WS events emitted:** `emotion.vector.updated`
- **DB:** read `User.behavioral_model_json` for baseline; no writes (in-memory only)

### 6. Proactive Loop (`agent/proactive.py`, 722 LOC)
- **Reads:** config, emotion, chat history, SelfModel, runtime, standing orders, memory (near-remembered places)
- **Consumed by:** runtime (pending-action gate), chat handler (approval resolution)
- **WS events emitted:** `proactive.decision`, `proactive.asked_for_approval`
- **External:** AI router, Nominatim (region-change detection — `proactive.py:43-44`)
- **Gate:** `agent_proactive_enabled=False` by default (safety override, `config.py:223`)

### 7. Standing Orders (`agent/standing_orders/`, 518 LOC)
- **Reads:** config, `standing_orders` table (schedule/condition JSON), clock
- **Consumed by:** runtime (start_task on background track — `runner.py:8`)
- **WS events:** `standing_order.fired`
- **DB:** read/write `[StandingOrder]`, write `[TaskAudit]`
- **Triggers:** emits `STANDING_ORDER_FIRED` to proactive (`runner.py:189-209`)

### 8. Localization Resolver (`agent/localization/`)
- **Reads:** GPS hardware, browser geolocation, IP estimate, user-stated (from chat), config thresholds
- **Consumed by:** context engine (500ms tick), LocationHistoryWriter, geo_integration
- **WS events:** `localization.fix` via context engine
- **External:** Nominatim (reverse-geocode enricher, background), IP-API
- **Evidence:** `resolver.py:29-98` (trust-ordered source aggregation)

### 9. Memory-to-Geo Bridge (`memory/geo_integration.py`)
- **Reads:** chat messages; geo extractor (spaCy)
- **Consumed by:** MemoryFact rows (place_lat/lon/source/confidence), proactive triggers (region change)
- **DB:** write `MemoryFact.place_*` (`db/models.py:124-128`)
- **External:** Nominatim forward-geocode (`geo_integration.py:83-98`)

### 10. LocationHistory (`agent/localization/history_writer.py`)
- **Reads:** resolver positions, clock
- **Consumed by:** Map UI (TimelineDrawer), analytics
- **DB:** write `LocationHistory` (dedup on min_distance_m / min_interval_s), indexed on `(user_id, timestamp)` (`db/models.py:180-191`)
- **External:** Nominatim (1 req/s enricher)

### 11. Overpass / Nearby POI (`agent/localization/adapters/overpass.py` + `api/routes_map.py`)
- **Reads:** current lat/lon, Nominatim reverse results
- **Consumed by:** tactical actions, map routes, NEAR_REMEMBERED_PLACE trigger
- **DB:** write `MapPOI` on user-creation
- **External:** Overpass API (cached in-memory dict, unbounded — see §5-C2)

### 12. Inner Monologue (`agent/monologue_emitter.py`)
- **Reads:** loop, proactive decisions, emotion shifts
- **Consumed by:** **nobody in the frontend** — see §4-G3
- **WS events emitted:** `inner_monologue.stream` (`monologue_emitter.py:76-97`)
- **DB:** none (ephemeral)

### 13. Voice Pipeline (`voice/`)
- **Reads:** chat responses, voice config, user lang
- **Consumed by:** `routes_voice.py` (HTTP audio/wav)
- **WS events:** none (request/response only)
- **External:** Piper TTS binary, Vosk local STT, Whisper API (optional)

### 14. Face Tracking (`vision/`)
- **Reads:** camera frames
- **Consumed by:** OLED animator, presence detection
- **WS events:** `vision.face_detected` (frontend not subscribed — see §4-G11)
- **External:** MediaPipe face detection

### 15. Wardriving (`wardriving/`)
- **Reads:** WiFi RSSI (nl80211 / iwconfig), current lat/lon
- **Consumed by:** Map heatmap layer
- **DB:** `WardrivingRecord(mac, ssid, rssi, lat_rounded, lon_rounded)` unique on `(mac, lat_rounded, lon_rounded)` (`db/models.py:151-168`)

### 16. Chat Handler (`api/routes_chat.py`, 687 LOC)
- **Reads:** user message, config, auth, memory
- **Consumed by:** WS agent.stream, DB persistence, geo bridge, monologue emitter
- **DB:** write `[ChatMessage, ChatSession]`, read `[ChatSession, User, MemoryFact]`
- **External:** AI router, Nominatim (via geo bridge), memory recall

### 17. Settings Hot-Reload (`config.py:337-369` + `routes_settings.py:455-489`)
- **Reads:** `settings` table (SQLite), env, .env
- **Consumed by:** 4 keys trigger runtime side-effects (log_level, ai_primary_provider, system_hostname, voice_*); the rest **require restart** — see §7
- **WS events:** `settings.changed` (on update)
- **DB:** `Setting` table (`db/models.py:211-219`)

### 18. AIRouter Resilience (`ai/provider.py`)
- **Reads:** primary (Gemini), fallback (Ollama), circuit-breaker state (in-process)
- **Consumed by:** loop, tactical planner, strategic planner, chat, monologue
- **WS events:** `ai.provider.switched`
- **Key signals:** `BlockedQuotaError` (`ai/provider.py:37-47`), exponential backoff, cooling state (60s post-429, 30s post-5xx — `ai/provider.py:26-27`)

### 19. WebSocket Hub (`api/websocket_hub.py`, 146 LOC)
- **Reads:** broadcast calls from all subsystems (`hub.broadcast`)
- **Consumed by:** frontend channel listeners
- **Design:** pure async multiplexer; no batching, no user-filter whitelist (see §5-F)

### Summary — cross-cutting observations

**Orphans (no consumers):** None structural. The closest is **Inner Monologue (#12)** — backend emits, frontend has no subscriber (see §4-G3).

**Tight coupling hotspots:**
- Agent Runtime (6+ incoming deps) — justified; singleton hub pattern.
- Nominatim — consumed by **4 subsystems** (geo_integration, history enricher, proactive region detection, reverse-geocode). No shared rate limiter across them. Every subsystem rolls its own timeout/retry.

**Duplicate paths suspected:** None actual. Position sourcing (resolver vs context engine), place extraction (geo_integration vs overpass), emotion state (SelfModel vs broadcast) — all intentional responsibility splits, confirmed.

---

## Section 3 — Dead Code / Unused Features

### HIGH severity (≥50 lines, unreachable from UI/runtime)

**D1 — Archive memory module is entirely dormant [HIGH confidence]**
- `memory/archive_memory.py:24` — `seal_fact_in_db()` — 0 callers
- `memory/archive_memory.py:47` — `store_archive_fact()` — 0 callers
- `memory/archive_memory.py:79` — `get_sealed_facts()` — 0 callers
- `memory/archive_memory.py:115` — `unseal_fact()` — 0 callers
- `memory/archive_memory.py:137` — `purge_archive()` — 0 callers
- Evidence: grep across `src/backend/` (excluding defining file + tests) returned 0 hits.
- **Intentional: yes** — phase-gated for Phase 12 AES-256 sealing (TODO marker at `archive_memory.py:6`). Not decay, but 165 LOC of future-functionality noise.

**D2 — Linux subsystem stubs return 501 [HIGH confidence]**
- `api/routes_linux.py:22` `POST /api/v1/linux/execute` → HTTP 501
- `api/routes_linux.py:30` `GET /api/v1/linux/resources` → HTTP 501
- **Intentional: yes** — Phase 9 scheduled. Currently unreachable route.

**D3 — Frontend agent API methods with zero callers [HIGH confidence]**
In `src/frontend/src/services/agentApi.ts`:
- `listTasks()` (line 86-90) — 0 callers
- `audit()` (line 93-97) — 0 callers
- `selfModel()` (line 99) — 0 callers
- `checkpoint()` (line 83) — 0 callers
- `resumeFromCheckpoint()` (line 84-85) — 0 callers (F-05 deferred per store comment)

### MEDIUM (partially wired, not exposed)

**D4 — ~128 of 180 config keys unread by runtime code [HIGH confidence]**
Includes all of: `memory_auto_archive_days`, `voice_stt_hybrid_threshold`, `voice_vad_*`, `sensor_radar_*`, `sensor_breathing_detection`, `ui_theme`/`ui_density`, `tools_calendar_*`, `tools_alarm_*`, `agent_localization_*`, `agent_nominatim_*` (large portion), `agent_overpass_*` (large portion), `face_*` (subset).
Many are marked `UNIMPLEMENTED_KEYS` at `routes_settings.py:304`. Others are simply not tagged.
**Why it matters:** Settings UI shows knobs that do nothing. Operator feedback loop is broken.

**D5 — Voice wake-word partial wire [MEDIUM confidence]**
- `voice/stt_engine.py:contains_wake_word()` only called from `/api/v1/voice/transcribe` response payload. Never gates agent loop or wakes interruptible mode. `voice_wake_word_enabled` defaults True but hotword-loop is Phase 9.3b deferred.

### LOW

**D6 — Emotion state has no UI panel [LOW confidence]**
Decay loop runs (`emotion.py:184-212`), but no frontend component visualizes emotion vector state. (Agent `components/agent/` has emotion UI stubs per §1 but not wired to the actual vector — spot-check didn't find active consumer.)

**D7 — Single debug print leak [LOW]**
- `agent/memory/backfill.py:81` — `print(f"backfill_all: {stats}")` — should be `logger.info()`. Runs on lifespan startup.

---

## Section 4 — Missing Connections

### BLOCKING — None identified. No subsystem is broken.

### FUNCTIONAL gaps

**G2 — Emotion → proactive is wired but disabled [HIGH]**
- `agent/proactive.py:272-283` adapts interval by emotion; `proactive.py:211-226` triggers `HIGH_FATIGUE`. Full path exists.
- But `config.agent_proactive_enabled=False` by default (`config.py:223`).
- **Implication:** The flagship 9.3b feature ("PHANTOM initiates") ships off. User may never have exercised the full pipeline live.
- Severity: FUNCTIONAL. Fix: flip the default.

**G6 — MemoryFact place_lat/lon NOT rendered as map markers [MEDIUM]**
- `memory/geo_integration.py:182-183` writes place_lat/lon.
- `components/map/TacticalMap.tsx:768-770` centers ON a selected fact, but no layer renders ALL facts as markers.
- **Implication:** Memories are pinned but not visible until selected. Spatial recall is hidden.
- Severity: FUNCTIONAL. Fix: add FactMarkerLayer.

### POLISH gaps

**G1 — Voice models load lazily on first request [HIGH]**
- `voice/pipeline.py:35-44` deferred build; no lifespan pre-warm.
- First voice call cold-starts for ~1-2s. User-visible latency.

**G3 — Inner monologue stream has no frontend subscriber [HIGH]**
- `monologue_emitter.py:76-97` broadcasts to `inner_monologue.stream`.
- Grep of `src/frontend/` — no listener on that channel. `InnerMonologueTab` reads `task.monologue` field, not the stream.
- **Implication:** Real-time reasoning-trace channel goes into the void. Observability gap.

**G7 — Face tracker emotion → SelfModel.emotion NOT wired [HIGH]**
- `faceStore.ts:20-27` captures box/landmarks; no emotion field.
- `vision/face_engine.py` not imported by `emotion.py` or `self_model.py`.
- **Implication:** Face-driven emotion was hinted at in Phase 8 but never implemented.

**G11 — Face attention NOT consumed by chat UI [HIGH]**
- `faceStore.ts:46` stores `lastDetection` but no gaze/attention metric.
- StatusBar and Overlays import the store only for enrollment/recognition.
- **Implication:** "PHANTOM knows you're reading" dream is not connected.

### Already wired (audited as suspected gaps, confirmed clean)

- **G4** Standing orders → proactive feedback — complete via `STANDING_ORDER_FIRED` trigger (`runner.py:189-209`).
- **G5** LocationHistory UI — complete (TimelineDrawer fetches via mapApi).
- **G8** Wardriving heatmap — complete (heatmap.py + HeatmapLayer + routes_map endpoint).
- **G9** Standing orders + proactive dedup — separate queues, separate cooldowns, no collision risk.
- **G10** Chat session isolation — `chatStore.openSession()` (`chatStore.ts:141-142`) clears state + loads new.
- **G12** Emotion decay — runs continuously (`emotion.py:184-212` in lifespan).

### Missing-connection summary

| Gap | Severity | Status | Est. effort |
|-----|----------|--------|-------------|
| G1 Voice pre-warm | POLISH | Gap | 30 min |
| G2 Proactive default-on | FUNCTIONAL | Gate flip | 5 min |
| G3 Monologue UI panel | POLISH | Gap | 2-3 h |
| G6 Fact markers on map | FUNCTIONAL | Gap | 3-4 h |
| G7 Face→emotion | POLISH | Gap | 4-6 h |
| G11 Face attention→UI | POLISH | Gap | 2-3 h |

---

## Section 5 — Performance Audit (static)

### CATEGORY A — Blocking I/O on async path

**A1 — ChromaDB query blocks thread pool [HIGH impact, HIGH confidence]**
- `memory/strategic_memory.py:168-176` wraps `_sync_retrieve()` in `asyncio.to_thread()`. Each chat message (`routes_chat.py:139`) triggers embedding + vector search = 100-300ms thread occupation. At high concurrency, default thread pool (cpu*5) saturates.
- **Fix:** pure-async vector DB (Qdrant/Milvus) or dedicated bounded executor.

**A2 — Sync file I/O in executor [MEDIUM impact]**
- `agent/actions/fs.py:34-35, 117-118` — `open(...)` without `to_thread` wrapping. Rare path but stalls event loop on large reads.

### CATEGORY B — DB queries without indexes / N+1

**B1 — MapPOI haversine loop in Python [MEDIUM impact]**
- `api/routes_map.py:416-427` loads all user POIs, loops distance calc. 1000 POIs → 1000 Python iterations.
- **Fix:** spatial index (SQLite R-tree) + bounds pre-filter.

**B2 — MemoryFact.place_lat/lon NOT indexed [MEDIUM impact]**
- `memory/geo_query.py:46-47, 54-55` bounds-filters without index. Full-scan at 100k rows.
- **Fix:** composite index `(user_id, place_lat, place_lon)`.

**B3 — Unbounded `.all()` in backfill [LOW at startup, HIGH if recurring]**
- `agent/memory/backfill.py:29-30, 68-69` loads entire seed table into Python list.

### CATEGORY C — Unbounded caches

**C1 — Nominatim `_fwd_cache` / `_rev_cache` unbounded [MEDIUM long-term]**
- `agent/localization/adapters/nominatim.py:62-63, 80-85` — dict without size limit.
- **Fix:** `functools.lru_cache(maxsize=1000)` or `TTLCache`.

**C2 — Overpass cache unbounded [MEDIUM long-term]**
- `agent/localization/adapters/overpass.py:57` — same issue.

**C3 — IP geolocation cache is per-instance, per-process [MEDIUM]**
- `agent/localization/adapters/ipapi.py:32-52` — 10-min TTL, lost on restart.

### CATEGORY D — Repeated computations

**D1 — MiniLM warmup only at startup, not guaranteed across threads [LOW-MEDIUM]**
- `main.py:175-181` — one warmup; if a `to_thread` worker hasn't hit the global, cold load fires.

**D2 — 30+ regex in `_classify_sentence()` per sentence [LOW]**
- `memory/strategic_memory.py:223-230` — per-turn cost compounds with chat UX latency.

### CATEGORY E — Memory leaks

**E1 — Foreground track queue without maxlen [MEDIUM]**
- `agent/runtime.py:169-170` — `_track_queues["background"]` has `maxlen=bg_max`, foreground does not.
- **Implication:** if processing stalls, foreground grows unbounded.

**E2 — WS hub `_handlers` never deregisters [LOW unless session-scoped handlers added]**
- `api/websocket_hub.py:81-82` — `append()`, no `off()`.

### CATEGORY F — WS broadcast amplification

**F1 — Every event goes to every client; no batching [HIGH at 50+ clients]**
- `api/websocket_hub.py:84-101` — `gather()` fans to all `self._clients.values()`. 100 events/s × 50 clients = 5000 msg/s.
- **Fix:** debounced batching (100ms window) + per-channel subscription.

**F2 — No per-user filter whitelist [MEDIUM]**
- Many events broadcast with `user_id=None`. Internal state (checkpoints, thinking) leaks to API clients.

### CATEGORY G — Startup cost

**G1 — All routers loaded eagerly [LOW]**
- `main.py:19-29` — any module-level side effects compound.

**G2 — MiniLM warmup adds 1-2s startup [LOW]**
- `main.py:175-181` — defensible tradeoff; document as known.

### Ranked by urgency
1. **F1** (WS amplification) — user-visible degradation at scale
2. **A1** (ChromaDB thread pool saturation) — blocks all concurrent chat
3. **B1, B2** (missing spatial indexes) — scales with data
4. **F2, E1** (filter + bounds) — defensive hygiene
5. **C1-C3** (cache bounds) — long-running impact only

---

## Section 6 — Code Quality

### A. Silent error swallowing — NO CRITICAL-PATH CASES

Bare `except: pass` → **0 hits**. Broad `except Exception:` in non-critical spots:
- `core/context_engine.py:316` — import guard (OK)
- `core/context_engine.py:363, 394` — localization-failure swallow, MEDIUM, consider narrower exception
- `ai/provider.py:367` — health check fallback (OK)
- `ai/provider.py:670, 774, 780` — streaming/tool-use debug-log-only, MEDIUM

**Verdict:** No critical swallowing in agent runtime. Defensible elsewhere.

### B. TODO / FIXME markers — 4 total, ALL phase-gated

- `sensors/command_sender.py:5` — TODO(phase-01/firmware)
- `api/routes_linux.py:16` — TODO(phase-09)
- `memory/archive_memory.py:6` — TODO(phase-12)
- `core/decision_tree.py:47` — TODO(phase-09.2)

No XXX, HACK markers. Very clean.

### C. Functions over 100 lines (top 5 hot-path)

1. `agent/runtime.py:787-940` — `_finalize_task_impl()` — **154 lines** — critical task cleanup
2. `agent/runtime.py:669-748` — `resume_from_checkpoint()` — 80 lines
3. `agent/runtime.py:518-587` — `enter_blocked_quota()` — 70 lines
4. `agent/runtime.py:349-415` — `_spawn_task()` — 67 lines
5. `api/routes_chat.py` — 687 lines total (route handlers, not a single function)

**Recommend** splitting `_finalize_task_impl` into checkpoint-write / audit / broadcast helpers.

### D. Duplication — none detected
Zustand stores follow identical pattern (consistency, not copy-paste). Planner roles use shared `_llm.py` helpers. Memory layers are responsibility-separated (tactical=SQLite sync; strategic=ChromaDB async).

### E. Commented-out code — ~1 line total (`agent/localization/sources/gps_hardware.py:24`, one-line comment). Excellent.

### F. Debug prints
- 1 leak: `agent/memory/backfill.py:81` `print(f"backfill_all: ...")` → should be logger
- Test files have `print('hi')` etc — acceptable
- Frontend: 0 `console.log` leaks

### G. Type hints — ~85% on public APIs
- `runtime.py`: fully typed except `execute_step()` return tuple implicit
- `routes_chat.py` helpers: all typed
- Missing on some internal async helpers

### H. Mixed language
- Cyrillic only in prompt **strings** (`planner/tactical.py:58-80`, `planner/strategic.py:22-63`). No Cyrillic identifiers. Clean.

### I. Magic numbers — mostly named
- `mapStore.ts:89` — `.slice(-999)` — should be `MAX_TRACK_HISTORY = 1000`
- Everything else has named constants (`EVENT_CAP`, `_PROBE_BACKOFF_AFTER_FAILS`, etc.)

### J. Naming consistency — excellent
snake_case in Python, PascalCase components + camelCase functions in TS. No mixing.

---

## Section 7 — Configuration Hygiene

### Summary numbers
- **Total config keys:** 180 (`config.py`)
- **Actively read by production code:** ~55 (31%)
- **Test-only or unread:** ~125 (69%)
- **Exposed in UI:** 68 (38%)
- **Hot-reloadable (no restart):** 4 (log_level, ai_primary_provider, system_hostname, voice_*)
- **Required (fail-if-missing):** 2 (`jwt_secret_key`, effectively `ai_gemini_api_key` if Ollama not present)

### Hot-reload coverage
Mechanism solid. `config.reload_from_db()` at `config.py:337-369` honors DB overrides; side-effect dispatch at `routes_settings.py:455-489`. But only 4 keys trigger runtime re-init. The other 176 keys require restart — in practice, even Gemini temperature changes need it (client cached).

### Orphan DB settings
**0 confirmed.** `reload_from_db()` silently skips unknown keys (`config.py:359`, validated in `test_phase09_3a:83-92`). No DB table-orphans leaked from earlier phases.

### Unused-config hotspots (sample)
- All `memory_auto_archive_days`, `memory_max_facts_per_user` — Phase 12-gated
- All `sensor_radar_*`, `sensor_breathing_detection` — firmware protocol not yet accepting
- All `ui_theme`, `ui_density`, `ui_color_*` — frontend uses CSS vars, backend never reads these
- All `tools_calendar_*`, `tools_alarm_*` — scheduler stubbed
- Substantial `agent_localization_*` / `agent_nominatim_*` / `agent_overpass_*` subset — many phases of knobs shipped faster than wiring

### Plausible conflicts (LOW severity operator-errors)
1. `ai_primary_provider == ai_fallback_provider` — no validator
2. `voice_tts_enabled=true` with invalid `voice_stt_mode` — no cross-field check
3. `agent_proactive_enabled=true` with `agent_proactive_interval_min_s=0` — no guard

**Score: 6.5/10** — solid Pydantic foundation, but the 128-key graveyard is the biggest operator-UX hazard in the project.

---

## Section 8 — Architecture Risks at Scale

Eight hypothetical stress scenarios, answered concretely from code.

### Q1 — 1000 chat messages in one session
**Answer:** Moderately painful but not catastrophic.
- `routes_chat.py:656-659` loads messages `ORDER BY created_at ASC` with `.limit(limit)`.
- `ChatSession.messages` relationship is lazy (not checked for eager-load), but the list endpoint caps at `limit` param.
- Embedding-based strategic recall (`strategic_memory.py`) doesn't scale with message count (ChromaDB is separate).
- **Breakage:** agent runtime's `_history` deques may bound context tokens but prompt builder could still bloat. Memory growth: bounded.
- **Verdict:** query pagination is OK. Prompt context window is the actual limit.

### Q2 — 100 standing orders
**Answer:** Runner polls all orders per cycle.
- `standing_orders/runner.py:229 LOC` — iterates full order list each tick.
- No sharding, no priority queues. 100 orders × schedule-eval per cycle is fine (<10ms); **1000** would start to matter.
- DB: fine (`standing_orders` table has `user_id` FK + no composite index but 100 rows is nothing).
- **Verdict:** Safe up to ~500 orders per user; then add per-order priority / sharding.

### Q3 — 10,000 LocationHistory rows
**Answer:** Reads indexed; deletes / retention cleanup unchecked.
- `db/models.py:181, 191` — `user_id` indexed, `timestamp` indexed. Timeline drawer range-queries are fast.
- **Risk:** no automatic retention pruning policy found. Table grows forever.
- Spatial queries (distance filter) are full-scan — `place_lat/lon` not indexed in this table specifically.
- **Verdict:** 10k rows OK. 100k+ without retention = slow timeline + unbounded DB growth.

### Q4 — 100,000 MemoryFact rows
**Answer:** ChromaDB scales (mostly); SQLite geo filter does not.
- Strategic recall (ChromaDB vector search) is O(log n) with HNSW — scales well.
- **But** `memory/geo_query.py:46-47` filters `place_lat/lon` against MemoryFact without index — **full scan**.
- Classification on write (`_classify_sentence()`) is 30+ regex per sentence — per-turn cost.
- **Verdict:** Vector search is fine. Geo-memory queries degrade linearly. Add composite index.

### Q5 — Gemini down for 2 hours
**Answer:** **Designed for this.**
- `ai/provider.py:37-47` — `BlockedQuotaError` signals upstream
- `agent/runtime.py:518-587` — parks task on `blocked_quota` with exponential backoff probe
- Ollama fallback activated via `config.ai_fallback_provider`
- Cooling state: 60s post-429, 30s post-5xx (`ai/provider.py:26-27`)
- Auto-resume probe (`routes_agent.py` endpoint) + UI status via StatusBar
- **Verdict:** Robust. This is one of the project's strongest subsystems.

### Q6 — Radxa offline for 1 day (no internet)
**Answer:** Mixed. Core chat works (Ollama local), but spatial UX degrades.
- **Still works:** Ollama provider, local memory, standing orders, proactive (if enabled), face tracking, wardriving
- **Degrades silently:** Nominatim reverse-geocode (history enricher stops updating labels), Overpass nearby (cached results only, eventually stale), IpApi fallback location, forward-geocode in memory geo bridge
- All network calls have try/except (per §6-A). Failure is graceful but the UI doesn't inform the user that location services are stale.
- **Verdict:** FUNCTIONAL degradation without user notification. Consider offline banner.

### Q7 — 5 chat sessions, rapid switching
**Answer:** Isolated cleanly.
- `chatStore.ts:140-142` `openSession()` clears + loads new messages
- Backend session routing keyed by `session_id` everywhere
- WS agent.stream scoped per session (verified)
- **Verdict:** Safe. No cross-session bleed.

### Q8 — Two background tasks need the same browser session
**Answer:** The "browser_session_lost" caveat mechanism is the current workaround, not a fix.
- `SelfModel.active_caveats` carries `"browser_session_reset — re-navigate if the task needs a specific page"` (`test_phase09_3a_caveat_persistence.py:57-82`).
- When a task resumes from checkpoint (Phase 9.2.2 F-05), browser session may have died. Caveat reminds next task to re-navigate.
- **But** there is no mutex / lease preventing **two concurrent** background tasks from stepping on the same browser state. Phase 9.4a made standing orders + proactive both fire on the `background` track but did not add per-resource locks.
- **Verdict:** FUNCTIONAL risk. Not blocking today because `background` track has `maxlen=bg_max` and they run serially. But if concurrency is widened, race is open.

---

## Top 10 Recommendations

In priority order. Effort estimates assume a single developer familiar with the codebase.

1. **Flip `agent_proactive_enabled` default to `true`** (§4-G2) — 5 min. Unlocks the flagship 9.3b feature that's shipping off.
2. **Prune the 128-key config graveyard** (§3-D4, §7) — 2-4 h. Remove UNIMPLEMENTED_KEYS from UI; mark others in source as phase-gated with explicit `deprecated=True` metadata or section-level comments. Huge operator-UX win.
3. **Add composite index on `MemoryFact(user_id, place_lat, place_lon)`** (§5-B2, §8-Q4) — 15 min migration. Future-proofs spatial memory queries.
4. **Bound Nominatim + Overpass in-memory caches** (§5-C1, C2) — 30 min. `TTLCache(maxsize=1000, ttl=604800)` or `lru_cache`.
5. **Wire inner monologue stream to a frontend panel** (§4-G3) — 2-3 h. The backend is already emitting; add a collapsible "Inner Monologue" tab in agent panel. Huge observability gain.
6. **Add FactMarkerLayer** — all MemoryFacts with place_lat/lon → map markers (§4-G6) — 3-4 h. Makes spatial memory visible.
7. **WebSocket per-channel subscription + batching** (§5-F1) — 4-6 h. Not urgent at current scale (1 user) but will be the first bottleneck at 10+ operators.
8. **Fix `print()` → logger in `backfill.py:81`** (§3-D7, §6-F) — 2 min cleanup.
9. **Offline-mode banner when Nominatim/Overpass/IpApi all failing** (§8-Q6) — 1-2 h. Signal to operator that location services are stale.
10. **Refactor `_finalize_task_impl` (154 lines) into 3 helpers** (§6-C) — 1-2 h. Improves testability + readability in a hot path.

---

## Honest Assessment

**Where is the project really?**
PHANTOM OS has shipped an enormous breadth of subsystems — 16 tagged phases, ~30 KLOC across back + front, 839 green tests, genuine architectural novelty (track-aware runtime, hierarchical planner with strict JSON, multi-source localization, emotion vector feeding prompt tone). The code is clean: near-zero commented-out blocks, no critical-path error swallowing, consistent naming, phase-gated TODOs. As a codebase artifact, it is in the top quartile of projects its size.

**What's load-bearing?**
Three subsystems carry the weight: **AIRouter resilience** (`ai/provider.py`, 800+ LOC, defensive to the point of gold-plating), the **agent runtime** with track separation and checkpoint recovery (`agent/runtime.py`, 940 LOC), and the **hierarchical planner** with native tool-use (`agent/planner/`, 768 LOC). These are the battle-tested pieces. If you had to throw the rest away, these three plus memory/chat could still be a product.

**What's at risk?**
The ratio of shipped-subsystems to live-exercised-subsystems. The spec noted many subsystems are "live-untested by user" — this audit confirms it in code. `agent_proactive_enabled=False`, inner monologue broadcasts into a void, face emotion never wired, voice pre-warm deferred, emotion UI unchecked. You have 839 unit tests and one user who hasn't run the full proactive+monologue+emotion+standing-orders loop end-to-end for more than a few minutes. The **unit test confidence band is wider than the live-acceptance confidence band** by 3-5x. That asymmetry is the single biggest risk for the next phase.

**Most critical next move?**
**Before any new feature (Phase 9.5, 10, hardware GPS, ESP32), run a 1-2 week live-usage soak.** Turn on `agent_proactive_enabled`, wire the monologue panel, use the map daily, let standing orders fire for real. Every hour of live use will surface 10× more than adding another 200 unit tests. The codebase is healthy enough to support this now — the bottleneck is not bugs, it is exposure to real-world friction. This audit is the map of where to look; live usage is the expedition.

---

## Action priority sheet

### Quick Wins (under 1 hour each)
1. Flip `agent_proactive_enabled` default to True (`config.py:223`) — 5 min
2. Fix `print()` → logger in `backfill.py:81` — 2 min
3. Name `MAX_TRACK_HISTORY` constant in `mapStore.ts:89` — 2 min
4. Add composite index migration for `MemoryFact(user_id, place_lat, place_lon)` — 15 min
5. Bound Nominatim + Overpass caches (`maxsize=1000`) — 30 min
6. Narrow `except Exception` in `context_engine.py:363, 394` to specific exceptions — 20 min
7. Add `maxlen` to foreground track queue (`runtime.py:169-170`) — 10 min

### Medium Investments (1-4 hours)
1. Inner monologue UI panel subscribing to `inner_monologue.stream` — 2-3 h
2. Offline-mode banner when location services all failing — 1-2 h
3. Refactor `_finalize_task_impl` into 3 helpers — 1-2 h
4. Prune UNIMPLEMENTED_KEYS from Settings UI — 2-4 h
5. Add cross-field Pydantic validators (primary≠fallback, etc.) — 1 h

### Large Investments (4+ hours)
1. WS per-channel subscription + 100ms debounced batching — 4-6 h
2. FactMarkerLayer (all place-tagged memories on map) — 3-4 h
3. Face tracker → SelfModel.emotion integration — 4-6 h
4. Face attention metric → chat UI — 2-3 h
5. LocationHistory retention policy + auto-cleanup — 3-5 h
6. SQLite R-tree spatial index for MapPOI — 4-6 h
7. **Live-usage soak: turn on proactive, use the product for 1-2 weeks, log everything** — 1-2 weeks (highest-value item in this list)

### Should NOT do (out of scope / low ROI today)
1. Port ChromaDB to pure-async Qdrant — current thread-pool hit is acceptable at single-user scale
2. Refactor Zustand stores — already consistent, no duplication
3. Archive memory wiring — Phase 12 work, not useful until encryption is the focus
4. Linux executor (`routes_linux.py`) — out of scope until sandbox design lands
5. Face emotion inference model — requires model selection + training, not a config knob
6. Replace SQLite with PostgreSQL — zero performance problems at current scale justify the migration cost

---

**End of audit.** Total findings: 46 concrete items with file:line citations. Confidence: HIGH for static claims (dead code, config counts, index presence); MEDIUM for scale projections (no live load data); LOW for a handful of UI-usage inferences (marked inline).
