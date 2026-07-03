# Phase 11c.5 — Always-on freeze

## Why

After 5 always-on attempts (11b → 11c.4), real user testing on 2026-04-26
exposed 2 unresolved bugs (duplicate WS, model reload) and 1 evidence
gap (real wake detection unverified). User is on day 14 of a marathon
and the right engineering answer is to disable the feature cleanly,
preserve the code for a future Phase 12, and ship a stable build with
push-to-talk only.

## What changed

- DB: `voice_always_on_enabled` → false
- Backend: `PUT /settings/voice_always_on_enabled` rejects writes setting
  it to true with HTTP 400 `{error: feature_disabled}`
- Frontend: toolbar Always-On button disabled with freeze tooltip,
  settings toggle hidden via render-loop filter,
  `VoiceAlwaysOnGate` forces `enabled = false` via a module-scope
  `FEATURE_DISABLED` constant
- All Phase 11b–11c.4 code preserved in source — feature is freeze, not
  delete

## What user gets

- Stable PHANTOM with push-to-talk voice (Phase 10.x intact)
- All chat, agent, map, calendar, memory features intact
- Build pipeline working
- Real-browser test infrastructure ready for Phase 12

## What user does not get

- Wake word "фантом" auto-listening
- Always-on background recording
- Continuation window after wake

## Tests

- Backend: 883 baseline + 2 new (`TestPhase11c5AlwaysOnWriteLock` —
  `test_set_voice_always_on_to_true_is_rejected`,
  `test_set_voice_always_on_to_false_is_not_rejected_by_lock`) → 885
- Frontend: 211 baseline (1 unrelated flaky timeout in
  `chat.test.tsx > MessageBubble > renders assistant content` at 15s
  pre-existed before Phase 11c.5; unchanged by this phase)
  - `FloatingToolbar.test.tsx` rewritten to assert button disabled + click
    no-op + aria-pressed always false (4 tests, was 5)
  - `VoiceAlwaysOnGate.test.tsx` rewritten to assert no WS opens
    regardless of setting (5 tests, was 5)
- Build: `npm run build` succeeds
- Gates 1, 2, 4, 6 verified live; Gates 3 + 5 verified via unit test +
  no push-to-talk code path touched

## Tag

`v0.11c.5-voice-freeze`

## Followup

- Phase 12 (when user is ready, weeks/months away): re-attempt always-on
  with bugs 1-3 from `known-issues.md` addressed first
- See `docs/phase-11c.5/known-issues.md` for entry points
