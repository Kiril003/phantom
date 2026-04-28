# Day-3 Architecture Audit — 2026-04-30

Read-only review by N-arch at HEAD `d3ca9a6` (branch `autonomous-run`, Day-3 baseline `c3602c8`). Builds on `docs/audit-2026-04-29-day2/architecture.md` (Day-2 baseline `111181e`).

Scope: validate the Tier-B `dispatch/` package proposal in `docs/AUTONOMOUS_DAY_PLAN_DAY3.md` Block P; re-walk F-02 / F-03 / F-06 / F-44 against the live tree; flag layering drift introduced by the Day-2 commits (chroma eager init, JSON logging, system_metrics_sampler, the new chat_tool_dispatcher shim, F-08+F-09 auth fixture work).

Severities A..F, lower is more urgent. A = must close before Tier B touches code; B = ship in Tier B; C = ship in Tier C/D; D = lift opportunistically; E = document only; F = false-flag from Day-2.

---

## TL;DR

The Day-2 architecture plan is structurally correct and the Day-3 Block-P proposal lands cleanly. **Three concrete shape errors in the plan must be fixed before Lane B-3 writes code:**

1. **`ContextEngine.set_localization()` setter is the right shape but the plan’s "delete `core/context_engine.py:331,362,388-437`" line numbers no longer match HEAD** — `_refresh_nearby` is at L351-386 and `resolve_localization` is L388-437. More importantly, the plan misses a SECOND inversion: `_refresh_nearby` calls `agent.localization.adapters.overpass.get_default_overpass` from inside `core/`. Any `set_localization()` writer must also push `nearby[]` (or expose a `set_nearby_features()` companion), otherwise nearby OSM features stop landing on the snapshot when `_refresh_nearby` deletes.
2. **`sensors/command_sender.send_actuator(payload)` does NOT exist.** Day-2 architect plan says "already exists at `sensors/command_sender.py`; no new code needed" — that is wrong. `command_sender.py` exposes typed methods (`servo`, `haptic`, `rgb`, `buzzer`, `oled_*`) but no generic `send_actuator(payload)` that takes a `DecisionAction.payload` dict. Lane B-3 must add a thin payload-routing helper OR the dispatcher must switch on `payload["type"]` itself. Either is fine, but it’s 15 LOC, not zero.
3. **`agent.proactive.ProactiveLoop.enqueue_initiative(action)` does NOT exist** either. `ProactiveLoop` only exposes `note_user_interaction`, `push_trigger`, `record_success_for_streak` etc. The Day-2 plan’s `dispatch.action_dispatcher.bind() → kind=ai_speak → enqueue_initiative()` chain has no landing site. Lane B-3 must add a public method (or the dispatcher writes to `chat_messages` directly via a service module — better, see NEW-ARCH-04 below).

Beyond those three, the new chat_tool_dispatcher shim is the right consolidation move (D2-A5 closed cleanly), but it spawns a small coupling regression worth fixing in Tier B (NEW-ARCH-05). The new top-level `system_metrics_sampler.py` is fine for now but accumulates the second top-level "kitchen sink" file after `observability.py`; recommend a Tier-D `core/observability/` package consolidation.

F-06 dual proactive system: **converge to `agent/proactive.py`, retire `decision_tree.py`’s `_check_ai_initiative` + `consume_initiative`**; do NOT keep both behind a flag (NEW-ARCH-06 below — concrete reasoning, not a vibe call).

---

## Tier B execution-risk assessment (Block P)

Read on each lane in the Day-3 plan. Sequencing rule from the plan stands: B-1 + B-2 + B-4 in parallel, B-3 follows B-1.

### Lane B-1 — `dispatch/` skeleton + state_broadcaster

**Risk: low. Lands cleanly.** The duplicated inline broadcasts at `main.py:69-75` and `main.py:105-111` are byte-identical and on a single emitting event (`state_changed` from `state_machine._apply` at `core/state_machine.py:297`). A subscriber in `dispatch/state_broadcaster.py` collapses both to one site.

**Concrete deliverables verified:**
- subscriber signature: `async def _on_state_changed(transition: StateTransition) -> None` — `StateTransition` is a frozen-shape dataclass, the broadcast already matches its fields one-to-one.
- the `oled_animator.set_system_state(transition.to_state)` block at `main.py:78-82` and `main.py:112-115` ALSO collapses into a `state_changed` subscriber. The plan’s "OLED animator self-subscribes" is fine; cleanest is `vision/oled_animator.py::start()` adds `event_bus.subscribe("state_changed", self._on_state_changed)` next to the existing task spawn (`oled_animator.py:117-122`).
- `EventBus.emit` (sync entry, async dispatch via `asyncio.create_task`) is the right primitive — handlers are already protected by `_track`/`_on_done` (`event_bus.py:38-49`). No need to reach for `emit_async`.

**One trap:** `state_machine._apply` runs on the main `_context_loop` task which holds NO lock when it emits. If a subscriber writes back to `state_machine` (e.g. `set_ai_initiative(False)` on entering DIALOGUE — see NEW-ARCH-02 below), the write is on a separate task, not the one that called `evaluate`. That’s actually fine because the only mutator today is the `evaluate()` call itself, but document it.

### Lane B-2 — F-44 layering inversion

**Risk: medium. Plan-shape OK, line numbers stale, hidden second writer.** See top-level finding 1. Detailed in NEW-ARCH-01.

**Concrete deliverables to add to the lane scope:**
- `ContextEngine.set_localization(estimate: LocationEstimate) -> None` — typed setter; takes the lock internally.
- `ContextEngine.set_nearby_features(features: list[dict]) -> None` — companion setter for the OSM features list. Same lock.
- A new `agent/localization/nearby_writer.py` (or fold into existing `lifecycle.py`) that schedules a periodic task: pull resolver estimate → call `set_localization` → if `lat/lon`, fetch overpass features → call `set_nearby_features`.
- Either define a thin `LocationEstimate`-shaped dataclass in `core/types.py` and have agent re-import (cleanest), or accept that `ContextEngine.set_localization` imports `agent.localization.base.LocationEstimate` (still wrong direction). The Day-2 plan suggested the former; do that.

**Out of scope for Day-3 (per plan):** moving `haversine_km` to a shared util module. Defer.

### Lane B-3 — F-02 + F-03 EventBus subscribers

**Risk: medium-high. Two missing landing sites + one priority decision.** See top-level findings 2 and 3. The plan as written assumes `command_sender.send_actuator()` and `proactive_loop.enqueue_initiative()` exist; they don’t. Lane B-3 has to either add them or route differently. Detailed in NEW-ARCH-03 + NEW-ARCH-04.

**Open priority decision (architect must call):**
- Day-2 plan recommended option #1: "emit ALL priorities, dispatcher rate-limits internally." That is correct, but `_can_initiate()` (`decision_tree.py:207-213`) mutates `_last_initiative_ts` ON THE CHECK, not on the emit (F-33). If we flip to emit-all, every priority<=2 + every priority>=3 action runs through the same emit pipe but the cooldown timer was already advanced by the gate even when no `ai_speak` shipped. That’s observable as "PHANTOM goes silent for 5 minutes after a transient stress spike." F-33 MUST close in Block-O quick-wins or it amplifies under emit-all.
- Alternative: emit only priority<=2 today (status quo) and route `ai_speak` differently (see NEW-ARCH-04). That cuts the F-33 risk entirely. I recommend this.

### Lane B-4 — F-06 dual proactive system

**Risk: low (it’s a doc commit). Recommendation given below.** NEW-ARCH-06 has the analysis; the operator picks. Plan has B-4 ship a recommendation doc, not code — that’s the right shape.

---

## Per-finding catalogue

### NEW-ARCH-01 — Severity B — F-44 step-1 hidden second writer

**Where:** `src/backend/core/context_engine.py:351-386` (`_refresh_nearby`) + L388-437 (`resolve_localization`)

**Evidence:** The Day-2 plan addresses only the resolver inversion (`get_resolver()` at L397). But L366 imports `agent.localization.adapters.overpass.get_default_overpass` and writes `self._snapshot["nearby"]` at L437. Both are layering violations of the same shape: `core/` reaches into `agent/` to PULL data into the snapshot. If Lane B-2 only inverts the resolver path, the overpass path keeps the violation alive — `core/context_engine.py` still imports `agent.localization.adapters.overpass`.

**Why it matters now:** F-44 is presented as "core has zero `agent` imports after this lands." With only the resolver inversion, `core/context_engine.py` retains exactly one `from agent.localization.adapters.overpass import ...` line. The architectural posture argument fails until both writers move.

**Recommendation:**
1. Add `ContextEngine.set_localization(estimate: LocationEstimate) -> None` AND `ContextEngine.set_nearby_features(features: list[dict]) -> None`.
2. Move `_refresh_nearby` body to `agent/localization/nearby_writer.py`. Move `resolve_localization` body to `agent/localization/lifecycle.py`. Both PUSH via the new setters.
3. Have the `_context_loop` in `main.py` STOP calling `await context_engine.resolve_localization()` (L62). Instead, the new writer task (started in lifespan, alongside the existing `wire_default_sources()` at `main.py:301-305`) ticks on its own cadence and pushes.
4. After the move, `core/context_engine.py` should import zero `agent.*` symbols. Verifiable with one grep:
   ```
   grep "from agent\|import agent" src/backend/core/context_engine.py  # → 0 lines
   ```

**Effort:** ~80 LOC (vs the plan’s 50). Worth the extra 30 LOC because it actually closes F-44 instead of half-closing it.

---

### NEW-ARCH-02 — Severity B — `state_machine.set_ai_initiative` and `decision_tree.consume_initiative` are dead but kept

**Where:** `core/state_machine.py:228` + `core/decision_tree.py:78-87`

**Evidence:** Greps confirm zero non-test callers for both methods (Day-2 architect already noted this). After Block P, the dispatcher will subscribe to `decision_action` events — neither method gets a caller in the Tier-B wiring either.

**Trap:** Lane B-3 might be tempted to re-wire `consume_initiative` as the `ai_speak` adapter ("dispatcher pulls via `consume_initiative` and forwards"). Don’t. `consume_initiative` mutates `_pending` after `evaluate()` already populated it — a per-tick race between the evaluator (writes `_pending`) and the dispatcher (consumes it via the bus). Cleaner: `decision_tree` emits, dispatcher consumes, neither uses `_pending` for cross-task state. `_pending` becomes a private debug list.

**Recommendation:**
- After Block P lands, delete `consume_initiative()` AND `set_ai_initiative()` (gate it on a follow-up cleanup commit, not Tier B). They’re K-of-N dead code that survives only because the audit hasn’t been brave enough yet.
- Until then, document at the top of `decision_tree.py` that `_pending` and `consume_initiative` are NOT the integration point — the bus is.
- F-33 (`_can_initiate` mutating on check) must close in Block O regardless. See NEW-ARCH-09.

**Effort:** Tier-F cleanup commit, ~10 LOC.

---

### NEW-ARCH-03 — Severity B — `command_sender.send_actuator(payload)` does not exist (plan-shape error)

**Where:** Day-2 architect plan + `src/backend/sensors/command_sender.py`

**Evidence:** The Day-2 plan says:
> `kind="actuator"` → `sensors/command_sender.send_actuator(payload)` (already exists at `sensors/command_sender.py`; no new code needed).

`command_sender.py` exposes a `CommandSender` class with typed methods (`.rgb(...)`, `.servo(...)`, `.oled_text(...)`, `.buzzer(...)`, `.haptic(...)`) and a module-level `serialize_command(cmd: dict)` JSON encoder. There is no `send_actuator(payload)` — the code that consumes a `DecisionAction.payload` dict and dispatches to the right typed method does not exist anywhere in the tree.

**Why it matters:** Lane B-3’s `action_dispatcher.bind()` cannot just call `send_actuator(payload)`. It either has to:
- (a) Switch on `payload["type"]` itself: `if payload["type"] == "rgb": await command_sender.rgb(...)` — adds 15 LOC of type-routing inside the dispatcher.
- (b) Add `CommandSender.send(payload)` as a thin router (already partially exists at `command_sender.py:96-111`, but it only forwards to `serialize_command` + writer — no payload→typed-method routing). Refactor `send` to dispatch on `cmd["type"]` and call the right typed method, OR just bypass typed methods and let `serialize_command` do everything (it already handles all types L37-79).

Option (b) is cleaner. The typed methods on `CommandSender` ALREADY just call `await self.send({...})` so the routing is a no-op — `serialize_command` already serializes `{"type": "rgb", ...}` shapes correctly. So `command_sender.send(payload)` works AS-IS for any well-formed `DecisionAction.payload` dict, provided the dispatcher passes the dict through unchanged. The `send_actuator` call in the plan is just `await command_sender.send(payload)` with no rename needed.

**Recommendation:** Day-3 plan’s commit message for Lane B-3 must say "uses existing `CommandSender.send(...)`". No new method, no new file. Same shape as plan, accurate naming.

**Effort:** zero new code, just a doc-correction in the lane scope.

---

### NEW-ARCH-04 — Severity B — `ProactiveLoop.enqueue_initiative` does not exist (plan-shape error)

**Where:** Day-2 architect plan + `src/backend/agent/proactive.py`

**Evidence:** Plan says:
> `kind="ai_speak"` → call into `agent.proactive.get_loop().enqueue_initiative(action)` (new method on ProactiveLoop, or a thin wrapper that calls the existing `_DECIDE_TEMPLATE` path with the prompt_hint).

`ProactiveLoop` exposes `start/stop`, `push_trigger`, `note_user_interaction`, `record_success_for_streak`, `record_fatigue_spike`, `resolve_pending_action`, etc. None match the call shape. The existing `_emit_speech` (L578-643) is the closest equivalent but it’s designed for the LLM-decided message string, not a `prompt_hint` rule-action shape.

**Two options for the dispatcher:**

**Option A — push triggers, let proactive loop decide.** When `decision_action(kind=ai_speak)` arrives, the dispatcher calls `proactive_loop.push_trigger(ProactiveTrigger(kind=..., context={...}, priority=...))`. The proactive loop’s next cycle consumes the trigger, runs the LLM decide prompt, and emits speech. Pro: respects the existing proactive contract; the trigger just becomes another input alongside emotion deltas / streak hits. Con: latency — proactive loop runs on a 30-300 s adaptive interval, so a stress-induced "suggest_breathing_exercise" could land 2 minutes after the event.

**Option B — direct emit via a new chat-side service.** Create `src/backend/agent/initiative.py` (~40 LOC) with `async def emit_initiative(prompt_hint: str, reason: str, priority: int)`. It builds a system-prompt + user-prompt-hint, calls `ai_router.generate`, persists to `chat_messages` (same shape as `proactive._emit_speech` lines 578-643), and broadcasts. The dispatcher just calls this. Pro: latency is "as fast as the LLM"; pro: doesn’t re-shape `ProactiveLoop`. Con: now there are two paths writing assistant messages with `metadata.origin` ∈ {`proactive`, `decision_tree`}.

**Recommendation: Option A.** Reasons:
1. F-06 says we have two parallel proactive systems already; collapsing the rule-tree’s `ai_speak` into the LLM proactive loop’s trigger queue is the SAME convergence direction NEW-ARCH-06 wants for F-06. One unification, two findings closed.
2. The decision_tree’s `prompt_hint`s ("suggest_breathing_exercise", "remind_upcoming_event", "check_in") are EXACTLY the shape `ProactiveTrigger.context` already carries. Wire `prompt_hint` → trigger context, profit.
3. Adding a third "emit assistant message" path in `agent/initiative.py` (option B) adds drift the audit will then have to find later.

**Effort:** Lane B-3 adds a `_decision_to_trigger(action: DecisionAction) -> ProactiveTrigger` helper; ~20 LOC. ProactiveTrigger schema may need a new `ProactiveTriggerKind.RULE_ACTION` enum value (~3 LOC in `agent/proactive_triggers.py`). Plus the `_DECIDE_TEMPLATE` reads from triggers already (L535-537), so no prompt change needed.

---

### NEW-ARCH-05 — Severity C — `chat_tool_dispatcher` shim is correct but creates a TWO-STEP audit path

**Where:** `src/backend/ai/chat_tool_dispatcher.py:69-71` + `src/backend/ai/tool_executor.py:735+`

**Evidence:** Day-2 D2-A5 was closed by collapsing the duplicate handlers — `chat_tool_dispatcher._make_delegate` now forwards to `tool_executor.execute_tool`. That’s correct architectural decision (single source of truth for the 5 chat-safe tool implementations).

But: every chat-tool call now writes audit rows on TWO layers. `tool_executor.execute_tool` writes its own `ai_tool_use_log` row internally (it always has). `chat_tool_dispatcher.dispatch` ALSO calls `_audit_dispatch` (L206-256) on every attempt. So one chat tool call = two audit rows with different `provider` fields ("chat" vs whatever tool_executor uses), different `tool_args_json`, different elapsed_ms (the dispatcher’s wall-clock includes tool_executor’s wall-clock).

**Why it matters:** D2-R1+D2-R3 (Day-2 audit, Tier C) explicitly added `tool_args_json` and `tool_result_summary` so chat-tool calls have a single auditable row with the args. With the shim, querying `ai_tool_use_log WHERE provider='chat'` gets the dispatcher row but NOT the args of the actual SQL/IO that ran inside execute_tool. Querying without the provider filter returns 2x rows per call and obscures rate-limiting / 1Hz dashboards.

**Recommendation (Tier-D follow-up, not Tier B):**
- Either: tool_executor learns to skip its internal audit when called from the dispatcher (pass a `audit=False` kwarg). Dispatcher’s row is canonical for chat path.
- Or: dispatcher skips `_audit_dispatch` — let tool_executor handle it; dispatcher just adds a `caller="chat"` tag to whatever audit row tool_executor writes.

Second option is cleaner. ~10 LOC of plumbing.

**Effort:** Tier-D, ~10 LOC. Not blocking Block P.

---

### NEW-ARCH-06 — Severity B — F-06 recommendation: converge to `agent/proactive.py`

**Where:** `core/decision_tree.py:153-175` (rule-based 500ms initiative) vs `agent/proactive.py:230-332` (LLM-based 30-300s adaptive cadence)

**Evidence:** Both systems decide whether PHANTOM should speak unprompted. Both currently have zero subscribers / consumers wiring their `ai_speak` decisions to actual chat broadcasts (decision_tree emits to event bus with no listener; proactive_loop has its own emit path via `_emit_speech` and IS the only working initiative chain in production today).

**Why proactive_loop wins:**
1. **Already wired in production.** `_emit_speech` writes to `chat_messages` with `metadata.origin='proactive'` and broadcasts on the WS. It works today. `decision_tree`’s `ai_speak` actions are emitted to a bus with no listener.
2. **Better UX for the same surface area.** The decide prompt at L86-138 produces nuanced Ukrainian speech matching the user’s active emotion state; `decision_tree`’s `prompt_hint`-driven path has 3 hardcoded rules ("suggest_breathing_exercise" / "remind_upcoming_event" / "check_in") with no LLM in the loop, so the speech would be either templated or punted to a second LLM call anyway.
3. **Adaptive cadence + cooldowns + pending-confirmation** already exist in `ProactiveLoop`. Re-implementing those for `decision_tree`’s 500 ms cadence is a recipe for "PHANTOM nags every half second on stress spike." `_can_initiate` exists but is buggy (F-33).
4. **F-06 framing.** The audit calls them "two parallel autonomous-decision systems." Converging means deleting one, not flagging.

**Why decision_tree LOSES (specific failure modes):**
- `_check_ai_initiative` at L153-175 reads `state in ("FOCUS",)` only — it doesn’t fire in SHADOW (the most common idle state). Already broken on its premise.
- `_can_initiate` mutates `_last_initiative_ts` on every CHECK, not on every EMIT (F-33 — see NEW-ARCH-09). So `_check_health` / `_check_calendar` / `_check_ai_initiative` race to consume the cooldown. With `evaluate()` running every 500 ms, transient stress spikes burn the cooldown invisibly.
- Hard-coded thresholds (stress > 0.6, idle > config.ai_initiative_cooldown_s) do not adapt to user mood.

**Recommendation:**
1. **Tier B Lane B-4 ships a doc** (per plan) recommending convergence. The doc lands at `docs/audit-2026-04-30-day3/F06-recommendation.md`.
2. **Subsequent Tier-F commit** removes `decision_tree._check_ai_initiative` and `decision_tree.consume_initiative` (both unused after dispatch wiring + no `ai_speak` actions ever emitted).
3. **`decision_tree.evaluate` keeps its three other roles** — alerts (priority<=2), actuator commands (`rgb`/`oled`/`buzzer`), and state-change triggers — those don’t belong to ProactiveLoop and have a real future as event-bus emitters.
4. **Do NOT keep both behind a feature flag.** Reasons: the dual-system surface area survives any future audit ("which of these decides X?"); the dead code rots; the rule-tree path is shipping bugs (F-33) the LLM path doesn’t have.

**Effort:** Lane B-4 doc only (Block P). Cleanup commit later; ~30 LOC delete.

---

### NEW-ARCH-07 — Severity D — `system_metrics_sampler.py` lives at `src/backend/` top-level

**Where:** `src/backend/system_metrics_sampler.py` (Day-2 D2-D-cpu fix)

**Evidence:** New 127-LOC module sits next to `main.py`, `config.py`, `observability.py`. That’s the SECOND top-level "kitchen sink" file (Day-2 audit flagged `observability.py` as the first — D-01). The codebase organises by package (`api/`, `core/`, `ai/`, etc.) but observability concerns now have two top-level files and counting.

**Module contents:** 1 Hz background task that calls `psutil.cpu_percent(interval=None)` and caches the result. `tool_executor._tool_get_system_metrics` reads it (`tool_executor.py:325-326`).

**Where it should live:**
- Option A — `core/observability/` package (also moves `observability.py` per Day-2 D-01).
- Option B — `core/sampling/cpu.py` if sampling becomes a category.
- Option C — `monitoring/cpu_sampler.py` if observability vs monitoring is distinguished.

I’d go with option A. The Day-2 D-01 fix was already pending; doing both moves in one commit is cheaper than splitting them. Three ways to spell the package: `core/observability/`, `observability/`, or `obs/`. `core/observability/` is most consistent with the current package layout.

**Recommendation:** Defer to Tier-E productisation. NOT a Tier-B blocker. But include `system_metrics_sampler.py` in the same move when D-01 lands. Don’t commit a third top-level "kitchen sink" file in Tier B.

**Effort:** Tier-E, ~30 LOC churn (re-exports for back-compat).

---

### NEW-ARCH-08 — Severity D — `observability._probe_chroma` reaches into `memory.strategic_memory` private API

**Where:** `src/backend/observability.py:357` (`from memory.strategic_memory import client_initialized, _get_client`)

**Evidence:** The probe imports `_get_client` (note leading underscore — convention says private). The Day-2 D2-A6/G-1 fix shipped this on purpose to avoid the `list_collections()` cold-scan. But the probe is now coupled to a private symbol. If `strategic_memory` refactors to a class-based client, this probe breaks silently — readiness check would always pass, but the underlying client could be uninitialized.

**Recommendation:**
- Promote `_get_client` to public `get_client` OR add a typed `assert_chroma_ready() -> None` function in `memory.strategic_memory` that raises on bad state. Probe calls that.
- Tier-D follow-up. Not blocking Block P.

**Effort:** ~10 LOC.

---

### NEW-ARCH-09 — Severity B — F-33 `_can_initiate` side-effect on check (Tier B blocker)

**Where:** `core/decision_tree.py:207-213`

```python
def _can_initiate(self) -> bool:
    elapsed = time.monotonic() - self._last_initiative_ts
    if elapsed >= config.ai_initiative_cooldown_s:
        self._last_initiative_ts = time.monotonic()  # ← MUTATES on check
        return True
    return False
```

**Evidence:** `_can_initiate` is called from `_check_health` (L113), `_check_calendar` (L143), and `_check_ai_initiative` (L167) — three sites per `evaluate()` call, every 500 ms. Each call that returns True ADVANCES `_last_initiative_ts`. Whoever asks first wins the cooldown; subsequent checks in the same `evaluate()` see an updated timestamp and return False. So a transient stress spike that satisfies `_check_health` first burns the cooldown that `_check_calendar` would have legitimately consumed for an actual reminder.

**Why it’s a Tier-B blocker now:** If Lane B-3 ships emit-all (Day-2 plan’s recommendation #1), every priority>=3 action is now BUS-VISIBLE, including `ai_speak` rule-fires that today get silently swallowed. F-33’s "first checker wins cooldown" becomes "first checker burns cooldown AND emits a real ai_speak event the dispatcher consumes." Compounds the user-visible weirdness (PHANTOM speaks once then goes silent for 5 minutes when it shouldn’t have spoken).

**Recommendation (Block O quick-win, BEFORE Lane B-3):**
```python
def _can_initiate(self) -> bool:
    elapsed = time.monotonic() - self._last_initiative_ts
    return elapsed >= config.ai_initiative_cooldown_s

def _mark_initiated(self) -> None:
    self._last_initiative_ts = time.monotonic()
```
Then `evaluate()` calls `_mark_initiated()` exactly once after picking a single `ai_speak` action (or skipping it). Net: cooldown advances on emit, not on check.

**Effort:** ~20 LOC including tests. Block O scope.

---

### NEW-ARCH-10 — Severity D — `agent.proactive` reaches into `api.websocket_hub` four times

**Where:** `agent/proactive.py:248,362,397,642`

**Evidence:** Same architectural shape as F-44 in reverse: `agent/` should not depend on `api/`. The Day-2 architect already flagged this as F-44 step 3 ("invert `agent.runtime → api.websocket_hub`"). proactive.py adds four more sites of the same violation.

**Recommendation:** When step-3 of F-44 lands (a `dispatch/agent_broadcaster.py` subscribing to a domain `agent.events` bus), include the four proactive sites. The pattern is the same: replace each `from api.websocket_hub import hub; await hub.broadcast(...)` with `await event_bus.emit_async("agent.proactive.cycle", {...})` (or similar) and have the dispatcher fan out to WS.

**Effort:** Tier-D / Tier-E productisation, M-sized. Not blocking Block P.

---

### NEW-ARCH-11 — Severity E — `EventBus.emit_async` is unused, but Lane B-1 will need it

**Where:** `core/event_bus.py:72-87`

**Evidence:** Day-2 architect flagged this as D-10. Day-3 prediction: `state_changed` subscribers may need ordered/awaited dispatch — specifically, the `state.transition` WS broadcast must happen BEFORE any subsequent `decision_action` that fires within the same tick (otherwise the UI sees the actuator command before the state change that motivated it).

**Recommendation:** Lane B-1 should consider whether `state_machine._apply` switches to `event_bus.emit_async` (await all state_changed handlers before the next emit). The cost is one `await` in `_apply` (which `state_machine.evaluate` is already inside an `async` chain for via `_context_loop`). Would force `_apply` to become async — currently sync at L289.

**Alternative:** Keep `emit` (fire-and-forget) but document the ordering invariant: `decision_action` is emitted AFTER `state_changed` in the same tick, but their handlers run concurrently. UI must not assume strict ordering. This is fine if the UI displays them on separate channels.

I lean toward keeping `emit` and documenting the invariant. `_apply` becoming async ripples through `force_transition`, `enter_operator`, `exit_operator` — all lifecycle methods called from many sites that aren’t in a coroutine context (force_transition called from REST endpoints). Not worth the churn for a UI ordering nicety.

**Effort:** zero code, doc only.

---

### NEW-ARCH-12 — Severity F — Day-2 plan said `_ws_chat_handler` doesn’t increment `chat_messages_total` (D-11)

**Status:** half-fixed in Day-2 H-track. Both REST and WS chat paths now increment via `_build_ai_response` after the consolidation. Verified at HEAD: `routes_chat.py:262` is the consolidated entry. The D-11 finding is closed not by fixing the WS handler but by making it call the same `_build_ai_response`. Architectural equivalence: same metric source-of-truth, achieves the same goal.

**Recommendation:** Mark D-11 closed in Day-3 FINDINGS.md. No additional Tier-B / Tier-D work needed.

---

### NEW-ARCH-13 — Severity D — `dispatch/` package needs a public surface contract

**Where:** Proposed `src/backend/dispatch/__init__.py`

**Evidence:** Block P proposes `dispatch/{__init__.py, action_dispatcher.py, state_broadcaster.py, lifecycle.py}`. Without a public surface contract, future modules will reach in arbitrarily ("`from dispatch.action_dispatcher import _route_actuator`"). Same shape as the `core/` boundary that F-44 is fixing.

**Recommendation:** Lane B-1 commit must include `dispatch/__init__.py` with an explicit `__all__` listing only the lifecycle binder:

```python
# dispatch/__init__.py
"""Dispatch layer — subscribes to core/ events, routes side-effects.

Public surface is the lifecycle binder only. Internal handlers
(_route_*, _on_state_changed, etc.) are NOT importable from outside
this package.
"""
from dispatch.lifecycle import wire_subscribers, unwire_subscribers
__all__ = ["wire_subscribers", "unwire_subscribers"]
```

`main.lifespan` calls `dispatch.wire_subscribers()` exactly once (after `register_chat_ws_handlers()` per the Day-2 plan, before `_context_loop` task spawn). On shutdown, `unwire_subscribers()` clears the bus subscriptions so a re-instantiated app for tests doesn’t double-subscribe.

**Effort:** ~10 LOC inside Lane B-1 scope. Not extra effort.

---

### NEW-ARCH-14 — Severity D — `dispatch/lifecycle.py` collides with `agent/localization/lifecycle.py` namespace

**Where:** Proposed `dispatch/lifecycle.py` vs existing `agent/localization/lifecycle.py`

**Evidence:** Both files end up named `lifecycle.py`. Two `from x.lifecycle import ...` forms in `main.py` is fine technically (Python distinguishes), but it’s a readability tax — especially if Lane B-2 (F-44) is adding more wiring inside `agent/localization/lifecycle.py`.

**Recommendation:** Rename `dispatch/lifecycle.py` to `dispatch/binder.py` or `dispatch/wire.py`. Preserve `wire_subscribers` as the public function name.

**Effort:** zero, naming only. Lane B-1 scope.

---

### NEW-ARCH-15 — Severity D — Lifespan ordering invariant for Lane B-3 + B-2 + B-1

**Where:** `main.py` lifespan (`main.py:171-415`)

**Evidence:** Block P adds three new startup hooks plus modifies one. Ordering matters:

| Order | What | Why |
|---|---|---|
| 1 | `init_db` | unchanged |
| 2 | `apply_overrides` (settings) | unchanged |
| 3 | `set_ai_provider` | unchanged |
| 4 | `dispatch.wire_subscribers()` (NEW Lane B-1+B-3) | subscribers must be live BEFORE first emit |
| 5 | `register_chat_ws_handlers` | unchanged |
| 6 | `init_chroma_eager` | unchanged |
| 7 | `system_metrics_sampler.start()` | unchanged |
| 8 | `preload_voice_models` | unchanged |
| 9 | serial_bridge / context_loop start | emits start landing here |
| 10 | localization lifecycle: `wire_default_sources` + new `start_localization_writer` (Lane B-2) | replaces L62 polled call |

**Trap:** if `wire_subscribers()` lands AFTER `register_chat_ws_handlers`, that’s benign. But if it lands AFTER `_context_loop` spawn, the FIRST `state_changed` / `context_updated` emit fires with no subscribers, and the UI flickers (state.transition WS message lost).

**Recommendation:** Lane B-1 commit must have the test "`wire_subscribers()` is called before any task that emits an event" — that is, asserts `_context_loop` task is not created before the binder runs. Easy to enforce in the lifespan ordering by call sequence; harder to assert in a test, but the existing `test_phase_audit_2026_04_29_h3_h4.py` pattern can demonstrate it.

**Effort:** zero new code, ordering convention. Lane B-1 acceptance criterion.

---

### NEW-ARCH-16 — Severity F — Day-2 D-04 (parallel chat-tool implementations) is closed correctly

**Status:** verified at HEAD `d3ca9a6`. `chat_tool_dispatcher.py` is now a 267-line shim that delegates to `tool_executor.execute_tool` via `_make_delegate(name)` (L58-73). `_HANDLERS` (L76-78) is built from `_CHAT_SAFE_TOOL_NAMES` (5 tools) and every entry forwards to `tool_executor`. The duplicate-handler drift the audit warned about is gone.

**Residual issue:** double-audit row pattern — see NEW-ARCH-05.

**Recommendation:** Mark D-04 closed. Add NEW-ARCH-05 follow-up to Tier-D scope.

---

### NEW-ARCH-17 — Severity D — `ai/provider.py` reaches into `core/context_engine`

**Where:** `src/backend/ai/provider.py:766` (`from core.context_engine import context_engine`)

**Evidence:** Same shape as the symmetry argument for `ai → core` Day-2 architect raised in D-03. The router pulls the snapshot to read the AI provider state for some side-effect (didn’t deep-read; the pattern is what matters). `ai/` depends on `core/` philosophically — symmetry says no.

**Recommendation:** Tier-D snapshot_view extraction (Day-2 D-03 plan). Hold for now. Not blocking Block P.

**Effort:** Tier-D, ~15 LOC.

---

### NEW-ARCH-18 — Severity B (false-finding) — `ai/tool_executor.py:355` import of `core/context_engine`

**Where:** `ai/tool_executor.py:280` (`from memory.strategic_memory import retrieve_relevant`) + L355 (`from core.context_engine import context_engine`)

**Evidence:** Same pattern as Day-2 D-03 warning, but here it’s `tool_executor` (production path, called from `gemini_provider.call_with_tools`). Lazy imports inside handler bodies — defensible coupling for what is essentially a tool-execution facade. The two lazy imports do not break layering by themselves; `ai/` invoking `memory/` and `core/` reads is what tool execution IS.

**Recommendation:** Document, don’t refactor. Tier-D snapshot_view extraction (D-03 plan) handles this if/when it lands. If chat_tool_dispatcher gets its own internal handlers in the future (right now it just delegates), we’d revisit. Today, it’s the right shape for "tool dispatcher reads from context."

**Effort:** zero. Documentation only.

---

### NEW-ARCH-19 — Severity D — Hidden `gemini_provider.generate` chat-tool loop still bypasses AIRouter

**Status check:** the Day-2 architect flagged this as D-07. Block Q (Tier D) plans to fix it via `ai/chat_pipeline.py` routing every iteration through `ai_router.call_with_tools`. Verified at HEAD: `gemini_provider.py` still has the inline loop (`gemini_provider.py:240-298` per Day-2 reading). Not regressed, not fixed yet — Block Q owns it.

**Recommendation:** Confirm Block Q acceptance gate explicitly closes D-07 (chat path no longer bypasses the router). The Tier D step-3 should remove the `gemini_provider.generate` inline loop OR mark it deprecated.

**Effort:** in-scope for Block Q. Not blocking Block P.

---

### NEW-ARCH-20 — Severity E — `EventBus` is a singleton and cannot be replaced for tests

**Where:** `core/event_bus.py:97` (`event_bus = EventBus()`)

**Evidence:** Module-level singleton. Tests that want to verify subscriber behaviour have to either monkeypatch `event_bus._handlers` or use `event_bus.clear(event)` between tests. The Lane B-1 acceptance gate ("8-12 tests") will need to do this OR construct a private `EventBus` and inject it into `dispatch.wire_subscribers(bus=...)`.

**Recommendation:** Lane B-1 should add a `bus: EventBus = event_bus` kwarg to `wire_subscribers` so tests can inject a fresh bus. Kwarg defaults to the singleton; production behaviour unchanged.

```python
def wire_subscribers(bus: EventBus = event_bus) -> None:
    bus.subscribe("state_changed", _on_state_changed)
    bus.subscribe("decision_action", _on_decision_action)
```

**Effort:** ~5 LOC. Lane B-1 scope.

---

### NEW-ARCH-21 — Severity D — `agent/emotion.py`, `agent/self_model.py`, `agent/monologue_emitter.py` reach into `api/websocket_hub`

**Status check:** four files in `agent/` import from `api/`. Day-2 architect flagged this as F-44 step-3. None regressed in Day-2; none fixed. Tier B does not address them (per plan).

**Recommendation:** Defer to Tier-D / Tier-E. Same fix pattern as F-44 step-3: domain bus + dispatcher.

**Effort:** Tier-E, M-sized.

---

### NEW-ARCH-22 — Severity D — No structured `agent.events` bus to mirror `event_bus`

**Where:** broader observation across `agent/`

**Evidence:** `core/event_bus.py` is the only event bus. Agent runtime broadcasts to `api/websocket_hub.hub` directly. There is no `agent.events` bus. F-44 step-3 envisions one but no skeleton exists.

**Recommendation:** When Tier-E lands the agent broadcaster, the `dispatch/` package gains a second module (`dispatch/agent_broadcaster.py`) and `agent/` gains an `events.py` thin pub/sub. Reuse `EventBus` from `core/event_bus.py` — don’t spawn a new bus class. Same primitive, different namespaces (`agent.proactive.cycle`, `agent.task.completed`, etc.).

**Effort:** Tier-E, ~80 LOC.

---

### D2-FALSE-1 — Day-2 architecture finding D-04 (parallel implementations) IS closed

See NEW-ARCH-16. Mark closed.

### D2-FALSE-2 — Day-2 architecture finding D-11 (`_ws_chat_handler` undercounts) IS closed

See NEW-ARCH-12. Mark closed.

### D2-FALSE-3 — Day-2 audit said D-09 (`OllamaProvider` has no `call_with_tools`) is P1

Status check: at HEAD, `ai/provider.py` still has `hasattr(provider, "call_with_tools")` guard at L486-491. Ollama still has no `call_with_tools`. Block Q plan correctly handles this with a graceful fall-through ("if not chat_tools_supported(provider): generate(...)"). This is not a false-finding; it’s an open finding that Block Q addresses.

---

## Cross-cutting drift introduced in Day-2 commits

### Drift D3-D-01 — `system_metrics_sampler.py` at top level

NEW-ARCH-07. Move to `core/observability/cpu_sampler.py` in Tier-E.

### Drift D3-D-02 — `chat_tool_dispatcher` shim creates double-audit pattern

NEW-ARCH-05. Tier-D fix.

### Drift D3-D-03 — `observability.py` reaches into `memory.strategic_memory._get_client` (private)

NEW-ARCH-08. Tier-D fix.

### Drift D3-D-04 — `observability.py` still hosts JsonFormatter + middleware + routes

Day-2 D-01 plan (split into `core/metrics.py` + `api/middleware.py` + `api/routes_observability.py`). Day-2 H-track did not land that split; the file grew (now 441 LOC, was ~300). Tier-E plan should consolidate. Not Tier-B blocking.

### Drift D3-D-05 — Lifespan body grew to 244 LOC

`main.py:171-415` is now 244 LOC. Most of it is best-effort try/except blocks for lazy module imports. CLAUDE.md commandment 1 ("ніяких моків, TODO, заглушок, скорочень — кожен файл повна реалізація") doesn’t mean "everything in lifespan." Tier-E candidate for extraction into `app/startup.py` (one helper per concern). Defer.

### Drift D3-D-06 — `routes_chat.py:225,412,427,442,683,684,695` lazy-imports `agent.*` six times in the chat path

Day-1 added these. Each is a `# noqa: PLC0415` deferred-import. Pattern: chat builds context by reaching into `agent.runtime`, `agent.self_model`, `agent.proactive`. Layering concern: `api/` depends on `agent/` — that’s expected and fine. The "six lazy imports" smell is more about the chat handler being a god-function (~850 LOC, F-54 territory).

**Recommendation:** F-54 ChatService extraction (Day-2 plan’s F-54) covers this. Defer to its window.

---

## God-objects, circular imports, module-boundary violations (full sweep)

### God-object hits

| Module | LOC | Why it’s problematic | Action |
|---|---|---|---|
| `routes_chat.py` | ~850 | REST + WS chat handlers, prompt building, fact extraction, response forming, all in one file | F-54 ChatService extraction (deferred per plan) |
| `main.py` | 673 | Application factory + lifespan + WS bare endpoint + static + middleware. Lifespan is 244 LOC. | D3-D-05 — Tier-E lifespan extraction |
| `observability.py` | 441 | Metrics primitives + middleware + routes + JSON logging + readiness probes | D3-D-04 — Tier-E split into 3 modules |
| `agent/proactive.py` | 723 | LLM decide loop + pending-confirmation + speech emit + WS broadcast + helpers | A larger refactor; defer past Day-3 |
| `core/context_engine.py` | 528 | Snapshot construction + system poll + history + nearby + localization writer | Lane B-2 (F-44) shrinks it ~80 LOC |

### Circular imports

Greps show no actual circular imports. The deferred-import pattern (`# noqa: PLC0415` inside function bodies) is overused but DOES break what would otherwise be import-time cycles between `core/` and `agent/`. Lane B-2 should remove the deferred imports in `core/context_engine.py` after `agent.localization` writes are inverted.

### Module-boundary violations (current state)

```
core/ → agent/   (F-44, Lane B-2 closes the L366,L397 sites; full closure needs nearby_writer split)
ai/ → core/      (D-03, NEW-ARCH-17, NEW-ARCH-18 — defer Tier-D)
ai/ → memory/    (NEW-ARCH-18 — defer; legitimate orchestration)
agent/ → api/    (NEW-ARCH-10, NEW-ARCH-21 — F-44 step-3; Tier-E)
memory/ → agent/ (geo_integration imports agent.localization.adapters / proactive — NEW-ARCH dep, mostly OK; one bridge in geo_integration.py:207-208 should move)
observability.py → memory/  (NEW-ARCH-08; Tier-D)
observability.py → ai/       (Tier-D probe; same shape as → memory)
```

The boundaries are not great but they have a coherent direction: most violations point from outer/orchestration layers (api, observability) into inner ones (core, memory) — that’s expected. The two SHARP problem cases are `core/ → agent/` (F-44 — fixing in Lane B-2) and `agent/ → api/` (F-44 step-3 — Tier-E).

---

## Recommended Block-O quick-win list (architecturally relevant only)

1. **NEW-ARCH-09 — F-33 `_can_initiate` mutates on check** — must close BEFORE Lane B-3 emits all priorities. ~20 LOC + tests.
2. **NEW-ARCH-13 — `dispatch/__init__.py` public surface contract** — folded into Lane B-1. Zero extra LOC.
3. **NEW-ARCH-14 — rename `dispatch/lifecycle.py` to `dispatch/binder.py`** — zero LOC, naming.
4. **NEW-ARCH-15 — lifespan ordering test** — assert subscribers wired before context_loop emits. ~30 LOC test.
5. **NEW-ARCH-20 — `wire_subscribers(bus=...)` test seam** — Lane B-1 ergonomics. ~5 LOC.

Items 2-5 are inside Lane B-1 acceptance criteria, no extra commit. Item 1 is Block O.

---

## Block P plan-shape corrections to ship into the plan doc

The Day-2 architect plan and the Day-3 Block P proposal are mostly correct, but the following plan-shape errors should be propagated back into `docs/AUTONOMOUS_DAY_PLAN_DAY3.md` BEFORE Lane B-3 starts (to prevent the lane agent from blocking on phantom symbols):

1. **NEW-ARCH-03** — `command_sender.send_actuator(payload)` is `command_sender.send(payload)`. Same call shape. No new method.
2. **NEW-ARCH-04** — `proactive_loop.enqueue_initiative(action)` is wrong; route via `proactive_loop.push_trigger(ProactiveTrigger(...))` and let the proactive cycle pick it up. Add `ProactiveTriggerKind.RULE_ACTION` enum value.
3. **NEW-ARCH-01** — F-44 inversion needs TWO setters (`set_localization` + `set_nearby_features`) and TWO writer body relocations. ~80 LOC, not 50.
4. **NEW-ARCH-09** — F-33 must close in Block O before Lane B-3 emits all priorities.

These are surgical edits, not strategy changes. The Block-P sequencing (B-1 + B-2 + B-4 parallel, B-3 follows) remains correct.

---

## Top-3 Day-3 architectural moves (independent of Block P scope)

If Day-3 has spare cycles after Block P + Block Q + Block R land:

1. **F-44 step-3 partial — invert `agent.proactive` 4 sites** (NEW-ARCH-10 / NEW-ARCH-21). About 80 LOC including a thin `agent/events.py`. Closes 4 of the 12 `agent/ → api/` violations and de-risks Tier-E. Pairs with the dispatch/agent_broadcaster.py companion, which is small.
2. **NEW-ARCH-09 + NEW-ARCH-02 + F-06 cleanup combo** — close `_can_initiate` race, delete `consume_initiative` and `set_ai_initiative`, delete `decision_tree._check_ai_initiative`. Net ~80 LOC delete + 30 LOC test rewrites. The tree shrinks and the converged proactive loop becomes the single `ai_speak` source. Pairs naturally with Block P Lane B-4 (the recommendation doc justifies the deletes).
3. **NEW-ARCH-07 + Day-2 D-01 — top-level kitchen-sink consolidation** (`observability.py` + `system_metrics_sampler.py` → `core/observability/{metrics,sampler,probes,middleware,routes}.py`). 30-40 LOC churn; preventive against drift D3-D-01 + D3-D-04. Tier-E candidate.

These three combined would re-tag `v0.20.0-secure-saas` carrying a structurally cleaner backend than Day-2 left.

---

## What I’m NOT recommending

- **Don’t add a feature flag for F-06.** Convergence is the right call, not "two systems behind a switch." See NEW-ARCH-06.
- **Don’t move `chat_tool_dispatcher` shim out of `ai/`.** It’s in the right spot. The double-audit issue (NEW-ARCH-05) is plumbing, not layering.
- **Don’t rename `EventBus`.** It’s the right primitive. The "agent.events bus" (NEW-ARCH-22) is a future namespace, not a different type.
- **Don’t fold `system_metrics_sampler.py` into `core/context_engine.py`.** Tempting (snapshot reads CPU%) but wrong: sampler runs at 1 Hz, context_engine at 2 Hz, and the sampler is read from `ai/tool_executor.py` not just from `core/`.
- **Don’t merge B-3 into the Block-P main commit.** The lane has external dependencies (Block-O F-33 fix) and external risk (the two missing landing sites). Keep it as its own commit so it can be rolled back independently if a subscriber misbehaves.

---

## Verifiable Tier-B exit criteria

After Block P ships, these greps should hold:

```bash
# core/ has zero agent imports (closes F-44 fully if NEW-ARCH-01 is in scope)
grep -rn "from agent\|import agent" src/backend/core/                    # → 0

# event_bus has at least 3 non-test subscribers (closes F-02)
grep -rn "event_bus.subscribe(" src/backend/dispatch/                    # → 3+

# inline state.transition broadcasts at main.py:69-75 + main.py:105-111 are gone
grep -n 'hub.broadcast("state", "transition"' src/backend/main.py        # → 0

# inline OLED set_system_state at main.py:78-82 + main.py:112-115 is gone
grep -n "oled_animator.set_system_state" src/backend/main.py             # → 0 (now in oled_animator.start())

# decision_action consumer wired
grep -rn 'subscribe("decision_action"' src/backend/dispatch/             # → 1

# chat-tool dispatcher canonical (D-04 already closed; verify)
grep -c "register_tool\|_HANDLERS" src/backend/ai/chat_tool_dispatcher.py   # → small (delegate-only shape)
```

Plus the Lane B-1 8-12 tests, the Lane B-2 layering tests, and the F-33 quick-win regression test. If all greps return the expected counts and pytest is green, Tier B closure is provable.
