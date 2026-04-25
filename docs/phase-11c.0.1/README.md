# Phase 11c.0.1 — TS strict errors fix

## Why
Phase 11c.0 audit found `npm run build` was broken on every commit since
at least Phase 9.x. `dist/` on disk was permanently stale (mtime
2026-04-24) — Phase 11b/11b.1 shipped working source that the user
never saw because the build failed silently and the previous dist was
served. Phase 11c.0 installed gates to catch the failure mode; this
phase removes the underlying breakage so those gates can be green on
every shipped commit.

## What ships
Type-only fixes for the 14 strict TypeScript errors blocking
`npm run build` (the audit count of 13 missed one of the four
StatusBar.tsx errors). No behavior changes, no refactors, no new
features, no `@ts-ignore` / `@ts-expect-error`.

### Errors fixed (categorized)

**Category A — Lucide icon type mismatch (4 errors, StatusBar.tsx)**
`ConnectivityDot` declared `Icon: { on, off }` as
`React.ComponentType<{ size?: number, ... }>`, but lucide-react icons
are `ForwardRefExoticComponent<LucideProps>` with `size: number | string`.
Replaced the local prop type with `LucideIcon` from lucide-react —
the type the library exports for exactly this purpose.

**Category B — `import.meta.env` missing types (3 errors)**
Created `src/frontend/src/vite-env.d.ts` with the single line
`/// <reference types="vite/client" />`. This pulls in Vite's
`ImportMeta.env` type definitions and resolves three TS2339 errors
in `authStore.ts` and `systemStore.ts`.

**Category C — Missing record properties (2 errors)**
- `src/__tests__/map.test.tsx` `resetStores`: added `facts: true` to
  the `layers` literal so it exhausts `MapLayerKey` (mirrors
  `mapStore.ts` `DEFAULT_LAYERS`).
- `src/components/core/Avatar.tsx` `STATE_CONFIGS`: added
  `[SystemState.OPERATOR]` entry mirroring `FOCUS` (semantically the
  closest active engaged state — OPERATOR is the elevated-user mode).

**Category D — Implicit any in self-referencing vars (2 errors,
translit.ts)**
Annotated `atWordStart: boolean` and `latin: string` in
`transliterateCharLevel`. TS5 strict mode flagged TS7022 because the
loop reassigns `prevIsLetter` from `latin.length` and the cyclical
narrowing collapsed to `any`. Explicit types break the cycle.

**Category E — Unused imports (3 errors, mechanical)**
- `FloatingWindow.tsx`: dropped unused `useEffect` and `Maximize2`.
- `SettingsPanel.tsx`: dropped unused default `React` import
  (`jsx: react-jsx` doesn't need it).

## Verification

### Gate 1 — TS error count strictly decreased per task
```
Baseline:    14 errors
After T1:    11 errors (-3, Category B)
After T2:     8 errors (-3, Category E)
After T3:     6 errors (-2, Category D)
After T4:     4 errors (-2, Category C)
After T5:     0 errors (-4, Category A)
```

### Gate 2 — `npm run build` succeeds
```
$ cd src/frontend && npm run build
...
dist/assets/maplibre-gl-BjoFNPsL.js      801.98 kB │ gzip: 216.90 kB │ map: 1,717.76 kB
✓ built in 39.42s
```
The chunk-size warning is pre-existing (maplibre-gl, DialogueLayout) —
out of scope for this phase.

### Gate 3 — Backend tests stay green
```
$ cd src/backend && .venv/bin/pytest -q
796 passed, 5 warnings in 170.73s
```

### Gate 4 — Frontend unit tests stay green
```
$ cd src/frontend && npm test -- --run
Test Files  22 passed (22)
     Tests  178 passed (178)
```

### Gate 5 — E2E tests stay green
```
$ npm run test:e2e
Running 3 tests using 1 worker
  ✓ 1 settings.spec.ts:52  PUT settings round-trips through GET (597ms)
  ✓ 2 smoke.spec.ts:6      app loads without console errors (2.6s)
  ✓ 3 smoke.spec.ts:28     backend health is reachable (63ms)
  3 passed (9.5s)
```

### Gate 6 — Dist freshness gate
```
$ ./scripts/check-dist-fresh.sh
OK: dist/ is fresh.
```
The first time this gate has been green on a regular `npm run build`
output (Phase 11c.0 worked around with `npx vite build` to skip tsc).

### Gate 7 — Hook consumer gate
```
$ ./scripts/check-hook-consumers.sh
OK: every hook has a production consumer.
```

## Behavior change
None. All fixes are type-only:
- `vite-env.d.ts` adds type definitions, no runtime code.
- Avatar `OPERATOR` config mirrors `FOCUS` — only matters at runtime
  if/when the system enters OPERATOR state, which today is gated by
  the FSM and not yet entered (the entry is preparatory completeness
  for `Record<SystemState, AvatarConfig>`).
- map.test.tsx `facts: true` matches `mapStore.DEFAULT_LAYERS`, so
  test default state continues to mirror production default.
- All other edits remove unused identifiers or add type annotations
  that are no-ops at runtime.

## Commits
- `e0b06d9` phase-11c.0.1: vite/client types for import.meta.env
- `74f4aa3` phase-11c.0.1: remove unused imports
- `99bb5c4` phase-11c.0.1: explicit types for translit self-referencing vars
- `04a4706` phase-11c.0.1: complete MapLayerKey and SystemState records
- `3c97690` phase-11c.0.1: use LucideIcon type for StatusBar icon record
- `<this>` phase-11c.0.1: acceptance doc

## Pre-phase state
- HEAD on entry: `e2cbd38` (v0.11c.0-playwright-gates)
- `npm run build`: **FAILS** with 14 strict TS errors
- dist mtime: 2026-04-24 (stale)
- Tests: backend 796 ✓ / frontend 178 ✓ / e2e 3 ✓

## Post-phase state
- HEAD on exit: see `git log --oneline` after the doc commit
- `npm run build`: **SUCCEEDS** in ~40s
- dist mtime: fresh (post-build)
- Tests: backend 796 ✓ / frontend 178 ✓ / e2e 3 ✓ (all unchanged)
- Tag: `v0.11c.0.1-ts-clean`

## Tag
`v0.11c.0.1-ts-clean` on the final commit of this branch.

## Out of scope / followups
- Pre-existing chunk-size warnings (maplibre-gl, DialogueLayout
  large bundles).
- CI integration of build + gates.
- Voice-specific tests (Phase 11c.1).

## Final report
- Tasks: 0 ✓ 1 ✓ 2 ✓ 3 ✓ 4 ✓ 5 ✓ 6 ✓ 7 ✓ 8 ✓
- TS errors: 14 → 0
- `npm run build`: succeeds
- Tests: backend 796, frontend 178, e2e 3 (all passing)
- Gates 1–7: PASS
- Reverts: none
- What this enables: every commit going forward can produce a fresh
  dist via `npm run build`; Phase 11c.1 always-on voice can use the
  ship gates from Phase 11c.0 without working around a broken build.
