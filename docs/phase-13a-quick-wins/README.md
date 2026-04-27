# Phase 13a — Quick Wins (Latency & CPU)

> **Мета фази:** позбавитись головного болю користувача — застосунок "спить" і always-on розпізнавання надто повільне — **без переписування архітектури**. Точкові зміни в існуючих модулях.
> **Цільовий результат:** end-to-end latency від `speech_end` до `final` ↓ з 2.5–4.5 c до **0.4–0.8 c**. CPU під час тиші ↓ з ~15-20% до ~2-4%.
> **Час на реалізацію:** 3–5 годин.
> **Ризик:** низький. Кожна зміна окремий комміт, простий revert.
> **Вхід:** `v0.12.4-ws-lifecycle` (commit `8181a9e`).
> **Вихід:** тег `v0.13.0a-quickwins`.

---

## 0. Передумови

### 0.1 Що НЕ міняємо в цій фазі

- Транспорт (WS лишається).
- Структуру orchestrator'а (FSM лишається).
- Модель Vosk (300MB) — лишається в singleton'і для майбутньої streaming-фази.
- Wake-word substring логіку — лишається.
- TTS-ducking — лишається.

### 0.2 Що міняємо (4 точкові зміни)

| # | Зміна | Файли | Очікуваний win |
|---|-------|-------|----------------|
| 1 | Whisper `medium` → `small` INT8 за замовчуванням | `config.py`, settings UI | STT latency ↓ 2-3× |
| 2 | Client-side VAD gate перед WS send | `voice-capture.worklet.js`, `useVoiceAlwaysOn.ts` | CPU при тиші ↓ 80%, мережа ↓ 90% |
| 3 | Backend skip-on-silence (бек-страхувальник) | `always_on.py`, `vad.py` | CPU spike protection |
| 4 | Прогрів Whisper моделі і Vosk recognizer'а на startup | `pipeline.py`, `main.py` lifespan | Перший фінал ↓ 200-500ms |

---

## 1. Зміна 1 — Whisper `small` INT8 за замовчуванням

### 1.1 Контекст

`config.py:81` визначає:
```python
voice_stt_whisper_model: Literal["small", "medium", "large-v3"] = "medium"
voice_stt_whisper_compute: Literal["int8", "float16", "float32"] = "int8"
```

На Radxa Q6A (ARM A78 без GPU/CUDA) `medium` INT8 ≈ 1.5–3 c per utterance, `small` INT8 ≈ 500–900 ms per utterance. Якість українською для коротких побутових фраз втрата ~3–5 % WER, що для діалогу з PHANTOM прийнятно.

### 1.2 Що зробити

**File:** `src/backend/config.py:81`
- Default `"medium"` → `"small"`.
- Залишити `"medium"` і `"large-v3"` як опції в Literal — оператор з UI може повернути будь-коли.

```python
# До:
voice_stt_whisper_model: Literal["small", "medium", "large-v3"] = "medium"
# Після:
voice_stt_whisper_model: Literal["tiny", "small", "medium", "large-v3"] = "small"
```

Додаємо `"tiny"` до Literal — це резерв на випадок якщо `small` теж буде повільно. `tiny` INT8 ≈ 200–400 ms на ARM, але WER на українській суттєво гірша.

**File:** `src/frontend/src/components/settings/SettingsPanel.tsx` (або де визначається dropdown для voice_stt_whisper_model)
- Додати опцію `"tiny"` у select.
- Додати tooltip: "small (швидко, рекомендовано) / medium (точніше, повільніше) / tiny (дуже швидко, нижче точність) / large-v3 (тільки для GPU)".

### 1.3 Тести

**File:** `src/backend/tests/test_config.py` (або `test_settings.py`)
- Тест що default = `"small"`.
- Тест що `"tiny"` приймається.
- Тест що `reset_providers()` спрацьовує при зміні `voice_stt_whisper_model`.

### 1.4 Acceptance gate

- Backend pytest зелений (всі 933 + нові).
- Manual: перезавантажити backend, переконатись `Loading faster-whisper model=small device=cpu compute=int8` в логах.

---

## 2. Зміна 2 — Client-side VAD gate (НАЙБІЛЬШИЙ WIN ПО CPU)

### 2.1 Контекст

Зараз `voice-capture.worklet.js:96` шле кожен 30 ms кадр через `port.postMessage` → main thread → `ws.send` **завжди**, незалежно від того, говорить юзер чи ні. Backend ловить кожен кадр, прокидає через `asyncio.to_thread` Silero VAD inference, і тільки тоді розуміє "о, це тиша, нічого не роблю".

Цей цикл відбувається 30 разів на секунду під час повної тиші. Це і є джерело "сну" — ноут (точніше Radxa) гріється і думає що щось робить, а воно просто бовтає тишею.

**Рішення:** запустити Silero VAD у браузері (через `@ricky0123/vad-web` або власну імплементацію в worklet'і з тим же Silero ONNX). Слати кадри тільки коли VAD вирішив що зараз мовлення.

### 2.2 Архітектура

```
   Browser AudioWorklet                 Backend
   ┌──────────────────────┐
   │ 1. resample 48k→16k  │
   │ 2. Silero VAD інфер  │            ┌──────────────────────┐
   │ 3. is_speech?        │ ┐          │ Silero VAD (другий   │
   │    YES → push frame  │ │ binary   │   рівень, як страх.) │
   │    NO  → drop frame  │ ├─────────▶│ Orchestrator FSM     │
   │ 4. send VAD events   │ │ JSON     │ STT on speech_end    │
   └──────────────────────┘ ┘          └──────────────────────┘
```

Browser-VAD є owner транзицій. Backend Silero лишається як страхувальник на випадок якщо browser помилився (рідкісне false-positive не зашкодить).

### 2.3 Залежність

```bash
npm install @ricky0123/vad-web
```

[`@ricky0123/vad-web`](https://www.npmjs.com/package/@ricky0123/vad-web) — оновлюваний пакет, MIT, ~2 MB бандл, надає `MicVAD` клас який виконує Silero ONNX в Web Worker. Підтримує custom `onSpeechStart`, `onSpeechEnd`, `onFrameProcessed` callbacks.

**Альтернатива:** не додавати залежність і запхати наш `silero_vad.onnx` (вже у repo) у browser через `onnxruntime-web`. Більше коду але уникнемо нового npm-пакета. Рекомендую почати з `@ricky0123/vad-web` як готового рішення; якщо треба — мігруємо пізніше.

### 2.4 Що зробити

**File:** `src/frontend/src/hooks/useMicStream.ts`
- Без змін — стрім лишається. VAD розташовується НАД ним.

**File:** `src/frontend/src/hooks/useVoiceAlwaysOn.ts`
- Імпортувати `MicVAD` з `@ricky0123/vad-web`.
- Перед налаштуванням AudioWorklet'а — створити `MicVAD` з тим же stream.
- Додати state `isClientSpeechActive: boolean`.
- У `worklet.port.onmessage` обгорнути `ws.send(ev.data)` під `if (isClientSpeechActive)`. Кадри під час тиші просто дропаються — НЕ йдуть на backend.
- На `MicVAD.onSpeechStart` — слати `{cmd: "client_speech_start"}` JSON команду. На `onSpeechEnd` — `{cmd: "client_speech_end"}`.
- Buffer pre-roll: VAD неминуче має activation_frames lag (декілька кадрів від справжнього старту до спрацювання). Тримати rolling buffer останніх ~300 ms PCM кадрів у worklet→main, і коли `onSpeechStart` спрацював — флушити цей buffer перед першим "живим" кадром, щоб backend Silero (страхувальник) і Whisper не втратили початок слова.

```ts
// Псевдо-код фрагмент логіки в useVoiceAlwaysOn.ts
const PREROLL_FRAMES = 10;  // 10 × 30ms = 300ms
const prerollRef = useRef<ArrayBuffer[]>([]);
const speakingRef = useRef(false);

const micVAD = await MicVAD.new({
  stream,                          // тот же MediaStream
  onSpeechStart: () => {
    speakingRef.current = true;
    // flush preroll
    for (const buf of prerollRef.current) ws.send(buf);
    prerollRef.current = [];
    ws.send(JSON.stringify({cmd: "client_speech_start"}));
  },
  onSpeechEnd: () => {
    speakingRef.current = false;
    ws.send(JSON.stringify({cmd: "client_speech_end"}));
  },
});

worklet.port.onmessage = (ev) => {
  if (!(ev.data instanceof ArrayBuffer)) return;
  if (speakingRef.current) {
    ws.send(ev.data);
  } else {
    // ring buffer останніх PREROLL_FRAMES кадрів
    prerollRef.current.push(ev.data);
    if (prerollRef.current.length > PREROLL_FRAMES) prerollRef.current.shift();
  }
};
```

### 2.5 Backend зміни (мінорні)

**File:** `src/backend/api/routes_voice_stream.py`
- У `_VoiceSession.handle_command` додати кейси:
  ```python
  elif cmd == "client_speech_start":
      # підказка від клієнта; backend може використати щоб switch FSM в STATE_PRELISTEN
      # або просто залогувати. У 13a — лише логування.
      logger.debug("voice WS: client_speech_start hint received (%s)", self.client_id)
  elif cmd == "client_speech_end":
      logger.debug("voice WS: client_speech_end hint received (%s)", self.client_id)
  ```
- Backend Silero VAD лишається активним і за замовчуванням буде формувати справжній SPEECH_START/SPEECH_END. Просто тепер кадрів менше, тому коштує дешевше.

### 2.6 Тести

**File:** `src/frontend/src/hooks/__tests__/useVoiceAlwaysOn.test.ts`
- Mock `MicVAD` (через `vi.mock('@ricky0123/vad-web')`).
- Тест: коли VAD onSpeechStart → ws.send викликається на наступний `worklet.port.message`.
- Тест: коли VAD onSpeechEnd → наступні message dropнуті.
- Тест: preroll buffer flush на onSpeechStart посилає накопичені кадри в порядку FIFO.
- Тест: ws.send отримує `client_speech_start` JSON один раз на цикл speech.

**File:** `src/backend/tests/test_routes_voice_stream.py`
- Тест: WS приймає `{"cmd": "client_speech_start"}` без помилок.
- Тест: WS приймає `{"cmd": "client_speech_end"}` без помилок.
- Тест: backend Silero VAD продовжує отримувати кадри і формувати власні події (regression check).

### 2.7 Edge cases

- **VAD холодний старт.** Перший раз коли користувач запускає always-on — `MicVAD.new` тягне ONNX модель з public/. Помістити модель в `public/vad-models/silero_vad.onnx` (вже маємо в `voice/models/silero-vad/silero_vad.onnx` — копіюємо в frontend public). Або через `await MicVAD.new({modelURL: '/vad-models/silero_vad.onnx'})`.
- **Mute під час TTS.** `worklet.postMessage({type:'mute'})` лишається — backend все ще отримує `mic_duck` команду, заглушка цілісна.
- **Безпечний fallback.** Якщо `@ricky0123/vad-web` не вдалось завантажити (CSP, мережа) — деградувати у `speakingRef = always true` режим = поточна поведінка. НЕ кидати помилку юзеру.

### 2.8 Acceptance gate

- Frontend `npm run build` зелений.
- Frontend vitest зелений.
- Manual: відкрити DevTools → Network. У `voice_mode='continuous'` під час тиші: `ws.send` НЕ викликається (видно по WS frame counter). Під час мовлення — викликається.
- Manual: подивитись Resource Monitor (htop) на Radxa: backend uvicorn-process CPU під час тиші ≤ 5%.

---

## 3. Зміна 3 — Backend skip-on-silence (страхувальник)

### 3.1 Контекст

Якщо браузер з якоїсь причини не виконав client-side VAD (старий Chromium, error в worklet'і), backend все ще ловить 30 frames/sec. Додатково: Silero VAD на backend має `_vad_inference_lock` (`vad.py:64`) — single-threaded inference. Під сильним навантаженням може стати bottleneck.

### 3.2 Що зробити

**File:** `src/backend/voice/always_on.py:141` (`process_frame` head)
- Додати **fast-path early-exit**: якщо backend ще не в speech state і **за останні 200 ms** не було активного кадру (per-energy heuristic), **дропати кадр без виклику Silero**. Це cheap RMS energy check замість повної ONNX inference.

```python
import struct
# Module-level constant
_ENERGY_DROP_THRESHOLD = 0.005  # RMS на нормалізованому [-1,1]

def _quick_energy(pcm_bytes: bytes) -> float:
    """Cheap RMS approximation. Уникнення ONNX inference коли тиша явна."""
    n = len(pcm_bytes) // 2
    if n == 0:
        return 0.0
    samples = struct.unpack(f"<{n}h", pcm_bytes)
    # абс мах нормалізований
    peak = max(abs(s) for s in samples)
    return peak / 32768.0
```

В `process_frame`:
```python
if not self._in_utterance and self._mode in (MODE_CONTINUOUS, MODE_WAKE_WORD):
    if _quick_energy(pcm_bytes) < _ENERGY_DROP_THRESHOLD:
        # явна тиша — пропускаємо інференс, але дамо VAD контексту
        # знати що time йшов (інакше silence_windows counter буде заморожений)
        return
```

**Гарніше:** замість struct.unpack використати `np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0` і брати `np.abs(arr).max()`. Це швидше для довших frames але дорожче для коротких; benchmark покаже. Стартувати з np-варіанту.

**Тонкий момент:** якщо ми дропаємо кадр — `silence_windows` counter в `_Hysteresis` НЕ збільшується (бо ми не викликали `_infer`), тому SPEECH_END може не спрацювати по таймеру. Розв'язок: якщо VAD в стані speech (`self._vad.in_speech`) — ВЖЕ НЕ дропаємо кадр. Energy-skip працює тільки коли і backend, і browser обоє згодні що зараз тиша.

### 3.3 Тести

**File:** `src/backend/tests/test_always_on.py`
- Тест: тихий buffer (всі sample == 0) → `process_frame` не викликає `vad.process` (mock його).
- Тест: гучний buffer → `vad.process` викликається.
- Тест: коли в `_in_utterance=True` → `vad.process` викликається завжди (regression проти SPEECH_END loss).

### 3.4 Acceptance gate

- Backend pytest зелений.
- Manual: завантажити backend, у тиші замоніторити CPU usage uvicorn process. Має бути ≤ 5% з порожнім WS connection.

---

## 4. Зміна 4 — Прогрів моделей на startup

### 4.1 Контекст

`pipeline.py:149-198` `preload_voice_models` вже грає Whisper, Vosk, VAD сесії на startup'і. Але **перший виклик `WhisperModel.transcribe`** все одно тягне додаткові 200-500 ms через ленивий внутрішній warm-up CTranslate2 буферів.

### 4.2 Що зробити

**File:** `src/backend/voice/pipeline.py:149`, `preload_voice_models`
- Після того як `provider._ensure_model()` спрацював — викликати `provider._model.transcribe(np.zeros(16000, dtype=np.float32), language='uk', beam_size=1)` один раз. Це теплий пробний запуск який примусить CTranslate2 алокувати всі робочі buffer'и. Витрати: 200-800 ms на startup.
- Аналогічно для Vosk: побудувати один dummy `KaldiRecognizer` з вже завантаженого `_vosk_model`, прогнати 1 секунду тиші — змусити Kaldi алокувати internal lattice arrays. Викинути recognizer, лишити тільки прогрітий `_vosk_model`.

```python
def _warm_whisper(provider) -> None:
    """Force CTranslate2 to allocate working buffers."""
    import numpy as np
    silence = np.zeros(16000, dtype=np.float32)  # 1s of silence
    try:
        list(provider._model.transcribe(silence, language='uk', beam_size=1)[0])
    except Exception as exc:
        logger.warning("whisper warm-up failed: %s", exc)


def _warm_vosk(model) -> None:
    """Force Vosk Kaldi to allocate internal arrays."""
    try:
        import vosk
        rec = vosk.KaldiRecognizer(model, 16_000)
        rec.AcceptWaveform(b"\x00" * 32_000)  # 1s silence as s16le
        rec.FinalResult()
    except Exception as exc:
        logger.warning("vosk warm-up failed: %s", exc)
```

Викликати з `preload_voice_models` після успішного ensure.

### 4.3 Тести

**File:** `src/backend/tests/test_pipeline.py`
- Тест: `preload_voice_models` повертає статус `whisper: warmed` (новий стан).
- Тест: повторний виклик idempotent (warm-up відбувається тільки раз).

### 4.4 Acceptance gate

- Backend startup logs показують `whisper warm-up complete in Xms`, `vosk warm-up complete in Yms`.
- Перша WS connect → перший STT call: latency на 100-300 ms нижче за baseline (виміряти manually).

---

## 5. Послідовність комітів

| # | Commit | Файли | Гейт |
|---|--------|-------|------|
| 1 | `phase-13a.1: switch default whisper to small` | `config.py`, `SettingsPanel.tsx`, tests | pytest + vitest |
| 2 | `phase-13a.2: add @ricky0123/vad-web dep + worklet wiring` | `package.json`, `useVoiceAlwaysOn.ts`, hook tests | vitest + manual VAD events visible |
| 3 | `phase-13a.3: client_speech_start/end cmds backend` | `routes_voice_stream.py`, route tests | pytest |
| 4 | `phase-13a.4: backend energy fast-path skip` | `always_on.py`, orchestrator tests | pytest + CPU manual |
| 5 | `phase-13a.5: warm-up whisper + vosk on startup` | `pipeline.py`, lifespan, tests | pytest + startup logs |
| 6 | `phase-13a.6: tag v0.13.0a-quickwins + acceptance doc` | `docs/phase-13a-quick-wins/ACCEPTANCE.md` | manual smoke |

Кожен commit окремий → revert одного не ламає інші.

---

## 6. Acceptance Doc Template (заповнюється у Зміні 6)

`docs/phase-13a-quick-wins/ACCEPTANCE.md` — заповнити такими секціями:

1. **Тести.** `pytest -q` count, `npm run test -- --run` count.
2. **Build.** `npm run build` ok / fail.
3. **Manual measurements.**
   - End-to-end latency `speech_end → final` event на 3-секундній фразі "привіт як справи" — 5 повторень, медіана.
   - Backend CPU при `voice_mode=continuous` і повна тиша 30 секунд — htop sample.
   - Frontend Network panel: WS frame count за 30 секунд тиші.
   - Frontend Network panel: WS frame count за 5 секунд активного мовлення.
4. **Regression checks.** TTS playback duck все ще працює (не self-feed). Tap-to-talk не зламаний. WS H1 (1006 close after first turn) — все ще присутній чи зник? Сама тільки 13a навряд чи фіксить H1 — але мережевий патерн змінюється.
5. **Subjective.** Користувач каже "відчувається жваво" / "все ще туго".

---

## 7. Ризики та нотатки

- **MicVAD ONNX model load на frontend.** Перший раз ~500 KB-2 MB качається. Розв'язок: bundlewith Vite через `?url`. Після першого завантаження — кеш браузера.
- **Точність Whisper-small vs medium на українській.** Можуть бути проблеми зі складними словами/іменами. Якщо суб'єктивно гірше — оператор повертає `medium` через UI. Phase 13b додає Whisper-як-refinement, що компенсує.
- **Browser-VAD false-negative.** Інколи дропне частину тихої вимови (шепіт). Backend Silero страхує: якщо browser-VAD не реагує а backend Silero таки бачить мовлення — все одно обробляється. Тестувати на whispers + швидких "так/ні".
- **Energy fast-path небезпечний:** при дуже тихій вимові може дропати справжнє speech. Threshold 0.005 = ~ -46 dBFS, нижче типового мовлення. Налаштувати по перших manual тестах.
- **Tap-to-talk інтеракція.** Tap-to-talk також ділить mic stream через `useMicStream`. MicVAD має бути per-consumer або disabled під час tap-to-talk active. Розв'язок: додати `enabled` prop в MicVAD setup і вимикати коли `inputMode === 'tap'`.

---

## 8. Що НЕ робить ця фаза (явно з scope винесено)

- Streaming partial transcripts → Phase 13b.
- Predictive LLM kickoff → Phase 14.
- Streaming TTS → Phase 14.
- Barge-in → Phase 14.
- Semantic endpointing → Phase 14.
- Real wake-word ONNX (openWakeWord) → Phase 14.
- WS H1 (1006 close after first turn) — окрема Phase 12.5 фікс, не блокує 13a.
- Перехід на WebRTC → не в roadmap'і взагалі (винесено за межі плану).

---

## 9. Estimated impact

| Метрика | Before | After 13a | Win |
|---------|-------:|----------:|----:|
| Backend CPU під час тиші | 15-20% | 2-4% | **5×** |
| Mic-fram per second on WS during silence | 33.3 | 0 | **∞** |
| `speech_end → final` latency (медіана) | 2.5-4.5 c | 0.4-0.8 c | **5×** |
| Cold-start WS connect → ready | 100-200 ms | 100-200 ms | same |
| First STT after server boot | 1.5-3 c (cold whisper) | 200-500 ms | **6×** |

Це **не SaaS-grade** — для нього потрібна Phase 13b (partials) і Phase 14 (predictive/streaming). Але це робить always-on **придатним до щоденного використання** замість "слабо працюючого".
