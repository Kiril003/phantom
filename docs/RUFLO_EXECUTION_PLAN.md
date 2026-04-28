# PHANTOM OS — Day-4 Ruflo Hive-Mind Execution Plan

**Author**: Ruflo Queen (this run).
**Operator brief**: Day-4 Hive-Mind Mission Brief, target tag
`v0.20.0-living-os`, baseline `e12188f` (checkpoint-pre-ruflo-day4).
**Charter**: `docs/AUTONOMOUS_DAY_PLAN_DAY4.md`.
**Audit input**: `docs/audit-2026-05-01-day4/FINDINGS.md` (97 findings,
30 Critical, 8 reviewers — sunk-cost done before this plan).
**Status**: **PENDING OPERATOR `GO`**. Will not start Phase 1 without it.

---

## 0. Honest scope reality (before "GO")

The 15 vision vectors in the brief are a 2–4 week roadmap, not one
day. Day-4 ships **foundations** for ALL 15, plus **complete
implementations** of items 1, 2, 3, 4, 6, 7, 9, 10, 13, 14, 15. Items
5, 8, 11, 12 land as skeletons + Day-5/6 backlog.

**Realistic Day-4 deliverables** (90% confidence, post-Phase-1 may
shrink Y/Z if Phase 2 surfaces blockers):

| Vector | Deliverable | Tier |
|---|---|---|
| 1 — Tauri shell | Linux .AppImage builds + Windows .exe path scaffolded; `127.0.0.1` host enforced in packaged mode; `tauri.conf.json` signed-installer ready | must |
| 2 — Animated chat | `<ChatScene>` composer + 4–5 scene presets (text/list/map-pin/plan/code-preview); `scene` envelope on WS contract back-compat with bubble | must |
| 3 — Sandbox | `bwrap` retarget for `agent/actions/{bash,net,notify}` + `mcp/adapter`; `SandboxProfile` enum (compute/net_observe/radio_privileged); F-40 realpath fix | must |
| 4 — Multi-agent orchestration | `agents/orchestrator.py` skeleton: per-sub-agent nonce, leaf+merge sanitize, import-gate CI test, default-off `chat_orchestrator_enabled` | must |
| 6 — AI Hub | `ai/hub.py` capability registry + auto-route; UI placeholder card (Settings → "AI Hub"); telemetry per provider | must |
| 7 — Profiles + cards | `security/crypto.py` Fernet helper + `UserFact` table + `/users/{id}/facts` route + `<FactCard>` UI component (4 types: email/phone/telegram/file_pointer) | must |
| 9 — Calendar/alarms | Standing-orders runner: `in_flight_task_id` lease, action-kind discriminator (`speak/notify/task/webhook`), progress events on event_bus, replace dead `Timer/Alarm/CalendarEvent` 501-stubs with thin wrappers over standing orders | must |
| 10 — Identity (foundation) | `User` table multi-row test under `single` mode; `speaker_id` field on transcript dataclass + default-`None` resolver; per-user fact RBAC dep `require_self_or_root` | must |
| 13 — Speed | Lifespan `asyncio.gather` parallelisation; latency `Histogram` primitive; chat-hot-path side-effects → `asyncio.create_task`; `_context_loop` 1-2 Hz when no presence | must |
| 14 — SaaS polish | Settings sub-group accordions (no overflow at 1024×600); `dynamic_source` schema for enumerable settings; reset confirmation modal | must |
| 15 — Multi-level tasks | Standing-orders progress events surfaced in chat-scene "plan" preset (closes feedback loop) | must |
| 5 — Visual code dev | `<CodePreviewScene>` skeleton (read-only render); full clickable iteration deferred Day-6 | partial |
| 8 — Auto-everything | `dynamic_source` covers picker case for vector 7+14; broader inference Day-5 | partial |
| 11 — BT/WiFi/ports | `SandboxProfile.radio_privileged` reserved capability slot; **no actual radio code** Day-4 (Day-6 deliverable) | skeleton |
| 12 — 1000+ map features | Day-4 audit produces feature backlog; Map UX delta deferred Day-6 | backlog only |

**Items deferred to `docs/DAY4_DEFERRED.md`**:
ML voice person recognition (weeks of training); BT/WiFi penetration
capabilities (legal + driver-level); 1000+ map features (continuous
goal); pixel-perfect motion-designer polish (human designer);
hardware-accelerated NPU LLM (chip-specific drivers); "better than
OpenClaw" KPI (continuous metric); 50+ scene library (motion designer
work).

## 1. Phase plan

### Phase 0 — Ruflo system smoke (~10 min, pre-flight, NOT a real phase)
- Verify ruflo CLI (`ruflo --version`), MCP not auto-started (autoStart=false in `.mcp.json`).
- `ruflo init` (idempotent — initialises project tracking).
- `ruflo doctor` — surfaces missing system deps (sqlite, embeddings backend) before any phase commits.
- Memory namespace map authored:

| Phase | Namespace | Purpose |
|---|---|---|
| 1 | `day4-phase1-decomp` | bounded contexts, dep graph, block order |
| 2 | `day4-phase2-arch` | ADRs, interfaces, contracts |
| 3 | `day4-phase3-impl` | block commits, decisions, deviations |
| 4 | `day4-phase4-valid` | acceptance results, perf numbers |
| 5 | `day4-phase5-release` | retrospective, deferred list |

- `ruflo memory store --namespace day4-vision --key product-charter --value "$(cat docs/AUTONOMOUS_DAY_PLAN_DAY4.md)"`
- `ruflo memory store --namespace day4-vision --key audit-findings --value "$(cat docs/audit-2026-05-01-day4/FINDINGS.md)"`
- Smoke gate: `ruflo memory search --namespace day4-vision --query "Tauri"` returns ≥1 hit.

### Phase 1 — DDD Decomposition (~40 min)
- **Mode**: `ruflo hive-mind init -t hierarchical-mesh` then `spawn`.
- **Queen**: strategic.
- **Workers**: 12 total
  - 8 domain-prober workers (one per cluster of vision vectors):
    - W-DESKTOP (vec 1, 13, 14)
    - W-CHAT-LIVENESS (vec 2, 5, 8, 13)
    - W-SANDBOX (vec 3, 11)
    - W-ORCHESTRATION (vec 4, 15)
    - W-AI-HUB (vec 6)
    - W-PROFILES-CARDS (vec 7, 8)
    - W-IDENTITY (vec 10)
    - W-TIME-EVENTS (vec 9, 15)
  - 1 dependency-graph synthesiser (consumes all 8 outputs)
  - 1 leverage-scorer (RICE-style scoring per block)
  - 1 deferred-list curator (writes `DAY4_DEFERRED.md` skeleton)
  - 1 audit-cross-check (every Phase-1 block has at least one
    `U[1-8]-*` finding it answers; prevents new charter drift)
- **Inputs**: `day4-vision` namespace (charter + FINDINGS).
- **Outputs**:
  - `docs/PHASE1_CONTEXTS.md` (8–12 bounded contexts, names, scope, owner)
  - `docs/PHASE1_DEPENDENCY_GRAPH.md` (mermaid graph + topological order)
  - `docs/PHASE1_BLOCK_ORDER.md` (block list with leverage score, est LOC, write-paths, owner)
  - `docs/PHASE1_DEFERRED.md` (full deferred backlog)
- **Memory writes**: each context as a separate `day4-phase1-decomp/<ctx>` row with embeddings.
- **Gate**: dep graph DAG (no cycles), ≥10 blocks ordered, every charter must-have item has ≥1 block.

### Phase 2 — Architecture per Domain (~75 min)
- **Mode**: `ruflo swarm coordinate --agents <N>` per context, parallelised.
- **Per context**: 2 agents (architect + test-planner) + shared embedding retrieval.
- **Cross-cutting agents** (always running, listening to all contexts):
  - C-INTEGRATION (catches contract conflicts at context boundaries)
  - C-SECURITY (review every ADR for sandbox / Tauri capability / RBAC delta)
  - C-PERF (latency budget per block, frame budget per UI component)
- **Inputs**: `day4-phase1-decomp` retrievals.
- **Outputs**:
  - `docs/architecture/<context>/ADR-NNN.md`
  - `docs/architecture/<context>/interfaces.ts` (or `.py`)
  - `docs/architecture/<context>/test-plan.md`
  - `docs/PHASE2_INTEGRATION_RISKS.md`
  - `docs/PHASE2_SECURITY_REVIEW.md`
  - `docs/PHASE2_PERF_BUDGETS.md`
- **Memory writes**: each ADR + risk/budget under `day4-phase2-arch`.
- **Gate**: 0 critical integration conflicts, 0 critical security
  risks (E1 trigger if any).

### Phase 3 — Implementation (~5–7 h, the heaviest phase)

**Topology**: SINGLE-AGENT per block, but **multiple blocks parallel
when write-paths disjoint**. Operator brief P3 + P7 govern.

**Block ordering (post-audit, may revise after Phase 1)**:

| # | Block | Path | Parallel-safe with | Time | Confidence |
|---|---|---|---|---|---|
| Y-1 | `security/crypto.py` Fernet helper + tests | `src/backend/security/crypto.py` | (anything) | 20 min | high |
| V-0 | OS-aware default paths in config | `src/backend/config.py` | Y-1 | 15 min | high |
| V-1 | Tauri scaffold | `src/frontend/src-tauri/`, `Cargo.toml`, `tauri.conf.json` | W-1 (front), Y-1, V-0 | 50 min | medium |
| V-2 | NPU platform-branch | `src/backend/voice/whisper_npu_provider.py`, `mms_npu_provider.py`, `stt_engine.py` | W-1 | 25 min | high |
| V-3 | `_refuse_lan_bind_in_packaged_mode` lifespan refuse | `src/backend/main.py` | (sequential) | 15 min | high |
| V-4 | Lifespan `asyncio.gather` parallelisation | `src/backend/main.py` | (sequential after V-3) | 40 min | high |
| V-5 | latency `Histogram` primitive | `src/backend/observability.py` | (sequential after V-4) | 30 min | high |
| W-1 | `<ChatScene>` composer + envelope | `src/frontend/src/components/chat/scenes/`, `src/shared/types/chat.ts`, `src/backend/api/routes_chat.py` | V-1 | 75 min | medium |
| W-2 | 4–5 scene presets (text/list/map-pin/plan/code-preview) | `src/frontend/src/components/chat/scenes/presets/` | (sequential after W-1) | 90 min | medium |
| W-3 | Settings subgroup accordions + reset confirm | `src/frontend/src/components/settings/SettingsPanel.tsx`, `routes_settings.py` (subgroup field) | W-1 | 60 min | high |
| W-4 | `dynamic_source` schema + `<DynamicPicker>` | `src/frontend/src/components/settings/`, `routes_settings.py`, voice + ollama enumeration routes | W-3 | 60 min | medium |
| X-1 | `agents/orchestrator.py` skeleton | `src/backend/agents/orchestrator.py`, `config.py`, CI import-gate test | (sequential after W-1) | 60 min | medium |
| X-2 | Per-sub-agent nonce + leaf+merge sanitize | `src/backend/agents/orchestrator.py` | (sequential after X-1) | 45 min | medium |
| Y-2 | `bwrap` retarget for agent.actions | `src/backend/agent/safety/sandbox.py`, `agent/actions/bash.py,net.py,notify.py`, `agent/mcp/adapter.py` | W blocks | 75 min | medium |
| Y-3 | F-40 realpath workspace check | `src/backend/agent/actions/fs.py` | Y-2 | 30 min | high |
| Z-1 | `UserFact` table + migration + `/users/{id}/facts` route | `src/backend/db/models.py`, `db/migrations/`, `api/routes_auth.py`, `security/permissions.py` (`require_self_or_root`) | Y-1 | 60 min | high |
| Z-2 | `<FactCard>` UI (email/phone/telegram/file_pointer) | `src/frontend/src/components/identity/cards/` | W-2, Z-1 | 75 min | medium |
| AA-1 | `ai/hub.py` capability registry | `src/backend/ai/hub.py`, `routes_settings.py` (AI Hub category) | (sequential after V-5) | 75 min | medium |
| AA-2 | AI Hub UI placeholder card | `src/frontend/src/components/settings/AIHubPanel.tsx` | AA-1, W-3 | 45 min | medium |
| AB-1 | Standing-orders lease + action-kind | `src/backend/agent/standing_orders/{runner,schedules,actions}.py`, `db/models.py` | (sequential after Y-1) | 75 min | high |
| AB-2 | Replace 501 Timer/Alarm/CalendarEvent stubs with thin wrappers over standing orders | `src/backend/api/routes_tools.py`, `src/backend/db/models.py` (drop dead tables) | AB-1 | 45 min | high |
| AB-3 | Standing-order progress events on event_bus | `src/backend/agent/standing_orders/runner.py` | AB-1 | 30 min | high |
| AC-X | `_context_loop` presence-gated tick rate | `src/backend/main.py` | (anytime) | 20 min | high |

**Total**: ~22 blocks, sequential floor = ~5h, parallel floor = ~3.5h.
Hard cap **6.5 h** to leave room for Phase 4+5.

**Operator override 2026-05-01**: Phase 3 parallel coder concurrency
**bumped 4 → 6** when write paths disjoint. Max 20x compute headroom.

**Per-block contract**:
- Pre-block: `ruflo memory search --namespace day4-phase2-arch --query "<block context>"` → confirm ADR exists + retrieved.
- During block: 1 agent via `ruflo agent spawn -t coder --task "<block-spec>"` OR direct Edit/Write tool ownership when block is small (≤30 LOC config touches).
- Post-block:
  1. `pytest -q` (backend) — must be green; if not, fix in same block, no rollover.
  2. `npm run typecheck && npm run build` (only frontend-touching blocks).
  3. ChromaDB drift restore: `git checkout -- src/backend/chroma_data/chroma.sqlite3` if untracked-on-disk drift.
  4. Atomic commit, message format: `phase-3-blockNN-<short>: <subject> (closes <audit-IDs>)`.
  5. `ruflo memory store --namespace day4-phase3-impl --key <blockNN> --value <commit-sha + summary>`.

**Parallel scheduling**: Only fire two coder agents in parallel when their write-paths share zero files. The table column "Parallel-safe with" is the explicit allowlist. Default = sequential.

**Failure handling per P10**:
- 1st test red → fix in same block.
- 2nd test red after fix → if block is non-must, defer to `DAY4_DEFERRED.md`; if must, escalate E2/E3.
- Any rm -rf / force-push / history rewrite agent suggestion → E4 immediate halt.

### Phase 4 — Validation (~50 min)
- **Mode**: `ruflo swarm coordinate --agents N` mesh.
- **Workers**: 1 validator per Phase-3 block + 3 cross-cutting:
  - V-INTEG (full chat flow inside Tauri shell — does WS scene
    envelope round-trip end-to-end?)
  - V-PERF (Lighthouse on UI, FPS sample on chat scenes, p50
    histograms read from `/metrics`)
  - V-SECURITY (re-scan after sandbox + Tauri capabilities + new
    `/users/{id}/facts` route)
- **Inputs**: `day4-phase2-arch` (ADR + acceptance criteria) +
  `day4-phase3-impl` (commit shas).
- **Outputs**:
  - `docs/PHASE4_VALIDATION/<block>.md` per block
  - `docs/PHASE4_CUMULATIVE.md` rollup
- **Gate**: 0 critical findings after one fix-pass loop within Phase 5.

### Phase 5 — Consolidation & Release (~45 min)
- **Mode**: single agent, role = release-manager.
- **Steps**:
  1. Apply Phase-4 critical fixes (≤3 fix-attempts per finding, else
     `DAY4_DEFERRED.md`).
  2. Build: `cd src/frontend/src-tauri && cargo tauri build` for Linux
     (.AppImage). Windows .exe build attempted via cross-compile (or
     skipped to Day-5 if Rust toolchain x86_64-pc-windows-msvc not
     resolvable — honest deferred).
  3. Update `README.md` "What ships in v0.20.0-living-os".
  4. Update `docs/CHANGELOG.md`.
  5. Write `docs/DAY4_RETROSPECTIVE.md` (commit-sha-anchored, honest:
     wins, misses, deferred items).
  6. Finalise `docs/DAY4_DEFERRED.md`.
  7. Git: tag `v0.20.0-living-os` + tag
     `autonomous-day-2026-05-01-acceptance`.
  8. `ruflo memory dump --namespace day4-* --output
     docs/DAY4_MEMORY_DUMP.json` (debug artifact, not committed).
  9. `ruflo hive-mind shutdown`.

## 2. Estimated agent count

| Phase | Concurrent agents (peak) | Total spawned | Wall-clock |
|---|---|---|---|
| 0 | 0 | 0 | 10 min |
| 1 | 12 | 12 | 40 min |
| 2 | 22 (8 ctx × 2 + 3 cross + queen) | 22 | 75 min |
| 3 | 4 (parallel impl when disjoint) | 22 (one per block) | 5–6 h |
| 4 | 25 (22 validator + 3 cross) | 25 | 50 min |
| 5 | 1 | 1 | 45 min |

**Estimated total agents over the day**: ~80–85.
**Peak concurrency**: 25 (Phase 4).
**Sustained wall-clock**: 8–9 h.

## 3. Memory namespace map (recap)

```
day4-vision               (charter + audit, written Phase 0, read all phases)
day4-phase1-decomp        (contexts + graph)
day4-phase2-arch          (ADRs + interfaces + budgets)
day4-phase3-impl          (block commits + deviations)
day4-phase4-valid         (acceptance results)
day4-phase5-release       (retrospective)
```

Every agent's first call must be a `memory search` on the closest
upstream namespace. This is the operator's P4 invariant.

## 4. Concrete kickoff commands (Phase 0 + Phase 1)

```bash
# Phase 0
npx -y claude-flow@v3alpha doctor
npx -y claude-flow@v3alpha init        # idempotent
npx -y claude-flow@v3alpha memory store \
  --namespace day4-vision --key product-charter \
  --value "$(cat docs/AUTONOMOUS_DAY_PLAN_DAY4.md)"
npx -y claude-flow@v3alpha memory store \
  --namespace day4-vision --key audit-findings \
  --value "$(cat docs/audit-2026-05-01-day4/FINDINGS.md)"
npx -y claude-flow@v3alpha memory search \
  --namespace day4-vision --query "Tauri"     # smoke

# Phase 1 (queen-led, 12 workers)
npx -y claude-flow@v3alpha hive-mind init -t hierarchical-mesh
npx -y claude-flow@v3alpha hive-mind spawn -n 12 \
  --memory-namespace day4-phase1-decomp
npx -y claude-flow@v3alpha hive-mind task -d "$(cat docs/PHASE1_TASK_BRIEF.md)"
# task brief written by me before this command, includes the 8 cluster
# probe targets + outputs spec + memory write contract
```

I will write `docs/PHASE1_TASK_BRIEF.md` immediately after "GO" and
before the `hive-mind task` call so the brief is reviewable in git.

## 5. Escalation triggers (mirrors operator brief)

E1 — security risk surfaced in Phase 2 → write `ESCALATION.md`, halt.
E2 — Phase 1 cannot decompose vision into coherent contexts → halt.
E3 — Tauri build fails on both platforms after 2 fix attempts → halt.
E4 — any agent proposes destructive git op → immediate halt + log.
E5 — AgentDB memory contradiction across phases → halt + dump.
E6 — Max-window rate limit → log pause to `docs/day4-progress.md` with
ISO timestamp + the exact block/agent name where I stopped, wait
reset, then continue from that same point. **Not an escalation**;
this is normal autonomy behavior per operator override 2026-05-01.

## 6. Honest risk register

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Tauri Windows cross-build fails (no x86_64-pc-windows-msvc on Linux host without `mingw-w64` + `cargo-xwin`) | medium | Day-4 ships Linux only, Windows deferred | Try `cargo-xwin` in Phase 5; if fails, `DAY4_DEFERRED.md` Windows build, ship Linux .AppImage. Operator hears truth. |
| Ruflo memory backend (sqlite/embeddings) corrupts mid-run | low | Phase contradictions; E5 | Phase 0 `doctor` smoke; namespace dumps before Phase 3 starts |
| `pytest -q` baseline reveals red leftovers from Day-3 drift | low (Day-3 capstone passed 1277/1277) | Phase 3 blocked until clean | First Phase-3 act: run `pytest -q`, if red → escalate E5 (state contradiction with Day-3 retrospective) |
| `ChatScene` envelope back-compat breaks Day-3 chat flow | medium | UI regression | Block W-1 acceptance test must include "old `response_form: text` still renders bubble" |
| Sandbox `bwrap` breaks `net.scan` ICMP path | known (audit U4-SEC-H2) | one tool degraded | Y-2 ADR explicitly handles `--share-net=yes` carve-out for `net.scan` |
| 6.5 h Phase-3 cap blown | medium | several Phase-3 blocks slip to Day-5 | Honest write to `DAY4_DEFERRED.md` per P10; capstone still ships with whatever's done |
| `npx claude-flow@v3alpha` resolution flakey under network blips | low | run stalls | Phase 0 prefetches by running `--help`; then `npm cache` is hot |

## 7. What I will NOT do without explicit operator approval

- Push commits to remote (`git push`).
- Force-push or rewrite history.
- Run any destructive shell op (`rm -rf`, `git reset --hard`, `git
  clean -fd` outside of pyc cleanup).
- Disable security checks, hooks, or validators to meet a deadline.
- Skip pytest / typecheck gates.
- Add a major dependency (>10 MB or new license class) without
  writing it to `docs/DEPENDENCIES_ADDED.md` first with reasoning.
- Touch the operator's `.env`, JWT secret, or AI keys.
- Exit Day-4 without a committed `DAY4_RETROSPECTIVE.md` and a
  finalised `DAY4_DEFERRED.md`.

## 8. The "I'm awake again" surface

When operator returns, the entry points to "what happened" are:

1. `git log --oneline e12188f..HEAD` — chronological commits
2. `docs/day4-progress.md` — narrative, written between phase
   transitions
3. `docs/DAY4_RETROSPECTIVE.md` — final honest assessment (Phase 5)
4. `docs/DAY4_DEFERRED.md` — Day-5+ backlog with reasons
5. `docs/PHASE4_CUMULATIVE.md` — validation rollup

Tags placed (or attempted, with honest "skipped because" notes):
- `v0.20.0-living-os`
- `autonomous-day-2026-05-01-acceptance`

## 9. Pending operator decision

Reply **"GO"** to start Phase 0.
Reply **"GO no-tauri-windows"** if you accept Linux-only AppImage.
Reply with edits / questions before "GO" otherwise.

I will not start Phase 0 without explicit confirmation. The
checkpoint is `e12188f` (`checkpoint-pre-ruflo-day4`).
