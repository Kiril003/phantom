# Plan: phase-22-G + phase-27-e — settings & chat compaction (round 2)

## Context

Operator (Kiril) tested round 1 (commits b77cbae phase-22-F + 6649da5 phase-27-d) on the 1024×600 device and rejected:

> в налаштуваннях пошук великий, елементи теж і досі великі, не компактні, та деякі не видно, місце краще використовуй. по чату взагалі НУЛЬ виправлень

Translation:
- Settings search bar is big
- Settings elements still big, not compact
- Some elements **not visible** (clipped/off-screen)
- Use space better
- Chat: ZERO fixes happened

Three Explore agents traced the actual root causes:

**Why chat felt invisible:** `sessionsOpen` defaults to `!minimalChrome` (`ChatWindow.tsx:100`) → on the live device the sessions sidebar is **OPEN by default**, eating **260px of width**. Round 1 cuts (empty state, gap-3, no Enter pill) all happened inside a compressed 764px viewport, so the changes barely registered. Operator was right — for them, it was zero.

**Why settings still feel cramped:**
- `SettingsFilterBar` ~44px tall + "Розширені" toggle steals **~104px horizontal** even when off
- Sidebar category buttons `minHeight: 44`. With 10+ categories the list **clips at the bottom** (one of the "не видно" symptoms)
- List gap 8px × ~40 rows = 320px of pure gap
- Theme tiles still 60px (3 × 60 = 180px on a 348px scrollable list = 52% of vertical real estate)
- Section header buttons (Reset/SAVE) `minHeight: 44`
- Sidebar inner padding 14px

The operator's display arithmetic says it: at 600px tall, with status bar 44px + bottom reserve 76px + section header ~44px + filter bar ~44px + diff strip ~32px, the actual settings list area = ~360px. After fitting one Theme picker + one AIProviderDiagnostics, only ~120px is left for actual rows.

## Goal

Two atomic commits that make a **visually obvious** density jump on a 1024×600 touch screen:

- **phase-22-G** — settings: kill the search/filter bar bulk, sidebar density, list gap, theme tiles, header buttons. Make every category fit on screen. Stop clipping.
- **phase-27-e** — chat: address the actual giants — sessions sidebar default state, glass-pill minHeight at idle, header height, ModelCard placement, meta-line density. Make round 1's cuts actually visible.

Goal pixel reclaim:
- Settings: ~150–200px vertical visible (per category page) + ~50px horizontal on the search row
- Chat: 260px width (sidebar default) + ~40–60px vertical (header + pill + meta)

## Files to modify

### phase-22-G
- `src/frontend/src/components/settings/SettingsPanel.tsx`
  - `SettingsFilterBar` (~lines 824–968) — search row compaction
  - Sidebar category buttons (~lines 313–363) — density
  - Sidebar wrapper padding (~line 231) — 14→10
  - List `gap: 8` → `gap: 6` (~line 580)
  - Section header (~lines 410–547) — Reset/SAVE/Status pills tighter
  - `ThemePicker` tiles (~lines 1335–1424) — 60→48
- `src/frontend/src/components/settings/SettingsAccordion.tsx`
  - Header `minHeight: 44` → `40`
- Tests: re-run `src/__tests__/settings-accordion.test.tsx` (24/24 must stay green)

### phase-27-e
- `src/frontend/src/components/chat/ChatWindow.tsx`
  - `sessionsOpen` default — change to `false` regardless of `minimalChrome`, keep menu toggle as the way to open it (line 100)
  - Header (lines 616–679) — `height: 52` → `48`, NEW button minHeight already 28 — keep
  - Glass pill `minHeight: 52` → `44` at idle (line ~920) — textarea `maxHeight: 120` keeps growth
  - Textarea `padding: '10px 12px'` → `'8px 10px'` (line 1028)
  - Move `ModelCard` echo from above-rail to inline with NEW button area in the **header** (lines 850–859) — reclaims 20px+padding above the input rail
  - Meta line (`MessageBubble.tsx:189–231`) — keep but reduce font / drop tokens unless > 0
- Tests: re-run `src/__tests__/chat.test.tsx` (36/36 must stay green) — adjust the sessions-open assertion if it asserts default state
- Maybe add tests for: header height 48, glass pill 44 at idle, sessionsOpen default false

## Approach

### phase-22-G changes (concrete diffs)

1. **SettingsFilterBar** — collapse "Розширені" label to icon-only at rest, show label only when toggle is on. Reduce container padding `8px 10px` → `4px 8px`. Drop divider line; rely on icon spacing. Result: ~28px total height, gives the search input ~50px more horizontal room.

2. **Sidebar category buttons** — `minHeight: 44` → `40`, `padding: 8px 10px` → `6px 8px`. `gap: 2` between buttons → `gap: 1`. With 10 categories this saves ~50px and lets all of them fit at 600px.

3. **Sidebar wrapper padding** — `padding: 14` → `10`. Saves 8px on top + 8px on bottom of the sidebar inner content.

4. **List `gap: 8` → `gap: 6`** — at ~40 rows, saves ~80px of pure breathing space without making rows touch.

5. **Section header buttons (Reset / SAVE)** — `minHeight: 44` → `36`, `padding: '6px 12px'` → `'4px 10px'`. Touch rule says 44×44 hit area — these stay >36×36 visible + transparent padding to maintain hit area.

6. **ThemePicker tiles** — `minHeight: 60` → `48`, swatch 36 → 28, `padding: '8px 10px'` → `'6px 8px'`. 3 tiles × 12px saved = 36px.

7. **SettingsAccordion** — header `minHeight: 44` → `40`. Saves 4px per accordion (~5 accordions × 4 = 20px).

### phase-27-e changes (concrete diffs)

1. **`sessionsOpen` default false** — `useState(!minimalChrome)` → `useState(false)`. Sidebar opens via menu toggle (always visible in header). This alone reclaims **260px of width** for the chat surface and is the change that makes round-1 visible.

2. **Header `height: 52` → `48`** — NEW button stays at minHeight 28; menu button stays at 32. Reduces title row from 52 to 48.

3. **Glass pill `minHeight: 52` → `44`** at idle — textarea `minHeight: 40` already; pill grows naturally with multi-line content via `maxHeight: 120` on textarea.

4. **Textarea padding `'10px 12px'` → `'8px 10px'`** — saves 4px vertical, looks closer to a normal input height on touch.

5. **Move ModelCard echo into the header right side** — currently a 20px+padding line above the input rail showing "gemini · whisper". Inline as a small chip next to the NEW button or as a subtle pill in the header. Saves ~26px of the input rail chrome. (If the move is risky, just hide ModelCard when input is empty + idle, show only when expanded — also saves 26px in the common case.)

6. **MessageBubble meta line tighten** — keep timestamp + provider dot, drop tokens unless >0 (already done) and drop latency unless > 100ms. Reduce font from `var(--fs-micro)` to 9px on touch. Saves ~2px per message × 30 = 60px in long scrolls.

## Verification

After each commit:

1. `npx vitest run src/__tests__/settings-accordion.test.tsx` — must be 24/24
2. `npx vitest run src/__tests__/chat.test.tsx` — must be 36/36
3. `npx tsc --noEmit 2>&1 | grep -E "(SettingsPanel|ChatWindow|MessageBubble|settings-accordion|chat\.test)"` — must be empty
4. **Eyeball at 1024×600** — operator self-check:
   - Settings: open the panel with category list visible; all 10+ categories should fit without scrolling the sidebar; the search row should be ≤32px tall; with one category open, ≥8 SettingRows visible without scroll.
   - Chat: open the chat tab; the sessions sidebar should be CLOSED by default; the chat surface uses the full 1024px width; empty-state hero is small (32px halo); input rail at idle is ≤48px tall (glass pill).

5. Commit per phase, atomic, message format identical to prior phase commits (operator complaint quoted, three numbered cuts, test counts at the end, Co-Authored-By trailer).

## Out of scope (deliberate)

- Avatar batching for consecutive same-sender messages — this changes information architecture, risky for a density pass. Defer.
- AttachDrawer modal-bottom redesign — UX redesign, separate phase.
- Error banner queue/toast consolidation — only matters in failure mode; don't touch happy path.
- Outer DialogueLayout chrome (296px voice orb, 76px bottom reserve) — that's a layout-level pivot, not density. Defer to a separate planning round.
- StatusBar shrinking — touched by many tests; defer.

Round 2 is intentionally a density pass with a single architectural cut (sidebar default-closed). If after this the operator still says "zero," the next round becomes layout-level (voice orb panel sizing, bottom reserve removal).
