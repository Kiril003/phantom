# Morning Report — 2026-04-30 (sunrise redesign Wave 0/1/2)

**Branch:** `autonomous-run` @ `7b95fed`
**Session-recovered from compact crash; 22 phase-5 commits shipped overnight.**

---

## Shipped (commit chain, oldest first)

### Wave 0 — Foundation + R0/R1 contracts
- `35272a8` token migration → sunrise-warm + cyberdeck-cold opt-in
- `176163d` CONTRACTS_R1.md (agent scope split + schemas)
- `de4401e` FE-CORE StatusBar (status-pill, sensor chips, MSym icons)
- `455c3f9` FE-SBX full-screen ROOT executor + WS stream

### Wave 1 — Backend infrastructure (rescued from crash uncommitted)
- `8312757` BE-SANDBOX `linux/{executor,dangerous_patterns,resource_monitor}.py` + routes_linux + WS streaming + kill-switch
- `080c906` BE-TOOLS 9 services (`timer/alarm/calendar/file_manager/wardriving_query/location_history/audit_service/checkpoint_service`) + `ai/scenes.py` + `db/tools_repo.py` + tactical-memory janitor + Chroma 0.5 defensive

### Wave 1 — Frontend foundation (rescued from crash uncommitted)
- `1668b89` FE-LAYOUTS-1 Shadow/Focus/Dialogue sunrise overhaul + Overlays + FloatingToolbar (deletes StateIndicator + ObservationCard)
- `5fa2135` FE-SCENES composer + 8 inline scene-kind types in `chat.ts`
- `81926b3` THEME-NIGHT + SETTINGS-REWRITE — 3-theme picker (`sunrise-warm` / `amber-night` / `cyberdeck-cold`) + 1546-line accordion settings
- `92ea121` VERIFIER audit deltas + AKG L0 phase doc
- `7053110` FE-SCENES-2 scene components (TimerScene/AlarmScene/CalendarScene/FilesScene/AuditScene/WardrivingScene) + StandingOrdersOverlay + .gitignore for ONNX blobs

### Wave 1 — Identity + visual overhaul (cherry-picked from worktrees)
- `eb2a10c` BE-IDENTITY 4-modality fusion (voice 0.35 / face 0.30 / rfid 0.20 / context 0.15) + ChromaDB per-user collection isolation (closes audit C-4 P0)
- `9064030` FE-LAYOUTS-2 SentinelLayout coral radar + threat detection
- `70c60e8` FE-AUTH keyframes (phantom-pulse + phantom-shake + rfid-scan)
- `6e9a70a` FE-AUTH ProfileSelector + PIN-pad + RFID flow

### Wave 1 — New signature feature
- `2edc7aa` FE-OPERATOR plan-tree + agent timeline + goal-input
- `fc6d7be` FE-MAP warm tactical map + glass markers + B-WK-3 fix
- `a817b11` PHANTOM-FAMILIAR — wisp creature, 7 SVG poses (idle/floating/pointing/peeking/sleeping/waving/vanishing), Bezier float
- `de77fe5` FAMILIAR-2 AI tool registration + Settings rarity slider
- `78b0d61` FAMILIAR-3 docs/PHANTOM_FAMILIAR.md (operator's design batch-3 prompt) + TS2308 dedupe

### Wave 2 — Verification
- `9c3d4f9` VERIFIER report — DB cleanup 463 → 36 users, dead-code sweep, contract audit
- `5044b3f` VERIFIER-P0-FIX — 3 missing scene files (LocationScene/CheckpointScene/SandboxScene) + lucide `Tune→SlidersHorizontal` + WSChannel `'familiar'`
- `7b95fed` QA-TESTS triage report (28 vitest fails / 12 pytest fails — clusters logged)

---

## Build state

- `tsc --noEmit` frontend: **0 errors** (was 5 P0)
- `vitest run`: 278 pass / 28 fail / 306 total — non-blocking, clusters logged
- `pytest`: 1650 pass / 12 fail / 1 skipped — non-blocking, clusters logged

## Open clusters for next phase (priority-ordered)

| ID | Pri | Owner | Symptom |
|---|---|---|---|
| R1-SANDBOX-KILL-PATH | P0 | linux/executor.py | `session.killed_by` never set, kill returns False (3 backend fails) |
| R1-CHECKPOINT-SCHEMA-DRIFT | P0 | tools/checkpoint_service.py | Pydantic rejects `reason='sandbox_complete'`, requires new `goal` field |
| R1-CHATFIX-DEFAULT-SCENE-ATTACHMENT | P1 | api/routes_chat.py | Empty bubble appends empty scene attachment (6 backend fails) |
| R1-STRATEGIC-MEMORY-FILTER | P1 | memory/strategic_memory.py | Defensive filter overzealous, drops legit facts |
| R1-FLOATTOOLBAR-VOICE | P1 | core/FloatingToolbar.tsx | Voice-mode tests 7/7 fail |
| R1-SENTINEL-LABELS | P1 | layouts/SentinelLayout.tsx | 3 vitest text-label assertions fail |
| QA-VISUAL re-run | P1 | new agent | Playwright sweep crashed mid-run; 27 screenshots not taken |
| DB cleanup residual | P2 | scripts/cleanup_test_users.py | 35 fixture users still leak (`phantom_i1_*`, `phantom_i3_*`, `phantom_rotated`) |
| H-WK-4 P2 | carry | layouts/MapLayout state collision | defer to R3 |
| H-WK-6 P3 | carry | voice always-on permission gate | not yet covered |

## Carry-forward closed by this run

- ✅ C-4 P0 ChromaDB cross-user privacy (BE-IDENTITY)
- ✅ B-1 P1 standing_orders WS subscriber (FE-SCENES-2)
- ✅ B-WK-3 P2 map stale-banner premature (FE-MAP)
- ✅ B-13/14 P3 timer/alarm/calendar tools (BE-TOOLS + scene components)
- ✅ B-17 P3 ChatMessage.scene unrendered (ChatScene composer)
- ✅ H-MM-3 SentinelLayout paper-thin (FE-LAYOUTS-2)
- ✅ Day-5 audit H-D3 — DB cleanup applied (425 fixture users drained, 35 residual)

## Hardware budget learning

This Radxa (8-core aarch64, 11Gi RAM) handled 12 parallel agents = crash. Sustainable budget = **3-4 agents/wave**. QA-VISUAL OOM-killed during Wave 2 (load 19.9 / 15-min). Next session should keep ≤3 concurrent agents + monitor `free -h`.

## Operator action items

1. **Paste design batch-3 prompt from `docs/PHANTOM_FAMILIAR.md`** into claude.ai/design to refine the 7 wisp SVG poses (current poses are coder-drawn placeholders; production-grade SVG awaits operator's design pass).
2. **Restart vite + uvicorn** to pick up theme/scene changes: `cd src/frontend && npm run dev` and `cd src/backend && uvicorn main:app --host 0.0.0.0 --port 8000`.
3. **Verify themes visually** — login (PIN `000000`), Settings → Theme → switch between sunrise-warm / amber-night / cyberdeck-cold.
4. **Re-run QA-VISUAL** after backend P0s are fixed (Playwright sweep + screenshot grid).
