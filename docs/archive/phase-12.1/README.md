# Phase 12.1 — VAD context-prefix fix + Vite WS bypass

Tag: `v0.12.1-vad-fix-real`
Branch: `autonomous-run`
Predecessor: `v0.12.0-vad-voice` (`0fb158b`)

---

## Why

User reported on 2026-04-26: "always-on не працює, push-to-talk OK". The
Phase 12.0 acceptance doc had marked `mode=continuous` as PASS based on
synthetic test frames — but on real microphone audio the speech path
never produced a chat message.

Root-cause investigation (see this directory's `investigation.md` and
inline comments in `voice/vad.py:_infer`) found two independent bugs:

1. **VAD silently broken on 16 kHz.** Our `voice/vad.py:_infer` was
   feeding the Silero v5 ONNX graph a bare 512-sample window instead
   of the `[64-sample context | 512-sample window] = 576` tensor the
   reference `silero_vad.OnnxWrapper.__call__` carries between calls.
   The model accepted the truncated input (input shape declared as
   `[None, None]`) but its LSTM never warmed up, so per-window speech
   probability was permanently floored. Measured on the
   `wake_phrase.wav` fixture: max prob **0.012** under our wrapper
   vs **0.9997** under the official one — same model file (sha256
   `1a153a22f4509…`), byte-identical to the one shipped in
   `silero-vad 6.2.1`. Threshold is 0.5; our wrapper never fired.
2. **Vite WS proxy crashed under voice load.** When `/ws/voice`
   carried 30 ms-cadence binary frames concurrently with the
   channel-mux `/ws` hub (oled / sensor / chat at high rate), the
   proxy died with `EPIPE` and the browser saw a 1006 close. PID
   145170 was alive at the start of the investigation session and
   gone after a single real-WAV streaming test. The chat hub stayed
   on the proxy fine — it's text-only, low rate.

## Changes

### `src/backend/voice/vad.py`
- `__init__`: track `_context_size` (64 for 16 kHz, 32 for 8 kHz) and
  `_context` (zeroed `(1, context_size)` float32 buffer).
- `reset`: zero `_context` alongside `_state` and `_pending`.
- `_infer`: concatenate `_context` to the new window before the ORT
  run; save `audio[:, -context_size:]` as the next call's prefix.

This mirrors the official `OnnxWrapper.__call__` line-for-line. No
public API change — the orchestrator and routes layer never touch
`_context` directly.

### `src/frontend/src/hooks/useVoiceAlwaysOn.ts`
- `_resolveWsUrl`: in `import.meta.env.DEV`, target
  `${hostname}:8000/ws/voice` directly. Production builds keep the
  same-origin path. Backend `cors_origins` already lists the dev
  hosts, and FastAPI's WebSocket layer doesn't gate on Origin by
  default.

### Tests
- **New**: `src/backend/tests/test_phase12_1_vad_real_audio.py` — three
  tests that close the gap left by Phase 11b's
  `test_synthetic_speech_detectable` (which explicitly skipped the
  question of whether `speech_start` ever fires):
  - `test_real_speech_fires_speech_start_and_end` — feeds the
    Phase 11b `wake_phrase.wav` fixture through `vad.process` in 30 ms
    chunks and asserts both transitions land.
  - `test_silence_produces_no_speech` — feeds the silence fixture and
    asserts no `speech_start`.
  - `test_per_window_max_prob_crosses_threshold` — direct probe of
    `_infer` requiring `max_prob > 0.5` on real speech. Fails
    surgically if a future refactor breaks the inference path.
- **Updated**: `tests/test_phase07_voice.py::test_voice_settings_put_resets_pipeline_cache`
  — Phase 12.0 (commit `00fc745`) intentionally narrowed
  `_apply_runtime_side_effect` to model-invalidating keys; the test
  was still PUT-ing `voice_tts_speed` (a runtime-only key) and
  expecting a cache reset, so it was failing on the patched main.
  Rewrote to pin both halves of the contract: runtime-only keys must
  NOT reset, invalidating keys MUST.

## Verification

| Layer | Result |
|-------|--------|
| Backend pytest (full suite) | **933 / 933 PASS** (was 932 / 933 on 12.0 due to the 07-suite drift above) |
| Frontend vitest (voice slice) | **24 / 24 PASS** |
| `npm run build` (TS strict + Vite) | OK, 47 s |
| Phase 12.1 real-audio gate | 3 / 3 PASS, max prob 0.9997 |
| Live `/ws/voice` direct (`:8000`) | `speech_start` + `speech_end` fire on real WAV — was 0 events on 12.0 |
| Live `/ws/voice` via Vite (`:5173`) | same — proxy is no longer in the voice path in dev |
| Push-to-talk regression | POST `/voice/stt` on `wake_phrase.wav` → `{"text":"Фантом.","wake_word_matched":true}`, HTTP 200 |

### What user must verify manually
1. Settings → Voice → mode = `continuous`
2. Reload frontend (HMR may not retrigger the WS connect on URL change).
3. Say "привіт" — message lands in chat.
4. Switch to mode = `wake_word`, phrase = `фантом`. Say "сьогодні гарно"
   → no message. Say "фантом який час" → "який час" lands in chat.
5. Backend stays responsive throughout.

If 3-5 fail, capture `/tmp/phantom-12.1.log` and the DevTools Network
panel — Phase 12.2 addresses surgically.

## What still hides

- The chat WS hub (`/ws`) still flows through the Vite proxy. If we
  ever see a recurrence of the EPIPE crash there, we'll need to apply
  the same direct-to-backend bypass for that hub. For now it's
  text-only and low-rate, well within Vite's comfort zone.
- The `wake_phrase.wav` fixture only just barely contains real speech
  (rms peaks in the last 800 ms). It's enough for a regression bound
  on `_infer`, but if a future Phase 12.x wants to validate full
  `speech_start → final → chat` in CI it should record a longer,
  louder utterance.

## Tag

`v0.12.1-vad-fix-real` applied at the merge of this acceptance doc.
