# PHANTOM Agent — Roadmap Phase 16 → 22

> Перевершити Claude Code / Claude Cowork. Агент як мега-команда яка не ламається офлайн і виконує задачі будь-якого масштабу (від email до мегаполісу в Blender).

## Context — навіщо це все

**Біль (з останнього прогону погоди):** агент завершив 4 під-цілі, але користувач не побачив звіту, його викинуло на головне меню, історії немає, продовжити неможливо. Більший біль: **немає керованості живого агента** — план immutable, multi-agent тільки в коді (orchestrator hardcoded на `single`), редагувати на льоту не можна, parallel-K не активований.

**Мета на горизонті 12-18 тижнів:** PHANTOM Agent рівня "віртуальна команда" — кілька агентів-перспектив, виживання при офлайн-нейронці, контроль будь-якого застосунку через screen+xdotool+atspi, делегування на інші пристрої, повноекранна драматургія процесу прийняття рішень.

**Що вже є під капотом** (НЕ переписувати):
- `src/backend/agent/loop.py` (746 LOC) — ReAct + Reflect + Checkpoint, repeat-action detection, 3-strike abandonment
- `src/backend/agent/schemas.py` — `SubGoal`, `InnerMonologue`, `PlanStep`, `Observation`, `ReflectionResult`, `ThoughtBudget`
- `src/backend/agent/runtime.py:789-950` — `finalize_task()` дзвонить `_finalize_persist` + `_finalize_broadcast` + `_finalize_release_slot`
- `src/backend/agent/audit.py`, `src/backend/agent/memory/seeds.py` — SQL audit + ChromaDB epizodes + `compose_summary()`
- `src/backend/ai/provider.py` — Gemini→Ollama fallback + `BlockedQuotaError` recovery
- `src/backend/agent/actions/registry.py` — FsRead/Write, BashRun, BrowserNavigate/Click/Extract, NetScan, ProcessList, NotifyDesktop, TimeWait, SelfCapability, SelfRecall, WebSearch
- `src/backend/agent/actions/browser.py` + `src/backend/vision/grounding.py` (DomAccessibilityParser + OmniParserV2)
- `src/backend/ai/agents/orchestrator.py` — scaffold for parallel-K, hardcoded `single` (X-3 placeholder)
- `src/backend/api/routes_agent.py` — pause/resume/intervene/cancel/checkpoint endpoints
- `src/frontend/src/components/agent/` — PlanTree, AgentTimeline, DecisionCard, GoalInput, ControlsBar, EmotionIndicator, ThoughtBudget, LLMCallBudget, InnerMonologueStream
- `src/frontend/src/stores/agentStore.ts` — currentTask, subGoals, recentActions, reflections, observations, emotion, quotaBackoff, lastCheckpoint
- `src/frontend/src/services/websocket.ts` + `agentApi.ts` — WS channels + REST для checkpoint/resume/list

---

## Глобальні архітектурні принципи (тримати по всіх фазах)

### П-1: Резистентність до офлайн-нейронки
Жодна фаза не вводить feature, що **повністю** залежить від онлайн LLM. Кожна нова дія, парсер, оркестратор має deterministic fallback path (template, rule-based, cached strategy). При `BlockedQuotaError`:
- агент НЕ зупиняється — переходить в "skeletal mode": продовжує виконувати завдання з кешованих стратегій + локальних шаблонів
- multi-agent fan-out → fall back to sequential single-agent з notification
- summary/report generation → deterministic stub з audit log (pretty format), не LLM-prose

### П-2: Drama as a feature (видимий процес)
Думання, дебати, помилки — НЕ ховаємо. Кожна нова FE-панель показує "що відбувається зараз" в живому темпі. Це і є відмінність від Claude Code де процес прихований за progress bar.

### П-3: Команда перспектив, не один агент
Multi-agent — це 3-7 агентів які дивляться на задачу з РІЗНИХ сторін (Planner, Critic, Executor, Researcher, Risk-Assessor, Aesthete, Skeptic). Не parallel workers — **adversarial collaboration**. Раунд: кожен говорить → консенсус через Critic → дія. Завжди ≥1 агент перевіряє роботу інших.

### П-4: Реверсивність + audit trail
Кожна руйнівна дія (file delete, system command, screen click, ESP32 actuator) — записує перед-стан + має undo path або явну згоду користувача. Audit trail обов'язковий для всіх phase 18-20 додавань.

### П-5: 1024×600 + touch + Familiar
Все на головному екрані PHANTOM. Жодна фаза НЕ вводить scroll на головному агентському екрані. Familiar 3D реагує на агента (хвилюється при ризику, радіє при успіху, дивиться на активний sub-goal).

---

## Phase 16 — Result Surfacing (1 тиждень) [foundational] ✅ SHIPPED 2026-05-02

**Статус:** реалізовано і верифіковано. Backend (`agent/reports.py`, `runtime.acknowledge_report`, нові 3 route-и) + Frontend (`AgentReportScreen`, `AgentSessionHistory`, `AgentSessionDetail`, store wiring, FloatingToolbar entry) — все на місці. tsc clean, deterministic offline-path працює end-to-end на синтетичній задачі. **Continue Phase 17.**

**Мета:** усунути "не бачу звіту, кинуло в меню" + перегляд історії + resume past sessions як conversation.

### Backend

**Файли до зміни:**
- `src/backend/agent/runtime.py:836-950` — `finalize_task()` НЕ дзвонить `state_machine.exit_operator()` автоматично. Замість того викликає `await runtime._broadcast("task.report_ready", {...})`. Exit OPERATOR state тільки після того як FE підтвердив `agent.report_acknowledged` через WS або `POST /api/v1/agent/tasks/{id}/dismiss-report`.
- `src/backend/agent/memory/seeds.py:24-79` — розширити `compose_summary()`: окрім short summary додати структуровані секції `achievements`, `obstacles`, `key_decisions`, `next_steps`, `evidence_links`. Зберігати в `AgentMemorySeed.payload` як JSON.
- `src/backend/agent/reports.py` (новий, ~300 LOC) — `ReportComposer` клас: бере `AgentTask` + `AgentAuditEntry[]` + `Observation[]` + `ReflectionResult[]` → структурований `TaskReport` об'єкт. Має 2 стратегії: LLM-narrative + deterministic-fallback (П-1).
- `src/backend/api/routes_agent.py` — додати:
  - `GET /api/v1/agent/tasks/{id}/report` → `TaskReport` (composes on demand if not cached)
  - `POST /api/v1/agent/tasks/{id}/dismiss-report` → triggers exit_operator
  - `POST /api/v1/agent/tasks/{id}/resume-as-conversation` → створює нову chat-сесію seeded з `TaskReport.summary` + `final_state` + `subgoals` як context

**Schemas:**
- `src/shared/types/agent.ts` + `src/backend/agent/schemas.py` — `TaskReport`: `task_id, goal, status, duration_ms, achievements[], obstacles[], key_decisions[], next_steps[], evidence_links[], audit_trail_compact[], llm_narrative?, generated_at, generation_strategy`

### Frontend

**Файли до зміни / створити:**
- `src/frontend/src/components/agent/AgentReportScreen.tsx` (новий, ~500 LOC) — повноекранна модалка (z-60 над OperatorLayout). Секції:
  - Hero: `goal` + статус-pill + duration + Familiar pose "presenting"
  - Achievements (зелені картки з emoji + 1 рядок кожна)
  - Obstacles (бронзові картки якщо були)
  - Key Decisions (DecisionCard reused, з confidence/objection)
  - Next Steps (suggestions, кожна — кнопка "Запустити нове завдання з цього")
  - CTA bar: `[Продовжити як розмову]` `[Зберегти в нотатки]` `[Закрити]`
- `src/frontend/src/components/agent/AgentSessionHistory.tsx` (новий, ~400 LOC) — список минулих task. Фільтри: status (done/failed/stopped), track (foreground/background), date range. Кожен item: goal, summary excerpt, timestamp, status pill, duration, action count. Tap → `AgentSessionDetail`.
- `src/frontend/src/components/agent/AgentSessionDetail.tsx` (новий, ~350 LOC) — повна історія одного run. Вкладки: Report | Timeline | Decisions | Audit. Кнопка `[Resume from this point]` (per-checkpoint) + `[Continue as conversation]`.
- `src/frontend/src/stores/agentStore.ts` — додати `reportPending: TaskReport | null`, `reportDismissed: boolean`, `historyTasks: TaskMeta[]`, `loadHistory()`, `acknowledgeReport()`. На WS `task.report_ready` → set `reportPending`, НЕ закриваємо OperatorLayout.
- `src/frontend/src/layouts/OperatorLayout.tsx` — підключити `<AgentReportScreen>` коли `reportPending !== null`. На `acknowledgeReport()` чи `resume-as-conversation` шле відповідний API call і робить layout swap у DialogueLayout зі seed-контекстом.
- `src/frontend/src/components/core/FloatingToolbar.tsx` — додати "Історія агента" кнопку → opens `AgentSessionHistory` як ToolsOverlay-style overlay.

### Verify (Phase 16)
1. Прогнати агент із 3-крокової задачі. Очікуваний результат: `AgentReportScreen` показується, не зникає поки не натиснути CTA. Stays on OPERATOR layout.
2. Натиснути "Продовжити як розмову" → перемикання в DialogueLayout, перше повідомлення від AI seed-ить контекст звіту, чат живий.
3. Закрити звіт через `[Закрити]` → exit OPERATOR → попередній layout. Перевірити DB: `AgentTask.status='done'`, `AgentMemorySeed` має structured payload, ChromaDB має episode.
4. Відкрити "Історія агента" → побачити прогін, відкрити detail, перейти в Resume → новий task seeded з checkpoint починається.
5. **Offline test (П-1):** заглушити Gemini + Ollama → запустити task → `compose_summary()` падає на deterministic stub, але звіт ВСЕ ОДНО показується з audit-derived bullets.

---

## Phase 17 — Live Controllability + Multi-Agent Team + Agent Studio (3 тижні) [TOP PRIORITY] ✅ SHIPPED 2026-05-02

**Статус:** Phase 17 ядро + Phase 17b Studio + auto-Council у loop.py + standing-orders × CustomAgent інтеграція — все на місці. Backend smoke 7/7. Frontend tsc clean. Continue Phase 18.

### Доповнення scope (на основі повторного інтерв'ю з користувачем)

**Quality bar (нова північна зірка):**
- Агент має **доводити до кінцевого результату** (як зараз не робить жодна нейронка): шукати в інтернеті ретельно поки не знайде найкраще рішення → стискати вже наявну інфу → адаптуватися до помилок → перед написанням коду/документу запитувати у своїх агентів-партнерів чи все правильно і не спричинить помилку → перевіряти → впевнюватись → виправляти → команда як одне ціле.
- Цей bar — частина quality-gate Council loop (далі).

**Гнучкий запит даних у користувача (Information-Need Resolution):**
- Якщо агент потребує ввід — ставить питання в **типізованому форматі**: text / single-choice / multi-choice / file-pick / range / confirm.
- На FE — багате відображення: choice-картки з прев'ю (як AskUserQuestion але красивіше), мультивибір з тегами, file-picker з drag&drop, range-slider, yes/no з контекстом.
- Питання НЕ тільки текст — можуть мати **візуальні підказки** (мініатюри, ілюстрації, приклади, пояснення під опціями).
- Агент може ескалувати: спочатку шукає сам в інтернеті → якщо неоднозначно → формує опції → питає → одержує відповідь → продовжує. Так само на критичних рішеннях.

### Phase 17a — Council + Live Plan Editor (як було)

**Мета:** агент = команда перспектив. Користувач редагує план на льоту. Декілька агентів-ролей дискутують і вирішують разом. Кожен бачить кожного.

### Backend — Multi-Agent Team

**Архітектурний зсув:** `agent/orchestrator/` стає повноцінним пакетом, не файлом. Введемо концепцію `Council` — набір з 3-7 `AgentRole` що дискутують у раундах.

**Файли:**
- `src/backend/agent/orchestrator/council.py` (новий, ~400 LOC) — `Council` клас:
  - `roles: dict[RoleName, AgentRole]`
  - `run_round(situation: CouncilSituation) -> CouncilDecision`
  - Раунд: paralel `role.deliberate()` → Critic challenges → revisions → Moderator picks consensus
  - Ролі: `Planner`, `Critic`, `Executor`, `Researcher`, `RiskAssessor`, `Aesthete` (UI/візуальні задачі), `Skeptic`
- `src/backend/agent/orchestrator/role.py` (новий, ~250 LOC) — `AgentRole` базовий клас з prompts per role, `deliberate(situation) -> RoleStatement`
- `src/backend/agent/orchestrator/modes.py` (новий, ~150 LOC) — `OrchestratorMode`: `Single`, `Council`, `Swarm` (parallel-K сильно відрізняється: незалежні task branches що merge в кінці)
- `src/backend/agent/loop.py` — інтегрувати: при критичних рішеннях (`revise_strategy`, перед руйнівною дією, при невпевненості <0.6) → виклик `Council.run_round()` замість одного LLM call
- `src/backend/ai/agents/orchestrator.py:42-69` — розблокувати logic, обрати mode на основі: complexity score + user setting + risk level

### Backend — Live Plan Editor

**Файли:**
- `src/backend/api/routes_agent.py` — додати:
  - `PATCH /api/v1/agent/tasks/{id}/plan` body: `{ subgoals_diff: SubGoalDiff[] }` — applies edit, потребує `task.status='paused'` (auto-pause if running)
  - `POST /api/v1/agent/tasks/{id}/inject-subgoal` body: `{ description, position, rationale }` — додає на льоту
  - `DELETE /api/v1/agent/tasks/{id}/subgoals/{sgid}` — видаляє/skip
- `src/backend/agent/runtime.py` — `apply_plan_diff(state, diff)` метод, audit-trail кожну зміну, broadcast `plan.user_edited` WS event
- `src/backend/agent/loop.py:307+` — після кожної ітерації перевіряти `state.plan_dirty` flag → re-evaluate стратегію

### Frontend — Multi-Agent UI + Plan Editor

**Файли:**
- `src/frontend/src/components/agent/CouncilStage.tsx` (новий, ~600 LOC) — головна нова панель. Шахівниця 2×3 або 3×3 ролей. Кожна роль:
  - Картка з аватаром (procedural SVG генеровані per role + emotion морф)
  - Поточне висловлювання (typewriter animation)
  - Статус-pill (думає / висловився / погоджується / заперечує)
  - Confidence bar
  - Animation: коли роль виступає — її картка піднімається + glow; коли заперечує іншій — стрілка зв'язку blink
- `src/frontend/src/components/agent/CouncilTimeline.tsx` (~200 LOC) — таймлайн раундів дебатів (round 1 → consensus / round 2 / final decision)
- `src/frontend/src/components/agent/PlanEditor.tsx` (новий, ~450 LOC) — modal над PlanTree. Drag-handle для reorder, inline edit text, [+] між sub-goals, swipe-left для delete. Зміни накопичуються як diff, save → PATCH → resume.
- `src/frontend/src/components/agent/AgentInjectSubgoal.tsx` (~200 LOC) — швидка форма "Додай під-ціль:" + pin position picker.
- `src/frontend/src/components/agent/PlanTree.tsx` — додати mode `editable` коли `task.status=paused` AND user role має дозвіл; long-press на sub-goal → action sheet (edit / inject after / delete / skip).
- `src/frontend/src/layouts/OperatorLayout.tsx` — нова tab/mode: `Single` (поточний) | `Council` (CouncilStage займає головну зону, PlanTree збоку як rail) | `Swarm` (placeholder Phase 17.b).
- `src/frontend/src/stores/agentStore.ts` — `councilState: CouncilSnapshot | null`, `roleStatements: RoleStatement[]`, `editingPlan: PlanDiff | null`.

### Phase 17a.5 — Information-Need Resolution

**Backend:**
- `src/backend/agent/needs.py` (новий, ~300 LOC) — `InfoNeed` модель: `kind` (text/single_choice/multi_choice/file_pick/range/confirm/visual_pick), `question`, `options[]` (з label, description, preview_url, example), `default`, `required`, `hints[]`. Resolver: try web-search → cache hit → ask-user fallback hierarchy.
- `src/backend/agent/actions/ask_user.py` (новий, ~200 LOC) — `AskUser` action class. Pause-task while awaiting → emit `agent.info_need` WS event → wait for `POST /agent/task/{id}/info-response` → unblock.
- `src/backend/agent/actions/research.py` (новий, ~250 LOC) — `WebResearch` action: multi-query iterative search, dedup, rank, summarize. Stops only when (a) found ≥3 corroborating sources OR (b) iteration cap reached (default 8) → returns synthesized digest. Plug-in to web.search action.

**Frontend:**
- `src/frontend/src/components/agent/InfoNeedDialog.tsx` (новий, ~500 LOC) — variant dialog renderer:
  - text → big textarea
  - single_choice / multi_choice → grid of cards з preview-image-сlot + description; touch-targets ≥ 88×88
  - file_pick → drag&drop + browser
  - range → slider з live preview
  - confirm → big yes/no with explanation panel
  - visual_pick → image grid (для UI-related goals)
- agentStore handler для `agent.info_need` event → set `currentInfoNeed`. Submit response через `respondToInfoNeed(answer)`.

### Phase 17a.6 — Quality Gate Loop (доводити до кінцевого результату)

**Backend:**
- `src/backend/agent/orchestrator/quality_gate.py` (новий, ~350 LOC) — wraps non-trivial outputs (code, document, plan, message-to-third-party) before they leave the agent:
  1. Producer agent generates draft.
  2. `Critic.review(draft, context)` — looks for: missing edge cases, factual errors, will-this-break-something, scope creep, incomplete coverage of acceptance criteria.
  3. If critic raises ≥1 blocker → producer revises → loop (max 3 cycles to avoid infinite revisions).
  4. `Verifier.confirm(final, original_intent)` — last-mile sanity check.
  5. Only after gate passes → emit output as observation / write to file / send.
- Loop integrated into `Council.run_round()` for "execute" decisions.

**Resilience (П-1 у Phase 17):**
- Council offline → fallback to **deterministic Council**: 3 hardcoded persona templates з rule-based "objection" логікою (наприклад RiskAssessor blacklist patterns, Critic checks expected_actions ≥ 1 і criteria measurable). Дебати все одно показуються в UI як "skeleton mode" з visual indicator "🜂 Council working from cache".
- Quality Gate offline → simplified deterministic checks (regex-based syntax check for code, link validation for documents, etc.).
- Plan edit + InfoNeed UI — повністю детерміністичні, не залежать від LLM.

### Phase 17b — Agent Studio (картки-агенти / "Васі-агенти")

**Мета:** користувач створює, налаштовує, зберігає, запускає **окремих автономних агентів** — наприклад "агент Васі" що щодня аналізує дані, звіряє з іншими джерелами, шукає в інтернеті, сортує файли, формує звіти і розсилає різним адресатам. Агент зберігається разово, потім запускається кнопкою або по розкладу. Користувач може просто розмовляти з PHANTOM ("створи мені агента що…") і він професійно проведе крізь конфігурацію.

#### Концептуальна модель

- **CustomAgent** — іменований персистентний агент з:
  - `name`, `description`, `avatar_url|emoji`, `owner_user_id`
  - `goal_template` — параметризований шаблон цілі (Jinja-like змінні: `{{date}}`, `{{user.name}}`, `{{custom.field_x}}`)
  - `cards: AgentCard[]` — конструктор з карток (див. нижче)
  - `inputs_schema: InfoNeedSpec[]` — які дані запитати при запуску (run-time, перевикористовує Phase 17a.5)
  - `recipients: Recipient[]` — кому надсилати результати (email / Telegram / SMS / file save / chat-self)
  - `schedule: Schedule | null` — null = manual, або cron / interval / conditional
  - `tags: string[]`, `created_at`, `updated_at`, `last_run_at`, `run_count`, `success_rate`

- **AgentCard** — лего-блок поведінки. Картки склеюються в DAG / ланцюг. Типи карток:
  - **Source cards**: `WebSearchCard`, `RSSCard`, `EmailInboxCard`, `FileWatchCard`, `APIPollCard`, `DBQueryCard`, `MobileSensorCard`
  - **Transform cards**: `SummarizeCard`, `CompareCard`, `FilterCard`, `SortCard`, `ExtractCard`, `DiffCard`, `ScoreCard`
  - **Decision cards**: `IfCard`, `BranchCard`, `LoopCard`, `RetryCard`, `AskUserCard` (інлайн info-need)
  - **Output cards**: `WriteFileCard`, `SendEmailCard`, `SendTelegramCard`, `PostToAPICard`, `CreateReportCard`, `NotifyCard`
  - **Council cards**: `ReviewByCouncilCard` (вмонтовує quality gate всередину flow)

- **AgentSwarm** — кілька CustomAgents склеєних в одне завдання (наприклад "Дослідник + Аналітик + Письменник + Редактор" → послідовно або паралельно). Опціонально, на пізніший етап Phase 17b.2.

#### Backend

- `src/backend/agent/studio/` (новий пакет):
  - `models.py` — Pydantic shapes (`CustomAgent`, `AgentCard`, `CardKind`, `CardLink`, `Recipient`, `RunSpec`)
  - `repository.py` — CRUD (SQL: `custom_agents`, `agent_cards`, `agent_runs` tables)
  - `compiler.py` — `compile(agent: CustomAgent, run_inputs: dict) -> ExecutionPlan` — перетворює DAG карток у послідовність sub-goals + actions для loop.py
  - `runner.py` — `run_custom_agent(agent_id, inputs)` — створює task через `agent_runtime.start_task`, з префіксом `[custom:{agent.name}]` + carries metadata so reports tag run history per agent
  - `cards/` — implementation для кожної AgentCard (дублюється з core actions але з friendlier signature)
  - `validate.py` — pre-flight: чи всі обов'язкові поля заповнені, чи рецепієнти існують, чи schedule валідний
- `src/backend/api/routes_studio.py` (новий, ~500 LOC):
  - `GET/POST /api/v1/studio/agents` — список + створення
  - `GET/PATCH/DELETE /api/v1/studio/agents/{id}` — детальний CRUD
  - `POST /api/v1/studio/agents/{id}/run` — запустити з опційним `inputs: dict`
  - `POST /api/v1/studio/agents/{id}/runs` — список минулих прогонів
  - `POST /api/v1/studio/agents/{id}/clone` — клонувати як шаблон
  - `GET /api/v1/studio/cards/catalog` — публічний catalog усіх типів карток для FE-конструктора
- `src/backend/agent/standing_orders` — extended: `kind: "custom_agent"` schedule entry → fires `run_custom_agent` instead of plain `start_task`.
- `src/backend/db/models.py` + `migrations/` — нові таблиці.

#### Conversational Agent Builder (зробити агента в розмові)

PHANTOM знає що CustomAgent існують. Якщо користувач каже "створи мені агента, що…" → активується `chat.tool_dispatcher` → запускається спеціальний `BuilderSession`:

- **Tool**: `studio.start_builder(initial_intent: str)` — запускає інтерв'ю.
- **Інтерв'ю**: BuilderSession проходить кроки (валідуючи кожен): name → description → goal_template → джерела даних (вибрати з catalog) → трансформації → отримувачі → schedule → preview → save. Кожен крок використовує InfoNeedDialog (Phase 17a.5) з візуальними підказками.
- **Auto-suggest**: на кожному кроці білдер пропонує 2-3 варіанти на основі попередніх відповідей (LLM-generated, з deterministic fallback templates).
- **Live preview**: під час налаштування FE показує "як це буде виглядати": граф карток (`AgentCardGraph`), приклад голу, mock-результат на seed-даних.
- Завершення → `repository.save(agent)` → user одержує link "Запустити зараз" / "Розклад / Налаштування".

#### Frontend — Agent Studio UI

- `src/frontend/src/components/studio/` (новий, 8-12 файлів):
  - `AgentLibrary.tsx` — список усіх збережених агентів. Картки з аватарами, last-run-at, success-rate, кнопки "Запустити" / "Редагувати" / "Клонувати" / "Видалити".
  - `AgentBuilder.tsx` — повний редактор. Layout: ліва панель (catalog карток згрупований по типу), центральне полотно (graph editor: drag-drop, з'єднання, reorder), права панель (properties того що виділено).
  - `AgentCardGraph.tsx` — візуальний граф (хедерний layout, зрозуміло без зум-палу). Картки скрізь touch-friendly. Кнопка [+] між картками для вставки.
  - `AgentCardPalette.tsx` — categorical browser, з пошуком + drag-handles.
  - `AgentCardInspector.tsx` — properties панель (input fields, recipients picker, validators).
  - `AgentRunDialog.tsx` — перед запуском: підтягує `inputs_schema`, рендерить через InfoNeedDialog flow, тоді fires.
  - `AgentRunHistory.tsx` — фільтрована per-agent історія runs (re-uses Phase 16 AgentSessionHistory pattern).
  - `AgentSwarmComposer.tsx` (Phase 17b.2 опц.) — agent-of-agents склеювання.
- `src/frontend/src/stores/studioStore.ts` (новий) — Zustand: `agents`, `currentBuilder`, `loadAgents`, `saveAgent`, `runAgent`, `selectedCardId`.
- Інтеграція в FloatingToolbar More-menu: нова кнопка "Studio" → відкриває `AgentLibrary`.
- Для in-chat creation: ChatWindow ловить tool-result з `studio.builder_step` → рендерить inline `BuilderStepCard` зі стейтом і CTA.

#### Verify (Phase 17b)

1. Створити агента "Денний звіт по погоді" в Studio: WebSearchCard("погода {{city}}") → SummarizeCard → CreateReportCard → SendTelegramCard. Inputs: `city`. Schedule: щодня 08:00.
2. Запустити вручну з `city=Київ` → AgentRunDialog показує форму → submit → побачити Phase 16 ReportScreen зі звітом, теги `[custom:Денний звіт по погоді]`.
3. У чаті сказати: "Створи мені агента, який щотижня перевіряє нові випуски Vue.js і складає коротку зведенку". PHANTOM запускає BuilderSession → проводить через інтерв'ю → агент зберігається.
4. Виявити агента в AgentLibrary, відредагувати recipients, зберегти.
5. Покласти Gemini+Ollama → AgentLibrary працює (CRUD), Builder працює в "deterministic mode" (без auto-suggest), вже-створений агент може запуститися (його cards мають deterministic паралельні шляхи).

### Verify (Phase 17 цілком)
1. Запустити task з high complexity goal ("спроектуй для мене persistence layer на ChromaDB"). Очікувати: orchestrator вибирає Council, CouncilStage показує 5 ролей дискусують, consensus → дія. Quality Gate перевіряє output → revisions → final.
2. На паузі: відкрити PlanEditor, переставити sub-goals, видалити один, додати новий. Save → resume. Агент продовжує по новому плану. Audit log містить `plan.user_edited` entry.
3. Inject під-ціль під час running task ("і ще додай тести після"). Агент паузиться, інжектить, продовжує.
4. Агент зустрічає неоднозначність → ставить InfoNeed (multi_choice з прев'ю) → користувач обирає → агент продовжує.
5. Створити CustomAgent в Studio + через чат → запустити → одержати звіт + надіслане Telegram повідомлення.
6. **Offline test:** Gemini timeout → Ollama timeout → Council Stage показує deterministic personas, дискусія йде по template, Quality Gate перевіряє через rule-based, рішення приймається. CustomAgent runs з deterministic-only cards.

---

## Phase 18 — Universal Device Control (3 тижні) ✅ SHIPPED 2026-05-03

**Статус:** Backbone shipped. ScreenCapture (mss/grim/scrot/import cascade), ScreenOCR (pytesseract), DesktopController (xdotool/ydotool/wtype) і ESP32 actuator stubs готові. 11 нових actions у registry (включно з BlenderRun + GameInputBurst). AgentVisionPanel ("очі агента") з live screenshot + OCR overlay змонтований у App.tsx, кнопка "Очі" у FloatingToolbar.

### Phase 18-COMPLETE — наступний імплементаційний тікет (2026-05-03)

**Контекст:** Phase 18 backbone закритий 6 коммітами (12334a8 last). Залишається 4 шматки що перетворюють агента з "клацає по екрану" в "повноцінно бачить, реагує і витримує годинні задачі":

1. **AT-SPI bridge** — semantic UI без OCR (швидше + надійніше для GTK/Qt/Electron native). Зараз `screen.click(x,y)` промахується якщо вікно змістилось між capture і click; AT-SPI дає `find_button("Save") → bbox` за <50ms і одразу повертає stable координати.
2. **LongRunningTaskCard + checkpoint UI** — Blender-задачі "побудуй мегаполіс" виходять на 30+ хв; зараз вони висять на foreground track і UI каже "agent thinking" замість показати progress.
3. **FamiliarReactor** — Familiar 3D реагує на screen-події агента (хвилюється на ризикових діях, дивиться на курсор). Без цього "очі агента" — мертвий debug-overlay, а не драма (П-2).
4. **ESP32 actuator wires** — `cs.send_haptic / send_rgb / send_oled_text` зараз stubs (`hasattr` повертає False, action повертає "API not wired"). Треба docked поверх існуючого `command_sender.haptic / rgb / oled_text`.

**Критичні файли (read-before-edit):**
- `src/backend/agent/actions/device.py` — ESP32Haptic/RGB/OLEDText stubs (lines 224-295), переключити на `cs.command_sender.haptic(...)` API
- `src/backend/sensors/command_sender.py` — singleton `command_sender` має `haptic(pattern, duration_ms)`, `rgb(led_id, color, mode, speed_ms)`, `oled_text(lines)`. Сігнатури НЕ збігаються з тим що чекає device.py — треба адаптувати або додати thin wrappers `send_haptic / send_rgb / send_oled_text` в `command_sender.py`
- `src/backend/agent/runtime.py:140-230` — track система є (foreground/background slots), але actions НЕ декларують `expected_duration` → loop не знає що `BlenderRun` треба авто-перекинути в bg
- `src/backend/agent/loop.py` — додати "promote to background if action.estimated_duration_s > threshold"
- `src/backend/api/routes_agent.py:481+` — multi-track status endpoint вже є; треба додати `GET /tasks/{id}/progress` з checkpoint timestamps
- `src/frontend/src/layouts/OperatorLayout.tsx` — куди монтувати `LongRunningTaskCard` (sidebar коли task.track==='background')
- `src/frontend/src/components/familiar/PhantomFamiliar.tsx` + `Familiar3D.tsx` — додати reactor hook що читає WS `screen.action_executed` events

**Плановані файли (новий код):**
- `src/backend/input/atspi_bridge.py` (~280 LOC) — `pyatspi3` обгортка. API: `find_role(role: 'push_button'|'menu_item'|...)`, `find_by_label(label: str)`, `click_element(node) → bbox`. Fallback `ATSPIUnavailable` коли `pyatspi` не імпортується (виключно X11 + a11y enabled). Cache app-tree на 500ms.
- `src/backend/agent/actions/device.py` — додати `ATSPIFindByLabel`, `ATSPIClickByLabel` (RiskLevel.LOW, але із semantic target → less destructive ніж blind click). Реєстрація в `actions/registry.py`.
- `src/backend/agent/long_running.py` (~240 LOC) — `LongRunningSpec` mixin: `estimated_duration_s: int`, `progress_checkpoint_interval_s: int=60`. Loop читає це з `action.long_running_spec()` classmethod (default None). При `>5min` — `runtime.promote_to_background(task)` + `_broadcast("task.promoted_to_background", {...})`.
- `src/backend/agent/actions/base.py` — додати classmethod `long_running_spec(cls) -> LongRunningSpec | None` (default None). Override у `BlenderRun` (1800s timeout → spec).
- `src/backend/api/routes_agent.py` — `GET /tasks/{id}/progress` → `{checkpoints: [{at, label, percent?}], started_at, eta_s?}`.
- `src/frontend/src/components/agent/LongRunningTaskCard.tsx` (~220 LOC) — карточка з progress bar, ETA, "resume foreground" / "cancel" CTAs. Один інстанс на background slot.
- `src/frontend/src/components/familiar/FamiliarReactor.tsx` (~180 LOC) — слухає `agentStore` events (action.executed, plan.user_edited, council.consensus_reached) → морфить емоцію Familiar (`worried` для `RiskLevel.HIGH` action, `triumphant` коли `task.report_ready`, `watching` коли screen.click активний з координатами курсора).
- `src/frontend/src/stores/agentStore.ts` — додати `progressByTaskId: Map<string, ProgressUpdate>`, `subscribeProgress`, ловити WS `task.progress` events.
- `src/shared/types/agent.ts` — `ProgressUpdate { task_id, label, percent?, at, kind: 'checkpoint'|'eta_update' }`.

**Reuse / НЕ переписувати:**
- `command_sender.command_sender` singleton — використати методи `.haptic / .rgb / .oled_text` з device.py замість fictitious `send_*` функцій
- `agent.runtime` track-promotion методи — `promote_to_background` (якщо немає — дописати поверх існуючих `_set_slot`)
- `Familiar3D.tsx` GLB animation system — `FamiliarReactor` тільки керує props (emotion / focus_target), 3D логіка не чіпається

**Resilience (П-1):**
- AT-SPI відсутній (no `pyatspi`, no a11y daemon) → action падає з ясним повідомленням, агент сам fallbackає на `screen.ocr → screen.click(x,y)` через standard plan-redo loop (вже працює)
- LongRunning без LLM → progress-checkpoints все одно емітяться (вони з action's `progress_callback`, не з LLM), просто без AI-narrated milestone
- FamiliarReactor — повністю детерміністичний state→emotion mapper, нуль LLM

**Verify (Phase 18-COMPLETE):**
1. Запустити `screen.click(x=10000, y=10000)` (off-screen) → action faillить → loop викликає `atspi.find_by_label("OK")` як fallback → знаходить кнопку → click → success. Audit log містить fallback.
2. Запустити `BlenderRun(script_path='examples/blender/cube.py', timeout_s=600)` → loop одразу promotes task to background → FE показує `LongRunningTaskCard` з progress, головний екран вільний для іншого goal. Через 30s checkpoint event → progress оновлюється.
3. ESP32 connected → `esp32.haptic(pattern='triple')` → повертає `ok=True`, фізична вібрація (на стенді), `command_sender.haptic` лог. ESP32 disconnected → `ok=False, error_class='SerialDisconnected'`, але agent loop НЕ падає, переходить до наступного step.
4. Familiar поведінка: під час Council debate камера повертається до speaking role; під час `screen.click` — Familiar нахиляється до click point; на `task.report_ready` — Familiar в "presenting" pose.
5. **Offline test (П-1):** Gemini+Ollama недоступні → AT-SPI працює (semantic, no LLM), LongRunningCard працює (deterministic checkpoints), Reactor працює (state-machine).

**Implementation order (atomic commits):**
1. ESP32 wire fix — `command_sender.send_haptic/rgb/oled_text` thin wrappers; device.py stops returning "not wired"
2. `agent/long_running.py` + `actions/base.py.long_running_spec()` + loop promotion logic + `BlenderRun.long_running_spec()` override
3. `routes_agent.py` `GET /tasks/{id}/progress` + WS `task.progress` channel + agentStore wiring
4. `LongRunningTaskCard.tsx` + OperatorLayout mount
5. `input/atspi_bridge.py` + `ATSPIFindByLabel/ClickByLabel` actions + registry
6. `FamiliarReactor.tsx` + PhantomFamiliar wire-up
7. Each commit: tsc + pytest гілки + smoke offline test from `tests/offline_simulation.py`

**Мета:** "бачити як людина і клацати по будь-якій кнопці". Керування БУДЬ-ЯКИМ застосунком на Linux + грати в ігри замість користувача + керувати ESP32 actuators.

### Backend — Screen Vision

**Файли:**
- `src/backend/vision/screen_capture.py` (новий, ~250 LOC) — `ScreenCapture` клас. Стратегії:
  - Wayland: `grim` subprocess (Radxa default) → PNG bytes
  - X11: `mss` library (вже в requirements? якщо ні — додати) → frame
  - Region capture (rect) + multi-monitor support
  - Throttle 5 FPS default, on-demand burst
- `src/backend/vision/screen_ocr.py` (новий, ~200 LOC) — Tesseract bindings (через `pytesseract`), Ukrainian + English models, returns `OCRResult[]` з bbox + text + confidence
- `src/backend/vision/screen_grounding.py` (новий, ~350 LOC) — розширення `vision/grounding.py`: `OmniParserV2` тепер працює і на screen, не тільки на DOM. `find_element_by_description(screenshot, "червона кнопка Зберегти")` → bbox + click point.
- `src/backend/vision/scene_understanding.py` (новий, ~200 LOC) — overall scene description: який застосунок зараз активний, які регіони (header / sidebar / main / dialog), фокус-вікно. Викликається 1 раз/раунд для контексту, не на кожен click.

### Backend — Input Automation

**Файли:**
- `src/backend/input/desktop_control.py` (новий, ~300 LOC) — `DesktopController` клас:
  - Wayland-first: `wtype` для тексту, `ydotool` для click/move (потребує ydotoold демон, додати в `scripts/setup.sh`)
  - X11 fallback: `xdotool`
  - Methods: `click(x,y, button='left')`, `double_click`, `right_click`, `drag(from, to)`, `type_text(s)`, `key_combo(keys)`, `scroll(dir, ticks)`
- `src/backend/input/window_control.py` (новий, ~150 LOC) — focus / move / resize / minimize вікон (wlr-foreign-toplevel-management для wayland, wmctrl для x11)
- `src/backend/input/atspi_bridge.py` (новий, ~250 LOC) — AT-SPI accessibility tree access (`pyatspi`) — semantic UI читання БЕЗ screen capture, працює з GTK/Qt/Electron native accessibility. `find_button("Save")` → AT-SPI element → click без OCR.

### Backend — ESP32 Actuator Bridge as Action

**Файли:**
- `src/backend/sensors/command_sender.py` — розширити: `send_haptic(pattern)`, `send_rgb(r,g,b,duration)`, `send_oled_text(text)`, `send_servo(angle)`, `send_buzzer(freq, duration)`
- `src/backend/agent/actions/device.py` (новий, ~250 LOC) — нові Action класи:
  - `ScreenCapture`, `ScreenFindElement`, `ScreenClickElement`, `ScreenType`, `ScreenKeyCombo`
  - `WindowFocus`, `WindowMove`, `AppLaunch`, `AppClose`
  - `ESP32Haptic`, `ESP32RGB`, `ESP32OLEDText`, `ESP32Servo`, `ESP32Buzzer`
  - `BlenderRun` — subprocess Blender headless mode з python script (для "побудуй мегаполіс" use-case)
  - `GameInputBurst` — high-frequency input для ігор (60 FPS+ click sequences)
- `src/backend/agent/actions/registry.py` — register all above

### Backend — Long-Running + Resumable Tasks (для "мегаполіс в Blender")

**Файли:**
- `src/backend/agent/long_running.py` (новий, ~300 LOC) — `LongRunningTask` mixin: при `expected_duration > 5min` агент:
  - переходить в `track=background` автоматично
  - зберігає progress checkpoints кожні 60s
  - resumable після рестарту PHANTOM
  - WS `progress.tick` events з частотою 1 Hz (НЕ кожна дія)
- `src/backend/agent/loop.py` — додати perception of duration: estimate from history of similar tasks (стратегічна пам'ять).

### Frontend — Vision-In-The-Loop UI

**Файли:**
- `src/frontend/src/components/agent/AgentVisionPanel.tsx` (новий, ~400 LOC) — live screenshot з overlay'ями: bbox кандидатів, обраний target, mouse trajectory, last click ripple. Toggle "show what agent sees" — drama (П-2).
- `src/frontend/src/components/agent/LongRunningTaskCard.tsx` (~200 LOC) — для бекграундних задач: progress bar, ETA, checkpoint timestamps, "resume in foreground" button. Список таких карток в окремій панелі.
- `src/frontend/src/components/familiar/FamiliarReactor.tsx` — Familiar реагує на screen actions: "стежить" за курсором, нахиляється до активного елемента, тривожиться при помилкових клацах.

### Resilience (П-1)
- Vision LLM відключений → grounding падає на pure DOM/AT-SPI accessibility (точніше) + OCR fallback з rule-based label matching. Працює без VLM.
- ESP32 disconnect → actions queue + retry; non-blocking для основного task.

### Verify (Phase 18)
1. Запит: "зайди в Firefox, відкрий wikipedia, знайди Київ, скріншоти 5 сторінок". Агент: launch app → screen capture → OCR/AT-SPI elem find → click → wait → repeat. Все видно в AgentVisionPanel.
2. Запит: "побудуй маленьке місто в Blender". Агент: спавнить `BlenderRun` action з python script → bg task → checkpoints → 30 хв пізніше → screenshots. Користувач бачить progress, може робити інше.
3. Гра: "грай за мене в 2048 поки не дійдеш до 1024". `GameInputBurst` action, screen capture analysis, decisions per move.
4. ESP32 actor: "коли я задрімаю — пастельний RGB і вібрація стулу". Sensor trigger → agent action → ESP32 command.
5. **Offline test:** все що вище БЕЗ Gemini/Ollama. AT-SPI based clicking + OCR matching + rule templates → працює, повільніше, без natural-language target descriptions.

---

## Phase 19 — Mobile Companion (3-4 тижні)

**Мета:** реалізувати все з `docs/MOBILE_COMPANION.md` що зараз тільки на папері. Phone = sensor organ + remote control + approve-on-phone tier для ROOT actions.

### Backend
- `src/backend/api/routes_pair.py` (новий, ~400 LOC) — pair init/claim/status (X25519 ECDH ephemeral + Ed25519 long-term); QR payload (60s TTL)
- `src/backend/security/pair_crypto.py` (новий, ~200 LOC) — crypto primitives, key persistence
- `src/backend/api/routes_mobile_sensors.py` (новий, ~200 LOC) — `POST /sensors/mobile_batch` — GPS/IMU/mic_rms/BLE/wifi
- `src/backend/api/routes_comms.py` — SMS/RCS bridge, call transcription accept
- `src/backend/agent/approve_on_phone.py` (новий, ~250 LOC) — wraps кожну ROOT-tier action: pushes до mobile companion, blocks до tap "approve" або "deny" (з timeout fallback policy)
- `src/backend/db/models.py` — нові tables: `PairedDevice`, `MobileSensorBatch`, `MobileApprovalRequest`

### Mobile App (Android Compose)
- Структура: `mobile/` під PHANTOM_OS_BLUEPRINT (нова root-level дир)
- Pair flow (camera QR scan)
- Sensor relay service (foreground service з notification)
- Agent stream view (mirrors PlanTree compactly)
- Approve sheet (push-driven, biometric confirm)
- Voice trigger (mic → STT → goal injection)

### Verify (Phase 19)
1. QR pair → mobile shows paired status. PHANTOM `PairedDevice` row.
2. Phone moves → GPS shows on PHANTOM tactical map.
3. Agent attempts ROOT action → push до phone → approve → action runs.
4. Voice command on phone → goal injects into PHANTOM agent.
5. Offline mobile (no internet) → caches sensor batches, syncs on reconnect.

---

## Phase 20 — Peer PHANTOM Mesh (2-3 тижні)

**Мета:** делегування на інші PHANTOM ноди. "Вдома + офіс + лабораторія" — три PHANTOMи бачать один одного, агент може передати task найшвидшому/найрелевантнішому.

### Backend
- `src/backend/mesh/discovery.py` (новий) — mDNS service `_phantom-mesh._tcp` advertise + browse
- `src/backend/mesh/peer_protocol.py` (новий) — signed peer envelopes (Ed25519), JSON-over-mTLS preferred
- `src/backend/mesh/task_handoff.py` (новий) — delegate task до peer, stream events back, merge results
- Trust list: ROOT-approved peers; new peer = manual approve flow
- Session memory shared via vector replication (ChromaDB to-peer push)

### Frontend
- Peers panel у Sentinel layout — список нод, capability summary, trust indicator
- Task can target peer explicitly: `[Run on @lab-phantom]`

### Verify
- 2 PHANTOMи в одній мережі бачать один одного. Trust handshake. Task delegation. Result merge.
- Offline peer → graceful fallback to local execution.

---

## Phase 21 — Visual Overhaul of Agent Layer (1.5 тижні) ✅ SHIPPED 2026-05-03

**Статус:** 5 atomic commits на гілці `autonomous-run` (091425f → 9881e92):

  • `phase-21-1` — PlanTree → living capsules. Sub-goals як капсули з
    progress-fill driven by actions_used / expected_actions; active
    breathes (capsule-breathe) + shimmers; done deepens у bronze; spine
    flows downward when task is running.
  • `phase-21-2` — DecisionCard. Confidence ring around eyebrow chip,
    typewriter (18 ms / char) for what_i_plan, "OBJECTION" pull-out tab
    with objection-pull-out keyframe.
  • `phase-21-3` — AgentTimeline. Filter chips (actions / obs /
    reflect), MAX cap 12 → 200, temporal opacity ramp 1.0 → 0.45 over
    15 min, live-badge < 5 s, auto-stick-to-top when at scroll head.
  • `phase-21-4` — FamiliarReactor. Status edges: running→done waving,
    →failed peeking, →awaiting_user pointing, →blocked_quota pointing
    "skeleton mode". Active sub-goal change → pointing with
    target.selector=[data-subgoal-id=...] for tendril resolution.
  • `phase-21-5` — Hero orb gets SVG progress-ring matching plan
    completion, BudgetChip switches to coral fill / border / gradient
    when pct ≥ 90.

Verify: tsc clean (0 errors), vitest 19/19 green, vite build exit 0
(1m 4s, OperatorLayout chunk 78.69 kB / 20.70 kB gzip).

Continue Phase 19 (Mobile Companion) next per operator directive
"по черзі давай" 2026-05-03.

### Original brief (kept for reference)

**Мета:** "сильно перевершує Claude Code візуально". OperatorLayout перебудова, plan tree як живий орган, Familiar інтегрований.

### Frontend
- `OperatorLayout.tsx` — повний redesign з `docs/VISUAL_SYSTEM.md` tokens (sunrise-warm primary, glass-stack)
- PlanTree:
  - sub-goal як "капсула" з життям всередині (внутрішня анімація = activity score)
  - progress visible через fill, не cifras
  - completed → fade to bronze з "глибшає" effect
  - active → пульс + Familiar point at it
- DecisionCard:
  - confidence як ширина кільця навколо аватара
  - objection відкриває як "tab pulled out" з drama
  - inner monologue — typewriter, не статичний текст
- Timeline:
  - infinite scroll, не 12-cap
  - filtering bar (action types / time range)
  - past entries fade-recede, future placeholder ghost-faded
- Familiar reactivity:
  - watches active sub-goal (head turn)
  - posture = task health (confident / worried / tense / triumphant)
  - reacts на Council debates (looks at speaker)
  - "presents" report at the end
- Animations: всі motion scale per state (per VISUAL_SYSTEM)

### Verify
- Side-by-side screenshot: до/після. Side-by-side з Claude Code UI demo.
- Performance: 60 FPS на Radxa Dragon Q6A.
- Reduced-motion: все ще читається без анімацій.

---

## Phase 22 — Always-On Multimodal Goal Capture (1-2 тижні)

**Мета:** менше тертя при запуску. Агент починає задачі з voice / point-and-click / proactive suggestion.

### Backend
- Wake-word "Phantom" → STT stream → goal extractor (LLM або template-based fallback)
- Screen-region select → "explain this" / "do this with this" goal seed
- Proactive engine: на основі context (час, активний застосунок, історія) пропонує goals (gentle, dismissible)

### Frontend
- Voice ribbon (стрічка вгорі) — когда агент чує goal-like utterance, з'являється "👂 Запустити агента: '...'?" + 3s confirm
- Region select tool (drag rect → goal)
- Proactive cards у DialogueLayout (не push, dismissable)

### Verify
- Voice: "Phantom, знайди мені рейс до Львова на завтра вечір" → goal entered, agent runs
- Region: drag over chart on screen → "explain this" → agent OCRs + analyzes
- Proactive: 23:00 → suggestion "перевірити чи всі IoT пристрої вимкнені?" — dismissable, not annoying

---

## Cross-Cutting: Resilience (offline-first) — обов'язково по всіх фазах

Кожен PR що додає LLM-залежний шлях — мусить додати fallback path. Тестовий harness:

- `src/backend/tests/offline_simulation.py` (новий) — pytest fixture що mock-ить `ai_router.generate` як `BlockedQuotaError` → ВСЕ функціонал нижче має працювати:
  - finalize_task → deterministic report
  - Council → deterministic personas
  - grounding → AT-SPI / OCR rule matching
  - long-running task → continues from checkpoint
  - plan edit → працює (UI/API)
  - history browse → працює
  - voice goal capture → template-based
- CI gate: `pytest -m offline` має проходити без LLM credentials.

---

## Cross-Cutting: Observability

- `src/backend/agent/telemetry.py` (Phase 16+) — кожен phase додає метрики: action_count, llm_calls, fallback_triggers, council_rounds, plan_edits, peer_handoffs
- Dashboard: SandboxLayout або новий MetricsLayout; show last-24h metrics, anomaly highlights

---

## Recommended starting point: **Phase 17 (Live Controllability)**

Користувач сказав керованість живого агента — **NAJVAZHLYVYSHE**. Тому імплементація стартує з Phase 17, але:

1. Phase 16 — пререквізит для Phase 17 (без AgentReportScreen Council demo буде "зник у меню" в кінці).
2. Тому фактичний порядок: **Phase 16 → Phase 17 → 18 → 21 → 22 → 19 → 20**.
3. Кожна фаза = окрема implementation сесія з власним детальним плануванням через `superpowers:writing-plans`.

---

## Glossary (для уникнення двозначностей)

- **Council** — 3-7 AgentRoles які дискусують ОДИН раунд → consensus. НЕ паралельні independent workers.
- **Swarm** — паралельні independent task branches (Phase 17.b, опціонально).
- **Track** — foreground / background класифікація task. Існує. НЕ переплутати з Council.
- **Skeleton mode** — стан коли LLM offline, агент діє з deterministic templates. УСІ phase respect це.
- **Approve-on-phone** — Phase 19 фіча. ROOT actions блокуються до tap на mobile.
- **AT-SPI** — Linux accessibility API. Дозволяє "клацати" по semantic кнопці без screen capture.

---

## Out of scope (явно)

- Перебудова core/state_machine.py (не треба)
- Заміна ChromaDB на іншу vector DB (не треба, працює)
- Заміна Gemini на OpenAI/Claude API (Gemini→Ollama стек залишається)
- Native iOS app (тільки Android для Phase 19)
- Voice cloning / TTS перебудова

---

## Спека для наступної сесії

Коли будемо стартувати Phase 16 implementation:
1. Запустити `superpowers:writing-plans` skill з цим документом як reference
2. План буде розкласти Phase 16 на дрібні steps з критеріями перевірки кожного
3. Implementation через `superpowers:executing-plans` (review checkpoints)
4. Коміт коли всі verify steps Phase 16 проходять
5. Перейти до Phase 17 та повторити цикл
