# Architecture Audit — 2026-04-28

Reviewer: architect-review subagent. Scope: read-only. Conventions: `file:line` cites; severities P0 (rot blocking productisation / CLAUDE.md violation), P1 (1–2-phase refactor pain), P2 (future-proofing).

---

## ContextEngine purity check

**Verdict: leaky and partially bypassed.** ContextEngine is built like a snapshot accumulator (good) but it has accreted non-context responsibilities and is also routinely bypassed by the agent layer.

- **Bypass #1 — Agent prompt assembly reads SelfModel/emotion directly, not via ContextEngine.** `src/backend/api/routes_chat.py:188-201` and `src/backend/ai/prompt_builder.py:117-154` synthesise an "INNER STATE" block by reaching into `agent_runtime.foreground_slot.self_model.emotion`. ContextEngine has no `inner_state` / `emotion` slot. Per CLAUDE.md "ContextEngine — центральний для ВСІХ рішень", emotion should be a first-class snapshot field.
- **Bypass #2 — Localization side-effects.** `ContextEngine.resolve_localization()` (`src/backend/core/context_engine.py:353-402`) does network I/O (`agent.localization.get_resolver`, Overpass) inside the engine, and `_refresh_nearby` (`context_engine.py:316-351`) calls Overpass directly. ContextEngine should _consume_ resolved estimates via subscribers; instead it _drives_ them. This couples a "snapshot builder" to outbound HTTP and to the agent package. It's also why nearby OSM data is cached in `_nearby_cache_*` instance state on the engine (lines 159-161) instead of in a dedicated localization service.
- **Bypass #3 — DecisionTree's outputs go nowhere.** `core/decision_tree.py:40-73` enqueues actions and emits `decision_action` via the EventBus, but **no subscriber for `decision_action` exists anywhere in the codebase** (grep `event_bus.subscribe` returns zero hits — see "Layering" section). DecisionTree is wired in `main.py:83` (`decision_tree.evaluate(snapshot)`) but the result is discarded. The only effect that DOES land is `has_pending_initiative()` polling (`core/state_machine.py:275`). So the central decision pipeline `Sensors → ContextEngine → DecisionTree → Action|Memory` is broken at the third arrow.
- **Direct StateMachine evaluation in main.py.** `main.py:66-83` and `main.py:101-110` call `state_machine.evaluate(snapshot)` directly from two parallel sites (tick loop and serial-bridge callback) — DRY violation that has already drifted (the OLED hook is duplicated, lines 78-82 vs 112-116).
- **Provider sync split-brain.** `_update_system` reconciles `self._ai_provider` with `config.ai_primary_provider` every 500ms (`context_engine.py:429-431`), AND `AIRouter._sync_context` writes the active responder after each call (`ai/provider.py:763-769`). The two writers race; the comment at `context_engine.py:425-428` admits "the next tick converges back". A live snapshot that flickers between primary and fallback within 500ms is a bug surface, not a feature.

## Layering & coupling

The `core/ai/agent/api/voice/sensors/memory` split looks clean on paper but the imports tell a different story.

- **Core depends on agent.** `core/context_engine.py:331` and `:362` `from agent.localization` — core knows about the agent package. CLAUDE.md's commandment is the inverse: agent is built on top of core.
- **Agent depends on api/websocket_hub.** `agent/runtime.py:265-269,283-285,398-405,943-950` and `agent/proactive.py:248-253,362-368,397-405,641-643` import `api.websocket_hub.hub` directly. Agent is supposed to be domain logic; instead every lifecycle event travels through a hard-import to a transport singleton. There is no `agent.events` or `agent.bus` abstraction over which the API layer can subscribe.
- **EventBus underused. Only emitters, no subscribers.** `grep event_bus.subscribe` returns zero matches. Emissions are at `core/context_engine.py:179,192`, `core/state_machine.py:297`, `core/decision_tree.py:70`, `sensors/serial_bridge.py:202`. So the EventBus exists, sinks every event into a `dict` (`core/event_bus.py:18`), and nobody listens. Every cross-module reaction is implemented via direct imports inside the originating function (e.g., `main.py:79-82`, `routes_chat.py:328-348`). This is a P0-level architectural rot for a "stateful living surface" goal — the system has no broadcast spine.
- **ChromaDB importing inside chat path.** `routes_chat.py:161,189` does `from memory.strategic_memory import ...` inside the function (correct for cycle avoidance) — but the deeper problem is `agent/runtime.py:849`, `agent/proactive.py:546`, `routes_chat.py:189` and `prompt_builder.py:94` all reach across packages with `try/except` import guards rather than depending on a stable façade.
- **Configuration is a god-object.** `config.py` is consumed via `from config import config` in 30+ files; settings keys like `agent_proactive_enabled`, `agent_max_llm_calls_per_background_task`, `voice_stt_mode`, `ai_initiative_cooldown_s` all live on the same Pydantic settings model. No grouping (Settings.AI, Settings.Voice, Settings.Agent), no validators surfacing as typed objects.

## Provider abstractions (AI / STT / TTS)

The AI provider abstraction is real and respectable; STT/TTS abstractions are skeletal and asymmetric.

- **AIProvider is the strongest layer in the codebase.** `ai/provider.py:64-95` defines a clean ABC with `generate / generate_stream / health_check`; `AIRouter` (lines 100-769) implements cooling, quota, backoff, audit. The `BlockedQuotaError` signal exception (line 37) is propagated honestly into the agent loop (`agent/loop.py:175,251,471`). This is one of the few places in the system that genuinely embodies the "transparent fallback" CLAUDE.md commandment.
- **But provider-specific knowledge leaked into the router.** `ai/provider.py:772-795` — `_classify_provider_exception` does `if provider_name == "gemini":` ... `elif "ollama":`. Adding a third provider (Anthropic, vLLM, NPU-local) requires editing the router. Should be a method on `AIProvider` (e.g., `classify_error(exc) -> ToolErrorKind`) with default impl in the base class. P1.
- **`call_with_tools` is provider-method, not router-method.** `ai/provider.py:486-491` — `if provider is None or not hasattr(provider, "call_with_tools")` — this is duck-typing in an ABC-based design. `call_with_tools` should be on the abstract base. Otherwise tool-use is a second-class capability that providers can silently lack, which directly contradicts the Jarvis ambition (every provider must agent).
- **STT abstraction is fragmented.** `voice/stt_engine.py`, `voice/whisper_npu_provider.py`, `voice/mms_npu_provider.py`, `voice/streaming_recognizer.py`, `voice/wake_spotter.py`, `voice/vad.py` — six files with overlapping responsibilities and no `STTProvider` ABC analogous to `AIProvider`. The promised "faster-whisper → Vosk fallback" (CLAUDE.md commandment #5) is implemented via `voice/pipeline.py` orchestration rather than as a polymorphic engine list. P1: no symmetry with AIProvider.
- **TTS has no abstraction at all.** `voice/tts_engine.py` is a single file; if you want piper or elevenlabs alongside StyleTTS2 (which the productisation push hints at), there's no seam to extend.

## State machine fidelity

- **Truncated transitions vs. STATE_MACHINE.md.** The doc lists 16 transitions; `core/state_machine.py:116-189` implements ~9. Missing: SHADOW→DIALOGUE on voice/touch (state machine relies on external `force_transition` from chat handlers — but `routes_chat.py` never calls `force_transition`); FOCUS→DIALOGUE on voice (only `ai_initiative` is wired, line 162); SENTINEL→DIALOGUE on user_acknowledges_threat; DREAM→DIALOGUE on whisper detection; SHADOW/FOCUS→SENTINEL via `_threat_detected` IS wired (line 147) but the spec says the trigger is `(first_visit OR night_time)` — `_threat_detected` (line 100-102) requires `_other_detected AND (first_visit OR is_night)` which is fine, but `_first_visit` (lines 66-69) uses `where.get("first_visit", False) or not where.get("place_known", True)` — `place_known` is never set anywhere I can find (no writer for it). So in practice the SENTINEL trigger always fires when an "other" is detected, regardless of whether the place is known. P1 correctness gap.
- **OPERATOR is a bolt-on, not in the documented FSM.** `state_machine.py:25-27` adds OPERATOR to the alphabet; STATE_MACHINE.md doesn't list it. `enter_operator/exit_operator` (lines 238-249) and `_pre_operator_state` (line 210) implement push/pop semantics — fine — but the doc and the code disagree. Documentation drift is a productisation hazard.
- **GHOST trigger is dead code.** `_ghost_trigger` (`state_machine.py:105-111`) reads `snap.get("encoder")` and `snap.get("buttons")` from the snapshot. **Neither field is ever populated** (`context_engine.py:_empty_snapshot` lines 59-134 has no `encoder` or `buttons` keys). The secret-feature CLAUDE.md commandment #6 is therefore broken at the data-source level, not at the FSM level. P0 if the secret feature is supposed to ship.
- **No transition validity table at runtime.** `_apply` (line 289) accepts any `to_state`; there's no `ALLOWED_TRANSITIONS[from] -> set(to)` enforcement. A malformed `force_transition("STATE_THAT_NEVER_EXISTED")` would land. Pydantic Literal on `StateTransition.to_state` would close this in 5 lines.
- **`previous` semantics are subtle.** State machine tracks `_previous` for `DIALOGUE → FOCUS|SHADOW` decisions (line 168). `enter_operator` saves `_pre_operator_state` separately to avoid clobbering (line 210 comment is correct). But `force_transition` updates `_previous` like any other transition (line 294), which means a user-initiated `DIALOGUE → SETTINGS` route via OPERATOR would corrupt the conversation-end target. Fragile and undocumented.

## Frontend ↔ backend contract

- **The FSM IS a real UI driver, not a label.** `frontend/src/app/App.tsx:27-35` maps each `SystemState` to a distinct lazy-loaded layout; `App.tsx:41` writes `data-state` attribute for CSS hooks; `AnimatePresence mode="wait"` (line 56) ensures full layout swap. So the SHADOW/FOCUS/DIALOGUE/SENTINEL/GHOST/DREAM/OPERATOR layouts are real surfaces. Good.
- **But the layouts are reading the same `context.when.time` / `context.env.temp_c` / etc.** `ShadowLayout.tsx:14-17` is representative — every layout pulls from `useSystemStore.context`. There's no per-state derived data shape; layouts are thin "render this snapshot differently" branches. For Jarvis ambition, each state should _change what data is collected and how_; right now they only change presentation. P2.
- **WebSocket hub is a true multiplexer.** `api/websocket_hub.py:81-82,86-101,109-138` — a single channel field routes to handlers; broadcast can scope by `user_id`. This is correct multiplexer shape. **One handler is registered** (`routes_chat.py:692-694`); the rest of the system is broadcast-only. So inbound RPC over WS is currently chat-only, while every other feature uses REST. That's fine but it caps the "living surface" ambition: e.g., the frontend can't subscribe to `agent.stream` and reply with `intervene` in-band — it has to POST `/agent/intervene` over REST. P1 for a cohesive product.
- **Voice WS lives outside the hub.** `api/routes_voice_stream.py` registers a separate `/ws/voice` endpoint (called from `main.py:450`). So PHANTOM has _two_ WebSocket transports, with different conventions. The "central WebSocket multiplexer" promise of CLAUDE.md is partially broken. P1.
- **`agent.stream` and `background_events` are two channels for the same concept.** `agent/runtime.py:269,284` — foreground events go to `agent.stream`, background events to `background_events`. This is actually a defensible split (UI doesn't want to render bg planner spam), but the channel naming is inconsistent (`agent.stream` is dotted, `background_events` is snake) and there's no schema doc.
- **Frontend stores: 11 of them, no clear orchestration.** `frontend/src/stores/`: `agentStore`, `authStore`, `chatStore`, `faceStore`, `inputModeStore`, `mapStore`, `oledStore`, `settingsStore`, `systemStore`, `uiStore`, `voiceAlwaysOnStatusStore`. Each is a Zustand singleton with its own subscribers. There's no derived/computed layer (à la `subscribeWithSelector` cross-store derivations); the FSM in `systemStore` doesn't influence `chatStore` or `agentStore` shape. So cross-cutting state (e.g., "is voice listening AND agent thinking AND in DIALOGUE → suppress map polling") has to be hand-wired in components. P2.

## Ceiling-capping choices (Jarvis-ambition lens)

Things that work today but will block the leap to a self-aware autonomous OS:

1. **Hardcoded prompts in code.** `ai/personality.py:12` (PHANTOM_IDENTITY string), `ai/personality.py:111` (STATE_BEHAVIORS dict), `agent/proactive.py:86-138` (`_DECIDE_SYSTEM` and `_DECIDE_TEMPLATE`), `agent/runtime.py:614` (probe prompt `"Reply with one word: OK."`). Every personality knob is a Python literal. Personality cannot evolve over time without editing source. The `config.ai_system_prompt_extra` knob (`prompt_builder.py:298-299`) is appended last — so it's an _override_ but the core identity is frozen. Productisation will demand per-user / per-mood / time-evolving identity; current architecture cannot do it without a refactor. **P0** for Jarvis ambition.
2. **Two parallel decision systems.** `core/decision_tree.py` (priority-based, rule-driven, runs every 500ms in `main.py:83`) AND `agent/proactive.py:_DECIDE_TEMPLATE` (LLM-driven, runs every 30-300s) are both in the codebase and **do not communicate**. DecisionTree's `consume_initiative()` (line 78-87) is never called. ProactiveLoop builds its own context (`agent/proactive.py:494-521`) ignoring DecisionTree's pending actions. So PHANTOM has two minds, both half-broken. **P0**.
3. **Chat is single-shot non-tool, even though tool-use exists.** `routes_chat.py:226-231` calls `ai_router.generate(...)` not `call_with_tools(...)`. `ai/chat_tools.py:18-200` defines a real CHAT_DATA_TOOLS catalog (search_locationhistory, query_temporal_anchors, recall_memory_facts, etc.) AND `ai/personality.py:86` defines `DATA_TOOLS_GUIDANCE` that's appended to the prompt (line 307 in prompt_builder). So we tell the LLM "here are tools you can call" but never actually pass `tools=` in the API call. The LLM's tool calls go nowhere. The prior 2026-04-22 audit identified this exact gap and ranked it #2 root cause; it remains unfixed. **P0** for Jarvis ambition — this is the single biggest leverage point.
4. **No agent loop entered from chat.** `routes_chat.py` always exits after one LLM call. Compare with `agent/loop.py` (a real ReAct + Reflect loop, 747 lines). A user message that needs multi-step reasoning ("plan my afternoon and book the dentist") has no path that engages the agent loop. The connection exists in theory (`agent_runtime.start_task("user goal")`) but is exposed only via `/api/v1/agent/...` REST routes, not via `/chat/message`. So chat is forever a single-turn completion while the agent capability sits in the next room. **P0**.
5. **EventBus has no subscribers, so cross-context reaction is impossible.** Concrete missing reactivity:
   - SHADOW→FOCUS transition does NOT trigger a memory recall about "last FOCUS session";
   - `decision_tree.has_pending_initiative()` does NOT trigger a chat session creation;
   - `state_machine.evaluate` is the only subscriber-shaped consumer, but it's a polled call from main.py, not a subscription.
   The infrastructure (`core/event_bus.py`) is there. The wiring is not. **P0**.
6. **DecisionTree rule set is hardcoded thresholds.** `decision_tree.py:103,111,128,167` — `stress > 0.7`, `bpm > 28`, `aqi > 150`, `idle_s > cooldown` — all magic numbers in code. None of these are settings; CLAUDE.md commandment #8 says "Всі конфіги — з UI". **P1** — direct CLAUDE.md non-negotiable violation.
7. **Memory is write-only from chat's view.** `routes_chat.py:441-459` writes a `TemporalAnchor` every chat turn; nothing reads them back into prompts (confirmed by prior audit, still true). Same for `LocationHistory`. The system collects rich autobiographical data and never feeds it to the AI. **P1**.
8. **Personality has 3 axes (biosignal/trust/time) but cannot mutate over time.** `ai/personality.py:calculate_tone` is pure-function. `BehavioralModel.trust_level` does evolve (`AI_INTEGRATION.md:233-257`), but identity tokens (PHANTOM_IDENTITY) and state behaviors are frozen. There's no `personality_evolution.py` or "yesterday I was tired, today I'm sharper" mechanism. **P2**.
9. **No "self-aware" introspection surface.** Inner monologue exists (`agent/monologue_emitter.py` referenced in `loop.py:285,492`), but nothing aggregates "what did I think about today" into a consumable summary the AI can read at the start of the next session. The `SelfModel` is per-task; it dies with the task. **P2**.
10. **Prompt is a string concatenation, not a structured object.** `prompt_builder.py:214-314` does `parts: list[str]; parts.append(...)`. There's no `PromptSection` class, no per-section gating, no diff/audit log of "which sections were active for this turn". Productisation will need this for A/B testing prompt strategies. **P2**.

---

## Ranked findings

### P0 (architectural rot / CLAUDE.md violation)

1. **Chat does not use tool-use.** `api/routes_chat.py:226` calls `ai_router.generate(...)` instead of `call_with_tools(...)`, despite `ai/chat_tools.py:18` defining the catalog and `ai/personality.py:86` advertising the tools to the LLM. **Effort: M.**
2. **EventBus has emitters but no subscribers.** `core/event_bus.py:31` is wired, `core/context_engine.py:179`, `core/state_machine.py:297`, `core/decision_tree.py:70` emit; `grep -rn 'event_bus.subscribe'` returns zero hits. The "central pub/sub spine" is dead. **Effort: M.**
3. **DecisionTree output is discarded.** `core/decision_tree.py:78-87` `consume_initiative()` is grepped to zero callers. The autonomous decision pipeline is broken at the third arrow of `Sensors → ContextEngine → DecisionTree → Action|Memory`. **Effort: M.**
4. **Two parallel autonomous-decision systems that don't talk.** `core/decision_tree.py` (rule-based, 500ms cadence) and `agent/proactive.py:_DECIDE_TEMPLATE` (LLM, 30-300s cadence) both exist; ProactiveLoop ignores DecisionTree. **Effort: L.**
5. **GHOST trigger is dead code.** `core/state_machine.py:105-111` reads `snap.get("encoder")` and `snap.get("buttons")`; `core/context_engine.py:59-134` `_empty_snapshot` never populates these keys. **Effort: S.**
6. **Hardcoded magic numbers in DecisionTree** (`decision_tree.py:103,111,128,167` — `0.7`, `28`, `150`, etc.) violate CLAUDE.md commandment #8 ("Всі конфіги — з UI"). **Effort: S.**
7. **Hardcoded personality / state behaviors** (`ai/personality.py:12,111`, `agent/proactive.py:86,93`) prevent evolution. **Effort: M.**
8. **Layering inversions.** `core/context_engine.py:331,362` imports `agent.localization`; `agent/runtime.py:265,283,398-405` imports `api.websocket_hub`. **Effort: L.**

### P1 (refactor pain within 1–2 phases)

9. **AIProvider classifier leak.** `ai/provider.py:772-795` `_classify_provider_exception` switches on provider name. **Effort: S.**
10. **`call_with_tools` not on the AIProvider ABC.** `ai/provider.py:490` `hasattr(provider, "call_with_tools")`. **Effort: S.**
11. **STT/TTS have no provider abstraction symmetric to AIProvider.** **Effort: M.**
12. **Voice WS lives outside the multiplexer.** `api/routes_voice_stream.py` is wired in `main.py:450` as a separate `/ws/voice` endpoint. **Effort: M.**
13. **State-machine FSM truncated vs spec.** `STATE_MACHINE.md` lists 16 transitions; `core/state_machine.py:_get_candidates` (lines 116-189) implements ~9. **Effort: M.**
14. **`_first_visit` is structurally broken.** `core/state_machine.py:66-69` reads `where.place_known` which is never set anywhere. SENTINEL fires too eagerly. **Effort: S.**
15. **OPERATOR state is undocumented.** `core/state_machine.py:25-27` adds it; `STATE_MACHINE.md` doesn't list it. **Effort: S** (just doc), or **M** (code+spec).
16. **Memory is write-only from chat.** `routes_chat.py:441-459` writes `TemporalAnchor`s; nothing reads them. Identical for `LocationHistory`. **Effort: M.**
17. **Single-writer race on `system.ai_provider`.** `core/context_engine.py:429-431` reconciles every 500ms; `ai/provider.py:763-769` writes after each call. **Effort: S.**
18. **Duplicated `state_machine.evaluate` + OLED hook in main.py.** `main.py:66-83` (tick path) and `main.py:101-117` (serial path) are almost-copies. **Effort: S.**

### P2 (future-proofing)

19. **Frontend layouts only swap presentation, not data shape.** **Effort: M.**
20. **Prompt is a list of strings, not a structured object.** **Effort: M.**

---

## Top-3 recommended structural moves (highest leverage)

### 1. Make chat agentic — wire `call_with_tools` into `routes_chat.py`. (P0 #1, P0 #4 partially) — Effort: M, ~3 days

The single highest-leverage change. The infrastructure is 90% built:

- `ai/chat_tools.py:18` defines `CHAT_DATA_TOOLS` (search_locationhistory, query_temporal_anchors, recall_memory_facts).
- `ai/tool_use.py` and `ai/tool_executor.py` exist and are battle-tested by the agent planner (`agent/planner/tactical.py:394`).
- `ai_router.call_with_tools` (`ai/provider.py:384-636`) has the resilience policy.

What's missing: in `routes_chat.py:_build_ai_response` (line 140), replace `ai_router.generate(...)` (line 226) with a `while not done: outcome = await ai_router.call_with_tools(tools=CHAT_DATA_TOOLS, ...); dispatch_chat_tool(outcome); break_when_response_form_emitted(...)`. Pattern is mirrored from `agent/planner/tactical.py:394-440`.

After this move, "де я був вчора?" stops being "не знаю" and becomes a `search_locationhistory(hours_ago=24)` tool call. This is the qualitative leap from passive AI to agent.

### 2. Activate the EventBus — switch cross-module reactions from direct imports to subscriptions. (P0 #2, P0 #3, P0 #8) — Effort: M, ~2-3 days

Concrete plan:

- `main.py:_context_loop` and `_start_serial_bridge` stop calling `state_machine.evaluate` and `decision_tree.evaluate` directly. Instead, `event_bus.subscribe("context_updated", state_machine.evaluate); event_bus.subscribe("context_updated", decision_tree.evaluate)`.
- `event_bus.subscribe("state_changed", broadcast_state)` where `broadcast_state` is a thin function in `api/websocket_hub.py`.
- `event_bus.subscribe("decision_action", action_dispatcher)` where `action_dispatcher` lives in a new `core/action_dispatcher.py`. Routes `kind="ai_speak"` to the proactive loop, `kind="actuator"` to `sensors/command_sender.py`, `kind="alert"` to a UI broadcast.
- `core.context_engine` stops importing `agent.localization`. Instead, `agent.localization.lifecycle.wire_default_sources` subscribes to `context_updated` and writes `where.source/confidence/accuracy_m` via a new `context_engine.set_localization(estimate)` method.

### 3. Lift personality, identity, and decision rules into hot-reloadable config. (P0 #6, P0 #7, P1 #20) — Effort: M, ~2 days

- Move `PHANTOM_IDENTITY`, `STATE_BEHAVIORS`, `_DECIDE_TEMPLATE` from Python literals to a `personality/` directory with markdown / YAML files. Settings UI loads, edits, hot-reloads.
- Promote DecisionTree thresholds (`stress > 0.7`, `bpm > 28`, `aqi > 150`, `idle_s > cooldown`) to Settings keys.
- Add a `PersonalityVersion` row in DB; let the SelfModel evolve identity over time.
