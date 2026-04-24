# Phase 10.3.1 — Diagnostic Investigation (no fixes applied)

**Date:** 2026-04-24
**Branch:** `autonomous-run` at tag `v0.10.3-polish` (commit `798a0b1`)
**Scope:** 4 symptoms from live user session 14:22–14:44 local
**Commits:** 1 (this doc only)
**Tag:** none

**Rule honoured:** zero code changes. `git diff --stat` for this phase
contains only `docs/phase-10.3.1-investigation/README.md`. Every suggested
fix below is described but NOT applied — the user makes the call.

---

## Executive summary

| # | Symptom | Root cause confidence | Fix size | Fix risk |
|---|---------|----------------------|----------|----------|
| 1 | Empty assistant bubbles on follow-up queries | **high** — reproduced in DB (3 empty rows today w/ `tokens_used≈7800`); plain-text branch in `gemini_provider.py:313-315` has no empty-content guard | S (30–45 min) | low |
| 2 | Session delete button "doesn't work" | **low** — could not reproduce via curl or code read (end-to-end works; cascade is wired); most likely silent failure on 401 or stale state | XS (15 min) — defensive refetch + surface error | low |
| 3 | New session doesn't appear in sidebar without page reload | **high** — confirmed: `startNewSession` clears local state only, never creates DB row; `sendMessage` doesn't refresh `sessions` after first-message creates one | XS (15 min) — append new session to store after sendMessage success | low |
| 4 | Voice STT returns 400 "Format not recognised" | **high** — confirmed: browser MediaRecorder emits `audio/webm;codecs=opus`, backend decode path is `soundfile.read()` which libsndfile does NOT support for WebM. Verified empirically. | M (60–90 min) — add ffmpeg transcode layer in `voice/pipeline.py`, or subprocess decode | medium |

Paragraph per symptom:

1. The 14:22 and 14:23 "а на завтра?" / "є?" turns in `sess=1f917f77` are
   in the DB with `content=''`, `response_form='text'`, `tokens_used=7874`
   and `7878`. At `ai_max_tokens=2048` that means input was ~5800+ tokens
   and output was truncated or empty. Gemini's candidate parts list came
   back with no usable content; the plain-text branch has no fallback
   while the function-call branch DOES have `content = "…"`. That
   asymmetry leaks an empty string into the DB.

2. Frontend wiring (`ChatWindow.tsx:411` → `chatStore.deleteSession:149`
   → `chatApi.deleteSession:97` → `DELETE /chat/sessions/{id}`) and
   backend route (`routes_chat.py:704-727`) are fully present and
   reachable. `get_db()` commits on success. ORM cascade on
   `ChatSession.messages` is `"all, delete-orphan"`. Direct curl on the
   running server deletes cleanly (`HTTP 200 {"ok":true}` and GET
   `/chat/sessions` confirms removal). Could not reproduce the user's
   "nothing happens" report. Plausible causes kept as hypotheses below.

3. `startNewSession` in `chatStore.ts:145-147` only does
   `set({ currentSessionId: null, messages: [], streaming: null })` —
   intentional (no DB row until user sends the first message). But the
   UX gap is real: **after** `sendMessage` creates the session server-side
   (`routes_chat.py:_get_or_create_session`), `chatStore.sendMessage`
   only updates `currentSessionId` (line 205), never the `sessions` array.
   `loadSessions` is called ONCE on `ChatWindow` mount
   (`ChatWindow.tsx:106-107`). So: click "+" → sidebar unchanged; send
   first message → sidebar still unchanged. Reload → the session finally
   appears.

4. Browser MediaRecorder emits `audio/webm;codecs=opus` by default on
   Chromium (`useVoiceRecorder.ts:27`). Backend STT decode is
   `soundfile.read(io.BytesIO(raw))` in `voice/stt_engine.py:63-84`.
   `soundfile.available_formats()` on this box returns WAV, FLAC, OGG
   (Vorbis), AIFF, AU, MP3, etc. — NO WebM. Feeding a webm byte stream
   directly raises `LibsndfileError: Format not recognised` which the
   pipeline wraps in `ValueError` and the route surfaces as 400. Nothing
   is wrong with Vosk itself — it never gets called because decode fails
   first.

---

## Symptom 1 — Empty assistant bubbles

### Repro steps

**In DB (backfill-only):**
```sql
SELECT id, session_id, content, response_form,
       json_extract(metadata_json, '$.tokens_used') AS tokens,
       json_extract(metadata_json, '$.latency_ms') AS ms,
       created_at
FROM chat_messages
WHERE role='assistant' AND (content IS NULL OR content='' OR content='…')
ORDER BY created_at DESC LIMIT 10;
```

Output (today, `sess=1f917f77`):
```
75af7496 | 1f917f77 | ''    | text     | 7878 | 1824 | 2026-04-24 14:23:43
5704bf41 | 1f917f77 | ''    | text     | 7874 | 2291 | 2026-04-24 14:22:50
```

**Live repro path that got close but didn't empty today:**
```bash
TOKEN=$(.venv/bin/python3 -c "from security.jwt_manager import create_token; \
  t,_=create_token('e35529fb-6573-4e88-a1f5-325ea325d0f7','phantom','ROOT'); print(t)")

R1=$(curl -sS -X POST http://127.0.0.1:8000/api/v1/chat/message \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"content":"плани на завтра?"}')
SID=$(echo "$R1" | python3 -c "import sys,json;print(json.load(sys.stdin)['session_id'])")

# R1 returns form=markdown with events list, ~4k tokens
# R2 follow-up "а на завтра?" in same session
curl -sS -X POST http://127.0.0.1:8000/api/v1/chat/message ... \
  -d "{\"content\":\"а на завтра?\",\"session_id\":\"$SID\"}"
# Returns: "Спокійно. На завтра поки що нічого не заплановано. Хочеш щось додати?"

# R3: "є?"  — tokens_used climbs to 3588
# Returns: "Так?"
```
In today's retry the empty-bubble case didn't reproduce, but the older
rows with `tokens_used=7874/7878` prove the class of failure exists and
scales with context.

### Evidence gathered

**DB rows (empty, recent):** 10 total empty assistant messages since
2026-04-22. Cluster patterns:

| created_at | form | tokens | Note |
|------------|------|--------|------|
| 2026-04-24 14:23 | text | 7878 | "є?" follow-up, `sess=1f917f77` |
| 2026-04-24 14:22 | text | 7874 | "а на завтра?" in same session |
| 2026-04-23 23:35 | text | 6302 | late-night, post tool call |
| 2026-04-23 23:34 | **terminal** | 3069 | empty content but terminal form kept attachment |
| 2026-04-23 19:10 | **terminal** | 1703 | four terminal empties in 30 s — likely tool-chain refusal |
| 2026-04-22 18:37 | text | 1323 | smaller context, still empty |

So the failure is NOT purely "max tokens" — we see empties at 1323
tokens too. Lower-token ones are likely model-refusal / no-parts
candidates; the 7800+ ones are budget-exhaustion.

**Config:** `config.py:59 ai_max_tokens=2048` (NOT 8192). `tokens_used`
is Gemini's `total_token_count` = input + output. 7878 total with
output capped at 2048 implies input was ~5800+ tokens — the system
prompt alone (with DATA_TOOLS_GUIDANCE + REGISTER_GUIDANCE +
RESPONSE_FORMS_GUIDANCE + memory hints + recent places + snapshot)
tops out at ~2-3k tokens, then history + tool roundtrip responses pile
on.

**Code path — the asymmetry that leaks empties:**

`src/backend/ai/gemini_provider.py:301-315`:
```python
# Response form OR plain text — finalize.
if fn_name:
    form, content, attachments = parse_function_call(fn_name, fn_args)
    if not content and not attachments:
        content = " ".join(text_parts).strip() or (response.text or "").strip()
        if not content:
            logger.warning(
                "Gemini returned empty %s function_call with no fallback text; "
                "model=%s tokens=%d",
                fn_name, config.ai_gemini_model, tokens_total,
            )
            content = "…"           # ← fallback exists
else:
    full_text = " ".join(text_parts).strip() or (response.text or "")
    form, content, attachments = parse_plain_text(full_text)
                                 # ← no fallback; "" propagates to DB
```

`parse_plain_text("")` returns `("text", "", [])`. No log, no substitute.

For `form=terminal content=''` cases: `parse_function_call(respond_terminal, {command: "..."})` returns `(form, content_from_args, [terminal_output])`. If Gemini filled `command` but left `content` empty, `not attachments` is False (attachments has 1 entry), so the fallback doesn't fire. Empty content shipped.

**Frontend rendering** (`MessageBubble.tsx:97` → `ResponseRenderer`):
No content means the bubble body renders nothing. There's a shell (avatar + meta line with latency/tokens/provider icon) but no text. That's exactly what the user screenshot shows — a floating meta line ("14:22 gemini 2291ms #7874") under an empty bubble.

### Root cause hypothesis

**High confidence.** Two converging causes:

1. **Context budget exhaustion.** System prompt + chat history + tool
   roundtrip responses inflate the input past ~5-6k tokens, leaving
   very little of the 2048 output budget for a useful reply. Gemini
   returns a candidate with `finish_reason=MAX_TOKENS` and few or zero
   content parts. The code never inspects `finish_reason` so we
   silently pass "" through.

2. **Plain-text branch has no empty guard.** Even when input is modest
   (see 2026-04-22 18:37 with `tokens_used=1323`), Gemini occasionally
   returns a candidate with empty parts. Function-call branch coerces
   to `"…"`; plain-text branch doesn't.

The terminal-form empties (multiple on 2026-04-23) suggest a third,
quieter path: `respond_terminal` called with `command` but empty
`content` — attachment present, so fallback skipped, `content=""`
persisted. UI probably still renders the terminal block so user may
not have noticed those.

### Suggested fix — S (30–45 min)

In `ai/gemini_provider.py` around line 313:

- Mirror the function_call branch's empty-content fallback in the
  plain-text branch. If `full_text.strip() == ""`, log a warning with
  `finish_reason` and substitute a minimal filler ("…" or a state-aware
  nudge like "Не встиг сформулювати — перепитай?").
- Also apply the same guard inside `parse_function_call` callers when
  attachments exist but content is empty AND response_form expects
  content (e.g. `text`, `markdown`): coerce content.
- Add `finish_reason` to the warning log so future empties are visible
  in stderr: `candidate.finish_reason` from google-genai `types`.
- Optionally trim `max_turns` or compress history when input tokens
  exceed a watermark (~4k) — reduces how often we hit the limit.
  Defer-friendly; handle in a later polish phase.

### Risk of fix

Low. Only changes the empty-path branch; no semantic change for
non-empty responses. The filler string is a UX tweak users will see
on the rare truncated turn.

---

## Symptom 2 — Session delete broken

### Repro steps

**Direct backend (worked):**
```bash
TOKEN=$(cat /tmp/phantom_token.txt)
SESS=$(curl -sS -X POST http://127.0.0.1:8000/api/v1/chat/message \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"content":"test delete"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['session_id'])")
# Created session: cbf2f09c-e60d-4d0d-9412-b583dbdd3c08

curl -sS -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8000/api/v1/chat/sessions \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('total=',d['total'], 'has:', any(s['id']=='$SESS' for s in d['sessions']))"
# total= 54, has= True

curl -sS -X DELETE -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:8000/api/v1/chat/sessions/$SESS -w "\nHTTP=%{http_code}\n"
# {"ok":true}
# HTTP=200

curl -sS -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8000/api/v1/chat/sessions \
  | python3 -c "...; print(any(...))"
# False  ← deleted, committed, gone
```

### Evidence gathered

**Frontend wiring — all present:**

- `ChatWindow.tsx:397-416` — trash `<button>` with `minWidth/minHeight: 44`
  touch target; `onClick` stopPropagation + calls `deleteSession(sess.id)`.
- `chatStore.ts:149-160` — `async deleteSession`: awaits
  `chatApi.deleteSession`, filters session list on success, sets error
  on catch.
- `services/api.ts:96-97` — `deleteSession(sessionId) => request('DELETE', /chat/sessions/${id})`.
- `services/api.ts:27-50` — `request` fetches, reads `Authorization: Bearer $token`
  from `localStorage`, throws `ApiError(status, code, detail)` on non-OK.

**Backend wiring:**

- `routes_chat.py:704-727` — DELETE endpoint: fetches session scoped to
  user, `await db.delete(session)` + `await db.flush()`.
- `db/database.py:57-65` — `get_session()` context manager DOES
  `await session.commit()` on clean exit. So the delete persists.
- `db/models.py:84` — `ChatSession.messages` relationship has
  `cascade="all, delete-orphan"` so ORM delete cascades to messages.

All layers individually look correct.

### Root cause hypothesis — low confidence

**Could not reproduce.** Working hypotheses ranked:

1. **Silent 401 / token expiry** (best bet). User has been in session
   for ~14h since 00:40 first tests. Token TTL is 8h
   (`config.py jwt_ttl_s` / equivalent). If the token expired between
   chat sends (which refresh nothing) and a subsequent delete click,
   the DELETE fetch returns 401. `chatStore.deleteSession` catches,
   sets `state.error`, but the sidebar keeps showing the session.
   User reads "nothing happens" because no toast / banner wires to
   `error`. Symptoms 1 (chat still working — because chat has its own
   code path) and 2 (delete failing silently) can coexist.

2. **Stale state cache** — if user had two tabs open, or the sessions
   list was loaded once at boot and the user never navigated away,
   and a backend crash or restart wiped cookies, the delete fetch
   could have failed on auth. Same mechanism as (1).

3. **Very rare: a non-200 response from backend route** — didn't
   reproduce in any curl. If the ChatSession has 0 messages (e.g. a
   legacy placeholder), cascade still works. Unlikely.

None of these are provable from evidence on disk. Would need the user's
browser devtools Network tab at the moment of the failed click.

### Suggested fix — XS (15 min)

- Surface `chatStore.error` in the sidebar (not just in the main chat).
  A small red toast or inline row on the sessions list when `error` is
  set clears the "nothing happens" perception — if delete failed, user
  sees why.
- After successful delete, call `loadSessions()` as a belt-and-braces
  refresh (instead of relying on the local filter alone). Guarantees
  sidebar matches server even if optimistic filter races with a
  background sessions fetch.
- Optional: centralise 401 handling in `api.ts:request` — redirect to
  `LoginScreen` automatically. Scope creep; defer.

### Risk of fix

Low. Adding `loadSessions()` on success is redundant but harmless.
Surfacing existing `error` state is pure UI.

---

## Symptom 3 — New session not live in sidebar

### Repro steps

Code inspection only; no runtime repro needed.

1. Open chat, count sidebar sessions = N.
2. Click "+" button → no new entry appears in sidebar (`currentSessionId`
   goes `null`, messages cleared, empty-state "New conversation" panel
   shown in main area).
3. Send first message → backend creates `ChatSession` row, returns
   `session_id`. Message bubble renders in main area.
4. Sidebar STILL shows N entries — new session does not appear.
5. Page refresh → sidebar shows N+1 entries.

### Evidence gathered

**`src/frontend/src/stores/chatStore.ts:145-147`:**
```ts
startNewSession: () => {
  set({ currentSessionId: null, messages: [], streaming: null, error: null });
},
```
Zero server interaction, zero sessions-list mutation. This is
intentional — DB sessions are only created on first message — but the
UI offers no placeholder/ghost entry so the user gets no feedback.

**`src/frontend/src/stores/chatStore.ts:188-210` (sendMessage success):**
```ts
set((s) => {
  ...
  return {
    currentSessionId: resp.session_id,
    messages: nextMessages,
    sending: false, isTyping: false, streaming: null,
  };
});
```
Updates `currentSessionId` + messages, but never touches `sessions`.
No `loadSessions()` call after the first message either.

**`src/frontend/src/components/chat/ChatWindow.tsx:106-107`:**
```ts
if (!minimalChrome) loadSessions();
}, [minimalChrome, loadSessions]);
```
Mount-time only. No effect on session-create events.

**Backend (`routes_chat.py:423-468`):** WS channel `chat` broadcasts
`message` events (`{message, session_id}`), NOT a dedicated
`session.created` event. The frontend `useChatStream` wires streaming
deltas but doesn't have a handler that recognises "this session_id is
new to me, refetch sessions list." So even WS-connected clients only
learn about new sessions through the main-response payload, which
chatStore ignores for sessions-list purposes.

### Root cause hypothesis — high confidence

Confirmed by code. Two composable bugs:

1. `startNewSession` provides no local placeholder — nothing visible
   in the sidebar between click and first message.
2. `sendMessage` doesn't update `sessions` when the backend creates a
   new one (detectable by `sessionId === ''` on the optimistic send or
   `resp.session_id` not already in `s.sessions`).

### Suggested fix — XS (15 min)

In `chatStore.ts`:

- After `sendMessage` success, if the incoming `resp.session_id` is not
  in `s.sessions`, either:
  - (a) `await loadSessions()` — simple, uses existing API
  - (b) synthesise a `ChatSession` entry from available fields
    (`id=resp.session_id, user_id, started_at=now, message_count=2,
    summary=req.content.slice(0,80)`) and prepend to sessions.
  (a) is one line and guaranteed consistent; (b) saves a round trip.
- Optionally, `startNewSession` could push a local "(new)" ghost row
  with a temporary id that gets replaced on first send. Nice UX polish
  but not required for the bug.

### Risk of fix

Low. One extra `loadSessions()` per new-session send = one extra GET
per N user messages. Zero risk of data corruption.

---

## Symptom 4 — Voice STT 400 "Format not recognised"

### Repro steps

**Empirical — libsndfile direct test:**
```bash
cd src/backend && .venv/bin/python3 -c "
import soundfile as sf, io
print(sorted(sf.available_formats().keys()))  # no WEBM
try:
    sf.read(io.BytesIO(b'\\x1a\\x45\\xdf\\xa3webm'))
except Exception as e:
    print(type(e).__name__, ':', str(e)[:120])
"
```
Output:
```
['AIFF','AU','AVR','CAF','FLAC','HTK','IRCAM','MAT4','MAT5','MP3','MPC2K',
 'NIST','OGG','PAF','PVF','RAW','RF64','SD2','SDS','SVX','VOC','W64','WAV',
 'WAVEX','WVE','XI']
LibsndfileError : Error opening <_io.BytesIO object at 0xffff87273100>:
                  Format not recognised.
```
**No WebM in the supported list.** Confirms the backend decode layer
cannot parse Chrome's default mic capture format.

**Runtime path:**
1. User clicks mic in `ChatWindow.tsx` → `useVoiceRecorder.start()`.
2. `MediaRecorder(stream, {mimeType: 'audio/webm;codecs=opus'})` if
   supported (Chromium default).
3. Recorder emits a `Blob` of type `audio/webm` on stop.
4. Frontend POSTs to `/api/v1/voice/stt` via `voiceApi.transcribe` as
   multipart `file`.
5. `routes_voice.py:67-100` calls `transcribe_blob(raw, lang)`.
6. `voice/pipeline.py:66-69 transcribe_blob` → `decode_to_mono16k(raw)`.
7. `voice/stt_engine.py:63-84 decode_to_mono16k` → `sf.read(BytesIO)`
   raises `LibsndfileError` → wrapped in `ValueError` ("Could not
   decode audio: ...") → route re-raises as 400 `HTTPException`.
8. Frontend toast: "Could not decode audio: Error opening
   <_io.BytesIO>: Format not recognised."

All verified by reading code and running the decode directly.

### Evidence gathered

- `src/frontend/src/hooks/useVoiceRecorder.ts:27` — default mimeType
  `audio/webm;codecs=opus`.
- `useVoiceRecorder.ts:120-121` — does `MediaRecorder.isTypeSupported`
  check but falls back to browser default; no attempt to force
  WAV/PCM (MediaRecorder doesn't support WAV anyway on most browsers).
- `src/backend/voice/stt_engine.py:63-84` — `decode_to_mono16k` is a
  pure `soundfile.read` call; no ffmpeg path, no magic-byte sniffing,
  no WebM container parse.
- `soundfile.available_formats()` on the running device confirms no
  WebM/Matroska support.
- `voice/stt_engine.py:202-233` — Vosk provider takes float32 PCM
  @ 16k and can't help here; it's never reached.
- `voice/stt_engine.py:323-340 build_stt_provider` — falls through to
  noop if model missing, but that's irrelevant; decode fails first.

**Noted while reading:** `src/backend/voice/models/` is an UNTRACKED
directory (see `git status`). Contents unknown to git; if it holds a
Vosk model, it's already functional — the format bug is purely the
decode layer.

### Root cause hypothesis — high confidence

`soundfile` (libsndfile) has NO WebM decoder. The browser produces
WebM/Opus by default. The backend has no container-to-PCM transcode
stage between them. Every browser mic capture fails at the decode
step with a 400.

### Suggested fix — M (60–90 min)

In `voice/pipeline.py` (or a new `voice/audio_transcode.py`):

- Add a preflight transcode step when the incoming blob is WebM/Opus.
  Options in order of ease:
  1. **`pydub.AudioSegment.from_file(BytesIO(raw), format='webm')`** —
     requires ffmpeg on PATH (already likely present on Linux), picks
     the right decoder based on libavformat. Simplest if ffmpeg is
     installed.
  2. **Direct `ffmpeg` subprocess** — `ffmpeg -i - -f wav -ar 16000 -ac 1 pipe:1`.
     Most robust, no new Python deps.
  3. `av` (PyAV, binding to libavcodec) — heaviest dep, avoidable.

- Wire in: `decode_to_mono16k` tries `sf.read` first; on
  `LibsndfileError`, fallback to ffmpeg subprocess decode → PCM16k
  `np.ndarray`. Cache ffmpeg availability once at startup so we don't
  fork-probe every request.

- Bump `MAX_STT_BYTES` check to account for webm being slightly smaller
  than equivalent WAV (currently 10 MB — still fine).

Alternative path on the frontend: try to force `audio/ogg;codecs=opus`
mime if supported (Firefox default) — libsndfile DOES support OGG
Vorbis but NOT OGG-with-Opus. So this doesn't help. Backend transcode
is the right fix.

### Risk of fix

Medium.

- Requires ffmpeg (or pydub) on the device. Standard Ubuntu/Debian
  package `ffmpeg` is almost certainly already installed; worth
  verifying. Docker/container images might not have it.
- Subprocess-per-request adds ~50-150 ms latency. Acceptable for push-
  to-talk but worth tracking with a timing log.
- Tests that hit `transcribe_blob` today use WAV fixtures and will
  keep passing; need new webm fixture to exercise the new path.

---

## Combined prioritization

| # | Symptom | User impact (1-5) | Fix size | Risk | Blocks |
|---|---------|-------------------|----------|------|--------|
| 1 | Empty bubbles | **5** — user sees system "broken"; no feedback at all | S | low | Any chat round where context grows; especially tool-use follow-ups |
| 4 | Voice STT 400 | **4** — voice input entirely non-functional via UI | M | medium | All voice features on Chromium |
| 3 | New session not live | **3** — confusing UX, workaround via reload | XS | low | Session-management flow; low severity but noisy |
| 2 | Session delete | **2** — could not reproduce; likely silent failure only in token-expiry edge | XS | low | Housekeeping only |

### Recommended mini-phase 10.4 scope

Two viable cuts:

**Option A — "UX fixes first" (~1h total)**
Fixes 1, 2, 3. Skips voice until a full 10.5. Good for a fast
confidence-win after 10.3.

- Fix 1 plain-text empty guard + finish_reason log → 30-45 min
- Fix 3 sessions-list refresh after sendMessage → 15 min
- Fix 2 error surfacing + defensive loadSessions → 15 min
- Gate: send 5 short messages ("є?", "так", "мм", "добре", "?"), all
  get non-empty content; delete a session, sidebar updates; create a
  new session, first message makes it appear without reload.
- Total: ~1h15m.

**Option B — "Voice + 1" (~2h total)**
Fixes 4 + 1. Skips 2 and 3 (low impact). Good if user's priority is
voice.

- Fix 4 ffmpeg transcode in `voice/pipeline.py` → 60-90 min
- Fix 1 plain-text empty guard → 30-45 min
- Gate: record webm via `arecord | ffmpeg` sample → `curl /stt` returns
  non-400 with transcript; empty-bubble repro sequence now gets a
  fallback string instead of "".
- Total: ~1h30m-2h15m.

**Combined Option C — "All four" (~2h30m-3h)**
Do them all: 1 → 3 → 2 → 4 (ascending risk). Fits in a single
afternoon slot. Recommended if the user wants closure on the polish
backlog before opening new scope (Phase 11 streaming, etc.).

User decides. Nothing starts without explicit green-light.

---

## Appendix

### A. JWT regeneration (for future repros)

```bash
cd src/backend
.venv/bin/python3 -c "
from security.jwt_manager import create_token
t,_ = create_token('e35529fb-6573-4e88-a1f5-325ea325d0f7','phantom','ROOT')
print(t)
" | tee /tmp/phantom_token.txt
```

### B. DB queries used

```sql
-- Empty assistant messages (root of symptom 1)
SELECT id, session_id, content, response_form,
       json_extract(metadata_json, '$.tokens_used'),
       json_extract(metadata_json, '$.latency_ms'),
       created_at
FROM chat_messages
WHERE role='assistant' AND (content IS NULL OR content='' OR content='…')
ORDER BY created_at DESC LIMIT 10;

-- Today's session trace
SELECT id, session_id, role, response_form, substr(content,1,60), created_at
FROM chat_messages
WHERE created_at > '2026-04-24 12:00'
ORDER BY created_at DESC LIMIT 20;
```

### C. Key code anchors (read-only during this phase)

- `src/backend/ai/gemini_provider.py:301-323` — response parse / fallback asymmetry
- `src/backend/ai/response_formatter.py:244-382` — parse_function_call / parse_plain_text
- `src/backend/api/routes_chat.py:704-727` — DELETE /sessions/{id}
- `src/backend/db/database.py:57-65` — get_session commit semantics
- `src/backend/db/models.py:84` — ChatSession.messages cascade
- `src/backend/voice/stt_engine.py:63-84` — decode_to_mono16k (the 400 site)
- `src/backend/voice/pipeline.py:66-69` — transcribe_blob entrypoint
- `src/frontend/src/stores/chatStore.ts:145-160` — startNewSession / deleteSession
- `src/frontend/src/stores/chatStore.ts:162-232` — sendMessage (no sessions refresh)
- `src/frontend/src/components/chat/ChatWindow.tsx:397-416` — trash button
- `src/frontend/src/components/chat/ChatWindow.tsx:106-107` — loadSessions mount only
- `src/frontend/src/hooks/useVoiceRecorder.ts:27,120-121` — webm default mime
- `src/frontend/src/services/api.ts:27-50` — request helper / error path

### D. What NOT to change in the fix phase

- `chat_tools.py` / `tool_executor.py` / `personality.py` — Phase 10.3
  fixes are clean and verified. No regressions touched in this audit.
- `response_formatter.py` attachment shapes — frontend renderers depend
  on the existing schema.
- Tests in `test_phase10_tool_use.py` — already comprehensive; extend
  them for the plain-text empty guard but don't rewrite.

### E. Gaps in this investigation

- Could not reproduce Symptom 2 under controlled curl. Would need
  browser-side devtools Network + state at failure moment.
- Did not exercise `/voice/stt` with an actual WebM blob via curl
  (would require a sample file; not generated to avoid arbitrary file
  creation under the read-only rule).
- Did not inspect `voice/models/` on disk — untracked directory; only
  noted its existence.
- Did not check `finish_reason` distribution across empty rows — would
  confirm the MAX_TOKENS hypothesis quantitatively. Google-genai
  exposes it on `response.candidates[0].finish_reason`; easy to add to
  the warning log during Fix 1.
