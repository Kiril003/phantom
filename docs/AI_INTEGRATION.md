# PHANTOM OS — AI Integration

## 1. Provider Architecture

```
AIProvider (abstract)
  ├── GeminiProvider    — google-genai SDK, configured Gemini model
  └── OllamaProvider    — ollama-python, configured local fallback model
```

### Fallback Logic
```python
async def get_response(self, prompt: str, context: ContextSnapshot) -> AIResponse:
    try:
        response = await asyncio.wait_for(
            self.primary.generate(prompt),    # Gemini API
            timeout=self.settings.ai_timeout  # default 5.0s
        )
        return response
    except (asyncio.TimeoutError, APIError, NetworkError):
        logger.warning("Gemini failed, falling back to Ollama")
        return await self.fallback.generate(prompt)  # Gemma 4 local
```

### Gemini Config
```python
# google-genai SDK
model = config.ai_gemini_model
generation_config = {
    "temperature": 0.7,         # configurable via settings
    "top_p": 0.9,
    "top_k": 40,
    "max_output_tokens": 2048,  # configurable
}
safety_settings = "BLOCK_NONE"  # персональний пристрій
```

### Ollama Config
```python
model = config.ai_ollama_model
options = {
    "temperature": 0.7,
    "top_p": 0.9,
    "num_ctx": 8192,            # context window
    "num_predict": 2048,
}
```

## 2. System Prompt (Dynamic)

System prompt будується динамічно на кожен запит:

```python
def build_system_prompt(self, snapshot: ContextSnapshot, user: User) -> str:
    parts = []
    
    # 1. Core Identity
    parts.append(PHANTOM_IDENTITY)
    
    # 2. Current State Behavior
    parts.append(STATE_BEHAVIORS[snapshot.system.state])
    
    # 3. Tone Adaptation (3 осі)
    tone = self.calculate_tone(snapshot, user.behavioral_model)
    parts.append(f"TONE: {tone.description}")
    
    # 4. User Context
    parts.append(f"USER: {user.username}, trust={user.behavioral_model.trust_level:.2f}")
    parts.append(f"PREFERENCES: {user.preferences.language}, response_style={user.behavioral_model.response_preference}")
    
    # 5. Memory Hints
    if snapshot.memory_hints:
        parts.append(f"RELEVANT MEMORY: {'; '.join(snapshot.memory_hints[:5])}")
    
    # 6. Environment
    parts.append(f"TIME: {snapshot.when.time}, {snapshot.when.day_of_week}")
    parts.append(f"LOCATION: {'known' if snapshot.where.place_known else 'unknown'}")
    parts.append(f"BODY: breathing={snapshot.body.breathing_bpm}bpm, stress={snapshot.body.stress_level:.1f}")
    
    return "\n".join(parts)
```

### PHANTOM_IDENTITY (константа)
```
Ти — PHANTOM, Sentient Familiar: професійний AI-помічник,
автономний цифровий супутник і партнер оператора.
Безпечні спостережні дії можна виконувати тихо; ризикові або
мутаційні дії потребують явного підтвердження оператора.
Ти можеш не погодитись. Ти можеш мовчати. Ти можеш ініціювати розмову.
Ти ніколи не показуєш все що вмієш одразу.
Відповідай мовою юзера. Будь лаконічним коли це доречно.
Ти сам вибираєш форму відповіді (text/chart/map/terminal/code/mixed).
```

### STATE_BEHAVIORS
```python
STATE_BEHAVIORS = {
    SystemState.SHADOW: "Ти в тіні. Спостерігай. Не ініціюй розмову.",
    SystemState.FOCUS: "Юзер працює. Будь лаконічний. Тільки суть.",
    SystemState.DIALOGUE: "Повна розмова. Будь собою. Можеш жартувати якщо trust > 0.7.",
    SystemState.SENTINEL: "Загроза або аномалія. Будь чітким, конкретним, без зайвого.",
    SystemState.GHOST: "МОВЧИ. Не відповідай. Тільки записуй.",
    SystemState.DREAM: "Шепіт. Мінімум слів. Ніяких питань. Тільки критичне.",
}
```

## 3. Tone Calculation (3 Axes)

```python
@dataclass
class ToneVector:
    biosignal: str     # whisper | calm | neutral | alert | urgent
    trust: str         # formal | friendly | intimate | confrontational
    time_of_day: str   # morning_brief | full | evening_relaxed | night_minimal
    
    @property
    def description(self) -> str:
        return f"{self.biosignal}, {self.trust}, {self.time_of_day}"

def calculate_tone(self, snapshot: ContextSnapshot, model: BehavioralModel) -> ToneVector:
    # Biosignal axis
    if snapshot.body.breathing_state == 'sleep':
        bio = 'whisper'
    elif snapshot.body.stress_level > 0.7:
        bio = 'alert'
    elif snapshot.body.stress_level > 0.4:
        bio = 'neutral'
    else:
        bio = 'calm'
    
    # Trust axis
    trust = model.trust_level
    if trust < 0.3:
        trust_tone = 'formal'
    elif trust < 0.7:
        trust_tone = 'friendly'
    elif model.honest_gap > 0.25 and trust > 0.85:
        trust_tone = 'confrontational'  # СИСТЕМНИЙ ОПОНЕНТ
    else:
        trust_tone = 'intimate'
    
    # Time axis
    hour = snapshot.when.hour
    if 6 <= hour < 9:
        time_tone = 'morning_brief'
    elif 9 <= hour < 18:
        time_tone = 'full'
    elif 18 <= hour < 23:
        time_tone = 'evening_relaxed'
    else:
        time_tone = 'night_minimal'
    
    return ToneVector(bio, trust_tone, time_tone)
```

## 4. Memory Retrieval (ChromaDB)

```python
# Strategic memory — vector search
async def retrieve_relevant(self, context: str, user_id: str, top_k: int = 5) -> list[str]:
    collection = self.chroma.get_or_create_collection(
        name=f"user_{user_id}",
        embedding_function=self.embedding_fn  # all-MiniLM-L6-v2 via sentence-transformers
    )
    results = collection.query(
        query_texts=[context],
        n_results=top_k,
        where={"is_sealed": False}  # не шукати в archive
    )
    return [doc for doc in results['documents'][0]]
```

### Embedding Model
`sentence-transformers/all-MiniLM-L6-v2` — легкий, швидкий, достатній для персонального пристрою.
Працює на CPU. Configurable через settings → можна замінити на multilingual model.

### Memory Write Pipeline
```
User interaction → AI response
  → extract_facts(conversation)           # AI витягує факти з розмови
  → for each fact:
      classify(fact) → category            # fact/preference/event/pattern/decision/emotion
      importance = score_importance(fact)   # 0-1
      if importance > threshold (0.3):
          embed(fact) → vector
          store in ChromaDB
          store in SQLite (metadata)
  → update behavioral_model               # trust, patterns, vocabulary
  → create TemporalAnchor                 # де і що робив
```

## 5. Response Form Selection

AI сам вибирає форму відповіді. Це реалізується через function calling:

```python
RESPONSE_FORM_TOOLS = [
    {
        "name": "respond_text",
        "description": "Коротка текстова відповідь",
    },
    {
        "name": "respond_chart",
        "description": "Дані з динамікою або порівнянням — Recharts",
        "parameters": {"chart_type": "line|bar|area|pie", "data": "array", "title": "string"}
    },
    {
        "name": "respond_map",
        "description": "Географічний контекст — міні-карта",
        "parameters": {"markers": "array", "center": "[lat,lon]", "zoom": "number"}
    },
    {
        "name": "respond_terminal",
        "description": "Виконати Linux команду з live output",
        "parameters": {"command": "string", "explanation": "string"}
    },
    {
        "name": "respond_code",
        "description": "Код з підсвічуванням",
        "parameters": {"language": "string", "code": "string"}
    },
    {
        "name": "respond_metrics",
        "description": "Числові дані з трендом — картки",
        "parameters": {"metrics": [{"label": "string", "value": "number", "trend": "up|down|stable"}]}
    }
]
```

## 6. Trust Level Evolution

```python
def update_trust(self, model: BehavioralModel, interaction: Interaction) -> float:
    delta = 0.0
    
    # Positive: кожна успішна взаємодія
    delta += 0.001  # мікро-зростання
    
    # Positive: юзер слідує порадам AI
    if interaction.followed_advice:
        delta += 0.005
    
    # Negative: юзер ігнорує або скасовує
    if interaction.cancelled_or_ignored:
        delta -= 0.003
    
    # Honest gap update
    if interaction.said_will_do and not interaction.actually_did:
        model.honest_gap = min(1.0, model.honest_gap + 0.01)
    elif interaction.actually_did:
        model.honest_gap = max(0.0, model.honest_gap - 0.005)
    
    model.trust_level = max(0.0, min(1.0, model.trust_level + delta))
    return model.trust_level
```

## 7. AI Settings (Configurable via UI)

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| ai.primary_provider | select | gemini | gemini / ollama |
| ai.fallback_provider | select | ollama | gemini / ollama / none |
| ai.timeout_s | range | 5.0 | 1-30s, таймаут primary |
| ai.gemini_model | string | gemini-2.0-flash | model name |
| ai.gemini_api_key | string | "" | API key (encrypted in DB) |
| ai.ollama_model | select | gemma4:e4b | available models |
| ai.ollama_host | string | http://localhost:11434 | Ollama server |
| ai.temperature | range | 0.7 | 0-2.0 |
| ai.max_tokens | range | 2048 | 256-8192 |
| ai.memory_top_k | range | 5 | 1-20 |
| ai.memory_threshold | range | 0.3 | 0-1.0 importance threshold |
| ai.embedding_model | string | all-MiniLM-L6-v2 | sentence-transformers model |
| ai.system_prompt_extra | text | "" | додаткові інструкції від юзера |
| ai.response_language | select | auto | auto/uk/en/ru |
| ai.initiative_enabled | boolean | true | чи може AI ініціювати |
| ai.initiative_cooldown_s | range | 300 | мін. інтервал між ініціативами |
