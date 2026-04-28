# Cross-Context ADRs (Day-4 Phase 2)

These 9 ADRs codify wire contracts between context boundaries. Each
mirrors a row in `docs/PHASE1_DEPENDENCY_GRAPH.md §"Cross-context
contracts"`. Implementation lives inside the cluster ADRs; this file
is the single-source-of-truth for the *contract shape* itself.

---

## ADR-XC-001 — `chat-orchestrator` → `ai-hub`: `hub.pick` contract

**Decision**: chat-orchestrator's `sub_agent.run_leaf` calls
`hub.pick(task_class="chat_subtask")` (NOT `ai_router.generate`
directly). Hub returns a `ProviderHandle`; sub-agent calls
`handle.generate(...)`.

**Why**: single integration seam (Z-4) so Day-5 hub auto-routing
upgrades benefit all sub-agents without touching orchestrator.

**Day-4 reality**: `chat_orchestrator_enabled=False` default —
contract is exercised only when both Z-1 and X-1 land. Z-4 is the
explicit Wave-2 cleanup block that wires the call.

**Negative**: orchestrator MUST NOT bypass Hub by calling
`ai_router.generate` directly — even on Hub failure, it falls back
to single-turn `chat_pipeline.run` (which legitimately uses
`ai_router`).

**Owners**: ADR-ORC-001 (orchestrator side), ADR-HUB-001 (hub
side), ADR-HUB-006 (the integration seam).

---

## ADR-XC-002 — `chat-scenes` → `speaker-id-foundation`: `ScenePanel.identity-ref`

**Decision**: `ScenePanel{ kind: 'identity-ref', data: { speaker_id:
string | null, label: string } }` is the wire shape for
identity-card scene preset.

**Day-4 reality**: `speaker_id` is always `null` Day-4 (resolver
is no-op per ADR-ID-002). Scene preset must render gracefully with
null — falls back to "Unknown speaker" label.

**Day-5 plug**: when ML resolver lands, the same `ScenePanel`
shape carries a real ULID; Frontend maps to `UserPicker`-style
avatar via existing GET `/api/auth/users/picker` route (ADR-IDB-003).

**Owners**: ADR-CS-001 (scene composer), ADR-ID-001 (speaker_id
field), ADR-IDB-003 (picker route reuse).

---

## ADR-XC-003 — `chat-scenes` → `standing-orders-harden`: `ScenePanel.plan-step`

**Decision**: `ScenePanel{ kind: 'plan-step', data: { order_id:
string, title: string, status: 'pending'|'firing'|'done'|'skipped',
last_event_ts: number } }`.

**Source**: WS subscription to `event_bus` topic
`standing_order.tick` / `standing_order.fired` /
`standing_order.skipped` (ADR-SOH-005). Frontend maintains a local
Map<order_id, panel_state>; scene with `kind: 'plan'` renders as a
list of `plan-step` panels.

**Day-4 reality**: scene preset `plan` lands minimal — just
`plan-step` panels in a vertical list with status pill. Animated
"firing" pulse uses `phantomVariants.pulse` (ADR-CP-001).

**Owners**: ADR-CS-001, ADR-SOH-005.

---

## ADR-XC-004 — `user-facts` → `crypto-primitive`: `encrypt_pii` contract

**Decision**: every value written to `UserFact.value_encrypted`
goes through `security.crypto.encrypt_pii(plaintext)` first; every
read goes through `decrypt_pii(token)`. ORM does NOT auto-encrypt
— explicit at the route handler.

**Why explicit**: ORM-level encryption hides the key-rotation
failure mode; Day-4 wants `InvalidToken` to bubble up as a 500
with operator-visible audit row, not a silent "row corrupted" log.

**Day-5 evolution**: Day-5 may add a SQLAlchemy `TypeDecorator`
that does both transparently — but only after operational
experience with Day-4 explicit pattern.

**Owners**: ADR-CRP-001/002, ADR-FCT-001/002.

---

## ADR-XC-005 — `sandbox-runtime` → `radio-capabilities-reserved`

**Decision**: `SandboxProfile.radio_privileged` is a real enum
value Day-4. `wrap_argv(argv, SandboxProfile.radio_privileged,
ctx)` raises `NotImplementedError("radio profile lands Day-6")`
with a clear message.

**Why a hard raise**: silent fallback to compute would let Day-6
work accidentally inherit `--share-net=no`, locking out
`bluetoothctl`/`iw`/`hciconfig`. Loud failure is safer.

**Day-6 contract** (frozen): the profile will spawn a
`phantom-radiod` UNIX-socket daemon at `/run/phantom/radiod.sock`
with MCP-stdio-compatible JSON-RPC; sandbox client routes through
that socket, not directly through `bwrap`.

**Owners**: ADR-SBX-002 (enum), ADR-RAD-001 (Day-6 contract).

---

## ADR-XC-006 — `desktop-shell` → `runtime-perf`: `/readyz` contract

**Decision**: `/readyz` returns 200 after **G2** (parallel warm
group) completes — voice models loaded, Chroma reachable, MiniLM
warm. NOT after G1 alone. This ties Tauri sidecar splash duration
to actual readiness, not minimal HTTP availability.

**Why**: if `/readyz` returned 200 after G1 (~800 ms), Tauri
WebView would attempt to connect WS at 800 ms, but voice would
still be cold for 2-4 s. User sees "broken voice button" on first
use. Honest 2.5-4.5 s splash > broken first impression.

**Hatch**: `?fast=1` query param returns 200 after G1 only —
useful for `docker healthcheck` where probe rapidity matters more
than UX. Tauri does not use this.

**Owners**: ADR-DSH-001 (Tauri sidecar), ADR-RTP-001 (lifespan
gather groups).

---

## ADR-XC-007 — `chat-input` → `dynamic-source-picker`: `DynamicPicker` reuse

**Decision**: the `<DynamicPicker source="ollama_models" />`
component (Settings UI consumer per ADR-DSP-002) is also the body
of `<ModelCard>` inside chat input drawer (W-3 Day-4 stub).

**Why**: one fetch+offline-fallback+44×44px primitive, zero
duplicate. Day-5 card library (ContactCard/FileCard/IDCard) will
follow the same pattern with `source` discriminators.

**Wire**: `<ModelCard onPick={(value) => insertCardToken(value)}>`
wraps `<DynamicPicker source="ollama_models" />`. Insert format
is a JSON sidecar attached to the `/chat` POST body's `cards: [{
type: 'model', value: 'gemma:4-27b' }]` field — NOT inline DOM
mention pill (per ADR-CI-001 sidecar decision).

**Owners**: ADR-CI-001 (chat input drawer), ADR-DSP-002 (picker).

---

## ADR-XC-008 — `standing-orders-harden` → `profile-cards`: notify-card shape

**Decision**: `NotifyAction{ title, body, target_user_id?:
string }` (ADR-SOH-003) is rendered by an
incoming-`standing_order.fired` event into a chat-scene with
`kind: 'plan-step'` AND a sidebar toast. The toast also surfaces
on Tauri tray (Day-4 best-effort; falls back to WS in-app toast
when D-Bus carve-out unavailable per ADR-SBX-005).

**Day-4 minimum**: chat-scene plan-step renders the title+body
inline; tray-toast deferred to Day-5 (Tauri allowlist additions
only — no `notify-send` dependency in Day-4 desktop ship).

**Owners**: ADR-SOH-003 (NotifyAction), ADR-CS-001 (scene
plan-step), ADR-SBX-005 (notify D-Bus carve-out — used by
`agent.actions.notify`, NOT by standing-orders directly).

---

## ADR-XC-009 — `chat-orchestrator` → `sandbox-runtime`: NO-EXEC chat path (NEGATIVE ADR)

**Decision**: chat-side modules under `ai/chat_pipeline.py` and
`ai/agents/**` MUST NOT import `agent.actions/runtime/proactive/standing_orders/mcp`.
This is enforced at CI by ADR-IGD-001 import-gate AST test.

**Why a negative ADR**: orchestrator could be tempted to "just
add bash.run as a tool" for "developer mode"; that path is the
laundering hop the threat model TM-17B-E4 explicitly forbids.
Day-4 keeps orchestrator data-only — every "tool" goes through
`chat_tool_dispatcher` (5-name read-only catalog).

**Day-5 evolution**: introducing exec capabilities to chat would
require: (a) new `SandboxProfile` value AND (b) IPC over the
`phantom-radiod`-style socket pattern (NOT direct subprocess) AND
(c) operator opt-in flag with distinct lifespan refusal pattern.
Until then — NO.

**Owners**: ADR-ORC-001/002 (orchestrator scope), ADR-IGD-001 (CI
gate), ADR-SBX-002 (sandbox profile).

---

## Phase-3 readiness implications

These cross-context ADRs are **Phase-3 Wave 2 enabling contracts**.
Wave 1 blocks (foundation: CRYPTO-1, V-2/3/4, W-1/2b, X-3, Y-4,
T-4, ID-1/2/3, IDB-1) do NOT depend on cross-context wires —
Wave 1 is intentionally chosen to be cross-context-clean.

Wave 2 blocks consume these contracts:
- W-2 (ChatScene) consumes ADR-XC-002 + XC-003.
- FACTS-1 consumes ADR-XC-004.
- V-1 (Tauri scaffold) consumes ADR-XC-006.
- W-3 (chat input drawer) consumes ADR-XC-007.
- T-3 (event_bus) emits per ADR-XC-008.
- Z-4 (orchestrator-Hub seam) consumes ADR-XC-001.
- X-3 (import-gate) enforces ADR-XC-009.
- Y-1 (SandboxProfile) reserves per ADR-XC-005.

If cross-cutting reviewers (PHASE2_INTEGRATION_RISKS / SECURITY /
PERF) surface a contract conflict, it lands as a `Critical`
blocker on the originating ADR — Phase 3 does not start until
resolved.
