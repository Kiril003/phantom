# Day-2 Code-Quality Audit — 2026-04-29

Read-only review of HEAD = `111181e` on branch `autonomous-run`. Scope: code-quality bugs, dead code, swallowed exceptions, async/concurrency footguns introduced or revealed by Day-1 commits (`b003c16` … `111181e`), with explicit attention to the files the orchestrator flagged: `observability.py`, `chat_tool_dispatcher.py`, `004_chat_prompt_log.py`, `routes_chat.py`, `routes_voice.py`, `core/event_bus.py`, `core/context_engine.py`, `voice/stt_engine.py`, `voice/whisper_npu_provider.py`, `voice/mms_npu_provider.py`, `agent/actions/bash.py`, `config.py`, `main.py`.

---

## Day 1 carry-overs still open

* **F-29** `api/websocket_hub.py:103-108` — broadcast cleanup still re-acquires the lock per disconnected client and `WSClient._connected` is mutated outside the hub lock at `WSClient.send` line 48. Untouched in Day 1. (P1, ~12 LOC)
* **F-30** `api/routes_chat.py:386-391` and again at `routes_chat.py:455` — `db.commit()` runs before `_build_ai_response`; `HTTPException` at line 463-466 raises without rolling back the user_msg row. Untouched. (P1, ~40 LOC)
* **F-32** `core/context_engine.py:464-466` vs `ai/provider.py:763-769` — both still reconcile `system.ai_provider` independently every 500 ms. Untouched. (P2, ~15 LOC)
* **F-33** `core/decision_tree._can_initiate` — pre-Day-1 finding, still mutates timestamp on the check. (P2)
* **F-35** `state_machine._first_visit` — `where.place_known` never written by any localisation path. (P2)
* **F-36** `routes_chat._ws_chat_handler` lines 761-766 — broad `except` swallows everything and emits opaque `{"detail": str(exc)}` (also re-leaks F-16 even after the Day-1 centralised exception handler). (P2)
* **F-40** `agent/actions/fs.py` `abspath` not `realpath`. (P1, untouched)
* **F-41** `agent/actions/net.py` arbitrary-host port-scan. (P1, untouched)

---

## New issues introduced or revealed by Day 1 commits

### P0

#### Q-01 — F-08 / F-09 NOT actually closed by commit `f488298`. Voice and Settings routes remain unauthenticated.
The B-2 commit message claims "voice + settings auth" but the code at HEAD does not have the dependencies.
* `src/backend/api/routes_voice.py:76,119,164` — `@router.post("/stt")`, `@router.post("/tts")`, `@router.get("/status")` have NO `Depends(require_auth)` on the route or the router (`router = APIRouter(prefix="/voice", tags=["voice"])`, line 33).
* `src/backend/api/routes_settings.py:437,442,636` — `GET ""`, `GET /_value/{key:path}`, `POST /export` still unauth. The router at line 33 carries no `dependencies=[Depends(require_root)]` either.
This is a P0 regression of credibility: the Day-1 release tag `v0.18.0-saas-base` ships with the LAN-takeover surface that the audit baseline declared closed. Fix: either add `Depends(require_auth)` per route or `dependencies=[Depends(require_auth)]` on the router. ~10 LOC + tests.

#### Q-02 — F-25 fix is half-wired: `engine_error` is populated but never read.
`voice/whisper_npu_provider.py:379-385` and `voice/mms_npu_provider.py:288-294` correctly set `STTResult.engine_error` on inference failure. But:
* `api/routes_voice.py:47-52` — `class STTResponse` has no `engine_error` field;
* `api/routes_voice.py:110-116` — `transcribe_speech` builds `STTResponse(text="", confidence=0, engine="mms_npu", language=..., wake_word_matched=False)` and returns 200 — pydantic strips `engine_error`;
* `voice/pipeline.py:80` `transcribe_blob` returns the raw `STTResult` but no caller inspects `engine_error`;
* `voice/always_on.py` — wake/utterance handler also does not check `engine_error` (no hits in `grep`).
The promised observability+recovery channel is therefore inert. The provider also does NOT mark itself "wedged" — the next call hits the same broken HTP session. Fix: route raises `HTTPException(503, detail="STT engine error", headers={"X-Engine-Error": result.engine_error})` when `result.engine_error` is set; provider zeroes `self._session = None` so `_ensure_model` re-tries from scratch. ~25 LOC.

### P1

#### Q-03 — Middleware registration order: `http_requests_counter` ends up OUTERMOST, so its exception path runs without correlation-id context.
`src/backend/main.py:497-498`. FastAPI's `app.middleware("http")` decorator pushes onto a stack that executes LAST-registered FIRST on incoming requests (Starlette `BaseHTTPMiddleware` semantics). With:
```
446  @app.middleware("http")  _phantom_security_headers          # registered first
497  app.middleware("http")(correlation_id_middleware)            # second
498  app.middleware("http")(http_requests_counter_middleware)     # third → outermost
```
the actual call order on a request is `counter → correlation_id → security_headers → app`. The `try/except` at `observability.py:80-82` therefore runs OUTSIDE the contextvar token scope, so any `logger.debug` it emits has `correlation_id="-"`. Worse: the punch-list explicitly required correlation-id BEFORE counter — the *intent* (counter sees the cid) is broken. Fix: register counter first, then correlation_id (so correlation_id is outermost) — or set the cid inside the counter middleware as well. ~3 LOC.

#### Q-04 — `EventBus._track` keeps strong refs but `emit()` still has a `RuntimeError → ensure_future` fallback that bypasses the running-loop check.
`core/event_bus.py:60-68`. The new `_pending_tasks: set` (line 25) is an event-loop-agnostic Python set; in the documented happy path (`asyncio.create_task`) tasks live on the running loop and the set keeps a strong ref. The fallback branch (no running loop, `asyncio.ensure_future`) creates a task on whatever the default policy yields — a different loop, possibly never started. Adding it to `_pending_tasks` keeps the ref alive but the task never runs. The Day-1 test passes because tests run inside `pytest-asyncio`'s loop. In production this only matters if `emit()` is called from a true sync entry point — currently none — but the dead branch will rot until something calls it. Fix: drop the `ensure_future` fallback entirely; raise so callers learn they need an `emit_async` invocation. ~5 LOC.

#### Q-05 — `Counter.inc` is not concurrency-safe; metric undercounts under request fan-out.
`observability.py:125-129`. `dict.get + assignment` is two separate ops; with `await call_next` between requests the `http_requests_counter_middleware` can interleave on the same `(method, route, status)` key and lose updates. CPython's GIL gives atomicity for *single* `setitem`, not for the `get → +1 → setitem` cycle on a hot label. With ~10-20 RPS this is invisible; with the WS broadcast volume of a connected device it shows up as drift in `phantom_http_requests_total` vs server-access logs. Fix: `threading.Lock()` (or `asyncio.Lock` only if you serialise inside `inc`, which is wrong for a sync helper). ~6 LOC.

#### Q-06 — `_uptime_seconds` uses wall-clock `time.time()`, not monotonic.
`observability.py:204-205`. `_PROCESS_STARTED_AT = time.time()` at module-import (line 37) plus `time.time() - _PROCESS_STARTED_AT` produces NEGATIVE uptime if NTP steps the clock backward, which Prometheus flags as a "counter reset". Use `time.monotonic()` consistently. ~4 LOC.

#### Q-07 — `_probe_ai_provider` reaches into `ai_router._is_provider_available` (single underscore = private).
`observability.py:268,270`. The probe couples the readyz contract to a private attribute that AIRouter is free to rename in any refactor (the Tier-0 Jarvis unlock work in Block C/D will likely touch it). Either lift `is_provider_available()` to the public surface of AIRouter or use a public accessor like `active_provider_name()` (which already exists at `ai/provider.py:133`). ~5 LOC.

#### Q-08 — `_chunk_content` zero-clamp short-circuit defeats the F-43 lower-bound clamp.
`routes_chat.py:591-597`. The early return for `chunk_size <= 0` runs *before* `max(chunk_size, 4)`, so a config-set `chat_stream_chunk_chars = 0` returns the entire `[text]` as one chunk and the streaming UX is silently broken. Fix: clamp first (`chunk_size = max(int(chunk_size or 4), 4)`), then chunk. ~3 LOC.

#### Q-09 — `chat_tool_dispatcher.dispatch` swallows ALL exceptions including `CancelledError`.
`ai/chat_tool_dispatcher.py:78`. `except Exception` catches `CancelledError` on Python 3.8+ (where it derives from `BaseException`, so technically NOT caught — *unless* the handler raised a wrapped task error). More importantly, `asyncio.TimeoutError`, `ConnectionError`, etc. all collapse to a 200-ish response (`ok=False`). Combined with the LLM treating tool-output as authoritative, a transient network blip on `recall_memory_facts` looks identical to "no facts found" and the model confabulates. Fix: re-raise `CancelledError`, classify others (`timeout`, `db_error`, `provider_error`) so the LLM can react; or at minimum log at `WARNING` (currently `WARNING` — okay) AND emit to the new `phantom_chat_tool_failures_total` counter (doesn't exist). ~10 LOC.

#### Q-10 — Day-1 `chat_messages_total` counter increments TWO labels for what may be ONE successful turn.
`routes_chat.py:298-304`. Inside `_build_ai_response`, after `ai_router.generate` succeeds, BOTH `role="user"` and `role="assistant"` get incremented in the same try block. But the user message is written and committed at `routes_chat.py:386-391`, which happens regardless of whether `_build_ai_response` succeeds. If F-30 fires (AI fails after user_msg commit), the counter never increments for the user message either — so dashboards under-count user inputs proportional to the AI failure rate. Fix: increment `user` at the user-msg commit site, `assistant` only on AI success. ~5 LOC.

#### Q-11 — `db` parameter name-shadow inside `_h_search_locationhistory`.
`ai/chat_tool_dispatcher.py:125-127`. The handler signature uses `user_id: str, db: AsyncSession`; the route pattern across the codebase passes `Depends(get_db)` as `db`. The dispatcher's caller (`dispatch` at line 71) uses keyword args (`user_id=...`, `db=...`) so no positional confusion today, but the chat path that will eventually call `dispatch` (Phase 17b) hands the SAME `AsyncSession` the chat user_msg was committed on. Tool handlers then read from this same session — opening an implicit transaction overlap with the still-running `_build_ai_response`. Once Phase 17b lands this becomes a deadlock vector identical to the one F-30's "two `commit()` calls" was added to defuse. Fix: open a fresh `async with get_session()` inside each handler, OR document loudly that handlers must not mutate. ~documentation only today, ~30 LOC when 17b lands.

#### Q-12 — `chat_tool_dispatcher.get_system_metrics` calls `psutil.cpu_percent(interval=0.05)` — blocks the event loop for 50 ms.
`ai/chat_tool_dispatcher.py:247`. The whole handler is an `async def` but it never `await`s; the 50 ms `interval` is a `time.sleep(0.05)` inside psutil. With the planned Phase 17b chat tool loop running this from the main loop on every "what's load" question, it blocks the WS broadcast cadence. Fix: `await asyncio.to_thread(psutil.cpu_percent, 0.05)` or use `interval=None` plus a short `asyncio.sleep`. ~3 LOC.

#### Q-13 — `_register_observability` mounts routes BEFORE the StaticFiles `app.mount("/")` — but the `include_in_schema=False` and the comment "mounted last" are misleading.
`main.py:484,499,510-514`. Health/metrics are registered between `_register_health(app)` (line 486) and the static-files mount. The order is fine for resolution. The risk is at line 488-499: the comment "Phase 18 (audit-2026-04-28 Block E) — productisation observability" reads as if it's a feature gate; if anyone later moves the static mount before this block, all observability endpoints silently 404 (StaticFiles with `html=True` matches every path). Fix: assert the mount runs last, or move observability registration to immediately AFTER the static mount with explicit prefix. ~docs only.

#### Q-14 — `correlation_id_middleware` does NOT validate header format beyond length.
`observability.py:53-54`. An attacker-supplied `X-Correlation-Id: <newline>…<inject>…` could land in log records (rendered via `record.correlation_id`). The 64-char clamp doesn't reject CR/LF, control chars, or shell metas. Log injection vector once correlation-ids are echoed into journal-style aggregators. Fix: `re.fullmatch(r"[A-Za-z0-9_-]{1,64}", incoming)` or fall through to generated id. ~4 LOC.

### P2

#### Q-15 — `bash.py` scrubbed env still leaks `PATH=/usr/sbin:/sbin`.
`agent/actions/bash.py:36-42`. The Day-1 fix (F-10c) scrubs API keys but the kept `PATH` includes `/usr/sbin` and `/sbin`, which contain `useradd`, `userdel`, `iptables`, `mount`. Since `agent_risk_tolerance` defaults to 3 and `bash.run` is `RiskLevel.MEDIUM`, the LLM can request these by passing risk_tolerance=5 in a follow-up — the env doesn't gate it. Fix: drop sbin paths; if firejail is active it doesn't matter, if it isn't (the silent CPU-fallback case) it does. ~2 LOC.

#### Q-16 — `WhisperNPUProvider` and `MMSNPUProvider` don't surface `_session = None` reset, so a wedged HTP stays wedged across calls.
`voice/whisper_npu_provider.py:373-385`, `voice/mms_npu_provider.py:283-294`. The `engine_error` path returns the broken result but leaves `self._session` populated, so the very next request takes the same blown path and produces the same empty transcript. F-25's "rebuild on next call" promise is unfulfilled. Fix: `self._encoder_session_qnn = None; self._model = None` in the whisper exception branch, `self._session = None` in MMS. ~4 LOC.

#### Q-17 — `004_chat_prompt_log.py` uses raw f-string in `ALTER TABLE`.
`db/migrations/004_chat_prompt_log.py:38-40`. `text(f"ALTER TABLE ai_tool_use_log ADD COLUMN {col_name} {col_type}")` — `col_name`/`col_type` come from a module-level dict so today this is safe, but the pattern (string-formatted DDL inside `text()`) is exactly what static analysers flag. If this template is ever reused with operator-supplied columns the SQLi fence is gone. Fix: use SQLAlchemy reflection + `op.add_column` (alembic) when the project moves off hand-rolled migrations, OR explicit allow-list assertion (`assert col_name in _NEW_COLUMNS`). ~3 LOC.

#### Q-18 — `ContextEngine._refresh_nearby` reads `self._nearby_cache_data` then awaits Overpass without holding `self._lock`, but writes the cache after.
`core/context_engine.py:351-386`. Two concurrent `resolve_localization()` calls (the tick loop and a future explicit refresh) can both miss the cache, both fetch from Overpass, both write — TOCTOU on the cache, double network cost. Lock scope wasn't enlarged to fix this in Day 1. Fix: cache check + write under `self._lock`, only the `await overpass.features_near` outside it. ~6 LOC.

#### Q-19 — `_serialize_session` swallows JSON parse error to empty list silently.
`routes_chat.py:135-138`. Mirrors the F-66 fix in `_serialize_message` (which now logs at WARNING) but `_serialize_session` was missed. Same bug class: corrupt `state_history_json` rows look indistinguishable from empty. Fix: identical `logger.warning` block. ~4 LOC.

#### Q-20 — `_HANDLERS` registry not exported; tests can't enumerate without touching `_register`.
`ai/chat_tool_dispatcher.py:43`. Single-underscore prefix on a registry that the test suite WILL want to introspect (Phase 17b will add 4-5 more handlers). Public alias or a `registered_handlers()` accessor would prevent tests from grabbing `_HANDLERS` directly. ~3 LOC.

---

## Cross-cutting observations

1. **The B-2 / F-08 / F-09 gap is the load-bearing finding of this audit.** A claimed-closed P0 that isn't actually closed in code reflects badly on the audit→fix→commit pipeline. Recommend a one-shot grep gate in CI: `grep -rn "Depends(require_auth)\|Depends(require_root)" src/backend/api/routes_voice.py src/backend/api/routes_settings.py | wc -l` and require ≥ 6 hits before merge.

2. **The `engine_error` half-fix (Q-02) is the second instance of "data-class field added but no consumer".** Same pattern as F-04 (snapshot fields without readers, fixed by Day 1 ContextEngine commit). Whenever a producer field lands, the closing test should be a route-layer or integration test that proves the consumer actually reads it.

3. **Day-1 observability counters are sprinkled inside try/except blocks that swallow on import error** (`routes_chat.py:303`, `routes_voice.py:108,151`, `ai/provider.py:777`). On a clean install this is fine, but on a partial deploy where `observability.py` is missing one of these would push corrupted module state into every request path. Either centralise the metric publication via an event bus (cleaner) or accept the silent-no-op (status quo) and remove the per-call try/except — `from observability import X` only fails once at import time. ~saves 8-10 LOC across the codebase.

4. **EventBus + tracker (Q-04) is the third place we paper over the "is there a running loop" question.** ContextEngine's `_lock` is an `asyncio.Lock` constructed at module-import time (`context_engine.py:172`) which has historically broken when imported under sync code. Worth adding a `docs/CONCURRENCY.md` (already on the Block E backlog) before more async surfaces land.

5. **Middleware ordering (Q-03) is the kind of bug that *only* shows up under load.** When the `http_requests_counter_middleware` exception path fires (presumably never in a green test run), the missing correlation-id makes triage hostile. Either lock down ordering with a comment+assertion or fold the counter into correlation_id_middleware itself (one middleware, two responsibilities, fewer ordering footguns).

6. **Tier-0 Jarvis unlock (F-01..F-06) untouched by Day 1.** Day 1 was correctly scoped to productisation; the brain still has dead wires. The chat tool dispatcher (`chat_tool_dispatcher.py`) is the *infra* for F-01's fix, but `ai_router.generate` at `routes_chat.py:262` still doesn't call `call_with_tools`. Phase 17b must close that gap or the Day-1 dispatcher is dead code waiting for a caller.

---

**Findings count:** 20 new (1 P0, 13 P1, 6 P2) + 8 carry-overs.
**Total LOC to close all P0+P1 items:** ~120 LOC.
