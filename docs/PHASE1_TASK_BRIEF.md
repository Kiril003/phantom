# Day-4 Phase 1 — DDD Decomposition Task Brief
# (handed to ruflo hive-mind queen at spawn time)

## Mission

Decompose the operator's 15-vector "living OS" charter into **8–12
bounded contexts** with explicit interfaces, dependencies, leverage
scores, and Day-4 implementation blocks. Inputs and outputs are
fully specified below — agents must not invent additional artifacts.

## Inputs (already in AgentDB, namespace `day4-vision`)

- `product-charter` — `docs/AUTONOMOUS_DAY_PLAN_DAY4.md` (charter
  with 15 vision vectors, must-have block table, deferred list)
- `audit-findings-full` — `docs/audit-2026-05-01-day4/FINDINGS.md`
  (97 findings, 30 Critical, 8 reviewer perspectives)
- `execution-plan` — `docs/RUFLO_EXECUTION_PLAN.md` (this run's
  master plan with phase boundaries and block order)

**MANDATORY first action of every worker**: `memory search
--namespace day4-vision --query <your-cluster-keywords>` then
`memory retrieve` the top hit if relevance > 0.4. Do not invent
context that contradicts the audit.

## Topology

- **Queen**: strategic, hierarchical-mesh.
- **Workers**: 12 (operator override 2026-05-01 confirmed 12 OK).
- **Memory namespace**: `day4-phase1-decomp`.
- **Coordination**: each worker writes a single namespaced memory
  entry on completion; the dependency-graph synthesiser reads ALL
  worker outputs once they're committed.

## Worker assignments (8 cluster probers)

Each prober owns a single cluster of vision vectors. It reads the
charter + audit slices relevant to its cluster, identifies 1–3
bounded contexts within it, and outputs one `context-spec` entry per
context to memory.

| Worker | Cluster ID | Vision vectors | Audit slices |
|---|---|---|---|
| W-DESKTOP | desktop-shell | 1 (Tauri), 13 (speed), 14 (polish) | U5-PKG-*, U8-PERF-* |
| W-CHAT-LIVENESS | chat-liveness | 2 (animated chat), 5 (visual code dev), 8 (auto-everything), 13 (speed) | U1-UX-*, U2-ANIM-* |
| W-SANDBOX | sandbox-runtime | 3 (sandbox), 11 (BT/WiFi/ports) | U4-SEC-*, F-58, F-40 |
| W-ORCHESTRATION | agent-orchestration | 4 (multi-agent), 15 (multi-day tasks) | U3-ORCH-*, TM-17B |
| W-AI-HUB | ai-hub | 6 (AI hub local + API + hybrid) | (synthesise from charter) |
| W-PROFILES-CARDS | profile-cards | 7 (profiles + cards), 8 (auto-input) | U6-ID-C2, U6-ID-G1, U1-UX-G1 |
| W-IDENTITY | identity-recognition | 10 (who-said-what, face/voice ID) | U6-ID-* |
| W-TIME-EVENTS | time-events | 9 (alarms/calendar), 15 (multi-day tasks) | U7-LRT-* |

### `context-spec` output schema (every prober must emit this)

```yaml
# stored as memory key: day4-phase1-decomp/<context-id>
context_id: <kebab-case-name>          # e.g. "desktop-shell"
cluster_id: <from-table-above>
vision_vectors: [<n>, <n>, ...]
audit_findings_addressed: [<U?-???-?>, ...]
purpose_one_sentence: <single sentence: what this context owns>
boundary:
  owns:                                # things INSIDE the context
    - <module path or capability>
  consumes:                            # contexts this one DEPENDS on
    - <other-context-id>
  produces:                            # contexts that DEPEND on this
    - <other-context-id>
interfaces:                            # public API surface
  - name: <fn or class name>
    kind: function|class|http_route|ws_event|cli
    inbound_or_outbound: in|out
    one_line_contract: <single sentence>
unanswered_questions:                  # phase-2 ADR will answer
  - <question>
day4_blocks_proposed:                  # what Phase 3 implements
  - block_id: <V-?, W-?, X-?, ...>
    one_line_scope: <sentence>
    write_paths: [<path1>, <path2>]
    estimated_loc: <int>
    parallel_safe_with: [<other-block-id>, ...]
    blocks_blocked_by: [<other-block-id>, ...]
    must_have_or_skeleton: must|skeleton
    confidence: high|medium|low
deferred_to_day5_or_later:             # what THIS context defers
  - item: <one-line>
    reason: <one-line>
```

## Synthesiser worker (W-DEPGRAPH)

After all 8 probers commit, this worker:
1. Reads ALL `day4-phase1-decomp/<context-id>` entries.
2. Builds a directed graph: `consumes` → `produces` edges.
3. Detects cycles. If any → ESCALATE E2 (operator decides which
   edge to break). If none → topological sort.
4. Emits `docs/PHASE1_CONTEXTS.md` (one section per context, full
   spec inline).
5. Emits `docs/PHASE1_DEPENDENCY_GRAPH.md` with mermaid diagram +
   topological order list.

## Leverage worker (W-LEVERAGE)

After W-DEPGRAPH, this worker:
1. Reads all blocks proposed by probers.
2. Scores each block RICE-style:
   - Reach = vision vectors served by this block (count)
   - Impact = 0.5/1/2/3 (skeleton/partial/must/foundation)
   - Confidence from prober (0.5/0.75/1.0)
   - Effort from estimated_loc (LOC / 60 = hours est.)
   - RICE = (Reach × Impact × Confidence) / Effort
3. Emits `docs/PHASE1_BLOCK_ORDER.md`: one row per block, sorted
   by RICE desc, with columns: block_id, scope, write_paths,
   parallel_with, est_loc, RICE, must/skeleton.

## Deferred worker (W-DEFERRED)

After W-LEVERAGE, this worker:
1. Collects every `deferred_to_day5_or_later` item from probers.
2. Adds the operator's static deferred list (charter §"Deferred").
3. Emits `docs/PHASE1_DEFERRED.md` with sections: Day 5 (next),
   Day 6 (radio + speaker), Day 7+ (1000+ map features), Beyond
   (hardware-specific NPU LLM, motion-designer scenes).

## Audit-cross-check worker (W-AUDIT-CROSS)

Last to run. Reads:
- All Phase-1 outputs above.
- `audit-findings-full` from `day4-vision`.

For every Critical finding (U?-???-C?) in the audit:
- Find at least one block_id in PHASE1_BLOCK_ORDER.md that addresses it.
- If none → write the missing block_id to a section "AUDIT-MISSED"
  in `docs/PHASE1_BLOCK_ORDER.md` with severity tag.

If AUDIT-MISSED has any Critical entries → ESCALATE E2 before
Phase 2 starts. Otherwise commit phase complete.

## Phase 1 success gate (operator-readable)

Before Phase 2 can start, all four files must exist:

- [ ] `docs/PHASE1_CONTEXTS.md` (8–12 contexts fully specified)
- [ ] `docs/PHASE1_DEPENDENCY_GRAPH.md` (DAG, no cycles)
- [ ] `docs/PHASE1_BLOCK_ORDER.md` (≥10 blocks, RICE-sorted, every
      Critical audit finding addressed)
- [ ] `docs/PHASE1_DEFERRED.md` (full Day-5+ backlog)

Plus: `git status` shows ONLY these four new files in `docs/` — no
code changes (phase 1 is research-only, not implementation).

## Phase 1 expected wall-clock

40 min. If exceeded, operator override allows up to 60 min. Beyond
that → check progress, abort if no value, iterate brief if wrong
inputs.

## Memory write discipline

- Every worker stores ONE primary entry under
  `day4-phase1-decomp/<context-id>` or
  `day4-phase1-decomp/<artifact-name>`.
- No worker may write outside its assigned namespace.
- No worker may write to `day4-vision` (read-only there).
- Final `docs/PHASE1_*.md` files are written by the synthesiser
  workers (W-DEPGRAPH, W-LEVERAGE, W-DEFERRED, W-AUDIT-CROSS) only.
- Probers do NOT write `.md` files directly — only memory entries.

## Phase 1 concrete kickoff (held until operator preview window passes)

```bash
# Held until operator confirms preview.
npx -y claude-flow@v3alpha hive-mind init -t hierarchical-mesh \
  --queen-type strategic
npx -y claude-flow@v3alpha hive-mind spawn --claude -n 12 \
  --memory-namespace day4-phase1-decomp \
  --task-brief docs/PHASE1_TASK_BRIEF.md
# After spawn: queen broadcasts the worker-assignment table to
# workers via the spawn task message; each worker self-elects from
# the table on first claim.
```

If the actual `hive-mind spawn` flag surface differs (e.g.
`--task-brief` is not supported), I'll adapt at invocation time
and document the deviation in `docs/day4-progress.md` with the
exact command used.
