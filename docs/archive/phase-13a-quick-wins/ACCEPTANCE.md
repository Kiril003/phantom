# Phase 13a — Quick Wins Acceptance

**Дата:** 2026-04-27
**Тег цілі:** `v0.13.0a-quickwins`
**Базовий коміт:** `8181a9e` (phase-12.4 WS lifecycle fix)

## Що зроблено

| Sub-phase | Зміна | Файли | Статус |
|-----------|-------|-------|--------|
| 13a.1 | Whisper default `medium` → `small` INT8; `tiny` додано до Literal | `config.py` | ✅ |
| 13a.2 | Client-side MicVAD (`@ricky0123/vad-web` + `onnxruntime-web`) gate перед WS send із preroll-буфером 360 ms | `useVoiceAlwaysOn.ts`, `package.json`, `public/vad/*` | ✅ |
| 13a.3 | Backend energy fast-path skip — пропуск Silero VAD inference коли idle + peak < threshold | `config.py`, `voice/always_on.py`, `routes_voice_stream.py` | ✅ |
| 13a.4 | Warm-up Whisper + Vosk на startup (1 c silence dummy run) | `voice/pipeline.py` | ✅ |
| 13a.5 | Backend handlers `client_speech_start/end` для diagnostics | `routes_voice_stream.py` | ✅ |

## Тести

| Suite | Before | After | Дельта |
|-------|-------:|------:|-------:|
| Backend pytest | 933 | **948** | +15 |
| Frontend vitest | 222 | **223** | +1 |
| `npm run build` | ok | **ok** | — |
| `npx tsc --noEmit` | ok | **ok** | — |

Усі тести зелені. Pre-existing collection-error файли (`test_phase02.py` через `jose`, інші через `sqlalchemy`/`numpy` коли запущені поза `.venv`) не торкнуто — це проблема dev-середовища, не функціональна.

## Architectural notes

### Що зберігається з Phase 12 (hard-won fixes)

- ✅ `useMicStream` refcount singleton (Phase 11b.1).
- ✅ `useVoiceAlwaysOn` WS singleton + 50 ms close grace (Phase 12.0/12.4).
- ✅ Silero VAD ORT session singleton (Phase 12.0).
- ✅ Vosk model singleton (Phase 11b).
- ✅ Lifespan preload (Phase 12.0 Bug 2 fix).
- ✅ Mic ducking on TTS (Phase 12.2).
- ✅ Vite WS proxy bypass DEV (Phase 12.1).
- ✅ Silero v5 ONNX 64-sample context prefix (Phase 12.1).

Phase 13a добавляє два нових шари:
- `MicVAD` живе паралельно з worklet'ом на тому ж shared MediaStream через `useMicStream`. Pause/resume в MicVAD як no-op, щоб трекі не disabled'ились.
- Backend energy fast-path активується тільки коли `_in_utterance == False`; кадри всередині висказувань завжди йдуть через VAD, тому SPEECH_END ніколи не втрачається.

### Performance budget — теоретичний

| Метрика | Before 13a | Target 13a | Прогноз |
|---------|-----------:|-----------:|--------:|
| Backend CPU @ idle (silent room, voice_mode='continuous') | 15-20% | ≤ 4% | очікується ✓ |
| WS frames/sec @ silence | 33.3 | 0 (через MicVAD gate) | очікується ✓ |
| `speech_end → final` med (3-секундна фраза) | 2.5-4.5 c | 0.4-0.8 c | потребує real-mic вимірювання |
| First-STT-call після boot | 1.5-3 c (cold whisper) | 200-500 ms | потребує real-mic вимірювання |

**Real-mic вимірювання НЕ виконано** в цьому prep — потребує Radxa hardware у тестовому стенді.

## Manual verification — pending

Для повного acceptance потрібно (на Radxa Q6A):

1. Запустити `./start-phantom.sh`.
2. Відкрити frontend, увімкнути `voice_mode = 'continuous'` у Settings.
3. Тиша 30 секунд → перевірити:
   - **htop**: backend uvicorn process CPU ≤ 5 %.
   - **DevTools Network → WS**: 0 binary frames за період тиші.
4. Сказати "привіт" → перевірити:
   - WS frames скакають (preroll ~12 кадрів + утеранс).
   - Final transcript у чаті за ~600-800 ms після кінця слова.
5. Перевірити TTS playback duck все ще працює (відсутність self-feedback).
6. Tap-to-talk не зламано (натиснути кнопку мікрофону, сказати).

## Граничні випадки які перевірено код-ревью

- **MicVAD load failure** (CSP, network, ORT WASM 404): degrade у `clientSpeakingRef = true` → forward all frames → legacy поведінка.
- **Mute під час TTS**: backend все ще отримує `mic_duck` JSON команду, frontend worklet теж mute'ить локально. MicVAD продовжує процеси на ducked stream.
- **Empty PCM bytes**: `_peak_energy_normalised(b"") → 0.0`, не падає.
- **Tap-to-talk vs always-on simultaneous**: інший consumer на shared `useMicStream` — refcount тримає stream до релізу обох.

## Out-of-scope (відкладено в Phase 13b/14)

- ❌ Streaming partial transcripts.
- ❌ Predictive LLM kickoff.
- ❌ Streaming TTS.
- ❌ Semantic endpointing.
- ❌ Barge-in.
- ❌ Real wake-word ONNX detector.
- ❌ WS H1 fix (1006 close after first turn).

## Ризики та обмеження

- Pre-built MicVAD bundle ~1.5 MB ORT WASM + 2 MB Silero ONNX → перший load повільніший (кешується browser'ом).
- `peak energy threshold = 0.005` (-46 dBFS) може дропнути дуже тихий шепіт. При проблемах — оператор може встановити `voice_energy_skip_threshold = 0.0` через UI щоб вимкнути.
- Whisper-small має нижчу якість ніж medium на акцентованих/шумних вимовах. Якщо суб'єктивно гірше — оператор повертає `medium` через Settings; Phase 13b планує Vosk-fast + Whisper-refine гібрид.

## Subjective measurement — TODO

Заповнити після real-mic тесту:

- "Відчувається жвавіше / так само / гірше?"
- "Застосунок все ще 'спить' під час тиші?"
- "Перший partial видимий через скільки приблизно?"

---

**Висновок:** код Phase 13a інтегрований чисто, всі регресії зелені. Live-міряння на Radxa hardware — наступний крок перед таганням `v0.13.0a-quickwins`.
