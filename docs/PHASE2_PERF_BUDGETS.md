# Phase-2 Performance Budgets (cross-cluster)

**Reviewer**: C-PERF (Phase-2 cross-cutting reviewer 3 of 8 — Day-4).
**Baseline**: `53d16bc` (`docs/PHASE1_BLOCK_ORDER.md` + 4 cluster ADRs in `docs/architecture/`).
**Mission**: lock end-to-end latency budgets, idle-tick load, and frame-budget gates so PHANTOM still feels alive on a fanless Q6A at 1024×600. Every number below is **the SLO Phase-3 acceptance must hit** — overruns trigger ADR amendment, not silent regression.

The four cluster ADRs reviewed:
- `docs/architecture/desktop-shell.md` (clusters `desktop-shell` + `runtime-perf`)
- `docs/architecture/chat-liveness.md` (clusters `chat-scenes` + `chat-input` + `chat-perf`)
- `docs/architecture/agent-orchestration.md` (clusters `chat-orchestrator` + `import-gate-discipline`)
- `docs/architecture/sandbox-runtime.md` (clusters `sandbox-runtime` + `radio-capabilities-reserved`)

---

## End-to-end SLOs (Day-4 acceptance gates)

| Path | p50 | p95 | p99 | Source histogram | Block |
|---|---:|---:|---:|---|---|
| Lifespan G1 (sync deps) → `/readyz` first 200 | — | 800 ms | 1500 ms | `phantom_lifespan_g1_ready_ms` | V-5 (`docs/architecture/desktop-shell.md` ADR-RTP-001) |
| Lifespan G2 (parallel warm) → voice ready | — | 2500 ms | 4500 ms | `phantom_lifespan_g2_ready_ms` | V-5 (same; budget tight vs. ADR's 2 s p95 target — see Risks) |
| Chat → first scene render @ tier=high | 250 ms | 600 ms | 1500 ms | `phantom_chat_response_latency_ms` | V-6 + W-2 (`docs/architecture/chat-liveness.md` ADR-CS-001) |
| Chat → first scene render @ tier=low | 350 ms | 900 ms | 2000 ms | (same, label `tier="low"`) | V-6 + W-5 (ADR-CP-002) |
| WS broadcast → client render | 50 ms | 150 ms | 400 ms | `phantom_ws_broadcast_latency_ms` | V-6 (ADR-RTP-002) |
| STT (NPU Whisper) → first transcript | 80 ms | 250 ms | 600 ms | `phantom_voice_stt_latency_ms` (label `engine`) | V-6 |
| Orchestrator parallel-K=3 (when fired) | 1500 ms | 3500 ms | 5000 ms | `phantom_chat_orchestrator_overhead_ms` | X-2/X-4 (`docs/architecture/agent-orchestration.md` ADR-ORC-004) |
| `pick()` AI Hub registry lookup | 0.1 ms | 0.5 ms | 1 ms | `phantom_ai_hub_pick_ms` | Z-1 |
| UserFact CRUD round-trip | 5 ms | 15 ms | 30 ms | `phantom_user_facts_op_ms` | FACTS-1 |
| Standing-order tick @ 100 due | 30 ms | 50 ms | 100 ms | `phantom_standing_orders_tick_ms` | T-3 |
| Bwrap fork+exec overhead vs bare `/bin/true` | 15 ms | 30 ms | 60 ms | `phantom_sandbox_wrap_overhead_ms` | Y-1 (`docs/architecture/sandbox-runtime.md` ADR-SBX-001 line 449) |
| `realpath_inside()` (depth ≤ 8) | 1 ms | 3 ms | 5 ms | `phantom_sandbox_realpath_ms` | Y-4 (ADR-SBX-006) |

**Budget anchor for chat hot-path**. Today the chat round-trip latency is captured into JSON metadata via `routes_chat.py:502 (latency_ms = int((time.monotonic() - t_start) * 1000))` and persisted at `routes_chat.py:527` — never aggregated. V-6 lifts that scalar into a Histogram. The 600 ms p95 is conservative vs. today's measured chat-pipeline turn (`config.chat_tool_max_total_ms = 12_000` ms ceiling, see `src/backend/config.py:505`); a single-turn no-tool chat must clear ten times faster than the wall-clock cap or the assistant feels dead.

**Budget anchor for orchestrator overhead**. ADR-ORC-004 (`docs/architecture/agent-orchestration.md` lines 71-87) splits the same 12 s ceiling: `per_sub=3500`, `merge_reserve=1500` for K=3. The +300 ms p95 *overhead* declared at ADR-ORC-001's perf table (lines 295-300) is the **net new cost vs. single-turn**, NOT total turn latency — the histogram MUST observe overhead alone (delta vs. the path that didn't take the orchestrator branch), or the metric becomes useless for "is the flag worth flipping?" decisions.

---

## Frame budget at 1024×600 (Q6A Adreno)

Hardware tier flag: `config.ui_hardware_tier: 'low' | 'high'` (default `high`) per `docs/architecture/chat-liveness.md` ADR-CP-002 lines 270-307.

- **Max simultaneous backdrop-filter layers**: **3** at tier=high, **1** at tier=low. The current stack at 50-message scrollback is ~57 layers (50 bubbles × 1 blur + 1 sidebar + 1 input + 3 ambient + 2 orb — measured at `chat-liveness.md:274`); a hard cap is **30 simultaneously rendered glass-bubbles** via virtualisation (W-5 stack-depth gate at `chat-liveness.md:288-289`).
- **Max ScenePanel count per scene**: **6** at tier=high, **4** at tier=low ("+N more" affordance for overflow). Gate from `docs/PHASE1_CONTEXTS.md:54` ("panel-count budget = 4 max @ tier=low").
- **Voice-amp store-write cadence**: **30 Hz max** (rAF coalesced); raw Whisper streaming at 30-60 Hz must be throttled. Required because `Orb.tsx:33` reads `voiceAmplitude` from the store on every change, and the current 100 Hz mic update path (`ChatWindow.tsx:108-111` — see ADR-CP-002 voice-amplitude rAF throttle, lines 292-293) re-renders the orb 100×/s. Even at tier=high this must hold or the orb halo's `filter: blur(36px) brightness(...)` (`Orb.tsx:48`) re-paints faster than the GPU can clear.
- **60 fps sustain target during scene reveal animation**. Stagger 80 ms × 6 panels = 480 ms total scene assembly; `getScaledDuration` (`src/frontend/src/styles/motion.ts:52-59`) must not drop below 50 fps under reveal at tier=low.
- **Orb halo blur radius**: 36 px at tier=high (`Orb.tsx:48`), MUST be replaced with a flat radial-gradient at tier=low per ADR-CP-002 line 284.
- **AmbientGlows**: 3 × 110-120 px blur layers at tier=high (`AmbientGlows.tsx:21,34,48`); MUST early-return `null` at tier=low per ADR-CP-002 line 283.
- **Drop `chat_stream_delay_s` artificial sleep**: confirmed live at `routes_chat.py:610` — replaces real network latency with synthetic pacing. ADR-CP-002 (lines 296-297) flips default to `0.0` and skips the sleep when delay=0.

---

## Idle-tick budget

- **`_context_loop` tick rate**: **2 Hz when presence detected, 0.5 Hz when idle** (V-9, `docs/PHASE1_BLOCK_ORDER.md:74`). Today the loop fires unconditionally at the configured cadence regardless of `voiceAmplitude == 0` and zero-presence sensor reads.
- **Proactive loop**: 30-300 s adaptive. Day-3 unchanged in Day-4 — `agent.proactive.ProactiveLoop` retains its silence-clock semantics (`main.py:470-485`).
- **Standing-orders runner**: 1 Hz tick (today's default), Day-4 unchanged. T-3 adds event-bus fan-out without changing the tick rate.
- **ChromaDB heartbeat**: every 5 s on `/readyz` only (Day-3 D3-A-6, `observability.py:367-385`). NOT per-call — the eager-init path at `main.py:283-301` removed the cold-scan cost from every probe.
- **CPU sampler**: 1 Hz background task (`main.py:344-349` → `system_metrics_sampler`); single `psutil.cpu_percent` per second. No change Day-4.
- **OLED animator**: self-gated via `oled_animation_enabled` (`main.py:432-433`); when disabled, no I/O.
- **Emotion decay**: cadence from `agent_emotion_decay_interval_s` config; only fires when foreground task active (`main.py:455-465`).

**Idle-CPU target**: with operator absent (no presence, no chat, no voice), system idle CPU ≤ **3 %** of one Q6A core. Without V-9 (presence-aware tick) we measured ~7 % from the always-on `_context_loop` + janitor/sampler stack — V-9 is the single biggest idle-CPU win Phase-3 can ship.

---

## Per-cluster perf risks

Walk each ADR and call out budget overruns or gaps the ADR doesn't fully close.

### `runtime-perf` cluster (V-5, V-6, V-8, V-9)

- **R-PERF-1 (HIGH) — G2 p95 ≤ 2 s contradicts ADR-RTP-001 lane content**. ADR-RTP-001 (`desktop-shell.md:155-181`) parallelises **5 lanes**: MiniLM warm, Chroma eager init, Chroma janitor, CPU sampler, `preload_voice_models`. The `preload_voice_models` lane today costs 8-10 s on cold first-load (per `main.py:351-366` comment). The ADR's stated p95 ≤ 2 s **only holds because the WS hub accepts at G2-complete and "Whisper warm not required for first WS — voice path lazy-fails on cold"** (lines 153-154). C-PERF concurs with this design but flags that the histogram bucket boundaries `(5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000)` (`desktop-shell.md:266`) MUST include a 2500 ms boundary — they do, but a 1500 ms boundary would tighten p95 reporting. Acceptable Day-4.
- **R-PERF-2 (MED) — Histogram observe() under chat hot-path lock**. ADR-RTP-002 budgets observe() at p99 ≤ 50 µs (`desktop-shell.md:359`). The hot-path is `routes_chat._build_ai_response`, which already calls `observability.chat_messages_total.inc()` (see `routes_chat.py:323-325`). C-PERF requires the Histogram observe() to mirror Counter.inc()'s no-lock dict update (no asyncio yield, no I/O). The spec already says so (`desktop-shell.md:396-397`); pin via test `test_histogram_observe_no_yield`.
- **R-PERF-3 (MED) — V-8 chat commit deferral has no histogram instrumentation**. V-8 (`PHASE1_BLOCK_ORDER.md:73`) defers geo/fact/behavioral writes via `create_task`. Without a `phantom_chat_post_turn_pending_tasks` gauge, an operator can't see the deferred-write backlog grow under load. C-PERF recommends adding a gauge to V-8 even though it's not in the ADR; cross-reference V-6 Histogram registry at line below.

### `chat-perf` cluster (W-5)

- **R-CHAT-1 (HIGH) — Voice-amp throttle target ambiguity**. ADR-CP-002 (`chat-liveness.md:292-293`) says "≤ 60 Hz under 100 Hz mic input"; the perf budget table (`chat-liveness.md:460`) repeats "≤ 60 Hz". C-PERF DOWNGRADES this to **30 Hz max** for the Zustand store write — at 60 Hz the orb halo (`Orb.tsx:48-50`) re-paints fast enough to chew Adreno fillrate even at tier=high. 30 Hz is enough to feel "live" (human flicker fusion is ~24 Hz); 60 Hz double-buffers GPU work for no visible gain. Pinned in Frame budget section above.
- **R-CHAT-2 (MED) — `<ChatScene>` first-paint p50 ≤ 250 ms (high) / 350 ms (low)** — ADR-CP-002 at `chat-liveness.md:455-456`. C-PERF concurs but flags the implicit dependency: this number assumes the scene envelope rides only on the WS `done:true` event (per ADR-CS-002 lines 113-115). If a future block sneaks scene partials into stream chunks, the 250 ms target is invalidated because intermediate layouts force re-reconciliation per chunk. Pin invariant: scene-on-final-only.
- **R-CHAT-3 (LOW) — `chat_stream_delay_s` removal needs default-0.0 + skip-sleep gate**. ADR-CP-002 line 297 ("when `config.chat_stream_delay_s = 0.0`"). The current code at `routes_chat.py:610` calls `await asyncio.sleep(config.chat_stream_delay_s)` unconditionally; setting to 0.0 still pays one event-loop yield. W-5 must explicitly `if config.chat_stream_delay_s > 0:` to skip the await entirely. Two-line fix; CI-test it.

### `chat-orchestrator` cluster (X-1, X-2, X-4)

- **R-ORCH-1 (HIGH) — Orchestrator overhead budget needs delta-histogram, not total-latency**. ADR-ORC-001 perf table (`agent-orchestration.md:295-300`) declares "+120 ms p50, +300 ms p95" overhead vs. single-turn fall-through. The histogram primitive landing in V-6 doesn't natively express deltas. C-PERF requires `phantom_chat_orchestrator_overhead_ms` to observe `(orchestrator_total_ms - max(leaf_completed_ms))` — i.e., the parallelisation-failure tax — NOT total turn latency. Otherwise the histogram conflates "K=3 leaves all fired" with "single-turn fall-through" because both pass through the entry function. Add this to V-6's instrument list.
- **R-ORCH-2 (MED) — Per-sub-agent nonce generation cost**. ADR-ORC-002 (`agent-orchestration.md:30-50`) calls `secrets.token_hex(8)` per leaf invocation. K=3 leaves + 1 merge × `~1 µs` per call = ~4 µs per turn — negligible. **No risk**, documented for completeness.
- **R-ORCH-3 (MED) — `asyncio.wait(ALL_COMPLETED)` post-deadline cleanup cost**. ADR-ORC-005 cancels surviving pending leaves (`agent-orchestration.md:100-101`). Cancel propagation through `chat_tool_dispatcher.dispatch`'s own `asyncio.wait_for` (`chat_tool_dispatcher.py:116-119`) is bounded but not zero — under K=3 with one slow leaf the cleanup can take ~50 ms. Acceptable; covered by the +300 ms p95 envelope.

### `chat-scenes` + `chat-input` clusters (W-1, W-2, W-2b, W-2c, W-3, W-3b, W-4)

- **R-SCENE-1 (MED) — `_serialize_message` re-promotion overhead**. ADR-CS-002 (`chat-liveness.md:108-115`) rides scenes through `attachments_json`, requiring `_serialize_message` (`routes_chat.py:99-130`) to round-trip-promote on read. Per-message JSON parse + dict-walk is O(panels) — for 50 messages × 6 panels = 300 dict allocations on session reload. At 1 ms per parse we add 300 ms to session GET. C-PERF requires a single-pass serialiser micro-benchmark in W-1: ≤ 5 ms for 50 messages, asserted via `pytest-benchmark`.
- **R-SCENE-2 (LOW) — Pixel-snapshot baseline at 1024×600 enforces back-compat**. ADR-CS-002 invariant 3 (`chat-liveness.md:118-122`) pins the legacy text path byte-identical vs. commit `e12188f`. Phase-3 W-1 acceptance MUST file the baseline image at `docs/architecture/chat-liveness-baselines/e12188f-text-50msg-1024x600.png`. Without it, any subsequent W-2/W-2b commit silently regresses. Risk = no risk if W-1 lands the snapshot; HIGH if W-1 ships the types but skips the baseline.

### `desktop-shell` + `sandbox-runtime` clusters (V-1..V-7, Y-1..Y-6)

- **R-DSH-1 (LOW) — Tauri WebView init dominates splash**. ADR-DSH-001 (`desktop-shell.md:48-51`): "Splash gate: Tauri's WebView shows a splash until `/readyz` returns 200; per ADR-RTP-001 G1+G2 lanes complete in ≤ 2 s". Stated splash budget: **≤ 2.5 s** (`desktop-shell.md:363`). C-PERF concurs; Tauri's own WebView init on Q6A WebKitGTK is ~500 ms cold — the 500 ms is **Tauri's tax, not ours**. Pin: `/readyz` first-200 latency goal stays at **800 ms p95** (G1) regardless of Tauri.
- **R-SBX-1 (MED) — `bwrap` fork+exec overhead under repeated MCP `call_tool`**. ADR-SBX-001 budgets ≤ 30 ms median per `bash.run` / `mcp.call_tool` (`sandbox-runtime.md:449`). For a chat turn that calls 3 tools (e.g., `recall_memory_facts` + `get_system_metrics` + `read_workspace_file`), that's 90 ms of pure sandbox overhead. Inside the chat hot-path's 600 ms p95 ceiling this is 15 % — acceptable but tight. C-PERF recommends Y-1 ship a `phantom_sandbox_wrap_overhead_ms` histogram so the budget is observable, not just asserted in a benchmark test.
- **R-SBX-2 (LOW) — `realpath_inside()` per-component walk**. ADR-SBX-006 budgets ≤ 5 ms for path depth ≤ 8 (`sandbox-runtime.md:451`). For typical workspace paths (`~/phantom/workspace/<task_id>/file.py`) depth is 4-5; ≤ 3 ms p95 in practice. No risk.

### `ai-hub` cluster (Z-1..Z-5)

- **R-HUB-1 (LOW) — `pick()` lookup is hot**. Day-4 Z-1 ships skeleton; Z-4 wires sub-agent dispatch via `hub.pick(task_class)`. Every leaf invocation in the orchestrator hits `pick()` → K=3 calls per parallel-K turn × ~hundreds of turns/hour. Budget 0.1/0.5/1 ms (p50/p95/p99) is tight enough that the registry MUST be a frozen dict, not a SQLAlchemy lookup. Pin in Z-1's ADR (currently TBD per `PHASE1_CONTEXTS.md:96`) — not yet authored as of `53d16bc`.
- **R-HUB-2 (MED) — telemetry storage TBD**. `ai/hub_telemetry.py` (`PHASE1_CONTEXTS.md:93`) is skeleton only. If telemetry writes ride into the same SQLite that the chat path is committing on (V-8 deferral seam), the lock contention reappears. Phase-3 Z-1 must declare a separate telemetry table or use an in-memory ring buffer.

### `time-events` cluster (T-1..T-6)

- **R-TIME-1 (HIGH) — Standing-order tick @ 100 due**. Budget 30/50/100 ms (p50/p95/p99). The runner today loads all due rows at each tick (`agent.standing_orders.runner`); at 100 due rows × ~3 ms per dispatch evaluation = 300 ms — 3× over budget. T-3 (`PHASE1_BLOCK_ORDER.md:42`) introduces event-bus fan-out which preserves the per-row work; the budget is achievable only with a SQL `WHERE next_due_at <= NOW() LIMIT 25` cap per tick. Pin: T-3 must declare a per-tick row cap or the budget is fiction.

### `profile-cards` cluster (CRYPTO-1, FACTS-1, W-4)

- **R-FACTS-1 (LOW) — UserFact CRUD round-trip 5/15/30 ms**. With Fernet encrypt/decrypt at create and read paths (CRYPTO-1, `PHASE1_CONTEXTS.md:107`), per-field cost ≈ 100 µs. For 5-fact response that's 500 µs; well inside the 5 ms p50. SQLite write commit (~3-8 ms typical) dominates. No risk.

### `identity-recognition` cluster (ID-1..3, IDB-1..3)

- **R-ID-1 (LOW) — Day-4 ID-* are field-only**. No new latency surface. Budget tracking deferred to Day-5 when `voice/identity/resolver.py` becomes a real ML call.

---

## Histogram registry (V-6 deliverable list)

`src/backend/observability.py` MUST expose, at the end of Wave 2, the following Histogram instances. Every one is registered via `_register(...)` (`observability.py:266`) so `/metrics` rendering picks them up automatically.

1. `phantom_chat_response_latency_ms` — observed by `routes_chat._build_ai_response` around `t_start = time.monotonic()` block (`routes_chat.py:483`). The existing `latency_ms = int((time.monotonic() - t_start) * 1000)` computation (`routes_chat.py:502`) is already the budget value; just call `chat_response_latency_ms.observe(latency_ms, tier=...)` after the line.
2. `phantom_voice_stt_latency_ms` — labelled `engine` (`vosk` / `whisper` / `whisper_npu` / `mms_npu`). Observation point: STT provider's existing `STTResult.latency_ms`.
3. `phantom_ws_broadcast_latency_ms` — observed in `websocket_hub.broadcast` around the existing `_lock` block.
4. `phantom_lifespan_g1_ready_ms` — observed once at end of `_warmup_g1_sync_deps` (V-5 entry; `desktop-shell.md:300-303`).
5. `phantom_lifespan_g2_ready_ms` — observed once at end of `_warmup_g2_parallel` (V-5 entry; `desktop-shell.md:306-310`).
6. `phantom_chat_orchestrator_overhead_ms` — only when `chat_orchestrator_enabled=True`. Observes the **delta** between orchestrator total and `max(leaf_completed_ms)` per ADR-ORC-001 perf table at `agent-orchestration.md:295-300`. **Not** total turn latency (R-ORCH-1).
7. `phantom_ai_hub_pick_ms` — Z-1 entry; budget 0.5 ms p95.
8. `phantom_user_facts_op_ms` — labelled `op` (`create`/`read`/`delete`); FACTS-1 entry.
9. `phantom_standing_orders_tick_ms` — observed once per runner tick; budget 50 ms p95 (T-3).
10. `phantom_scene_render_latency_ms` — frontend-emitted via a new POST endpoint `/api/v1/metrics/observe`. Frontend captures `performance.now()` around `<ChatScene>` mount; backend resolves the route handler to `chat_response_latency_ms.observe(value, tier=...)` if the LOC budget allows, otherwise dedicated instrument.

**Bonus instruments recommended (cross-cluster gaps)**:
- `phantom_sandbox_wrap_overhead_ms` (R-SBX-1) — bwrap fork+exec p95 visibility.
- `phantom_sandbox_realpath_ms` (R-SBX-2) — debug instrument; OK to default OFF.

**Bucket boundaries**: per ADR-RTP-002 `DEFAULT_BUCKETS_MS = (5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000)` (`desktop-shell.md:266-267`). C-PERF concurs — the buckets cover sub-frame latency (5-25 ms = scene reveal stagger), single-frame chat reactions (50-250 ms = orb pulse, WS broadcast), turn-budget territory (500-2500 ms = chat round-trip), orchestrator wall-clocks (5000-10000 ms = parallel-K=3 ceiling).

---

## Recommended Phase-3 readiness gate

Before any other Wave-2 block lands, these MUST hold:

- [ ] **V-6 (Histogram primitive) ships first in Wave 2** — every later block instruments through it. Without V-6, every other budget in this document is unenforceable. ADR-RTP-002 `desktop-shell.md:185-236`.
- [ ] **V-9 (presence-aware tick) ships in Wave 2** — saves idle CPU for parallel orchestration. Idle-CPU target ≤ 3 % is unreachable without it. `PHASE1_BLOCK_ORDER.md:74`.
- [ ] **V-5 (lifespan staged groups) ships in Wave 2** — Tauri sidecar splash budget (≤ 2.5 s; ADR-DSH-001 `desktop-shell.md:48-51`) is downstream-blocked on it.
- [ ] **W-5 (hardware tier flag) ships in Wave 2** — every animated component (Orb, AmbientGlows, ChatScene, voice-amp store) MUST declare a tier=low fall-back. ADR-CP-002 `chat-liveness.md:270-307`.
- [ ] **`tier=low` fall-back behaviour defined for every animated component** — Orb halo (flat radial), AmbientGlows (null), ChatScene (4-panel cap + "+N more"), MessageBubble (flat backdrop), voice-amp (rAF-coalesced 30 Hz). Per ADR-CP-002 lines 281-286.
- [ ] **Pixel-snapshot baseline `e12188f` filed at `docs/architecture/chat-liveness-baselines/`** — back-compat invariant 1 of ADR-CS-002 (`chat-liveness.md:472`) is unenforceable without the artefact. **HIGH risk if missed.**
- [ ] **Histogram observation under chat hot-path is no-yield** — Counter.inc() shape (`observability.py:224-228`). Pin via `test_histogram_observe_no_yield` in V-6.
- [ ] **Per-tick row cap declared for standing-orders runner** — T-3 budget 50 ms p95 fictional without it (R-TIME-1).
- [ ] **AI Hub `pick()` is a frozen dict, not SQL** — Z-1 / Z-4 budget 0.5 ms p95 unreachable otherwise (R-HUB-1).

**Phase-2 gate verdict**: Histogram primitive (V-6) is the keystone. Every other ADR routes its budget through it. Block all Wave-2 work on V-6 landing first.

---

## Appendix — direct file:line citations consulted

- `src/backend/main.py:212-518` — current strictly-serial lifespan body.
- `src/backend/main.py:283-301` — Chroma eager init (G2 lane).
- `src/backend/main.py:344-349` — CPU sampler 1 Hz.
- `src/backend/main.py:351-366` — `preload_voice_models` (G2 lane, dominant cost).
- `src/backend/main.py:427` — `asyncio.create_task(_context_loop, ...)` (V-9 target).
- `src/backend/observability.py:215-238` — `Counter` shape (Histogram MUST mirror).
- `src/backend/observability.py:241-257` — `Gauge` shape.
- `src/backend/observability.py:263-268` — `_REGISTRY` + `_register()`.
- `src/backend/observability.py:330-341` — `render_metrics()` exposition.
- `src/backend/api/routes_chat.py:483` — `t_start = time.monotonic()` (chat hot-path entry).
- `src/backend/api/routes_chat.py:502` — `latency_ms = ...` (existing measurement).
- `src/backend/api/routes_chat.py:527` — `latency_ms` JSON metadata persist.
- `src/backend/api/routes_chat.py:590-621` — `_broadcast_message_stream` (WS chunking).
- `src/backend/api/routes_chat.py:610` — `await asyncio.sleep(config.chat_stream_delay_s)` (the "fake streaming" sleep W-5 drops).
- `src/backend/config.py:42` — `memory_top_k: int = 5`.
- `src/backend/config.py:79` — `chat_max_session_history: int = 50`.
- `src/backend/config.py:505` — `chat_tool_max_total_ms: int = 12_000` (orchestrator + chat ceiling).
- `src/frontend/src/components/core/Orb.tsx:33-35` — `voiceAmplitude` store read.
- `src/frontend/src/components/core/Orb.tsx:48-50` — halo `filter: blur(36px) brightness(...)` + `transform: scale(...)` (tier=low MUST replace).
- `src/frontend/src/components/core/Orb.tsx:62-63,75-76` — `phantom-radar` CSS animation already respects `var(--motion-scale)`.
- `src/frontend/src/components/core/AmbientGlows.tsx:14,27,40` — 3 × backdrop blur layers (tier=low MUST early-return null).
- `docs/architecture/desktop-shell.md:128-181` — ADR-RTP-001 lifespan parallelisation.
- `docs/architecture/desktop-shell.md:185-236` — ADR-RTP-002 Histogram primitive.
- `docs/architecture/desktop-shell.md:265-267` — `DEFAULT_BUCKETS_MS`.
- `docs/architecture/desktop-shell.md:355-365` — desktop-shell perf budgets.
- `docs/architecture/chat-liveness.md:213-267` — ADR-CP-001 phantomVariants.
- `docs/architecture/chat-liveness.md:270-307` — ADR-CP-002 hardware-tier + stack-depth gate.
- `docs/architecture/chat-liveness.md:451-464` — chat-liveness perf budgets.
- `docs/architecture/agent-orchestration.md:70-87` — ADR-ORC-004 budget split.
- `docs/architecture/agent-orchestration.md:91-110` — ADR-ORC-005 asyncio.wait shape.
- `docs/architecture/agent-orchestration.md:291-303` — orchestrator perf budgets.
- `docs/architecture/sandbox-runtime.md:444-454` — sandbox perf budgets.
- `docs/PHASE1_BLOCK_ORDER.md:29-74` — Day-4 block ranking (V-/W-/X-/Y-/Z-/T-/FACTS-/ID-/IDB-/CRYPTO-).
- `docs/PHASE1_CONTEXTS.md:13-164` — 16 contexts × 8 clusters; specifically lines 21-27 (`runtime-perf` block list), 49-54 (`chat-perf` panel-count budget), 75-87 (`chat-orchestrator` config keys), 89-101 (`ai-hub` skeleton).
