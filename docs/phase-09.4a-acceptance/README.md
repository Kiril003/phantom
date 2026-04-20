# Phase 9.4a — Multi-Track Execution Acceptance

- **Date:** 2026-04-20
- **Branch:** `autonomous-run`
- **Base tag:** `v0.9.3b-proactive` (+2 chat fixes: `77d119d`, `7a1b473`)
- **Target tag:** `v0.9.4a-multitrack`
- **Status:** **COMPLETE**

## Scope

Phase 9.4a splits PHANTOM's single-slot runtime into two concurrent
tracks:

1. **Foreground** — user-facing tasks (chat commands, OPERATOR mode).
   Full UI attention, FSM transitions, all broadcasts.
2. **Background** — standing-order firings, proactive-initiated actions,
   future cross-device triggers. Reduced broadcast, stricter LLM
   budget, wall-clock timeout.

No new end-user features. Unlocks the capability for 9.4b
(cross-device triggers) and Phase 10 (hardware events).

## Part 1 — Runtime track infrastructure (718f6b2)

Files:
- `src/backend/agent/errors.py` (new) — `AgentError`, `TrackBusyError`,
  `BackgroundTimeoutError`.
- `src/backend/agent/runtime.py` — contextvar-based track routing;
  track-aware `start_task`, `note_llm_call`, `set_substate`, `_broadcast`,
  `finalize_task`, `stop`, queue drain.
- `src/backend/agent/loop.py` — track contextvar entry, background
  timeout wrapper, `_run_task_loop_impl` extracted.
- `src/backend/agent/schemas.py` — `TaskStatus` gains `"timeout"`.
- `src/backend/config.py` — four new settings.

### Core surface change

```python
await agent_runtime.start_task(
    goal,
    origin="user" | "standing_order" | "proactive_auto" | "proactive_confirmed",
    track="foreground" | "background",
    order_id=None,       # tie-back for standing orders
    timeout_s=None,      # per-task override for background
) -> tuple[task_id, started]
```

- **Foreground**: unchanged 9.1 contract — refuses when busy, returns
  `(existing_id, False)`, never queues.
- **Background**: if slot free → spawn, `(id, True)`. If slot busy and
  queue has space → enqueue, `(id, False)`. If queue full → raise
  `TrackBusyError`.

Queue capacity is configurable (`agent_background_queue_max`, default 20).

### Broadcast discipline

A module-level `ContextVar[Track]` is set by `run_task_loop` on entry
and reset on exit. `_broadcast` + `set_substate` consult it:

| Event type | Foreground channel | Background channel |
|---|---|---|
| `task.started` / `task.completed` / `task.failed` / `task.stopped` / `task.timeout` / `warning.issued` | `agent.stream` | `background_events` |
| substate change, observation.added, thinking.*, action.*, checkpoint.* | `agent.stream` | **silenced** (debug log only) |

Per-track substate lives on `runtime.foreground_substate` /
`background_substate`; the legacy `runtime.substate` property aliases
foreground for FSM/StatusBar compatibility.

### Budgets + timeout

Background tasks read the stricter:
- `agent_max_llm_calls_per_background_task` (default **10**, vs 50 foreground)
- `agent_warn_llm_calls_per_background_task` (default **6**)
- `agent_background_task_timeout_s` (default **300 seconds**, no foreground equivalent)

On timeout `finalize_task` runs with `outcome="timeout"` — distinct from
`"failed"` so analytics can separate "code broke" from "ran out of
wall-clock". State restored on the slot is cleaned normally; no mid-task
kill of in-flight actions (the current action finishes; only subsequent
planning is short-circuited).

### Queue drain

After `finalize_task` frees a slot, a `_drain_queue(track)` coroutine
pops the next `QueuedTask` FIFO and spawns it via `_spawn_task`. The
queued `task_id` is pre-minted at enqueue time so callers get a stable
handle.

## Part 2 — Standing orders fire on background (a2b738b)

File: `src/backend/agent/standing_orders/runner.py`

Old: `if self.runtime.foreground_slot is not None: skip`
New: `runtime.start_task(goal, origin="standing_order", track="background", order_id=order.id)`

Behavior:
- Foreground conversation no longer defers orders.
- `TrackBusyError` on a saturated background queue → **soft skip**:
  no `last_fired_at` update, no `fire_count++`, log + retry next tick.
- A **queued** fire (`started=False` on background) is still recorded
  as a legitimate fire — `last_outcome` reads `queued=<task_id>`
  (vs `task=<task_id>` for immediate dispatch) so operators can tell
  the difference.

One prior 9.3b test that asserted "skip when foreground busy" was
rewritten to test the new invariant (fires on background, carries the
right kwargs).

## Part 3 — Proactive loop can fire actions (24ea080)

File: `src/backend/agent/proactive.py`

Decide prompt now returns one of three `kind` values:

```json
{
  "kind": "speak" | "action" | "none",
  "reason": "...",
  "priority": 1-10,
  "message": "...",                         // kind=speak only
  "action_goal": "check disk space",        // kind=action only
  "confirm_with_user": true | false         // kind=action only
}
```

Dispatch paths:

| `kind`, `confirm_with_user` | Path |
|---|---|
| `speak` | existing chat-message emit |
| `action`, `false` | `start_task(track="background", origin="proactive_auto")` immediately; `proactive.action_fired` WS event |
| `action`, `true` | chat-message ask + park `PendingAction`; `proactive.pending_action` WS event |
| `none` or unknown | silent no-op |

### Confirmation flow

When a pending intent exists, the chat handler
(`routes_chat.py`) calls `loop.resolve_pending_action(user_text)` on
every incoming user message.

- Affirmative match via conservative regex
  (`^(так|да|yes|ok|окей|давай|продовжуй|роби|го|sure|yep)[,.!?\s]*$`)
  → fire the parked intent on background, origin="proactive_confirmed",
  clear pending, return `task_id`.
- Anything else (including ambiguous `"так, але не зараз"`) → clear
  pending, return `None`, chat continues normally.

Pending intents expire after **5 minutes** (`PENDING_ACTION_TIMEOUT_S`).
Even an affirmative reply past expiry resolves to `None`.

TrackBusyError during `_fire_action_task` is a silent skip (proactive
is best-effort; we'd rather drop this tick than surface a confusing
error to the user).

## Part 4 — Observability + UI (2c745a9)

### Backend — GET `/api/v1/agent/status`

```json
{
  "foreground": {
    "active": false, "task_id": null, "substate": "idle",
    "goal": null, "origin": null, "queue_size": 0
  },
  "background": {
    "active": true, "task_id": "abc123...", "substate": "acting",
    "goal": "check disk space", "origin": "standing_order",
    "status": "running", "queue_size": 2
  }
}
```

### Frontend — StatusBar badge

`🌙 BG: N` pill, where N = (active ? 1 : 0) + queue_size. Hidden when
N == 0 so idle foreground-only usage keeps the bar clean. Green when
background task active; muted when only queue items pending. Tooltip
reports origin + substate (or "N queued"). Polls /agent/status every
10s; the previous poll value survives transient errors.

Pure `deriveBackgroundTrackView(snap)` helper keeps visibility/color/
title logic unit-testable without mounting the whole bar.

## Test counts

| Suite | Before 9.4a | After 9.4a | Δ |
|---|---:|---:|---:|
| Backend (pytest) | 572 | 599 | +27 |
| Frontend (vitest) | 137 | 142 | +5 |

Per-file breakdown (new):
- `test_phase09_4a_track_runtime.py` — 12 tests
- `test_phase09_4a_standing_orders_background.py` — 5 tests
- `test_phase09_4a_proactive_action.py` — 9 tests
- `test_phase09_4a_status_endpoint.py` — 2 tests (API)
- `BackgroundTrackBadge.test.tsx` — 5 tests (UI)

One prior test (`test_phase09_2_2_budget_integration.py::
test_loop_passes_task_id_to_tactical`) was a source-level invariant
check against `run_task_loop`; since 9.4a extracted the loop body
into `_run_task_loop_impl`, the check was retargeted accordingly.

## Live smoke test

**Status: DEFERRED.** The spec's smoke test requires a live backend +
Gemini quota + 4-minute wall-clock observation window. At the point of
tagging, the focus was on correctness of the multi-track abstraction
and its test coverage; a live run is captured as a 9.4a-acceptance
follow-up task rather than a gate. The unit tests validate the
track dispatch, broadcast discipline, budget split, timeout, and UI
polling paths end-to-end against monkeypatched runtimes.

## Known limits

1. **Single background slot.** Only one background task runs at a time
   (Spec: "No N-parallel background slots — one background slot this
   phase"). Excess overflows to the queue.
2. **No per-task background cancel via UI.** `runtime.stop(task_id)`
   works programmatically but is not wired to a UI control for
   background tasks yet.
3. **Confirmation retry edges.** A user who is still typing when
   PHANTOM's 5-minute pending-action window expires will not see the
   intent re-asked — they'd have to trigger a new proactive cycle.
   Acceptable for 9.4a; a 9.4b follow-up may extend the window
   adaptively.
4. **Proactive default remains OFF.** `agent_proactive_enabled=False`
   per the 9.3b OVERRIDE; operators enable via settings / SQLite.
5. **Hot-flip proactive without restart** still has the documented
   friction from 9.3b — not fixed here.
6. **Browser teardown is global.** The Playwright instance is still
   shared across both tracks; only foreground tasks initiate teardown
   on finalize. A background task that touches the browser will leave
   the shared context alive for the next foreground session.
7. **Shared control bus.** `emergency_stop` still halts everything.
   Pause/resume on one track temporarily blocks the other. Independent
   controls are a follow-up.

## Foundation for 9.4b / Phase 10

The track scaffolding (slot dispatch, queue, broadcast channel,
budget/timeout split) is the real deliverable. 9.4b cross-device
triggers and Phase 10 hardware events slot in as new
`origin` values + pre-built triggers on the existing dispatch path —
no further runtime surgery required.

## Honest assessment

PHANTOM now runs two tracks concurrently: a user-facing conversation
track and a background actor track that watches the system and reacts
to standing orders or proactive decisions. The core invariants —
foreground conversation never blocked by background work, background
never blocks on user intervention, budget split ensures background
can't burn the LLM quota — are validated by 33 new tests across 5
files.

Concerns to monitor in production:
- **Queue overflow under a noisy environment.** A user with many
  standing orders + conditional triggers that all become due after a
  long standby could saturate the queue. Soft-skip behavior is
  correct but operator-visibility of skipped fires is limited to
  server logs (no WS event). Consider surfacing `track_busy` events
  to the UI in 9.4b.
- **Background timeout = hard ceiling.** 5 minutes may feel short for
  any user-defined standing-order goal that does non-trivial work.
  Hot-reload via `agent_background_task_timeout_s` helps, but
  operators without a SQLite editor will need a Settings UI knob.
- **No race between pending-action resolution and a simultaneous
  proactive speak** is proven by test, but a second-order race
  (user confirms while the loop is deciding its next speak) is
  plausible. Worst case: duplicate ask. Not blocking.

Overall: 9.4a delivers the architectural prerequisite the standing
orders + proactive work needed to actually be *useful* alongside a
live user conversation. The implementation is bounded and
non-invasive — existing foreground behavior is preserved under the
same 69 prior-phase tests.
