# PHANTOM OS — Day-4 Backlog Extensions (post-Wave-1)

**Status**: proposed by autonomous run after Wave-1 closure (`ef6e27f`).
**Operator decision**: pending — review + signal which items pull into
Wave-2 vs split into Day 5 / Day 6 / DAY4_DEFERRED.

This file extends `docs/PHASE1_BLOCK_ORDER.md`. Every entry below is
either (a) a gap the Day-4 charter does not cover but the operator's
post-/compact directive implies, or (b) follow-on work that emerged
during Wave-1 implementation that should not silently drift.

The RICE column uses the same scoring as `PHASE1_BLOCK_ORDER.md`:
`R` = vision vectors served, `I` = 0.5/1/2/3 (skel/partial/must/foundation),
`C` = confidence (1.0/0.75/0.5), `E` = LOC/60 hours, `RICE = R*I*C/E`.

---

## A. Security / privacy gaps

The Day-4 charter ships sandbox closure (Y), Tauri shell (V), CRYPTO-1
(Fernet PII), and refuse-LAN-bind (V-4). Three orthogonal gaps remain.

### A-1 — Encrypted backup & restore wizard

| Field | Value |
|---|---|
| LOC | 280 (backend cli + UI dialog + `Backup` SQLAlchemy table) |
| RICE | R=2, I=2, C=1.0, E=4.67, RICE=0.86 |
| Tier | must (data-loss class) |
| Blocks_by | CRYPTO-1 (already shipped Wave-1) |

**Why**: losing the device's SD card = losing chat history, vector memory
(ChromaDB), standing orders, JWT secret, Fernet key. There is no
operator-facing path to bundle these into one encrypted archive
(`phantom-backup-<ts>.zip.enc`) and restore on a new device. The
existing Tauri `V-1` shell is the natural surface (Settings → "Backup &
Restore"). The encryption rides on CRYPTO-1's `Fernet` helper — keep
the same key derivation so a backup made today decrypts on a new
device given the same passphrase.

**Scope**: `tools/backup_service.py` (~140 LOC), Settings UI card
(~80 LOC), `BackupRestoreDialog` worktree (~60 LOC). One round-trip
test covering create → wipe → restore.

### A-2 — Tamper-evident audit trail

| Field | Value |
|---|---|
| LOC | 220 (HMAC-chain on existing `agent_audit_trail` rows + verify endpoint) |
| RICE | R=2, I=2, C=0.75, E=3.67, RICE=0.82 |
| Tier | must (forensics class) |
| Blocks_by | none |

**Why**: today `agent_audit_trail` (`db/models.py:AgentAuditTrail`) is
plain rows the agent writes. Day 6 ships BT/Wi-Fi control surface; with
that, "did the operator request this scan, or did the agent run it
unsolicited?" must be cryptographically answerable. HMAC-chain each row
with the previous row's HMAC + the row payload, sign with a daemon-only
key (separate from JWT_SECRET). `/api/v1/admin/audit/verify` walks the
chain and surfaces a single boolean + first-broken-row.

### A-3 — Hardware kill-switch UI

| Field | Value |
|---|---|
| LOC | 90 (binding + state-machine + WS broadcast) |
| RICE | R=1, I=1, C=0.75, E=1.5, RICE=0.50 |
| Tier | should |
| Blocks_by | none |

**Why**: today `/admin/halt` exists in code but no fast-path UI gesture.
Operator's BT/Wi-Fi/port autonomy implies a "stop everything NOW"
affordance. Bind GPIO button on ESP32 (firmware side already exposes
generic event channel) → `kill_switch.activate` event → backend cancels
every in-flight subprocess + flushes `recent_actions` audit row.

---

## B. "Alive" behaviour gaps (zero/sparse coverage today)

### B-1 — Proactive ChatScene emission

| Field | Value |
|---|---|
| LOC | 180 (ProactiveSceneEmitter + budget + UI ack gate) |
| RICE | R=3, I=2, C=0.75, E=3.0, RICE=1.50 |
| Tier | must (charter "сам себе перемикав по системі") |
| Blocks_by | W-2 (Wave-2 ChatScene composer) |

**Why**: Day-4 charter calls for "сам себе перемикав по системі,
візуалізовував". Today `agent/proactive/cycle.py` only writes log lines
— no path emits a `<ChatScene>` to the UI without a user message. After
W-2 lands the composer, B-1 wires `event_bus → proactive_scene_emit
(scene_kind, payload, confidence, throttle_key)`. Budget:
`config.proactive_scenes_per_hour: int = 3` (default conservative).
Every emission ack-pinged via WS even if user is on another tab; UI
shows "Phantom suggests…" tray. **This is the primary path that turns
the ChatScene composer from "responsive UI" into "alive companion".**

### B-2 — Persona drift telemetry + assertion

| Field | Value |
|---|---|
| LOC | 110 (drift counter + `personality.report_drift()` + 4 invariants) |
| RICE | R=2, I=2, C=0.75, E=1.83, RICE=1.64 |
| Tier | must |
| Blocks_by | none |

**Why**: `ai/personality.py` adapts tone "по осях biosignal/trust/time"
per the README, but no test exercises the adaptation. A future refactor
that silently locks the persona to one tone ships green. Add a
`PersonalityDriftReport` model (avg trust/biosignal/time multipliers
seen in last 24h, observed tone distribution) + a test asserting at
least 2 distinct tones surface across a synthetic scenario sweep.
Belt-and-braces telemetry endpoint `/api/v1/admin/persona/drift` for
operator dashboards.

### B-3 — Multi-agent conversation (vetoer pattern)

| Field | Value |
|---|---|
| LOC | 320 (conversation harness + critic agent + arbiter) |
| RICE | R=2, I=2, C=0.5, E=5.33, RICE=0.38 |
| Tier | should (charter "багато вбудованих і продуманих агентів") |
| Blocks_by | X-1 (Wave-2) |

**Why**: X-1 ships `agents/orchestrator.py` with sequential + parallel
dispatch, but sub-agents don't TALK to each other. Charter wants
"послідовно чи паралельно в залежності від ситуації працювали б". A
debate-loop with a critic agent (third sub-agent vetting the proposed
answer before merge) is the next maturity step. **Defer to Day 5**
unless operator wants it baked into Wave-2 X-1 — the LOC is heavy and
the value compounds with W-2 scenes (visualised debate).

---

## C. Polish that compounds across the year

### C-1 — Time-shifted sandbox / virtual clock for long-running tasks

| Field | Value |
|---|---|
| LOC | 150 (VirtualClock + checkpoint replay harness) |
| RICE | R=2, I=2, C=1.0, E=2.5, RICE=1.60 |
| Tier | must (Day-5 prereq) |
| Blocks_by | T-1 (Wave-2 SO lease columns) |

**Why**: charter "багаторівневі складні завдання, дано на день місяць
тощо". Debugging a 30-day workflow today = wait 30 days. Add a
`VirtualClock` injected via `Depends(get_clock)` everywhere
`datetime.now()` is used in standing-orders + agent runtime. Test
harness fast-forwards. Without this, T-1 lease/recover and AB
durable-scheduler test coverage is paper-thin.

### C-2 — Settings export / import

| Field | Value |
|---|---|
| LOC | 70 (JSON schema + 2 routes + UI buttons) |
| RICE | R=1, I=1, C=1.0, E=1.17, RICE=0.86 |
| Tier | must |
| Blocks_by | W-3b (Wave-2 Settings accordions) |

**Why**: today config has 50+ keys; moving a tuned device to a fresh
SD card = manual replay through the UI. JSON export + import endpoint,
with a UI button next to the Settings header. Sensitive keys
(JWT_SECRET, Fernet key) NEVER export — A-1 backup is the path for
those.

### C-3 — Ambient mode (idle visualisation)

| Field | Value |
|---|---|
| LOC | 220 (state extension + IdleScene composition + sleep budget) |
| RICE | R=2, I=2, C=0.75, E=3.67, RICE=0.82 |
| Tier | should |
| Blocks_by | W-2 (Wave-2 ChatScene composer) |

**Why**: charter implicitly wants "always-on alive feel". Today states
are SHADOW/FOCUS/DIALOGUE/SENTINEL/GHOST/DREAM — none of them is
"low-attention always-on". Add `AMBIENT` state: clock + weather card +
next standing-order ETA, scene-rendered with reduced framerate (`tier`
auto-flip to 'low' from W-5). Battery & display-burn-in friendly.

### C-4 — Per-user RAG isolation in ChromaDB

| Field | Value |
|---|---|
| LOC | 180 (collection-per-user + migration + test) |
| RICE | R=3, I=2, C=1.0, E=3.0, RICE=2.00 |
| Tier | must (multi-user privacy class) |
| Blocks_by | IDB-1 (Wave-1 — already shipped) + FACTS-1 (Wave-2) |

**Why**: IDB-1 (just shipped) pinned multi-user *for SQL data* — chat
sessions, standing orders, UserFacts. ChromaDB collections are still
SHARED. A family of 4 → User B's vector recall surfaces User A's
location-history embeddings via similarity search. **This is the
biggest sleeper privacy bug in the codebase.** Migration to
`collection_id = f"phantom_v1_user_{user_id}"` + an Alembic backfill
that re-embeds existing rows under their owning user's collection.
Recommended: pull into Wave-2 alongside FACTS-1 since they touch the
same memory subsystem.

---

## D. Charter-coverage gap surfaced during Wave-1

### D-1 — `scene_kind: 'plan'` will be empty until T-3 lands

| Severity | Decision required |
|---|---|
| Medium | Operator must pick: prioritise T-3 in Wave-2 OR demote charter to "5 presets Day-4, plan on Day-5" |

**Discovery**: W-1 (Wave-1, just shipped) declared 6 SceneKind values:
`text | list | map-pin | plan | code-preview | identity-card`. Of those,
`plan` is fed by `agent/standing_orders/runner.py` via the standing-order
event stream — which is **T-3 Wave-2** (`event_bus standing_order.tick/
fired/skipped + WS fan-out`). If T-3 slips to Wave-3 (or further), the
6-preset story is structurally true but the user opening Day-4's UI sees
plan-scenes only when the runner happens to tick a manual interval order.

**Recommendation**: keep T-3 in **Wave-2 priority slot** alongside W-2
(composer) and FACTS-1. The charter's "alive" promise rests on plan +
identity-card scenes being demonstrable on Day-4 ship.

---

## E. RICE-sorted summary (decision matrix for operator)

Order by RICE descending; pull into Wave-2 in this order until
4-h Wave-2 budget is reached, then defer:

| # | Block | RICE | Tier | Recommended slot |
|---|---|---:|---|---|
| 1 | C-4  Per-user RAG isolation       | **2.00** | must | **Wave-2 next** (privacy class) |
| 2 | B-2  Persona drift telemetry      | **1.64** | must | **Wave-2 next** (smoke gate for "alive") |
| 3 | C-1  Time-shifted sandbox         | **1.60** | must | **Wave-2 if T-1 slot opens** (Day-5 prereq) |
| 4 | B-1  Proactive ChatScene emission | **1.50** | must | **Wave-2 after W-2** (turns scenes "alive") |
| 5 | A-1  Backup/restore wizard        | 0.86 | must | Day-5 (V-1 Tauri shell prereq) |
| 6 | C-2  Settings export/import       | 0.86 | must | Day-5 |
| 7 | A-2  Tamper-evident audit trail   | 0.82 | must | Day-6 (lands with BT/Wi-Fi surface) |
| 8 | C-3  Ambient mode                 | 0.82 | should | Day-5 |
| 9 | A-3  Hardware kill-switch UI      | 0.50 | should | Day-6 (firmware side prereq) |
| 10| B-3  Multi-agent conversation     | 0.38 | should | Day-5 (X-1 first, debate-loop after) |

**D-1 is not RICE-rankable** — it's a charter-decision flag, not new
work. Resolve independently before Wave-2 starts.

---

## F. Suggested Wave-2 amendment

Original `PHASE1_BLOCK_ORDER.md` Wave-2 sequence: V-1 → V-5 → V-6 → W-2
→ W-2c → W-3 → W-3b → W-4 → W-5 → Y-1 → Y-2 → Y-5 → X-1 → X-2 → X-4 →
Z-1 → Z-2 → FACTS-1 → IDB-2 → IDB-3 → T-1 → T-2 → T-3.

**Proposed amended Wave-2 sequence** (insertions in **bold**):

V-1 → V-5 → V-6 → W-2 → W-2c → **B-1** → W-3 → W-3b → W-4 → W-5 → Y-1 →
Y-2 → Y-5 → X-1 → X-2 → X-4 → Z-1 → Z-2 → FACTS-1 → **C-4** → IDB-2 →
IDB-3 → T-1 → **C-1** → T-2 → T-3 → **B-2**.

Wave-2 LOC budget: ~4515 → ~5285 (+770). At concurrency-6 wall-clock:
~3.5–4.5 h → ~4–5.5 h. **Within operator's 6.5 h Phase-3 cap if
charter "60% excellent > 100% mediocre" rule is invoked on the bottom
3 items of Wave-2.**

If operator picks "all four extension blocks", the cuttable items are
W-3b (Settings overflow workaround can ship Day-5) and IDB-3 (UserPicker
React polish — backend IDB-2 carries the shared-PIN protection alone
for one ship cycle).

---

*Authored 2026-05-01 23:25 CEST after Wave-1 closure at `ef6e27f`.
Operator pre-/compact request: "додай і зафіксуй … я компактну і ти
закінчиш". Source-of-truth path: this file is read FIRST on post-compact
resume, before `docs/day4-progress.md`, until the operator signals which
extensions ship.*
