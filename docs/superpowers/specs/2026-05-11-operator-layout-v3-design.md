# OperatorLayout v3 — Roster + Focus + Tape + collapsible chrome

Date: 2026-05-11
Status: design (pending implementation)
Author: Kiril003 (з brainstorming session)

> Revision 2 (2026-05-11): додано секцію "Chrome density & collapse" —
> розширення content-area через chrome-collapse на всі layout’и.

## Контекст

Поточний `src/frontend/src/layouts/OperatorLayout.tsx` (1024×600 OPERATOR
screen) перевантажений і дублює дані. Оператор повідомив три симптоми:

1. Інформації до виводу в рази більше, ніж місця.
2. Багато халтури і непроробок — три панелі (Hero, PlanTree, Logic Stream,
   Event Log) кажуть про те саме різними словами.
3. Коли агент зациклюється на `revise_strategy` (наприклад, через Gemini
   Pro 2.5 400 INVALID_ARGUMENT, який стався 2026-05-11), UI рендерить
   десятки однакових карток і нічого не видно.
4. Бачимо тільки foreground-таск. `BackgroundTaskCardMount`,
   `standing_orders/runner`, `agent/proactive`, ради `Council` —
   працюють у бекенді, але оператор їх існування ловить тільки по
   побічних слідах (StatusBar breathing dot, окремий floating overlay).

Бажаний результат — на одному екрані 1024×600 видно ВСІХ агентів, плюс
повну картину виділеного, плюс єдиний timeline без дублів.

## Цілі

- Один canonical погляд на всі активні агентські процеси (FG/BG/SO/Proactive/Council).
- Єдиний timeline ("Tape") замість трьох конкуруючих джерел.
- Frontend-дедуплікація loop-spam (`reflection × N` замість 22 карток).
- Backend reflection-cap, який зупиняє безкінечну петлю палити квоту.
- Видимий feedback на помилки в `AgentCommandCenter` (зараз `console.error`).
- **Chrome density**: усі сталі елементи (StatusBar, Roster, HUD,
  FloatingToolbar) колапсуються незалежним стрілочко-handle’ом і
  пам'ятають стан між сесіями. Дефолт — згорнуто компактно, не
  розгорнуто. Працює системно у ВСІХ layout’ах (Shadow / Focus /
  Dialogue / Sentinel / Operator / Ghost).

## Поза скоупом

- Кореневий fix Gemini Pro 2.5 tool-schema 400. Окремий debug ticket
  (`docs/audit-2026-05-11-gemini-pro-tool-schema.md` — поки не існує).
  Reflection-cap у цьому PR рятує тільки від спалу квоти.
- Редизайн модалок Vault, Chat, InterveneDialog, InfoNeed, Council,
  Report, PlanEditor — лишаються `as-is`.
- Mobile companion / `phantom-companion/` — не зачіпається.
- StatusBar — без змін.

## Архітектура

### Замінюється

- `src/frontend/src/layouts/OperatorLayout.tsx` — повний rewrite body.
  StatusBar/FloatingToolbar/AmbientGlows/модалки лишаються.
- Зникають як floating-overlays: `BackgroundTaskCardMount`, окрема
  «Logic Stream» секція, окрема «Event Log» секція.
- `src/frontend/src/components/agent/DecisionCard.tsx` — поглинається в
  `FocusPanel`, як `<DecisionRow>` (компактний рядок з монологом).
- `src/frontend/src/components/agent/AgentCommandCenter.tsx` — додає
  toast-слот, error handling в `submitGoal`.

### Лишається без змін

- `useAgentStore`, `useAgentStream`, `agentApi`.
- `StatusBar`, `FloatingToolbar`, `AmbientGlows`.
- Усі модалки: `Vault`, `ParallelChatDrawer`, `InterventionDialog`,
  `CouncilStage`, `InfoNeedDialog`, `AgentReportScreen`, `PlanEditor`,
  `LongRunningTaskCard` (тепер показується тільки коли focus=background).
- `agent/audit.py`, `agent/runtime.py`, `agent/orchestrator/*` — без змін.

### Нові компоненти

| Файл | Призначення |
|------|-------------|
| `src/frontend/src/components/agent/AgentRoster.tsx` | 36px стрічка з 4 chip’ами + Council-індикатор. Селектор foreground/background/standing-orders/proactive. |
| `src/frontend/src/components/agent/FocusPanel.tsx` | Поглинає Hero+PlanTree+DecisionCard. Малює стан обраного агента. |
| `src/frontend/src/components/agent/Tape.tsx` | 120px права колонка. Дедуплікований timeline. Один компактний рядок на подію. |
| `src/frontend/src/stores/uiStore` (extend) | Додаємо `focusedAgent` selector + `toast({kind,message})` API. |
| `src/frontend/src/hooks/useStandingOrdersHeartbeat.ts` | Опитує `/standing_orders/state` раз/10s для chip-у SO (бо WS-каналу немає). |

### Backend дельта

- `src/backend/agent/loop.py` (~15 LOC):
  - При запису reflection з `verdict='revise_strategy'` і незмінним
    `step_idx`, інкрементуємо `consecutive_revise_strategy_same_step`.
  - При значенні `≥ 5`: викликаємо `agent_runtime.pause(task_id,
    reason='auto_reflect_loop')`. Це стандартний `paused` стан —
    оператор може resume вручну після фіксу root cause.
  - Reset лічильника, як тільки verdict змінився або step_idx посунувся.

## Layout (1024×600)

Дефолт (chrome compact + collapsed bottom):

```
┌──────────────────────────────────────────────────────────────────────────┐
│ StatusBar compact (24px)                                       ⚙   ◀▶  │ <- handle
├──────────────────────────────────────────────────────────────────────────┤
│ AgentRoster compact (28px)  ●FG  ◌BG  ◌SO  ◌PRO  ⚖                ◀▶  │ <- handle
├──────────────────────────────────────────────────────────────────────────┤
│ ┌────────── FocusPanel (flex ~524px) ────────────────┐ ┌── Tape 120px ─┐│
│ │  monologue                                          │ │ 21:01 rv×22 │ │
│ │  PlanTree                                           │ │ 21:00 g400  │ │
│ │  recentActions (inline під активним subgoal)        │ │ 20:59 strt  │ │
│ │  …                                                  │ │ …           │ │
│ │  now-row STEPS · AI · loop · cf                     │ │             │ │
│ └─────────────────────────────────────────────────────┘ └─────────────┘ │
├──────────────────────────────────────────────────────────────────────────┤
│  HUD collapsed (12px handle bar)                           ▲ show HUD   │
└──────────────────────────────────────────────────────────────────────────┘
```

Розгорнутий стан (handles вмикають елементи на повний розмір):

```
┌──────────────────────────────────────────────────────────────────────────┐
│ StatusBar full (36px)                                          ⚙   ▼   │
├──────────────────────────────────────────────────────────────────────────┤
│ AgentRoster full (36px)   …chips…                                 ▼   │
├──────────────────────────────────────────────────────────────────────────┤
│ FocusPanel (404px) + Tape                                                │
├──────────────────────────────────────────────────────────────────────────┤
│ AgentCommandCenter HUD (64px)                                  ▼ hide   │
├──────────────────────────────────────────────────────────────────────────┤
│ FloatingToolbar (60px)                                         ▼ hide   │
└──────────────────────────────────────────────────────────────────────────┘
```

Висоти (px) в кожному стані:

| Елемент    | compact | full | різниця |
|------------|---------|------|---------|
| StatusBar  | 24      | 36   | 12      |
| Roster     | 28      | 36   | 8       |
| HUD        | 12      | 64   | 52      |
| Toolbar    | 12      | 60   | 48      |
| **Content sum** | **524** | **404** | **+120** |

Тобто `FocusPanel` отримує до +30% вертикального простору, коли chrome
максимально згорнутий. Width лишається 1024 завжди (вікно фізичне).

- Roster row: 4×170px chip + flex Council = full width 992 (з padding 16).
  В compact-режимі chip скидає підпис → 4×120px + Council icon-only.
- main grid: `[1fr 120px]` cols × main height.

## Components

### AgentRoster

Props: none — все читає зі store.

Render: 5 horizontal sections:

| Section | Source | Active якщо |
|---------|--------|------------|
| Foreground | `currentTask`, `status` | `taskActive` (≠ idle/done/failed/stopped) |
| Background | `promotedToBackgroundAt`, `bgTaskGoals`, `progressByTaskId` | будь-який bg task існує |
| Standing Orders | new `useStandingOrdersHeartbeat` | enabled count > 0 |
| Proactive | `proactive.enabled`, `proactive.lastCycleAt` | `enabled === true` |
| Council | `councilActive`, `councilStatements.length` | `councilActive === true` |

Кожен chip:
- 36px висота, `min-width: 168px`, `border-radius: 12`, touch ≥ 44px клік-зона через `::before`.
- `aria-pressed={focusedAgent === id}`.
- Активний → фон `var(--primary)`, текст білий; інакше — glass.
- Один pulse-dot ліворуч (колір по статусу), один-два рядки тексту.

Клік: `useUIStore.setState({ focusedAgent: id })`.

### FocusPanel

Props: `focusedAgent` (з store).

Top row (monologue, 80px max-h, fade scroll):
- Якщо є last reflection — `verdict · summary` (до 200 char) + `cf` badge.
- Якщо є active recentAction — `action · monologue` (до 200 char).
- Якщо обидва — reflection вище, action нижче.
- Дедуплікація: ⤴ якщо останні N подій ідентичні, показуємо одну з `↻N`.

Plan row (flex, scroll-y):
- `subGoals.map(sg => <PlanRow status icon goal />)` — 32px кожен,
  активний має lefthand vertical bar `var(--primary)`.
- Поряд з активним subgoal вкладеними item’ами recentActions для цього subgoal.

Now row (32px, sticky bottom):
- `STEPS used/cap` · `AI used/cap` · `loop ↻N` · `cf 0.XX`
- bar для actionsPct і llmPct (як у поточному BudgetChip).

Залежно від `focusedAgent`:
- `foreground` — стандартна картина (вище).
- `background` — `progressByTaskId[currentBgId]` як monologue, plus `LongRunningTaskCard` body inline.
- `standing_orders` — список enabled orders з last_fired_at, fire_count, in_flight_task_id.
- `proactive` — `proactive.lastCycleAt` як relative time, `hasTriggers` як bool indicator.
- `council` — Council ще не дискутувала → "Council idle"; коли active —
  редіректить у `<CouncilStage>` модалку (Roster chip працює як кнопка
  "open council").

### Tape

Props: none — read `events`, `recentActions`, `reflections` через
selectors.

Логіка дедуплікації (pure function `collapseRepeats`):

```ts
function collapseRepeats(items: TapeRow[]): TapeRow[] {
  const out: TapeRow[] = [];
  for (const r of items) {
    const last = out[out.length - 1];
    if (last && sameSignature(last, r)) {
      last.repeats = (last.repeats ?? 1) + 1;
      last.ts = r.ts;
      continue;
    }
    out.push({ ...r, repeats: 1 });
  }
  return out;
}

function sameSignature(a: TapeRow, b: TapeRow): boolean {
  return a.kind === b.kind &&
         a.verdict === b.verdict &&
         a.step_idx === b.step_idx &&
         a.action === b.action;
}
```

Row render: `<time>HH:MM</time> <verdict>` (truncate); якщо `repeats > 1`
показуємо `↻N` badge праворуч. Tap → expand останні 5 подій inline.

### AgentCommandCenter (delta)

Існуючий код `submitGoal` лиш `console.error`. Заміна:

```ts
const submitGoal = async () => {
  const goal = value.trim();
  if (!goal || busy || taskActive) return;
  setBusy(true);
  try {
    await startTask(goal);
    setValue('');
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'failed to start';
    useUIStore.getState().toast({ kind: 'error', message: msg });
  } finally {
    setBusy(false);
  }
};
```

Toast-смужка над HUD’ом:
- Position: `absolute; bottom: 76px; left: 12px; right: 12px`.
- 3s auto-dismiss, клік → копіює `message` в clipboard.
- Кольори: `error → signal-alert`, `warn → signal-warn`, `info → primary`.
- Mount: один глобальний `<ToastRail />` у `OperatorLayout` body.

### Backend reflection-cap

`src/backend/agent/loop.py`, у місці запису reflection (зараз ~line 419):

```python
# Auto-pause guard: identical revise_strategy on same step_idx → loop.
if ref.verdict == "revise_strategy":
    if (self._last_revise_step == step_idx and
        self._last_revise_verdict == ref.verdict):
        self._revise_loop_count += 1
    else:
        self._revise_loop_count = 1
    self._last_revise_step = step_idx
    self._last_revise_verdict = ref.verdict

    if self._revise_loop_count >= 5:
        logger.warning(
            "Auto-pause: %d consecutive revise_strategy at step %d",
            self._revise_loop_count, step_idx,
        )
        await agent_runtime.pause(
            task_id, reason="auto_reflect_loop",
        )
        return
else:
    self._revise_loop_count = 0
```

State `_revise_loop_count / _last_revise_step / _last_revise_verdict`
живе на інстансі orchestrator-loop, тому per-task ізольовано.

## Chrome density & collapse (system-wide)

### Принцип

Кожен сталий елемент chrome (StatusBar, AgentRoster, AgentCommandCenter
HUD, FloatingToolbar) має дві висоти — **compact** і **full** — і
особистий стрілочко-handle. Handle лежить на правому краю самого
елемента (для top-mounted) або на верхньому краю (для bottom-mounted).
Tap по handle перемикає стан.

Дефолт першого запуску: **compact для верхніх (StatusBar, Roster) +
collapsed для нижніх (HUD, Toolbar)**. Оператор уже бачив, що нижні
кнопки заважають — інверсія попереднього дефолту.

### Store

```ts
// src/frontend/src/stores/uiStore.ts (extend)
type ChromeKey = 'statusBar' | 'roster' | 'hud' | 'toolbar';

interface ChromeState {
  // true = compact (top) / collapsed (bottom). false = full.
  collapsed: Record<ChromeKey, boolean>;
}

const DEFAULT_CHROME: ChromeState['collapsed'] = {
  statusBar: true,
  roster:    true,
  hud:       true,
  toolbar:   true,
};

// Persisted to localStorage під ключем `phantom.chrome.v1`.
```

### Handle UI

Спільний компонент `<ChromeHandle position="top|bottom" collapsed=… onToggle=… />`:

- Розмір **44×24** (touch-safe), позиціонується абсолютно у правому
  верхньому куті свого елемента (для top-mounted) або в центрі
  верхнього краю (для bottom-mounted HUD/Toolbar).
- Іконка: `ChevronDown` коли compact → tap розгортає у full; `ChevronUp`
  навпаки. Для bottom — `ChevronUp` коли collapsed → tap піднімає HUD.
- Анімація: `framer-motion` height-transition 200ms `EASE_PHANTOM`, без
  layout shift content area (FocusPanel grow/shrink через
  `flex-1 min-h-0`).
- aria-label: `"Розгорнути <name>"` / `"Згорнути <name>"`.
- aria-expanded: `!collapsed`.

### Compact-режим — що ховаємо

| Елемент    | Full                                | Compact                                                  |
|------------|-------------------------------------|----------------------------------------------------------|
| StatusBar  | повна (час, місце, ROOT, ws, dot)   | час + одна dot-група status icons, без підписів          |
| Roster     | chip = dot + назва + статус         | chip = dot + icon, без тексту. Council = ⚖ icon-only     |
| HUD        | mic + textarea + run + 3 кнопки     | 12px handle smug з міткою "tap to send goal"             |
| Toolbar    | Timer/Alarm/Calendar/Files          | 12px handle smug                                          |

Перемикання HUD з collapsed → full **автоматично** при першому
натисканні shortcut Ctrl/Cmd+K чи фокусі на textarea через клавіатуру.
Toolbar — тільки ручний (рідко потрібен).

### Чому глобально, а не per-layout

OperatorLayout — найбільший пожирач простору, але інші layout’и
(`ShadowLayout`, `FocusLayout`, `DialogueLayout`, `SentinelLayout`,
`GhostLayout`) теж мають StatusBar + FloatingToolbar і теж страждають
від ~96px chrome-tax. Один `useChromeCollapse` hook обслуговує всіх.

Файл імплементації — окремий `src/frontend/src/hooks/useChromeCollapse.ts`,
експортує `(key, defaultCollapsed?) => [collapsed, toggle]`. Layout’и
підключаються однаково:

```tsx
const [statusBarCollapsed, toggleStatusBar] = useChromeCollapse('statusBar');
const [rosterCollapsed,    toggleRoster]    = useChromeCollapse('roster');
const [hudCollapsed,       toggleHud]       = useChromeCollapse('hud');
const [toolbarCollapsed,   toggleToolbar]   = useChromeCollapse('toolbar');
```

### Auto-collapse policies (тільки HUD)

- Після успішного `startTask` HUD згортається назад у handle через 1.5s
  (вільне місце для FocusPanel).
- При `awaiting_user` / `currentInfoNeed != null` HUD авторозгортається
  (бо оператор має ввести відповідь).
- При помилці `toast({kind:'error'})` HUD авторозгортається на 5s — щоб
  оператор бачив input та міг повторити.

Toolbar — без auto-policy. Тільки ручний toggle.

### Тести chrome-collapse

- `__tests__/useChromeCollapse.test.ts`
  - default state = всі `true`.
  - Toggle → `false`, повторний toggle → `true`.
  - localStorage write і read між монтуваннями.
- `__tests__/ChromeHandle.test.tsx`
  - Розмір ≥ 44×24, aria-expanded коректний.
  - Tap → виклик onToggle.
- `__tests__/OperatorLayout.test.tsx` (update існуючого)
  - `hudCollapsed=true` за дефолтом → input не видно.
  - Toggle HUD → input з'являється і отримує focus.
  - Після `startTask` HUD auto-collapse через 1.5s (vi.useFakeTimers).
  - При `currentInfoNeed` → HUD auto-expands.

### Файли — додаток до acceptance checklist

- [ ] `src/frontend/src/hooks/useChromeCollapse.ts` (new)
- [ ] `src/frontend/src/components/core/ChromeHandle.tsx` (new)
- [ ] `src/frontend/src/components/core/StatusBar.tsx` (compact mode)
- [ ] `src/frontend/src/components/core/FloatingToolbar.tsx` (collapsed mode)
- [ ] `src/frontend/src/components/agent/AgentRoster.tsx` (compact mode — у спеці вже є, додаємо handle)
- [ ] `src/frontend/src/components/agent/AgentCommandCenter.tsx` (collapsed mode + auto-policies)
- [ ] `src/frontend/src/__tests__/useChromeCollapse.test.ts` (new)
- [ ] `src/frontend/src/__tests__/ChromeHandle.test.tsx` (new)
- [ ] Update інші layout’и (ShadowLayout, FocusLayout, DialogueLayout,
      SentinelLayout, GhostLayout) — підключити `useChromeCollapse`
      для StatusBar+Toolbar. PlanTree/Roster — only в OperatorLayout.

## Data flow

```
useAgentStream (WS) ──► useAgentStore ──► selectors
                                          ├─► AgentRoster (chips)
                                          ├─► FocusPanel
                                          └─► Tape

useUIStore.focusedAgent ──► AgentRoster.aria-pressed
                          └► FocusPanel pivots view

submitGoal err ──► useUIStore.toast() ──► <ToastRail />

orchestrator loop emit reflection ──► loop-cap guard ──► pause if N≥5
                                                       └─► WS event
                                                          ──► Tape row
                                                              (dedup ↻N)
```

## Тести

Frontend (vitest + testing-library):

- `__tests__/AgentRoster.test.tsx`
  - 5 чіпів рендеряться з порожнього стора.
  - Клік на BG chip → `useUIStore.focusedAgent === 'background'`.
  - Aria-pressed true тільки на активному.
- `__tests__/Tape.test.tsx`
  - 10 однакових reflection → 1 рядок з `↻10`.
  - Різні verdicts не зливаються.
  - Tap expand → рендерить 5 sub-rows.
- `__tests__/FocusPanel.test.tsx`
  - focusedAgent='foreground' — показує goal + subgoals.
  - focusedAgent='background' з заповненим `progressByTaskId` —
    показує bg-progress monologue.
  - focusedAgent='standing_orders' з 2 enabled orders — рендерить 2 рядки.
- `__tests__/OperatorLayout.test.tsx`
  - Layout містить StatusBar + Roster + FocusPanel + Tape + HUD.
  - Logic Stream / Event Log секцій більше немає.
  - При errorToast у store — `<ToastRail>` показує `role="alert"`.

Backend (pytest):

- `tests/agent/test_loop_revise_cap.py`
  - 4 поспіль revise_strategy на step_idx=0 → task ще `running`.
  - 5-та → task стає `paused`, paused_reason='auto_reflect_loop'.
  - Зміна step_idx до 5-ї → лічильник скидається.
  - Зміна verdict на `continue` до 5-ї → лічильник скидається.

## Міграція / rollout

Single PR, без feature-flag. Заміна OperatorLayout body — атомарна.
Старі модалки лишаються. Backend cap — additive, без зміни існуючих
шляхів.

Перевірка перед merge:
1. `npx vitest` у `src/frontend` — green.
2. `pytest` у `src/backend` — green.
3. Manual: запустити dev, відкрити `/operator` (default route), submit
   goal, побачити foreground chip активний, Tape отримує події, при
   симуляції 5×revise_strategy task паузиться.

## Файли (acceptance checklist)

- [ ] `src/frontend/src/components/agent/AgentRoster.tsx` (new)
- [ ] `src/frontend/src/components/agent/FocusPanel.tsx` (new)
- [ ] `src/frontend/src/components/agent/Tape.tsx` (new)
- [ ] `src/frontend/src/components/core/ToastRail.tsx` (new)
- [ ] `src/frontend/src/hooks/useStandingOrdersHeartbeat.ts` (new)
- [ ] `src/frontend/src/stores/uiStore.ts` (extend: focusedAgent + toast API)
- [ ] `src/frontend/src/layouts/OperatorLayout.tsx` (rewrite body)
- [ ] `src/frontend/src/components/agent/AgentCommandCenter.tsx` (error handling)
- [ ] DELETE: `BackgroundTaskCardMount`, окрема Logic Stream / Event Log section in OperatorLayout
- [ ] DELETE old: usage of `<DecisionCard />` inline у OperatorLayout (компонент-файл може лишитись для модалок)
- [ ] `src/frontend/src/__tests__/AgentRoster.test.tsx` (new)
- [ ] `src/frontend/src/__tests__/Tape.test.tsx` (new)
- [ ] `src/frontend/src/__tests__/FocusPanel.test.tsx` (new)
- [ ] `src/frontend/src/__tests__/OperatorLayout.test.tsx` (update)
- [ ] `src/backend/agent/loop.py` (auto-pause guard, ~15 LOC)
- [ ] `src/backend/tests/agent/test_loop_revise_cap.py` (new)

## Відомі ризики

- Standing Orders читання — окремий REST polling раз/10s. Якщо REST
  endpoint відсутній → потрібен новий `/agent/standing_orders/state`
  (перевірити перед стартом implementation).
- Proactive heartbeat зараз приходить через `agent.stream`. Якщо
  WS-канал нестабільний на Radxa — Roster chip показуватиме застарілий
  `lastCycleAt`. Mitigation: timer "X хв тому", fade колір.
- Loop-cap (`>= 5`) — ризик false positive, коли валідний strategy
  цикл правда триває (наприклад, агент послідовно revise → continue →
  revise). Тест `test_loop_revise_cap.py` має ловити reset на `continue`.

## Out-of-scope follow-ups (окремі PR)

1. **Gemini Pro 2.5 tool-schema fix** — root cause 400 INVALID_ARGUMENT.
   Потрібен log capture реальної відповіді API + порівняння схеми, що
   надсилається, з 2.5 specs.
2. Опціональний flag `AI_GEMINI_MODEL=gemini-2.5-flash` у `.env` як
   тимчасовий work-around до root cause fix.
3. Аудит модалок Vault/Chat/Council/InfoNeed/PlanEditor/Report на
   «халтуру» — окремий sprint, поза цим PR.
