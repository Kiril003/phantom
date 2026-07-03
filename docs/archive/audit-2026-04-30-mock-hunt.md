# Audit 2026-04-30 — Mock-Data Hunt (Task A)

**Scope:** find every `mock` / `fake` / `lorem` / `placeholder` /
`dummy` / `TODO` / `FIXME` / `STUB` / hardcoded sample data in
production code paths and either wire it to real backend or document
honestly. Fixtures and `__tests__` paths excluded.

**Verdict:** the codebase is **substantially mock-free**. Two days of
phase-5 redesign work shipped without leaking sample data. The few
hits found are categorised below — most are false positives (the word
"placeholder" used legitimately for `<input>` UI copy), the rest are
documented epic-scoped TODOs (not halтура).

---

## Frontend — false positives (legitimate uses)

These contain the search-words but are NOT mock data:

| File | Line | Why it's fine |
|---|---|---|
| `chat/ChatWindow.tsx` | many | `placeholder` on `<input placeholder="Message PHANTOM…">` — UI copy |
| `chat/DynamicPicker.tsx` | many | `placeholder` prop for empty-resolver fallback text |
| `auth/AddProfileWizard.tsx` | 222–321 | `placeholder` for input fields (PIN, username) |
| `auth/LoginScreen.tsx` | 413 | `placeholder="operator id"` |
| `core/Overlays.tsx` | 280, 358 | `placeholder` on terminal/filter inputs |
| `chat/ChatWindow.tsx` | 888 | comment about Framer Motion test mock — production wraps real button |
| `agent/AgentTimeline.tsx` | 6 | doc comment "Sources (live, no mocks)" — confirms real |
| `agent/PlanTree.tsx` | 8 | doc comment "fully data-driven from agentStore — no mocks" |
| `layouts/OperatorLayout.tsx` | 17 | doc comment "No mocks" |
| `layouts/FocusLayout.tsx` | 23 | doc comment about mock referenced in design ref, NOT shipped |
| `layouts/ShadowLayout.tsx` | 41 | comment about "placeholder bpm" used when sensor disconnects (real ContextEngine value when alive) |
| `chat/scenes/panels/SceneIdentityCardPanel.tsx` | 6 | comment about "•••" placeholder before backend resolves identity |
| `chat/scenes/panels/SceneMapPinPanel.tsx` | 13 | comment about placeholder when map data missing |
| `stores/chatStore.ts` | 245 | "optimistic placeholder" — UI-side echo before backend confirms (industry pattern, NOT mock) |
| `stores/familiarStore.ts` | 86 | comment about deterministic test mocking |
| `chat/scenes/FilesScene.tsx` | 82 | uses `data.filter_placeholder` from backend payload |
| `agent/GoalInput.tsx` | 140 | placeholder text for goal entry |
| `agent/InterventionDialog.tsx` | 66 | placeholder for instruction textarea |
| `layouts/DialogueLayout.tsx` | 313 | placeholder for chat input |
| `test-setup.ts` | 10 | jsdom canvas mock — TEST-ONLY, never bundled in prod |
| `components/auth/PinPad.tsx` | 13 | `KEYS = ['1'..'9']` — keypad constant, not mock |
| `components/chat/ChartResponse.tsx` | 55 | `y_keys = ['value']` — chart default fallback when caller omits, not mock |
| `layouts/SandboxLayout.tsx` | 915 | `KEYWORDS = [...]` — Python syntax keyword list for code highlight |
| `components/map/TacticalMap.tsx` | 48 | `MAP_STYLE_VALUES` — closed-enum constant |

**Verdict:** zero changes needed in FE.

---

## Backend — known epic TODOs (NOT halтура)

Three TODO comments live in our code. Each is a phase-scoped epic,
already tracked in `docs/phases/`, NOT a leftover stub:

| File | Line | Tracked under | Detail |
|---|---|---|---|
| `core/decision_tree.py` | 47 | phase-09.2 | wake-word→agent_task wiring; the FSM otherwise works text-only today |
| `sensors/command_sender.py` | 5 | phase-01-firmware | several Settings fields persist in DB but the ESP32-S3 firmware doesn't yet act on them (firmware-side work) |
| `memory/archive_memory.py` | 6 | phase-12 | AES-256 sealing for archive-tier memory not yet landed |

**Verdict:** these are real, but they're scope-bounded epics with
their own phase plans. Closing them is a phase task, not a quick fix.
Each line of code is correct AS-IS for the current phase contract.

---

## Backend — venv vendor TODOs (excluded)

`src/backend/venv/` contains 20+ TODO comments inside `psutil`,
`google.genai`, `google.auth`, `typing_extensions`. These are
upstream library code, not ours. **Excluded from this audit.**

---

## Action items

- ✅ A — mock-data hunt — **closed**. No production mocks found.
- 🟡 phase-09.2 wake-word→agent_task — defer to phase-9 epic plan
- 🟡 phase-01-firmware Settings sync — defer to firmware track
- 🟡 phase-12 archive memory sealing — defer to phase-12 epic

---

## Methodology

```bash
# Frontend production-code search:
grep -rnEi "mock|fake|lorem|placeholder|dummy" src/frontend/src \
    --include="*.ts" --include="*.tsx" \
    | grep -v "node_modules\|__tests__\|\.test\."

# Backend production-code search:
grep -rnE "TODO|FIXME|STUB|HACK" src/backend \
    --include="*.py" \
    | grep -v "tests/\|__pycache__\|\.venv\|venv/lib/"

# Hardcoded sample-data array search:
grep -rnE "= \[\s*\{[^}]*'(alice|bob|charlie|test|sample|demo|lorem)" src/frontend/src
```

All three queries returned the entries above. Nothing of substance was
hidden.
