# PHANTOM OS — Autonomous Day 4 Charter (2026-05-01)

**Baseline**: `b26a27f` (`autonomous-day-2026-04-30-acceptance` /
`v0.19.0-jarvis-online`).
**Branch**: `autonomous-run`.
**Target tag**: `v0.20.0-living-os` (and `autonomous-day-2026-05-01-acceptance`).

---

## 1. Operator charter (post-/compact directive — verbatim intent)

The operator's Day-4 ask reframes PHANTOM as a **living, multi-modal,
sandboxed, identity-aware desktop OS** rather than a chat-bot wearing a
React skin. The non-negotiables extracted from the directive:

1. **Feel alive** — chat answers must arrive as composed visual scenes
   (animated, situational), not raw bubbles. The system "talks back" with
   the room, not at the user.
2. **Multi-task in parallel without losing tempo** — long-running tasks
   (day / week / month horizon) must keep advancing while the operator
   chats about something else.
3. **Self-driving system controller** — agent toggles its own subsystems
   (state, voice, vision, tools) without operator handholding.
4. **Sandboxed agentic execution** — like Claude Code / Antigravity, but
   visual-and-clickable, fully autonomous to "done", with internal sub-agents
   (sequential or parallel) cooperating per task.
5. **Cross-platform native shell** — compile to a single signed executable
   for Linux *and* Windows (Tauri target), runnable as a normal app.
6. **AI Hub** — a first-class panel routing work between the local NPU,
   the local CPU/GPU model, and remote APIs (Gemini, OpenAI keys), with
   automatic capability-aware dispatch.
7. **Identity layer** — recognise *who* is speaking, remember per-user
   facts (email, IDs, file references, preferences), respond in their voice,
   add new identities online.
8. **Card-based structured input** — replace freeform text fields with
   typed cards (model picker, contact card, file card, ID card, etc.) so
   the operator clicks rather than types.
9. **Environmental I/O as native** — Bluetooth + Wi-Fi + raw serial ports
   become first-class agent tools (analyse, configure, control), not
   bolted-on scripts.
10. **Maps + 1000+ features** — the geo layer expands from "tactical map"
    into a richer surface (more layers, denser interactions, animated cues).
11. **Auto-everything** — fewer text inputs, more inferred dropdowns
    (e.g., "model" → enumerated picker, not freeform).
12. **Visual debug surface** — when the agent writes code/scripts, the
    operator sees clickable preview, runs in sandbox, iterates without
    leaving the app.

The operator labelled this scope **"million-dollar product"**. It is
**deliberately bigger than one day**. Day 4 ships the *foundation* and
the most operator-visible items; Day 5–7 build on that foundation.

---

## 2. What ships on Day 4 (v0.20.0-living-os)

| Block | Scope | Tier | Hard cutoff |
|---|---|---|---|
| **U** | 8-perspective audit baseline against the new charter — produces `docs/audit-2026-05-01-day4/FINDINGS.md` | All-tier | block-level |
| **V** | Tauri shell skeleton + cross-platform packaging recipe (Linux .AppImage + Windows .exe wrapper) | Tier-A foundation | end of V |
| **W** | Animated chat cockpit redesign — `<ChatScene>` composer + 6 scene presets (text, list, map-pin, plan, code-preview, identity-card); chat WebSocket payload extended with `scene` envelope (back-compat with bubble fallback) | Tier-A UX | end of W |
| **X** | Internal multi-agent orchestrator skeleton — `agents/orchestrator.py` with sequential + parallel sub-agent dispatch, scoped to read-only catalog, results merged into a single chat-scene answer; CONTROL: `chat_orchestrator_enabled` (default off) | Tier-A capability | end of X |
| **Y** | Subprocess sandbox closure (carry-over D3-F-58) — `bwrap`/`unshare` wrap of `linux/executor`, drop-net flag, bind-RO root, `realpath` workspace check (D3-F-40 too) | Tier-A security | end of Y |
| **Z** | AI Hub backend skeleton — `ai/hub.py` capability registry (NPU/CPU/Gemini/Ollama/OpenAI), routing policy per task class, telemetry per provider; UI placeholder card (Settings → "AI Hub") | Tier-B capability | end of Z |
| **AC** | Day-4 capstone — full pytest green, `pytest -q` count delta, README + OPERATIONS update, tag `v0.20.0-living-os` + `autonomous-day-2026-05-01-acceptance` | Capstone | block-level |

### Explicitly deferred to Day 5 (v0.21.0-personalised)

- **AA** — Identity/speaker ID layer (needs voice-pipeline rework).
- **AB** — Durable long-running task scheduler (needs APScheduler / SQL store + worker isolation; spec only on Day 4).
- **W-2** — Card-based structured input library (Day 4 ships scenes; cards next).
- **Maps 1000+ features** — Day-4 audit must produce a feature backlog;
  shipping happens on Day 6.
- **BT/Wi-Fi/port full surface** — Day-4 only ships the *catalog stub*
  (no actual radio control yet — needs a privileged daemon split).

### Explicitly deferred to Day 6 (v0.22.0-environment)

- Bluetooth control plane (BlueZ over D-Bus, paired-device tools)
- Wi-Fi management (`nmcli`/`iwd` D-Bus tools, scan→tools)
- Serial port catalog + per-port permission cards
- Speaker-recognition encoder (Resemblyzer / pyannote)
- Per-user voice profile + targeted TTS reply

---

## 3. Audit perspectives (Block U)

Eight reviewer agents run **in parallel** against `b26a27f` + this
charter. Each reviewer reads the charter section above plus its own
slice of the codebase and writes a section to
`docs/audit-2026-05-01-day4/FINDINGS.md` with severity-tagged findings.

| # | Perspective | Focus | Key questions |
|---|---|---|---|
| 1 | **SaaS UX** | Chat surface, settings density, onboarding | Where does the current bubble chat fight the "alive scene" charter? Which settings need card-pickers vs text? |
| 2 | **Animation/Visual** | Frame budget, scene composition, motion language | Can `<ChatScene>` re-use Framer Motion stagger? What's the perf budget at 1024×600? Where do current animations decorate vs inform? |
| 3 | **Multi-agent orchestration** | Sub-agent boundaries, parallelism, result merge | What's the max safe parallelism? How do scoped read-only catalogs prevent prompt-injection escalation across agents? |
| 4 | **Sandbox/security** | Subprocess isolation, network drop, FS bind | F-58 closure plan: bwrap vs unshare vs nsjail? How does it interact with `linux/executor` env passthrough? |
| 5 | **Cross-platform packaging** | Tauri vs Electron vs PyInstaller | Which surfaces (FastAPI, ChromaDB, NPU bins) survive Windows? What's the asset-bundling cost? |
| 6 | **Identity/personalization** | Speaker ID, per-user model, RBAC delta | What's the minimal Day-5 prerequisite that Day-4 must NOT break? Where does `user_model` already track per-user prefs? |
| 7 | **Long-running tasks** | Durability, recovery, observability | Does the existing `agent/proactive` cycle counter (D3-D-2) already give us a substrate? What does APScheduler buy vs hand-rolled? |
| 8 | **Performance / "alive" feel** | E2E latency budget, idle-tick load, NPU utilisation | Where is the chat→render p50 today? What's the budget after scenes (more JS work)? Where does NPU sit idle? |

---

## 4. Hard rules (carried from Day-3)

- Atomic commits with audit-finding ID in the message subject.
- `pytest -q` (backend) + `npm run typecheck && npm run build` (frontend)
  green at every commit boundary.
- ChromaDB drift restored before each commit (`git checkout -- src/backend/chroma_data/chroma.sqlite3`)
  *unless* the commit explicitly migrates schema.
- `memory/active_day_plan.md` updated after each commit.
- No mocks/TODOs/stubs in product code (CLAUDE.md non-negotiable).
- Every new config key reachable from Settings UI (auto-render `CATEGORY_SPEC`).

---

## 5. Block sequence (planned)

```
U (audit, ~45 min)
  → V (Tauri skeleton, ~90 min)
    → W (chat scenes, ~120 min)
      → X (orchestrator, ~90 min)
        → Y (sandbox closure, ~60 min)
          → Z (AI Hub backend, ~75 min)
            → AC (capstone, ~45 min)
```

Each block must produce ≥ 1 atomic commit and update this file's
"Current position" section (added at end of Block U) before the next
block starts.

---

*Charter authored 2026-05-01 06:00 CEST, immediately after
`v0.19.0-jarvis-online` shipped. Source-of-truth path:
`memory/active_day_plan.md` will pivot from DAY3 to this file at the
first Block-U commit.*
