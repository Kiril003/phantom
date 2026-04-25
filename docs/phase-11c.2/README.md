# Phase 11c.2 — Always-On toolbar toggle button

## Why

Phase 11c.1 wired up the always-on voice infrastructure
(`VoiceAlwaysOnGate`, `useVoiceAlwaysOn`, `useMicStream`, wake-word
backend) but left the only `voice_always_on_enabled` toggle inside
**Settings → Voice**. The operator complaint was direct:

> "Натискаю Voice і мене у чат перекидає і там мікро врубає, де ж
>  always-on працює??"

That is the **designed** behaviour of the **Voice** button (Phase 9.5
shortcut: open chat + tap-to-talk). The user wanted a separate, visible
control for *always-on* listening. This phase adds it.

## What changed

A new primary-toolbar button `Always-On` (lucide `Radio` icon) sits
between **Voice** and **Settings**:

- Reads `voice_always_on_enabled` from `useSettingsStore`.
- `aria-pressed` reflects current value (true/false).
- On click: optimistic `applyRemote('voice_always_on_enabled', !current)`
  + `settingsApi.set(...)`. On PUT failure, reverts the optimistic flip.
- Tooltip flips: "Always-on listening: ON (tap to disable)" /
  "Always-on listening: OFF (tap to enable)".
- 44×44 touch target (consistent with all toolbar primary items).
- `VoiceAlwaysOnGate` already reacts to `values.voice_always_on_enabled`
  changes — flipping the setting starts/stops the AudioWorklet + WS
  pipeline without needing any extra wiring.

The **Voice** button (`Mic` icon) is unchanged. It still opens the chat
and starts tap-to-talk, exactly as before.

## Files changed

```
src/frontend/src/components/core/FloatingToolbar.tsx   | 33 +++++++++--
src/frontend/src/__tests__/FloatingToolbar.test.tsx    | new, 130 lines
src/frontend/e2e/toolbar-always-on.spec.ts             | new, 132 lines
docs/phase-11c.2/README.md                             | new
```

No backend changes. The `voice_always_on_enabled` setting key already
existed (Phase 11b.1) and `PUT /api/v1/settings/{key}` already
persisted it.

## Verification

- Frontend unit suite: 209 effective (was 204 → +5 new in
  `FloatingToolbar.test.tsx`):
  - `renders the Always-On button in the primary toolbar`
  - `reflects the current voice_always_on_enabled value via aria-pressed`
  - `on click: flips the store value optimistically and PUTs new value`
  - `on PUT failure: reverts the optimistic flip`
  - `toggles back to false when clicked while currently true`
- Frontend e2e (Playwright, real Chromium): **8/8 pass** (was 7 → +1
  new `clicking the Always-On button flips voice_always_on_enabled in
  the backend`). The new test does a real PIN login through the UI,
  clicks the toolbar button twice, and polls the backend to confirm
  `voice_always_on_enabled` flips and reverts. Defensive `finally`
  restores the original value if any assertion bails.
- Backend pytest: untouched (883 passed at v0.11c.1.1).
- `npm run build`: `✓ built in 54.56s`.
- `scripts/check-dist-fresh.sh`: `OK: dist/ is fresh.`
- `scripts/check-hook-consumers.sh`:
  `OK: every hook has a production consumer.`

Note: `chat.test.tsx > MessageBubble > renders assistant content`
flaked once on the full unit-suite run under concurrent build load
(15s vitest timeout exceeded). 28/28 passes when run isolated.
Pre-existing flake unrelated to this phase.

## What the user should now see

- Toolbar primary now has six icons: Home, Dialogue, Map, **Voice**,
  **Always-On**, Settings, plus More.
- **Always-On** button:
  - When `voice_always_on_enabled = false` → button rendered with
    secondary ink colour (off). Tooltip says "tap to enable".
  - When `voice_always_on_enabled = true` → button glows accent (on).
    Tooltip says "tap to disable". Wake-word detection is active.
- Single click toggles the setting; the change persists across reloads
  because the backend setting is the source of truth.
- Clicking does **not** navigate, does **not** transition system state,
  and does **not** start tap-to-talk. It is purely a toggle.

## Out of scope

- Visual badge on the Always-On button when wake word is currently
  matching / hot — deferred. The backend
  `GET /api/v1/voice/status` exposes wake-word state; a follow-up phase
  could pulse the icon while a turn is being captured.
- The orphan-stream edge case in `useMicStream` (stream resolves after
  recorder timeout) — pre-existing, tracked from Phase 11c.1.1.

## Tag

`v0.11c.2-always-on-button`
