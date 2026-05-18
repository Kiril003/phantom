# Plan: Symbiont Diary — Chat/Memory Redesign

## Context

The current chat surface drifted into «список бабблів у 5 хардкоднутих тредах». The operator wants something that lives up to `DESIGN_BRIEF.md`'s «Він **не**: чат-бот з повідомленнями». PHANTOM already has the raw material — sensors, biosignals, 6-state FSM, backend ChromaDB with ONNX embeddings — but none of it is wired into the conversational surface. Items have only `text`, `role`, `seqNo`, `createdAt`. No location, no state, no emotion, no pins, no tags, no semantic recall.

Operator-confirmed direction: **Symbiont Diary (A)** with:

- **Single timeline** + tags (old OLYA / FAMILY / WHISPERS threads collapse into the main stream as tag-facets; VAULT stays as a separate locked bunker).
- **Event-triggered reflections** (not scheduled cron).
- **Pinning into system-prompt CORE FACTS** (UI strip can come later — start invisible).

Intended outcome: the chat surface becomes a symbiont's memory — every utterance is stamped with where/when/what state, surfaced through facets and a time rail rather than a flat scroll, semantically searchable, and decorated with PHANTOM-written reflections when something significant happens.

---

## Roadmap (5 commits)

### P4-3-5 — Foundation: stamps + thread→tag migration

Adds the data substrate for everything else.

**Files to modify:**

- `core-data/.../stream/StreamItemEntity.kt` — add columns:
  - `location_lat: Double?` / `location_lon: Double?` / `place_name: String?`
  - `phantom_state: String?` (DIALOGUE / FOCUS / GHOST / SENTINEL / SHADOW / DREAM)
  - `emotion_tag: String?` (calm / alert / stressed / playful / tired — derived from biosignals + tone parser at write time)
  - `pinned: Boolean = false`
  - `tags: String?` (CSV, e.g. `"olya,family"`)
- `core-data/.../stream/AppDatabase.kt` — bump version + add `Migration_N_to_N+1` adding the columns with NULL defaults (existing rows survive).
- `core-data/.../stream/StreamItemDao.kt` — new queries:
  - `byThreadSinceTagged(threadId, sinceMs, tagFilter)` for time+tag facet filters.
  - `pinned(threadId)` for CORE FACTS injection.
  - `updatePinned(id, pinned)` for the long-press toggle.
- `feature-stream/.../StreamViewModel.kt`:
  - At write-time (where StreamItem is appended/persisted), call a new `ContextStamper` that reads current location (already in `LocationContextProvider`), current FSM state, and current emotion (BiosignalEngine tone). Stamps populated on every item.
  - Old thread routing (`OLYA` / `FAMILY` / `WHISPERS`) → still resolves but injects an inbound-thread tag into `tags` and writes the item to a new `ThreadId.MAIN` (formerly `NOW`). Bubble keeps origin via tag; nothing is lost.
  - VAULT stays its own thread untouched.
- `feature-stream/.../domain/ThreadId.kt`:
  - Rename `NOW` semantically to `MAIN` (keep string id `"now"` to avoid migration); deprecate OLYA / FAMILY / WHISPERS as routable threads but keep the IDs as tag constants for backward-compat ingest.
  - `DefaultThreadRail` becomes `MAIN`, `VAULT`.

**New helpers:**

- `feature-stream/.../parse/ContextStamper.kt` — pure-Kotlin helper that takes `(LocationContext, FsmState, EmotionTone)` and stamps an item. Easy to JVM-test.

**Tests:**

- `ContextStamperTest` — pure stamping logic.
- `StreamItemDaoMigrationTest` (Room migration test) — verify schema bump preserves data.

**Verification:**

- Install. Open chat. Submit a message. `adb shell run-as local.phantom.companion.debug sqlite3 .../stream_items.db "SELECT id, text_content, location_lat, phantom_state FROM stream_items ORDER BY rowid DESC LIMIT 5;"` — last item has lat/lon/state populated.
- Existing OLYA items still readable (`SELECT thread_id, tags FROM stream_items WHERE thread_id='olya' LIMIT 3;`) — `thread_id='olya'` preserved, `tags` empty for pre-migration rows.

### P4-3-6 — Single-timeline UI + facet pills + time rail

Replaces the ThreadRail with the new diary surface.

**Files:**

- `feature-stream/.../ui/StreamScreen.kt`:
  - Drop top `ThreadRail`. Replace with `FacetBar` (Composable: horizontal scrollable pills: «Сьогодні» / «Тиждень» / «Все» / dynamic tag chips derived from `state.knownTags`).
  - Add right-edge `TimeRail` Composable (vertical, 6-12 month markers, dots coloured by dominant PHANTOM state in that band; tap → scroll LazyColumn to nearest item).
  - VAULT becomes a single locked pill on FacetBar; tap → navigates to the existing vault-locked stream view.
- `feature-stream/.../ui/widget/FacetBar.kt` (new) — pure Composable; state lives in VM.
- `feature-stream/.../ui/widget/TimeRail.kt` (new) — pure Composable; renders against a sparse summary of items.
- `feature-stream/.../StreamViewModel.kt`:
  - State adds `selectedFacets: Set<Facet>` (sealed: `TimeRange.Today`, `TimeRange.Week`, `TimeRange.All`, `Tag(name)`).
  - `visibleItems` derived from `state.items` ⊕ `selectedFacets`.
  - New `state.knownTags: List<String>` populated from a DAO `distinctTags()` query on the active thread.

**Existing patterns to reuse:**

- Glass card styling: `core-design/.../component/GlassCard.kt`.
- LazyColumn key= pattern already correct at `StreamScreen.kt:146`.
- `LocalStateAccent` for coloured dots on TimeRail.

**Verification:**

- Tap «Сьогодні» — only today's items render.
- Tap «#oly» (or whatever the original OLYA items get tagged as) — only those.
- Scroll TimeRail back to a month → LazyColumn jumps to that band.
- VAULT pill → existing locked surface, untouched.

### P4-3-7 — Pinning → CORE FACTS in system prompt

Long-press → pin → AI sees the pinned bubble in every future turn.

**Files:**

- `feature-stream/.../ui/widget/StreamItemRow.kt` (or wherever long-press is handled — currently no long-press menu wired) — add `combinedClickable` with `onLongClick` showing a `DropdownMenu` with «📌 Закріпити» / «📌 Відкріпити».
- `feature-stream/.../StreamViewModel.kt`:
  - `onEvent(StreamEvent.TogglePin(itemId))` updates `pinned` via DAO and refreshes state.
  - `buildSystemPrompt()` (or wrap existing `SystemPrompts.DEFAULT_PHANTOM` injection) now prepends a `[CORE FACTS:]` block containing all pinned text items in the active thread.
- `core-ai/.../SystemPrompts.kt` — add a method `withCoreFacts(facts: List<String>)` that returns the prompt with the block injected.

**Tests:**

- `SystemPromptsCoreFactsTest` — verify block is added in the right place (before identity? after? — let's put it right after `BREVITY_DISCIPLINE` so it's near the top and pre-cache).
- `StreamViewModelPinTest` — toggling pin updates the row and the next built history includes the bubble's text in the system prompt.

**Verification:**

- Pin a bubble. Restart app. Pin survives (DB persistence).
- Submit a new chat turn. Look at `adb logcat | grep -i "system prompt"` (or instrumentation log) — the pinned bubble's text is in the `[CORE FACTS:]` block.

### P4-3-8 — Event-triggered reflections

Reflections fire on real signals, not scheduled jobs.

**Triggers:**

- PHANTOM state transition into DIALOGUE from FOCUS/SHADOW for the first time in 4+ hours.
- Stress spike: `stress_level` rises from ≤ 0.3 to ≥ 0.6 within 10 min window.
- New place: location enters a `place_name` operator hasn't visited in the last 30 days.
- Big topic shift: rolling cosine drift > 0.5 on the last 5 AI assistant turns (requires P4-3-9 embeddings — so this step **blocks on P4-3-9** for the topic-shift trigger; the other 3 triggers can ship first).
- Cooldown: max 1 reflection per 2 hours.

**Files:**

- `feature-stream/.../reflection/ReflectionTrigger.kt` (new) — pure-Kotlin policy. Inputs: state transition, biosignals delta, location delta, time-since-last-reflection. Output: `ReflectionTrigger.Decision.Emit(reason)` or `Skip`.
- `feature-stream/.../reflection/ReflectionEmitter.kt` (new) — when policy fires `Emit`, asks the AI router for a short markdown reflection (system instruction: «напиши 3-4 речення про те що ти помітив у користувача за останні години, врахуй причину: {reason}»), then injects the result as a `markdown` widget into the stream.
- `feature-stream/.../StreamViewModel.kt`:
  - Subscribes to FSM transitions, biosignal flow, location flow.
  - Routes each transition through ReflectionTrigger; on `Emit`, calls ReflectionEmitter.

**Tests:**

- `ReflectionTriggerTest` — JVM. Pin all four trigger conditions + cooldown.

**Verification:**

- `adb shell` simulate biosignal spike: write to a debug Intent that the operator-mode dev panel exposes (or inject via test hook). Reflection appears within a few seconds.

### P4-3-9 — Backend embedder wiring + semantic recall widget

Now the chat becomes searchable by meaning, not LIKE.

**Files:**

- `phantom-os/.../backend/api/routes_memory.py` — new endpoint `POST /memory/index_chat`. Accepts `{user_id, item_id, content, metadata: {location, state, tags, ts}}`. Stores in user's Chroma collection under category `chat_shard`.
- `phantom-os/.../backend/api/routes_memory.py` — new endpoint `POST /memory/recall_chat`. Accepts `{user_id, query, limit}`, returns `{shards: [{item_id, snippet, score, metadata}]}`.
- `phantom-os/.../backend/ai/chat_tools.py` — new `recall_chat_shards` tool the AI can call when operator asks «що ми про X?».
- `phantom-os/.../backend/ai/chat_pipeline.py` — the existing `_auto_render_envelope` shortcut path adds a `recall_chat_shards` branch that emits a `recall-result` widget envelope to the Android side.
- Android `core-ai/.../route/GeminiCloudRoute.kt` — no change (passthrough).
- Android `feature-stream/.../net/ChatShardIndexer.kt` (new) — fire-and-forget POSTs every finalized text item + widget summary to backend `/memory/index_chat`. Best-effort; failure does not block stream UI.
- Android `feature-stream/.../ui/widget/RecallResultWidget.kt` (new) — renders the `recall-result` envelope: collapsed shards with snippet + tap-to-jump-to-item-in-stream.
- Android `feature-stream/.../ui/widget/WidgetRenderer.kt` — register `recall-result` type.
- `core-ai/.../SystemPrompts.kt` — envelope §15 + rule: «коли оператор питає про щось зі своєї історії — використай тул `recall_chat_shards`, а потім поверни `recall-result` envelope».

**Verification:**

- Submit several chat messages mentioning «піца», then ask «що ми про піцу?». AI calls `recall_chat_shards` → emits `recall-result` widget → 2-3 shards land as collapsed cards.

### P4-3-10 — Auto-tagging via topic clustering

Sunday night job runs HDBSCAN over the week's embeddings → emits tag pills.

**Files:**

- `feature-stream/.../work/TopicClusterWorker.kt` — WorkManager periodic worker, fires Sunday 03:00 (per `workmanager_for_oem_battery_kill` memory; must use WorkManager not coroutine schedulers).
- Worker queries backend `/memory/cluster_chat?since=...&user_id=...` (new backend endpoint), gets cluster labels + member item-ids, writes tags into `stream_items.tags` via DAO.
- FacetBar (from P4-3-6) re-renders with the new tags surfaced.

---

## What this all builds toward

A chat surface where:

- Every utterance carries the **context of its moment** (state, place, mood).
- The operator scrolls a **single life-timeline**, not 5 buckets, with **facets** and a **time rail** to zoom.
- PHANTOM **interjects reflections** when something real happens, not on a schedule.
- The operator can **pin** facts that matter; PHANTOM stops forgetting them.
- The operator asks «що ми про X?» and gets **semantic recall**, not Ctrl-F.
- Topics **self-organise** weekly; tag pills materialise from the actual life of the operator, not a hardcoded ontology.

Nothing in this redesign breaks the existing widget catalog or the AI envelope contract. The new surface composes with markdown / table / artifact / progress / diff / comparison.

---

## Critical files reference

| File | Role |
|---|---|
| `core-data/.../stream/StreamItemEntity.kt` | new columns: lat/lon/place/state/emotion/pinned/tags |
| `core-data/.../stream/AppDatabase.kt` | Room migration N→N+1 |
| `core-data/.../stream/StreamItemDao.kt` | tagged queries, pin update, distinctTags() |
| `feature-stream/.../parse/ContextStamper.kt` | new — pure stamping logic |
| `feature-stream/.../domain/ThreadId.kt` | MAIN consolidation, OLYA/FAMILY/WHISPERS demoted to tag constants |
| `feature-stream/.../StreamViewModel.kt` | stamp on write, facet state, pin handling, reflection trigger sub |
| `feature-stream/.../ui/StreamScreen.kt` | FacetBar + TimeRail replacing ThreadRail |
| `feature-stream/.../ui/widget/FacetBar.kt` | new |
| `feature-stream/.../ui/widget/TimeRail.kt` | new |
| `feature-stream/.../ui/widget/RecallResultWidget.kt` | new |
| `feature-stream/.../reflection/ReflectionTrigger.kt` | new |
| `feature-stream/.../reflection/ReflectionEmitter.kt` | new |
| `feature-stream/.../net/ChatShardIndexer.kt` | new |
| `feature-stream/.../work/TopicClusterWorker.kt` | new — WorkManager |
| `core-ai/.../SystemPrompts.kt` | + CORE FACTS injection + recall envelope §15 + topic-shift rule |
| `phantom-os/.../backend/api/routes_memory.py` | new endpoints |
| `phantom-os/.../backend/ai/chat_tools.py` | `recall_chat_shards` tool |
| `phantom-os/.../backend/ai/chat_pipeline.py` | recall envelope shortcut |
| `docs/COMPANION_CONTRACT.md` | §13 Chat Memory contract |

---

## Verification (end-to-end after all five commits)

1. Open chat → submit «привіт, я у Львові, втомився». DB row carries lat/lon, `phantom_state=DIALOGUE`, `emotion_tag=tired`.
2. Long-press the message → «Закріпити». Restart app. Submit a fresh turn — `adb logcat` shows the bubble's text in `[CORE FACTS:]` of the system prompt.
3. Tap «Тиждень» pill — list scrolls to last 7 days. Tap a TimeRail month marker — list jumps.
4. Old OLYA items render with `#oly` tag chip; tap chip → filtered.
5. Submit 5 short messages about pizza. Wait 1 minute. Ask «що ми про піцу?» — AI emits `recall-result` widget with 3 shards.
6. Force a stress spike via dev-mode injection. Within ~10 s a `markdown` reflection bubble appears: «Помітив, що ти останні хвилини у напрузі — все ок?».
7. After a week of chat: «Білд» / «Сон» / «Робота» tag pills appear in FacetBar automatically.

---

## Open follow-ups (NOT in this plan, but expected after)

- UI strip showing pinned items above stream (deferred per operator's «сам вирішуй» — starting with system-prompt-only; revisit after V1).
- BPE-accurate token budget (current HistoryBudget is char-based; works but conservative).
- Operator-editable reflections (V1 only allows inspecting; editing canonicalises memory).
- Vault → biometric-gated semantic recall (V1 keeps vault stream out of the index).
