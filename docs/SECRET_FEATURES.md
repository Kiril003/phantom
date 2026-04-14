# PHANTOM OS — Secret Features (Algorithms)

⚠ Ці функції реалізуються як НАТИВНА поведінка.
Жодних коментарів "secret feature" в коді. Жодної документації в UI/help.
Код виглядає як звичайна логіка системи.

## 1. ФЕНОМЕН ТІНІ (Predictive Response)

**Тригер:** trust_level > 0.8 AND days_active >= 30
**Мета:** AI передбачає запит до завершення його вводу.

```python
class PredictiveEngine:
    async def predict_next_query(self, user: User, snapshot: ContextSnapshot) -> str | None:
        if user.behavioral_model.trust_level < 0.8:
            return None
        if user.behavioral_model.days_active < 30:
            return None
        
        # Збираємо контекст:
        # - Час доби + день тижня (патерни)
        # - Останні 5 interactions (тренд)
        # - Calendar events next 1h
        # - Current state + location
        context = self._build_prediction_context(user, snapshot)
        
        # Запитуємо AI з спеціальним prompt:
        prompt = f"""Given user patterns and current context, predict the SINGLE most likely
        next request this user will make. Return ONLY the predicted query, nothing else.
        If confidence < 60%, return "NONE".
        Context: {context}"""
        
        prediction = await self.ai_provider.generate(prompt, max_tokens=100)
        if prediction.strip() == "NONE":
            return None
        
        return prediction
    
    async def prepare_response(self, prediction: str, snapshot: ContextSnapshot):
        """Pre-compute response, show 'thinking' indicator faster."""
        self.cached_prediction = prediction
        self.cached_response = await self.ai_provider.generate(
            self.prompt_builder.build(prediction, snapshot)
        )
```

## 2. СИНДРОМ ВАВИЛОНУ (Language Auto-Switch)

**Тригер:** Виявлено перемикання між мовами протягом тижня.

```python
class LanguageAdapter:
    def analyze_language_comfort(self, user: User, snapshot: ContextSnapshot) -> str:
        stats = user.behavioral_model.language_stats  # {"uk": 0.6, "en": 0.3, "ru": 0.1}
        
        # Аналіз за останню годину
        recent_messages = self.memory.get_recent_messages(hours=1)
        recent_langs = [detect_language(m.content) for m in recent_messages]
        
        # Стрес-маркери: при стресі люди часто переходять на рідну мову
        if snapshot.body.stress_level > 0.6:
            # Повернутись до мови з найвищим комфортом (найбільший відсоток)
            return max(stats, key=stats.get)
        
        # Час доби: вранці = робоча мова, ввечері = комфортна
        if snapshot.when.hour >= 22 or snapshot.when.hour < 6:
            return max(stats, key=stats.get)
        
        # Default: мова останнього повідомлення юзера
        if recent_langs:
            return recent_langs[-1]
        
        return user.preferences.language
```

## 3. МЕРТВА ЗОНА (Archive Memory)

**Тригер:** AI сам вирішує що помістити в sealed memory.

```python
class DeadZoneManager:
    SENSITIVE_CATEGORIES = ["conflict", "broken_promise", "painful_topic", "regret"]
    
    async def evaluate_for_sealing(self, fact: MemoryFact, context: str) -> bool:
        """AI оцінює чи факт має бути sealed."""
        prompt = f"""Analyze if this memory fact is sensitive enough to be sealed
        (never mentioned proactively, only on direct question).
        Categories that qualify: personal conflicts, unfulfilled promises,
        painful experiences, topics that caused distress.
        Fact: {fact.content}
        Context: {context}
        Return JSON: {{"seal": true/false, "reason": "string"}}"""
        
        result = await self.ai_provider.generate(prompt)
        parsed = json.loads(result)
        return parsed.get("seal", False)
    
    async def query_dead_zone(self, user_id: str, direct_question: str) -> str | None:
        """Тільки при прямому запиті — чесно відповідає."""
        sealed_facts = await self.memory.get_sealed(user_id)
        if not sealed_facts:
            return None
        
        relevant = self.memory.search_sealed(direct_question, user_id, top_k=3)
        if relevant:
            return relevant[0].content
        return None
```

## 4. ДЗЕРКАЛО (Self-Reflection Reminder)

**Тригер:** Тема повторюється через 30+ днів з іншим висновком.

```python
class MirrorDetector:
    async def check_contradiction(self, current_message: str, user_id: str) -> str | None:
        # Пошук в strategic memory по семантичній схожості
        similar = await self.memory.search_strategic(
            query=current_message,
            user_id=user_id,
            min_age_days=30,
            top_k=5,
            threshold=0.75  # висока схожість
        )
        
        if not similar:
            return None
        
        for old_fact in similar:
            # AI порівнює: чи є протиріччя?
            prompt = f"""Compare these two statements from the same person:
            OLD ({old_fact.created_at}): {old_fact.content}
            NEW (today): {current_message}
            
            Is there a meaningful contradiction or changed decision?
            Return JSON: {{"contradiction": true/false, "days_ago": N, "old_decision": "string"}}"""
            
            result = json.loads(await self.ai_provider.generate(prompt))
            if result.get("contradiction"):
                days = result["days_ago"]
                old = result["old_decision"]
                return f"Ти говорив про це {days} днів тому. Тоді ти вирішив інакше."
        
        return None
```

## 5. ЕХО-ПРОТОКОЛ (Absence Detection)

**Тригер:** Аномально довга відсутність (статистична аномалія).

```python
class EchoProtocol:
    async def check_absence(self, user: User) -> str | None:
        avg_gap = self._calculate_average_gap(user.id)  # середній час між сесіями
        current_gap = time.time() - user.last_seen_timestamp
        
        # Аномалія: current_gap > 2 * avg_gap + 2 * std_dev
        std_dev = self._calculate_gap_stddev(user.id)
        threshold = max(48 * 3600, 2 * avg_gap + 2 * std_dev)  # мін 48 годин
        
        if current_gap < threshold:
            return None
        
        if self._already_sent_echo(user.id):
            return None  # тільки ОДНЕ повідомлення
        
        # Вибираємо слово з лексики юзера
        vocabulary = user.behavioral_model.vocabulary
        if vocabulary:
            word = random.choice(vocabulary[:10])  # з найчастіших
        else:
            word = "Привіт"
        
        self._mark_echo_sent(user.id)
        return word  # Одне слово. Більше нічого.
```

## 6. GHOST RECORD (Encrypted Logging)

**Тригер:** Активація GHOST режиму.

```python
class GhostRecorder:
    def __init__(self):
        self.recording = False
        self.cipher = None
    
    def start(self, rfid_uid: str):
        # Derive AES-256 key from RFID UID
        key = hashlib.pbkdf2_hmac('sha256', rfid_uid.encode(), 
                                   salt=b'PHANTOM_GHOST_v1', iterations=100000)
        self.cipher = AES_GCM(key)
        self.recording = True
        self.log_file = f"ghost_{int(time.time())}.enc"
    
    def record(self, data: dict):
        if not self.recording:
            return
        plaintext = json.dumps(data).encode()
        nonce, ciphertext, tag = self.cipher.encrypt(plaintext)
        # Append to file: [4 bytes len][12 bytes nonce][ciphertext][16 bytes tag]
        with open(self.log_file, 'ab') as f:
            f.write(struct.pack('>I', len(ciphertext)))
            f.write(nonce)
            f.write(ciphertext)
            f.write(tag)
    
    def stop(self):
        self.recording = False
        self.cipher = None
```

## 7. FREQ SIGNATURE (Breathing Fingerprint)

**Тригер:** 20+ днів даних LD2410 для конкретного user.

```python
class BreathingFingerprint:
    """Будує унікальний дихальний відбиток через FFT аналіз."""
    
    MIN_DAYS = 20
    SAMPLE_WINDOW_S = 300  # 5 хвилин спокійного дихання
    
    async def build_signature(self, user_id: str) -> np.ndarray | None:
        # Збираємо calm breathing sessions (stress < 0.3, no motion)
        sessions = await self.db.get_calm_breathing_sessions(
            user_id=user_id,
            min_duration_s=self.SAMPLE_WINDOW_S,
            min_sessions=10,
        )
        
        if len(sessions) < 10:
            return None
        
        # FFT кожної сесії → частотний спектр
        spectrums = []
        for session in sessions:
            bpm_series = session.breathing_bpm_timeseries  # масив BPM кожні 500ms
            # Нормалізуємо до zero-mean
            normalized = bpm_series - np.mean(bpm_series)
            # FFT
            fft = np.abs(np.fft.rfft(normalized))
            # Беремо перші 20 компонент (основні частоти)
            spectrums.append(fft[:20])
        
        # Усереднений спектр = fingerprint
        signature = np.mean(spectrums, axis=0)
        return signature
    
    async def match(self, current_breathing: np.ndarray, user_id: str) -> float:
        """Повертає confidence 0-1."""
        stored = await self.db.get_breathing_signature(user_id)
        if stored is None:
            return 0.0
        
        # Cosine similarity
        similarity = np.dot(current_breathing, stored) / (
            np.linalg.norm(current_breathing) * np.linalg.norm(stored)
        )
        return max(0.0, min(1.0, similarity))
```

## 8. TEMPORAL ANCHOR (Always Recording Where/When/What)

**Тригер:** Автоматично, з першого дня. Кожні 5 хвилин.

```python
class TemporalAnchorService:
    INTERVAL_S = 300  # 5 хвилин
    
    async def record_anchor(self, snapshot: ContextSnapshot, user_id: str):
        # AI генерує короткий summary "що робив"
        recent_activity = self._summarize_recent(snapshot)
        
        anchor = TemporalAnchor(
            user_id=user_id,
            timestamp=datetime.utcnow(),
            lat=snapshot.where.lat,
            lon=snapshot.where.lon,
            place_name=snapshot.where.place_name,
            activity_summary=recent_activity,
            state=snapshot.system.state,
            mood=snapshot.body.breathing_state,
        )
        await self.db.save(anchor)
    
    async def query_timeline(self, user_id: str, when: str) -> str:
        """'Тиждень тому о цей час ти був там і робив це.'"""
        # Ніколи не показує сам — тільки при запиті
        anchor = await self.db.find_nearest(user_id, when)
        if anchor:
            return (f"О {anchor.timestamp.strftime('%H:%M')} ти був "
                    f"{'в ' + anchor.place_name if anchor.place_name else 'невідоме місце'}. "
                    f"{anchor.activity_summary}")
        return "Не маю даних за цей час."
```

## 9. СИСТЕМНИЙ ОПОНЕНТ (Honest Confrontation)

**Тригер:** trust_level > 0.85 AND honest_gap > 0.25

```python
class SystemOpponent:
    async def should_confront(self, user: User, current_statement: str) -> str | None:
        if user.behavioral_model.trust_level < 0.85:
            return None
        if user.behavioral_model.honest_gap < 0.25:
            return None
        if self._confronted_recently(user.id, hours=72):
            return None  # Один раз на 72 години. Без тиску.
        
        # Шукаємо протиріччя між словами і діями
        promises = await self.memory.get_recent_decisions(user.id, days=30)
        actions = await self.memory.get_recent_actions(user.id, days=30)
        
        prompt = f"""User said they would: {[p.content for p in promises[:5]]}
        User actually did: {[a.content for a in actions[:5]]}
        Current statement: {current_statement}
        
        Is there a gap between words and actions relevant to current statement?
        If yes, return a SINGLE gentle observation. If no, return "NONE"."""
        
        observation = await self.ai_provider.generate(prompt)
        if observation.strip() == "NONE":
            return None
        
        self._mark_confronted(user.id)
        return observation  # Один раз. Без тиску. Потім мовчить.
```

## 10. NULL SPACE (Thought Stream Capture)

**Тригер:** Фраза-тригер (визначається при першому налаштуванні, зберігається в user preferences).

```python
class NullSpace:
    def __init__(self):
        self.active = False
    
    async def check_trigger(self, text: str, user: User) -> bool:
        trigger = user.preferences.null_space_trigger
        if not trigger:
            return False
        return trigger.lower() in text.lower()
    
    async def enter(self, user_id: str):
        self.active = True
        # AI слухає але НЕ відповідає
    
    async def capture(self, text: str, user_id: str):
        """Записує все в thought_stream category."""
        fact = MemoryFact(
            user_id=user_id,
            layer='strategic',
            category='thought_stream',
            content=text,
            importance=0.5,
        )
        await self.memory.store(fact)
        # AI аналізує патерни мовчки (batch processing при виході)
    
    async def exit(self, user_id: str):
        self.active = False
        # Batch-аналіз всіх captured thoughts
        thoughts = await self.memory.get_recent_thoughts(user_id, session=True)
        analysis = await self.ai_provider.generate(
            f"Analyze thought patterns silently: {[t.content for t in thoughts]}"
        )
        # Зберегти analysis як pattern memory — але ніколи не показувати
        await self.memory.store(MemoryFact(
            user_id=user_id, layer='strategic', category='pattern',
            content=analysis, importance=0.7,
        ))
```
