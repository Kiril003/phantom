# PHANTOM OS — Voice Pipeline

## 1. Архітектура

```
                    ┌─────────────────────────┐
 Microphone ──────►│    Voice Pipeline        │
                    │                          │
                    │  ┌─────────┐  ┌────────┐ │
                    │  │ Vosk    │  │faster- │ │
                    │  │Streaming│  │whisper │ │
                    │  │ (CPU)   │  │ (GPU)  │ │
                    │  └────┬────┘  └───┬────┘ │
                    │       │ partial    │ final │
                    │       ▼           ▼       │
                    │  ┌────────────────────┐   │
                    │  │  Hybrid Resolver   │   │
                    │  │  (Levenshtein)     │   │
                    │  └─────────┬──────────┘   │
                    │            │ text          │
                    │            ▼               │
                    │     AI Processing          │
                    │            │               │
                    │            ▼               │
                    │  ┌────────────────────┐   │
                    │  │     Piper TTS      │   │
                    │  │ current runtime    │   │
                    │  └─────────┬──────────┘   │
                    │            │ audio         │
                    └────────────┼───────────────┘
                                 ▼
                              Speaker
```

## 2. STT: Hybrid Whisper + Vosk

### Чому гібрид?
- **Vosk** — миттєвий streaming (<100ms latency), працює на CPU, детермінований.
  Ідеальний для показу partial results в UI в реальному часі.
  WER для українського ~15-20% (модель `vosk-model-uk-v3-nano` або `vosk-model-uk-v3-lgraph`)
  
- **faster-whisper** — точність на рівні людини, WER 5-8% для української (medium/large-v3).
  Потрібен GPU або швидкий CPU. Latency 1-3s для типового речення.

### Алгоритм
```python
class HybridSTT:
    def __init__(self, settings):
        self.vosk = VoskEngine(model_path=settings.stt_vosk_model_path)
        self.whisper = WhisperEngine(
            model_size=settings.stt_whisper_model,  # "medium" default
            device=settings.stt_whisper_device,      # "auto" → GPU if available
            compute_type=settings.stt_whisper_compute # "int8" for ARM
        )
        self.mode = settings.stt_mode  # "hybrid" | "vosk_only" | "whisper_only"
    
    async def process_stream(self, audio_chunks: AsyncIterator[bytes]):
        if self.mode == "vosk_only":
            async for partial in self.vosk.stream(audio_chunks):
                yield STTResult(text=partial.text, is_final=partial.is_final, engine="vosk")
            return
        
        # Hybrid mode
        audio_buffer = AudioBuffer()
        
        async for chunk in audio_chunks:
            audio_buffer.append(chunk)
            
            # Vosk — instant partial
            vosk_result = self.vosk.feed(chunk)
            if vosk_result.text:
                yield STTResult(text=vosk_result.text, is_final=False, engine="vosk")
            
            # Vosk endpoint detected (silence = sentence boundary)
            if vosk_result.is_endpoint:
                segment = audio_buffer.get_segment()
                
                if self.mode == "hybrid" and len(segment) > 0:
                    # Whisper — final accurate
                    whisper_text = await self.whisper.transcribe(segment)
                    
                    # Resolve: if significantly different, Whisper wins
                    distance = levenshtein_ratio(vosk_result.text, whisper_text)
                    if distance > 0.3:  # configurable threshold
                        yield STTResult(text=whisper_text, is_final=True, engine="whisper")
                    else:
                        yield STTResult(text=vosk_result.text, is_final=True, engine="vosk")
                else:
                    yield STTResult(text=vosk_result.text, is_final=True, engine="vosk")
                
                audio_buffer.clear_segment()
```

### Vosk Models для Української
```
vosk-model-uk-v3-nano     — 73MB, швидкий, менш точний (embedded)
vosk-model-uk-v3-lgraph   — 325MB, гарна точність для CPU
vosk-model-uk-v3          — 1.6GB, найточніший Vosk
```
Configurable через settings. Default: `vosk-model-uk-v3-lgraph`.

### faster-whisper Config
```python
# faster-whisper (CTranslate2 backend — значно швидший за OpenAI Whisper)
from faster_whisper import WhisperModel

model = WhisperModel(
    model_size,                    # "small" | "medium" | "large-v3"
    device="auto",                 # auto-detect GPU
    compute_type="int8",           # int8 для ARM, float16 для GPU
)
segments, info = model.transcribe(
    audio_array,
    language="uk",                 # force Ukrainian (configurable)
    beam_size=5,
    vad_filter=True,               # skip silence
    vad_parameters=dict(
        min_silence_duration_ms=500,
        speech_pad_ms=200,
    )
)
```

## 3. TTS: Piper now, StyleTTS2 later

The active runtime is `voice/tts_engine.py` with Piper as the default neural
TTS provider and a silent fallback when TTS is disabled or unavailable. The
bundled Ukrainian voice is `uk_UA-ukrainian_tts-medium`.

StyleTTS2 remains a future voice-quality track. It is intentionally not
documented as the current implementation until a real provider, model
download path, settings UI, and tests exist.

### Tone Adaptation для TTS
```python
# Різна конфігурація TTS залежно від SystemState
TTS_STATE_CONFIGS = {
    SystemState.DREAM: {
        "speed": 0.8,
        "embedding_scale": 0.5,    # менше емоцій
        "diffusion_steps": 3,      # швидше, тихіше
    },
    SystemState.SENTINEL: {
        "speed": 1.2,
        "embedding_scale": 1.5,    # більше емоцій (тривога)
        "diffusion_steps": 5,
    },
    SystemState.DIALOGUE: {
        "speed": 1.0,
        "embedding_scale": 1.0,    # нормально
        "diffusion_steps": 5,
    },
}
```

## 4. Wake Word Detection

```python
class WakeWordDetector:
    """Простий wake word на основі Vosk partial results."""
    
    def __init__(self, settings):
        self.wake_words = settings.voice_wake_words  # ["фантом", "фантоме", "hey phantom"]
        self.vosk = VoskEngine(model_path=settings.stt_vosk_model_path)
        self.active = False
    
    async def listen(self, audio_stream):
        async for chunk in audio_stream:
            partial = self.vosk.feed(chunk)
            if partial.text:
                text_lower = partial.text.lower().strip()
                for word in self.wake_words:
                    if word in text_lower:
                        self.vosk.reset()
                        yield WakeWordEvent(word=word, timestamp=time.time())
                        break
```

## 5. Voice Settings (Configurable via UI)

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| voice.stt_mode | select | hybrid | hybrid / vosk_only / whisper_only |
| voice.stt_vosk_model | select | vosk-model-uk-v3-lgraph | доступні моделі |
| voice.stt_whisper_model | select | medium | small / medium / large-v3 |
| voice.stt_whisper_device | select | auto | auto / cpu / cuda |
| voice.stt_whisper_compute | select | int8 | int8 / float16 / float32 |
| voice.stt_language | select | uk | uk / en / auto |
| voice.stt_hybrid_threshold | range | 0.3 | Levenshtein порог для whisper override |
| voice.tts_enabled | boolean | true | |
| voice.tts_voice | select | uk_UA-ukrainian_tts-medium | Piper voice model |
| voice.tts_speed | range | 1.0 | 0.5-2.0 |
| voice.tts_auto_language | boolean | true | choose Ukrainian/English Piper fallback |
| voice.wake_words | text | фантом | comma-separated |
| voice.wake_word_enabled | boolean | true | |
| voice.vad_silence_ms | range | 500 | 200-2000 |
| voice.vad_speech_pad_ms | range | 200 | 50-500 |
| voice.auto_listen_in_dialogue | boolean | true | авто-слухати в DIALOGUE |
| voice.tts_state_adaptation | boolean | true | адаптувати TTS по стану |
