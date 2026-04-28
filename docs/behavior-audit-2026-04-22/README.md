# PHANTOM OS — Behavior Audit

Date: 2026-04-22
Branch: `autonomous-run`
HEAD: `82ebe26` (post v0.9.4c.1-hotfix)
Mode: READ-ONLY. No code changes.

---

## Executive summary

Chat feels generic because the chat prompt is a **passive context dump**, not
a tool-use loop. The system prompt does include `where.place_name` and a top-5
ChromaDB memory hit list, but **no nearby places, no LocationHistory rows, no
TemporalAnchors, no emotion vector, and no tools** to fetch any of that on
demand. The LLM sees "LOCATION: Ostrava" plus 5 vector-similar fact strings
and is then asked a free-form question — when the user says "Де я вчора був?"
the LLM truthfully replies "не маю доступу" because *no part of yesterday's
location is in its prompt and no tool exists to look it up*. Memory hits use
semantic similarity on the raw user message, so a recently-stored geo fact
("Згадано місце: ВШБ") is only retrievable when the user mentions ВШБ again,
not when they say "пам'ятаєш мене?". On top of that, **no chat prompt is
logged anywhere** — `ai_tool_use_log` only records metrics — so we have no
in-system observability of what the LLM actually receives. (HIGH confidence
on every claim above; cited file:line below.)

The fix is integration, not capability. ChromaDB, LocationHistory, Overpass,
and the emotion vector all already exist and have data; the chat prompt
builder simply does not assemble them. Tool-use plumbing also exists for the
tactical planner but chat uses the no-tools `ai_router.generate()` path.

---

## Part B1 — Chat Prompt Trace

### B1.1 Entry point

| File | Line | What |
| --- | --- | --- |
| `api/routes_chat.py` | 207 | `POST /chat/message` → `send_message` |
| `api/routes_chat.py` | 448 | WS `chat` channel → `_ws_chat_handler` (parallel path) |
| `api/routes_chat.py` | 110 | `_build_ai_response` — single shared pipeline |
| `ai/prompt_builder.py` | 19 | `build_system_prompt` — assembles the prompt |
| `ai/provider.py` | 128 | `AIRouter.generate` — final LLM call (no tools) |

Both REST and WS paths feed into the same `_build_ai_response` (HIGH).

### B1.2 Prompt sections

What the LLM actually receives, derived from `prompt_builder.build_system_prompt`
(lines 37–113) plus the user message and recent history.

| # | Section | Included? | How formatted | Source |
| --- | --- | --- | --- | --- |
| 1 | Identity | YES | `PHANTOM_IDENTITY` (≈8 lines, Ukrainian) | `personality.py:12` |
| 2 | State behavior | YES | `CURRENT STATE: SHADOW\nТи в тіні. Спостерігай.` | `personality.py:22` |
| 3 | Tone (3 axes) | YES | `TONE: calm, friendly, evening_relaxed` | `personality.py:44` |
| 4 | User | YES | `USER: kiril, role=ROOT, trust=0.50` | `prompt_builder.py:52-58` |
| 5 | Language | YES | `LANGUAGE: uk` | `prompt_builder.py:61-67` |
| 6 | Memory hints | YES (top 5) | `RELEVANT MEMORY: ...; ...; ...;` | `prompt_builder.py:70-73` |
| 7 | Time | YES | `TIME: 19:11, wed` | `prompt_builder.py:81` |
| 8 | Location | YES | `LOCATION: Ostrava, speed=0.0km/h` | `prompt_builder.py:85-89` |
| 9 | Body | YES (when ESP32 present) | `BODY: breathing=18bpm, stress=0.3, state=normal` | `prompt_builder.py:91-95` |
| 10 | Env | YES (when ESP32 present) | `ENV: 22.0°C, aqi=?` | `prompt_builder.py:97-99` |
| 11 | System | YES | `SYSTEM: cpu=12%, ram=58%, ai=gemini` | `prompt_builder.py:101-107` |
| 12 | Extra-prompt setting | YES (if non-empty) | raw text from `config.ai_system_prompt_extra` | `prompt_builder.py:109-111` |
| **13** | **Nearby OSM features** | **NO** | — | not assembled anywhere in chat path |
| **14** | **LocationHistory rows** | **NO** | — | table is written-only by chat (anchor at line 362) |
| **15** | **TemporalAnchor rows** | **NO** | — | written every chat turn but never read back |
| **16** | **MemoryFact `place_lat/lon` neighbours** | **NO** | — | retrieval is semantic-only, not spatial |
| **17** | **Emotion vector** | **NO** | — | only assembled in tactical planner (`tactical.py:126`); chat prompt builder never imports `agent.emotion` |
| **18** | **Tool-use schema** | **NO** | — | `_build_ai_response` calls `ai_router.generate()` without `tools=`; chat has zero `call_with_tools` references |
| **19** | **Recent dialog turns** | YES (separate) | passed as `history` arg to provider, not into system prompt; cap = `config.chat_max_session_history` | `routes_chat.py:163-164` |

(All YES/NO HIGH confidence; verified by reading each cited line.)

### B1.3 Memory retrieval

Path: `_build_ai_response` → `retrieve_relevant(user_id, query=user_message, top_k=5)` → `_sync_retrieve` (`strategic_memory.py:87-116`) → ChromaDB
`collection.query(query_texts=[user_message], n_results=5)`.

What's passed to LLM: a list of up to 5 fact strings joined with `; `,
prefixed with `RELEVANT MEMORY:` (`prompt_builder.py:71-73`).

What this **does not** do (HIGH):
- Filter by recency
- Filter by user's current location
- Boost facts that share a `place_lat/lon` near current `where.lat/lon`
- Use any structured query, only raw user-message embedding

So a freshly-stored `MemoryFact(content="Згадано місце: ВШБ", place_name="VŠB",
place_lat=49.83, place_lon=18.16)` only resurfaces if the user types something
semantically close to "ВШБ" again. It will not surface for "пам'ятаєш мене?",
"де я вчора був?", "що в нас по плану?".

Sample of in-DB memory facts (most are test fixtures from prior phase tests,
which itself is a noise problem):

```
location_reference | Fact 0 | Place 0 | 50.0   | 30.0
location_reference | Fact 1 | Place 1 | 50.001 | 30.001
location_reference | Fact 9 | Place 9 | 50.009 | 30.009
```

So a vector search on "де я вчора був" would return these test strings if any
embedding similarity emerges — explaining why answers feel both generic *and*
sometimes off-topic.

### B1.4 Location injection

YES — present. `prompt_builder.py:85-89`:

```python
if where.get("fix"):
    place = where.get("place_name") or f"({where['lat']:.4f}, {where['lon']:.4f})"
    parts.append(f"LOCATION: {place}, speed={where.get('speed_kmh', 0):.1f}km/h")
else:
    parts.append("LOCATION: unknown (no GPS fix)")
```

Caveat (MEDIUM): the gate is `where.get("fix")`. `fix` is `True` only for
hardware GPS (`context_engine.py:292, 346`). When the user is on BROWSER /
IP / USER-stated source, `fix` is False even though `lat/lon/place_name` are
populated. So in the current test scenario (BROWSER 75% Ostrava) the prompt
likely says **"LOCATION: unknown (no GPS fix)"** instead of "LOCATION: Ostrava".

This is a one-line bug that single-handedly explains the "doesn't know where I
am" symptom. Verifying: `context_engine.py:343-346` only sets `fix=True` for
`gps_hardware`; browser/IP/user_stated sources update `lat/lon/source/confidence`
but leave `fix=False`. The prompt builder gate filters them out.

### B1.5 Emotion injection

NO — not in chat prompt (HIGH). Verified two ways:
1. `grep "emotion\|EmotionVector" ai/prompt_builder.py ai/personality.py
   ai/provider.py api/routes_chat.py` → empty.
2. The only emotion-aware prompt block is `tactical.py:126-157`
   (`_format_emotion_block`) which only runs in the agent planner.

Prior audit's claim ("Emotion engine adapts tactical prompt tone") is correct
*for tactical*; chat is unaffected.

### B1.6 Real prompt sample

**Cannot extract** — there is no prompt logging. `ai_tool_use_log` schema
(`db/models.py:396` / SQL dump):

```
id, task_id, step_idx, provider, model, tool_name, success, error_kind,
error_message, elapsed_ms, retry_count, timestamp, retry_after_s,
fell_through_to_fallback, cooling_triggered
```

No `prompt`, no `system_prompt`, no `user_message`, no `response`. Of the 107
rows, 100 are `tool_name='', provider='router'` (chat-path generate calls);
the remaining 7 are tactical tool-use. So the table confirms chat does flow
through `ai_router.generate()` and is observable in metrics, but the actual
text the LLM saw is unrecoverable.

This is itself a finding (gap #6 below).

A *reconstructed* prompt for the live test scenario (browser-located Ostrava
user asking "Де я вчора був?") based on the prompt builder code would look
roughly like:

```
Ти — PHANTOM, автономний AI-партнер. ...
CURRENT STATE: SHADOW
Ти в тіні. Спостерігай. Не ініціюй розмову.
TONE: calm, friendly, evening_relaxed
USER: kiril, role=ROOT, trust=0.50
LANGUAGE: uk
RELEVANT MEMORY: Fact 0; Fact 1; Fact 9; Згадано місце: ВШБ; Fact 7
TIME: 19:11, wed
LOCATION: unknown (no GPS fix)            ← because fix=False on BROWSER source
SYSTEM: cpu=12%, ram=58%, ai=gemini
```

Then the user message: `"Де я вчора був?"`. From this prompt the only honest
answer the LLM can give is "не маю доступу". The reply is correct given the
prompt; the prompt is the bug.

---

## Part B2 — Connection sanity

| # | Connection | State | Evidence | Fix complexity |
| --- | --- | --- | --- | --- |
| 1 | Chat ↔ Memory (ChromaDB) | WIRED but text-only | `routes_chat.py:139-160` calls `retrieve_relevant`, results land in prompt | small (already wired) |
| 2 | Chat ↔ Memory spatial | NOT WIRED | no SQL query of `MemoryFact` joining on `where.lat/lon` anywhere in chat path | small (~20 LOC SQL + format) |
| 3 | Chat ↔ Localization snapshot | WIRED but gated by `fix` | `prompt_builder.py:85`; `context_engine.py:346` only sets `fix=True` for hardware GPS | trivial (1-line: gate on `where.get('source') != 'none'` instead of `fix`) |
| 4 | Chat ↔ Nearby (Overpass) | NOT WIRED | endpoint exists (`routes_map.py:363`) but `routes_chat.py` has zero references to `nearby`, `overpass`, `features_near` | small (cache hits in context engine, then format top-N into prompt) |
| 5 | Chat ↔ LocationHistory | NOT WIRED | 98 rows, 92 with reverse-geocoded `place_name`. Zero queries of `LocationHistory` in chat path. | small for "yesterday" tool; medium for general retrieval |
| 6 | Chat ↔ TemporalAnchor | WRITE-ONLY | `routes_chat.py:362-381` writes anchors; nothing reads them back into prompts | small (last-N anchors block in prompt) |
| 7 | Chat ↔ Emotion | NOT WIRED | 0 imports of `agent.emotion` in chat path; emotion block only in `tactical.py:126-157` | trivial (copy `_format_emotion_block` style) |
| 8 | Chat tools available | NONE | `_build_ai_response` calls `ai_router.generate(...)` with no `tools=` arg; tool-use plumbing exists in `ai/tool_use.py` and is used only by `agent/planner/tactical.py:394` | medium (need to define a chat tool catalog: `recall_location_history`, `get_nearby`, `search_memory_by_place`) |
| 9 | Inner monologue emission for chat | NOT EMITTING | `emit_monologue` referenced only at `agent/loop.py:285, 492`. Chat handler never imports `monologue_emitter`. | small (best-effort emit when LLM answers) |
| 10 | Prompt observability | NONE | `ai_tool_use_log` is metrics-only (no prompt/response columns) | small (add nullable `prompt_excerpt`/`response_excerpt` columns) |

---

## Root cause ranked

1. **`fix=True` gate in `prompt_builder.py:85` filters out browser/IP/user-stated
   location.** Result: the LLM sees `LOCATION: unknown (no GPS fix)` even when
   the localization resolver knows the city. This single line is the biggest
   reason the user gets "Зрозуміло, ти в Остраві" only if the *user typed* it.
   (HIGH)
2. **Chat has no tools.** `ai_router.generate()` takes no `tools=`, so the LLM
   cannot ask `recall_location_history(days_ago=1)` or `get_nearby_places(500)`
   even when the existing endpoints would return useful data. The LLM is a
   single-turn chat completion, not an agent. (HIGH)
3. **Memory retrieval is text-only semantic search.** No spatial, no temporal,
   no recency boost. Fresh geo facts only resurface if the user re-types the
   same name; "пам'ятаєш мене?" gets vector noise. (HIGH)
4. **No nearby Overpass injection.** The user can see "Healthy Black Kale FOOD
   130m" in the UI sidebar but the LLM cannot. (HIGH)
5. **No emotion in chat prompt.** Tactical planner gets emotion-aware tone,
   chat does not — so tone always derives from `calculate_tone` (biosignal +
   trust + time-of-day) and never reflects current focus/curiosity/concern.
   (MEDIUM)
6. **TemporalAnchor and LocationHistory are write-only from chat's view.**
   Every turn writes a new anchor, but nothing reads them. (HIGH)
7. **Top-5 memory hints are diluted by leftover test fixtures** (`Fact 0
   Place 0 50.0 30.0` …). Real recent geo facts compete with synthetic test
   data for the 5 prompt slots. (MEDIUM — symptom, not root cause)
8. **No prompt observability.** `ai_tool_use_log` is metrics-only, so all
   future audits face the same "cannot show what the LLM saw" wall. (MEDIUM —
   blocks debugging more than user-facing UX)
9. **Chat doesn't emit inner monologue events,** so the live diagnostic panel
   shows "Inner monologue events: 0" during active chat. Cosmetic but
   reinforces the "nothing is happening" perception. (LOW)

---

## Recommended fix scope

### Quick wins (under 2 hours total)

These are 1- to 20-line changes that flip the user-visible smarts dial up
without inventing new subsystems.

1. **Fix the localization fix-gate** — `prompt_builder.py:85`:
   change `if where.get("fix"):` to
   `if where.get("source") not in (None, "none") and where.get("lat") is not None:`.
   Also include `source` and `confidence` in the formatted line so the LLM
   knows it's a coarse browser fix vs hardware GPS:
   `LOCATION: Ostrava (browser, 75% confidence, ±2km)`. ~3 LOC.
2. **Add a "RECENT VISITED PLACES" block** to the prompt — top 5 distinct
   `place_name` from `LocationHistory` in the last 24 h, sorted by recency.
   ~15 LOC SQL + format in `prompt_builder.py`. Answers "де я був вчора" out
   of the box without any tool-use.
3. **Add a "NEARBY" block** — the chat handler calls
   `context_engine.get_snapshot()` already; add a parallel best-effort fetch
   of `/map/nearby` (or directly `overpass.features_near`) cached by 60 s in
   `context_engine`, then format top-5 into prompt:
   `NEARBY: pizzeria 106m, Healthy Black Kale (food) 130m, ...`. ~25 LOC.
4. **Filter test-fixture facts out of chat retrieval** — quick guard in
   `_sync_retrieve` (`strategic_memory.py:107`): add a `where["category"] !=
   "test_fixture"` filter or, faster, a one-shot SQL `DELETE FROM memory_facts
   WHERE content LIKE 'Fact %' AND place_name LIKE 'Place %'`. Ask before
   deleting; this is fixture cleanup not a code fix.
5. **Inject emotion block in chat prompt** — copy the pattern from
   `tactical.py:126-157` into `prompt_builder.py`. Read emotion from the
   foreground agent slot's `SelfModel.emotion` if a slot is active, otherwise
   skip. ~20 LOC.

### Moderate (2–6 hours)

6. **Switch chat to `call_with_tools`** with a small chat tool catalog:
   - `recall_location_history(hours_ago: int) -> list[place_visit]`
   - `get_nearby_places(radius_m: int) -> list[feature]`
   - `search_memory(query: str, by_place_name: bool, by_proximity: bool) -> list[fact]`
   - `get_temporal_anchors(hours_ago: int) -> list[anchor]`
   This is the change that turns chat from passive prompt → agent. The
   `ai/tool_use.py` infrastructure is ready; `agent/planner/tactical.py:388-400`
   shows the call pattern. Allocate ~4 h for the catalog + handlers.
7. **Spatial memory recall** — extend `retrieve_relevant` (or add a sibling
   `retrieve_relevant_at(user_id, query, lat, lon, radius_km)`) that joins
   ChromaDB hits with `MemoryFact.place_lat/lon` proximity. Used by the new
   `search_memory(by_proximity=True)` tool. ~2 h.

### Deferred

- Adding columns to `ai_tool_use_log` for prompt/response excerpts — useful
  but lower urgency once the visible UX improves.
- Inner-monologue emission from chat — cosmetic; address once tool-use is in
  so the monologue has actual reasoning to emit.
- Real-NER memory categorisation upgrade — current regex classifier is fine
  enough; the bottleneck is what makes it into the prompt, not what gets
  stored.

---

## Honest assessment

"Чат тупий" is **almost entirely** explained by missing integration, not LLM
limitations. Gemini 2.0 Flash, given the actual data PHANTOM holds (current
city, last 24 h location history, 9 nearby OSM features, recent
TemporalAnchors, recent MemoryFacts), would answer most "де я", "що в нас",
"пам'ятаєш" questions naturally. The system instead hands the LLM a 12-line
status block that says "LOCATION: unknown" and 5 random vector hits, then
asks an open question and gets the only honest answer back.

After fixes #1–#5 (the quick wins, a single afternoon's work), the user
should see:
- "Де я?" → "В Остраві, browser-fix, точність ~2 км" (instead of "не знаю")
- "Де я вчора був?" → list of 3-5 named places from LocationHistory
- "Що тут поруч?" → 3-5 OSM features by name and distance
- Tone shifts visibly when emotion.concern or fatigue rises

After fix #6 (tool-use), chat starts looking like an actual agent: it asks
the system for what it needs instead of working from a pre-baked snapshot.
That is the qualitative jump from "passive AI" to "PHANTOM as designed".

If the user reports "chat is still dumb" after fix #1–#5, the next thing to
inspect is **history retention** — `chat_max_session_history` and how
`session_memory.get_history_dicts` trims; we did not audit that path here.

---

## Confidence summary

| Claim | Confidence |
| --- | --- |
| Prompt sections list (B1.2) | HIGH (read every line of prompt_builder) |
| `fix` gate filters browser source | HIGH (verified in context_engine.py:285-346) |
| Chat has no tools | HIGH (grep + read) |
| Emotion not in chat prompt | HIGH (grep returned empty + tactical block traced) |
| LocationHistory not read by chat | HIGH (grep) |
| 92/98 location_history rows have place_name | HIGH (sqlite count) |
| Reconstructed prompt sample (B1.6) | MEDIUM (no prompt log, code-derived) |
| Test-fixture noise in memory_facts | MEDIUM (sample showed 3 obvious fixtures, did not full-table check) |
| Tool-use is the qualitative jump | MEDIUM (engineering judgment, not measurement) |

---

## Time budget

Used: ~70 minutes (within target).
Files read: 7. SQL queries: 7. Greps: 14.
Findings count: 10 (within ceiling).
