# Cluster ADR — `chat-liveness` (Phase-2, Day-4)

**Cluster contexts**: `chat-scenes`, `chat-input`, `chat-perf`
**Baseline commit**: `53d16bc`
**Prober**: Phase-2 cluster architect 2 of 8
**Inputs**: `docs/PHASE1_CONTEXTS.md` §"Cluster: chat-liveness", `docs/PHASE1_BLOCK_ORDER.md` (rows W-1, W-2, W-2b, W-2c, W-3, W-3b, W-4, W-5).
**Audit anchors closed**: U1-UX-H1–H4, U1-UX-G2, U1-UX-C1, U1-UX-C2, U2-ANIM-C1, U2-ANIM-C2, U2-ANIM-G1, U2-ANIM-H1, U2-ANIM-H2, U2-ANIM-H3, U2-ANIM-M1, U2-ANIM-M2, U2-ANIM-M3, U8-PERF-M3.

This ADR set is the single source of truth for Phase-3 implementation of every W-* block in the cluster. Every block lands behind a back-compat invariant: `response_form: 'text' | 'markdown' | 'code' | 'chart' | 'diagram' | 'map' | 'terminal' | 'metric_cards' | 'mixed'` with no `scene` field MUST render exactly as the baseline (`src/frontend/src/components/chat/MessageBubble.tsx:53-160`, `src/frontend/src/components/chat/ResponseRenderer.tsx:36-143`).

---

## ADR-CS-001 — `<ChatScene>` composer architecture

### Context

Today the assistant message render path is a closed `switch (response_form)` that dispatches to one renderer per form (`src/frontend/src/components/chat/ResponseRenderer.tsx:45-141`). The 8-form `ResponseForm` enum (`src/shared/types/chat.ts:3-12`) is closed and mirrored 1:1 in `RESPONSE_FORM_TOOLS` (`src/backend/ai/response_formatter.py:12-224`) and `_FORM_MAP` (`src/backend/ai/response_formatter.py:230-239`). Adding a new "alive" panel kind (e.g. `identity-card`, `plan-step`, `map-pin`) without changing the closed enum is impossible, and U2-ANIM-C1 ("no ChatScene") explicitly calls out that the bubble cannot compose >1 renderer with shared motion choreography. Mixed form (`ResponseRenderer.tsx:121-138`) bolts blocks together with `flex-col gap-2` and zero motion sequencing — it is functional, not "alive".

### Decision

Introduce a new presentation layer **`<ChatScene>`** under `src/frontend/src/components/chat/scenes/` that owns a *composition tree of named panels*. The shape is:

```
<ChatScene kind="..." panels={...} reveal={...}>
  ├ <ScenePanelText/> | <ScenePanelList/> | <ScenePanelMapPin/>
  ├ <ScenePanelPlan/> | <ScenePanelCodePreview/> | <ScenePanelIdentityCard/>
  └ ...
</ChatScene>
```

`<ChatScene>` is a **composer**, not a switch:

1. Accepts `kind: SceneKind` (one of 6 named presets) and `panels: ScenePanel[]` (an explicit, ordered, typed array).
2. Owns the *reveal choreography* — staggered entry per `reveal.policy: 'sequential' | 'cascade' | 'instant'` with stagger `reveal.staggerMs ∈ [0, 240]`.
3. Each panel is a **dumb leaf** — it renders one chunk (text/list/map-pin/plan-step/code-preview/identity-card). Leaves never own choreography; only `<ChatScene>` does.
4. Composition tree is *flat* (depth = 1). Nested scenes are explicitly forbidden Day-4 — every panel is a leaf.
5. The 6 named presets (Day-4 closed set):

   | `SceneKind`     | Composition shape | Used for |
   |-----------------|-------------------|----------|
   | `text`          | 1 × `text`        | back-compat default; renders identically to `MarkdownResponse` |
   | `list`          | 1 × `text` + 1 × `list`  | enumerated answers, search hits |
   | `map-pin`       | 1 × `text` + 1 × `map-pin` | location answers, "де я був" |
   | `plan`          | 1 × `text` + N × `plan-step` | standing-orders, multi-step ack |
   | `code-preview`  | 1 × `text` + 1 × `code-preview` | code/terminal output |
   | `identity-card` | 1 × `text` + 1 × `identity-card` | speaker-id + UserFact recall (Day-5 hot-wire) |

6. **Composer + 6 presets**, *not* a registry of N kinds. New kinds require a typed enum extension *and* a preset map update — no string-typed escape hatch.

### Why composer + 6 presets and not a generic registry

- A generic registry (e.g. `KIND_TO_RENDERER: Record<string, RC>`) re-introduces the same closed-enum pain for the *next* dimension (panel × kind matrix would explode). The composer fixes the *render* axis once, and the *kind* axis is a documented union with a preset map per kind.
- 6 presets matches the 6 charter-must-have scene kinds without overshooting; the closed enum guarantees the LLM can be function-call constrained on the backend (ADR-CS-003).
- Reveal choreography MUST live in one place; if every panel owned its own entry animation we re-create the dialect drift problem ADR-CP-001 is closing.

### Consequences

- `<ChatScene>` becomes the new render entrypoint inside `MessageBubble.tsx:97` *only when* `message.scene !== undefined`. When `scene` is absent, `MessageBubble` keeps calling `<ResponseRenderer>` exactly as today (back-compat invariant).
- `<MessageBubble>` is unaware of panels — it only forwards `message.scene` and `streaming` to `<ChatScene>`.
- `ResponseRenderer.tsx` is **frozen**, not deleted, until W-2 ships all 6 presets *and* the back-compat snapshot test (ADR-CS-002) is green vs `e12188f`.
- Adding a 7th preset requires (a) extend `SceneKind` union in `src/shared/types/chat.ts`, (b) add panel composition spec in `scenes/presets.ts`, (c) update `response_formatter.scene_kind_for_form()` mapping, (d) extend pixel-snapshot suite. No "stringly typed" backdoors.

### File touchpoints (W-1 + W-2)

- W-1 (90 LOC): `src/shared/types/chat.ts` — `SceneKind`, `ScenePanel`, `ChatScene`, `RevealPolicy` types added; `ChatMessage.scene?: ChatScene` optional field added.
- W-2 (480 LOC): `src/frontend/src/components/chat/scenes/{ChatScene.tsx, presets.ts, panels/{Text, List, MapPin, Plan, CodePreview, IdentityCard}.tsx}` — composer + 6 preset compositions + 6 leaf panels.
- `MessageBubble.tsx:97` — gate: `message.scene ? <ChatScene scene={message.scene} streaming={streaming}/> : <ResponseRenderer message={message} streaming={streaming}/>`.

---

## ADR-CS-002 — Scene envelope wire format

### Context

The current wire format is `ChatMessage` with `response_form` + `attachments[]` (`src/shared/types/chat.ts:14-32`, `src/backend/api/routes_chat.py:99-130`). Backend writes the assistant message at `routes_chat.py:516-533` and broadcasts it via `_broadcast_message_stream` at `routes_chat.py:590-621`. The WS payload is the serialized `ChatMessage` plus the streamed deltas. Adding scene support without breaking 100% of in-flight messages, in-flight DB rows, and in-flight TTS playback requires a *purely additive* envelope.

### Decision

Add a single optional field on `ChatMessage`: **`scene?: ChatScene`**.

The wire format is:

```jsonc
{
  // ...all existing ChatMessage fields stay 1:1 with src/shared/types/chat.ts:14-32...
  "scene": {                              // OPTIONAL — absent → MessageBubble path unchanged
    "kind": "plan",                       // SceneKind union (closed, 6 values Day-4)
    "panels": [
      {
        "id": "p0",                       // stable id for keyed reveal animation
        "kind": "text",                   // ScenePanelKind (matches one of 6 leaf renderers)
        "data": { "markdown": "..." }     // panel-kind-specific payload (typed)
      },
      {
        "id": "p1",
        "kind": "plan-step",
        "data": { "title": "...", "state": "pending|active|done|error", "eta_ms": 4200 }
      }
    ],
    "reveal": {                           // OPTIONAL — defaults to {policy:'sequential', staggerMs:80}
      "policy": "sequential",             // 'sequential' | 'cascade' | 'instant'
      "staggerMs": 80                     // clamped to [0, 240] at render time
    }
  }
}
```

### Persistence

- DB column `metadata_json` already stores arbitrary JSON (`routes_chat.py:104-119`). The `scene` field rides as a top-level addition on the *serialized message dict* and is persisted into `attachments_json` as a single envelope-style attachment of `type: 'scene'` for forward compatibility with existing schema. The serializer (`_serialize_message` at `routes_chat.py:99-130`) is updated to *promote* the scene attachment back up to `message.scene` on read so the frontend type matches.
- **Why not add a column**: avoids an Alembic migration during chat-liveness rollout; keeps the change purely additive at the JSON layer. A real column is acceptable post-Day-4 once the wire format is stable, but Day-4 ships JSON-on-JSON.

### Streaming semantics

`_broadcast_message_stream` (`routes_chat.py:590-621`) sends `chat:stream` deltas of `content` text first, then a `done:true` final event carrying the full message. The scene envelope is *only* attached to the final `done` payload — partial chunks remain plain text deltas. Reasoning: until the scene is fully composed (panels finalised, reveal computed), partial-scene rendering would force `<ChatScene>` into intermediate layouts that conflict with reveal choreography. ChatStore on the frontend (`useChatStream` + chatStore — referenced from `ChatWindow.tsx:13-19`) already commits the final message into `messages[]` on the `done` event; this is the exact insertion point where scene materialises.

### Back-compat invariants

1. Backend assistant turns that do NOT emit a function call (plain text path, `parse_plain_text` at `response_formatter.py:364-382`) MUST NOT emit a `scene`. Result: legacy text replies keep `response_form: 'text'`, no `scene`, `MessageBubble.tsx:97` keeps using `<ResponseRenderer>`.
2. Frontend MUST treat `scene === undefined` as equivalent to "render the legacy way" (no implicit `kind: 'text'` substitution).
3. Pixel-snapshot baseline test against commit `e12188f` exercises text/markdown/code/chart messages and asserts pixel equality at 1024×600 (W-1 lands the test).
4. Any field rename, kind removal, or non-additive change to `ChatScene` is a wire-break and requires a versioned envelope. Day-4 ships v1 only.

### Consequences

- The shared `ChatMessage` type and its backend Pydantic mirror (implicit — no Pydantic model exists in `routes_chat.py:99-130`, the envelope is dict-shaped) become the contract surface. Tests at `src/backend/tests/test_chat_*.py` will assert that absence of scene is preserved end-to-end.
- ChatStore round-trip stability: when a session is reloaded via `GET /chat/sessions/{session_id}/messages` (`routes_chat.py:837-859`), the deserializer must re-promote `scene` out of the attachments array. `_serialize_message` is the single authority — keep it the only place this transformation lives.

---

## ADR-CS-003 — Backend `response_formatter` `scene_kind` picker

### Context

The current backend response builder (`src/backend/ai/response_formatter.py:12-224`) defines 7 function-call tools (`respond_chart, respond_map, respond_terminal, respond_code, respond_metrics, respond_diagram, respond_mixed`) and a parser (`parse_function_call` at `response_formatter.py:244-361`) that returns `(response_form, content, attachments)`. `_build_ai_response` at `routes_chat.py:176-368` consumes that tuple and stores it. There is no scene-kind selection logic — the assistant either returns plain text (handled by `parse_plain_text` at `response_formatter.py:364-382`) or one of the 7 tools.

### Decision

Add a *picker function* `scene_kind_for_form(response_form: str, attachments: list[dict]) -> SceneEnvelope | None` to `response_formatter.py` that maps `response_form` (legacy axis) → `scene` (new axis) **without modifying the tool catalog Day-4**.

Mapping table (legacy → scene):

| `response_form` legacy | `SceneKind` picked | Panel composition derived |
|---|---|---|
| `text`                  | *none* (returns `None`, scene absent — back-compat) |
| `markdown`              | *none* (returns `None`) |
| `code`                  | `code-preview`   | text(content) + code-preview(language, code from `code_block` attachment) |
| `chart`                 | *none* Day-4 (defer to ResponseRenderer; chart preset is post-Day-4) |
| `diagram`               | *none* Day-4 |
| `map`                   | `map-pin`        | text(content) + map-pin(markers, center, zoom from `map_markers` attachment) |
| `terminal`              | `code-preview`   | text(content) + code-preview(language=`bash`, code=`command` from `terminal_output` attachment) |
| `metric_cards`          | `list`           | text(content) + list(items derived from `metric_card.metrics`) |
| `mixed`                 | *none* Day-4 (composer-of-mixed not built; falls back to legacy mixed renderer) |

Day-4 the picker is **conservative** — only 4 of 9 forms (`code`, `map`, `terminal`, `metric_cards`) get auto-promoted to a scene. `text`, `markdown`, `chart`, `diagram`, `mixed` keep `scene: None`. This is the smallest possible surface to validate the wire format end-to-end while preserving full back-compat for the 5 pure-legacy paths.

### Why "form → scene picker" and not "new tool catalog"

- A new tool catalog (e.g. `respond_scene_plan`) means the LLM is *forced* to use scenes — Gemini's function-call audit at `phase-09.5-scope-audit/README.md` showed 100% bias toward `respond_text` even with `respond_*` available. Forcing scenes via tools would re-create the same routing bias.
- The picker keeps tool-calling exactly as Day-3, which is already battle-tested. Scenes are an *output reformat*, not a new generation contract.
- Day-5 will introduce a dedicated `respond_scene` tool (out of scope for Day-4), at which point the picker becomes the *fallback path* for the legacy 9 forms and the new tool emits scenes natively. This ADR is forward-compat with that.

### Identity-card and plan kinds

`identity-card` is wired by FACTS-1 + ID-3 (cross-cluster contract — see `Interfaces` section below). `plan` is wired by T-3 standing-order events when `event_bus` fans `standing_order.fired/skipped/tick` into the chat channel. **Neither is reachable via the legacy `response_form` axis** — they must be emitted by their producing subsystems (`ai.chat_pipeline` for identity-card after a UserFact lookup, `agent.standing_orders.runner` for plan after fire). The picker does not own them. Day-4 the picker emits `code-preview / map-pin / list` only.

### Touchpoints

- W-2c (60 LOC): `response_formatter.scene_kind_for_form()` + `_attachments_to_panels()` helpers.
- `_build_ai_response` at `routes_chat.py:176-368` calls the picker after `parse_function_call` returns; if non-None, the resulting scene envelope is added into the attachments list with `type: 'scene'`.
- **No change** to `RESPONSE_FORM_TOOLS` Day-4. The tool-call → form mapping at `_FORM_MAP` (`response_formatter.py:230-239`) is also unchanged.

---

## ADR-CI-001 — Chat input typed-card `+`-button drawer + ModelCard echo

### Context

The chat input bar at `src/frontend/src/components/chat/ChatWindow.tsx:639-723` is a single-row composer: Voice toggle (`ChatWindow.tsx:647-674`), `<textarea>` (`ChatWindow.tsx:676-694`), Send button (`ChatWindow.tsx:696-722`). The user can attach nothing. U1-UX-H3 calls out missing typed-card attachment; U1-UX-C2 demands enumerated source pickers (handled by W-4 in `dynamic-source-picker` cluster — *cross-context contract* below).

### Decision

Add a **`+` button** between Voice and `<textarea>` (left of textarea, after voice toggle) that opens an **`<AttachDrawer/>`** floating above the input bar. Drawer surface is `glass-card` rounded-xl, height ≤ 220 px to respect the 1024×600 budget.

Drawer Day-4 ships **one card type only**: `<ModelCard/>` — a typed echo card the user can attach to indicate "use this provider for this turn". Selection populates a typed cell that rides the next user-message send as a `chat_attachment` of `type: 'model-card'`. The backend logs it (Day-4 stub) into `metadata.attached_model_card` but does *not* yet route to that provider — wiring is deferred to Day-5 (`ai-hub` cluster Z-1).

### Feature flag

The whole drawer is gated by `config.chat_typed_cards_enabled: bool = False`. Default off — operators flip it on per deploy via Settings. When off, the `+` button is hidden, ChatWindow renders identically to baseline.

### Why a drawer (not a toolbar, not an inline picker)

- Toolbar consumes vertical space below 600 px (CLAUDE.md rule #4 — UI must fit 1024×600 with no scroll on main screens). A drawer is `position: absolute; bottom: 100%` of the input bar — invisible until invoked.
- Inline picker (e.g. an inline `<select>`) breaks the chat bubble flow and produces a flicker on every input refocus.
- Drawer is the canonical iOS / Mac chat compose pattern; touch targets are 44×44 (CLAUDE.md rule #2) trivially.

### Cross-context dependency on `dynamic-source-picker`

ModelCard's "pick a model" UI uses `<DynamicPicker source="ollama_models">` from W-4 (cluster `dynamic-source-picker`). The interface contract is in §Interfaces below. If W-4 lands in the same wave (Wave 2), ModelCard wires through directly. If W-4 slips, ModelCard temporarily renders a hard-coded list of 3 candidate models drawn from `config.ollama_models_default` — flag for cleanup on W-4 land.

### Settings overflow side-fix (W-3b)

W-3b (100 LOC, NEW in synthesis — see `PHASE1_BLOCK_ORDER.md:33`) closes U1-UX-C1 (Settings overflow at 1024×600). The voice category currently has ~30 keys laid out vertically; W-3b adds **subgroup accordions** (collapsed by default) and a **2-column layout** for the voice subgroup. This is *cluster-extension* work — owned here because it shares the chat-input cluster's design language.

### Touchpoints

- W-3 (220 LOC): `src/frontend/src/components/chat/AttachDrawer.tsx`, `src/frontend/src/components/chat/cards/ModelCard.tsx`, `+` button injected at `ChatWindow.tsx:646` (before voice toggle conditional).
- W-3b (100 LOC): `src/frontend/src/components/settings/SettingsGroups.tsx` (existing) gains `<AccordionGroup>` wrap; voice category lays out 2-col on viewport ≥ 768.
- Backend: `chat_attachment` type union extends with `model-card` (additive). `routes_chat.send_message` records `metadata.attached_model_card` into `metadata_json`. No router change Day-4.

---

## ADR-CP-001 — Unified `phantomVariants` motion vocab + `getScaledDuration` wiring

### Context

`src/frontend/src/styles/motion.ts:6-43` exports a `motion` const with 7 named presets (`fadeIn, slideUp, slideOver, stateTransition, pulse, heartbeat, alarm`) and an `EASE_PHANTOM` cubic-bezier. `getScaledDuration` at `motion.ts:52-59` reads two CSS variables (`--motion-scale` for state-driven scale, `--motion-scale-user` for the user setting) and combines them. **However**, `MessageBubble` uses an inline transition `{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }` (`MessageBubble.tsx:59`) — the bezier is duplicated, the duration is hard-coded, and `getScaledDuration` is **not called**. ChatWindow has 6 inline `transition={{...}}` calls (`ChatWindow.tsx:481, 545, 565, 589`) likewise hard-coded. Orb uses CSS `animation: phantom-radar calc(20s / var(--motion-scale, 1)) linear infinite` (`Orb.tsx:62-63, 75-76`) — yet another dialect. AmbientGlows uses Tailwind's `animate-pulse-slow` class with raw CSS keyframes — yet another dialect. U2-ANIM-G1 calls this "dialect drift".

### Decision

Introduce a single named-export **`phantomVariants`** object alongside the existing `motion` object in `src/frontend/src/styles/motion.ts`. It is the *Framer Motion variants vocabulary* — every animation in the app picks variants from this object, not inline.

Shape (W-2b adds it in 70 LOC):

```ts
export const phantomVariants = {
  bubbleEnter:    { initial: { opacity: 0, y: 6 },  animate: { opacity: 1, y: 0 }, baseMs: 240 },
  panelReveal:    { initial: { opacity: 0, y: 8 },  animate: { opacity: 1, y: 0 }, baseMs: 280 },
  panelStagger:   { stagger: 80 /* ms */, baseMs: 280 },
  scenePresence:  { initial: { opacity: 0 },         animate: { opacity: 1 },        exit: { opacity: 0 }, baseMs: 200 },
  ghostPreview:   { initial: { opacity: 0, y: 4 },  animate: { opacity: 1, y: 0 }, baseMs: 220 },
  thinkingPulse:  { animate: { opacity: [0.3, 1, 0.3] }, baseMs: 1000, repeat: Infinity },
  pingDot:        { animate: { opacity: [0.2, 1, 0.2] }, baseMs: 1000, repeat: Infinity },
  cursorBlink:    { animate: { opacity: [0.3, 1, 0.3] }, baseMs: 1000, repeat: Infinity },
} as const
```

Every chat-cluster site replaces inline `{ duration: ..., ease: ... }` with `getPhantomTransition('bubbleEnter')`, where:

```ts
export function getPhantomTransition(kind: keyof typeof phantomVariants) {
  const v = phantomVariants[kind]
  return phantomTransition(getScaledDuration(v.baseMs))
}
```

This **wires `getScaledDuration` everywhere** — every chat motion now respects `--motion-scale` (state) × `--motion-scale-user` (settings). U2-ANIM-G1, H1, M1 close.

### Why a single variants object (not per-component variants)

- One vocabulary = one place to audit motion choices ("is `bubbleEnter` actually used?", "is anything bypassing scaling?"). A grep for `getPhantomTransition(` is exhaustive.
- Per-component variants drift over time; the dialect-drift audit was triggered by exactly this drift.
- `phantomVariants` is `as const` — TypeScript constrains every call to a known key. Adding a new variant = explicit edit; misuse is caught at compile time.

### Sites updated

- `MessageBubble.tsx:59` system bubble + `:54-60` user/assistant bubble: `getPhantomTransition('bubbleEnter')`.
- `ChatWindow.tsx:481, 545, 565, 589`: `getPhantomTransition('scenePresence' | 'ghostPreview' | 'thinkingPulse')`.
- `<ChatScene>` panel reveal (NEW from ADR-CS-001): `getPhantomTransition('panelReveal')` with `phantomVariants.panelStagger.stagger` × `getScaledDuration` for sequential reveal.
- `Orb.tsx:62, 75`: keep CSS-side scaling (already using `var(--motion-scale)`); add a comment cross-ref to `phantomVariants` so the dialect is documented.
- `AmbientGlows.tsx:14, 27, 40`: keep Tailwind `animate-pulse-slow` (out of chat-liveness scope); document the deliberate exception.

### Consequences

- `motion` (lower-case) const stays for legacy callers Day-4; deprecated comment added. Day-5 cleanup migrates all sites to `phantomVariants` and removes the legacy export.
- A regression test in `src/frontend/src/components/chat/__tests__/motion.test.tsx` greps the chat directory for inline `transition={{` literals containing `duration:` and asserts the count is exactly the known whitelist (= 0 after W-2b lands).

---

## ADR-CP-002 — Hardware-tier flag + backdrop-filter stack-depth gate

### Context

`MessageBubble.tsx:82-94` applies `glass-panel` / `glass-subtle` (CSS classes that include `backdrop-filter: blur(...)`). Each bubble is one stack of backdrop-filter blur. `AmbientGlows.tsx:14-53` adds 3 fullscreen blurred blobs. `Orb.tsx:48-50, 91-100` adds 1 blurred halo + 1 blurred core. ChatWindow sidebar (`ChatWindow.tsx:315`) is `glass-panel`, the input bar (`ChatWindow.tsx:641`) is `glass-card`, the composer container is `glass-panel`. **At a 50-message scrollback**: stack depth is 50 bubbles × 1 blur + 1 sidebar + 1 input + 3 ambient + 2 orb = ~57 simultaneous backdrop-filter layers. On the Radxa Dragon Q6A this drops the chat scroll FPS from ~60 to ~22 (U2-ANIM-C2 measurement). U8-PERF-M3 corroborates.

### Decision

Introduce **`config.ui_hardware_tier: 'low' | 'high'` = 'high' default** (Pydantic Settings, Day-4 W-5). Frontend reads it from the existing `/settings` GET via `useSettingsStore`. Behavior:

- **`tier = 'high'`** (default; matches today): every glass class keeps `backdrop-filter: blur(...)`. `<AmbientGlows/>` renders all 3 blobs. Orb keeps full halo. **Visual = baseline.**
- **`tier = 'low'`**: a global CSS class `data-ui-tier="low"` on `<html>` flips the behavior:
  - `glass-panel`, `glass-subtle`, `glass-card` swap `backdrop-filter: blur(N)` for `background: color-mix(...)` flat fallbacks. (CSS-side rewrite in `globals.css` — already segmented via CSS variables.)
  - `<AmbientGlows/>` returns `null` (full early-out — `AmbientGlows.tsx:7-11` guarded).
  - `<Orb/>` halo (`Orb.tsx:43-52`) is replaced by a flat radial-gradient div (no blur).
  - `<ChatScene>` enforces a panel-count cap of **4 max** (per `PHASE1_CONTEXTS.md:54` "Produces: chat-scenes (panel-count budget = 4 max @ tier=low)"). Panels 5+ are collapsed into a "+N more" trailing affordance.

### Stack-depth gate

Independent of the tier, **chat scrollback enforces a hard cap of 30 simultaneously rendered glass-bubbles**. Bubbles outside the visible viewport ± 1 page are virtualised — the ChatWindow message list mounts a windowed renderer (lightweight; uses scroll position from `handleScroll` at `ChatWindow.tsx:123-129`). Beyond the cap, off-screen bubbles render in a flat-style "off-screen" variant (no `backdrop-filter`).

### Voice-amplitude rAF throttle

`ChatWindow.tsx:108-111` pushes `recorder.amplitude` into `setVoiceAmplitude` on **every render** (re-fired on every amplitude tick). On a 100 Hz mic update this is 100 Zustand commits/sec, each triggering Orb re-render (`Orb.tsx:33-35` reads `voiceAmplitude`). W-5 throttles via `requestAnimationFrame` to ≤ 60 Hz; `voiceAmplitude` writes pass through a `rafThrottle` helper. This is independent of the tier — even tier=high benefits.

### Drop `chat_stream_delay_s` artificial sleep

`routes_chat.py:610` sleeps `config.chat_stream_delay_s` between WS chunks for "UX parity with a true streaming provider". This fakes streaming latency on what is already a *real* network round-trip. W-5 removes the sleep when `config.chat_stream_delay_s = 0.0` (already the natural value to set), and the default is changed to `0.0`. The chunking remains (still produces visible chunked reveal client-side) but no artificial pacing.

### Why not auto-detect tier

- The Radxa device is a known target (CLAUDE.md device spec); operator can flip tier in Settings on first boot. Auto-detect via `navigator.hardwareConcurrency` is unreliable on ARM64 Linux Chromium.
- Tauri builds (V-1) can hard-code `tier = 'low'` for the production Radxa wrapper. Browser dev keeps `tier = 'high'`.

### Touchpoints

- W-5 (140 LOC): `src/backend/config.py` (+`ui_hardware_tier`, +`chat_stream_delay_s` default to 0.0), `src/frontend/src/styles/globals.css` (+`[data-ui-tier="low"]` overrides), `src/frontend/src/app/AppShell.tsx` (apply `data-ui-tier` attribute from settings), `src/frontend/src/hooks/useVoiceAmplitudeRAF.ts` NEW (rAF throttle), `<AmbientGlows/>` early-out, `routes_chat._broadcast_message_stream` drop sleep when delay=0.

---

## Interfaces (TypeScript)

The cluster's public type surface — every type consumed across context boundaries lives in `src/shared/types/chat.ts` so backend Pydantic and frontend React see the same shape.

```ts
// ─── Scene primitives ──────────────────────────────────────────────────────────

/** Closed enum, Day-4. New kinds require ADR amendment. */
export type SceneKind =
  | 'text'
  | 'list'
  | 'map-pin'
  | 'plan'
  | 'code-preview'
  | 'identity-card';

/** Reveal choreography; lives on <ChatScene>, never on individual panels. */
export type RevealPolicy = 'sequential' | 'cascade' | 'instant';

export interface SceneReveal {
  policy: RevealPolicy;
  /** Per-step delay in ms; clamped to [0, 240] at render time. */
  staggerMs: number;
}

/** Each panel is a typed leaf. The data union keeps strict per-kind shape. */
export type ScenePanelKind =
  | 'text'
  | 'list'
  | 'map-pin'
  | 'plan-step'
  | 'code-preview'
  | 'identity-card';

export type ScenePanel =
  | { id: string; kind: 'text';           data: { markdown: string } }
  | { id: string; kind: 'list';           data: { items: Array<{ label: string; value?: string | number; trend?: 'up' | 'down' | 'stable' }> } }
  | { id: string; kind: 'map-pin';        data: { markers: Array<{ lat: number; lon: number; label: string; color?: string }>; center: [number, number]; zoom?: number } }
  | { id: string; kind: 'plan-step';      data: { title: string; state: 'pending' | 'active' | 'done' | 'error'; eta_ms?: number; note?: string } }
  | { id: string; kind: 'code-preview';   data: { language: string; code: string; runnable?: boolean } }
  | { id: string; kind: 'identity-card';  data: { user_id: string; display_name: string; trust: number; facts: Array<{ id: string; label: string; value: string; sensitive?: boolean }> } };

export interface ChatScene {
  kind: SceneKind;
  panels: ScenePanel[];
  reveal?: SceneReveal;
}

// ─── ChatMessage extension ─────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  session_id: string;
  user_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  response_form: ResponseForm;          // unchanged — back-compat
  metadata: { /* unchanged from src/shared/types/chat.ts:21-29 */ };
  attachments: ChatAttachment[];
  created_at: string;

  /** OPTIONAL — when absent, MessageBubble renders via <ResponseRenderer> exactly as today. */
  scene?: ChatScene;
}

// ─── <ChatScene> component props ───────────────────────────────────────────────

export interface ChatSceneProps {
  scene: ChatScene;
  /** Pass true to mark this render as a live stream (skips heavy panels until done). */
  streaming?: boolean;
  /** Hardware tier override; defaults to reading data-ui-tier from <html>. */
  tier?: 'low' | 'high';
}

// ─── phantomVariants — exported type for compile-time safety ───────────────────

export const phantomVariants: PhantomVariants = { /* see ADR-CP-001 */ } as const;

export type PhantomVariantKey = keyof typeof phantomVariants;
export interface PhantomVariant {
  initial?: Record<string, number | number[]>;
  animate?: Record<string, number | number[]>;
  exit?: Record<string, number | number[]>;
  baseMs: number;
  repeat?: number;
  stagger?: number;
}
export type PhantomVariants = Record<string, PhantomVariant>;

export function getPhantomTransition(key: PhantomVariantKey): { duration: number; ease: number[] };

// ─── DynamicPicker — cross-context contract with profile-cards/W-4 ─────────────

/** Sources are a closed enum at the `dynamic-source-picker` cluster boundary. */
export type DynamicPickerSource =
  | 'ollama_models'
  | 'voice_voices'
  | 'mms_languages'
  | 'serial_ports'
  | 'tts_speakers';

export interface DynamicPickerOption {
  value: string;
  label: string;
  /** Optional metadata; used by <ModelCard/> to show provider tag. */
  meta?: { provider?: string; size_mb?: number; lang?: string };
}

export interface DynamicPickerProps {
  source: DynamicPickerSource;
  value: string | null;
  onChange: (next: string) => void;
  /** Touch-friendly placeholder when options haven't loaded. */
  placeholder?: string;
  /** Force-refresh trigger; useful when source is "serial_ports" and the operator just plugged a device. */
  refreshKey?: number;
  /** Disable interactions during async resolution. */
  disabled?: boolean;
}
```

The `DynamicPickerProps` shape is **the cross-context contract** between `chat-input` (W-3 ModelCard consumer) and `dynamic-source-picker` (W-4 producer). Both contexts MUST import from `src/shared/types/chat.ts` (frontend) / a Pydantic mirror at `src/backend/api/schemas/dynamic_source.py` (backend). Day-4 ships the frontend-only contract; backend resolvers live in W-4's owned module.

---

## Test plan (per-block)

| Block  | What ships | Test surface | Specific assertions |
|--------|-----------|--------------|---------------------|
| **W-1** | `SceneKind`, `ScenePanel`, `ChatScene`, `RevealPolicy` types + `ChatMessage.scene?` field | `src/frontend/src/components/chat/__tests__/scene_types.test.ts` (vitest); `src/backend/tests/test_chat_scene_envelope.py` (pytest) | Backend `_serialize_message` round-trips `scene` envelope through `attachments_json`; absent scene ⇒ `message.scene === undefined`; `tsc --noEmit` rejects unknown `SceneKind` strings; pixel-snapshot of legacy text bubble vs `e12188f` is byte-identical at 1024×600. |
| **W-2** | `<ChatScene>` composer + 6 named presets + 6 leaf panels | vitest `__tests__/ChatScene.test.tsx` per preset; story snapshot per panel kind | Each of the 6 presets renders its declared panel composition; `kind: 'text'` preset matches `<MarkdownResponse>` baseline; `reveal.policy: 'instant'` skips stagger; `reveal.policy: 'sequential' staggerMs: 80` produces 6 panels in 480 ms ± 40 ms of motion-scale=1; nested scenes are forbidden (TS + runtime guard). |
| **W-2b** | `phantomVariants` + `getPhantomTransition` + chat sites migrated | vitest motion-vocab grep test | `grep -r 'transition={{' src/frontend/src/components/chat` returns only allow-listed sites; every `getPhantomTransition(key)` call has `key in phantomVariants`; `getScaledDuration` is exercised via `--motion-scale` CSS variable mutation in jsdom and produces scaled output. |
| **W-2c** | `response_formatter.scene_kind_for_form()` picker | pytest `test_response_formatter_scene_picker.py` | `(form='code', attachments=[code_block])` → scene with `code-preview` panel + correct payload; `(form='text', ...)` → `None`; `(form='mixed', ...)` → `None` (Day-4 pass-through); legacy `parse_function_call` outputs unchanged. |
| **W-3** | `+` button + `<AttachDrawer/>` + `<ModelCard/>` | vitest + Playwright headless on 1024×600 | `+` button is 44×44; drawer opens above input bar without overflow; ModelCard echo lands in `metadata.attached_model_card` on send; `chat_typed_cards_enabled=False` hides the `+` button entirely. |
| **W-3b** | Settings subgroup accordions + 2-col voice layout | Playwright on 1024×600 | Voice category ≤ 600 px tall when all subgroups collapsed; expanding any one subgroup keeps total height ≤ 560 px (chrome budget); 2-col layout collapses to 1-col below 768 px viewport (no overflow at 1024). |
| **W-4 frontend slice** | `<DynamicPicker>` consumer wired into ModelCard | vitest + MSW mock backend for `/api/v1/dynamic_source/{source}` | Picker resolves on mount; ChooseAction emits `onChange(value)`; `refreshKey` bump re-fetches; disabled state respects `disabled` prop; touch target ≥ 44×44. |
| **W-5** | `ui_hardware_tier` flag + voice-amp rAF throttle + `chat_stream_delay_s=0.0` | pytest + vitest + Playwright | `tier='low'` renders `<AmbientGlows/>` as null; `glass-panel` resolves to flat fallback; `<ChatScene>` caps 4 panels with "+N more"; voice-amp store updates ≤ 60/sec under 100 Hz mic input; `_broadcast_message_stream` no longer sleeps when delay=0; FPS measurement on Radxa baseline ≥ 50 with 50 messages and tier=low. |

---

## Performance budgets

| Metric | Hardware tier | Target | Measurement site |
|--------|---------------|--------|------------------|
| `<ChatScene>` first-paint p50 | high (browser dev, full glass) | ≤ 250 ms at 1024×600 | vitest perf via `performance.now()` around mount; Playwright trace on Radxa |
| `<ChatScene>` first-paint p50 | low (tier=low, flat fallbacks) | ≤ 350 ms at 1024×600 | same |
| Panel reveal stagger | both | 80 ms ± 8 ms per step at `--motion-scale=1, --motion-scale-user=1` | Playwright animation trace |
| Chat scroll FPS @ 50 messages | high | ≥ 50 fps | Radxa Performance HUD |
| Chat scroll FPS @ 50 messages | low | ≥ 55 fps | same |
| Voice-amplitude store write rate | both | ≤ 60 Hz under 100 Hz mic input | vitest with mock recorder |
| WS chunk pacing overhead | both | 0 ms artificial sleep when `chat_stream_delay_s=0.0` | pytest timing on `_broadcast_message_stream` |
| Backdrop-filter stack depth | low | ≤ 6 layers visible simultaneously | DOM audit (count `glass-*` elements with non-flat fallback active) |

The 250 ms / 350 ms targets are *first paint of fully composed scene*, not "scene visually complete" — sequential reveal is allowed to extend beyond 350 ms by design (reveal duration = 6 × 80 ms stagger + 280 ms last-panel base = 760 ms at scale 1). The budget covers React reconciliation + first frame.

---

## Back-compat invariants

These invariants are **gating** — Phase-3 W-2 ships only if every one is green. CI on `autonomous-run` runs them on every commit touching `src/frontend/src/components/chat/**` or `src/backend/ai/response_formatter.py`.

1. **Legacy text path unchanged.** A `ChatMessage` with `response_form: 'text'` and `scene === undefined` renders as `<MessageBubble>` calling `<ResponseRenderer>` exactly as today (`src/frontend/src/components/chat/MessageBubble.tsx:97`, `src/frontend/src/components/chat/ResponseRenderer.tsx:46-48`). Pixel-snapshot vs commit `e12188f` at 1024×600 with 50 messages MUST be byte-identical.
2. **Wire format additive.** Removing or renaming any field in `src/shared/types/chat.ts:14-32` is a wire-break. Only ADD `scene?` (optional). Backend `_serialize_message` (`src/backend/api/routes_chat.py:99-130`) is the single round-trip authority.
3. **Tool catalog frozen.** `RESPONSE_FORM_TOOLS` (`src/backend/ai/response_formatter.py:12-224`) and `_FORM_MAP` (`src/backend/ai/response_formatter.py:230-239`) are NOT modified Day-4. The 7 `respond_*` tools keep their schema; Gemini's existing function-call selection is unchanged.
4. **Streaming semantics preserved.** WS `chat:stream` deltas at `src/backend/api/routes_chat.py:602-615` continue to ship plain-text deltas; the `scene` envelope rides only on the final `done:true` event.
5. **Motion budget preserved.** `getScaledDuration` is honoured everywhere via `getPhantomTransition` (ADR-CP-001); a user with `--motion-scale-user=0.5` still sees scaled motion in chat.
6. **Hardware-tier opt-in.** `ui_hardware_tier` defaults to `'high'`; existing deploys see zero visual change until an operator flips the Settings toggle.
7. **Feature-flag opt-in.** `chat_typed_cards_enabled` defaults to `False`; the `+` button is hidden until flipped.
8. **TS strict.** All new types added to `src/shared/types/chat.ts` compile under the existing strict config; `tsc --noEmit` is part of W-1 acceptance.
9. **No new Alembic migration.** `scene` rides JSON-on-JSON via existing `attachments_json` column. A real column is post-Day-4.
10. **Cross-cluster deps respect ADR boundaries.** ModelCard imports `DynamicPickerProps` from `src/shared/types/chat.ts`; W-4 produces the resolver. If W-4 slips, ModelCard ships with a flag-gated 3-item hard-coded fallback (cleanup ticket auto-filed by W-3 commit).

The pixel-snapshot baseline `e12188f` is the contract artefact — a reproducible image-diff is stored at `docs/architecture/chat-liveness-baselines/e12188f-text-50msg-1024x600.png` with the W-1 commit. All subsequent W-* commits MUST keep this image byte-identical when scene is absent.
