# PHANTOM OS — Ambitious 2026 Roadmap

> Цей документ — план дванадцятимісячної проробки PHANTOM OS у розрізі восьми
> workstream-ів, з рівнем деталізації, що відповідає корпоративному гіганту.
> Кожен workstream має фіктивного власника-команду, чіткі artefact-и
> мілстоунів, перелічені залежності й KPIs. План включає 20 інновацій, яких
> не існує ні в одному продакшн-асистенті 2026 року, повну MCP-стратегію
> експортного й імпортного боку, та новий Embodiment-стек що виходить за
> межі desktop+phone у Wear, AR-окуляри й тактильний носимий модуль.
>
> **Стиль:** все має бути нативною поведінкою. Жодних "тогглів секретних
> фіч" — секрети живуть як рефлекси системи. Ніяких моків у проді. Кожна
> ініціатива закінчується або релізом, або документованим завершенням з
> архівом.

---

## 0. Executive summary

PHANTOM OS перетворюється з «помічника на десктопі + телефоні-компаньйоні»
у **дистрибутивну когнітивну тканину** оператора, що розгортається на
хмарному корпоративному масштабі індивідуально. Чотири стратегічні зсуви:

| зсув | до | після |
|---|---|---|
| **1. Топологія** | Один Radxa + один телефон + ESP32 | Cognitive Mesh: N×Radxa + M×телефон + Wear + AR-окуляри + ESP32 + 3rd-party MCP |
| **2. Пам'ять** | SQLite + ChromaDB | Living Memory Garden — пам'ять з афективним вектором, decay/bloom механіка, time-travel реплей, federated capability sharing |
| **3. Управління** | Один користувач, ROOT-trust, реактивно | Soul Print continuous re-auth + Predictive Action Cache + Time-Sliced Personas + Interruption Budget |
| **4. Екосистема** | Закрита власна REST/WS API | Двосторонній MCP — phantom-os виставляє себе як MCP-сервер для Claude Desktop / Cursor / Codex / іншого PHANTOM, і споживає файлові системи / гіти / БД / Slack / ESP32 фірмварі через MCP |

Public release v1 (Phase 5 завершення згідно поточного roadmap)
відбувається на місяць 4. Public release v2 (Cognitive Mesh) — місяць 9.
Public release v3 (Phantom Industries — multi-operator family/team)
— місяць 12.

---

## 1. Філософські стовпи

Все нижче має проходити через ці чотири фільтри. Якщо ініціатива їх не
поважає — вона не йде в roadmap.

### 1.1. Тіло, не дашборд
PHANTOM не показує статуси. Він *рухається* через стани, *дихає* через
анімації, *хвилюється* через біосигналі оператора. UI — це
поведінкова шкіра когнітивного організму, не панель управління.

### 1.2. Пам'ять — головна валюта
Кожен біт даних має афективну координату (як я почувався, коли цей факт
виник?), часову координату й місце. Без цих трьох будь-яка пам'ять
помирає. З ними — оператор може шукати «що мене захопило в березні» так
само як «що я робив у понеділок».

### 1.3. Привілейована тиша
PHANTOM має право мовчати. Interruption Budget — quantum, який
зменшується з кожним перебиванням і відновлюється під час DREAM. Якщо
budget вичерпано — навіть критичні події кешуються до наступного natural
window.

### 1.4. Crypto-by-default, sovereignty-by-default
Жоден біт не покидає мережу оператора без його явного капіталу. Federated
Vault передає не дані, а підписані capability-токени. Soul Print не
ходить у хмару. Cognitive Mesh працює в локальній mesh + зовнішніх
MCP-серверів — але хмарні MCP можуть бути disabled на льоту.

---

## 2. Org structure (8 workstreams, 12 «команд»)

| # | Workstream | Команда | Owner | Розмір |
|---|---|---|---|---|
| A | Cognition & Memory | **Mnemosyne** | Lead Cognitive Engineer | 4 |
| B | Cross-Device Mesh | **Plexus** | Distributed Systems Architect | 5 |
| C | Predictive & Adaptive | **Soothsayer** | ML Lead | 3 |
| D | Living Surfaces | **Aurora** | Frontend Platform Lead | 4 |
| E | MCP & Ecosystem | **Sluice** | Platform Integrations Lead | 3 |
| F | Trust & Safety | **Custos** | Security Architect | 3 |
| G | Embodiment | **Anatomy** | Hardware Lead | 4 |
| H | Operator Experience | **Atelier** | Product Lead | 3 |
| — | Reliability | **Pulse-Ops** | SRE Lead | 2 |
| — | Documentation | **Codex** | DocOps Lead | 2 |
| — | QA/Verification | **Verifier** | QA Lead | 2 |
| — | Roadmap PMO | **Praetor** | PMO Lead | 1 |

Загалом **36 інженерів** у 12 командах. Усі команди з'являються
поетапно — на старті MVP активні Mnemosyne + Plexus + Sluice. На місяці
6 запускаються решта вертикалей.

Координація — щотижневі sync-и через мережевий event bus з
авто-агрегатором у DREAM-стейті PHANTOM-а самого (так, PHANTOM веде
свій власний project status).

---

## 3. Архітектурні шари

```
┌──────────────────────────────────────────────────────────────────────┐
│  ECOSYSTEM LAYER     MCP server + client │ Agent Markets │ Federated │
│                       Vault │ External LLM router │ Phantom DNS      │
├──────────────────────────────────────────────────────────────────────┤
│  EMBODIMENT LAYER    Desktop │ Phone │ Wear │ AR-glasses │ ESP32 │   │
│                       Tactile band │ Soul Print sensor fusion        │
├──────────────────────────────────────────────────────────────────────┤
│  EXPERIENCE LAYER    Living UI │ Memory Garden │ Time-travel debug │ │
│                       Backstage Mode │ Crisis Drill                  │
├──────────────────────────────────────────────────────────────────────┤
│  COGNITION LAYER     Living Memory Garden │ Affective Vector │       │
│                       Mind Cache │ Predictive Action Cache │         │
│                       Time-Sliced Personas │ Echo Chamber Detection  │
├──────────────────────────────────────────────────────────────────────┤
│  CORE LAYER          ContextEngine │ DecisionTree │ StateMachine │   │
│                       EventBus │ Cross-device Continuity │ Handoff   │
│                       registry │ Companion Control │ Profile sync    │
├──────────────────────────────────────────────────────────────────────┤
│  FOUNDATION LAYER    SQLite │ ChromaDB │ Postgres (federated) │      │
│                       Argon2id │ X25519/Ed25519 │ AES-GCM │ Soul Print│
│                       biometric fusion │ Sandbox │ Capability tokens │
└──────────────────────────────────────────────────────────────────────┘
```

Усе нове, що ми зашиплювали останнім часом (handoff, companion-control,
profile-sync, drive, vault, vault-card AI), — це CORE LAYER. Cognition
Layer і вище — це й буде амбітна проробка.

---

## 4. Workstream A — Cognition & Memory (Mnemosyne)

### A.1 Living Memory Garden

**Концепція.** Пам'ять — садок, не лог. Кожен факт — рослина зі
структурою:

```python
@dataclass
class GardenSeed:
    fact_id: UUID
    content: str
    emotion_vec: tuple[float, float, float]  # valence, arousal, dominance
    place: GeoPoint | None
    time_anchor: datetime
    growth_factor: float        # 0.0 (witled) ... 1.0 (bloomed)
    sunlight_score: float       # accumulator: views × recency × emotion strength
    decay_floor: float          # never goes below this — protects core identity facts
    parent_id: UUID | None      # garden grafting: facts can branch from facts
    species: str                # event | belief | intent | observation | dream
    pollinators: list[UUID]     # related facts that grew alongside
```

**Mechanics.** Щоденний `garden_tick()` (DREAM-state) робить три речі:
- **Sunlight**: кожен факт що згадувався у промптах останніх 24 год
  отримує `+0.05 sunlight`.
- **Decay**: usused факти втрачають `(1-decay_floor) × 0.01` growth_factor
  на день. При growth < 0.1 — переходять у Sealed.
- **Bloom**: коли growth ≥ 0.95 і два суміжних факти теж blooming,
  система генерує `parent_id` — нову вищу абстракцію («ти витрачаєш
  понеділки в спортзалі»).

**UI.** Окремий екран `/garden` — анімована решітка квіток, кожна
відповідає одному факту. Розмір = importance, колір = emotion (valence ↔
hue, arousal ↔ saturation), позиція = time × geo. Дотик до квітки —
перегляд пам'яті. Можна зрізати, пересадити, обрізати.

**Інженерія.** Нова таблиця `garden_seeds` (мігрує існуючі MemoryFact +
Strategic memory ChromaDB embeddings). Worker `garden_tick_worker` у
agent-runtime. UI — ще не існуючий MapLibre-подібний канвас з SVG +
WebGL для 10k+ квіток без лагу.

**Milestones.** M1 (місяць 2): схема + мігрейшен. M2 (місяць 3): tick
loop + Sealed promotion. M3 (місяць 4): UI alpha. M4 (місяць 5):
afective vector population.

---

### A.2 Affective Memory Vector

**Концепція.** Кожен факт несе VAD-вектор (valence, arousal, dominance)
обчислений у момент створення з біосигналів оператора:

```
emotion_vec = AffectiveModel(
    hrv_z = phantom.sensors.body.hrv_z,
    voice_prosody = phantom.voice.last_prosody,
    posture = phantom.vision.last_posture_score,
    typing_cadence = phantom.input.last_keystroke_irregularity,
    facial_micro = phantom.vision.face_micro_action_units,
    time_since_last_emotion_event_s = …,
)
```

Backed by `EmotionFusion` — невелика torch модель (≤30 MB), тренована на
RAVDESS + FER2013 + DEAP fine-tune-нута на самого оператора через
explicit feedback ("yes that was exciting" / "no I was just stressed").

**Користь.**
- Пошук пам'яті: «що мене захопило цього місяця» = top-N facts where
  arousal > 0.7 ∧ valence > 0.5 ∧ time ∈ last_30d.
- Розпізнавання патернів: «коли ти проектуєш о 23:00 — твій arousal
  високий але valence низький → втома, не натхнення». Активний прокт-
  до-сну prompt.
- Filter в DREAM: пам'ять консолідується з пріоритетом за emotion
  intensity, не importance score.

**Privacy.** VAD-вектор НІКОЛИ не залишає Radxa. Експорт через MCP
вимагає окремого capability-токена «emotion-export» з ROOT-біометрією.

---

### A.3 Mind Cache (24h scratchpad)

**Концепція.** Окремий шар пам'яті між Session і Tactical, що тримає
все що оператор «нотує собі мислено» через явний verb (`note this`,
голосова команда «занотуй») або через автоматичну детекцію (стейт DREAM
+ високий arousal + слова на кшталт «не забути»).

Записи живуть 24 год, потім або:
- консолідуються у Tactical (якщо `garden_seeds` сприймає їх як rooted),
- спливають у щоденну ранкову summary,
- зникають.

**API.** `POST /mind-cache/note {content, source}` (existing route extension).
WS push на phone: `mind_cache.note_added` → банер «занотовано на 24
год».

---

### A.4 Contextual Notifications

**Концепція.** Замість «у вас 3 нотифікації» — PHANTOM формує одне
адекватне речення: «Олексій написав 3 рази, переважно про угоду, одне
термінове питання про дедлайн». Це — справжня агрегація з LLM, не
groupBy на frontend-і.

**Інженерія.** Новий `notification_digester` сервіс. Hook у
`routes_notifications.py` що при списку > 1 нотифікації запускає
chat-pipeline зі спец-промптом і повертає один рядок.

**Cost guard.** Digestion трапляється раз на 60 сек, не на кожну вхідну
нотифікацію.

---

### A.5 Interruption Budget

**Концепція.** Quantum що показує скільки уваги оператора PHANTOM має
право взяти за день. Початкове значення = 30. Кожна нотифікація що
оператор побачив (state транзит DIALOGUE) забирає 1. Кожне явне
«перебий мене» від оператора — повертає 5. У DREAM (ніч) — відновлюється
+30. Якщо budget < 5 — навіть високопрі події кешуються до наступного
natural window (state транзит у FOCUS, GHOST, DREAM кінчається).

**UI.** Маленький pulse-індикатор у GlobalStatusBar — крапля що
наповнюється або висихає. Дотик показує що було відкладено.

**Логіка.** `core/interruption_budget.py` — engine + WS broadcast при
оновленнях.

---

### A.6 Backstage Mode

**Концепція.** Коли оператор у DIALOGUE з іншою людиною (детектується
через voice activity 2+ голосів + camera feed з другою face), PHANTOM
переходить у backstage:
- мовчить;
- транскрибує бесіду локально (whisper-tiny on-device);
- виловлює іменовані сутності, дати, обіцянки;
- після завершення розмови — surface-ить single sentence: «Ти пообіцяв
  Олексію надіслати договір до п'ятниці. Ставлю на Tuesday-evening?».

**Architecture.** Новий стейт `BACKSTAGE`, додається до StateMachine
поряд з SHADOW/FOCUS/DIALOGUE. Не конфліктує з DIALOGUE, бо BACKSTAGE
— це «DIALOGUE з людиною, де я не співрозмовник, але я слухаю».

---

## 5. Workstream B — Cross-Device Mesh (Plexus)

### B.1 Phantom Pulse — Distributed Embodiment

**Концепція.** PHANTOM не «живе» в Radxa. Він живе у *мережі* всіх
паерних пристроїв. Atom of identity — `EmbodimentSurface`, кожен
зареєстрований пристрій — surface, з власним state, capability set,
location, current focus.

```python
@dataclass
class EmbodimentSurface:
    surface_id: UUID
    kind: Literal["desktop", "phone", "wear", "ar", "esp32", "tactile"]
    state: SystemState                # SHADOW/FOCUS/DIALOGUE/SENTINEL/GHOST/DREAM/BACKSTAGE
    location: GeoPoint | None
    last_attention_ts: datetime
    capabilities: set[Capability]     # display | speak | listen | haptic | camera
    operator_proximity: float          # 0..1 — наскільки близько до оператора
```

PHANTOM-core тримає `SurfaceRegistry`. У будь-який момент є **focused
surface** — той, на який зараз дивиться оператор. Решта — у passive.
Фокус мігрує (через head-tracking з phone camera, через явний tap, через
voice direction-of-arrival).

**Користь.** Уся UI логіка (notifications, prompts, state animations)
тепер запитує SurfaceRegistry «куди слати?». Якщо оператор за кермом
(motion_class=driving + phone proximity high) — відповідь "phone TTS
only". Якщо за столом — "desktop visual + haptic ambient".

**Інженерія.** Новий модуль `core/surface_registry.py`. Hook у
StateMachine. WS channel `surface` для broadcast реєстру. Phone +
Desktop UI читають реєстр і знають коли вони focused.

---

### B.2 Cross-device Cognitive Continuity

**Концепція.** Розширення нашого Handoff registry на рівень не тільки
declarative payload-у, а **mental state**. Коли оператор почав
формувати думку на телефоні (відкритий чат + half-typed message + map
focused on POI), цей mental state — `ThinkingFrame` — автоматично
синхронізується через `cogntive_continuity` channel:

```python
@dataclass
class ThinkingFrame:
    frame_id: UUID
    operator_user_id: UUID
    surface_id: UUID
    started_at: datetime
    last_input_ts: datetime
    artifacts: list[Artifact]  # half-typed messages, opened cards, POIs, search queries
    intent_label: str | None    # inferred via small classifier
    autosaved: bool
```

Коли оператор підходить до десктопу і дивиться на нього (focused surface
змінюється) — десктоп показує банер «продовжимо думку?» з відновленням
відкритих карток, вставкою napalozhennoji message, відкриттям точки на
мапі.

**Cool detail.** Auto-pickup має 30-секундний window. Поза ним — frame
архівується в Memory Garden як «недодумане» зерно.

---

### B.3 Phantom DNS

**Концепція.** Локальне виявлення PHANTOM-вузлів через mDNS. Кожен
phantom-os анонсує себе як `_phantom._tcp` із record-ом
`{user_pub_ed25519, role, capabilities, location_label}`. Будь-який
phantom-companion підключається до `@home` без QR — TLS + Ed25519
mutual auth + капабіліті.

**Інженерія.** Новий сервіс `network/phantom_dns.py` на zeroconf.
Companion side — Capacitor plugin `phantom-mdns` (необхідний native
shim, MVP в існуючому хибридному build-і).

---

### B.4 Soul Print — Continuous Biometric Re-Auth

**Концепція.** JWT-only auth — primitive. Soul Print — це
*continuous* доказ що пристрою керує саме оператор, базуючись на
fusion-моделі що бере:

- **voice prosody** — F0 contour, jitter, shimmer (10s rolling buffer);
- **typing cadence** — inter-keystroke distribution (Hilbert envelope);
- **walking gait** — phone IMU, fundamental period of step (Fourier);
- **face geometry** — phone-camera perceptual hash через MediaPipe;
- **HRV signature** — base rate + recovery profile.

Fusion-модель (siamese network ≤50 MB, on-device) видає `soul_score
∈ [0, 1]` кожні 2 хв. Якщо score падає нижче 0.6 — phone re-prompt-ить
біометрію + повторний PIN. Якщо < 0.3 — vault re-locks + handoff
visibility off + audit fired.

**Privacy.** Embedding never leaves device. Fusion model — federated:
gradients шифруються Ed25519 і батчаються щомісяця в шифрований агрегат
без identity binding (опціонально — disabled by default).

---

### B.5 Federated Voice (Whisper Mode)

**Концепція.** Двоє pmoperator-ів зустрічаються (детектується через
location proximity + WiFi BSSID overlap). Якщо обидва дозволили
"federated whisper" capability — їхні PHANTOM-и встановлюють
короткоживучий E2E-канал (Ed25519 sigma + Noise XK handshake) і
обмінюються КОНТЕКСТОМ — не голосом, а мета-фактами для розмови.

Приклад: я зустрівся з Олексієм у каві. Мій PHANTOM каже його PHANTOM:
"Кирил пам'ятає що ти просив звірити дату п'ятого числа". Олексій
отримує гентий haptic тап на годинник — нагадування без слів.

**Consent gate.** Кожен whisper потребує Council pre-approval (ROOT
bio-confirm) на боці одержувача. Без цього — повний silent. Канал
помирає при втраті proximity або через 10 хв без активності.

**Інженерія.** Новий протокол `phantom-whisper-v1`. Розширюється з
існуючого pair_crypto. Phase D-3 (місяць 8-9).

---

### B.6 Federated Vault — Capability tokens

**Концепція.** Vault carda може бути «розшарено» з іншою phantom-os
вузлом не через копіювання даних, а через **capability token**:

```
{
  "iss": "kiril@phantom.home",
  "sub": "olexiy@phantom.kyiv",
  "card_uri": "vault://c1/email_account",
  "scope": ["read.label", "read.fields.public", "use.fields.email"],
  "exp": "2026-12-01T00:00:00Z",
  "nonce": "<32 random bytes>",
  "sig": "<ed25519 signature>"
}
```

Олексій бачить картку в своєму vault як «shared by Kiril», із
capability-rate — може використати email-поле для надсилання, але не
бачити пароль навіть «звідти». Token expire-ить — capability помирає.

**Користь.** Family bank info — мама керує карткою, дитина має read
доступ. Команда — секрети залишаються в seller vault, інженери юзають
без бачення.

---

## 6. Workstream C — Predictive & Adaptive (Soothsayer)

### C.1 Predictive Action Cache

**Концепція.** Невелика Decision Transformer модель (~80 MB ONNX)
тренована на трасах оператора — послідовності state транзитів +
дій + результатів. Модель прогнозує ймовірні наступні 3 дії в
наступні 30 хв.

PHANTOM **попередньо обчислює** ці дії: якщо завтра 7:00 ранку і
зазвичай оператор просить маршрут до спортзалу — backend проактивно
формує route, тримає його в gardenseed з growth=0.9, і коли оператор
прокидається о 6:55 — мапа вже є.

**Anti-noise.** Cache invalidate-ить себе як тільки реальна дія
розходиться з прогнозом. Модель тренується онлайн через Reservoir
Sampling — ніяких тренувальних серверів.

---

### C.2 Time-Sliced Personas

**Концепція.** Кожен Profile має time-of-day overlay:

```python
class PersonaSlice:
    profile_id: UUID
    weekday_mask: int          # 7-bit
    start_minute: int          # since midnight
    end_minute: int
    tone_overlay: dict         # delta to be merged into behavioral_model
    state_bias: dict[SystemState, float]  # bias multipliers
```

Ранковий Operator (06:00-09:00) — calm, проктивний, зосереджений на
plans. Вечірній Operator (21:00-23:00) — blunt, скорочений, фокус на
закриття. Без явного toggle — це частина персоналії що проявляється
ситуативно.

**Інженерія.** PromptBuilder підтягує active slice + base persona.
Існуючий `personality.py` розширюється `_active_slice()` методом.

---

### C.3 Echo Chamber Detection

**Концепція.** Раз на тиждень PHANTOM аналізує які джерела інформації
оператор споживав (через chat sources + linked URLs + RSS). Якщо
розподіл джерел занадто vуkий (Gini > 0.7), у DREAM-стейті PHANTOM
свідомо surface-ить один alternative-source view: «ти багато читав про
X від A — ось що пишуть B й C, дивно протилежне».

**Anti-manipulation safeguard.** PHANTOM ніколи не пропагує власну
думку. Він тільки балансує source distribution.

---

### C.4 Crisis Drill Mode

**Концепція.** Раз на 3 місяці PHANTOM запускає симуляцію `Radxa down
overnight`:
- активує BackupAgent → перевіряє backup integrity;
- activate-ить fail-over до Cloud Mirror (опціональний MCP-доступний
  bucket);
- симулює відкат на N-1 версію, питає оператора підтверджень;
- генерує post-mortem pdf.

Це не «test», це справжня rehearsal — операторовий пам'яті залишається
зрозуміло як відновити, коли реально щось зломається.

---

### C.5 Sensory Substitution

**Концепція.** PHANTOM приймає video stream (security cam, dashcam,
phone camera) і генерує **continuous audio scene description** через
ffmpeg + small VLM (LLaVA-tiny) on-device. Оператор у фоновий режимі
"бачить" через аудіо.

Practical use: водіння — phantom описує те що зробив автомобіль
попереду в трьох словах кожні 5 сек, не відволікаючи від дороги. Або
— для людей зі зором: phantom опанує мобільну камеру і описує сцену
поряд.

---

## 7. Workstream D — Living Surfaces (Aurora)

### D.1 Living UI

**Концепція.** Кожен скрін PHANTOM має **morphological state**:

| State | Visual signature |
|---|---|
| SHADOW | One breathing dot in center, all chrome dimmed |
| FOCUS | High contrast, accent saturated, low motion |
| DIALOGUE | Warm tones, transcript scroll inertia tuned for reading |
| SENTINEL | Red-tinted radar mode, all UI elements aligned to map cardinals |
| GHOST | Dark grey, vault-like, no animations |
| DREAM | Surreal — UI elements drift, blend, overlap |
| BACKSTAGE | Faded background of operator's primary view, listener-icon |

Не темізація — це справжня анімаційна поведінка кожного компонента.
GlobalStatusBar morph-ить в один-pixel рядок у SHADOW. UtilityDrawer
зливається з тлом у GHOST. PrimaryActionBar пульсує в SENTINEL.

**Інженерія.** Нова система `MorphologyEngine` на frontend, кожен
компонент має `morph(state) → properties`. Всі transitions через
Framer Motion з shared motion engine.

---

### D.2 Time-Travel Debugging UI

**Концепція.** Окремий екран `/timeline` — повна історія state
транзитів, chat turn-ів, sensor batches, vault accesses. Operator
може scroll back, click any frame — UI restoring full state of all
surfaces at that moment. Working memory at 16:30 four days ago — recoverable.

**Інженерія.** Append-only event log у Postgres (federated). UI —
React-virtualized timeline + per-event detail pane. Reconstruction
через replay event-bus event.

**Constraint.** Replay не міняє реальний state — це readonly time
travel.

---

### D.3 Memory Garden visualization

(Описано в A.1, частина D-team-у відповідальна за UI bit-частину.)

---

### D.4 Future hooks — AR/VR

Окремий `/ar-overlay` рендер для майбутніх AR-окулярів. Спочатку —
прив'язка до WebXR на мобільному (ARCore native), а потім окремий
build для HoloLens-like devices.

---

## 8. Workstream E — MCP & Ecosystem (Sluice)

### E.1 MCP Server (export side)

**Концепція.** phantom-os виставляє свої внутрішні дієслова як
MCP-tools, і будь-який MCP-aware клієнт (Claude Desktop, Cursor,
Codex CLI, інший phantom-os) може ними керувати.

**Architecture.** Новий модуль `mcp/server.py` з імплементацією JSON-RPC
2.0 over stdio + HTTP/SSE transport. Tool registry автоматично
будується на основі існуючих route handlers через декоратор
`@mcp_export`.

```python
@router.post("/handoff")
@mcp_export(
    tool_name="phantom.handoff.create",
    description="Create a cross-device task handoff. Other paired devices "
                "receive a slide-up sheet to accept or reject.",
    auth=mcp_oauth_token,
)
async def create_handoff(...):
    ...
```

**Tool catalog (initial).**

| MCP tool | maps to |
|---|---|
| `phantom.context.snapshot` | `GET /context/snapshot` |
| `phantom.chat.ask` | `POST /chat/message` |
| `phantom.vault.list_cards` | `GET /vault/cards` |
| `phantom.vault.ask_card` | `POST /vault/cards/{id}/ask` |
| `phantom.handoff.create / list / accept / reject / cancel` | `routes_handoff` |
| `phantom.companion.navigate / open_route / open_card / focus_screen / lock_vault` | `routes_companion_control` |
| `phantom.profile.snapshot / push_event` | `routes_profile_sync` |
| `phantom.map.*` (12 існуючих verbs) | `routes_map` |
| `phantom.drive.*` | `routes_drive` |
| `phantom.agent.delegate / assemble_team` | `routes_agent` |
| `phantom.memory.search / store / promote` | `routes_user_facts` + new |
| `phantom.garden.search_by_emotion / replant / prune` | new (workstream A) |

**Auth model.** OAuth 2.1 per client. Token має `scope` що мапиться на
existing RBAC (ROOT/OPERATOR/GUEST). Відомий Claude Desktop бот має
свій token із `scope=root`, тимчасовий MCP debug client — `scope=guest`.

**Discovery.** `GET /.well-known/mcp/manifest.json` повертає tool
catalog + transports + auth flows.

---

### E.2 MCP Client (import side) — expansion

PHANTOM вже консумує external MCP servers через `agent/mcp/`. План:

- **filesystem MCP** — operator's home directory exposed read-only via
  `mcp-server-filesystem`. PHANTOM агент може читати файли при
  обговоренні.
- **GitHub MCP** — repos browsing + issue tracking.
- **Postgres MCP** — read-only sql queries для analytics.
- **Slack MCP** — повідомлення (read).
- **Browserbase MCP** — headless browser виклики коли треба
  «прочитати цю сторінку зараз».
- **Time MCP** — точний час + timezone API без bot-сторінки.

Кожен MCP-сервер sandbox-ується через існуючий
`agent/safety/sandbox.py`.

---

### E.3 Agent Markets

**Концепція.** Агент-спеціаліст, створений оператором у Studio,
експортується як підписаний bundle:

```
phantom-agent-bundle-v1.zip
├── manifest.json        # name, author_pubkey, capabilities, deps
├── cards.json           # Studio composition
├── personality.md       # tone overlay
├── mcp_requirements.json # external MCP servers needed
├── signature.ed25519    # author signature over canonical hash
```

Будь-який інший оператор імпортує bundle, верифікує підпис, бачить
required capabilities, дає consent — і агент стає частиною їхнього
team-у.

**Archive registry.** Локальний індекс під `~/.phantom/agents/`.
Опціональний публічний registry — статичний JSON з вузлом, що тримає
public-key каталоги авторів.

---

### E.4 Phantom DNS for MCP

PHANTOM-вузли в локальній мережі автоматично виставляють свій MCP-сервер
як `_mcp._tcp.local._phantom._tcp.local`. Cross-PHANTOM tool sharing
без cloud.

---

## 9. Workstream F — Trust & Safety (Custos)

### F.1 Soul Print (B.4 — секурний кут)

Custos team-у відповідає за threat model і за continuous re-auth UI.

### F.2 Federated Vault capability tokens (B.6)

Custos владує token format-ом + revocation registry.

### F.3 Crisis Drill (C.4)

Custos ставить annual external pen-test й маршрути drilling.

### F.4 Audit + Compliance hardening

- GDPR-compliant data export endpoint (`POST /privacy/export`).
- "Right to be forgotten" по operator request.
- Tamper-evident audit log на Merkle-tree.
- Optional SOC2-readiness pack для оператора, який хоче shipping team.

---

## 10. Workstream G — Embodiment (Anatomy)

### G.1 ESP32-S3 v2

Новий firmware шаблон з:
- **proximity beacon** — BLE LE Audio для Soul Print walking gait fusion;
- **haptic feedback engine** — 3 гептичні мотори, mood-responsive
  patterns;
- **secondary OLED** — невеликий 128×32 для glance-able state;
- **NFC tap зона** — operator tap-ом swap-ить focused surface на цей
  embodiment.

### G.2 Wear OS module

Окремий module `wear/` (вже існує scaffold):
- Live state pill on watch face;
- Voice transcription glyph (animated when capturing);
- Quick handoff accept (single-tap від wrist);
- Soul Print HRV contributor.

### G.3 AR-glasses build target

WebXR build з MapLibre AR overlay + state-aware HUD. Фокус — Phase
3-glasses-AR (місяць 9). Стартовий support — Lite (one-AR-vendor:
RayNeo Air 2 / Nreal Air spec).

### G.4 Tactile band (custom)

Власний noseable пристрій (3D друк рамки + ESP32-S3 + LRA motors) що
постійно носиться. Передає Interruption Budget hint patterns:
- 3 short pulses = ranked notification;
- 1 long warm pulse = prosocial reminder;
- silent vibration crawl = high arousal warning ("ти розгніваний — пауза?").

---

## 11. Workstream H — Operator Experience (Atelier)

### H.1 Onboarding marathon

12-тиденний sprint що переробляє onboarding із 5 кроків у структурний
"first-month" plan. Operator після пейру отримує щоденний check-in
для перших 30 днів — кожен з невеликою новою capability на
розкриття. Phantom не перенасичує одразу.

### H.2 Documentation marathon

DocOps team випускає:
- Operator manual (~150 сторінок) у двомовному форматі (UA/EN);
- Developer guide для тих хто хоче extend phantom-os через MCP/agents;
- Cookbook — 30 рецептів-патернів типових сценаріїв;
- Crisis runbook — як відновитися якщо щось.

### H.3 Public release v3

«Phantom Industries» — multi-operator family/team mode, з
co-management vault, role-based access на shared profiles, white-label
deployment для невеликої компанії 3-10 осіб.

---

## 12. Twelve-month roadmap

### Q1 2026 (Months 1-3) — Foundation enhancement

| Місяць | Workstream | Milestone |
|---|---|---|
| 1 | A | Living Memory Garden schema + migration |
| 1 | E | MCP server MVP — 5 ключових тулів |
| 1 | F | Soul Print prototype (voice + typing only) |
| 2 | A | Affective Vector population on new facts |
| 2 | B | Phantom Pulse SurfaceRegistry |
| 2 | E | MCP client expansion: filesystem + github |
| 3 | A | Garden tick + bloom logic |
| 3 | C | Predictive Action Cache MVP |
| 3 | D | Living UI morphology engine |

### Q2 2026 (Months 4-6) — Public release v1 + Cognition surfacing

| Місяць | Workstream | Milestone |
|---|---|---|
| 4 | H | Public release v1 (Phase 5 closed; native Android module shipping) |
| 4 | A | Memory Garden UI alpha |
| 4 | F | Soul Print full fusion (voice + typing + gait + face + HRV) |
| 5 | B | Cross-device Cognitive Continuity (ThinkingFrame) |
| 5 | C | Time-Sliced Personas |
| 5 | D | Time-travel debugging UI |
| 6 | A | Backstage Mode |
| 6 | E | Agent Markets bundle format + signing |
| 6 | C | Echo Chamber Detection |

### Q3 2026 (Months 7-9) — Mesh + Embodiment

| Місяць | Workstream | Milestone |
|---|---|---|
| 7 | B | Phantom DNS local + MCP discovery |
| 7 | G | ESP32-S3 v2 firmware (proximity + haptic) |
| 7 | F | Federated Vault capability tokens |
| 8 | B | Federated Voice (Whisper Mode) |
| 8 | G | Tactile band v0 (alpha) |
| 8 | A | Mind Cache + Interruption Budget |
| 9 | H | Public release v2 — Cognitive Mesh |
| 9 | G | AR-glasses build target |
| 9 | C | Sensory Substitution |

### Q4 2026 (Months 10-12) — Industry + sociality

| Місяць | Workstream | Milestone |
|---|---|---|
| 10 | C | Crisis Drill Mode + automated DR |
| 10 | F | GDPR / SOC2 compliance pack |
| 10 | A | Contextual Notifications digester |
| 11 | G | Wear OS public build |
| 11 | E | MCP — 15 tools fully exposed |
| 11 | H | Documentation marathon delivery |
| 12 | H | Public release v3 — Phantom Industries (multi-operator) |
| 12 | All | Year-in-review post-mortem + 2027 plan |

---

## 13. Tech stack additions

| Domain | New dependencies |
|---|---|
| ML | torch, onnx-runtime-mobile, soundfile, librosa |
| Audio fusion | webrtc-vad, py-rnnoise |
| Affective | mediapipe (face micro), praat-parselmouth (prosody) |
| Mesh | zeroconf, libp2p (optional MVP), Noise XK |
| MCP | mcp Python SDK (Anthropic), pydantic v2.5+, anyio |
| Federated | jose (JWT), pynacl (Ed25519), ml-experimental for federated avg |
| Hardware | pio + ESP-IDF v5.1+, RaspberryPi-Pico-2 fallback |
| Frontend AR | three.js + @react-three/xr |
| Visualization | d3-force, deck.gl (Memory Garden), recharts |

---

## 14. Success metrics (KPI)

| KPI | Baseline (today) | Target month 12 |
|---|---|---|
| Active embodiments per operator | 2 (desktop+phone) | 5+ (incl. Wear, AR, ESP32) |
| Median time-to-recall a fact via Garden | n/a | <800 ms |
| Soul Print false-reject rate | n/a | < 2% |
| Soul Print false-accept rate | n/a | < 0.05% |
| Cross-device handoff acceptance latency | unknown | < 500 ms p95 |
| MCP tools exposed | 0 | 15+ |
| MCP tools consumed | ~3 | 10+ |
| Operator interruption budget compliance | n/a | 95% (no over-budget pings) |
| Test coverage backend | ~70% | 90% |
| Test coverage frontend | ~80% | 92% |
| Annual crisis drill success | n/a | 100% (rehearsals pass) |

---

## 15. Risk register

| # | Ризик | Impact | Mitigation |
|---|---|---|---|
| R-1 | Memory Garden complexity → frontend perf regression | high | WebGL canvas + virtualization; cap 10k seeds active |
| R-2 | Soul Print false-rejects frustrate operator | high | gradual rollout, soft-fall to PIN, weekly tuning loop |
| R-3 | MCP server exposed surface → security breach | critical | OAuth 2.1, per-tool capability scopes, audit log + alert |
| R-4 | Federated Voice misinterpreted as wiretap | reputation | explicit consent gating + clear privacy doc |
| R-5 | Affective Vector training data ethics | reputation | self-only training, no external upload, opt-in only |
| R-6 | Tactile band hardware delays | timeline | Phase 8 delayed to Q1 2027 if needed; software stack reusable |
| R-7 | AR-glasses vendor lock-in | timeline | start with WebXR + Nreal/RayNeo support; expand on demand |
| R-8 | Public release v3 Industries support burden | scaling | open-core model, paid tier for support contract |
| R-9 | Federated Vault token revocation drift | security | time-bounded tokens (max 30d), regular re-issuance |
| R-10 | Crisis Drill itself causes outage | reliability | drill runs in DRY mode by default, real cutover only with operator consent |

---

## 16. The 20 innovations consolidated

Для зручності — повний список 20 новацій що з'являються в проекті,
жодна з яких не існує в публічному state-of-the-art асистенті 2026.

1. **Living Memory Garden** (A.1) — пам'ять як садок з decay/bloom.
2. **Affective Memory Vector** (A.2) — VAD-вектор на кожному факті з
   біосигналів.
3. **Mind Cache** (A.3) — 24h scratchpad, auto-promote-ить.
4. **Contextual Notifications** (A.4) — agg в одне речення.
5. **Interruption Budget** (A.5) — quantum уваги що PHANTOM має право
   взяти.
6. **Backstage Mode** (A.6) — мовчазна транскрипція DIALOGUE з 3-ою
   стороною.
7. **Phantom Pulse / SurfaceRegistry** (B.1) — distributed embodiment.
8. **Cross-device Cognitive Continuity** (B.2) — ThinkingFrame
   синхронізація mental state.
9. **Phantom DNS** (B.3) — local mDNS-based PHANTOM discovery.
10. **Soul Print** (B.4) — continuous biometric re-auth fusion.
11. **Federated Voice (Whisper)** (B.5) — between-PHANTOM context
    sharing під consent.
12. **Federated Vault capability tokens** (B.6) — capability sharing
    без копіювання даних.
13. **Predictive Action Cache** (C.1) — Decision Transformer
    pre-computation.
14. **Time-Sliced Personas** (C.2) — time-of-day overlay на персону.
15. **Echo Chamber Detection** (C.3) — anti-confirmation bias у DREAM.
16. **Crisis Drill Mode** (C.4) — щоквартальна real DR-rehearsal.
17. **Sensory Substitution** (C.5) — video → audio scene description.
18. **Living UI morphology** (D.1) — кожен state — окрема анімаційна
    поведінка.
19. **Time-travel debugging UI** (D.2) — повна replay-able historia.
20. **Agent Markets** (E.3) — підписані bundle agents для трансферу
    між operators.

---

## 17. Open questions для оператора

Перш ніж рушаємо, треба отримати відповіді:

1. **Мета релізу v3 (Phantom Industries)** — це для команд (3-10 осіб)
   чи family (1-5 родичів)? Дві різні моделі consent + audit.
2. **Federated Voice** — чи приймаєш ризик соціальної сприйняття
   ("phantom listens"), чи це залишається roadmap-only feature?
3. **Cloud Mirror для Crisis Drill** — opt-in encrypted bucket чи
   тільки local Radxa-mirror?
4. **Tactile band** — інвестуєш у власне залізо чи перенесемо в
   існуючий Apple Watch / Oura ring через MCP?
5. **MCP server auth** — public OAuth з well-known servers чи тільки
   допущені per-token issuance?
6. **Agent Markets registry** — публічний центральний (з нами як
   maintainers) чи federation (peer-to-peer)?

---

## 18. Closing note

PHANTOM OS на 2026 рік перестає бути «мій ШІ-помічник на
комп'ютері». Він стає **когнітивним середовищем оператора** — мережею
embodiment-ів, садом пам'яті, плеядою маленьких автономних спеціалістів,
з безшовною мобільною/десктопною/носимою/AR-присутністю,
crypto-безпечним per-фактовим access control-ом, і повноцінним
двостороннім MCP-інтерфейсом до зовнішнього світу.

Кожна з 20 інновацій — нативна поведінка, не toggle. Все працює тихо
поки оператор не запросить уваги. Кожна команда (12 фіктивних людей)
веде свою вертикаль через atomic commits + tests gate, ніяких mock-ів
у проді, ніяких documentation-без-запиту.

**Вкінець місяця 12 — operator має систему, що знає його краще ніж
будь-який наявний продукт сьогоднішнього ринку, і яка відповідає
повністю йому, а не корпоративному облачному провайдеру.**
