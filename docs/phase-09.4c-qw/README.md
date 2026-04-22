# Phase 9.4c-qw — Chat Context Quick Wins

**Branch:** `autonomous-run`
**Base HEAD:** `82ebe26` (after `v0.9.4c.1-hotfix`)
**Date:** 2026-04-22
**Driver:** behaviour audit `docs/behavior-audit-2026-04-22/README.md`

---

## What this phase did

The 9.4c-hotfix round fixed *infrastructure* bugs (Overpass UA, keep-alive,
no-op resolver replays). Chat still felt generic because all the data the
audit identified — browser localization, LocationHistory, Overpass results,
emotion vector — never made it into the LLM prompt.

This is the "wire the data into the prompt" round. Five focused fixes,
one commit each, each verifiable separately by chatting in the browser.

---

## Commit table

| # | Hash       | Subject                                                                | Files touched                                                                                                                                  |
| - | ---------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 | `efc479e`  | fix #1 unblock browser/IP localization in chat prompt                  | `ai/prompt_builder.py`, `tests/test_phase03.py`                                                                                                 |
| 2 | `30e0ef4`  | fix #2 RECENT PLACES block from LocationHistory                        | `ai/prompt_builder.py`, `api/routes_chat.py`, `tests/test_phase03.py`, `tests/test_phase09_4c_qw.py` (new)                                      |
| 3 | `ae5b03d`  | fix #3 NEARBY block from Overpass in chat prompt                       | `core/context_engine.py`, `ai/prompt_builder.py`, `tests/test_phase03.py`, `tests/test_phase09_4c_qw.py`                                        |
| 4 | `4240102`  | fix #4 purge test-fixture pollution from memory retrieval              | `scripts/cleanup_test_fixtures.py` (new), `memory/strategic_memory.py`, `tests/test_phase09_4c_qw.py`                                           |
| 5 | `9ecbb24`  | fix #5 EMOTION block in chat prompt (ported from tactical planner)     | `ai/prompt_builder.py`, `api/routes_chat.py`, `tests/test_phase03.py`                                                                           |

---

## What changed in the prompt

Pre-fix prompt (audit report, abbreviated):

```
PHANTOM identity / state / tone
USER alice / role / trust
RELEVANT MEMORY: [polluted by Fact 0/Place 0 fixtures]
TIME 14:30 mon
LOCATION: unknown (no GPS fix)        ← lied — browser had us in Ostrava
BODY breathing/stress
ENV temp/aqi
SYSTEM cpu/ram/ai
```

Post-fix prompt (real new sections in **bold**):

```
PHANTOM identity / state / tone
USER alice / role / trust
RELEVANT MEMORY: [filtered — fixtures dropped]
TIME 14:30 mon
LOCATION: Ostrava (browser, 75% confidence, ±2km), speed=0.0km/h    ← FIX #1
NEARBY (within 500m):                                                ← FIX #3
  • Cafe Aroma (amenity=cafe, 110m)
  • Stryiskyi Park (leisure=park, 350m)
  • ...
RECENT PLACES (last 24h):                                            ← FIX #2
  • Cafe Aroma (14:30 wed)
  • Lviv Library (11:05 wed)
  • ...
BODY / ENV / SYSTEM
INNER STATE: focused (focus=0.8 curiosity=0.5 concern=0.1 fatigue=0.0)  ← FIX #5
```

---

## Tests

|                                               |   Before |   After |
| --------------------------------------------- | -------: | ------: |
| `tests/test_phase03.py::TestPromptBuilder`    |        9 |     23  |
| `tests/test_phase09_4c_qw.py` (new)           |        — |     18  |
| Full backend suite                            |      706 |    738  |

`pytest -q` runtime: 192 s, 4 unraisable-warning notices (event-loop
close timing in async fixtures, pre-existing — not caused by these fixes).

All Quick Wins tests pass with 0 regressions across earlier phases (verified
against `tests/test_phase01.py` + `tests/test_phase02.py` + `tests/test_phase03.py`
= 182/182 in the regression sweep at fix #3).

---

## DB cleanup

`memory_facts` table contained 68 leftover `Fact N / Place N` rows at
~(50.0, 30.0) from earlier integration runs against the production DB.
The audit confirmed they were stealing top-K slots in spatial recall.

Two layers of defence:

1. **`scripts/cleanup_test_fixtures.py`** — idempotent one-shot DELETE
   against `memory_facts` plus a sweep of every `user_*` ChromaDB
   collection for the same pattern. Reports counts per layer.
2. **`_sync_retrieve` defensive filter** — drops any
   (`doc.startswith("Fact ")`, `meta.place_name.startswith("Place ")`)
   tuple from the post-query result. ChromaDB itself was already clean
   (verified via `embedding_fulltext_search`), so this is preventative.

**Execution status:** the script is shipped and tested but the DELETE
itself requires the backend uvicorn to release its write lock on
`phantom.db`. Run:

```bash
# After stopping the backend
cd src/backend
.venv/bin/python scripts/cleanup_test_fixtures.py
# Restart backend
```

Expected output: `INFO Deleted 68 rows from memory_facts (SQLite)`.
The defensive filter neutralises any leaked rows in the strategic-memory
prompt hint path immediately, independent of when the SQLite cleanup runs.

---

## How to verify each fix in the browser

After backend restart, open the chat panel and ask exactly these questions.

| Fix | Try this in chat                                          | Expected behaviour change                                                                  |
| --- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| #1  | "Де я зараз?"                                             | LLM names Ostrava (or wherever browser has you) instead of "не знаю / немає GPS". |
| #2  | "Де я був вчора?" / "Де я був сьогодні раніше?"           | LLM lists 3–5 named places from history with rough times.                                  |
| #3  | "Що тут поруч?" / "Де поїсти?"                            | LLM lists named OSM features (kafe, library, park) with distance in metres.                |
| #4  | Any chat after backend restart + cleanup script           | Less "Fact 0 / Place 0" noise in any LLM responses that quote memory hints.                |
| #5  | Trigger an agent task that elevates concern, then chat    | Subtle tone shift — chat references being concerned/focused only when emotion is salient.  |

If any of #1–#3 still answer "не маю доступу" / "не знаю", the snapshot
itself was stale at chat time — check `/api/v1/state` and confirm
`where.source != "none"` and `nearby` is populated.

---

## Time

Target: 2-3 h. Actual: ~1 h 45 min code + tests + commit overhead.

| Phase            | Time    |
| ---------------- | ------- |
| Recon (audit refresh, fixture inspection) | 10 min |
| Fix 1            | 12 min  |
| Fix 2            | 18 min  |
| Fix 3            | 25 min  |
| Fix 4            | 14 min  |
| Fix 5            | 15 min  |
| Verification gate + acceptance doc | 11 min |

---

## What's still open after this phase

The audit identified 9 root causes. This phase addresses items 1, 4, 5,
and partially 6. Three larger items remain (separate phases):

- **Tool-use protocol for chat** (audit #6 in full): `chat_tools.py` with
  `recall_location_history`, `get_nearby_places`, `search_memory`, wired
  through `ai_router.call_with_tools`. Estimated 4-6 h. The current
  Quick Wins make tools *less urgent* because the prompt now carries the
  data tools would have fetched, but tool-use is still the right end-state
  for follow-up questions across multiple turns.
- **Spatial-aware semantic recall** (audit #7): join
  `find_memories_near` results into ChromaDB hint blending. ~2 h.
- **Temporal anchor read-back** (audit #8): chat writes `TemporalAnchor`
  rows but never reads them on later turns. ~1 h.

---

## Honest assessment

What feels solidly improved:
- Chat now *knows where the user is* — the single biggest "this thing
  feels stupid" moment from the audit. One-line fix in `prompt_builder.py:85`
  was hiding the data that was already there.
- Chat can answer history-of-place questions ("де я вчора був?") from
  real DB data instead of hallucinating "не маю доступу".
- Top-K memory pollution is filtered at retrieval, even before the
  cleanup script physically runs.

What is shipped but not yet user-validated end-to-end:
- The user will test each fix in the browser between commits.
  Verification gate ran the test suite green; only browser confirmation
  is pending.
- Fix #4's SQLite DELETE has not yet executed against the production DB
  — that needs one backend restart cycle.

What is *not* solved by this phase:
- Cross-turn tool use (audit #6 full). Asking "and where exactly is
  that café?" still requires the LLM to remember from prompt context,
  not call back into the system.
- Persistent place-pinning across chat sessions.
- "PHANTOM should *act* on knowing my location" beyond just answering
  questions about it. Proactive triggers exist but aren't wired to chat
  output yet.
