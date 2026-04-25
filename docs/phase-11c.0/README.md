# Phase 11c.0 — Voice infrastructure foundation

## Why
Phase 11b/11b.1 retrospective (commit `7a4331d`, `docs/phase-11b-retrospective/README.md`)
showed that 199 frontend unit tests passed in vitest while the user-facing
app was a stale `dist/` with zero new code in it — for **two consecutive
ship attempts**. The "user must verify manually" step was the first real
integration test, and it failed twice.

This phase installs the gates that catch that failure mode before it
ships again. **No always-on feature work** — that's deferred to Phase 11c.1,
which will land on top of these gates with a real-browser test as a hard
ship requirement.

## What ships

### Test infrastructure
- `@playwright/test@^1.59.1` as devDependency (installed via `npm install -D`)
- Chromium browser binary in `~/.cache/ms-playwright/` (~1.9 GB total cache,
  shared with existing playwright MCP server installs — no new disk cost
  on this machine)
- `src/frontend/playwright.config.ts` — Chromium-only project, single
  worker, fake media stream flags so tests don't need real microphone
  hardware, vite preview as webServer on port 4173
- `src/frontend/vite.config.ts` — vitest excludes added (`e2e/**`,
  `playwright-report/**`, `test-results/**`) so vitest and Playwright
  don't fight over `.spec.ts` files
- `src/frontend/package.json` scripts: `test:e2e`, `test:e2e:ui`,
  `test:e2e:headed`
- `.gitignore` updated for `playwright-report/`, `test-results/`,
  `.playwright/`

### Tests
- `src/frontend/e2e/smoke.spec.ts` (2 tests):
  - **app loads without console errors** — navigates to `/`, watches
    for `console.error` and uncaught page errors, filters DevTools /
    favicon / WebSocket / "Failed to load resource" noise, asserts
    nothing else fires.
  - **backend health is reachable** — hits `/health` directly, asserts
    `status:ok` and a non-empty `ai_active`.
- `src/frontend/e2e/settings.spec.ts` (1 test):
  - **PUT settings round-trips through GET** — logs in via PIN
    (`phantom`/`000000` by default; env-overridable), reads
    `voice_tts_enabled`, flips it via PUT, re-reads to verify, restores
    in a `finally` block.

### Gate scripts
- `scripts/check-dist-fresh.sh` — fails (exit 1) if max mtime in
  `src/frontend/dist/` is older than the latest commit touching
  `src/frontend/src/`. Both paths verified manually (success path: OK;
  failure path: aged dist files via `touch -d '2020-01-01'`, gate fails
  with clear date diff).
- `scripts/check-hook-consumers.sh` — fails (exit 1) if any
  `src/frontend/src/hooks/use*.ts(x)` has zero production consumers
  (excludes the hook file itself, `__tests__/`, `*.test.*`, `*.spec.*`).
  Both paths verified: baseline 4 hooks all consumed (PASS); injected
  fake `useOrphan.ts` (FAIL with file path + remediation hint).

## Notable finding: baseline `npm run build` is broken

While preparing the smoke test we discovered that
`npm run build` (which is `tsc && vite build`) **fails on baseline v0.10.5**
with EXIT=2 due to pre-existing strict-TS errors:

- `src/__tests__/map.test.tsx` — missing `facts` MapLayerKey
- `src/components/core/Avatar.tsx` — missing `OPERATOR` SystemState in record
- `src/components/core/FloatingWindow.tsx` — unused `useEffect`, `Maximize2` imports
- `src/components/core/StatusBar.tsx` — lucide-react `ComponentType` size-prop
  type mismatch (4 sites)
- `src/components/settings/SettingsPanel.tsx` — unused `React` import
- `src/services/translit.ts` — implicit-any on self-referencing init
- `src/stores/authStore.ts`, `src/stores/systemStore.ts` —
  `ImportMeta.env` type missing (3 sites)

The `dist/` directory on the working tree was last built **2026-04-24
22:32**, before these errors crept in. Every commit since has been
shipped against this stale dist. **This is exactly the failure mode
Phase 11c.0 was designed to surface** — and the dist freshness gate
flags it correctly when the timestamps misalign.

For Phase 11c.0 we used `npx vite build` directly (which uses esbuild
for transforms and skips `tsc`) to produce a fresh dist for the smoke
test to run against. Vite's transform layer accepts the code; the
errors are strict-checker complaints that don't prevent runtime
behavior.

**This is followup work, not Phase 11c.0 scope.** A future
`phase-11c.0a-tsc-cleanup` (or rolled into 11c.1's prep) should fix
each of these so `npm run build` is green again.

## Verification

### Gate 1 — Tests still green
```
backend: 796 passed, 5 warnings in 181.16s
frontend: 22 test files / 178 tests passed
```
Baselines preserved.

### Gate 2 — Playwright config parses
```
$ npx playwright test --list
Total: 0 tests in 0 files
```
(empty before tests added; 3 tests after).

### Gate 3 — Smoke test passes
```
$ npm run test:e2e -- smoke
Running 2 tests using 1 worker
  ✓  1 [chromium] › e2e/smoke.spec.ts:6:3  app loads without console errors (3.3s)
  ✓  2 [chromium] › e2e/smoke.spec.ts:28:3 backend health is reachable (153ms)
  2 passed (12.2s)
```

### Gate 4 — dist freshness gate, both directions
```
# Baseline (after vite build)
$ ./scripts/check-dist-fresh.sh
OK: dist/ is fresh.

# Aged dist
$ find src/frontend/dist -type f -exec touch -d '2020-01-01' {} +
$ ./scripts/check-dist-fresh.sh; echo "EXIT=$?"
FAIL: dist/ is stale.
  dist last build:      2020-01-01 00:00:00
  last frontend commit: 2026-04-24 18:04:42
  Run: cd src/frontend && npm run build (or: npx vite build)
EXIT=1
```

### Gate 5 — consumer gate on baseline
```
$ ./scripts/check-hook-consumers.sh
OK: every hook has a production consumer.
```
4 hooks (`useAgentStream`, `useChatStream`, `useFaceDetection`,
`useVoiceRecorder`) all imported by production layouts/components.

Failure-path verified by injecting a fake hook:
```
$ ./scripts/check-hook-consumers.sh
FAIL: useOrphan has no production consumer.
  Defined: src/frontend/src/hooks/useOrphan.ts
  Either import it from a component/layout/page, delete it, or move it under /experiments/.
EXIT=1
```

### Gate 6 — Settings test passes
```
$ npm run test:e2e -- settings
Running 1 test using 1 worker
  ✓ Settings reactivity › PUT settings round-trips through GET (746ms)
  1 passed (8.2s)
```

### Gate 7 — Final integration
```
$ npm run test:e2e
Running 3 tests using 1 worker
  ✓ 1 settings.spec.ts:52  PUT settings round-trips through GET (690ms)
  ✓ 2 smoke.spec.ts:6      app loads without console errors (3.6s)
  ✓ 3 smoke.spec.ts:28     backend health is reachable (59ms)
  3 passed (11.4s)

$ ./scripts/check-dist-fresh.sh
OK: dist/ is fresh.

$ ./scripts/check-hook-consumers.sh
OK: every hook has a production consumer.
```

## How to run

### Local
```
cd src/frontend
npx vite build           # produces fresh dist (skip tsc until baseline cleanup)
npm run test:e2e         # all e2e tests
npm run test:e2e:ui      # Playwright UI debugger
npm run test:e2e:headed  # watch the browser
```

### Gate scripts
```
./scripts/check-dist-fresh.sh
./scripts/check-hook-consumers.sh
```

### Pre-merge suggestion (manual, not automated yet)
Before any merge that touches `src/frontend/src/`:
```
cd src/frontend && npx vite build && cd ../..
./scripts/check-dist-fresh.sh
./scripts/check-hook-consumers.sh
cd src/frontend && npm run test:e2e
```

## What this enables (Phase 11c.1)

When always-on voice is re-attempted in 11c.1, the ship gates are:
1. **Real-browser e2e test** that mounts the always-on path and
   verifies a wake event triggers a chat message — uses synthetic
   media stream flags already configured here.
2. **Dist freshness gate** (`scripts/check-dist-fresh.sh`) — must pass.
3. **Consumer-of-hook gate** (`scripts/check-hook-consumers.sh`) — must
   pass; catches dead hooks like 11b's `useVoiceAlwaysOn`.
4. Existing 796 backend / 178 frontend unit-test floor.

If 11c.1 cannot make those gates green, **it does not ship.** That's
the rule the audit demanded.

## Out of scope
- CI/CD integration (gates run locally only — phase ceiling didn't
  permit this work)
- Headless test in container (would need display libs)
- Multi-browser testing (Chromium only — what the user actually runs)
- Voice-specific tests (Phase 11c.1)
- Fixing the strict-TS errors that block `npm run build` (followup)

## Pre-phase state
- HEAD on entry: `90640ef` (v0.10.5-provider-sync)
- Backend tests: 796 ✓
- Frontend tests: 178 ✓
- Tags preserved: v0.10.4-postpolish, v0.11-voice-always-on,
  v0.11.1-voice-fix, v0.10.5-provider-sync

## Post-phase state
- HEAD on exit: see `git log --oneline` after the doc commit
- Backend tests: 796 ✓ (unchanged — no backend code changed)
- Frontend tests: 178 ✓ (unchanged — no app code changed)
- E2E tests: 3 ✓ (new)
- Gate scripts: 2 ✓ (both directions verified)
- Tag: `v0.11c.0-playwright-gates`
- All Phase 11b/11b.1 work still archived in tags, NOT on HEAD.

## Tag
`v0.11c.0-playwright-gates` on the final commit of this branch.

## Final report
- Tasks: 0 ✓ 1 ✓ 2 ✓ 3 ✓ 4 ✓ 5 ✓ 6 ✓ 7 ✓ 8 ✓
- Tests: backend 796, frontend 178, e2e 3 (all passing)
- Gates: 1 ✓ 2 ✓ 3 ✓ 4 ✓ 5 ✓ 6 ✓ 7 ✓
- Reverts: none
- Discovered: baseline `npm run build` is broken (pre-existing TS strict
  errors); workaround documented; followup logged
- What this enables: Phase 11c.1 always-on voice with real-browser ship gates
