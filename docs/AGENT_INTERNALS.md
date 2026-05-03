# AGENT_INTERNALS — як насправді працює `agent/loop.py`

> Phase 23-F — карта внутрішніх контурів агентового циклу. Тримай поряд
> коли працюєш над будь-чим у `src/backend/agent/`. Канонічні імена з
> публічного API — `agent.planner.strategic_plan`, `tactical_plan`,
> `tactical_plan_safe`, `reflect`.

## Мета документа

Один-екранна модель того, як task проходить від `/api/v1/agent/start`
до `task.report_ready`. Описує: хто планує, хто оцінює ризик, коли
вмикається Council, де живе Quality Gate, що блокує виконавця, як
з'являється Observation. Не дублює API_CONTRACTS.md і не пояснює
схеми — для цього `agent/schemas.py`.

## Шари агента (по контурах, не по файлах)

| Контур | Модулі | Відповідальність |
|---|---|---|
| Контракти | `agent/schemas.py` | Pydantic-моделі: `TaskState`, `SubGoal`, `PlanStep`, `Observation`, `RiskLevel`, `CouncilSituation`, `ReflectionResult` |
| Реєстр дій | `agent/actions/registry.py` + `agent/actions/*.py` | `Action` класи з полями `risk_level`, `preconditions`, `execute()` + `tool_schema` для LLM tool-calling |
| Планер | `agent/planner/` (`strategic.py`, `tactical.py`, `reflector.py`, `_llm.py`) | LLM-розмови, що повертають типізовані `StrategicPlan` / `PlanStep` / `ReflectionResult` |
| Виконавець | `agent/executor.py` | Викликає `Action.execute()` з sandbox + budget + audit |
| Вердикти | `agent/orchestrator/` (`council.py`, `quality_gate.py`, `modes.py`, `runtime_hooks.py`) | Council (6 ролей) + Producer→Critic→Verifier loop |
| Безпека | `agent/safety/sandbox.py`, `agent/approve_on_phone.py`, `agent/loop.py` risk-gate | Tolerance gate, Council pre-approval (Phase 23-D), phone/desktop intervene |
| Runtime | `agent/runtime.py` | Foreground+background slots, `_broadcast()` WS, intervention queue, audit |
| Цикл | `agent/loop.py` (`_run_task_loop_impl`) | Склеює всі контури в один async loop |

## Канонічна послідовність одного steps

```
┌──────────────────────────────────────────────────────────────────────┐
│  /api/v1/agent/start  →  AgentRuntime.start_task()  →  loop.run_task │
└──────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
                    ┌──────────────────────────┐
                    │ ensure StrategicPlan     │  ← strategic_plan()
                    │ (sub-goals, criteria)    │     LLM → StrategicPlan
                    └──────────────────────────┘
                                   │
              loop iteration ──────┤
                                   ▼
                    ┌──────────────────────────┐
                    │ pick next sub-goal       │
                    │ (status=pending → active)│
                    └──────────────────────────┘
                                   │
                                   ▼
                    ┌──────────────────────────┐
                    │ tactical_plan_safe(...)  │  ← tools = registry.catalog()
                    │ → PlanStep|None          │     filtered by risk_tolerance
                    └──────────────────────────┘
                                   │
            ┌──────────────────────┼──────────────────────┐
            │  None / parse_fail   │   PlanStep ok        │
            ▼                      ▼                      │
   ┌──────────────────┐   ┌──────────────────┐            │
   │ reflect()        │   │ DONE_TASK?       │──→ Quality │
   │ → revise/abandon │   │ (sentinel action)│   Gate Loop│
   └──────────────────┘   └──────────────────┘            │
                                                          │
                                                          ▼
                                          ┌──────────────────────────┐
                                          │ Risk gate                │
                                          │ if risk > tolerance:     │
                                          │   ① Council              │ ← Phase 23-D
                                          │      kind=high_risk_action│   maybe_consult_council
                                          │      verdict=abort/revise│   (modes.pick → "council")
                                          │      → drop step, replan │
                                          │   ② phone approval       │ ← Phase 19-4
                                          │      approve/deny/timeout│   request_phone_approval
                                          │   ③ desktop intervene    │ ← Phase 9.2.3
                                          │      bounded queue.get() │
                                          └──────────────────────────┘
                                                          │
                                                          ▼
                                          ┌──────────────────────────┐
                                          │ executor.execute()       │
                                          │  preconditions check     │
                                          │  sandbox wrap (bwrap)    │
                                          │  Action.execute()        │
                                          │  → ActionResult          │
                                          └──────────────────────────┘
                                                          │
                                                          ▼
                                          ┌──────────────────────────┐
                                          │ Observation appended     │
                                          │ self_model.update()      │
                                          │ checkpoint persists row  │
                                          └──────────────────────────┘
                                                          │
                                  every N actions ────────┤
                                                          ▼
                                          ┌──────────────────────────┐
                                          │ reflect() (cyclic)       │
                                          │  continue / revise_subgoal│
                                          │  / revise_strategy /      │
                                          │  abandon / wait_user      │
                                          │ revise_strategy → council │ ← Phase 17
                                          │  (kind=strategic_revise) │
                                          └──────────────────────────┘
                                                          │
                                                          ▼
                                              loop iteration ⮢
                                                          │
                                                          ▼
                              all sub-goals done OR DONE_TASK passes
                              Quality Gate → finalize_task("done")
                              → task.report_ready WS event
                              → AgentRuntime.pending_reports holds
                                until operator close/continue
```

## Council — коли вмикається

`agent/orchestrator/runtime_hooks.py::maybe_consult_council` єдина точка
входу. Mode picker (`modes.pick_orchestrator_mode`) повертає `"council"`
автоматично для шести (тепер семи) `CouncilSituationKind`:

| Kind | Точка виклику в loop.py | Що тригерить |
|---|---|---|
| `strategic_revise` | line 424 | Reflector вердикт → перепланування |
| `quality_gate` | line 722 | Quality Gate знайшов blocker → revise |
| `high_risk_action` | line 858 (Phase 23-D) | Risk > tolerance, ПЕРЕД approval |
| `before_destructive` | (зарезервовано) | Action з `is_destructive` маркером |
| `low_confidence` | (зарезервовано) | InnerMonologue.confidence < 0.5 |
| `info_need` | (зарезервовано) | AskUser action |
| `user_invoked` | UI button | Operator явно попросив раду |

`pick_orchestrator_mode` шанує `agent_orchestrator_mode` setting:
`single` обходить council; `council` примушує її для всіх ситуацій;
`auto` (default) використовує матрицю вище.

Verdict семантика:
- `proceed` → виконуємо як і планували
- `revise` → виконуємо альтернативний `chosen_action` або replan
- `abort` → пропускаємо step, planner вибере щось інше
- `ask_user` → маршрутизація до approval flow (phone → desktop)

## Quality Gate — як перевіряє результат

Sentinel action `DONE_TASK` (planner повертає коли вважає що мета досягнута)
не виконується відразу. Замість цього `agent/orchestrator/quality_gate.py`
запускає Producer→Critic→Verifier round (LLM-based; deterministic
fallback на regex). Якщо Critic знайшов blocker, loop:
1. Інкрементує `state.quality_gate_failures`
2. Викликає Council (`kind=quality_gate`) для додаткової перспективи
3. Викликає `reflect()` з reason `quality_gate_failed`
4. Або replans, або (на 2-му strike) фіналізує task з caveat
   warning у TaskReport

Налаштування — `agent_reflection_every_n_actions` (cyclic),
`_QUALITY_GATE_MAX_FAILURES` (2 strikes max).

## Risk gate (loop.py:849-940) — три рівні захисту

```
config.agent_risk_tolerance ∈ {1, 3, 5, 7}  (SAFE, LOW, MEDIUM, HIGH)
                ↓
   if action.risk_level > tolerance:
   │
   ├── ① Phase 23-D — Council (kind=high_risk_action)
   │    if verdict ∈ {abort, revise}:
   │       broadcast warning.issued (council_blocked_risky)
   │       state.step_idx += 1; continue
   │    else:                              ← proceed/ask_user fall through
   │
   ├── ② Phase 19-4 — phone approval (Mobile Companion)
   │    request_phone_approval() → approved | denied | timeout | no_device
   │    approved → fall through to executor
   │    denied → drop step
   │    no_device/timeout → fall to ③
   │
   └── ③ Phase 9.2.3 — desktop intervene queue
        bounded asyncio.wait_for(intervention_queue.get(), timeout)
        approve | reject | (timeout → reject + warning)
```

Settings: `agent_risk_tolerance` (1/3/5/7), `agent_council_for_high_risk`
(default True), `agent_phone_approval_timeout_s` (90 s),
`agent_user_consent_timeout_s` (300 s).

## Executor — що робить між planner і Action.execute

`agent/executor.py::execute()`:
1. Перевіряє preconditions (key/required/failure_mode)
2. Витягує SandboxProfile (compute|net_observe; radio_privileged
   зарезервовано)
3. Огортає subprocess через `agent/safety/sandbox.py::wrap_argv` (bwrap)
4. Викликає `Action.execute(ctx, args)` під `_current_action_task`
   handle (для `cancel_step`)
5. Записує audit row через `agent/audit.py`
6. Повертає `ActionResult` + Observation

Power-knobs: `agent_max_actions_per_task`, `agent_max_elapsed_s_per_action`,
`agent_max_consecutive_identical_errors`, `agent_max_llm_calls_per_task`.

## Observation → SelfModel → next iteration

Після кожного step:
- `Observation` додається до `state.observations`
- `agent/self_model.py::update_from_observation` пере-обчислює
  `risk_aversion`, `confidence`, `emotional_state`
- `agent/audit.py::checkpoint_step` персистить рядок

Reflector (`reflect()`) кожні `agent_reflection_every_n_actions`
дій бачить весь contention зі `state.observations[-15:]` + recent
actions summary і повертає `ReflectionResult` з verdict, який вирішує
що робити далі (continue / revise_subgoal / revise_strategy /
abandon_task / wait_user).

## Як консумувати planner з нового коду

```python
from agent.planner import (
    strategic_plan,        # async — goal → StrategicPlan
    tactical_plan,         # async — sub_goal → PlanStep
    tactical_plan_safe,    # async — як tactical_plan, але повертає (PlanStep|None, err|None)
    reflect,               # async — observations → ReflectionResult
    PlannerLLMError,       # підіймається коли planner LLM не зміг відповісти
    BlockedQuotaError,     # підіймається коли провайдер вичерпав квоту
    # Phase 23-G — lesson loop (compounding знання між сесіями)
    distill_lesson,        # async — observations → Lesson|None
    write_lesson,          # async — Lesson → ChromaDB row
    recall_lessons,        # async — query → top-K filtered by relevance
    format_lessons_for_prompt,  # sync — list[Lesson] → UA bullet block
)
```

## Phase 23-G — Lesson loop (compounding знання)

PHANTOM на відміну від Claude Code / Coworker / Aider / Cursor компаундує
знання МІЖ сесіями: після кожного task `done` runtime витягує
ТРАНСФЕРАБЕЛЬНИЙ урок ("коли мета X, роби Y, уникай Z") у відокремлену
ChromaDB-колекцію `agent_lessons`. На наступний task `strategic_plan` +
`tactical_plan` витягують top-3 уроки за схожістю мети та інжектять їх у
prompt над блоком епізодів.

```
finalize_task(state, "done")
        │
        ▼
┌──────────────────────────────────────┐
│ _finalize_persist                    │
│  ① compose_summary + write_episode   │ ← episode (narrative)
│  ② distill_lesson(LLM)               │ ← Phase 23-G
│     → {what_worked, what_avoid,      │
│         applicability}               │
│  ③ write_lesson → ChromaDB           │
│     collection 'agent_lessons'       │
└──────────────────────────────────────┘

наступний task:
        │
        ▼
┌──────────────────────────────────────┐
│ strategic_plan(goal)                 │
│  recall_lessons(goal, k=3)           │
│   ↳ format_lessons_for_prompt(...)   │
│   ↳ injected ABOVE episodic block    │
│  recall(goal, k=5)                   │
│   ↳ episodic block                   │
│  → LLM with both blocks above tools  │
└──────────────────────────────────────┘
        │
        ▼
для кожної sub_goal:
┌──────────────────────────────────────┐
│ tactical_plan(sub_goal)              │
│  recall_lessons(sub_goal.description)│
│   ↳ injected after caveats_block,    │
│     before sub-goal recap            │
│  → next PlanStep                     │
└──────────────────────────────────────┘
```

**Чому це сильніше за Claude Code/Coworker:**
- Claude Code/Coworker reset memory per turn або per session — досвід пропадає.
- PHANTOM-уроки персистять у ChromaDB → embedding search → injection.
- LLM бачить prescriptive guidance ("роби X / уникай Y") до того як заглядає у raw episodes — це справжній metacognitive layer.
- Уроки фільтруються `agent_lessons_min_relevance` (0.35 default) щоб
  cold-cache prompts лишались чистими.

Settings: `agent_lessons_enabled` (default True), `agent_lessons_top_k`
(3), `agent_lessons_min_relevance` (0.35).

Внутрішні модулі (`agent.planner.strategic`, `.tactical`, `.reflector`,
`._llm`) лишаються імпортовними для тестів і просунутих call sites,
але їх API не контракт — зміна сигнатури в submodule НЕ вважається
breaking change поки публічні імена вище не змінились.

## Куди дивитись далі

- `agent/loop.py::_run_task_loop_impl` — головний loop, ~1100 LOC
- `agent/orchestrator/council.py::Council.run_round` — як 6 ролей
  голосують і консенсусять
- `agent/orchestrator/quality_gate.py::QualityGate.run` — Producer→
  Critic→Verifier
- `agent/runtime.py::AgentRuntime` — двослотовий runtime
- `docs/audit-2026-04-30-day3/FINDINGS.md` + `audit-2026-05-01-day4/FINDINGS.md`
  — попередні аудити шарів вище
