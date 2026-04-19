# Phase 9.3a — Awakening Foundation Acceptance

- **Date:** 2026-04-19
- **Branch:** `autonomous-run`
- **Base tag:** `v0.9.2.3-cleanup` (9cf20a1)
- **Target tag:** `v0.9.3a-emotion-self`
- **Status:** **COMPLETE**

## Scope

Pre-9.3 hardening (AD-01, AD-02, AD-05, AD-06) + emotion vector + expanded
SelfModel. Foundation for 9.3b (proactive loop, standing orders, inner
monologue channel). Proactive/standing-order/monologue code NOT in this
phase — only hook points.

## Part 0 — AD-fixes

| ID | Title | Commit | Notes |
|---|---|---|---|
| AD-02 | Config hot-reload from DB | 8d3d946 | `reload_from_db()` helper + `validate_assignment=True`; PUT `/settings/{key}` now broadcasts `config.reloaded`. Latent-bug fix: invalid values no longer sneak through setattr. |
| AD-06 | blocked_quota DB persistence | d6ecff3 | Explicit `await db.commit()` in `update_task_status`. 4 regression tests pass without the fix (the live failure doesn't reproduce in isolation); fix is belt-and-suspenders minimal (~2 LoC) to pin the invariant against future async-session refactors. |
| AD-05 | Interruptible probe sleep | 7141dfb | `asyncio.wait_for(emergency_stop.wait(), timeout=interval)` replaces `asyncio.sleep`. STOP now short-circuits the probe within a scheduler tick instead of waiting up to 600s. |
| AD-01 | Browser caveat on SelfModel | 5b278e4 | `SelfModel.active_caveats` survives the 10-observation tactical window; resume-from-checkpoint populates; successful `browser.navigate` clears it. |

## Part 1 — Emotion vector (d93a74a)

Four-axis `EmotionVector` carried on SelfModel: focus, curiosity, concern,
fatigue. Values in [0, 1]. Structure:

- **Schema** (`agent/schemas.py`) — clamp() and a Ukrainian summary() function.
- **Event deltas** (`agent/emotion.py`) — 11 rules covering task lifecycle,
  action lifecycle, reflection verdicts (continue/revise/abandon branch),
  blocked_quota entry, user interruption, praise.
- **Decay loop** — background task drifts each axis toward baseline
  (focus=0.5, curiosity=0.5, concern=0.1, fatigue=0.0) every
  `agent_emotion_decay_interval_s` seconds (default 60s) at
  `agent_emotion_decay_rate` (default 0.05 per tick). Uses AD-02
  hot-reload for runtime tuning.
- **Prompt tone modulation** (`agent/planner/tactical.py`) — includes a
  ПОТОЧНИЙ СТАН block only when an axis has notably deviated from
  baseline (avoids prompt bloat on just-started tasks). Explicit
  instruction: emotion colours *monologue tone*, NOT decision-making.
- **UI** — `EmotionIndicator` renders four thin animated bars next to
  `SubstateIndicator`. Subtle by design.

## Part 2 — Expanded SelfModel (54bc4c7)

Three new surfaces on SelfModel, fully serialized into every planner
prompt via the existing `model_dump(mode="json")` path:

- **`relationships: dict[str, Relationship]`** — per-user `Relationship`
  (user_id, trust_level, interaction_count, last_interaction_at,
  known_preferences up to 10). Populated by chat handler on every
  authenticated send. Auto-inferred preferences DEFERRED to 9.3b.
- **`active_concerns: list[str]`** — FIFO cap 10, dedup refreshes
  position. Heuristic regex patterns match Ukrainian keyword hints
  (сумно → feeling down; втомився → fatigue; погано себе → not well).
  Future decay via `decay_stale_concerns()` — takes optional
  `last_refresh` map (deferred to 9.3b when the runtime will carry
  per-concern timestamps).
- **`recent_successes: list[str]`** — FIFO cap 5. Appended from
  `finalize_task` on `done` outcome only; failures don't go here.

## Hook points for 9.3b

| What 9.3b will consume | Where | File:line |
|---|---|---|
| Read emotion.fatigue to throttle proactive init | `agent/emotion.py` | emotion.py:~125 `update_emotion_on_event` |
| Emit proactive-suggestion based on recent_successes | `agent/runtime.py` | runtime.py finalize_task (record_success) |
| Inner monologue channel broadcast helper | `agent/runtime.py` | runtime._broadcast (add alongside emotion hook) |
| Standing-order trigger check | `agent/loop.py` | loop.py top-of-loop gate (insert before pause check) |
| Decay stale concerns on a 24h cadence | `agent/self_model.py` | self_model.py `decay_stale_concerns` (needs per-concern `last_refresh` timestamp map on runtime) |
| Relationship preference auto-extraction | `agent/self_model.py` | self_model.py `update_known_preference` (LLM classification task) |

## Test delta

| Suite | Baseline (9.2.3) | After 9.3a | Delta |
|---|---:|---:|---:|
| Backend (pytest) | 471 | **523** | +52 |
| Frontend (vitest) | 133 | **135** | +2 |

Breakdown:
- AD-02 hot-reload: 5 tests
- AD-06 DB persist: 4 tests
- AD-05 interruptible sleep: 2 tests
- AD-01 caveat: 7 tests
- Emotion vector: 15 tests
- SelfModel expansion: 19 tests (3 prompt integration tests double as planner regression)
- AgentPanel emotion indicator: 2 frontend tests

## Verification

- `cd src/backend && .venv/bin/pytest -q` → 523 passed in 163s
- `cd src/frontend && npx vitest run` → 135 passed

## Hard-don'ts honoured

- No proactive loop (deferred to 9.3b).
- No standing orders (deferred to 9.3b).
- No inner monologue WS channel (deferred to 9.3b).
- No multi-track.
- No cross-device.
- No new LLM providers.
- No refactoring for its own sake.
- Phase 0-8 code untouched except the necessary chat-handler hook (+17 LoC,
  best-effort, guarded against failure).
- Complex emotion semantics NOT added — four bounded axes, simple deltas,
  decay toward baseline.
- LLM-based concern extraction NOT added — regex only.

## 9.3b foundation assessment

**Ready.** 9.3b is free to build on top.

- Emotion axes are a clean signal source — proactive loop can read
  `fatigue > threshold` and back off, `concern < threshold` to allow
  standing-order suggestions.
- Relationships carry a stable `interaction_count` + `trust_level` —
  standing-order consent thresholds can gate on both without new schema.
- `recent_successes` list provides the "confidence-enough-to-suggest-X"
  signal without requiring runtime state beyond SelfModel.
- `active_caveats` and `active_concerns` share a consistent FIFO idiom —
  any 9.3b subsystem that wants to surface its own hints can follow the
  same pattern.
- Config hot-reload is in place so tunable knobs for proactive cooldown,
  emotion decay, standing-order windows can be added in 9.3b without
  restart friction.

## Known rough edges (carried into 9.3b)

- AD-03 (LOW) — McpStdioClient.close has no kill() fallback.
- AD-04 (LOW) — Ollama classifier substring false-positive risk.
- `decay_stale_concerns` is scaffolded but no-ops without a per-concern
  last-refresh timestamp map — 9.3b runtime will add this.
- `update_known_preference` is manual; auto-inference TBD.

## Commits

| Hash | Title |
|---|---|
| 8d3d946 | `phase-09.3a: AD-02 config hot-reload from DB` |
| d6ecff3 | `phase-09.3a: AD-06 fix blocked_quota DB persistence` |
| 7141dfb | `phase-09.3a: AD-05 interruptible sleep in blocked_quota loop` |
| 5b278e4 | `phase-09.3a: AD-01 browser caveat lives in SelfModel.active_caveats` |
| d93a74a | `phase-09.3a: emotion vector — event updates + decay + tone modulation + UI` |
| 54bc4c7 | `phase-09.3a: SelfModel — relationships, concerns, successes + chat hook` |
| (this) | `phase-09.3a: final acceptance — 9.3b foundation ready` |

## Final tag

`v0.9.3a-emotion-self` annotated at the final acceptance commit —
see `git show v0.9.3a-emotion-self` for the tag message.
