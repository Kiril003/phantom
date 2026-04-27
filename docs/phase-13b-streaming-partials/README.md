# Phase 13b — Streaming Partial Transcripts (Live Feel)

> **Мета фази:** зробити так щоб користувач БАЧИВ свої слова в чаті ВЖЕ ПІД ЧАС МОВЛЕННЯ, а не після нього. Це найбільший психологічний win — навіть якщо total latency не зміниться, відчуття "застосунок мене чує в моменті" зробить взаємодію живою.
> **Передумова:** Phase 13a вже завершена і змерджена. Без 13a backend CPU просто не витримає streaming partials.
> **Цільовий результат:**
> - Перший partial transcript з'являється на UI через ≤ 300 ms від першого слова.
> - Партіали оновлюються кожні ~150-250 ms.
> - Final після `speech_end` приходить через ≤ 200 ms.
> - End-to-end "користувач чує власні думки" відчуття: instant.
> **Час на реалізацію:** 12–18 годин (1-2 робочі сесії).
> **Ризик:** середній. Зачіпає протокол WS, frontend chat store, і backend FSM. Усе під feature flag.
> **Вхід:** тег `v0.13.0a-quickwins`.
> **Вихід:** тег `v0.13.0b-streaming-partials`.

---

## 0. Передумови

### 0.1 Що має бути зроблене перед стартом

- Phase 13a змерджена. Backend з Whisper-small + client-VAD + warm-up.
- Бекенд stable, тести зелені.
- Vosk model singleton прогрітий і доступний (вже є з 11b).

### 0.2 Концептуальна зміна

```
ДО (current):                          ПІСЛЯ (Phase 13b):

  speech_start                           speech_start  ── frontend: ghost bubble appear
       │                                      │
       │ (3-5s wait)                          │ partial "при..."  → ghost bubble updates
       │                                      │ partial "привіт"  → ghost bubble updates
       │                                      │ partial "привіт як"
       │                                      │ partial "привіт як справи"
  speech_end                             speech_end ── ghost finalises into real bubble
       │                                      │
       │ STT (1-3s)                           │ final "привіт як справи" (~200ms) → POST chat
       │                                      │
  final → POST chat                      [optional] final_revised "..." з Whisper background
       │                                                       ↓ chatStore.replaceLastUserMessage
  user sees text first time              user already saw text live
```

### 0.3 Чому Vosk, а не streaming Whisper

Phase-13-plan README §3 розглядав 6 кандидатів. Для PHANTOM Vosk streaming = найдешевший win:
- Vosk модель **вже завантажена** (300 MB у RAM завжди).
- `KaldiRecognizer.PartialResult()` нативно стрімить — не треба whisper-streaming протокол з sliding-window LocalAgreement-2.
- Latency перших partials: **< 100 ms на ARM CPU**.
- Final result: **< 200 ms після speech_end**.
- Whisper лишається — як background **refine** для якості після того як LLM вже почав думати.

---

## 1. Архітектура Phase 13b

```
┌─────────────────────────────────── Browser ───────────────────────────────────┐
│                                                                               │
│  AudioWorklet (без змін з 13a)                                                │
│       │                                                                       │
│       ▼                                                                       │
│  client-VAD gate (з 13a)                                                      │
│       │ binary frames (тільки під час speech)                                 │
│       ▼                                                                       │
│  WS /ws/voice ──────────────────────────────────────────────────┐             │
│                                                                 │             │
│  useVoiceAlwaysOn._handleServerEvent                            │             │
│   case 'partial': setPartialTranscript(text)                    │             │
│   case 'final':   onFinalTranscript({text, source:'vosk_fast'}) │             │
│   case 'final_revised': onRevisedTranscript({text})  ← NEW      │             │
│       │                                                         │             │
│       ▼                                                         │             │
│  VoiceAlwaysOnGate                                              │             │
│   • partialTranscript  → setUserPreview(text) ← already exists  │             │
│   • final              → sendMessage(text, 'voice', state)      │             │
│   • final_revised      → updateLastUserMessage(text)  ← NEW     │             │
│                                                                 │             │
│  ChatWindow                                                     │             │
│   • render userPreview as ghost bubble (italic, dimmed)         │             │
│   • when sendMessage hits → ghost replaced by real bubble       │             │
│                                                                 │             │
└─────────────────────────────────────────────────────────────────┼─────────────┘
                                                                  │
┌─────────────────────────────────────────────────────────────────┼─────────────┐
│  Backend                                                        │             │
│                                                                 ▼             │
│  routes_voice_stream → AlwaysOnOrchestrator (Phase 13b mode)                  │
│                                                                               │
│   on speech_start:                                                            │
│     • build free-grammar KaldiRecognizer (vosk_model singleton)               │
│     • start utterance buffer                                                  │
│     • emit speech_start                                                       │
│                                                                               │
│   on each frame during speech:                                                │
│     • utterance_buffer.extend(pcm)                                            │
│     • is_final = recognizer.AcceptWaveform(pcm)                               │
│     • text = (Result if is_final else PartialResult)['partial' or 'text']     │
│     • if text changed AND debounce-ok → emit partial                          │
│                                                                               │
│   on speech_end:                                                              │
│     • final_text = recognizer.FinalResult()['text']                           │
│     • emit final {transcript: final_text, source: 'vosk_fast', confidence}    │
│     • [optional] spawn background_refine_task(utterance_buffer)               │
│                                                                               │
│   background_refine_task (asyncio.create_task):                               │
│     • whisper_text = await whisper_provider.transcribe(audio)                 │
│     • if levenshtein_ratio(vosk, whisper) < THRESHOLD:                        │
│         emit final_revised {transcript: whisper_text, source: 'whisper_quality'}│
│     • else: silently discard (Vosk вже хороший)                               │
│                                                                               │
└───────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Backend зміни

### 2.1 Новий config keys

**File:** `src/backend/config.py`

Додати після `voice_silence_timeout_ms` (line ~135):

```python
# Phase 13b — streaming partials.
# Коли True (default), always-on orchestrator емітить `partial` події
# під час мовлення замість тихо буферувати. Це перетворює "застій" на
# живе відчуття. False = legacy 12.x поведінка.
voice_streaming_partials: bool = True

# Дебаунс для partial events. Vosk може видавати nove partials кожні
# ~50ms; занадто часті оновлення UI створюють миготіння. 200ms = ~5 fps,
# відчувається плавно.
voice_partial_debounce_ms: int = 200

# Phase 13b — фонове переуточнення Whisper'ом.
# Якщо True, після Vosk-final запускаємо Whisper на тому ж буфері. Якщо
# результат суттєво відрізняється — емітимо final_revised. За замовчуванням
# OFF щоб не плодити "магічних" корекцій без явного opt-in.
voice_refine_with_whisper: bool = False

# Поріг різниці (Levenshtein-ratio від 0 до 1) при якому ввімкнений refine
# вирішує що Whisper суттєво кращий. <0.85 = різна > 15% символів.
voice_refine_diff_threshold: float = 0.85
```

Додати валідатори в `_validate_voice_mode_keys`:
- `voice_partial_debounce_ms` ∈ [50, 1000]
- `voice_refine_diff_threshold` ∈ [0.0, 1.0]

### 2.2 Новий модуль `voice/streaming_recognizer.py`

**File:** `src/backend/voice/streaming_recognizer.py` (новий, ~120 рядків)

```python
"""
StreamingVoskRecognizer — Phase 13b streaming partial transcripts.

Wraps a free-grammar vosk.KaldiRecognizer with a delta-emit + debounce
loop. Designed for use inside AlwaysOnOrchestrator's per-utterance scope:
construct on speech_start, feed frames, finalise on speech_end.

Public contract:
  StreamingVoskRecognizer(vosk_model, sample_rate=16000, debounce_ms=200)
  feed(pcm_bytes: bytes) -> Optional[PartialEvent]
  finalise() -> FinalEvent
  reset() -> None

PartialEvent: {"text": str, "is_committed": bool}
FinalEvent: {"text": str, "confidence": float}
"""
from __future__ import annotations
import json
import time
from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class PartialEvent:
    text: str
    # is_committed=True коли Vosk внутрішньо вирішив "це фінальне слово",
    # навіть якщо utterance триває. Використовуємо для UI кольорового підкреслення.
    is_committed: bool = False


@dataclass(frozen=True)
class FinalEvent:
    text: str
    confidence: float


class StreamingVoskRecognizer:
    def __init__(
        self,
        vosk_model,
        *,
        sample_rate: int = 16_000,
        debounce_ms: int = 200,
    ) -> None:
        import vosk
        self._model = vosk_model
        self._sample_rate = int(sample_rate)
        self._debounce_s = debounce_ms / 1000.0

        self._recognizer = vosk.KaldiRecognizer(self._model, self._sample_rate)
        self._recognizer.SetWords(True)

        self._last_partial_text: str = ""
        self._last_partial_emit_at: float = 0.0
        # Текст підтверджених (committed) сегментів — Vosk періодично
        # виробляє "проміжний final" для частин довгих утерансів.
        self._committed_text: str = ""

    def feed(self, pcm_bytes: bytes) -> Optional[PartialEvent]:
        """Feed s16le PCM. Returns a PartialEvent тільки якщо текст змінився
        І минув debounce. None щоб скоротити кількість UI оновлень."""
        if not pcm_bytes:
            return None
        is_committed = self._recognizer.AcceptWaveform(pcm_bytes)
        if is_committed:
            payload = json.loads(self._recognizer.Result() or "{}")
            chunk = (payload.get("text") or "").strip()
            if chunk:
                self._committed_text = (
                    self._committed_text + " " + chunk if self._committed_text else chunk
                )
            full_text = self._committed_text
            committed = True
        else:
            payload = json.loads(self._recognizer.PartialResult() or "{}")
            partial = (payload.get("partial") or "").strip()
            full_text = (
                self._committed_text + " " + partial if self._committed_text else partial
            )
            committed = False

        now = time.monotonic()
        if full_text == self._last_partial_text:
            return None
        if (now - self._last_partial_emit_at) < self._debounce_s and not committed:
            # дебаунс — зберігаємо текст але ще не емітимо
            return None
        self._last_partial_text = full_text
        self._last_partial_emit_at = now
        return PartialEvent(text=full_text, is_committed=committed)

    def finalise(self) -> FinalEvent:
        """Force a final result. Called on SPEECH_END."""
        payload = json.loads(self._recognizer.FinalResult() or "{}")
        text = (payload.get("text") or "").strip()
        if self._committed_text:
            text = (self._committed_text + " " + text).strip() if text else self._committed_text
        words = payload.get("result") or []
        if words:
            conf = float(sum(w.get("conf", 0.0) for w in words) / len(words))
        else:
            conf = 1.0 if text else 0.0
        return FinalEvent(text=text, confidence=conf)

    def reset(self) -> None:
        import vosk
        self._recognizer = vosk.KaldiRecognizer(self._model, self._sample_rate)
        self._recognizer.SetWords(True)
        self._last_partial_text = ""
        self._last_partial_emit_at = 0.0
        self._committed_text = ""
```

### 2.3 Зміни в orchestrator

**File:** `src/backend/voice/always_on.py`

- Додати імпорт `from voice.streaming_recognizer import StreamingVoskRecognizer, PartialEvent, FinalEvent`.
- Додати константу `MODE_STREAMING = "streaming"` (нова).
- В `__init__` додати field `self._streaming: Optional[StreamingVoskRecognizer] = None`.
- В `__init__` приймати `streaming_partials: bool = False`, `partial_debounce_ms: int = 200`.
- В `process_frame` додати dispatch на `_process_frame_streaming`, який активний коли `streaming_partials=True` І `mode in (MODE_CONTINUOUS, MODE_WAKE_WORD)`.

```python
async def _process_frame_streaming(self, pcm_bytes: bytes) -> None:
    """Phase 13b: VAD + streaming Vosk partials."""
    try:
        vad_events = await asyncio.to_thread(self._vad.process, pcm_bytes)
    except ValueError as exc:
        await self._emit_error(f"vad: {exc}")
        return

    if SPEECH_START in vad_events:
        self._in_utterance = True
        self._utterance_pcm = bytearray(pcm_bytes)
        self._streaming = StreamingVoskRecognizer(
            self._vosk_model,
            sample_rate=self._sample_rate,
            debounce_ms=self._partial_debounce_ms,
        )
        await self._send({"type": "speech_start"})
    elif self._in_utterance:
        self._utterance_pcm.extend(pcm_bytes)

    if self._in_utterance and self._streaming is not None:
        try:
            partial = await asyncio.to_thread(self._streaming.feed, pcm_bytes)
        except Exception as exc:
            logger.warning("streaming recognizer failed: %s", exc)
            partial = None
        if partial is not None and partial.text:
            await self._send({
                "type": "partial",
                "transcript": partial.text,
                "is_committed": partial.is_committed,
            })

    if SPEECH_END in vad_events and self._in_utterance:
        await self._handle_speech_end_streaming()


async def _handle_speech_end_streaming(self) -> None:
    self._in_utterance = False
    audio = bytes(self._utterance_pcm)
    self._utterance_pcm = bytearray()
    await self._send({"type": "speech_end"})

    if self._streaming is None:
        await self._send({"type": "rejected"})
        return
    final_event = await asyncio.to_thread(self._streaming.finalise)
    self._streaming = None

    text = (final_event.text or "").strip()
    if not text:
        await self._send({"type": "rejected"})
        return

    if self._mode == MODE_WAKE_WORD:
        if not self._wake_phrase or self._wake_phrase not in text.lower():
            await self._send({"type": "rejected"})
            return
        text = self._strip_wake_phrase(text)
        if not text:
            await self._send({"type": "rejected"})
            return

    await self._send({
        "type": "final",
        "transcript": text,
        "source": "vosk_fast",
        "confidence": final_event.confidence,
    })

    if self._refine_with_whisper:
        # fire-and-forget; LLM round-trip вже почався з Vosk-fast
        asyncio.create_task(self._background_whisper_refine(audio, text))


async def _background_whisper_refine(self, audio: bytes, vosk_text: str) -> None:
    """Run Whisper async і емітити final_revised тільки якщо різниця суттєва."""
    try:
        import numpy as np
        from voice.pipeline import get_stt_provider
        from config import config

        wave = np.frombuffer(audio, dtype=np.int16).astype(np.float32) / 32768.0
        provider = get_stt_provider()
        # use Whisper if available, fallback to Vosk (no win then)
        if provider.name != "whisper":
            return
        result = await provider.transcribe(wave, config.voice_stt_language)
        whisper_text = (result.text or "").strip()
        if not whisper_text:
            return
        ratio = _levenshtein_ratio(vosk_text, whisper_text)
        if ratio >= config.voice_refine_diff_threshold:
            return  # Vosk вже досить хороший
        await self._send({
            "type": "final_revised",
            "transcript": whisper_text,
            "source": "whisper_quality",
            "confidence": result.confidence,
            "diff_ratio": ratio,
        })
    except Exception as exc:
        logger.warning("whisper refine failed: %s", exc)


def _levenshtein_ratio(a: str, b: str) -> float:
    """Simple ratio: 1.0 = identical. Без зовнішніх dep."""
    if not a or not b:
        return 0.0 if (a or b) else 1.0
    # Use stdlib difflib to avoid extra dep
    import difflib
    return difflib.SequenceMatcher(None, a.strip().lower(), b.strip().lower()).ratio()
```

### 2.4 routes_voice_stream зміни

**File:** `src/backend/api/routes_voice_stream.py`

`_build_orchestrator` має пробросити нові параметри:

```python
return AlwaysOnOrchestrator(
    vad=vad,
    wake_spotter=spotter,
    vosk_model=vosk_model,
    sample_rate=16_000,
    continuation_window_s=config.voice_continuation_window_s,
    mode=mode if mode in ("off", "continuous", "wake_word") else "legacy",
    wake_phrase=config.voice_wake_phrase,
    silence_timeout_ms=config.voice_silence_timeout_ms,
    streaming_partials=config.voice_streaming_partials,    # NEW
    partial_debounce_ms=config.voice_partial_debounce_ms,  # NEW
    refine_with_whisper=config.voice_refine_with_whisper,  # NEW
)
```

`ready` event розширити: додати `streaming_partials: bool`, `partial_debounce_ms: int`, `refine_with_whisper: bool`.

### 2.5 reset_providers інтеграція

**File:** `src/backend/api/routes_settings.py` (або де `_apply_runtime_side_effect`)

`voice_streaming_partials`, `voice_partial_debounce_ms`, `voice_refine_with_whisper`, `voice_refine_diff_threshold` НЕ є model-invalidating — нові WS connection отримає нові значення без рестарту провайдерів. Доповнити whitelist що НЕ тригерить `reset_providers()`.

### 2.6 Backend тести

**File:** `src/backend/tests/test_streaming_recognizer.py` (новий)
- `feed` повертає None коли текст не змінився.
- `feed` поважає debounce (два швидкі feed з однаковим текстом — лиш один partial).
- `finalise` повертає накопичений committed + останній decode.
- `reset` чистить state.
- Інтеграція: feed послідовність синтетичних PCM (з фікстури), expect partials і final.

**File:** `src/backend/tests/test_always_on_streaming.py` (новий)
- `streaming_partials=True, mode=continuous` → emit послідовність `partial` events.
- `streaming_partials=True, mode=wake_word` без wake-phrase у тексті → `rejected`.
- `streaming_partials=False` → 12.x поведінка (regression проти 13a).
- `refine_with_whisper=True` І Whisper доступний І різниця > threshold → `final_revised` емітитьcя.
- `refine_with_whisper=True` І різниця < threshold → НЕ емітитьcя.
- `refine_with_whisper=False` → ніколи не емітитьcя `final_revised`.
- mic_duck під час streaming — recognizer reset, partial buffer очищений.

**File:** `src/backend/tests/test_routes_voice_stream.py`
- `ready` event містить нові поля.
- `partial` event прибуває до клієнта (mock orchestrator).

---

## 3. Frontend зміни

### 3.1 chatStore оновлення

**File:** `src/frontend/src/stores/chatStore.ts`

Додати методи:
```ts
// Заміняє останнє user повідомлення (для final_revised). Не emit'ить новий.
replaceLastUserMessage: (newContent: string, metadata?: Record<string, unknown>) => void;
```

`userPreview` state вже існує (`setUserPreview`). Використовуємо.

### 3.2 useVoiceAlwaysOn — нові події

**File:** `src/frontend/src/hooks/useVoiceAlwaysOn.ts`

В `_handleServerEvent` додати:
```ts
case 'partial':
  if (typeof ev.transcript === 'string') {
    setPartialTranscript(ev.transcript);
  }
  break;

case 'final_revised':
  if (typeof ev.transcript === 'string') {
    onRevisedTranscript?.({
      transcript: ev.transcript,
      source: 'whisper_quality',
      confidence: typeof ev.confidence === 'number' ? ev.confidence : 0,
    });
  }
  break;
```

В `AlwaysOnConfig` додати поле `onRevisedTranscript?: (t: FinalTranscript) => void`.

### 3.3 VoiceAlwaysOnGate — UI пайп

**File:** `src/frontend/src/components/chat/VoiceAlwaysOnGate.tsx`

Поточний `useEffect(() => setUserPreview(partialTranscript || null))` лишається — він уже передає partial у chat store. Просто тепер `partialTranscript` змінюється часто (не лише з 12.x partial-mode).

Додати handler для revisedTranscript:
```tsx
const onRevisedTranscript = useCallback(
  (t: FinalTranscript) => {
    const text = (t.transcript ?? '').trim();
    if (!text) return;
    replaceLastUserMessage(text, { revised_by: 'whisper' });
  },
  [replaceLastUserMessage],
);

useVoiceAlwaysOn({
  enabled,
  onFinalTranscript,
  onRevisedTranscript,  // NEW
});
```

### 3.4 ChatWindow — ghost bubble

**File:** `src/frontend/src/components/chat/ChatWindow.tsx`

Поточно у chat list рендер тільки фінальних повідомлень. Додати "ghost user bubble" коли `chatStore.userPreview` НЕ null:

```tsx
const userPreview = useChatStore((s) => s.userPreview);

// Render після списку повідомлень, перед input area:
{userPreview && (
  <div
    className="ml-auto max-w-[80%] rounded-2xl bg-cyan-500/10 px-4 py-2 italic text-cyan-200/70 border border-cyan-500/20 animate-pulse"
    aria-label="Розпізнавання у процесі"
  >
    {userPreview}
    <span className="ml-1 inline-block h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
  </div>
)}
```

Стилізація узгоджена з docs/VISUAL_SYSTEM.md — приглушена, italic, cyan з низькою непрозорістю, легка пульсація. Коли `final` подія тригерить `sendMessage` — `userPreview` ставимо в null (вже робиться?). Перевірити: `sendMessage` чистить `userPreview`.

Якщо `final_revised` приходить *після* того як bubble вже стало real (sendMessage завершився): `replaceLastUserMessage` оновлює text in-place. Стилізація: на 1.5 секунди показати тонке cyan glow на оновленому повідомленні (Framer Motion `animate={{ boxShadow: [...]}}`), щоб користувач бачив що щось змінилось без того щоб подумати "це баг".

### 3.5 Frontend тести

**File:** `src/frontend/src/hooks/__tests__/useVoiceAlwaysOn.test.ts`
- `partial` server event → `partialTranscript` state оновлюється.
- `partial` потоком → state бачить останнє значення.
- `final_revised` → `onRevisedTranscript` callback викликається.

**File:** `src/frontend/src/components/chat/__tests__/VoiceAlwaysOnGate.test.tsx`
- partialTranscript оновлюється → setUserPreview викликається (вже є тест).
- onRevisedTranscript → replaceLastUserMessage викликається.

**File:** `src/frontend/src/components/chat/__tests__/ChatWindow.test.tsx`
- `userPreview != null` → ghost bubble в DOM.
- `userPreview == null` → ghost bubble прибраний.
- Final user message з text "X", потім final_revised на "Y" → message text стає "Y" (через replaceLastUserMessage).

**File:** `src/frontend/src/stores/__tests__/chatStore.test.ts`
- `replaceLastUserMessage` оновлює text останнього user-сорта повідомлення.
- НЕ зачіпає assistant повідомлення.
- Викликаний коли немає повідомлень — no-op.

---

## 4. Settings UI

**File:** `src/frontend/src/components/settings/SettingsPanel.tsx` (Voice tab)

Додати після `voice_silence_timeout_ms`:

- **Streaming partials** — toggle `voice_streaming_partials`. Опис: "Показувати слова в чаті в момент мовлення (рекомендовано увімкнено)."
- **Partial debounce (ms)** — slider [50..1000], default 200. Опис: "Як часто оновлювати ghost-текст. Менше = швидше але миготливіше."
- **Whisper refine (advanced)** — toggle `voice_refine_with_whisper`. Опис: "Тиха корекція тексту через Whisper після Vosk. Може дезорієнтувати — пробуй обережно."
- **Refine threshold** — slider [0.5..1.0], default 0.85. Опис: "Поріг різниці тексту, нижче якого Whisper переписує. Вище = частіше переписує."

---

## 5. Послідовність комітів

| # | Commit | Файли | Гейт |
|---|--------|-------|------|
| 1 | `phase-13b.1: add streaming_partials config keys + validators` | `config.py`, tests | pytest |
| 2 | `phase-13b.2: add StreamingVoskRecognizer module + tests` | `voice/streaming_recognizer.py`, tests | pytest |
| 3 | `phase-13b.3: orchestrator streaming mode dispatch` | `voice/always_on.py`, tests | pytest |
| 4 | `phase-13b.4: routes_voice_stream wires new flags` | `routes_voice_stream.py`, tests | pytest |
| 5 | `phase-13b.5: orchestrator background whisper refine` | `voice/always_on.py`, tests | pytest |
| 6 | `phase-13b.6: chatStore replaceLastUserMessage` | `chatStore.ts`, tests | vitest |
| 7 | `phase-13b.7: useVoiceAlwaysOn handles partial + final_revised` | `useVoiceAlwaysOn.ts`, tests | vitest |
| 8 | `phase-13b.8: VoiceAlwaysOnGate wires onRevisedTranscript` | `VoiceAlwaysOnGate.tsx`, tests | vitest |
| 9 | `phase-13b.9: ChatWindow ghost user bubble` | `ChatWindow.tsx`, tests | vitest + manual |
| 10 | `phase-13b.10: SettingsPanel new voice keys UI` | `SettingsPanel.tsx`, tests | vitest |
| 11 | `phase-13b.11: tag v0.13.0b + acceptance doc` | `docs/.../ACCEPTANCE.md` | manual smoke |

---

## 6. Acceptance Doc Template

`docs/phase-13b-streaming-partials/ACCEPTANCE.md` — заповнити:

1. **Тести.** `pytest -q` count (має зрости на ~25 нових), `npm run test -- --run` count (~12 нових).
2. **Build.** `npm run build` ok / fail.
3. **Manual measurements (real mic).**
   - Час від початку слова "при..." до першого partial видимого в UI ghost-bubble.
   - Швидкість партіалів (FPS) під час 5-секундного речення.
   - Час від `speech_end` до коли ghost-bubble стає real bubble.
   - Якщо `voice_refine_with_whisper=true`: чи з'являється `final_revised` на складній фразі (наприклад: ім'я + цифри + іншомовний термін).
4. **Subjective.**
   - Чи відчуваєш "застосунок мене чує живо"?
   - Чи миготіння партіалів дратує? (тюнити debounce_ms).
   - Чи Whisper-revision дезорієнтує? (можна вимкнути).
5. **Regression.** TTS playback duck все ще працює. Tap-to-talk не зламаний. Frontend не падає на parsing невідомих server events.

---

## 7. Performance budget

| Stage | Budget | Validation |
|-------|-------:|------------|
| Frame WS receive → Vosk feed | < 5 ms | logging.debug timer |
| Vosk PartialResult → JSON parse | < 10 ms | unit test |
| Partial WS send | < 5 ms | logging.debug |
| Browser receive → React state | < 50 ms | manual DevTools |
| React render ghost bubble update | < 16 ms (60fps) | manual DevTools Performance |
| **Total: speech onset → first partial visible** | **< 300 ms** | manual stopwatch |
| Vosk FinalResult on speech_end | < 200 ms | unit test + manual |
| Whisper background refine | 1-3 s, async | logger info per turn |

---

## 8. Edge cases

### 8.1 Partial text "відкочується"
Vosk іноді міняє думку: після `"при"` показує `"приві"`, потім нагло `"привіт"`, потім `"привіт як"`. Це нормально. Дебаунс 200ms згладжує. UI не має "стрибати" — використовуй `whitespace-pre-wrap` і фіксовану висоту блоку щоб layout не плавав.

### 8.2 Дуже коротке мовлення (< 200ms)
Дебаунс може з'їсти єдиний partial. У тому випадку final все одно прийде — користувач побачить text відразу як real bubble. Acceptable.

### 8.3 Дуже довге мовлення (> 30s)
Vosk committed_text може накопичитись великий. Память все ще ОК (max ~100KB тексту). Але WS payload росте. На 30+ секунд — обрізати committed_text до останніх N=2000 символів у `_committed_text`. Тобто скользящий вікно. Якщо user реально таке довге — він і не очікує що PHANTOM пам'ятатиме перші 30 секунд як одну фразу.

### 8.4 final_revised прийшов після того як юзер уже отримав assistant reply
Крайовий випадок який Phase-13-plan §6 явно списує як ризик [L]. Default OFF як раз про цей випадок — opt-in feature. Коли ON: replaceLastUserMessage просто оновлює user message в історії; assistant reply теж зберігається. Якщо assistant вже згадав повідомлення в своїй відповіді, текстова невідповідність — приймальна ціна.

### 8.5 Мережева затримка LAN (Radxa-host)
Якщо WS ping > 50 ms — partial latency зростає. Це поза scope 13b; SSE/WebTransport не міняють картину суттєво.

### 8.6 Кнопка "відмінити" під час мовлення
Якщо user натискає Stop / змінює `voice_mode` посеред мовлення:
- Backend: orchestrator.reset() → streaming recognizer = None, utterance_buffer cleared, no final emit.
- Frontend: setUserPreview(null) → ghost bubble зникає. Без residual text.

---

## 9. Rollback plan

- Після 13b.4: revert backend (zero side-effects на frontend, який все ще шле тільки final).
- Після 13b.9: revert лише frontend — backend емітить partials, frontend їх ігнорує (немає UI). Безпечно.
- Після 13b.11: feature flag `voice_streaming_partials=false` через UI або config — поведінка моментально 12.x.
- Worst case: `git checkout v0.13.0a-quickwins`.

---

## 10. Що НЕ робить ця фаза

- Predictive LLM kickoff на partials → Phase 14.
- Streaming TTS (per-sentence playback) → Phase 14.
- Barge-in (interrupt PHANTOM mid-TTS) → Phase 14.
- Semantic endpointing (silence_ms адаптивний на пунктуацію/інтонацію) → Phase 14.
- Real wake-word ONNX → Phase 14.
- WS H1 fix → окрема Phase 12.5 hotfix.

---

## 11. Estimated impact

| Метрика | After 13a | After 13b | Win |
|---------|----------:|----------:|----:|
| First partial visible after speech onset | n/a (нема) | ≤ 300 ms | **новий UX** |
| `speech_end → final` | 400-800 ms | ≤ 200 ms | 2-4× |
| Suб'єктивне відчуття латентності | "не пускає" | "слухає в моменті" | **гра-чейнджер** |
| Точність розпізнавання (Vosk vs Whisper-medium) | (Whisper-small) | Vosk + opt. Whisper refine | ~однакова з refine on |

**Це і є та "жвавість спілкування" яку просив користувач** — не швидше абсолютно, а УТРИМАННЯ ВВАГИ через постійний візуальний фідбек.
