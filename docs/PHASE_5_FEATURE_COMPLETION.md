# Phase-5 Feature Completion — Track Plan

**Origin:** Operator 2026-04-30 — "пропиши доки із завданнями під все, але починай поступово по всім пунктам. якісно!"

This is the master backlog for closing every UI surface that talks to a
working backend feature. Order is execution-priority: mock-data hunt
first (clears the foundation), then a per-feature CRUD pass.

Each task lists: scope, files touched, backend dependency, acceptance
criteria, and est. effort. None of them are halтура — every endpoint
must be REAL (no stubs, no fake data, no "later" placeholders).

---

## A — Mock-data hunt + purge

**Status:** in progress (`phase-5-R1-A-MOCK-HUNT`).

**Why first:** before adding new features, every existing surface that
silently renders fake data must be wired to real backend or marked
honestly. Operator's complaint: "багато фейкових даних замість
реальних".

**Scope:**
- Grep across `src/` for `mock`, `fake`, `lorem`, `placeholder`,
  `dummy`, `TODO`, `FIXME`, `STUB`, hard-coded test usernames
  (`alice`, `charlie`, `test-`, `phantom_i*`).
- For each hit:
  - **If a real endpoint exists** — wire it (`useEffect` fetch +
    loading + error state).
  - **If endpoint is missing** — open a sub-task in this doc with
    acceptance criteria; do NOT leave the mock.
  - **If the surface is dev-only** (`__tests__`, `*.test.*`,
    debug pages) — leave it.
- Output `docs/audit-2026-04-30-mock-hunt.md` with categorised hits +
  fixes applied + open sub-tasks.

**Acceptance:**
- Zero mocks in user-visible production code.
- All sub-tasks documented in this file under their feature section.

**Files touched (estimate):** 10–25 across FE + BE.
**Effort:** 1–2 hours.

---

## B — Calendar full UI

**Backend:** `src/backend/tools/calendar_service.py` (CRUD + recurrence
RRULE), `routes_tools.py` exposes `tools.calendar.*`.

**Scope:**
- `src/frontend/src/components/calendar/CalendarView.tsx` — month grid,
  week & day strip, event chips with category color from `CalendarEvent`
  schema.
- `src/frontend/src/components/calendar/EventEditor.tsx` — create/edit
  modal: title, datetime, duration, location, recurrence (RRULE
  builder), reminders, color/category.
- `src/frontend/src/stores/calendarStore.ts` — zustand store: events
  by date, optimistic CRUD, WS subscription on `tools.calendar.event_*`.
- `routes_tools.py` audit: confirm POST/PUT/DELETE/list/by-range.
- Wire into `OperatorLayout` accordion or new top-level scene.

**Acceptance:**
- Month view renders real events from backend (not mocks).
- Create event → POST hits backend → WS broadcast → all clients update.
- Edit/delete same flow with confirm dialog on delete.
- Recurrence: weekly/daily/monthly/custom RRULE; events expand correctly.
- Reminders fire via backend scheduler → UI banner + optional voice.
- Touch ≥ 44, 1024×600 strict, no overflow.

**Files touched:** 4–6 FE files, audit-only on BE.
**Effort:** 4–6 hours.

---

## C — Timer manager UI

**Backend:** `src/backend/tools/timer_service.py` (already shipped in
phase-5-R2-BE-TOOLS-1). REST + WS streaming.

**Scope:**
- `src/frontend/src/components/timers/TimerListPanel.tsx` — list of
  active + recently-finished timers; per-row pause/resume/cancel/
  extend buttons (44×44).
- `src/frontend/src/components/timers/NewTimerDialog.tsx` — duration
  picker (HH:MM:SS), label, preset chips (5m / 15m / 1h / Pomodoro /
  custom), AI-summary toggle.
- `src/frontend/src/stores/timerStore.ts` — list + WS-driven tick
  updates; reuses existing `TimerScene` for inline rendering.
- Settings group "Tools" → button "Open Timers panel".

**Acceptance:**
- Active timers tick in real time via WS, not polling.
- Pause/resume/cancel/extend → backend action confirmed → UI update.
- New timer creation succeeds without page reload.
- Reduce-motion: tick visual replaced with text-only countdown.
- AI-suggested labels via `tools.timer.suggest_label` (if present;
  otherwise drop the toggle silently — no fake data).

**Files touched:** 3 new FE files, audit `routes_tools.py` for the
WS event names.
**Effort:** 3–4 hours.

---

## D — Files manager UI

**Backend:** `src/backend/tools/file_manager.py` (sandbox-bound paths,
read/write/list/delete + size cap).

**Scope:**
- `src/frontend/src/components/files/FileBrowser.tsx` — left pane tree
  view of allowed roots, right pane current directory listing with
  size + mtime + icon by ext.
- `src/frontend/src/components/files/FilePreview.tsx` — text/code
  (Monaco-lite via existing CodePreview), image (`<img>` w/ object-fit),
  PDF (iframe), other → metadata-only.
- Upload: drag-drop OR file-picker → POST `tools.files.write` with
  base64 body and SHA-256 verify.
- Delete: confirm dialog, soft-delete to sandbox trash if backend
  supports; otherwise hard.

**Acceptance:**
- Tree expands lazily (no full-recursive load).
- Path traversal blocked client-side AND server-side (already enforced).
- Upload + delete reflect in tree without reload.
- 1024×600 strict; tree max-width 200, preview takes remainder.

**Files touched:** 2 new FE files + 1 store, audit BE routes.
**Effort:** 4–5 hours.

---

## E — Profile management UI (post-login)

**Backend:** `users_router` in `routes_auth.py` — full ROOT CRUD already
ships (list / create / put / put role / delete). RFID enrollment
endpoint exists (`/auth/rfid/enroll`).

**Scope:**
- `src/frontend/src/components/settings/ProfileManagement.tsx` — list
  of users with avatar mandala + role + last_seen; per-row edit/role
  /delete buttons.
- `src/frontend/src/components/settings/EditProfileDialog.tsx` —
  username (RO once set, per audit), avatar URL, role selector, PIN
  rotate, RFID enroll button (triggers wake-on-tap reader).
- ROOT-only — gate behind `useAuthStore.user.role === 'ROOT'`; otherwise
  show empty-state "ROOT-required".
- Add to SettingsPanel "Profile" group as a sub-section.

**Acceptance:**
- List loads from `/api/v1/users` GET.
- Edit submits PUT, role-change submits separate `/role` PUT, delete
  has confirm dialog.
- RFID enrollment → 10-sec listen window with live status pill from
  `/auth/rfid/listen` WS.
- Operator can NOT delete the user they are currently signed in as
  (FE enforcement + backend already guards).

**Files touched:** 2 new FE files + SettingsPanel patch.
**Effort:** 3–4 hours.

---

## F — Terminal full UI (chat-shell + history)

**Backend:** `linux/executor.py` (sandbox subprocess) + `routes_linux.py`.
Sandbox FE exists (`SandboxLayout`); chat-inline terminal rendering
needs the `respond_terminal` AI form to actually execute.

**Scope:**
- Wire `respond_terminal` AI form: when AI replies with a terminal
  scene, the FE auto-creates a sandbox session and streams output into
  the chat bubble (closes carry-forward "respond_terminal doesn't
  execute").
- `src/frontend/src/components/terminal/TerminalSessionList.tsx` —
  history of past sandbox sessions; click to re-show stream/output.
- Inline `SandboxScene` (already in `chat/scenes/`) gets a "Re-run"
  button when session is finished.

**Acceptance:**
- Chat → AI suggests `respond_terminal cmd="..."` → FE confirms via
  ROOT gate → sandbox session created → stream lands in chat.
- Past sessions browsable via `linux.runs` GET.
- Re-run button opens a NEW session with same cmd, NOT the same id
  (history preserved).

**Files touched:** 1 new FE file + ChatScene wiring + `respond_terminal`
handler in chat reducer.
**Effort:** 3 hours.

---

## G — Events / standing orders UI

**Backend:** `tools/standing_orders` partially exists (closed in
phase-5-R1-FE-SCENES-2 with the WS subscriber + StandingOrdersOverlay).

**Scope:**
- `src/frontend/src/components/orders/OrdersListPanel.tsx` — list of
  orders w/ next-fire time, RRULE, action; per-row pause/cancel.
- `src/frontend/src/components/orders/NewOrderDialog.tsx` — natural-
  language entry → backend parses to RRULE + action via AI; preview
  step before save.
- Audit log panel (closes B-22 carry) — `src/frontend/src/components/audit/AuditLogPanel.tsx` —
  paginated table from `/agent/audit` with filter chips by
  action_name + risk_level + time-range.

**Acceptance:**
- List of orders renders REAL data; create flows through to backend.
- Audit log filters work; row click expands to JSON detail.

**Files touched:** 3 new FE files.
**Effort:** 4 hours.

---

## Cross-cutting cleanups (continuous)

These run alongside A–G whenever an opportunity arises:

- **Whisper warm-up** (P3 carry-forward) — first chunk after voice-on
  drops because the model isn't loaded; pre-warm on app boot.
- **H-WK-6 voice always-on permission gate** — prompt before opening
  the mic when `voice_mode=continuous` flips on.
- **DB cleanup script** — patch `scripts/cleanup_test_users.py` so
  the next test run can't re-leak fixtures (carry-forward H-D3).
- **QA-VISUAL re-run** — Playwright sweep when system has headroom
  (the previous attempt OOM'd at load 19.9).

---

## Execution order this session

1. ✅ Plan written (this doc)
2. ⏳ A — mock-data hunt + purge
3. ⏳ E — profile management UI (smallest, builds on AddProfileWizard)
4. ⏳ C — timer manager UI (already-shipped backend, fast win)
5. ⏳ B — calendar full UI (largest single task; may span sessions)
6. ⏳ D — files manager UI
7. ⏳ F — terminal chat-shell wiring
8. ⏳ G — events + audit panel

**Honest cap for this session:** A + E + C realistic. B–G probably span
the next 2–3 sessions. Each ships as its own atomic commit set so the
operator can review, push, and merge independently.
