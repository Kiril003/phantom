# Voice always-on — known issues (frozen at Phase 11c.5)

The always-on voice feature (wake word "фантом") was attempted in Phases
11b through 11c.4. Lab tests passed each phase. Real user testing on
2026-04-26 surfaced bugs that lab tests did not catch. Feature is disabled
in this build and frozen until a future Phase 12 with proper field-test
infrastructure.

## Bug 1 — Multiple WS connections per click

Symptom: clicking the Always-On toolbar button opens 2 WebSocket
connections to /ws/voice within ~37ms.

Evidence (from /tmp/phantom-11c1.log on 2026-04-26):

```
14:24:13.553  voice WS connected: client=7e329e8f...  always_on_enabled=True
14:24:13.554  STT provider active: whisper
14:24:13.555  Vosk model loading fresh
14:24:13.590  voice WS connected: client=114d26da...  ← second connection
```

Likely root cause: `useVoiceAlwaysOn` startup effect runs twice in
React 18 strict mode, or `VoiceAlwaysOnGate` mounts twice in the layout
tree.

What Phase 12 needs:

- Add a StrictMode-safe deduplication in useVoiceAlwaysOn so concurrent
  start() calls collapse to one WS
- OR: confirm Gate is only mounted in one place (App.tsx vs DialogueLayout)

## Bug 2 — Vosk and Silero models reload on every WS connect

Symptom: every WS connect triggers full model loading. Cold-start ~10s.
For an always-on toggle, this is unusable UX.

Evidence:

```
14:24:13.555  always-on: loading fresh Vosk model from /home/radxa/vosk-models/vosk-model-uk-v3
14:24:18.545  Loading Silero VAD ONNX model
14:24:18.545  Loading Silero VAD ONNX model  ← also duplicated
```

Likely root cause: orchestrator instances per-connection don't share
underlying Vosk/Silero models. The pipeline.get_vosk_model() helper
exists but may not be hit, or each WS handler creates its own pipeline.

What Phase 12 needs:

- Verify pipeline.get_vosk_model() is reached by always_on path
- Make Silero VAD model singleton too (similar to Vosk)
- Lazy-load at backend startup, not at first WS

## Bug 3 — Real-mic wake detection unverified

Symptom: during 2026-04-26 testing, no evidence captured of "фантом" being
recognized. Backend logs at INFO level don't show per-frame events.

What Phase 12 needs:

- Real-browser Playwright test that uses a real audio file (not silence)
  containing "фантом" via --use-file-for-fake-audio-capture
- Backend test that feeds wake_spotter a known audio buffer and asserts
  recognition
- Manual test script with reproducible audio sample (record once, replay
  for every test)

## Why frozen, not deleted

All code from Phase 11b through 11c.4 is preserved:

- `routes_voice_stream.py`, `voice/always_on.py`, `voice/vad.py`,
  `voice/wake_spotter.py` — backend infrastructure intact
- `useVoiceAlwaysOn.ts`, `useMicStream.ts`, `VoiceAlwaysOnGate.tsx`,
  `inputModeStore.ts` — frontend wiring intact
- Toolbar Always-On button — visible but disabled
- `/ws/voice` endpoint — still mounted, returns ready, but Gate doesn't
  open it because settings flag is false and Gate has FEATURE_DISABLED
  guard

When Phase 12 starts:

1. Remove the FEATURE_DISABLED short-circuit in VoiceAlwaysOnGate
2. Re-enable toolbar button (set ALWAYS_ON_DISABLED to false in
   FloatingToolbar.tsx)
3. Re-show settings toggle (drop the filter in SettingsPanel.tsx)
4. Remove backend write-lock for voice_always_on_enabled in
   routes_settings.py
5. Address Bugs 1, 2, 3 above with real-browser e2e + audio fixture

## What still works (push-to-talk)

- Toolbar mic button → tap-to-talk recording
- Chat input mic button → same path
- POST /api/v1/voice/stt → Whisper transcription
- POST /api/v1/voice/synthesize → Piper TTS
- All Phase 10.x chat tool integration

This is a complete voice UX. Always-on is a convenience layer on top,
not a prerequisite.
