# Arbitrary Artifact Widgets — Design Spec

- **Date:** 2026-05-16
- **Branch context:** `companion-v2-phase-0`
- **Status:** Approved design — ready for implementation plan
- **Author:** brainstorming session (operator: Kiril, ROOT)

## 1. Problem & Goal

PHANTOM chat renders only a closed, typed catalog of ~8 widget kinds
(`text, list, map-pin, plan-step, code-preview, identity-card, chart,
diagram`). When a situation needs something the catalog cannot express,
the AI falls back to plain text. The operator wants a Claude-artifacts-
class escape hatch: the model can generate an **arbitrary, self-
contained, interactive, animated widget** when the standard widgets are
not enough — without weakening the platform's existing security model.

This spec covers **only** the arbitrary-generation path. Expanding the
standard catalog (the "Part A" option) is explicitly out of scope.

## 2. Decisions (locked during brainstorming)

| Decision | Choice |
|---|---|
| Scope | Arbitrary generation only (no standard-catalog expansion) |
| Capability boundary | Full: artifact may **read** curated PHANTOM data **and** request **actions** |
| Execution / consent | Visual auto-renders; every action is brokered through the **existing** `chat_tool_dispatcher` gate (SAFE auto-runs; MEDIUM+/dangerous raise the same tap-confirm the normal chat path uses today) |
| Lifecycle | Ephemeral by default (lives in session history as a scene); optional "save as tool" promotes it into the existing `studio` card catalog |
| Render surface | PHANTOM device 1024×600 only (React+Vite frontend). Mobile companion is a separate future effort |
| Architecture | Approach 1 — sandboxed `<iframe srcdoc>` + `postMessage` broker |

## 3. Threat Model

The threat is **not** an untrusted user (the device and hardware are the
operator's, ROOT trust). The threat is **untrusted model output**: a
hallucinating or prompt-injected provider (Gemini/Ollama) emitting a
malicious or buggy artifact that executes in the operator's privileged
session. Mitigations are layered in §6.

## 4. Architecture & Data Flow

No new transport. The artifact rides the existing scene channel:

```
Model picks respond_artifact(html, title, capabilities[])
  → response_formatter.parse_function_call
      maps respond_artifact → form "artifact"
      validates (size cap, capabilities ⊆ allowlist)
      emits scene panel {kind:'artifact', data:{html,title,caps}}
      via existing build_scene_envelope / _FORM_TO_SCENE_KIND path
  → routes_chat._serialize_message lifts the single scene attachment
      to top-level message.scene  (closed: one scene per message)
  → frontend SceneComposer switch gains one `case 'artifact'`
  → SceneArtifactPanel.tsx mounts a locked-down <iframe srcdoc>
  → artifactBroker.ts mediates postMessage read/action requests
```

Verified integration seams:
- `src/backend/api/routes_chat.py:133` — scene rides as one
  `attachment type:'scene'` → promoted to `message.scene`.
- `src/frontend/src/components/chat/scenes/SceneComposer.tsx:92` —
  exhaustive `switch(panel.kind)` over the 8 current kinds.
- `src/backend/ai/chat_tool_dispatcher.py:124` — `dispatch(...)`; `:302`
  `supported_tools()`. Reused as the action gate.
- `src/backend/agent/studio/models.py` + `/studio/cards` — reused for
  "save as tool"; no new persistence subsystem.

## 5. Component Design

### 5.1 Backend

**`ai/response_formatter.py`**
- Add `respond_artifact` to `RESPONSE_FORM_TOOLS`. Function-call params:
  - `html: str` — the self-contained document.
  - `title: str` — operator-facing label.
  - `capabilities: list[str]` — subset of the closed allowlist
    `{"read:context", "read:sensors", "read:memory", "read:state",
    "action:tools"}`.
- `_FORM_MAP["respond_artifact"] = "artifact"`.
- `_FORM_TO_SCENE_KIND["artifact"] = "artifact"`.
- `parse_function_call` branch: validate `len(html) <= ARTIFACT_HTML_CAP`
  (config, default 64 KB) and `set(capabilities) <= ALLOWLIST`. On
  violation or `config.chat_artifacts_enabled is False`, degrade
  `respond_artifact → "text"` (same pattern as the existing
  `respond_alarm → text` hallucination-safety alias). On success, emit
  `{type:'artifact', data:{html, title, capabilities}}` panel.

**`api/routes_chat.py`**
- New thin endpoint `POST /chat/artifact-action` — accepts
  `{tool, args}` (+ auth, same `get_user_or_device_user` dependency as
  `/chat/message`), forwards verbatim to
  `chat_tool_dispatcher.dispatch(tool, args, user_id=…, db=…)`, returns
  its `{ok, result|error}`. It adds **no** privilege: it is a proxy so
  the iframe never holds a dispatcher reference. All existing
  permission/dangerous-pattern/confirm/audit behaviour of the dispatcher
  applies unchanged.

**`config.py`**
- `chat_artifacts_enabled: bool = True` (kill switch, settings-exposed
  per project rule "all config from UI").
- `chat_artifact_html_cap_bytes: int = 65536`.

No backend artifact-broker module: the broker is frontend-only; the
backend only validates + packages + proxies actions.

### 5.2 Shared types

**`src/shared/types/chat.ts`** — documented ADR amendment (the file's
own header mandates this path for new kinds; no stringly-typed
backdoors):
- Extend `SceneKind` and `ScenePanelKind` with `'artifact'`.
- Add `ScenePanel` arm:
  `{ id: string; kind: 'artifact'; data: { html: string; title: string;
  capabilities: ArtifactCapability[] } }`.
- `export type ArtifactCapability = 'read:context' | 'read:sensors' |
  'read:memory' | 'read:state' | 'action:tools';`

### 5.3 Frontend

**`components/chat/scenes/panels/SceneArtifactPanel.tsx`**
- Renders `<iframe sandbox="allow-scripts" srcdoc={composed}>` — note
  the deliberate **absence** of `allow-same-origin` → the frame is a
  null origin: no access to parent DOM, cookies, `localStorage`,
  `IndexedDB`, or the PHANTOM session.
- `composed` = the model HTML prefixed with a hard CSP `<meta>`:
  `default-src 'none'; style-src 'unsafe-inline'; script-src
  'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'`.
  Result: full inline JS/CSS/canvas/animation, **zero network**.
- Fixed viewport box sized for 1024×600 (no layout escape, no scroll
  on the host screen — project UI rule).
- Header chip: title + "✕ зупинити" (unmounts iframe) + "⭳ зберегти
  як інструмент" (→ studio).
- Instantiates one `ArtifactBroker` bound to this iframe's
  `contentWindow`.

**`components/chat/scenes/artifactBroker.ts`**
- Single `window` `message` listener; **hard-pins**
  `event.source === iframe.contentWindow` and rejects everything else
  (anti cross-frame spoofing).
- Accepts exactly two message types:
  - `phantom.read {reqId, key}` — `key` ∈ closed allowlist
    `{context.snapshot, sensors.latest, memory.facts, system.state}`,
    each mapped to the **existing** read-only context/snapshot API
    surface; replies `phantom.read.result {reqId, data}`. Unknown key →
    `{reqId, error:'forbidden'}`.
  - `phantom.action {reqId, tool, args}` — gated by the artifact's
    declared `capabilities` containing `action:tools`; POSTs to
    `/chat/artifact-action`; replies `phantom.action.result
    {reqId, ok, result|error}`. The dispatcher (not the broker) decides
    SAFE-vs-confirm; the existing tap-confirm overlay surfaces normally.
- Capability enforcement: a `read:*` key whose capability was not
  declared by the model → rejected before any data is read.

**`components/chat/scenes/SceneComposer.tsx`**
- One new exhaustive `case 'artifact': return <SceneArtifactPanel …/>`.
  Reveal/stagger animation unchanged (artifact is just another panel).

### 5.4 Save-as-tool (minimal)

"⭳ зберегти як інструмент" → `POST` to the existing studio cards API
with a card of kind `artifact` carrying `{html, title, capabilities}`.
Re-opening from the studio catalog renders the same
`SceneArtifactPanel`. No new lifecycle subsystem; reuse studio models.
Detailed studio wiring is intentionally thin and may be sequenced as
the final implementation step.

## 6. Security — Defense in Depth

1. **Null-origin iframe sandbox** (`allow-scripts` only) — a hardened
   browser primitive, not code we must get perfectly right.
2. **CSP `connect-src 'none'` / `default-src 'none'`** — the artifact
   physically cannot reach the network: no exfiltration even if the
   model is malicious.
3. **Closed bridge allowlist** — finite read keys; every action is
   proxied through the **existing** `chat_tool_dispatcher` which already
   enforces RBAC (`permissions`), `dangerous_patterns` tap-confirm, and
   audit (`ai_tool_use_log`). The artifact gains zero ambient privilege.
4. **Backend pre-validation** — HTML size cap + capability allowlist
   before the panel is ever packaged.
5. **Kill switch** — `config.chat_artifacts_enabled` (UI setting) +
   per-message "✕ зупинити" unmount.
6. **postMessage source pinning** — broker rejects any message whose
   `source` is not this iframe's `contentWindow`.

## 7. Error Handling & Fallback

- iframe load error / CSP violation / render timeout → panel collapses
  to "артефакт не вдалося відобразити" and shows the raw HTML via the
  existing `code-preview` panel (no dead bubble).
- `chat_artifacts_enabled=false` OR `html` over cap OR bad capabilities
  → `parse_function_call` degrades `respond_artifact → "text"` (existing
  hallucination-safety degrade pattern).
- Broker action failure → `phantom.action.result {ok:false, error}`;
  artifact decides how to present; PHANTOM logs via existing audit.

## 8. Non-Goals

- Standard-catalog expansion (Part A).
- Mobile companion rendering (separate future spec).
- Network access from artifacts (deliberately impossible via CSP).
- Artifact-to-artifact communication or persistence beyond studio save.
- A bespoke artifact storage subsystem (reuse studio).

## 9. Acceptance Criteria

1. Model `respond_artifact` with valid HTML+caps renders an interactive,
   animated widget inside the chat scene on the 1024×600 device, with no
   host-screen scroll/overflow.
2. The iframe has `sandbox="allow-scripts"` (no `allow-same-origin`) and
   the injected CSP; an artifact attempting `fetch`/`XMLHttpRequest`/
   `WebSocket` fails (blocked by `connect-src 'none'`).
3. `phantom.read` for an allowlisted, declared key returns curated data;
   a non-allowlisted key or undeclared capability is rejected.
4. `phantom.action` routes through `chat_tool_dispatcher`: a SAFE tool
   auto-runs; a MEDIUM+/dangerous tool raises the existing tap-confirm
   overlay and is audited in `ai_tool_use_log`.
5. A message from any window other than the artifact iframe is ignored.
6. `chat_artifacts_enabled=false` ⇒ `respond_artifact` degrades to a
   plain-text reply (no panel, no error bubble).
7. Oversized or bad-capability artifact degrades to text.
8. "Save as tool" persists to studio and re-opens identically.
9. All existing chat/scene tests stay green; new tests (below) pass.

## 10. Test Plan (no mocks in product code; tests may stub providers)

- **Backend pytest:** `parse_function_call(respond_artifact)` —
  valid → artifact panel; oversize → text; bad capability → text;
  `chat_artifacts_enabled=false` → text. `/chat/artifact-action`
  proxies to dispatcher and preserves `{ok,result|error}` + auth.
- **Frontend vitest:** SceneArtifactPanel emits `sandbox="allow-scripts"`
  (asserts no `allow-same-origin`) and the CSP meta; broker rejects
  foreign `event.source`; read outside allowlist rejected; undeclared
  capability rejected; action proxies to `/chat/artifact-action`;
  kill-switch + "✕" unmounts.
- **Playwright:** artifact renders + animates; a MEDIUM action raises
  the confirm overlay; a `fetch` inside the artifact is blocked.

## 11. Scope Estimate

~6–8 files changed/added, zero new subsystems. Reuses scene channel,
`chat_tool_dispatcher`, studio, and the audit log. Full implementation,
no placeholders/mocks in product code (project rule #1). Tests after the
phase (project rule #10).
