# Verifier Audit — 2026-04-30

Sunrise redesign Wave 2 verifier sweep. Single-process scan; no fixes
applied. Reports only.

Scope: ~15 phase-5 commits landed overnight (1668b89 → de77fe5). Goal —
find broken contracts, orphan code, unwired stubs after the parallel
worktree merge.

---

## Section 1 — DB cleanup result

`scripts/cleanup_test_users.py --apply` ran against the live
`src/backend/phantom.db`.

| | users.row | ai_tool_use_log | chat_messages | chat_sessions | location_history | memory_facts | temporal_anchors |
|---|---|---|---|---|---|---|---|
| Before | 463 | 211 | 9 | 9 | 104 | 68 | 39 |
| Deleted | 427 | 211 | 9 | 9 | 104 | 68 | 39 |
| After | 36 | 0 | 0 | 0 | 0 | 0 | 0 |

The script matched 6 patterns: `phase17a_user_*`(156), `t_*`(52),
`id3-*`(30), `phantom_test_*`(23), `phantom_i7_*`(100),
`phantom_i4_*`(66). Audit hole H-D3 closed for the dominant rows.

Residual leakage **not** matched by current patterns (still in DB):

- `phantom_i1_*` — 12 rows (test_phase_audit_2026_04_29_i1_input_hardening.py:163).
- `phantom_i3_*` — 22 rows (test_phase_audit_2026_04_29_i3_dispatcher_timeout.py:27).
- `phantom_rotated` — 1 row (key-rotation test).

Plus the legitimate `phantom` ROOT operator. Real operators present: 1.
**P1 follow-up:** extend `TEST_USER_PATTERNS` in
`scripts/cleanup_test_users.py:31` with `phantom\_i1\_%`,
`phantom\_i3\_%`, `phantom\_rotated` and re-run.

---

## Section 2 — Dead-code findings

### Frontend — orphan imports / missing files (P0, blocks `tsc --noEmit`)

`src/components/chat/scenes/ChatScene.tsx:39-41` imports three modules
that **do not exist** on disk:

- `import { LocationScene } from './LocationScene';` — file missing.
- `import { CheckpointScene } from './CheckpointScene';` — file missing.
- `import { SandboxScene } from './SandboxScene';` — file missing.

`tsc --noEmit` errors:

```
src/components/chat/scenes/ChatScene.tsx(39,31): error TS2307: Cannot find module './LocationScene'
src/components/chat/scenes/ChatScene.tsx(40,33): error TS2307: Cannot find module './CheckpointScene'
src/components/chat/scenes/ChatScene.tsx(41,30): error TS2307: Cannot find module './SandboxScene'
src/components/settings/SettingsPanel.tsx(18,3):  error TS2305: Module '"lucide-react"' has no exported member 'Tune'.
```

The router `case` arms reference these too (`ChatScene.tsx:80,82,84`).
`PhantomManifestScene` exists. The barrel `index.ts` re-exports
`PhantomManifestScene` only — adding new scenes requires updating it.

### Frontend — wrong icon name

`src/components/settings/SettingsPanel.tsx:18` imports `Tune` from
`lucide-react`. The package has no `Tune` export — must be `Settings2`,
`SlidersHorizontal`, or similar. Used at `:880`. Crashes on prod build.

### Frontend — stale comment referencing deleted component

`src/app/StateTransitionController.tsx:32` still references `StateIndicator`
in a comment ("indicator morph — handled by CSS transition on
StateIndicator"). The component was deleted in 1668b89; comment is
misleading. Cosmetic only; no runtime impact.

### Frontend — `as never` cast hides missing channel type

`src/services/wsHandlers.ts:62` does
`wsClient.on('familiar' as never, …)` because `'familiar'` is **not** in
`WSChannel` union (`src/services/websocket.ts:5-23`). BE actively
broadcasts on this channel (`api/routes_familiar.py:140`,
`agent/actions/notify.py:43`). The cast neuters type safety. **P1.**

### Backend — orphan test files in git status

`src/backend/test_chroma.py` and `src/backend/test_fix.py` appear in
`git status` (top-level worktree) as untracked. They are stray fixture
scripts — not in `tests/`, not run by `pytest.ini`, not imported
anywhere. **P2 cleanup.**

### Backend — vitest test failures (regression)

Background `npx vitest run` produced **27 failed / 279 passed** across
4 files. Notable: `src/__tests__/layouts.test.tsx:304` —
`screen.getByText('Night time')` no longer found in `SentinelLayout`
after 9064030 (coral radar overhaul). **P1 — broken tests after FE
overhaul.**

### Backend — no clear orphan modules detected

All `tools/*_service.py` are imported by `api/routes_tools.py` →
registered via `tools_router` in `main.py:730`. `db/tools_repo.py`
consumed by `routes_tools.py:7`. `ai/scenes.py` consumed by every
`tools/*_service.py`. No orphan Python modules in product code.

---

## Section 3 — Contract gaps (FE ↔ BE)

### Tool-scene producer wiring — INCOMPLETE

`@shared/types/chat.ts:142-152` declares 10 `ToolSceneKind` values:
`timer | alarm | calendar | files | audit | wardriving | location |
checkpoint | sandbox | phantom_manifest`.

| Kind | BE producer | FE component | Status |
|------|-------------|--------------|--------|
| `timer` | `tools/timer_service.py:_scene_for` | `TimerScene.tsx` | OK |
| `alarm` | `tools/alarm_service.py` (imports `AlarmSceneData`) | `AlarmScene.tsx` | OK |
| `calendar` | `tools/calendar_service.py` | `CalendarScene.tsx` | OK |
| `files` | `tools/file_manager.py` | `FilesScene.tsx` | OK |
| `audit` | `tools/audit_service.py` | `AuditScene.tsx` | OK |
| `wardriving` | `tools/wardriving_query.py` | `WardrivingScene.tsx` | OK |
| `location` | `tools/location_history_service.py` | **MISSING** `LocationScene.tsx` | **P0 GAP** |
| `checkpoint` | `tools/checkpoint_service.py` | **MISSING** `CheckpointScene.tsx` | **P0 GAP** |
| `sandbox` | `linux/executor.py:498` (`"kind": "sandbox"`) | **MISSING** `SandboxScene.tsx` | **P0 GAP** |
| `phantom_manifest` | `api/routes_familiar.py` (no scene producer that I found) | `PhantomManifestScene.tsx` | needs verify |

**P0:** Three FE scene components are imported but never created. `tsc`
fails. Any AI reply that emits a `location`/`checkpoint`/`sandbox`
scene will hard-crash chat rendering once TS errors are resolved.

### Phase-1 Day-4 W-2 panel composer

`SceneKind` (`text|list|map-pin|plan|code-preview|identity-card`) all
present in `panels/Scene*Panel.tsx` and re-exported from `index.ts`.
No gap on the W-2 arm.

### WSChannel union vs BE broadcasts

`WSChannel` (`src/services/websocket.ts:5-23`) declares 13 channels:
`sensor | state | chat | voice | terminal | alert | map | settings |
oled | face | agent.stream | background_events | inner_monologue.stream`.

BE channels actually broadcast (grep `hub.broadcast` minus tests/venv):
`agent.stream`, `background_events`, `chat`, `familiar`, `map`, `oled`,
`sensor`, `state`. Plus the non-channel event-name args inside
`agent.stream` (`task.resumed`, `agent.budget.warning`, etc.) — those
are `type`, not `channel`.

| Channel | FE typed? | BE emits? | Status |
|---------|-----------|-----------|--------|
| `sensor` | yes | yes (`main.py:91,195`) | OK |
| `state` | yes | yes (`agent/runtime.py:399,944`) | OK |
| `chat` | yes | yes (`api/routes_chat.py:626`, `agent/proactive.py:652`) | OK |
| `voice` | yes | not found in product grep | **P1** — declared but not wired (likely emitted in `voice_pipeline.py`; verify) |
| `terminal` | yes | not found (was wired pre-overhaul?) | **P1** verify |
| `alert` | yes | not found in product grep | **P1** verify |
| `map` | yes | yes (`main.py:202`) | OK |
| `settings` | yes | yes (`api/routes_settings.py:591`) | OK |
| `oled` | yes | yes (`vision/oled_animator.py:147`) | OK |
| `face` | yes | not found in product grep | **P2** verify |
| `agent.stream` | yes | yes (many) | OK |
| `background_events` | yes | yes (`agent/runtime.py:269`) | OK |
| `inner_monologue.stream` | yes | yes (`agent/monologue_emitter.py:89`) | OK |
| `familiar` | **NO** | yes (`api/routes_familiar.py:140`, `agent/actions/notify.py`) | **P1 GAP** — FE casts `'familiar' as never` |

---

## Section 4 — Settings drift

### BE config field count vs UI

`PhantomConfig` exposes **221 fields** (`config.py`). The
`SettingsPanel.tsx` is **dynamic** — the BE serves field definitions
via `routes_settings.py:_build_definition` (introspects
`PhantomConfig.model_fields`) and the FE renders them generically. So a
naive grep for field-name string in `SettingsPanel.tsx` is **not** a
drift signal — only ~3 keys are hard-coded (`voice_always_on_enabled`,
`ai_ollama_model`, `stt_engine` reference).

That means **every** field that is not excluded by the BE category
filter automatically gets a UI control. No per-field UI drift detected.

### Hard-coded UI keys without BE check

Two FE keys hard-coded in `SettingsPanel.tsx` that must match BE config:

- `:715` — `def.key !== 'voice_always_on_enabled'` — exists in BE
  (`config.py` has it; verified in pydantic dump).
- `:968` — `def.key === 'ai_ollama_model'` — exists in BE (line 58).

No drift on the two hard-coded keys.

### Stray UI hard-codes that bypass schema

`SettingsPanel.tsx:1842` displays `status.stt_engine`. This field comes
from `voiceApi.getStatus()` not from `PhantomConfig`, so it's a
**runtime status**, not a config setting. No drift.

### One settings duplicate already closed

Commit `e43c490` removed duplicate `agent_localization_enabled`. No
fresh duplicates spotted in 221-field dump.

---

## Section 5 — Priority list

### P0 (privacy / security / crash)

- **FE-CRASH-1:** `ChatScene.tsx:39-41` imports 3 missing files
  (`LocationScene`, `CheckpointScene`, `SandboxScene`). `tsc --noEmit`
  fails; production build cannot ship. *Fix:* create the three
  scene components matching `LocationSceneData`, `CheckpointSceneData`,
  `SandboxSceneData` envelopes from `chat.ts`.
- **FE-CRASH-2:** `SettingsPanel.tsx:18` imports `Tune` from
  `lucide-react`; no such export. Used at `:880`. *Fix:* swap for
  `SlidersHorizontal` or `Settings2`.

### P1 (broken feature)

- **DB-LEAK-1:** `cleanup_test_users.py` patterns miss
  `phantom_i1_*` (12), `phantom_i3_*` (22), `phantom_rotated` (1).
  Add patterns and re-run.
- **WS-CONTRACT-1:** `'familiar'` channel missing from
  `WSChannel` union (`src/services/websocket.ts:5-23`).
  `wsHandlers.ts:62` casts `as never` to silence TS. *Fix:* add
  `| 'familiar'` to the union.
- **TEST-REGRESSION-1:** Vitest 27/306 failing post-overhaul. Notable:
  `layouts.test.tsx:304` (Sentinel "Night time" copy gone),
  4 files total. *Fix:* update tests to match sunrise copy.
- **WS-VERIFY-1:** Channels `voice`, `terminal`, `alert`, `face`
  declared in `WSChannel` but no BE producer found in product grep.
  Verify via runtime smoke (channels may be emitted via dynamic strings).

### P2 (polish)

- **DEAD-COMMENT-1:** `StateTransitionController.tsx:32` references
  deleted `StateIndicator` component; rewrite the comment.
- **STRAY-FILE-1:** `src/backend/test_chroma.py`,
  `src/backend/test_fix.py` are untracked stray scripts at backend
  root; either move under `tests/` or delete.
- **BARREL-1:** `components/chat/scenes/index.ts` re-exports only
  `PhantomManifestScene` from the tool-scene family. The 8 inline tool
  scenes (TimerScene, AlarmScene, etc.) are imported directly from
  their files in `ChatScene.tsx`. Either re-export all from the
  barrel for consistency or document the convention.

---

## Stats

- **Files scanned:** 221 BE config fields, 14 FE components in
  `chat/scenes/`, 13 BE routers, 14 shared type files, 8 tools
  services.
- **Dead-code findings:** 6 (3 P0 missing files, 1 P0 wrong icon,
  2 P2 stale-references).
- **Contract gaps:** 4 (3 missing tool-scene FE components, 1
  channel union missing).
- **Settings drift:** 0 hard drift (dynamic schema), 0 duplicates.
- **DB cleanup:** 463 → 36 users (-427 leaked test rows; 35 residual
  test rows still leaking from i1/i3/rotated patterns).
- **Vitest:** 4/33 files failing, 27/306 tests failing.
- **TS errors:** 4 hard errors (3 missing modules, 1 missing export).
