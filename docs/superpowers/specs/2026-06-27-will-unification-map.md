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

## What is bridged so far

- `engine._motivation()` composes `identity_system.summary()` + `drive_system.dominant()`
  and injects it into `decide_next`'s prompt → the conductor's goal choice is now
  coloured by who PHANTOM is and what it currently needs. First bridge. Best-effort,
  lazy, never fails a tick.

## Full unification path — ALL FIVE SHIPPED (2026-06-27)

1. **Values gate on ACT — DONE** (`271c4c1` wired it; `f842639` made it real). The
   engine evaluates effectful `start_task`/`standing_order` decisions against the
   doctrine and journals `vetoed_by_values` on a confident rejection. Fixed
   `ValuesSystem.values_path` — was a non-existent CWD-relative path, so the gate
   silently used a generic fallback; now resolved module-relative to the real
   `agent/cognition/will/values.md`.

2. **Drive satisfaction feedback — DONE** (`9327e8d`). `finalize_task` rewards
   autonomy + achievement when a `origin=will` task completes (`DriveSystem.reward`
   satisfies + persists). Drives are `load()`ed at startup so the change survives a
   restart. Motivation→action→satisfaction is a closed loop.

3. **Identity grows from deeds — DONE** (`c845351`). Once per daily reflection,
   `agent/will/self_growth.grow_identity_from_journal` folds the character-defining
   journal entries (dispatched deeds + principled vetoes) into `self_narrative.md`.
   Also fixed `IdentitySystem.narrative_path` (same CWD bug as values). summary()
   feeds `_motivation`, so deeds → identity → next decisions is a real loop.

4. **Reflection consults values + drives — DONE** (`558e863`).
   `reflect._gather_observations` now carries the doctrine + dominant drive, so
   self-generated goals serve the entity's values and needs, not drift.

5. **Single goal writer — DONE** (`3aab50a`). `goals.py` is the sole INSERT path;
   `goal_stack.push` delegates to the extended `goals.seed` (priority components
   preserved). The last structural fork is gone — the two layers are one entity at
   data, motivation, conduct, and memory levels.

## Why this matters

The operator's vision is ONE entity "smarter and better than a human", not a scheduler
bolted onto a mood model. Unifying these layers means every autonomous step is
chosen by identity, weighed by values, driven by needs, deepened by planning, and
remembered as experience — a single will, not two subsystems sharing a table.
