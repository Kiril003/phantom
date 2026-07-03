# PHANTOM OS — Multi-Perspective Audit, 2026-04-28

Consolidated punch list from four parallel reviewers (code-quality, architecture, security, performance). Each finding is deduped, ranked by *blast radius × probability × ROI*, and cross-referenced. Source dimension(s) shown as `[CQ]` `[ARCH]` `[SEC]` `[PERF]`.

**Headline:** the small things are clean. The big thing is that the autonomous brain — the literal "Jarvis" — is built but **never switched on**. `DecisionTree.consume_initiative()` has zero callers; `event_bus.subscribe()` has zero callers; `state_machine.set_ai_initiative()` has zero callers; `chat.send_message` calls `ai_router.generate()` instead of `call_with_tools()` even though `CHAT_DATA_TOOLS` is fully defined and advertised in the prompt. Half of `core/` is infrastructure for an autonomy that is wired *up to but not into* the runtime. Fixing this is the single biggest unlock. Productisation security is the next tier; perf is third.

Scope of this audit: `src/backend/{core,ai,agent,voice,api,memory,db,security}/`, `src/frontend/src/{stores,hooks,components,layouts}/`. Excluded: tests, build artefacts, third-party.

---

## Tier 0 — Jarvis unlock (autonomous brain has dead wires)

> Six findings whose fix turns "looks like Jarvis on paper" into "behaves like Jarvis at runtime." Most of the code already exists; what is missing is the wiring at three integration points (chat → tools, EventBus → subscribers, DecisionTree → action dispatcher).

| ID | Severity | Title | Where | Effort |
|---|---|---|---|---|
| **F-01** | P0 | Chat ignores tool-use catalogue | `api/routes_chat.py:226` calls `ai_router.generate(...)`, not `call_with_tools(...)` — yet `ai/chat_tools.py:18` defines the full `CHAT_DATA_TOOLS` and `ai/personality.py:86` already advertises them in the system prompt | M (~3 d) |
| **F-02** | P0 | EventBus has emitters but zero subscribers | `core/event_bus.py:18-42` is wired; `core/context_engine.py:179`, `core/state_machine.py:297`, `core/decision_tree.py:70`, `sensors/serial_bridge.py:202` emit; `grep -rn 'event_bus.subscribe'` returns nothing | M (~2 d) |
| **F-03** | P0 | DecisionTree output is discarded | `main.py:83` calls `decision_tree.evaluate(snapshot)`; `consume_initiative()` (`decision_tree.py:78-87`) has zero callers; every `actuator/alert/ai_speak/recommendation` action is built and immediately thrown away | M (~2 d) |
| **F-04** | P0 | GHOST trigger reads dead snapshot fields | `state_machine.py:107-111` reads `snap["encoder"]`/`snap["buttons"]` — `context_engine._empty_snapshot` (lines 59-134) never publishes those keys. Secret feature is silently inert. CLAUDE.md commandment #6 broken at the data-source level | S (~15 LOC) |
| **F-05** | P0 | `last_interaction_ago_s` is broken at boot | `context_engine.py:147` initialises `_last_interaction_ts = time.monotonic()`, so on the first tick `last_interaction_ago_s ≈ 0`. Every guard built on it (FOCUS→SHADOW idle, `decision_tree._check_ai_initiative`, `_no_interaction(snap, 120)` in state machine) silently fails until the first user touch. PHANTOM cannot drift autonomously | S (~3 LOC) |
| **F-06** | P0 | Two parallel autonomous-decision systems that don't talk | `core/decision_tree.py` (rule-based, 500 ms cadence) and `agent/proactive.py:_DECIDE_TEMPLATE` (LLM, 30-300 s cadence) both exist and ignore each other. ProactiveLoop builds its own context (`proactive.py:494-521`) without consulting DecisionTree's pending actions | L (~3 d) |

### Tier-0 quick wins (lift the floor in <100 LOC total)

- F-04 + F-05: `15 + 3 = ~18 LOC` — no design change, just data.
- F-02 minimal: subscribe `state_changed` from the WS hub (~10 LOC), subscribe `decision_action` from a new `core/action_dispatcher.py` (~30 LOC) — turns dead emit into observable behaviour.
- F-03 minimal: in `main.py:_context_loop`, after `decision_tree.evaluate(snapshot)`, drain `consume_initiative()` and route through the dispatcher above (~25 LOC).
- F-01 is the only Tier-0 P0 that needs a phase-sized commit (it lands in Block D).

---

## Tier 1 — Productisation security gates

> Eight findings that block any ship beyond a single-tenant LAN device. Quick-wins block listed inside.

### F-07 [SEC] **Default ROOT user `phantom`/PIN `000000` + auto-login + `host=0.0.0.0`** — P0 LAN takeover on first boot
`security/auth.py:91-111` creates the default user; `security/auth.py:77-88` auto-login bypass; `config.py:27,261`. Pristine deployment = unauthenticated full takeover. **Quick-win:** refuse auto-login when PIN hash matches `"000000"` (~8 LOC).

### F-08 [SEC] **Voice routes carry no auth** — P0
`api/routes_voice.py:76,113,152` — `/voice/stt`, `/voice/tts`, `/voice/status` have no `Depends(require_auth)`. Hostile LAN device can DoS Whisper/HTP, exfiltrate NPU bundle path. **Quick-win:** add `Depends(require_auth)` to all three routes (~6 LOC). `voice_status` should also redact `npu_model_path` for non-ROOT.

### F-09 [SEC] **Settings GET / export are unauthenticated** — P0
`api/routes_settings.py:437,442,636` — `GET /settings`, `GET /settings/_value/{key}`, `POST /settings/export` no auth. Only password-class keys are masked; everything else (hostnames, agent paths, MCP configs, network UA, wardriving toggle, all thresholds) leaks freely. **Quick-win:** blanket `Depends(require_root)` on the settings router (~3 LOC).

### F-10 [SEC] **`bash.run` is the de-facto Linux executor; sandbox silently downgrades** — P0
`agent/actions/bash.py` + `agent/safety/sandbox.py:38-43`. CLAUDE.md describes `linux/executor.py` + `dangerous_patterns.py`; **neither file exists** (`routes_linux.py:22-32` returns 501). The actual executor wraps `firejail` *only when on PATH*; otherwise it silently runs unsandboxed. Inherits parent env — leaks `JWT_SECRET_KEY`, `AI_GEMINI_API_KEY` to spawned shells. Default `agent_risk_tolerance=5` permits MEDIUM. **Quick-wins (≤10 LOC each):** (a) fail-closed on missing firejail, (b) pass `env={"PATH": "/usr/bin:/bin", "HOME": ctx.workspace_dir}`, (c) drop default risk tolerance to `3`.

### F-11 [SEC] **Prompt injection → memory recall → web search exfiltration chain** — P0 (productisation)
`ai/tool_executor.py:281-336`, `ai/chat_tools.py`, `ai/gemini_provider.py:283-298`. No input sanitisation, no tool-output sanitisation, no chain-depth cap, no separator hygiene. A single hostile turn can chain `recall_memory_facts → search_web` to exfiltrate every fact via Google query log. Becomes worse the moment chat tool-use ships (F-01). **Mitigation:** add MAX_TOOL_CALLS_PER_TURN cap, refuse `search_web` whose `query` originated from a tool result, output classifier on the final TTS-bound message.

### F-12 [SEC] **CORS `allow_methods=["*"], allow_headers=["*"], allow_credentials=True`** — P0 CSRF surface
`main.py:425-432`. Cookies are `httponly samesite="lax"`. Combined with the unauth-but-cookie-honouring routes, an allow-listed origin can drive any state-changing POST with the user's session. **Quick-win:** explicit method+header allow-lists (~2 LOC), require Authorization header (not cookie) for `/auth/refresh`.

### F-13 [SEC] **No security headers** — P1
`main.py:415-432` adds only CORSMiddleware. **Quick-win:** ~12-LOC middleware emitting `X-Frame-Options DENY`, `X-Content-Type-Options nosniff`, `Referrer-Policy`, `HSTS`, baseline CSP.

### F-14 [SEC] **JWT: HS256 single secret, no `kid`, no revocation, 8 h TTL + 1 h refresh grace, no absolute lifetime cap** — P1
`security/jwt_manager.py`. Logout only clears cookie. Refresh extends session indefinitely. **Quick-wins:** add `orig_iat` claim + 30-day absolute cap (~10 LOC); add `revoked_jti` table for logout-everywhere (~30 LOC).

### F-15 [SEC] **No rate-limit / lockout enforcement** — P1
`security/auth.py:44-57` — RFID login is bcrypt-O(n) over every user with no rate limit; PIN attempts not counted. `security_max_pin_attempts` and `security_lockout_duration_m` are surfaced via `/auth/config` but never read. **Fix:** in-memory `dict[str, deque]` + 429 after threshold (~25 LOC). Wires the already-configured knobs.

### F-16 [SEC] **Provider exception detail leaks via `detail=str(exc)`** — P1
`gemini_provider.py:154-163`, `routes_voice.py:96,133`, `routes_chat.py:392`. Google SDK errors have historically embedded request URLs / partial keys. **Fix:** centralised exception handler returning `{"error_code": "..."}`, logs full traceback server-side (~20 LOC). Closes also S-13 (settings validation swallowed).

---

## Tier 2 — Latency / leak (operator-visible perf today)

| ID | Sev | Where | Issue + fix | Δ |
|---|---|---|---|---|
| **F-17** | P0 | `chroma_data/` directory | **537 orphan collection dirs / 1 live collection / 10 embeddings / 93 MB**. Cold scan ~2-3 s on first chat. Per-user collection sharding fans out unbounded. Fix: janitor at lifespan + open client at warm time + migrate to single sharded collection with `where={"user_id": ...}` | −2-3 s first chat, −90 MB |
| **F-18** | P0 | `frontend/stores/systemStore.ts:65` | `setContext: (ctx) => set({ context: ctx })` — every 500 ms sensor tick re-renders every `s.context` consumer (PresenceLayer, TacticalMap, all layouts, Overlays). Drops UI off 60 fps. Fix: equality guard + per-field selectors | +3-6 ms / frame at idle |
| **F-19** | P0 | `api/websocket_hub.py:84-101` | Broadcast fans out every channel to every client including 2 Hz sensor snapshots. No subscription model. Fix: per-client `subscriptions: set[str]` gate, pre-serialize once per broadcast | −3-5 % backend, −5-10 % frontend at idle |
| **F-20** | P1 | `routes_chat.py:267-393` | Chat turn fires 8-11 SQLite round-trips + 2 explicit commits before LLM call. Two commits exist as deadlock barrier; underlying cause is tool executor opening its own AsyncSession | 30-80 ms / turn |
| **F-21** | P1 | `voice/stt_engine.py:81-115` | `subprocess.run(ffmpeg)` blocks event loop on every WebM/Opus push-to-talk. Fix: wrap `decode_to_mono16k` in `to_thread` at the route layer | unblocks loop for utterance duration |
| **F-22** | P1 | `voice/mms_npu_provider.py:128,215-224` | MMS pads every utterance to 30 s; instant tier latency stuck. Fix: compile a 3 s context binary, pick by audio length | −40-60 ms median (instant tier) |
| **F-23** | P1 | `voice/always_on.py:219,380` | Silero VAD `to_thread` per 30 ms frame at 33 Hz/connection. Fix: single batched VAD worker, `asyncio.Queue` | −3-5 % CPU during speech |
| **F-24** | P1 | `voice/mms_npu_provider.py:228-258` | CTC greedy decode loops T~1500 frames in pure Python. Fix: vectorise argmax with numpy | −5-15 ms / utterance |
| **F-25** | P1 | `voice/whisper_npu_provider.py:373-381`, `mms_npu_provider.py:283-291` | NPU/MMS providers swallow inference failures into empty `STTResult(text="")` — looks like silence. Fix: emit `engine_error` field, mark provider wedged, rebuild on next call | observability + recovery |
| **F-26** | P1 | `voice/always_on.py:625`, `stt_engine.py:293` | `KaldiRecognizer` constructed per utterance — 5-20 ms C++ alloc. Fix: thread-local cache keyed on (model, sample_rate) | −5-20 ms / Vosk utterance |
| **F-27** | P1 | `memory/geo_integration.py:84,121` | Nominatim N+1: one HTTP call per place entity in chat message. Fix: batch at extractor | up to seconds on geo-dense messages |
| **F-28** | P1 | `core/context_engine.py:176,189` | `_history` shares inner-dict references — `get_history()` returns lies for any field updated in-place. Fix: deepcopy the snapshot, add monotonic `snapshot_id` | correctness + debug-ability |

---

## Tier 3 — Latent correctness (will bite eventually)

### F-29 [CQ] WebSocketHub broadcast cleanup races — `api/websocket_hub.py:103-108`
After `gather()`, cleanup re-acquires the lock per disconnected client. Two interleaved broadcasts can pop the same cid; `WSClient._connected` mutated outside the lock. Fix: single lock-guarded sweep, or delegate cleanup to `disconnect()` only (~12 LOC).

### F-30 [CQ] Chat user-message committed before AI call → orphan rows on AI failure — `routes_chat.py:382-393`
`db.commit()` before `_build_ai_response`. On Gemini hiccup, user_msg lives forever, no assistant_msg, no rollback, no idempotency key. Fix: defer commit until AI succeeds, OR add `status: "pending"|"answered"|"failed"` column (~40 LOC).

### F-31 [CQ] EventBus tasks dropped — `core/event_bus.py:36-42`
`asyncio.ensure_future(result)` without storing the task; CPython GC may collect mid-flight. Exception handlers run silently. Fix: `self._pending: set[asyncio.Task]` with `add_done_callback(self._pending.discard)` (~10 LOC).

### F-32 [ARCH/CQ] Single-writer race on `system.ai_provider` — `core/context_engine.py:429-431` vs `ai/provider.py:763-769`
Both reconcile `_ai_provider` independently every 500 ms; a UI snapshot can flicker between primary/fallback within a tick. Fix: AIRouter is the only writer; ContextEngine reads via getter (~15 LOC).

### F-33 [CQ] `decision_tree._can_initiate` mutates `_last_initiative_ts` on the *check* — `decision_tree.py:207-213`
Multiple per-tick callers compete; only the first passes; cooldown starts before the action is consumed. Fix: split into `_can_initiate()` (pure) and `_mark_initiated()` (called by consumer) (~8 LOC).

### F-34 [CQ] Provider classifier import error swallowed — `ai/provider.py:783-791`
`try / except Exception: pass` around `from ai.gemini_provider import _classify_gemini_error`. A bad import → quota cooler never trips → Gemini hammered at full rate forever. Fix: narrow to `ImportError` + `logger.exception` (~4 LOC).

### F-35 [ARCH] `_first_visit` is structurally broken — `state_machine.py:66-69`
Reads `where.place_known` which is never written anywhere. SENTINEL fires too eagerly on every "other" detection. Fix: write `place_known` from the geo subsystem when reverse-geocode hits a known location (~30 LOC + test).

### F-36 [CQ] WS chat handler swallows all exceptions opaquely — `routes_chat.py:683-688`
WS `error` event has no error code. Frontend can't classify retry-able vs auth issues. Fix: mirror REST classification (~25 LOC).

### F-37 [CQ] `_FFMPEG_BIN` resolved at import time only — `voice/stt_engine.py:51`
Operator installing ffmpeg post-boot keeps STT broken until restart. Fix: lazy resolution + 60 s cache (~6 LOC).

### F-38 [SEC] `apply_overrides` swallows validation errors — `config.py:442-456`
PUT response says "accepted", value silently rolled back. Fix: log at WARN with key+reason; surface in `skipped` list (~3 LOC).

### F-39 [CQ] `STTResult.engine` typing rot — `voice/stt_engine.py:66`
Comment says `"whisper"|"vosk"|"noop"`; actual values include `"whisper_npu"`, `"mms_npu"`. Frontend may switch incorrectly. Fix: `Literal[...]` typed field (~6 LOC).

### F-40 [SEC] `fs.write` workspace check uses `abspath` not `realpath` — `agent/actions/fs.py:92-128`
A pre-existing symlink lets the LLM clobber files outside the workspace. Fix: realpath both sides + reject any path component that's a symlink (~12 LOC).

### F-41 [SEC] `net.scan` ports mode allows arbitrary host string — `agent/actions/net.py:48-108`
Hostname bypasses IP validator (intentional). The operator's IP is a free port-scanner for the LLM; risk currently `SAFE`. Fix: bump to MEDIUM, RFC1918 default, log destination (~10 LOC).

### F-42 [CQ] `routes_settings` rollback failures swallowed — `routes_settings.py:670-678`
Bare `except: pass` around inner rollback. Fix: log at WARN (~3 LOC).

### F-43 [CQ] `_chunk_content` boundary not clamped — `routes_chat.py:517-531`
`config.chat_stream_chunk_chars` has no minimum; `chunk_size=2` produces half-syllable cuts. Fix: clamp `>=4` + multi-byte test (~5 LOC).

---

## Tier 4 — Architectural ceilings (Jarvis-grade refactors)

> Each work item is M-L; deferred to phase 16-19 unless explicitly listed. They cap *future* leverage even when current behaviour is acceptable.

- **F-44 [ARCH]** Layering inversions: `core/context_engine.py:331,362` imports `agent.localization`; `agent/runtime.py:265,283,398-405` imports `api.websocket_hub`. Fix: localization subscribes to `context_updated` and writes back via `context_engine.set_localization(...)`; agent emits to a domain bus that the API layer subscribes to.
- **F-45 [ARCH]** STT/TTS have no provider abstraction symmetric to AIProvider. Six voice files with overlapping responsibilities. Fix: `voice/_provider.py` ABC with `transcribe`, `health`, `warmup`.
- **F-46 [ARCH]** Voice WS lives outside the multiplexer (`api/routes_voice_stream.py` registers its own `/ws/voice` endpoint). Fix: route through `WebSocketHub` once subscriptions land (F-19).
- **F-47 [ARCH]** State machine truncated vs `STATE_MACHINE.md` (9 of 16 transitions implemented); SHADOW→DIALOGUE on voice/touch missing. OPERATOR is undocumented in spec but exists in code.
- **F-48 [ARCH]** Hardcoded personality + state behaviours — `ai/personality.py:12,111`, `agent/proactive.py:86,93`, `agent/runtime.py:614`. Fix: lift to a `personality/*.md` directory, hot-reloadable from settings UI.
- **F-49 [ARCH]** DecisionTree thresholds are magic numbers — `decision_tree.py:103,111,128,167` (`stress > 0.7`, `bpm > 28`, `aqi > 150`). Direct CLAUDE.md commandment #8 violation. Fix: promote to Settings keys with validators (~15 LOC + auto UI).
- **F-50 [ARCH]** Memory write-only from chat — `routes_chat.py:441-459` writes `TemporalAnchor`s; nothing reads them. Same for `LocationHistory`. Lands inside Phase 16 (Block C).
- **F-51 [ARCH]** Provider-specific knowledge in router — `ai/provider.py:772-795` hard-codes `if provider_name == "gemini"`. Fix: `AIProvider.classify_error()` ABC method.
- **F-52 [ARCH]** `call_with_tools` not on the AIProvider ABC — `ai/provider.py:486-491` `hasattr(...)`. Fix: lift to abstract method, default raises `NotImplementedError`.
- **F-53 [ARCH]** Prompt is string concatenation, not structured object — `prompt_builder.py:214-314`. Productisation needs A/B testing. Fix: `PromptSection` dataclass + audit log of active sections per turn.
- **F-54 [ARCH/CQ]** Two duplicated chat-send pipelines (REST `send_message` + WS `_ws_chat_handler`) — drift already visible. Fix: `ChatService` class, two thin transport adapters (~120 LOC reduction).
- **F-55 [CQ]** `useVoiceAlwaysOn.ts` is 799 LOC. Decompose into `useVoiceWebsocket`, `useMicCapture`, `useDuckingPolicy`, `useAlwaysOnConfig`.
- **F-56 [CQ]** 115 broad `except Exception` blocks. Pattern: `swallow_for_telemetry(label)` context manager that logs at WARN + increments a metric.

---

## Tier 5 — Defence-in-depth & cleanups

- **F-57 [SEC]** Stale deps: `python-jose==3.3.0` (alg-confusion risk if HS/RS keys ever mix; dormant), `passlib==1.7.4` (dormant). Migrate to `pyjwt` + use `bcrypt` directly.
- **F-58 [SEC]** Net subprocess (`net.scan` basic-mode `ping`, `notify.send`, `mcp/adapter.py:65`) bypasses the firejail wrapper. Route every subprocess through `safety/sandbox.py`.
- **F-59 [SEC/PERF]** `chroma_data/chroma.sqlite3` and `db/phantom.db` tracked in git. Embedding DB carries user content. Fix: `git rm --cached`, add to `.gitignore` (~3 LOC).
- **F-60 [PERF]** `collection.count()` called on every chroma query (`memory/strategic_memory.py:98`). 60 s TTL cache (~10 LOC).
- **F-61 [PERF]** Defensive Python re-filter for leaked test fixtures (`memory/strategic_memory.py:113-130`). Clean prod DB once, drop band-aid.
- **F-62 [PERF]** `_peak_energy_normalised` allocates numpy per frame (`always_on.py:90-107`). Replace with `audioop.max(pcm_bytes, 2)/32768.0`.
- **F-63 [PERF]** Voice preload serial with agent setup (`main.py:198-339`). Parallelise — −2-4 s startup.
- **F-64 [PERF]** `session_memory._sessions` dict unbounded across sessions. LRU cap 50.
- **F-65 [PERF]** Wardriving has no row TTL. Daily growth on a moving Radxa.
- **F-66 [CQ]** JSON parse swallowed in `routes_chat.py:73-94` (`meta`, `attachments`). Same in `routes_auth.py:38-47`. Add `logger.warning`.
- **F-67 [CQ]** `_warm_whisper` reaches into `provider._model.transcribe`. Move warmup onto the (future) STTProvider ABC (F-45).
- **F-68 [CQ]** Bundle path resolver duplicated 3 ways across `whisper_npu_provider.py`, `mms_npu_provider.py`, `stt_engine.py`. Extract `voice/_paths.py`.
- **F-69 [CQ]** GHOST is a one-way door (only `_ghost_trigger` exits, and it's broken). Add `force_transition(SHADOW, "manual_ghost_exit")` route.

---

## Block B execution plan (≤30-LOC quick-wins)

Picks below are the items where every gate is ≤30 LOC, has a clear regression test seam, and lands one or more punch-list IDs. Group into 4 atomic commits.

### Commit B-1 — `quick-wins: snapshot fields + idle clock` (≈25 LOC)
- F-04: GHOST snap fields — encoder + buttons in `_apply_batch` + `_empty_snapshot`.
- F-05: `_last_interaction_ts` initialised to `monotonic() - ai_initiative_cooldown_s`.
- Test: `tests/test_phase_audit_quickwins_brain.py` exercising both.

### Commit B-2 — `quick-wins: security gates` (≈40 LOC)
- F-08: `Depends(require_auth)` on `/voice/{stt,tts,status}`.
- F-09: `Depends(require_root)` on settings router GET / `_value` / export.
- F-10c: `agent_risk_tolerance` default `5 → 3` + env scrubbing in `bash.run`.
- F-12: CORS explicit method/header allow-list.
- Tests: 401/403 for unauth voice + settings; ensure ROOT still works.

### Commit B-3 — `quick-wins: hardening + observability` (≈45 LOC)
- F-13: security headers middleware.
- F-16: centralised exception handler (`{"error_code": ...}`), kills `str(exc)` echoes.
- F-34: narrow provider-classifier `except` to `ImportError` + log.
- F-38: `apply_overrides` validation logging.
- F-42: settings rollback logging.
- F-66: chat metadata JSON warning.
- Test: exception-handler emits opaque code; settings PUT echoes `skipped`.

### Commit B-4 — `quick-wins: voice + perf hot-spots` (≈55 LOC)
- F-25: NPU/MMS empty-result re-raise OR `engine_error` field; reset wedged provider.
- F-37: `_FFMPEG_BIN` lazy resolution.
- F-39: `STTResult.engine` Literal type.
- F-43: `chunk_size` lower clamp.
- F-62: `_peak_energy_normalised` `audioop` rewrite.
- F-31: EventBus task-set tracking.
- Tests: NPU forced-error test, ffmpeg lazy re-resolve, energy parity, EventBus task ref-count.

### Commit B-5 (deferred to Block B+)  — `quick-wins: chroma janitor` (≈30 LOC)
- F-17 partial: scan `chroma_data/` against `list_collections()`, log + delete orphans on lifespan startup; gated behind a `chroma_janitor_enabled` setting (default true on dev, opt-in prod).
- F-60: `count()` 60 s TTL cache.
- Test: with synthesised orphan dirs, lifespan reduces to expected count.

Heavier wins (F-22 short-MMS bundle, F-19 WS subscriptions, F-23 batched VAD, F-32 ai_provider single-writer, F-30 chat commit ordering, F-29 hub broadcast race) live in the Phase 18 perf hardening block — they need >30 LOC or design changes and are owned by Block E.

---

## Cross-cutting follow-ups (Block E or later)

1. **Concurrency map** (`docs/CONCURRENCY.md`): codify which paths run async vs threaded vs sync; every `to_thread` site should have a comment justifying it. Useful before F-23 batched VAD lands.
2. **`swallow_for_telemetry(label)` context manager** (F-56): replace 115 broad `except Exception` blocks across api/ai/core/voice. Each label increments a Prom counter.
3. **`ChatService` class** (F-54): collapse REST + WS chat send pipelines.
4. **`PromptSection` dataclass** (F-53): A/B-able prompt assembly.
5. **`STTProvider` ABC** (F-45): symmetry with `AIProvider`; preconditions for F-46 voice WS unification.
6. **`personality/` directory** (F-48): hot-reloadable identity + state behaviours; the architectural seam where "secret features" can hide cleanly.

---

## Things confirmed safe (one-liners — do not waste cycles re-verifying)

- `.env` gitignored, no secrets in git history (`git check-ignore` + `git ls-files`).
- No raw SQL string-formatting in production; SQLAlchemy ORM throughout.
- No `eval`/`exec`/`os.system`/`shell=True` in non-test code.
- PIN/RFID storage uses bcrypt with per-credential salt.
- Settings PUT correctly redacts `ai_gemini_api_key` and `jwt_secret_key`.
- `genai.Client` constructed with API key as kwarg, not URL param.
- `bash.run` enforces 120 s timeout + 16 KiB output cap.
- AIProvider ABC + AIRouter cooling/quota/backoff is the strongest layer in the codebase.
- WebSocketHub multiplexer shape is correct (broadcast + scoped + auth-on-connect).
- Voice frame hot-path correctly uses `to_thread` for every blocking C++ call.
- STT singletons are warmed at lifespan; no model reload per request (other than F-26 KaldiRecognizer).

## Spec-vs-reality gaps (informational)

CLAUDE.md describes modules that do not exist in the shipping code; the code path lives elsewhere:
- `linux/executor.py`, `linux/dangerous_patterns.py`, `linux/resource_monitor.py` — not implemented; `routes_linux.py` returns 501. Real executor is `agent/actions/bash.py` + `agent/safety/sandbox.py` (see F-10).
- `security/crypto.py` AES-256 for GHOST sealed records — not implemented; `is_sealed` is a SQL-side filter only; sealed facts are plaintext in SQLite + ChromaDB.
- `voice/wake_word.py` — file absent; wake matching lives in `voice/wake_spotter.py` + always-on orchestrator.

Closing these requires their own audit pass.
