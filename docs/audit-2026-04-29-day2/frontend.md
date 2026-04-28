# Day-2 Frontend Audit — 2026-04-29

Scope: read-only audit of `src/frontend` at HEAD on `autonomous-run`. Cross-referenced against
`src/backend/api/routes_settings.py` and `src/backend/config.py`.

---

## Settings UI — Day 1 config-key gaps

The settings schema is **opt-in**: `_collect_categories()` walks `CATEGORY_SPEC` and only
emits rows for keys that are explicitly listed (`routes_settings.py:416-431`). Anything not
in a category is invisible to `SettingsPanel.tsx`, even though `PUT /settings/{key}` will
still persist the value. `_build_definition()` also requires a `LABEL_OVERRIDES` entry to
get a humane label — without it the row is auto-titlecased from the snake_case key.

**All 6 of the new chat keys ship invisible.** The `agent_risk_tolerance` key is also
missing from `CATEGORY_SPEC` and was already missing before Day 1; only its default flipped.

| Key                                  | Category in `CATEGORY_SPEC`? | Label override? | Severity |
|--------------------------------------|------------------------------|-----------------|----------|
| `chat_prompt_logging_enabled`        | no                           | no              | **P1**   |
| `chat_prompt_excerpt_max_chars`      | no                           | no              | **P1**   |
| `chat_tools_enabled`                 | no                           | no              | **P1**   |
| `chat_tool_locationhistory_limit`    | no                           | no              | **P2**   |
| `chat_tool_anchors_limit`            | no                           | no              | **P2**   |
| `chat_tool_max_calls_per_turn`       | no                           | no              | **P2**   |
| `agent_risk_tolerance`               | no (was always missing)      | no              | **P1**   |

Proposed wiring (single PR against `routes_settings.py:101-252` and `:254-342`):

1. **New category `chat`** (icon `💬`, label "Чат") with keys:
   `["chat_prompt_logging_enabled", "chat_prompt_excerpt_max_chars",
   "chat_tools_enabled", "chat_tool_locationhistory_limit",
   "chat_tool_anchors_limit", "chat_tool_max_calls_per_turn"]`.
2. Add to existing `auth` or a new `agent` category: `agent_risk_tolerance` (range
   1..7 step 2) — current `_infer_type` returns `"number"` for `int`, which renders as
   a free-text spinner; that is acceptable but a slider would be friendlier given the
   B-2 default change to 3 (only legal values are 1/3/5/7).
3. Label overrides:
   - `chat_prompt_logging_enabled` → "Логування промптів"
   - `chat_prompt_excerpt_max_chars` → "Макс. символів виписки"
   - `chat_tools_enabled` → "Інструменти AI (location/anchors)"
   - `chat_tool_locationhistory_limit` → "Tool: history limit"
   - `chat_tool_anchors_limit` → "Tool: anchors limit"
   - `chat_tool_max_calls_per_turn` → "Tool: макс. викликів за хід"
   - `agent_risk_tolerance` → "Agent risk tolerance"

`SettingsPanel.tsx` itself needs **zero changes** — the panel iterates whatever the API
returns. `SettingsPanel.tsx:377-393` will render the new boolean and number editors via
`ValueEditor` (`:457-601`) without modification. The `agent_risk_tolerance` default
of 3 will display correctly because `ValueEditor` renders integers via the plain `number`
input (`:534-557`), so "verify integers render cleanly" is satisfied.

`UNIMPLEMENTED_KEYS` (`routes_settings.py:351-375`) is the wrong escape hatch here — these
features ARE implemented backend-side, so they should NOT carry the `[soon]` badge.

---

## Touch-target violations

CLAUDE.md #2 mandates min 44×44 px. The codebase is mostly disciplined: every interactive
element in `SettingsPanel.tsx` (sidebar `:157-203`, save/reset `:270-322`, every editor
variant `:472-600`) explicitly sets `minHeight: 44` and a `minWidth` where width is
constrained.

Findings:

1. **NPU diagnostics Refresh button — 32 px tall**
   `SettingsPanel.tsx:1015-1039` sets `minHeight: 32` for the "Refresh" pill in the
   voice-category NPU diagnostics card. This is the only button on a settings screen
   below the 44 px floor. **P2** (low-frequency action; still a violation).

2. **Settings dirty-counter pill — 16 px**
   `SettingsPanel.tsx:184-201` renders a 16×16 px badge inside the sidebar button.
   The badge isn't independently clickable (the entire 44-px sidebar row is the hit
   target), so this is fine. Noted to avoid re-flagging next audit.

3. **Sentinel layout decorative dot — 12×12**
   `SentinelLayout.tsx:117` renders a 12×12 marker; not interactive. Fine.

4. **Ghost layout micro-indicator — 3×3 px**
   `GhostLayout.tsx:33-39`. Intentionally invisible per `SECRET_FEATURES.md`; not
   interactive. Fine.

5. **ChatWindow composer**
   `ChatWindow.tsx:341-346, 443-455, 488-489, 648-656, 696-705, 751` — every button
   uses `minWidth: 44; minHeight: 44`. The send button has `width: 40; height: 40`
   which is overridden by the explicit `minWidth/minHeight: 44`, so the actual hit
   target is 44×44. Visually 40 px but tactile-correct. Fine.

6. **DialogueLayout / OperatorLayout**
   No raw clickable elements outside of `ChatWindow`, `FloatingToolbar`, and `AgentPanel`
   (already audited). No violations.

7. **`ChatErrorBanner` "Open Settings" link**
   `ChatWindow.tsx:751` sets `minHeight: 44` with vertical padding; OK.

Net: **1 P2 violation** (NPU Refresh).

---

## 1024×600 overflow risks

Every layout root binds `w-[1024px] h-[600px]` and uses `flex flex-col` with
`min-h-0` on scroll containers. Static analysis:

| Layout            | Root size           | Internal scroll/overflow handling                                              |
|-------------------|---------------------|--------------------------------------------------------------------------------|
| `ShadowLayout`    | 1024×600 ✓          | `flex-1 overflow-hidden` (`:31`) — orb-only, safe                              |
| `FocusLayout`     | 1024×600 ✓          | `min-h-0` on log card, internal `overflow-y-auto` (`:177-178`) — safe          |
| `DialogueLayout`  | 1024×600 ✓          | aside is fixed 300 px; chat side uses `inset` glass + `pb-14` — safe           |
| `SentinelLayout`  | 1024×600 ✓          | `overflow-hidden` (`:52`); aside fixed 320 px → main only 704 px — safe        |
| `GhostLayout`     | 1024×600 ✓          | absolute positioning only — safe                                               |
| `DreamLayout`     | 1024×600 ✓          | explicit `overflow-hidden` (`DreamLayout.tsx:28`) — safe                       |
| `OperatorLayout`  | 1024×600 ✓          | `grid grid-cols-12` with `min-h-0` — safe                                      |
| `MapLayout`       | 1024×600 ✓          | `min-h-0` on main; map handles its own viewport — safe                         |

No explicit heights >600 px. No horizontal overflow patterns. Note: `Avatar size={100}`
plus `100 + ring*80` rings in `SentinelLayout.tsx:67-71` produces a 340 px outer ring
(ring=3), well within the centre column (`flex-1` of 1024-320 = 704 px). Sweep line is
180 px tall (`:88`), inside the 600-56 (status bar) main pane. **No P0/P1 risks.**

One thing to keep an eye on: `ChatWindow.tsx:684-693` uses `maxHeight: 120` on the
composer textarea; with `pb-14` on the chat pane this yields 600 - 32 (statusbar) - 56
(toolbar) - 120 (composer) ≈ 392 px scroll area for messages. Fine but tight; if a
future feature parks more chrome above the composer, document risk before merging.

---

## Dead code candidates

Cross-checked every file in `stores/`, `hooks/`, `components/`, `services/`, `app/`,
`layouts/` against `grep -rn` of importing siblings.

| Candidate                          | Imported by         | Verdict                              |
|------------------------------------|---------------------|--------------------------------------|
| `stores/oledStore.ts`              | `OledEyePreview`, `app/providers.tsx` | live                          |
| `stores/faceStore.ts`              | `Overlays`, `StatusBar`, `settingsBootstrap`, `useFaceDetection` | live |
| `stores/inputModeStore.ts`         | `VoiceAlwaysOnGate`, `useVoiceRecorder`, `useVoiceAlwaysOn` | live      |
| `stores/voiceAlwaysOnStatusStore`  | `DialogueLayout`, voice hooks            | live                       |
| `stores/agentStore.ts`             | `OperatorLayout`, `AgentPanel`           | live                       |
| `stores/uiStore.ts`                | (not yet checked exhaustively but `8.8 KB`, used by `Overlays` per `:14`) | live |
| `components/core/FloatingWindow`   | `Overlays.tsx:14`                        | live                       |
| `components/core/Overlays`         | `app/App.tsx:7`                          | live                       |
| `components/core/OledEyePreview`   | `StatusBar.tsx:24`                       | live                       |
| `components/core/AmbientGlows`     | every layout + `LoginScreen`             | live                       |

**No orphan modules detected.** The frontend is tight; Day 1 added zero frontend code
and Phase 17b/19 will get a clean slate.

Minor: `agentStore.test.ts:19` still hardcodes `risk_tolerance: 5` (legacy default).
Update that fixture when wiring the slider — otherwise B-2 regression check passes
purely by accident. **P2.**

---

## Animation discipline

CLAUDE.md #9 says every animation must carry information. Walked every Framer Motion
call site.

Information-carrying (kept):

- `StateIndicator` (`:88-145`) — fade/scale on state-machine transitions; conveys the
  state change.
- `FloatingToolbar` (`:352-375`) — slide-in conveys panel availability.
- `MessageBubble` (`:34-159`) — entry slide and ghost-typing pulses convey arrival
  and ongoing-stream status.
- `ChatWindow` (`:478-595`) — typing dots + streaming partial fade convey live
  inference.
- `Avatar` (`:177-190`) — pulse tied to system state; conveys readiness.
- `MetricCards`, `TerminalResponse`, `MarkerCard`, `PinPad`, `LoginScreen` — all
  carry state or arrival info.
- `RFIDScanner` (`:73-117`) — sweep + dots convey scanning progress.
- `DialogueLayout` (`:44-166`) — 0.4-0.5 s entrance, no infinite loops; carries
  layout-mount info.
- `FocusLayout` (`:122-152`) — single 0.6 s reveal; carries focus engagement.
- `OperatorLayout` (`:28-34`) — single fade; mount info.
- `MapLayout` (`:24-30`) — single fade; mount info.
- `ShadowLayout` (`:34-38`) — slow ambient reveal of time/temp; carries
  "system is alive but quiet" information per state contract.

Borderline-decorative (kept under #9 if you accept "ambient state telemetry"):

1. **`SentinelLayout.tsx:43-50`** — flash overlay with `opacity:[0,0.06,0]` looping
   every 0.8 s. Could read as decorative red flicker; on the device it's actually a
   "this is the alert state" cue. **P2** — defendable but the cheapest cut if any
   animation gets pruned.
2. **`SentinelLayout.tsx:61-118`** — radar ring scale + sweep line + presence dot.
   The sweep at `duration: 4, repeat: Infinity, ease: 'linear'` (`:94-95`) is pure
   skeuomorph: it does not encode anything that isn't already in `other_distance`.
   **P2** if you read CLAUDE.md #9 strictly. Recommend leaving alone — radar sweep
   is a state-cue convention, not decoration.
3. **`SentinelLayout.tsx:150-155`** — alarm bell pulse (`scale:[1,1.15,1]` infinite).
   Conveys "active alert"; OK.
4. **`GhostLayout.tsx:27-40`** — micro red dot opacity loop. Convention-encoded
   "you are recording"; OK per `SECRET_FEATURES.md` requirement that GHOST be
   recognisable only to the operator.
5. **`DreamLayout.tsx:84-109`** — ambient particles. The intent is state-as-mood
   (DREAM = passive consolidation). **P2** — closest thing to a pure-decoration
   call site, but the spec for DREAM explicitly asks for ambient drift. Defensible.

Net: zero **P0/P1** animation violations; 2-3 **P2** call sites that one could trim
if a perf budget audit demands it.

---

## WS / store subscription regressions

Confirms F-19 from Day 1 perf audit.

`systemStore.ts:65` — `setContext: (ctx) => set({ context: ctx })` replaces the entire
`context` object on **every WS context message**. There is no diff/equality short-circuit
(contrast with `setVoiceAmplitude` at `:69-74` which DOES short-circuit sub-threshold
deltas). When `app/providers.tsx:134` dispatches `useSystemStore.getState().setContext(snapshot)`
on each `context.tick` (5 Hz per `providers.tsx:64-84` — actually 0.2 Hz; backend may
push faster), every component using `useSystemStore((s) => s.context)` re-renders.

Subscribers to `s.context`:

- `layouts/ShadowLayout.tsx:14`
- `layouts/FocusLayout.tsx:26`
- `layouts/DialogueLayout.tsx:20`
- `layouts/SentinelLayout.tsx:25`
- `layouts/GhostLayout.tsx:15`
- `layouts/DreamLayout.tsx:15`
- `components/map/TacticalMap.tsx:93`
- `components/map/layers/PresenceLayer.tsx:31`
- `components/core/StatusBar.tsx:42` — uses `useSystemStore()` with no selector,
  so it re-renders on **every** store mutation (state, context, esp32, voice
  amplitude, ws connected). This is the worst offender.

Plus indirect: `FocusLayout` derives 6+ scalars off `context` per render
(`:30-37`), and `DialogueLayout` reads `context.body.breathing_bpm`, `stress_level`,
`where.place_name`, and `system.ai_provider` via `ContextLine` children that re-render
in lockstep.

**Severity: P1.** Not broken at the device today (the 7" panel is 60 Hz and the
context tick is sub-Hz on dev hardware), but under full sensor cadence (500 ms ESP32
batch → ContextEngine → WS broadcast) you can hit 2 Hz of full-tree re-render. The
fix is one of:

1. Selector-narrowing inside each layout (e.g. `useSystemStore((s) => s.context?.body.breathing_bpm)`).
2. `setContext` does shallow-equality of the top-level slots and bails when nothing
   changed (`systemStore.ts:65`).
3. Backend sends only the changed sub-snapshot (the F-19 root cause).

(2) is the smallest patch and unblocks (3) being optional.

`StatusBar.tsx:42` is a separate **P1** — `const { state, wsConnected, context, esp32 } = useSystemStore();`
destructures the whole store, defeating Zustand's selector model. Should be four
individual `useSystemStore((s) => s.state)`-style selectors.

---

## P0/P1/P2 punch list

### P0 — broken at the device today
*(none)*

### P1 — will break under load or under multi-tenant
1. `routes_settings.py:101-252` — wire 7 new Day-1 keys into `CATEGORY_SPEC`
   (`chat_*` → new `chat` category; `agent_risk_tolerance` → existing `auth` or new
   `agent` category). Add `LABEL_OVERRIDES` entries. Without this fix every Phase-16/17a
   feature is operator-invisible from the UI.
2. `systemStore.ts:65` — `setContext` writes a fresh object every tick with no
   shallow-equality bail; cascades into 8+ subscribers and triggers full layout
   re-renders at WS cadence.
3. `StatusBar.tsx:42` — `useSystemStore()` without a selector destructures the
   whole store; re-renders on every mutation including unrelated `voiceAmplitude`
   updates (which fire at audio rate when listening).
4. Integer-only constraint on `agent_risk_tolerance` (legal values 1/3/5/7) is not
   enforced by the generic number editor (`SettingsPanel.tsx:534-557`); operator
   could type `4` and it would persist with no backend rejection visible in the UI.

### P2 — polish
5. `SettingsPanel.tsx:1015-1039` — NPU "Refresh" button is 32 px tall; bring to 44.
6. `SentinelLayout.tsx:43-50` — pure-flash overlay loop is the most decoration-shaped
   animation under CLAUDE.md #9; consider linking opacity to `context.alert_intensity`
   when that field exists.
7. `__tests__/agentStore.test.ts:19` — fixture still hardcodes `risk_tolerance: 5`;
   update for B-2 default of 3.
8. `chat_tool_*` keys could be hidden inside an `Advanced` collapsible in the new
   `chat` category — six rows is a lot to reveal at once on 1024×600.

---

**Total findings: 8.** Zero P0, four P1, four P2.
