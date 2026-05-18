# PHANTOM OS — Roadmap Past Claude Code / Claude Co-work

> **Кодова назва плану:** atomic-painting-elephant
> **Створено:** 2026-05-03 cessіon-end
> **Гілка:** `autonomous-run`
> **Відштовх:** explorer'и підтвердили що cognitive contour PHANTOM (council, quality gate, info needs, persistent agents) уже категорично багатший за Claude Code/Co-work; залишилось підняти cognitive якість + замкнути self-improvement + дати тіло яке Claude Code не може мати.

---

## Context — навіщо цей план

Поточний `autonomous-run` стан (станом на 2026-05-03 04:30):
- **Cognitive contour закритий:** Quality Gate з producer revise loop (`agent/loop.py:DONE_TASK`), Council 6 ролей з auto-fire, Info-Need 7 варіантів, AskUser→memory+web, 13 chat tools для Васі-агентів CRUD.
- **Hardware integration працює:** ESP32 actuators, screen+OCR+xdotool+atspi, voice STT/TTS, Familiar 3D, ContextEngine 500ms snapshot.
- **Mobile companion майже:** pair_crypto + sensors + approve-on-phone — Backend готовий, Android Compose окремий sprint.
- **Visual Pulse Lane** показує live council/quality-gate/reflection активність.

Що ОБ'ЄКТИВНО блокує "перевершити Claude Code":
1. **Cognitive ceiling** — лише Gemini 2.0 Flash + Ollama. Claude API ніколи не підключений (`ai/provider.py:64-96` має чистий `AIProvider` interface, але реєстрація hardcoded на `{"gemini", "ollama"}` в lines 112-115).
2. **Жодного trajectory learning** — episodes recall є, але pattern extraction нема. PHANTOM не вчиться зі своїх же успіхів.
3. **Phase 20 Peer Mesh — нуль коду.** `src/backend/mesh/` не існує.
4. **Mobile sensors dead-end** — `MobileSensorBatch` зберігається + WS broadcast, але `ContextEngine._apply_batch` (`core/context_engine.py:176-349`) НЕ читає mobile дані. Phone GPS не доходить до snapshot.
5. **Continuous screen monitoring відсутнє** — `vision/screen_capture.py` тільки ad-hoc; нема background loop'а що міг би помітити "користувач відкрив це 3 рази за тиждень".
6. **Council не truly adversarial** — нема Devil's Advocate що ЗАВЖДИ заперечує. Додавання — config-only через `agent/orchestrator/role.py`.
7. **Quality Gate code path** — producer revise регенерує тільки text/document/message/plan; код падає на reflection без справжнього rewrite.

Бажаний результат — після Horizon 1 PHANTOM вже об'єктивно сильніший за Claude Code на cognitive якості; після Horizon 3 — категорично інший продукт (peer organism, ambient presence, marketplace Васі).

---

## HORIZON 1 — Cognitive Lift + Adversarial (1–2 тижні)

### Phase 22 — Multi-Provider Cognition (Claude API + per-task model picker) [S/M]
**Що:** Claude Opus 4.7 / GPT як 3-й + 4-й провайдери з `model_hint` per call.
- **Нові:**
  - `src/backend/ai/anthropic_provider.py` (~250 LOC) — реалізує `AIProvider` interface з `ai/provider.py:64-96`, `_classify_anthropic_error` сімейний до `_classify_gemini_error` (`ai/provider.py:794-830`).
  - `src/backend/ai/openai_provider.py` (~200 LOC) — те ж саме для GPT-родини (опційно).
  - `src/backend/ai/router_policy.py` (~150 LOC) — політика "для kind=council → claude-opus, для tactical → gemini, для chat banter → ollama".
- **Модифіковані:**
  - `src/backend/ai/provider.py:136,281,397` — `model_hint: str | None = None` параметр у всіх трьох entry points (`generate`/`generate_stream`/`call_with_tools`); `_available_sequence` обирає за hint→provider mapping.
  - `src/backend/ai/provider.py:112-115` — replace hardcoded providers dict на `_load_configured_providers(config)`.
  - `src/backend/agent/runtime.py:89-126` — `TaskState.model_config: dict[str, str] | None = None`.
  - `src/backend/agent/planner/tactical.py:19`, `src/backend/agent/orchestrator/council.py:79-106`, `src/backend/ai/chat_pipeline.py:111` — pass `model_hint=...`.
  - `src/backend/config.py` — `ai_anthropic_api_key`, `ai_openai_api_key`, `llm_model_for_context: dict[str, str]`.
  - `src/frontend/src/components/agent/InfoNeedDialog.tsx` + studio UI — model dropdown у CustomAgent run dialog.
- **Залежить:** ні від чого. Strictly additive.
- **Тест:** unit для `_classify_anthropic_error` + integration test що `model_hint="council"` направляє в Claude.
- **Чому це поза Claude Code:** Claude Code = single-vendor harness. PHANTOM стає **cross-vendor cognitive substrate** — Devil's Advocate може працювати на іншій model family ніж Planner; провайдерська різноманітність сама стає епістемічною безпекою.

### Phase 23 — Devil's Advocate + Code-Path Quality Gate [S]
**Що:** 7-ма роль що ЗАВЖДИ заперечує + Quality Gate revise для code артефактів.
- **Нові:**
  - `src/backend/agent/orchestrator/code_revise.py` (~200 LOC) — викликає planner re-entry на critique; producer для kind="code" робить tactical replan з blocker'ами як constraint.
- **Модифіковані:**
  - `src/backend/agent/orchestrator/role.py:34-127` — додати `"devils_advocate"` `_RoleProfile` з `temperature_hint=0.7` і emphasis "Always find the scenario where this plan fails. Object loudly."
  - `src/backend/agent/orchestrator/role.py:261` (`build_default_council_roles`) — append devils_advocate.
  - `src/backend/agent/orchestrator/council.py:41` — додати `"devils_advocate"` у `_BLOCKING_ROLES` так його objection реально downgrade'ує verdict.
  - `src/backend/agent/loop.py` (DONE_TASK блок) — dispatch `artefact_kind == "code"` у `code_revise.run()` замість current single-pass.
  - `src/backend/agent/orchestrator/quality_gate.py` — extend `_LIKELY_HALF_CODE` regex catalog.
- **Залежить:** Phase 22 (щоб Advocate fix-ив на Claude/GPT — sibling model).
- **Тест:** mock 3-агентний council, Advocate force objection → verdict downgrades to "revise". Code artefact з `def foo(): pass` → quality gate force regen → новий patch без stub.
- **Чому це поза Claude Code:** Claude Code оптимізує під complacent помічника. PHANTOM має **інституційного диссидента** що блокує shipping — структурна властивість якої single CLI session мати не може.

### Phase 24 — Mobile Sensors → ContextEngine Fusion [S]
**Що:** Phone GPS/IMU/baro/HRV доходять до 500ms snapshot → geofencing і body-state alerts реально працюють.
- **Модифіковані:**
  - `src/backend/core/context_engine.py:176-349` — додати `_apply_mobile_batch()` що читає `MobileSensorBatch` останній row для активних `PairedDevice` юзера; merge у gps/motion/body fields snapshot. Поле `mobile_present: bool`.
  - `src/backend/api/routes_mobile_sensors.py:96` — після persist + broadcast, fire `context_engine.notify_mobile_batch_arrived()` так наступний snapshot tick одразу читає свіжі дані.
  - `src/backend/core/snapshot_schema.py` (or wherever ContextSnapshot lives) — додати optional `mobile_*` fields.
- **Залежить:** ні (паралельно з 22-23).
- **Тест:** PHANTOM running локально + curl POST /sensors/mobile_batch → перевірити що наступний WS `context.snapshot` містить новий GPS і `mobile_present=true`.
- **Чому це поза Claude Code:** Claude Code не має тіла. PHANTOM ingest off-device біологічні/просторові сигнали як first-class context.

---

## HORIZON 2 — Self-Improvement + Ambient + Mesh foundation (3–6 тижнів)

### Phase 25 — Trajectory Pattern Learning (ReasoningBank-style) [L]
**Що:** Успішні episodes дистилюються у reusable strategy patterns; recall ранжує їх; planner inject'ить як hints.
- **Нові:**
  - `src/backend/agent/memory/trajectory_patterns.py` (~350 LOC) — extract: tool-sequence n-grams, role-vote signatures, time-of-day correlations.
  - `src/backend/db/migrations/0XX_trajectory_patterns.py` — table `agent_trajectory_patterns(id, owner_user_id, goal_signature, action_sequence_json, success_count, failure_count, last_seen_at)`.
  - `src/backend/agent/memory/distill_job.py` — DREAM-state nightly job що проганяє останні N episodes через pattern extractor.
- **Модифіковані:**
  - `src/backend/agent/memory/seeds.py:37-79` (`compose_summary`) — emit pattern delta після write_episode.
  - `src/backend/agent/planner/strategic.py:77-85` — recall patterns поряд з episodes; `format_episodes_for_prompt` extend "proven_patterns: [tool_a→tool_b, success_rate=0.9]".
  - `src/backend/agent/self_model.py:65-115` — `recent_successes` бо FIFO 5 → bounded set keyed by pattern_id.
- **Залежить:** Phase 22 (кращий distill model).
- **Тест:** прогнати 5 однотипних задач (всі succeed) → перевірити що `agent_trajectory_patterns` має row з success_count=5 → 6-та задача отримує prompted hint від recall.
- **Чому це поза Claude Code:** Claude Code забуває кожну сесію. PHANTOM **вчиться своїх стратегій і перестає повторювати помилки через тижні**.

### Phase 26 — Continuous Screen Monitor + Usage-Pattern Triggers [L]
**Що:** PHANTOM проактивно пропонує CustomAgents з спостерігаючи звички.
- **Нові:**
  - `src/backend/vision/screen_monitor.py` (~400 LOC) — async loop @ 2-5Hz, perceptual-hash dedup, ROI diff detection, AT-SPI window tracking.
  - `src/backend/vision/window_classifier.py` — групує "схожі вікна" через ph-hash threshold + window title fingerprint.
  - `src/backend/agent/standing_orders/usage_patterns.py` — n-of-m window matcher ("login 3+ за останні 7 днів").
- **Модифіковані:**
  - `src/backend/agent/standing_orders/conditions.py` (~30) — додати `usage_pattern` condition kind.
  - `src/backend/agent/standing_orders/runner.py` — eval new condition.
  - `src/backend/ai/chat_tools.py` — додати tool `propose_agent_from_pattern` (14-й studio tool).
- **Залежить:** Phase 25 (patterns — substrate для usage detection).
- **Тест:** open Login dialog 3 рази за день → standing_order fires → PHANTOM в чаті: "помітив, відкривав логін 3 рази; створити агента що автоматизує?".
- **Чому це поза Claude Code:** Claude Code чекає коли його викликають. PHANTOM **проактивний і ambient** — пропонує автоматизації з реальної роботи, не з prompt'ів.

### Phase 27 — Phase 20 Peer Mesh Bootstrap [L]
**Що:** Дві PHANTOM в LAN бачать один одного, обмінюються heartbeat + capability digest.
- **Нові:**
  - `src/backend/mesh/__init__.py`, `src/backend/mesh/discovery.py` (mDNS / Zeroconf, service `_phantom-mesh._tcp`).
  - `src/backend/mesh/peer_protocol.py` (~300 LOC) — Ed25519-signed envelope, **reuse mobile pairing primitives з `security/pair_crypto.py`** (вже існує).
  - `src/backend/mesh/registry.py` — peer table + trust ledger.
  - `src/backend/api/mesh_ws.py` — peer-to-peer WS endpoint.
- **Модифіковані:**
  - `src/backend/main.py` (lifespan) — start/stop mDNS browser.
  - `src/backend/security/keys.py` — node-level Ed25519 (per-host, не per-user).
- **Залежить:** Phase 24 (signing infrastructure).
- **Тест:** 2 PHANTOM на LAN → /api/v1/mesh/peers повертає один одного через 5s.
- **Чому це поза Claude Code:** Claude Code = 1:1 user-LLM. PHANTOM стає **peer-aware node** — передумова всього в Horizon 3.

### Phase 28 — Self-Critique Loop on Trajectories ("Ralph Mode") [L]
**Що:** У DREAM state PHANTOM replay'ує failed episodes проти свого новішого self і patch'ить власні playbooks.
- **Нові:**
  - `src/backend/agent/orchestrator/self_critique.py` — re-runs failed task summaries through current Council.
  - `src/backend/agent/dream/replay.py` — DREAM-state hook що picks 1-3 recent failures.
- **Модифіковані:**
  - `src/backend/core/state_machine.py` — DREAM hook event.
  - `src/backend/agent/orchestrator/quality_gate.py` — verdicts feed playbook deltas back до SelfModel.
  - `src/backend/memory/user_model.py` — `behavioral_model.lessons_learned: list[str]`.
- **Залежить:** Phases 23, 25.
- **Тест:** force a task failure → wait for DREAM transition → перевірити SelfModel.lessons_learned оновлено.
- **Чому це поза Claude Code:** Claude Code не **переписує власні priors**. PHANTOM робить це уві сні.

---

## HORIZON 3 — Emergent properties (2–3 місяці)

### Phase 29 — Peer-Cognition Task Handoff [XL]
Task мігрує до peer PHANTOM з кращим model / спецспеціалізацією.
- **Нові:** `mesh/task_handoff.py`, `mesh/capability_match.py`, `mesh/trust_ledger.py`.
- **Модифіковані:** `agent/runtime.py:463/770` (TaskState serialize for migration), `agent/orchestrator/council.py` (cross-peer Council vote — peer roles join quorum).
- **Залежить:** 25, 27.

### Phase 30 — Васі-агенти Marketplace [L]
Operator publishes CustomAgent → інший PHANTOM imports under approval.
- **Нові:** `marketplace/manifest.py`, `marketplace/signer.py`, `marketplace/sandbox.py` (capability-scoped install), `api/marketplace.py`.
- **Модифіковані:** `ai/chat_tools.py` (`publish_agent`, `install_peer_agent` — 15-16-й tools), studio UI.
- **Залежить:** 27, 29.

### Phase 31 — Predictive Presence (FSM-aware anticipation) [L]
PHANTOM передбачає наступний FSM transition і pre-warm'ить артефакти (Familiar pose, drafts, Council pre-votes).
- **Нові:** `core/presence_predictor.py` (Markov + trajectory-pattern fusion), `core/precompute_queue.py`.
- **Модифіковані:** `state_machine.py`, `context_engine.py`, Familiar 3D bridge.
- **Залежить:** 25, 26.

### Phase 32 — Embodied Council (voice + Familiar + mobile quorum) [XL]
Council debate розгортається через колонки (TTS persona per role), Familiar gestures, phone — quorum requires multi-surface acknowledgement.
- **Модифіковані:** `voice/tts.py` (per-role voice), `vision/oled_animator.py` + 3D rig, mobile approve flow, `orchestrator/council.py` (surface-bound votes).
- **Залежить:** 23, 24, 29.
- **Чому це поза Claude Code:** Claude Code живе в терміналі. PHANTOM debates **у твоїй кімнаті**, з тілом, голосом, телефоном. Категорично інший артефакт.

---

## Перший PR який варто стартувати — **Phase 22**

**Причина:** unblock'ує все наступне (23, 25, 28 виграють від кращої моделі); найменша поверхня (3 callers + `TaskState.model_config`); strictly additive за feature flag; найбільший immediate operator-visible win — Claude Opus для коду, Gemini Flash для chat banter, Ollama для offline standing orders.

Concretely: ~600 LOC за half-day review. Add `anthropic_provider.py`, thread `model_hint: str | None` через `provider.py:136,281,397`, store на `TaskState`, expose в studio UI + chat tool `studio_set_model_hint(agent_id, contexts: dict)`.

---

## Verification end-to-end (мета-план)

Після ВСІХ Horizon 1 phase:
1. `pytest src/backend/tests/test_phase22*.py -v` — multi-provider unit + integration.
2. `pytest src/backend/tests/test_phase23_devils_advocate.py -v` — Council force-objection.
3. `pytest src/backend/tests/test_phase24_mobile_fusion.py -v` — mobile sensors у snapshot.
4. Manual smoke: запустити PHANTOM, dispatch task з goal "напиши Python скрипт який…", перевірити WS events `quality_gate.regenerated` для code path та council.role_spoke з role=devils_advocate.
5. CI gate: `pytest -m offline` continues to pass — кожен новий provider має deterministic fallback.

Після Horizon 2:
- 5 однотипних задач → trajectory patterns extracted; 6-та задача отримує hint.
- 2 PHANTOM на LAN бачать один одного.
- Symptom test: відкрити дialog 3+ рази за день → проактивна пропозиція агента у чаті.

---

## Operator notes / коментарі від мене (Claude)

**Чому такий пріоритет:**
- Phase 22 (Claude API) — найшвидший reality check чи "PHANTOM сильніший за Claude Code". До нього ти буквально граєш слабшою моделлю; після — змагання чесне.
- Phase 23 (Devil's Advocate) — 100 LOC роботи, ефект — Council перестає бути декоративним, починає реально blocker'ити shipping.
- Phase 25 (Trajectory) — це те що **PHANTOM має, Claude Code ніколи не матиме без серверного state**. Найвища стратегічна ROI.
- Phase 27 (Mesh) — це twist з Claude Code не змагається взагалі. Тут "пара PHANTOM = розумніша за один" стає реальністю.

**Ризики/застереження:**
- Phase 22 не = "просто додай провайдер". Ollama tool-calling шорт-circuit'и спрацьовують навіть на Anthropic — треба `_classify_anthropic_error` повноцінний (NETWORK / TIMEOUT / RATE_LIMIT / QUOTA / INVALID_API_KEY).
- Phase 25 пожере багато LLM calls на distill (DREAM nightly). Без feature flag можеш втратити 50% денного quota Gemini.
- Phase 27 (Mesh) — обережно з security. mDNS broadcast'ить service на network; якщо unsigned — host injection risk. Reuse `pair_crypto.py` обов'язковий.
- Phase 32 (Embodied Council) — це найдовший термін. Якщо комусь скажеш "PHANTOM розумніший за Claude Code", саме на цей phase покажи.

**Що я НЕ заплановував:**
- Phase 19 mobile Android Compose app — окремий sprint, треба emulator. Не залежить від cognitive contour.
- Real-time policy network для action games — рисіalable з research perspective, але не unlock'ує "поза Claude Code". Низький пріоритет.
- Voice cloning — operator явно сказав out of scope.

**Питання що залишилось мені:**
- Чи хочеш ти платити за Anthropic API ключ для Phase 22? Без нього план виходить на GPT-only або тільки local.
- Чи готовий до Trajectory Patterns DB schema migration (Phase 25)? Зачищення старих episodes можливо.
- Чи це OK що Phase 27 Mesh require'ить open mDNS на LAN? У "офіс/дім/лабораторія" сценарію OK; у студентському гуртожитку — security concern.

**Якщо обмежені 1 тиждень:** Phase 22 + 23 + 24 — все три H1, ~1500 LOC, transformative effect.
**Якщо обмежені 1 день:** Phase 23 (Devil's Advocate, 100 LOC) — конкретно видимий effect у Council.

---

*Сесія завершена 2026-05-03 04:30. Continue from `autonomous-run` HEAD.*
