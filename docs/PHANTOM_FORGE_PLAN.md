# PHANTOM FORGE — PC Node Total Rework Plan (V2)

**Date:** 2026-07-02 (V2 same day: added Part II — total internal rework)
**Status:** ACTIVE — supersedes `PHANTOM_OS_GRAND_PLAN.md` §1 (module breadth list)
and the 40-capability catalog of `ECOSYSTEM_GRAND_PLAN.md` §1 as *execution
documents*. Those files remain as idea quarries; nothing in them is a
commitment anymore.
**Structure:** Part I (F-phases) = what the organism becomes — the pair, the
Foundry, the ateliers. Part II (G-phases) = total rework of the body itself —
every subsystem of the 142k-line backend and 58k-line frontend audited,
unified, or rebuilt. F says *where we're going*; G says *what we fix in the
flesh to get there*. They interleave (schedule at the end of Part II).
Part III (Amendment A) = STAVKA, the living agent organization. Part IV
(Amendment B, L-phases) = CHANCELLERY — knowledge, deliberation, foresight.
**Sibling documents:**
`phantom-companion/docs/PHANTOM_V3_REBUILD_PLAN.md` (the phone body, R-phases)
and `phantom-companion/docs/PHANTOM_SYMBIOTE_CODEX.md` (the concept pillars).
This plan is their PC-side counterpart: **F-phases**. R and F interlock but
never block each other except where explicitly marked.

Operator directive (2026-07-02): «Треба в рази сильнішу концепцію, окремо
потужна робота у парі з телефоном так що користувач цього навіть і не
помічає. Можливості окремих агентських масштабних робіт де днями може одна
задача виконуватись… не просто написати код а розуміння і бачення візуально
того що створюється… по мапам можна стільки всього придумати що гугл карти
здадуться іграшкою.»

---

## Why this plan exists

phantom-os is large (~1230 green backend tests, mature FastAPI core, voice
stack, OmniMap, vault, agent council) and simultaneously very small: it does
not know *what it is*. The repo carries three diseases, all documented by its
own audits:

1. **Identity confusion.** It behaves like a standalone product — its own
   chat, its own login, its own settings — competing with the phone instead
   of completing it. The operator lives in their pocket, not at a desk.
2. **Breadth disease.** `ECOSYSTEM_GRAND_PLAN` lists 40 capabilities;
   `PHANTOM_OS_GRAND_PLAN` answers with ~30 *new* backend modules. That is
   how the companion got 18 orphaned subsystems with zero consumers. Depth
   beats breadth; a capability that isn't wired end-to-end to the operator's
   pocket does not exist (companion Law 1).
3. **Hygiene rot.** Logs, scratch scripts and fix-scripts in repo root; a
   docs/ graveyard of 100+ phase folders; 24 GB working tree. Trust in the
   repo decays with every session that has to wade through it.

The cure is the same one that is already working on the phone: a short list
of laws, a strict phase order, one honest capability at a time, commit-per-
sub-item, acceptance lines that a human can verify.

---

## The Concept — One Organism, Two Bodies

There is **one PHANTOM**. One identity, one memory, one ledger of what it
perceived and did. The phone and the PC are not "versions" — they are limbs
with different gifts:

| | Phone (Companion, R-plan) | PC (Forge, this plan) |
|---|---|---|
| Role | **Senses & presence** — always with the operator | **Muscle & long horizon** — always powered, GPU, disk |
| Perceives | location, motion, notifications, voice, camera | screen, filesystem, network, render viewports |
| Acts in | seconds | hours and days |
| Surface | the chat/Stream — **the mouth of the organism** | a workshop window — glanceable, never primary |
| Dies when | battery / OEM kill (WorkManager law) | power loss / reboot (Journal law, F2) |

The seam between the bodies is a **capability mesh**: every node advertises a
signed capability set (`gpu`, `blender`, `browser`, `disk:2TB`, `always-on`,
`watts:45`), and the tool router sends each call to whichever limb owns the
needed hand. The operator writes «зроби місто» into the same chat as always;
the phone has no Blender, the mesh does; progress flows back into the same
Stream as facet cards. **The operator never notices the seam. That is the
entire UX specification of the mesh.**

The Codex defines symbiote intelligence as `perception × memory × initiative
× taste`. The Forge adds the fifth multiplier the phone can never have:

> **× industry** — the capacity to labor on one thing for days without
> forgetting, tiring, or silently dying.

And where the phone's master loop is `SENSE → FUSE → NOTICE → DECIDE →
ACT/PRESENT → LEARN`, the Forge adds the labor loop that runs inside every
long task:

```
CONTRACT → PLAN → LABOR → CHECKPOINT → SEE → CRITIQUE → (loop) → DELIVER
```

The `SEE → CRITIQUE` pair is the load-bearing idea for creative work: the
Forge never generates blindly into Blender/Unity/a browser. Every pass
renders or screenshots its result, looks at it with multimodal eyes, judges
it against the goal, and patches *structured state* (a scene graph, a DOM, a
document tree) — not regenerated code. A detailed city is impossible for
blind codegen and routine for a seeing loop over procedural open data.

---

## Laws (non-negotiable, apply to every F-phase)

1. **No fake theater.** Unwired = absent. No endpoint, UI element, or
   capability advertisement that pretends. (Companion Law 1, verbatim.)
2. **Wire or delete.** The salvage audit (F0.1) is the only inventory that
   matters; the 40-item gap list is void. A module kept must have a named
   consumer in some F-phase, else it is FROZEN (excluded from runtime) or
   DELETED.
3. **The phone is the mouth.** No feature ships a PC-only surface first if
   its consumer is the operator. Forge outputs arrive as Stream facets on
   the phone; the PC window (F9) is a workshop view, never a second chat.
4. **Every hand is gated and audited.** Every tool: permission gate (parity
   with companion `ToolPermissionGate` semantics), audit entry, honest
   failure. Every tool exposed to the model is added to the Gemini adapter
   schema (companion Law 4 applies mesh-wide).
5. **Durable by default.** Any task expected to run >5 minutes must survive
   process death: event-sourced journal + resumable checkpoint. This is the
   PC sibling of the phone's WorkManager law.
6. **Creation must see.** No creative pipeline (3D, UI, documents, maps) may
   apply more than one pass without a render/screenshot → critique step in
   between, logged in the task journal.
7. **Budget honesty.** Time, tokens, and money are metered per task and
   visible in the ledger before, during, and after. A contract gate (F2.2)
   precedes every long task.
8. **One attention stream.** Forge-originated insights flow through the
   phone WatchTower's calm contract (budget, quiet hours, severity ladder).
   The Forge NEVER becomes a second notification channel.
9. **Repo hygiene.** Nothing in repo root but the project's front door. No
   logs, no scratch, no fix-scripts. One phase per session, commit per
   numbered sub-item tagged `f#.#-name`, tests green before commit.

---

## Phase F0 — Triage & Identity Surgery (do first, 1–2 sessions)

The trust-repair phase. Nothing new is built.

### F0.1 salvage-audit
Walk every backend module and produce ONE table (append to this file, §
Salvage Ledger): `module → KEEP (has F-phase consumer) / WIRE (real but
orphaned; name the phase that consumes it) / FREEZE (real, off-mission;
excluded from app startup) / DELETE`. Candidates already visible:

- **KEEP/WIRE**: `core/event_bus`, `core/state_machine` (6 states incl.
  DREAM — F8.3 consumer), `ai/*` providers + tool dispatcher, `memory/*`
  tiers, `geo/*` (pmtiles, routing, elevation — F6), `vision/screen_capture`
  + `screen_ocr` (F4!), `input/desktop_control` + `atspi_bridge` (F4),
  `linux/executor` + `dangerous_patterns` (F3), `agent/planner` + `audit` +
  council (F7), `tools/checkpoint_service` (F2), `api/routes_pair`,
  `routes_handoff`, `discovery/mdns_publisher` (F1), `voice/*` (kept as-is,
  it ships).
- **FREEZE candidates**: `memory/tom_dream`, `memory/core_narrative`,
  `agent/consciousness_stream`, `ai/sentience`, `wardriving/*`, `firmware/`
  ESP32 lane — real work, off the critical path; freeze, don't delete.
- **DELETE**: dead experiments the audit finds with zero imports.

### F0.2 root-hygiene
`backend*.log`, `frontend*.log`, `*_flake8.log`, `scratch.py`,
`fix_fasttrack.py`, `refactor_imports.py`, stray `phantom.db`,
`src/backend/~`, `.swarm.backup-*` → moved under `scripts/` or deleted;
`.gitignore` extended so they cannot return. docs/ phase-graveyard moved to
`docs/archive/` in one commit (history preserved, floor clean).

### F0.3 node-manifest
One `phantom_node.toml`: node identity (public key), human name («Кузня»),
and the capability list — containing ONLY what is real at that commit.
Served at `/node/manifest`, signed. This file is the honesty anchor for the
whole mesh: F1 advertises it, the phone router trusts it.

### F0.4 theater-sweep
Same as companion R0.1: any route, UI element, or settings row whose backend
is a stub — removed. The frontend's fake-looking corners get the same knife
the phone's slash-palette got.

**Acceptance:** fresh clone → `start-phantom.sh` → `/healthz` green,
`/node/manifest` returns only true capabilities, repo root contains only the
front door, salvage ledger committed into this doc.

---

## Phase F1 — The Nerve (mesh peering; the phones stops being alone)

### F1.1 one pairing protocol
Reconcile the PC's existing ECDH+HMAC `routes_pair` with the companion's
core-net PairFlow (QR/claim-link, Ed25519/X25519/AesGcm). **The companion's
protocol is the reference; the PC adapts.** One ceremony: phone scans QR on
the PC screen (or claim-link), keys pinned both sides, revocation works.
Mind the known NSC pitfall: Android network-security-config needs exact
hosts, not CIDR.

### F1.2 capability advertisement
The signed `phantom_node.toml` capability set flows over the paired channel
+ mDNS for LAN discovery. The phone's router learns: this mesh has `blender,
browser, shell, gpu, disk, always-on`.

### F1.3 tool-call transport
The phone's `RoutedAIRouter` gains a mesh route: a tool call whose
capability lives on the Forge is serialized over the paired channel,
executed under F-side gates, and its result (including streaming progress)
returns as Stream items. First tool: `node.status` (uptime, load, GPU, disk,
active Foundry tasks). Second: `node.shell` behind an explicit high-friction
gate.

### F1.4 off-LAN honesty
Optional Tailscale/WireGuard bridge for away-from-home reach. If absent:
honest degradation — the phone says «Кузня поза досяжністю», never fakes.

### F1.5 handoff
Wire existing `routes_handoff` to the companion's `distributedself.*` orphan
(this is companion R6.3's counterpart — coordinate, don't duplicate).

**Acceptance:** operator asks the phone «що на кузні?» → live status facet
within 2s on LAN; pull the LAN cable → honest unreachable notice; every
mesh tool call visible in both audit logs.

---

## Phase F2 — Foundry (the long-horizon task runtime; the heart of this plan)

A task that lives for days cannot live in a chat history. It becomes a
first-class object.

### F2.1 task-as-object
Event-sourced journal (SQLite + append-only events): lifecycle
`proposed → contracted → running → checkpoint → review → done | abandoned`.
Every state change is an event; the current state is a fold.

**V2 amendment (recon finding):** the repo already contains THREE partial
Foundries built in different eras — `agent/kernel/` (loop, runtime,
long_running, checkpoints, rehydrate), `agent/missions/` (ledger, store,
reports, verify), `agent/operations/` (orchestrator, standing_orders,
approve_on_phone) — plus `ai/agents/` (orchestrator, sub_agent, budget).
F2 is therefore a **unification, not a greenfield**: ONE task spine survives
(kernel's loop/checkpoint machinery is the strongest skeleton), missions'
ledger/reporting and operations' standing-orders/approval become organs of
it, and the losers are deleted in the same commits (Law 2). Building a
fourth Foundry next to three dead ones is the exact failure mode this plan
exists to kill. See G1.2.

### F2.2 contract gate
Before `running`: a contract facet goes to the phone — goal, definition of
done, budget (wall-clock, tokens/$, disk), intervention points, and what the
Forge is allowed to touch. Operator approves from the phone. No contract, no
labor. (Law 7.)

### F2.3 checkpoint & resurrection
Configurable checkpoint cadence; on process death or reboot the Foundry
resumes every `running` task from its last checkpoint artifact on startup.
Kill -9 during a task is a *unit test*, not an incident.

### F2.4 progress facets
Milestones stream to the phone as facet cards with artifact thumbnails
(render, file, diff, page screenshot). Silence longer than a contracted
interval is itself reported («працюю, наступний checkpoint о 14:00»).

### F2.5 recurring & watch tasks
The same object with a schedule trigger (cron-like) or a condition trigger
(watch expression over F8 watchers). This single mechanism is the operator's
«надати завдання яке треба регулярно робити або слідкування за чимось».

### F2.6 intervention API
From the phone chat, mid-task: `pause`, `redirect <нова інструкція>`,
`cancel`, `show latest artifact`. A redirect becomes a journal event and a
re-plan, not a restart.

**Acceptance:** a synthetic 24h task survives a hard reboot, streams ≥3
milestone facets to the phone, is redirected once mid-run by voice, and its
final ledger shows time/token cost against contract.

---

## Phase F3 — Hands of the Forge (PC-grade tools)

Each behind a gate, each audited, each in the Gemini adapter (Law 4):

| Tool | Mechanism | Notes |
|---|---|---|
| `forge.shell` | existing `linux/executor` + `dangerous_patterns` | high-friction gate; dry-run preview in the approval facet |
| `forge.fs` | read/write/move under contracted roots | path-sanitized, per-contract allowlist |
| `forge.browser` | Playwright (already a dev dep) headed/headless | the agent's window to the live web; screenshots journal-logged |
| `forge.download` | aria2/httpx with checksum + quota | feeds F5/F6 asset pipelines |
| `forge.media` | ffmpeg transforms | video/audio conversion, thumbnailing |
| `forge.doc` | md → pdf/docx render | reports and deliverables |
| `forge.git` | clone/branch/commit on contracted repos | never pushes without an explicit gate |

**Acceptance:** from the phone: «скачай <відео>, витягни аудіо, поклади в
архів і дай посилання» — end-to-end, with audit entries and one approval.

---

## Phase F4 — Eyes of the Forge (the perception-action primitive)

The single most reused component of the whole plan. Build once, consume
everywhere (F5 ateliers, F6 cinematics, F3 browser, F7 agency).

### F4.1 SeeingLoop service
`see(capture) → critique(goal, capture, history) → verdict{pass | patch-list}`.
Capture sources: screen region (existing `vision/screen_capture`), app
window, Blender viewport render, browser page. Critique: multimodal model
call with the task goal and the previous captures; output is a *structured*
patch list, not prose.

### F4.2 actuators
Existing `input/desktop_control` + `atspi_bridge` wired as gated actuators;
plus per-atelier structured actuators (bpy ops, Playwright actions). GUI
clicking is the fallback; structured APIs are the preference.

### F4.3 visual memory
Every SEE capture and verdict is journaled; before/after diffs render in the
phone's milestone facets. The operator can scrub a task's visual history —
«покажи як воно виглядало вранці».

**Acceptance:** task «відкрий <застосунок>, зміни налаштування X» executes
with visual verification at each step, screenshots in the journal, zero
blind actions.

---

## Phase F5 — Ateliers (creative studios; Blender first)

The operator's own example, made real: «якщо місто деталізоване попросять
зробити — для чисто кодової це фантастика». For a seeing loop over open
data, it's a pipeline.

### F5.1 Blender bridge
Headless Blender as a persistent RPC worker (bpy). **The scene graph is the
source of truth**: the model reads and patches structured scene state
(objects, transforms, materials, modifiers, geometry-node params) — it does
not emit throwaway scripts. «Зроби собор вищим» = one node patch.

### F5.2 procedural base library
The 80%-by-data layer: OSM/Overture building footprints → extrusion with
roof heuristics; Copernicus/USGS DEM → terrain mesh; PolyHaven CC0
materials/HDRIs via `forge.download`; road/water/green from the F6 geo
store. One command materializes a raw but *correct* district.

### F5.3 the refinement loop
`render → SeeingLoop critique → targeted patches → re-render`, N contracted
passes (Law 6). The critique judges composition, lighting, scale honesty,
landmark fidelity — exactly the judgments blind codegen cannot make. This is
the same multi-pass grammar as companion R6.1 PhantomCanvas (`план → каркас
→ дані → полірування`) applied to a viewport; keep the vocabulary aligned.

### F5.4 operator co-creation
Milestone renders stream to the phone; voice patches («темніше небо»,
«більше дерев уздовж набережної») become scene-graph patches mid-task via
F2.6. The operator is a co-author with eyes on every pass, not a client
waiting three days.

### F5.5 Unity atelier (stub, later)
Only after Blender proves the loop: Unity Editor scripting bridge under the
same SeeingLoop + scene-graph contract. Same pattern, second tool — the
architecture cost is already paid.

**Acceptance:** «зроби деталізований квартал біля <точка>» → a textured,
lit, recognizable 3D scene; journal shows ≥3 critique passes with visible
improvement; one voice patch from the phone lands as a scene change.

---

## Phase F6 — Geo Forge (the heavy geo brain; Google-як-іграшка track)

Google's moat is data freshness and global routing — don't fight there. The
Forge's moat is **personal fusion + generative presentation + compute
Google will never spend on one person**.

### F6.1 ingestion
Overture Maps + OSM extracts for the operator's regions, DEM tiles, GTFS
feeds where available — into the existing `geo/` stack (`pmtiles_manager`,
`layer_registry`, `elevation`, `routing` — extend, don't rewrite).

### F6.2 heavy compute
Isochrones («що досяжне за 15 хв пішки ввечері»), viewsheds («що видно з
цієї гори»), corridor analyses, offline route matrices — computed on the
Forge, served to the phone map as **personal layers** (the direct sibling of
companion R4's `map.show`).

### F6.3 generative layers
A question becomes a bespoke composed layer, not a filter: «тихі зелені
маршрути додому» → green-share from OSM + traffic-noise proxy + lighting
tags, fused and styled, streamed as a layer + a facet explaining the
composition. The Facets grammar (companion R2.6) on geography.

### F6.4 memory on the map
The phone's Atlas places and ONNX-indexed history anchor to geography:
«тут ти казав про X у березні» — the layer Google can never have.

### F6.5 cinematic geo
F5's Blender atelier consumes F6 data: terrain + buildings + time-of-day
lighting (the living-theme palette drives the sun) → flyover renders and
«казкові» stills of real places, delivered as artifacts. This is the
дух-захоплює deliverable, and it is just F5 + F6 composed.

**Acceptance:** phone map displays a Forge-computed personal layer; «що
видно з <гора>?» returns a viewshed layer + a rendered view; one flyover
video of the operator's district exists as a task artifact.

---

## Phase F7 — Agency (multi-day autonomous labor)

### F7.1 planner/critic pair
Existing `agent/planner` + `agent/audit` wired into Foundry tasks: plan →
labor → self-critique gate between phases; a failed gate re-plans or
honestly reports, never silently degrades.

### F7.2 true parallelism
The Forge runs parallel sub-agents (the Radxa host cannot — serialize there,
parallelize here) under one shared budget from the contract. Council roles
(existing `agent/council`) become sub-agent personas where useful.

### F7.3 honest failure
A task that cannot meet its definition-of-done says so with evidence and a
partial-artifact inventory. Abandonment is a first-class, contract-visible
outcome — not a stuck `running` state.

### F7.4 `/agent` mesh-aware
The phone's `/agent` (companion R6.2) targets the Forge automatically when
the decomposition needs Forge capabilities. One command grammar, two bodies.

**Acceptance:** a real research-and-build task (e.g. «збери порівняння X,
побудуй звіт з графіками, підготуй pdf») runs ≥8h unattended with ≥2
parallel sub-agents, passes its critique gates, and delivers a reviewed
artifact with a full cost ledger.

---

## Phase F8 — WatchTower North (PC-side vigilance)

### F8.1 watchers
Sites, feeds, prices, repos, long-running external processes — declarative
RuleCards in the SAME grammar as companion R8 (one catalog, a `node` field
decides where a card runs). PC cards get powers the phone can't afford:
minute-level polling, full-page diffing, headless browser checks.

### F8.2 one attention budget
Forge insights are *delivered by the phone* WatchTower under its calm
contract — attention budget, quiet hours, severity ladder, why-now,
dismiss-with-reason. (Law 8. The Forge never notifies directly.)

### F8.3 night synthesis
The existing DREAM state (`core/state_machine`) finally earns its name: a
nightly Foundry task digests the day across both bodies (journal + phone
LifeLog), pre-computes tomorrow's brief, warms caches (geo tiles, likely
assets). Morning brief facet on the phone composes it (companion R8's
morning card, fed by the Forge).

**Acceptance:** a price-drop watcher fires exactly once, lands on the phone
within its severity budget, is dismissible with a remembered reason; the
morning brief cites at least one Forge-computed item.

---

## Phase F9 — The Workshop Window (PC surface, LAST)

Not a chat clone (Law 3). The existing Tauri/React shell is refit into a
glanceable workshop: Foundry task board with live journals, artifact gallery
(renders, documents, videos), the big map with F6 layers, the cost ledger,
the perception ledger. Beautiful, calm, and strictly a *window into* the
organism — every feature here must already exist as a phone-reachable
capability first.

**Acceptance:** a glance at the PC screen answers «над чим зараз працює
кузня і що вона сьогодні зробила» in under 5 seconds; zero features exist
only on this surface.

---

## Execution order, interlocks & session budgeting

**F0 → F1 → F2 → F3 → F4 → F5 → F6 → F7 → F8 → F9.**

- F0–F2 are the foundation; nothing else starts before F2 is green.
- F1 interlocks with companion R6.3 (distributedself) — coordinate the
  transport in one design; do not build two.
- F5/F6 may interleave once F4 is done (the geo data work F6.1 is a good
  background Foundry task — dogfood F2 on it).
- F8 waits for companion R8's RuleCard engine to exist (one grammar, phone
  first).
- One phase per session where possible; F2 and F5 likely take two each.
  Commit per numbered sub-item, tag `f#.#-name` (e.g. `f2.3-resurrection`).
  Tests green + one real acceptance check per commit; if an external service
  is down, the honest-degradation path IS the acceptance test.

### Model routing (Fable / Opus / Sonnet)

| Phase | Model | Why |
|---|---|---|
| F0 triage | **Opus** | judgment calls on KEEP/FREEZE/DELETE; mechanical sweeps → Sonnet |
| F1 nerve | **Fable** | crypto/protocol reconciliation across two codebases — wrong choices are permanent |
| F2 foundry | **Fable** (design F2.1–F2.3) → Sonnet (F2.4–F2.6) | the runtime's event model is the plan's heart |
| F3 hands | **Sonnet** | table-driven tool wiring, patterns fixed by F1/F2 |
| F4 eyes | **Fable** (SeeingLoop contract) → Opus (wiring) | the critique-verdict schema is reused by everything after |
| F5 ateliers | **Fable** (F5.1–F5.3) → Opus (iteration passes) | flagship; scene-graph contract + loop design |
| F6 geo | **Opus**, Sonnet for ingestion plumbing | extends an existing, decent stack |
| F7 agency | **Fable** | parallel budgets + critique gates + failure semantics |
| F8 watchtower | **Sonnet** | grammar inherited from companion R8 |
| F9 window | **Opus** | taste work, operator in the loop |

---

# Part II — Total Internal Rework (G-phases: the flesh)

Part I gives the organism its role. Part II rebuilds the body that has to
carry it. Recon findings (2026-07-02) that motivate every G-phase:

- **Three overlapping agent runtimes** (`agent/kernel`, `agent/missions`,
  `agent/operations`+`ai/agents`) — the PC-side version of the companion's
  18 orphans, except here they half-overlap AND half-run.
- **Monoliths**: `ai/tool_executor.py` 2593 lines, `agent/kernel/loop.py`
  2178, `agent/kernel/runtime.py` 1722, `api/routes_agent.py` 1379,
  `api/routes_chat.py` 1374, `db/models.py` 1305, `main.py` 1151,
  `config.py` 914; frontend: `SettingsPanel.tsx` 2458, `ChatWindow.tsx`
  1352, `Overlays.tsx` 1179. Nothing this size can be safely evolved.
- **35+ API route files**, 16 Zustand stores, 180 components, 6 state
  layouts — surface area grown by accretion, never pruned.
- **Duplicate cognition**: `core/context_engine` + `agent/cognition/*` +
  `ai/sentience/*` + `memory/mind_state` all model "what is going on" with
  no single source of truth.

The G-law on top of Part I laws: **every G-phase must shrink the codebase or
keep it equal — never grow it.** Net-negative diffs are the success metric
of Part II. New capability lives in Part I; Part II pays for it.

## Phase G0 — The Map (graphify + measurement; prerequisite for F0.1)

### G0.1 graphify the repo
Run `graphify update .` at phantom-os root → `graphify-out/graph.json`
(the companion's 8949-node graph proved the workflow). The salvage audit
(F0.1) then stops being archaeology: `graphify explain "<module>"` lists
real consumers; zero-inbound-edge modules are DELETE/FREEZE candidates by
*evidence*, not vibes. Refresh the graph after every G-phase commit — the
shrink is visible in node/edge counts.

### G0.2 baseline metrics
One script (`scripts/metrics.sh`): total LoC by domain, files >500 lines,
route count, store count, import-cycle count, test runtime. Output table
appended to this doc per phase. What isn't measured won't shrink.

**Acceptance:** graph.json exists and answers "who consumes X?" for any
module; the baseline table is committed below the Salvage Ledger.

## Phase G1 — One Brain (AI pipeline & agent-runtime unification)

The deepest surgery. Do immediately after F1 (the nerve), before F2 builds
on the wrong spine.

### G1.1 split the tool monolith
`ai/tool_executor.py` (2593) + `ai/chat_tools.py` (1212) → a tool registry
package: one file per tool family, one typed `ToolSpec` (schema, gate tier,
audit template, node capability tag). The Gemini/Ollama/Anthropic adapters
consume the registry — a tool declared once appears in every provider
schema (companion Law 4 mesh-wide, enforced structurally).

### G1.2 one agent spine
Execute the F2.1 amendment: `agent/kernel` survives as the skeleton;
`missions/ledger+reports+verify` become Foundry organs (journal views,
deliverable rendering, definition-of-done checks); `operations/
standing_orders` becomes the F2.5 recurring-task trigger;
`operations/approve_on_phone` becomes the F2.2 contract gate transport;
`ai/agents/budget` becomes the F2.2/F7.2 budget meter. `ai/agents/
orchestrator`, `agent/operations/orchestrator`, and the parallel planner in
`agent/cognition/planner` collapse into ONE. Everything not absorbed:
deleted in the same commit.

### G1.3 provider layer honesty
`gemini_provider` / `ollama_provider` / `anthropic_provider` behind one
streaming interface with native tool-call turns and a stall watchdog —
port the companion's hard-won pre-r0 lessons (native functionCall/
functionResponse turns; wall-clock watchdog on IO dispatcher) instead of
rediscovering them. Quota-aware fallback stays; last-error-wins masking
(the companion's RoutedAIRouter bug) is explicitly tested against.

### G1.4 prompt & context budget
`prompt_builder` becomes a budgeted composer: each context source (memory
tiers, sensor snapshot, geo, persona) declares token cost and priority;
the composer packs to a hard budget and *logs what it dropped*. No more
blind concatenation.

### G1.5 sentience verdict
`ai/sentience/*` (endocrine, monologue, reflex, graph_memory) +
`agent/consciousness_stream` + `memory/tom_dream` (924 lines): each gets a
WIRE-with-named-consumer or FREEZE verdict in the Salvage Ledger. Default
FREEZE — poetry may return later; it may not haunt the runtime unconsumed.

**Acceptance:** one runtime executes a chat turn, a tool call, and a
multi-step agent task through the same spine; `graphify explain` shows one
orchestrator; backend LoC net-negative vs G0 baseline.

## Phase G2 — One Memory

Seven stores (`session/tactical/strategic/archive` + `user_model` +
`mind_state` + `narrative`/`core_narrative`) and a second vector story in
`sentience/graph_memory`.

1. **One embedding index** for everything retrievable (ChromaDB stays as
   the engine); tiers become *retention policies* on one store, not four
   codebases. `resolver.py` is the only read API.
2. **Consolidation & forgetting as Foundry tasks** (DREAM-state scheduled,
   F8.3) — `consolidation.py` + `forget_service.py` wired there, their
   private schedulers deleted.
3. **Geo memory** (`geo_extractor/geo_query/geo_integration`) plugs into F6
   as the "memory on the map" source (F6.4).
4. **Cross-body sync contract**: which memories replicate to the phone
   (facts, places, preferences) vs stay Forge-local (task journals, bulk
   artifacts) — one explicit table, one sync channel over F1, ledgered.

**Acceptance:** one query API answers time-scoped, semantic, and geo
recalls; a fact learned on the phone is recalled on the Forge and vice
versa; store-count in the metrics table: 7 → 1 (+policies).

## Phase G3 — One World-Model (core spine = companion R7's sibling)

`core/context_engine` (755) + `state_machine` + `decision_tree` +
`salience_arbiter` + `referee` + `event_bus` + `system_monitor` — good
organs, no shared blood.

1. **Typed `PhantomEvent` bus** (same envelope as companion R7.1 — one
   schema across bodies) — every producer (sensors, vitals, watchers,
   Foundry lifecycle, voice, vision) publishes there; ad-hoc pub/sub dies.
2. **ContextFrame fold**: the versioned world snapshot + diffs; the PC
   twin of the phone's ContextFrame, exchanged over F1 so each body sees
   a distilled frame of the other («оператор їде додому» ↔ «кузня рендерить
   3-тю годину, GPU 84°»).
3. `state_machine` (SHADOW/FOCUS/DIALOGUE/SENTINEL/GHOST/DREAM) becomes a
   *derived view* of the frame; `salience_arbiter` + `referee` fold into
   the F8 WatchTower calm contract as its PC enforcement point.
4. `decision_tree` autonomous decisions → RuleCards (F8.1 grammar) or
   deleted; no second initiative engine (Law 8).

**Acceptance:** «що зараз відбувається?» answered from the frame with zero
live queries; the phone shows the Forge's one-line frame in its status
facet; event-bus consumer list fully enumerable from graphify.

## Phase G4 — Surface Flattening (API, schemas, security)

1. **Route triage**: 35+ `routes_*.py` audited against real consumers
   (frontend + phone). Consumed → regrouped into ~8 domain routers with
   versioned prefix; unconsumed → deleted (Law 1: an endpoint nobody calls
   is theater for machines).
2. **One schema layer**: `agent/schemas.py` (751) + `api/schemas/` +
   inline Pydantic models deduplicated; wire format between bodies pinned
   by contract tests on both repos (break = both CIs red).
3. **Security consolidation**: `security/` is rich (jwt, device tokens,
   pair crypto, vault, pii_guard, lockdown, witness) — it becomes the ONLY
   gate implementation; per-route ad-hoc checks die. Every F3 hand and F1
   mesh call passes through it. `ghost_recorder`/`witness` wire into the
   perception ledger or freeze.
4. `main.py` (1151) → thin composition root; startup becomes a declared
   list of organs (the app's own manifest, mirroring `phantom_node.toml`).

**Acceptance:** route count in metrics table ≥40% down; OpenAPI spec reads
like a table of contents; one gate module in every call path (graphify-
verifiable).

## Phase G5 — Data & Config Ground (db, settings)

1. `db/models.py` (1305) → per-domain model modules along G4's boundaries;
   migrations keep working (13 exist — the discipline is real, keep it).
2. `config.py` (914) → typed per-domain settings objects; secrets only via
   env/keyring; a startup config-honesty check prints which capabilities
   are OFF due to missing config (honest degradation at boot).
3. **Storage quotas**: artifacts, chroma, model weights, geo tiles get a
   budget + eviction policy; the 24 GB working tree becomes a metrics-table
   line that only goes down. Runtime data leaves the repo tree entirely
   (`.phantom-data` is the only sanctioned home, gitignored, quota'd).

**Acceptance:** clean clone + env → boot prints an honest capability
report; repo tree (sans venv/node_modules) under 2 GB.

## Phase G6 — Frontend Rebirth (the workshop window earns its body)

The React shell is where "великий але дуже малий" is most visible: 180
components, 16 stores, and the three monsters (SettingsPanel 2458,
ChatWindow 1352, Overlays 1179). This phase merges INTO F9 — same taste
bar as companion R3 («можна і набагато краще»).

1. **Store diet**: 16 Zustand stores → ~6 domain stores fed by the G3
   frame over one WS channel; `websocket_hub` multiplexing simplifies to
   typed event streams.
2. **Kill the monsters**: SettingsPanel → generated from the same
   capability/settings registry the backend declares (one source of
   truth, like the companion's honest capability matrix); ChatWindow
   shrinks to a *mirror* of the phone Stream (read + quick reply — never
   the primary chat, Law 3); Overlays dissolves into routed surfaces.
3. **One design language**: port `PhantomThemeSpec` + living-theme palette
   from the companion (`:core-design` is the reference) so both bodies
   visibly belong to one organism — same dawn/day/dusk/night moods, same
   glass/glow discipline, PC-scale layout.
4. **The workshop layout** (F9's concrete form): Foundry board · artifact
   gallery · big map (F6 layers) · ledgers (cost, attention, perception).
   The 6 state layouts (Shadow/Focus/…) become one layout with a
   state-driven *mood*, not six codebases.
5. Component count is a metrics line; target ≤100 with no feature loss.

**Acceptance:** designer-eye pass: PC and phone screenshots side-by-side
read as one product; stores ≤6; no component >500 lines; state moods
visibly driven by the same living palette as the phone.

## Phase G7 — Voice & Vision Refit

1. Voice stack is production-grade (instant/refined STT tiers, Piper TTS)
   — keep, but: wake/always-on becomes a G3 frame producer; barge-in and
   earcons obey the attention budget; `identity_resolver` gates which
   operator's memory namespace a voice turn touches (multi-person rooms).
2. Verbal transparency parity with the phone: the Forge speaks its honest
   empty/error notices too (companion invariant, organism-wide).
3. Vision: `screen_capture`/`screen_ocr`/`grounding` are F4 organs (KEEP);
   `face_engine`/`oled_animator`/servo tracking → FREEZE with the ESP32
   lane unless the desk-presence rig returns to mission.
4. STT/TTS advertised as mesh capabilities: the phone may route heavy
   transcription (long recordings) to the Forge as a Foundry task.

**Acceptance:** «кузне, статус» spoken at the desk answers from the G3
frame; a 1-hour recording sent from the phone comes back transcribed with
a cost-ledger entry.

## Phase G8 — Quality Ratchet (make regressions structurally hard)

1. **File-size law**: no new file >500 lines; every touched monolith must
   leave smaller. CI enforces (fail on growth of a tracked-monolith list).
2. **Test topology**: 1230 tests are phase-named (`test_phase03`,
   `test_phase10_tool_use`…) — meaningless after this plan. Re-home to
   domain names as each G-phase touches them; delete tests of deleted
   code in the same commit (a green test of a corpse is theater).
3. **Contract tests between bodies**: the F1 wire format + G4 schemas get
   a shared fixture set; either repo's CI fails on drift.
4. **The ratchet script**: `scripts/metrics.sh` runs in CI; monoliths,
   route count, LoC, cycle count may only decrease. Graphify refresh per
   merge; `diagnose multigraph` clean.

**Acceptance:** CI red on any ratchet violation; metrics table shows every
G-phase net-negative; zero phase-named test files remain.

## Interleaved execution order (F × G)

```
G0 (map/metrics)
→ F0 (triage, uses G0 graph)
→ F1 (nerve)
→ G1 (one brain)            ← before F2 builds on the wrong spine
→ F2 (Foundry, on G1.2 spine)
→ G3 (world-model) → G2 (memory)     ← frame first, memory reads it
→ F3 (hands) → F4 (eyes)
→ G4 (surfaces) → G5 (data/config)   ← quick pair, mostly Sonnet
→ F5 (ateliers) ∥ F6 (geo)           ← F6.1 ingestion dogfoods F2
→ F7 (agency)
→ F8 (watchtower, on G3 frame)
→ G6+F9 (frontend rebirth = workshop window)
→ G7 (voice/vision refit)
→ G8 (ratchet — starts at G0 as a script, hardens as CI here)
```

One phase per session where possible; G1 likely two, G6 likely two.
Commits: `g#.#-name`, same rules as F (tests green, net-negative diff
where the phase promises it, metrics table updated).

### Model routing addendum (G-phases)

| Phase | Model | Why |
|---|---|---|
| G0 | Sonnet | scripts + graph run |
| G1 | **Fable** | the riskiest surgery in either repo: three runtimes → one, live behavior preserved |
| G2 | **Fable** (design) → Opus (migration) | memory semantics are irreversible |
| G3 | **Fable** | shared cross-body event/frame schema — a contract with the phone's R7 |
| G4, G5 | Sonnet, Opus for route-triage judgment | mechanical once the graph says who's consumed |
| G6 | Opus (taste, operator in loop) | Sonnet for store/monolith mechanics |
| G7 | Opus | integration judgment over a working stack |
| G8 | Sonnet | scripts, CI, test re-homing |

# Part III — STAVKA: the Living Organization (F7's flagship; Amendment A, 2026-07-02)

Operator directive: «хочу щось таке зробити від чого дах зносило б». The
current agent section (routes_agent 1379 lines, agentStore 1236,
AgentStudioOverlay 952 — doesn't even open) is one of the three dead
runtimes G1.2 unifies. STAVKA is what they unify *into*.

## The idea in one sentence

When the operator gives PHANTOM a mission, it does not answer with a
spinner — it **founds an organization before their eyes**, and the operator
watches that organization think, argue, build and fail-and-replan in real
time, commands any member of it directly, and can rewind the whole thing
like a film.

Not a chat mode. A **command theater**. The wow is not animation — the wow
is that every moving thing on screen is a real cognition event.

## The load-bearing contract: MissionGraph

One typed, event-sourced structure serving FOUR masters at once — this
quadruple duty is the hard design and the reason the schema comes first:

1. **Execution** — the kernel spine (G1.2) walks it;
2. **Visualization** — the theater renders it live with zero translation;
3. **Intervention** — operator commands are mutations of it;
4. **Replay** — the event log IS the mission's biography.

Node types: `Intent` (the mission + contract), `PlanNode` (task DAG,
reshapeable), `Agent` (a minted role), `Artifact` (anything produced),
`Verdict` (critique gate result), `Decision` (operator intervention —
first-class, forever visible). Edges: `delegates`, `depends`, `produces`,
`critiques`, `supersedes`. Every mutation = journal event (F2 spine);
current graph = fold; a mission IS a Foundry task whose body is a graph.

## The organization

- **The Director** (PHANTOM itself) decomposes the Intent and **mints roles
  on the fly** via a RoleForge: a charter (name, mandate, allowed tools,
  budget slice, model+temperature, personality seed) written per mission
  within contract limits — Architect, Scout, Builder, Critic, Quartermaster,
  Chronicler are *conventions*, not enums. The org chart is born live.
- **Critique is law**: every branch terminates in a `Verdict` from a Critic
  minted with a DIFFERENT model/temperature than the builder; anything
  visual is judged by SeeingLoop (F4). No artifact reaches `done` without a
  verdict. Failed verdict → visible re-planning, not silent retry.
- **The Quartermaster** meters the contract budget (tokens/time/$) and can
  *refuse delegations* — scarcity drives visible prioritization arguments.
- **True parallelism** on the Forge (F7.2); sub-agent memos stream as they
  think.

## The Theater (three synchronized views of one graph)

1. **Org view** — the living org chart: agents pulse while thinking, edges
   flash on delegation, roles appear/dissolve. Click an agent → its working
   memo stream and its charter.
2. **Plan view** — the DAG as a constellation: nodes shift state
   (planned/running/blocked/failed/verdict-passed); when reality bites and
   the Director re-plans, the constellation *visibly reshapes*.
3. **Chronicle view** — the event river with artifacts as cards and a
   scrub-bar: drag back to any moment of the mission and watch it replay.
   The time machine falls out of event sourcing for free.

Plus: the **budget dial** burning in real time; gate prompts; the phone
gets the same theater as facets (mission status card, approval gates,
«покажи останній артефакт») — Law 3, the mouth is the phone.

## The intervention grammar (co-command, not spectatorship)

- **Talk to any agent directly** — your message enters ITS context, not the
  Director's: interrogate the Scout, overrule the Critic.
- `pause branch` / `kill agent` / `redirect <нова інструкція>` /
  `inject constraint` / `promote artifact` — each becomes a `Decision`
  node, forever visible in the graph and the replay.
- Everything gated + audited like every other hand (Law 4).

## The memory of victories and defeats

Mission end compiles the graph into a **Chronicle artifact** (replayable,
shareable, beautiful) and distills lessons (wire the existing
`agent/lesson_distill.py`) that seed future missions: the Director of the
next mission *opens with* «минулого разу цей підхід провалився на X —
Scout перевіряє X першим». The organization learns as an organization.

## Prerequisites & honesty

Depends on: G1.2 (one spine — STAVKA is its unification target, NOT a 4th
runtime), F2 journal (events), F1 (phone facets), F4 (SeeingLoop critic;
can stub verdict-by-model until F4 lands). If built before G1/F2 complete:
build the MissionGraph schema + Director loop directly ON `agent/kernel`,
absorbing missions/operations organs per G1.2 — the vertical slice IS the
unification. The replaced surfaces (AgentStudioOverlay, agentStore
monolith, routes_agent) are deleted in the same commits (net-negative law).

**Acceptance (the дах-зносить scenario):** operator says «Ставко, дослідіть
і зберіть порівняння трьох підходів до X зі звітом і графіками». Within
seconds the org chart births 5+ roles; the constellation grows; two
builders work in parallel while the Critic rejects one draft ON SCREEN and
the plan visibly reroutes; the operator clicks the Scout mid-flight and
redirects it by voice; the budget dial burns honestly; the phone shows the
gate and the milestone; at the end a Chronicle replays the whole mission
from minute zero, and the distilled lesson appears in the next mission's
opening plan.

## Executor prompt (copy-paste to the building session)

```
Ти будуєш STAVKA — живу організацію агентів PHANTOM OS.

ПРОЧИТАЙ СПЕРШУ (обов'язково, у цьому порядку):
1. phantom-os/docs/PHANTOM_FORGE_PLAN.md — Part III (STAVKA) повністю,
   Laws у Part I, амендмент F2.1 і G1.2 (три мертві рантайми → один хребет).
2. Стан репо: чи виконані G0 (graphify-out/graph.json існує?) та G1/F2.
   Якщо ні — вертикальний зріз: MissionGraph + Director buduється ПРЯМО на
   agent/kernel (loop/runtime/checkpoints/rehydrate), поглинаючи
   agent/missions (ledger→журнал, reports→Chronicle) та agent/operations
   (standing_orders, approve_on_phone→гейти) за G1.2. НІКОЛИ не будуй
   четвертий рантайм поруч із трьома мертвими.

ПОРЯДОК РОБОТИ (коміт на кожен крок, тег s#-назва, тести зелені):
s1  MissionGraph: типізована event-sourced схема (Intent, PlanNode, Agent,
    Artifact, Verdict, Decision; ребра delegates/depends/produces/
    critiques/supersedes). Одна схема обслуговує виконання, візуалізацію,
    втручання і реплей — спроектуй її ПЕРШОЮ, реши edge-cases на папері
    в docstring до коду. Журнал = append-only події, стан = fold.
s2  Director loop на хребті kernel: декомпозиція Intent → RoleForge
    (чартери ролей: мандат, тулзи, бюджетна частка, модель+температура),
    делегування, паралельні суб-агенти з одним бюджетом.
s3  Critic-вердикти: інша модель/температура ніж у builder'а; для
    візуального — SeeingLoop (F4) або чесний стаб verdict-by-model.
    Жоден Artifact не стає done без Verdict. Провал → ре-план, не retry.
s4  WS-стрім подій графа + Theater у фронтенді: Org view (живий орг-чарт),
    Plan view (сузір'я DAG), Chronicle view (ріка подій + scrub-реплей),
    budget dial. Заміни собою AgentStudioOverlay/agentStore-моноліт/
    routes_agent — ВИДАЛИ їх у тих самих комітах (net-negative закон).
s5  Граматика втручання: пряма розмова з будь-яким агентом (у ЙОГО
    контекст), pause branch / kill agent / redirect / inject constraint /
    promote artifact — кожне = Decision-вузол. Все під гейтами + аудит.
s6  Телефонні фасети: mission status card, approval gates, останній
    артефакт (Law 3 — рот організму на телефоні).
s7  Chronicle-компілятор + wiring agent/lesson_distill.py: уроки місії
    сідають у відкриваючий план наступної.

ЗАКОНИ (порушення = провал сесії):
- No fake theater: кожен рух на екрані = реальна подія когніції. Жодних
  декоративних анімацій без події за ними.
- Файли <500 рядків. Кожен коміт net-negative або нейтральний по LoC
  (ти ЗАМІНЮЄШ мертвий розділ, не додаєш поверх).
- Kill -9 посеред місії = юніт-тест: реплей із checkpoint.
- Бюджет чесний: dial показує реальні токени/час, Quartermaster






 вміє
  відмовляти в делегуванні.
- Кожен новий tool → Gemini adapter schema (закон companion Law 4).

ПРИЙМАННЯ: сценарій «дах зносить» із Part III дослівно — 5+ ролей на
екрані, паралельні builder'и, відхилений вердиктом драфт з видимим
ре-плануванням, втручання голосом у Scout посеред польоту, гейт на
телефоні, реплей з нульової хвилини, урок у наступній місії.
```

# Part IV — CHANCELLERY: Knowledge, Deliberation & Foresight (Amendment B, 2026-07-02)

Operator directive: «аналізувати тонни інформації, проробляти стратегії,
компактити і тримати все в голові, завдання рівня "парламент" який думає
що найкраще як це на майбутнє повпливає, відкладати по принципу
архіву/бібліотеки — і це лише дрібнички». Part IV is the organ that turns
the Forge from a worker into a **counselor**: it reads mountains, remembers
libraries, deliberates like a parliament, and — the part nobody else does —
**keeps score on its own foresight**.

Five organs, one governing law: **knowledge without provenance is fake
theater.** Every synthesized claim keeps an edge to its source — Law 1
applied to thought itself.

## L1 — СКРИПТОРІЙ (mass ingestion & compaction)

The honest answer to «компактити і тримати все в голові»: nobody holds
everything — you hold a **pyramid**.

- `ingest` accepts anything the F3 hands can fetch: folders, PDFs,
  mailboxes, URL lists, repos, feeds. The contract gate quotes the
  distillation cost UP FRONT (budget-honesty law): «це ~40k сторінок,
  дистиляція ≈ X токенів / Y годин — згода?».
- Map-distill-reduce on the Foundry: shards summarized in parallel (F7.2)
  by a cheap model, reduced upward into a **Living Brief (Жива Довідка)** —
  a bounded-size, versioned digest with a table of contents.
- The pyramid is navigable *downward*: every claim in the brief carries
  citation edges through intermediate digests to raw shards. «Звідки це?»
  is answerable at every level — synthesis with receipts.
- Re-ingest is incremental: new material diffs into the existing pyramid,
  the brief re-versions, and the operator is shown WHAT changed since they
  last read it.

## L2 — БІБЛІОТЕКА (the archive that stays awake)

A **Dossier** is a first-class object over G2's one memory: topic, sources,
briefs, embeddings, catalog card, lifecycle state. The lifecycle is exactly
as the operator framed it — analyze when needed, then shelve:

`hot` (composed into active context) → `warm` (indexed for semantic
recall) → `shelf` (digest stays hot, raw compressed on disk) → `vault`
(catalog card only).

- A standing **Curator** role promotes/demotes by *real usage*, never by
  manual filing. Every dossier keeps a human-readable **catalog card**:
  what it is, why it was kept, what would make it relevant again.
- **The wake trigger is the magic**: a dossier may register a WatchTower
  RuleCard (F8) — «якщо станеться подія про X, розбуди досьє Y». The
  library is not storage; it is **dormant attention**. Archived knowledge
  resurfaces itself — on the phone, as a facet — exactly when the world
  makes it relevant again.
- `lesson_distill` (Part III) writes into the Library: institutional
  memory of missions lives on the same shelves as ingested knowledge, so
  Parliament can cite past defeats as sources.

## L3 — ПАРЛАМЕНТ (deliberation as a STAVKA mission archetype)

Parliament is deliberately NOT new machinery — it is a **mission archetype
on the MissionGraph**, which is why the quadruple-duty schema of Part III
had to come first.

- The Director convenes **chambers** — minted roles with distinct lenses:
  Risk, Opportunity, Cost, Second-Order Effects, and a mandatory **Devil's
  Advocate** — each on a DIFFERENT model/temperature. Real cognitive
  diversity, not one model agreeing with itself in five voices.
- Protocol: position papers (Artifacts) → cross-examination rounds
  (`critiques` edges — chambers attack each other's papers ON SCREEN in
  the theater) → Director's synthesis → **Verdict with the minority report
  preserved**. Dissent is first-class and never deleted: six months later
  «а хто був проти і чому?» replays in the Chronicle.
- **Consequence trees** are the future-impact organ: synthesis emits
  `Prediction` nodes — projected outcomes at horizons (тиждень / місяць /
  рік / далі), each with a confidence AND a falsifier («що доведе, що ми
  помилились»). Every strategy ships with its own tripwires.

## L4 — КАССАНДРА (the foresight ledger)

Every `Prediction` node is a bet, and bets get graded — this is the
«ніхто так не робить» organ:

- WatchTower watches each prediction's falsifier/resolver; when reality
  arrives the prediction is scored, and the score is permanent.
- PHANTOM accumulates a **calibration record per domain** — it can show
  «за пів року: 78% моїх тижневих прогнозів справдились, 44% річних» —
  and the next Parliament OPENS with its own track record in that domain,
  adjusting confidence accordingly.
- This converts «думає що на майбутнє повпливає» from vibes into
  **accountable foresight**: an assistant that keeps score on itself.

## L5 — ЗВІТИ (reports as living views)

Mostly salvage — deliberately last, because the organs above feed it:

- `agent/missions/reports.py` + `pdf_export.py` + `html_dashboard.py` are
  absorbed (G1.2 spirit — never a parallel pipeline) into one **Report
  artifact family** rendered via forge.doc (F3): PDF, HTML dashboard and
  phone facet from ONE source of truth.
- A report is a **view over a dossier or mission**, not a dead file: the
  dossier updates → the report re-versions. «Брифінг тижня» is a standing
  order (absorbed from `agent/operations/standing_orders`) that lands on
  the phone Monday morning as a facet, full document in the Chronicle.
- The Chronicler (Part III) uses the same family — one rendering pipeline
  for mission chronicles, parliament verdicts and weekly briefs.

## Acceptance (the counselor scenario)

Operator dumps a 2 GB folder of research and market material and says:
«Парламенте, чи варто мені робити X — проаналізуй усе це і скажи, як воно
вплине на рік уперед». The contract quotes the cost; the Scriptorium
pyramid builds with visible progress; chambers argue in the theater; the
verdict lands with a minority report and three predictions with tripwires;
the operator asks «звідки взяв цифру Y?» and reaches the exact source
shard in two clicks; the dossier shelves itself a week later; three months
later a WatchTower event wakes it, and a prediction is scored — on the
phone.

## Slotting & honesty

- L1/L2 build directly on G2 (one memory) + F3 (hands) + F7.2 (parallel
  distillation). Earliest sensible start: after G2.
- L3/L4 require STAVKA's MissionGraph (Part III) and F8 wake triggers for
  scoring. Parliament is a *schema consumer* — the proof that the
  quadruple-duty design was right.
- Interleave amendment: `… F7 → L1 → L2 → F8 → L3 → L4 ∥ L5 → G6+F9 …`
- Model routing: **Fable** — L3 deliberation protocol + L4 scoring
  contract; **Opus** — L1 pyramid quality, L5 taste; **Sonnet** — L2
  lifecycle plumbing, ingest connectors.
- **A Builder role may be headless Claude Code** (`claude -p` via
  forge.shell, gated like every other hand): the Forge does not compete
  with the best coding harness — it *employs* it. (F3 amendment:
  `forge.coder`.)

---

# Amendment C — ЕСТАФЕТА (the Relay: full-app builds at harness-grade effectiveness)

Operator directive: «якщо я попрошу фантом написати повністю застосунок
рівня що ти + клауд код може зробити — хочу ефективність як у вас І
можливості самого фантома: безперервно, поки не досягне бажаного».

The design refuses the trap of reimplementing a coding harness. The Relay
is a **Foundry mission archetype**: PHANTOM is the conductor, headless
Claude Code is the runner, and the baton is a written brief.

- **Contract first** (F2.2): goal, definition-of-done (build green, tests
  green, acceptance scenarios *runnable*), budget. Then the Director
  authors the target repo's OWN instruments before any code: a plan doc
  and a CLAUDE.md — the same instruments THIS plan is. The spec is the
  conductor's score.
- **A leg** = one `forge.coder` run (`claude -p`, gated like every hand):
  fresh context, armed with the target plan doc + the **handoff brief** —
  the journal artifact every leg must end with (зроблено / далі /
  несподіванки / команди, що працюють). The brief automates exactly what
  the operator does today between Claude Code sessions.
- **Between legs the Foundry verifies, not the model**: build + tests via
  forge.shell; UI flows exercised through SeeingLoop (F4) — screenshots
  judged against the acceptance scenario; a Critic (different model) reads
  the leg's diff. Failed verdict → the next leg opens with the failure
  evidence; repeated failure → the Director re-plans the decomposition.
- **Continuous by Law 5**: reboots don't kill the mission — kill -9
  mid-leg resumes from the journal. The relay runs nights and days until
  the DoD verdict passes or the budget exhausts → honest failure with a
  partial-artifact inventory (F7.3). Milestones and gates land on the
  phone; the intervention grammar (F2.6 / Part III) works mid-mission.
- **The effectiveness math is honest**: per-leg quality = Claude Code's,
  because each leg IS Claude Code. What PHANTOM adds is the thing that
  today only the operator provides — the between-sessions conductor:
  memory, verification, re-planning, persistence. «Ефективність як у вас
  + не зупиниться, поки не досягне» — without pretending the Forge
  out-codes the harness it employs.

**Slotting:** needs F2 (Foundry) + F3 (`forge.coder`); F4 for UI apps
(headless targets can relay without it); Part III optional-but-natural (a
Relay is a mission whose Builders are coder legs).
**Acceptance:** «збудуй мені застосунок X повністю» → contract on the
phone → ≥5 legs across ≥1 reboot with ZERO operator prompts between them →
the app passes its own acceptance scenarios *run by the Foundry*, not
asserted by the model.

---

# Appendix — Книга промптів сесій (copy-paste, одна на фазу)

Моя авто-пам'ять живе в phantom-companion — сесія у phantom-os її не
бачить. Носій контексту = ЦЕЙ документ, тому кожен промпт починається з
нього. Спільна шапка вставляється ПЕРШОЮ в кожну сесію, далі блок фази.

## Спільна шапка

```
Ти працюєш у phantom-os. СПЕРШУ прочитай docs/PHANTOM_FORGE_PLAN.md
ПОВНІСТЮ (Parts I–IV, Laws, амендменти). Він — єдине джерело істини і
СПЕЦИФІКАЦІЯ, не побажання: якщо реальність репо їй суперечить —
зупинись і скажи вголос, не імпровізуй мовчки.
Потім перевір стан: git log --oneline -40 (теги виконаних фаз),
graphify-out/graph.json, таблиця метрик і Salvage Ledger у плані. Якщо
фаза вже почата — продовж із першого невиконаного під-пункту.
Дисципліна: один коміт на під-пункт (теги f#.#-назва / g#.#-назва /
l#.#-назва), тести зелені перед комітом; для G-фаз кожен коміт
net-negative по LoC; наприкінці фази онови таблицю метрик і зроби
graphify update . Завершуй сесію одним підсумком:
зроблено / відкладено / несподіванки.
```

## Сесія 1 · G0 — Мапа (Sonnet)

```
[шапка]
Виконай фазу G0: g0.1 graphify-карта репо (graphify update ., збережи
graphify-out/); g0.2 scripts/metrics.sh (LoC по доменах, файли >500
рядків, кількість роутів/сторів, цикли імпортів, час тестів) +
baseline-таблиця в план під Salvage Ledger.
У цій фазі НІЧОГО не рефакторити — лише виміряти.
```

## Сесія 2 · F0 — Тріаж та операція на ідентичності (Opus; 1–2 сесії)

```
[шапка]
Виконай F0: f0.1 salvage-аудит КОЖНОГО backend-модуля з вердиктом
KEEP/WIRE/FREEZE/DELETE у Salvage Ledger — на підставі graphify-ребер
(нуль вхідних ребер = кандидат FREEZE/DELETE), докази, не вайби; WIRE
вимагає назвати фазу-споживача. f0.2 гігієна кореня (логи, скретчі,
fix-скрипти геть; docs/ цвинтар фаз → docs/archive/ одним комітом).
f0.3 phantom_node.toml ЛИШЕ з реальних можливостей, підписаний,
/node/manifest. f0.4 theater-sweep: кожен роут/елемент UI зі стабом
позаду — під ніж.
Приймання: чистий клон → /healthz зелений, маніфест чесний, корінь
чистий, Salvage Ledger закомічений у план.
```

## Сесія 3 · F1 — Нерв (Fable)

```
[шапка]
Виконай F1. Критичне: f1.1 ОДИН протокол пари — референсом є companion
core-net PairFlow (прочитай phantom-companion/core-net уважно; PC
routes_pair АДАПТУЄТЬСЯ під нього, не навпаки); пам'ятай Android
NSC-пастку: точні хости, CIDR не парситься. f1.2 advertisement
можливостей із phantom_node.toml + mDNS. f1.3 mesh-маршрут tool-calls у
RoutedAIRouter телефону: перший тул node.status, другий node.shell за
high-friction гейтом; кожен мешевий тул → Gemini adapter schema (Закон 4).
f1.4 чесна недосяжність поза LAN («Кузня поза досяжністю», ніколи не
фейкувати). f1.5 routes_handoff ↔ companion distributedself — координуй
з companion R6.3: ОДИН транспорт, не два.
Приймання: «що на кузні?» з телефону → живий фасет ≤2с на LAN;
висмикнутий кабель → чесне повідомлення; обидва audit-логи бачать кожен
mesh-виклик.
```

## Сесія 4 · G1 — Один мозок (Fable; ймовірно 2 сесії)

```
[шапка]
Найризикованіша операція обох реп. Виконай G1: g1.1 tool_executor.py
(2593) + chat_tools.py (1212) → пакет-реєстр тулів (файл на сім'ю, один
типізований ToolSpec: схема, гейт-рівень, аудит-шаблон, node-тег;
адаптери провайдерів СПОЖИВАЮТЬ реєстр — тул декларується один раз).
g1.2 ОДИН хребет: agent/kernel лишається скелетом; missions
ledger/reports/verify та operations standing_orders/approve_on_phone
стають його органами; оркестратори ai/agents + operations + cognition
КОЛАПСУЮТЬ в один; неабсорбоване ВИДАЛЯЄТЬСЯ в тих самих комітах.
НІКОЛИ не будуй четвертий рантайм поруч із трьома. g1.3 чесний
провайдер-шар: нативні functionCall/functionResponse turns + wall-clock
stall watchdog (портуй уроки companion pre-r0); тест ПРОТИ
last-error-wins маскування. g1.4 budgeted prompt composer: джерела
декларують ціну і пріоритет, дропи логуються. g1.5 вердикти sentience/*,
consciousness_stream, tom_dream — дефолт FREEZE, WIRE лише з названим
споживачем.
Приймання: чат-хід, tool-call і багатокрокова задача через ОДИН хребет;
graphify показує один оркестратор; LoC net-negative проти G0.
```

## Сесія 5 · F2 — Foundry (сесія A: Fable, f2.1–f2.3; сесія B: Sonnet, f2.4–f2.6)

```
[шапка]
Виконай F2 (діапазон під-пунктів цієї сесії: <вкажи>). Це УНІФІКАЦІЯ на
хребті G1.2, не greenfield. f2.1 задача-як-об'єкт: event-sourced журнал
(append-only події, стан = fold), lifecycle
proposed→contracted→running→checkpoint→review→done|abandoned. f2.2
contract gate: фасет на телефон (мета, definition-of-done, бюджет
час/токени/диск, точки втручання) — без контракту немає праці. f2.3
checkpoint і воскресіння: kill -9 посеред задачі — ЮНІТ-ТЕСТ, не
інцидент. f2.4 progress-фасети з мініатюрами артефактів; тиша довша за
контрактну — теж звіт. f2.5 recurring/watch задачі (standing_orders вже
поглинуто в G1.2 — тут вони стають тригером). f2.6 інтервенції з
телефону: pause / redirect / cancel / show latest artifact — redirect =
подія журналу і ре-план, не рестарт.
Приймання: синтетична 24h-задача переживає жорсткий ребут, стрімить ≥3
milestone-фасети, редиректиться голосом посеред виконання, фінальний
ledger показує кошт проти контракту.
```

## Сесія 6 · G3 — Одна модель світу (Fable)

```
[шапка]
Виконай G3: g3.1 типізований PhantomEvent-бас — ТОЙ САМИЙ конверт, що
companion R7.1 (це контракт між тілами — узгодь схему з
phantom-companion, не вигадуй паралельну); всі продюсери публікують
туди, ad-hoc pub/sub помирає. g3.2 ContextFrame-fold: версійований
знімок світу + діфи, обмін дистильованими кадрами через F1. g3.3
state_machine (SHADOW…DREAM) стає derived view кадру;
salience_arbiter + referee вливаються в calm-контракт F8. g3.4
decision_tree → RuleCards або видалення; ДРУГОГО двигуна ініціативи не
існує (Закон 8).
Приймання: «що зараз відбувається?» відповідається з кадру без живих
запитів; телефон бачить однорядковий кадр Кузні; споживачі басу
перелічуються graphify.
```

## Сесія 7 · G2 — Одна пам'ять (Fable design → Opus міграція)

```
[шапка]
Виконай G2: g2.1 ОДИН embedding-індекс (ChromaDB лишається двигуном);
7 сторів стають retention-політиками одного стору; resolver.py — єдиний
read API. g2.2 консолідація і забування = Foundry-задачі за розкладом
DREAM (F8.3); приватні шедулери видалити. g2.3 geo-пам'ять → джерело
F6.4. g2.4 контракт cross-body sync: явна таблиця що реплікується на
телефон (факти, місця, преференції) vs Forge-local (журнали, важкі
артефакти); один канал через F1, ledgered.
Приймання: один API відповідає на часові, семантичні й geo-запити; факт
з телефону згадується на Кузні і навпаки; метрика сторів 7 → 1.
```

## Сесія 8 · F3 — Руки Кузні (Sonnet)

```
[шапка]
Виконай F3: сім рук за таблицею плану — forge.shell (існуючий
linux/executor + dangerous_patterns, high-friction гейт, dry-run у
фасеті), forge.fs (контрактні корені, path-sanitized), forge.browser
(Playwright, скріншоти в журнал), forge.download (чексуми+квоти),
forge.media (ffmpeg), forge.doc (md→pdf/docx), forge.git (push лише за
явним гейтом). ПЛЮС Amendment C: forge.coder — headless Claude Code
(claude -p) як гейтована рука Builder'а. КОЖЕН тул: гейт, аудит, Gemini
adapter schema (Закон 4).
Приймання: з телефону «скачай <відео>, витягни аудіо, поклади в архів і
дай посилання» — end-to-end з аудитом і одним approve.
```

## Сесія 9 · F4 — Очі Кузні (Fable контракт → Opus wiring)

```
[шапка]
Виконай F4 — найбільш перевикористовуваний компонент плану. f4.1
SeeingLoop: see(capture) → critique(goal, capture, history) →
verdict{pass | patch-list}; capture = екран (існуючий
vision/screen_capture), вікно, Blender viewport, сторінка браузера;
вердикт — СТРУКТУРОВАНИЙ patch-list, не проза. Схема вердикту —
контракт, який споживуть F5/F6/F7/Amendment C: спроектуй її першою.
f4.2 актуатори: desktop_control + atspi_bridge гейтовано; структуровані
API (bpy, Playwright) — преференція, GUI-кліки — fallback. f4.3
візуальна пам'ять: кожен capture і вердикт у журналі, before/after у
фасетах.
Приймання: «відкрий <застосунок>, зміни налаштування X» виконується з
візуальною верифікацією кожного кроку, нуль сліпих дій.
```

## Сесія 10 · G4 — Сплощення поверхонь (Sonnet; route-triage судження — Opus)

```
[шапка]
Виконай G4: g4.1 тріаж 35+ routes_*.py проти реальних споживачів
(frontend + телефон): споживане → ~8 доменних роутерів з версійованим
префіксом, неспоживане → видалити (ендпоінт без споживача — театр для
машин). g4.2 один шар схем: agent/schemas.py + api/schemas/ + inline
Pydantic дедуплікувати; wire-формат між тілами закріпити
контракт-тестами в ОБОХ репах. g4.3 security/ стає ЄДИНОЮ реалізацією
гейтів; ad-hoc перевірки по роутах помирають. g4.4 main.py → тонкий
composition root (декларований список органів).
Приймання: роутів ≥40% менше; OpenAPI читається як зміст; один
гейт-модуль у кожному call path (перевірено graphify).
```

## Сесія 11 · G5 — Дані і конфіг (Sonnet)

```
[шапка]
Виконай G5: g5.1 db/models.py (1305) → по-доменні модулі вздовж меж G4;
13 міграцій продовжують працювати. g5.2 config.py (914) → типізовані
по-доменні settings; секрети лише env/keyring; на старті чесний звіт
які можливості OFF через відсутній конфіг. g5.3 квоти сховищ: артефакти,
chroma, ваги моделей, geo-тайли — бюджет + евікшн; runtime-дані живуть
ЛИШЕ в .phantom-data (gitignored, квотовано).
Приймання: чистий клон + env → чесний capability-звіт на буті; дерево
репо (без venv/node_modules) < 2 GB.
```

## Сесія 12 · F5 — Ательє Blender (Fable f5.1–f5.3 → Opus f5.4; ∥ з F6)

```
[шапка]
Виконай F5 (діапазон цієї сесії: <вкажи>). f5.1 headless Blender як
персистентний RPC-воркер (bpy); SCENE GRAPH — джерело істини: модель
читає і патчить структурований стан сцени, НЕ емить одноразові скрипти
(«зроби собор вищим» = один патч вузла). f5.2 процедурна база: OSM/
Overture футпринти → екструзія, DEM → терен, PolyHaven CC0 через
forge.download, дороги/вода/зелень з F6-стору. f5.3 цикл шліфування:
render → SeeingLoop critique → цільові патчі → re-render, N контрактних
пасів (Закон 6); та сама граматика що companion R6.1 PhantomCanvas —
тримай словник вирівняним. f5.4 співтворчість: milestone-рендери на
телефон, голосові патчі через F2.6. f5.5 Unity — лише стаб, після
доведеного циклу.
Приймання: «зроби деталізований квартал біля <точка>» → упізнавана 3D
сцена; журнал показує ≥3 critique-паси з видимим покращенням; один
голосовий патч з телефону лягає в сцену.
```

## Сесія 13 · F6 — Geo Forge (Opus; ingestion-сантехніка — Sonnet)

```
[шапка]
Виконай F6 — міць не в змаганні з Google за свіжість, а в персональному
ф'южні + генеративній подачі + компʼюті, який Google ніколи не витратить
на одну людину. f6.1 інжест Overture+OSM регіонів оператора, DEM, GTFS —
у ІСНУЮЧИЙ geo/ стек (pmtiles_manager, layer_registry, elevation,
routing — розширюй, не переписуй); f6.1 — гарна фонова Foundry-задача
(dogfood F2). f6.2 важкий компʼют: ізохрони, viewsheds, коридори,
офлайн-матриці маршрутів → персональні шари на мапу телефону (сіблінг
companion R4 map.show). f6.3 генеративні шари: питання → скомпонований
bespoke-шар + фасет з поясненням композиції. f6.4 пам'ять на мапі:
Atlas + ONNX-історія якоряться до географії. f6.5 кінематографічне geo:
F5-ательє споживає F6-дані → flyover-рендери реальних місць.
Приймання: мапа телефону показує Forge-обчислений шар; «що видно з
<гора>?» → viewshed + рендер; один flyover району оператора існує як
артефакт.
```

## Сесія 14 · F7 — STAVKA (Fable; кілька сесій s1–s7)

Промпт УЖЕ вбудований у Part III → «Executor prompt (copy-paste to the
building session)». Використовуй його дослівно; шапку з цього додатка
можна не дублювати — той промпт самодостатній.

## Сесія 15 · L1 — Скрипторій (Opus)

```
[шапка]
Виконай L1 (Part IV): інжест будь-чого досяжного руками F3;
contract gate котирує ціну дистиляції ДО старту. Map-distill-reduce на
Foundry (паралельні шарди дешевою моделлю, F7.2) → версійована Жива
Довідка обмеженого розміру зі змістом. ЗАКОН ПОХОДЖЕННЯ: кожне
твердження довідки несе цитатні ребра крізь проміжні дайджести до сирих
шардів — «звідки це?» відповідається на кожному рівні. Реінжест
інкрементальний: діф у піраміду, довідка ре-версіюється, оператор бачить
ЩО змінилось.
Приймання: тека на десятки тисяч сторінок → довідка з навігацією вниз до
джерела за два кліки; повторний інжест показує дельту.
```

## Сесія 16 · L2 — Бібліотека (Sonnet)

```
[шапка]
Виконай L2 (Part IV): Dossier — першокласний об'єкт над пам'яттю G2
(тема, джерела, довідки, embeddings, каталожна картка, стан);
lifecycle hot→warm→shelf→vault; standing-роль Кюратор
підвищує/понижує за РЕАЛЬНИМ використанням, не вручну. Магія: досьє
реєструє WatchTower RuleCard (F8) — «якщо подія про X, розбуди досьє Y»;
бібліотека = спляча увага, не сховище. lesson_distill пише в Бібліотеку.
Приймання: досьє саме йде на полицю через тиждень невикористання; подія
будить його фасетом на телефоні з каталожною карткою «чому прокинулось».
```

## Сесія 17 · F8 — WatchTower North (Sonnet; чекає на companion R8)

```
[шапка]
Виконай F8. Передумова: RuleCard-граматика companion R8 ІСНУЄ — якщо ні,
зупинись і скажи. f8.1 вотчери (сайти, фіди, ціни, репи, довгі зовнішні
процеси) — декларативні RuleCards у ТІЙ САМІЙ граматиці, поле node
вирішує де карта бігає; PC-картам можна хвилинний полінг і full-page
diff. f8.2 ОДИН бюджет уваги: інсайти Кузні доставляє ТЕЛЕФОН під його
calm-контрактом; Кузня ніколи не нотифікує напряму (Закон 8). f8.3
нічний синтез: DREAM-стан нарешті заробляє ім'я — нічна Foundry-задача
дайджестить день обох тіл, гріє кеші, готує ранковий бриф.
Приймання: price-drop вотчер спрацьовує РІВНО раз, лягає в бюджет
серйозності, dismissible із запам'ятованою причиною; ранковий бриф
цитує ≥1 Forge-обчислений пункт.
```

## Сесія 18 · L3 — Парламент (Fable)

```
[шапка]
Виконай L3 (Part IV) — архетип місії на MissionGraph зі STAVKA, НЕ нова
машинерія. Палати = карбовані ролі з різними лінзами (Ризик, Можливість,
Ціна, Другопорядкові ефекти + обов'язковий Адвокат Диявола), кожна на
ІНШІЙ моделі/температурі. Протокол: позиційні папери (Artifacts) →
раунди перехресного допиту (critiques-ребра, видимі в театрі) → синтез
Директора → Вердикт зі ЗБЕРЕЖЕНОЮ окремою думкою меншості (незнищенна).
Дерева наслідків: синтез емить Prediction-вузли з горизонтами
(тиждень/місяць/рік/далі), кожен з confidence І фальсифікатором.
Приймання: сценарій радника з Part IV — вердикт з minority report і ≥3
прогнозами з tripwire'ами; «а хто був проти і чому?» реплеїться в
Chronicle.
```

## Сесія 19 · L4 — Кассандра (Fable)

```
[шапка]
Виконай L4 (Part IV): кожен Prediction-вузол — ставка, і ставки
оцінюються. WatchTower стежить за фальсифікатором/резолвером кожного
прогнозу; настала реальність → скор, і скор ПЕРМАНЕНТНИЙ. Калібрувальний
рекорд по доменах («78% тижневих справдились, 44% річних»); наступний
Парламент ВІДКРИВАЄТЬСЯ власним послужним списком у релевантному домені
і коригує впевненість.
Приймання: прогон із синтетичними прогнозами → скоринг на телефоні;
рекорд видимий; Парламент N+1 цитує його у вступному плані.
```

## Сесія 20 · L5 — Звіти (Opus)

```
[шапка]
Виконай L5 (Part IV): missions/reports.py + pdf_export.py +
html_dashboard.py ПОГЛИНАЮТЬСЯ (дух G1.2 — ніколи паралельний пайплайн)
в одну сім'ю Report-артефактів через forge.doc: PDF, HTML-дашборд і
телефонний фасет з ОДНОГО джерела. Звіт = жива в'юха над досьє чи
місією: досьє оновилось → звіт ре-версіювався. «Брифінг тижня» =
standing order → фасет на телефон у понеділок зранку, повний документ у
Chronicle. Chronicler зі STAVKA споживає ту саму сім'ю.
Приймання: один звіт існує в трьох формах з одного джерела; оновлення
досьє ре-версіює його; тижневий бриф приходить сам.
```

## Сесія 21 · G6+F9 — Відродження фронтенду = Workshop Window (Opus; ймовірно 2 сесії; оператор у циклі)

```
[шапка]
Виконай G6+F9 разом. g6.1 дієта сторів: 16 → ~6 доменних, годованих
кадром G3 через один WS-канал. g6.2 убий монстрів: SettingsPanel (2458)
→ генерується з capability/settings-реєстру бекенда; ChatWindow (1352)
→ ДЗЕРКАЛО телефонного Stream (read + quick reply, НІКОЛИ не первинний
чат — Закон 3); Overlays (1179) розчиняється в роутених поверхнях. g6.3
одна мова дизайну: портуй PhantomThemeSpec + living-theme палітру з
companion :core-design — обидва тіла видимо один організм. g6.4
workshop-макет: дошка Foundry · галерея артефактів · велика мапа з
F6-шарами · леджери (кошт, увага, перцепція); 6 state-макетів → ОДИН з
mood'ами. g6.5 компонентів ≤100 без втрати функцій.
Приймання: скріншоти PC і телефону поруч читаються як один продукт;
сторів ≤6; жоден компонент >500 рядків; погляд на екран відповідає «над
чим працює кузня» за <5 секунд; нуль фіч лише на цій поверхні.
```

## Сесія 22 · G7 — Рефіт голосу і зору (Opus)

```
[шапка]
Виконай G7: g7.1 голосовий стек лишається (він production-grade), але
wake/always-on стає продюсером кадру G3; barge-in та earcons коряться
бюджету уваги; identity_resolver гейтить чий namespace пам'яті чіпає
голосовий хід. g7.2 вербальна прозорість як на телефоні: Кузня теж
ГОВОРИТЬ свої чесні empty/error повідомлення (інваріант організму). g7.3
vision: screen_capture/ocr/grounding — органи F4 (KEEP); face_engine/
oled_animator/servo → FREEZE разом з ESP32-лейном. g7.4 STT/TTS як
mesh-можливості: телефон роутить важку транскрипцію на Кузню як
Foundry-задачу.
Приймання: «кузне, статус» за столом відповідає з кадру G3; годинний
запис із телефону повертається транскрибованим із записом у леджері.
```

## Сесія 23 · G8 — Храповик якості (Sonnet)

```
[шапка]
Виконай G8: g8.1 закон розміру файлів у CI (fail на рості будь-якого
файла зі списку монолітів; нових >500 рядків не існує). g8.2 топологія
тестів: phase-названі (test_phase03…) ре-хоумляться в доменні імена;
тести видаленого коду видаляються тим самим комітом (зелений тест трупа
— театр). g8.3 контракт-тести між тілами: спільний fixture-set wire-
формату F1 + схем G4; дрейф = червоні CI в ОБОХ репах. g8.4
scripts/metrics.sh у CI: моноліти, роути, LoC, цикли — лише вниз;
graphify refresh на merge; diagnose multigraph чистий.
Приймання: CI червоний на будь-яке порушення храповика; таблиця метрик
показує кожну G-фазу net-negative; нуль phase-названих тестів.
```

---

## Out of scope (explicitly)

- The 40-capability catalog as a commitment: posthumous familiar, LoRA
  pipelines, federated learning/DP-SGD, inter-phantom market, memory-palace
  AR, generational transfer, empathy relay, echolocation mesh — **parked**,
  not deleted. Any of them re-enters only as an F-phase amendment with a
  named consumer and an acceptance line.
- ESP32 firmware evolution (frozen lane; serial bridge kept as-is).
- SaaS/multi-tenant pivot.
- A second chat surface on the PC (forbidden by Law 3, listed for emphasis).

---

## Salvage Ledger (F0.1 output)

### 2026-07-03 — commit context `1722b94` (F0.1 audit)

**Method (evidence, not vibes).** Backend module inventory = 402 non-test
`.py` under `src/backend` (excl. `venv/`, `tests/`, `test_*`). Consumer map
built two ways and cross-checked: (a) graphify `imports`/`imports_from`/
`re_exports` edges from `graphify-out/graph.json`; (b) a single-pass import
resolver over every `from/import` line (`scripts/`-external, in scratch) that
resolves dotted + relative targets to files — graphify's static pass misses
lazy/in-function imports (e.g. `main.py` lifespan lazy-imports
`agent.kernel.runtime`, `proactive.loop`, `standing_orders.runner`), so (b) is
authoritative and (a) corroborates. Dynamic dispatch checked by hand where a
registry exists (`agent/actions/registry.py`, `_synth` boot auto-loader,
`db/migrations` runner). Verdict basis: **zero production import-consumers AND
no named future-phase consumer** ⇒ FREEZE/DELETE; real consumers OR a named
F/G phase ⇒ KEEP/WIRE. Result: **402 modules → 326 consumed, 76 zero-consumer**;
of the 76, most are structural (`__init__.py`, `main.py`, 25 migrations, entry
points) that are KEEP-by-design, leaving **~20 modules needing WIRE/FREEZE/
DELETE**, itemized below.

### ⚠ Reality contradicts the plan's FREEZE guesses (surfaced per directive)

The plan's F0.1 candidate lists were written from memory; the graph disagrees
in two load-bearing places. **These are not freezable — freezing breaks live
chat / map:**

1. **`ai/sentience/*` + `agent/consciousness_stream` + `memory/core_narrative`
   are NOT off-mission poetry — they are wired into the live chat path.**
   Consumer counts (production, import-verified):
   `sentience/endocrine` **6** (`ai/tool_executor`, `ai/chat_pipeline`,
   `api/routes_chat`, `agent/cognition/emotion`, `agent/cognition/will/drives`,
   `sentience/reflex`), `sentience/monologue` **2**, `sentience/graph_memory`
   **1**, `consciousness_stream` **5** (incl. `main.py`, `routes_chat`,
   `will/engine`, `guardian`, `proactive/loop`), `core_narrative` **2**,
   `mind_state` **3**, `narrative` **2**. → **KEEP/WIRE, not FREEZE.** G1.5's
   "default FREEZE" must be overridden here: the named consumer is the chat
   pipeline. Only `sentience/reflex` (0) and `memory/tom_dream` (0) are truly
   orphaned.
2. **`wardriving/*` is NOT a dead lane.** `wardriving/collector` +
   `wardriving/heatmap` are consumed by `main.py`, `api/routes_map`,
   `api/routes_mobile_sensors` → **KEEP.** Only the separate
   `tools/wardriving_query` (0 consumers) is an orphan duplicate → DELETE.

### KEEP (default — 326 modules consumed on a live or named path)

Stated by domain (per-module rows only for the non-obvious). All of `ai/*`
providers + dispatcher, `agent/kernel/*` (the F2/G1.2 spine — reached via
`main.py` lifespan lazy-import), `agent/will/*` (via `routes_will` + proactive
loop), `agent/cognition/*` chat path, `core/{context_engine,state_machine,
event_bus,decision_tree,system_monitor}`, `memory/{session,tactical,strategic,
resolver,consolidation,mind_state,narrative,core_narrative,user_model,brain,
geo_*}`, `geo/*` (pmtiles/routing/elevation/layer_registry), `vision/{screen_
capture,screen_ocr,grounding,camera_capture}`, `voice/*`, `security/*` (jwt,
device_token, pair crypto, vault, pii_guard, lockout, auth), all 37 `api/*`
routers (all `include_router`-ed in `main.py`), `linux/*`, `sensors/*`,
`input/*`, `dispatch/*`. Structural KEEP-by-design: every `__init__.py`,
`main.py`, `_phantom_entry.py`, `lifespan_warmup.py`, `system_metrics_sampler.py`,
`tests/conftest.py`. **`db/migrations/001..025` (25 files): KEEP** — never
imported by name; applied by the migration runner via directory discovery
(`db/migrations/__init__.py` ← `lifespan_warmup`). **`agent/actions/_synth/
{say_voice_pythonic,voice_greet_synth}.py`: KEEP** — runtime-synthesized
Actions auto-loaded at boot by `registry._load_synth_actions` (filesystem
discovery, not import); note: these are runtime data leaked into the tree,
relocate to `.phantom-data` in G5.3.

### WIRE (real, orphaned now — named consumer phase required)

| module | LoC | consumer phase | evidence |
|---|---|---|---|
| `core/salience_arbiter.py` | 253 | G3.3 / F8 (calm contract) | 0 import-consumers; plan G3.3 names it |
| `core/referee.py` | 300 | G3.3 / F8 | 0 prod, 3 test consumers; plan G3.3 names it |
| `tools/checkpoint_service.py` | 221 | F2.3 (checkpoint & resurrection) | 0 consumers; plan F0.1 + F2.3 name it |
| `tools/location_history_service.py` | 168 | F6.4 / G2 (memory on map) | 0 consumers; geo-history use is named |
| `memory/archive_memory.py` | 164 | G2 (one memory — Sealed/Dead-Zone tier) | 0 consumers; tier of the memory system G2 unifies |
| `security/ghost_recorder.py` | 49 | G4.3 (perception ledger) | 0 consumers; plan G4.3 "wire into perception ledger or freeze" |
| `security/witness.py` | 199 | G4.3 (perception ledger) | 0 prod, 1 test; same G4.3 clause |
| `agent/missions/util.py` | 40 | G1.2 / F2 (Foundry organs) | 0 consumers; rides missions→Foundry absorption |
| `agent/operations/standing_orders/actions.py` | 195 | F2.5 / G1.2 (recurring trigger) | 0 consumers; runner IS live via lifespan, this action-set folds into F2.5 |
| `agent/cognition/memory/backfill.py` | 128 | G2 (memory backfill) | 1 thin reference; keep pending G2 |

### FREEZE (real, off-mission, no consumer, no near-term phase — exclude from startup)

| module | LoC | note |
|---|---|---|
| `memory/tom_dream.py` | 924 | 0 consumers; matches plan G1.5. Largest single freeze. |
| `ai/sentience/reflex.py` | 51 | 0 consumers; G1.5 default FREEZE (the ONE sentience file that IS orphaned). |
| `agent/localization/nearby_watch.py` | 112 | 0 consumers; re-WIRE at F6.4 if place-localization returns. |
| `agent/localization/translit.py` | 246 | 0 consumers; re-WIRE at F6.4. |
| `geo/trajectory_learner.py` | 63 | 0 consumers; re-WIRE at F6.2 (corridor/trajectory analysis). |

FREEZE subtotal: **1396 LoC** excluded from the runtime once G1.5/G-phases execute.

### DELETE (dead, zero consumers, provably superseded, no named phase)

| module | LoC | superseded by (evidence) |
|---|---|---|
| `agent/actions/map/add_layer.py` | 192 | 24-B `MAP_ACTIONS` — `map/__init__.py` imports 16 newer verbs, NOT this |
| `agent/actions/map/create_geofence.py` | 69 | same — not in `MAP_ACTIONS` tuple |
| `agent/actions/map/get_elevation_profile.py` | 42 | same |
| `agent/actions/map/list_geofences.py` | 49 | same |
| `agent/actions/map/time_travel.py` | 67 | same |
| `tools/timer_service.py` | 130 | `db/tools_repo` — `routes_tools` uses the repo, not this service |
| `tools/alarm_service.py` | 145 | `db/tools_repo` (same) |
| `tools/calendar_service.py` | 197 | `db/tools_repo` (same) |
| `tools/audit_service.py` | 181 | `ai/tool_use_audit` + `agent/kernel/audit`; this one 0 consumers |
| `tools/wardriving_query.py` | 156 | orphan duplicate; live path is `wardriving/collector` |

DELETE subtotal: **1228 LoC** removable (execution deferred to the consuming
G-phases per the net-negative law; F0.1 is the inventory, not the surgery —
the 5 superseded map actions + 3 tool-service duplicates are the safest first
cuts for G1/G4).

**Ledger totals:** KEEP 326 · WIRE 10 · FREEZE 5 · DELETE 10 (of the 402;
structural/migration/synth KEEP folded into the 326). Net reclaimable by
Part II: ~2.6k LoC FREEZE+DELETE, before the monolith splits.

---

## Baseline Metrics (G0.2 output — re-run `scripts/metrics.sh` per G-phase, append below)

### 2026-07-03 — commit `1beca2e` (G0 baseline, before any G-phase surgery)

**LoC by domain**

| domain | LoC |
|---|---|
| backend | 142291 |
| frontend | 68413 |
| shared | 2159 |
| firmware | 1299 |

**Files >500 lines: 82** (full list in `scripts/metrics.sh` output; confirms
the plan's recon exactly — `tool_executor.py` 2593, `SettingsPanel.tsx`
2458, `kernel/loop.py` 2178, `kernel/runtime.py` 1722, `routes_agent.py`
1379, `routes_chat.py` 1374, `ChatWindow.tsx` 1352, `db/models.py` 1305,
`Overlays.tsx` 1179, `main.py` 1151, `config.py` 914 all present as cited).
14 of the 82 are `test_phase*.py` files (test-topology debt for G8.2).

**Route files** (`src/backend/api/routes_*.py`): 33
**Zustand stores** (`src/frontend/src/stores/*.ts`): 16

**Repo size**: 24G total (incl. venv/node_modules/build artifacts) —
matches the plan's cited figure exactly; 5.9G excluding vendor/build noise.
Aside found while measuring: `src/backend` carries BOTH `.venv/` (6.6G,
2026-04-17) and `venv/` (5.3G, 2026-05-12) — two full virtualenvs, one
clearly stale. Not touched here (G0 = measure, not fix); flag for G5.3
storage-quota cleanup.

**Import cycles** (static stdlib-only Tarjan SCC over the graphify-adjacent
import graph — no pydeps/madge dependency; backend excludes `tests/`,
frontend only resolves relative `./`/`../` imports so path-alias-based
cycles are undercounted):
- backend: **4 cycles, 54 modules involved**. Largest is a 47-module SCC
  centered on `agent.actions.*` (`_synth.synthesizer`, `ask_user`,
  `delegate`, `intelligence`, `optimize_capability`, `registry`, …) — very
  likely the structural shadow of the "three overlapping agent runtimes"
  G1.2 targets. Two smaller ones: `voice.mms_npu_provider` ↔
  `voice.stt_engine` ↔ `voice.whisper_npu_provider` (3 modules), and
  `api.vision_streamer` ↔ `api.websocket_hub` (2 modules).
  Load-bearing for G1/G8 acceptance criteria ("cycle count" must only
  decrease).
- frontend: 0 cycles detected — plausible given TS/React barrel-import
  conventions, but the relative-import-only heuristic likely undercounts;
  don't treat as a clean bill of health, treat as this method's floor.

**Test-suite runtime**: NOT reliably measured, and deliberately excluded
from `scripts/metrics.sh`'s default (fast) path. Two independent
`npx vitest run` attempts (600s and 900s timeouts) both stopped at the
exact same point — 58 of 60 frontend test files reported, two workers
pinned at 100% CPU for 11+ CPU-minutes past that point with zero further
output. Diffing the full test-file list against what the log reported
identifies the two files that never completed in either run:
`src/__tests__/map.test.tsx` and `src/__tests__/phase24_pre.test.tsx`.
This reads as a genuine hang/runaway in one or both of those files (or
whatever they render), not raw ARM-board slowness — worth a dedicated
look, flagged here rather than investigated (out of scope for G0).
Given that evidence plus the documented board-freeze risk running heavy
AI-stack combos on this hardware, the full backend pytest suite (2523
tests collected in 24s via `--collect-only`, only 1 marked
`@pytest.mark.integration`) was **not attempted** this pass. G8.4's own
CI-ratchet list doesn't track test runtime anyway (only LoC/routes/
monoliths/cycles) — time both suites properly once on real CI hardware.

*Baseline commit note: the `1beca2e` graphify-map commit landed the
gitignore-only diff for g0.1; g0.2 (this table + `scripts/metrics.sh`) is
a separate commit per the one-commit-per-sub-item discipline.*
