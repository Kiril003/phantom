# Phase 12.4 — WS lifecycle fix + continuous loop

Tag: `v0.12.4-ws-lifecycle`
Branch: `autonomous-run`
Predecessor: `v0.12.3-rejected-event` (`4ef11c7`)

---

## Why

After 12.3 shipped, the user's first live test surfaced a 6-millisecond
WebSocket lifetime per turn:

```
15:10:54.920  voice WS connected: client=37f03c0e
15:10:54.926  voice WS closed:    client=37f03c0e   ← 6 ms life
15:10:54.945  voice WS connected: client=5ed5587b   ← replacement
```

Speaking five phrases in a row was impossible because every utterance
triggered a fresh tear-down + reconnect, and `MediaRecorder.start()`
sometimes raced the WS lifecycle.

## Investigation (no code changes during this phase)

### Read the four hook layers

`useVoiceAlwaysOn.ts:75-165` (singleton WS), `useMicStream.ts`,
`VoiceAlwaysOnGate.tsx`, `routes_voice_stream.py:235-302` (handler),
`always_on.py:134-326` (orchestrator).

### Reproduce

A synthetic Python client opened the WS, immediately closed it,
re-opened, then streamed 100 silence frames. Backend behavior:

```
WS1 open at +57.6ms, ready: {...}
WS1 closed at +59.3ms                   ← client-side close round-trip
WS2 open at +66.5ms, ready: {...}
WS2 sent=100 frames, spurious_events=0, early_close=False
```

**Backend never closed unprompted.** The 6 ms close is purely the
frontend triggering close+open under React StrictMode (and HMR), where
the auto-start `useEffect` mounts → unmounts → remounts within ~10 ms
and the singleton's `_releaseWS` closed the socket the instant the
refcount hit zero. The next `_acquireWS` then had to build a brand-new
WS with a new `client_id` server-side.

### Diagnosis

`useVoiceAlwaysOn.ts:150-165` (pre-12.4):

```typescript
function _releaseWS(): void {
  _wsRefCount = Math.max(0, _wsRefCount - 1);
  if (_wsRefCount === 0 && _wsInstance) {
    _wsInstance.close();   // ← immediate, no grace window
    _wsInstance = null;
    _wsState = 'idle';
  }
}
```

Under StrictMode the ref count goes 1 → 0 (cleanup) → 1 (remount) over
about 10 ms, but the close event fires synchronously, so the second
acquire always sees `_wsInstance === null` and builds a fresh socket.

The `MediaRecorder.start()` error is a knock-on of the same churn:
each tear-down re-issues `getUserMedia` and the next `MediaRecorder`
gets constructed against a brand-new (sometimes still acquiring)
stream. With the WS stable, the AudioWorklet path completes once and
the tap-to-talk recorder isn't fighting it for the mic.

## Fix path applied — F1

### `src/frontend/src/hooks/useVoiceAlwaysOn.ts`

Added a module-level `_wsCloseTimer` and a 50 ms grace window around
the singleton close.

- `_releaseWS` now schedules `ws.close()` on a 50 ms `setTimeout`
  instead of closing immediately. A pending timer is replaced when
  another release fires inside the window — only the latest
  release's timer is allowed to win, and it re-checks
  `_wsRefCount === 0 && _wsInstance === ws` before closing.
- `_acquireWS` clears the pending timer if it fires inside the
  window. The remount then reuses the still-open singleton
  (refcount goes 0 → 1 against the existing socket); the backend
  sees one stable connection across the StrictMode cycle.
- `__resetVoiceAlwaysOnWS` clears the timer too so test isolation
  is clean.

50 ms is the sweet spot: long enough to absorb StrictMode's same-task
unmount→remount and Vite HMR's invalidation tick, short enough that an
intentional teardown (user toggles voice off) doesn't keep the socket
pinned.

### `src/backend/config.py`

`voice_silence_timeout_ms` default lowered **1500 → 800 ms**. At 1500
the user perceives a long lag between "I'm done speaking" and "PHANTOM
replies." 800 ms still tolerates intra-sentence pauses while turning
around fast enough that a back-and-forth conversation is workable.
The validator's `[500, 5000]` range is unchanged; operators can still
tune via Settings.

## Out of scope

- **MediaRecorder hardening** — the brief listed F3 (defer
  `MediaRecorder.start()` until WS is OPEN) as a candidate. The
  always-on path already does this via the AudioWorklet, and the
  tap-to-talk path's MediaRecorder error in 12.3 traced back to the
  same WS churn — fixing F1 settles the secondary symptom too. If
  it surfaces again, F3 lands as a targeted patch.
- **Spontaneous WS reconnect** — if the backend or network closes
  the WS spontaneously, the hook stays in `disconnected` and waits
  for the user to toggle the mode. Auto-reconnect is an enhancement
  for a later phase, not a 12.4 defect.
- **Phase 13 rewrite** — separate planning doc at
  `docs/phase-13-plan/README.md`. Untouched here.

## Tests

| Layer | Baseline (12.3) | After 12.4 | Delta |
|-------|-----------------|------------|-------|
| Frontend vitest (full suite) | 222 / 222 PASS | **224 / 224 PASS** | +2 |
| Frontend vitest (`voiceAlwaysOn.test.tsx`) | 16 / 16 | **18 / 18** | +2 |
| Backend pytest | 931 / 933 (2 fail) | **933 / 933 PASS** | +2 |
| `npm run build` (TS strict + Vite) | OK | **OK** (37 s) | — |

Pre-existing 12.3 test failures fixed in this phase:
- `test_phase11b_orchestrator.py::test_no_wake_match_returns_to_idle`
  — Phase 12.3 added a `rejected` event after a no-wake-match
  utterance; the assertion list still expected only
  `["speech_start", "speech_end"]`. Updated to include the new event.
- `test_phase11b_settings.py::test_voice_mode_default_is_off` — was
  reading `config.voice_mode` from the process-wide singleton and
  failing when another test in the suite mutated it via
  `monkeypatch.setattr` (Pydantic `validate_assignment=True` can leave
  the override in place after teardown). Switched to checking
  `PhantomConfig.model_fields["voice_mode"].default`, which is what the
  test actually wants to pin.

New / updated frontend tests in `voiceAlwaysOn.test.tsx`:
- `refcount drops to 0 and WS closes after the deferred grace window`
  — refcount drops at release time, but `close()` is deferred 50 ms.
  Awaits 80 ms to confirm exactly one close.
- `Phase 12.4 — StrictMode unmount→remount within 50ms reuses the
  same WS` — the production-bug case. Mount → unmount → mount in the
  same task tick → after 80 ms wait, only one `WebSocket` instance
  exists; the `close()` spy was never called; refcount is 1.
- `Phase 12.4 — full unmount with no remount eventually closes after
  grace` — confirms the timer still fires when nothing acquires
  during the window, and that a fresh mount past the window does
  build a new WS.

Updated backend test:
- `test_phase11b_settings.py::test_voice_silence_timeout_default` —
  renamed from `..._is_1500`, asserts the new 800 ms default off the
  field metadata (also pollution-resistant).

## Verification

| Layer | Result |
|-------|--------|
| Frontend vitest (full suite) | **224 / 224 PASS** |
| Frontend `voiceAlwaysOn.test.tsx` | **18 / 18 PASS** |
| `npm run build` | OK (36.96 s) |
| Backend pytest (full suite) | **933 / 933 PASS** |
| Synthetic repro: WS2 stays open through 100 frames, zero spurious closes | PASS |
| Backend log: zero `ERROR` / `Exception` / `Traceback` lines during repro | PASS |
| Push-to-talk regression (`POST /api/v1/voice/stt`) | HTTP 200 |
| Settings round-trip (`PUT /api/v1/settings/voice_silence_timeout_ms`) | HTTP 200, value=800 |

### What user must verify manually

1. Hard refresh the browser (DevTools → Application → Clear storage).
2. Settings → Voice → mode = `continuous` (already set in dev).
3. Speak 5 different phrases, ~3 seconds apart.
4. All 5 should land in chat as voice messages **without re-toggling**
   the mic and without reloading the page.
5. DevTools Network → `/ws/voice` panel should show **one** WS
   connection that survives all 5 turns. Backend log should show
   exactly one `voice WS connected` line for the whole session
   (not one per turn).
6. After the assistant's TTS finishes, a follow-up phrase should land
   as a fresh user turn, not be self-fed (12.2 ducking still in
   place).

If 1–6 hold, Phase 12.4 is done. If WS still flaps once per turn, the
remaining cause is HMR (separate phase — needs a Vite-specific
investigation) or the `enabled` prop flapping due to settings
re-renders (F2, deferred).

## Tag

`v0.12.4-ws-lifecycle` applied at the merge of this acceptance doc.
