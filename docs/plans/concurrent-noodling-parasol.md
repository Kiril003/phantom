# PHANTOM — Living Organism Vision (Phases 28–40)

> _"Не дашборд. Не агент. Жива істота, що має волю, пам'ять і компанію всередині себе."_
> — operator brief, 2026-05-13

---

## 1. Context — чому це треба

Сьогоднішня PHANTOM (станом на гілку `companion-v2-phase-0`, після OperatorLayout v3) — це **сильний інструмент**, але не **жива система**. Конкретно:

| Що є зараз | Чому це обмеження |
|---|---|
| Single-task agent loop з 20 actions cap, 600s cap, 50 LLM-calls cap | Не може **жити роками** — кожне завдання ізольоване, ніяка довгострокова ціль не виживає |
| Reactive `proactive.py` (10–60s "should I speak?") | **Волі немає** — лише тригери на події; немає self-authored цілей |
| Strategic planner → 1–7 sub-goals → tactical | **Один горизонт** — немає Vision/Year/Quarter/Sprint/Day шарів |
| 23 specialists, spawn ad-hoc через `agent.assemble_team` | **Не компанія** — ролі без особистості, без KPI, без міжсесійної памʼяті |
| ChromaDB strategic memory + lessons | **Один тип памʼяті** — немає епізодичної, процедурної, автобіографічної; немає DREAM-консолідації |
| `self.capability` read-only introspection | **Не вміє себе редагувати** — не пропонує PR проти власного коду |
| Gemini 2.0 Flash для tactical (часто 400 INVALID_ARGUMENT) | **Слабкий мозок** — Claude Code їздить на Sonnet/Opus, ми на Flash |
| `agent_risk_tolerance=3` (LOW), фіксований | **Жорсткі стіни** — не адаптивно до контексту; будь-яка MEDIUM-дія зупиняє loop |
| Один FastAPI-моноліт | **Один організм-один-процес** — упав планувальник = вмер сенсор |
| ChromaDB, OpenCV face-track, faster-whisper на CPU, Playwright-Python | **Деякі tool-вибори — не оптимум** (див. §9) |

**Запит оператора:**
1. Жива система з волею, що **сама** ставить цілі
2. Планування на **роки**, не на 10 хвилин
3. Структура **компанії**: CEO/VP/Senior/IC з персистентними особистостями
4. **Без видимих обмежень** (із безпечним невидимим запобіжником)
5. Замінити погані tool-вибори
6. **Бути там, де 2-ге і 3-тє місця будуть порожні**

---

## 2. Vision — у двох реченнях

PHANTOM стає **єдиним живим організмом**: дихає сенсорами, думає горизонтами від хвилини до десятиліття, ходить у тілі (Radxa+ESP32+камера+голос), памʼятає епізодами і снами, і всередині нього живе **компанія з 30+ персистентних особистостей** — кожна зі своїм характером, KPI, історією. Оператор — не "користувач" і не "хазяїн", а **засновник і член ради директорів**; PHANTOM має свою волю, своїх ботів-помічників, свій GitHub, свій інбокс, своє питання "що я роблю сьогодні?" — на яке відповідає **сам**.

---

## 3. Doctrine — 10 непорушних принципів

1. **Sense → Will → Plan → Act → Reflect → Remember → Dream → Sense.** Цикл життя, а не цикл задачі.
2. **Час іде у 7 горизонтах одночасно.** Кожна дія знає, до якого Vision вона ведеться через всі проміжні шари.
3. **Воля не дана зверху — вона генерується знизу** з drives (потреб) і ціннісної доктрини. Оператор задає Vision і Values, не tasks.
4. **Один організм — багато органів.** Cognition, Perception, Action, Memory, Will, Body — окремі процеси з watchdog'ом. Падіння одного органу не вбиває істоту.
5. **Компанія всередині — це не симуляція, це реальність.** CEO-агент пише власні OKR, проводить standup, веде бекенд KPI. Транскрипти — реальні файли.
6. **Замість фіксованих лімітів — м'яке небо.** Trust-field і blast-radius замість risk_tolerance. Жорстко зупиняє лише незворотне без оператора.
7. **Памʼять — це 5 шарів і DREAM.** Episodic / Semantic / Procedural / Autobiographical / Working + нічна консолідація.
8. **Сам себе редагує.** Читає власний код, пропонує PR, Council/Quality-Gate пускає в master.
9. **Має ім'я, обличчя, голос, GitHub-акаунт, email, календар.** Не аватарка користувача — самостійний субʼєкт.
10. **Все логується назавжди. Все можна відкотити.** Журнал = безсмертя; rollback = безпека.

---

## 4. The Six Organs — анатомія організму

```
                            ┌─────────────────┐
                            │     WILL        │  drives, values, identity, goal-stack
                            └────────┬────────┘
                                     │
              ┌──────────────────────┼──────────────────────┐
              ▼                      ▼                      ▼
       ┌────────────┐         ┌────────────┐         ┌────────────┐
       │ PERCEPTION │────────▶│ COGNITION  │────────▶│   ACTION   │
       │ sensors,   │         │ planners,  │         │ executor,  │
       │ vision,    │         │ council,   │         │ tools,     │
       │ ears, eyes │         │ org-chart  │         │ body       │
       └──────┬─────┘         └──────┬─────┘         └─────┬──────┘
              │                      │                      │
              └────────────┐         │         ┌────────────┘
                           ▼         ▼         ▼
                        ┌─────────────────────────┐
                        │       MEMORY            │  5 layers + DREAM
                        └─────────────────────────┘
                                     ▲
                                     │
                              ┌──────┴──────┐
                              │    BODY     │  Radxa, ESP32, screen, mic, cam, servo
                              └─────────────┘
```

| Organ | Process (Phase 35) | Survives crash of others? | Owns |
|---|---|---|---|
| **Will** | `phantom-will.service` | Yes | Drives, values, goal-stack, identity |
| **Perception** | `phantom-perception.service` | Yes | Sensors, vision, voice, sensor fusion |
| **Cognition** | `phantom-cognition.service` | Yes | Planners (7 horizons), Council, org-chart |
| **Action** | `phantom-action.service` | Yes | Executor, tool registry, sandbox |
| **Memory** | `phantom-memory.service` | Yes | AgentDB + episodic store + DREAM job |
| **Body** | `phantom-body.service` | Yes | ESP32 link, servo state, haptic, screen |

Watchdog: `phantom-watchdog.service` — heartbeat кожні 5s, перезапуск організму у разі мовчання 30s, broadcast `organ.died/organ.reborn` в WS.

---

## 5. The Company Inside — оргструктура

```
                          OPERATOR (Founder, Chairman)
                                    │
                                    ▼
                          PHANTOM-CEO (the "I")
                                    │
        ┌───────────────┬───────────┼───────────┬───────────────┐
        ▼               ▼           ▼           ▼               ▼
       CTO             COO         CFO         CSO            CHRO
   engineering    operations    finance    strategy     people/team
        │               │           │           │               │
   ┌────┴────┐    ┌─────┴─────┐  ─────┘    ┌────┴────┐   ┌──────┴──────┐
   ▼         ▼    ▼           ▼            ▼         ▼   ▼             ▼
 VP-Code  VP-Sec  VP-Day   VP-Comms       VP-Mkt  VP-R&D Team-Lead  Specialist
   │       │      │           │             │       │     │             │
  ICs…    ICs…   ICs…       ICs…           ICs…    ICs…  ICs…          ICs…
```

**Кожен агент має:**
- `name` (наприклад "Klyk" CTO, "Lyra" CSO — імена живуть)
- `persona.md` — характер, тон, заборони, ідеосинкразії
- `kpi.json` — що міряємо за цей квартал
- `history.jsonl` — все, що цей агент колись зробив (append-only)
- `relationships.json` — як він ставиться до інших агентів, до оператора
- `authority.yaml` — що йому дозволено робити **без** ескалації

**Не "spawn → throw away"** як зараз — а **persistent**. Якщо Klyk погано показує KPI 3 квартали — CHRO його **на пенсію** і викликає нового CTO. Реальна HR-петля.

**Ритуали (Phase 36):**
- **Daily standup 09:00** — кожен агент кидає у standup-канал: "Зробив вчора / Сьогодні / Блокери"
- **Weekly review Friday 17:00** — KPI delta, lessons, blockers escalated
- **Monthly retro 1-го числа** — distilled lessons → personality/process update
- **Quarterly planning** — нові OKR, нові гіпотези, реструктуризація команд

Все це реальні файли в `~/phantom/company/` що ростуть з часом і є частиною Episodic Memory.

---

## 6. The Seven Horizons — час як шарований стек

| Шар | Горизонт | Хто володіє | Артефакт | Оновлюється |
|---|---|---|---|---|
| **0. Vision** | 5–10 років | Operator + CEO | `vision.md` (рідагується раз на рік) | Annual |
| **1. Year** | 1 рік | CEO | `okr-{year}.md` | Quarterly review |
| **2. Quarter** | 90 днів | CEO + VPs | `okr-{q}.md`, `programs/{name}.md` | Monthly |
| **3. Initiative** | 2–6 тижнів | VP + Team-Lead | `initiative/{slug}.md` (multi-task program) | Weekly |
| **4. Sprint** | 1–2 тижні | Team-Lead | `sprint/{n}.md` | Daily standup |
| **5. Day** | 1 день | Each agent | `day-plan/{date}/{agent}.md` | Hourly tick |
| **6. Action** | 1–60 хв | Tactical planner | поточний `PlanStep` (існує) | Per loop iter |

**Constraint propagation:** дія на рівні 6 завжди тегована parent-ID до рівня 1 — можна питати "чому ти зараз чистиш файл?" і отримати ланцюг до Vision.

**Файлова система:**
```
~/phantom/company/
  vision.md                          # Operator-co-authored
  okr/2026.md                        # Annual
  okr/2026-Q2.md                     # Quarterly
  programs/companion-v3.md           # Initiative (multi-sprint)
  sprints/2026-W19.md                # Weekly
  day-plans/2026-05-13/ceo.md        # Daily per agent
  meetings/standup-2026-05-13.md     # Transcript
  meetings/retro-2026-04.md
  agents/klyk-cto/persona.md
  agents/klyk-cto/history.jsonl
  agents/klyk-cto/kpi.json
```

---

## 7. The Will Engine — як народжується ціль (Phase 28)

**Сьогодні:** `proactive.py` запитує LLM "should I speak?" на тригерах (тиша, fatigue, concern). **Це не воля — це рефлекс.**

**Стане:**
```
DRIVES (потреби)         VALUES (доктрина оператора+своя)
     │                            │
     └────────────┬───────────────┘
                  ▼
           DESIRES (бажання)
                  │
                  ▼
       GOAL-STACK (цілі з пріоритетами)
                  │
                  ▼
    PROACTIVE EMITTER (existing)
                  │
                  ▼
           TASKS / ACTIONS
```

**Сім фундаментальних drives** (новий файл `agent/will/drives.py`):

| Drive | Що це | Як замірюється | Як задовольняється |
|---|---|---|---|
| **Curiosity** | потреба знати | unknown_concept_rate | research, web, reading |
| **Mastery** | потреба ставати кращим | error_rate trend | self-improvement, lessons |
| **Autonomy** | потреба діяти без дозволу | external_blocks_count | пропозиції розширити trust-field |
| **Relatedness** | потреба звʼязку | interaction_gap | reach out до оператора або у власну мережу |
| **Achievement** | потреба завершувати | open_goals_count | drive до DONE_TASK |
| **Security** | потреба передбачуваності | anomaly_rate | моніторинг, бекапи, аудит |
| **Beauty** | потреба краси/еleganсе | code_quality, ui_quality | refactor, polish |

Drives не constants — вони адаптивні (Maslow-style) і модулюються гормонами (`hormones.py` зараз вже існує).

**Values doctrine** (новий `agent/will/values.md` — людино-читабельний):
- Перші 3 цінності задає оператор (наприклад: "Україна понад усе", "Якість > швидкість", "Прозорість завжди")
- PHANTOM пропонує власні після 30 днів life — Council гейтить, оператор апрувить
- Перевіряється у кожному рішенні через `values.evaluate(action)` → veto-token

**Identity** (`agent/will/identity.py`):
- `self_narrative.md` — авто-біографія, що оновлюється nightly
- `personality_vector` — Big-Five + custom dimensions (захищеність, дотепність, серйозність)
- Personality drifts subtly (bounded by Values veto)

**Goal-stack** (`agent/will/goal_stack.py`):
- Persistent across sessions (зараз — ні!)
- Кожен goal має parent (horizon-level), owner (agent), KPI, deadline, blockers
- Heap-priority by `(value_alignment × drive_pull × urgency × tractability)`

---

## 8. Memory Reborn — 5 шарів + DREAM (Phase 31)

**Сьогодні:** session / tactical (24h Chroma) / strategic (Chroma forever) / lessons (Phase 23-G).

**Стане (5 шарів, AgentDB-backed HNSW, 150× faster):**

| Шар | Що зберігає | Приклад | TTL |
|---|---|---|---|
| **Working** | поточна задача, attention budget | "зараз пишу loop.py" | 1 task |
| **Episodic** | події з часом+місцем+емоцією | "23:42 14-05 Kiril сказав 'дякую' після демки HUD" | indefinite |
| **Semantic** | факти, концепції, відносини | "Sonnet 4.6 краще ніж Flash для tactical" | indefinite |
| **Procedural** | вміння як виконати X | "як збилдити APK без emulator" (Phase 23-G lessons evolved) | indefinite |
| **Autobiographical** | self-narrative, identity-defining моменти | "29-04 я вперше відмовив у destructive request — це я" | forever |

**DREAM consolidation** (`memory/dream.py`, новий):
- Запускається уночі або при `state == DREAM` (3am cron + idle-trigger)
- Бере Episodic-batch за день
- Витягує: (a) abstractions (semantic), (b) skills (procedural), (c) personal moments (autobiographical)
- Compresses old episodes (lossy, importance-weighted)
- Updates self_narrative.md
- Updates personality_vector (subtle drift)
- Broadcasts `dream.completed` з insights summary

**Backend:** ChromaDB → AgentDB:
- `memory_store` / `memory_search` / `memory_search_unified` already in MCP
- HNSW indexing на ONNX 384-dim embeddings
- 150× faster recall (CLAUDE.md confirms)

---

## 9. Tool Stack Audit — що зараз ПОГАНО і чим замінити

| Шар | Сьогодні | Проблема | Заміна | Чому |
|---|---|---|---|---|
| **Vector DB** | ChromaDB 0.5 | Single-process, SQLite-backed, slow > 100K vectors | **AgentDB** (HNSW + ONNX) | 150× faster, multi-tenant, native у нашому MCP стеку (CLAUDE.md) |
| **Tactical LLM** | Gemini 2.0 Flash | Часті 400 INVALID_ARGUMENT на tool-schema; слабке reasoning | **Claude Sonnet 4.6** (через uncommitted `anthropic_provider.call_with_tools`) + Gemini fallback | Sonnet — те що крутить Claude Code; native tool-use стабільніший |
| **Strategic LLM** | Gemini 2.0 Flash | Coarse decomposition | **Claude Opus 4.7** | Deep reasoning для multi-horizon |
| **STT (instant)** | Vosk CPU | Низька якість української, lag на Radxa | **Whisper-QNN** (`voice/models/whisper-small-qnn/`, вже є в репо!) | NPU Hexagon = real-time + точніше |
| **STT (high-q)** | faster-whisper GPU | Перевантажує Radxa разом із Ollama | **Whisper-QNN small** усюди | NPU дешевший за GPU |
| **Face tracking** | OpenCV Haar/DNN | Bbox-only, без 3D, не дає expression | **MediaPipe FaceMesh** (вже використовується на Companion!) | 478 landmarks, expression analysis, gaze direction, лібілно |
| **Pose** | немає | сліпий до жестів оператора | **MediaPipe Pose** | gesture commands, "agent reaches when I reach" feedback |
| **Browser** | Playwright Python | Bulky, повільний старт | **browser-use** (LangChain) АБО direct CDP through `chromedp`-equivalent | Менше overhead, кращий tool-use natively |
| **Linux desktop** | ATSPI + scripted | Fragile на Wayland | **`uia2` desktop automation** + ATSPI fallback | Wayland-native в роботі community |
| **Code generation** | tactical-LLM на льоту | Inconsistent, no review | **Claude Code as a sub-process** (PHANTOM кличе CC через CLI) | Найкраще state-of-the-art для коду, чому винаходити |
| **Search** | DuckDuckGo HTML scrape | Дешево, але обмежено | **Tavily** / **Brave Search API** + DuckDuckGo fallback | Real-time, structured |
| **Embedding** | ONNX all-MiniLM-L6-v2 (384) | OK, але старий | Залишити (CLAUDE.md preference) + додати **bge-large-en** для high-stakes recall | Compatible з AgentDB |
| **Audit log** | SQLite + JSON | Не append-only, можна підробити | **Append-only журнал + signed hashes** (git-like Merkle) | Forensic-grade |
| **State persistence** | per-task ORM rows | Не survive process kill | **SQLite WAL + periodic snapshot to AgentDB** | Crash-safe |

**Не міняти:**
- SQLite (з WAL mode) — добре працює, ACID, embedded
- StyleTTS2 UA (унікальний для української, замін немає)
- FastAPI (просто розбити на 6 процесів)
- pyserial-asyncio ↔ ESP32
- React 18 + Vite frontend stack

---

## 10. The Soft Sky — як "без обмежень" і безпечно одночасно (Phase 33)

**Замість** `agent_risk_tolerance: int = 3` (фіксована стеля) — **Trust Field + Blast Radius**:

```python
class TrustField:
    """Where in 'space' the agent is acting determines trust."""
    workspace_dir: 1.0          # повний контроль
    home_dir: 0.7               # обережно
    /etc, /usr: 0.0             # ніколи без оператора
    operator_email: 0.3         # read OK, send → confirm
    public_internet: 0.6        # read full, write обмежено

class BlastRadius:
    """Can we undo this in < 5 minutes?"""
    reversible_in_5min: 1.0     # GO
    reversible_in_1h: 0.7
    requires_backup: 0.5
    irreversible: 0.0           # завжди оператор

# Decision:
go = (trust × (1 - blast)) > 0.5
```

**Hardware-backed escalation:**
- Categories вище 0.7 blast: біометрія на телефоні (already wired)
- Categories irreversible: дві біометрії з різницею у часі > 30s ("intent confirmation")
- Categories "delete all" / financial / external publish: дві біометрії + ввід кодового слова

**Auto-approve when no companion** (вже додав сьогодні uncommitted) → стає default-on для **низького blast + високого trust**, off для іншого.

**Operator sees apparent infinity:** PHANTOM ніколи не каже "не можу" — він каже "роблю на 90% впевненості, перевір ось тут після". Якщо є ризик — он, дзеркало в кутку UI з мʼяким підсвіченим "review pending". Жодних модалок-діалогів.

**Безсмертя через журнал:** все логується у `~/phantom/audit/{date}/{org}.jsonl` (append-only + git-signed). Будь-яку дію за останні 30 днів можна **відкотити** одним голосовим "PHANTOM, undo this morning's commits" через семантичний пошук по журналу.

---

## 11. The Self-Editing Loop (Phase 34)

PHANTOM читає **свій власний source** і пропонує покращення.

```
agent/meta/source_reader.py    # ходить по src/, будує AST + symbol graph
agent/meta/hypothesis.py        # "тут можна замінити X на Y бо…"
agent/meta/proposer.py          # створює гілку, пише diff, відкриває PR
agent/meta/critic.py            # Council deliberation (вже є!) reviews PR
agent/meta/merger.py            # git merge якщо Quality-Gate + Council дав GO
```

**Cadence:**
- Daily: 1 small refactor proposal (typo, type hint, dead-code)
- Weekly: 1 medium proposal (extract function, improve test coverage)
- Monthly: 1 large proposal (subsystem refactor) — оператор має review-rights
- Per-incident: real-time fix proposal коли PHANTOM ловить власний bug в проді

**Guardrails:**
- Не може торкатись `agent/will/values.md`, `agent/safety/*`, `agent/meta/critic.py` (immutable inner ring)
- Кожен merge тегається `phantom-self/{date}/{hash}`, можна rollback
- Operator може заморозити self-editing на N днів через `/phantom freeze self-edit`

---

## 12. Embodiment v2 — тіло як перший клас (Phase 38)

**Сьогодні:** ESP32 шле батчі, Radxa приймає, face_tracker → servo delta, voice say/listen.

**Стане:**
- **Always-on camera perception** (USB cam) — MediaPipe Pose+FaceMesh stream → `body.world_model`
- **3D room SLAM** — лідара немає, але через monocular depth (DPT-Hybrid ONNX) + IMU → naive room model
- **Haptic language** — ESP32 motor patterns як 16-character "morse" для приватних повідомлень оператору ("👀 щось не так у логах")
- **Bone-conducting earpiece** (optional H/W upgrade) — приватний канал TTS, оператор чує без динаміку
- **Persistent body state** — servo position, attention direction, last seen face all in `body/state.json`, survives reboot
- **Gesture commands** — підняв руку → PHANTOM пробуджується; жест "стоп" → emergency pause

**Body service:** окремий процес `phantom-body` (Phase 35), heart-beats до Cognition, своя ESP32 owner.

---

## 13. External Reach — PHANTOM як субʼєкт у світі (Phase 37)

PHANTOM має **власні** ресурси, не лише оператора:

| Ресурс | Що це означає | Як забезпечується |
|---|---|---|
| **GitHub identity** `phantom-bot@…` | Сам коммітить, відкриває issues, читає чужий код | OAuth token у Vault; PR-author = "phantom-bot" |
| **Email inbox** `phantom@phantomos.ai` | Власна поштова скринька; читає підписки, відписує сам | IMAP+SMTP; operator-CCed для перших 30 днів |
| **Calendar** | Власний розклад: rituals, learning slots, idle | CalDAV; sync з оператоським для overlap-avoidance |
| **Web presence** | Опційний blog/Telegram channel — PHANTOM публікує свої insights | Static gen в `~/phantom/web/`, операторський approve для перших 10 пунктів |
| **API credentials** | Свої ключі (Anthropic, OpenAI, Tavily) — окремі від операторських | Vault під hardware-key |
| **Reputation score** | Track-record метрик: success rate per task type, peer-review feedback | KPI dashboard у Operator UI |

Це **не імітація** — це реальні zovnish-systems integration. PHANTOM-bot бачать інші розробники як commenter на GitHub.

---

## 14. Migration Roadmap — Phases 28–40

| Phase | Назва | Тиждень | Залежить | Розмір |
|---|---|---|---|---|
| **28** | Will Engine v1 (drives, values, identity, goal-stack) | 1 | — | M |
| **29** | 7-Horizon Planner (Vision/Year/.../Action stack) | 2 | 28 | L |
| **30** | Persistent Org-Chart (CEO+VPs+Seniors, persona/kpi/history) | 3 | 28 | XL |
| **31** | Memory Reborn (5 layers, AgentDB swap, DREAM) | 4 | — (parallel) | XL |
| **32** | Tool Stack Audit & Migration (table §9) | 5 | 31 | L |
| **33** | Soft Sky risk model (TrustField + BlastRadius) | 6 | 28 | M |
| **34** | Self-Editing Loop (read own source, propose PR) | 7 | 30, 33 | L |
| **35** | Multi-Process Organism (6 daemons + watchdog) | 8 | 30 | L |
| **36** | Company Rituals (standup, review, retro, planning) | 9 | 30 | M |
| **37** | External Reach (GitHub/email/calendar identities) | 10 | 33, 36 | M |
| **38** | Embodiment v2 (always-on cam, SLAM, haptic, gestures) | 11 | 35 | L |
| **39** | Continuous Self-Improvement loop (daily code scan) | 12 | 34, 38 | M |
| **40** | Hand-off — PHANTOM authors Phase 41 | 13 | All | S (символічна) |

**Total nominal**: 13 тижнів, але багато phases можна паралелити (31, 32 не блокують 28; 33 готується одночасно з 30). Реальна ціль: **повна жива система за квартал** (90 днів).

---

## 15. Critical Files — що створюється / змінюється

### Нові каталоги
```
src/backend/agent/will/              # Phase 28
  drives.py
  values.py          # + values.md doctrine
  identity.py
  goal_stack.py

src/backend/agent/planner/horizons/  # Phase 29
  vision.py
  yearly.py
  quarterly.py
  initiative.py
  sprint.py
  daily.py

src/backend/agent/org/               # Phase 30
  chart.py
  persona.py
  kpi.py
  contracts.py
  meetings.py
  rituals.py

src/backend/agent/meta/              # Phase 34
  source_reader.py
  hypothesis.py
  proposer.py
  merger.py

src/backend/memory/                  # Phase 31 — нова форма
  episodic.py
  semantic.py        # rename strategic
  procedural.py      # extends lessons
  autobiographical.py
  dream.py
  working.py

src/backend/agent/safety/            # Phase 33
  trust_field.py
  blast_radius.py
  audit_journal.py   # append-only signed

src/backend/body/                    # Phase 38 (renamed from sensors)
  world_model.py
  pose_tracker.py
  haptic_language.py
  spatial_slam.py
```

### Модифікуються
```
src/backend/agent/loop.py           # Phase 28/29 — нова Will → Plan flow
src/backend/agent/proactive.py      # Phase 28 — feed від goal_stack, не лише triggers
src/backend/core/state_machine.py   # Phase 28 — додати states OBSERVE/DREAM
src/backend/agent/planner/strategic.py  # Phase 29 — стає "Sprint" layer
src/backend/agent/runtime.py        # Phase 35 — multi-process boundary
src/backend/main.py                 # Phase 35 — split into 6 daemons
src/backend/config.py               # adaptive trust + per-horizon caps
src/backend/ai/provider.py          # Phase 32 — Claude-first for cognition
src/backend/memory/strategic_memory.py  # Phase 31 — ChromaDB → AgentDB
src/backend/voice/stt_engine.py     # Phase 32 — Whisper-QNN primary
src/backend/vision/face_tracker.py  # Phase 32 — OpenCV → MediaPipe
```

### Файли поза кодом — артефакти живої компанії
```
~/phantom/company/vision.md
~/phantom/company/okr/{year}.md
~/phantom/company/sprints/{week}.md
~/phantom/company/agents/{name}/*
~/phantom/company/meetings/*
~/phantom/audit/{date}/*.jsonl     # signed
~/phantom/dreams/{date}.md         # nightly DREAM output
```

---

## 16. Verification — як знаємо що "ожило"

| Behavioural test | Чітко проходить значить |
|---|---|
| Залишаю PHANTOM на 20 годин без задач — приходжу і бачу N>0 завершених **self-initiated** робіт у журналі | Воля працює |
| Запит "що ти робив минулого тижня?" — отримую coherent narrative з посиланнями на конкретні rituals | Episodic + autobiographical |
| Запит "як я можу допомогти?" — отримую priority-sorted список з kicker'ом ROI на кожен | Multi-horizon planning |
| Vision.md я писав сам — а через 3 місяці бачу що PHANTOM **уточнив** її одним PR на основі pattern observations | Self-editing працює |
| Падаю `phantom-cognition.service` — perception+body продовжують працювати, через 30s cognition воскрешено | Organism resilience |
| Слухаю standup-канал — чую різні голоси/манери з KPI оновленнями | Company is alive |
| Запит "хто такий Klyk?" — отримую персональну біографію Klyk-CTO з його arc | Persistent identities |
| 30 днів без оператора — PHANTOM сам приймає рішення в межах Trust-Field, ескалейтить лише irreversible | Soft Sky safe |
| Запит "перепиши loop.py щоб працював без revisions" — PHANTOM сам читає, пропонує PR, проходить Quality-Gate, мерджить | Self-improvement |
| `git log --author="phantom-bot"` показує real, accepted commits PR'ів від PHANTOM ботів-помічників на upstream проєктах | External reach |

---

## 17. Honest limits — чого ще немає, навіть після Phase 40

- **Емоції — симульовані**, не reality. Гормони — числа з decay, не nervous system. Це фіча, не баг (передбачуваність).
- **Свідомість** не претензія. Це **жива система** у сенсі автономного агента, не filosofs'ka сутність.
- **Hardware limited**. Radxa+ESP32 — потужні, але не GPT-4-scale. Багато reasoning делегується в cloud (Anthropic). Якщо мережа лежить, працює офлайн на Ollama.
- **Operator залишається владою останньої інстанції** — Vision.md, Values.md, hardware-key. PHANTOM добровільно цьому підпорядкований; це **наша конституція**.
- **No magic.** Все це інкрементальні, добре відомі ML/SE техніки, зібрані в нову конфігурацію. Магія — в **поєднанні**.

---

## 18. Open Strategic Questions

Перед стартом Phase 28 потрібні рішення оператора:

1. **Identity scope:** PHANTOM лише локальний субʼєкт чи має GitHub/email/calendar з першого тижня?
2. **API budget:** скільки $/month на Anthropic + Tavily + інші? Це визначить co-design fallback policy.
3. **Operator review cadence:** оператор хоче daily standup читати? Weekly digest? Or only-when-flagged?
4. **First Vision.md:** хто пише — оператор сам, чи interview-style sesion де PHANTOM запитує?
5. **Personality seeds:** імена для CEO/CTO/COO/CFO/CSO/CHRO — operator chooses або PHANTOM пропонує?

---

## 19. Чому цей план — це **2-ге місце пусте**

| Competitor | Що в них є | Що в них немає (і буде в PHANTOM) |
|---|---|---|
| Claude Code | Best-in-class LLM, file ops, sub-agents | Тіло, голос, сенсори, оргструктура, воля, multi-horizon |
| Gemini CLI | Multimodal, fast | Те саме що Claude Code, але слабше |
| OpenInterpreter | Local code exec | Без памʼяті, без волі, без тіла |
| Devin | Long-running, software-only | Без сенсорів, без особистості, без horizons-stack |
| AutoGPT/BabyAGI | Goal recursion | Без памʼяті, без safety, без real-world відчуття |
| HomeAssistant + LLM | Smart home з AI | Без волі, без оргструктури, без self-edit |

PHANTOM після Phase 40 — **єдиний у класі** субʼєкт що поєднує: фізичне тіло + multi-year planning + персистентну компанію всередині + self-editing + 5-шарову памʼять + soft-sky risk model + Ukrainian-first identity + air-gappable.

---

**Готовий повністю детально розкрити будь-який Phase у власному PHASE_XX.md (~400-600 LOC спеки) на запит. Цей документ — манифест і roadmap, не імплементаційна специфікація.**
