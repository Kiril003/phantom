# Frontend Test Flakes — Known

## chat.test.tsx (reported Phase 9.2.1, 2026-04-19)

**Symptom**: Claude Code final report noted "pre-existing chat.test.tsx flake unrelated" during 9.2.1 npm test run.

**Investigation**: 5 consecutive isolated runs of chat.test.tsx all passed (28/28). Flake did not reproduce in isolation.

**Hypothesis**: Likely race condition when running as part of full suite (11 parallel test files via vitest), not inherent to chat.test.tsx logic. Or a one-time npm/vite hiccup.

**Action**: Deferred. Not a blocker. Revisit if:
- Flake appears in CI
- Affects >1 out of 10 full-suite runs
- New chat-related tests added

Last checked: 2026-04-19 22:12 UTC
