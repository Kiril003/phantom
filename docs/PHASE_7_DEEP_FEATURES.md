# Phase 7 — Deep features (no halтура edition)

**Origin:** Operator 2026-04-30 — multiple major gaps flagged after
phase-6 ship:
- "термінал не зробив" → being closed in this session via routes_chat
  respond_terminal → sandbox bridge.
- "ангентік і досі фігня, не краще клауд коду" — agent is Gemini 2.0
  Flash + Ollama fallback per `CLAUDE.md`. We are NOT replacing the
  brain. What we CAN do (and do) is grow the tool surface, the memory
  reach, and the visualisation of agent thinking.
- "візуально ще не може бачити що створює" — vision self-perception
  for the agent (screenshot tool + visual feedback loop).
- "календар скудний" — recurrence, reminders, categories, ICS
  import/export.
- "файли просто перегляд" — write/edit/upload/mkdir/rename now ship in
  this session (BE+agent tools); FE edit-mode + drag-drop upload still
  pending in the same session as a follow-up.
- "він може професійні презентації/документи клепати, редагувати,
  вивчати" — separate document/presentation editor track.
- "чат не пророблена внутрішня візуалізація і атачментси" — agent
  thinking trace + image/file attachments inline in chat.

This file is the **honest scope of work** for what doesn't fit a single
session and shouldn't be faked into one.

---

## P1 — Document & presentation editor (NEW major feature)

**Estimate:** 2-3 sessions.

A real editor track:
- **Markdown-first writer** — `src/frontend/src/components/docs/DocEditor.tsx`
  with `@uiw/react-md-editor` or CodeMirror 6 + preview.
- **Slide deck mode** — Slidev-style markdown deck rendering. Adopting
  `slidev` as a dev-dep is acceptable since it's MIT and has a runtime
  bundler we can host inside the FE.
- **Export** — html (built-in), pdf (puppeteer headless on the radxa),
  docx (`html-docx-js`).
- **Backend storage** — `tools/docs_repo.py` with `Document` SQLAlchemy
  model. Each doc has `id, user_id, title, format ('md' | 'slides' |
  'rich'), content, updated_at`. CRUD endpoints under
  `/api/v1/docs/...`.
- **Agent reach** — new tools `create_document`, `update_document`,
  `list_documents`, `read_document`, `export_document_pdf`. Agent can
  voice-create "зроби презентацію 8 слайдів про X" → outline → fill →
  export.

**Out of scope here:** real-time collab editing, comments, version
diffs (those belong to a phase-8 collab track).

---

## P2 — Calendar deep features

**Estimate:** 1-2 sessions.

- **Recurrence (RRULE)** — extend `CalendarEvent` model with
  `rrule_str`, `recurrence_end_at` fields. Use `python-dateutil`
  `rrulestr()` to expand on read. FE: `RRuleBuilder.tsx` (frequency
  + interval + count/until + by-day).
- **Reminders** — `EventReminder` model with `event_id, offset_min,
  channel ('voice' | 'banner' | 'haptic')`. Scheduler emits banners
  before due events.
- **Categories + colors** — operator-defined; per-category color picker
  in EventEditor.
- **ICS import/export** — drag-drop .ics file → events parsed.
  Right-click event → "Export .ics".
- **Agent reach** — `create_recurring_event`, `set_event_reminder`.

---

## P3 — Files: write/edit (BE) + edit-mode + upload (FE)

**Status:** **HALF SHIPPED in this session.**

Done now:
- BE: `write_file` (5 MiB cap), `make_directory`, `rename_path`.
- REST: POST `/files/write`, POST `/files/mkdir`, POST `/files/rename`.
- Agent tools: `write_file`, `make_directory` (25 tools total now).

Still pending — picked up later in this session:
- FE FileBrowser edit-mode toggle (tap pencil → CodeMirror editor →
  Save = `/files/write`).
- Drag-drop upload pane in FileBrowser left pane.
- Per-row context menu: rename / mkdir-here.

---

## P4 — Vision self-perception (NEW agent capability)

**Estimate:** 1 session for stub, 2 more for full integration.

The agent today is text-blind to its own UI. Operator's complaint:
"візуально ще не може бачити що створює." Real fix:

- **Screenshot tool** — new agent tool `take_ui_screenshot()` that
  drives the FE via Playwright headless on the same Radxa, captures
  a 1024×600 PNG, returns a base64 thumbnail + saves to
  `~/phantom/screenshots/`.
- **Visual evaluator** — feed the thumbnail back to Gemini 2.0
  vision-capable model (the Flash family supports image inputs) so it
  can self-critique. Gate behind `agent_vision_enabled` setting.
- **Self-correct loop** — when the operator says "make it warmer",
  agent: (a) takes screenshot, (b) compares to operator description,
  (c) emits a CSS-token diff, (d) screenshots again to verify.

This is a real feature, not a stub. Kept off P3 because it needs the
Playwright MCP server already-running on the host + a UID-bound chrome
profile so the captured frame matches the operator's session.

---

## P5 — Chat thinking trace + attachments

**Estimate:** 1-2 sessions.

- **Thinking trace** — when `agent_thinking_visible=True`, the chat
  surfaces the inner monologue stream (already ships on
  `inner_monologue.stream` WS channel; FE consumer pending). Render
  each step as a collapsible italic line under the assistant bubble.
- **Tool-call viewer** — every `tool_executor.execute_tool` call emits
  a chat-level event: name + args snippet + elapsed_ms. FE renders a
  pill stack ("created timer · 14ms · ✓") so the operator sees the
  agent's hands working.
- **File attachments** —
  * Upload: drag a file into the chat input → multipart POST to
    `/files/write` then attach a `terminal_output`-style scene with
    a download link. Agent can `read_file()` on it next turn.
  * Image preview inline (when scene `kind: image`).
  * PDF preview via `<iframe src=blob:...>`.

---

## P6 — Standing orders / proactive interventions

**Estimate:** 1 session.

Operator-flagged carryover from phase-5 (B-1 closed; B-2 / standing-
orders FE list still pending per `morning-2026-04-30-report.md`).

- `OrdersListPanel.tsx` in ToolsOverlay (5th tab) — list of orders,
  pause/cancel.
- `NewOrderDialog.tsx` — natural-language → RRULE + action via AI;
  preview before save.
- BE `/orders` REST surface with WS `standing_orders.fired` channel
  already in place (audit closed).

---

## Honest priorities

What we actively work on this session, in order:
1. ✅ respond_terminal → sandbox session (committed in this same push)
2. ✅ Files write/edit/mkdir/rename BE + agent tools
3. ⏳ Files FE edit-mode + drag-drop upload
4. ⏳ Chat tool-call pill stack (P5 partial)
5. ⏳ This document committed so the rest is honestly logged.

What we do NOT do this session:
- P1 docs/presentations editor (separate track — needs slidev
  bundler + pdf export infra)
- P2 calendar recurrence (needs `python-dateutil` rrule plumbing)
- P4 vision (needs Playwright headless + Gemini vision wiring)
- P5 thinking-trace UI (needs uiStore + WS subscriber)

These are scoped here so the operator sees the whole map without me
faking them into a half-baked commit.
