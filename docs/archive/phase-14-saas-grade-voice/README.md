# Phase 14 — SaaS-grade Voice Interaction

> **Мета фази:** перетворити PHANTOM з "розпізнає що ти сказав" на "розмовляє з тобою як ChatGPT Voice / Pi.ai / Sesame". Не просто швидко — а **живо і передбачливо**.
> **Передумова:** Phase 13a + Phase 13b завершені і працюють стабільно ≥ 5 днів реального використання.
> **Цільовий результат:** користувач сприймає взаємодію з PHANTOM як живий діалог: PHANTOM думає вже коли ти говориш, починає відповідати поки ти ще не закінчив, і ти можеш перебити його у будь-який момент голосом.
> **Час на реалізацію:** 25-40 годин (3-5 робочих сесій).
> **Ризик:** середньо-високий. Зачіпає LLM провайдер контракт, TTS engine, AEC/audio routing.
> **Вхід:** тег `v0.13.0b-streaming-partials`.
> **Вихід:** тег `v0.14.0-saas-grade`.

---

## 0. Філософія цієї фази

Phase 13a забрав CPU bloat. Phase 13b забрав візуальну латентність ("сидиш у пустоті"). Phase 14 забирає **діалогову латентність** — час між тим, як ти закінчив думку, і тим, як PHANTOM почав відповідати.

SaaS-рівень голосової взаємодії складається з 6 стовпів:

1. **Streaming partial transcripts** — ✓ зробили в 13b.
2. **Predictive LLM kickoff** — починаємо thinking ще під час мовлення. ← **ДОДАЄМО**.
3. **Streaming TTS** — починаємо відповідати ще поки LLM генерує. ← **ДОДАЄМО**.
4. **Semantic endpointing** — silence_ms адаптивний на контекст. ← **ДОДАЄМО**.
5. **Barge-in** — мікрофон не глухне під час TTS. ← **ДОДАЄМО**.
6. **Real wake-word** — мікрофон не активний, поки не почув "фантом". ← **ДОДАЄМО**.

---

## 1. Архітектура Phase 14

```
   User speaks                                                    PHANTOM
   ─────────────                                                  ────────
   "пр..."         ──┐
                     │ partial event
                     ▼
                  Frontend ghost bubble updates
                     │
                     │ (Vosk partials продовжуються)
   "привіт..."     ──┤
                     │
                     │ ←── stable partial detected (text незмінне 2 cycles)
                     │     →  Backend: kickoff predictive LLM call (cancellable)
                     │     →  Backend: stream LLM response → streaming TTS chunks
                     │
   "привіт"        ──┤
                     │ semantic endpointer:
                     │   – terminator detected (period/question intonation)
                     │   – OR adaptive silence_ms expired
                     │ → SPEECH_END
                     │
                     ▼
                  Backend: vosk final = "привіт"
                  Did predicted text == final?
                    YES → continue streaming TTS already in progress
                    NO  → cancel predictive call, restart with corrected text

                                                  PHANTOM TTS plays:
   ░░░░░░░░░░░░░░░ <── (250 ms) ←─────────── "Привіт! Як справи?"
                                                   │
                                                   │ ← user starts speaking
   "стоп, я хотів..."                              │   (mic stays open, AEC subtracts TTS)
                                                   │   browser-VAD detects speech_start
                                                   │   → backend: barge-in event
                                                   │   → cancel TTS, cancel LLM
                                                   │   → start new turn
```

---

## 2. Стовп 2 — Predictive LLM Kickoff

### 2.1 Концепція

В sea SaaS voice agents (Pi.ai, Inflection, ChatGPT Voice) є відомий трюк: коли streaming-STT видає **stable partial** (текст не міняється 2-3 cycles підряд = ~400-500 ms), бекенд **спекулятивно** запускає LLM call з цим partial. Якщо вгадав — TTS вже почав звучати до того, як user перестав говорити. Якщо вгадав не точно — cancel і re-kickoff з виправленим текстом, ціна — 1-2 LLM токени викинуті.

### 2.2 Алгоритм stable-partial detection

**File:** `src/backend/voice/streaming_recognizer.py` (доповнення)

```python
class StreamingVoskRecognizer:
    # ... існуючий код 13b ...

    def feed(self, pcm_bytes: bytes) -> Optional[PartialEvent]:
        # ... існуючий feed логіка ...

        # NEW: track stability counter
        if full_text == self._last_partial_text:
            self._stable_count += 1
        else:
            self._stable_count = 0

        return PartialEvent(
            text=full_text,
            is_committed=committed,
            stability=self._stable_count,  # NEW field
        )


@dataclass(frozen=True)
class PartialEvent:
    text: str
    is_committed: bool = False
    stability: int = 0  # NEW: how many cycles text unchanged
```

### 2.3 Predictive LLM in orchestrator

**File:** `src/backend/voice/always_on.py`

Додати поля в `__init__`:
```python
self._predictive_llm_enabled: bool = predictive_llm_enabled
self._predictive_stability_threshold: int = 2  # 2 cycles == ~400ms
self._predictive_min_chars: int = 10            # не пускати "при..."
self._predictive_task: Optional[asyncio.Task] = None
self._predicted_text: str = ""
```

В `_process_frame_streaming` після emit partial:
```python
if (
    self._predictive_llm_enabled
    and partial is not None
    and partial.stability >= self._predictive_stability_threshold
    and len(partial.text) >= self._predictive_min_chars
    and partial.text != self._predicted_text
):
    self._cancel_predictive()
    self._predicted_text = partial.text
    self._predictive_task = asyncio.create_task(
        self._kickoff_predictive(partial.text)
    )
```

В `_handle_speech_end_streaming`:
```python
final_text = final_event.text.strip()
if (
    self._predictive_task is not None
    and not self._predictive_task.done()
    and self._predicted_text == final_text
):
    # Predicted текст збігся з final — predictive call відлітає вперед.
    # Не відміняємо, дозволяємо завершитись і його результат використовуємо
    # як fast-path replacement of normal /chat/message POST.
    await self._send({
        "type": "predictive_committed",
        "transcript": final_text,
    })
else:
    # Не вгадав — cancel і піде звичайним шляхом.
    self._cancel_predictive()
    await self._send({
        "type": "final",
        "transcript": final_text,
        "source": "vosk_fast",
        "confidence": final_event.confidence,
    })
```

### 2.4 Frontend predictive_committed handler

**File:** `src/frontend/src/hooks/useVoiceAlwaysOn.ts`

Новий event:
```ts
case 'predictive_committed':
  // Backend повідомляє: "predictive LLM call вже летить, не роби POST /chat/message".
  // Frontend все одно фінілайзує ghost bubble як real (locked-in user message).
  if (typeof ev.transcript === 'string') {
    onPredictiveCommitted?.({transcript: ev.transcript});
  }
  break;

case 'llm_partial':
  // Backend стрімить токени з LLM. Кожен token як окремий event.
  if (typeof ev.text === 'string') {
    onLLMPartial?.({text: ev.text});
  }
  break;

case 'llm_final':
  // Backend завершив LLM stream.
  if (typeof ev.text === 'string') {
    onLLMFinal?.({text: ev.text});
  }
  break;
```

### 2.5 Backend — який LLM модуль використати

PHANTOM має `ai/provider.py` з `AIProvider` interface. Метод `respond` зараз НЕ streaming. Треба додати **streaming variant**:

**File:** `src/backend/ai/provider.py`

```python
@abstractmethod
async def respond_stream(
    self,
    prompt: str,
    *,
    system: Optional[str] = None,
    history: Optional[list[ChatTurn]] = None,
    cancel_token: Optional[CancelToken] = None,
) -> AsyncIterator[str]:
    """Yield response tokens as they generate. Honor cancel_token."""
```

**File:** `src/backend/ai/gemini_provider.py`

Gemini SDK (`google-genai`) підтримує `client.models.generate_content_stream(...)`. Імплементувати `respond_stream` як generator over chunks.

**File:** `src/backend/ai/ollama_provider.py`

Ollama HTTP API має `stream=true`. Імплементувати async iterator over response lines.

### 2.6 Cancel token

**File:** `src/backend/ai/provider.py` (новий клас)

```python
class CancelToken:
    def __init__(self) -> None:
        self._cancelled = False

    def cancel(self) -> None:
        self._cancelled = True

    @property
    def cancelled(self) -> bool:
        return self._cancelled
```

Provider implementations перевіряють `cancel_token.cancelled` перед кожним yield. На Gemini — закрити stream context. На Ollama — abort http request.

### 2.7 Тести

- Unit: stability counter в StreamingVoskRecognizer.
- Unit: predictive task cancel коли predicted ≠ final.
- Unit: predictive task проходить коли predicted == final, emit `predictive_committed`.
- Integration: full happy-path streaming partial → predictive kickoff → speech_end with match → llm_partial events → llm_final.

---

## 3. Стовп 3 — Streaming TTS

### 3.1 Концепція

StyleTTS2 за замовчуванням синтезує **весь текст одразу** і повертає WAV. Для речення "Привіт, як справи? Що нового сьогодні?" це 1.5-2 секунди очікування, потім миттєвий старт playback.

Streaming TTS = **синтезувати по реченню (або фразі)**, відразу віддавати на playback, наступне речення йде паралельно. Перший звук — через ~300-500 ms замість 1.5-2 c.

### 3.2 Pipeline

```
LLM stream tokens                 Sentence buffer                StyleTTS2 worker            Browser audio
─────────────                     ───────────────                ──────────────              ─────────────
"Привіт"   ──┐
", як "      ├─ accumulate ──▶  "Привіт, як справи?"  ──▶ synthesize → WAV chunk → ws send → ▶ audio.play()
"справи?"  ──┘   detect end-of-sentence
                                                                                              (паралельно):
"Що "      ──┐
"нового "    ├─ accumulate ──▶  "Що нового сьогодні?" ──▶ synthesize → WAV chunk → ws send → ▶ append to queue
"сьогодні?"──┘
```

### 3.3 Sentence detector

**File:** `src/backend/voice/tts_streamer.py` (новий)

```python
"""
TTS streaming buffer — групує LLM токени в речення для StyleTTS2.

Sentence boundary heuristic:
  • '.', '!', '?', ';', ':' followed by space/EOL → boundary
  • >= MAX_SENTENCE_CHARS without boundary → force boundary (long monologue)
  • EOF (LLM stream ended) → flush remaining
"""
import re
from typing import AsyncIterator

_SENTENCE_RE = re.compile(r"([.!?;:][\s\n]|[.!?;:]$)")
MAX_SENTENCE_CHARS = 200
MIN_SENTENCE_CHARS = 8  # дуже короткі ("Так.") синтезувати окремо ОК


class SentenceStreamer:
    def __init__(self) -> None:
        self._buffer = ""

    def feed(self, chunk: str) -> list[str]:
        """Append chunk, return list of complete sentences ready to synthesize."""
        self._buffer += chunk
        sentences: list[str] = []
        while True:
            m = _SENTENCE_RE.search(self._buffer)
            if not m and len(self._buffer) < MAX_SENTENCE_CHARS:
                break
            cut_at = m.end() if m else MAX_SENTENCE_CHARS
            sent = self._buffer[:cut_at].strip()
            self._buffer = self._buffer[cut_at:]
            if sent and len(sent) >= MIN_SENTENCE_CHARS:
                sentences.append(sent)
            elif sent:
                # дуже коротке — підшити до наступного buffer'а
                self._buffer = sent + " " + self._buffer
                break
        return sentences

    def flush(self) -> str:
        rest = self._buffer.strip()
        self._buffer = ""
        return rest
```

### 3.4 TTS worker

**File:** `src/backend/voice/tts_engine.py` (доповнення)

Додати async iterator interface:
```python
async def synthesize_stream(
    self,
    sentences: AsyncIterator[str],
    voice: str,
    speed: float,
) -> AsyncIterator[bytes]:
    """Yield WAV chunks per sentence as they synthesize."""
    async for sent in sentences:
        result = await self.synthesize(sent, voice, speed)
        yield result.audio_bytes
```

### 3.5 WS protocol — нові events

```python
{"type": "tts_chunk_start", "chunk_index": 0, "text": "Привіт, як справи?"}
{"type": "tts_chunk_audio", "chunk_index": 0}  # binary frame followed
# (binary frame з WAV bytes)
{"type": "tts_chunk_end", "chunk_index": 0}
{"type": "tts_stream_end", "total_chunks": 4}
```

### 3.6 Frontend audio queue

**File:** `src/frontend/src/services/voiceApi.ts` або новий `streamingTTS.ts`

```ts
class StreamingTTSPlayer {
  private queue: Blob[] = [];
  private playing = false;
  private audio: HTMLAudioElement | null = null;

  enqueue(wavBlob: Blob): void {
    this.queue.push(wavBlob);
    if (!this.playing) void this.playNext();
  }

  private async playNext(): Promise<void> {
    if (this.queue.length === 0) {
      this.playing = false;
      return;
    }
    this.playing = true;
    const blob = this.queue.shift()!;
    const url = URL.createObjectURL(blob);
    this.audio = new Audio(url);
    this.audio.onended = () => {
      URL.revokeObjectURL(url);
      void this.playNext();
    };
    this.audio.onerror = () => {
      URL.revokeObjectURL(url);
      void this.playNext();
    };
    await this.audio.play();
  }

  stopAll(): void {
    this.queue = [];
    if (this.audio) {
      try { this.audio.pause(); } catch { /* ignore */ }
      this.audio = null;
    }
    this.playing = false;
  }
}
```

В `useVoiceAlwaysOn._handleServerEvent`:
- `tts_chunk_audio` event підказує що наступний binary frame — WAV для chunk N. Зберегти `expectedChunk = N`.
- На binary frame коли waiting for chunk audio — `streamingTTSPlayer.enqueue(blob)`.
- `tts_stream_end` — кінець потоку.

---

## 4. Стовп 4 — Semantic Endpointing

### 4.1 Концепція

Зараз `voice_silence_timeout_ms` константний (default 800-1500). Ситуації:
- "Ну, я думаю..." (пауза 1500ms) "...що це непогана ідея" — поточна система **поріже** на "Ну, я думаю".
- "Привіт.|" (явний кінець, тиша 300ms) — поточна система **чекає 1500ms** даремно.

SaaS-рішення: silence_ms залежить від context'у:
- Якщо partial transcript закінчується крапкою/знаком питання + Vosk-confidence висока → silence_ms = 300-500.
- Якщо партіал закінчується сполучником ("і", "що", "та") або hesitation marker ("ну", "ем", "е-е-е") → silence_ms = 2000-3000.
- За замовчуванням → 1000.

### 4.2 Implementation

**File:** `src/backend/voice/semantic_endpointer.py` (новий, ~80 рядків)

```python
"""
Semantic endpointer — adapts silence_timeout per partial transcript context.

Pure heuristic, no ML. Keeps decisions explainable.
"""
import re
from dataclasses import dataclass


HESITATION_TOKENS = {"ну", "ем", "е-е-е", "е", "м-м", "ах", "ага", "так", "от"}
CONJUNCTIONS = {"і", "та", "що", "як", "де", "коли", "якщо", "але", "хоча"}
TERMINATORS = re.compile(r"[.!?]\s*$")


@dataclass(frozen=True)
class EndpointDecision:
    silence_ms: int
    reason: str


def adaptive_silence_ms(
    partial_text: str,
    *,
    base_ms: int = 1000,
    short_ms: int = 400,
    long_ms: int = 2500,
) -> EndpointDecision:
    """Decide adaptive silence timeout based on partial text shape.

    Always returns a decision; reason field for logging/debugging.
    """
    text = (partial_text or "").strip().lower()
    if not text:
        return EndpointDecision(silence_ms=base_ms, reason="empty")
    if TERMINATORS.search(text):
        return EndpointDecision(silence_ms=short_ms, reason="terminator")
    last_word = text.split()[-1].rstrip(",;:")
    if last_word in HESITATION_TOKENS:
        return EndpointDecision(silence_ms=long_ms, reason="hesitation")
    if last_word in CONJUNCTIONS:
        return EndpointDecision(silence_ms=long_ms, reason="conjunction")
    return EndpointDecision(silence_ms=base_ms, reason="default")
```

### 4.3 Інтеграція в orchestrator

**File:** `src/backend/voice/always_on.py`

В `_process_frame_streaming` після кожного partial:
```python
if partial is not None and partial.text:
    from voice.semantic_endpointer import adaptive_silence_ms
    decision = adaptive_silence_ms(
        partial.text,
        base_ms=config.voice_silence_timeout_ms,
        short_ms=config.voice_silence_min_ms,
        long_ms=config.voice_silence_max_ms,
    )
    # Динамічно оновлюємо VAD's silence_windows
    self._vad.set_silence_ms(decision.silence_ms)
```

Потрібно **додати метод `set_silence_ms`** в `SileroVAD`/`_Hysteresis` який перераховує `silence_windows` без reset.

**File:** `src/backend/voice/vad.py`

```python
def set_silence_ms(self, silence_ms: int) -> None:
    """Update silence threshold mid-utterance. Recalculates windows."""
    window_ms = 1000 * self._window_samples / self._sample_rate
    new_silence_windows = max(1, int(silence_ms // window_ms))
    self._hysteresis.set_silence_windows(new_silence_windows)
```

### 4.4 Config keys

```python
voice_semantic_endpointing: bool = True
voice_silence_min_ms: int = 400   # коли явно завершено
voice_silence_max_ms: int = 2500  # коли hesitation
```

### 4.5 Тести

- `adaptive_silence_ms("привіт.")` → `short_ms`
- `adaptive_silence_ms("привіт як")` → `long_ms` (як = conjunction)
- `adaptive_silence_ms("ну")` → `long_ms` (hesitation)
- `adaptive_silence_ms("привіт")` → `base_ms`
- Integration: orchestrator адаптує silence dynamically.

---

## 5. Стовп 5 — Barge-in (interrupt PHANTOM by speaking)

### 5.1 Концепція

Поточно під час TTS PHANTOM повністю глушить мікрофон (`mic_duck` JSON command + worklet mute). Користувач хоче перебити голосом — не може. Має чекати. Це і є "не SaaS".

SaaS-підхід:
- Мікрофон лишається слухати під час TTS playback.
- Вхідний звук (mic) - вихідний звук (TTS playback) = **AEC** (Acoustic Echo Cancellation).
- Browser-VAD на cleaned audio: якщо detected speech під час TTS → barge-in event → backend cancel TTS, cancel LLM, start new turn.

### 5.2 AEC варіанти

**Варіант A (швидкий):** ввімкнути `echoCancellation: true` в `getUserMedia` constraints. Браузер сам АЕC якщо:
- TTS audio грається через ту ж AudioContext.
- АБО browser автоматично subscribe'ується до системного output (Chromium робить це за замовчуванням з 2022).

Поточно `useMicStream.ts:81` має `echoCancellation: true` — отже AEC вже активний на рівні браузера. Перевірити чи реально субтрактає TTS playback (там HTMLAudioElement через `URL.createObjectURL(blob)`, не через Web Audio API).

**Варіант B (правильний):** провести TTS playback через ту ж AudioContext через `AudioBufferSourceNode`, що дає браузеру явний "loopback reference signal".

```ts
async function playStreamingChunkInWebAudio(audioCtx: AudioContext, wavBlob: Blob) {
  const arrayBuffer = await wavBlob.arrayBuffer();
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  const source = audioCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(audioCtx.destination);
  source.start();
  return new Promise<void>((resolve) => { source.onended = () => resolve(); });
}
```

### 5.3 Barge-in detection

В `useVoiceAlwaysOn.ts`:
```ts
const ttsPlayingRef = useRef(false);

// On tts_chunk_start: ttsPlayingRef.current = true
// On tts_stream_end:  ttsPlayingRef.current = false

// In MicVAD.onSpeechStart:
if (ttsPlayingRef.current) {
  // BARGE-IN!
  ws.send(JSON.stringify({cmd: "barge_in"}));
  streamingTTSPlayer.stopAll();
  // НЕ викликаємо mic_duck — мікрофон лишається активним
}
```

### 5.4 Backend barge-in handler

**File:** `src/backend/api/routes_voice_stream.py`

```python
elif cmd == "barge_in":
    # Cancel any in-flight predictive LLM and TTS streaming
    if orch._predictive_task is not None:
        orch._predictive_task.cancel()
    if orch._tts_streaming_task is not None:
        orch._tts_streaming_task.cancel()
    await self.send({"type": "barge_in_ack"})
```

### 5.5 Mic ducking — opt-out only

Замість `voice_mic_duck_on_tts: bool = True` — той же ключ але default `False` коли barge-in увімкнений.

```python
voice_barge_in_enabled: bool = True
voice_mic_duck_on_tts: bool = False  # default змінений
```

Якщо `voice_barge_in_enabled=True` — `mic_duck` команда від ChatWindow не йде (ChatWindow перевіряє settings.voice_barge_in_enabled).

### 5.6 Edge cases

- **AEC не справляється:** TTS пробивається в мікрофон, MicVAD активується, barge-in fires помилково. Mitigation: spectral fingerprint TTS audio і відняти на frontend — складно. Простіший fallback: тоді барге-ін за замовчуванням OFF, оператор робить opt-in через settings.
- **Користувач сказав щось коротке "ага" як backchannel** — barge-in не має тригерити. Mitigation: minimum speech duration перед barge-in fire = 500ms.

---

## 6. Стовп 6 — Real wake-word (openWakeWord ONNX)

### 6.1 Концепція

Поточно `mode='wake_word'` робить substring search над ВИХІДНИМ Vosk transcript'ом (тобто PHANTOM транскрибує ВСЕ що почув, потім фільтрує). Це означає мікрофон та STT **завжди працюють**. Зайва робота.

SaaS-рішення: **ONNX wake-word модель на frontend** (~2 MB, інферить в worklet'і або Web Worker'і за <5 ms на frame). Поки не задетектила "фантом" — WS взагалі не відкривається. Backend СПИТЬ.

### 6.2 Бібліотека

[openWakeWord](https://github.com/dscripka/openWakeWord) — open source, ~16 MB models, ONNX runtime. Має модель "hey jarvis" і tools для тренування власних. Альтернатива: [Porcupine](https://picovoice.ai/platform/porcupine/) — комерційна, але має free tier для personal use.

Для PHANTOM — потрібна **українська модель "фантом"**. Варіанти:
- **A: тренувати власну** через openWakeWord pipeline (~50-200 записів wake + ~10000 негативних). 4-12 годин зусиль + ~5 GB GPU compute (можна Colab free).
- **B: тимчасово використати англомовну "hey jarvis"** як placeholder поки тренується "фантом".
- **C: купити Porcupine custom keyword** — швидко, ~$10/keyword/year, але зовнішній сервіс.

Рекомендую **B → A** — почати з jarvis як proof-of-concept, потім тренувати "фантом".

### 6.3 Frontend — wake gate

**File:** `src/frontend/src/hooks/useWakeWordGate.ts` (новий)

```ts
export function useWakeWordGate(opts: {
  enabled: boolean;
  modelUrl: string;
  threshold: number;
  onWake: () => void;
}) {
  // Web Worker з onnxruntime-web inference на 80ms windows
  // Inference cycle: ~5-10 ms per window на ARM Chromium
  // ...
}
```

Логіка інтеграції в `useVoiceAlwaysOn`:
```ts
const [wakeArmed, setWakeArmed] = useState(false);

useWakeWordGate({
  enabled: voiceMode === 'wake_word',
  modelUrl: '/wake-models/phantom.onnx',
  threshold: 0.7,
  onWake: () => {
    setWakeArmed(true);
    void start();  // тепер відкриваємо WS і починаємо stream
  },
});

// WS закриваємо через 30 секунд після останнього SPEECH_END
// якщо wakeArmed і немає активного speech
```

### 6.4 Mode зміни

`voice_mode='wake_word_real'` (новий) на відміну від `voice_mode='wake_word'` (старий substring filter).
- `'continuous'` — як в 13b.
- `'wake_word'` — старий substring (legacy).
- `'wake_word_real'` — НОВИЙ ONNX detector.

### 6.5 Що це дає

- WS connection only on demand: backend CPU = **0%** доки PHANTOM не почув своє ім'я.
- Mic stream все ще йде в browser (для wake detector), але не передається на backend.
- Frontend privacy++.

---

## 7. Послідовність комітів (велика фаза, розбита на 6 sub-phases)

### Phase 14.1 — Predictive LLM (8-12 годин)

| # | Commit | Гейт |
|---|--------|------|
| 14.1.1 | StreamingVoskRecognizer stability counter | pytest |
| 14.1.2 | AIProvider.respond_stream interface | pytest |
| 14.1.3 | GeminiProvider.respond_stream impl | pytest + integration vs real Gemini |
| 14.1.4 | OllamaProvider.respond_stream impl | pytest |
| 14.1.5 | CancelToken | pytest |
| 14.1.6 | Orchestrator predictive_task wiring | pytest |
| 14.1.7 | WS protocol: predictive_committed, llm_partial, llm_final | pytest |
| 14.1.8 | Frontend handlers + chat store update API | vitest |
| 14.1.9 | tag v0.14.1 + acceptance | manual |

### Phase 14.2 — Streaming TTS (5-8 годин)

| # | Commit | Гейт |
|---|--------|------|
| 14.2.1 | SentenceStreamer | pytest |
| 14.2.2 | TTS engine synthesize_stream | pytest |
| 14.2.3 | WS protocol: tts_chunk_* events | pytest |
| 14.2.4 | StreamingTTSPlayer frontend | vitest |
| 14.2.5 | useVoiceAlwaysOn TTS chunk handlers | vitest |
| 14.2.6 | tag v0.14.2 + acceptance | manual |

### Phase 14.3 — Semantic endpointing (3-5 годин)

| # | Commit | Гейт |
|---|--------|------|
| 14.3.1 | semantic_endpointer module | pytest |
| 14.3.2 | SileroVAD.set_silence_ms | pytest |
| 14.3.3 | Orchestrator integration | pytest |
| 14.3.4 | Config keys + UI | vitest |
| 14.3.5 | tag v0.14.3 + acceptance | manual |

### Phase 14.4 — Barge-in (4-6 годин)

| # | Commit | Гейт |
|---|--------|------|
| 14.4.1 | TTS playback through Web Audio (AEC ref) | vitest |
| 14.4.2 | barge_in WS command + backend handler | pytest |
| 14.4.3 | Frontend MicVAD during TTS + cancel propagation | vitest |
| 14.4.4 | Settings: voice_barge_in_enabled | vitest |
| 14.4.5 | tag v0.14.4 + acceptance | manual + verify mic не лагає |

### Phase 14.5 — Real wake-word (5-9 годин)

| # | Commit | Гейт |
|---|--------|------|
| 14.5.1 | Add openWakeWord dep + jarvis placeholder model | vitest |
| 14.5.2 | useWakeWordGate hook | vitest |
| 14.5.3 | useVoiceAlwaysOn wake-armed integration | vitest |
| 14.5.4 | mode='wake_word_real' backend support | pytest |
| 14.5.5 | (optional) Train phantom.onnx — окремий процес | n/a |
| 14.5.6 | tag v0.14.5 + acceptance | manual |

### Phase 14.6 — Acceptance + tag

| # | Commit | Гейт |
|---|--------|------|
| 14.6.1 | docs/phase-14-saas-grade-voice/ACCEPTANCE.md | manual |
| 14.6.2 | tag v0.14.0-saas-grade | release |

---

## 8. Acceptance criteria для всієї фази

`docs/phase-14-saas-grade-voice/ACCEPTANCE.md` — заповнити:

1. **Predictive LLM:**
   - 5 утерансів. Перевірити: на стабільному partial сервер логує `kickoff_predictive`.
   - На утерансах де final == predicted: TTS починається до того як user перестав говорити.
   - На утерансах де final ≠ predicted: predictive task cancelled, no audio артефактів.
2. **Streaming TTS:**
   - Час від першого LLM token до першого TTS звуку ≤ 600 ms.
   - Чути перерви між реченнями? (acceptable якщо ≤ 200 ms).
   - Якість StyleTTS2 не погіршилась per-sentence vs full-text?
3. **Semantic endpointing:**
   - "Ну я думаю..." (пауза 2c) "...що це добре" — НЕ ріжеться.
   - "Привіт." (пауза 0.5c) — final за 500-700 ms, не 1500.
   - "Що?" — final за 500-700 ms.
4. **Barge-in:**
   - PHANTOM говорить, юзер каже "стоп" — TTS зупиняється у межах 200 ms, новий turn починається.
   - Беккграунд шум (телевізор, вентилятор) НЕ тригерить помилковий barge-in.
   - AEC: TTS audio в мікрофон не повертається як користувач "повторив свою фразу".
5. **Real wake-word:**
   - Тиша 30 секунд → backend CPU = 0% (jarvis-detector тільки в browser).
   - "Привіт як справи" (без wake) → ніщо не відкривається, нічого не передається.
   - "Фантом, привіт" → wake_armed=true, WS відкривається, бекенд починає stream обробку.
   - False-positive rate в типовій кімнаті ≤ 1 / 10 хвилин.

6. **Subjective.** Користувач після 30-хвилинної сесії каже "це SaaS-рівень" / "майже" / "не зовсім".

---

## 9. Performance budget (target)

| Stage | Phase 13b | Phase 14 | Win |
|-------|----------:|---------:|----:|
| First partial visible | 300 ms | 300 ms | same |
| LLM thinking start | after final (~2-4 s) | on stable partial (~0-500 ms before final) | **gigantic** |
| First TTS audio playback | after LLM done (~2-3 s) | per-sentence streaming (~300-500 ms) | **5-10×** |
| Total: speech-end → first sound | 3-5 s | **0-500 ms** (if predictive hit) | **gigantic** |
| Barge-in latency | n/a | ≤ 200 ms | new |
| Backend CPU at idle (wake-word mode) | 2-4% | **0%** | **infinite** |

---

## 10. Ризики та обмеження

### 10.1 Predictive LLM API cost
- **[H] При predictive miss — викидаємо invocation.** На Gemini 2.0 Flash це ~50 токенів вхід + ~20 токенів вихід. Pricing 2026: $0.075/M вхід, $0.30/M вихід → ~$0.000017 per miss. На 100 misses/день = $0.05/місяць. Acceptable.
- **[M] Ollama локальний — нема грошей, але CPU.** Кожен miss = ~500 ms warm Gemma 4. Нескінченних missed predictions немає бо stability threshold.

### 10.2 Streaming TTS quality
- **[M] StyleTTS2 на коротких реченнях має менше контексту для просодії.** Голос може звучати "плоско" на одно-словних реченнях ("Так." "Ага."). Mitigation: збирати кілька коротких речень в одне якщо разом < 50 chars.

### 10.3 Semantic endpointer accuracy
- **[L] Hesitation list не покриває всю українську розмовну мову.** "ну-у-у", "та-а-к", діалектні маркери. Mitigation: додавати по мірі реальної експлуатації; список в config (`voice_hesitation_words`).

### 10.4 Barge-in AEC reliability
- **[H] AEC на Radxa Q6A може бути недостатнім якщо мікрофон/динамік близько.** Якщо TTS пробивається через AEC — false barge-in, нескінченний цикл перебивання. Mitigation: barge-in default OFF до того як перевіримо на залізі.
- **[M] HTML5 Audio замість Web Audio може не давати АЕС reference signal.** Reference Phase-13-plan §3 candidate E note: AEC requires the browser to know about the playback stream. Тому критично пройти TTS через WebAudio AudioContext.

### 10.5 Wake-word false positive/negative
- **[M] "Фантом" короткое слово, легко плутається з фрагментами інших слів.** Mitigation: threshold 0.7-0.8 (не 0.5), validation на real recordings.
- **[M] Тренування власної openWakeWord моделі — окрема піддиректорія project/wake-word-training/ з pipeline.** Це 4-12 годин роботи, але робиться раз.

### 10.6 LLM streaming on Gemini API
- **[L] Quota / rate limits.** Gemini Flash має 60 RPM free tier. Predictive misses їдять quota. Mitigation: monitor, cache misses by partial text (don't kickoff identical predictive text twice).

---

## 11. Дизайн-рішення які явно НЕ робимо

- **WebRTC transport.** Phase-13-plan §3.E — занадто дорого, відкладено. Поточний WS + AEC через AudioContext = достатньо.
- **Custom wake-word через Whisper turbo.** Whisper навіть turbo занадто важкий для wake-detection cadence.
- **Server-side AEC.** Робиться в браузері — менше latency, менше CPU на backend.
- **Емоційна адаптація голосу до user mood.** Це окрема Phase 15 (personality-driven voice).
- **Multi-speaker diarization.** PHANTOM один-на-один з оператором. Не потрібно.
- **Cloud LLM streaming через Anthropic / OpenAI замість Gemini.** Вже є fallback chain Gemini → Ollama, не змінюємо.

---

## 12. Roll-back paths

- Кожен з 5 sub-phases має свій feature flag, тегований реліз і dedicated tests. Можна `git revert` будь-який окремо.
- Найризикованіший: 14.4 (barge-in). Якщо false-positives — `voice_barge_in_enabled=false` в settings, поведінка миттєво legacy.
- Predictive LLM: якщо cost зростає → `voice_predictive_llm=false`.
- Streaming TTS: якщо якість гірша → `voice_streaming_tts=false`, повертається до synthesize-all-then-play.

---

## 13. Сумарний UX after Phase 14

| Сценарій | Before (12.x) | After 13b | After 14 |
|----------|---------------|-----------|----------|
| Швидке "Привіт" | 3-5c пауза, потім чат текст, потім TTS відп. | Ghost bubble під час, real bubble через 200ms, потім TTS | Ghost bubble + LLM ще thinking + перші TTS звуки за ~500ms після того як юзер закінчив |
| Довге питання з паузами | Часто ріжеться посеред думки | Те саме (silence_ms константа) | Адаптивний endpointer тримає мовлення до завершення |
| Користувач передумав | Чекає поки PHANTOM закінчить, потім скасовує | Те саме | Каже "стоп" або наступне питання — PHANTOM миттєво перемикається |
| Мікрофон в кімнаті, поки немає звертання | WS+CPU постійно зайняті | WS+CPU постійно зайняті | CPU=0%, WS закритий, чекає wake |

**Це і є SaaS-рівень.**
