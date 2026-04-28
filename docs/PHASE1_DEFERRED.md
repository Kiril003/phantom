# PHANTOM OS — Day-4 Deferred Backlog

**Authored**: 2026-05-01 by Phase-1 synthesis (W-DEFERRED inline).
**Source**: aggregated `deferred_to_day5_or_later` lists from 8 cluster probers + operator's static charter §"Deferred" + Wave-3 cut candidates from `PHASE1_BLOCK_ORDER.md`.

This file is **predictive** — by end of Day 4, `docs/DAY4_DEFERRED.md` will be the *actual* honest list of what didn't ship. This file is the input to that.

---

## Day 5 (target tag `v0.21.0-personalised`, 2026-05-02)

**Theme**: profile depth, performance, AI Hub real routing.

### Identity / personalization
- Speaker-recognition encoder integration (pyannote/Resemblyzer) — plugs into `voice/identity/resolver.py` no-op slot from ID-2.
- Per-user voice profile + targeted TTS reply.
- `ChatMessage.speaker_user_id` backfill policy (NULL vs JWT-holder copy).
- Personality engine pivots when `speaker_id ≠ JWT-holder`.
- Confidence threshold for accepting a resolver hit.

### Profiles + cards
- Card library expansion: ContactCard, FileCard, IDCard (Day-4 ships only ModelCard echo + 4 fact categories).
- TG/Discord OAuth verification flow (verified_at field per fact).
- Speaker-attributed fact-write ("the person speaking told me their email").
- Per-fact `verified_at` for email-verification flow.
- Multi-value categories (two emails) — order, primary flag.

### AI Hub
- Real cross-provider load balancing (cost-first / quality-first policies wired to live data).
- OpenAI provider registration (operator-key card via card library).
- Hub-level per-task budget (tokens × USD).
- Replace `ai_router.generate` call sites in `chat_pipeline` with `hub.dispatch`.
- MiniLM-on-NPU bundle (encoder_int8.bin + scripts/aihub_compile_minilm.py + accuracy bench).
- NPU arbiter (STT vs embeddings priority lock).
- Switch `strategic_memory._embedding_fn` default to NPU after benchmark drift < 1 % vs CPU.

### Performance
- Histogram-based SLO acceptance test in pytest (gate `pytest -q` on p50 < budget).
- True Gemini streaming (replace `chat_stream_delay_s` artificial sleep — U8-PERF-M3).
- `ai_router.generate` total wall-clock cap distinct from per-attempt (U8-PERF-M5).
- Proactive loop LLM cost throttle (U8-PERF-M4).
- NPU MiniLM offload to free 200-400 ms per chat turn (U8-PERF-G2).

### Standing orders
- Per-user fairness scheduler + priority class column.
- Webhook signing + retry/backoff policy (Day-4 ships skeleton).
- Multi-day chat-continuity surface (vector 15) — link `standing_order` → `ChatSession` thread.
- Calendar → standing-order auto-reminder linkage.
- Recurring calendar events (RRULE).

### Sandbox
- Landlock LSM hardening on top of bwrap (defence-in-depth).
- seccomp filter list curation per profile.
- Per-MCP-server profile granularity.
- Resource quota enforcement (CPU shares, disk-write quota) via cgroup v2.

### Orchestration
- `chat_turn_id` column on `ai_tool_use_log` + index on `tool_name`.
- Ollama-side parallel orchestration (TM-17B-S2 string-concat regression must be solved first).
- Multi-day task continuity (vision 15) — link orchestrator turn to standing-orders.
- Dynamic K (cost-aware) selection beyond static `max_subagents`.
- Runtime metapath finder rejecting forbidden imports (defence-in-depth).
- Frontend extension of import-gate (no React component imports backend agent surface).

### Sandbox
- Landlock LSM hardening on top of bwrap.
- seccomp filter list curation per profile.
- Per-MCP-server profile granularity (different bind sets).
- Resource quota via cgroup v2 directly (CPU shares, disk-write quota).

### Settings UI
- `<DynamicPicker>` chip-array editor for `voice_wake_words` (U1-UX-M1).
- `system_hostname` live validation (U1-UX-M2).
- `Cmd+K` settings search (U1-UX-M3).
- Cross-category dirty-state pill (U1-UX-M4).
- `Reset` confirmation modal (U1-UX-M5).

### Cards in chat input
- ContactCard / FileCard / IDCard (Day-4 ships ModelCard only stub).
- Stable scene_id for re-mount idempotency on WS reconnect.

---

## Day 6 (target tag `v0.22.0-environment`, 2026-05-03)

**Theme**: environmental I/O — BT/Wi-Fi/serial as native organs.

### Bluetooth control plane
- BlueZ over D-Bus (paired-device tools).
- BT scan → tools, pair → tools.
- Per-paired-device permission cards in UI.
- Built on `SandboxProfile.radio_privileged` (Y-6 enum reservation Day-4).

### Wi-Fi management
- `nmcli` / `iwd` D-Bus tools.
- WiFi scan → tools.
- Captive-portal detection.

### Serial port catalog
- `pyserial` autoscan with permission cards per port.
- Port label persistence in `UserFact{category=file_pointer}`.

### `phantom-radiod` system service
- New system user with `CAP_NET_RAW`+`CAP_NET_ADMIN`.
- UNIX-socket JSON RPC at `/run/phantom/radiod.sock`.
- MCP-stdio-compatible wire protocol (so `mcp/adapter.py` can talk to it).
- CAP drop after radio handshake.

### Visual code dev (vector 5 full surface)
- Click-to-iterate code preview scenes.
- Live sandbox execution + diff render.
- Inline test-run + assertion render.

### Vision encoder on NPU
- Face-tracker / camera frames hosted on NPU.
- "vision-hub" as a new context.

### NPU bundles
- Whisper-turbo full bundle (Day-4 ships skeleton; this is the production-quality voice).
- BGE-small upgrade for embeddings.

---

## Day 7+ (continuous goals)

### Maps 1000+ features (vector 12)
- Day-4 audit produces feature backlog (NOT in this file — Phase-1 didn't surface backlog).
- Animated cues per layer.
- Heat-map density rendering.
- Geo-aware notify shape.

### Pixel-perfect SaaS polish (vector 14 deep)
- Motion-designer authored cinematic scenes (50+ presets).
- Skin/theme system.
- Onboarding cinematics.
- "Better than OpenClaw in everything" — continuous KPI.

### Hardware-specific NPU LLM (vector 6 deep)
- HTP encoder export per chip family.
- Bundle signing + driver-version pinning.
- Per-chip benchmark gate.

### "1000+ features" charter promise
- This is a continuous expansion goal. PHANTOM ships under v1.x for the next 6+ months adding capabilities.

---

## Wave-3 cut candidates (forced into DEFERRED if 6.5 h cap reached on Day 4)

If Phase-3 wall-clock crosses 4 h and Wave-2 still has must-haves outstanding, these blocks will be cut from Day-4 ship and moved to Day-5:

| Block | LOC | Reason cut tolerance | Charter must-have? |
|---|---:|---|---|
| Y-3 | 90 | net.scan + notify D-Bus carve-outs — Day-4 sandbox closes 95% without them | no |
| Y-6 | 30 | Radio enum reservation — Day-6 lands real radio anyway | no |
| T-5 | 380 | Timer/Alarm 501 stubs — operator currently uses neither route in production | no (charter §9 reachable via T-1+T-2) |
| T-6 | 200 | /tools/calendar — already half-live via tool_executor; AI side works | no |
| Z-3 | 180 | AI Hub UI card — Z-1+Z-2 ship the registry + route, UI can wait | no (charter §6 satisfied by registry alone) |
| Z-4 | 40 | Orchestrator hub.pick consumption — cleanup, not foundation | no |
| Z-5 | 30 | NPU embeddings slot — Day-5 lands real bundle anyway | no |
| V-7 | 60 | Requirements split — Day-4 ships unsigned dev build, requirements are still buildable | no |
| V-8 | 70 | Chat hot-path commit defer — perf optimisation, not blocker | no |
| V-9 | 55 | Presence-aware tick — perf optimisation | no |

If all 10 are cut: ~1135 LOC saved, freeing ~1.2 h Phase-3 budget.

---

## Static deferred (operator charter §"Deferred" — never Day-4)

These are the operator's explicit "don't try Day 4" items, repeated here for completeness:

- Production-quality voice person recognition (ML pipeline, weeks of training + dataset).
- Bluetooth/WiFi penetration/hacking capabilities (legal, driver-level work, months).
- 1000+ features in production (continuous goal, months).
- Pixel-perfect SaaS design with motion-designer-level polish (needs human designer).
- Local NPU LLM with hardware-acceleration per chip (chip-specific drivers).
- "Better than OpenClaw in everything" as measurable KPI (continuous, not one-shot).
- Universal cyclic animated scenes for ANY task type (50+ scene library, motion designer).

---

## End-of-Day-4 fork

After Day 4 ships, this file forks into:
- `docs/DAY4_DEFERRED.md` — *actual* end-of-Day-4 honest list (what slipped from Wave 3, what cut from Wave 2 mid-flight).
- `docs/DAY5_PLAN.md` — Day-5 charter constructed from Day-5 section above.
