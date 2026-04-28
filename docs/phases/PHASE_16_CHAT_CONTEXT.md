# PHASE 16 — Chat Context Expansion

**Status:** acceptance criteria met 2026-04-28.
**Tag:** `v0.16.0-chat-context`.
**Driver:** [behavior-audit-2026-04-22](../behavior-audit-2026-04-22/) + [audit-2026-04-28](../audit-2026-04-28/) FINDINGS step 4.

## Goal

Make the chat prompt carry the autobiographical signal PHANTOM already collects:
recent visited places (LocationHistory), nearby points of interest (Overpass cache),
and the agent's own emotional state. Add per-turn observability so prompt
section drift is visible in operator dashboards rather than only on staring at
ai_router.generate logs.

## Scope

The behavior audit identified five injection gaps; one of them (the
`fix`-flag localization gate at prompt_builder.py:85) was a Block B quick win
covered separately. The remaining four:

| # | Sub-task | Status entering Block C |
|---|----------|--------------------------|
| 1 | Inject RECENT VISITED PLACES (top-5 distinct from LocationHistory, last 24h) | Already wired in `routes_chat.py:192` + `prompt_builder.py:179` |
| 2 | Inject NEARBY block (top-5 OSM features from Overpass cache) | Already wired in `prompt_builder.py:270` via `snapshot["nearby"]` |
| 3 | Inject emotion block (focus/curiosity/concern/fatigue) | Already wired in `routes_chat.py:197-227` + `prompt_builder.py:117` |
| 4 | Add prompt-excerpt logging to `ai_tool_use_log` | **This commit.** |

Sub-tasks 1-3 had been delivered by an earlier Phase-9.4c-qw push but not
captured in a phase doc. This commit acknowledges them by wiring sub-task 4
(the missing observability layer) so we can verify the others actually fire
on every turn.

## What changed in this commit

### Schema

`db/models.py::AiToolUseLog` gains four nullable columns:

| Column            | Type            | Purpose |
|-------------------|-----------------|---------|
| `user_id`         | `VARCHAR(36)`   | Owner of the turn — indexed for per-tenant queries |
| `prompt_excerpt`  | `TEXT`          | Truncated system prompt (first N chars, N = `chat_prompt_excerpt_max_chars`) |
| `response_excerpt`| `TEXT`          | Truncated AI response |
| `prompt_sections` | `VARCHAR(256)`  | Comma-separated section flags: `identity,state,tone,user,memory,recent_places,nearby,emotion,body,env,system_meta` |

Migration: `db/migrations/004_chat_prompt_log.py` is idempotent — checks
`PRAGMA table_info` before each `ALTER TABLE ADD COLUMN`, creates
`ix_ai_tool_use_log_user_id` via `CREATE INDEX IF NOT EXISTS`.

### Config

Two new keys in `config.py`:

| Key                                 | Default | Purpose |
|-------------------------------------|---------|---------|
| `chat_prompt_logging_enabled`       | `False` | Privacy-conscious off-by-default; operator opts in via Settings UI. |
| `chat_prompt_excerpt_max_chars`     | `800`   | Truncation budget — keeps the row cheap and the operator's privacy expectation honoured. |

### Writer hook

`api/routes_chat.py::_build_ai_response` writes one row to `ai_tool_use_log`
per turn when the flag is enabled. Wrapped in `try/except` and logged at
DEBUG so a failed write never propagates into the chat reply path.

`_detect_prompt_sections(prompt)` is a small marker-substring scan that
returns the comma-separated flag string. Markers are tuned for the current
`build_system_prompt` layout (`PHANTOM`, `CURRENT STATE:`, `TONE:`, etc.)
and live in `_PROMPT_SECTION_MARKERS` so future prompt-shape changes carry
their own marker update.

### Tests

`tests/test_phase16_chat_observability.py` (7 cases):

- `_detect_prompt_sections`: empty / full / minimal prompts.
- `write_log` persists chat columns when supplied.
- `write_log` stays backward compatible — pre-existing call sites that
  don't pass chat fields keep working with all new fields NULL.
- Config defaults — flag is `False`, max_chars is in 200..4000 sweet spot.

## Acceptance

- ✅ `pytest src/backend/tests/test_phase16_chat_observability.py` — 7/7.
- ✅ Full backend pytest: **1064 / 1064** (was 1057 before B-3, +7 from this).
- ✅ `_detect_prompt_sections("PHANTOM is...\nCURRENT STATE: ...\nRECENT PLACES (last 24h):\n...")` returns `identity,state,recent_places`.
- ✅ Migration is idempotent: `apply_pending(engine)` is safe to re-run on a DB that already has the columns.
- ✅ `chat_prompt_logging_enabled` is `False` by default — operators must opt in.

## Out of scope (deferred)

- **Frontend dashboard** for the new columns — operator queries SQLite
  directly today. Operations dashboard lands in Block E (Phase 18 SaaS
  productisation) once `/metrics` and structured logs are in place.
- **Settings UI toggle** for the new flag — auto-rendered by the existing
  `routes_settings.py` mechanism, but no `chat_prompt_logging_enabled`
  category metadata yet. Will be auto-picked up on next category sync.
- **PromptSection structured object** (architecture audit F-53) — would
  let `build_system_prompt` self-report active sections instead of relying
  on marker grep. Tracked under Phase-19 architectural cleanups.

## Block C closing notes

Phase 16 originally listed 5 steps with full re-implementation of sub-tasks
1-3. Discovery: those sub-tasks were already shipped under
`Phase-9.4c-qw` in an earlier session — the behavior audit predated the
fix. Block C therefore narrows to a single observability commit that makes
the prior work measurable. Net effect: chat now feeds the LLM RECENT
PLACES + NEARBY + emotion (already), and every turn is observable for the
opt-in operator (this commit).
