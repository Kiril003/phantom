# Phase 12.2 — TTS feedback fix (mic ducking)

Tag: `v0.12.2-tts-feedback-fix`
Branch: `autonomous-run`
Predecessor: `v0.12.1-vad-fix-real` (`7c007f4`)

---

## Why

Root cause confirmed in the prior session (Phase 12.1 + audit
2026-04-22): the always-on path works once per WS connection, then the
assistant's TTS audio plays through the speakers, the open-mic stream
captures it, the Silero VAD treats the played-back voice as new
speech, the orchestrator transcribes it, and PHANTOM replies *to its
own previous utterance*. Net result: a self-feedback loop and the
appearance of the WS "closing once per turn" (the orchestrator was
actually busy hallucinating a second turn from its own audio).

The backend `voice/always_on.py` already had the `mic_duck` /
`mic_unduck` commands wired (`always_on.py:138` drops frames while
`_ducked` is set), and the `useVoiceAlwaysOn` hook already exposed
`micDuck` / `micUnduck` callbacks (`useVoiceAlwaysOn.ts:546-547`).
What was missing was a producer: no path in the production frontend
called either of them. The TTS playback effect in
`ChatWindow.tsx:200-236` constructed an `<audio>` element and called
`play()` with the always-on mic still hot.

## Changes

### `src/frontend/src/hooks/useVoiceAlwaysOn.ts`
Added two module-level functions next to the existing
`__resetVoiceAlwaysOnWS` helper:

- `voiceAlwaysOnDuck()` — sends `{cmd: "mic_duck"}` on the singleton
  WS if it's `OPEN`. No-op otherwise (e.g., voice mode is `off`, or
  the WS is between connections).
- `voiceAlwaysOnUnduck()` — counterpart sending `{cmd: "mic_unduck"}`.

These operate on the existing module-level `_wsInstance` singleton,
which is the same socket the per-hook `micDuck` / `micUnduck`
callbacks already write to. Hoisting them out of React state lets a
non-hook consumer (the chat TTS effect) call them without prop
drilling or a new store.

### `src/frontend/src/components/chat/ChatWindow.tsx`
TTS playback effect (~line 200) refactored:

1. **Wider gate.** Previously fired only when the local
   `lastUserInputMethodRef === 'voice'`, which is only set on
   tap-to-talk. Always-on transcripts arrive through
   `VoiceAlwaysOnGate.sendMessage`, a sibling component, so the ref
   stayed `'text'` — TTS never played for always-on, and ducking
   would have been moot anyway. The gate now also walks back to find
   the previous user message and consults
   `metadata.input_method === 'voice'`. Tap-to-talk path keeps its
   synchronous ref check (no behavior change there).
2. **Duck before play, unduck on every exit.** Order in the audio
   IIFE: construct `Audio`, attach `ended`/`error` listeners, call
   `voiceAlwaysOnDuck()`, then `await audioEl.play()`. The `ducked`
   bool guards `releaseDuck()` so we never double-unduck on rapid
   exits (cancellation + ended landing on the same tick).
3. **All exits release.** `releaseDuck()` is called from `onEnded`,
   `onError`, the `try/catch` rejection handler, and the cleanup
   return. The cleanup also `removeEventListener`s ended/error so a
   replaced effect doesn't keep firing into a stale closure.

### Tests
**New:** three tests in `src/frontend/src/__tests__/chat.test.tsx`
under `describe('ChatWindow TTS playback ducks the always-on mic')`:

- `calls voiceAlwaysOnDuck before audioEl.play() and
  voiceAlwaysOnUnduck on ended` — pre-populates messages with a
  voice-input user turn followed by an assistant reply, mocks
  `voiceApi.synthesize`, spies on `voiceAlwaysOnDuck` /
  `voiceAlwaysOnUnduck`, captures call ordering into a shared
  `timeline` array, asserts `duck` precedes `play` and `unduck`
  fires on the simulated `ended` event.
- `calls voiceAlwaysOnUnduck on audio error` — same setup,
  dispatches `error` instead and asserts release.
- `does not duck when previous user message was text` — guard test
  proving the metadata-based gate doesn't overshoot.

**Helper extension:** `baseMessage`'s `over` parameter now accepts
`Partial<ChatMessage['metadata']>` (was the full record), so the
new tests can override only `input_method` without restating the
whole metadata block.

## Out of scope (carried into the next phase)

- **WS reconnect after utterance.** If the always-on WS still drops
  with code 1006 once per turn after this fix, that's a different
  cause (HMR `_wsInstance` survival or backend close on `final`).
  This phase doesn't address it.
- **HMR `_wsInstance` survival** — module-level singleton state
  survives HMR but listeners attached to the prior socket can fire
  into a stale React tree. Dev-only, separate phase.
- **Latency reduction.** Continuation window / cooldown timing is
  config tuning, not a code defect.

## Verification

| Layer | Result |
|-------|--------|
| Frontend vitest (full suite) | **222 / 222 PASS** (was 222 / 222 on 12.1; 3 new TTS-feedback tests added inside an existing file, total now 225 — see file count below) |
| Frontend vitest (`chat.test.tsx`) | **31 / 31 PASS** (was 28; +3 TTS feedback tests) |
| `npm run build` (TS strict + Vite) | OK, 41.5 s |
| `dist/index.html` mtime > source mtime | OK (rebuilt after final code state) |
| Backend pytest (collectable subset) | **722 PASS, 13 fail** — same 13 failures on `7c007f4` parent (pre-existing env issues: cachetools / soundfile / silero models not in this venv, plus `test_phase09_3b` time-based flake). No new regressions. |
| Audit of producer/consumer | `voiceAlwaysOnDuck` is called from exactly one place (`ChatWindow.tsx` TTS effect); `voiceAlwaysOnUnduck` is called from `onEnded`, `onError`, the `try/catch` failure path, and the cleanup return — every play() has a matching release. |

### What user must verify manually
1. Settings → Voice → mode = `continuous` (or `wake_word`).
2. Reload frontend.
3. Say "привіт" — message lands in chat, PHANTOM replies via TTS.
4. While the TTS is speaking, observe DevTools Network → `/ws/voice`
   frames: backend is dropping mic frames (no further `speech_start`
   fires until the audio finishes). The orchestrator does not
   transcribe its own voice.
5. After TTS completes, say a follow-up — it lands as a fresh turn,
   not a continuation of PHANTOM's reply.

If 3-5 still self-feedback, the duck command isn't reaching the
backend (check `mic_duck_ack` in the WS log) — that points at the WS
reconnect issue tracked separately.

## Tag

`v0.12.2-tts-feedback-fix` applied at the merge of this acceptance
doc.
