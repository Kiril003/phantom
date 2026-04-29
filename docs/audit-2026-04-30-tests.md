# Audit 2026-04-30 — Test Triage After Sunrise Wave 0/1

**Agent**: QA-TESTS (a7945a43be7cbec95)
**Branch**: worktree-agent-a7945a43be7cbec95 (off `autonomous-run`)
**Scope**: TypeScript check + Vitest + Pytest after ~15 phase-5 commits.
**Logs**: `/tmp/tsc.log`, `/tmp/tsc-after.log`, `/tmp/vitest.log`, `/tmp/pytest.log`.

## Section 1 — TypeScript (`tsc --noEmit`)

| Stat       | Before fix | After fix |
| ---------- | ---------- | --------- |
| Errors     | **5**      | **3**     |

### Remaining errors

```
src/components/chat/scenes/ChatScene.tsx:39:31  TS2307  Cannot find module './LocationScene'
src/components/chat/scenes/ChatScene.tsx:40:33  TS2307  Cannot find module './CheckpointScene'
src/components/chat/scenes/ChatScene.tsx:41:30  TS2307  Cannot find module './SandboxScene'
```

All three are **missing source files**: `ChatScene.tsx` imports `LocationScene`,
`CheckpointScene`, `SandboxScene` from `./` but the files do not exist in
`src/frontend/src/components/chat/scenes/`. The `scenes/` dir contains
`AlarmScene`, `AuditScene`, `CalendarScene`, `ChatScene`, `FilesScene`,
`PhantomManifestScene`, `SceneComposer`, `TimerScene`, `WardrivingScene`,
plus `index.ts` and `panels/`.

These look like Wave-1 placeholder imports left by another agent who did not
create the scene components. Out of scope for QA — flagged P0 below.

## Section 2 — Vitest (frontend unit / component)

| Stat        | Value |
| ----------- | ----- |
| Total tests | **306** |
| Passing     | **278** |
| Failing     | **28**  |
| Test files  | 33 (5 failed, 28 passed) |
| Duration    | 137 s |

### Failures by cluster

1. **`src/__tests__/scenes.test.tsx`** — entire file errors during collect
   because `ChatScene.tsx` imports the missing scenes (see Section 1). All
   scenes-level tests skipped. **P0** — same root cause.

2. **`FloatingToolbar.test.tsx`** (7 fails, all in "Voice mode cycle (Phase
   12.0)") — `aria-pressed`, `aria-label`, button-state assertions fail.
   Likely the recent `phase-5-R1-FE-CORE-1: StatusBar repaint` and toolbar
   work renamed/restructured the voice button. **P1**.

3. **`chat.test.tsx`** (16 fails) — every MessageBubble / ChatWindow / TTS
   ducking test times out at 15s. The render itself is hanging. Suggests
   that `MessageBubble` or one of its parents now renders a Suspense
   boundary that never resolves (probably a lazy import of one of the
   missing scenes), or a `useEffect` that loops on a Zustand selector.
   **P0** — biggest hot-zone.

4. **`layouts.test.tsx > SentinelLayout`** (3 fails: "renders THREAT
   DETECTED header", "shows other presence distance", "shows night time
   warning") — `getByText` cannot find expected strings. Likely the
   `phase-5-R1-FE-LAYOUT-SENTINEL: coral radar` rewrite renamed the
   labels. Real assertion drift, not stale snapshot. **P1**.

5. **`voiceAlwaysOn.test.tsx`** (1 fail: "cooldown events surface through
   status") — assertion `expect(['cooldown','error']).toContain(status)`
   gets `'disconnected'`. Hook's status state machine appears to map
   cooldown→disconnected. **P2** — semantic, not regression-blocking.

No stale-snapshot failures — none regenerated.

## Section 3 — Pytest (backend)

| Stat        | Value |
| ----------- | ----- |
| Total tests | **1663** |
| Passing     | **1650** |
| Failing     | **12**   |
| Skipped     | 1 |
| Duration    | 364 s |

### Failures by cluster

1. **`tests/test_linux_sandbox.py`** (3 fails)
   - `test_overrun_command_killed_by_timeout` — `session.killed_by` is
     `None`, expected `"timeout"`. The new sandbox executor never marks
     killed_by on timeout path. **P0**.
   - `test_kill_running_session_emits_killed` — kill returns `False`,
     expected `True`. **P0**.
   - `test_checkpoint_after_complete` — `Checkpoint` model now requires
     `goal` field and rejects `reason='sandbox_complete'`
     (literal accepts only `auto_reflect|manual|pause|shutdown`).
     **P0** — backend `Checkpoint` schema drifted from sandbox executor's
     usage. Needs either schema relax or executor adjustment.

2. **`tests/test_phase09_3_chatfix_empty_response.py`** (3 fails) — every
   test asserts `result.attachments == []` but the new gemini provider
   path now appends an empty-text scene attachment
   `{kind:'text', panels:[{markdown:''}]}`. New default attachment from
   recent scene-envelope refactor. **P1**.

3. **`tests/test_phase09_4c_qw.py::TestStrategicMemoryDefensiveFilter`**
   (3 fails) — defensive filter now drops *every* fact (returns `[]`)
   instead of keeping legit facts. **P1** — likely overzealous filter
   from a recent strategic_memory.py change.

4. **`tests/test_phase10_4_empty_bubble_guard.py`** (3 fails) — same root
   cause as cluster #2: empty-bubble guard now wraps responses in scene
   attachments unconditionally; tests expect bare content. **P1**.

## Section 4 — Fixes applied (this session)

| File | Summary |
| ---- | ------- |
| `src/frontend/src/components/settings/SettingsPanel.tsx` | `Tune` icon doesn't exist in lucide-react@1.8 — aliased `SlidersHorizontal as Tune` (visual-equivalent). |
| `src/shared/types/chat.ts` | Removed duplicate `PhantomManifestSceneData` interface (defined identically in `familiar.ts`); imported + re-exported from familiar at file top. Resolves TS2308 in `shared/types/index.ts:12`. |

**Result**: 5 → 3 tsc errors, no source code semantics changed, no tests
modified, no tests deleted.

## Section 5 — Open regressions for next phase

### P0 (blocks build / TSC / sandbox runtime)

- **R1-MISSING-SCENES**: `ChatScene.tsx` imports `LocationScene`,
  `CheckpointScene`, `SandboxScene` that do not exist on disk. Causes 3
  tsc errors + cascading vitest collect-failure for `scenes.test.tsx` +
  16 hangs in `chat.test.tsx`. Likely owner: whichever agent shipped the
  Wave-1 scene refactor. Fix: implement the three scene components OR
  remove the imports + the corresponding case branches in ChatScene.
- **R1-SANDBOX-KILL-PATH**: `linux/executor.py` does not set
  `session.killed_by` on timeout, and `kill()` returns False even when
  the session was running. Three tests in `test_linux_sandbox.py` fail.
- **R1-CHECKPOINT-SCHEMA-DRIFT**: `Checkpoint` pydantic model rejects
  `reason='sandbox_complete'` and now requires `goal`. Sandbox executor
  in `linux/executor.py:492` doesn't pass `goal` and uses an unsupported
  `reason` literal. Either extend the literal in `Checkpoint` or fix the
  executor call site.

### P1 (real regressions, not yet shipping-blocking)

- **R1-CHATFIX-DEFAULT-SCENE-ATTACHMENT**: AI provider/empty-bubble guard
  now appends a `{kind:'text', panels:[{markdown:''}]}` scene attachment
  when content is empty. 6 tests fail across
  `test_phase09_3_chatfix_empty_response.py` and
  `test_phase10_4_empty_bubble_guard.py`. Fix to skip the auto-attach
  on empty/placeholder paths or update tests to reflect new contract.
- **R1-STRATEGIC-MEMORY-FILTER-OVERZEALOUS**: `strategic_memory.py`
  filter now drops legit facts ("User loves espresso", "User dislikes
  mornings", "Fact about Lviv weather"). 3 tests fail.
- **R1-FE-FLOATING-TOOLBAR-VOICE**: 7 tests in `FloatingToolbar.test.tsx`
  fail after StatusBar repaint. Voice-mode cycle button-state /
  aria-pressed contract changed.
- **R1-FE-SENTINEL-LABELS**: `SentinelLayout` no longer renders the
  expected text labels ("THREAT DETECTED", presence distance, night
  time warning) per the existing tests. Coral-radar rewrite renamed
  the strings.

### P2 (semantic / minor)

- **R1-VOICE-ALWAYSON-COOLDOWN**: `useVoiceAlwaysOn` maps cooldown event
  to `disconnected` status; test expects `cooldown|error`. Decide which
  is correct (status FSM doc).

---

**Test command reproducibility**:

```bash
# Frontend
cd src/frontend && ./node_modules/.bin/tsc --noEmit
cd src/frontend && ./node_modules/.bin/vitest run --reporter=verbose

# Backend (via main repo .venv)
cd src/backend && /home/radxa/.../src/backend/.venv/bin/pytest --tb=short
```

`node_modules` is symlinked from the main repo (`src/frontend/node_modules`)
because the worktree had no install. Backend uses
`src/backend/.venv` (the real venv, not the empty `phantom-os/venv`).
