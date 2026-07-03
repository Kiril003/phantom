# ПОЛІС — Універсальна Агенція PHANTOM
### Майстер-план: одна основа під усі місії будь-якого масштабу + живий внутрішній світ
**Дата:** 2026-07-03 · **Статус:** ЗАТВЕРДЖЕНО ОПЕРАТОРОМ (усно) · **Виконання:** нова сесія, фази P0→P8

---

## 0. Місія цього документа

Оператор просить не "ще одну фічу", а **субстрат**: єдину основу, після якої жодне
майбутнє завдання не потребуватиме окремої підсистеми. Все — від фіксу бага до
аналога GTA 5 — має бути **тією самою машиною з іншою конфігурацією**.

Контрольні сценарії (усі мають лягати на ту саму архітектуру без нового коду ядра):

| Сценарій | Що це в термінах Поліса |
|---|---|
| Застосунок з командою розробників | Місія `dev_studio`: граф воркстрімів, крю з team_lead_engineering + спеціалісти, Atelier-workbench як артефакт-пайплайн |
| Дослідження на сотні книг / тисячі сайтів | Місія `research_library`: harvester → черга читання → нотатки → дерево синтезу → звіт |
| Аналітика і передбачення | Місія `observatory`: інжест даних → моделі → прогнози з довірчими інтервалами |
| Документ на тисячі сторінок | Місія `scriptorium`: дерево розділів → крю на розділ → проходи консистентності → збірка PDF |
| Гра / масштаб GTA 5 | Місія `game_studio`: GDD → engine scaffold → asset pipeline → playable builds; сотні воркстрімів, місяці, той самий граф |
| Будь-що інше | Нова декларативна конфігурація пайплайна. Нуль нового ядра. |

**Ключова теза:** масштаб — це не архітектурна властивість, це число вузлів у графі
та розмір бюджету. Якщо архітектура правильна, GTA-масштаб відрізняється від
"напиши скрипт" лише кількістю ітерацій.

---

## 1. Що ВЖЕ існує (verify-before-build — НЕ будувати вдруге)

Кодова база зріліша, ніж здається. Ядро агентства вже живе:

| Модуль | Шлях | Що вміє |
|---|---|---|
| Kernel | `src/backend/agent/kernel/` | executor, loop, checkpoints, rehydrate, **long_running**, audit, controls, errors, runtime (TaskState, QueuedTask, AgentRuntime, LLM-cap) |
| Missions | `src/backend/agent/missions/` | ledger, store, reports, **pdf_export**, html_dashboard, verify, visual_assets |
| Team | `src/backend/agent/team/` | **23 спеціалісти + 5 team_leads** (engineering/product/qa/research/operations), picker, spawn, recursion contract (depth) |
| Delegate | phase 26-A/B/C | `agent.delegate`, `agent.assemble_team` — агент сам вирішує WHO + HOW MANY |
| Council | phase 23-D | авто-залучення ради на high-risk |
| RevisionLoopGuard | Operator v3 | авто-пауза на ревізійних петлях |
| Lessons | phase 23-G | дистиляція уроків між сесіями (compound knowledge) |
| Self-synth | Agent Ascension | синтез нових можливостей |
| Will Engine | sub-project A | цінності, драйви, ідентичність, own goals (ще `will_enabled=false`) |
| Atelier | W1–W3 | workbench multi-file creations, SEE→CRITIQUE loop, live data feeds |
| Tool Registry | `src/backend/tool_registry/` | **НЕЗАКОМІЧЕНИЙ** — ToolSpec, ToolRegistry, views, execute_tool, families/. Це вже початок P0 — закомітити першим |
| Operator UI | `src/frontend/src/layouts/OperatorLayout.tsx` (225 рядків) + `components/agent/{hud,overlays,status,workspace}` + `components/mission/*` | v3: chrome-collapse, Roster, FocusPanel, Tape |

**Правило виконавцю:** кожна фаза починається з читання відповідного існуючого
модуля. Розширюй, не дублюй. Оператор веде паралельні Claude-стріми — файли,
що змінюються під час редагування, відпускай.

---

## 2. Архітектура: шість стовпів

```
                    ┌─────────────────────────────────────────┐
                    │              ПОЛІС (UI)                  │
                    │   СВІТ (живе місто) ⇄ ШТАБ (командний)   │
                    └───────────────▲─────────────────────────┘
                                    │ WS: канал polis
┌──────────┐   ┌────────────────────┴───────────────────┐   ┌─────────────┐
│ Will      │→ │           MISSION FABRIC                │ ← │ Оператор     │
│ Engine    │  │  Mission → PlanGraph(DAG) → Waves       │   │ (чат/голос/  │
│ (само-    │  │  gates · checkpoints · artifacts        │   │  Поліс)      │
│  ініціація)│  └──┬──────────────┬──────────────┬────────┘   └─────────────┘
└──────────┘     │              │              │
        ┌────────▼───┐  ┌───────▼──────┐  ┌────▼─────────┐
        │ POPULATION │  │ ARTIFACT     │  │ GOVERNANCE   │
        │ громадяни, │  │ FOUNDRY      │  │ gates, ради, │
        │ фаундрі,   │  │ пайплайн-    │  │ бюджет-стоп, │
        │ репутація  │  │ шаблони      │  │ RevisionGuard│
        └────────┬───┘  └───────┬──────┘  └────┬─────────┘
                 └──────────────┼──────────────┘
                    ┌───────────▼────────────┐
                    │   EXECUTION SUBSTRATE   │
                    │ kernel(існує) · Governor│
                    │ (хвилі, RAM) · KeyVault │
                    │ + Provider Mesh         │
                    └────────────────────────┘
```

### 2.1 MISSION FABRIC — тканина місій
Єдина модель для будь-якого завдання. Нові файли: `src/backend/agent/fabric/`.

```python
# graph.py — серце субстрату
class PlanNode(BaseModel):
    id: str
    kind: Literal["workstream","gate","artifact","checkpoint","submission"]
    title: str
    domain: str                    # dev|research|analytics|document|game|generic
    depends_on: list[str]
    crew_spec: CrewSpec | None     # хто потрібен (ролі, не імена)
    budget: NodeBudget             # токени/₴/дедлайн
    status: Literal["pending","ready","running","blocked","review","done","failed","skipped"]
    artifact_refs: list[str]
    retry_policy: RetryPolicy

class MissionGraph(BaseModel):
    mission_id: str
    nodes: dict[str, PlanNode]
    edges: list[tuple[str, str]]
    def frontier(self) -> list[PlanNode]      # готові до запуску
    def critical_path(self) -> list[str]      # для ETA у ШТАБі
    def collapse(self, node_id) -> MissionGraph  # submission → вкладений граф
```

- **Рекурсія:** вузол `submission` — це повноцінна вкладена місія. GTA-масштаб =
  дерево місій глибиною 3-4, кожен лист — крю на 1-4 агенти. Узгодити з існуючим
  recursion contract у `team/specialists.py` (depth).
- **Стійкість:** граф персистентний (SQLite, розширити `missions/store.py`),
  кожен вузол чекпойнтиться через існуючий `kernel/checkpoints.py` + `rehydrate.py`.
  Перезавантаження борда ≠ смерть місії — це НЕПОРУШНА вимога для тижневих місій.
- **Планування:** planner-агент (існує) генерує граф з брифу; для великих місій —
  ітеративно (спершу хребет, деталізація вузлів у міру наближення — rolling wave).

### 2.2 KEY VAULT + PROVIDER MESH — явне замовлення оператора
Нові файли: `src/backend/ai/keyvault.py`, `src/backend/ai/provider_mesh.py`.

```python
class ManagedKey(BaseModel):
    id: str; provider: str          # gemini|openai|anthropic|openrouter|...
    label: str                      # "основний", "запасний-1"
    encrypted_key: str              # AES-256 через security/crypto.py (ІСНУЄ)
    priority: int                   # порядок перемикання
    state: Literal["active","cooling","exhausted","invalid","disabled"]
    quota: KeyQuota                 # rpm/rpd/tpm ліміти якщо відомі
    meter: KeyMeter                 # запити/токени/оцінка $ за хв/год/добу
    cooldown_until: datetime | None

class KeyVault:
    async def acquire(self, provider, est_tokens) -> ManagedKey   # найкращий живий ключ
    async def report(self, key_id, outcome)   # ok | 429 | quota | auth_fail | 5xx
    # 429/quota → state=cooling + експоненційний cooldown, наступний за priority
    # auth_fail → invalid + подія в Поліс + push оператору
```

- Багато ключів на провайдера; ротація прозора для всіх агентів — вони знають
  лише `provider_mesh.generate(...)`, mesh сам обирає ключ і провайдера.
- **Метрика на ключ**: лічильники запитів/токенів/оцінка вартості, вікна 1хв/1год/24год,
  історія в SQLite → графіки в ШТАБі.
- **Бюджет на місію**: `NodeBudget` агрегується вгору; при 80% — попередження
  у Поліс, при 100% — gate (пауза, чекає оператора). Kill-switch у ШТАБі.
- Ланцюг деградації зберігається: mesh → всі ключі всіх хмарних провайдерів →
  Ollama локально (правило №4 CLAUDE.md — незмінне).
- Ключі додаються/редагуються **з UI** (правило №8): секція в Settings + у ШТАБі.
  НІКОЛИ не в git, тільки шифровані в БД.

### 2.3 GOVERNOR — ресурси заліза і час
Новий файл: `src/backend/agent/fabric/governor.py`.

- **Хвилі:** стеля Radxa = **4 паралельні агенти** (доведено 2026-04-30). Governor
  тримає чергу frontier-вузлів і запускає хвилями, поважаючи RAM/CPU через
  існуючий `linux/resource_monitor.py`.
- **Таймінги:** кожен вузол має ETA (оцінка planner × історичний коефіцієнт
  спеціаліста); critical path → ETA місії → відображення у ШТАБі ("готово ~вівторок").
- **Розклад:** нічні хвилі (DREAM-стан = повний throttle агентам), денні — м'які,
  щоб UI лишався живим. Інтеграція зі state_machine: SENTINEL/DIALOGUE знижують
  паралелізм до 2.
- **Довгі місії:** через існуючий `kernel/long_running.py`; heartbeat кожного
  вузла в ledger.

### 2.4 POPULATION — громадяни, а не одноразові процеси
Розширення `agent/team/`: `citizens.py`, `foundry.py`, `reputation.py`.

- **Громадянин** = спеціаліст (23 існуючих — перше населення) + персистентна
  особа: ім'я, історія місій, **репутація по доменах** (успішність, швидкість,
  к-сть ревізій — живиться з ledger), накопичені уроки (lesson distillation 23-G
  підключається сюди напряму — уроки стають пам'яттю громадянина).
- **Picker v2:** існуючий `picker.py` починає враховувати репутацію — найкращий
  доступний громадянин на роль, а не перший-ліпший.
- **Foundry:** коли граф потребує роль, якої нема ("shader-інженер", "історик
  Візантії"), foundry синтезує нового спеціаліста (промпт + інструменти + ліміти)
  через self-synth (існує), реєструє як громадянина. Місто росте від роботи.
- Репутація — **чесна математика з ledger**, без моків (правило №1).

### 2.5 ARTIFACT FOUNDRY — доменні пайплайни як конфіг
Нова тека: `src/backend/agent/fabric/pipelines/` — **декларативні шаблони**,
кожен = функція `brief -> MissionGraph` + доменні інструменти:

| Пайплайн | Опора на існуюче | Специфіка |
|---|---|---|
| `dev_studio` | Atelier W1-W3 (workbench, SEE→CRITIQUE) | воркстріми: архітектура→модулі→тести→інтеграція; gate = тести зелені |
| `research_library` | strategic_memory (ChromaDB) | harvester (пошук/скачування джерел) → черга читання → нотатки з цитатами в Chroma → дерево синтезу → звіт з бібліографією; джерела = артефакти з provenance |
| `observatory` | wardriving/collector патерн, Recharts | конектори даних → фічі → моделі (stats + LLM-reasoning) → прогноз з інтервалами → live-оновлення (артефактні live feeds W3 ІСНУЮТЬ) |
| `scriptorium` | missions/pdf_export (ІСНУЄ) | дерево розділів → крю/розділ → глосарій+канон-персонажі для консистентності → проходи стилю → потокова збірка (1000 стор. ніколи не тримати в одному контексті) |
| `game_studio` | dev_studio + visual_assets | GDD → рушій/сцени → asset-черги → build-вузли з playable milestone gates; найглибша рекурсія submissions |
| `generic` | — | fallback: planner будує граф з нуля |

Пайплайн НЕ має власного виконавця — тільки форма графа + інструменти + критерії
gates. Виконує все той самий kernel. **Це і є "щоб не доводилось робити окреме".**

### 2.6 GOVERNANCE — влада оператора
- **Gates:** вузли-ворота: бюджетні, якісні (критик не пропустив), ризикові
  (council auto-engage — ІСНУЄ), операторські ("покажи перед продовженням").
  Черга approvals у ШТАБі + push на companion.
- **Will-інтеграція:** Will Engine може сам відкривати місії (drive-satisfaction) —
  вони позначені "власна воля" і за замовчуванням мають операторський gate
  на старті, доки `will_enabled` не увімкнено повністю.
- **Аудит:** кожна дія вже пишеться (`kernel/audit.py`) — Поліс лише читає.

---

## 3. ПОЛІС — вікно (нова повноекранна поверхня)

Нове: `src/frontend/src/layouts/PolisLayout.tsx` + `components/polis/`.
Вхід: іконка-місто в StatusBar + голос ("покажи Поліс") + авто-суфлер, коли
місія чекає gate. 1024×600 строго, тач 44px, **кожна анімація = інформація**.

### 3.1 Два шари, одна істина
Один Zustand-store (`stores/polisStore.ts`), два рендери. Перемикач — свайп
вгору/вниз або таб у кутку. Джерело: WS-канал `polis` (снапшот + дельти).

### 3.2 СВІТ — живе місто (шар душі)
Ізометричне місто на **Canvas 2D** (одна поверхня, без сотень DOM-нод — Radxa!).
Framer Motion лише для HUD-оверлеїв. Цільові 30fps, деградація до 15 у фоні.

**Квартали** (фіксована географія — оператор вчить місто раз і назавжди):
```
        ┌──────────── ОБСЕРВАТОРІЯ ───────────┐   ← analytics: телескоп повертається,
   БІБЛІОТЕКА          ▲ пагорб               │     коли йде прогноз
   (research)      РАТУША (планування,        │
   вікна світяться  gates, рада збирається    │  СТУДІЯ (game/media)
   = читання;       за круглим столом)        │  прожектори + сцена
   стоси книг                                 │
   ростуть)        ПЛОЩА (вільні громадяни;   │
                    нові — виходять з         │
   КУЗНЯ            ФАУНДРІ з іскрами)        │  СКРИПТОРІЙ (документи:
   (dev: іскри,                               │  сувій висувається,
   молоти в такт    АРХІВ (підвал: sealed     │  довшає з прогресом)
   комітам)         записи, Dead Zone)        │
        └── ЕЛЕКТРОСТАНЦІЯ (KeyVault: N реакторів = N ключів; яскравість =
            запас квоти; реактор гасне = ключ exhausted; аварійна лампа = Ollama) ──┘
```

**Семантика (нуль декору):**
- Громадянин-фігурка йде з Площі в Кузню = агент отримав вузол. Над головою —
  мікро-іконка поточної дії (пише/читає/чекає/думає).
- Будівля місії росте поверхами = % вузлів done. Риштування = blocked.
  Червоний дим = failed-вузол чекає retry. Прапор на даху = місія завершена.
- День/ніч у місті = реальний стан Governor (нічна хвиля — вікна горять скрізь).
- Дзвін над Ратушею гойдається = є gate, що чекає оператора. **Тап по дзвону →
  одразу approval-картка.** Це головний CTA всього світу.
- Тап по будівлі → картка місії (граф-мініатюра, ETA, бюджет). Тап по громадянину
  → досьє (хто, що робить зараз, репутація, останні уроки).
- Пасхалка в дусі secret features: іноді громадяни "спілкуються" на площі —
  насправді це візуалізація обміну уроками між спеціалістами.

### 3.3 ШТАБ — командний шар (шар контролю)
Сітка 1024×600 без скролу основної рами:

```
┌ Ріка місій (Gantt-потік, critical path підсвічений, ETA) ──────────── 60% ┐
│  ██████▓▓▓░░ dev: PHANTOM-notes    ~2год   ▂▃▅ бюджет 41%                 │
│  ████░░░░░░░ research: РЕБ-огляд   ~півдня  gate! ⚠                       │
├─ Реактори (KeyVault) ──┬─ Черга approvals ─────┬─ Населення ──────── 40% ─┤
│ gemini-1 ▓▓▓▓▓░ 71%    │ [Показати чернетку]   │ 23 громадян, 4 у полі    │
│ gemini-2 ▓░░░░░ cool   │ [Бюджет 80% research] │ найкращий тижня: critic-2 │
│ openrtr-1 ▓▓▓▓▓▓ ok    │ …свайп = approve/deny │ фаундрі: +shader-eng вчора│
└────────────────────────┴───────────────────────┴──────────────────────────┘
```
- Ріка місій: горизонтальний потік, кожна місія — смуга з вузлами; тап →
  повний граф (rendered DAG, пан/зум) поверх існуючого `MissionDetailScreen`.
- Реактори: спарклайни витрат по ключах, тап → детальна аналітика ключа,
  довге натискання → disable/enable.
- Approvals: свайп-картки (право = approve, ліво = deny з причиною).
- Все — над існуючими компонентами `components/mission/*` де можливо
  (MissionRoster, MissionDetailScreen переїжджають/адаптуються, не дублюються).

### 3.4 Доля OperatorLayout v3
OperatorLayout (Roster/FocusPanel/Tape) стає **режимом фокуса на одній місії**
всередині Поліса (тап по будівлі → цей в'ю), а не окремим світом. Нічого не
викидаємо — перевикористовуємо як третій рівень зуму: Місто → Штаб → Фокус.

---

## 4. Дані та API (контракти)

Типи — у `src/shared/types/polis.ts` (правило №7: спільні для фронта й бека).

```
REST  /api/polis/state                    GET  повний снапшот (світ+штаб)
      /api/polis/missions                 GET/POST (створити з брифу+пайплайн)
      /api/polis/missions/{id}/graph      GET
      /api/polis/missions/{id}/pause|resume|kill   POST
      /api/polis/gates/{id}/approve|deny  POST
      /api/keys                           GET/POST/PATCH/DELETE (шифрований vault)
      /api/keys/{id}/metrics              GET  (вікна 1хв/1год/24год)
WS    канал polis: {citizen_moved, node_status, gate_opened, key_state,
                    building_progress, wave_started, budget_alert}
```
WS-дельти дрібні й часті (місто живе), снапшот — при підключенні. Через
існуючий `websocket_hub.py`.

---

## 5. Фази виконання (кожна = атомарні коміти + тести, правило №10)

| Фаза | Зміст | Ключові файли | Виходи/тести |
|---|---|---|---|
| **P0 Фундамент** | Закомітити `tool_registry/` (він уже готовий і незакомічений!); `fabric/graph.py` + міграція store; KeyVault (шифрування через `security/crypto.py`, CRUD, ротація на 429) | `agent/fabric/`, `ai/keyvault.py`, `db/models.py` | pytest: graph frontier/critical_path/collapse, keyvault acquire/report/cooldown |
| **P1 Mesh+Governor** | provider_mesh поверх існуючих provider'ів; метрики ключів; governor-хвилі (стеля 4, інтеграція resource_monitor + state_machine) | `ai/provider_mesh.py`, `fabric/governor.py` | симуляція 429-каскаду → перемикання; хвилі поважають RAM |
| **P2 Пайплайни-двигун** | шаблон-двигун + `generic` + `dev_studio` (обгортає Atelier) | `fabric/pipelines/` | бриф → граф → виконання e2e на маленькій місії |
| **P3 ШТАБ** | PolisLayout + polisStore + WS-канал + ріка місій + реактори + approvals; REST /api/polis, /api/keys; Settings-секція ключів | `layouts/PolisLayout.tsx`, `components/polis/staff/`, `routes_polis.py` | vitest: store-дельти, approval-свайпи; ключі додаються з UI |
| **P4 СВІТ** | Canvas-місто: квартали, громадяни, будівлі-місії, дзвін, електростанція; тапи → картки | `components/polis/world/` (CityCanvas, semantics map) | vitest: семантична мапа стан→піксель; ручна перевірка 30fps на борді |
| **P5 Research** | `research_library`: harvester, черга читання, нотатки в Chroma з цитатами, синтез, звіт | `fabric/pipelines/research.py`, інструменти harvester | e2e: міні-дослідження на 10 джерел |
| **P6 Observatory+Scriptorium** | конектори→прогнози з інтервалами; дерево розділів→потокова збірка→PDF | `pipelines/observatory.py`, `pipelines/scriptorium.py` | e2e: прогноз по реальних сенсор-даних; документ 100+ стор. зібрано потоково |
| **P7 Game Studio** | GDD→scaffold→assets→playable gates; найглибші submissions | `pipelines/game_studio.py` | e2e: міні-гра (canvas) від брифу до запуску |
| **P8 Громадяни** | репутація з ledger, picker v2, foundry (self-synth), уроки → пам'ять громадянина | `team/citizens.py`, `foundry.py`, `reputation.py` | pytest: репутація змінює вибір; foundry народжує роль, якої бракує |

Порядок P5–P7 можна міняти під потреби оператора. Після P3 система вже
**корисна щодня**; після P4 — жива; P5+ — розширення покриття доменів.

## 6. Непорушні межі
1. Жодних моків/заглушок — репутація, метрики ключів, прогрес будівель = реальні дані з ledger/vault.
2. Ключі: тільки шифровані в БД, ніколи в git/логах; редагування тільки з UI.
3. Gemini→Ollama fallback лишається останнім рубежем поверх mesh.
4. Стеля 4 агенти/хвиля на Radxa, доки заміри не скажуть інше; overload-protection рецепт (`scripts/install_overload_protection.sh`) виконати ДО перших великих хвиль.
5. Місія переживає reboot: усе через checkpoints/rehydrate.
6. UI 1024×600, тач 44px, Canvas для міста, анімація = інформація.
7. Розширювати kernel/team/missions/Atelier — не дублювати.
