# PHANTOM Agent Ascension — Design Spec

- **Date:** 2026-05-16 (autonomous overnight run — operator asleep, full delegation)
- **Branch:** `companion-v2-phase-0`
- **Status:** Self-approved under explicit autonomous mandate ("все на тобі",
  "цілу ніч", "до ідеалу"). Brainstorming discipline applied solo
  (decompose / YAGNI / isolated units); interactive approval gate
  overridden by direct user instruction (using-superpowers priority #1).
- **Author:** orchestrator (Opus) from Explore recon digest 2026-05-16.

## 1. Problem & Goal

Operator wants the **Агент** to be a conversational, limitless,
command-executing assistant **strictly better than Claude Code in
everything**, with "divine-level execution/creation and logic
uncharacteristic of any AI tool today." Recon shows the differentiators
already exist (persistent lessons, Will, Council, missions, vision,
ESP32, self-introspection) but five concrete gaps make it feel "ну так
собі":

1. **No true conversation with the agent** — goal submission is a
   one-shot text field; `ParallelChatDrawer` is stateless, memory-thin,
   loses history on close. (CRITICAL — core "better than Claude Code".)
2. **Hard caps make "limitless" a fiction** — `agent_max_actions_per_task
   =20`, `agent_max_llm_calls_per_task=50`, background=10, no UI, no
   unbound mode.
3. **ParallelChat is a hollow shell** — no ChromaDB recall, no lessons,
   no observations, no tools, no persistence.
4. **PlanEditor is dead UI** — fully implemented backend+component, never
   wired to a trigger.
5. **AGENT_INTERNALS.md doc drift** — documents pre-reorg module paths.

Plus operator Q1: **progressive artifact render** ("бачити що він
створює", Claude-style sequential reveal) — the deferred ArtifactStudio
follow-up.

And the flagship ask: a **novel cognition capability no other AI tool
has** ("логіку що непритаманна ніодному ші інструменту").

## 2. Decomposition (independent verticals, leverage-ordered)

Each vertical is a self-contained spec→plan→TDD→review→commit cycle.
Ordered so partial completion still ships the highest value. Quality bar
(non-negotiable, project rules): no mocks/TODO/stubs in product code;
dense, minimal comments; tests after each task; atomic targeted commits
(NEVER `git add -A` — the working tree has 196 uncommitted refactor
files that are NOT ours); every config exposed in Settings UI.

| # | Vertical | Leverage | Independent | Est |
|---|---|---|---|---|
| **V1** | Limitless execution: caps → config + Settings UI + **unbound mode** (0 = ∞), parametrized bash timeout/output | Highest, literal ask | Yes | S |
| **V2** | True conversational agent mode: stateful memory-backed `/agent/chat` (ChromaDB recall + lessons + live observations + inner monologue) with **tool use** + WS streaming + persisted thread; ParallelChatDrawer → store-backed, streaming, reasoning-visible | Highest, core UX | Yes | L |
| **V3** | Progressive artifact render: ArtifactStudio emits phase events (draft→critiquing→polishing→done) over WS scene channel; panel reveals progressively (Q1) | High, operator-requested | Yes (builds on shipped studio) | M |
| **V4** | Self-synthesizing capability (flagship "divine logic"): when no registered action fits a goal, the agent authors → sandbox-tests → registers → uses → **persists** a new action, with lesson integration | Flagship differentiator | Yes (uses existing registry+sandbox+lessons) | L |
| **V5** | Wire PlanEditor + OPERATOR-screen declutter (conversation-primary) | Medium UX polish | Yes | S |
| **V6** | AGENT_INTERNALS.md doc-drift fix + final integration sweep | Correctness | Yes | S |

Execution order: V1 → V6 → V2 → V3 → V5 → V4 (cheap correctness first to
de-risk, then highest-leverage UX, flagship last as it's the most
ambitious and benefits from the rest being stable). If the night runs
short, V1–V3 alone deliver the operator's primary asks.

## 3. Per-Vertical Design

### V1 — Limitless execution
`config.py`: `agent_max_actions_per_task`, `agent_max_llm_calls_per_task`,
`agent_max_llm_calls_per_background_task`, `agent_bash_timeout_s`,
`agent_bash_output_cap_bytes` — all keep current defaults but `0` (or
`<=0`) now means **unbound**. `kernel/loop.py` + `actions/bash.py`:
treat `<=0` as no cap (no `while count < cap` stop; no `wait_for`
timeout; no output truncation). New `config.agent_unbound_default: bool
= False`. Settings UI: an "Агент / Межі" group with numeric inputs +
an "Безмежний режим" master toggle that zeroes the caps. Tests: loop
honors cap; `0` → no stop after N>cap; bash honors `0` → no truncation;
Settings group renders + persists. **Safety mechanisms (sandbox/risk
gate/`unsafe_mode`) are untouched** — this lifts *quotas*, not the
operator-controlled safety switch that already exists.

### V2 — Conversational agent mode
New SQLite table `agent_chat_thread(id, task_id, role, content,
created_at)` via SQLAlchemy model + migration-on-startup (existing
pattern). `routes_agent.parallel_chat` becomes a real loop:
load last N thread turns + `recall(message,k=5)` + `recall_lessons(
message)` + `state.observations[-20:]` + current inner-monologue/substate
→ build a rich agent-voice prompt → run through the **tool-use pipeline**
(reuse `ai.chat_pipeline`/`chat_tool_dispatcher` so the agent can DO
things in conversation, gated by the same dispatcher) → stream tokens +
tool events over the existing agent WS channel → persist both turns.
Frontend: `agentStore` owns `agentChat: {threadId, messages[],
streaming}`, survives drawer close; `ParallelChatDrawer` renders
streaming text, tool-call chips, and a header strip with live
substate/monologue. Endpoint stays `POST /api/v1/agent/chat` (back-comp:
still returns final `{reply}` for non-WS callers). Tests: thread persists
across calls; recall+lessons+observations injected; tool call dispatched;
WS stream emitted; store survives remount.

### V3 — Progressive artifact render
`ai/artifact_studio.build_artifact` gains an optional `on_phase:
Callable[[str,str|None],Awaitable]` — emits `("draft",html)`,
`("critiquing",None)`, `("polishing",html)`, `("done",html)`. The
chat/agent path passes a callback that broadcasts a
`scene.artifact.progress` WS event `{phase, htmlPreview?}`. `Scene
ArtifactPanel` subscribes: shows a phase-labelled shimmer + live HTML
preview swap on each phase, settling on `done`. Ephemeral, no schema
break (additive WS event; final scene unchanged). Tests: callback fired
in order; WS events shaped; panel renders each phase; absent callback =
current behavior (regression).

### V4 — Self-synthesizing capability (flagship)
New action `SynthesizeCapability` + `kernel`/cognition helper: when the
planner's chosen step has no matching registered Action (or an explicit
`synthesize_capability` step), the agent (a) drafts a Python Action
subclass via a focused LLM prompt against the real `BaseAction` ABC,
(b) runs it in the **existing bwrap sandbox** against a generated smoke
test, (c) on green, registers it into the live `ActionRegistry` for the
session AND persists the source under `agent/actions/_synth/` + a lesson
("capability X synthesized for goal class Y"), (d) the planner can now
pick it. Bounded: max `config.agent_synth_max_per_task` (default 3),
sandbox-only execution, ROOT-trust device (operator explicitly mandated
limitless on his own hardware). This is the "logic uncharacteristic of
any AI tool" — a self-extending, persistent toolset fused with the
lesson loop. Tests: synth→sandbox-test→register→reuse; failure rolls
back (not registered, lesson records the failure); per-task cap.

### V5 — PlanEditor wire + declutter
Add an "✎ План" button (AgentCommandCenter) → `setPlanEditorOpen(true)`.
On the OPERATOR screen, demote always-on telemetry: collapse `AgentVitals`
+ `Tape` to peek strips, make the conversational surface (V2 drawer
expandable to a center column) primary. Behind `config.ui_agent_layout
= 'conversation' | 'telemetry'` (default conversation). Tests: button
opens editor; layout toggle; collapsed strips render.

### V6 — Doc drift + sweep
Rewrite `AGENT_INTERNALS.md` module paths to `cognition/kernel/
operations`; add a "Conversational Mode" + "Self-Synthesis" section.
Final cross-vertical pytest+vitest+tsc sweep; backend-restart caveat
documented (live singletons: provider/router/config — operator restarts).

## 4. Cross-cutting

- **Data flow:** all new realtime rides the existing agent WS channel
  (no new transport). Persistence reuses the SQLAlchemy async engine.
- **Error handling:** every new path degrades to current behavior on
  failure (no dead UI, no regression) — same discipline as ArtifactStudio.
- **Testing:** TDD per task; deterministic provider stubs; no live model
  in unit tests; final sweep before report.
- **Restart:** changes to config/provider/router/personality need a
  backend restart (no `--reload`); chat_pipeline lazy per-request. The
  morning report states exactly what needs a restart.

## 5. Non-Goals (YAGNI)

- chat_orchestrator parallel-K (separate gated effort, agent-orchestration.md).
- Touching the 196-file companion-v2-phase-0 refactor.
- Removing/weakening safety *mechanisms* (only quota caps become
  operator-configurable; sandbox/`unsafe_mode` stay as the existing
  operator switch).
- Visual redesign beyond V5 declutter.
- Anthropic/Claude provider, chat-model swap.

## 6. Acceptance

Per vertical: its tests green + existing agent/chat/scene suites green +
tsc clean + atomic committed. Night success = V1–V3 + V6 fully shipped
and ≥1 of V4/V5; flagship V4 shipped if time permits. Morning report:
per-vertical status, commits, what needs a restart, honest partials.
