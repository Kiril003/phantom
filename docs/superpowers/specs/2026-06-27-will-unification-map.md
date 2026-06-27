# Will Unification Map — two will-layers into one soul

**Date:** 2026-06-27
**Context:** discovered while building the Will Engine (sub-project A). Captures
the relationship between the new conductor and the pre-existing motivational
layer, and the path to fully unify them.

## The two layers (both already share `goals_persistent`)

**1. Motivational layer — `agent/cognition/will/`** (pre-existing, committed)
- `drives.py` — `DriveSystem`: named drives with current_level/pressure, decay/tick,
  DB-backed. `dominant()` = strongest current need.
- `needs.py`, `values.py` — `ValuesSystem.evaluate(action_intent) -> ValueVerdict`
  (LLM value check against `values.md` doctrine).
- `identity.py` — `IdentitySystem.summary()` (who PHANTOM is), `self_narrative.md`.
- `goal_stack.py` — `PersistentGoalStack` reads/writes **`goals_persistent`**.
- Exposed at `/agent/will/state` (drives + dominant + identity) and
  `/agent/will/horizons` (goal tree).

**2. Conductor layer — `agent/will/`** (new, sub-project A)
- `goals.py` (repo over the SAME `goals_persistent`), `budget.py`, `arbitration.py`,
  `journal.py`, `decide.py` (decide-ONE), `reflect.py` (self-generation),
  `decompose.py` (tree deepening), `engine.py` (WillLoop: sense→orient→decide→act→record).
- Exposed at `/agent/will/journal` + `/agent/will/engine`.

**Key fact:** both operate on `goals_persistent`. They are already one entity at the
data layer — the goal tree IS the shared spine. The split is motivation (why) vs
conduct (when/how).

## What is bridged so far (2026-06-27)

- `engine._motivation()` composes `identity_system.summary()` + `drive_system.dominant()`
  and injects it into `decide_next`'s prompt → the conductor's goal choice is now
  coloured by who PHANTOM is and what it currently needs. First bridge. Best-effort,
  lazy, never fails a tick.

## Full unification path (next, in order)

1. **Values gate on ACT (safety + coherence).** Before the engine dispatches a
   `start_task`/`standing_order` whose `action_text` implies an irreversible/external
   effect, call `values_system.evaluate(action_text)`; if the verdict rejects, journal
   `outcome="vetoed_by_values"` and skip dispatch. Note: fix `ValuesSystem.values_path`
   — it currently points at `src/backend/agent/will/values.md` but the doctrine lives at
   `agent/cognition/will/values.md`. (Adds 1 LLM call only for risky decisions.)

2. **Drive satisfaction feedback.** When a will-dispatched task completes (journal
   outcome), call `drive_system` to mark the relevant drive satisfied
   (lower its pressure). Closes the motivation→action→satisfaction loop so drives
   actually move as the will acts.

3. **Identity grows from outcomes.** Periodically fold the will journal into
   `self_narrative.md` / `IdentitySystem` so PHANTOM's sense of self is shaped by what
   it has actually done — not a static file.

4. **Reflection consults values + drives.** `reflect.propose_goals` should receive the
   values doctrine + dominant drives as observations, so self-generated goals serve the
   entity's values, not drift.

5. **Retire the duplicate goal writer.** `goal_stack.PersistentGoalStack` and
   `agent/will/goals.py` both write `goals_persistent`. Pick the conductor's `goals.py`
   as the single writer; make `goal_stack` read-through or delegate, to remove the last
   structural fork.

## Why this matters

The operator's vision is ONE entity "smarter and better than a human", not a scheduler
bolted onto a mood model. Unifying these layers means every autonomous step is
chosen by identity, weighed by values, driven by needs, deepened by planning, and
remembered as experience — a single will, not two subsystems sharing a table.
