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
| B-3 | WS `settings` channel | `routes_settings.py:587` broadcasts `config.reloaded` after every PUT so other clients refresh live, but no FE consumer; channel not in `WSChannel` union. Multi-tab settings stay stale until manual reload. | P2 | Open settings on tab A and tab B, change a value on A — B does not refresh | Add channel + handler that re-runs `bootstrapSettings()` or merges the patch | Open |
| B-4 | WS `map` channel | `main.py:201` broadcasts `wardriving_update` on channel `map` whenever a new AP is captured, but no FE listener — `mapStore` only polls `getWardriving()`. New APs invisible until next poll. | P2 | Trigger wardriving capture; FE doesn't append marker until next poll cycle | Subscribe to `map` channel and append into `mapStore.wardrivingRecords` | Open |
| B-5 | WS `voice` channel typed but unused | `services/websocket.ts:47-51` defines `VoiceMessage` for types `partial`/`final`/`tts_start`/`tts_end`. No `wsClient.on('voice', …)` subscriber; BE never broadcasts on `'voice'` (voice events flow over a separate `/ws/voice/stream` socket in `routes_voice_stream.py`). Type is dead on both sides. | P3 | grep `'voice'` channel in BE — zero hub.broadcast calls; FE — zero subscribers | Drop `VoiceMessage` interface or wire BE to publish into the multiplexed hub | Open |
| B-6 | WS `alert` channel | `services/websocket.ts:53-57` defines `AlertMessage` with `type: 'priority'`. No FE subscriber and no BE publisher (`decision_tree.py` returns kind="alert" Decisions internally but they never become WS messages). Channel is dead. | P3 | Trigger high-priority decision (e.g. battery alert); nothing crosses WS | Wire DecisionTree alert → `hub.broadcast('alert', 'priority', …)` or remove the dead type | Open |
| B-7 | WS `terminal` channel | `WSChannel` lists `'terminal'` (`services/websocket.ts:11`) but no BE publisher and no FE subscriber. TerminalWidget is meant to stream live linux output; live feed is unreachable. | P3 | Open Terminal widget overlay; no live process output | Either delete channel or wire `linux/executor.py` streaming output to `hub.broadcast('terminal', 'output', …)` | Open |
| B-8 | WS `face` channel | `WSChannel` includes `'face'` (`services/websocket.ts:15`) but no BE broadcaster and no FE subscriber. Likely leftover from face-recognition planning that never landed. | P3 | grep — no `hub.broadcast('face', …)` anywhere | Drop from union OR wire face-recognize event → broadcast | Open |
| B-9 | `agentApi.checkpoint` / `resumeFromCheckpoint` orphaned | Backend exposes `POST /agent/task/{id}/checkpoint` and `…/resume_from_checkpoint` (`routes_agent.py:104,112`); FE wraps both in `agentApi.ts:78-81`. Neither is called from `components/`, `stores/`, or `hooks/`. User has no way to manually checkpoint or resume — feature is wired backend-only. | P2 | Open agent panel — no "checkpoint" / "resume" buttons | Add controls to ControlsBar or task detail view | Open |
| B-10 | `authApi.config` never called | `GET /auth/config` (`routes_auth.py:371`) exposes `max_pin_attempts`, `lockout_duration_m`, `session_timeout_m`. FE wrapper exists (`services/api.ts:83-87`); no caller. PinPad uses hardcoded values instead of these limits. | P2 | Set `max_pin_attempts=2` in BE config; PinPad still allows N attempts before lockout fires | Call `authApi.config()` on PinPad mount; use returned limits in lockout logic | Open |
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
| B-25 | `bootstrapSettings()` never re-runs after a write | `services/settingsBootstrap.ts:15` is called once in `providers.tsx`. BE broadcasts `settings/config.reloaded` on PUT (B-3). Even within a single tab, settings UI updates the local store optimistically, but downstream consumers (agent quota, voice config) reading via `bootstrapSettings` cache see stale values until full reload. | P2 | Change `agent_max_steps` in Settings; agent quota stays stale until page reload | Have settings WS handler trigger a partial bootstrap re-fetch for the relevant key | Open |

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
| H-D3 | ProfileSelector — 426 seeded test users in the live operator picker | Initial-load network captures show **426 OPERATORS KNOWN** in the picker footer (visible in `01-profile-selector.jpg`). The horizontally scrollable list is dominated by `phase17a_user_*`, `phantom_test_root_*`, `phantom_i7_*`, `phantom_i4_*`, `t_*` (test factory), `id3-speaker-*`, `id3-holder-*` (ID3 contract test fixtures). On a single-operator device this is unusable: a real user would have to scroll through hundreds of fake accounts to find their tile. The seed/test users were created by `tests/test_phase_*` runs against the dev DB and never purged. | P1 | Open `/`, count buttons. Sweep captured 30+ buttons in the first viewport, all test-named. Footer says "426 OPERATORS KNOWN". | Add `User.is_test` (or filter on username prefix `phase17a_*`/`t_*`/`id3-*`/`phantom_test_*`) in `routes_auth.py`'s users-list endpoint when `settings.environment == "production"`. Or move pytest fixtures to a separate `:memory:` DB so they never pollute `phantom.db`. | Open |
| H-D4 | ProfileSelector — operator cards have no per-user identity surface | Every card renders the same template: gradient background + first-letter avatar + raw `username` string + "Tap to enter". No display name, no avatar image, no last-seen timestamp, no role badge (ROOT/OPERATOR/GUEST), no trust indicator. The user model on backend has all of these (`User.role`, `User.last_login_at`, `User.behavioral_model`), but the UI throws them away. Combined with H-D3, every card looks identical except for a random hue. | P2 | See `01-profile-selector.jpg` — five cards, all "P / OPERATOR / phase17a_user_..." with no other differentiation. | In the profile picker, surface `display_name || username`, `role` chip, last-login relative time, trust score (if known). Users without a real `display_name` should fall back to a friendlier prefix, not the raw uuid. | Open |
| H-D5 | PIN pad — visible PIN input is a clickable digit grid, not an `<input type="password">` | The PIN pad is rendered as 10 `<button>`s plus 6 dot indicators (`02-pin-pad.png`). There is **no `<input>` element of any kind on this surface** — `await page.$$('textarea, input[type="text"], input[type="password"]')` returns 0. Consequence: no autofill, no hardware keyboard input on the dev kiosk (you must mouse/tap the on-screen pad), no password manager support, and any test that drives PIN entry must enumerate buttons by visible label rather than `.fill()`. For a touch-only kiosk this is acceptable, but the sweep needs to know to click buttons rather than type. | P3 | `document.querySelectorAll('input').length === 0` on the PIN surface. | Either: (a) add a hidden `<input type="password" autocomplete="one-time-code">` paralleled to the visible buttons so test scripts and password managers can type, or (b) document this in `docs/STATE_MACHINE.md` under "Auth surface" so future audits don't waste a cycle on it. | Open — document or implement |
| H-D6-CLOSED | Initial bootstrap fires `GET /api/v1/settings` while unauthenticated, gets 401×4 in console | Network log: `GET /api/v1/settings` fires four times during initial load (twice on first navigation, twice on subsequent), each returning 401 because the user is on the pre-auth profile picker. The console accumulates 4 red errors. After PIN failure, `POST /api/v1/auth/login/pin` returns the expected 401 (correct), but the persistent settings polling means the console is dirty before the user has even attempted login. Likely a `useEffect`/`useQuery` running unconditionally instead of being gated on `auth.session !== null`. | P2 | Initial load. Watch DevTools network — four `settings` 401s before PIN entry. | Gate `bootstrapSettings()` (or whichever hook does the GET) on `useAuthStore(s => s.session)` being non-null; or move it into a `<RequireAuth>` boundary. | Open |
| H-D7 | StatusBar / brand text rendered as one letter per DOM node | Sweep `body.innerText.slice(0,1500)` on the PIN surface returns `…\nP\nH\nA\nN\nT\nO\nM\n \nO\nS\n…` — every glyph of "PHANTOM OS" is on its own line, meaning each character is a separate inline-block (probably for a glyph reveal animation). Screen readers announce each letter individually ("P, H, A, N, T, O, M, O, S"), and copy/paste includes newlines between every glyph. | P3 | Inspect the brand element on the PIN surface — DOM has 9 sibling spans, one per letter. | Wrap the animated glyphs in a single accessible element with `aria-label="PHANTOM OS"` and apply per-letter animation via CSS pseudo-elements or with `aria-hidden` glyph spans + a sibling visually-hidden full label. | Open |
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
