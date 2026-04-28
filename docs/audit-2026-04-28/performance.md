# Performance Audit — 2026-04-28

Audit lens: Snapdragon QCM6490 / Hexagon V68, 8 GB RAM, 7" 1024×600 touchscreen, single-box always-on assistant. Targets: STT instant 60–90 ms, refined 600–1000 ms, voice idle ≤ 15 % CPU, 60 fps UI. The audit is read-only and traces hot paths from the WS frame in, through STT/LLM, to the WS frame out, plus background loops that compound.

Bottom line up-front: the voice frame path is clean. The kill-shots are (a) a chroma data directory with **537 leftover collection folders** for **1 live collection / 10 embeddings** that will compound, (b) a chat turn that fans out into ~10 SQLite round-trips and 2 commits *before* the LLM is even called, (c) a frontend pattern where every component subscribes to whole `state` / `context` slices so a sensor tick at 2 Hz re-renders Avatar / Orb / StateIndicator / FloatingToolbar / ChatWindow / TacticalMap simultaneously, and (d) WS broadcast that holds an asyncio lock and sends to every connected client serially per channel — including the always-on `sensor.snapshot` at 2 Hz to clients that don't subscribe.

---

## Voice pipeline (latency budget)

The hot path is solid. STT singletons are warmed on lifespan startup (`src/backend/main.py:188-212`), MMS / Whisper / Vosk / Silero ORT all get `_ensure_model` + a 1 s silence dummy forward, and every blocking C++ call is correctly off-loaded to `asyncio.to_thread` (`src/backend/voice/always_on.py:219, 236, 285, 292, 380, 396, 417, 496, 591, 620`). The orchestrator state machine is per-connection so utterance state never crosses sessions (`routes_voice_stream.py:149-156`).

Issues that *will* bite as the agent loop layers on:

- **`_transcribe_full_sync` re-builds a `KaldiRecognizer` per utterance** with `SetWords(True)` (`always_on.py:625-626` and `stt_engine.py:293-294`). KaldiRecognizer construction = 5–20 ms C++ alloc on the Q6A. With Phase 13b streaming on, this only fires on the legacy 11b path, but it is *also* still hit by every `transcribe_blob` call in `voice/pipeline.py:80-83` and by `routes_voice.py`. Cache one recognizer per (model, sample_rate) pair, reset per utterance — saves 5–20 ms per utterance.
- **Silero VAD `to_thread` per ~30 ms frame**. `always_on.py:219, 380` hands every frame to the default thread pool. On a 30 ms frame at 16 kHz that's 33 dispatches per second per WS connection; under continuous mode with no energy fast-path, the thread-pool round-trip alone is ~0.3–0.7 ms per frame on ARM64 = ~10–25 ms/sec sustained event-loop overhead. The energy fast-path at `always_on.py:373-378` mitigates idle-state, but during speech every frame goes through. Recommend a *batched* VAD worker thread: feed it via `asyncio.Queue`, single long-lived consumer, eliminate per-frame dispatch. Estimated CPU: −3-5 % during active utterance.
- **MMS NPU pads every utterance to 30 s.** `mms_npu_provider.py:128, 215-224` always pads to `max_samples = 16_000 * 30`. The HTP graph is fixed-shape so this is unavoidable today, but a 1-second utterance pays for 30 s of HTP compute → ~60-90 ms median exactly because the input size is constant. Compile *two* context binaries (3 s and 30 s) and pick by raw audio length: short utterances drop to ~15-25 ms median. P1 — biggest single win on the instant tier, but requires recompile.
- **Per-frame numpy allocation in `_peak_energy_normalised`** (`always_on.py:90-107`). Every frame builds `np.frombuffer(...)`, `np.abs(...)`, `.max()`. For a 30 ms s16le frame that's ~960 bytes; allocator churn at 33 Hz is small but compounds with the to_thread above. Replace with a struct.unpack-free C-fast path (`int.from_bytes` chunked or precomputed view) or skip numpy entirely — `audioop.max(pcm_bytes, 2) / 32768.0` is stdlib and a single C call.
- **Background Whisper refine fires `_transcribe_phase12` which calls `to_thread` to convert PCM → float32** (`always_on.py:587-591`). Cheap individually but the conversion could be done on the speech_end finalise path once and shared between the Vosk-fast emit and the Whisper-refine task. Saves ~1-2 ms and one allocation per utterance.

---

## Async hygiene

The codebase is disciplined here — only one true sync subprocess remains, and there is no `time.sleep`, `requests.get`, or sync SQLAlchemy in async context. Findings:

- **`subprocess.run` blocks the event loop** in `voice/stt_engine.py:81-115`. The ffmpeg WebM → WAV decoder is invoked synchronously (with a 10 s timeout) inside `_ffmpeg_decode_to_mono16k`, which is called from `decode_to_mono16k` (line 150) which itself is invoked from the async `transcribe_blob` (`voice/pipeline.py:82-83`). Browser MediaRecorder defaults to WebM/Opus → every push-to-talk on Chromium goes through this. Wrap the whole `decode_to_mono16k` call in `asyncio.to_thread` at the route layer (`routes_voice.py`), not inside the function — that way Vosk's already-async transcribe doesn't re-thread. P1, latency Δ near-zero per call but the event loop stalls for the duration of a 1-3 second utterance decode under load.
- **Localization resolver runs every 500 ms tick** (`main.py:62, context_engine.py:353-402`). The resolver itself is async + cached, but the call holds `self._lock` (`context_engine.py:372`) and *also* fires `_refresh_nearby` which can hit the Overpass HTTP adapter every 60 s. Under no-fix conditions this is fine, but the lock acquisition cycle here serialises against every `update()` from the serial bridge. P2 — switch to a `try_acquire` and skip on contention; a missed tick is harmless because the next one is 500 ms away.
- **`urllib.parse` imports on hot paths**: `agent/actions/web.py:14, agent/actions/browser.py:8`. Top-level imports are fine; just noting these are not on the per-frame voice path.

No `time.sleep` calls in product code outside of `agent/actions/time_.py` which is correctly inside an async helper.

---

## DB / Chroma hot paths

**One chat turn currently triggers 8–11 SQLite round-trips and 2 explicit commits before the LLM call** (`api/routes_chat.py:267-393`). The sequence:

1. `select User by id` (line 278)
2. `select ChatSession or insert` (`_get_or_create_session`, lines 119-137)
3. `db.add(user_msg) + flush` (lines 312-313)
4. `db.commit()` (line 318) — explicit, comment cites SQLite single-writer deadlock with tool handlers
5. `process_chat_message_for_places` (line 370) — async geocode + region-change → up to 3 inserts/selects per place entity, plus a Nominatim HTTP call (`memory/geo_integration.py:84, 121` → forward-geocode loop over every entity, *N+1 by design*).
6. `db.commit()` (line 382) — second explicit
7. Inside `_build_ai_response` (line 387): `get_behavioral_model` (1 select), `retrieve_relevant` (ChromaDB query, threaded), `fetch_recent_places` (`prompt_builder.py:97`), `save_behavioral_model` (1 update), `extract_and_store_facts` (a tactical insert per sentence above the threshold, up to 15).
8. Inside (post LLM): `get_behavioral_model` AGAIN to compute the tone (`routes_chat.py:404`), `db.add(assistant_msg)` + flush, `session.message_count += 2`, `db.add(TemporalAnchor)` + flush.

P0 wallclock impact: ~30-80 ms of SQLite round-trip latency per chat turn before the LLM is even hit, before considering the geocoder HTTP. The two `await db.commit()` calls predate Phase 10 deadlock work and now serve as an effective barrier — the comment is correct, but the underlying cause (tool executor opening *its own* AsyncSession) should be fixed at the executor level, not by forcing the chat path to commit twice. P1.

The N+1 in `geo_integration.py:121` (Nominatim per extracted place entity) is the worst single offender if the user message is dense with geo references — each entity is a serialized HTTP call with a rate-limiter (`adapters/rate_limiter.py:77`). Batch them at the extractor level.

**ChromaDB findings (P0):**

- `src/backend/chroma_data/` contains **537 collection directories** but the SQLite metadata reports **1 live collection and 10 embeddings**. 93 MB of orphaned per-collection HNSW segments on disk. Every PersistentClient open scans this directory; the cold-start scan is ~2-3 seconds on the SD card.
- `memory/strategic_memory.py:48-51` keys collections **per user** (`user_{user_id}`). On a multi-user device or with the test fixtures that have leaked into prod (the comment at line 113-130 confirms ~70 leaked rows from fixtures), this fans out unbounded.
- The MiniLM embedding function is loaded once (`_get_ef`, line 38-45), correctly. But `_sync_retrieve` re-calls `count()` on every query (line 98) — that's a SQL count on the embeddings table for every chat turn. Cache it with a 60 s TTL; embedding count rarely changes mid-session. Saves ~1-3 ms/turn.
- `_sync_retrieve` runs the full `where={"is_sealed": False, "importance": ...}` filter, then defensively re-filters the result in Python at line 119-130 to strip leaked test fixtures. This is a band-aid for old fixture leaks — **clean the prod DB once and remove the filter** (P2, code only, 5 LOC).

---

## WebSocket / streaming

Single hub, one task per channel handler. Findings:

- **`hub.broadcast` holds `asyncio.Lock` while snapshotting clients** (`api/websocket_hub.py:92-93`). The lock is then released and `gather` runs sends in parallel — that part is fine. But the *cleanup pass* (lines 104-107) reacquires the lock for every disconnected client one at a time. With many disconnects in a single broadcast (e.g. all clients drop on backend restart), this serializes the cleanup. P2, replace with a single async-with that pops all dead clients at once.
- **Sensor snapshots broadcast at 2 Hz to every connected client unconditionally** (`main.py:84, 117`). There's no per-client subscription — UI-only clients that don't render the map still get the full snapshot dict. Phase 11c.4 already paid the json.dumps cost; with a frontend that tree-renders on every snapshot (see Frontend section below), this is the dominant idle CPU on the device. Add a per-client `subscriptions: set[str]` and gate at `WSClient.send` — most clients only need `state.transition`, `chat.*`, and a 1 Hz aggregated metric. P1, RAM Δ negligible, CPU Δ ~3-5 % at idle on the Q6A backend, ~10-15 % on the frontend (see below).
- **No JSON serialization caching on broadcast.** Every broadcast call dumps the same payload N times (once per client). At 2 Hz × N clients it's wasted CPU. Pre-serialize once in `broadcast()` and call `ws.send_text(serialized)` directly. P2, easy win when a second client connects (e.g. mobile companion), saves N-1 × `json.dumps` per broadcast.
- **Agent runtime broadcasts to channel `agent.stream` for every state change** (`agent/runtime.py:284`) — about 23 distinct broadcast call-sites in the codebase. During a single agent task with 10 actions the path emits ~50-80 events. The chat channel (`api/routes_chat.py:498-514`) also stream-emulates the LLM response in `chunk_size=24` char chunks at a configurable delay. With `voice_streaming_partials` on, you have voice partial events + chat stream events + monologue events + sensor snapshots all hitting the same hub. Channel subscriptions (above) become P0 once Phase 16 ships the agent UI.

---

## Memory growth

The major leak is the **chroma data directory leaking 537 collection dirs while only 1 is alive**. This will continue to grow on every test run that creates ephemeral users + `get_or_create_collection`. Add a periodic janitor that compares `_chroma_client.list_collections()` against on-disk dirs and removes orphans. Or stop using per-user collections and shard inside one collection by `where={"user_id": uid}` — that's also faster (one HNSW index to keep warm instead of N).

Other growth vectors:

- **`context_engine._history` is a `deque(maxlen=720)`** = 6 minutes of snapshots at 500 ms (`core/context_engine.py:145`). Each snapshot is a fully-deep copy (`dict(self._snapshot)` line 176, 189) — that's not actually deep-copy but the inner dicts are *shared by reference*. So mutating `system` in-place at line 432 retroactively mutates every history entry. Each history entry is ~1-2 KB; 720 × 2 KB = ~1.5 MB cap. Bounded, but the shared-reference bug means `get_history()` returns snapshots whose `system.cpu_percent` etc. all show the *current* values, not the values at that timestamp. P1 correctness bug masquerading as memory.
- **`session_memory._sessions` is unbounded across sessions** (`memory/session_memory.py:34`). Each session deque is capped at 100 messages but the dict itself grows forever. After 1000 chat sessions in a long-running process you have 1000 keys. Add an LRU cap of `~50` sessions or evict on `clear_session`. P2.
- **Wardriving ingest has no row cap** (`wardriving/collector.py:225-260`). Currently 0 rows in `phantom.db` but the upsert path inserts unbounded — every BSSID seen anywhere creates a row. On a moving Radxa, daily growth could be 1k+ rows. The lifetime stats at line 250-257 are RAM-only, but the SQLite table grows. Add a TTL prune (e.g. drop sightings older than 30 days at low RSSI). P2.
- **`actions_log` in `agent/loop.py:642, 659` is unbounded per task**. A task with 100 steps accumulates 100 dicts. Tasks are cleaned up at finalise so this is per-task memory only — bounded by `agent_background_task_timeout_s = 300` but worth noting. P3.
- **`_history_writer` from `agent/localization/lifecycle.py`** writes location history into SQLite; if not pruned this grows linearly with movement. Check the schema for an explicit retention policy.

---

## Frontend render cost

The Zustand pattern across the codebase is `useSystemStore((s) => s.state)` and `useSystemStore((s) => s.context)`. Zustand's default equality is `Object.is`, which means **every `setContext(ctx)` at 2 Hz creates a new object reference and re-renders every component subscribed to `s.context`** (`PresenceLayer.tsx:31`, `TacticalMap.tsx:93`, `SentinelLayout.tsx:25`, `DreamLayout.tsx:15`, `ShadowLayout.tsx:14`, `GhostLayout.tsx:15`). At idle on Shadow that's 6+ subtree re-renders at 2 Hz purely from sensor noise. Findings:

- **`setContext` should diff before set.** `systemStore.ts:65` does `setContext: (ctx) => set({ context: ctx })`. Pass equality function or split into per-field selectors (`s.context?.body.breathing_bpm`, `s.context?.where.lat`). P1 — biggest single frontend win, eliminates idle re-renders. Estimated frame budget recovery: 3-6 ms per tick on Q6A class hardware, which is the difference between sustained 60 fps and noticeable jitter when the chat ghost-bubble is animating.
- **`setVoiceAmplitude` already has a threshold guard** (`systemStore.ts:69-74`), good. Mic amplitude is updated 30+ Hz from the AudioWorklet (`hooks/useVoiceRecorder.ts`); without the guard, every frame would re-render Orb + ChatWindow + Avatar.
- **`Avatar.tsx:81` and `StateIndicator.tsx:79`** subscribe to `state` only — fine. The risk is `s.context` consumers (above).
- **`stateHistory: [...s.stateHistory.slice(-99), transition]`** (`systemStore.ts:60`) creates a new array on every transition; consumers using `stateHistory` re-render. No consumer found (`grep`), but if Phase 16 introduces a transition timeline UI, switch to a ring buffer + a separate version counter selector.
- **No virtualization on `ChatMessages`**: not directly checked, but ChatWindow.tsx is a single component subscribing to `messages` from `chatStore`. Long sessions (100 msg cap from session_memory) will paint all bubbles. Phase 17+ should adopt `@tanstack/react-virtual`.
- **MapLibre tile reflow on every context update**: `TacticalMap.tsx:93` uses `s.context` directly. Every sensor tick passes a fresh ref through to MapLibre; if any layer reads `context` in its `useEffect` deps it re-fits / re-projects. Audit Phase 12+ added `PresenceLayer.tsx:31` with same pattern — the layer paints presence dots on every tick. P1.

---

## Startup time

`main.py:140-339` lifespan walks: `init_db` → load settings → reconcile AI provider → reconfigure logger → `ensure_default_user` → MiniLM warmup → voice models preload (Silero, Vosk, Whisper/MMS) → register WS → start serial bridge → wire localization → location history writer → start context loop → start OLED animator → maybe start agent runtime + emotion decay + proactive loop + standing orders runner → maybe MCP discovery.

Cold-start sequence is **serial**. The voice preload (`main.py:200-212`) takes the lion's share — 1-3 s for Silero ORT + 0.5-1 s for Vosk model + 1.5-3 s for Optimum Whisper-NPU + (15b) MMS forward warmup. MiniLM warmup adds ~0.5-1 s. Total: 4-8 seconds before the first WS connection is healthy. Findings:

- **Run voice preload in parallel with agent setup** (`main.py:200-339`). Wrap the voice block in `asyncio.create_task(...)` and `gather` at the end. The serial bridge, agent runtime, and proactive loop don't depend on voice models. P1, startup Δ −2 to −4 s.
- **`init_db` and `load_settings_from_db` could overlap** with `voice preload`; they're both I/O-bound. P2, Δ −0.5 s.
- **`get_or_create_collection` in chroma is O(N) on the disk dir** (537 dirs) — the cold scan happens on first chat message because of lazy chroma `_get_client`. Currently masked by MiniLM warmup which doesn't open chromadb. First chat message therefore pays 2-3 s of disk scan. **Open the chroma client at lifespan time** alongside MiniLM warm. P1, latency Δ −2 to −3 s on the first chat turn.
- **Cleaning the orphan dirs first** drops that 2-3 s to <100 ms. P0 if any user is still on a snapshot of this prod DB.

---

## CPU under voice load

Phase 15b acceptance gate is ≤ 15 % CPU during continuous voice. Per the implementation:

- **No thread spawning per chunk**. `to_thread` uses the default executor (default-sized thread pool, `min(32, cpu_count + 4)` on Python 3.11; on the Q6A 8c that's 12 threads). Each Vosk / Silero / numpy call grabs a worker; no explicit `Thread()` or `ThreadPoolExecutor()` per frame. Good.
- **Vosk `KaldiRecognizer` per utterance** (above) is a small alloc spike. Recommend reuse.
- **MMS NPU forward at 30 s pad** is the steady-state bottleneck for the instant tier — 60-90 ms of HTP per utterance is fine, but compute ratio HTP : event loop is 100% on HTP for the duration. CPU stays low precisely because HTP is doing the work. The CPU side is the **CTC argmax + per-frame softmax** in `_ctc_greedy_decode` (`mms_npu_provider.py:228-258`). The implementation avoids a full softmax by computing per-frame max-prob, but it still loops in Python over `T` frames. For a 30 s window at the model's frame rate (~50 Hz), that's 1500 Python iterations per utterance — measurable. Vectorise: `np.exp(logits - logits.max(axis=-1, keepdims=True))`, divide, take diagonal. Saves ~5-15 ms per utterance. P1 because it's on the instant tier latency budget.
- **Wake-spotter `vosk.KaldiRecognizer.AcceptWaveform` runs on every speech-detected frame** (`always_on.py:236`). The orchestrator state machine prevents this in IDLE, but during a held button or wake utterance it's ~10-30 ms per frame on a 30 ms frame — **this is the steady-state 15 % CPU budget being consumed end-to-end**. There's no obvious quick fix; just confirm the `voice_mode = "off"` branch (`always_on.py:208-209`) is the one Phase 15b acceptance was tested under.

---

## Top-5 highest-leverage fixes (each ≤ 50 LOC)

1. **Fix `setContext` Zustand re-render storm** (`systemStore.ts:65`). Either `setContext: (ctx) => set((s) => deepEqual(s.context, ctx) ? s : { context: ctx })` *or* split into per-field stores. Eliminates 2 Hz idle re-renders on Avatar/Orb/Map/Layouts. **Latency Δ: −3-6 ms per UI frame at idle, recovers 60 fps.**

2. **Add per-client WS channel subscriptions** (`api/websocket_hub.py:33-101`). Track `client.subscriptions: set[str]`; require clients to send `{"channel": "subscribe", "channels": [...]}` on connect; gate broadcasts on membership. Pre-serialize once per broadcast. **CPU Δ: −3-5 % backend idle, −5-10 % frontend idle (no useless renders), unblocks Phase 16 agent UI.**

3. **Open ChromaDB client + clean orphan collection dirs at lifespan startup** (`main.py:188-195`, `memory/strategic_memory.py:30-35`). Call `_get_client()` from a `to_thread` after MiniLM warm; emit a `list_collections()` and reconcile against on-disk dirs (delete orphans). **Latency Δ: −2-3 s on the first chat turn after restart. Disk Δ: −90 MB.**

4. **Pre-serialize broadcast JSON + cache `collection.count()`** (`api/websocket_hub.py:84-107`, `memory/strategic_memory.py:98`). One `_sanitize + json.dumps` per broadcast call instead of per-client; 60 s TTL on `collection.count()`. **CPU Δ: O(N) → O(1) on broadcast fan-out; ~1-3 ms / chat turn savings.**

5. **Run voice preload in parallel with agent + serial setup** (`main.py:198-339`). `asyncio.create_task` for voice preload, gather right before yield. **Latency Δ: −2-4 s startup → first ready WS connection.**

---

## P0 / P1 / P2 punch list

### P0 — live latency / memory leak today

- **PERF-01** — ChromaDB persistent dir leaks per-user collections. **537 orphan dirs / 1 live, 93 MB / ~80 KB needed.** Cold-start chroma open scans this dir → first chat message pays 2-3 s. `src/backend/chroma_data/`, owner `memory/strategic_memory.py:30-51`. Janitor + switch to single sharded collection.
- **PERF-02** — Frontend `setContext` triggers full re-render of every consumer at 2 Hz. `src/frontend/src/stores/systemStore.ts:65`. Components affected: `PresenceLayer.tsx:31, TacticalMap.tsx:93, SentinelLayout.tsx:25, DreamLayout.tsx:15, ShadowLayout.tsx:14, GhostLayout.tsx:15, Overlays.tsx:433`. Drops UI off 60 fps under sensor noise. Diff before set or split selectors.
- **PERF-03** — `WebSocketHub.broadcast` fans out unconditionally; every client receives every channel, including the 2 Hz sensor snapshot. `api/websocket_hub.py:84-101`. Frontend / backend CPU lockstep.

### P1 — will breach under load

- **PERF-04** — Chat turn fires 8-11 SQLite round-trips + 2 explicit commits before the LLM call. `api/routes_chat.py:267-393`. Latency Δ ≈ 30-80 ms / turn. Fix at executor level so the chat path doesn't need the dual-commit barrier.
- **PERF-05** — `subprocess.run(ffmpeg)` blocks the event loop on every WebM/Opus push-to-talk. `voice/stt_engine.py:81-115` invoked from async `transcribe_blob`. Wrap `decode_to_mono16k` in `to_thread` at the route layer.
- **PERF-06** — MMS NPU pads every utterance to 30 s; short-utterance latency stuck at 60-90 ms. `voice/mms_npu_provider.py:128, 215-224`. Compile a 3 s context binary too, pick by length. Latency Δ ≈ −40-60 ms median for short commands.
- **PERF-07** — Silero VAD `to_thread` per frame at 33 Hz/connection. `voice/always_on.py:219, 380`. Replace with a single batched VAD worker. CPU Δ ≈ −3-5 % during speech.
- **PERF-08** — `context_engine._history` shares inner-dict references across all 720 snapshots. `core/context_engine.py:176, 189`. `get_history()` returns lies for any field updated in-place by `_update_system`. Use `copy.deepcopy` or rebuild leaf dicts.
- **PERF-09** — Geo-extraction N+1: one Nominatim HTTP call per place entity in chat message. `memory/geo_integration.py:84, 121`. Batch at extractor.
- **PERF-10** — MMS CTC decode loops T=~1500 frames in pure Python. `voice/mms_npu_provider.py:228-258`. Vectorise with numpy. Latency Δ ≈ −5-15 ms / utterance on instant tier.
- **PERF-11** — Cold ChromaDB client open is lazy; first chat message pays the full disk scan. `memory/strategic_memory.py:30-35`. Open in lifespan.
- **PERF-12** — Voice preload serialises with agent / localization startup. `main.py:198-339`. Parallelise.
- **PERF-13** — `MapLibre` / `TacticalMap.tsx:93` reads `s.context` whole — every sensor tick. `PresenceLayer.tsx:31` ditto. Re-projects layers at 2 Hz.

### P2 — efficiency lift

- **PERF-14** — `KaldiRecognizer` allocated per `_transcribe_full_sync` call. `voice/always_on.py:625, voice/stt_engine.py:293`. Pool 1 per worker.
- **PERF-15** — `collection.count()` called on every chroma query. `memory/strategic_memory.py:98`. 60 s TTL cache.
- **PERF-16** — `_sanitize + json.dumps` happens per-client in `WSClient.send`. `api/websocket_hub.py:40-48`. Pre-serialize.
- **PERF-17** — `session_memory._sessions` dict grows unbounded across sessions. `memory/session_memory.py:34`. LRU cap.
- **PERF-18** — Wardriving table has no retention prune. `wardriving/collector.py:225-260`. Add TTL.
- **PERF-19** — Defensive Python re-filter to strip leaked test fixtures from chroma queries. `memory/strategic_memory.py:113-130`. Clean prod DB once, drop the band-aid.
- **PERF-20** — `_peak_energy_normalised` allocates numpy array per frame. `voice/always_on.py:90-107`. Use `audioop.max`.

---

## Files cited

- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/main.py`
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/api/websocket_hub.py`
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/api/routes_chat.py`
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/api/routes_voice_stream.py`
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/voice/pipeline.py`
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/voice/stt_engine.py`
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/voice/always_on.py`
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/voice/mms_npu_provider.py`
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/voice/whisper_npu_provider.py`
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/voice/streaming_recognizer.py`
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/core/context_engine.py`
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/memory/strategic_memory.py`
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/memory/session_memory.py`
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/memory/tactical_memory.py`
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/memory/geo_integration.py`
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/wardriving/collector.py`
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/agent/loop.py`
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/agent/runtime.py`
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/frontend/src/stores/systemStore.ts`
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/frontend/src/components/map/TacticalMap.tsx`
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/frontend/src/components/map/layers/PresenceLayer.tsx`
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/chroma_data/` (537 leaked collection dirs)
