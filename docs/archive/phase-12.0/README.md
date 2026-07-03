# Phase 12.0 — VAD-driven voice + optional wake mode

Tag: `v0.12.0-vad-voice`
Branch: `autonomous-run`
Predecessor: `v0.11c.5-voice-freeze` (`6be8ae1`)

---

## What ships

- **`voice_mode` setting** — replaces the binary `voice_always_on_enabled`.
  Three values: `off` (default) / `continuous` / `wake_word`.
- **`voice_wake_phrase` setting** — string used in `wake_word` mode.
  Default `"фантом"`, customisable up to 50 characters.
- **`voice_silence_timeout_ms` setting** — VAD end-of-utterance threshold,
  500–5000 ms. Default 1500 ms.
- **`AlwaysOnOrchestrator` Phase-12 path** — VAD-driven buffer + STT-then-
  match. The legacy 11b wake-spotter FSM remains the default for backward
  compat; routes_voice_stream picks the Phase-12 mode at WS connect time.
- **Singleton WebSocket** in `useVoiceAlwaysOn` — module-level refcount so
  React StrictMode double-mounts and rapid clicks share one socket.
- **Singleton Silero VAD ORT session** plus startup preload of VAD / Vosk /
  Whisper, so the first `/ws/voice` connect opens in <100 ms instead of
  the 8–10 s reload that 11c.5 documented.
- **Settings hot-reload narrowed** — `_apply_runtime_side_effect` only resets
  STT/TTS providers when an actually-invalidating key changes; flipping
  `voice_mode` no longer trashes the singletons.
- **Frontend Settings UI** auto-renders the three new keys (select / text /
  number). Toolbar button cycles `off → continuous → wake_word → off`.
  Sphere label adapts to the active mode.

## Behaviour

### Mode `off` (default)
Push-to-talk only. The orchestrator returns immediately on every frame, so
audio costs nothing beyond the WS receive itself.

### Mode `continuous`
Speak naturally. Silero VAD owns SPEECH_START / SPEECH_END (silence_ms
wired to `voice_silence_timeout_ms`). On SPEECH_END the buffer feeds the
active STT provider, the resulting transcript becomes a `final` event, and
the chat store posts it. No wake phrase needed.

### Mode `wake_word`
Same VAD + STT flow. After transcription, the result is dropped unless the
text contains `voice_wake_phrase` (case-insensitive substring match). On a
match the phrase + adjacent punctuation is stripped before the `final`
event lands in chat. STT-then-match — no Vosk wake spotter.

## Bug fixes from `docs/phase-11c.5/known-issues.md`

### Bug 1 — duplicate WS connections per click → fixed
Module-level singleton in `useVoiceAlwaysOn.ts` (`_wsInstance` /
`_wsState` / `_wsRefCount`). `acquireWS` reuses connecting/connected
sockets and bumps the refcount; `releaseWS` only closes when the count
hits zero. The 11c.5 leak (close() gated on `readyState === OPEN`) is also
fixed — release closes regardless of state. Switched `onmessage` /
`onerror` / `onclose` assignment to `addEventListener` so multiple
consumers don't clobber each other's handlers.

### Bug 2 — Vosk/Silero models reload per WS → fixed
- New module-level singleton for the Silero VAD ORT InferenceSession in
  `voice/vad.py` (`get_vad_session` / `reset_vad_session`).
- New `voice/pipeline.preload_voice_models()` helper called from
  `main.lifespan` after settings load. Pre-warms Silero, Vosk, and the
  Whisper provider in one place.
- `routes_settings._apply_runtime_side_effect` no longer drops the cache
  on every `voice_*` write — only model-invalidating keys (STT engine,
  Whisper config, Vosk path, TTS voice) trigger `reset_providers()`.
  `voice_mode` / `voice_wake_phrase` / `voice_silence_timeout_ms` stay
  cache-friendly.

Verified at runtime: backend log shows `Loading Silero VAD` exactly **1×**
and `loading fresh Vosk model` exactly **1×** across multiple WS connects
and settings flips.

### Bug 3 — real-mic detection unverified
Still unverified. User declined to record an audio fixture, so all
verification is synthetic. See **What user must verify manually** below.

## Tests

| Layer | Baseline | After 12.0 | Delta |
|-------|----------|------------|-------|
| Backend (pytest) | 885 | **930** | +45 |
| Frontend unit (vitest) | 210 | **219** | +9 |
| E2E (playwright) | 6/8 (drift) | **8/8** | +2 (adapted) |

New backend test files:
- `test_phase12_singleton_models.py` — VAD singleton + preload helper (9 tests)
- `test_phase12_orchestrator_modes.py` — off/continuous/wake_word + ducking (13 tests)

New / updated frontend tests:
- `voiceAlwaysOn.test.tsx` — +4 singleton WS tests (refcount, StrictMode cycle)
- `VoiceAlwaysOnGate.test.tsx` — replaced 11c.5 freeze tests with mode-cycle tests
- `FloatingToolbar.test.tsx` — replaced disabled-button tests with cycle assertions

## Live verification

`scripts/verify-12.0.py` (uncommitted) exercises the running backend:

| Step | Result |
|------|--------|
| login + token round-trip | PASS |
| `mode=off` + silence frames → no events besides `ready` | PASS |
| `mode=continuous` + silence → no `final` events | PASS |
| `/health` responsive while continuous WS streams | PASS |
| Gate 5: `Loading Silero VAD` line count | **1** |
| Gate 5: `loading fresh Vosk` line count | **1** |
| Push-to-talk POST + chat POST regression | HTTP 200 |

## Build + gates

- `npm run build` (TS strict + Vite) — succeeds.
- `scripts/check-dist-fresh.sh` — OK.
- `scripts/check-hook-consumers.sh` — OK.

## What user must verify manually

1. **Settings → Voice → mode = continuous** → say something → message lands
   in chat.
2. **Settings → mode = wake_word, phrase = "фантом"** → say "сьогодні
   гарно" → no message arrives.
3. Same setup → say "фантом який час" → message "який час" lands in chat.
4. **Mode = off** → only push-to-talk works.
5. Backend stays responsive throughout — no UI freeze, `/health` keeps
   answering 200 during streaming.

If any of those fail, file evidence (backend log, DevTools console) and
Phase 12.1 addresses surgically.

## Tag

`v0.12.0-vad-voice` applied at the merge of this acceptance doc.
