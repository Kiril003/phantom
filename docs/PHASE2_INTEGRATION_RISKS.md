# Phase-2 Integration Risks (cross-cluster)

**Reviewer**: C-INTEGRATION (Phase-2 cross-cutting reviewer 3-of-3)
**Baseline**: `53d16bc`
**Inputs**: `docs/architecture/{desktop-shell,chat-liveness,agent-orchestration,sandbox-runtime,ai-hub,profile-cards,identity-recognition,time-events,CROSS_CONTEXT_ADRS}.md`,
  `docs/PHASE1_DEPENDENCY_GRAPH.md`, `docs/PHASE1_BLOCK_ORDER.md`, `docs/PHASE1_CONTEXTS.md`.
**Status of cluster ADRs at review time**: 8 of 8 cluster ADRs landed
  PLUS one consolidated `CROSS_CONTEXT_ADRS.md` covering the 9 seeds named
  in `PHASE1_DEPENDENCY_GRAPH.md`. Re-read after the second 4 landed; risks
  below reflect the FULL set.

This file is the "do these specs actually compose?" review. It does not
duplicate single-cluster risks — those belong in each cluster ADR's own
§"Open questions". It catches the **cracks between** cluster ADRs.

---

## Critical (block Phase-3 start until resolved)

- **INTG-C1** — **Synthetic `chat-orch-*` `task_id` does NOT enforce any LLM-call budget**
  — ADRs in conflict: `agent-orchestration.md` ADR-ORC-007 (lines 124-134)
    vs. the actual `agent.runtime.AgentRuntime.note_llm_call` semantics
    at `src/backend/agent/runtime.py:484-518`.
  - **Conflict**. ORC-007 declares: "the runtime budget for `chat-orch-*`
    task ids is configured separately via `config.agent_max_llm_calls_per_task`
    (existing key) — orchestrator does *not* introduce a new budget knob;
    it reuses the existing one." (`agent-orchestration.md:131`). It then
    concedes: "the runtime's `note_llm_call` accepts unknown task_ids
    without raising (verified at provider.py:904-909 — the `try/except`
    swallows). This is acceptable: the budget-counter side-effect is what
    we need" (`agent-orchestration.md:132`).
  - **Reality**. `runtime.py:495-497` does `state = self._find_active(task_id)`,
    then on `state is None` returns True without incrementing any counter.
    The synthetic `chat-orch-<hex>` id is NEVER registered as an `AgentTask`
    (ORC-007:132 explicitly says it isn't), so `_find_active` always
    returns None. The "budget side-effect" the ADR claims to inherit
    **does not exist**.
  - **Impact**. U3-ORCH-H4 ("silent cost explosion") — the very threat
    the ADR claims to mitigate — remains UNCLOSED. With ai-hub's
    PEER-not-wrapper choice (`ai-hub.md` ADR-HUB-001) the existing AIRouter
    cooling/quota machinery still works, but per-turn LLM-call ceiling for
    parallel-K=3 (4× LLM cost) has NO upper bound.
  - **Decision needed**. Either (a) register a lightweight `chat-orch-*`
    track on `AgentRuntime` so `_find_active` resolves and the counter
    increments; or (b) introduce a dedicated
    `chat_orchestrator_max_llm_calls_per_turn` config key (default = `K + 1
    = 4`) wired into `orchestrator.run` directly, NOT via `note_llm_call`.
  - **Proposed resolution**. Option (b) — fewer cross-cluster moving parts.
    Lands as an X-4 amendment (90 LOC unchanged; adds 1 config key + 1
    counter). Drop the misleading paragraph at ORC-007:131-134 and replace
    with explicit "orchestrator owns its own per-turn counter" wording.

- **INTG-C2** — **`SceneKind` enum value mismatch between `chat-liveness.md`
  and `CROSS_CONTEXT_ADRS.md` (XC-002)**
  — ADRs in conflict: `chat-liveness.md:317-324` declares the closed Day-4
  `SceneKind = 'text' | 'list' | 'map-pin' | 'plan' | 'code-preview' |
  'identity-card'`, AND `chat-liveness.md:336-350` ships a `ScenePanel`
  union with the panel kind `'identity-card'`.
  Cross-context ADR `CROSS_CONTEXT_ADRS.md` ADR-XC-002 (lines 34-49)
  declares the wire as `ScenePanel{ kind: 'identity-ref', data: {
  speaker_id, label } }`.
  - **Conflict**. Same panel — two different `kind` strings: `'identity-card'`
    (cluster ADR) vs. `'identity-ref'` (cross-context ADR). Frontend
    `<ChatScene>` switch on `panel.kind` will fail to match one of the two.
    Backend JSON serialiser will pick whichever the implementer reads
    first, breaking interop.
  - **Impact**. W-2 implementer (480 LOC) compiles against the cluster
    ADR; speaker-id producer (Day-5 wire) targets `'identity-ref'`. The
    Day-5 hot-wire of identity-card scenes does not render. **This is
    a wire-break before any code lands.**
  - **Decision needed**. Pick one name. `chat-liveness.md` also declares
    a `data` shape `{ user_id, display_name, trust, facts[] }` (line 350)
    that is much richer than XC-002's `{ speaker_id, label }`. The two
    ADRs disagree on **both** the kind name AND the data shape.
  - **Proposed resolution**. Adopt the cluster ADR's name (`'identity-card'`)
    and richer data shape. Amend XC-002 wire to `ScenePanel{ kind:
    'identity-card', data: { user_id, display_name, trust, facts[] } }`
    where `user_id` carries the JWT-holder for Day-4 (resolver no-op per
    ADR-ID-002) and Day-5's resolver populates the speaker. Add a
    `speaker_id?: string | null` field on the data shape so the Day-5 wire
    matches XC-002's intent without renaming the kind.

- **INTG-C3** — **`plan-step` panel field-name and enum mismatches —
  XC-003 vs. chat-liveness vs. time-events SOH-005**
  — ADRs in conflict: three ADRs disagree on the `plan-step` panel/event
  schema:
    - `chat-liveness.md:348` — `data: { title: string; state: 'pending' |
      'active' | 'done' | 'error'; eta_ms?: number; note?: string }`
    - `CROSS_CONTEXT_ADRS.md:55-58` — `data: { order_id: string; title:
      string; status: 'pending'|'firing'|'done'|'skipped'; last_event_ts:
      number }`
    - `time-events.md:218-219` — emits `standing_order.fired` with payload
      `{order_id, action_kind, task_id, outcome_summary, fired_at_iso}` —
      no `title`, no `status`/`state`, no `eta_ms`.
  - **Conflict**. Three layers (rendering / wire / producer) disagree on:
    - field name `state` vs. `status`,
    - enum values `'active'|'error'` vs. `'firing'|'skipped'`,
    - presence/absence of `order_id`, `title`, `eta_ms`, `last_event_ts`,
      `outcome_summary`.
  - **Impact**. T-3 producer emits one shape; W-2 composer reads another;
    cross-context ADR documents a third. Frontend renders `undefined`
    strings and "unknown status" pills. `plan` scene is born broken.
  - **Decision needed**. Lock one shape across all three. Given the
    producer (time-events) is the most concrete (it ties to existing
    `StandingOrder` columns), recommend the producer-driven shape:
    `data: { order_id: string, action_kind: string, title: string,
    status: 'pending'|'firing'|'done'|'skipped', last_event_ts: number,
    note?: string }`. Add a `title` derivation rule on the time-events
    side: `title = StandingOrder.description` (existing column at
    `db/models.py:439-461`).
  - **Proposed resolution**. (a) Amend `chat-liveness.md:348` to match
    XC-003's `status` enum + `order_id` + `last_event_ts` fields; (b)
    amend `time-events.md` SOH-005 emit payloads to include `title`
    (derived from `StandingOrder.description`) on `fired` AND `skipped`
    AND `tick`; (c) the cross-context ADR XC-003 becomes the canonical
    contract — both producers and consumers cite XC-003.
  - **Severity**. Critical — Phase-3 W-2 + T-3 + Z-3 all fail acceptance
    without this lock.

---

## High (Phase-3 blocks should expect contract drift; pin order or defer)

- **INTG-H1** — **`asyncio.gather(return_exceptions=True)` (RTP-001) vs.
  `asyncio.wait(..., ALL_COMPLETED)` (ORC-005) — divergent posture for
  the same hazard**
  — ADRs in conflict: `desktop-shell.md` ADR-RTP-001 (lines 128-181) vs.
  `agent-orchestration.md` ADR-ORC-005 (lines 91-111).
  - **Conflict**. RTP-001 picks `asyncio.gather(..., return_exceptions=True)`
    for the lifespan G2 parallel warmups. ORC-005 picks `asyncio.wait(...,
    return_when=ALL_COMPLETED)` and explicitly **rejects** the gather
    pattern: "Not `asyncio.gather(*leaves, return_exceptions=True)` wrapped
    in `asyncio.wait_for(...)` — the latter cancels every survivor when
    the outer timeout fires" (`agent-orchestration.md:103-105`).
  - **Risk**. The two ADRs are solving subtly different problems (G2 has
    no outer wait_for; ORC-005 has one). The team will read both and
    assume one is wrong. Worse: a Phase-3 implementer wiring
    `chat_orchestrator_overhead_ms` histogram to an `asyncio.wait_for`
    wrapper will mistakenly cancel survivor leaves.
  - **Resolution proposed**. Add a one-line cross-ref in RTP-001
    §"Alternatives rejected" pointing to ORC-005's analysis: "Note:
    ORC-005 rejects `gather + wait_for` for the orchestrator because
    that path has an outer timeout. G2 has no outer timeout (failures
    only log WARN), so `gather(return_exceptions=True)` is safe here."
    Add reverse cross-ref in ORC-005.

- **INTG-H2** — **Histogram primitive (V-6) consumed by orchestrator
  (X-2) AND profile-cards (FACTS-1) AND ai-hub (Z-1/Z-3) in the same
  Wave-2**
  — ADRs cited consistently but registry not addressed:
  `desktop-shell.md` ADR-RTP-002 (lines 184-235) declares **three**
  registered histograms (`chat_response_latency_ms`,
  `voice_stt_latency_ms`, `ws_broadcast_latency_ms`).
  Three other clusters declare additional series:
    - `agent-orchestration.md:302` — `chat_orchestrator_overhead_ms`
    - `profile-cards.md:609-610` — `pii_encrypt_ms`, `user_facts_crud_ms`,
      `dynamic_source_resolve_ms`
    - `ai-hub.md` — implicit via `ai_hub_dispatch_total` Counter
      (different primitive, but same `_REGISTRY` list).
  - **Conflict**. RTP-002 freezes Day-4 to **three** registered instruments
    (`desktop-shell.md:287-296`); the other 4+ histogram series proposed
    elsewhere all touch `observability.py` — a file owned by the
    runtime-perf cluster. Wave-2 has V-6 plus X-1/X-2/X-4 plus FACTS-1
    plus Z-1 plus Z-2 plus Z-3 in parallel (per `PHASE1_BLOCK_ORDER.md:103-117`).
    Six-way merge conflict on `observability.py` is highly likely.
  - **Resolution proposed**. RTP-002 amends to declare the **Histogram
    class public** but the **registry open** — any `_register(Histogram(...))`
    call from any module is allowed Day-4. Each cluster registers its
    own histograms in its own module's bootstrap. Or: V-6 lands the 4
    additional named instruments as no-op stubs (observed=0 until their
    real call sites land) so `observability.py` is touched once.
  - **Severity**. High — implementer collision risk; defuses by ordering
    V-6 strictly before X-2/FACTS-1/Z-* in Wave-2.

- **INTG-H3** — **D-Bus carve-out (SBX-005) does not cover D-Bus address
  env injection**
  — ADRs in conflict: `sandbox-runtime.md` ADR-SBX-005 (lines 188-208)
  vs. ADR-SBX-003 (lines 117-152).
  - **Conflict**. SBX-005 says: "`DBUS_SESSION_BUS_ADDRESS` is reconstructed
    from the bind path inside the child via the standard freedesktop
    fallback rule (`unix:path=/run/user/$UID/bus`)"
    (`sandbox-runtime.md:196-198`). But SBX-003's `clean_env()` allowlist
    is `{PATH, HOME, LANG, LC_ALL, TERM}` —
    **`DBUS_SESSION_BUS_ADDRESS` is NOT in the allowlist**, and the
    fallback rule only fires when `notify-send` itself looks up the env
    var and finds it absent. Many GLib-based clients of `notify-send`
    pre-resolve via the libdbus connection, which **requires** the env
    var to be set explicitly.
  - **Risk**. `notify-send` may falsely fall back to WS toast on systems
    where libdbus needs the env var set explicitly (e.g. KDE Plasma
    sessions, some GNOME variants). Day-4 ships honest fallback behaviour
    but may not "actually deliver desktop notification on Plasma".
  - **Resolution proposed**. Either (a) extend `clean_env()` to take an
    optional `extra_keys: Iterable[str] = ()` argument and have notify
    call `clean_env(extra_keys=("DBUS_SESSION_BUS_ADDRESS",))`; or (b)
    document the fallback as the **expected** Day-4 behaviour in SBX-005
    and defer Plasma support to Day-5 with a tracking ticket.

- **INTG-H4** — **NotifyAction `target_user_id` not honoured by D-Bus
  carve-out**
  — ADRs in conflict: `time-events.md` ADR-SOH-003 NotifyAction (lines
  136-140) vs. `sandbox-runtime.md` ADR-SBX-005 (lines 188-208).
  - **Conflict**. SOH-003 declares `NotifyAction{ title, body,
    target_user_id?: string }` — implies the notification is targetable
    to a specific user (different than the session running the runner).
    SBX-005's D-Bus carve-out binds **`/run/user/$UID/bus`** where `$UID`
    is the runner's UID — fixed per-process. There's no way to deliver
    a desktop notification to user B from a runner running as user A.
  - **Risk**. SOH-004 dispatcher invokes `notify` action emitting via
    `event_bus.emit_async("notification.show", payload)` — that
    propagates through WS to the **frontend** (not desktop). Day-4
    actually sends only WS toasts; the SBX-005 D-Bus path is owned by
    `agent.actions.notify` (called from `chat_tool_dispatcher`), NOT by
    `agent.standing_orders.actions`. CROSS_CONTEXT_ADRS.md ADR-XC-008:163
    confirms this: "tray-toast deferred to Day-5".
  - **Resolution proposed**. (a) Document explicitly in SOH-003 that
    `target_user_id` is for the **WS-toast routing** layer (not D-Bus);
    Day-5 may add D-Bus targeting if the kiosk grows multi-X-session.
    (b) Add a one-line cross-ref note in XC-008 making this explicit.
  - **Severity**. High — operator UX expectations.

- **INTG-H5** — **`ScenePanel kind:'identity-card'` references
  `data.facts[].sensitive?: boolean` but PII decryption boundary
  unclear**
  — ADRs in conflict (latent): `chat-liveness.md:350` (panel data shape)
  vs. `profile-cards.md` ADR-FCT-002 (route auth) vs. ADR-XC-004
  (encrypt_pii contract).
  - **Conflict**. `chat-liveness.md:350` declares `facts: Array<{ id:
    string; label: string; value: string; sensitive?: boolean }>` —
    plaintext value. `profile-cards.md` ADR-FCT-002 says GETs are gated
    by `require_self_or_root` — only the user themselves OR ROOT can
    read. ADR-XC-004 enforces explicit `decrypt_pii` at the route
    handler. **However**: when chat-side composes an identity-card scene
    and broadcasts via `_broadcast_message_stream`, the WS push goes to
    the entire chat session — including potentially other participants
    who can SEE the WS frame (when multi-user kiosk has 2 users in one
    session, a future Day-5+ surface). The ADR set does not specify
    the scene-level redaction policy.
  - **Risk**. If a guest sees the assistant's reply containing
    identity-card facts of *the speaker* (which after Day-5 may differ
    from the JWT-holder), then PII tagged `sensitive: true` leaks via
    the WS broadcast.
  - **Resolution proposed**. Add a back-compat invariant to
    `chat-liveness.md` Day-4: "identity-card scene panels in a chat
    session WS broadcast MUST NOT include any fact whose `sensitive ===
    true` UNLESS the broadcasting session is single-user AND the
    target_user is the JWT-holder of that session." `output_safety.sanitize`
    Day-3 already redacts sensitive content at the textual layer; the
    structured panel layer needs the same gate. Lands as a 1-paragraph
    amendment + a redaction step in the picker (CS-003 §"Identity-card
    construction").
  - **Severity**. High — touches PII path; failure = PII leak in
    plaintext on WS broadcast.

- **INTG-H6** — **`tier='low'` panel-count cap = 4 (CP-002) vs. CS-001
  composer not enforcing it**
  — ADRs in conflict: `chat-liveness.md` ADR-CP-002 (lines 285-287) vs.
  ADR-CS-001 composer (`chat-liveness.md:31-67`).
  - **Conflict**. CP-002 says: "`<ChatScene>` enforces a panel-count cap
    of **4 max** (per `PHASE1_CONTEXTS.md:54`). Panels 5+ are collapsed
    into a `+N more` trailing affordance." But CS-001 ships 6 named
    presets, several of which declare panel compositions that already
    approach the cap (`plan` is `1×text + N×plan-step` — N is unbounded,
    likely > 4 for real standing orders). CS-001 does NOT mention any
    panel-count cap. The runtime check must live somewhere — currently
    no ADR section names the enforcer.
  - **Risk**. W-2 ships ChatScene composer without the cap enforcement;
    W-5 expects the cap to be enforced. Wave-2 has W-2 (480 LOC) and
    W-5 (140 LOC) in parallel. Cap enforcement is a 5-line method on
    `<ChatScene>` that falls between two cluster ADRs.
  - **Resolution proposed**. Add an explicit ADR-CS-001 §"Panel-count
    cap" addendum: composer accepts `tier` prop (already declared at
    `chat-liveness.md:382`), enforces `panels.length <= 4 when tier
    === 'low'`, truncates with `+N more` trailing panel. Lands with W-2.
  - **Severity**. High — without enforcement, a `tier='low'` Radxa boot
    can still render 50-plan-step scenes and tank to 22 fps.

- **INTG-H7** — **AIRouter peer (HUB-001) must NOT double-count
  `phantom_ai_provider_used_total`**
  — ADRs in conflict: `ai-hub.md` ADR-HUB-001 (lines 12-27) and
  ADR-HUB-004 (lines 73-103) declare a peer architecture; existing
  `phantom_ai_provider_used_total` counter
  (`src/backend/observability.py:283-294`) is incremented in
  `AIRouter._sync_context` (`provider.py:786-791`).
  - **Conflict**. HUB-001 says hub delegates back to `ai_router.generate`
    for Gemini/Ollama, so the existing counter increments naturally. But
    HUB-004 also adds `phantom_ai_hub_dispatch_total` with overlapping
    `provider` labels. An operator dashboard summing both will
    double-count. ADR-HUB-001 §Consequences (line 25) says "the existing
    `phantom_ai_router_fallthrough_total` counter is unchanged" but
    doesn't address `phantom_ai_provider_used_total` overlap.
  - **Risk**. The two counters' relationship is undocumented;
    `phantom_ai_hub_dispatch_total{provider=gemini, task_class=chat,
    decision=pick_remote}` and `phantom_ai_provider_used_total{provider=gemini}`
    will both increment on the same chat turn that goes via the hub.
  - **Resolution proposed**. ADR-HUB-004 amend §"Anti-cardinality clamp"
    to add: "Hub counters are ADDITIVE — operators MUST NOT sum
    `ai_hub_dispatch_total` with `ai_provider_used_total`. The hub
    counters are scoped to hub callers (Day-4: orchestrator only); the
    router counter is scoped to all callers (chat hot-path + orchestrator
    delegation). For 'total LLM calls', use `ai_provider_used_total`
    alone."
  - **Severity**. High for ops dashboards Day-5+; not a runtime bug.

- **INTG-H8** — **Z-4 dependency cycle: orchestrator (X-1) ↔ ai-hub (Z-1)**
  — ADRs cite each other consistently but the dependency graph at
  `PHASE1_DEPENDENCY_GRAPH.md:40-42` declares `chat_orchestrator → ai_hub
  → chat_orchestrator` — an explicit cycle.
  - **Conflict**. `ai-hub.md` ADR-HUB-006 (line 172) says hub's only
    Day-4 caller is the orchestrator. `agent-orchestration.md:321` (Open
    Questions) says "When Z-1..Z-4 land, sub-agents pick provider via
    `ai.hub.pick(task_class)` — Z-4 explicitly depends on X-1." The
    PHASE1_DEPENDENCY_GRAPH edge `chat_orchestrator → ai_hub` (line 40)
    AND `ai_hub → chat_orchestrator` (line 42) both exist.
  - **Risk**. The cycle is acceptable because the directions are about
    different things: orchestrator depends on hub for `pick()` (call-time);
    hub depends on orchestrator as the only consumer for Day-4
    (registration-time, integration ordering). But a future maintainer
    reading the graph will be confused.
  - **Resolution proposed**. Add a graph-level note in
    `PHASE1_DEPENDENCY_GRAPH.md:40-42`: "edge X→Y means 'X consumes Y at
    call-time'; the reverse edge `ai_hub → chat_orchestrator` is a
    **temporal** dependency for Day-4 only (Z-4 ordering after X-1)
    — not a runtime call-time cycle." OR remove the reverse edge, since
    Z-4 ordering is captured by `PHASE1_BLOCK_ORDER.md:15`.
  - **Severity**. High for docs clarity; not technical.

---

## Medium (cleanup post-Day-4)

- **INTG-M1** — **`PHANTOM_PACKAGED=1` env signal (DSH-003) is set by
  Tauri sidecar but DSH-002 path resolver also branches on it**
  — `desktop-shell.md` ADR-DSH-002 (lines 87-90) vs. ADR-DSH-003 (lines
  121-124).
  - **Conflict**. The same env var drives both behaviours. If Tauri's
    sidecar fork-spawn fails to set the env var (e.g. on a Windows
    installer where the variable inheritance is exotic), both behaviours
    silently revert to dev mode — no LAN bind refusal AND no platformdirs
    path rebase. The two failures compound: a half-installed PHANTOM
    running with `host=0.0.0.0` AND `./chroma_data` cwd in `Program
    Files`.
  - **Resolution proposed**. Tauri sidecar sets BOTH `PHANTOM_PACKAGED=1`
    AND `PHANTOM_PACKAGED_INSTALLER_VERSION=<semver>` so the absence of
    either is observable in `/healthz`. V-1 commit message must call
    this out.

- **INTG-M2** — **`F-40 realpath fix` (Y-4) and `paths.py` (V-2) both
  touch filesystem semantics**
  — `sandbox-runtime.md` ADR-SBX-006 (lines 213-249) vs. `desktop-shell.md`
  ADR-DSH-002 (lines 58-93).
  - **Conflict**. SBX-006 hardens `agent.actions.fs.write` against
    symlink escape from `ctx.workspace_dir`. V-2 introduces
    `resolve_data_dir(...)` that returns paths under platformdirs
    locations. Are platformdirs paths symlink-clean on Windows where
    `%APPDATA%` itself can be a junction? V-2 doesn't say. If
    `resolve_data_dir("workspace")` returns a junction-traversed path,
    the workspace bind in bwrap (`sandbox-runtime.md:108-110`) may bind
    a different physical path than `ctx.workspace_dir` declares.
  - **Resolution proposed**. V-2 adds an `os.path.realpath()` call in
    `ensure_data_dirs()` so the materialised paths are realpath-canonicalised
    before being handed downstream. Free for SBX-006 (`realpath_inside`
    works on already-canonical paths).

- **INTG-M3** — **`scene` JSON-on-JSON persistence (CS-002) vs. ID-3
  `speaker_user_id` real column — share the migration**
  — `chat-liveness.md` ADR-CS-002 (lines 108-112) vs.
  `identity-recognition.md` ADR-ID-004 (lines 118-153).
  - **Conflict**. CS-002 explicitly defers a real DB column for `scene`
    to avoid an Alembic migration: "Why not add a column: avoids an
    Alembic migration during chat-liveness rollout"
    (`chat-liveness.md:111`). But ID-3 (per `identity-recognition.md:147`)
    DOES add a migration on the same `chat_messages` table — though
    using raw `ALTER TABLE` rather than Alembic. The migration constraint
    that CS-002 sidesteps is paid anyway.
  - **Resolution proposed**. Roll CS-002's `scene` field into the same
    raw migration as ID-3's `speaker_user_id`. One ALTER, two columns.
    Saves a Day-5 cleanup ticket. ID-3's idempotent `try/except
    OperationalError` pattern handles the second column trivially.

- **INTG-M4** — **`output_safety.sanitize` called K+1 times (ORC-003)
  multiplies a per-call ceiling**
  — `agent-orchestration.md` ADR-ORC-003 (lines 53-67).
  - **Conflict**. ORC-003 says: "the `examined_facts` metric
    (output_safety.py:131) doubles in volume per parallel-K turn —
    acceptable: Day-3's 200-row LIMIT in `_load_user_sensitive_facts`
    (output_safety.py:227-233) is a per-call ceiling, not per-user." Yet
    each leaf reloads the same 200 rows independently — that's `K *
    200 = 600` row-fetches per parallel-K=3 turn vs. 200 in single-turn.
    SQLite read contention is bounded but the 4× memory traffic is real.
    With FACTS-1 added, the leaf MAY also trigger UserFact decryption
    on the same query path.
  - **Resolution proposed**. `sub_agent.run_leaf` accepts a pre-loaded
    `sensitive_facts` list passed by `orchestrator.run` (one fetch, K
    sanitize calls share the list). Day-5 micro-optimisation.

- **INTG-M5** — **`chat_typed_cards_enabled` flag (CI-001) vs.
  `chat_orchestrator_enabled` flag (ORC-001) — independent toggles for
  one user-visible feature**
  — `chat-liveness.md` ADR-CI-001 (lines 187-189) vs.
  `agent-orchestration.md` ADR-ORC-001 (lines 13-22).
  - **Conflict**. ModelCard echo (CI-001) lets the user pick a provider;
    orchestrator (ORC-001) decides provider routing. If both flags are
    on, user picks "ollama" via ModelCard but orchestrator falls through
    to single-turn (because Gemini-only gate). User sees no parallel-K
    — the UX promise of "pick a model" is undocumented when paired with
    orchestrator routing.
  - **Resolution proposed**. ORC-001 amend §Consequences: "When
    `chat_typed_cards_enabled` is also True AND the user-attached
    ModelCard selects a non-Gemini provider, the orchestrator falls
    through to single-turn — but the response surface still indicates
    ModelCard was honoured. Day-5 hardens Ollama parity then re-enables
    parallel-K under Ollama too."

- **INTG-M6** — **CI-001 fallback to "hard-coded list of 3 candidate
  models" stale once XC-007 lands**
  — `chat-liveness.md:199` vs. `CROSS_CONTEXT_ADRS.md:133-149` (XC-007).
  - **Conflict**. CI-001 declares a "if W-4 slips" fallback path. XC-007
    treats W-4's `<DynamicPicker source="ollama_models">` as the
    canonical body of `<ModelCard>` — no fallback path. Wave-2 has W-3
    and W-4 in parallel; a slip on either side leaves the other in an
    ambiguous state.
  - **Resolution proposed**. Make W-4 a hard prerequisite of W-3 in
    `PHASE1_BLOCK_ORDER.md`; OR retain the CI-001 fallback as the
    canonical degraded mode and add it to XC-007 explicitly.

- **INTG-M7** — **profile-cards FACTS-1 RBAC and ADR-XC-002
  identity-ref consumer mismatch on `display_name`**
  — `chat-liveness.md:350` declares `data: { user_id, display_name,
  trust, facts[] }` but no ADR specifies whether `display_name` is
  user-visible across guest sessions.
  - **Conflict**. CS-002's identity-card panel includes `display_name`.
    `profile-cards.md` ADR-FCT-003's `_user_to_dict(include_private=False)`
    returns `username` (line 219) — but **never** a separate
    `display_name`. The picker route (`identity-recognition.md` ADR-IDB-003,
    line 234) returns `username` + `avatar_url` only.
  - **Risk**. W-2 implementer of identity-card scene pulls `display_name`
    from… where? `User.username`? Or a future `User.display_name` column?
    No ADR specifies.
  - **Resolution proposed**. Pin in CS-002 amendment: "`display_name` is
    sourced from `User.username` Day-4; Day-5+ may introduce
    `User.display_name` as a separate column with FACTS-1 PII gating."

- **INTG-M8** — **time-events `scripts/migrate_oneshot_utc.py` (T-4)
  vs. desktop-shell paths.py packaging**
  — `time-events.md:251-253` defines an ops migration script. V-1 Tauri
  ship doesn't enumerate ops scripts as part of the desktop bundle.
  - **Risk**. Operator running the packaged Radxa ship who hits a UTC
    issue has no way to invoke the script (PyInstaller `--onedir` ships
    the bundled `phantom-backend` binary, not loose scripts).
  - **Resolution proposed**. V-7 (requirements split, post-Day-4) adds
    an entry-point script that is `phantom-backend migrate-oneshot-utc`
    — runnable from the packaged binary. T-4 ADR amends to also expose
    a CLI subcommand under the same banner.

---

## Cross-context ADR seeds confirmed

`PHASE1_DEPENDENCY_GRAPH.md:99-111` enumerates 9 cross-context ADR seeds.
Below is each seed's status as of this review (post-second-batch landing).

| Seed (from PHASE1_DEPENDENCY_GRAPH.md) | Status | Owner / Coverage |
|---|---|---|
| chat-orchestrator → ai-hub: `hub.pick(task_class) -> ProviderHandle` | **CONSISTENT** | `CROSS_CONTEXT_ADRS.md` ADR-XC-001 + `ai-hub.md` ADR-HUB-001/006 + `agent-orchestration.md` ADR-ORC-001 align. Z-4 wires the call. |
| chat-scenes → speaker-id-foundation: `ScenePanel{ kind:'identity-ref', ... }` | **CONFLICT** | XC-002 uses `'identity-ref'`; cluster ADR uses `'identity-card'`. **See INTG-C2.** |
| chat-scenes → standing-orders-harden: `ScenePanel{ kind:'plan-step', ... }` | **CONFLICT** | XC-003 + cluster ADR + producer disagree. **See INTG-C3.** |
| user-facts → crypto-primitive: `encrypt_pii(plaintext) -> str` Fernet token | **CONSISTENT** | XC-004 + `profile-cards.md` ADR-CRP-001/002 + ADR-FCT-001 align. |
| sandbox-runtime → radio-capabilities-reserved: `SandboxProfile.radio_privileged` raises | **CONSISTENT** | XC-005 + `sandbox-runtime.md` ADR-SBX-002 + ADR-RAD-001 align. |
| desktop-shell → runtime-perf: Tauri sidecar splash duration tied to `/readyz` G1 vs G2 | **CONSISTENT** | XC-006 + `desktop-shell.md` ADR-DSH-001 + ADR-RTP-001 align. |
| chat-input → dynamic-source-picker: `<DynamicPicker source="model"/>` reused | **CONSISTENT** | XC-007 + `profile-cards.md` ADR-DSP-002 + `chat-liveness.md` ADR-CI-001 align (modulo INTG-M6 fallback wording). |
| standing-orders-harden → profile-cards: notify action-kind payload | **PARTIAL** | XC-008 covers chat-scene rendering; D-Bus targeting deferred per INTG-H4. |
| chat-orchestrator → sandbox-runtime: NO-EXEC chat path (negative ADR) | **CONSISTENT** | XC-009 + `agent-orchestration.md` ADR-IGD-001 + `sandbox-runtime.md` ADR-SBX-002 align. |

**Summary**. 6 of 9 fully consistent. 1 partial (notify D-Bus targeting
gap). 2 with critical naming/shape conflicts (INTG-C2 + INTG-C3).

---

## Phase-3 sequencing dependencies surfaced

Dependencies the Phase-1 BLOCK_ORDER did not explicitly call out. Each
is a proposed `blocks_blocked_by` addition.

1. **W-2 (ChatScene composer) `blocks_blocked_by`: ID-3 (speaker_user_id
   migration), T-3 (event_bus standing-order events), W-2b
   (phantomVariants), AND resolution of INTG-C2 + INTG-C3.**
   — Reason: `SceneKind` includes `identity-card` and `plan` (closed
   enum per CS-001); panels render `undefined` if their producers
   haven't shipped their wire shape AND the wire shape is locked.
   Currently W-2 is in Wave-2 alongside ID-3 and T-3 — ordering must
   be ID-3 + T-3 first, then W-2.
   — Alternative: amend CS-001 to ship a 4-kind enum Day-4 (text, list,
   map-pin, code-preview) and defer `plan` and `identity-card` to Day-5.

2. **X-1 (orchestrator skeleton) `blocks_blocked_by`: V-6 (Histogram
   primitive)**
   — Reason: ORC's `chat_orchestrator_overhead_ms` series (per
   `agent-orchestration.md:302`) needs the Histogram class. Same
   applies to FACTS-1 / Z-* (per INTG-H2).

3. **W-3 (ModelCard echo) `blocks_blocked_by`: W-4 (DynamicPicker
   resolver)**
   — Already declared as soft-dep in CI-001 (fallback to hard-coded
   list); propose hardening to true `blocks_blocked_by` to eliminate
   ambiguity (INTG-M6).

4. **W-2 (ChatScene composer) `blocks_blocked_by`: W-2b (phantomVariants)**
   — Already implied by the `getPhantomTransition('panelReveal')` usage
   in CS-001; explicitly declare it. W-2b is currently a peer in Wave-2
   — must come first.

5. **X-2 (per-sub-agent nonce) `blocks_blocked_by`: V-6 (Histogram)
   AND ORC-007 resolution (INTG-C1)**
   — Reason: per-leaf sanitize counter requires the histogram primitive;
   silent budget bypass (INTG-C1) must be resolved before X-2 ships its
   counter writes.

6. **Y-2 (bash + mcp adapter retarget) `blocks_blocked_by`: Y-5
   (sandbox settings surface)**
   — Reason: Y-2 reads `config.agent_sandbox_profile_default` to pick
   the profile per call site; the config key is added by Y-5. Currently
   Y-2 is already declared `blocks_by Y-1` per
   `PHASE1_BLOCK_ORDER.md:112`; add Y-5 to that list.

7. **T-3 (standing-order events) `blocks_blocked_by`: W-1 (SceneKind
   types) AND resolution of INTG-C3**
   — Reason: `standing_order.fired/skipped/tick` payload shape must
   match `ScenePanel kind:'plan-step'.data` (XC-003 closed shape). W-1
   ships the types; T-3 produces values. INTG-C3 must resolve before
   either ships.

8. **FACTS-1 (UserFact CRUD) `blocks_blocked_by`: CRYPTO-1 (already
   declared) + V-6 (Histogram for `pii_encrypt_ms`,
   `user_facts_crud_ms`)**
   — V-6 dependency added per INTG-H2.

9. **Z-4 (orchestrator consumes hub) is in Wave-3 (optional) per
   `PHASE1_BLOCK_ORDER.md:135`** — but `CROSS_CONTEXT_ADRS.md` ADR-XC-001
   states Z-4 is the canonical wire for orchestrator-Hub. If Wave-3
   slips, orchestrator's leaf-spawn keeps the Day-4 hardcoded
   `ai_router.get_provider(config.ai_primary_provider)` path. This is
   documented in HUB-006 as "30-40 LOC". Recommend: do not bump Z-4 to
   Wave-2 unless X-1 ships in Wave-2 first.

---

## Recommended Phase-3 readiness gate

Before Phase-3 Wave 1 starts:

- [ ] **INTG-C1 resolved** — orchestrator owns its own LLM-call counter,
  NOT via `note_llm_call`. X-4 amendment lands with explicit
  `chat_orchestrator_max_llm_calls_per_turn` config key.
- [ ] **INTG-C2 resolved** — pick one name (`'identity-card'` or
  `'identity-ref'`) and one data shape; amend whichever side disagrees.
- [ ] **INTG-C3 resolved** — pin `plan-step` schema across all three
  layers (chat-liveness, time-events SOH-005, XC-003); amend cluster
  ADRs to cite XC-003 as canonical.
- [ ] All 9 cross-context ADR seeds covered by either a single-context
  ADR section or a new cross-context ADR doc — currently 6 of 9 fully
  green; 1 partial (INTG-H4); 2 critical (INTG-C2 + INTG-C3).
- [ ] INTG-H1 cross-references added between RTP-001 and ORC-005 to
  prevent implementer conflation.
- [ ] INTG-H2 ordering: V-6 lands before X-1/X-2/FACTS-1/Z-* in Wave-2
  OR Histogram registry made open in RTP-002 amendment.
- [ ] INTG-H6 enforcement: ADR-CS-001 amends with explicit panel-count
  cap method on `<ChatScene>`.
- [ ] INTG-H5 PII boundary: chat-liveness amends with WS-broadcast
  redaction policy for identity-card scenes.

If only items in §Critical resolve and §High remain open, Wave-1 may
proceed (Wave-1 blocks do not touch the High-risk surfaces). Wave-2
must wait on all High items.

**Headline recommendation**: 3 Critical risks (all wire-format /
budget-correctness; not architectural rework). Resolutions are 1-day
amendments to existing ADR docs, no new ADRs needed. **Recommend:
escalate the 3 Critical items to operator for rapid amendments, then
proceed with Phase-3 Wave 1 immediately**. Wave 1 blocks (CRYPTO-1,
V-2/3/4, W-1/2b, X-3, Y-4, T-4, ID-1/2/3, IDB-1) are cross-context-clean
per `CROSS_CONTEXT_ADRS.md:198-201` and not gated by the Critical risks.

---

**End of `docs/PHASE2_INTEGRATION_RISKS.md`.**
