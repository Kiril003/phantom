# Day-2 Architecture Audit — 2026-04-29

Read-only review at HEAD `111181e` (branch `autonomous-run`). Day-1 baseline: `docs/audit-2026-04-28/FINDINGS.md`.

Scope of this pass: pre-implementation guidance for F-01 / F-02+F-03 / F-44, regression check on Phase 16 / 17a / 18 wiring, and any additional architectural smells introduced or surfaced. Severities: P0 must-fix-before-next-block, P1 important, P2 lift-when-cheap.

---

## F-01 chat tool-use wiring — implementation plan

### State of play (before writing the new path)

There is a **second tool-use code path that the audit's F-01 description does not name**: `ai/gemini_provider.py:14,194-298` already imports `tool_executor.execute_tool` and runs a **provider-internal** chat-tool loop driven by `CHAT_DATA_TOOLS`. It triggers when `generate(..., user_id=<set>)` and is bounded by `MAX_TOOL_CALLS_PER_TURN=3` (`ai/tool_executor.py:39`). Routes call `ai_router.generate(... user_id=user.id)` (`api/routes_chat.py:262-267`), so the chain user_id → gemini_provider → execute_tool **is live for Gemini**. This is critical context: F-01 is not "no tool use anywhere," it is "no tool use at the router seam, and the only working version is Gemini-only and bypasses the router's resilience policy." `OllamaProvider` has no equivalent loop.

There is also a brand-new dispatcher: `ai/chat_tool_dispatcher.py` (Phase 17a). It is entirely separate from `ai/tool_executor.py` (Phase 10) and **registers a different set of handlers** for the same tool names (`search_locationhistory`, `query_temporal_anchors`, `recall_memory_facts`, `get_system_metrics`, `get_sensor_status`). The two implementations have already drifted in subtle ways (limit values, return shapes, time windows). See "Other findings" D-04 below.

### Cleanest seam — three options

| Option | Where the loop lives | Pros | Cons |
|---|---|---|---|
| A. Loop in `routes_chat._build_ai_response`, call `ai_router.call_with_tools` per iteration | route layer | keeps router stateless per call; uniform across providers; `tool_config_mode` is a route-level concern | route file already 850+ LOC; another nested loop bloats it |
| B. New `ai/chat_pipeline.py` runs the loop, both REST + WS chat call into it | dedicated module | DRY for the F-54 follow-up; clean unit-test seam; isolates security policy (F-11 cap, search_web injection guard) | one more module; one more lifecycle question (singleton vs functional?) |
| C. Lift the loop onto `AIProvider.call_with_tools_chat()` ABC | provider layer | symmetric across Gemini / Ollama; reuses existing AIRouter retry/cooling | the loop is 80% provider-agnostic — pushing it down duplicates orchestration; Ollama implementation has to grow |

**Recommendation: B, with the loop in `ai/chat_pipeline.py`.** Reasons:

1. The `_build_ai_response` body in `routes_chat.py:176-334` is already a multi-stage pipeline (snapshot → memory hints → recent places → emotion → user dict → prompt → history → generate → log → trust → fact-extract). Adding a multi-iteration tool loop inside it crosses the "one screenful of intent" line.
2. The eventual F-54 ChatService refactor will collapse `routes_chat.send_message` and `_ws_chat_handler` (`routes_chat.py:612-766`) — both pipelines must call the same tool loop. A free function in `ai/chat_pipeline.py` is the obvious shared callable.
3. Putting the loop on an ABC method (option C) duplicates the retry/cooling/budget machinery already in `AIRouter.call_with_tools` (`ai/provider.py:384-636`). Better to call **into** that method per iteration.

### Concrete shape

```
# ai/chat_pipeline.py  (new ~150 LOC)

async def chat_with_tools(
    *, user_message, system_prompt, history,
    user_id, db, max_iterations=3,
    tool_config_mode="AUTO",  # "AUTO" for chat, "ANY" for tactical
) -> AIResponse:
    """
    Multi-iteration tool-use loop. Each iteration calls
    ai_router.call_with_tools(...) with mode=AUTO so the model is
    NOT forced to emit a function_call (greetings stay textual).
    
    Termination:
      - model returns text-only         → wrap as AIResponse(text), return
      - model returns response_form fn  → finalize via parse_function_call
      - model returns data tool         → dispatch via chat_tool_dispatcher,
                                          append tool_response, loop
      - iterations == max_iterations    → force-final call WITHOUT data tools
      - any ToolUseError                → bubble to caller (let routes_chat
                                          turn it into the existing 503)
    """
```

The loop calls `chat_tool_dispatcher.dispatch(...)` (Phase 17a) — **NOT** the older `tool_executor.execute_tool` — so the new dispatcher becomes the single source of truth and the old executor can be sunsetted in a follow-up commit. This kills D-04 below.

### `tool_config_mode` — where to thread it

There are two consumers and they want **opposite defaults**:

| Caller | Mode | Reason |
|---|---|---|
| `routes_chat` (chat path) | `"AUTO"` | greetings, small-talk, "так"/"ні" must stay plain text — `"ANY"` would force a function call on every turn |
| `agent/planner/tactical.plan` | `"ANY"` | tactical planner MUST emit a structured action — already wired at `agent/planner/tactical.py:394-400` via `gemini_provider.call_with_tools` (which hard-codes `mode="ANY"` on `gemini_provider.py:437`) |

**Cleanest threading:** add a `tool_config_mode: Literal["AUTO", "ANY"] = "ANY"` kwarg to `AIProvider.call_with_tools` (and the router method). Default to `"ANY"` so existing tactical callers don't break. Chat pipeline passes `"AUTO"`. The Gemini implementation already builds `FunctionCallingConfig(mode="ANY")` at `gemini_provider.py:437` — that becomes `FunctionCallingConfig(mode=tool_config_mode)`. Ollama: future work.

This also closes **F-52** (call_with_tools not on the ABC) — making the ABC method real now, with the new kwarg, costs one signature change.

### Multi-iteration without re-implementing the agent loop

The agent loop (`agent/loop.py`, `agent/planner/tactical.py`) is task-oriented: each PlanStep produces ONE action, the loop persists state via SQLAlchemy, and the runtime tracks budgets per-task. The chat tool loop needs only:

- iteration cap (`max_iterations=3`, hard ceiling = `MAX_TOOL_CALLS_PER_TURN`)
- per-iteration call budget already enforced by `_runtime_note_llm_call` inside `call_with_tools`
- `task_id=None` is fine — chat is not a task; the budget path already accepts it (`ai/provider.py:862-872`)
- conversation building: keep history list of `{role, content|function_call|function_response}` parts in memory; do NOT persist intermediate iterations (no DB writes between tool calls).

Critical: `ai_router.call_with_tools` returns a `ToolCallResult` with `arguments`; the chat pipeline must distinguish three kinds of tool name:
1. `RESPONSE_FORM_TOOLS` (`respond_text`, `respond_markdown`, `respond_metrics`, ...) → terminal, parse via `response_formatter.parse_function_call`
2. `CHAT_DATA_TOOLS - {search_web, create_calendar_event}` → dispatch via `chat_tool_dispatcher.dispatch`, append `function_response`, continue
3. `search_web` / `create_calendar_event` → **explicitly refuse for now** with a `function_response` containing `{"ok": false, "error": "deferred_to_phase_17b"}` — F-11 prompt-injection chain remains open until 17b ships the sanitiser.

### Settings flag

`config.chat_tools_enabled` already exists (`config.py:458`, default `False`). The new pipeline gates on it: when False, fall through to today's `ai_router.generate(...)`; when True, use the new loop. Keeps the rollback button live.

**Severity: P0** — F-01 itself remains the highest-leverage Tier-0 item.

---

## F-02 + F-03 EventBus subscribers — wiring plan

### Current state

Verified at HEAD by grep: `event_bus.emit(...)` fires from four sites; `event_bus.subscribe(...)` from **zero** non-test sites:

- `core/context_engine.py:188,201` — `context_updated` (every tick)
- `core/state_machine.py:297` — `state_changed` (every transition)
- `core/decision_tree.py:70` — `decision_action` (only when `priority <= 2`)
- `sensors/serial_bridge.py:202` — `esp32_disconnected`

`DecisionTree.consume_initiative` (`core/decision_tree.py:78-87`) has zero non-test callers. `state_machine.set_ai_initiative` (`core/state_machine.py:228`) has zero non-test callers. Day-1 didn't change this; the F-02/F-03 wiring is genuinely the next move.

### Where subscribers should live (NOT in core/)

`core/` is the policy layer. It must not import from `api/`, `ai/`, `voice/`, or `agent/`. F-44 already calls out the existing `core → agent.localization` violation; the right shape is **dispatcher modules outside core/ subscribe to events emitted by core/**.

Proposed module layout:

```
src/backend/
├── core/
│   ├── event_bus.py        # unchanged
│   ├── context_engine.py   # emits context_updated  (unchanged)
│   ├── state_machine.py    # emits state_changed    (unchanged)
│   └── decision_tree.py    # emits decision_action  (unchanged)
└── dispatch/                              # NEW package
    ├── __init__.py
    ├── action_dispatcher.py               # subscribes decision_action
    ├── state_broadcaster.py               # subscribes state_changed
    └── lifecycle.py                       # called from main.lifespan
```

`dispatch/lifecycle.py::wire_subscribers()` runs once during lifespan startup (after `register_chat_ws_handlers()` and before `_context_loop` task is created). It imports:

- `dispatch.action_dispatcher.bind()` — subscribes `decision_action` and routes by `kind`:
  - `kind="actuator"` → `sensors/command_sender.send_actuator(payload)` (already exists at `sensors/command_sender.py`; no new code needed).
  - `kind="alert"` → `hub.broadcast("alert", ...)` (uses existing WS hub).
  - `kind="ai_speak"` → call into `agent.proactive.get_loop().enqueue_initiative(action)` (new method on ProactiveLoop, or a thin wrapper that calls the existing `_DECIDE_TEMPLATE` path with the prompt_hint).
  - `kind="state_change"` → `state_machine.force_transition(target, trigger)`.
- `dispatch.state_broadcaster.bind()` — subscribes `state_changed` and emits the `state.transition` WS broadcast that today is duplicated inline at `main.py:69-75` and `main.py:105-111`.

Subscribers should NOT call `emit_async` recursively unless the chain is bounded; the existing F-31 task-set tracking (`event_bus.py:20-49`) already protects against task GC, but emit-from-handler invariants need a doc note.

### `decision_tree.evaluate` — the unconsumed return

`main.py:83` calls `decision_tree.evaluate(snapshot)` and **discards the return value**. The evaluator already pushes priority<=2 actions through `event_bus.emit("decision_action", ...)` at line 70. So once `dispatch/action_dispatcher.py` subscribes, **priority-1 and priority-2 actions** start firing immediately.

Priority>=3 actions (`ai_speak`, `actuator/dream`, low-priority calendar) currently never emit and never get consumed. Two options:

1. **Emit all priorities** (mod the line in `decision_tree.py:69` to `for action in actions: event_bus.emit("decision_action", action)`). Simple, but the dispatcher must internally rate-limit `ai_speak` (cooldown already lives in `_can_initiate`, fine).
2. **Drain `consume_initiative()` from main loop**, route through dispatcher. This is what F-03 quick-win sketches.

I recommend **#1** because:
- Symmetric: every decision is observable on the bus
- `_can_initiate` already gates the cooldown (`decision_tree.py:207-213`); the dispatcher just respects the action.
- Avoids the per-loop drain pattern (which couples `main.py` to DecisionTree internals).

The F-33 finding (mutating `_last_initiative_ts` on the check) lands **before** this, otherwise emitting all actions amplifies the race.

### `state_changed` subscribers that SHOULD exist

| Subscriber | Purpose | Lives in |
|---|---|---|
| `dispatch/state_broadcaster.py` | WS `state.transition` (replaces inline broadcast) | dispatch/ |
| `vision/oled_animator.py::_on_state_changed` | OLED face animation (today: pulled inline at `main.py:79-82, 112-115`) | vision/ — subscribes itself in `start()` |
| `state_machine.set_ai_initiative(False)` | reset initiative flag on entering DIALOGUE | state_machine — but this is self-update; cleaner: dispatcher triggers it |
| `agent.proactive.get_loop().note_state_change(...)` | proactive loop already has `note_user_interaction`; symmetric "state changed" hook lets it suppress check-ins right after a transition | agent/ — subscribes itself |

### `context_updated` subscribers

Most paths today **poll** the snapshot via `context_engine.get_snapshot()`. That polling is redundant once `context_updated` fans out, and it's how the tactical map / PresenceLayer end up re-rendering 2 Hz. The subscriber model is what unlocks F-19 (per-client subscription gate at the WS hub) — clients only get `context_updated` if they care.

Day-2 wiring should subscribe **at most one consumer** to `context_updated` (the WS broadcaster, replacing `main.py:84,117`) and leave the polled `get_snapshot()` calls alone for this commit. Migrating polled callers to subscribers is a separate, larger refactor (F-32 implications).

### Interaction with the main.py polled `state_machine.evaluate`

`main.py:66-83` (tick path) and `main.py:101-117` (serial-batch path) both call `state_machine.evaluate(snapshot)` and `decision_tree.evaluate(snapshot)`, then duplicate the WS broadcast inline. This is F-18 in the Day-1 punch list (audit doc has F-18 listed under perf, but it is also a structural duplication).

Sequence after the wiring:

1. `context_engine.tick()` / `update()` → emits `context_updated`.
2. `_context_loop` (and `on_batch`) calls `state_machine.evaluate(snapshot)` — applies transition, **emits `state_changed`** internally.
3. The inline `await hub.broadcast("state", "transition", {...})` block at `main.py:69-75` and `main.py:105-111` is **deleted**; `dispatch/state_broadcaster.py` does that on `state_changed`.
4. The inline `oled_animator.set_system_state(...)` block at `main.py:78-82` and `main.py:112-115` is **deleted**; OLED animator self-subscribes.
5. `decision_tree.evaluate(snapshot)` — emits `decision_action` per action (after the priority-emit-all change).
6. `dispatch/action_dispatcher.py` routes each action.

Net result: `_context_loop` body shrinks from 33 LOC to ~10 LOC; the duplication between tick and serial paths collapses to a one-liner each.

**Severity: P0** — closes F-02, F-03, partially F-18.

---

## F-44 layering inversion — refactor plan

### Walked dependency graph

`core/context_engine.py` imports from `agent.localization` at TWO sites:

- Line 366 (`agent.localization.adapters.overpass.get_default_overpass`) inside `_refresh_nearby` — fetches OSM features for the snapshot's `nearby[]` list.
- Line 397 (`agent.localization.get_resolver`) inside `resolve_localization` — pulls a `LocationEstimate` from the resolver chain.

Both are inside `try/except ImportError` and use `# noqa: PLC0415` (deferred import comments), which signals the author already knew this was wrong.

There are also imports of `agent.localization` from siblings of `core/` that don't violate layering but are relevant to the refactor design:

- `api/routes_map.py:299,392,411,498` — fine, API depends on agent.
- `memory/geo_integration.py:83,91` — fine if memory < agent.
- `memory/geo_query.py:16` — `from agent.localization.base import haversine_km` — this is a pure utility; should move to a shared module.

The reverse direction (`agent.runtime → api.websocket_hub` at `agent/runtime.py:265,283,398-405`) is the OTHER half of F-44; same architectural violation, same shape.

### Refactor — three steps that don't break the running system

**Step 1 (Day-2 P1, ~50 LOC, no behaviour change):** invert the resolver call.

Today `context_engine.resolve_localization()` PULLS from the resolver. Invert: `agent/localization/lifecycle.py` (already exists, wires sources) starts a **task** that runs every `localization_resolve_interval_s` and calls `context_engine.set_localization(estimate: LocationEstimate)`. Add a new public method `ContextEngine.set_localization()` that takes a typed estimate (not the agent module's class — define a thin local dataclass in `core/types.py` and have `agent.localization` import core, not the other way around).

Net: `core/context_engine.py:388-437` deletes; `_refresh_nearby` moves to `agent/localization/nearby_writer.py` and writes to context via the same setter. `core` knows nothing about resolvers, overpass, sources.

**Step 2 (Day-3, ~40 LOC):** move `haversine_km` from `agent.localization.base` to a shared utility (`core/geo_utils.py` or `shared/geo.py`). It's a pure function; no agent runtime dep. Update three importers (`api/routes_map.py`, `memory/geo_query.py`, `agent.localization.base` re-exports for back-compat).

**Step 3 (later, M-sized):** invert `agent.runtime → api.websocket_hub`. Agent runtime should emit events on a domain bus (`agent.events`); a `dispatch/agent_broadcaster.py` subscribes and fans out to the WS hub. Same pattern as F-02.

### Compatibility / tests

Steps 1+2 are pure refactor — no runtime behaviour change if the new task ticks at the same cadence as today's `_context_loop` polled call. Existing tests that mock `context_engine.resolve_localization()` need rerouted to mock the new writer. Day-1 didn't touch context_engine, so the test surface is the same as the audit baseline.

**Severity: P1** — architectural; not blocking F-01 / F-02 / F-03.

---

## Day 1 architecture regressions

### D-01 P1 — `observability.py` lives at `src/backend/` top-level

`src/backend/observability.py` is a sibling of `main.py`, `config.py`. Other top-level files are `main.py` (entry point) and `config.py` (Pydantic settings). The codebase otherwise organises by package (`api/`, `core/`, `ai/`, ...).

**Why it's wrong:** the module mixes three concerns — Prometheus metric primitives (`Counter`, `Gauge`), HTTP middleware (`correlation_id_middleware`, `http_requests_counter_middleware`), and FastAPI route registration (`_register_observability`). Each belongs to a different layer:

| Concern | Should live in |
|---|---|
| `Counter` / `Gauge` / `render_metrics` / contextvar | `core/metrics.py` (depended on by ai/, api/, core/) |
| `correlation_id_middleware` / `CorrelationFilter` / `http_requests_counter_middleware` | `api/middleware.py` |
| `/healthz` `/readyz` `/metrics` route registration / probes | `api/routes_observability.py` |

The current shape works but creates a top-level "kitchen sink" — every module that needs a counter (`api/routes_chat.py:300`, `api/routes_voice.py:106,149`, `ai/provider.py:775`) imports from `observability` rather than from a layered location.

**Fix (P1, ≤30 LOC churn):** split into the three modules above; `observability.py` becomes a thin re-export shim for one release so importers don't break in lockstep.

### D-02 P1 — Phase 18 `StaticFiles` mount at `/` with `html=True` after the API router

`main.py:506-514`:

```python
_dist_path = _os.environ.get("PHANTOM_FRONTEND_DIST", "/app/dist")
if _os.path.isdir(_dist_path):
    app.mount("/", StaticFiles(directory=_dist_path, html=True), name="frontend")
```

**FastAPI/Starlette route resolution:** `app.mount("/", ...)` registers a catch-all that fires when no preceding route matches. Since the API router is mounted at `prefix="/api/v1"` (`main.py:470`) and the WS at `/ws` (`main.py:520`), `/healthz` `/readyz` `/metrics` (`observability.py:281,291,306`), `/health` (`main.py:543`), and `/docs` `/redoc` (FastAPI built-ins, gated on `config.debug`) all match before the static mount.

**No conflict found** — every existing API path is a strict prefix that resolves before `/`, and `html=True` only serves `index.html` for paths that don't match a file in the dist. The shadow risk is **future routes added at the bare root** (`/foo` without a prefix) — those would be eaten by static. There is no such route today.

**One subtle issue:** Phase 18 E-2 used `app.mount` AFTER `app.include_router(...)` calls — correct order. But `_register_ws(app)` and `register_voice_ws(app)` are called before the static mount (`main.py:484-485`), so WS endpoints win. **Verified safe.**

**Recommendation (P2):** add a one-line comment explicitly documenting the mount-order invariant, or move the static mount into a `_register_static(app)` helper that asserts no overlapping routes exist via `app.routes` introspection. Cheap insurance for the next person who adds a bare-root route.

### D-03 P1 — `ai/chat_tool_dispatcher.py` reaches into `core` and `memory` directly

`ai/chat_tool_dispatcher.py:223` (`from memory.strategic_memory import retrieve_relevant`) and line 265 (`from core.context_engine import context_engine`). Per-handler imports (lazy), inside the handler body — the file's top-level imports are clean.

**Is it wrong?** The dispatcher is an orchestration layer that sits between LLM tool selection and effect execution. Reaching into `core` and `memory` is exactly what a dispatcher does. The lazy imports at handler scope are defensible: they keep dispatcher load fast and break cycles if any.

**However:** `ai/` should not depend on `core/` philosophically — `core` is the policy heart, `ai` is one of its consumers. Symmetry argument with F-44: just as `core` shouldn't import `agent`, `ai` shouldn't import `core` directly. The right inversion is for `core/context_engine` to expose a read-only `get_sensor_status_dict()` method that the dispatcher calls, OR the dispatcher accepts a snapshot argument from the caller and never imports core itself.

**Fix (P1, ~15 LOC):** extract a `core/snapshot_view.py` module with read-only accessors; `chat_tool_dispatcher._h_get_sensor_status` calls `snapshot_view.get_sensor_status()` instead of pulling the singleton. Same import-cycle risk as today, lower coupling. Defer until the F-01 wiring lands so we know the actual call signatures.

### D-04 P0 — Two parallel chat-tool implementations

`ai/tool_executor.py` (Phase 10, 612 LOC) and `ai/chat_tool_dispatcher.py` (Phase 17a, 305 LOC) **both implement handlers for the same tool names**:

| Tool | tool_executor.py handler | chat_tool_dispatcher.py handler |
|---|---|---|
| `search_locationhistory` | `_tool_search_locationhistory:64` (limit 10, returns per-row) | `_h_search_locationhistory:124` (limit `chat_tool_locationhistory_limit`, GROUP BY place_name, returns aggregates) |
| `query_temporal_anchors` | `_tool_query_temporal_anchors:104` | `_h_query_temporal_anchors:177` |
| `recall_memory_facts` | (Phase 10 has it) | `_h_recall_memory_facts:217` |
| `get_system_metrics` | (Phase 10 has it) | `_h_get_system_metrics:231` |
| `get_sensor_status` | (Phase 10 has it) | `_h_get_sensor_status:260` |

`gemini_provider.py:14,270` calls `tool_executor.execute_tool` (the Phase 10 path). `chat_tool_dispatcher.dispatch` is **not called from production code** today — only from `tests/test_phase17a_chat_tool_dispatcher.py`.

**This is a fork.** The tests verify the new dispatcher works; the runtime uses the old executor. F-01 wiring will pick one. If it picks the dispatcher (recommended — cleaner surface, smaller LOC, registered handler pattern), the old executor needs deletion or sunset, otherwise drift compounds and bug fixes go in the wrong place.

**Severity: P0** because the F-01 plan above is predicated on picking the new dispatcher, AND because today there's no documented invariant about which one is canonical — a contributor could add a tool to either.

### D-05 P2 — `chat_tools_enabled` config flag has no live consumer

`config.py:458` defines `chat_tools_enabled: bool = False`. Grep for the symbol returns the config definition, the test file (`tests/test_phase17a_chat_tool_dispatcher.py:325` only verifies it defaults to False), and **nothing else**. Phase 17a shipped the dispatcher + flag; F-01 (Phase 17b) is what reads it.

**Why flag this now:** the flag's existence implies a feature gate, but with zero readers it is **dormant configuration that documents an intent**. Either the F-01 wiring lands within the day-2 window (and reads the flag), or the flag is removed pending its real use. Default-False prevents risk; documentation drift is the only cost. P2.

### D-06 P1 — `ai_router_fallthrough_total` declared but never incremented

`observability.py:190` declares the counter; grep returns the declaration and one mention in audit log helper text inside `provider.py`, but **no `ai_router_fallthrough_total.inc(...)` call**. The fall-through site is `provider.py:486-624` where `prov_idx > 0` means we're on fallback; the audit row is written via `write_log(... fell_through_to_fallback=is_fallback_attempt)` but the metric never increments.

**Fix (P1, 3 LOC):** at `provider.py` end of the success path inside the loop where `is_fallback_attempt is True`, call `ai_router_fallthrough_total.inc(primary=primary_name, fallback=prov_name)`.

---

## Other findings (P0 / P1 / P2)

### D-07 P0 — `gemini_provider.generate` chat-tool loop bypasses AIRouter resilience

When `routes_chat.py:262` calls `ai_router.generate(... user_id=...)`, the router does its quota / cooling / 429 handling for the **first** Gemini call. Inside `gemini_provider.generate` (`gemini_provider.py:240-298`), iteration 2..N of the data-tool roundtrip calls `client.aio.models.generate_content(...)` directly, **not via the router**. If iteration 2 hits a 429 or 5xx, it raises out and the router treats it as a primary failure — but the inner retries / cooling never trigger because the loop owns the call.

**Why this matters:** F-11 (prompt-injection chain) doubles down here — a hostile turn can drive 3 tool-use iterations all on Gemini, and a quota exhaustion mid-iteration looks to the router like a single failure rather than 3 chained calls. Audit log has only one row per `generate()` even though 3 LLM calls happened.

**Fix:** the F-01 chat-pipeline rewrite naturally fixes this by routing every iteration through `ai_router.call_with_tools`. Mark this finding as superseded once F-01 lands. **Severity P0** because the issue is live today.

### D-08 P1 — `MAX_TOOL_CALLS_PER_TURN` is a module constant, not a config

`ai/tool_executor.py:39` and `ai/gemini_provider.py:14` import `MAX_TOOL_CALLS_PER_TURN: int = 3`. Not surfaced via `config.py`, not a Settings key, not validated. F-11 mitigation requires this to be tunable from the operator UI. CLAUDE.md commandment #8 ("All configs from UI") is violated.

**Fix:** promote to `config.chat_tool_max_iterations: int = 3` with validator (>=1, <=8). Change `gemini_provider.py:267,279` and the new chat pipeline to read `config.chat_tool_max_iterations`. ~6 LOC. **P1.**

### D-09 P1 — `OllamaProvider` has no `call_with_tools`

`ai/provider.py:486-491` checks `hasattr(provider, "call_with_tools")` and skips the provider in the loop if it doesn't have one. Today, only Gemini does (`gemini_provider.py:396`). This means:

- `agent.planner.tactical.plan` works ONLY when Gemini is the active provider.
- F-01 chat-pipeline path also degrades to non-tool when Gemini is exhausted and Ollama takes over.
- F-52 (call_with_tools on the ABC) closes this; Ollama's tool-use needs implementing OR a clean "tools unsupported, fall through to plain generate" shim.

**Recommendation:** when F-01 lands, the chat pipeline must explicitly check `if not chat_tools_supported(provider)` and gracefully fall back to plain `ai_router.generate(...)`. This is a one-liner in the new pipeline; doesn't need an Ollama tool-use implementation now. **P1.**

### D-10 P2 — `event_bus.emit_async` is unused

`core/event_bus.py:72-87` defines `emit_async` (await-all-handlers) — zero callers. `emit` (fire-and-forget via task) is the only emitter used. Dead code today; will be relevant when F-02 wiring needs ordered, awaited dispatch (e.g. `state_changed` must complete before the WS broadcast). Keep, document the intent. **P2.**

### D-11 P1 — `_ws_chat_handler` in `routes_chat.py:612` does NOT increment chat counters

REST path `_build_ai_response` at line 299-304 increments `chat_messages_total`. WS path at line 612-766 (separate pipeline, F-54 territory) does the message ingest + AI generation but never imports/increments the counter. Phase 18 E-5's `/metrics` undercounts WS chat traffic.

**Fix:** mirror the increment in `_build_ai_response` at the right place, OR — better — collapse the two pipelines per F-54 so the counter has one home. **P1.**

### D-12 P2 — Phase 16 prompt observability writes via `chat_prompt_logging_enabled` even on tool-use turns

`routes_chat.py:275-296` writes a row to `ai_tool_use_log` with `tool_name=f"chat:{response_form}"`. That table is the agent-runtime's audit trail; mixing chat prompt excerpts in keeps observability simple but conflates two purposes. When F-01 lands and the chat pipeline writes per-iteration audit rows, this single-row-per-turn surface becomes inconsistent.

**Fix (Day-3):** add a `prompt_log` table or a `kind: enum("agent_tool", "chat_prompt", "chat_tool")` column on `ai_tool_use_log` so consumers can filter. **P2.**

### D-13 P2 — Inline `ai_router.generate` exception → 503 swallows ToolUseError detail

`routes_chat.py:461-466`: `except Exception` → `HTTPException(503, detail=f"AI unavailable: {exc}")`. F-16 quick-win in Day-1 added a centralised exception handler in B-3, but the chat path still inlines the `f"AI unavailable: {exc}"` template — Gemini SDK exception text leaks to the client.

**Fix:** route through the centralised handler with `error_code="ai_unavailable"`. **P2.**

### D-14 P1 — `_ghost_trigger` reads `rgb_states[1]` without length guard

`core/state_machine.py:111`: `btns.get("rgb_states", [False, False, False])[1]`. Day-1 F-04 fixed the data-source side — `context_engine._apply_buttons` (`core/context_engine.py:268-275`) writes `list(btns.rgb_states)` from the typed sensor batch. But if firmware ever ships fewer than 2 RGB states (or the sensor parser changes), this raises IndexError mid-tick and the whole `state_machine.evaluate` blows up.

**Fix:** guard with `rgb = btns.get("rgb_states") or []; ... rgb[1] if len(rgb) >= 2 else False`. **P1**; secret-feature surface.

---

## Top-3 highest-leverage moves for Day 2

1. **F-02 + F-03 together via `dispatch/` package** (~80 LOC + tests).
   Wires every emitted event to a real subscriber, kills the inline `state.transition` broadcast duplication at `main.py:69-75,105-111`, and turns the `decision_action` bus from theatre into behaviour. Once this lands, every existing emit site has a real consumer; future findings (F-32, F-18, F-19) get a clean substrate. **Single biggest "Jarvis lights up at runtime" unlock that fits in a day.**

2. **F-01 chat tool-use loop in new `ai/chat_pipeline.py` calling `ai_router.call_with_tools(mode="AUTO")`** (~150 LOC + integration tests).
   Closes the literal Tier-0 P0 finding. Picks `chat_tool_dispatcher` (Phase 17a) as canonical, lets us sunset `tool_executor.py` next day (D-04 closure). Adds the `tool_config_mode` kwarg through to `AIProvider.call_with_tools` — knocks out F-52 in passing. Migrates the secondary Gemini-only loop (D-07) to the router-level seam, so resilience policy applies to every iteration.

3. **F-44 step 1 only — invert `core → agent.localization`** (~50 LOC).
   The other two findings ship behaviour; this one ships the architectural posture that makes everything afterward cheaper. Localization writer becomes a `lifecycle.py` task that calls `context_engine.set_localization(...)` instead of being pulled from inside core. `core/` stops importing `agent/`. Costs almost nothing now; saves a multi-day refactor when F-46 voice WS unification or F-50 memory-read wiring needs to add another `core <- ?` import.

These three closures, in order, take Day 2 from "Day 1 stabilised the seams" to "the autonomous brain is observably running and chat is on the same tool-use rails as the agent." Everything else (F-04 / F-05 already done, F-22 short-MMS bundle, F-30 chat commit ordering, F-19 WS subscriptions) becomes additive rather than load-bearing.
