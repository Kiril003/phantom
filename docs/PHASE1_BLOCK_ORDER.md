# PHANTOM OS — Day-4 Phase-3 Block Order

**Total proposed blocks**: 41 (after dedup, ID conflict resolution, audit-cross-check additions).
**Day-4 budget**: 6.5 h Phase-3 cap (operator hard limit).
**Strategy**: top-priority blocks by **charter-must-have OR top-RICE**, scheduled with parallel concurrency = 6 (operator override).

## ID conflict resolution log (probers used overlapping prefixes)

- **Y-1/Y-2/Y-3** assigned to **sandbox-runtime** (W3 prober) — kept verbatim.
- **CRYPTO-1** (was Y-2 in W6 prober) — renamed to non-overlap.
- **FACTS-1** (was Y-3 in W6 prober) — renamed.
- **W-4** (chat-input prober + dynamic-source-picker prober) — merged; canonical W-4 owns `dynamic_source` schema + DynamicPicker (380 LOC).
- **W-6** (chat-perf prober) — merged into V-6 (runtime-perf Histogram).
- **V-5/V-6** (desktop-shell prober + runtime-perf prober) — runtime-perf is canonical owner.
- **Z-4** depends on **X-1**; deferred unless both land.

## Audit-cross-check addition

The 8 cluster probers did **not** propose a block for **U1-UX-C1** (Settings overflow at 1024×600 violates CLAUDE.md rule #4). Synthesis adds:

- **W-3b** — Settings subgroup accordions + 2-column layout for voice category (which has ~30 keys). 100 LOC, must, no deps. Owned by chat-input cluster (extension).

## RICE-sorted block list

`R` = vision vectors served (count). `I` = 0.5/1/2/3 for skeleton/partial/must/foundation. `C` = confidence (1.0/0.75/0.5). `E` = LOC/60 (hours). `RICE = R*I*C/E`.

| Block | Cluster | Scope (1-line) | LOC | R | I | C | E | RICE | Tier |
|---|---|---|---:|--:|--:|---:|---:|---:|---|
| W-1 | chat-scenes | SceneKind/ScenePanel types + scene? on ChatMessage | 90 | 3 | 3 | 1.0 | 1.5 | 6.00 | must |
| CRYPTO-1 | crypto-primitive | Fernet helper + HKDF + tests (PREREQ for FACTS-1) | 80 | 2 | 3 | 1.0 | 1.33 | 4.51 | must |
| V-3 | desktop-shell | Win32 hard-skip on NPU providers before QNN imports | 30 | 1 | 2 | 1.0 | 0.5 | 4.00 | must |
| V-4 | desktop-shell | host=127.0.0.1 packaged + _refuse_lan_bind | 35 | 1 | 2 | 1.0 | 0.58 | 3.45 | must |
| W-2b | chat-scenes | phantomVariants unified + getScaledDuration wired | 70 | 2 | 2 | 1.0 | 1.17 | 3.42 | must |
| W-3b | chat-input | Settings subgroup accordions (closes U1-UX-C1) | 100 | 1 | 3 | 1.0 | 1.67 | 1.80 | must |
| V-2 | desktop-shell | OS-aware paths via platformdirs (chroma/db/voice/dist) | 90 | 2 | 2 | 1.0 | 1.5 | 2.67 | must |
| T-4 | so-harden | UTC-normalize OneShotSchedule + croniter early check | 90 | 2 | 2 | 1.0 | 1.5 | 2.67 | must |
| Y-4 | sandbox-runtime | F-40 realpath fix in fs.write (symlink escape) | 45 | 1 | 2 | 1.0 | 0.75 | 2.67 | must |
| Y-1 | sandbox-runtime | bwrap retarget + SandboxProfile + clean_env | 180 | 2 | 3 | 1.0 | 3.0 | 2.00 | must |
| V-6 | runtime-perf | Histogram primitive + 3 latency metrics (chat/STT/ws) | 180 | 2 | 3 | 1.0 | 3.0 | 2.00 | must |
| W-2c | chat-scenes | Backend response_formatter scene_kind picker | 60 | 2 | 2 | 0.75 | 1.0 | 3.00 | must |
| X-3 | import-gate | Extend TM-17B-E4 AST test to ai/agents/** | 70 | 1 | 2 | 1.0 | 1.17 | 1.71 | must |
| T-3 | so-harden | event_bus standing_order.tick/fired/skipped + WS fan-out | 160 | 2 | 2 | 1.0 | 2.67 | 1.50 | must |
| W-5 | chat-perf | hardware-tier flag + voice-amp throttle + drop chat_stream_delay_s | 140 | 2 | 2 | 0.75 | 2.33 | 1.29 | must |
| IDB-1 | multi-user | pytest pinning multi-user under deployment_mode=single | 90 | 1 | 2 | 1.0 | 1.5 | 1.33 | must |
| T-1 | so-harden | StandingOrder lease columns + recover_stale_leases | 220 | 2 | 2 | 1.0 | 3.67 | 1.09 | must |
| Y-5 | sandbox-runtime | Sandbox settings surface (profile_default + workspace_dir) | 55 | 1 | 1 | 1.0 | 0.92 | 1.09 | must |
| ID-1 | speaker-id | speaker_id field on STTResult + Transcript + WS payload | 60 | 1 | 1 | 1.0 | 1.0 | 1.00 | must |
| ID-3 | speaker-id | ChatMessage.speaker_user_id column + migration | 110 | 1 | 1 | 1.0 | 1.83 | 0.55 | must |
| Y-2 | sandbox-runtime | bash + mcp adapter retarget through wrap_argv(compute) | 140 | 1 | 2 | 1.0 | 2.33 | 0.86 | must |
| W-2 | chat-scenes | ChatScene composer + 6 scene presets | 480 | 3 | 2 | 1.0 | 8.0 | 0.75 | must |
| FACTS-1 | user-facts | UserFact ORM + CRUD route + require_self_or_root | 320 | 2 | 2 | 1.0 | 5.33 | 0.75 | must |
| ID-2 | speaker-id | resolver.py no-op + frozen interface for Day-5 ML | 80 | 1 | 1 | 1.0 | 1.33 | 0.75 | must |
| W-3 | chat-input | + button + AttachDrawer + ModelCard echo | 220 | 2 | 1 | 1.0 | 3.67 | 0.55 | must |
| W-4 | dynamic-picker | dynamic_source schema + 5 resolvers + DynamicPicker | 380 | 2 | 2 | 1.0 | 6.33 | 0.63 | must |
| V-5 | runtime-perf | Lifespan asyncio.gather staged groups (8-15s → <2s WS) | 110 | 2 | 2 | 1.0 | 1.83 | 2.18 | must |
| T-2 | so-harden | action-kind discriminator (speak/notify/task/webhook) | 340 | 2 | 2 | 1.0 | 5.67 | 0.71 | must |
| IDB-2 | multi-user | shared-PIN guard + /api/auth/users/picker route | 140 | 1 | 1 | 1.0 | 2.33 | 0.43 | must |
| IDB-3 | multi-user | UserPicker React + LoginScreen integration | 220 | 1 | 1 | 1.0 | 3.67 | 0.27 | must |
| V-1 | desktop-shell | Tauri 2.x scaffold + Cargo.toml + tauri.conf.json + sidecar | 220 | 1 | 2 | 1.0 | 3.67 | 0.55 | must |
| Z-1 | ai-hub | AIHub class + ProviderCapability + locality-first stub | 220 | 1 | 1 | 1.0 | 3.67 | 0.27 | skel |
| Z-2 | ai-hub | /api/v1/hub/providers + /hub/route_state routes | 110 | 1 | 1 | 1.0 | 1.83 | 0.55 | skel |
| X-1 | orchestrator | ai/agents/ skeleton + single-turn default + Gemini-only gate | 220 | 2 | 1 | 1.0 | 3.67 | 0.55 | skel |
| X-2 | orchestrator | per-sub-agent nonce + leaf+merge sanitize (closes U3-ORCH-C1+C2) | 110 | 2 | 2 | 1.0 | 1.83 | 2.19 | must |
| X-4 | orchestrator | config keys + budget split + asyncio.wait gather-no-cancel | 90 | 1 | 1 | 1.0 | 1.5 | 0.67 | must |
| Y-3 | sandbox-runtime | net.scan + notify D-Bus carve-outs | 90 | 1 | 1 | 0.75 | 1.5 | 0.50 | must |
| Y-6 | radio-reserved | SandboxProfile.radio_privileged enum reservation | 30 | 1 | 0.5 | 1.0 | 0.5 | 1.00 | skel |
| Z-3 | ai-hub | Settings UI placeholder card "AI Hub" | 180 | 1 | 0.5 | 0.75 | 3.0 | 0.13 | skel |
| Z-4 | ai-hub | Orchestrator consumes hub.pick(task_class) | 40 | 1 | 0.5 | 0.75 | 0.67 | 0.56 | skel |
| Z-5 | npu-util | NPU-embeddings capability slot (available=False) | 30 | 1 | 0.5 | 1.0 | 0.5 | 1.00 | skel |
| T-5 | tools-routes | Replace 501 Timer/Alarm with standing-orders adapters; drop dead tables | 380 | 1 | 2 | 1.0 | 6.33 | 0.32 | must |
| T-6 | tools-routes | Wire /tools/calendar GET+POST to existing CalendarEvent | 200 | 1 | 1 | 1.0 | 3.33 | 0.30 | must |
| V-7 | desktop-shell | Split requirements (drop playwright from desktop) | 60 | 1 | 1 | 0.75 | 1.0 | 0.75 | must |
| V-8 | runtime-perf | Chat hot-path commit deferral (geo/fact/behavioral → create_task) | 70 | 1 | 1 | 0.75 | 1.17 | 0.64 | must |
| V-9 | runtime-perf | Presence-aware _context_loop tick (1-2 Hz idle) | 55 | 1 | 0.5 | 0.75 | 0.92 | 0.41 | skel |

## Phase-3 execution sequence (charter must-haves first, then RICE)

The operator's brief enumerates 8 must-have categories. **Charter must-have always wins over pure RICE** — the operator picked these foundations deliberately.

### Wave 1 — Foundation (parallel-safe, no deps; up to 6 concurrent)

Start immediately, all parallel:
1. **CRYPTO-1** (80, must) — blocks FACTS-1 from proceeding
2. **V-2** (90, must) — OS-aware paths
3. **V-3** (30, must) — NPU win32 hard-skip
4. **V-4** (35, must) — host refuse
5. **W-1** (90, must) — SceneKind types
6. **W-2b** (70, must) — phantomVariants
7. **X-3** (70, must) — import-gate AST test
8. **Y-4** (45, must) — F-40 realpath fix
9. **T-4** (90, must) — UTC normalize standing-orders
10. **ID-1** (60, must) — speaker_id field
11. **ID-2** (80, must) — resolver no-op
12. **ID-3** (110, must) — speaker_user_id column
13. **IDB-1** (90, must) — multi-user pytest

Wave-1 LOC: ~990. Concurrency-6 wall-clock: ~25–35 min.

### Wave 2 — Charter must-haves + heavy infrastructure

After Wave 1 commits land:
14. **V-1** (220, must) — Tauri scaffold ← charter must-have
15. **V-5** (110, must, blocks_by V-2) — lifespan asyncio.gather
16. **V-6** (180, must) — Histogram primitive (closes U8-PERF-C1+G1)
17. **W-2** (480, must, blocks_by W-1) — ChatScene composer + 6 presets ← charter must-have
18. **W-2c** (60, must, blocks_by W-1) — backend scene_kind picker
19. **W-3** (220, must) — + button + AttachDrawer ← charter must-have card
20. **W-3b** (100, must, NEW) — Settings subgroup accordions (closes U1-UX-C1)
21. **W-4** (380, must) — dynamic_source + DynamicPicker ← charter must-have
22. **W-5** (140, must) — hardware-tier flag + voice-amp throttle
23. **Y-1** (180, must) — bwrap + SandboxProfile ← charter must-have
24. **Y-2** (140, must, blocks_by Y-1) — bash + mcp retarget
25. **Y-5** (55, must, blocks_by Y-1) — sandbox settings surface
26. **X-1** (220, skel) — orchestrator skeleton ← charter must-have
27. **X-2** (110, must, blocks_by X-1) — per-sub-agent nonce + sanitize
28. **X-4** (90, must, blocks_by X-1+X-2) — config + budget split
29. **Z-1** (220, skel) — AIHub class skeleton ← charter must-have
30. **Z-2** (110, skel, blocks_by Z-1) — /hub/providers route
31. **FACTS-1** (320, must, blocks_by CRYPTO-1) — UserFact CRUD ← charter must-have
32. **IDB-2** (140, must) — shared-PIN + picker route ← charter must-have
33. **IDB-3** (220, must) — UserPicker React ← charter must-have
34. **T-1** (220, must) — standing-order lease ← charter must-have
35. **T-2** (340, must, blocks_by T-1) — action-kind discriminator
36. **T-3** (160, must) — event_bus standing-order events

Wave-2 LOC: ~4515. Concurrency-6 wall-clock: ~3.5–4.5 h.

### Wave 3 — Optional (if budget left after Wave 2)

37. **Y-3** (90, must) — net.scan + notify D-Bus carve-outs
38. **Y-6** (30, skel) — radio enum reservation
39. **T-5** (380, must) — replace Timer/Alarm 501 stubs
40. **T-6** (200, must) — wire /tools/calendar
41. **Z-3** (180, skel) — AI Hub UI card
42. **Z-4** (40, skel) — orchestrator consumes hub
43. **Z-5** (30, skel) — npu-embeddings stub
44. **V-7** (60, must) — split requirements
45. **V-8** (70, must) — chat hot-path commit defer
46. **V-9** (55, skel) — presence-aware _context_loop

Wave-3 LOC: ~1135. Operator P10: if Phase-3 6.5 h cap reached → cut Wave 3 to `DAY4_DEFERRED.md`.

## Realistic Day-4 ship cone

Probability-weighted forecast (after Phase-1 synthesis):
- **Wave 1 + Wave 2 ship in full**: ~70%
- **Wave 1 + 80% Wave 2 (skip W-2 last 2 presets, T-2 partial)**: ~95%
- **All three waves ship**: ~25%

Operator's "60% excellent > 100% mediocre" rule: if Wave 2 starts to slip past the 4 h mark, **cut W-2 from 6 presets to 4**, **cut W-4 from 5 resolvers to 3**, **defer Z-3 entirely**, and **ship Wave 1 + reduced Wave 2 cleanly**.

## Per-block contract (carry from RUFLO_EXECUTION_PLAN.md §3)

For every block in Phase 3:
1. Pre-block: `memory search --namespace day4-phase2-arch --query "<block context>"` → confirm ADR retrieved.
2. Implementation via Edit/Write (small) or Agent spawn (large).
3. Post-block:
   - `pytest -q` (backend) green; if not, fix in same block.
   - `npm run typecheck && npm run build` (frontend-touching only).
   - Commit message: `phase-3-<blockID>: <subject> (closes <audit-IDs>)`.
   - `memory store --namespace day4-phase3-impl --key <blockID> --value <commit-sha + summary>`.
   - Update `docs/day4-progress.md`.
