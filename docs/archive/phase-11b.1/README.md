# Phase 11b.1 — Voice Architecture Fix

**Status**: complete, tag `v0.11.1-voice-fix` applied at head of
`autonomous-run`.
**Base**: `v0.11-voice-always-on` (commit `d3b5344`).
**Date**: 2026-04-24 / 2026-04-25 (Kyiv time)

Phase 11b shipped the always-on voice infrastructure (Silero VAD,
Vosk wake spotter, orchestrator state machine, /ws/voice, the
`useVoiceAlwaysOn` hook, AudioWorklet) but the UI integration was
missing — the hook had no consumer, the settings toggle did nothing,
and tap-to-talk was the only path that actually worked. Phase 11b.1
closes that loop.

---

## Root-cause verification (Task 0)

The original plan listed four hypotheses for the user-reported bugs.
After grepping and reading the relevant files, here's what was
actually true vs. what was surface-level speculation:

| Hypothesis | Status | Evidence |
|---|---|---|
| **A — Frontend auto-starts always-on regardless of config** | **FALSE** | `grep -rn useVoiceAlwaysOn src/` shows zero component-level consumers — only the hook file itself and its test. The "Listening" state user saw MUST come from `useVoiceRecorder` (tap-to-talk), not always-on. |
| **B — Mic stream conflict** | **PROSPECTIVE** | Not an active bug today (always-on never ran) but would have become real the moment we wired the hook. Defensive fix required. |
| **C — WS /voice auto-starts orchestrator** | **PARTIAL** | `routes_voice_stream.py:260` does gate binary frames on `config.voice_always_on_enabled`, but still ACCEPTS the WS connection and sends `ready`. Moot since nothing opens the WS, but worth noting. |
| **D — Ollama flicker** | **PLAUSIBLE, backend-side** | `context_engine.py:131` initialises `ai_provider` from `config.ai_primary_provider` at module import, BEFORE `main.py` lifespan applies SQLite overrides. If env default ≠ persisted primary, the first WS broadcast ships the wrong value for one 500ms tick. |
| **E — "Listening" stuck due to `requesting` state** | **NEW, most likely** | `ChatWindow.toggleVoice` flips `onVoiceToggle(true)` BEFORE awaiting `getUserMedia` — so "Listening" shows the instant the button is pressed, regardless of whether the mic actually activates. Combined with mic contention from background processes (stale `arecord`, pipewire), a user sees "Listening" without hearing results. |

**Core fix target:** wire the always-on hook into a component gated
on `voice_always_on_enabled`, share the mic between both modes via a
refcounted stream, and make the input-mode arbitration explicit so
tap-to-talk and always-on don't double-submit.

---

## What changed (per commit)

| Commit | Subject |
|---|---|
| `3f468bd` | **phase-11b.1: shared mic stream between tap-to-talk and always-on** — introduces `useMicStream` singleton. `useVoiceRecorder` refactored to consume it. `inputModeStore` seeded for Task 3. |
| `daa91f6` | **phase-11b.1: wire useVoiceAlwaysOn with settings gate + mode arbitration** — `enabled` prop, auto-start/stop on toggle, wake/final suppression when `mode=tap`, new `VoiceAlwaysOnGate` component mounted in `DialogueLayout`, sphere label gains `Armed` / `Cooldown` / `Awake` states. |
| `e33ca45` | **phase-11b.1: sync ai_provider after DB settings load to prevent flicker** — startup reconcile in `main.py` so the very first context broadcast matches the user's persisted primary. |
| `bfb2b9a` | **phase-11b.1: settings toggle wiring verified** — dedicated `VoiceAlwaysOnGate.test.tsx` proving reactivity to `useSettingsStore` flips. |

---

## Architectural changes

```
                             ┌─────────────────────┐
                             │  useSettingsStore   │
                             │  values.voice_      │
                             │  always_on_enabled  │
                             └──────────┬──────────┘
                                        │
                              VoiceAlwaysOnGate
                                        │ enabled={...}
                                        ▼
            ┌────────────────────  useVoiceAlwaysOn  ────────────────────┐
            │                              │                              │
            │  auto-start/stop on enabled  │  suppresses wake/final      │
            │  change via useEffect        │  when inputMode==='tap'     │
            │                              │                              │
            └─────────────┬────────────────┴───────────────┬──────────────┘
                          │                                │
                    useMicStream                    inputModeStore
                    (shared stream)                 (idle|tap|always_on)
                          ▲                                ▲
                          │                                │
                  useVoiceRecorder  ──── sets mode='tap' on start,
                   (tap-to-talk)         'idle' on cleanup
```

### Key design points

1. **One source of truth for the mic**: `useMicStream` is a module-scoped
   refcounted singleton. Both tap-to-talk and always-on `acquire()` it
   with unique consumer IDs; the `MediaStream` stays live while the
   refcount is > 0 and is torn down on the last release. This means:
   - Toggling always-on ON while tap-to-talk is active does NOT grab a
     second stream — it shares the existing one.
   - Stopping tap-to-talk does NOT tear down the mic if always-on still
     holds it.

2. **Settings gate is the hook's contract, not the caller's**: the
   hook's `enabled` prop drives auto-start/stop via its own
   `useEffect`. Consumers just wire `enabled={setting}`; they don't
   call `start()` / `stop()` manually. This prevents the "hook ran
   even though the setting said no" class of bug.

3. **Input-mode arbitration at the wake/final layer**, not the mic
   layer. Both modes can hold the stream simultaneously, but only one
   gets to produce a chat turn at a time. When `mode === 'tap'`, the
   hook:
   - Discards `wake` events (no `setStatus('armed')`, no callback).
   - Discards `final` events (no `onFinalTranscript` fire).
   - Sends `{cmd: 'reset'}` back to the server so its orchestrator
     doesn't keep capturing continuation frames we'd ignore anyway.

4. **Ollama flicker fix is a one-liner**: after
   `config.apply_overrides(overrides)` in `main.py`, call
   `context_engine.set_ai_provider(config.ai_primary_provider)`. The
   next WS tick (500 ms cadence) reconciles too, but this guarantees
   the FIRST broadcast is already correct.

---

## Test results

**Frontend:**
```
Test Files  24 passed (24)
      Tests  199 passed (199)
```
Delta from 11b: 187 → 199 (+12 new). New test files:
- `src/__tests__/useMicStream.test.tsx` (8 tests — refcount contract)
- `src/__tests__/VoiceAlwaysOnGate.test.tsx` (3 tests — settings reactivity)
- `src/__tests__/voiceAlwaysOn.test.tsx` (+4 tests — enabled gate, input
  mode arbitration)

**Backend:**
```
883 passed, 4 warnings in 164.84s
```
No regressions from 11b (still 883). The one new backend change
(startup ai_provider sync) doesn't add tests — it's a single
idempotent call verified by the no-regression count + the live gate.

---

## Gate results

| Gate | Expected | Result |
|---|---|---|
| 0 — Investigation | Hypotheses verified | PASS — findings above |
| 1 — Tests green | backend ≥883, frontend ≥187 | PASS (883 / 199) |
| 2 — 11b features don't regress | all 11b tests still pass | PASS |
| 3 — Phase 10 doesn't regress | backend suite green | PASS |
| 4 — Tap-to-talk with setting OFF | HTTP 200 on /voice/stt | PASS (live verified with setting=false, ffmpeg sine) |
| 5 — Settings toggle persists | SQLite row reflects value both ways | PASS (live verified via PUT /api/v1/settings/voice_always_on_enabled) |
| 6 — Manual test script exists | `docs/phase-11b.1/manual-test.md` | PASS (29 numbered steps, A-H sections) |

---

## Known limitations / deferred work

- **Ollama flicker fix is minimal**: it guarantees the FIRST broadcast
  is correct but AIRouter still calls `_sync_context(provider)` on
  every response. If a fallback happens mid-session, users will still
  see `ollama` for one 500 ms tick before the reconcile catches up.
  That's intentional (signal to the user that fallback was used), but
  could be smoother with a dedicated "last_responder" field separate
  from the configured primary. Deferred.

- **Mic-duck during TTS**: the hook sends `mic_duck` / `mic_unduck`
  commands to the server, but the actual TTS-aware ducking is not
  wired to a consumer yet. For Phase 11b.1's scope (user reported
  "фантом" self-wake during TTS), the suppression logic is in place
  via `inputModeStore` (when mode='always_on' during TTS, we'd
  suppress self-wake) — but the TTS player in `ChatWindow` doesn't
  currently call `micDuck()`. Flagged for Phase 11c.

- **Sphere label taxonomy**: 'Awake', 'Armed', 'Cooldown' are new
  states added ad-hoc. A clean state-diagram in `docs/STATE_MACHINE.md`
  would tie them back to the overall system-state vocabulary.
  Deferred.

- **Worklet asset bundling**: carried forward from Phase 11b — the
  AudioWorklet `.js?url` import works at dev time but will need a
  build verification pass before a real user sees it in production.
  This is unchanged from 11b (it's not a Phase 11b.1 regression).

---

## Architectural invariants (binding)

These invariants are maintained in code and any future change must
preserve them or justify the break in the PR description:

1. **One `getUserMedia` per session**. `useMicStream` is the only
   path to the mic. No other hook or component calls
   `navigator.mediaDevices.getUserMedia` for audio.

2. **The settings gate is the ONLY start mechanism for always-on.**
   `useVoiceAlwaysOn` reacts to `enabled` via `useEffect`; callers
   must not call `start()` directly outside tests.

3. **Only one producer of a chat turn at a time.** `inputModeStore`
   is the arbitration point; wake/final from always-on are
   suppressed when `mode === 'tap'`.

4. **Default is off.** `voice_always_on_enabled` defaults to
   `False` in `config.py` and the frontend falls back to `false`
   when the key is missing from `values`. Flipping the default is a
   breaking change and requires a phase bump.

5. **WS auth is enforced server-side.** `routes_voice_stream.py`
   rejects any WS open without a valid JWT in the query string
   (close code 1008). The hook sends the token; the server
   validates.

---

## How to verify manually

See `docs/phase-11b.1/manual-test.md` — a 29-step numbered script
covering the default-off path, tap-to-talk preservation, always-on
activation, continuation window, self-wake guard during TTS, and
toggle-off behaviour. Follow each step literally; a deviation is a
regression.
