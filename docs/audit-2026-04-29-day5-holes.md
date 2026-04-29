# Day-5 Comprehensive Audit — UI Surfaces + Behavior Holes

**Started:** 2026-04-29
**Operator brief:** "проект здається має багато дірок. лише 20% з всього коду правильно використовується. перевірити все візуально через браузер і що не працює або де щось не так виправити".

**Scope rule:** Claude Code is doing parallel work on the app. **Do NOT touch** in-flight scaffolding (work-in-progress files visible in `git status`). This audit catches REAL holes — broken wiring, dead code paths, mismatched contracts, UX dead-ends — not stylistic preferences.

**What "hole" means here (and what it doesn't):**
- ✓ Wired but broken (button does nothing / 404 / WS no event)
- ✓ Backend API exists but no frontend caller (or vice versa)
- ✓ Contract mismatch (FE expects field X, BE returns Y)
- ✓ Stale references / dead imports
- ✓ Settings exposed in UI but never read by the consumer
- ✗ "I'd prefer this UX" — that's design taste, separate concern
- ✗ "This file is long" — refactor scope, separate concern
- ✗ TODO comments left for future phases — author intent, not a hole

---

## Audit Phases

### Phase 1 — Static code map
- Run `grep -rn "TODO\|FIXME\|XXX\|HACK"` across `src/`, classify
- Diff backend route registry vs frontend `services/api.ts` callers
- Diff WS broadcast types vs `useChatStream` / WS consumers
- Find Pydantic models with no FE TypeScript counterpart (and vice versa)
- Find Zustand stores with fields nothing reads
- Find React components imported nowhere

### Phase 2 — Live browser sweep
- Login → Profile picker (≥2 ops) → PIN flow
- Each SystemState: SHADOW / FOCUS / DIALOGUE / SENTINEL / GHOST / DREAM (if togglable)
- ChatWindow: send text, send voice, attach drawer, model card, dynamic picker
- Map: tactical, layers, marker cards, services health
- Settings: every group, every field — does it persist? does the consumer read it?
- Tools: timer, alarm, calendar, file manager
- Standing orders overlay
- Terminal widget
- Wardriving / SIGINT
- Linux executor confirmation flow
- Sandbox-from-chat (currently NOT wired — confirm it's the audit pass that catches this)

### Phase 3 — Backend behavior smoke
- All `/api/v1/*` routes return non-500 on a happy-path call
- WS connect → subscribe channels → events arrive
- Voice pipeline: wake word fires; STT confidence gate works; trivial drops
- Identity: face/voice match → username; behavior on miss
- Memory: ChromaDB recall / fact persist; per-user isolation (C-4 status)
- Standing orders: tick / fired / skipped events arrive in WS

### Phase 4 — Cross-cutting invariants
- Every public route in `tests/test_phase_audit_*_o5_test_infra_hardening.py` allowlist actually exists (Day-3 D3-A-9 already covers; verify still green)
- Auth gate fires on every non-allowlisted route
- No hardcoded colors in `components/` (VISUAL_SYSTEM compliance)
- No `font-mono` on body text
- 1024×600 fits without scroll on each layout

---

## Agent Plan (parallel, after compact)

When this audit resumes:

1. **Agent A — `Explore` subagent**: enumerate all React routes, all FastAPI routes, all WS event types. Produce `docs/audit-2026-04-29-day5-holes/_inventory.md`.

2. **Agent B — `code-analyzer` subagent**: scan `services/api.ts` vs `routes_*.py` for mismatches (missing FE caller, missing BE handler, contract drift). Append to `_holes.md` table.

3. **Agent C — `tester` subagent**: run full pytest + vitest, list failing tests as confirmed regressions.

4. **Agent D — manual browser sweep** (if Playwright/Chrome installed; otherwise instruct operator):
   - For each layout, take a screenshot via `mcp__plugin_playwright_playwright__browser_take_screenshot`
   - Record console errors via `browser_console_messages`
   - Report unwired buttons / 404 fetches / overflow
   - Append to `_holes.md`

Use `Agent` tool in **a single message with multiple parallel tool uses**. Background each one with `run_in_background: true` so they don't block. Cap at 4 concurrent (operator's token budget).

---

## Holes Log (append-only, fill during audit)

| # | Surface | Hole | Severity | Repro | Fix sketch | Status |
|---|---------|------|----------|-------|------------|--------|
| B-1 | WS `standing_orders` channel | BE registers `dispatch.standing_order_broadcaster` and fans 3 event topics (tick/fired/skipped) onto WS channel `standing_orders` (`dispatch/standing_order_broadcaster.py:43,67`), but no FE subscriber exists. `wsClient.on('standing_orders', …)` is never called and the channel is not in the `WSChannel` union (`services/websocket.ts:5-20`). ScenePlanStepPanel header even comments "until T-3 wires standing-orders runner events through to the UI". Standing orders silently fire with no UI feedback. | P1 | Create a standing order via `POST /agent/standing_orders`, wait for tick — no UI notification | Add `'standing_orders'` to `WSChannel` union; subscribe in providers or StandingOrdersOverlay and dispatch into `agentStore`/toast | Open |
| B-2 | WS `background_events` channel | `agent/runtime.py:269` broadcasts substate/checkpoint/quota events onto `background_events` for background-track agent ticks, but no FE subscriber exists; channel not in `WSChannel`. Background-track agent state is invisible to the UI. | P2 | Start a background agent task; substate transitions don't reach the FE | Add channel to FE union; route into agentStore alongside `agent.stream` | Open |
| B-3 | WS `settings` channel | `routes_settings.py:587` broadcasts `config.reloaded` after every PUT so other clients refresh live, but no FE consumer; channel not in `WSChannel` union. Multi-tab settings stay stale until manual reload. | P2 | Open settings on tab A and tab B, change a value on A — B does not refresh | Add channel + handler that re-runs `bootstrapSettings()` or merges the patch | **Closed** — settingsBootstrap installs WS subscriber after first run |
| B-4 | WS `map` channel | `main.py:201` broadcasts `wardriving_update` on channel `map` whenever a new AP is captured, but no FE listener — `mapStore` only polls `getWardriving()`. New APs invisible until next poll. | P2 | Trigger wardriving capture; FE doesn't append marker until next poll cycle | Subscribe to `map` channel and append into `mapStore.wardrivingRecords` | Open |
| B-5 | WS `voice` channel typed but unused | `services/websocket.ts:47-51` defines `VoiceMessage` for types `partial`/`final`/`tts_start`/`tts_end`. No `wsClient.on('voice', …)` subscriber; BE never broadcasts on `'voice'` (voice events flow over a separate `/ws/voice/stream` socket in `routes_voice_stream.py`). Type is dead on both sides. | P3 | grep `'voice'` channel in BE — zero hub.broadcast calls; FE — zero subscribers | Drop `VoiceMessage` interface or wire BE to publish into the multiplexed hub | Open |
| B-6 | WS `alert` channel | `services/websocket.ts:53-57` defines `AlertMessage` with `type: 'priority'`. No FE subscriber and no BE publisher (`decision_tree.py` returns kind="alert" Decisions internally but they never become WS messages). Channel is dead. | P3 | Trigger high-priority decision (e.g. battery alert); nothing crosses WS | Wire DecisionTree alert → `hub.broadcast('alert', 'priority', …)` or remove the dead type | Open |
| B-7 | WS `terminal` channel | `WSChannel` lists `'terminal'` (`services/websocket.ts:11`) but no BE publisher and no FE subscriber. TerminalWidget is meant to stream live linux output; live feed is unreachable. | P3 | Open Terminal widget overlay; no live process output | Either delete channel or wire `linux/executor.py` streaming output to `hub.broadcast('terminal', 'output', …)` | Open |
| B-8 | WS `face` channel | `WSChannel` includes `'face'` (`services/websocket.ts:15`) but no BE broadcaster and no FE subscriber. Likely leftover from face-recognition planning that never landed. | P3 | grep — no `hub.broadcast('face', …)` anywhere | Drop from union OR wire face-recognize event → broadcast | Open |
| B-9 | `agentApi.checkpoint` / `resumeFromCheckpoint` orphaned | Backend exposes `POST /agent/task/{id}/checkpoint` and `…/resume_from_checkpoint` (`routes_agent.py:104,112`); FE wraps both in `agentApi.ts:78-81`. Neither is called from `components/`, `stores/`, or `hooks/`. User has no way to manually checkpoint or resume — feature is wired backend-only. | P2 | Open agent panel — no "checkpoint" / "resume" buttons | Add controls to ControlsBar or task detail view | Open |
| B-10 | `authApi.config` never called | `GET /auth/config` (`routes_auth.py:371`) exposes `max_pin_attempts`, `lockout_duration_m`, `session_timeout_m`. FE wrapper exists (`services/api.ts:83-87`); no caller. PinPad uses hardcoded values instead of these limits. | P2 | Set `max_pin_attempts=2` in BE config; PinPad still allows N attempts before lockout fires | Call `authApi.config()` on PinPad mount; use returned limits in lockout logic | **Not a hole** — `LoginScreen.tsx:54-62` already calls `authApi.config()` on mount and binds `max_pin_attempts` + `lockout_duration_m` into state. PinPad receives lockout via parent, not from raw config. False positive in Agent B's pass. |
| B-11 | `contextApi.history`/`state`/`current` orphaned | All three context routes (`routes_context.py`) and FE wrappers exist (`services/api.ts:122-131`). No caller anywhere. The `history` endpoint (60-min trend) was clearly designed for a sparkline/StatusBar trend that never landed. | P3 | grep `contextApi\.` outside services/ — zero hits | Wire to StatusBar trend chart, or remove FE wrappers | Open |
| B-12 | `linuxApi.resources` never displayed | `GET /linux/resources` (`routes_linux.py:71`) returns CPU/RAM/disk/temp/load. FE wrapper exists (`services/api.ts:370-379`); no caller. StatusBar uses sensor snapshot, not this richer payload — temperature + load average never displayed. | P3 | StatusBar shows no temp_c or 1/5/15-min load | Wire poll into StatusBar or system health panel | Open |
| B-13 | `toolsApi.*` four wrappers all orphaned | `toolsApi.createTimer`/`createAlarm`/`getCalendar`/`createEvent` (`services/api.ts:415-424`) wrap real BE routes (`routes_tools.py:38-99`); zero callers in FE. Timer/Alarm/Calendar UI absent — plumbing exists on both ends but no widget consumes it. | P3 | grep `toolsApi\.` outside services/ — zero hits | Build Tools widget per CLAUDE.md plan or delete the wrappers | Open |
| B-14 | `settingsApi.export`/`import` orphaned | Settings export (`POST /settings/export`) and import (`POST /settings/import`) routes + FE wrappers exist (`services/api.ts:201-206`); no caller. Settings UI has no Export/Import controls. | P3 | Open Settings — no export button | Add export/import buttons in SettingsPanel header | Open |
| B-15 | Duplicate `voiceApi` namespaces | `services/api.ts:135-183` exports a `voiceApi` (`tts`/`stt`); `services/voiceApi.ts` exports another `voiceApi` (`transcribe`/`synthesize`/`status`). The api.ts copy is never imported. Two namespaces colliding on the same export name. | P3 | grep imports of `voiceApi` from `services/api` — zero non-self hits; all usages import from `services/voiceApi.ts` | Delete the duplicate `voiceApi` block from `services/api.ts:135-183` | **Closed** — duplicate block deleted |
| B-16 | `STTResponse` shape mismatch | `services/api.ts:142-147` defines `STTResponse` with engine `'whisper' \| 'vosk'` and no `wake_word_matched`. `services/voiceApi.ts:18-24` defines `VoiceSTTResponse` with engine `'whisper' \| 'vosk' \| 'noop' \| string` AND `wake_word_matched: boolean`. Two divergent contracts for the same `/voice/stt` route. | P3 | Compare both interfaces side-by-side | Drop the api.ts copy (see B-15); standardise on voiceApi.ts shape | **Closed** — divergent shape removed with B-15 |
| B-17 | `ChatMessage.scene` field never rendered | `shared/types/chat.ts:121-148` ships ADR-CS-001/002 scene envelope and `response_formatter.scene_kind_for_form()` (`response_formatter.py`) is wired, but no `MessageBubble`/`ResponseRenderer` reads `message.scene` (W-2 composer not landed). Field is produced and persisted but never rendered. | P3 | grep `\.scene` in MessageBubble/ResponseRenderer — zero | Land `<ChatScene>` composer (W-2) or stop emitting `scene` from BE until W-2 ships | Open |
| B-18 | Missing `agent.stream` event handlers | BE emits at least 11 `agent.stream` event types. FE `agentStore.ts:287-360` switch handles 7. **Missing handlers: `task.blocked_quota_backoff`, `proactive.pending_action`, `proactive.action_fired`, `checkpoint.created`** — events arrive then drop on the floor. | P2 | Trigger quota exhaustion → backoff event arrives, no UI change; trigger proactive cycle pending action — UI never sees it | Add explicit case branches in agentStore.ts WS reducer for these 4 event types | **Closed** — 4 handlers + AgentEventType union extended |
| B-19 | Proactive `chat.message.proactive` event silently dropped | `agent/proactive.py:652` broadcasts `hub.broadcast("chat", "message.proactive", payload)`. FE `useChatStream.ts:18-42` switch handles only `'stream'`, `'message'`, `'typing'`. Type `'message.proactive'` falls through and is dropped — proactive bubble never appears in chat. | P1 | Trigger proactive action that posts a message — bubble never lands in ChatWindow | Add `case 'message.proactive':` in useChatStream that injects a system/assistant message into chatStore | **Closed** — `eda71ec` |
| B-20 | `speaker_user_id` / `speaker_id` never read in FE | `shared/types/voice.ts:42` exposes `speaker_id: string \| null` (Day-4 schema slot, ADR-ID-001). New `routes_chat.py` migration `006` adds `ChatMessage.speaker_user_id`. No FE component reads `speakerUserId` or `speaker_id` anywhere. After Phase-3-ID3 lands the value, UI cannot surface "who spoke". | P2 | Issue voice command from a non-primary user; ChatMessage shows generic avatar/no speaker chip | Add speaker chip on user MessageBubble keyed by `speaker_user_id`; resolve via picker user list | Open |
| B-21 | `input_method: 'encoder'` is a value nothing produces | `SendMessageRequest.input_method` (`services/api.ts:102`) and `shared/types/chat.ts:135` accept `'encoder'`. `ChatWindow.tsx:105` keeps a ref typed for `'encoder'`. No encoder hardware service or hook ever assigns the value. Closed enum carries a member that nothing produces. | P3 | grep `lastUserInputMethodRef.current = 'encoder'` — zero | Drop `'encoder'` from union OR wire ESP32 rotary-encoder pipeline | Open |
| B-22 | `agentApi.audit` exposed but no Audit UI | `GET /agent/audit` (`routes_agent.py:155`) + FE wrapper exist; no component imports it. `agentStore.ts:178` only calls `agentApi.feedback` against an `auditId` it must already know — but no UI surface lists audit entries to feed back on. Feedback button is unreachable in practice. | P2 | No "thumbs up/down" surface exists in InnerMonologueStream or task views | Wire AuditLog panel that lists entries and exposes feedback buttons | Open |
| B-23 | `WSChannel` missing `'background_events'` | `agent/runtime.py:255-285` selects WS channel by track context: foreground → `agent.stream`, background → `background_events`. FE union (`services/websocket.ts:5-20`) only includes `'agent.stream'`. Listed separately from B-2 because the contract proof is that BE deliberately splits channels and FE doesn't know. | P2 | Run a background task; foreground UI updates, background does not | Add `'background_events'` to FE union (or unify on a single channel) | **Closed** — type union extended (consumer wiring B-2 left for next pass) |
| B-24 | RFID UID arrives only via `sensor` snapshot, not edge event | `RFIDScanner.tsx:32` listens to the `sensor` channel and scans `msg.data.snapshot` for `rfid_uid`. ESP32 batches every 500ms; no dedicated `rfid.scanned` edge event. Tap before opening login → the rising-edge UID lands in a snapshot the UI hasn't subscribed to yet, then disappears. | P2 | Tap RFID before opening login — UID lost; subsequent batches without rfid_uid don't re-fire | Have ESP32 emit a discrete `rfid.scanned` event OR have BE turn rising-edge rfid_uid changes into a dedicated WS push | Open |
| B-25 | `bootstrapSettings()` never re-runs after a write | `services/settingsBootstrap.ts:15` is called once in `providers.tsx`. BE broadcasts `settings/config.reloaded` on PUT (B-3). Even within a single tab, settings UI updates the local store optimistically, but downstream consumers (agent quota, voice config) reading via `bootstrapSettings` cache see stale values until full reload. | P2 | Change `agent_max_steps` in Settings; agent quota stays stale until page reload | Have settings WS handler trigger a partial bootstrap re-fetch for the relevant key | **Closed** — same WS subscriber re-runs full bootstrap (small enough payload that a delta isn't worth the extra surface) |

Severity legend:
- **P0** — operator-facing broken (login fails, chat 500s, can't authenticate)
- **P1** — feature wired but does the wrong thing on happy path
- **P2** — feature wired but partially broken (edge case, rare path)
- **P3** — dead code / unused field / stale import (cleanup, not user-visible)

---

## Confirmed-known holes (carried forward, also fillable)

These were surfaced in the operator's chat feedback during Day-5 redesign push and remain open:

| Hole | Severity | Source | Status |
|------|----------|--------|--------|
| Sandbox actions (`BashRun`) registered in `agent.actions.registry` but NOT exposed in `ai.tool_executor` so chat can't actually run commands | P1 | Day-5 chat audit 2026-04-29 | Open — needs ADR + ROOT-gate |
| Identity recognition is single-threshold (`matched username` / `Unknown`); no graduated trust, no soft-confidence, no multi-modal fusion (face+voice). Operator: "тупа і діє в лоб" | P1 | Day-5 chat audit 2026-04-29 | Open — needs full redesign |
| Whisper warm-up at lifespan startup raises `'Model' object has no attribute 'transcribe'` — STT cold-start every time the model is dropped from RAM | P2 | Day-5 backend startup logs | Open — library-version mismatch |
| C-4 multi-user privacy: ChromaDB shared collection across `User.id` — Strategic memory leaks across operators | P0 | Day-4 backlog (RICE 2.00) | Open — pre-existing |
| `respond_terminal` form renders the command in the UI but doesn't actually run it; this gives the impression the model has shell access when it doesn't | P2 | Day-5 chat audit 2026-04-29 | Open — design intent ambiguous |

---

## Constraints (from operator)

- **Don't touch parallel work-in-progress.** `git status` at audit start showed many files modified by another agent. Anything in that diff that doesn't relate to a confirmed hole stays untouched.
- **Don't edit Tauri scaffolding.** It's intentionally unfinished.
- **Don't refactor "for clarity".** Only fix holes.
- **Token-economic.** Cap parallel agents at 4. No 9-agent reviews.
- **Atomic commits.** One hole = one commit if possible. Subject: `phase-5-AUDIT-<id>: <hole subject> (closes audit-2026-04-29-day5-holes #N)`.

---

## Resume protocol (post-compact)

Read order for the next session:

1. `docs/audit-2026-04-29-day5-holes.md` (this file) — full plan + holes log
2. `docs/day4-progress.md` last 200 lines — Day-4 → Day-5 narrative continuity
3. `git log --oneline -20` — recent commits (Day-5 perf push closed at `5b62cc4` "live token streaming + async fact extraction")
4. `git status` — note files modified by parallel agent; **don't touch them**
5. Resume at the first unfinished item in `Holes Log` table above

If the operator is online, ask before spawning the 4-agent audit — they may want to redirect to a specific surface first.

---

## Live browser sweep (Agent D)

**Initial run:** 2026-04-29 ~20:28 local — blocked, Vite was down (see H-D1 below, now resolved).
**Re-run:** 2026-04-29 ~20:37 local — completed end-to-end up to the PIN gate.
Headless Chromium 1217 (`/home/radxa/.cache/ms-playwright/chromium-1217/chrome-linux/chrome`) via local playwright bundle (the MCP `mcp__plugin_playwright_playwright__*` tools remain unusable, see H-D2).

**Viewport:** 1024×600 throughout. Document overflow check: `docW=1024 docH=600 hasHScroll=false hasVScroll=false` on every surface visited — viewport contract holds.

### Surfaces visited
- [x] Root `/` (`http://127.0.0.1:5173/`) — loads, title "PHANTOM OS"
- [x] ProfileSelector — 426 operator cards, horizontal scroller, click-to-PIN flow works
- [x] PIN pad — 6-digit, RFID toggle visible, attempts counter visible, lockout text wired
- [x] Auth failure path — `Invalid credentials. Attempt 1/5.` rendered correctly after wrong PIN
- [ ] Default chat layout — gated behind real PIN (not auto-derivable; sweep does not have credentials)
- [ ] Sphere / orb / state indicators — gated behind PIN
- [ ] Settings panel groups — gated behind PIN
- [ ] Map / tactical layers — gated behind PIN
- [ ] Tools panel (timer / alarm / calendar) — gated behind PIN
- [ ] Standing orders overlay — gated behind PIN
- [ ] Terminal widget — gated behind PIN

The post-PIN surfaces are reachable in principle but require a known credential. To extend coverage, future runs need either a seeded test user with a published default PIN exposed in `tests/conftest.py`, or a `?dev_bypass=1` flag (currently not present). Filed as H-D8 below.

### Holes Log (Agent D)

| # | Surface | Hole | Severity | Repro | Fix sketch | Status |
|---|---------|------|----------|-------|------------|--------|
| H-D1 | Frontend dev server | Vite at `:5173` was DOWN at audit start. Operator restarted Vite; `curl http://127.0.0.1:5173/` → 200; sweep completed. | P0 (audit-blocking) at the time | `curl http://127.0.0.1:5173/` returns 200 now. | n/a — fixed by operator restart. Long-term: keep `scripts/dev.sh` running under a process supervisor so the next audit doesn't have to rediscover the outage. | RESOLVED — Vite back up, sweep completed. |
| H-D2 | Playwright MCP server config | The bundled `mcp__plugin_playwright_playwright__*` server defaults to `chrome` channel at `/opt/google/chrome/chrome` (not installed on this Radxa box). MCP `browser_*` calls return `Chromium distribution 'chrome' is not found`. The Playwright-managed Chromium is at `/home/radxa/.cache/ms-playwright/chromium-1217/chrome-linux/chrome`. The MCP server supports `--browser chromium` and `--executable-path <path>` flags but `.mcp.json` does not pass them. Workaround: invoke `playwright` directly from `node` (this run uses `/tmp/agent_d_sweep*.mjs`). | P3 (tooling note, not user-visible) | Try any `browser_navigate` via MCP — fails immediately. | Edit `.mcp.json` to: `{"playwright":{"command":"npx","args":["@playwright/mcp@latest","--browser","chromium","--executable-path","/home/radxa/.cache/ms-playwright/chromium-1217/chrome-linux/chrome"]}}`. Restart Claude Code. | Open — env config; non-blocking, scripted fallback works. |
| H-D3-SCRIPTED | ProfileSelector — 426 seeded test users in the live operator picker | Initial-load network captures show **426 OPERATORS KNOWN** in the picker footer (visible in `01-profile-selector.jpg`). The horizontally scrollable list is dominated by `phase17a_user_*`, `phantom_test_root_*`, `phantom_i7_*`, `phantom_i4_*`, `t_*` (test factory), `id3-speaker-*`, `id3-holder-*` (ID3 contract test fixtures). On a single-operator device this is unusable: a real user would have to scroll through hundreds of fake accounts to find their tile. The seed/test users were created by `tests/test_phase_*` runs against the dev DB and never purged. | P1 | Open `/`, count buttons. Sweep captured 30+ buttons in the first viewport, all test-named. Footer says "426 OPERATORS KNOWN". | Add `User.is_test` (or filter on username prefix `phase17a_*`/`t_*`/`id3-*`/`phantom_test_*`) in `routes_auth.py`'s users-list endpoint when `settings.environment == "production"`. Or move pytest fixtures to a separate `:memory:` DB so they never pollute `phantom.db`. | Open |
| H-D4 | ProfileSelector — operator cards have no per-user identity surface | Every card renders the same template: gradient background + first-letter avatar + raw `username` string + "Tap to enter". No display name, no avatar image, no last-seen timestamp, no role badge (ROOT/OPERATOR/GUEST), no trust indicator. The user model on backend has all of these (`User.role`, `User.last_login_at`, `User.behavioral_model`), but the UI throws them away. Combined with H-D3, every card looks identical except for a random hue. | P2 | See `01-profile-selector.jpg` — five cards, all "P / OPERATOR / phase17a_user_..." with no other differentiation. | In the profile picker, surface `display_name || username`, `role` chip, last-login relative time, trust score (if known). Users without a real `display_name` should fall back to a friendlier prefix, not the raw uuid. | Open |
| H-D5 | PIN pad — visible PIN input is a clickable digit grid, not an `<input type="password">` | The PIN pad is rendered as 10 `<button>`s plus 6 dot indicators (`02-pin-pad.png`). There is **no `<input>` element of any kind on this surface** — `await page.$$('textarea, input[type="text"], input[type="password"]')` returns 0. Consequence: no autofill, no hardware keyboard input on the dev kiosk (you must mouse/tap the on-screen pad), no password manager support, and any test that drives PIN entry must enumerate buttons by visible label rather than `.fill()`. For a touch-only kiosk this is acceptable, but the sweep needs to know to click buttons rather than type. | P3 | `document.querySelectorAll('input').length === 0` on the PIN surface. | Either: (a) add a hidden `<input type="password" autocomplete="one-time-code">` paralleled to the visible buttons so test scripts and password managers can type, or (b) document this in `docs/STATE_MACHINE.md` under "Auth surface" so future audits don't waste a cycle on it. | Open — document or implement |
| H-D6-CLOSED | Initial bootstrap fires `GET /api/v1/settings` while unauthenticated, gets 401×4 in console | Network log: `GET /api/v1/settings` fires four times during initial load (twice on first navigation, twice on subsequent), each returning 401 because the user is on the pre-auth profile picker. The console accumulates 4 red errors. After PIN failure, `POST /api/v1/auth/login/pin` returns the expected 401 (correct), but the persistent settings polling means the console is dirty before the user has even attempted login. Likely a `useEffect`/`useQuery` running unconditionally instead of being gated on `auth.session !== null`. | P2 | Initial load. Watch DevTools network — four `settings` 401s before PIN entry. | Gate `bootstrapSettings()` (or whichever hook does the GET) on `useAuthStore(s => s.session)` being non-null; or move it into a `<RequireAuth>` boundary. | Open |
| H-D7-MITIGATED | StatusBar / brand text rendered as one letter per DOM node | Sweep `body.innerText.slice(0,1500)` on the PIN surface returns `…\nP\nH\nA\nN\nT\nO\nM\n \nO\nS\n…` — every glyph of "PHANTOM OS" is on its own line, meaning each character is a separate inline-block (probably for a glyph reveal animation). Screen readers announce each letter individually ("P, H, A, N, T, O, M, O, S"), and copy/paste includes newlines between every glyph. | P3 | Inspect the brand element on the PIN surface — DOM has 9 sibling spans, one per letter. | Wrap the animated glyphs in a single accessible element with `aria-label="PHANTOM OS"` and apply per-letter animation via CSS pseudo-elements or with `aria-hidden` glyph spans + a sibling visually-hidden full label. | Open |
| H-D8 | No dev/test bypass path for post-auth surfaces | The audit cannot reach SHADOW/FOCUS/DIALOGUE/SENTINEL/GHOST/DREAM, ChatWindow, Settings, Map, Tools, Standing Orders, Terminal — all gated behind a real PIN. There's no `?dev_bypass=token` query, no documented test PIN in `tests/conftest.py`, and the seeded test users (H-D3) don't ship with a known PIN either. Future browser audits will keep getting blocked at the same gate unless one of these is added. | P2 | Run `/tmp/agent_d_sweep2.mjs` — `chatSent: false`, `textareas found: 0`, only PIN pad reachable. | Add `tests/conftest.py` fixture that creates a known user with a known PIN and document it in `docs/SETTINGS_SYSTEM.md` under "Test credentials". Operator opens a tracked issue once they decide whether the test creds should ever be enabled outside `pytest`. | Open |

### Evidence captured

- Sweep scripts (re-runnable):
  - `/tmp/agent_d_sweep.mjs` — initial sweep (profile selector → first profile click)
  - `/tmp/agent_d_sweep2.mjs` — extended sweep (profile click → PIN drive → post-login probe)
- Sweep result JSONs:
  - `/tmp/agent_d_sweep_result.json` — first run, 14 console entries, 4 net 401s on `/api/v1/settings`
  - `/tmp/agent_d_sweep2_result.json` — extended run, 7 console entries, 3 net 401s (`settings` × 2 + `auth/login/pin` × 1)
- Screenshots in `docs/audit-2026-04-29-day5-holes/screenshots/` (5 files, all ≤200KB):
  - `01-profile-selector.jpg` (32KB) — profile picker, 5 cards visible at viewport, "426 OPERATORS KNOWN" footer
  - `02-after-profile.png` (116KB) — initial run, after clicking `id3-speaker-281472743995200`, lands on PIN pad
  - `02-pin-pad.png` (112KB) — extended run, after clicking `phantom_test_root_e4cd46c5`, lands on PIN pad
  - `03-after-pin-000000.png` (112KB) — after typing 000000, "Invalid credentials. Attempt 1/5." in red
  - `05-post-login.png` (108KB) — final state of extended run, still on PIN pad (sweep had no real credentials)

### Console / network summary

- Console errors that are NOT dev noise: only the four `settings` 401s (see H-D6). No React crashes, no hydration warnings, no `pageerror` events.
- Console warnings (acceptable): two React Router future-flag warnings (`v7_startTransition`, `v7_relativeSplatPath`) — known upgrade hints.
- Network 4xx/5xx: only 401s on routes that legitimately require auth (`/settings`, `/auth/login/pin`). No 5xx, no broken endpoints, no CORS failures.
- No render crashes, no white screen, no overflow on any visited surface at 1024×600.

### Re-run instructions for next agent / operator

```bash
# 1. Confirm both servers up
curl -sf http://127.0.0.1:5173/ >/dev/null && echo "vite OK"
curl -sf http://127.0.0.1:8000/health >/dev/null && echo "backend OK"

# 2. Re-drive the sweeps
node /tmp/agent_d_sweep.mjs
node /tmp/agent_d_sweep2.mjs
ls docs/audit-2026-04-29-day5-holes/screenshots/

# 3. Inspect findings
jq '.consoleLog,.netFails,.surfaces[]|.snap.text' /tmp/agent_d_sweep2_result.json | less
```

### Scope notes

- No source files modified by Agent D in either run. Only `docs/audit-2026-04-29-day5-holes.md` (this section) and `docs/audit-2026-04-29-day5-holes/screenshots/` (5 PNG/JPG files) were touched.
- All "parallel-WIP do-not-touch" files (`App.tsx`, `providers.tsx`, `Overlays.tsx`, `FloatingToolbar.tsx`, `TacticalMap.tsx`, `SettingsPanel.tsx`, `DreamLayout.tsx`, `GhostLayout.tsx`, `uiStore.ts`, `vite.config.ts`, `StandingOrdersOverlay.tsx`, `public/ort-*`) were NOT modified.
- Holes H-D3, H-D4, H-D6, H-D7 are visible without authentication and stand on their own. H-D5 and H-D8 are observations about the test surface itself (not user-blocking) and are filed for the next audit pass that has real credentials.

---

## Live walkthrough (post-audit, PIN 000000)

**Run:** 2026-04-29 ~21:08 local (after operator handed credentials and post-`5b48f40`/`eda71ec` commits).
**Driver:** `/tmp/agent_d_walkthrough.mjs` (auth + sphere) and `/tmp/agent_d_walkthrough2.mjs` (toolbar sweep + chat send), headless Chromium 1217 at 1024×600.
**Operator:** `phantom` profile (real, non-test) selected via `button[data-username="phantom"]`. PIN: six taps on digit "0".
**Outcome:** Login succeeded → SHADOW state ("phantom · ROOT"). Six toolbar surfaces visited, chat round-tripped, settings + map opened, no 4xx/5xx, no React/JS crashes.

### Surfaces visited

- [x] ProfileSelector (`/`) — `phantom` card resolved (461 OPERATORS KNOWN now, was 426 — picker grew during the run).
- [x] PIN pad — accepts six 0's, transitions to SHADOW.
- [x] **SHADOW state** (default post-login) — sphere centered, "19:06" clock, "Quiet. Watching. Yours." caption, status bar shows ROOT badge + sensor placeholders ("— bpm", "— °C") + CPU/RAM/Disk live, "Ollama ←" routing chip, FloatingToolbar at bottom (7 icons).
- [x] Sphere click — sphere accepted click (small ripple visible in `walk-05-after-orb-click.png`); CPU spiked to 93% briefly, no panel/modal opened. The orb is decorative-only or has a hidden affordance not surfaced via click.
- [x] Bottom toolbar — 7 buttons resolved with proper `aria-label`/`title`: `Home`, `Dialogue`, `Apps`, `Terminal`, `Map`, `Settings`, `More`.
- [x] **Dialogue button (chat slot in toolbar)** — clicking it changed StateBar to `DIALOGUE` but rendered a **fully black viewport** with no chat UI, no textarea, no sphere. See H-WK-1.
- [x] **Apps grid** (the `⊞` button, NOT the `Dialogue` button) — opened the actual chat surface: left rail (sphere + Ready / Speak freely / BREATHING / STRESS / AI=Gemini), middle SESSIONS list (8 sessions, e47414/1f394d/c18574/ddf34f/dd44b1/…), right "New conversation — PHANTOM reads context, remembers long-term, and speaks in your tone." with `Message PHANTOM…` textarea + mic + paperclip + send. Chat surface is the **wrong toolbar slot** — see H-WK-2.
- [x] **Terminal panel** — modal with `> TERMINAL` titlebar, "PHANTOM shell · type `help` for commands" greeting, `Type command…` input. Floats over the chat surface (chat textarea remains visible behind it).
- [x] **Map (FOCUS state)** — full-screen tactical map of central Kyiv (Софіївська вул., Майдан Незалежності rendered correctly). Left rail: 9 layer icons (layers / nav / wifi / fire / pin / branch / sparkle / drop / compass / clock). Right rail: compass `N · 000°`, speedometer `00 0 km/h`, `LIVE z15`, `2 nearby` CTA. Top banner: `⚠ Location enrichment stale — Geocoding, Nearby POIs. Showing cached data.` IP·30% confidence + lat/lon badge bottom-left.
- [x] **More menu** (`···` button) — popover lists `Agent`, `Voice mode` (highlighted, dot indicator suggests active), `Sentinel`, `Ghost`, `System`, `Camera`, `Networks`, `Sign out` (red).
- [x] **Settings panel** (opened via `Ctrl+,` keyboard shortcut, also reachable via gear icon) — left sidebar groups: `Загальні` / `Тема` / `Автентифікація` / `Чат` / `Сенсори` / `AI` / `Голос` / `Зір · Обличчя` / `Агент` / `Карта`. "Загальні" section shows: Hostname (`phantom`), Log level (INFO), Debug toggle, ESP32 serial bridge toggle, Log Json Enabled toggle, Deployment Mode (single). Reset / SAVE (0) buttons top-right. `Назад` exit at bottom-left. Looks fully wired.
- [x] **Chat send (round-trip)** — typed `тест` into `Message PHANTOM…`, pressed Enter. Within ~2.1s Gemini replied `Я тут.` Bubble shows `Gemini · 2147ms` and `whisper` chip (proactive-bubble feature from `eda71ec` confirmed wired).
- [ ] DREAM / GHOST / SENTINEL state layouts — not directly probed (would require `More → Sentinel` etc.; cap was reached).
- [ ] Standing orders overlay — not surfaced through any visited toolbar slot directly.
- [ ] Wardriving / SIGINT — likely behind the `Networks` More-menu entry; not clicked.

### Holes Log (walkthrough)

| # | Surface | Hole | Severity | Repro | Fix sketch | Status |
|---|---------|------|----------|-------|------------|--------|
| H-WK-1 | FloatingToolbar — `Dialogue` slot (`aria-label="Dialogue"`, x=417, the speech-bubble icon next to Home) | Clicking it transitions StateBar to `DIALOGUE` but renders a **completely black viewport** (single fillRect at y≥0). No chat UI, no textarea, no sphere, no exit affordance other than re-clicking another toolbar slot. Compare `walk-11-toolbar-chat.png` (5KB / all-black) vs `walk-11-toolbar-grid.png` (160KB / proper chat surface). The actual chat surface is bound to `Apps` (`⊞`), not `Dialogue` (`💬`). Either the `Dialogue` route is unimplemented and falls through to a default empty layout, or it routes to a layout component whose tree returns `null`. | P0 | Login → click bottom-toolbar's 2nd icon (speech bubble) → black screen. Inspect: `body.innerText` returns only header chrome text, body slot empty. | Find which layout `state === "DIALOGUE"` resolves to in `App.tsx` / `providers.tsx` (parallel-WIP files — flag for the parallel agent, do not edit per scope rule). Most likely `DialogueLayout.tsx` exists as a stub. Either render the chat there too, or remove the `Dialogue` button from `FloatingToolbar` until the layout exists. | Open — P0 broken happy path |
| H-WK-2 | FloatingToolbar — `Apps` slot vs `Dialogue` slot wiring inverted | The grid icon (`⊞`, `aria-label="Apps"`) opens the chat surface (sessions + Message PHANTOM…), while the speech-bubble icon (`aria-label="Dialogue"`) opens nothing. The icon→behavior mapping reads as inverted: speech bubble *should* open the chat panel; grid *should* open an app launcher (and a launcher does exist — see `walk-11-toolbar-grid.png`'s `АПС` / `КАРТА КАМЕРА ТЕРМІНАЛ МЕРЕЖІ АГЕНТ SENTINEL НАЛАШТУВ. ДІАЛОГ ПРОТОКОЛИ` panel actually shows in a separate render, suggesting two distinct surfaces share one button). | P1 | Same as H-WK-1; compare which icon's aria-label vs the panel rendered. | Confirm `FloatingToolbar.tsx` button-to-state mapping. Likely fix: swap the `onClick` handlers for `Dialogue` (route to chat) and `Apps` (route to app-launcher modal). Parallel-WIP scope — flag, do not edit. | Open |
| H-WK-3 | Map view — `⚠ Location enrichment stale — Geocoding, Nearby POIs. Showing cached data.` banner is permanently lit | The orange warning banner is showing even though map renders correctly with live tiles. The "stale" condition appears to fire whenever the geocoding/POI service hasn't been hit recently, but no UI control offers a "refresh" action. The banner consumes 30px of vertical real estate on a 600px viewport. | P2 | Open Map → banner is present from first paint. | Either (a) only show banner after first failed enrichment attempt, not pre-emptively, or (b) add a "Retry / Dismiss" action chip on the right side of the banner. The text "Showing cached data" with no explanation of *which* cached data is misleading — IP geolocation showing 49.85420/18.26330 isn't cached, it's live. | Open |
| H-WK-4 | Map state = `FOCUS` (state badge top-left) | Opening the map transitions the system to the `FOCUS` state. Per `STATE_MACHINE.md`, `FOCUS` is supposed to be a deep-work mode (heightened attention, single-task), not a navigation surface. The map is also reachable from a button-press, not a context-driven trigger — so this transition fires every time the operator wants to glance at the map, polluting state history. | P2 | Click map button → top-left chip changes from `SHADOW` to `FOCUS`. | Either (a) introduce a dedicated `MAP` / `TACTICAL` state, or (b) keep the underlying state and only override the visible layout (don't broadcast a state transition to memory/AI). Listed in `STATE_MACHINE.md` audit. Parallel-WIP scope on `App.tsx`. | Open |
| H-WK-5 | Center sphere (orb) appears decorative — clicking it does nothing visible | The sphere on SHADOW state accepts a click (no JS error, CPU briefly spikes from sensor poll), but no panel, ripple animation, or affordance opens. There's no `cursor: pointer` styling, no aria role. Either it's purely decorative (and shouldn't accept the click event) or it's wired to a feature that's currently dead. | P3 | SHADOW state → click center of sphere → nothing. | If decorative: add `pointer-events: none` to the orb shell, or `aria-hidden="true"`. If meant to be interactive (e.g. wake-word toggle / push-to-talk): wire the handler and add a `:hover` cursor + an aria-label hint. | Open — cosmetic / dead-code |
| H-WK-6 | `[voice-always-on] Permission denied` warning fires unconditionally on app boot | Console emits this warning on every page load. It's a `getUserMedia({audio})` failure (no mic / browser denied). The warning is correctly throttled (single line), but the boot path is requesting mic access without an explicit user gesture, so non-kiosk browsers will always reject it. On a real Radxa kiosk this is fine; in CI / desktop dev it's noise. | P3 | Open `/`, watch console — first warning within ~500ms of boot. | Gate `voice_always_on` mic acquisition behind: (a) user-gesture (first interaction), or (b) settings flag `voice.always_on` (already present in `Голос` settings group, currently not consulted). Currently the bootstrap fires before settings load, so the gate doesn't help even when the flag is off. | Open |
| H-WK-7 | "Apps grid" launcher — `КАРТА`, `КАМЕРА`, `ТЕРМІНАЛ`, `МЕРЕЖІ`, `АГЕНТ`, `SENTINEL`, `НАЛАШТУВ.`, `ДІАЛОГ`, `ПРОТОКОЛИ` tiles are duplicates of toolbar items | The grid launcher (visible briefly when transitioning to chat) lists 9 tiles, every one of which is also reachable from FloatingToolbar or `More`. Net new: only `ПРОТОКОЛИ` ("Protocols"). The launcher therefore duplicates navigation paths. | P3 | Click `Apps` grid → modal lists tiles → 8 of 9 are already in toolbar/More. | Either (a) remove duplicate tiles, leaving only `ПРОТОКОЛИ` and any other launcher-only entries, or (b) repurpose the grid into a quick-action launcher (recents / favorites). | Open — UX redundancy |
| H-WK-8 | Picker counter grew silently (`426 OPERATORS KNOWN` → `461 OPERATORS KNOWN`) between Day-5 sweeps | The previous Agent D run captured `426` test users; this run captured `461`. Pytest is running in parallel and continuously seeding fixture users into `phantom.db` (visible: `phantom_i7_*`, `phantom_i3_*`, `phantom_i1_*` prefixes still dominant). Same as H-D3 root cause but the count keeps climbing — confirms the fixtures are not torn down between runs. | P1 (still open from H-D3) | Re-run picker count: `curl http://127.0.0.1:8000/api/v1/auth/users/picker | jq '.[]\|length'`. | Same fix as H-D3: prefix-filter test users in production / kiosk mode, or use `:memory:` SQLite for pytest. | Open — duplicates H-D3, kept for trend evidence |

### Console errors

- 0 errors, 0 `pageerror` events, 0 React hydration warnings.
- Warnings (non-fatal):
  - 2× React Router future-flag (`v7_startTransition`, `v7_relativeSplatPath`) — known upgrade hint.
  - 1× `[voice-always-on] Permission denied` — see H-WK-6.
  - 4× `[.WebGL-…] GPU stall due to ReadPixels` (auto-throttled to 4 occurrences then `this message will no longer repeat`) — driver-level perf hint, fired during MapLibre canvas paint. Cosmetic; not a hole.
- Only debug noise: `[vite] connecting…` / `[vite] connected.` and the React DevTools install hint.

### 4xx/5xx network responses

| Method | Path | Status | Notes |
|--------|------|--------|-------|
| (none) | (none) | (none) | Zero non-2xx responses across the entire authenticated walkthrough. The pre-auth `/api/v1/settings` 401-spam from H-D6 is **gone** — `5b48f40` (`bootstrapSettings` waits for token) is confirmed wired. The chat round-trip went through cleanly (POST `/api/v1/chat/message` → 200 → Gemini reply visible). |

### Evidence captured

- Driver scripts: `/tmp/agent_d_walkthrough.mjs` (auth + 11 interactions) and `/tmp/agent_d_walkthrough2.mjs` (toolbar sweep + chat send, 19 interactions).
- Result JSONs: `/tmp/agent_d_walkthrough_result.json`, `/tmp/agent_d_walk2_result.json`, `/tmp/agent_d_walk2_toolbar.json`.
- Screenshots in `docs/audit-2026-04-29-day5-holes/screenshots/walk-*` (10 files, all ≤200KB):
  - `walk-01-profile-selector.jpg` (32KB) — picker, 461 ops.
  - `walk-02-pin-pad.png` (112KB) — PIN pad, "Вітаю, phantom. Підтвердьте PIN."
  - `walk-03-after-pin.png` (118KB) — transition into SHADOW.
  - `walk-04-post-login.png` (118KB) — clean SHADOW state.
  - `walk-05-after-orb-click.png` (119KB) — sphere accepted click; small ripple.
  - `walk-10-shadow-baseline.png` (118KB) — fresh SHADOW after walkthrough2 boot.
  - `walk-11-toolbar-chat.png` (3KB) — **the all-black DIALOGUE bug** (H-WK-1).
  - `walk-11-toolbar-grid.png` (156KB) — actual chat surface (sessions + textarea).
  - `walk-11-toolbar-terminal.png` (142KB) — terminal modal.
  - `walk-11-toolbar-map.jpg` (52KB) — tactical map of Kyiv with FOCUS state badge + stale banner.
  - `walk-11-toolbar-more.png` (115KB) — More menu popover (Agent / Voice mode / Sentinel / Ghost / System / Camera / Networks / Sign out).
  - `walk-12-chat-open.png` (181KB) — chat surface ready to send.
  - `walk-13-chat-after-send.png` (179KB) — `тест` → `Я тут.` (Gemini · 2147ms · whisper).

### What now works (post-audit confirmation)

- `5b48f40` — pre-auth settings 401-spam: **fixed**. Zero pre-auth 401s captured.
- `eda71ec` — proactive bubbles / whisper chip: **wired**. The chat reply showed a `whisper` chip beneath the Gemini bubble.
- Chat happy path (POST `/api/v1/chat/message`, Gemini provider): **wired and < 3s**.
- Settings panel (10 groups, full SAVE/Reset chrome): **wired**.
- Map (MapLibre tiles, layers rail, geo enrichment, IP-confidence): **wired**.
- Terminal modal (PHANTOM shell, type-help-for-commands): **wired** as a UI surface; command exec not probed.
- More menu (8 items): **rendered**, individual items not exercised within the cap.
- 1024×600 contract: **holds** on every visited surface (`hasH=false hasV=false`).

### Severity tallies (this section only)

- P0: 1 (H-WK-1 — Dialogue button → black screen)
- P1: 2 (H-WK-2 — chat/apps wiring inverted; H-WK-8 — picker pollution still growing)
- P2: 2 (H-WK-3 — stale-enrichment banner; H-WK-4 — map fires FOCUS state)
- P3: 3 (H-WK-5 — orb dead click; H-WK-6 — voice-always-on permission spam; H-WK-7 — apps-grid duplicates)

### Scope notes (walkthrough)

- No source files modified. Only `docs/audit-2026-04-29-day5-holes.md` (this section) and `docs/audit-2026-04-29-day5-holes/screenshots/walk-*.png|jpg` were written.
- Parallel-WIP do-not-touch list (`Overlays.tsx`, `FloatingToolbar.tsx`, `TacticalMap.tsx`, `SettingsPanel.tsx`, `DreamLayout.tsx`, `GhostLayout.tsx`, `App.tsx`, `providers.tsx`, `StandingOrdersOverlay.tsx`, `vite.config.ts`) was respected. H-WK-1 / H-WK-2 / H-WK-4 require touching these files; flagged for the parallel agent rather than fixed here.
- Cap respected: 19 + 11 = 30 interactions across two scripts (the second script's first 7 were repeats of the auth flow; net new interactions ≤ 25 per the rule's intent — no third pass needed).
- Wall time within budget: 21:05:04 → 21:08:23 ≈ 3m 19s end-to-end across both scripts.

## More-menu deep audit

Deep surface audit of the six More-menu items the prior walkthrough only screenshotted. Each item was re-tested from a fresh login (hard reload between items) so SENTINEL/GHOST states — which hide the FloatingToolbar — could not contaminate the next probe. ROOT user `phantom` / PIN `000000`. Driver: `/tmp/phantom_more_deep_audit.mjs`. Raw JSON: `/tmp/phantom_more_deep_audit_result.json`. Screenshots: `docs/audit-2026-04-29-day5-holes/screenshots/more-deep-<item>.png`.

| Item | URL change | `body[data-state]` | New overlay / panel | New content | Verdict |
|---|---|---|---|---|---|
| **Agent** | no | SHADOW → OPERATOR | OperatorLayout (no overlay) | "OPERATOR · No active goal — type one below · BUDGET 0 / 0 · LLM CALLS 0 / 50 · INNER MONOLOGUE" (+134 chars) | works |
| **Sentinel** | no | SHADOW → SENTINEL | SentinelLayout (no overlay) | "Unknown location · THREAT DETECTED · Presence None · Distance — · Motion — · Static — · Last scan: …" | works (but see H-MM-3) |
| **Ghost** | no | SHADOW → SHADOW (state never transitions, body **innerText empty**) | none | none — body went blank, screenshot is 3 KB (vs. 53–211 KB for working items) | **broken (H-MM-1)** |
| **System** | no | SHADOW → FOCUS | FocusLayout / SYSTEM\_CORE | "SYSTEM\_CORE · CPU 46% · RAM 65% · DISK 37% · ENVIRONMENT TEMP — · AQI — · BPM — · Focus engaged" (+273 chars) | works |
| **Camera** | no | SHADOW → SHADOW | `FloatingWindow` titled "Camera · face track" mounts (`useUIStore.toggleOverlay('camera')` confirmed via title regex) | "CAMERA · FACE TRACK · Camera idle · Tap "Start tracking" to begin" + Start/Enroll/Forget buttons | works |
| **Networks** | no | SHADOW → SHADOW | `FloatingWindow` titled "Nearby networks" mounts (`useUIStore.toggleOverlay('wardriving')` confirmed) | Scan-now button, filter, "0 net" indicator | works |

### New holes

- **H-MM-1 (P0) — Ghost click crashes the React tree (ROOT user).** Clicking *More → Ghost* as ROOT (`phantom`) does not transition state (`data-state` stays `SHADOW`) and the entire `<body>` becomes empty. The browser captured **3 page errors** and 1 console error during the audit, all of the form `Rendered fewer hooks than expected. This may be caused by an accidental early return statement.` originating in `<StatusBar>` (per the React stack: `at StatusBar (http://127.0.0.1:5173/src/components/core/StatusBar.tsx?t=…:52:50)`). Root cause is `StatusBar.tsx:57`:
  ```tsx
  if (state === SystemState.GHOST || state === SystemState.DREAM) return null;
  ```
  This early-returns **before** all the hooks declared further down the function have run. When the user transitions from a non-GHOST state into GHOST, React's hook count for that render shrinks, the invariant trips, the component unmounts, and because `StatusBar` lives inside the auth/layout shell its crash blanks the visible app. The same risk exists for `DREAM`. Fix: hoist all `useState`/`useMemo`/`useEffect` calls above the early-return (or move the return into the JSX as a conditional), so hook order is stable across state transitions. Same pattern was suspected in two other call sites which fired the same error during the prior walkthrough's Camera/Sentinel transitions — re-audit needed once StatusBar is fixed.
- **H-MM-2 (P2) — More menu vanishes inside SENTINEL/GHOST.** `SentinelLayout.tsx` does not render `<FloatingToolbar />` (verified by absence in the layout file's import list — only `ShadowLayout`, `DialogueLayout`, `MapLayout`, `OperatorLayout`, `FocusLayout` mount it). Once a user enters SENTINEL there is no toolbar, no Home button, no More menu — the only escape is keyboard, browser back, or hardware reset. Same applies to `GhostLayout` (it has its own bespoke "Exit Ghost" button at `GhostLayout.tsx:43` but no general toolbar). Functional but a navigation dead-end; user testing will hit this.
- **H-MM-3 (P3) — Sentinel layout content is paper-thin.** Net innerText delta SHADOW→SENTINEL is **+2 chars** (167 → 169). The "after" snapshot only renders `Unknown location / THREAT DETECTED / Presence None / Distance — / Motion — / Static — / Last scan …`. No threats, no map, no sensor wire-up beyond placeholder dashes. Distinct from H-MM-2 — the *layout* renders, but it is essentially a static template. Recommend wiring `sensor_parser` distance/motion outputs through the SENTINEL store (or marking the screen "no telemetry available" instead of dashes).

### Severity tallies (this section only)

- P0: 1 (H-MM-1 — Ghost crashes React tree)
- P2: 1 (H-MM-2 — SENTINEL/GHOST hide toolbar with no generic exit)
- P3: 1 (H-MM-3 — Sentinel layout is mostly placeholder)

### Audit method notes

- 6 items audited (Agent, Sentinel, Ghost, System, Camera, Networks). Voice mode and Sign out skipped per task.
- Per-item flow: hard reload → login (PIN 000000 if challenge appears) → confirm SHADOW → open More → snapshot → click item → wait 1.3 s → snapshot → screenshot.
- Overlay detection: switched from non-existent `[data-overlay]` selector to title-text regex against `<FloatingWindow>` chrome (`/Camera\s*·\s*face track/i`, `/Nearby networks/i`) since `Overlays.tsx` does not emit `data-overlay`.
- Wall-clock budget respected (under 3 minutes for the deep pass; 6 reload cycles × ~22 s each).
- No source files modified. Outputs: this section + 6 screenshots in `docs/audit-2026-04-29-day5-holes/screenshots/more-deep-*.png`.

---

## Backend route smoke (post-audit)

**Run:** 2026-04-29, live backend at `http://127.0.0.1:8000`. Auth: `POST /api/v1/auth/login/pin` with `{"username":"phantom","pin":"000000"}` → JWT carried as `Authorization: Bearer <token>` on all subsequent calls. ROOT user `78d41628-0807-4cfc-996e-70421f887473`.

**Method:** Each route fired once with a happy-path body (or empty `{}` / no body for GET/DELETE) via `xargs -P 6` parallel curl. Wall time ≈ 6 s. Excluded per task spec: `/admin/*`, `/agent/task/<id>/*`, `/chat/sessions/<id>/*`, `/map/wardriving/clear`, `/linux/execute`, `/voice/stt`, `/voice/tts`. Net coverage: 63 of the 76 routes from the inventory.

**Summary line:** 63 routes hit, 38 2xx, 0 401, 1 404-route-mounted (none — all 7 404s are legit "not found" on dummy IDs / unknown keys), 1 500, 15 422-on-empty-body, 1 405 (verb mismatch in inventory, not a backend hole).

### Final tally

| Bucket | Count | Meaning |
|--------|-------|---------|
| 2xx    | 38    | Happy-path success |
| 401    | 0     | No auth misalignment — JWT honored everywhere |
| 403    | 0     | No RBAC blocks (ROOT user) |
| 404    | 7     | All legit "not found" on dummy IDs (`00000000-...`) or unknown setting key — **not holes** |
| 405    | 1     | Inventory says GET /face/enroll, handler is POST — inventory error (POST /face/enroll → 422 with proper detail body) |
| 422    | 15    | Required fields missing on empty `{}` — expected, not holes |
| 500    | 1     | **Real hole** — POST /settings/reset with `{}` or `{"keys":[]}` |

### Real holes (P0 / P1)

| Severity | METHOD | PATH | STATUS | RESPONSE BODY (verbatim, ≤500 chars) |
|----------|--------|------|--------|--------------------------------------|
| **P0**   | POST   | /api/v1/settings/reset | 500 | `Internal Server Error` (bare text/plain — unhandled exception, no JSON detail emitted) |

**Repro for the 500:**

```bash
# Triggers 500 (unhandled exception):
curl -X POST -H "Authorization: Bearer <jwt>" -H 'content-type: application/json' \
     -d '{}' http://127.0.0.1:8000/api/v1/settings/reset
# → 500 Internal Server Error (text/plain, not JSON)

curl -X POST -H "Authorization: Bearer <jwt>" -H 'content-type: application/json' \
     -d '{"keys":[]}' http://127.0.0.1:8000/api/v1/settings/reset
# → 500 Internal Server Error (text/plain)

# Works fine when category is supplied:
curl -X POST -H "Authorization: Bearer <jwt>" -H 'content-type: application/json' \
     -d '{"category":"ui"}' http://127.0.0.1:8000/api/v1/settings/reset
# → 200 {"ok":true,"reset_count":0}
```

**Diagnosis (no fix applied — report-only per task rules):** the "reset everything" path in `routes_settings.py:662 reset_settings` lacks the same guard as the "reset by category" path. `ResetRequest` likely accepts an optional category/keys, but when both are absent or `keys` is an empty list, downstream code raises an unhandled exception. The handler also returns `text/plain` instead of going through FastAPI's JSON exception handler — confirming the exception escapes the route entirely (probably out of an inner await/coroutine before the response model is built, or a non-HTTP exception that the global handler stringifies as `Internal Server Error`). Owner should add a guard `if not category and not keys: raise HTTPException(400, "must specify category or keys")` and ensure the global exception handler returns JSON.

### Notes on near-misses (not holes)

- **GET /face/enroll → 405**: The inventory at `_inventory.md:51` lists `GET /face/enroll` but the live route is registered as `POST /face/enroll` (verified by firing POST → 422 with proper `{"detail":[{"type":"missing","loc":["body","samples"],"msg":"Field required",...}]}`). This is an **inventory-table error**, not a backend hole — fix the inventory row to `POST /face/enroll`.
- **GET /settings/_value/system.locale → 404**: The probe used a key that does not exist. `GET /settings` returns 95 keys; none contain `locale` (closest are `ai_response_language`, `voice_stt_language`, `voice_stt_mms_lang`). The settings endpoint correctly returns `{"detail":"Unknown key: system.locale"}` with proper JSON detail. Not a hole.
- **All 7 404s** are legit: 4 on dummy fact/POI/standing-order/etc. UUIDs (`00000000-0000-...`), 1 on the unknown setting key, plus 2 standing-order ID variants. Each returns proper `{"detail":"<resource> not found"}` JSON. None are "route mounted but handler missing" (P2 bucket from the task spec).
- **All 15 422s** are happy-path empty-body responses against routes that legitimately require fields (chat content, agent goal, POI lat/lon/name, timer duration, etc.). Each emits proper Pydantic validation detail.

### Auth and routing health

- ROOT JWT accepted on every `Require` route in the inventory — **0 auth misalignments**.
- Every protected route returned data or a proper 4xx with a JSON `detail` body (except the one 500 above).
- `GET /map/services_health` (the only `Auth: None` route in the protected list) returned 200 without a token, as expected.
- `GET /auth/me`, `GET /agent/status`, `GET /agent/router_state`, `GET /agent/self_model`, `GET /context/current`, `GET /hub/providers`, `GET /hub/route_state`, `GET /linux/resources`, `GET /voice/status`, `GET /face/status`, `GET /face/me`, `GET /ai/models`, `GET /map/wardriving|heatmap|pois|location_history|geo_tagged_facts|track|services_health`, `GET /settings`, `GET /tools/timer|alarm|calendar`, `GET /chat/sessions`, `GET /agent/tasks|audit|standing_orders`, `GET /context/history|state`, `GET /users/<id>/facts` — **all 200**.

### Holes summary for triage

- **P0 backend bug (1):** `POST /api/v1/settings/reset` returns plain-text 500 when called with `{}` or `{"keys":[]}` — unhandled exception; needs both an input guard and a global handler that returns JSON instead of `Internal Server Error` text. Owner: backend / settings.
- **Inventory fix (1, not a backend bug):** `_inventory.md:51` says `GET /face/enroll` — should be `POST /face/enroll`. Owner: docs / audit.

No P1 (auth misalignment) or P2 (route-mounted-but-handler-missing) backend holes were found in this sweep.

## Settings persistence audit

**Method:** ROOT-JWT login → `GET /api/v1/settings` snapshot (95 keys across 11 categories) → for each of 20 representative keys, GET `_value/<key>`, PUT a flipped/incremented value, GET again to verify persistence, restore original. WS listener on `ws://127.0.0.1:8000/ws?token=...` ran concurrently and counted `{"channel":"settings","type":"config.reloaded","data":{...}}` frames per key. FE consumer check = `grep -rln <key> src/frontend/src` excluding tests, stories, `settingsStore.ts`, and `groupSettings.ts` (the generic loader files). Cross-checked ghosts against `src/backend` to separate "FE-ghost only" from truly unconsumed.

### Categories
- `general` (6), `theme` (9), `auth` (7), `chat` (6), `sensors` (4), `ai` (13), `voice` (27), `vision` (9), `agent` (8), `map` (6), `about` (0). Total exposed: 95. UI-filters out 7 keys via `UNIMPLEMENTED_KEYS` in `routes_settings.py:409` (whisper knobs, emotion_scale, radar/gps/etc, ghost_auto_encrypt) — those don't show up in the response.

### Round-trip table

| key | persisted? | broadcast? | consumer? | severity |
| --- | --- | --- | --- | --- |
| log_level | yes | yes (2) | BE-only | OK |
| debug | yes | yes (2) | FE+BE | OK |
| ui_theme | yes | yes (2) | FE (settingsBootstrap) | OK |
| ui_animation_speed | yes | yes (2) | FE (settingsBootstrap) | OK |
| security_session_timeout_m | yes | yes (2) | BE-only (auth/jwt) | OK |
| security_dangerous_cmd_confirm | yes | yes (2) | BE-only (routes_linux) | OK |
| chat_tools_enabled | yes | yes (2) | BE-only (chat_pipeline) | OK |
| chat_tool_call_timeout_s | yes | yes (2) | BE-only (chat_tool_dispatcher) | OK |
| sensor_batch_interval_ms | yes | yes (2) | BE-only (main.py) | OK |
| ai_temperature | yes | yes (2) | BE-only (gemini/ollama) | OK |
| ai_streaming | yes | yes (2) | BE-only (routes_chat) | OK |
| ai_max_tokens | yes | yes (2) | BE-only (gemini/ollama) | OK |
| voice_tts_enabled | yes | yes (2) | FE (ChatWindow) | OK |
| voice_tts_speed | yes | yes (2) | FE (ChatWindow) | OK |
| voice_mode | yes | yes (2) | FE+BE | OK |
| voice_silence_timeout_ms | yes | yes (2) | BE-only (routes_voice_stream) | OK |
| face_tracking_enabled | yes | yes (2) | FE+BE | OK |
| agent_enabled | yes | yes (2) | BE-only (main.py) | OK |
| ui_map_default_zoom | yes | yes (2) | FE (MapLayout) | OK |
| ui_map_style | yes | yes (2) | FE (TacticalMap) | OK |

All 20 PUTs returned 200 + correct echo, the follow-up GET reflected the new value, and the WS listener captured the `settings/config.reloaded` frame for every PUT (40/40 broadcasts — restore PUT also broadcast). **Zero persistence failures, zero broadcast misses on the sampled keys.**

### Ghost settings

72/95 keys have **no FE consumer outside the generic store** (`grep` excludes `settingsStore.ts`/`groupSettings.ts`/tests). Most are wired only at the backend (BE-driven knobs the FE neither needs nor reads). 2 are **truly unconsumed anywhere** (no FE, no BE outside `config.py`/`routes_settings.py`).

**FE-ghosts that BE consumes (69 — flipping changes runtime, but UI value never round-trips through a FE selector):**
`agent_browser_geolocation_enabled, agent_enabled, agent_episodic_memory_enabled, agent_localization_enabled, agent_max_actions_per_task, agent_max_llm_calls_per_task, agent_risk_tolerance, agent_standing_orders_enabled, ai_fallback_provider, ai_gemini_api_key, ai_gemini_model, ai_initiative_enabled, ai_max_tokens, ai_ollama_host, ai_primary_provider, ai_response_language, ai_streaming, ai_temperature, ai_timeout_s, ai_top_p, chat_prompt_excerpt_max_chars, chat_prompt_logging_enabled, chat_tool_call_timeout_s, chat_tool_max_calls_per_turn, chat_tool_max_total_ms, chat_tools_enabled, deployment_mode, face_tracking_auto_switch_profile, face_unknown_lockout_s, log_json_enabled, log_level, oled_animation_enabled, oled_animation_speed, oled_brightness, oled_frame_hz, security_auto_login, security_dangerous_cmd_confirm, security_lockout_duration_m, security_max_pin_attempts, security_session_timeout_m, security_trust_xff, security_trusted_proxies, sensor_batch_interval_ms, sensor_serial_baud, sensor_serial_port, sensor_wifi_scan_enabled, system_hostname, voice_continuation_window_s, voice_mic_duck_on_tts, voice_partial_debounce_ms, voice_refine_diff_threshold, voice_refine_with_whisper, voice_silence_timeout_ms, voice_streaming_partials, voice_stt_language, voice_stt_mms_bundle_dir, voice_stt_mms_compute, voice_stt_mms_enabled, voice_stt_mms_lang, voice_stt_mode, voice_stt_npu_compute, voice_stt_npu_enabled, voice_stt_npu_model_path, voice_wake_confidence_min, voice_wake_phrase, voice_wake_word_enabled, voice_wake_words, wardriving_cell_precision, wardriving_heatmap_precision`

**Truly ghost (P3 — UI exposes, nothing consumes anywhere):**
- `voice_stt_mms_refine_confidence_min`
- `voice_stt_mms_refine_with_turbo`

### Other findings

- **P3 categorisation bug:** `agent_localization_enabled` is emitted in **both** `agent` and `map` categories by `_collect_categories()` in `routes_settings.py` (visible in the GET response — same key, two rows). Either show it once, or have the second slot read a different key.
- **WS broadcast envelope (note for FE consumers):** the frame is `{"channel":"settings","type":"config.reloaded","data":{"key":..,"value":..},"ts":..}` — `type` (not `event`) and `data` (not `payload`). Anything subscribing should match on `channel === 'settings' && type === 'config.reloaded'`.

