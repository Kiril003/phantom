# R1 Coordination Contracts — Sunrise Build

This file is the **single source of truth** for inter-agent shapes during the
2026-04-29 / 2026-04-30 overnight redesign. Every agent reads this before
touching code. Every change to a shape must be reflected here AND in
`src/shared/types/`.

## Branches

- Base: `autonomous-run`
- Each agent works in its **own worktree** (Agent tool `isolation: "worktree"`).
- Each agent commits to its **own branch** (auto-named by harness).
- Lead (Kiril / coordinator) merges branches in the morning.

## Commit subjects

Use one of these prefixes per commit:

- `phase-5-R0-3-*` — design tokens + theme variants
- `phase-5-R1-FE-*` — frontend layout / component overhaul
- `phase-5-R2-BE-*` — tools-as-skills wiring
- `phase-5-R3-BE-*` — identity + sandbox + privacy
- `phase-5-R3-FE-*` — sandbox UI
- `phase-5-VERIFY-*` — orphan / dead-code / DB cleanup
- `phase-5-QA-*` — visual + test sweep findings

## Hard rules (CLAUDE.md ratified)

1. **No mocks. No TODO. No stub returns.** Every file is fully implemented.
2. **Touch targets ≥ 44×44 px.**
3. **UI: 1024×600 strict.** No scroll on primary screens.
4. **Gemini → Ollama fallback** — preserved.
5. **faster-whisper → Vosk fallback** — preserved.
6. **All types in `src/shared/types/`** — both ends import same.
7. **All animations carry meaning** — no decorative loops.
8. **Tests after every commit.** pytest backend, vitest + tsc frontend.

## Design DNA (sunrise-warm theme — already shipped)

Tokens in `src/frontend/src/styles/tokens.css` (commit `35272a8`).
Helpers in `src/frontend/src/styles/globals.css`.
Reference HTML/JSX prototypes in `docs/design-handoff/` and
`docs/design-handoff/batch-2/`.

Two more themes ship with this redesign:

- `data-theme="sunrise-warm"` (default, bright cream + amber)
- `data-theme="amber-night"` (deep warm-dark, amber accents — owned by THEME-NIGHT agent)
- `data-theme="cyberdeck-cold"` (legacy dark slate, opt-in)

## Shared schemas

### `ChatScene` payload (BE → FE inline render)

```ts
type ChatScene =
  | { kind: "timer";        data: TimerSceneData }
  | { kind: "alarm";        data: AlarmSceneData }
  | { kind: "calendar";     data: CalendarSceneData }
  | { kind: "files";        data: FilesSceneData }
  | { kind: "audit";        data: AuditSceneData }
  | { kind: "wardriving";   data: WardrivingSceneData }
  | { kind: "location";     data: LocationSceneData }
  | { kind: "checkpoint";   data: CheckpointSceneData }
  | { kind: "sandbox";      data: SandboxSceneData };
```

Owner: shared types — FE-SCENES + BE-TOOLS jointly extend
`src/shared/types/chat.ts` `ChatMessage.scene?: ChatScene`.

### Tool execution result (BE)

```ts
interface ToolResult {
  tool: string;            // canonical id, e.g. "timer.create"
  ok: boolean;
  scene: ChatScene | null; // rendered inline in chat if set
  summary: string;         // one-line text fallback
  audit_id: string;        // ULID
  error?: string;
}
```

Owner: BE-TOOLS — `src/backend/ai/tool_executor.py` returns this shape.

### Identity confidence (BE → FE + auth)

```ts
interface IdentityResolution {
  user_id: string;
  confidence: number;                 // 0..1
  modalities: ("voice"|"face"|"rfid"|"context")[];
  rejected: boolean;                  // confidence < 0.65
  reasons: string[];                  // why each modality contributed
}
```

Owner: BE-IDENTITY — extends `src/backend/voice/identity_resolver.py`.

### Sandbox stream WS event (BE → FE)

```ts
type SandboxEvent =
  | { type: "session.started";   session_id: string; root: boolean }
  | { type: "plan.step";         session_id: string; step_id: string; status: "pending"|"running"|"done"|"failed"; text: string }
  | { type: "plan.thought";      session_id: string; text: string }
  | { type: "stdout.line";       session_id: string; line: string; severity?: "info"|"warn"|"error" }
  | { type: "stderr.line";       session_id: string; line: string }
  | { type: "process.completed"; session_id: string; exit: number; duration_ms: number }
  | { type: "session.killed";    session_id: string; by: "operator"|"timeout" };
```

Owner: BE-SANDBOX — emits over multiplexed WS channel `sandbox.<session_id>`.
FE-SANDBOX renders.

### Settings theme picker

`src/shared/types/settings.ts` adds:

```ts
interface ThemeSettings {
  active: "sunrise-warm" | "amber-night" | "cyberdeck-cold";
}
```

Owner: THEME-NIGHT — wires the picker into Settings › Theme group and applies
`<html data-theme="…">` from `App.tsx` on user change.

## File scope per agent (no overlapping writes)

| Agent | Owns these paths |
|---|---|
| FE-AUTH | `src/frontend/src/components/auth/**`, `src/frontend/src/screens/LoginScreen.tsx` |
| FE-CORE | `src/frontend/src/components/core/{StatusBar,FloatingToolbar,Overlays}.tsx` |
| FE-LAYOUTS-1 | `src/frontend/src/layouts/{ShadowLayout,FocusLayout,DialogueLayout}.tsx` |
| FE-LAYOUTS-2 | `src/frontend/src/layouts/{SentinelLayout,MapLayout,OperatorLayout}.tsx` |
| FE-SANDBOX | `src/frontend/src/layouts/SandboxLayout.tsx` (new), `src/frontend/src/components/settings/SettingsPanel.tsx` |
| FE-SCENES | `src/frontend/src/components/chat/scenes/**`, `src/shared/types/chat.ts` (additive only) |
| BE-TOOLS | `src/backend/ai/tool_executor.py`, `src/backend/tools/**`, `src/backend/api/routes_tools.py` |
| BE-SANDBOX | `src/backend/linux/**`, `src/backend/api/routes_linux.py` |
| BE-IDENTITY | `src/backend/voice/identity_resolver.py`, `src/backend/security/auth.py`, `src/backend/memory/strategic_memory.py` (privacy fix only) |
| THEME-NIGHT | `src/frontend/src/styles/tokens.css` (additive), `src/shared/types/settings.ts`, theme picker in `SettingsPanel` |
| VERIFIER | `scripts/cleanup_test_users.py` (run --apply), `docs/audit-2026-04-30-verifier.md` |
| QA-VISUAL | `docs/audit-2026-04-30-visual.md`, `docs/screenshots/2026-04-30/**` |
| QA-TESTS | `docs/audit-2026-04-30-tests.md` (small fixups OK in any path) |

## Common workflow per agent

1. Read this file + `CLAUDE.md` + `phantom-os/CLAUDE.md` + your own scope's
   current state.
2. Read the matching design prototype in `docs/design-handoff/` or
   `docs/design-handoff/batch-2/`.
3. Implement in your scope. Keep call-sites stable; preserve Zustand
   selectors, props, and existing API contracts.
4. Run scoped checks:
   - FE: `cd src/frontend && npx tsc --noEmit && npx vitest run --no-coverage`
   - BE: `cd src/backend && .venv/bin/python -m pytest -x -q`
5. Commit atomically with one of the prefixes above.
6. Return a short summary listing files changed, commits made, anything
   you couldn't finish, and any contract you needed to extend.
