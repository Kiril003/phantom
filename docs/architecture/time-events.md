# time-events — Phase-2 Cluster Architecture (Day-4)

**Cluster scope (8 of 8)**: harden the existing standing-orders runner and replace
the dead `/tools/{timer,alarm,calendar}` 501 stubs with thin adapters.

**Baseline commit**: `53d16bc`.

**Contexts owned**

| Context | Scope | Day-4 blocks |
|---|---|---|
| `standing-orders-harden` | runner / schedules / conditions + new `actions.py` dispatcher; `StandingOrder` table extensions; recover-stale-leases on startup | T-1, T-2, T-3, T-4 |
| `tools-routes-replace` | `api/routes_tools.py`; new `tools/{timer,alarm,calendar}_adapter.py`; drop dead `Timer` + `Alarm` tables (`CalendarEvent` KEPT) | T-5, T-6 |

Source of truth: `docs/PHASE1_CONTEXTS.md:147-163`, `docs/PHASE1_BLOCK_ORDER.md`
rows for T-1…T-6 (lines 36, 42, 45, 56, 70, 71).

**APScheduler is REJECTED** per audit finding `U7-LRT-G2`. We harden the
existing in-process poll runner instead — adding leases, action dispatch,
event-bus telemetry, UTC normalisation, and dependency import-checks at
runner start.

---

## 1. Inventory of the existing surface

| File | Lines | Role today |
|---|---|---|
| `src/backend/agent/standing_orders/runner.py` | 1-229 | Polls `standing_orders` table on `agent_standing_orders_poll_s` (default 10s); fires due orders via `runtime.start_task(track="background", origin="standing_order")`; emits `STANDING_ORDER_FIRED` proactive trigger |
| `src/backend/agent/standing_orders/schedules.py` | 1-122 | Pydantic union `IntervalSchedule | CronSchedule | ConditionalSchedule | OneShotSchedule`; `parse_schedule()`, `next_fire_time()`. `OneShotSchedule.at: datetime` is currently tz-naive-tolerant |
| `src/backend/agent/standing_orders/conditions.py` | 1-137 | Regex-driven mini-DSL evaluator (`cpu_percent`, `disk_free_gb`, `memory_percent`, `hour`, `concern_count`, `fatigue`); fail-safe to `False` |
| `src/backend/db/models.py:439-461` | StandingOrder | `id, user_id, description, kind, schedule_json, action_json, enabled, created_at, last_fired_at, fire_count, last_outcome` |
| `src/backend/db/models.py:269-279` | Timer table | **dead** — never read outside schema migration / model imports |
| `src/backend/db/models.py:281-291` | Alarm table | **dead** — same |
| `src/backend/db/models.py:294-305` | CalendarEvent | **live** — read at `ai/tool_executor.py:645`, written at `ai/tool_executor.py:701` |
| `src/backend/api/routes_tools.py:33-74` | 501 stubs for timer/alarm/calendar | replaced in T-5/T-6 |
| `src/backend/core/event_bus.py:51-87` | `emit()` / `emit_async()` | re-used for new `standing_order.*` topics |
| `src/backend/agent/runtime.py:298-335` | `start_task(track, origin, order_id)`; raises `TrackBusyError` | re-used |
| `src/backend/config.py:386-389` | `agent_standing_orders_enabled`, `agent_standing_orders_poll_s` | extended in T-1 |

`grep -rn "Timer(\|Alarm(" --include="*.py" src/backend` returns **zero hits**
in product code (only `.venv` stdlib timers). This confirms `U7-LRT-C2`
("dead Timer/Alarm tables") and authorises ADR-TRR-001.

`ai/tool_executor.py:645,701` confirms `CalendarEvent` is actively read
(date-window query) and written (`db.add(event); commit()`). This authorises
ADR-TRR-002 ("KEEP CalendarEvent").

---

## 2. ADRs — `standing-orders-harden`

### ADR-SOH-001 — `StandingOrder` lease columns

**Decision.** Extend `StandingOrder` (`db/models.py:439-461`) with two new
columns:

| Column | Type | Default | Index | Purpose |
|---|---|---|---|---|
| `in_flight_task_id` | `String(36)`, nullable | `NULL` | yes | Task ID currently servicing a fire of this order |
| `claimed_at` | `DateTime`, nullable | `NULL` | no | UTC timestamp of the lease claim |

Lease TTL is configurable via new setting
`agent_standing_orders_lease_ttl_s: int = 300` (5 min default) on
`config.Settings` (alongside existing `agent_standing_orders_poll_s` at
`config.py:386-389`).

**Claim semantics.** Inside `_fire_order()`, before calling
`runtime.start_task`, we run an atomic
`UPDATE standing_orders SET in_flight_task_id=:tid, claimed_at=NOW() WHERE id=:oid AND in_flight_task_id IS NULL`
and check `rowcount==1`. If the row is already claimed, we emit
`standing_order.skipped(reason="lease_conflict")` and continue to the next
order. After `start_task` returns and we update `last_fired_at`, we keep
`in_flight_task_id` set; release happens through `task_status` reconciliation
(see SOH-002) or after `agent_runtime.update_task_status` reaches a terminal
state. We add a one-line subscriber on the existing agent task-status event
(`agent.runtime` already calls `update_task_status` at runtime.py:452, 533,
565, 734, 818) that clears the lease columns when a task linked by
`in_flight_task_id` reaches `done|error|cancelled`.

**Rationale.**
- Today (`runner.py:90-144`) the runner re-reads the table on each tick. A
  slow `start_task` (background queue drain) can overlap with the next tick
  and double-fire.
- Storing the in-flight task makes "what is order X doing right now?"
  observable without joining via timing heuristics.
- A 5-minute TTL is generous (background tasks rarely exceed 60s, but cron
  windows can require headroom) and configurable for ops experimentation.

**Back-compat.** Both columns default `NULL`; existing rows and tests
(`test_phase09_3b_standing_orders.py`, `test_phase09_4a_standing_orders_background.py`)
are unaffected because the claim branch is a no-op when leases are unused.

### ADR-SOH-002 — `recover_stale_leases()` at runner startup

**Decision.** Add `async def recover_stale_leases(self) -> int` on
`StandingOrderRunner` (`runner.py:51-71`), invoked once from `start()` before
the poll loop begins. It:

1. Selects rows where `in_flight_task_id IS NOT NULL AND claimed_at < now - lease_ttl`.
2. For each row, calls `runtime.task_status(task_id)` (we add this
   read-only helper to `agent/runtime.py` next to `update_task_status` at
   `runtime.py:38`; it returns `"running" | "done" | "error" | "cancelled" | "missing"`).
3. **Reconciles**:
   - `done | cancelled` → clear `in_flight_task_id`, `claimed_at`; set
     `last_outcome = f"recovered:{status}"`.
   - `error | missing` → clear lease; emit
     `standing_order.skipped(reason="lease_recovered_failed")`; runner will
     re-fire on next tick (idempotent because `last_fired_at` was already set
     by the original `_update_fire_stats`).
   - `running` → leave as-is (lease still legitimate; only stale by clock).
4. Returns the count of leases released (for the test surface).

**Rationale.** Crash-recovery: a runner that died mid-`start_task` would
otherwise leave the lease pinned forever. Five minutes is too long to wait
for production uptime so we reconcile at boot, not just by TTL expiry on
the next tick.

**Back-compat.** When `agent_standing_orders_enabled=False`, `start()`
returns early — preserving Day-3 behaviour where the runner does not start.
We invoke `recover_stale_leases()` only inside the enabled branch.

### ADR-SOH-003 — Action-kind discriminator

**Decision.** Introduce a Pydantic discriminated union for `action_json` and
add a dedicated indexed column `action_kind: String(16)` on `StandingOrder`
for fast filtering (operator console / per-kind metrics).

```python
class SpeakAction(BaseModel):
    kind: Literal["speak"]
    text: str
    voice: Optional[str] = None

class NotifyAction(BaseModel):
    kind: Literal["notify"]
    title: str
    body: str
    target_user_id: Optional[str] = None

class TaskAction(BaseModel):
    kind: Literal["task"]
    goal: str

class WebhookAction(BaseModel):
    kind: Literal["webhook"]
    url: HttpUrl
    method: Literal["GET", "POST"] = "POST"
    body: Optional[dict] = None

ActionSpec = Annotated[
    Union[SpeakAction, NotifyAction, TaskAction, WebhookAction],
    Field(discriminator="kind"),
]
```

**Storage.** `action_json` continues to hold the full JSON payload (no schema
change there); `action_kind` is a derived denormalised column populated on
write (POST `/standing-orders/`). A migration backfill sets
`action_kind = json_extract(action_json, '$.kind')` and defaults
unmigratable rows (legacy "goal-only" payloads — see runner.py:154) to
`"task"` so the existing single-mode behaviour is preserved.

**Validation.** A new module-level `parse_action(raw)` mirrors
`parse_schedule()` (`schedules.py:65-69`). Errors at create time return 422.

**Rationale.** The current runner only knows `goal → start_task` (`runner.py:154`).
The charter for `time-events` requires speak / notify / webhook to ship as
first-class. The discriminator makes the dispatch layer (SOH-004) a pure
match table.

**Back-compat.** Existing rows have `action_json={"goal": "..."}` without a
`kind` field. The migration sets `action_kind="task"` for these and the
`parse_action()` adapter accepts `{"goal": ...}` as a `TaskAction` shorthand
(emits a one-time deprecation warning, NOT per-row).

### ADR-SOH-004 — `actions.py` dispatcher module

**Decision.** New file `src/backend/agent/standing_orders/actions.py`
exports a single async entry point:

```python
async def dispatch_action(order: StandingOrder, action: ActionSpec) -> ActionOutcome: ...
```

`ActionOutcome` is `BaseModel(success: bool, summary: str, task_id: Optional[str])`.
Routing by `action.kind`:

| Kind | Sink |
|---|---|
| `speak` | `voice/tts_engine.py` provider singleton (`get_tts_engine().speak(text, voice)`). Hard timeout `agent_standing_orders_speak_timeout_s = 10`. |
| `notify` | `core/event_bus.event_bus.emit_async("notification.show", payload)` — frontend StatusBar already subscribes through `websocket_hub`. |
| `task` | existing `runtime.start_task(action.goal, origin="standing_order", track="background", order_id=order.id)`. Same call site as today (`runner.py:163-169`); only the goal source moves from raw-`action_json` to typed `action.goal`. |
| `webhook` | `httpx.AsyncClient` POST/GET with `agent_standing_orders_webhook_timeout_s = 5`. Body is `action.body` JSON (POST only). 4xx/5xx logged + counted as `success=False` but does not raise. |

`_fire_order()` in `runner.py:146-210` is restructured: parse → claim lease →
dispatch_action → on success update fire stats → on failure release lease +
emit `standing_order.skipped`. The proactive-trigger emission
(`runner.py:193-209`) survives unchanged but moves to `dispatch_action`'s
success path so it fires for every action kind, not just `task`.

**Rationale.** Clean separation between schedule eligibility (runner) and
side effect (dispatcher) lets us unit-test each in isolation and add new
action kinds without re-touching the runner.

**Back-compat.** `TaskAction` path is a literal lift-and-shift of today's
`runner.py:163-176` block. `test_phase09_4a_standing_orders_background.py`
will cover the `track="background"` invariant and remain green.

### ADR-SOH-005 — event_bus telemetry

**Decision.** Three new event_bus topics emitted by the runner via the
existing singleton at `core/event_bus.py:97`:

| Topic | When | Payload |
|---|---|---|
| `standing_order.tick` | per poll cycle, once after `check_and_fire_due_orders()` returns | `{cycle_at_iso, evaluated, fired, skipped}` |
| `standing_order.fired` | after a successful `dispatch_action(...)` returns `success=True` | `{order_id, action_kind, task_id, outcome_summary, fired_at_iso}` |
| `standing_order.skipped` | condition false, queue full, lease conflict, dispatch failure | `{order_id, action_kind, reason, at_iso}` (`reason ∈ {"condition_false","track_busy","lease_conflict","dispatch_error","cron_no_schedule"}`) |

**Fan-out.** `api/websocket_hub.py` registers three subscriptions (one per
topic) on app startup; payloads flow through the existing
`/ws` multiplex envelope as `{topic, data}`. Frontend `useStandingOrders`
hook subscribes via the WS multiplexer for live status without polling.

**Performance.** `event_bus.emit()` is fire-and-forget (sync inline +
`asyncio.create_task` for coroutines, see `event_bus.py:56-68`). Budget
≤ 100 µs per emission, dominated by handler-list copy and dict construction.

**Rationale.** Today the runner is silent except for `logger.warning` (e.g.
`runner.py:86`). Operators have no live signal. WS fan-out enables the
frontend "Standing Orders" panel without short-poll endpoints.

**Back-compat.** Subscribers are additive; no existing handler changes. The
`STANDING_ORDER_FIRED` proactive trigger (`runner.py:201-209`) remains
untouched — it's a separate concern (LLM cognition trigger), not an
operator telemetry event.

### ADR-SOH-006 — UTC normalisation + croniter import-check

**Decision (UTC).**

- **Schema-level**: `OneShotSchedule.at` (`schedules.py:51-53`) is documented
  as UTC and `parse_schedule()` coerces tz-naive input to `UTC` via
  `at.replace(tzinfo=timezone.utc)` if `at.tzinfo is None`.
- **Runner-startup auto-coerce**: a one-time migration step inside
  `recover_stale_leases()`'s sibling `_normalise_schedule_timezones()` reads
  every `kind="one_shot_future"` row, parses, coerces if naive, re-serialises
  with `tzinfo` set, and writes back. Single-pass at boot, idempotent on
  subsequent runs.
- **One-shot script**: `src/backend/scripts/migrate_oneshot_utc.py` — same
  logic, runnable manually. Used by ops for the existing production DB.

The runner already does pointwise normalisation at `runner.py:114-119` for
`last_fired_at` / `due_at`; this ADR pushes the fix upstream so the database
is canonical.

**Decision (croniter).** Today, every cron-tick that hits an order with
`kind="cron"` does a `from croniter import croniter` inside `next_fire_time`
(`schedules.py:84-91`). On a 100-order tick that's 100 import-attempts; on
a system without croniter installed it's 100 `RuntimeError("croniter not
installed")` instances.

We add to `StandingOrderRunner.start()`:

```python
async def _check_croniter_available(self) -> None:
    try:
        from croniter import croniter  # noqa: F401
        self._croniter_available = True
    except ImportError:
        self._croniter_available = False
        logger.warning(
            "croniter not installed — cron-kind standing orders disabled "
            "(install croniter to enable)."
        )
```

`check_and_fire_due_orders()` skips orders whose `parse_schedule()` returns
`CronSchedule` when `self._croniter_available is False`, emitting
`standing_order.skipped(reason="cron_no_schedule")` once per order per poll.
The single warning is logged exactly once per process — at runner startup —
not 100/tick.

**Rationale.** Fail-fast diagnostics with zero tick-time overhead.

**Back-compat.** When croniter IS installed (current Day-3 prod state), the
behaviour is identical to today.

---

## 3. ADRs — `tools-routes-replace`

### ADR-TRR-001 — Replace `/tools/timer` + `/tools/alarm` 501 stubs; drop `Timer` + `Alarm` tables

**Decision.** Replace the 501s at `routes_tools.py:33-52` with thin adapters
that insert `StandingOrder` rows. New module
`src/backend/tools/{timer,alarm}_adapter.py` translates the route DTO into
a `(schedule_spec, action_spec)` tuple:

| Route | Schedule produced | Action produced |
|---|---|---|
| `POST /tools/timer { duration_s, label }` | `OneShotSchedule(at = now_utc + timedelta(seconds=duration_s))` | `NotifyAction(title="Timer: <label>", body=f"<duration_s>s elapsed")` |
| `POST /tools/alarm { time:"HH:MM", repeat, label }` | `repeat="daily"` → `CronSchedule(minute=mm, hour=hh)`; `repeat="weekdays"` → `CronSchedule(minute=mm, hour=hh, day_of_week="1-5")`; `repeat="once"` → `OneShotSchedule(at=next-occurrence)` | `NotifyAction(title="Alarm: <label>", body="alarm time")` |

Both routes return `{order_id, fires_at}` (HTTP 201). DELETE routes are
out-of-scope for Day-4 (existing `/standing-orders/{id}` covers it).

The dead `Timer` and `Alarm` SQLAlchemy classes at `db/models.py:269-291` are
removed in T-5. A migration drops the `timers` and `alarms` tables; existing
rows (verified via `grep` to be schema-only and never written by product
code) are dropped without backup. Existing schema-only test
`test_phase00_scaffolding.py` (and any siblings) is updated to drop the
`Timer`/`Alarm` assertions.

**Rationale.** `U7-LRT-C2`: two tables that the codebase never queries are
liabilities (migration cost, schema drift, operator confusion). One
unified primitive (`StandingOrder` + `NotifyAction`) ships timer + alarm +
custom triggers from one path.

**Back-compat.** The 501 → 201 transition is strictly additive: no consumer
expects a 501. Frontend `api.ts` `createTimer`/`createAlarm` consumers
(blocked today by the 501) become fully functional.

### ADR-TRR-002 — KEEP `CalendarEvent`; wire `/tools/calendar` GET+POST

**Decision.** `CalendarEvent` table at `db/models.py:294-305` is preserved
unchanged. The route handlers at `routes_tools.py:55-74` are replaced with:

- `GET /tools/calendar?range=week|day|month` → reuses the date-window query
  shape from `ai/tool_executor.py:645-665` (a small refactor moves the query
  into `tools/calendar_adapter.py:list_events(user_id, start, end)` and
  the tool_executor reuses the new helper).
- `POST /tools/calendar/events` → reuses the create logic from
  `ai/tool_executor.py:701-720` via
  `tools/calendar_adapter.py:create_event(user_id, payload)`.

The route handlers depend on the existing `get_current_user` (or whatever
auth dependency the rest of `api/routes_*.py` uses) for `user_id` extraction.
Range parsing (`day|week|month`) is a small enum mapping — no LLM-style
freeform parser.

**Rationale.** ADR-TRR-002 closes the route coverage gap (frontend
`api.ts:getCalendar` is blocked by 501) without disturbing the LLM tool
path that already works.

**Back-compat.** `ai/tool_executor.py:645,701` is unchanged behaviourally —
its CalendarEvent reads/writes go through the same SQL, just behind a
shared helper.

---

## 4. Interfaces (Python type signatures, no implementation)

```python
# src/backend/agent/standing_orders/actions.py
from typing import Annotated, Literal, Optional, Union
from pydantic import BaseModel, Field, HttpUrl

class SpeakAction(BaseModel):
    kind: Literal["speak"]
    text: str
    voice: Optional[str] = None

class NotifyAction(BaseModel):
    kind: Literal["notify"]
    title: str
    body: str
    target_user_id: Optional[str] = None

class TaskAction(BaseModel):
    kind: Literal["task"]
    goal: str

class WebhookAction(BaseModel):
    kind: Literal["webhook"]
    url: HttpUrl
    method: Literal["GET", "POST"] = "POST"
    body: Optional[dict] = None

ActionSpec = Annotated[
    Union[SpeakAction, NotifyAction, TaskAction, WebhookAction],
    Field(discriminator="kind"),
]

class ActionOutcome(BaseModel):
    success: bool
    summary: str                   # short, ≤256 chars, used as last_outcome
    task_id: Optional[str] = None  # set when kind=="task"

def parse_action(raw: str | dict) -> ActionSpec: ...

async def dispatch_action(
    order: "StandingOrder",
    action: ActionSpec,
) -> ActionOutcome: ...
```

```python
# src/backend/agent/standing_orders/runner.py — additions

class StandingOrderRunner:
    async def recover_stale_leases(self) -> int:
        """Reconcile any in_flight orders whose lease exceeded TTL.
        Returns the count of leases released."""

    async def _claim_lease(self, order_id: str) -> bool:
        """Atomic UPDATE; returns True if this runner now owns the lease."""

    async def _release_lease(self, order_id: str, outcome: str | None) -> None:
        """Clear in_flight_task_id + claimed_at; optionally write last_outcome."""

    async def _normalise_schedule_timezones(self) -> int:
        """One-pass UTC migration for OneShotSchedule rows. Idempotent.
        Returns number of rows rewritten."""
```

```python
# src/backend/agent/runtime.py — additive read helper (next to update_task_status)
async def task_status(task_id: str) -> Literal["running","done","error","cancelled","missing"]: ...
```

```python
# src/backend/tools/timer_adapter.py
async def create_timer(
    user_id: str, duration_s: int, label: str
) -> tuple[str, datetime]: ...   # (order_id, fires_at)

# src/backend/tools/alarm_adapter.py
async def create_alarm(
    user_id: str, time_hhmm: str, repeat: Literal["daily","weekdays","once"], label: str
) -> tuple[str, datetime]: ...

# src/backend/tools/calendar_adapter.py
async def list_events(
    user_id: str, start: datetime, end: datetime, limit: int = 20
) -> list[CalendarEventDTO]: ...

async def create_event(
    user_id: str, payload: CalendarEventCreate
) -> CalendarEventDTO: ...
```

```python
# src/backend/config.py — additions next to lines 386-389
agent_standing_orders_lease_ttl_s: int = 300
agent_standing_orders_speak_timeout_s: int = 10
agent_standing_orders_webhook_timeout_s: int = 5
```

---

## 5. Test plan per block

### T-1 — `StandingOrder` lease columns + `recover_stale_leases`

`tests/test_phase04_t1_standing_order_leases.py`:

1. Migration adds `in_flight_task_id` + `claimed_at` columns; existing
   `test_phase09_3b_standing_orders.py` rows still queryable (back-compat).
2. `_claim_lease` returns `True` on first call; second concurrent call from
   a fresh session returns `False` (use SQLite reserved-row test pattern).
3. `recover_stale_leases` with three rows (one fresh-running, one stale-done,
   one stale-missing) reconciles to (running pinned, done released,
   missing released + re-fire on next tick). Asserts return count == 2.
4. Lease TTL config knob honoured: a row with `claimed_at = now - 299s` is
   NOT recovered when `lease_ttl_s=300`; same row at `now - 301s` IS.

### T-2 — Action-kind discriminator

`tests/test_phase04_t2_action_discriminator.py`:

1. `parse_action({"kind":"speak","text":"hi"})` round-trips through
   JSON serialise/deserialise.
2. Each of `notify | task | webhook` validates and rejects missing required
   fields with Pydantic ValidationError.
3. Legacy `{"goal": "x"}` payload (no `kind`) parses as `TaskAction(goal="x")`
   with deprecation warning emitted exactly once across N parses.
4. `dispatch_action` for `task` invokes `runtime.start_task` with
   `track="background"` + `origin="standing_order"` + `order_id` (mock
   runtime; assert call args).
5. `dispatch_action` for `notify` causes
   `event_bus.emit_async("notification.show", ...)`.
6. `dispatch_action` for `webhook` issues a single `httpx.AsyncClient` POST;
   non-2xx → `success=False`, summary contains status code; timeout →
   `success=False`, summary contains `"timeout"`.
7. `dispatch_action` for `speak` calls TTS provider with text + voice.
8. Migration backfills `action_kind` correctly: payloads with `"kind":"speak"`
   → `"speak"`; legacy goal-only → `"task"`.

### T-3 — event_bus topics + WS fan-out

`tests/test_phase04_t3_standing_order_events.py`:

1. After one tick with one due order: exactly one `tick`, one `fired`, zero
   `skipped` events captured by a test subscriber.
2. After one tick with one due order whose condition is false: zero `fired`,
   one `skipped(reason="condition_false")`.
3. After one tick with `TrackBusyError` raised by mocked runtime: one
   `skipped(reason="track_busy")`.
4. After one tick with lease already claimed (simulated via direct SQL UPDATE
   before tick): one `skipped(reason="lease_conflict")`.
5. WS multiplexer test: subscribe a fake WS client; trigger an emit; assert
   the client receives `{topic, data}` envelopes. Three topics, three
   envelopes.
6. Performance: 1 emit ≤ 100 µs measured via `time.perf_counter_ns()` x1000
   iterations / mean (gate: p50).

### T-4 — UTC normalisation + croniter import-check

`tests/test_phase04_t4_utc_and_croniter.py`:

1. `parse_schedule({"kind":"one_shot_future","at":"2026-04-29T08:00:00"})`
   (no tz) returns a `OneShotSchedule` whose `at.tzinfo is timezone.utc`.
2. `_normalise_schedule_timezones` rewrites a stored naive row; second
   invocation is a no-op (idempotent).
3. Mock `croniter` import to raise `ImportError`; runner.start() logs the
   warning exactly once; subsequent ticks with cron orders do NOT log
   again; the cron orders show up as `skipped(reason="cron_no_schedule")`.
4. With croniter installed (default), all existing
   `test_phase09_3b_standing_orders.py` cron tests remain green.

### T-5 — Replace Timer/Alarm 501 stubs; drop dead tables

`tests/test_phase04_t5_tools_timer_alarm.py`:

1. `POST /tools/timer {duration_s:60,label:"tea"}` → 201 with
   `{order_id, fires_at}`. DB row exists in `standing_orders` with
   `kind="one_shot_future"`, `action_kind="notify"`.
2. `POST /tools/alarm {time:"07:30",repeat:"weekdays",label:"wake"}` → 201;
   `kind="cron"`, `schedule_json` cron expr `"30 7 * * 1-5"`.
3. `repeat="once"` produces a one-shot at the next occurrence ≥ now in UTC.
4. Migration drops `timers` + `alarms` tables (assert via SQLAlchemy
   `inspect()` — they are absent post-migration).
5. Existing schema/scaffolding test
   (`test_phase00_scaffolding.py` or whichever asserts table presence) is
   updated to NOT expect `timers` / `alarms`.

### T-6 — Wire `/tools/calendar` GET+POST

`tests/test_phase04_t6_tools_calendar.py`:

1. `GET /tools/calendar?range=week` returns events in the next 7 days, max
   20, sorted ascending by `start_at`.
2. `POST /tools/calendar/events {title,start_at,end_at,…}` returns 201 with
   the persisted row (mirroring `ai/tool_executor.py:701-720`).
3. Same `CalendarEvent` query path used by `ai/tool_executor.py:645` still
   works after the helper extraction (sanity: existing chat-tool tests still
   green).
4. `range=day|month` enum mapping; invalid range → 422.

### Back-compat regression suite

The following pre-existing tests remain green without modification:

- `tests/test_phase09_3b_standing_orders.py` — runner happy path.
- `tests/test_phase09_3b_proactive.py` — STANDING_ORDER_FIRED proactive trigger.
- `tests/test_phase09_4a_standing_orders_background.py` —
  `track="background"` invariant.
- `tests/test_phase09_4a_track_runtime.py` — `start_task` semantics.
- `tests/test_phase09_4a_status_endpoint.py` — `/agent/status`.

---

## 6. Performance budgets

| Operation | Budget | Justification / measurement plan |
|---|---|---|
| `_run()` tick total (100 due orders) | **≤ 50 ms** | Today's `check_and_fire_due_orders` (runner.py:90-144) is O(N) over enabled rows + one DB read; lease claim adds one indexed `UPDATE` per due order; `dispatch_action` for `notify` is event_bus emit (≤100 µs). `task` kind defers to `runtime.start_task` which is non-blocking when the bg slot is free, returns `TrackBusyError` fast otherwise. 100 orders × (claim 200 µs + dispatch 200 µs) ≤ 40 ms; budget includes 10 ms margin. |
| `event_bus.emit()` per call | **≤ 100 µs** | Pure handler-list iteration (event_bus.py:56-68) + dict construction. Measured via `time.perf_counter_ns()` x1000 in T-3 test. |
| `recover_stale_leases()` at startup | **≤ 200 ms for 1000 stale rows** | One indexed SELECT + N round-trips through `runtime.task_status` (in-memory dict lookup) + N `UPDATE`s. Called once per process boot, not on hot path. |
| `_normalise_schedule_timezones()` at startup | **≤ 100 ms for 1000 one-shot rows** | One SELECT + per-row JSON parse + UPDATE. Also one-shot at boot. |
| `dispatch_action(webhook)` p99 | **≤ 5 s (timeout)** | Hard timeout via `httpx.AsyncClient(timeout=5)`. Failure path emits `standing_order.skipped(reason="dispatch_error")`. |

---

## 7. Back-compat invariants

| Invariant | Source | How preserved |
|---|---|---|
| `agent_standing_orders_enabled=False` → runner does not start | Day-3 contract; `runner.py:81-82` already guards each tick | `start()` continues to honour the flag; new `recover_stale_leases` runs only inside the enabled branch. |
| Existing `test_phase09_3b_*` suite green | Phase-9.3b acceptance | Lease columns are nullable + default NULL; legacy goal-only `action_json` payloads parse as `TaskAction` via the back-compat shim in `parse_action`; `track="background"` semantics unchanged. |
| Existing `test_phase09_4a_*` suite green | Phase-9.4a acceptance | `start_task(track="background", origin="standing_order", order_id=...)` call signature unchanged; `TrackBusyError` deferral path unchanged. |
| `STANDING_ORDER_FIRED` proactive trigger | `runner.py:194-209` | Moved into `dispatch_action` success path; emitted for every action kind (strict superset of today). Tests asserting it for `task` kind remain green. |
| `CalendarEvent` schema | `ai/tool_executor.py:645,701` | Untouched. Helper extraction is internal-only. |
| Frontend `api.ts` consumers | `api/routes_tools.py` | 501 → 201 is additive; consumers blocked today are unblocked. |

---

## 8. File-touch summary (for subsequent implementation phase)

```
src/backend/agent/standing_orders/runner.py        edit  (T-1, T-3, T-4, T-2)
src/backend/agent/standing_orders/schedules.py     edit  (T-4 UTC coerce in parse)
src/backend/agent/standing_orders/conditions.py    untouched
src/backend/agent/standing_orders/actions.py       NEW   (T-2)
src/backend/agent/runtime.py                       edit  (add task_status read helper)
src/backend/db/models.py                           edit  (T-1 cols, T-2 col, T-5 drop Timer+Alarm)
src/backend/db/migrations/<new>.py                 NEW   (T-1 + T-2 + T-5 migrations)
src/backend/api/routes_tools.py                    edit  (T-5, T-6)
src/backend/tools/timer_adapter.py                 NEW   (T-5)
src/backend/tools/alarm_adapter.py                 NEW   (T-5)
src/backend/tools/calendar_adapter.py              NEW   (T-6)
src/backend/api/websocket_hub.py                   edit  (T-3 fan-out)
src/backend/config.py                              edit  (lease_ttl + 2 timeouts)
src/backend/scripts/migrate_oneshot_utc.py         NEW   (T-4 ops script)
src/backend/tests/test_phase04_t{1..6}_*.py        NEW   (per-block coverage)
```

NO CODE CHANGES in this document — all editing happens in subsequent
T-1…T-6 implementation passes by their respective owners.
