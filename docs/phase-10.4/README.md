# Phase 10.4 — Post-polish fixes

Starting tag: `v0.10.3-polish` (`798a0b1`)
Evidence base: `docs/phase-10.3.1-investigation/README.md` (`2e6d345`)
Branch: `autonomous-run`
Window: 2026-04-24 15:55 – 18:12 local (~2 h 17 m)
Final tag: `v0.10.4-postpolish`

## Scope

Four fixes from Phase 10.3.1 investigation, landed in ascending risk
order so early wins bank before higher-risk work:

1. **Fix 1** — Empty-bubble plain-text guard in `gemini_provider.py` (high confidence)
2. **Fix 3** — Sidebar live-refresh after new-session send (high confidence)
3. **Fix 2** — Surface delete errors + defensive sessions refresh (low confidence root cause, keeps fix XS)
4. **Fix 4** — ffmpeg transcode fallback for voice STT decode (high confidence, highest risk)

## Fixes applied

### Fix 1 — Empty-content guard (commit `89bdcaa`)

**File:** `src/backend/ai/gemini_provider.py`

Pre-10.4 the plain-text branch (`fn_name is None`) at `gemini_provider.py:313-315`
had NO empty-content fallback — when Gemini returned a candidate with empty
text parts (MAX_TOKENS, SAFETY finish_reasons, or similar), content=""
leaked straight into the DB and the chat UI rendered blank bubbles.

Fix makes the guard symmetric and richer:

- **Plain-text branch**: empty `content` AND no `attachments` → log warning
  with `finish_reason` and substitute `"Не встиг сформулювати — перепитай?"`
  as a user-friendly filler.
- **Function-call branch**: text-like forms (`text`, `markdown`) now coerce
  empty content even when attachments are present — previously the guard
  only fired when BOTH were empty, which let empty text bubbles with stray
  attachments through.
- **Attachment-only forms** (terminal/code/chart/map/metrics/diagram):
  empty content still permitted, because the attachment card is meaningful
  on its own.
- **Warning log** now includes `finish_reason` for future debuggability.

Also updated `test_phase09_3_chatfix_empty_response.py` to expect the new
Ukrainian filler instead of the cryptic "…".

### Fix 3 — Sessions live-refresh (commit `6158724`)

**File:** `src/frontend/src/stores/chatStore.ts`

`sendMessage` success handler now captures whether the returned
`session_id` was already in `state.sessions` BEFORE the state update. If
this is a fresh session (first message of a new chat), a fire-and-forget
`loadSessions()` fires after the state update so the sidebar entry
appears without a page reload.

No changes to `startNewSession` (intentional no-op-on-server behaviour
preserved). No retry logic, no WS session.created handler — keeping the
fix minimal per the investigation's "What NOT to change" list.

### Fix 2 — Delete UX (commit `86de904`)

**Files:** `src/frontend/src/stores/chatStore.ts`, `src/frontend/src/services/api.ts`

Three small UX improvements for the session delete flow:

1. `chatStore.deleteSession`: on success, call `loadSessions()` as
   defensive re-sync so the optimistic filter can't drift away from
   DB state.
2. `chatStore.deleteSession`: on 401, actionable error copy instructs
   user to re-authenticate; generic copy for other failures.
3. `services/api.ts` `request()`: on 401 (excluding `/auth/me`, the
   auto-login probe), clear the stored token so the next navigation
   hits the login screen instead of silently 401-ing again.

Original investigation couldn't reproduce the symptom; silent-401 was
the best hypothesis. These three changes either fix it outright (token
cleared, flow restarts) or surface it visibly (actionable error text,
defensive re-sync).

### Fix 4 — ffmpeg voice STT fallback (commit `20acc12`)

**Files:** `src/backend/voice/stt_engine.py`, new `src/backend/tests/test_phase10_4_voice_transcode.py`

Browser MediaRecorder defaults to `audio/webm;codecs=opus`, which
libsndfile has no decoder for. Pre-10.4 `/voice/stt` returned HTTP 400
"Format not recognised" on every push-to-talk attempt from
Chromium/Firefox.

- New `_ffmpeg_decode_to_mono16k(raw)` helper pipes bytes through
  `ffmpeg -f wav -ar 16000 -ac 1` and parses the result via soundfile,
  preserving the existing float32 conversion path.
- `decode_to_mono16k` falls through to this helper on any soundfile
  decode failure when ffmpeg is available.
- `_FFMPEG_BIN = shutil.which("ffmpeg")` cached at module import; if
  absent, a WARNING is logged once and the pre-10.4 behaviour (400 on
  WebM) is retained — nothing explodes on import.
- No new Python dependencies; ffmpeg is a standard system package.

**Deployment note:** ffmpeg must be installed on the target device
(`apt install ffmpeg` on Debian/Ubuntu/Radxa). Verified present at
`/usr/bin/ffmpeg` (v6.1.1-3ubuntu5) during this phase.

## Gate results

| Gate | Contract | Result |
|------|----------|--------|
| 1 backend (Fix 1) | `pytest` green, ≥ 786 | **PASS — 790** (+4 new Phase 10.4 tests) |
| 1 frontend (Fix 3) | `vitest` green, = 178 | **PASS — 178** |
| 1 frontend (Fix 2) | `vitest` green, = 178 | **PASS — 178** |
| 1 backend (Fix 4) | `pytest` green, ≥ 790 | **PASS — 796** (+6 new Phase 10.4 voice tests) |
| 2 basic chat (Fix 1) | 200, non-empty, < 15 s | **PASS — 200, 3.15 s**, "Привіт." |
| 3 empty-bubble (Fix 1) | 0 new empty rows across 5 queries | **PASS — 0 new empties** |
| 4 form distribution (Fix 1) | ≥ 3 distinct response_forms | **PASS — 6 distinct**: text, metric_cards, terminal, code, chart, markdown |
| 5 new session live (Fix 3) | GET /sessions shows new session immediately after sendMessage | **PASS** — new session `6c3ace3f-…` appeared on first GET |
| 6 delete round-trip (Fix 2) | DELETE → 200 → session gone from GET | **PASS** — `24a23784-…` created → DELETE 200 → still_exists=False |
| 7 voice webm transcribe (Fix 4) | HTTP 200 on WebM input (not 400) | **PASS — HTTP 200** from 1s Opus sine (ffmpeg: `/usr/bin/ffmpeg` present) |
| 8 empty-bubble cleanup (informational) | 0 new empty rows since phase start | **PASS — 0** since 2026-04-24T15:55:00 |

## Live verification

Production build, `gemini-2.5-flash-lite`, `phantom` ROOT user.

### Gate 2 — basic chat

```
POST /api/v1/chat/message  content="привіт"
→ HTTP 200, 3.15 s
→ content="Привіт.", response_form=text
```

### Gate 3 — empty-bubble repro sequence

Five contextless messages sent ("є?", "так", "мм", "?", "добре"):

```
msg='є?'      http=200 t=0.99s  content_len=13
msg='так'     http=200 t=2.72s  content_len=17
msg='мм'      http=200 t=3.03s  content_len=9
msg='?'       http=200 t=3.05s  content_len=20
msg='добре'   http=200 t=2.68s  content_len=15
```

All five produced non-empty content. DB count of NEW empty rows since
phase start:

```sql
SELECT COUNT(*) FROM chat_messages
WHERE role='assistant' AND (content='' OR content IS NULL)
  AND created_at > '2026-04-24T15:55:00';
-- 0
```

Total empty rows remain at 13 (pre-Phase-10.4 accumulation — no cleanup
this phase; that's historical data, not regression).

### Gate 5 — new session live

```
POST /api/v1/chat/message  content="gate5 new session probe"
→ session_id=6c3ace3f-8a83-49c1-bcd2-0a438b797442

GET /api/v1/chat/sessions
→ new session present (20 total sessions, includes the new one)
```

Wiring verified at `chatStore.ts`: `loadSessions` referenced 4× (interface
decl + implementation + Fix 3 new-session-refresh + Fix 2 defensive-delete-refresh).

### Gate 6 — delete round-trip

```
POST /api/v1/chat/message  content="to be deleted"
→ session_id=24a23784-55a9-4f54-b483-0601d0d2a91b

DELETE /api/v1/chat/sessions/24a23784-…
→ {"ok":true}, HTTP 200

GET /api/v1/chat/sessions | grep 24a23784
→ still_exists=False
```

### Gate 7 — voice WebM transcribe

Generated 1s Opus WebM fixture:

```
ffmpeg -f lavfi -i "sine=frequency=440:duration=1" \
       -c:a libopus /tmp/test.webm -y
→ 10046 bytes written

POST /api/v1/voice/stt  file=@/tmp/test.webm
→ HTTP 200, 9.08 s
→ {"text":"","confidence":0.0,"engine":"vosk","language":"uk",
    "wake_word_matched":false}
```

Empty transcript on a sine tone is expected (not speech); the critical
point is HTTP 200 with a parseable JSON body instead of the pre-10.4
HTTP 400 "Format not recognised." Decode routed through ffmpeg → Vosk
processed 16 kHz mono PCM and returned silence.

## Test deltas

| Suite | Before | After | Δ |
|-------|--------|-------|---|
| Backend (pytest) | 786 | 796 | +10 |
| Frontend (vitest) | 178 | 178 | 0 |

New backend tests:

- `test_phase10_4_empty_bubble_guard.py` — 4 tests:
  - plain-text branch empty response → Ukrainian filler + WARNING + `finish_reason` in log
  - plain-text with real content: regression guard, no filler applied
  - respond_terminal empty content + attachment: preserved (form-aware guard)
  - respond_text empty content: `finish_reason` surfaced in warning
- `test_phase10_4_voice_transcode.py` — 6 tests:
  - WAV happy path unchanged (regression guard)
  - real WebM/Opus fixture → ffmpeg fallback → mono 16 kHz PCM
  - `_ffmpeg_decode_to_mono16k` unit test on WebM
  - ffmpeg absent → clear ValueError, no crash
  - ffmpeg helper rejects when binary missing
  - empty payload still raises early

Updated existing tests:

- `test_empty_function_call_with_no_text_returns_placeholder_and_warns` —
  now expects the Ukrainian filler (`"Не встиг сформулювати — перепитай?"`)
  instead of the old `"…"`, matching the new form-aware guard behaviour.

## Commits

| Order | Commit | Fix | Lines |
|-------|--------|-----|-------|
| 1 | `89bdcaa` | Fix 1 — empty-content guard | +197 −6 |
| 2 | `6158724` | Fix 3 — sessions live-refresh | +12 −0 |
| 3 | `86de904` | Fix 2 — delete UX + 401 clear | +28 −1 |
| 4 | `20acc12` | Fix 4 — ffmpeg STT fallback | +214 −1 |
| 5 | *(this doc)* | acceptance + live verification | — |

Tag: `v0.10.4-postpolish` applied on HEAD after this doc lands.

## Reverts

None. Each fix cleared its gates on first pass; no gate tripped the
auto-revert path.

## Deferred / still open

- Original investigation root cause for empty bubbles (context-budget
  exhaustion when tool responses + history pile up past `ai_max_tokens=2048`
  input budget) — fix 1 is a band-aid at the output layer. A proper fix
  would compress tool-response JSON in history turns or raise
  `ai_max_tokens`. Open for a future phase.
- Automatic logout UX on 401 is partial — token is cleared from
  localStorage, but no force-navigation to login. An `authStore`
  subscription watching token clears could fire the redirect; kept out
  of scope here.
- Voice TTS English still blocked on Piper EN model install (Phase 10.1
  territory).
- TS strict errors from earlier external review: not touched here.
- Calendar UI view (Phase 10.3 optional #5): still bypass via chat.
- Markdown heuristic refinement (Phase 10.3 optional #7): still open.
- Phase 11 streaming chat.

## Deployment notes

- `ffmpeg` system package required on the target device for voice STT
  to accept browser recordings. Verify with `which ffmpeg`. Present at
  `/usr/bin/ffmpeg` on the current Radxa build.
- No new Python dependencies added in this phase.
- No schema changes; no migration required.

## Known remaining issues

- Tail-latency on tool-use queries stays ~9-15 s (by design — tool
  round-trip + second Gemini call).
- Pre-Phase-10.4 empty rows (13 in DB) remain as historical data; no
  cleanup script applied.
