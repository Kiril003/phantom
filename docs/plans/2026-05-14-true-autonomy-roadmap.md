# PHANTOM — True Autonomy Roadmap

**Status**: planning · author: Claude · operator: Kiril · date: 2026-05-14
**Scope**: how to take the current agent loop (~Level-3) to a state where it can sustain a complex multi-domain mission (e.g. *"build a fully-procedural city in Blender, render a 30-second cinematic, deliver MP4"*) — running unattended for **24–72 hours**, self-correcting, self-throttling, never silently lying about progress.

This is not "install LangChain". It's a list of real CS problems with real techniques.

---

## 0. Translate "more powerful than Claude Code, for days" into primitives

Claude Code is an interactive single-shot tool-using LLM. Five things make PHANTOM's goal **different**:

| Capability | Claude Code | PHANTOM target |
|---|---|---|
| **Horizon** | minutes-to-hours, operator-supervised | days, unsupervised, with operator able to walk away |
| **Domain adaptation** | code + shell only | code + shell + 3D + browser + voice + sensors + ESP32 |
| **Resource awareness** | "is `node_modules/` big?" | live RAM/CPU/disk watchdog, throttling, OOM avoidance |
| **Verification** | tests pass + manual visual review | per-milestone artifact checks via vision, OCR, file probes, ground-truth |
| **Memory** | session conversation | cross-session episodic + lessons + RAG + identity drift |

If we don't solve **all five**, "powerful for days" stays a fantasy. Solving four out of five gives a bot that runs 20 hours then quietly fakes the result.

---

## 1. Honest map of where PHANTOM falls apart today

| Failure mode | Where the bug lives | Symptom |
|---|---|---|
| **No crash recovery** | `agent/runtime.py:_spawn_task` creates an `asyncio.Task` runner; if the process dies, the task is gone | OOM kill at hour 6 → no replay, no resume |
| **Will-engine doesn't survive provider swap** | `ai/hub.py` chooses provider per-call; if Gemini quota dies mid-flight, current step is lost (not replayed) | partial Blender script half-written |
| **No artifact-level verification** | Loop trusts `ActionResult.ok=True`. `bash.run` returns ok=True even if the script silently produced 0 polygons | LLM declares "city built" with empty .blend |
| **No global mission state** | Only `state.observations[-10]` + `recent_task_summary`. Long horizons require an explicit *mission ledger* | At step 800 of 1500, agent forgets the seed prompt |
| **No backpressure on RAM** | `device_monitor` doesn't exist; long Blender render eats 8 GB; Ollama fights for the same RAM | Q6A swaps, then OOM, then daemon dies, then no recovery |
| **Reflector is myopic** | `planner/reflector.py` looks at last sub-goal only; can't refactor strategy when hour-3 pattern conflicts with hour-1 plan | does the same wrong loop until quota dies |
| **No idempotency on actions** | `fs.write` retried after restart re-writes; `bash.run` retried re-runs side-effects | restart → Blender re-renders 60% of frames already done |
| **No quality dimension on outputs** | "Render city" → renders flat untextured 4-cube blob | declares ✅ done because `.png` exists |

These are 8 distinct engineering problems. Each has a known CS solution. Below.

---

## 2. The Six Engineering Blocks

### Block A — Sustained Autonomy (crash + provider failure resilience)

**Problem**: an `asyncio.Task` runner in a single Python process is too fragile for 24h+ runs.

**Patterns**:
1. **Event-sourced task state** — every state transition (sub-goal completed, action result, reflection) writes an audit row *first*, then mutates `TaskState`. On restart, replay audit → rebuild `TaskState` deterministically. Most of this is ALREADY in place (`agent/audit.py:write_audit_entry`), but the **rebuild path is missing**.
   * **Concrete task**: implement `agent_runtime.rehydrate_task(task_id)` that reads audit rows + the latest `TaskState` snapshot and resumes from the last completed step.
   * Audit rows already have everything. We just don't replay them on cold start.

2. **Per-step checkpointing**, not per-task. Currently `git_checkpoint.py` checkpoints workspace files on MEDIUM+ actions. Extend to checkpoint **the `TaskState` itself** every N steps + before every MEDIUM action. Store snapshots in `~/.phantom/checkpoints/<task_id>/step_<N>.json.gz`.

3. **Provider failure ≠ task failure**. `ai/hub.py` already does fallback (Gemini → Ollama). Extend: if BOTH fail, **park the task in `blocked_quota`** (already exists) AND start a `provider_health_probe` that polls every 60s; on first success, **replay the failed step**, not advance the index.

4. **Process-level supervisor**. Run the FastAPI daemon under `systemd` with `Restart=always` + `RestartSec=10`. On boot, the daemon's lifespan hook should:
   * Read DB → find all tasks in status `planning|running|paused|awaiting_user|blocked_quota`
   * For each: rehydrate `TaskState` from audit, push to `foreground_slot` or `background_slot`, resume the loop
   * If a task was mid-action when killed, the audit row for that action is *incomplete* → mark it `cancelled_by_crash`, retry it.

5. **Action idempotency keys**. Every action that has side effects gets a `idempotency_key = hash(task_id, step_idx, action_name, args)`. The action checks: "did I already do this work?" — `fs.write` checks file mtime + content hash; `bash.run` writes a `.phantom-done-<key>` sentinel in workspace; `blender.run` checks output_path mtime. If idempotency key matches, return cached result without re-doing work.

**Files to touch**:
* `agent/runtime.py` — add `rehydrate_task`, `_supervisor_resume_on_boot`
* `agent/checkpoints.py` — extend to TaskState snapshots, not just git
* `main.py` — lifespan hook: rehydrate all live tasks
* New: `agent/actions/_idempotency.py` — helper for sentinel files / content hashes
* New: `scripts/install_systemd.sh` — systemd unit file generator

**Effort**: 1.5–2 weeks. The hardest piece is action idempotency — needs case-by-case design per action.

---

### Block B — Resource Governance (RAM/CPU/disk/temp watchdog)

**Problem**: PHANTOM on the Q6A has 16 GB RAM. Blender headless rendering a city eats 12 GB. Ollama with Gemma 4 27B eats 18 GB (already over budget). faster-whisper streaming eats 1.5 GB. Without a governor, the agent OOMs itself and dies.

**Patterns**:

1. **Live resource model in `ContextEngine`**. Build a `SystemMonitor` daemon that samples every 5s:
   ```python
   @dataclass
   class ResourceSnapshot:
       ram_used_pct: float
       ram_available_mb: int
       cpu_pct: float
       cpu_temp_c: float | None  # from `sensors` if available
       disk_free_gb: float
       gpu_mem_used_pct: float | None
       swap_pct: float
   ```
   Push snapshots to `event_bus` AND make available as `agent_runtime.current_resources()`.

2. **Pre-action resource check**. Every action with `long_running_spec()` declares `estimated_peak_ram_mb`. Before execute, executor calls `if estimated_peak > current_available: ...`. Three options:
   * **Wait + replan**: pause until other heavy task finishes
   * **Throttle**: lower resolution, fewer samples, lower quality
   * **Abort + revise**: hand back to reflector with `resource_constrained` failure_mode

3. **Self-throttling planner**. The tactical planner gets a `resource_block` in its prompt:
   ```
   RESOURCE BUDGET:
   RAM available: 4.2 GB (low — 73% used)
   CPU: 87% over last minute (hot)
   Disk: 19 GB free
   STRATEGY HINT: prefer cheap reflection steps; defer heavy renders.
   ```
   This is the same pattern as the `emotion_block` and `will_block` I just shipped — just another optional prompt section.

4. **Process killer of last resort**. A separate watchdog process (NOT the daemon) monitors the daemon. If RAM > 95% for >30s, sends SIGTERM to the heaviest child (Blender, Ollama, browser) — never to the daemon itself. The daemon detects the death via `asyncio.create_subprocess_exec(...).returncode` and surfaces it as a recoverable action error.

5. **Provider routing by resource pressure**. `ai/hub.py` already routes per latency. Extend: when local RAM > 80%, prefer Gemini (remote, zero local RAM); when network is dead, force Ollama and accept the RAM cost.

6. **Thermal awareness on Q6A**. The Q6A throttles HARD above 85°C. Read `/sys/class/thermal/thermal_zone*/temp`. When trending up: throttle Ollama context size, suspend background tasks, lower Blender thread count.

**Files**:
* New: `core/system_monitor.py` (replaces existing `linux/resource_monitor.py` which is stub-ish)
* New: `agent/actions/_resource_gate.py` — pre-flight check helper
* `agent/planner/tactical.py` — add `_format_resource_block()`
* `ai/hub.py` — resource-aware routing tier
* New: `scripts/phantom-watchdog.py` — out-of-process killer

**Effort**: 1 week. Most of the work is calibrating thresholds and writing realistic action `estimated_peak_ram_mb` declarations.

---

### Block C — Long-Horizon Planning (hierarchical milestones + mission ledger)

**Problem**: `strategic.plan` produces 1–7 sub-goals. "Build a city" maps to 200+ atomic actions across 15+ logical phases (terrain → road grid → building distribution → mesh placement → texture pass → lighting → camera placement → animation → render → composite). A flat 7-sub-goal list cannot hold this.

**Patterns**:

1. **Three-tier planning**, not one:
   * **Mission** — the operator's prompt, durable, written once. Persisted in `agent_missions` table. Has fields: `success_criteria`, `quality_bar`, `deadline`, `budget_constraints`.
   * **Phase** — strategic decomposition into 5–15 phases. Each phase has its own `success_criteria` and `expected_duration_h`. Persisted, durable. Re-planned only on explicit operator revise.
   * **Sub-goal** — the existing `SubGoal` shape. Re-planned freely as observations come in. Lives inside a phase.

2. **Mission ledger** — a single Markdown file per mission, append-only:
   ```
   # Mission: build cyberpunk Tokyo 2089 in Blender, 30s cinematic
   ## Operator brief (verbatim)
   ...
   ## Phase 1 — terrain (DONE @ step 142, duration 1h23m)
   - Decided: 4km × 4km grid, 8m heightmap resolution
   - Acceptance: heightmap.exr exists, max gradient < 0.4 (sanity check passed)
   - Artifacts: ~/.phantom/workspace/terrain/heightmap.exr (12 MB)
   - Lessons: PEFC4D plugin OOM'd; switched to pure-Python erosion. Slower but stable.
   ## Phase 2 — road grid (IN PROGRESS, step 143-?)
   - Plan: voronoi cells → main arteries → secondary streets → alleys
   - Current attempt: step 167, voronoi seed 0x7c4a, 142 cells. Re-evaluating density.
   ```
   This file is **the source of truth** for the LLM after restart. Restart → daemon reads this → injects into the strategic planner prompt as ground state.

3. **Phase-level verification gates**. Before transitioning Phase N → Phase N+1, run an explicit `verify_phase(phase)` step that:
   * Checks the declared artifacts exist
   * Runs ground-truth probes (e.g. "open the .blend, count meshes, assert > 500" for phase=road_grid)
   * Spawns a council deliberation to read the ledger and rule "did we actually finish this, or did we just declare it finished?"
   * If verdict=`abort` or `revise`, the phase reopens, no advancement.

4. **Phase-local memory window**. Tactical planner currently sees `observations[-10]`. Switch to: `current_phase.observations` (which can be 50+) PLUS one-sentence summary of every prior phase. The "1500-step amnesia" stops.

5. **Mission-level checkpoints, not just task-level**. Every phase completion → a tagged git commit on `~/.phantom/workspace/` with message `mission-X phase-N done`. Operator can `git log` to see real progress. Operator can `git reset --hard` to a phase boundary to redo.

**Files**:
* New schema: `db/models.py` — `Mission`, `Phase` tables
* New: `agent/planner/mission.py` — top-level planner
* New: `agent/planner/phase.py` — phase planner (between strategic and tactical)
* New: `agent/missions/ledger.py` — markdown ledger reader/writer
* `agent/loop.py` — drive the Mission → Phase → SubGoal → Step chain
* New: `agent/actions/mission_verify.py` — phase verification action

**Effort**: 2.5–3 weeks. Real schema work + planner stack rewrite. Highest-leverage block by far.

---

### Block D — Verification Loops (no fake "done")

**Problem**: the agent declaring "city built ✅" is meaningless. Verification is **the hardest thing**, more than planning.

**Patterns**:

1. **Acceptance criteria are machine-readable**. Every SubGoal already has `acceptance_criteria: str`. Right now it's free-text. Move to structured:
   ```python
   class AcceptanceCriterion(BaseModel):
       kind: Literal["file_exists", "shell_check", "vision_check", "council_review", "regex_match", "test_pass"]
       target: str           # path / command / question / pattern
       expected: str | None  # for regex / shell stdout match
       quality_floor: float | None  # for vision-judged quality (0..1)
   ```
   Strategic planner emits these directly. Loop runs them automatically at sub-goal end. No human or LLM trust needed for "file exists" / "shell rc=0" / "tests pass".

2. **Vision-as-judge for qualitative criteria**. For "the city has visible cyberpunk aesthetic", run:
   * `blender.render` a low-res 360 preview from N angles (cheap)
   * For each render: `vision.see_screen` with focused prompt "rate cyberpunk aesthetic 0–10 with reasoning"
   * Aggregate scores. Pass = mean ≥ 7, no single ≤ 4.
   * Score recorded in mission ledger.
   This is the **only honest way** to verify aesthetic claims. Trusting the LLM that wrote the code to also judge it is fake.

3. **Domain-specific probes**. For Blender specifically:
   * `bpy.context.scene.objects` count
   * Polygon count via `bmesh`
   * Texture memory via `bpy.data.images`
   * Bounding box volume
   * Histograms of color channels in a test render

   Write these as a tiny library `blender_probes.py` shipped INTO the workspace; agent calls it via `blender --python probes.py`. Returns JSON. Loop reads JSON. No LLM judgment for ground truth.

4. **Council on phase boundaries**. The existing Council (Phase 23-D) gets a new situation kind: `phase_completion_review`. Auto-engaged at every phase complete. The council reads the ledger + acceptance results + a vision snapshot, and emits proceed/revise/abort. This is the meta-quality gate.

5. **Diff-based progress checks**. Every hour, a `progress_sentinel` action:
   * Renders a 1-frame preview
   * Diffs it (perceptual hash) against the same render 1h ago
   * If diff < threshold → "no visual progress for 1h" → reflector triggered with `stalled_visually` failure mode
   * Prevents the "loop forever doing nothing visible" failure

6. **Ground-truth questions back to the operator**. If after 6h of attempts the council still says `abort`, the loop **must** escalate via `ask_user`/phone-approve before continuing. This is the safety valve.

**Files**:
* `agent/schemas.py` — `AcceptanceCriterion` model
* New: `agent/verification/runner.py` — acceptance criteria executor
* New: `agent/verification/vision_judge.py` — vision-as-judge wrapper
* New: `agent/probes/blender.py` (shipped to workspace at task start)
* `agent/orchestrator/council.py` — new situation kinds
* New: `agent/sentinels/progress_sentinel.py`

**Effort**: 2–3 weeks. Verification is what separates a *demo* from a *system*.

---

### Block E — Domain Adaptation (Blender / Web / Code / Vision)

**Problem**: each domain needs specialist *prompts*, *tools*, *verification probes*, *resource profiles*. A single generic loop can't pretend it knows all domains equally.

**Patterns**:

1. **Specialist personas** (already exists — Phase 26-A team). Extend: each persona declares its **tool allowlist**, **resource profile**, **prompt augmentations**, **verification probes**. Currently the `senior_backend` persona just gets a different system prompt. Should also get:
   * Tool allowlist: `fs.*`, `bash.run(profile=read_host)`, `web.research`, NO `vision.see_camera`, NO `esp32.*`
   * Heavyweight personas (`blender_artist`) declare `requires_resource: ram >= 6gb, disk >= 5gb`

2. **Domain "departments"** with internal sub-teams. `blender_artist` department contains: `terrain_modeler`, `texture_artist`, `lighting_director`, `camera_operator`, `render_tech`. `agent.assemble_team("blender", mission="city")` builds them, runs in parallel where appropriate, joins.

3. **Domain skill library** — a versioned folder per domain in workspace:
   ```
   ~/.phantom/skills/blender/
     ├── README.md                # what this skill library can do
     ├── probes/                  # blender_probes.py + heightmap_check.py + ...
     ├── primitives/              # terrain_voronoi.py, road_grid.py, building_lod.py
     ├── recipes/                 # cyberpunk_city.md, fantasy_village.md
     └── retros/                  # "what went wrong last time" lessons
   ```
   The specialist persona's prompt includes `SKILL LIBRARY: ~/.phantom/skills/blender/README.md`. Lessons (Phase 23-G) auto-populate `retros/`.

4. **Reusable primitives over re-derivation**. Right now every Blender task starts from scratch: planner re-derives a voronoi road grid each mission. Brutal waste. Switch to: planner sees `primitives/road_grid.py` exists, *calls* it with new parameters, doesn't rewrite it.

5. **Cross-domain handoff**. Mission "city" needs: `blender_artist` for modeling, `senior_backend` for procedural Python, `researcher` for cyberpunk reference imagery, `reviewer` for aesthetic + technical review. Mission planner decides which department to invoke for which phase.

**Files**:
* `agent/team/specialists.py` — augment persona spec with tool allowlist + resource profile + skill library path
* New: `agent/skills/__init__.py` — skill library loader
* New: `~/.phantom/skills/blender/` — seeded skill set (ships with first install)
* `agent/team/spawn.py` — enforce tool allowlist at spawn time

**Effort**: 2 weeks. Mostly file shuffling + careful skill seed authoring. Skill library is the big one — needs at least 2–3 high-quality domains seeded by hand (Blender, web-scraping, build-systems) for the agent to bootstrap.

---

### Block F — Continuous Learning (lesson distillation + retrieval ranking)

**Problem**: Phase 23-G ships lesson distillation. It works, but lessons are recalled by raw embedding similarity — not by *recency*, *outcome*, *task class*. Slowly the lesson pool drifts toward noise.

**Patterns**:

1. **Outcome-weighted retrieval**. Lessons store `outcome: success|partial|failure` and `times_applied`, `times_helped` (operator or downstream verifier confirms). Retrieval ranks by `embedding_similarity × outcome_weight × log(1 + times_helped)`. Bad lessons sink.

2. **Lesson decay**. Each lesson has `last_useful_at`. If not retrieved/used in 30 days → moved to `cold_storage` (still searchable, but excluded from default top-k). If not used in 90 days → archived to disk, not searchable. Keeps the active set sharp.

3. **Self-critique loop on lesson candidates**. Before storing a lesson, a small LLM call: "Is this lesson genuinely transferable, or is it overfit to this specific task?" If overfit → don't store, or store in cold_storage immediately.

4. **Per-domain retrieval**. Retrieval scoped by `domain_tag` so a Blender task doesn't pull lessons from web-scraping unless the embedding really matches across.

5. **Counter-examples in retrieval**. When recalling top-3 supporting lessons, ALSO recall top-1 *contradicting* lesson (lowest similarity, but in the same domain). Forces the planner to reason against an opposing case. This is what makes "experience" robust vs cargo-cult.

6. **Identity drift detection**. Will Engine drives shift over time. If `curiosity` is pinned at 0.05 for a week (saturated), something is wrong — the system is bored or the operator has stopped giving novel tasks. Surface as a notification. Same for `mastery=0.95` for a week — agent's been doing only easy things.

**Files**:
* `agent/memory/lessons.py` — extend with outcome weights + decay
* New: `agent/memory/self_critique.py` — pre-store quality filter
* `agent/will/drives.py` — saturation detection + notification

**Effort**: 1 week. Mostly data-model + retrieval ranking math.

---

## 3. Hacks and Trade-offs (the unglamorous truths)

Things nobody tells you in tutorials:

* **Vision-as-judge is expensive**. Each Gemini multimodal call is ~$0.0005 + 2–5s. A mission with 200 phase-completion judgments + hourly progress diffs = $5–10 + 30min of latency total. Budget for this. Local fallback (LLaVA on Ollama) is 10–20x slower but free.

* **Blender headless on Q6A** caps at ~2000 polygons/sec for export and ~30s/frame for EEVEE at 1080p. A city scene at 50k polys with 30s @ 24fps = 4 hours render minimum. Plan acceptance accordingly. Never let the LLM declare "render done" until the framecount matches.

* **Ollama and faster-whisper are RAM-hostile to each other**. Don't run both at full quality during a long task. Pre-allocate: during long Blender renders, downgrade Ollama context to 2k and whisper to `small.en`. Re-upgrade after the heavy phase.

* **bwrap `--ro-bind` slows file enumeration ~3x**. For long IO-bound phases, the `read_host` profile costs latency. Sometimes `unsafe_mode` on a verified-clean phase is the right answer. The toggle exists; the planner should know when to ask for it.

* **Git checkpointing on a 20 GB workspace** takes seconds per commit. After phase boundary, OK. Per-action (currently HIGH risk only) is too aggressive — disable for trivially-replayable actions, keep for irreversible.

* **The reflector LLM call is the single biggest budget eater** (~40% of tokens on long runs). Cap aggressive — `force_reflect_ratio=2` is fine, anything < 2 burns budget without quality gain. Quality gate tests this empirically.

* **You cannot replan around a stuck operator.** If the mission says "use Blender 4.3" and Blender 4.3 has a bug that crashes the export, the agent loops forever unless `ask_user`. Make sure escalation is wired to the phone, not just desktop intervene — operator can be away.

* **Provider quotas are not your friend on day-3+**. Gemini Pro has a daily token cap. Plan for it: at 80% of cap, the loop must switch to Ollama-only mode and notify. Don't let it hard-fail.

* **Don't trust your own logs**. Add an external sanity timer: a cronjob (separate process) that every 10 min reads the mission ledger's "last update" timestamp. If it's > 30 min stale, ping operator: "mission appears stalled, agent claims X but ledger hasn't moved." This catches the agent silently lying to itself.

* **Idempotency is harder than it sounds**. `bash.run("apt install ...")` is *not* idempotent (apt-cache updates). `fs.write` of identical content is idempotent. `git_checkpoint` is idempotent if no working-tree changes. `vision.see_screen` is *never* idempotent — the screen moves. Per-action design matters.

---

## 4. 12-Week Roadmap

Realistic ordering. Each week is a real week (~25h focused work).

| Week | Block | Concrete output |
|---|---|---|
| 1 | A-1: Rehydrate | `rehydrate_task` + systemd unit; daemon survives restart, resumes tasks |
| 2 | A-2: Idempotency | `_idempotency.py` helper; `fs.write`, `bash.run`, `blender.run` retrofitted |
| 3 | B: Resource governor | `system_monitor.py` + pre-flight gate + resource block in prompt |
| 4 | C-1: Schema | `Mission` + `Phase` tables, ledger file format frozen |
| 5 | C-2: Mission planner | `agent/planner/mission.py` + `phase.py`; loop drives the new hierarchy |
| 6 | D-1: Acceptance criteria | `AcceptanceCriterion` model + executor; auto-runs at sub-goal end |
| 7 | D-2: Vision-as-judge | Vision judge + Blender probes; aesthetic verdicts wired into mission |
| 8 | D-3: Sentinels | Progress sentinel + external sanity cron; lying detection |
| 9 | E-1: Skill library | Seed Blender + web + code skill libraries; persona allowlists |
| 10 | E-2: Departments | `assemble_team` extended for cross-domain handoffs |
| 11 | F: Memory hygiene | Outcome weights + decay + self-critique on lesson candidates |
| 12 | Integration | Run a real 72h mission. Fix what breaks. Document. Ship. |

**Test mission for week 12**: *"Build a fully procedural cyberpunk Tokyo block (200m × 200m), 8 distinct building styles, working neon, animated traffic, render 15s cinematic at 1080p24, deliver MP4 + .blend + breakdown notes. Budget: $20 of Gemini + 72h wall time."*

If at end of week 12 PHANTOM delivers that **without operator intervention** and the result is genuinely good (operator + 3 council-LLM judges agree it meets the brief), the architecture is real.

---

## 5. Anti-patterns (chronologically listed by how much they cost)

Things to refuse, even when tempting.

1. **"Just let the LLM judge its own output."** Always pair with structural ground truth (file exists, polygon count, render histogram). LLMs reliably hallucinate success.

2. **"Add more reflection cycles to fix bad output."** Throwing reflections at a bad plan loop just burns budget. After 2 consecutive `revise_strategy`, force a council deliberation or escalate to operator.

3. **"More tools = more capable."** More tools = larger schema, smaller cache hit rate, more wrong picks. Keep the per-task tool allowlist *small*. Specialists with 5–10 tools beat generalists with 50.

4. **"Run Ollama and faster-whisper at full quality concurrently."** This will OOM the Q6A. Resource governor must downscale at runtime, not just at startup.

5. **"Skip checkpointing for speed."** You will lose work. Checkpoint cost is amortized over restart cost; restart cost without checkpoint is ∞.

6. **"Let the agent write its own probes."** Sometimes OK, sometimes the probe is a stub that always returns success. Probes for verification MUST be human-written and human-reviewed. Treat them like security tests.

7. **"Trust the recent_task_summary for long horizons."** It's a one-paragraph summary by step 1500. The ledger is the source of truth, not the summary.

8. **"Persistent will means the agent always has a goal."** A persistently-driven agent without an active mission will start doing things you didn't ask. The will engine should *modulate* missions, not *originate* them — at least until verification is rock-solid.

9. **"Sandbox is the safety net."** Sandbox is one safety net. Defense in depth: bwrap + risk-tolerance + Council + phone-approve + read-only filesystems + per-action idempotency + watchdog. Any single layer fails some of the time.

10. **"Once it works for one mission, it works for all."** Each new domain needs at least one week of skill-library + probe authoring before claiming the system "does" that domain.

---

## 6. What this roadmap is NOT

* It's not a guarantee. It's a map. The actual implementation will reveal sub-problems that aren't on this list.
* It's not a substitute for the operator. Even at full capability, a 72h mission needs operator review at start (brief), at every phase boundary in real-time *or* asynchronously via phone, and at delivery.
* It's not "ship in 12 weeks". It's "12 weeks of focused engineering work" — calendar time is 4–6 months realistically, given other obligations.
* It's not the only path. There are alternatives (Devin-style cloud sandbox, full RL fine-tune, multi-model ensemble) that trade different costs. This roadmap optimizes for: ship-on-existing-stack, keep-data-local, minimize-API-cost, leverage-existing-Phantom-investment.

---

## 7. Where to start tomorrow

If you accept this map, the **single highest-leverage move next session** is:

* Block C-1 + C-2 in tandem — Mission + Phase schema and the mission ledger format.

Why: every other block depends on having durable mission state. Resilience (A) replays into it. Verification (D) gates on phase boundaries. Specialists (E) are spawned at phase boundaries. Memory (F) scopes by phase. Without the ledger, every other block is plumbing around a missing center.

Estimated time: one focused session (~3h) for the schema + ledger writer; second session (~3h) for the mission planner that decomposes operator-brief → phases; third session (~3h) for loop integration.

Then everything else has somewhere to attach.

---

*This is a working roadmap, not a final spec. When reality contradicts it, reality wins.*

---

## 8. Capability Verticals — what is missing per domain

The Blocks A–F build the spine. The **verticals** are what makes PHANTOM able to do *specific* high-value missions. Each vertical is a sidecar discipline — it depends on the spine but lives in its own bounded context with its own probes, risk gates, and resource budgets.

For each: **current state**, **missing pieces** (concrete), **effort** (focused weeks), **risk class** (PAPER = simulation only safe / LIVE = touches real systems), **dependencies on Blocks A–F**.

The order is rough capability ladder — V1–V3 unlock everything else; V4–V9 are domain investments.

---

### V1 — Multi-channel Vision Extensions

**Current state**: One-shot capture works on 5 channels (Gemini pixels, OmniParser grounding, OCR, AT-SPI tree, Playwright DOM). Camera one-shot landed today (`vision.see_camera`).

**Missing**:

1. **Continuous vision daemon** — current model is per-action snapshot. For "watch the chart and alert on breakout" we need a 1–2 Hz capture loop with throttled re-analysis (only re-run Gemini when perceptual hash diff > 0.15). Surfaces as new action `vision.watch_screen(region, predicate, on_match)`. Background-track only.
2. **Multi-monitor**. `screen_capture.py` reads primary. Extend with `display_id: int` parameter; auto-list displays via Xrandr/Wayland `wlr-randr`.
3. **Video stream** (vs single frame). `vision.see_camera_stream(duration_s, fps)` — for "show me the last 10 seconds when motion was detected". Persist as MP4 in workspace.
4. **Depth / stereo** (only relevant if a second camera lands on the Q6A). Stub for now; do not implement until hardware exists.
5. **Privacy zones**. Operator can declare regions of the camera frame that get pixelated before any LLM call (e.g. always blur the door behind you). Stored per-user.
6. **Vision diff between frames** — `vision.diff(frame_a, frame_b)` returns structured description of what changed. Different from raw perceptual hash — semantic ("the chart added a red candle at 14:32").

**Effort**: 1.5 weeks. **Risk class**: PAPER (passive observation). **Depends on**: B (resource governor — continuous daemon must throttle under RAM pressure), A (must survive restart).

---

### V2 — Browser & UI Stealth (anti-bot, human-like imitation)

**Current state**: Playwright `BrowserNavigate / BrowserExtract / BrowserClickByDescription` work. Raw `xdotool/wayland`-level input through `ScreenClick / ScreenType` works. Both are detectable as automation.

**Missing**:

1. **`playwright-stealth` integration**. Patches `navigator.webdriver`, `chrome.runtime`, audio fingerprint, canvas fingerprint, Notification.permission, etc. Default ON for all browser actions, opt-out via `stealth=False`. Closes Cloudflare/PerimeterX/Datadome instant-blocks.
2. **Human input layer** (`agent/actions/_human_input.py`):
   * **Click**: Bezier-curve mouse path from current → target, 200–600ms duration, jitter ±2px on touchdown, occasional 0.5% misclick + correction.
   * **Type**: Per-key delay sampled from log-normal (mean 80ms, σ 30ms), occasional typo + backspace, 1–3% rate.
   * **Scroll**: Wheel events with momentum decay curve, not instant teleport.
   * **Pauses**: Reading-time pauses between actions, derived from on-screen text length.
3. **Behavioral fingerprint resilience**:
   * Persistent browser profile per "identity" (separate Playwright user-data-dir per persona)
   * Consistent timezone / language / UA / viewport per identity
   * GPU fingerprint stable per identity (via stealth flags)
4. **Multi-tab orchestration**. Currently each `browser.*` action acts on a single page. Extend to `browser.tab.open / .switch / .close` so the agent can hold 5 tabs (research / docs / target / monitoring / scratch).
5. **Captcha encounters**. When a 2Captcha-resolvable challenge appears, route to operator's phone via approve-on-phone with a "solve this captcha" screen. If operator is offline, pause task. Never silently fail-through.
6. **Session state durability**. Cookies, localStorage, IndexedDB persist across restart via Playwright `storage_state` snapshots, encrypted at rest under the same key as Vault.

**Effort**: 2 weeks. **Risk class**: PAPER for research; LIVE the moment authenticated sessions are involved (account bans possible). **Depends on**: A (session state survives restart), F (per-identity memory partitioning).

**Anti-pattern**: Do NOT use stealth for terms-of-service violation. The mode is for legitimate research, accessibility, archival — not credential stuffing or scraping behind explicit no-robot signals. The Council situation kind `tos_concern` must auto-trigger on first sight of a robots.txt deny or a clickwrap accepted by another party.

---

### V3 — Web3 Subsystem

**Current state**: No first-class action. Workaround: `bash.run(profile=read_host)` can `pip install web3.py`, but private keys live in env where `host_env_unsafe` exposes them to any subsequent action — unacceptable.

**Missing**:

1. **`wallet.sign` action** — runs in a separate subprocess with `--unshare-net --ro-bind /usr --ro-bind /etc --bind /tmp/wallet-ipc /tmp/ipc`, isolated from anything else the agent does. Private key never enters the main daemon's address space. Signing happens via a domain-socket RPC. Key material decrypted from Vault, never written to disk.
2. **RPC quorum client** (`agent/web3/rpc_quorum.py`). For every read query, fan out to N RPC endpoints (Infura + Alchemy + own node), require majority agreement, surface dissent. For every write (signed tx), submit to all, monitor for inclusion on at least 2 — protects against single-RPC malicious response.
3. **Mempool watch daemon**. WebSocket subscription to pending txs filtered by `to`/`from` addresses of interest. Surfaces as events to the agent loop ("address X moved 5 ETH 200ms ago").
4. **Smart-contract verification probes**:
   * `slither <addr>` for static analysis
   * `mythril analyze --rpc <RPC> <addr>` for symbolic execution
   * Bytecode-vs-source verification against Etherscan
   * Honeypot detector — simulate buy + sell against forked chain via Anvil
5. **Gas oracle integration** — Blocknative/Etherscan gas-track APIs feed `_format_resource_block`-style prompt section: "current gas: 23 gwei, trend rising". Planner can wait for cheaper window.
6. **Tax/audit log**. Every signed tx written to `~/.phantom/web3/ledger.jsonl` with chain, tx_hash, value, counterparty, USD-at-time, agent-rationale, council-verdict. Append-only, cryptographically chained (each entry's hash includes prior). Used for tax + dispute.
7. **Token allowance hygiene**. After each interaction, revoke residual ERC-20 allowances unless explicitly long-lived. Standard practice; agent must do it.

**Effort**: 3 weeks. **Risk class**: LIVE — real funds. **Depends on**: D (verification — must judge contract bytecode before signing), B (mempool daemon under RAM pressure), C (multi-step txs across phases), Vault.

**Hard rule**: Until D's verification council reaches a "no aesthetic-fraud" maturity level on smart contracts, every tx > $50 routes through phone-approve. No exceptions. The Vault biometric reveal flow extends here.

---

### V4 — Trading Subsystem (Rust fast-lane + deterministic risk)

**Current state**: Nothing trade-specific. LLM loop with 1–10s tick is too slow for anything beyond positional/daily.

**Missing — and this is a separate engineering project**:

1. **Rust fast-lane sidecar** (`phantom-trader/`). Independent binary, NOT a Python action. Owns the trading hot path:
   * tokio-tungstenite WebSocket clients per exchange (Binance, Bybit, Coinbase, Hyperliquid)
   * Lock-free order book per symbol (BTreeMap with versioning)
   * Strategy engine — pre-compiled decision graphs, NOT LLM calls (sub-ms latency)
   * Order router with idempotent client-order-ids
2. **Communication**: Rust ↔ Python via Unix domain socket + bincode/protobuf. Python LLM gives *strategy parameters* (entry/exit conditions, position size, stop levels). Rust *executes* the strategy. LLM never sits on the order-decision path.
3. **Backtest harness**:
   * Historical tick data ingestor (parquet over S3 or local Cassandra) — minimum 6 months
   * Walk-forward replay with realistic latency, fill simulation, partial fills, slippage model
   * Per-strategy metrics: Sharpe, Sortino, max drawdown, win rate, P&L distribution
   * Strategies must pass backtest acceptance before going live
4. **Risk management layer** — deterministic, NOT LLM. Hard rules:
   * Per-trade position cap (default 1% of account equity)
   * Daily loss cap (default 3% of equity) → flatten all + suspend strategy + alert operator
   * Max concurrent positions (default 5)
   * Correlation cap (no two highly-correlated assets > 50% combined)
   * Kelly criterion advisory (NOT auto-applied — anchored at half-Kelly)
5. **Order book microstructure analytics**:
   * Live spread tracking
   * Effective spread calculation
   * Slippage prediction (volume vs depth)
   * Toxic-flow detector (sudden one-sided pressure)
6. **Disaster mode** — circuit breakers independent of LLM:
   * Network down 30s → flatten all positions, market orders, no LLM consult
   * Exchange API error rate > 5% over 60s → suspend strategy
   * RAM > 95% → suspend non-essential subscriptions, keep order routing alive
   * Operator-set "panic" via phone biometric → instant flatten + lock
7. **Compliance + tax log**. Per-trade record: timestamp (ns), symbol, side, qty, fill price, fee, USD-equiv-at-fill, account, jurisdiction. Append-only. Exportable in formats KYC counsel expects.
8. **Strategy lifecycle**: Research (paper) → backtest → forward-test (small live, ≤ $100 equiv) → graduated capital (10× steps with operator approval at each).
9. **Operator dashboard**: dedicated `OperatorTrading.tsx` layout — live P&L, open positions, current strategy, recent decisions. NOT mixed with the main agent screen.

**Effort**: 6–8 weeks. **Risk class**: LIVE — real money, irreversible. **Depends on**: A (strategy state survives restart), B (must coexist with Blender renders without RAM contention), C (multi-phase research → backtest → live), D (backtest verification), Vault (exchange API keys).

**Hard rule**: LLM is **never** on the order-decision path. LLM proposes strategies, council reviews, backtest validates, Rust executes, deterministic risk gates filter. If this rule is ever violated, real money goes to zero on the first market regime change.

---

### V5 — Pentest / Bug Bounty

**Current state**: `net.scan` does TCP/UDP port scan to /24. `browser.*` can interact with auth flows. No specialist tooling.

**Missing**:

1. **nmap orchestrator** (`pentest.scan`) — wraps nmap with sensible defaults, parses XML output to structured findings. Rate-limited to never DoS the target.
2. **Burp Suite integration** — `burp.intercept(target_url)` spawns headless Burp + Playwright with Burp as upstream proxy; agent reads/replays/mutates requests through Burp's REST API.
3. **Vulnerability scanner suite** — nikto, sqlmap (in safe-mode only), nuclei. Each as its own action with strict target allowlist.
4. **Exploit harness** — Metasploit RPC client. **Hard-gated**: requires explicit operator written acknowledgement of authorization (scope document hash committed to mission ledger).
5. **Reporting templates** — Markdown report generator with CVSS scoring, reproduction steps, remediation suggestions, optional video capture via V1's `vision.see_camera_stream`.
6. **Scope enforcer** — every action that touches the network checks the target IP/hostname against an explicit allowlist for the current mission. Outside-scope action is hard-refused, not Council-deliberated.

**Effort**: 2–3 weeks. **Risk class**: LIVE — legal liability is huge for unauthorized scans. **Depends on**: A (mission survives restart), D (Council reviews scope before any active probe), Vault (target credentials).

**Hard rule**: A pentest mission cannot start without a signed scope document. The signature is verified at mission spawn; absence = hard refusal. The Council situation `scope_violation` auto-engages on any out-of-scope action attempt.

---

### V6 — Video / Streaming Production

**Current state**: ffmpeg available via `bash.run`. No high-level orchestration.

**Missing**:

1. **`video.compose` action** — declarative video pipeline (sources, filters, transitions, output codec) → ffmpeg filter graph → render. Hides ffmpeg incantation hell behind a structured args schema.
2. **OBS WebSocket integration** — `obs.scene.switch`, `obs.source.toggle`, `obs.record.start/stop`. Lets agent control a live stream.
3. **Stream health monitor** — RTMP / SRT health probe, framerate/bitrate watcher, drop detector. Surfaces as events.
4. **Subtitle pipeline** — faster-whisper transcribe → autocorrect → SRT export → burn-in via ffmpeg.
5. **Cinematic helpers** — Ken Burns effect, color grading LUT application, audio loudness normalization (EBU R128). Each a small standalone action.
6. **Live director persona** — `live_director` specialist that watches the stream + chat + scene composition, suggests/executes scene switches.

**Effort**: 2 weeks. **Risk class**: PAPER (no real-money or legal stakes for offline; LIVE for public streams — reputation). **Depends on**: B (heavy CPU/RAM during render), V1 (vision for scene composition feedback).

---

### V7 — Legal / Compliance Documents

**Current state**: LLM can write text. No jurisdiction-grounded RAG, no template registry, no audit trail.

**Missing**:

1. **Legal RAG corpus** — per-jurisdiction text (EU, US-federal, US-state, UA, etc.) ingested into ChromaDB with metadata `{jurisdiction, doc_type, effective_date, supersedes}`. Update pipeline that ingests new gazette entries.
2. **`legal.lookup` action** — retrieves N most relevant clauses from a jurisdiction, returns with citation + effective date. NOT a "write the contract for me" action — a research action.
3. **Template registry** — `~/.phantom/legal/templates/` of operator-vetted templates (NDA, employment, services, IP-assignment, EULA, terms-of-service). Each tagged with jurisdiction.
4. **Specialist persona `legal_drafter`** with:
   * Tool allowlist: `legal.lookup`, `fs.read/write`, NO bash, NO browser
   * Prompt guardrails: "always cite source; never invent statute; ALWAYS recommend operator engage a licensed attorney before reliance"
   * Output gets a mandatory disclaimer block appended at action level
5. **Verification council kind** `legal_review` — two-persona review (drafter + adversary), surface every clause without citation.
6. **Audit trail** — every drafted document gets a signed `.phantom-legal-audit.json` companion with sources used, council verdict, operator approval status. For dispute trail.

**Effort**: 3–4 weeks. **Risk class**: LIVE — bad legal output causes irreversible harm (signed bad contract). **Depends on**: D (verification council with adversary), Vault (signature certs).

**Hard rule**: PHANTOM does NOT replace counsel. It assists. Every output carries an unremovable footer pointing to that. Council situation `legal_unsupervised` auto-engages on any draft destined for a contracting party rather than internal review.

---

### V8 — Music Production

**Current state**: Nothing. ffmpeg can transcode, but no DAW/MIDI control.

**Missing**:

1. **DAW automation backend**. Pick one — Ardour has a Lua/OSC API; Reaper has Python/Lua; both work headless on Linux. Wrap as `daw.project.new / .track.add / .render`.
2. **MIDI tooling** — `midi.compose` action that writes MIDI files via mido; `midi.send_to_jack` for live routing.
3. **Audio analysis probes**:
   * Tempo / key detection (librosa)
   * Loudness / dynamic range
   * Frequency spectrum histogram
   * Stem separation (demucs/spleeter) for "extract bass from this track"
4. **Render pipeline** — full mix → master → loudness-normalize → MP3/FLAC export. Each step a separate action so it's resumable.
5. **Reference matching** — given target track A, render-and-compare candidate track B; verdict on similarity in tempo/timbre/dynamics.
6. **`music_producer` specialist** with the above tools and a long-horizon brief (mission C lives well here — "produce a 3-track EP in the style of X over 2 weeks").

**Effort**: 3 weeks. **Risk class**: PAPER (offline). **Depends on**: B (heavy CPU on render/separation), D (vision-as-judge analogue for audio: "does this sound mastered?"), C (multi-phase: write → arrange → mix → master).

---

### V9 — ML Training Orchestration

**Current state**: `bash.run` can launch a `python train.py`. No GPU governance, no checkpoint replay specific to training, no metrics integration.

**Missing**:

1. **GPU resource model** — extend `SystemMonitor` (Block B) with per-GPU memory, utilization, temperature via `nvidia-smi --query-gpu`. PHANTOM Q6A has integrated GPU; this matters when a future build adds dGPU.
2. **Training-aware checkpointing** — wrapper around `torch.save` / HF accelerate / lightning checkpoint hooks so that on restart, training resumes from latest checkpoint, not from epoch 0.
3. **WandB / mlflow integration** — `ml.log_metrics` action pipes through to the operator's run logger. Council can read run charts ("loss is flat for 3h — abort and re-tune LR").
4. **Distributed training launcher** — `ml.train.distributed(hosts, gpus_per_host, ...)` orchestrates SSH-based DDP launch; tracks each rank's heartbeat; restarts failed ranks.
5. **Hyperparameter search** as a long-horizon mission — Bayesian optimization wrapped as agent loop: spawn N trials, monitor, prune, allocate compute, declare best.
6. **Dataset sanity probes** — class imbalance, duplicate detection, leakage between train/val. Auto-run before any training start.

**Effort**: 2 weeks. **Risk class**: PAPER (compute cost only; no real-money risk unless cloud GPU). **Depends on**: B (GPU monitor), C (multi-day training as a phase), D (probes as acceptance criteria), F (lessons distill across training runs).

---

## 9. Cross-vertical patterns (do not re-derive per vertical)

These patterns appear in every vertical above. Centralize them once.

* **Specialist persona definition** = `(system_prompt, tool_allowlist, resource_profile, skill_library_path, council_situation_kinds, hard_rules)`. The `agent/team/specialists.py` schema needs all six fields, not just system_prompt.
* **Domain skill library layout** = `README.md / probes/ / primitives/ / recipes/ / retros/` — same shape, different content per vertical.
* **Acceptance criteria** are domain-specific but use the same `AcceptanceCriterion` schema (Block D). Each vertical contributes its probe types (`polygon_count`, `tick_data_freshness`, `evm_call_simulated`, `loudness_lufs`, `model_val_loss`).
* **Hard rules** registry. Each vertical lists rules that must never be bypassed (LLM never on order-decision path, legal output always disclaimed, pentest never out-of-scope). These get enforced at executor level, NOT just prompted.
* **Risk class tagging** propagates through the loop — PAPER mission can use ambient resources freely; LIVE mission throttles itself, demands more council, more phone-approve.

If even one vertical re-implements one of these locally, technical debt explodes.

---

## 10. Verticals roadmap (after Blocks A–F)

Once the spine (A–F, 12 weeks) lands, verticals can ship **in parallel** because they share the spine but don't depend on each other. Realistic ordering by ROI:

| Order | Vertical | Why first | Cumulative weeks |
|---|---|---|---|
| 1 | V1 — Vision extensions | Unblocks every other vertical that wants "watch X" | 12 + 1.5 = 13.5 |
| 2 | V2 — Browser stealth | Most missions touch web; stealth + human input has the widest reuse | 15.5 |
| 3 | V5 — Pentest **or** V6 — Video | Lowest live-risk + high operator value | 17.5 |
| 4 | V9 — ML training orchestration | Lets PHANTOM improve itself + serves a clear operator demand | 19.5 |
| 5 | V3 — Web3 | High value, high care — wait until Vault + Council are battle-tested | 22.5 |
| 6 | V8 — Music | Pure creative outlet, no risk; pleasant week | 25.5 |
| 7 | V7 — Legal | Big effort, big risk; requires real attorney advisory partnership before shipping | 29.5 |
| 8 | V4 — Trading | Last because the deterministic Rust fast-lane is the most complex sidecar and the most consequential mistake-class | 37.5 |

That's a ~9-month total program from today's state to a system that can credibly attempt **any** of the listed missions, with each vertical operator-toggleable per mission.

---

## 11. What is **not** on this roadmap (and probably should never be)

Stating refusals on the record:

* **Autonomous social engineering / phishing harness** — the stealth layer (V2) is for *consented* research. We do not build harvesters that impersonate humans against unsuspecting third parties. Refusal is at the agent level, not the operator level.
* **Anti-detection for sanctions / KYC evasion** — Web3 wallet isolation is for security, not for laundering. KYC log (V3.6) makes evasion structurally incompatible with the architecture.
* **Synthetic media impersonation of identifiable persons** — V6 video tools refuse face-swap / voice-clone of specific named people without explicit consent payload. Council situation `consent_missing` is hard-refused, not deliberated.
* **Trading other people's funds** — V4 architecture is for the operator's own capital. Multi-account orchestration on behalf of unconsented parties is out of scope.
* **Legal opinion as legal opinion** — V7 outputs are *drafts*, never *opinions*. The footer disclaimer is structural, not advisory.

These refusals are coded into the executor as hard-stops, not into LLM prompts. Prompts can be jailbroken; executor checks cannot.

---

## 12. Estimated total program

| Block | Time | Status |
|---|---|---|
| Spine (A–F) | 12 weeks | Roadmap above |
| Verticals (V1–V9) | 25–27 additional weeks of focused work, parallelizable across operators if more than one engineer | Spec above |
| **Total** | **~9 months solo / ~5 months with two engineers** | **End-state**: PHANTOM credibly attempts any of: long-horizon Blender film, multi-week ML training, pentest engagements within scope, Web3 portfolio operation, music EP production, live-streamed creative production, legal-research drafting — all from a single operator brief, with operator review at phase boundaries instead of step-by-step |

This is what "more powerful than Claude Code, sustained for days" actually costs to build.

Refuse the timeline before refusing the spec. The spec is honest; the timeline is the price of honesty.

