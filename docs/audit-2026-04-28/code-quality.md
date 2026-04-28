# Code-Quality Audit — 2026-04-28

Scope: `src/backend/{core,ai,voice,api,memory,db}` and `src/frontend/src/{stores,hooks,services,components/{chat,core}}`. Excluded `tests/`, `venv/`. Focus: bugs, dead code, swallowed exceptions, ContextEngine bypasses, unbounded fallback masking, async/concurrency footguns.

The repo is in surprisingly good shape on small things — almost no bare `except:`, no random `print()`, naming is consistent, dataclasses used properly. The trouble is at the **wiring** layer: the autonomous brain (`DecisionTree`, `set_ai_initiative`, `consume_initiative`, several `ContextSnapshot` fields) is built but **never actually called**. The Jarvis-grade ambition currently rests on plumbing that is not connected on either end.

## P0

### 1. DecisionTree initiatives are never consumed → autonomous behaviour is dead code

- **Where:** `src/backend/main.py:83` (only call site is `decision_tree.evaluate(snapshot)`); `src/backend/core/decision_tree.py:75-87` (`has_pending_initiative`, `consume_initiative`); `src/backend/core/state_machine.py:228` (`set_ai_initiative`).
- **What:** `decision_tree.evaluate()` is invoked every 500 ms in the context loop, but its return value is discarded. `consume_initiative()` and `has_pending_initiative()` are referenced by zero callers (`grep -rn 'consume_initiative\|has_pending_initiative'` outside the definition file returns nothing). `state_machine.set_ai_initiative` is also never called. Result: every "AI initiative", every `actuator` payload, every `alert` is built and immediately thrown away. The `FOCUS → DIALOGUE` transition in `state_machine.py:161` (guarded on `ai_initiative`) is therefore unreachable.
- **Why it matters:** This is the literal "Jarvis" feature. CLAUDE.md rule "ContextEngine — central for ALL decisions. Each sensor → ContextEngine → DecisionTree → Action|Memory" is unimplemented. RGB pulse on `SENTINEL`, breathing-exercise prompt on stress, calendar reminders, idle check-in — none of them ever fire. This is the largest gap between blueprint and reality.
- **Fix sketch:** In `_context_loop`, after `decision_tree.evaluate(snapshot)`: capture actions, push `actuator` payloads through the existing `serial_bridge.send_command` channel, broadcast `alert` payloads on a new WS channel, drive `state_machine.set_ai_initiative(decision_tree.has_pending_initiative())`, and pop `ai_speak` actions onto an internal `agent_runtime.start_task` for proactive turns. (~80–120 LOC; 30–100 if you only wire the actuator path first.)

### 2. `_ghost_trigger` reads `snap["encoder"]` / `snap["buttons"]` — fields ContextEngine never publishes

- **Where:** `src/backend/core/state_machine.py:107-111`; `_empty_snapshot()` in `src/backend/core/context_engine.py:59-134`.
- **What:** `_ghost_trigger` checks `snap.get("encoder")` and `snap.get("buttons").get("rgb_states", ...)`. The snapshot dict produced by `_empty_snapshot()` has no `encoder` and no `buttons` keys, and `_apply_batch` never copies `batch.encoder` / `batch.buttons` into the snapshot. So GHOST mode (priority-0 secret feature, per `SECRET_FEATURES.md`) can never be triggered by hardware. Both `enc` and `btns` are always `None`, the function returns `False` every tick.
- **Why it matters:** A documented secret feature that *looks* implemented is silently inert. Operator presses long-encoder + RGB-1 forever; nothing happens. Worse, it gives false confidence the FSM is wired.
- **Fix sketch:** In `context_engine._apply_batch`, add `_apply_encoder(batch)` / `_apply_buttons(batch)` that lift the parsed `EncoderData` / `ButtonsData` into `self._snapshot["encoder"]` and `self._snapshot["buttons"]` dicts; add the keys to `_empty_snapshot()`. ~15 LOC.

### 3. NPU/MMS providers swallow inference failures into empty transcripts that look like silence

- **Where:** `src/backend/voice/whisper_npu_provider.py:373-381`; `src/backend/voice/mms_npu_provider.py:283-291`.
- **What:** When `generate()` / `session.run()` raises mid-call, both providers `logger.warning(...)` and return `STTResult(text="", confidence=0.0, engine="...", language=...)` to "fall through gracefully". But the route never sees an exception — it sees a successful empty transcript, which downstream is indistinguishable from silence. A wedged NPU session, a torn-out audio cable, an OOM, a tokenizer corruption, all surface as "user said nothing." Latency keeps looking great in metrics. There is no chain fall-through here — the provider was already chosen; the "fall through gracefully" comment is a misread of the chain semantics.
- **Why it matters:** Silent data loss from the operator's perspective ("PHANTOM stopped hearing me"), zero observability, no fallback to the next chain entry (Vosk) once construction succeeded.
- **Fix sketch:** Re-raise — let `voice/pipeline.py::transcribe_blob` propagate, route handler returns 503; OR, if you want auto-recovery, set a "wedged" flag and rebuild the provider on next call (`reset_providers()` from inside the worker). ~10 LOC each. At minimum surface a `"engine_error"` field in `STTResult` and an `error` event on the WS so the frontend can show "STT temporarily unavailable" instead of treating it as silence.

### 4. ContextEngine `last_interaction_ago_s` defaults to 999 but is overwritten with 0.0 on first tick — idle detection is broken

- **Where:** `src/backend/core/context_engine.py:147` (`self._last_interaction_ts = time.monotonic()`); `_update_history_metrics` line 462-466.
- **What:** `_last_interaction_ts` is initialised to *now*, so on every snapshot `interaction_ago = now - self._last_interaction_ts` is at most ~500 ms after boot, and `last_interaction_ago_s` in the snapshot is ~0. Combined with finding #1 (no AI initiative consumption), every guard built on `last_interaction_ago_s` fails to fire: `_no_interaction(snap, 120)` in `state_machine.py:159`, the FOCUS→SHADOW timeout, the idle initiative in `decision_tree._check_ai_initiative` (line 162) all never trip until 2 minutes after the *first user message*. PHANTOM can never enter SHADOW from FOCUS without an interaction.
- **Why it matters:** Combined with #1 it means the FSM cannot drift autonomously at all. The system always feels "asleep" until you talk to it.
- **Fix sketch:** Initialise `_last_interaction_ts` to `time.monotonic() - config.ai_initiative_cooldown_s` (or to `None` and guard accordingly) so a fresh boot reports a realistic idle time. ~3 LOC.

### 5. `WebSocketHub.broadcast` deletes disconnected clients while iterating without holding the same lock

- **Where:** `src/backend/api/websocket_hub.py:103-108`.
- **What:** After `gather(*tasks)`, the cleanup re-enters the lock per disconnected client (`async with self._lock` inside `for cid in disconnected`). Two interleaved `broadcast` calls can both compute `disconnected` on copies of the dict, then both try to pop the same `cid` — second pop is a noop, but if the cid was reused (UUID collision is rare; sequential ids more likely) the second broadcast silently drops a different client. More importantly, `client._connected` is mutated inside `WSClient.send` on send-failure (line 47-48), but `_connected` is read here without any lock — race between `send()` setting `_connected = False` and broadcaster reading `c._connected` is benign in practice but smells.
- **Why it matters:** Latent disconnect leak under burst broadcast. The whole eventing pipeline (sensor 500 ms broadcast + chat stream + voice events) hits this constantly.
- **Fix sketch:** Move the `_connected` flag into a `_dead` set guarded by the same lock, and prune in one critical section after `gather`. Or just drop the manual cleanup and let `disconnect()` (called from the receive loop's `finally`) do it — that's already the only place it actually needs to happen. ~12 LOC.

### 6. `_build_ai_response` never updates `behavioral_model` on the failure path, but commits the user message before AI runs

- **Where:** `src/backend/api/routes_chat.py:382-393` (commit before AI), `_build_ai_response` line 219-264 (post-turn writes).
- **What:** `await db.commit()` happens at line 382 (so other writers don't deadlock), then `_build_ai_response` runs. If AI fails (line 388 `except`), we `raise HTTPException(503, ...)` — the user_msg is committed, but the assistant_msg, the trust/vocab updates, and the TemporalAnchor never run. Worse, on retry the user re-sends the same content; another row goes in. There's no idempotency key, no "pending" marker, no rollback. The user's chat history grows orphan user-rows on every Gemini hiccup.
- **Why it matters:** Visible data corruption. The chat list shows "user said X, user said X, user said X" with no replies. Combined with the Ollama fallback also failing (which happens in dev when Ollama isn't running), every failed turn pollutes the DB.
- **Fix sketch:** Either (a) defer the user_msg commit until AI succeeds (refactor: build assistant_msg first in a single transaction), or (b) add a `status: "pending" | "answered" | "failed"` column on `ChatMessage` and update on outcome. Frontend can then suppress display of pending-orphans. ~40 LOC.

## P1

### 7. ChromaDB sqlite committed into the working tree

- **Where:** `src/backend/chroma_data/chroma.sqlite3` (modified per `git status`); `src/backend/db/phantom.db`.
- **What:** Both DBs are tracked. `git status` shows the chroma sqlite is dirty on this branch. This conflates state with code, every test/dev run produces noisy diffs, and any secret embedded in vector store memory ships with the repo.
- **Why it matters:** Privacy / leak risk; dev velocity drag; merges between branches will conflict on binary blobs.
- **Fix sketch:** Add `src/backend/chroma_data/` and `src/backend/db/phantom.db` to `.gitignore`, `git rm --cached`. ~3 LOC.

### 8. Module-level mutable global `_FFMPEG_BIN` is captured at import-time only

- **Where:** `src/backend/voice/stt_engine.py:51`.
- **What:** `_FFMPEG_BIN` is set via `shutil.which("ffmpeg")` at import. If the operator installs ffmpeg after backend start (common during initial setup on a fresh Radxa image), STT keeps 400-ing on WebM/Opus until the process restarts. Same fragility for any container-rebuild pattern.
- **Why it matters:** Surprise failure mode; "I installed ffmpeg, why is voice still broken."
- **Fix sketch:** Resolve lazily inside `_ffmpeg_decode_to_mono16k` (cache for ~60s) and on settings change. ~6 LOC.

### 9. ContextSnapshot has 3 fields that are never populated by any code path

- **Where:** `src/backend/core/context_engine.py:78` (`first_visit`), 76 (`place_known`), 115-116 (`active_timers`, `pending_events_1h`).
- **What:** `first_visit`, `place_known`, `active_timers`, `pending_events_1h` initialised to fixed defaults; nothing ever writes them. `state_machine._first_visit` and `decision_tree._check_calendar` read them, so the SENTINEL/threat-detection logic and calendar reminder never trip on real data. (Combined with #1 they wouldn't trip anyway, but the fields are still dead.) Two of these (`active_timers`, `pending_events_1h`) have whole tools subsystems (`tools/timer_service.py`, `tools/calendar_service.py`) that should be feeding them.
- **Why it matters:** Snapshot looks rich; half of it is decoration. Prompt builder (`ai/prompt_builder.py:285-`) probably emits these to Gemini too — the model gets misleading signal that "no events pending" when in fact the system never asked.
- **Fix sketch:** Add a `_refresh_history_signals()` step in `tick()` that polls timer_service and calendar_service (~ms) and writes the counts; have the geo subsystem write `place_known/first_visit` when reverse-geocoding. ~30–80 LOC depending on how much real plumbing you want.

### 10. `event_bus.emit` schedules coroutines with `asyncio.ensure_future` and immediately drops the reference

- **Where:** `src/backend/core/event_bus.py:36-42`.
- **What:** Tasks created by `ensure_future(result)` are not stored. If a coroutine handler is the last thing keeping a Task alive, Python's GC may collect it mid-flight. CPython's task tracker mitigates this *most* of the time, but not all. PEP guidance and the official asyncio docs both say: keep a strong reference. Also: any exception in those handlers is logged only when awaited; with no `add_done_callback` the failure is silent unless asyncio's default handler runs.
- **Why it matters:** Random "event handler ran 80% then vanished" bugs. Hard to reproduce, harder to debug. EventBus is on the hot path for every state transition / context update.
- **Fix sketch:** Keep a `self._pending: set[asyncio.Task] = set()`, `task = asyncio.create_task(result)`, `self._pending.add(task)`, `task.add_done_callback(self._pending.discard)` and a callback that logs exceptions. ~10 LOC.

### 11. `ChatMessage._serialize_message` swallows JSON parse errors silently — corrupted rows render as empty bubbles

- **Where:** `src/backend/api/routes_chat.py:73-94`.
- **What:** `meta = json.loads(...)` and `attachments = json.loads(...)` both wrapped in `except Exception: pass`. If the column is `NULL` or non-JSON (legacy data, partial writes), the bubble loads with empty meta/attachments and zero log signal. There's no telemetry, no health surface, no test for this. A renderer that depended on `metadata.tone` or `attachments[0].kind` would silently degrade.
- **Why it matters:** Smell that will mask future schema bugs. Same anti-pattern repeated in `routes_auth.py:38-47` for `prefs` and `bm`.
- **Fix sketch:** `logger.warning("metadata_json corrupt for msg=%s", msg.id)` in the except. Or use Pydantic JSON columns and let SQLAlchemy validate on load. ~5 LOC for logging; ~30 LOC for typed columns.

### 12. WhisperNPUProvider/MMSNPUProvider duplicate ~50 LOC of "register-EP-then-build-session" logic

- **Where:** `src/backend/voice/whisper_npu_provider.py:243-326` and `src/backend/voice/mms_npu_provider.py:157-211`.
- **What:** Bundle path probing, QNN options dict, `add_provider_for_devices` vs CPU fallback, exception handling — both providers diverge in subtle ways: Whisper's CPU fallback keeps a session but logs warning; MMS's CPU fallback rebuilds the session with `providers=["CPUExecutionProvider"]` (which is correct) but then sets `_mode = "cpu-fallback"` only on the second branch, leaving `_mode` unset if the first try succeeds with CPU device only. Future MMS-XL or Distil-Whisper bundle would re-paste this.
- **Why it matters:** The next NPU model will rot the duplication.
- **Fix sketch:** Extract `voice/qnn_runtime.py::build_qnn_session(graph_path, *, htp_arch_override, fp16, context_binary)` that returns `(session, mode_str, on_npu_bool)`. ~60 LOC pulled out, ~80 LOC removed across the two providers.

### 13. `voice/pipeline.py::reset_providers` mutates a global `_vosk_model` declared *after* it

- **Where:** `src/backend/voice/pipeline.py:66-70`; `_vosk_model = None` defined at line 86.
- **What:** `reset_providers` says `global _stt, _tts, _vosk_model` and then assigns `_vosk_model = None` at line 70 — but the module-level binding is created at line 86. At import time this works because both are module attributes, but moving the function above the global is fragile and confusing; on a future refactor "extract pipeline lifecycle to a class" this stops working without a noticeable error message. Also `reset_providers` does not call `reset_vosk_model()` (defined ~70 lines below) — duplicating intent.
- **Why it matters:** Subtle, but the file is going to be rewritten as soon as you ship a third STT.
- **Fix sketch:** Move all globals to top of module; have `reset_providers` delegate to `reset_vosk_model()` rather than touching the global. ~6 LOC.

### 14. `VoskSTTProvider._transcribe_sync` re-imports `vosk` on every call

- **Where:** `src/backend/voice/stt_engine.py:289-293`.
- **What:** `import vosk` at the top of `_transcribe_sync` runs every transcribe. Python caches modules, so it's cheap, but it disguises the dependency. Same pattern in `FasterWhisperSTTProvider` (line 339). Style smell, not a bug; remove for clarity. Note the actual bug nearby: `_transcribe_sync` constructs a fresh `KaldiRecognizer` per call — Kaldi's first AcceptWaveform allocates ~50–100 ms (warm-up code in `_warm_vosk` already documents this) — so PTT latency for short utterances is dominated by recogniser construction. Reuse a per-thread recogniser pool.
- **Why it matters:** Every Vosk push-to-talk pays the cold-cache price the warm-up was meant to amortise — the warm-up only helps the wake-spotter recogniser, not the per-request one.
- **Fix sketch:** `threading.local` cache of `KaldiRecognizer` keyed on `(model_id, sample_rate)`, reset on `reset_providers()`. ~25 LOC.

### 15. `routes_chat._ws_chat_handler` swallows ALL exceptions including the inner DB ones

- **Where:** `src/backend/api/routes_chat.py:683-688`.
- **What:** Outer `except Exception as exc:` catches the WS-level errors AND any unhandled DB error inside the long inner `try`. The error is logged but the user just sees `"chat", "error", {"detail": str(exc)}` — no error code, no retry hint, no metric. Compare with REST path which raises `HTTPException(503)` and the frontend has timeout/retry logic.
- **Why it matters:** WS chat fails opaquely. Frontend has no way to distinguish "transient AI error, retry" from "auth issue, re-login".
- **Fix sketch:** Mirror REST: classify exception (AIError → 503, AuthError → 401, etc.), include `code` field on the error event, expose router state snapshot on AI failure. ~25 LOC.

### 16. `STTResult.engine` typed comment claims `"whisper" | "vosk" | "noop"` but actual values are 5

- **Where:** `src/backend/voice/stt_engine.py:66` (comment) vs actual values: `"whisper"`, `"vosk"`, `"noop"`, `"whisper_npu"` (whisper_npu_provider.py:380, 392), `"mms_npu"` (mms_npu_provider.py:289, 303).
- **What:** Pure typing rot. Frontend `voiceApi.ts` likely switches on this and would be surprised by `whisper_npu`/`mms_npu`. No `Literal[...]` type annotation enforces it. A future provider add will rot this further.
- **Why it matters:** Frontend display logic ("which engine answered?") may be wrong; logs and audit trails carry inconsistent values.
- **Fix sketch:** Make `engine` a `Literal` typed field; update the docstring; grep frontend for engine-string switches and audit. ~6 LOC + frontend audit.

### 17. `provider.py:_classify_provider_exception` has a defensive `except Exception` around the dispatch, no log

- **Where:** `src/backend/ai/provider.py:783-791`.
- **What:** `from ai.gemini_provider import _classify_gemini_error` inside a `try / except Exception: pass` — if Gemini provider module itself fails to import (bad pyright/Pydantic upgrade etc.), we silently fall through to the default classifier, which marks everything as `"unknown"` and never quota-cools. So a bad import → PHANTOM hammers Gemini at full rate forever, eats your quota in minutes.
- **Why it matters:** Cost / availability incident. Same pattern repeats for ollama at 789-791.
- **Fix sketch:** `except ImportError as exc: logger.exception(...)` — narrow the catch, log loudly. ~4 LOC.

### 18. `decision_tree._can_initiate` mutates `_last_initiative_ts` on the *check* path

- **Where:** `src/backend/core/decision_tree.py:207-213`.
- **What:** `_can_initiate()` does both the test AND the side-effect of marking "initiative just fired". Multiple callers in the same tick (`_check_health`, `_check_calendar`, `_check_ai_initiative`) each potentially gate on it — only the *first* one passes, the rest are silently suppressed. Worse, since this returns True the first time and immediately bumps the timestamp, the cooldown effectively starts before any action is consumed (combined with #1 — initiatives aren't consumed at all). When you fix #1, this method needs a separate `mark_initiated()` step called after the action lands.
- **Why it matters:** Initiatives compete in undocumented priority order; only one can ever land per cooldown window even if two are independent ("breathe + calendar reminder" can't co-exist).
- **Fix sketch:** Split into `_can_initiate()` (pure check) and `_mark_initiated()` (called by the consumer after publishing). ~8 LOC.

### 19. `ContextEngine.update` releases lock then calls `event_bus.emit` with a snapshot — handlers see stale data

- **Where:** `src/backend/core/context_engine.py:167-180`.
- **What:** Pattern is: `async with self._lock: ... snapshot_copy = dict(self._snapshot)` (release), `event_bus.emit("context_updated", snapshot_copy)`. Two concurrent `update()` calls (sensor batch arrives while a tick is in flight) both copy the dict, both emit — handlers see snapshots in the wrong order. There's no monotonic snapshot id. With #10 (un-tracked tasks) plus this, debugging "why did the OLED state lag" is very hard.
- **Why it matters:** Race between concurrent ticks/updates, plus the snapshot dict is a *shallow* copy — nested dicts (`who`, `where`, `body`, `system`) are *shared* between snapshot copies. So a handler reading `snap["where"]["lat"]` may see a value that was overwritten by the next batch before the handler's coroutine runs. **This is a real correctness bug**, not just a style smell.
- **Why it matters (severity):** Borderline P0. ContextEngine is the single source of truth; if downstream consumers see torn reads, every decision is suspect. I'm leaving it P1 only because the dict is mostly immutable scalars and the concrete impact in production is hard to demonstrate; auditor judgement may upgrade to P0.
- **Fix sketch:** `snapshot_copy = copy.deepcopy(self._snapshot)` (cheap, the dict is small) and add `"snapshot_id"` (monotonic counter) to every snapshot. ~6 LOC.

## P2

### 20. `_resolve_bundle_path` and `_resolve_mms_bundle` re-implement the same project-root probing 3 different ways

- **Where:** `src/backend/voice/whisper_npu_provider.py:92-121`, `src/backend/voice/mms_npu_provider.py:62-82`, plus `_resolve_vosk_model_path` in `stt_engine.py:218-239`.
- **What:** Three different conventions for "find a model directory under a few candidate roots." Each shipped in a different phase. Refactor opportunity, not a bug today — but a fourth model lands and we'll have a fourth probe.
- **Fix sketch:** `voice/_paths.py::resolve_model_dir(name, search=[...])`. ~30 LOC.

### 21. `_chunk_content` leaks half-words on small chunk sizes, no test boundary at chunk_size=1

- **Where:** `src/backend/api/routes_chat.py:517-531`.
- **What:** `if space > cursor + chunk_size // 2` — for `chunk_size=1` this is `space > cursor + 0`, so any space splits cleanly; for `chunk_size=2` you get half-syllable cuts. Cosmetic but the parameter is operator-tunable via `config.chat_stream_chunk_chars` and there's no clamp on the lower bound.
- **Fix sketch:** Min clamp `chunk_size >= 4` and add a unit test for chunk boundary on multi-byte characters. ~5 LOC.

### 22. `_warm_whisper` reaches into `provider._model.transcribe` — naming "private" attribute breaks abstraction

- **Where:** `src/backend/voice/pipeline.py:161-166`.
- **What:** Uses `provider._model.transcribe(...)` directly. Future provider that re-implements `FasterWhisperSTTProvider` differently won't match the duck shape. Better: have providers expose `warmup()` on the protocol (each STTProvider knows its own warm-up).
- **Fix sketch:** Add `warmup() -> None` default-no-op on `STTProvider`, override in each, drop `_warm_whisper`/`_warm_npu`/`_warm_mms_npu` helpers. ~25 LOC restructure.

### 23. `routes_settings.py:670-675` swallows rollback failures without logging

- **Where:** `src/backend/api/routes_settings.py:670-678`.
- **What:** Inner `try/except: pass` around `config.apply_overrides({key: before})` rollback — if rollback itself fails the import of N settings still claims `imported_count` correct and "skipped" is incremented. Operator can't tell which rows actually didn't roll back.
- **Fix sketch:** `logger.warning("settings rollback failed for %s: %s", key, exc)`. ~3 LOC.

### 24. `useVoiceAlwaysOn.ts` is 799 LOC — single hook for one of the most stateful subsystems

- **Where:** `src/frontend/src/hooks/useVoiceAlwaysOn.ts`.
- **What:** One file, one hook, 800 lines. Hook composition rules become hard to follow; React's strict-mode double-invoke surfaces hard-to-trace effect re-runs at this size; testing requires mocking ~12 services. Compare with the (cleaner) backend `always_on.py:670 LOC` which is at least split into multiple coroutines.
- **Fix sketch:** Decompose into `useVoiceWebsocket`, `useMicCapture`, `useDuckingPolicy`, `useAlwaysOnConfig`. Probably a half-day refactor. >100 LOC.

### 25. `state_machine.GHOST` exit only on `_ghost_trigger`, but `_ghost_trigger` is broken (#2)

- **Where:** `src/backend/core/state_machine.py:186-187`, `_ghost_trigger` line 105-111.
- **What:** Once GHOST somehow becomes the active state (via `force_transition` API), it can only be exited by re-toggling — and the trigger reads dead snapshot fields (#2). So GHOST is a one-way door once entered. Combined with the documented "GHOST = panic / silent mode" semantic, this is dangerous: operator triggers GHOST in the field, can't exit without rebooting backend.
- **Fix sketch:** Lands automatically when #2 is fixed, but also add an explicit `force_transition(SHADOW, "manual_ghost_exit")` route on `routes_context.py`. ~10 LOC.

## Cross-cutting observations

- **115 broad `except Exception` blocks across api/ai/core/voice (excluding tests).** Most are reasonable "best-effort" non-critical paths logging at `debug` (telemetry, fact extraction, secondary writes). Several mask real bugs (#3, #11, #15, #17). Pattern needed: a `swallow_for_telemetry(label)` context manager that logs at `warning` *and* increments a metric — turns silent failures into observable ones. ROI: high; LOC: ~40.
- **Dead-wired autonomous brain.** Findings #1, #2, #4, #9, #18 collectively make ~half of `core/` be "infrastructure for a Jarvis that has not been switched on". The blueprint is in `core/decision_tree.py` and `core/state_machine.py`, but the only consumer of those events in `main.py` is `state_machine.evaluate` for FSM transitions; everything DecisionTree builds is discarded. Fixing this is the single biggest unlock toward "Jarvis-grade autonomy."
- **STT provider chain treats "session up" as success and never re-validates.** Once `WhisperNPUProvider()` constructs, it's locked in for the process lifetime even if every transcribe returns empty (#3). Pattern: providers should report `health()` (a la `AIRouter._is_provider_available`) and the chain should re-pick if the active provider's last-K calls are all empty/zero-confidence.
- **Concurrency primitives are inconsistent across the codebase:** `asyncio.Lock` in `WebSocketHub` and `ContextEngine`, `threading.RLock` in `voice/pipeline.py`, no lock in `EventBus`. Each is justifiable in isolation; together they make the threading model non-obvious. A short `docs/CONCURRENCY.md` explaining "what runs in async vs thread vs sync" would prevent future regressions.
- **Two fully duplicated chat-send pipelines** (`send_message` REST handler 267-480 + `_ws_chat_handler` 534-688). Both build user_msg, call `_build_ai_response`, build assistant_msg, broadcast, commit. Drift is already visible (REST has `auto_tts`, WS doesn't; REST has 9.4b geo ingest, WS has it too but the imports are inline). One pipeline through a `ChatService` class, two thin transport adapters. ~120 LOC reduction.
- **No structured event for AI failures.** Every fallback / quota-exhaust / provider switch is a `logger.warning`. Frontend has no way to surface "Gemini is in cooldown, falling back to Ollama" to the operator. Adding a `system_event` WS channel that emits these (with type, severity, recoverable: bool) is small and high-leverage. ~30 LOC backend + StatusBar widget.
