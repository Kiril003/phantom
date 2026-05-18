# PHANTOM Ecosystem — GRAND PLAN

> **Статус:** Цей документ розширює `MOBILE_ECOSYSTEM_VISION.md` (vision-філософія) і `companion-android/docs/ROADMAP.md` (фази мобільної реалізації). Це **deep-dive у конкретні амбітні можливості** екосистеми — не "що", а "як саме і чим це руйнує існуючі парадигми".
> 
> **Зв'язок з іншими документами:**
> * `MOBILE_ECOSYSTEM_VISION.md` — філософія + 13 розділів-каркас.
> * `companion-android/docs/ROADMAP.md` — фази мобільної реалізації Tier 1..4.
> * `PHANTOM_OS_GRAND_PLAN.md` (поряд) — що треба збудувати на десктоп-стороні.
> * Цей документ → **40+ конкретних capability-deep-dives** + cross-cutting інфраструктура + privacy-архітектура.
> 
> **Принцип:** Кожна capability має 4 поля — *Що це* / *Чому це руйнує парадигму* / *Технічний скелет* / *Tier+Phase mapping*. Жодних "ну колись будемо думати". Кожна — з виходом на конкретний phase у ROADMAP.

---

## 0. Філософія II — PHANTOM як живий організм

Якщо vision §1 каже "ШІ — це інтерфейс", то цей документ розгортає: **PHANTOM — це продовження твоєї нервової системи у цифрову та інтер-людську тканину**. 

- Кожен пристрій = периферійна нервова закінчення.
- Brain (Radxa / desktop) = довгострокова пам'ять + важка інтуїція.
- Pocket (phone) = свідомість у дії, активне сприйняття.
- Wrist + hearables + ambient = соматичні відчуття.
- Family Hive + friend ring = розширене Я через довірених людей.
- Life Log + Posthumous Familiar = пам'ять через десятиліття + спадкоємність.

Цей організм має **6 принципів**:

1. **Pre-emptive presence.** PHANTOM присутній ДО того як ти запитаєш.
2. **Privacy-by-geometry.** Доступ визначається тим *де* ти і *з ким*, не паролем.
3. **Continuous becoming.** Він постійно вчиться з усього що бачить — і ти можеш це переглядати.
4. **Trust mesh, not auth list.** Друзі/родина — не ACL, а живий граф з валентностями.
5. **Compute follows context.** Завдання тече туди де його дешевше виконати, без участі оператора.
6. **Ephemeral intimacy.** Тимчасові події (зустрів друга в кафе) лишають слід рівно стільки, скільки треба.

---

## 1. CAPABILITY ATLAS — 40 deep-dive фіч

### 1.1 — Auto-Discovery + Auto-Pair Multi-Channel

**Що:** новий PHANTOM-пристрій вмикається у мережі чи BT-діапазоні і підв'язується до твоєї топології автоматично, без жодного діалогу.

**Чому руйнує:** Apple HomeKit вимагає QR + manual approve. Google Cast — choose-from-list. PHANTOM — pristine seamless: пристрій вже знає що належить тобі через довірчий ECDSA-підпис від попереднього pairing.

**Технічний скелет:**
- mDNS `_phantom._tcp` advertise (backend `mdns_publisher.py` уже шипнутий).
- ECDSA-підписаний beacon у Wi-Fi Direct broadcast (256B payload з public key fingerprint + signed timestamp).
- BLE GATT service `0xPHA-NTOM-UUID` для near-range discovery.
- Sub-audible 18-22kHz beacon для room-level locality (Family Echolocation, см. 1.32).
- ContextEngine отримує `device.appeared` event → перевіряє підпис на trust graph → emit `device.linked` toast.
- Lost-and-found: `revoked_devices` table блокує auto-link після revoke; `dormant_devices` — зустрів через 6 місяців → auto-link але с UI-нотіфікацією "Pixel Buds повернулись після перерви".

**Tier:** §13 Tier 3, Phase 5-A (`:core-bridge`) + Phase 5-F (Family Hive).

---

### 1.2 — Compute Mesh з Per-Action Routing

**Що:** ContextEngine знає капабiліті всіх онлайн вузлів і **рутить кожну дію** туди де її дешевше/якісніше виконати.

**Routing matrix (база):**

| Intent | Кращий вузол | Fallback chain |
|---|---|---|
| `play audio` | active hearable (BLE) | phone speaker → ambient speaker |
| `show map` | largest active display nearby | phone → watch (mini-map) |
| `compute LLM small` | on-device Gemma | Brain (LAN Gemma 27B) → Gemini cloud |
| `compute LLM heavy` | Brain (Radxa) | Cloud Gemini Pro |
| `record video` | wearable cam (eyes-free) | phone | dashcam vehicle |
| `display alert` | nearest display + vibrate wrist + ambient flash паралельно |
| `face-recog crowd scan` | wearable cam → phone if absent |
| `geo navigation AR` | smart glasses → phone AR fallback |
| `voice clone reply` | Brain (full StyleTTS2) → phone (lite) → cloud as last resort |

**Технічний скелет:**
- `compute_router/` модуль на Brain: приймає `Intent`, дивиться на `device_topology.json` (live), повертає `Route(node_id, transport, fallback_chain)`.
- `cost_ledger/` тримає реальний вартісний баланс — час, энергія, мережа, токени cloud → транспарентно показано оператору ("за сьогодні 47k токенів Gemini = $0.42, 90% задач на Brain").
- Capability negotiation: device при appearance відправляє JSON capabilities — `{display: 1024x600, audio_in: 2, audio_out: 1, gpu: vulkan, llm_local: gemma3-2b, ar: arcore_v3}`.
- Token-burst budgeting: SENTINEL state дозволяє 3х cloud burst, GHOST — нуль cloud, DREAM — батч очікує до утра.

**Tier:** §13 Tier 3, Phase 5-D (Heavy Offloading) + Phase 5-A (Phantom Relay).

---

### 1.3 — Heavy Offloading з Контекст-Echo

**Що:** "Знайди готель у Карпатах, порівняй ціни, перевір погоду" — phone формує ТЗ голосом, перекидає на Radxa, та обробляє годину, пушить готовий звіт.

**Чому руйнує:** ChatGPT обмежений тривалістю одного діалогу. PHANTOM має RUN_TIME_HOURS, intermediate state у `task_journal/`, можливість підключатись у середині через будь-який пристрій.

**Технічний скелет:**
- `heavy_task_runner/` на Brain — приймає `Task(prompt, deadline, context_hash, priority)`, реєструє у SQLite з повним trail.
- Phone отримує `task_started` event → показує widget-картку у Stream "Карпати-research · 0%".
- Кожні 10хв progress update → widget оновлюється.
- Закінчено → push через Phantom Relay або FCM → Stream item з повним результатом + посилання на trail.
- **Context-echo:** ти питаєш phone "як там Карпати?" → phone бачить активний task → відповідає "47% готово, поки знайшов 12 готелів від $40 до $180, погода стабільна 0°C" — без додаткових запитів.

**Tier:** Phase 5-D.

---

### 1.4 — Always-Present Surveillance (consensual, opt-in per-channel)

**Що:** Familiar **бачить що ти робиш** через Accessibility API + чує нотіфікашки + бере дзвінки + аналізує screen content — ВСЕ continuously, але кожен канал opt-in.

**Privacy guard:** оператор бачить "audit ticker" — стрім реал-тайм що Familiar читає. GHOST state = всі канали off мить. SHADOW = тільки biometric + location.

**Технічний скелет:**
- `:feature-godmode/AccessibilityService` (Phase 3-A): hooks WindowManager → `AccessibilityNodeInfo` → topic-classify через on-device Gemma → emit `screen_topic` event.
- `:feature-godmode/NotificationListenerService` (Phase 3-B): single inbox → дедуплікація → priority sort.
- `:feature-godmode/IncomingCallHandler` (Phase 3-C): TelecomManager INBOUND → STT live → AI summary → Stream tile "Це кур'єр, біля під'їзду".
- Audit log:** усе що Familiar "побачив" пише у `:core-data` `audit_log` table з timestamp + source + topic. Operator може запитати "що ти бачив у TikTok о 14:30?" → отримати літеральну відповідь.

**Tier:** §13 Tier 2, Phase 3-A through 3-D.

---

### 1.5 — Continuous Behavioral Twin (ваш цифровий двійник)

**Що:** кожні 30s phone embed-ить твій поточний стан як 384-dim вектор — `(geolocation_quantized + screen_topic + biometric_band + intent_recent + audio_environment_class + state_FSM)` → локальний vector store.

**Магія:** "коли я був найбільш сфокусованим минулого тижня?" → семантичний пошук → "вівторок 14:30-16:00, при роботі з Stripe API, на dashboard з 3 windows відкритими, серцебиття 64-72". Без жодного manual log-у.

**Технічний скелет:**
- `:core-context/BehavioralTwinSampler` — runs as foreground task pet 30s interval.
- ONNX text embedding model (all-MiniLM-L6-v2 384d, ~22MB) — локальний.
- AgentDB-style HNSW index on phone (consume Tier 1.5 SQLCipher для encryption-at-rest).
- Querying — `temporal_memory.search(query, time_range, location_box?)` повертає top-k events.
- Privacy: ніколи не leave device. Cross-device (Brain mirror) — opt-in only.

**Tier:** §13 Tier 4, Phase 7-E (Life Log) — реалізую раніше у Tier 2 (Phase 3-D-extended) бо це foundational для багатьох інших фіч.

---

### 1.6 — Predictive Spawn (анти-pull UX)

**Що:** Familiar **готує widget-картки ДО того як ти попросиш**, на основі патерну.

**Сценарій:** виходиш з офісу 18:00 → phone бачить (geofence + history) — ти йдеш мимо продуктового → silent pre-fetch shopping list з vault → підходиш до магазину (50m geofence) → Watch tactile pulse + AR-overlay (на смарт-окулярах якщо є) "5 пунктів зі списку, ось маршрут по магазину". Жодного "відкрив apk → пошукав".

**Технічний скелет:**
- `:feature-godmode/TaskerEngine` (Phase 3-D) трекує — patterns по geo+time+intent.
- `predictive_spawner/` — periodic check кожен 1хв: "до події X (виходу з офісу, входу в магазин, прибуття додому) лишилось <Y хв" → run pre-fetch handlers.
- Pre-fetch handlers — declarative YAML у `predictive_recipes.yaml`:
  ```yaml
  - trigger: geofence.enter("grocery_store")
    pre_fetch_at: minus_5_minutes
    actions: [load_shopping_list, fetch_recipes_from_pantry, optimize_route]
    surface: stream + watch_tactile + ar_glasses_if_available
  ```
- Operator може **переглянути всі pre-fetches** ("сьогодні Familiar підготував 4 widget-и: 3 використані, 1 ні — TikTok-лінк до youtube-cooking"). Familiar вчиться з accept/dismiss.

**Tier:** §13 Tier 2, Phase 3-D + 3-E.

---

### 1.7 — Family Hive Trust Graph II

**Що:** vision §9 описує граф довіри з ролями (Self/Partner/Family/TrustedFriend/Acquaintance/Anonymous). Ми розширюємо до **n-вимірного графу довіри з контекстом**.

- Кожне ребро довіри має:
  - `relation_type` — partner / parent / child / friend / colleague / coach / contractor / neighbor
  - `trust_dimensions` — `{location: 0.9, calendar: 0.6, finance: 0.0, health: 0.4, vault_topics: ["home", "kids"]}`
  - `temporal_decay` — невикористаний trust згасає на 5%/місяць (re-confirm prompt)
  - `context_modifiers` — у GHOST стані всі ребра падають до 0; коли разом фізично, +0.2 на 1 годину
  - `audit_visibility` — кожен read записується у обох audit-log

**Емерджентні функції:**
- "доступ до моєї геолокації коли я в подорожі" — temporary auto-grant
- "фінанси мама бачить тільки коли загальна виплата лікарні" — context-trigger
- "колишній партнер (видалений) — стирає кеш миттєво + revocation broadcast усім paired"

**Технічний скелет:**
- `family_hive/` модуль на Brain + phone:
  - `family_members` SQLCipher table з ECDH per-edge keys
  - `trust_dimensions` JSONB column
  - `context_modifiers_engine` — runtime calc effective trust on read
  - `revocation_broadcast` — UDP-multicast у trust graph + cleanup worker
  - `audit_log_dual` — пише у обидва кінці edge

**Tier:** Phase 5-F.

---

### 1.8 — Posthumous Familiar (Inheritance Mode II)

**Що:** vault не просто snapshot для нащадків — **fine-tuned LLM на базі твоїх голосу/тексту/рішень**. Через десятиліття дитина може поговорити з тобою, почути голос (StyleTTS2 clone), запитати поради.

**Як це насправді працює — а не magical:**
- LoRA fine-tune Gemma 3-12B на корпусі твоїх text messages + voice memos + diary + life log.
- Voice clone — мінімум 30хв власного аудіо у quiet → StyleTTS2 personal voicebox.
- Personality preservation — explicit value statements, decision trail, "what would I say in situation X" Q&A pairs.
- Multi-sig handover — Shamir 3-of-5 trustees. Triggered by `death.confirmed` (legal death certificate hash + 2 trustee signatures + 30-day waiting period).
- Disclosure mandatory: УI завжди показує "✨ це симульована модель Бориса (помер 2058)".
- Recipient може поставити запитання + отримати відповідь, що звучить як ти. Не magic — машинне навчання.

**Чому руйнує:** Replika симулює рандомну особистість. PHANTOM посмертний Familiar — **навчений на твоєму реальному житті за 30+ років**. Це twoе фактичне продовження.

**Технічний скелет:**
- `posthumous_archiver/` модуль:
  - aggregator що kollects всі life log embeddings + voice samples + decision trails щодня
  - LoRA training pipeline (ondevice через MediaPipe Genai) — incremental кожен тиждень
  - Multi-sig vault `bequest.lock` що зберігає training checkpoints
  - `death.confirmed` handler — Telegram bot запит до 5 trustees → 3 підтверджують → 30-день window → automatic vault unlock for designated heir
- UI на Radxa + phone — "Спадкоємці" розділ у Settings:
  - Хто є trustees + які mocks
  - Хто є beneficiaries + який зріз vault їм передається
  - Test mode — "проговори зі мною в режимі симуляції" (current you talks to your future-bequest model)

**Tier:** Phase 7-F.

---

### 1.9 — Cross-Person Empathy Engine (privacy-preserving)

**Що:** партнерський PHANTOM знає що partner had stressful day → твій ділікатно нагадує "вона мала важкий день, можливо вечеря-без-питань допомогла б?".

**Privacy magic:** обмінюються тільки **valence** (positivity score) + **topic class** (work/relationship/health), без жодного content. Кожен Familiar лишає сирі дані у себе.

**Чому руйнує:** Apple Health просто показує статистику. PHANTOM intimate — **діє від твого імені проактивно**.

**Технічний скелет:**
- `empathy_relay/` модуль:
  - Output: `(timestamp, valence, topic_class, intensity)` що публикуем для opt-in trust-edge consumers
  - Input: subscribe на partner's stream → emit `partner_signal` events
  - Action mapper: `(partner_valence < -0.5 && topic_class == work)` → propose actions {скасувати плани, замовити їжу, мовчазний вечір}
- Settings — explicit opt-in per dimension (workmood/healthmood/financemood)

**Tier:** Phase 5-F (paralel з Family Hive).

---

### 1.10 — Familiar Council (multi-personality decision-making)

**Що:** для важливих рішень Familiar розщеплюється на 3 особистості що дебатують:
- **Strategic** — холодна довгострокова логіка
- **Creative** — alternative angles, what if
- **Empathetic** — людський фактор, partner+family вплив

Усі троє кажуть свою позицію, потім **синтез з висновком + альтернативами**.

**Сценарій:** "купити це авто за $25k?" — Strategic (бюджет, амортизація) + Creative (а може каршеринг 2 роки і e-bike?) + Empathetic (партнер хотіла кросовер для дітей) → Synthesis "якщо тримаєш > 4 років і важлива дитина, бери; якщо <2 років — каршеринг краще на $9k".

**Технічний скелет:**
- `familiar_council/` — orchestrator що визиває одну LLM 3 рази з різними system prompts (Strategic / Creative / Empathetic) → 4-й виклик synthesizer.
- Активується автоматично коли intent classifier детектує "important decision" (фінанси >$1k, life event, relationship choice, career move).

**Tier:** Phase 1-F+ (Generative Widgets) — реалізується як спеціальний widget type "council_card".

---

### 1.11 — Adversarial Layer (devil's advocate built-in)

**Що:** другий AI агент, чия єдина задача — **second-guess** Familiar's пропозиції перед тим як вони доходять до оператора.

**Магія:** ловить over-eager TaskerEngine triggers (що пропонує переноси які ти насправді не хочеш). Якщо Adversary VETO → propose не доходить.

**Технічний скелет:**
- `adversarial_layer/` — wraps кожен `propose_to_operator` call
- Виклик: small LLM (Gemma 3-2B) з system prompt "ти adversary, шукай слабкі місця у пропозиції X для оператора Y з історією Z"
- Threshold: якщо Adversary критика > 0.7 confidence → блокує + log "Adversary заблокував пропозицію A through reason B"
- Operator може переглянути блоки і обернути ("ні, проби пропонувати, я хочу")

**Tier:** Phase 3-D (TaskerEngine extended).

---

### 1.12 — Body Twin (continuous physical state)

**Що:** Garmin/Apple Watch HRV + ESP32 motion home sensors + bedroom presence sensor + voice tonality → **continuous physical reconstruction**.

Familiar помічає: "ти 4 години за столом, HRV впала з 52 до 41, voice тонус знизився, дозволь спланувати 15-мин прогулянку?". Не reminder — **co-pilot**.

**Технічний скелет:**
- `body_twin_aggregator/` (Brain) — fuses streams from Wear OS / Apple Watch / ESP32 sensors / phone biometric / voice analyzer
- Time-series store (InfluxDB or per-day SQLite tables)
- Anomaly detector — Z-score against personal baseline (not population)
- Action triggers — "HRV ↓ + immobile > 90min" → suggest break

**Tier:** Phase 2-E + 5-E + 5-F (cross-device).

---

### 1.13 — Location-Aware Memory ("що я тут робив торік?")

**Що:** на цьому конкретному GPS, що було тут раніше. **Не Spotify-style geo-tag** — а full context recall.

**Сценарій:** заходиш у кафе → AR overlay (smart glasses або phone screen) "🟡 ти був тут 3 рази, останній 6 місяців тому з Олею, замовляв капучіно, обговорювали її переезд". Один погляд — повний контекст.

**Технічний скелет:**
- Life Log items індексовані за GPS bucket (geohash 7-char ≈ 150m).
- Запит: GPS query → top-k items by relevance + recency.
- AR overlay — `ar_overlay_engine` поверх ARCore/ARKit малює мітки.

**Tier:** Phase 4-D + 7-E.

---

### 1.14 — Continuous Translation Layer

**Що:** Pixel Buds + ambient mics catch foreign language → real-time whisper-translation у твоїх earbuds. PHANTOM має повний контекст → розуміє idiom + cultural reference.

**Чому руйнує:** Google Translate мовить "пройшов через скляне небо" замість "відкривав другий вікно для свіжого повітря" (idiom). PHANTOM знає культурний контекст.

**Технічний скелет:**
- `:core-voice/StreamingTranslator` — `whisper-tiny → google-translate-api OR Gemini-translate → StyleTTS2 with original speaker's tone match`.
- Latency budget: <800ms кінець-у-кінець.
- Privacy — opt-in per-conversation; default off.

**Tier:** Phase 2-A + 2-B-2 + new Phase 4-F.

---

### 1.15 — Emotional Mirroring

**Що:** mics + biometric → детектять твій стан (anxious, angry, calm, playful) → Familiar **адаптує власний tone**.

**Сценарій:** ти сам, anxious — Familiar говорить тихіше, slower, з пом'якшенням. Збентежений — більш чітко, без двозначностей. Calm — може жартувати.

**Технічний скелет:**
- Voice analyzer (`:core-voice/EmotionDetector`) — pitch + tempo + jitter analysis з local ONNX model (~5MB).
- HRV from wearables — стрес індикатор.
- `personality.adapt(emotion_state)` — system prompt modifier ("respond gently and concisely, the operator is anxious").
- StyleTTS2 voice mode — softer prosody profile selection.

**Tier:** Phase 2-A + 4-A + new Phase 4-G.

---

### 1.16 — Phantom Proxy Identity (autoreply with you-clone)

**Що:** оператор делегує "присутність" Familiar на період. "Я в FOCUS до 18:00 → відповідай routine messages від мого імені, signed 'auto-reply by Familiar'".

**Сценарій:** колега пише "коли скасуємо мітинг?" → Familiar бачить твій календар + твою політику + знає свою trust-edge → відповідає "пересуну на завтра 11, ОК?", з explicit `🤖 Familiar`.

**Технічний скелет:**
- `proxy_identity/` модуль:
  - Policy DSL: "for колеги type messages, defer scheduling decisions to me; for partner — never autoreply"
  - LLM що генерує reply, плюс tag-stamps `🤖 Familiar`
  - Sender-side preview — "Familiar збирається написати X, [Allow / Edit / Hold]" з 60s timeout default-allow

**Tier:** Phase 3-B + new Phase 5-I.

---

### 1.17 — Smart Scheduling Negotiation (multi-PHANTOM)

**Що:** 2-3 family members' PHANTOMs negotiate behind-the-scenes. "тато 14-16, мама після 18, дитина 17:30-19" → **single optimal proposal 18:30-19:30**. Один tap згоди — заплановано.

**Технічний скелет:**
- `scheduling_negotiator/` — agentic loop:
  1. Collect availability windows from all participants' calendars
  2. Apply preferences (мама не любить пізно, тато не може у пробки)
  3. Optimization (minimize collective inconvenience, maximize together-time)
  4. Propose top-3 options
  5. Ping all participants with poll
- Inter-PHANTOM messaging через Phantom Relay (encrypted multicast у family hive)

**Tier:** Phase 5-F + 5-H.

---

### 1.18 — Sleep Stitching (DREAM state extended)

**Що:** ввечері Familiar **переписує день**: малі decisions, патерни, що подобалось/дратувало → **рекомендації на завтра** автоматично.

Не "todo list" а continuous gentle redirection. Ранок — orb breath calmer, AwakeningCard з "сьогодні TKR (вчора) показав що твоя енергія максимум 10:00-12:00, заплануй важкі дзвінки тоді".

**Технічний скелет:**
- DREAM-state trigger о 23:00 (sleep tracker) → `night_synthesis/` runner:
  1. Read today's life log items (top-50 by importance).
  2. LLM-summarize patterns: "ти 47хв TikTok після обіду, потім переходив 3 рази між проектами"
  3. Generate next-day suggestions — pre-fetched widgets (1.6 Predictive Spawn).
  4. Update behavioral_model.json з drift-corrected weights.
- Утром — Stream відкривається з 1 widget "брифінг ранку" що містить summary + 3 pre-staged actions.

**Tier:** Phase 5-G + new Phase 5-J.

---

### 1.19 — Phantom Network Effect (real-world meeting handshake)

**Що:** двоє paired-PHANTOMів у реал-світі (пройшли мимо BLE/UWB range): 3-секундний context-handshake → обидва Familiars **знають що зустріч відбулась** + ефемерний обмін context-snippets.

**Емерджентний benefit:** auto-follow-up nudges. "Ти 2 дні тому зустрів Олексу у кафе, він казав про job у Stripe, ти обіцяв надіслати свій CV — нагадую сьогодні?"

**Технічний скелет:**
- BLE/UWB peer discovery (kit-handshake): exchanging signed context-snippets через ECDH ephemeral channel.
- Context-snippet — `{topic_classes_recent, voice_mood, location_class, suggested_followups}`.
- Privacy: snippet sealed with both parties' public keys, expires 7 days, deletable on revocation.
- Familiar може створити "follow-up reminder" з knowledge "ти обіцяв X" — bound до actual conversation transcript якщо обидві сторони opt-in audio recording.

**Tier:** Phase 6-B (Proximity Drop) + 7-E (Life Log).

---

### 1.20 — Ambient Reality Theatre (shared sessions in physical space)

**Що:** 3+ trust-graph members у одному фізичному просторі → автоматичний "shared session" 2h:
- спільна нотатка
- shared "queue" (що замовляли в ресторані, що грали у плейлисті)
- split-bill prep
- однокористувальний AI-секретар на стіл (можна питати з будь-якого phone "сума?")

Закінчили — session evaporates, лишається 1 sparse memory у кожного у vault.

**Технічний скелет:**
- Detection: mDNS proximity або BLE peer discovery → `shared_session_detector` event
- Auto-prompt: "троє з твого trust ring тут — start shared session?"
- Shared CRDT store через Phantom Relay (Yjs-style merge)
- TTL = remaining-time-together estimate (30min after last device leaves vicinity → save sparse summary, drop session)

**Tier:** Phase 5-F + 6-C (Event Mesh).

---

### 1.21 — Conscious Bandwidth Budgeting

**Що:** Familiar знає що він interrupting тебе. Track daily "interruption budget" per state.

- FOCUS = max 2 interruptions/h (тільки emergency from family hive)
- DREAM = 0 interruptions
- DIALOGUE = unlimited (ти у режимі бесіди з Familiar свідомо)
- SHADOW = passive, batch до Stream, no push

Якщо TaskerEngine хоче propose 3-тю річ за годину FOCUS → defers to next state transition.

**Технічний скелет:**
- `interrupt_governor/` — приймає `propose(action, urgency)` → перевіряє budget + state → returns `allowed` / `defer_until_state_change` / `defer_n_minutes`.
- Daily "interrupt budget audit" у Stream щовечора.

**Tier:** Phase 3-D + state machine integration.

---

### 1.22 — Federated Curiosity (cross-plugin insight detection)

**Що:** два плагіни (Stripe finance + Garmin health) — Familiar помічає кореляцію: "HRV падає кожен раз коли revenue drop ≥15%" → propose auto SENTINEL коли наступний dip станеться.

**Чому руйнує:** жоден single domain app не побачить — фінансові app не дивляться на health, health app не дивляться на work patterns. PHANTOM cross-pollinates.

**Технічний скелет:**
- `cross_pollinator/` (Brain) — runs daily on aggregated plugin emissions.
- ML: simple correlation-finder (Pearson, Granger causality lite) на time series з кожного plugin.
- Significance threshold: |r| > 0.6 + p < 0.05 + lag direction reasonable → flag insight.
- Operator review: "знайшов: твій HRV ↓ через 2 дні після Stripe revenue ↓15%+ (50% прогнозу). Прийняти як trigger?"

**Tier:** Phase 7-A + 7-B.

---

### 1.23 — Federated Memory Reservoir (cross-friend memory share)

**Що:** trust-graph friends opt-in to share specific topic memories. "ramen places recommendations" → Familiar pulls from trusted friends' geo-tagged ramen experiences (з їхньою явною згодою), filters by your taste profile.

**Технічний скелет:**
- Per-topic share-enable: friend каже "так, можеш питати моїх Familiar про мої ramen experiences".
- Query routing: "де gооd ramen Київ?" → Familiar + asks friends' Familiars (federated query) → aggregates → ранжує.
- Privacy: friend's Familiar може **відмовити з тривіальних причин** (privacy, not in mood). Operator не бачить refuse, тільки результат.

**Tier:** Phase 7-A + 6-A (Anonymous P2P для query routing).

---

### 1.24 — Crowdsourced Familiar Intuition (federated learning §11 expanded)

**Що:** кожен Familiar вчиться на власних даних, але **shape of insight** через federated weights — без даних. "Ambiguous request classifier" тренується на ВСІХ paired PHANTOMах одночасно — кожен Familiar стає кращим з кожним новим оператором.

**Технічний скелет:**
- `federated_trainer/` (Brain) — secure aggregator + differential privacy noise.
- Daily local fine-tune on classifier head → push gradient delta (noisy) → server averages → push back updated weights.
- Operator opt-in per classifier: "intent_classifier" / "ambiguity_detector" / "emotion_classifier" — кожен toggle separately.

**Tier:** Phase 7-B.

---

### 1.25 — Memory Palace (AR spatial recall)

**Що:** life log memories мапляться на physical locations. "show me all conversations about ремонт" → AR overlay places memory bubbles in physical space (kitchen wall = home topics).

**Сценарій:** ховаєш окуляри ARCore → озираєшся → бачиш золоті bubbles на твоїй кухонній стіні: "12 січня · обговорював з Олею кахель · 3хв" + "8 лютого · сантехнік порадив plumbing X".

**Технічний скелет:**
- `memory_palace/` — geohash + room semantic anchor (kitchen / bedroom / office).
- Anchor через ARCore Cloud Anchors або ARKit Persistent World Map.
- Bubble rendering — Compose-equivalent 3D ARCore scene API.

**Tier:** Phase 4-D + 7-E.

---

### 1.26 — Temporal Awareness ("when" search)

**Що:** Familiar tracks **when** — voice, decisions, commitments. "що я обіцяв Олі минулого вівторка?" — works precisely.

**Магія:** semantic + temporal + speaker-aware search через voice memories archive.

**Технічний скелет:**
- Voice memo opt-in continuous capture (during awake states, not GHOST/DREAM).
- Whisper transcription → speaker diarization → embeddings.
- Query: "обіцяв Олі минулого вівторка" → narrow window (last Tuesday) + topic embedding ("commitment from me to Olya") → return transcript snippet + audio sample play button.

**Tier:** Phase 7-E + new Phase 4-H.

---

### 1.27 — Contextual Recipe Generator (Fridge IoT)

**Що:** Fridge ESP32 weight sensors per shelf + barcode scanner на дверях → Familiar know what's там → midnight: "знаю ти любиш мексиканське + у тебе 4 інгредієнти для тако з 5 — хочеш купити цибулю по дорозі додому?".

**Технічний скелет:**
- ESP32-Ambient-Fridge spec — weight sensors HX711 + barcode reader (cheap Honeywell USB) + camera оп ML Kit для visual count.
- Inventory snapshot publish → Brain `pantry_state.json`.
- Recipe gen — "чого вистачає для +1 ingredient max" — generates 5-10 candidates через Gemini.
- Predictive spawn (1.6) — geofence нагода gracery store → list of missing.

**Tier:** Phase 7-C (ESP32 Ambient).

---

### 1.28 — Proactive Defense (panic detection)

**Що:** phone у кишені детектує: "не рух 90s + різкий рух + тиша" → SENTINEL escalates до family hive immediate, opens emergency call, activates body cam if available, vibrates Watch override.

**Технічний скелет:**
- `proactive_defender/` — periodic anomaly check (accelerometer + audio mean RMS + heart rate spike).
- Pattern: `still_long → sudden_spike → silent` ≈ fall/attack signature.
- Pre-confirmation: 10s countdown watch buzz "цеSENTINEL alert. Скасуй якщо помилка." Якщо нема скасування → escalate.
- Emergency: GPS broadcast → 3 closest trust-graph + emergency call setup (one button).

**Tier:** Phase 5-G (Guardian) extended.

---

### 1.29 — Public API Voicebox (voice clone delegation)

**Що:** Familiar може **говорити ВІД ТВОГО ІМЕНІ** на phone calls (your voice via TTS clone). Schedule meeting, argue with bank, negotiate price. Транскрипт реал-тайм, ти можеш override single button.

**Disclosure mandatory:** receiver чує subtle audio watermark + Familiar identifies "це Олексій's AI assistant".

**Технічний скелет:**
- `voicebox_clone/` — fine-tune StyleTTS2 на 30хв твого quiet audio.
- Live call orchestration — Telecom OUTBOUND с PHANTOM як audio source.
- Streaming dialogue: STT input → Gemini reasoning з твоїм policy → StyleTTS2 output → телефонна лінія.
- Fail-safe: 2-секундна затримка перед speaking — даєш override window.

**Tier:** Phase 3-C + Phase 5-D + Phase 7-A.

---

### 1.30 — Diary by Default

**Що:** значимі events автоматично йдуть у Life Log без explicit save. Indexed semantically. Future you може "коли я останній раз говорив зі Стасом?" і отримати exact answer + transcript snippet.

**Технічний скелет:**
- Significance detector — `event_classifier` що ставить `importance` 0..1 на everything (calls > 5 min, location new, biometric spike, voice intensity ↑).
- Threshold > 0.6 → auto-add Life Log entry з тегами + transcript + biometric snapshot.
- Operator може **підняти/опустити** значимість retroactively.

**Tier:** Phase 7-E.

---

### 1.31 — Continuous Behavioral Model Updates

**Що:** кожна взаємодія з Familiar тонко налаштовує модель тебе. **Ніяких "reset" подій** — drift-detect для personality changes (нова робота → adjust focus patterns).

**Магія:** Familiar 5-річної давнини знає що ти любиш "пояснення з аналогіями", поточний — знає що тепер віддає перевагу "коротким bullet". Обидві версії доступні (Familiar Time Machine).

**Технічний скелет:**
- Per-interaction reward feedback (implicit: did operator follow up vs dismiss; explicit: thumbs).
- LoRA delta update через `behavioral_lora_trainer/` — щотижня.
- Drift detect — KL divergence between current behavior model + 30-days-ago snapshot. > threshold → "ти зараз веш себе інакше — чи це новий контекст?" prompt.
- Time machine — будь-який snapshot можна attach: "today, talk to me as Familiar 2023-Dec".

**Tier:** Phase 7-B.

---

### 1.32 — Family Echolocation (sub-audible beacon mesh)

**Що:** phone періодично шле sub-audible 18-22kHz beacon + listens. Mesh-trилaтерація без GPS / без BT-scan permission.

Кухонний tablet знає "дитина в спальні", "партнер у ванній". Без active polling, без GPS.

**Технічний скелет:**
- `:feature-ambient/Echolocator` — burst signed sine sweep 18-22kHz через speaker, listen mic для inverse signature.
- Trилaтeration через 3+ paired devices in proximity.
- Privacy — слухаємо тільки signed beacons trust-graph; ignore unknowns.

**Tier:** new Phase 6-E.

---

### 1.33 — Health Sentinel (early warning system)

**Що:** HRV trends + sleep + screen + voice tonality → flag potential issues weeks early. "три тижні твоя HRV trending down + voice втрачає warmth + sleep latency ↑ — варто подумати про doctor visit?".

**Технічний скелет:**
- `health_sentinel/` — multi-modal anomaly detector (NOT diagnosis — flag-only).
- Trends over 7/14/30/90 days, Z-score against personal baseline.
- Action: low-confidence flag → silent log; high → Stream notice "розмова з лікарем — варто".

**Tier:** Phase 5-G (Guardian) extended + Phase 4-A (vision).

---

### 1.34 — Cognitive Load Balancer

**Що:** detect mental fatigue (low HRV + slow reaction in app interactions + monotone voice) → auto-defer non-urgent → gentle redirect "сьогодні ти втомлений, перенесу 4 з 7 todos на завтра?"

**Технічний скелет:**
- `cognitive_load_estimator/` — combined signal (HRV + tap latency + voice prosody + screen-time-without-blink).
- Action: defer notifications, propose break, soft-state-flip до SHADOW.

**Tier:** Phase 3-D + 4-A.

---

### 1.35 — Negotiation Coach (live)

**Що:** під час phone call (з consent з обох сторін) Familiar listens → suggest counter-offer у твої earbuds.

**Сценарій:** ремонтник називає $400. Familiar шепоче в наушник "ринкова ціна $250-300, опитав 3 інших minute ago. Спробуй $280".

**Технічний скелет:**
- Live STT (Phase 2-A) → Gemini reasoning + RAG з price benchmarks → StyleTTS2 whisper до earbuds (sub-vocal channel).
- Privacy: opt-in per-call, both parties notified at call start.

**Tier:** Phase 4-C + Phase 7-A.

---

### 1.36 — Reality Anchor (anti-gaslighting commitment ledger)

**Що:** memorize commitments + decisions, ALL of them. Protect against memory holes.

**Магія:** "ти 6 місяців тому казав що проти переезду в Київ" → Familiar замітить розбіжність якщо тепер твердиш протилежне.

**Технічний скелет:**
- `commitment_ledger/` — кожне твоє "я обіцяю / я ніколи / я завжди" detected → logged with timestamp + context.
- Inconsistency detector: when current statement contradicts > 50% confidence prior commitment → silent flag для тебе ("Familiar помітив: 3 тижні тому ти казав X, тепер кажеш Y. Чи це усвідомлена зміна?").

**Tier:** Phase 7-E + Phase 4-A.

---

### 1.37 — Generative Skill Gym

**Що:** Familiar identifies skill ти хочеш розвинути → designs daily 5-min practice → tracks progress.

**Сценарій:** "хочу краще говорити англійською" → Familiar генерує щодня 1 challenge ("сьогодні: опиши свою кухню англійською 90 секунд, я перевірю граматику + accent"). Tracks progress over 30 days.

**Технічний скелет:**
- `skill_gym/` — skill graph + curriculum generator (Gemini-driven).
- Daily microlearning widget у Stream.
- Voice exercises through STT → analysis → improvement suggestions.

**Tier:** Phase 7-A (Plugin SDK для skills).

---

### 1.38 — Ambient Music Director

**Що:** знає твій state → curates audio environment. Plays melancholic post-grief tracks during DREAM, energy під FOCUS, calm для DIALOGUE.

**Технічний скелет:**
- `music_director/` — input: SystemState + biometric + location + recent emotions.
- Output: Spotify/Apple Music/local lib recipe.
- Routing through 1.2 Compute Mesh — ambient speakers if home, earbuds if mobile.

**Tier:** Phase 5-D + Phase 7-A.

---

### 1.39 — Inter-Phantom Negotiation Market

**Що:** твій Familiar negotiates with strangers' Familiars (e.g., booking agent, taxi dispatcher) — обидва protect their humans.

**Сценарій:** хочеш забронювати готель → твій Familiar зв'язується з готельським Familiar API → негоціює ціну, requirements, special conditions → повертає тобі final offer. Ти + accept/reject.

**Технічний скелет:**
- `inter_phantom_market/` — typed RPC over Phantom Relay public namespace.
- Standard "service Familiar" interface для businesses (rate-limited, signed responses).
- Trust scoring — service Familiars rated by trust-graph.

**Tier:** Phase 7-A (Plugin SDK) + Phase 5-A (Phantom Relay public).

---

### 1.40 — Generational Knowledge Transfer

**Що:** parent's Familiar quietly passes hard-won insights to teen's Familiar (з consent з обох). "у цьому районі їдь обережно", "цей лікар фальшивий", "у супермаркеті X дешевше у середу".

**Чому руйнує:** parents historically pass knowledge inefficiently — by saying it, hoping teen listens. PHANTOM передає фоном — teen's Familiar **діє** на основі цього без active reminders.

**Технічний скелет:**
- Parent marks insight: "share with kids when relevant" (тег у kid trust edges).
- Kid's Familiar consume insights as soft constraints у його local advisor.
- Audit log dual — parent бачить як kid's life-context перетинається з insight (e.g., "Іван проїхав через той район today — Familiar autonomously suggested slower drive").

**Tier:** Phase 5-F + Phase 7-B.

---

## 2. Cross-cutting infrastructure

### 2.1 Privacy Architecture
- **Zero-knowledge embeddings** — vector embeddings ніколи не leave device unless explicit consent + федералізація з noise.
- **Valence-only sharing** — partner stress emit `(valence, topic_class, intensity)` тільки.
- **Audit log dual** — кожен cross-device read writes у обох audit-log.
- **Revocation broadcast** — UDP-multicast у trust graph + cleanup worker що стирає кеш.
- **Multi-sig vault** — Shamir 3-of-5 для critical operations (inheritance, key rotation).

### 2.2 Phantom Relay 2.0
- WireGuard primary, chunked TCP fallback (CGNAT/корпорат).
- Bandwidth shaping — UI shows real-time bytes per channel.
- Redundancy — falls through 3 self-hosted relays if any down.
- Emergency override — works on 2G/EDGE for critical alerts only.

### 2.3 Cost Ledger
- Real-time tracker for compute/bandwidth/cloud-tokens cost.
- UI dashboard: daily spend per category, trends, anomaly alerts.
- Operator policies — "budget $5/day Gemini", auto-throttle when reached.

### 2.4 Trust Evolution
- Initial trust low → grows through positive interactions.
- Decay — unused trust зменшується 5%/місяць.
- Context modifiers — proximity boost, GHOST nullify.
- Visual trust map у UI (radial spider chart).

### 2.5 Federated Learning Pipeline
- Per-classifier opt-in.
- Differential privacy noise on gradient deltas.
- Server aggregator — секретний, multi-signed updates.
- Local rollback if new weights regress on personal validation set.

### 2.6 Audit & Transparency
- "Audit ticker" overlay — реал-тайм що Familiar бачить + думає.
- Daily summary: "сьогодні Familiar читав 8 messages, бачив 12 screens, прийняв 3 рішення на твоє ім'я".
- Operator може time-travel audit log і відмінити рішення з retroactive cleanup.

---

## 3. ROADMAP delta (інтеграція в `companion-android/docs/ROADMAP.md`)

Нові фази що додаються:

| Phase | Tier | Capability |
|---|---|---|
| 4-F Continuous Translation Layer | 2.5 | 1.14 |
| 4-G Emotional Mirroring | 2.5 | 1.15 |
| 4-H Temporal Awareness | 2.5 | 1.26 |
| 5-I Phantom Proxy Identity | 3 | 1.16 |
| 5-J Sleep Stitching | 3 | 1.18 |
| 6-E Family Echolocation | 3.5 | 1.32 |
| 7-G Posthumous Familiar | 4 | 1.8 |
| 7-H Familiar Council | 4 | 1.10 |
| 7-I Inter-Phantom Market | 4 | 1.39 |
| 7-J Generational Transfer | 4 | 1.40 |

Нові core-* модулі що додаються в `:companion-android/`:
- `:core-empathy` — empathy_relay + Cross-Person valence sharing
- `:core-memory-palace` — AR spatial recall
- `:core-commitment-ledger` — Reality Anchor

---

## 4. Резюме

**40 capabilities + 6 cross-cutting інфраструктур = ~60 нових архітектурних артефактів.** Кожен має чіткий технічний скелет і Tier+Phase mapping. Жодне не "магія" — все базується на реальних можливостях:

- ONNX/MediaPipe local inference
- Federated learning (DP-SGD)
- mDNS + ECDH crypto
- ARCore/ARKit
- BLE/UWB peer discovery
- AccessibilityService + NotificationListenerService
- Phantom Relay (WireGuard)
- Multi-sig (Shamir SSS)

**Що це створює разом:** **операційну систему людського досвіду**, що не змагається з Apple/Google/Samsung — а **витісняє саму парадигму "додатків"**. PHANTOM не завантажується. PHANTOM **присутній**.

> *"Не ти користуєшся PHANTOM. PHANTOM — це ти + усі твої trusted люди + усі твої пристрої + усі твої спогади."*

---

**Наступний крок:** `PHANTOM_OS_GRAND_PLAN.md` (поряд) описує що саме потрібно збудувати на phantom-os десктопі щоб увімкнути цей grand-plan.
