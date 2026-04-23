# Phase 9.5 — UI + prompt polish

**Date:** 2026-04-23
**Branch:** `autonomous-run`
**Pre-phase baseline commit:** `b4f5ea2`
**Tag:** `v0.9.5-ui-prompt-polish` (applied on success)

---

## Summary

Four low-risk items and one prompt-engineering change based on the scope audit
in `docs/phase-09.5-scope-audit/README.md`:

1. Response-form guidance block injected into chat system prompt (`personality.py` + `prompt_builder.py`).
2. `respond_text` removed from the Gemini/Ollama tool catalog (`response_formatter.py`).
3. Voice sidebar button now auto-fires the mic on Dialogue mount (Option B).
4. "System core" → "System" with a distinguishing tooltip.
5. Ghost menu item hidden entirely for non-ROOT users (was leaking with a disabled "(root only)" label).

---

## What shipped

### 1. Response-form guidance (chat only)

- `src/backend/ai/personality.py` — removed the single line
  `Ти сам вибираєш форму відповіді (text/chart/map/terminal/code/mixed).`
  from `PHANTOM_IDENTITY` (which is also fed to the tactical planner) and
  added a new chat-scoped constant `RESPONSE_FORMS_GUIDANCE` with 7
  concrete trigger → form examples plus an explicit negative nudge away
  from plain text.
- `src/backend/ai/prompt_builder.py` — `build_system_prompt` now appends
  `RESPONSE_FORMS_GUIDANCE` as the final block. Only called from
  `routes_chat.py:_build_ai_response` — planner (`agent/planner/tactical.py`)
  uses its own `_SYSTEM_PROMPT_UA` and is untouched.

### 2. `respond_text` dropped from tool catalog

- `src/backend/ai/response_formatter.py` — `RESPONSE_FORM_TOOLS` now has **7
  entries** (was 8). `_FORM_MAP` retains the `respond_text → "text"`
  mapping so if Gemini ever emits the stray function call anyway, it's
  still coerced to the text form. `parse_plain_text()` fallback is the
  authoritative plain-text path.

### 3. Voice sidebar → auto-trigger mic (Option B)

- `src/frontend/src/stores/uiStore.ts` — new transient flag
  `pendingVoiceActivation`.
- `src/frontend/src/components/core/FloatingToolbar.tsx` — `openVoice`
  sets the flag + navigates to Dialogue.
- `src/frontend/src/components/chat/ChatWindow.tsx` — `useEffect`
  consumes the flag (clears it first) and fires `toggleVoice()` only
  when the recorder is idle.

Rationale for choosing B over A (remove): user muscle memory preserved
and the two buttons now have distinct semantics (Dialogue = open chat,
Voice = open chat AND start listening).

### 4. System-core button naming

- `src/frontend/src/components/core/FloatingToolbar.tsx` — label
  `System core` → `System`, added `tooltip: 'System — CPU / RAM / processes'`.
  New optional `tooltip` field on `ToolbarAction` feeds both
  `ToolbarIcon` and `MoreMenuItem` `title` attributes (falls back to
  `label`). Also set `tooltip: 'Tactical map'` on Map to disambiguate
  the two FOCUS-state destinations.

### 5. Ghost button — non-ROOT hidden

- `src/frontend/src/components/core/FloatingToolbar.tsx` — secondary
  menu now split into `secondaryAll` + filter; the Ghost entry is
  removed from the rendered menu entirely for non-ROOT users. Prior
  label `"Ghost (root only)"` deleted. Complies with CLAUDE.md rule #6
  (secret features native, no UI leakage).

---

## Test count delta

| Suite    | Before | After | Delta |
|----------|--------|-------|-------|
| Backend  | 743    | 746   | +3    |
| Frontend | 178    | 178   | 0     |

Backend adds:
- `TestPersonality.test_phantom_identity_no_response_form_line`
- `TestPersonality.test_response_forms_guidance_has_triggers`
- `TestPromptBuilder.test_build_contains_response_forms_guidance`

Plus `TestResponseFormatter.test_tools_list_has_all_forms` updated to
reflect the 7-tool catalog + new negative assertion on `respond_text`.

No frontend test regressions — the existing ChatWindow voice-toggle test
still exercises direct mic clicks and is unaffected by the new
`pendingVoiceActivation` path.

---

## Live test results

### Setup
- Backend started with default `.env` — provider resolved to **Gemini 2.0 Flash**
  (Gemini key present in environment, not in repo `.env`).
- Fresh session, JWT minted for ROOT user `phantom`.
- 18 diverse Ukrainian queries fired sequentially at
  `POST /api/v1/chat/message`.

### Pre-phase baseline

```
SELECT response_form, COUNT(*) FROM chat_messages WHERE role='assistant';
text|25        ← 100%
```

### Third live-test run (clean 18/18, phase_start `2026-04-23T18:04:29Z`)

```
SELECT response_form, COUNT(*)
FROM chat_messages
WHERE role='assistant' AND created_at > '2026-04-23 18:04:29'
GROUP BY response_form ORDER BY COUNT(*) DESC;

text         | 7   (39%)
metric_cards | 5   (28%)
code         | 3   (17%)
terminal     | 2   (11%)
map          | 1   ( 6%)
```

**Distinct forms: 5. Text share: 39% (well under the 80% failure gate).**

### Per-query transcript (final run)

| # | Query                                                   | Form         | Verdict |
|---|---------------------------------------------------------|--------------|---------|
| 01 | як погода?                                              | text         | OK — model has no weather data, text is honest |
| 02 | де я?                                                   | text         | Acceptable — no GPS fix; model admits |
| 03 | покажи навантаження системи                              | metric_cards | ✓ exact target form |
| 04 | напиши функцію на Python яка додає два числа             | code         | ✓ |
| 05 | котра година?                                           | metric_cards | ✓ richer than plain text |
| 06 | виконай ls -la                                          | terminal     | ✓ |
| 07 | що ти вмієш?                                            | text         | OK — open-ended capabilities answer |
| 08 | як справи?                                              | text         | OK — small talk |
| 09 | привіт                                                  | text         | OK — greeting, text is correct |
| 10 | покажи мої нещодавні місця                              | map          | ✓ used RECENT PLACES block |
| 11 | який зараз заряд батареї?                                | metric_cards | ✓ |
| 12 | покажи код hello world на js                            | code         | ✓ |
| 13 | скільки вільної пам'яті?                                | metric_cards | ✓ |
| 14 | намалюй діаграму залежностей системи                     | text         | Missed — expected respond_diagram; model asked for component list instead |
| 15 | як довго я працюю за компом?                            | terminal     | Acceptable substitute (uptime via command) |
| 16 | скільки cpu відсотків зараз?                            | metric_cards | ✓ |
| 17 | напиши bash скрипт для копіювання файлу                 | code         | ✓ |
| 18 | покажи тренд температури за день                         | text         | Missed — expected respond_chart; model didn't emit one |

15 of 18 hit the targeted structured form or a reasonable substitute;
3 of the "hardest" queries (open-ended or no data to back the form)
stayed text. This is the expected behaviour of the guidance block — it
nudges but does not force.

### Gate

**PASS.** ≥ 3 distinct forms observed (5 seen), text well under the 80%
failure threshold.

---

## Decisions + trade-offs

- **`_FORM_MAP` keeps `respond_text → "text"` mapping** even though
  `respond_text` is gone from the catalog. Gemini can still emit a
  stray function call by that name occasionally (seen historically in
  `test_phase09_3_chatfix_empty_response.py`); coercing it to plain
  text is cheap defensive code, not a backwards-compat hack for
  something that will be re-added.
- **Filter approach for Ghost** (not a prop like `rolesRequired`) —
  audit noted this is the only role-gated item, and a conditional
  filter reads cleaner than plumbing role props everywhere.
- **Option B over A for Voice button** — preserves muscle memory. If
  the auto-trigger proves unreliable (mic permissions, WS race
  conditions) we can flip to A (remove) without touching the backend.

---

## Bugs NOT addressed (from audit, deferred intentionally)

- Bug #5 — markdown heuristic fragility in `parse_plain_text` (deferred,
  not in scope).
- Data-fetching tools (search_locationhistory, weather, etc.) —
  **Phase 10**.
- Prompt observability / per-turn system-prompt logging — **Phase 11**.

---

## Discovered during 9.5 (flagged, NOT fixed)

None beyond the audit.

---

## Followups

- **Phase 10 (chat tool-use):** add data-fetching tools so queries like
  "як погода?" or "покажи тренд температури" produce real `respond_chart`
  / `respond_metrics` with actual data. Est. 6–8h.
- **Phase 11 (voice/spatial/latency/observability):** multiple items.
  Est. 6–10h.
