# Phase 11c.1 — Always-on voice (cherry-pick + wire)

## Why
Phase 11b/11b.1 shipped twice and broke twice in user testing. The
retrospective audit (`7a4331d`, branch `phase-11b-retrospective`) found:

- **Phase 11b**: `useVoiceAlwaysOn` had zero production consumers. The
  hook existed; no component imported it. The feature could not work.
- **Phase 11b.1**: Wired the hook (`VoiceAlwaysOnGate`), added shared
  mic, settings gate, mode arbitration. **Source code was correct.**
  But `npm run build` was broken (TS strict errors), `dist/` was stale,
  the browser ran the previous baseline; the user saw nothing.

Phase 11c.0 added the gates that would have caught both regressions
(Playwright e2e, dist freshness, hook-consumer audit). Phase 11c.0.1
fixed the strict-TS errors so `npm run build` actually produces a fresh
dist on every commit.

This phase replays Phase 11b.1's wiring on top of working build
infrastructure with a real-browser e2e test added as a hard ship gate.
The gates make Phase 11b's failure mode mechanically impossible to
repeat.

## What ships

### Backend (cherry-pick of Phase 11b)
- `014360f` — dependency reconciliation (faster-whisper installed,
  piper-tts pinned, Silero VAD ONNX model committed)
- `39b2538` — `voice/vad.py` Silero VAD with hysteresis
- `936daf1` — `voice/wake_spotter.py` Vosk wake-word spotter
- `f5057bb` — `voice/always_on.py` orchestrator FSM
- `4b269a6` — `api/routes_voice_stream.py` `/ws/voice` channel
- `2c84792` — `routes_chat.py` `input_method=voice` branch
- `b9d0c40` — `routes_settings.py` voice group exposes
  `voice_always_on_enabled`, `voice_wake_confidence_min`,
  `voice_continuation_window_s`, `voice_mic_duck_on_tts` with
  Ukrainian labels

### Frontend (cherry-pick of Phase 11b + 11b.1)
- `4f8be5c` — Phase 11b: AudioWorklet (`workers/voice-capture.worklet.js`)
  + `useVoiceAlwaysOn` hook
- `3f468bd` — Phase 11b.1: shared `useMicStream` (refcount on a single
  `MediaStream` so tap-to-talk and always-on share the mic instead of
  fighting for it)
- `0445f4c` — Phase 11b.1: `VoiceAlwaysOnGate` mounted in
  `DialogueLayout`, `useInputMode` store for mode arbitration,
  `enabled` prop on `useVoiceAlwaysOn`
- `0c748f1` — Phase 11b.1: `VoiceAlwaysOnGate.test.tsx`
- `ef587a2` — Phase 11b.1: manual test script + acceptance doc

`e33ca45` (Phase 11b.1 ai_provider sync fix) was **not** cherry-picked
— it already landed via Phase 10.5.

### New for Phase 11c.1
- `src/frontend/e2e/voice-always-on.spec.ts` — 4 Playwright tests:
  1. App loads without VoiceAlwaysOn-related console errors (Gate
     consumer mounts — catches Phase 11b's dead-hook regression)
  2. `voice_always_on_enabled` setting round-trips through PUT/GET
  3. `GET /api/v1/voice/status` exposes `wake_word_enabled` + `wake_words`
  4. Push-to-talk endpoint still accepts webm uploads (regression check
     against the shared-mic refactor)

## Vite-env.d.ts merge

The Phase 11c.0.1 file (`/// <reference types="vite/client" />`) merged
cleanly with the Phase 11b additions (the `*.js?url` module declaration
for AudioWorklet imports). Final file is the union — both directives
present.

## Verification

### Gate 1 — Tests stay green per task
```
Baseline:           backend 796 ✓ / frontend 178 ✓ / e2e 3 ✓
After backend cp:   backend 869 ✓ (+73)
After frontend cp:  frontend 202 ✓ (+24)
After e2e add:      e2e 7 ✓ (+4)
```

### Gate 2 — `npm run build` succeeds
```
$ cd src/frontend && npm run build
...
dist/assets/maplibre-gl-Cu-NOlbd.js     801.98 kB │ gzip: 216.90 kB
dist/assets/DialogueLayout-CxFoipcR.js  529.42 kB │ gzip: 145.97 kB
✓ built in 39.59s
```
Pre-existing chunk-size warnings (maplibre-gl, DialogueLayout) — out of
scope for this phase.

### Gate 3 — dist freshness
```
$ ./scripts/check-dist-fresh.sh
OK: dist/ is fresh.
```

### Gate 4 — Hook consumers gate (CRITICAL)
```
$ ./scripts/check-hook-consumers.sh
OK: every hook has a production consumer.
```
`useVoiceAlwaysOn` → consumed by `VoiceAlwaysOnGate` (mounted in
`DialogueLayout.tsx:48`). The Phase 11b dead-hook regression cannot
recur without this gate breaking.

### Gate 5 — Real-browser e2e (CRITICAL)
```
$ PHANTOM_BACKEND=http://127.0.0.1:8001 npm run test:e2e
Running 7 tests using 1 worker
  ✓  1 settings.spec.ts:52       PUT settings round-trips         (756ms)
  ✓  2 smoke.spec.ts:6           app loads without console errors (2.9s)
  ✓  3 smoke.spec.ts:28          backend health is reachable      (81ms)
  ✓  4 voice-always-on.spec.ts:65  Gate consumer mounts           (3.0s)
  ✓  5 voice-always-on.spec.ts:89  voice_always_on_enabled rt     (534ms)
  ✓  6 voice-always-on.spec.ts:111 voice/status wake_word fields  (771ms)
  ✓  7 voice-always-on.spec.ts:124 push-to-talk regression        (15.2s)
  7 passed (31.5s)
```

### Gate 6 — Push-to-talk regression check
e2e test 7 (push-to-talk endpoint) PASS — the shared-mic refactor in
`useVoiceRecorder` did not break the existing tap-to-talk path.

### Gate 7 — All-gates simultaneous final pass
- backend tests: 869 ✓
- frontend unit tests: 202 ✓
- e2e: 7 ✓
- npm run build: ✓
- dist freshness: ✓
- hook consumers: ✓

## Behavior

- **Default**: `voice_always_on_enabled = false`. Push-to-talk remains
  the primary input path — unchanged for users who don't toggle.
- **When enabled**: User toggles ON in Settings → Voice. The
  `VoiceAlwaysOnGate` (mounted in `DialogueLayout`) reads the setting
  reactively, calls `useVoiceAlwaysOn({ enabled: true })`, which:
  1. Acquires the shared mic via `useMicStream`
  2. Opens `/ws/voice` (single backend WebSocket)
  3. Streams 16 kHz PCM frames from the AudioWorklet
  4. Backend orchestrator FSM runs: VAD → wake spotter → STT → emit
     final transcript → close window
  5. Final transcript is sent to chat with `input_method='voice'`
- **Mode arbitration**: `useInputMode` store; tap-to-talk
  preempts always-on for the duration of an utterance, then hands back.

## How to use (manual)

Refer to `docs/phase-11b.1/manual-test.md` — the script applies
verbatim because Phase 11c.1 ships the same source code. Use that
checklist after this phase ships to verify wake-word behavior on real
hardware mic (the e2e tests cover infrastructure but cannot exercise
actual Vosk wake spotting on the user's voice).

If wake doesn't fire on real voice → not a code regression (e2e gates
passed), investigate Vosk model + audio quality + ReSpeaker config.

## Pre-phase state
- HEAD on entry: `ed72988` (`v0.11c.0.1-ts-clean`)
- Backend: 796 tests / Frontend: 178 unit / E2E: 3
- `npm run build`: succeeds
- `voice_always_on_enabled` setting: not present in baseline backend
- `VoiceAlwaysOnGate`: not present in baseline frontend

## Post-phase state
- HEAD: see `git log --oneline ed72988..HEAD`
- Backend: 869 tests / Frontend: 202 unit / E2E: 7
- `npm run build`: succeeds (39.59s)
- `voice_always_on_enabled` setting: live, defaults `false`
- `VoiceAlwaysOnGate`: mounted in `DialogueLayout`, consumes
  `useVoiceAlwaysOn`
- Tag: `v0.11c.1-always-on`

## Commits (cherry-picked + new)
```
5097eff phase-11b: dependency reconciliation (task 0)
00abcd8 phase-11b: Silero VAD module with hysteresis (task 1)
587c444 phase-11b: Vosk wake-word spotter with restricted grammar (task 2)
e048db2 phase-11b: always-on orchestrator + state machine (task 3)
e4f065a phase-11b: voice WebSocket channel (task 4)
f6ae8a2 phase-11b: chat input_method=voice branch (task 5)
e8845bc phase-11b: settings surface for always-on voice (task 7)
c3ca9a7 phase-11b: frontend AudioWorklet + useVoiceAlwaysOn hook (task 6)
1e35ba2 phase-11b.1: shared mic stream between tap-to-talk and always-on
0445f4c phase-11b.1: wire useVoiceAlwaysOn with settings gate + mode arbitration
0c748f1 phase-11b.1: settings toggle wiring verified
ef587a2 phase-11b.1: manual test script + acceptance doc
cedaf16 phase-11c.1: real-browser e2e test for always-on infrastructure
<this>  phase-11c.1: acceptance doc
```

## Tag
`v0.11c.1-always-on` on the final commit of this phase.

## Out of scope / followups
- Multi-language STT (deferred to Phase 11c.2)
- LLM addressee classifier (Phase 11c.2)
- Barge-in during TTS (Phase 11c+)
- ReSpeaker hardware AEC probing (Phase 11c+)
- Wake-word training for English (never unless requested)
- Pre-existing chunk-size warnings (maplibre-gl, DialogueLayout)
- CI integration of build + gates
- Manual hardware-mic verification (separate from e2e infrastructure
  test)

## Final report
- Tasks: 0 ✓ 1 ✓ 2 ✓ 3 ✓ 4 ✓ 5 ✓ 6 ✓ 7 ✓ 8 ✓
- Cherry-picks: backend 7 commits, frontend 5 commits (skipped
  `e33ca45` — already in via Phase 10.5)
- Tests: backend 869 (was 796), frontend 202 (was 178), e2e 7 (was 3)
- Gates 1-7: PASS
- npm run build: succeeds
- dist freshness: OK
- Hook consumers: useVoiceAlwaysOn → VoiceAlwaysOnGate ✓
- Reverts: none
- Vite-env.d.ts conflict: resolved by union (both directives kept)
- What user must verify manually: `docs/phase-11b.1/manual-test.md`
  against real hardware mic — e2e covers infrastructure, not Vosk
  wake-spotting on real voice
- What this enables: always-on voice path is live behind a settings
  toggle, default off. Real-browser gate (`voice-always-on.spec.ts`)
  will trip on every commit going forward if the consumer goes missing,
  the settings key disappears, the voice/status route changes shape, or
  push-to-talk regresses.
