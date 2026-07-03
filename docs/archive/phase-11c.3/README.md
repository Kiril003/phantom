# Phase 11c.3 — Lift `VoiceAlwaysOnGate` to App level (always-on works from any state)

## Why

Phase 11b.1 mounted `<VoiceAlwaysOnGate />` inside **`DialogueLayout`**.
Consequence: the always-on listener was alive **only while the operator
was viewing the chat**. Toggling `voice_always_on_enabled` from any
other state (SHADOW / FOCUS / OPERATOR / settings page / map) flipped
the DB value but the gate component was never in the React tree, so
`useVoiceAlwaysOn` never started — no `/ws/voice` open, no
`getUserMedia`, no wake-word detection.

The Phase 11c.2 toolbar **Always-On** button surfaced this directly: a
user clicks the button from the home screen, the DB flips to `true`,
nothing happens visibly because the gate isn't mounted in `ShadowLayout`.

## What changed

1. **New global status store**
   `src/frontend/src/stores/voiceAlwaysOnStatusStore.ts` — single field
   `status: VoiceAlwaysOnStatus`. The gate writes to it on every status
   change; layouts that want to render the status read from it.

2. **`VoiceAlwaysOnGate` writes to the global store**
   The existing `onStatusChange` callback prop is preserved (still
   called) for backward compatibility, but the gate now also calls
   `useVoiceAlwaysOnStatusStore.setStatus()` inside the same effect.

3. **Mount the gate at App level** (`src/frontend/src/app/App.tsx`)
   New `<GlobalAlwaysOnGate />` component reads
   `useSystemStore(s => s.authenticated)` and renders
   `<VoiceAlwaysOnGate />` whenever the operator is logged in. Mounted
   once for the whole app lifetime (across all states and routes).

4. **Removed in-tree mount from `DialogueLayout`**
   `DialogueLayout.tsx` no longer imports or renders
   `VoiceAlwaysOnGate`. It still reads the status — but now from
   `useVoiceAlwaysOnStatusStore` instead of local React state.

## Files changed

```
src/frontend/src/stores/voiceAlwaysOnStatusStore.ts          | new (38 lines)
src/frontend/src/components/chat/VoiceAlwaysOnGate.tsx       | +5 -1
src/frontend/src/app/App.tsx                                 | +21 -1
src/frontend/src/layouts/DialogueLayout.tsx                  | +3 -3
src/frontend/src/__tests__/VoiceAlwaysOnGate.test.tsx        | +37 -0  (new tests)
src/frontend/e2e/toolbar-always-on.spec.ts                   | +44 -0  (WS stub)
docs/phase-11c.3/README.md                                   | new
```

No backend changes.

## Verification

- **Frontend unit tests**: 211 / 211 pass (was 209 → +2 new in
  `VoiceAlwaysOnGate.test.tsx`):
  - `writes initial "disabled" to the global status store on mount when off`
  - `updates the global status store as the underlying hook progresses`
- **Frontend e2e (Playwright)**: 8 / 8 pass.
- **Live verification on dev :5174 with real Chromium** (script at
  `/tmp/phantom-always-on-trace.mjs`):
  - Logged in via PIN, **stayed on SHADOW** (home), clicked toolbar
    Always-On.
  - `aria-pressed` flipped `false → true`.
  - `PUT /api/v1/settings/voice_always_on_enabled` → `200`.
  - Backend WS log:
    `WebSocket /ws/voice ... [accepted]; voice WS connected: ...
     always_on_enabled=True`
  - **WS opens from SHADOW state** — the fix works.
- `npm run build`: `✓ built in 37.16s`.
- `scripts/check-dist-fresh.sh`: `OK: dist/ is fresh.`
- `scripts/check-hook-consumers.sh`:
  `OK: every hook has a production consumer.`

## What the user should now see

- Toggle Always-On from **any** screen (Home / Map / Agent / Settings):
  - Frontend optimistically flips the button.
  - Backend persists `voice_always_on_enabled = true`.
  - `VoiceAlwaysOnGate` opens `/ws/voice`, requests microphone, starts
    streaming PCM frames to the wake-word backend.
- Toggle off → WS closes, mic released, gate idle.
- The chat sphere's existing label ("Awake" / "Listening" / "Armed" /
  "Cooldown") still works — it now reads from the global status store
  rather than a local DialogueLayout state.

## Known issues / out of scope

- **Backend Phase 11c.1 always-on STT pipeline blocks the asyncio
  event loop** when audio frames arrive. Once `/ws/voice` accepts a
  client and frames start flowing, all other HTTP endpoints stop
  responding (queue grows, `Recv-Q` climbs, `/health` times out).
  Reproduced twice in this session (PIDs 3857 and 72143 hung after
  WS open with `always_on_enabled=True`). The toolbar e2e was updated
  to **stub `WebSocket('/ws/voice')`** so it tests only the frontend
  toggle path; the backend pipeline is exercised via API-only tests in
  `voice-always-on.spec.ts`.

  This needs a follow-up phase (Phase 11c.4) to move the synchronous
  STT/wake-word work off the event loop — likely a `run_in_executor`
  or a queued worker. Not in scope here; the Phase 11c.3 frontend
  change is independent.

- The `<VoiceAlwaysOnGate />` is mounted as soon as the operator
  authenticates, regardless of whether always-on is enabled in
  settings. The gate's internal `useVoiceAlwaysOn` hook is
  `enabled`-gated, so when the setting is `false` it sits in
  `'disabled'` state with no WS / mic / worklet.

## Tag

`v0.11c.3-always-on-global-gate`
