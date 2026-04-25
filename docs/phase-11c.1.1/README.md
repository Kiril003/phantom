# Phase 11c.1.1 — Toolbar mic + recorder stuck hotfix

## Bug fixed

Sphere stuck on **"Listening"** after clicking the toolbar mic button when
always-on voice is **off**. Root cause: `useVoiceRecorder.start()` set state
to `'requesting'` and awaited `getUserMedia` (via `useMicStream.acquire()`)
without a timeout. If the mic permission prompt is flaky or the device is
busy, the recorder is stuck in `'requesting'` indefinitely. The sphere
label is `voiceActive ? 'Listening' : ...` where
`voiceActive = recorder.state === 'recording' || recorder.state === 'requesting'`,
so a stuck `'requesting'` reads as a permanent "Listening" with no path
back to idle.

This bug existed since at least Phase 9.x (per Phase 11b retrospective
Section H4 — "Sphere 'Listening' comes from `recorder.state`, not from
always-on. Same logic in baseline; not introduced by 11b.") and was
inherited by Phase 11c.1. Not a regression — pre-existing baseline bug.

## Fixes shipped

### Fix A — `MIC_ACQUIRE_TIMEOUT_MS = 6000` in `useVoiceRecorder.start()`

File: `src/frontend/src/hooks/useVoiceRecorder.ts`

- New module-level export `MIC_ACQUIRE_TIMEOUT_MS` (6 seconds).
- `start()` wraps `micAcquire(CONSUMER_ID)` in a `Promise.race` against a
  timeout that rejects with `new Error('mic_timeout')`.
- Catch block detects `'mic_timeout'` and surfaces the user-facing message
  `"Mic permission timed out — check browser settings"`. Other errors fall
  through with their original message (unchanged from before the patch).
- Catch block now explicitly calls `micRelease(CONSUMER_ID)` so the shared
  mic stream's consumer set never carries a stale 'tap-to-talk' reference
  past a failed start. (`cleanup()` only released when
  `hasStreamRef.current === true`; on timeout that ref was never set.)
- The pending `setTimeout` is cleared on both the success path and the
  catch path so we never leak a timer into the next render.

### Fix B — Toolbar mic guard (verify-only, no change needed)

File: `src/frontend/src/components/chat/ChatWindow.tsx` (line 188-194,
unchanged).

The existing effect already correctly clears `pendingVoiceActivation`
**before** calling `toggleVoice()` and only fires `toggleVoice()` when
`recorder.state ∈ {'idle', 'error'}`. A second click while the recorder
is `'requesting'` is therefore a no-op (silent skip). `useVoiceRecorder`
also self-guards re-entrancy at line 125: `if (state === 'recording' ||
state === 'requesting') return;`. No change required.

### Fix C — Display feedback for error state (out of scope)

The hotfix puts the recorder in `'error'` state with a populated
`recorder.error` message. Sphere returns to "Ready" silently — the user
has no toast feedback yet. Per phase ceiling (≤10 lines beyond the core
fix) this is **deferred**.

## Verification

- Frontend unit suite: 204 passed (was 202; +2 new tests for Fix A — see
  `src/frontend/src/__tests__/voice.test.tsx`):
  - `phase 11c.1.1: transitions to error if mic acquire hangs past 6s`
  - `phase 11c.1.1: transitions to error when mic acquire rejects`
- Frontend e2e (Playwright, real Chromium): 7/7 pass
- Backend pytest: 883 passed (≥ 869 baseline; no backend code touched)
- `npm run build`: `✓ built in 57.59s`
- `scripts/check-dist-fresh.sh`: `OK: dist/ is fresh.`
- `scripts/check-hook-consumers.sh`: `OK: every hook has a production consumer.`

Note: `chat.test.tsx > MessageBubble > renders assistant content` flaked
on the full-suite run under concurrent build load (15s vitest timeout
exceeded). Re-running `chat.test.tsx` in isolation: 28/28 pass in 7.6s.
Pre-existing flake unrelated to this hotfix.

## What the user should now see

- Click toolbar mic → sphere shows "Listening" briefly while permission
  prompt is open.
- Permission granted → sphere stays "Listening", recording starts as
  before.
- Permission stalled or denied → after **6 seconds** at most, recorder
  transitions to `'error'`, sphere returns to "Ready".
- `recorder.error` carries `"Mic permission timed out — check browser
  settings"` (timeout) or the underlying error message (immediate
  reject).
- Subsequent toolbar mic clicks are accepted (state is `'error'`, not
  stuck `'requesting'`).
- No more permanent "Listening" stuck state.

## Files changed

```
src/frontend/src/__tests__/voice.test.tsx  | 51 ++++++++++++++++++++++++++++++
src/frontend/src/hooks/useVoiceRecorder.ts | 38 ++++++++++++++++++++--
2 files changed, 86 insertions(+), 3 deletions(-)
```

No backend changes. No new packages. No type relaxations. No
`@ts-ignore`.

## Out of scope

- **Fix C** (sphere/toast feedback for error state) — deferred.
- **`useMicStream` orphan-stream leak**: if `getUserMedia` resolves
  *after* our 6-second timeout fired, `state.stream` will be set with
  zero consumers (no one will ever release it). This is a pre-existing
  shared-mic-stream issue that only manifests when a stalled
  `getUserMedia` later resolves — rare, and out of scope for this
  surgical hotfix. Tracked as a follow-up.
- Always-on voice features — Phase 11c.1 unchanged.

## Tag

`v0.11c.1.1-recorder-hotfix`
