# Will Engine — Ядро Єдиної Волі (Design Spec)

**Date:** 2026-06-26
**Branch:** companion-v2-phase-0
**Status:** Approved (design) → pending implementation plan
**Sub-project:** A of {A will-core, B live-chat, C embodiment, D spatial-goals}

## Motivation

PHANTOM today has the *organs* of a unified entity but no single will binding
them. Three continuous loops run independently — `ProactiveLoop` (initiative,
~30 s tick), `StandingOrderRunner` (scheduled tasks, ~10 s poll), `_context_loop`
(context snapshots) — plus an on-demand `mission` planner and a 7-horizon goal
tree (`goals_persistent`, whose own docstring says *"priority-sorted by the Will
Engine"*). Nothing drives that tree: no loop wakes up, reads "what am I trying to
achieve across all horizons", and takes the next step. The islands react; they do
not *want*.

The Will Engine is the missing conductor: a single persistent will that both
**drives** (visibly pursues goals between conversations) and **unifies** (every
behaviour traces to one goal hierarchy).

## Decisions (locked during brainstorming)

1. **Will both drives and unifies** — visible autonomous goal-pursuit AND coherence.
2. **Full autonomy within a budget** — acts on its own, reports post-facto; bounded
   by a daily budget, not by per-action approval gates.
3. **User seeds + entity generates** — operator sets top directions; the entity
   derives subgoals and proposes new goals from observing the user and the world.
   Partner, not servant.
4. **Architecture = Conductor (Approach 1)** — a new `WillLoop` sits *above* the
   existing loops, owns the goal tree, and conducts the islands as executors.

## Goals / Non-goals

**Goals**
- One slow deliberation loop that owns `goals_persistent` as the single source of intent.
- Each tick advances exactly ONE highest-value next step toward active goals (anti-bifurcation).
- Daily goal-tree expansion (decompose horizons) + daily reflective self-generation of new goals.
- A daily budget governor that hard-stops the will when spent; midnight reset.
- Post-facto reporting via a Will Journal queryable from chat.
- Existing loops subordinated, not rewritten.

**Non-goals (this sub-project)**
- Live chat streaming/latency (sub-project B).
- New embodiment/actuator coherence (sub-project C) — the will *uses* existing body
  actions only.
- New routing intelligence (sub-project D) — the will may *call* existing routing
  actions but builds no new geo logic here.
- Replacing or merging `ProactiveLoop` / `StandingOrderRunner` internals.

## Architecture

```
                    ┌─────────────────────────────────────┐
                    │            WillEngine                │
                    │  (agent/will/engine.py)              │
                    │                                      │
   goals_persistent │  WillLoop  ── tick every ~5 min ──┐  │
   (7-horizon tree) ─┤   sense → orient → decide-ONE →   │  │
                    │   act → record                     │  │
                    │            │                       │  │
                    │   BudgetGovernor (daily caps)      │  │
                    │   IntentMutex (arbitration)        │  │
                    │   WillJournal (post-facto report)  │  │
                    └────────────┼───────────────────────┘  │
                                 │ conducts                  │
        ┌────────────────────────┼─────────────────────────┐
        ▼                        ▼                          ▼
  AgentRuntime.start_task   StandingOrderRunner        ProactiveLoop
  (background tasks)        (executive arm: will       (narrowed to "when to
                            creates/disables orders)    voice it", gated by mutex)
```

The will never executes work inline. It **decides** and **dispatches**, then the
existing execution substrate does the work. This keeps the will small, reasoned-about
in one context, and testable in isolation with mocked dispatch.

## Components

Each unit: *what it does · interface · depends on*.

### `WillEngine` (`agent/will/engine.py`)
- **Does:** owns the loop lifecycle; holds BudgetGovernor, IntentMutex, WillJournal;
  exposes `start()`/`stop()` and a single-tick `run_once()` for tests.
- **Interface:** `await engine.start()`, `await engine.stop()`, `await engine.run_once(user_id, db) -> WillTickResult`.
- **Depends on:** AgentRuntime, goals repo, context_engine snapshot, ai_router (reasoning model), config.

### `WillLoop` (inside engine)
- **Does:** the `while not stopped` heartbeat; sleeps `will_tick_interval_s`; wakes
  early on a wake event (e.g., new seeded goal). Calls `run_once` per active user.
- **Interface:** internal `_run()`.
- **Depends on:** WillEngine.

### `goals` repository (`agent/will/goals.py`)
- **Does:** typed CRUD + queries over `goals_persistent` — active goals by horizon,
  children of, set_status, add/clear blockers, next-actionable leaf. No raw SQL in the loop.
- **Interface:** `list_active(user_id)`, `tree(user_id)`, `seed(user_id, description, horizon, ...)`,
  `decompose(goal_id, children)`, `set_status(goal_id, status)`, `pick_next_action(user_id) -> Goal|None`.
- **Depends on:** db models (`PersistentGoal`).

### `decide` (`agent/will/decide.py`)
- **Does:** the Decide-ONE reasoning step — given context snapshot + goal tree +
  budget remaining, returns a single `WillDecision` (one action, with rationale).
  Anti-bifurcation enforced here.
- **Interface:** `await decide_next(snapshot, tree, budget, db) -> WillDecision`.
- **Depends on:** ai_router (reasoning model), prompt builder.

### `BudgetGovernor` (`agent/will/budget.py`)
- **Does:** tracks the will's daily LLM-call/token spend; `can_spend()` gate; midnight
  reset; persists counters so a restart doesn't reset mid-day.
- **Interface:** `can_spend() -> bool`, `note_spend(calls, tokens)`, `remaining() -> Budget`.
- **Depends on:** config caps, a small persisted counter (DB row keyed by user+date).

### `IntentMutex` (`agent/will/arbitration.py`)
- **Does:** a single in-process lock representing "an intent is currently acting";
  ProactiveLoop checks it before interjecting so will + proactive never fire together.
- **Interface:** `async with intent_mutex.hold("will"):` / `intent_mutex.held_by`.
- **Depends on:** nothing (asyncio primitive).

### `WillJournal` (`agent/will/journal.py`)
- **Does:** append-only record of each non-trivial tick — decision, action,
  dispatched task id, outcome, budget delta. Surfaced via consciousness_stream and a
  chat query ("що ти робив?").
- **Interface:** `await journal.record(entry)`, `await journal.recent(user_id, n)`.
- **Depends on:** a `will_journal` table (or reuse `agent.kernel.audit`), consciousness_stream.

### New actions
- `will.seed_goal` (operator seeds VISION/YEAR via chat/UI) — `agent/actions/will_seed.py`.
- `will.status` (operator asks "what are you pursuing / what did you do") — read path
  over goals tree + journal.

## Data model

Reuse `goals_persistent` (already exists: id, user_id, parent_id, horizon_level 0–6,
description, owner_agent, kpi, deadline, blockers_json, status). Add **no** schema
change to goals if the existing columns suffice; add a `source` discriminator only if
needed to distinguish `seeded` vs `self_generated` (decide during planning — prefer
encoding in `owner_agent` or a status/`origin` column if one exists; otherwise a small
migration `025_will_goal_origin`).

New tables (migrations, created via existing `create_all` + numbered migration path):
- `will_budget_ledger` (user_id, date, llm_calls, tokens, updated_at) — daily counters.
- `will_journal` (id, user_id, ts, decision_json, action, task_id, outcome, budget_delta_json).

## The Will Tick (one cycle)

```
async def run_once(user_id, db):
    1. SENSE   snapshot = context_engine.get_snapshot()
               tree     = goals.tree(user_id)
               budget   = governor.remaining()
               if not config.will_enabled or not budget.ok: return SLEEP
    2. ORIENT  if day_rolled_over or no active DAY goal:
                   expand top horizons → child goals (mission planner as tool)
               once/day: reflective self-generation proposes new pending goals
                   from mind_state + narrative + ToM episodes
    3. DECIDE  decision = decide_next(snapshot, tree, budget)   # exactly ONE step
    4. ACT     async with intent_mutex.hold("will"):
                   dispatch decision via {start_task | standing_order | proactive_seed}
                   gate truly-irreversible actions through dangerous_patterns regardless
    5. RECORD  journal.record(...); goals.set_status/blockers; governor.note_spend(...)
```

Anti-bifurcation: step 3 returns one decision; the loop dispatches one thing per tick.
Long work runs as a background task; the will checks its outcome on a later tick.

## Budget governor + autonomy envelope

- **Daily caps** (config, conservative defaults): `will_daily_llm_calls` (e.g. 200),
  `will_daily_token_cap` (e.g. 300k). Spent → will sleeps until midnight local.
- **Free (reversible), no gate:** think, plan, decompose goals, read/research, prepare
  routes, soft body actions (e.g. expressive servo/voice within existing safety).
- **Gated regardless of autonomy:** external sends, spending money, physical motion
  beyond "soft", anything matched by `security/dangerous_patterns`. These keep their
  existing confirm path even under full autonomy.
- **Kill switch:** `will_enabled` (Settings, default **false**). Off = engine idle.
- **Board safety:** the will is the lowest-priority LLM consumer; it must respect the
  existing runtime budget/cooling and never run an LLM call while a foreground chat
  turn holds the provider (reuse `_runtime_note_llm_call`).

## Reporting (Will Journal)

Every non-trivial tick appends a journal entry and emits a consciousness_stream
"pending thought" so the next chat turn can weave in "between us, I did X". The
operator can ask in chat — `will.status` reads the goal tree + recent journal and
answers naturally (e.g. "Сьогодні я просунув ціль Y: підготував маршрут, запустив
фонову задачу Z, витратив ~40 викликів").

## Arbitration with existing islands

- **ProactiveLoop:** keeps deciding *when* to voice, but acquires `intent_mutex`
  (non-blocking try) before interjecting; if the will holds it, proactive defers.
  The will may also *seed* a proactive thought (the will decides the content).
- **StandingOrderRunner:** becomes the will's executive arm. The will creates/updates/
  disables standing orders (existing actions) to schedule recurring pursuit; the runner
  executes them unchanged.
- **mission planner:** invoked by the will as the decomposition tool (no behaviour change).

## Config (new keys, `config.py`)

```
will_enabled: bool = False                # master kill switch
will_tick_interval_s: int = 300           # 5-min deliberation cadence
will_daily_llm_calls: int = 200           # daily budget — calls
will_daily_token_cap: int = 300_000       # daily budget — tokens
will_reflect_hour_local: int = 4          # daily self-generation hour
will_max_active_day_goals: int = 3        # anti-sprawl on the DAY horizon
```

## Testing

Unit (mock LLM + mock dispatch), no live board load:
- decide-ONE returns exactly one action; never bifurcates.
- BudgetGovernor: gate opens/closes at caps; midnight reset; survives restart.
- IntentMutex: will + proactive never both act; proactive defers when will holds.
- goals repo: tree/decompose/pick_next_action/set_status correctness.
- Orient: day-rollover triggers expansion; reflective self-gen creates pending goals.
- Kill switch: `will_enabled=false` → engine no-ops.
- Journal: records decision/outcome/budget; `will.status` reads it back.

## Rollout

1. Ship behind `will_enabled=false`. Land code + tests green.
2. Enable manually with a tiny budget (e.g. 20 calls/day) and watch the journal for one day.
3. Raise budget once behaviour is trustworthy.
4. Then proceed to sub-projects B/C/D, each plugging into the same goal tree.

## Open knobs (sensible defaults chosen; tune in planning)

- Tick cadence (300 s), daily caps (200 calls / 300k tok), reflect hour (04:00),
  goal `source` discriminator (column vs encode). None block the design; all are
  config/migration details settled during the implementation plan.
