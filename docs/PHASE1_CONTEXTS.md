# PHANTOM OS — Day-4 Phase-1 Bounded Contexts

**Authored**: 2026-05-01 by 8 parallel cluster probers (native Agent fallback after ruflo v3 alpha task-dispatch broken — see `day4-progress.md`).
**Inputs**: `day4-vision/{product-charter,audit-findings-full,execution-plan}` AgentDB namespace.
**Storage**: each context's full spec under `day4-phase1-decomp/<context-id>` in ruflo memory (128-dim vector + HNSW). This file is the human-readable index.

**Total**: **16 contexts** across 8 clusters. Operator's brief asked 8–12; the splits are deliberately fine-grained because Phase-2 ADRs will own each context independently — bigger contexts = harder ADR scope.

---

## Cluster: desktop-shell

### `desktop-shell`
- **Vectors**: 1 (Tauri), 14 (SaaS polish)
- **Owns**: `src/frontend/src-tauri/`, OS-aware paths in `config.py`, NPU platform branches, Tauri sidecar spec, requirements split.
- **Consumes**: runtime-perf, ai-hub, sandbox-runtime.
- **Produces**: chat-liveness (frontend bundle), profile-cards (per-user data dir).
- **Key audit findings**: U5-PKG-C1, C2, C3, H1–H5, M1–M5, G1.
- **Day-4 blocks**: V-1, V-2, V-3, V-4, V-7.

### `runtime-perf`
- **Vectors**: 13 (speed), 14 (polish).
- **Owns**: lifespan parallelisation, latency Histogram primitive (peer of Counter/Gauge in `observability.py`), chat hot-path commit deferral, presence-aware `_context_loop`, WS broadcast lock, Whisper warmup with real audio, AI router wall-clock cap.
- **Consumes**: desktop-shell.
- **Produces**: chat-liveness, ai-hub, agent-orchestration.
- **Key findings**: U8-PERF-C1, H1–H4, M1–M5, G1.
- **Day-4 blocks**: V-5, V-6, V-8, V-9.

## Cluster: chat-liveness

### `chat-scenes`
- **Vectors**: 2 (animated chat), 5 (visual code dev — read-only render Day-4), 13 (render speed).
- **Owns**: `src/frontend/src/components/chat/scenes/` (NEW), `<ChatScene>` composer + 6 presets (text/list/map-pin/plan/code-preview/identity-card), `scene` envelope on WS payload, `MessageBubble` gated behind back-compat, backend `response_formatter.py` scene_kind picker.
- **Consumes**: ai-hub, identity-recognition, profile-cards.
- **Produces**: chat-input, desktop-shell.
- **Key findings**: U1-UX-H1–H4, G2; U2-ANIM-C1, G1, H2.
- **Day-4 blocks**: W-1, W-2, W-2b, W-2c.
- **Acceptance gate (back-compat)**: `response_form: text` + no `scene` field renders MessageBubble exactly as today.

### `chat-input`
- **Vectors**: 8 (auto-everything), 11 (BT/Wi-Fi futures).
- **Owns**: chat input bar `+` button + AttachDrawer stub + ModelCard echo, `chat_typed_cards_enabled` feature flag.
- **Consumes**: chat-scenes, ai-hub, profile-cards.
- **Produces**: chat-scenes (echoed user turns).
- **Key findings**: U1-UX-H3, C2, G1.
- **Day-4 blocks**: W-3 (drawer + first card), `dynamic-source-picker` cluster owns W-4 picker.

### `chat-perf`
- **Vectors**: 13 (speed), 2 (alive feel).
- **Owns**: motion-vocab unification (`phantomVariants`), `Orb`/`AmbientGlows` stack-depth gate, voice-amplitude rAF throttle, kill `chat_stream_delay_s` artificial sleep, hardware-tier flag.
- **Consumes**: chat-scenes.
- **Produces**: chat-scenes (panel-count budget = 4 max @ tier=low).
- **Key findings**: U2-ANIM-C2, H1, H3, M1–M3; U8-PERF-M3.
- **Day-4 blocks**: W-5. `W-6` was a duplicate of V-6 Histogram — merged into runtime-perf.

## Cluster: sandbox-runtime

### `sandbox-runtime`
- **Vectors**: 3 (sandbox), 11 (BT/WiFi/serial — reserved for Day-6).
- **Owns**: `agent/safety/sandbox.py` (`SandboxProfile` enum + `wrap_argv`/`clean_env`), retarget of `agent/actions/{bash,net,notify}.py` and `agent/mcp/adapter.py`, `agent/actions/fs.py` realpath fix, env-scrub allowlist promotion.
- **Consumes**: agent-action-runtime, settings-config.
- **Produces**: audit-trail, radio-capabilities-reserved.
- **Key findings**: U4-SEC-C1, C2, H1–H4, M1–M3; F-58, F-40.
- **Day-4 blocks**: Y-1, Y-2, Y-3, Y-4, Y-5.

### `radio-capabilities-reserved`
- **Vectors**: 11.
- **Owns**: `SandboxProfile.radio_privileged` enum slot only (NotImplementedError guard), Day-6 IPC contract docstring.
- **Consumes**: sandbox-runtime.
- **Produces**: (Day-6) bluetooth-control, wifi-management, serial-port-catalog.
- **Day-4 blocks**: Y-6 (skeleton, 30 LOC).

## Cluster: agent-orchestration

### `chat-orchestrator`
- **Vectors**: 4 (multi-agent), 15 (multi-day tasks).
- **Owns**: `src/backend/ai/agents/{__init__,orchestrator,sub_agent,merge,budget,nonce}.py` (NEW), config keys (`chat_orchestrator_enabled` default False, `chat_orchestrator_max_subagents=3`, `chat_orchestrator_per_subagent_ms=3500`, `chat_orchestrator_merge_reserve_ms=1500`), Gemini-only gate inherited from TM-17B-S2.
- **Consumes**: ai.chat_pipeline (single-turn fall-back), ai.chat_tool_dispatcher (only tool-execution path), ai.output_safety, ai.provider.
- **Produces**: api.routes_chat (opt-in), api.websocket_hub (scene envelope downstream).
- **Key findings**: U3-ORCH-C1, C2, H1–H4, M1–M3, G1.
- **Day-4 blocks**: X-1, X-2, X-4.
- **Default OFF** — flag-gated; on any failure falls back to Day-3 `chat_pipeline.run`.

### `import-gate-discipline`
- **Vectors**: 4.
- **Owns**: `src/backend/tests/test_chat_import_gate.py` extending TM-17B-E4 to `ai/agents/**`. AST-walk forbidding imports of `agent.actions/runtime/proactive/standing_orders/mcp` from chat-side modules.
- **Day-4 blocks**: X-3 (must, 70 LOC).

## Cluster: ai-hub

### `ai-hub`
- **Vectors**: 6 (AI Hub).
- **Owns**: `src/backend/ai/hub.py` capability registry (provider × task-class), `ai/hub_telemetry.py`, `api/routes_hub.py` (`/api/v1/hub/providers`, `/hub/route_state`), routing policy (locality-first stub Day-4), Settings UI placeholder card.
- **Consumes**: ai-providers (existing AIRouter), voice-stt, strategic-memory.
- **Produces**: agent-orchestration (sub-agent dispatch), chat-pipeline (long-term replacement seam).
- **Day-4 blocks**: Z-1, Z-2, Z-3, Z-4 (all skeleton).

### `npu-utilisation`
- **Vectors**: 6.
- **Owns**: NPU embeddings capability slot (registered as `available=False` Day-4); real MiniLM-on-NPU bundle deferred Day-5.
- **Day-4 blocks**: Z-5 (skeleton, 30 LOC).

## Cluster: profile-cards

### `crypto-primitive`
- **Vectors**: 7.
- **Owns**: `src/backend/security/crypto.py` Fernet helper (HKDF-derived from `JWT_SECRET_KEY`), `encrypt_pii`/`decrypt_pii` API, full pytest.
- **Consumes**: config.
- **Produces**: user-facts, archive-memory (closes `archive_memory.py:4-8` TODO(phase-12) placeholder).
- **Key findings**: U6-ID-C1.
- **Day-4 blocks**: CRYPTO-1 (must, 80 LOC, no deps — must land first).

### `user-facts`
- **Vectors**: 7, 8.
- **Owns**: `UserFact` ORM model + Alembic migration, `api/routes_user_facts.py` (POST/GET/DELETE `/users/{id}/facts`), `permissions.py::require_self_or_root` (NEW), `_user_to_dict` field-leak patch.
- **Consumes**: crypto-primitive, identity-recognition.
- **Produces**: chat-liveness (identity-card scene), ai-hub (prompt_builder enrichment).
- **Key findings**: U6-ID-C2, M1, M2, G1.
- **Day-4 blocks**: FACTS-1 (must, 320 LOC, blocks_by [CRYPTO-1]).

### `dynamic-source-picker`
- **Vectors**: 8, 11.
- **Owns**: `dynamic_source` field on `SettingDefinitionOut`, 5 backend resolvers (ollama_models / voice_voices / mms_languages / serial_ports / tts_speakers), single frontend `<DynamicPicker>` consumer.
- **Consumes**: voice/tts_engine, voice/mms_npu_provider, ai/ollama_provider, sensors/serial_bridge.
- **Produces**: chat-liveness (W-2 card composer reuse), identity-recognition (Day-5 speaker picker).
- **Key findings**: U1-UX-C2, G1, M2.
- **Day-4 blocks**: W-4 (must, 380 LOC).

## Cluster: identity-recognition

### `speaker-id-foundation`
- **Vectors**: 10.
- **Owns**: `STTResult.speaker_id` field, `voice/identity/resolver.py` no-op stub, `ChatMessage.speaker_user_id` sibling column + migration, `Transcript.speaker_id` shared type, `voice` WS event extension.
- **Consumes**: identity-recognition/multi-user-bootstrap (logical, not import).
- **Produces**: chat-liveness (identity-card scene), profile-cards (UserFact attribution), ai-hub (prompt_builder speaker line — Day-5 wires).
- **Key findings**: U6-ID-H2, M3.
- **Day-4 blocks**: ID-1, ID-2, ID-3.

### `multi-user-bootstrap`
- **Vectors**: 10.
- **Owns**: `tests/test_single_mode_allows_multi_user.py` (pins D3-R-2 invariant), `auth/UserPicker.tsx` (NEW React), `LoginScreen.tsx` extension when `user_count > 1`, shared-PIN guard on `POST /api/auth/users`, `GET /api/auth/users/picker` route.
- **Consumes**: speaker-id-foundation (logical).
- **Produces**: profile-cards (card-based identity enrolment), chat-liveness (identity-card semantics).
- **Key findings**: U6-ID-H1, H3.
- **Day-4 blocks**: IDB-1, IDB-2, IDB-3.

## Cluster: time-events

### `standing-orders-harden`
- **Vectors**: 9 (alarms/calendar), 15 (multi-day tasks).
- **Owns**: existing `agent/standing_orders/runner.py` + `schedules.py` + `conditions.py` + NEW `actions.py` dispatcher; `StandingOrder` table extensions (`in_flight_task_id`, `claimed_at`, `action_kind`, `priority`), migration, recover-stale-leases on startup.
- **Consumes**: agent-orchestration (`AgentRuntime.start_task`, `TrackBusyError`), chat-liveness, identity-recognition, ai-hub.
- **Produces**: chat-liveness (live progress), profile-cards (notify cards), desktop-shell (Tauri tray).
- **Key findings**: U7-LRT-C1, H1–H3, M1–M3, G1, G2.
- **Day-4 blocks**: T-1, T-2, T-3, T-4. **APScheduler REJECTED** per U7-LRT-G2 — harden existing runner.

### `tools-routes-replace`
- **Vectors**: 9.
- **Owns**: `api/routes_tools.py` (replace 501 stubs), NEW `tools/{timer,alarm,calendar}_adapter.py`, drop dead Timer + Alarm tables (CalendarEvent KEPT — actively used by `ai/tool_executor.py:645,701`).
- **Consumes**: standing-orders-harden, identity-recognition, profile-cards.
- **Produces**: chat-liveness, desktop-shell (frontend api.ts createTimer/createAlarm/getCalendar consumers unblocked).
- **Key findings**: U7-LRT-C2.
- **Day-4 blocks**: T-5, T-6.

---

## Audit cross-check (W-AUDIT-CROSS work, inline)

Every Critical audit finding mapped to ≥1 Day-4 block:

| Finding | Block | Status |
|---|---|---|
| U1-UX-C1 (Settings overflow 1024×600) | **W-3b (NEW)** | added in synthesis — see BLOCK_ORDER |
| U1-UX-C2 (text fields → enumerated) | W-4 | ✓ |
| U2-ANIM-C1 (no ChatScene) | W-1 + W-2 | ✓ |
| U2-ANIM-C2 (backdrop stack jank) | W-5 | ✓ |
| U3-ORCH-C1 (per-process nonce) | X-2 | ✓ |
| U3-ORCH-C2 (cross-agent prompt-injection) | X-2 | ✓ |
| U3-ORCH-C3 (TM-17B-E4 to agents/**) | X-3 | ✓ |
| U4-SEC-C1 (Y mis-targets non-existent file) | Y-1 (rescoped) | ✓ |
| U4-SEC-C2 (firejail unavailable on Radxa) | Y-1 (drops firejail) | ✓ |
| U5-PKG-C1 (no Tauri scaffold) | V-1 | ✓ |
| U5-PKG-C2 (playwright 400 MB) | V-7 | ✓ |
| U5-PKG-C3 (NPU Linux-only branch) | V-3 | ✓ |
| U6-ID-C1 (`crypto.py` missing) | CRYPTO-1 | ✓ |
| U6-ID-C2 (`_user_to_dict` field-leak) | FACTS-1 | ✓ |
| U7-LRT-C1 (standing orders shipped — rename) | T-1 + T-2 | ✓ |
| U7-LRT-C2 (dead Timer/Alarm tables) | T-5 | ✓ |
| U8-PERF-C1 (lifespan 8-15s serial) | V-5 | ✓ |

**No `AUDIT-MISSED` Critical entries** — Phase-2 gate clears.
