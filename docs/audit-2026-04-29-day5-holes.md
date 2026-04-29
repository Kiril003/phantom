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
| _none yet_ | | | | | | |

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
