# PHANTOM OS Desktop — GRAND PLAN

> **Що це:** документ-аудит + план змін на десктоп-стороні `phantom-os` (Radxa Dragon Q6A / Linux ARM64), щоб реалізувати екосистему з `ECOSYSTEM_GRAND_PLAN.md`.
> 
> **Зв'язок з іншими планами:**
> * `MOBILE_ECOSYSTEM_VISION.md` — філософія §1..§13.
> * `ECOSYSTEM_GRAND_PLAN.md` (поряд) — 40 capability-deep-dives + cross-cutting інфраструктура.
> * `companion-android/docs/ROADMAP.md` — мобільні фази Tier 1..4.
> * Цей документ → **що саме треба добудувати/перебудувати на phantom-os**, з прив'язкою до конкретних capability у ECOSYSTEM_GRAND_PLAN.

> **Принцип:** phantom-os з самого початку був "single-device brain з touch-7-екраном на Radxa". Тепер він стає **brain-в-розподіленому-організмі**: координатором десятків пристроїв, координатором family hive, оркестратором heavy задач, архіватором life log на десятиліття. Мусять змінитись фундаментальні шари. Цей документ розкладає де + як.

---

## 0. Поточний стан (Audit on 2026-05-06)

### 0.1 Що вже є (✅)

**Backend Python FastAPI:**

```
src/backend/
├── core/
│   ├── context_engine.py        ✅ зрілий — збирає snapshot, оцінює intent
│   ├── decision_tree.py         ✅ priority-based autonomous decisions
│   ├── state_machine.py         ✅ 6 SystemStates (SHADOW/FOCUS/DIALOGUE/SENTINEL/GHOST/DREAM)
│   └── event_bus.py             ✅ internal pub/sub
├── ai/
│   ├── gemini_provider.py       ✅ Gemini 2.0 Flash via google-genai
│   ├── ollama_provider.py       ✅ local Gemma fallback
│   ├── chat_pipeline.py         ✅ orchestration з fallback
│   ├── prompt_builder.py        ✅ dynamic prompts
│   └── personality.py           ✅ tone adaptation
├── memory/
│   ├── session_memory.py        ✅ оперативна
│   ├── tactical_memory.py       ✅ 24h window
│   ├── strategic_memory.py      ✅ ChromaDB вічна
│   ├── archive_memory.py        ✅ Sealed/Dead Zone
│   └── user_model.py            ✅ behavioral_model per user
├── voice/
│   ├── stt_engine.py            ✅ faster-whisper + Vosk
│   ├── tts_engine.py            ✅ StyleTTS2 Ukrainian (patriotyk)
│   ├── wake_word.py             ✅ hotword
│   └── voice_pipeline.py        ✅ full duplex
├── sensors/
│   ├── serial_bridge.py         ✅ pyserial-asyncio ESP32
│   ├── sensor_parser.py         ✅ JSON → typed snapshot
│   └── command_sender.py        ✅ ESP32 commands
├── vision/
│   ├── face_tracker.py          ✅ OpenCV + servo delta
│   └── camera_manager.py        ✅ camera lifecycle
├── security/                    ✅ auth + jwt + crypto + permissions
├── linux/                       ✅ executor + resource_monitor + dangerous_patterns
├── tools/                       ✅ timer + alarm + calendar + file_manager
├── wardriving/                  ✅ wifi/ble scan + heatmap
├── api/
│   ├── routes_*.py              ✅ auth/chat/context/settings/map/linux/tools/voice
│   ├── websocket_hub.py         ✅ central WS multiplexer
│   ├── routes_pair.py           ✅ ECDH+HMAC pair flow
│   ├── routes_handoff.py        ✅ cross-device handoff registry
│   ├── routes_companion_control.py  ✅ phone-controls-desktop
│   ├── routes_backup.py         ✅ encrypted backup wizard (commit 8202022)
│   └── routes_drive.py          ✅ phone /drive/upload
├── discovery/
│   └── mdns_publisher.py        ✅ _phantom._tcp advertise (commit 8202022)
├── agent/
│   ├── planner.py               ✅ multi-step planning
│   ├── audit.py                 ✅ self-audit loop
│   ├── emotion.py               ✅ valence detection
│   ├── council.py               ✅ Council auto-engage (commit 5fc2966)
│   └── lesson_distill.py        ✅ knowledge compounding (commit 290fdd1)
├── tools/backup_service.py      ✅ encrypted vault export
└── db/                          ✅ SQLAlchemy + 13 migrations
```

**Frontend React 18 + Vite + TS strict:**

```
src/frontend/src/
├── components/
│   ├── core/                    ✅ StatusBar, Avatar, StateIndicator
│   ├── chat/                    ✅ ChatWindow, MessageBubble
│   ├── map/                     ✅ TacticalMap, Layers, MarkerCards
│   ├── settings/                ✅ SettingsPanel, BackupRestoreCard
│   ├── auth/                    ✅ LoginScreen, PinPad, RFIDScanner
│   ├── terminal/                ✅ TerminalWidget, LiveOutput
│   └── tools/                   ✅ Timer, Alarm, Calendar, FileManager
├── stores/                      ✅ Zustand
├── hooks/                       ✅ useAgentStream, useChannel
├── services/                    ✅ WebSocket, API
├── layouts/                     ✅ Shadow/Focus/Sentinel/Ghost/Dream/Dialogue
└── components/agent/            ✅ ControlsBar, etc
```

**OmniMap (Phase 24):** ✅ 12 layer manifests + 4 endpoints + AttributionDrawer + 50 tests + map.* verbs (24-B routing facade BRouter+ORS+OSRM 47/47 tests).

**Personal Vault (Phase 25-A..E):** ✅ encrypted vault end-to-end + REST + chat + reveal + FE + AI vault card.

**Team Organisation (Phase 26-A/B/C):** ✅ agent.delegate + 23 specialists + team_leads + agent.assemble_team.

### 0.2 Чого нема (❌) — gap analysis

| Capability (з ECOSYSTEM_GRAND_PLAN) | Що бракує на phantom-os |
|---|---|
| 1.1 Auto-Discovery + Multi-Channel Pair | mDNS publisher є, але **нема ECDSA-beacon з Wi-Fi Direct + BLE GATT advertise + sub-audible echolocation** на boundary devices |
| 1.2 Compute Mesh Routing | Нема `compute_router/` модуля. ContextEngine routes **тільки локально**, не знає про phone/watch/ambient capabilities |
| 1.3 Heavy Offloading | Нема `task_journal/`, нема progress-streaming назад на phone |
| 1.4 GodMode (mobile-side capability) | n/a — це phone-only |
| 1.5 Behavioral Twin | Існує user_model, але **нема continuous 30s embedding + HNSW vector store + temporal_memory query** |
| 1.6 Predictive Spawn | Нема `predictive_spawner/` runner, нема `predictive_recipes.yaml` DSL |
| 1.7 Family Hive Trust Graph | Нема **`family_members` SQLCipher table з ECDH per-edge keys** |
| 1.8 Posthumous Familiar | Нема LoRA training pipeline + multi-sig handover + voice clone aggregator |
| 1.9 Cross-Person Empathy | Нема `empathy_relay/` модуля з valence-only sharing |
| 1.10 Familiar Council | Council auto-engage є (commit 5fc2966) — **треба розширити до 3-personality** (Strategic/Creative/Empathetic) + synthesizer |
| 1.11 Adversarial Layer | Нема `adversarial_layer/` wrapper для propose-to-operator calls |
| 1.12 Body Twin Aggregator | Нема fusion pipeline для wearables + ESP32 + voice biometric |
| 1.13 Location-Aware Memory | OmniMap є, але **нема індекса life log items за geohash bucket** |
| 1.14 Continuous Translation | StyleTTS2 є, **streaming whisper-translate-StyleTTS2 chain не зібраний** |
| 1.15 Emotional Mirroring | Emotion detector є (`agent/emotion.py`), **personality adapter відсутній** |
| 1.16 Phantom Proxy Identity | Нема policy-DSL для autoreply governance |
| 1.17 Smart Scheduling Negotiation | Нема `scheduling_negotiator/` agentic loop між PHANTOMами |
| 1.18 Sleep Stitching | Нема DREAM-state runner що робить night synthesis + tomorrow brief |
| 1.19 Phantom Network Effect | Нема BLE/UWB peer handshake, нема `meeting_handshake/` |
| 1.20 Ambient Reality Theatre | Нема CRDT shared session store (Yjs-style) |
| 1.21 Conscious Bandwidth Budgeting | Нема `interrupt_governor/` за state |
| 1.22 Federated Curiosity | Нема `cross_pollinator/` correlation finder між плагінами |
| 1.23 Federated Memory Reservoir | Нема query-routing-to-friends-Familiar mechanism |
| 1.24 Federated Learning | Нема secure aggregator + DP-SGD pipeline |
| 1.25 Memory Palace | Нема ARCore Cloud Anchor integration |
| 1.26 Temporal Awareness | Memories є але **нема "when" semantic search + speaker diarization** |
| 1.27 Contextual Recipe Generator | Нема ESP32-Fridge spec + recipe gen runner |
| 1.28 Proactive Defense | Нема panic detector pattern (motionless→spike→silent) |
| 1.29 Voicebox Clone | Нема personal-voice fine-tune pipeline для StyleTTS2 |
| 1.30 Diary by Default | Нема significance classifier + auto Life Log entry creation |
| 1.31 Continuous Behavioral Updates | LoRA delta updates не реалізовані |
| 1.32 Family Echolocation | Нема sub-audible beacon mesh implementation |
| 1.33 Health Sentinel | Нема multi-modal anomaly detector trends ↑↓ |
| 1.34 Cognitive Load Balancer | Нема `cognitive_load_estimator/` |
| 1.35 Negotiation Coach (live) | Нема `live_call_listener/` + RAG benchmark |
| 1.36 Reality Anchor | Нема `commitment_ledger/` long-term tracking |
| 1.37 Skill Gym | Нема curriculum generator + progress tracker |
| 1.38 Ambient Music Director | Нема `music_director/` state-aware curator |
| 1.39 Inter-Phantom Market | Нема public Familiar API + service-Familiar registry |
| 1.40 Generational Transfer | Нема parent→kid insight passing з consent |

**Cross-cutting infrastructure gaps:**

| Інфраструктура (ECOSYSTEM_GRAND_PLAN §2) | Стан |
|---|---|
| 2.1 Privacy Architecture | partial — vault шифрований, але **нема differential privacy для federated, нема Shamir SSS для multi-sig, нема revocation broadcast** |
| 2.2 Phantom Relay 2.0 | ❌ **відсутній цілком** — зараз LAN-only через ngrok manually |
| 2.3 Cost Ledger | ❌ нема real-time tracker compute/bandwidth/cloud-tokens |
| 2.4 Trust Evolution | ❌ paired_hosts есть, але без trust dimensions, без decay, без context modifiers |
| 2.5 Federated Learning | ❌ нема secure aggregator + per-classifier opt-in |
| 2.6 Audit & Transparency | partial — є audit trail logs але **нема operator-facing "audit ticker" dashboard** |

---

## 1. ПЛАН ПЕРЕБУДОВИ (по доменах)

### 1.1 Нові backend модулі (Python)

#### `src/backend/router/` (нове)
- `compute_router.py` — `Route(intent, available_nodes) → Node + transport + fallback_chain`
- `device_topology.py` — live JSON dump усіх online вузлів з capabilities
- `cost_ledger.py` — real-time бюджет токенів/мережі/часу
- `routing_policies.py` — per-state routing matrix (FOCUS=cloud-OK, GHOST=local-only)

**Залежить від:** ECOSYSTEM_GRAND_PLAN 1.2.

#### `src/backend/relay/` (нове)
- `phantom_relay_client.py` — client до self-hosted relay
- `phantom_relay_server.py` — own WireGuard-based reverse relay (для production deploy на VPS)
- `tailscale_bridge.py` — опційна інтеграція mesh VPN
- `cloudflare_tunnel_fallback.py` — для зон де UDP не пройде
- `roaming_handoff.py` — transparent reconnect ≤500ms WiFi↔5G

**Залежить від:** ECOSYSTEM_GRAND_PLAN 2.2 + Phase 5-A,B,C.

#### `src/backend/heavy_task/` (нове)
- `runner.py` — приймає Task, реєструє у `task_journal` SQLite, виконує годинами
- `progress_streamer.py` — push WS updates до phone
- `context_echo.py` — phone може спитати "як там Карпати?" — runner відповідає поточний state

**Залежить від:** ECOSYSTEM_GRAND_PLAN 1.3 + Phase 5-D.

#### `src/backend/family_hive/` (нове)
- `members.py` — CRUD на `family_members` SQLCipher table
- `trust_graph.py` — n-вимірний граф з dimensions + temporal_decay + context_modifiers
- `revocation_broadcast.py` — UDP-multicast у trust graph + cleanup worker
- `audit_log_dual.py` — записує дві сторони edge на read
- `proximity_zones.py` — ECDSA-signed beacon detection

**Залежить від:** ECOSYSTEM_GRAND_PLAN 1.7 + Phase 5-F.

#### `src/backend/empathy/` (нове)
- `valence_emitter.py` — періодично публікує `(valence, topic_class, intensity)` для opt-in subscribers
- `valence_subscriber.py` — слухає партнерські valence streams
- `action_mapper.py` — правила "(partner_valence < -0.5 && topic == work)" → propose actions

**Залежить від:** ECOSYSTEM_GRAND_PLAN 1.9 + Phase 5-F.

#### `src/backend/posthumous/` (нове)
- `data_aggregator.py` — щоденний збір text/voice/decisions для training corpus
- `lora_trainer.py` — incremental LoRA fine-tune Gemma 3-12B (через MediaPipe Genai на Radxa GPU)
- `voice_clone_trainer.py` — StyleTTS2 personal voicebox fine-tune
- `multi_sig_vault.py` — Shamir 3-of-5 trustees + bequest.lock storage
- `death_confirmed_handler.py` — Telegram bot інтеграція + 30-день window
- `posthumous_chat_runtime.py` — runtime для бесіди з симуляцією

**Залежить від:** ECOSYSTEM_GRAND_PLAN 1.8 + Phase 7-F.

#### `src/backend/body_twin/` (нове)
- `wearable_aggregator.py` — fuses Garmin / Apple Watch / Wear OS / Pixel Watch streams
- `voice_biometric.py` — voice prosody → stress/fatigue indicators
- `esp32_fusion.py` — bedroom motion + RFID + bed pressure → presence states
- `time_series_store.py` — InfluxDB or per-day SQLite tables
- `personal_baseline.py` — Z-score against operator's own baseline (NOT population)

**Залежить від:** 1.12, 1.33, 1.34 + Phase 5-E + 5-F.

#### `src/backend/temporal_memory/` (нове)
- `embedder.py` — 30s vector capture (operator state)
- `hnsw_index.py` — HNSW per-day shard, queryable
- `temporal_search.py` — combined semantic + temporal + spatial query
- `voice_diarization.py` — speaker-aware transcript indexing

**Залежить від:** ECOSYSTEM_GRAND_PLAN 1.5, 1.13, 1.26 + Phase 7-E.

#### `src/backend/predictive/` (нове)
- `spawner.py` — 1хв cron checks pre-fetch handlers
- `recipes.yaml` — declarative pre-fetch DSL
- `pattern_detector.py` — geo+time+intent pattern miner
- `accept_dismiss_logger.py` — operator feedback loop

**Залежить від:** ECOSYSTEM_GRAND_PLAN 1.6 + Phase 3-D.

#### `src/backend/agent_council_v2/` (розширення існуючого)
- `personality_strategic.py` — system prompt holder
- `personality_creative.py` — same
- `personality_empathetic.py` — same
- `synthesizer.py` — 4-й виклик зводить 3 голоси у фінал
- `important_decision_classifier.py` — інтент → значуще?

Розширює `agent/council.py`.

**Залежить від:** ECOSYSTEM_GRAND_PLAN 1.10 + new Phase 7-H.

#### `src/backend/adversarial/` (нове)
- `propose_wrapper.py` — обгортає `propose_to_operator` calls
- `adversary_llm.py` — Gemma 3-2B з system prompt "знайди слабкі місця у пропозиції"
- `veto_threshold.py` — confidence > 0.7 → блок
- `operator_review_panel.py` — UI для перегляду блоків + revoke

**Залежить від:** 1.11.

#### `src/backend/agent/proxy_identity/` (нове)
- `policy_dsl.py` — DSL parser ("for колеги type messages, defer scheduling decisions to me")
- `outbound_drafter.py` — LLM генерує draft + tag-stamp
- `preview_window.py` — 60s timeout default-allow override
- `audit_trail.py` — usage log

**Залежить від:** 1.16 + new Phase 5-I.

#### `src/backend/scheduling_negotiator/` (нове)
- `availability_collector.py` — pull від кожного PHANTOMа family hive
- `optimizer.py` — оптимізація (collective inconvenience minimization)
- `inter_phantom_messenger.py` — encrypted multicast у hive
- `poll_orchestrator.py` — poll all participants з timeout

**Залежить від:** 1.17 + Phase 5-H.

#### `src/backend/night_synthesis/` (нове)
- `dream_runner.py` — DREAM state о 23:00 trigger
- `day_summarizer.py` — top-50 events → narrative
- `tomorrow_brief.py` — pre-stage 1-3 widgets для ранку
- `behavioral_drift_detector.py` — KL divergence current vs 30days-ago

**Залежить від:** 1.18 + new Phase 5-J.

#### `src/backend/echolocation/` (нове)
- `beacon_emitter.py` — burst signed sine sweep 18-22kHz
- `beacon_listener.py` — inverse signature detection
- `triangulator.py` — 3+ paired devices → room-level locality
- `signed_beacon_validator.py` — trust-graph only

**Залежить від:** 1.32 + new Phase 6-E.

#### `src/backend/cross_pollinator/` (нове)
- `correlation_finder.py` — Pearson + Granger causality lite
- `time_series_aligner.py` — different plugins emit at different cadences
- `insight_proposer.py` — flag |r|>0.6, p<0.05 → review
- `insight_acceptor.py` — operator accept/reject feedback

**Залежить від:** 1.22 + Phase 7-A.

#### `src/backend/federated/` (нове)
- `secure_aggregator.py` — receive gradient deltas + DP-SGD aggregate
- `noise_engine.py` — differential privacy guard
- `model_distributor.py` — push back updated weights to opt-in clients
- `per_classifier_governance.py` — per-classifier opt-in tracking

**Залежить від:** 1.24 + Phase 7-B.

#### `src/backend/plugin_sandbox/` (нове)
- `wasm_runtime.py` — WASM seccomp-jail
- `manifest_parser.py` — YAML manifest validator
- `capability_negotiator.py` — plugin declares + operator approves
- `result_envelope.py` — typed response shape
- `plugin_marketplace_api.py` — list/install/uninstall

**Залежить від:** ECOSYSTEM_GRAND_PLAN §11 + 1.39 + Phase 7-A.

#### `src/backend/inter_phantom_market/` (нове)
- `service_familiar_api.py` — public typed RPC namespace
- `trust_score_collector.py` — service Familiars rated by trust-graph
- `negotiation_protocol.py` — typed offer/counter-offer messages

**Залежить від:** 1.39 + new Phase 7-I.

#### `src/backend/commitment_ledger/` (нове)
- `commitment_detector.py` — "я обіцяю / ніколи / завжди" detector
- `inconsistency_finder.py` — current vs prior detection
- `gentle_flag_emitter.py` — non-confrontational notification

**Залежить від:** 1.36 + new Phase 7-K.

#### `src/backend/skill_gym/` (нове)
- `skill_graph.py` — known skills + dependencies
- `curriculum_gen.py` — 5-min daily challenge generator
- `progress_tracker.py` — per-skill metrics + plateaus detect

**Залежить від:** 1.37 + Phase 7-A.

#### `src/backend/music_director/` (нове)
- `state_to_audio_recipe.py` — SystemState + biometric → playlist recipe
- `provider_router.py` — Spotify/Apple Music/local lib через unified interface
- `routing.py` — ambient speakers vs earbuds через compute_router

**Залежить від:** 1.38.

#### `src/backend/cognitive_load/` (нове)
- `estimator.py` — multi-modal fatigue (HRV + tap latency + voice)
- `defer_governor.py` — push non-urgent to next state
- `state_proposer.py` — soft-flip до SHADOW при високому fatigue

**Залежить від:** 1.34.

#### `src/backend/negotiation_coach/` (нове)
- `live_listener.py` — STT live during call
- `benchmark_rag.py` — price benchmarks knowledge base
- `whisper_responder.py` — sub-vocal channel в earbuds
- `consent_tracker.py` — both parties opt-in management

**Залежить від:** 1.35.

#### `src/backend/health_sentinel/` (нове)
- `trend_analyzer.py` — 7/14/30/90 days trends
- `anomaly_classifier.py` — flag-only NOT diagnose
- `doctor_visit_proposer.py` — high-confidence → propose visit

**Залежить від:** 1.33.

#### `src/backend/diary_by_default/` (нове)
- `significance_classifier.py` — score event 0..1
- `auto_log_entry.py` — > 0.6 threshold → Life Log entry
- `manual_override.py` — operator retroactive adjust

**Залежить від:** 1.30.

#### `src/backend/memory_palace/` (нове, mobile-first але координує з backend)
- `arcore_anchor_bridge.py` — ARCore Cloud Anchor sync через relay
- `room_semantic_anchor.py` — kitchen / bedroom / office classification
- `bubble_renderer_proto.py` — proto messages для phone/glasses AR

**Залежить від:** 1.25.

#### `src/backend/generational_transfer/` (нове)
- `parent_insight_collector.py` — "share with kids when relevant" tag
- `kid_familiar_consumer.py` — soft constraints у advisor
- `audit_dual_logger.py` — parent бачить як insight applied

**Залежить від:** 1.40.

---

### 1.2 Розширення існуючих backend модулів

#### `src/backend/core/context_engine.py`
**Зараз:** збирає snapshot, оцінює intent тільки з local Radxa data.
**Треба:**
- Subscribe на device_topology updates (1.2)
- Read від phone Behavioral Twin embeddings (1.5)
- Apply per-state policies (interrupt_governor, 1.21)
- Cross-reference family hive valence (1.9)

#### `src/backend/core/state_machine.py`
**Зараз:** 6 SystemStates з простим переходом.
**Треба:**
- Per-state interrupt budget rules (1.21)
- Routing strategy per state (1.2)
- DREAM-state trigger night synthesis (1.18)
- GHOST-state cuts ALL outbound (federated, valence emit, etc)

#### `src/backend/api/websocket_hub.py`
**Зараз:** central WS multiplexer для phone <-> desktop.
**Треба:**
- Channels: `family_hive`, `valence`, `task_journal`, `audit_ticker`, `device_topology`
- Multi-PHANTOM routing (one socket → many family Familiars subscribed)
- Compression — bandwidth budgeting (cost_ledger)

#### `src/backend/agent/lesson_distill.py`
**Зараз:** lesson distillation loop (commit 290fdd1) — local only.
**Треба:** federated cross-device — lessons можуть приходити від phone Familiar / wear / partners' agents (1.24).

#### `src/backend/voice/tts_engine.py`
**Зараз:** StyleTTS2 Ukrainian (patriotyk).
**Треба:**
- Personal voice clone training pipeline (1.29)
- Multi-voice (Familiar Council 3 personalities sound differently — 1.10)
- Streaming output для negotiation_coach whisper (1.35)
- Latency optimization для real-time translation (1.14)

#### `src/backend/agent/council.py`
**Зараз:** auto-engage on high-risk (commit 5fc2966).
**Треба:** розширити до 3-personality (Strategic/Creative/Empathetic) + synthesizer (1.10).

---

### 1.3 Frontend (Radxa display) перебудова

Поточний frontend — операторський dashboard на 1024×600. Має стати **ecosystem control room**.

#### Нові layouts (поряд з Shadow/Focus/Sentinel/Ghost/Dream/Dialogue)

**`src/frontend/src/layouts/EcosystemLayout.tsx`** — нова поверхня для огляду усієї tканини:
- Top: device topology graph (live nodes + transport + signal strength)
- Center: family hive board (хто де + коли)
- Right: heavy_task journal (running tasks + progress)
- Bottom: audit ticker (real-time що Familiar бачить)

**`src/frontend/src/layouts/LifeLogLayout.tsx`** — query interface для life log:
- Top: search bar (semantic + temporal + spatial)
- Center: timeline (vertical scroll, decade-aware zoom)
- Bottom: detail panel (вибраний event + transcript + biometric snapshot + bubble на map)

**`src/frontend/src/layouts/PluginsLayout.tsx`** — marketplace + management:
- Installed plugins list
- Marketplace browse
- Per-plugin permissions + audit log
- Federated learning opt-in toggles

**`src/frontend/src/layouts/CostLayout.tsx`** — Cost Ledger transparency:
- Daily spend graph (compute/bandwidth/cloud-tokens)
- Per-category breakdown
- Anomaly alerts ("сьогодні 5x токенів — debugging?")
- Operator policy editor ("budget $5/day Gemini")

**`src/frontend/src/layouts/PosthumousLayout.tsx`** — bequest setup:
- Trustees registry (Shamir 3-of-5)
- Beneficiary recipes (which slice goes to whom)
- Test mode ("проговори зі мною симуляцію future-me")
- Training progress bar (Familiar fine-tune corpus growth)

**`src/frontend/src/layouts/ExistentialLayout.tsx`** — yearly review:
- "У 2026 ти провів 740h на телефоні"
- 6 значущих рішень з контекстом
- 12 нових knowledge domains
- Visual timeline of growth

#### Нові components

- `components/ecosystem/DeviceTopology.tsx` — graph viz
- `components/ecosystem/FamilyHiveBoard.tsx` — calendar-like хто-де
- `components/ecosystem/AuditTicker.tsx` — real-time що Familiar бачить
- `components/lifelog/SemanticSearchBar.tsx`
- `components/lifelog/TimelineScroller.tsx`
- `components/plugins/MarketplaceCard.tsx`
- `components/cost/SpendChart.tsx`
- `components/posthumous/TrusteesEditor.tsx`
- `components/posthumous/BequestPlanner.tsx`
- `components/existential/YearlyReview.tsx`
- `components/trust/TrustGraphRadar.tsx` — radial spider chart per trust dimension
- `components/familiar/CouncilDebate.tsx` — Familiar Council UI з 3 голосами
- `components/health/SentinelDashboard.tsx`
- `components/decisions/AdversarialReviewPanel.tsx` — переглянути блоки

#### Нові stores

- `stores/deviceTopologyStore.ts`
- `stores/familyHiveStore.ts`
- `stores/auditTickerStore.ts`
- `stores/lifeLogStore.ts`
- `stores/pluginsStore.ts`
- `stores/costLedgerStore.ts`
- `stores/posthumousStore.ts`
- `stores/trustGraphStore.ts`
- `stores/healthSentinelStore.ts`

---

### 1.4 Sensor / actuator expansion (ESP32-S3 firmware + new devices)

#### Nodes (vision §8.1)

**ESP32-Ambient-Kitchen** (новий node):
- Door magnetic switch (open/close detection)
- Motion PIR
- RFID/NFC (для presence tag-based check-in)
- Light intensity (для DREAM proximity check)
- Optional: weight sensor for fridge inventory (1.27)

**ESP32-Ambient-Bedroom** (новий node):
- Bed pressure sensor (хто-коли спить)
- Motion detector (presence)
- Air quality (CO2 + VOC for sleep tracking)
- Temperature + humidity

**ESP32-Ambient-Hallway** (новий node):
- Camera + ML Kit person counter (хто увійшов)
- Motion direction (came in / went out)
- Floor pressure mat (gait pattern recognition for biometric trust 1.7)

**ESP32-Ambient-Vehicle** (новий node):
- OBD-II reader (engine state, fuel, errors)
- GPS module
- Camera (dashcam mode)
- BLE bridge для phone когда в машині

**Smart Glasses bridge** (Meta Ray-Ban API or Frame or Brilliant Labs):
- First-person camera feed → vision processing
- AR overlay rendering surface
- Speaker (для whisper-channel в полевих умовах)

**Body cam bridge** (consumer body cam через RTSP or USB):
- Continuous video for life log + Memory Palace
- Optional spatial audio capture

**Wear OS bridge** (Phase 5-E):
- HRV + heart rate stream
- Tactile alerts
- Voice PTT input
- Watch face state mirror

**Pixel Buds / TWS bridge:**
- Spatial audio output (1.4 ambient mosaic)
- Mic input (whisper-translate, emotion detect)
- Tap controls

#### Backend `src/backend/sensors/` extensions

- `multi_node_orchestrator.py` — координує ESP32 mesh
- `wearable_bridge.py` — Wear OS / Apple Watch / Pixel Watch unified API
- `glasses_bridge.py` — Meta Ray-Ban / Frame / Brilliant API normalization
- `vehicle_bridge.py` — OBD-II + GPS car module
- `body_cam_bridge.py` — RTSP/USB camera ingestion

---

### 1.5 Cross-cutting infrastructure

#### Privacy stack

`src/backend/privacy/`
- `differential_privacy.py` — DP-SGD noise for federated
- `shamir_secret_sharing.py` — multi-sig vault
- `valence_only_emitter.py` — content-stripping для empathy
- `audit_log_dual.py` — dual-side write
- `revocation_broadcast.py` — UDP-multicast cleanup

#### Phantom Relay (self-hosted)

`src/relay_server/` (новий top-level каталог — окремий VPS deployable)
- WireGuard config templating
- Authentication через Brain's signing key
- Bandwidth shaping per-edge
- Multi-relay redundancy + health check

#### WASM Plugin sandbox

`src/backend/plugin_sandbox/wasmtime_runtime.py` — wasmtime-py або wasmer-python integration з seccomp.

#### Time-series store

`src/backend/timeseries/`
- InfluxDB local або per-day SQLite tables
- Used by body_twin, health_sentinel, cost_ledger

#### Vector store upgrade

Зараз ChromaDB. Треба:
- HNSW index — for behavioral_twin (1.5) — ~30-day rolling window per user
- AgentDB integration або custom HNSW pure-Python
- Quantization 4-32x для memory budget

`src/backend/vector_store/`
- `hnsw_per_day.py`
- `quantization.py`
- `hybrid_search.py`

---

## 2. ФАЗА-ОРІЄНТОВАНИЙ ROADMAP (phantom-os сторона)

Прив'язано до tier-системи з MOBILE_ECOSYSTEM_VISION §13 + ROADMAP мобільного.

### Phase Desktop-1 — Compute Mesh foundation (Tier 1.5)
- `compute_router/` + `device_topology` + `cost_ledger`
- ContextEngine adapter to consume topology
- Frontend `DeviceTopology` component basic
- ETA: 2-3 тижні

### Phase Desktop-2 — Family Hive trust graph (Tier 3)
- `family_hive/` модуль
- `trust_graph` table + dimensions
- ECDH per-edge key exchange
- Frontend `FamilyHiveBoard` + `TrustGraphRadar`
- Migration script `017_family_members.py`

### Phase Desktop-3 — Phantom Relay self-hosted (Tier 3)
- `relay_server/` standalone VPS deploy
- WireGuard config + bandwidth shaping
- Roaming Handoff client integration
- Documentation для self-hosting

### Phase Desktop-4 — Heavy Task orchestrator (Tier 3)
- `heavy_task/` runner + journal + progress streaming
- Frontend "Heavy Task" panel у EcosystemLayout
- Phone-side widget integration

### Phase Desktop-5 — Body Twin aggregator (Tier 1.5 + 3)
- `body_twin/` fusion pipeline
- Wearable bridges (Wear OS first)
- Time-series store init
- Health Sentinel base

### Phase Desktop-6 — Posthumous archiver (Tier 4)
- `posthumous/` модуль
- LoRA training pipeline (Gemma 3-12B)
- Voice clone training (StyleTTS2 fine-tune)
- Multi-sig vault + Shamir SSS
- Frontend `PosthumousLayout` setup wizard

### Phase Desktop-7 — Familiar Council v2 (Tier 4)
- 3-personality system prompts + synthesizer
- Frontend `CouncilDebate` UI
- `important_decision_classifier`
- Adversarial Layer integration

### Phase Desktop-8 — Federated Learning (Tier 4)
- `federated/` aggregator + DP-SGD
- Per-classifier opt-in UI
- Cross-pollinator running on top

### Phase Desktop-9 — Plugin SDK + Marketplace (Tier 4)
- `plugin_sandbox/` WASM runtime
- Manifest YAML + capability negotiation
- Frontend `PluginsLayout` marketplace
- Inter-Phantom Market public API

### Phase Desktop-10 — Life Log + Temporal Memory (Tier 4)
- `temporal_memory/` HNSW per-day shard
- Voice diarization pipeline
- `Diary by default` significance classifier
- Frontend `LifeLogLayout` search interface

### Phase Desktop-11 — Predictive + Sleep Stitching (Tier 2 + 3)
- `predictive/` spawner
- `night_synthesis/` DREAM runner
- `cognitive_load/` estimator

### Phase Desktop-12 — Inter-PHANTOM ecosystem features (Tier 3 + 4)
- `scheduling_negotiator/` multi-Familiar
- `empathy/` valence relay
- `meeting_handshake/` BLE/UWB
- `generational_transfer/`
- `commitment_ledger/`

### Phase Desktop-13 — Voice + AI advanced (Tier 2.5 + 4)
- `voicebox_clone/` personal voice
- `negotiation_coach/` live call
- `continuous_translation/` whisper-translate-StyleTTS2

### Phase Desktop-14 — Existential dashboard + Ambient music (Tier 4)
- `existential_dashboard/` yearly review aggregator
- `music_director/` state-aware curator
- Frontend `ExistentialLayout`

---

## 3. ЩО ТРЕБА ПЕРЕРОБИТИ (technical debt)

### 3.1 ChromaDB → AgentDB або кастомний HNSW
Поточний ChromaDB — single-collection, не оптимальний для:
- per-day shard (life log)
- quantized vectors (memory budget)
- multi-tenant query (family hive shared topics)

**Action:** evaluate AgentDB (claude-flow project ref) або pure-Python HNSW (`hnswlib`).

### 3.2 SQLAlchemy schema розширення
Додати таблиці:
- `device_topology` — live nodes
- `family_members` — Family Hive
- `trust_edges` — graph edges with dimensions
- `task_journal` — heavy task state
- `cost_ledger_daily` — costs aggregated
- `commitment_ledger` — long-term commitments
- `audit_log_dual` — dual-side reads
- `predictive_recipes` — pre-fetch patterns
- `health_baseline` — personal Z-score baseline
- `pivotal_events` — life log significance > 0.7

Migration scripts `017_*.py` через `028_*.py`.

### 3.3 Frontend layout system
Поточні 6 layouts (Shadow/Focus/Sentinel/Ghost/Dream/Dialogue) — state-driven. Додаються 7 layouts (Ecosystem/LifeLog/Plugins/Cost/Posthumous/Existential/Health) — **task-driven**, не state-driven. Треба:
- LayoutSwitcher v2 — supports both state-driven і task-driven
- Persistence — `selectedLayout` в localStorage
- Fast switching через Cmd+1..7 keyboard shortcuts (на десктоп)

### 3.4 WebSocket channel multiplexing
Зараз `websocket_hub.py` має ~10 channels. Додаємо 12+ нових. Треба:
- Channel registry pattern (avoid 30-channel monolith)
- Subscription manager — per-channel rate-limit
- Backpressure handling — slow consumer doesn't block fast

### 3.5 Async pipeline для heavy задач
Поточний `chat_pipeline.py` синхронний по timeout 5s → fallback Ollama. Heavy tasks потребують:
- Job queue (Celery? або asyncio.Queue + supervisor)
- Cancellation token propagation
- Progress streaming back через WS

### 3.6 Configuration — Pydantic Settings v2
Існуючий `config.py` (Pydantic v2) має ~50 полів. З додаванням ECOSYSTEM_GRAND_PLAN додасться ~150 нових. Треба:
- Розбити на feature-config-files (`config_relay.py`, `config_family.py`, `config_posthumous.py`)
- Hot-reload — operator може переконфігурувати без restart
- Schema validation на UI side

### 3.7 Тестова стратегія
Поточно ~250 backend tests + ~150 frontend tests.
З ECOSYSTEM_GRAND_PLAN треба ~600+ нових тестів. Треба:
- Test partitioning — per-feature suite
- Integration test fixture для multi-Familiar (mock 3 PHANTOMs у family hive)
- Property-based testing (hypothesis) для trust graph + relay
- E2E через Playwright для UI layouts

---

## 4. ЦІЛЬ + AKEPTANCE-критерії

### 4.1 Tier 1 standalone (вже досягнутий on mobile)
Phantom-os: нічого нового не треба.

### 4.2 Tier 1.5 + 2 mobile (next 3-6 months)
Phantom-os мусить мати:
- ✅ Compute Mesh routing (Phase Desktop-1)
- ✅ Body Twin aggregator base (Phase Desktop-5)
- ✅ Predictive spawner (Phase Desktop-11)

### 4.3 Tier 3 ecosystem (6-12 months)
- ✅ Family Hive (Phase Desktop-2)
- ✅ Phantom Relay self-hosted (Phase Desktop-3)
- ✅ Heavy Task orchestrator (Phase Desktop-4)
- ✅ Body Twin full + Health Sentinel (Phase Desktop-5)

### 4.4 Tier 4 god-tier (12+ months)
- ✅ Posthumous archiver (Phase Desktop-6)
- ✅ Familiar Council v2 + Adversarial (Phase Desktop-7)
- ✅ Federated Learning (Phase Desktop-8)
- ✅ Plugin SDK + Marketplace (Phase Desktop-9)
- ✅ Life Log + Temporal Memory (Phase Desktop-10)
- ✅ Inter-PHANTOM features (Phase Desktop-12)
- ✅ Voice advanced (Phase Desktop-13)
- ✅ Existential + Music (Phase Desktop-14)

---

## 5. Як це РУЙНУЄ існуючі парадигми

| Парадигма | PHANTOM альтернатива |
|---|---|
| Apple HomeKit (centralized hub) | Self-organizing fabric з per-device capabilities |
| Google Assistant (single AI) | Multi-Familiar council + adversarial + federated |
| Notion / Obsidian (manual notes) | Diary by default + temporal-aware semantic search |
| Spotify Wrapped (vendor analytics) | Existential dashboard на власному пристрої |
| WhatsApp / iMessage (text-only) | Phantom Network Effect — context handshake IRL |
| Google Calendar (manual scheduling) | Smart scheduling negotiation between PHANTOMs |
| Replika (chatbot persona) | Posthumous Familiar — fine-tuned на real life |
| Ring / Nest (privacy-questionable cameras) | Body Twin з consent + valence-only sharing |
| ARKit/ARCore (sandboxed apps) | Memory Palace + Continuous Translation seamless |
| Plug-in stores (App Store revenue cut) | Federated plugin SDK — operator-paid, no vendor cut |

---

## 6. Фінальне резюме

**Чотири шари перетворення phantom-os:**

1. **Координатор tканини** замість brain-в-вакуумі — ContextEngine знає про всі trusted nodes.
2. **Архіватор життя** — temporal_memory + life_log + posthumous archiver роблять phantom-os мyltи-decade memory підкорою.
3. **Орchestrator agentic loops** — heavy_task + scheduling_negotiator + Familiar Council замість single-shot prompt-response.
4. **Privacy guardian** — differential privacy + multi-sig + valence-only + revocation broadcast — кожен новий feature має built-in privacy story.

**~30 нових backend модулів + ~7 нових frontend layouts + ~10 нових ESP32/wearable bridges + ~10 нових infrastructure components = ~60 нових artifacts.**

Це **2-3 роки роботи** при поточному темпі. Але кожен phase атомарний, кожен — самодостатній (operator може встановити Phase Desktop-2 і отримати Family Hive без чекання Phase Desktop-6 Posthumous).

> *PHANTOM OS — не "розумний асистент на дисплеї". PHANTOM OS — це **довговічна нервова система твого життя**, яка живе на твоєму домі, на твоєму тілі, у твоїх стосунках, і переживе тебе у формі симуляції що твої нащадки зможуть запитати поради.*

---

**Наступний крок:** з цього документу + ECOSYSTEM_GRAND_PLAN можна формувати детальні specs для кожного Phase Desktop-N. Перші три фази (Compute Mesh + Family Hive + Phantom Relay) — фундаментальні і блокують усе інше.
