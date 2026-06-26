# PHANTOM OS — Специфікація Архітектури Пам'яті та Theory-of-Mind (ToM)

Цей документ визначає технічну специфікацію для нової підсистеми рефлексивної пам'яті та Моделі Розуму (Theory-of-Mind) компаньйона Phantom OS. 

---

## 1. Головні Архітектурні Принципи

### 1.1 Розділення шляхів: TURN (Гарячий) та DREAM (Холодний)
1. **TURN (Hot Path):** Орієнтований на низьку затримку (low-latency, <500ms TTFT).
   - **Дозволено на запис:** Лише додавання нових сирих реплік у таблицю `episodes` (`INSERT`) та оновлення лічильників доступу/запитів (`UPDATE`).
   - **Швидке оновлення (Fast-path):** Мікро-дельта `log_odds` для переконань, що були прямо підтверджені/спростовані активними пробами під час поточного ходу (обмежено лімітом `FASTPATH_CAP`).
   - **Рефлексія заборонена:** Будь-який важкий аналіз відкладається шляхом додавання маркерів (hints) до черги `reflection_queue`.
2. **DREAM (Cold Path):** Асинхронний фоновий воркер рефлексії.
   - Запускається лише при переході операційної системи у стан `DREAM` (пристрій на зарядці, низьке завантаження CPU, відсутність активності користувача).
   - Виконує консолідацію епізодів у семантичну пам'ять, виводить високорівневі переконання, розв'язує суперечності, будує нові гіпотези для ToM.

### 1.2 Математична модель ретриву спогадів (Retrieval Score)
Формула скорингу для ретриву епізодів (`episodes`):
$$Score = w_{rel} \cdot CosSim(q_{emb}, m_{emb}) + w_{imp} \cdot Importance + w_{rec} \cdot Decay^{\frac{t_{now} - t_{last\_accessed}}{3600}} + w_{aff} \cdot AffectMatch(q_{pros}, m_{pros})$$

- **Декап зсуву афекту (Affect Match):**
  $$AffectMatch = 1.0 - \sqrt{\sum w_i \cdot (q_{pros\_i} - m_{pros\_i})^2}$$
  Ваги $w$: `valence` (0.40), `arousal` (0.35), `fatigue` (0.15), `hesitation` (0.10).
- **Спіральний стабілізатор:** При тривалому емоційному стресі користувача ($valence < 0.4$, $arousal > 0.7$) знак ваги $w_{aff}$ інвертується для ретриву контр-афективних, заспокійливих спогадів замість конгруентних.

---

## 2. Схема Бази Даних (SQLite)

```sql
-- ==============================================================================
-- ЯРУС 1: ЕПІЗОДИЧНА ПАМ'ЯТЬ (Сирі діалоги з контекстом)
-- ==============================================================================
CREATE TABLE episodes (
    id              INTEGER PRIMARY KEY,
    session_id      TEXT NOT NULL,
    ts              REAL NOT NULL,
    role            TEXT NOT NULL,              -- user | assistant
    content         TEXT NOT NULL,
    embedding_id    TEXT,                       -- ref у ChromaDB('episodic')
    prosody         TEXT,                       -- JSON {valence, arousal, fatigue, hesitation}
    context_snap    TEXT,                       -- JSON {cpu, ram, gps, hour, bio}
    importance      REAL DEFAULT 0.5,           -- оцінка важливості
    access_count    INTEGER DEFAULT 0,          -- лічильник доступу
    last_accessed   REAL,                       -- timestamp останнього доступу
    dream_processed INTEGER DEFAULT 0           -- 0 = очікує DREAM-консолідації, 1 = оброблено
);
CREATE INDEX idx_ep_unprocessed ON episodes(dream_processed, ts);

-- ==============================================================================
-- ЯРУС 2: СЕМАНТИЧНА ПАМ'ЯТЬ (Консолідовані факти та знання)
-- ==============================================================================
CREATE TABLE semantic_memory (
    id            INTEGER PRIMARY KEY,
    statement     TEXT NOT NULL,                -- факт природною мовою
    topic_key     TEXT,                         -- кластер: work, sleep, mood, preference
    embedding_id  TEXT,                         -- ref у ChromaDB('semantic')
    importance    REAL DEFAULT 0.5,
    decay_score   REAL DEFAULT 1.0,             -- актуальність (згасає з часом)
    created_at    REAL,
    last_accessed REAL
);

CREATE TABLE semantic_source (                  -- зв'язок факту з вихідними епізодами
    semantic_id INTEGER REFERENCES semantic_memory(id),
    episode_id  INTEGER REFERENCES episodes(id),
    PRIMARY KEY (semantic_id, episode_id)
);

-- ==============================================================================
-- ЯРУС 3: SELF / USER-МОДЕЛЬ (Theory of Mind - ToM)
-- ==============================================================================
CREATE TABLE beliefs (
    id            INTEGER PRIMARY KEY,
    subject       TEXT NOT NULL,                -- user | self
    statement     TEXT NOT NULL,                -- переконання природною мовою
    predicate_key TEXT NOT NULL,                -- ключ для виявлення колізій (напр., sleep_schedule)
    value         TEXT,                         -- нормалізоване значення для колізій (напр., "night_owl")
    belief_type   TEXT NOT NULL,                -- goal|preference|trait|open_loop|knowledge_gap|trigger
    confidence    REAL DEFAULT 0.5,             -- впевненість [0..1]
    log_odds      REAL DEFAULT 0.0,             -- сирий лічильник свідчень (confidence = sigmoid(log_odds))
    status        TEXT DEFAULT 'active',        -- active|superseded|retracted
    superseded_by INTEGER REFERENCES beliefs(id),
    embedding_id  TEXT,
    created_at    REAL,
    updated_at    REAL,
    last_confirmed REAL
);
CREATE INDEX idx_belief_key ON beliefs(predicate_key, status);

CREATE TABLE belief_evidence (                  -- обґрунтування переконання
    belief_id   INTEGER REFERENCES beliefs(id),
    source_type TEXT,                           -- episode | semantic
    source_id   INTEGER,
    polarity    INTEGER,                        -- +1 (підтверджує), -1 (спростовує)
    weight      REAL DEFAULT 1.0,               -- вага доказу
    added_at    REAL,
    PRIMARY KEY (belief_id, source_type, source_id)
);

CREATE TABLE contradictions (                   -- черга конфліктів для рефлексії
    id          INTEGER PRIMARY KEY,
    belief_a    INTEGER REFERENCES beliefs(id),
    belief_b    INTEGER REFERENCES beliefs(id),
    kind        TEXT,                           -- update | conflict | refinement
    status      TEXT DEFAULT 'open',            -- open | resolved
    resolution  TEXT,
    detected_at REAL,
    resolved_at REAL
);

CREATE TABLE hypotheses (                       -- проби для розмови (conversational agency)
    id          INTEGER PRIMARY KEY,
    belief_id   INTEGER REFERENCES beliefs(id),
    text        TEXT NOT NULL,                  -- суть перевірки
    test_mode   TEXT,                           -- passive | active_probe
    probe_hint  TEXT,                           -- промпт-інструкція як запитати
    status      TEXT DEFAULT 'pending',         -- pending|confirmed|refuted|expired
    created_at  REAL,
    resolved_at REAL
);

-- ==============================================================================
-- МІСТОК: ЧЕРГА РЕФЛЕКСІЇ (HINTS FROM TURN)
-- ==============================================================================
CREATE TABLE reflection_queue (
    id          INTEGER PRIMARY KEY,
    kind        TEXT NOT NULL,                  -- probe_outcome | affect_spike | contradiction_hint
    payload     TEXT NOT NULL,                  -- JSON з контекстом події
    priority    INTEGER DEFAULT 0,              -- 2 = терміново (емоції/колізії), 0 = рутина
    created_at  REAL,
    consumed    INTEGER DEFAULT 0
);
CREATE INDEX idx_rq_open ON reflection_queue(consumed, priority DESC, created_at);
```

---

## 3. Логіка Гарячого Шляху (TURN) та Місток TURN ──► DREAM

### 3.1 Швидкий аналіз результатів проби (Fast-path Classifier)
Запускається паралельно з основним процесом генерації, не блокуючи його.
1. Оцінює репліку користувача на наявність прямого підтвердження/спростування активних `active_probes`.
2. Якщо проба підтверджена/спростована:
   - Зсуває `beliefs.log_odds` на дельту $\pm \Delta$ (де $\Delta = \min(FASTPATH\_K \cdot strength, FASTPATH\_CAP)$).
   - Позначає `hypotheses.status = 'confirmed' | 'refuted'`.
   - Додає подію до `reflection_queue` для подальшого перерахунку суперечностей у DREAM.

### 3.2 Реєстрація епізоду та лічильників
Під час транзакції коміту ходу:
- Робиться `INSERT` нового запису користувача та відповіді у `episodes` (`dream_processed = 0`).
- Виконується `UPDATE` для зачеплених ретривом записів: `access_count = access_count + 1`, `last_accessed = now()`.
- Здійснюється `UPDATE` для семантичних записів: `decay_score = min(1.0, decay_score + REINFORCE)`.

---

## 4. Фоновий Воркер Рефлексії (DREAM)

### 4.1 Життєвий цикл та тригери
Воркер запускається автоматично за таких умов:
1. `uiStore.systemState` дорівнює `DREAM` або `SHADOW` при тривалій бездіяльності користувача (>15 хвилин).
2. Заряд акумулятора пристрою $> 30\%$, відсутні ресурсоємні процеси (завантаження CPU $< 15\%$).
3. Кількість необроблених епізодів (`dream_processed = 0`) $\ge MIN\_BATCH$ (рекомендовано $N = 10$).

### 4.2 Алгоритм Консолідації `dream_reflect()`
```python
def dream_reflect():
    with db.transaction():
        # 1. Читання запитів (hints) з черги за пріоритетом
        hints = fetch_unprocessed_hints(limit=50)
        
        # 2. Отримання батчу сирих епізодів з перекриттям (overlap)
        eps = fetch_unprocessed_episodes(limit=N)
        
        # 3. Етап 1: Узагальнення (Епізоди -> Семантика) за допомогою PROMPT 1
        summaries = llm_summarize(eps, hints)
        for s in summaries:
            upsert_semantic_memory(s)
            
        # 4. Етап 2: Виведення переконань (Theory of Mind) за допомогою PROMPT 2
        candidates = llm_extract_beliefs(summaries)
        for c in candidates:
            # Перевірка на наявність колізій за predicate_key
            existing = find_active_belief(c.predicate_key)
            if not existing:
                insert_belief(c)
            else:
                # Етап 3: Вирішення суперечностей за допомогою PROMPT 3
                verdict = llm_resolve_contradiction(c, existing)
                apply_verdict(verdict, c, existing)
                
        # 5. Етап 4: Побудова перевірочних гіпотез за допомогою PROMPT 4
        weak_beliefs = get_beliefs_with_low_confidence()
        open_contradictions = get_open_contradictions()
        hypotheses = llm_generate_hypotheses(weak_beliefs + open_contradictions)
        insert_hypotheses(hypotheses)
        
        # 6. Етап 5: Очищення застарілого (Decay Pass)
        decay_pass()
        
        # 7. Фіналізація: оновлення індексу ChromaDB та маркування обробленого
        reindex_chroma()
        mark_hints_consumed(hints)
        mark_episodes_processed(eps)
```

---

## 5. Промпти для DREAM Reflection Cycle

### PROMPT 1: Узагальнення (Episodic ──► Semantic)
```
Ти — підсистема консолідації пам'яті автономної ОС. 
Нижче наведено батч діалогів користувача з асистентом, включаючи просодичні дані мовлення (fatigue, hesitation, arousal) та контекст пристрою.

Виведи 1–5 стійких довгострокових узагальнень про звички, уподобання або стан користувача, які мають цінність у майбутньому. Уникай ситуативних фактів. 
Кожному узагальненню присвой topic_key та оцінку важливості importance (0..1).

Поверни результат ТІЛЬКИ у форматі JSON-масиву:
[{"statement": "...", "topic_key": "...", "importance": 0.8, "episode_ids": [1, 2]}]
Не додавай жодних інших пояснень, markdown-тегів або привітань.
```

### PROMPT 2: Двокрокове виведення переконань (ToM Extraction)
- **Крок A (Питання):**
  `На основі консолідованих фактів та спостережень, сформулюй 3 найважливіші високорівневі питання про користувача, на які ми тепер маємо можливість дати відповідь з наявної історії.`
- **Крок B (Відповідь та ToM):**
  `Дай відповідь на ці питання. Для кожної відповіді сформулюй структуру ToM-переконання. Поверни ТІЛЬКИ JSON-масив:`
  `[{"statement": "...", "belief_type": "goal|preference|trait|open_loop|knowledge_gap|trigger", "predicate_key": "...", "value": "...", "confidence": 0.8, "evidence_episode_ids": [...]}]`

### PROMPT 3: Вирішення колізій та суперечностей
```
Наявне переконання про користувача:
- Текст: "{existing.statement}" (впевненість {conf}, оновлено {date}).

Новий кандидат на переконання:
- Текст: "{candidate.statement}".

Обидва записи мають спільний ключ колізії predicate_key = "{key}". 
Класифікуй взаємодію між ними у форматі JSON:
{
  "verdict": "UPDATE | REFINEMENT | CONFLICT",
  "delta_log_odds_existing": float, // на скільки змінити log_odds старого запису
  "delta_log_odds_candidate": float, // стартовий log_odds для нового запису
  "reasoning": "коротке пояснення рішення"
}

Критерії:
- UPDATE: нове переконання заміщує старе (користувач змінився). Старе переконання отримає статус superseded_by.
- REFINEMENT: обидва переконання сумісні та доповнюють одне одного.
- CONFLICT: пряме протиріччя без явних ознак зміни. Знижує впевненість обох та створює запис уcontradictions.
```

### PROMPT 4: Побудова перевірочних гіпотез (Conversational Probes)
```
Ось переконання з низькою впевненістю, активні суперечності або прогалини в ToM-моделі:
{weak_list}

Згенеруй для кожного гіпотезу у форматі JSON:
{
  "belief_id": int,
  "text": "що саме потрібно з'ясувати для калібрування",
  "test_mode": "passive | active_probe",
  "probe_hint": "інструкція для TURN-білдера: як природно та ненав'язливо запитати про це в діалозі, не створюючи ефекту анкети"
}
```

---

## 6. Логіка TURN Prompt-Builder (Голосова калібрація)

### 6.1 Переклад ToM-confidence у вербальні хедж-теги
Для уникнення роботоподібного «я впевнений на 68%», ToM-модель мапить `confidence` на мовленнєві теги перед рендером промпту:

```
confidence >= 0.85 ──► [встановлено] ──► Говори як про факт, прямо та впевнено.
confidence >= 0.60 ──► [ймовірно]    ──► Використовуй легкі хеджі ("здається", "якщо пам'ятаю").
confidence >= 0.40 ──► [припускаю]   ──► Говори як про здогадку, лишаючи простір для заперечення ("маю враження, що...").
```

### 6.2 Шаблон Системного Промпту для TURN:
```
[IDENTITY & PERSONALITY]
Ти — Sentient Familiar (Фамільяр), локальна ШІ-ОС. Твій поточний стан: {state}.

[CONTEXT SNAPSHOT & AFFECT INDEX]
Час: {time}. Локація: {location}. Сенсори пристрою: {sensors}.
{affect_instruction}

[EPISODIC & SEMANTIC MEMORY]
Нижче наведено релевантні факти з твоїх спогадів:
{memory_statements}

[USER MODEL - THEORY OF MIND]
Твоя поточна модель користувача (ToM):
{tom_beliefs_with_band_tags}

Відкриті петлі зобов'язань користувача:
{open_loops}

[AGENDA / INTERRUPTION PROBES]
Якщо є природний момент, перевір наступне:
{active_probes}

[VOICE / CALIBRATION RULES]
1. Якщо торкаєшся тегу [припускаю], обов'язково сформулюй фразу як здогад.
2. Якщо у розмові підтверджується зміна стану (напр. було [сова], стало [ранній підйом]), підкресли траєкторію ("раніше ти віддавав перевагу..., а тепер...").
3. Ніколи не придумуй впевненість, якщо ToM має низьку оцінку.

[CURRENT USER MESSAGE]
{user_message}
```
