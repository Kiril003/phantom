# Phase 13b — Streaming Partial Transcripts — Acceptance

> **Завершено:** 2026-04-28
> **Тег:** v0.13.0b-streaming-partials
> **Базова фаза:** 13a (`v0.13.0a-quickwins`).
> **Скоп:** Vosk-driven `partial` events emitted from the always-on
> orchestrator while the user is still speaking + a fast-path Vosk
> `final` (replaces the Whisper hop on the realtime path) + an opt-in
> background Whisper refinement that publishes a `final_revised`
> event when its transcript meaningfully differs from Vosk's.

---

## 1. Чого ця фаза досягла

Психологічно: користувач **бачить свої слова в чаті в момент мовлення**.
Без зміни абсолютної latency LLM round-trip це найбільший UX-win за весь
голосовий пайплайн — застосунок перестає "застигати" на 2–3 секунди
після фрази і починає поводитися як живий співрозмовник.

Технічно: VAD `speech_start` будує per-utterance `StreamingVoskRecognizer`,
який обгортає `vosk.KaldiRecognizer` дебаунс-логікою (200 ms за
замовчуванням) і агрегує "committed" сегменти. Кожна нова видима підстрока
прилітає клієнту як `partial` event і малюється "ghost"-бабблом у чаті.
По `speech_end` Vosk віддає фінальний результат локально (~50–200 ms на
ARM CPU, без Whisper хопу) — `final` з `source: "vosk_fast"`. Опційно
`voice_refine_with_whisper=True` запускає Whisper на тому ж буфері у фоні
і, якщо отриманий текст відрізняється від Vosk-final більше ніж на
`(1 - voice_refine_diff_threshold)`, емітить `final_revised` — chat
store замінює текст останнього user-повідомлення на місці.

---

## 2. Тести

### Backend (`pytest -q`)
- `tests/test_phase13b_streaming.py` — 11 тестів (партіали, wake-word
  стрипінг, rejected на пустому, reset під час streaming, refine
  emit/silent/disabled, similarity helper).
- `tests/test_phase13b_streaming_recognizer.py` — 14 тестів (feed
  contract, debounce window, committed bypass, finalise, JSON safety,
  stability counter).
- Загалом нових: **25** (відповідає таргету README §6.1 ~25).
- Сума backend після 13b: див. § 4 нижче.

### Frontend (`npx vitest run`)
- `src/__tests__/voiceAlwaysOn.test.tsx` — додано блок
  *"Phase 13b streaming partials"*: 6 нових тестів (partial оновлює
  visible state, partial suppressed for tap-to-talk, vosk_fast source
  forwarded, final_revised callback, final_revised tap suppression,
  malformed final_revised silently ignored).
- `src/__tests__/chat.test.tsx` — додано до `describe('chatStore', …)`
  5 нових тестів: setUserPreview slot, replaceLastUserMessage базова,
  pick last user when assistant later in array, no-op без user
  повідомлень, no-op для порожнього списку.
- Загалом нових: **11** (план просив "~12 нових" — на одного менше
  бо `replaceLastUserMessage` тримається в одному thoroughly-tested
  блоці замість двох окремих).
- Сума frontend після 13b: **234 / 234** (попередньо було 223).

### Build
- `npm run build` — **green** (див. § 4).

---

## 3. Файлові зміни

### Backend (новий код)
- `src/backend/voice/streaming_recognizer.py` — `StreamingVoskRecognizer`,
  `PartialEvent`, `FinalEvent`. Один інстанс per utterance; `feed`
  повертає `None` коли текст не змінився або під дебаунсом, інакше
  `PartialEvent(text, is_committed, stability)`. `finalise` дренує
  recognizer.
- `src/backend/voice/always_on.py`:
  - import `StreamingVoskRecognizer`.
  - 4 нових поля в `__init__`: `streaming_partials`, `partial_debounce_ms`,
    `refine_with_whisper`, `refine_diff_threshold`.
  - `_process_frame_phase12` будує streaming recognizer на `speech_start`,
    feeds frames, emits `partial` events.
  - `_finalise_streaming` обгортає `rec.finalise()` → `final
    {source:"vosk_fast"}`, опційно стартує `_background_whisper_refine`.
  - `_background_whisper_refine` запускає Whisper, рахує
    SequenceMatcher ratio, емітить `final_revised` коли різниця
    суттєва.
  - `_string_similarity` — stdlib-only difflib helper.
  - `_reset_internal` чистить streaming recognizer і скасовує refine
    task (mid-utterance reset / duck не повинен витікати background
    work).
- `src/backend/api/routes_voice_stream.py` — `_build_orchestrator`
  пробрасує 4 нові параметри з `config`. `ready` event розширений
  полями `streaming_partials`, `partial_debounce_ms`,
  `refine_with_whisper`.
- `src/backend/config.py` — 4 нові ключі: `voice_streaming_partials`
  (default `True`), `voice_partial_debounce_ms` (default `200`),
  `voice_refine_with_whisper` (default `False`), `voice_refine_diff_threshold`
  (default `0.85`). Plus валідатори в `_validate_voice_mode_keys`:
  debounce ∈ [50, 1000], threshold ∈ [0.0, 1.0].
- `src/backend/api/routes_settings.py` — 4 ключі додані в "voice"
  category + укр. лейбли. `_apply_runtime_side_effect` *не* тригерить
  `reset_providers()` для них (вони runtime-only, як і
  `voice_silence_timeout_ms` з 12.0).

### Frontend (новий код)
- `src/frontend/src/stores/chatStore.ts` — `userPreview` state,
  `setUserPreview`, `replaceLastUserMessage(content, extraMetadata?)`.
  `sendMessage` чистить `userPreview` при оптимістичному пуші.
- `src/frontend/src/hooks/useVoiceAlwaysOn.ts`:
  - тип `FinalTranscript['source']` розширений: `'vosk_fast' | 'whisper_quality'`.
  - `AlwaysOnConfig.onRevisedTranscript`.
  - `_handleServerEvent` обробляє `case 'partial':` (suppressed for
    tap-to-talk) і `case 'final_revised':`.
  - `final` з `source:'vosk_fast'` лишає UI у `'ready'` без cooldown.
- `src/frontend/src/components/chat/VoiceAlwaysOnGate.tsx` — пайпить
  `partialTranscript` у `chatStore.setUserPreview`, `onRevisedTranscript`
  у `chatStore.replaceLastUserMessage`.
- `src/frontend/src/components/chat/ChatWindow.tsx` — рендерить
  ghost-баббл (italic, dimmed cyan, animated pulsing dot) коли
  `userPreview != null` та `!sending`.

---

## 4. Test counts (snapshot після 13b)

| Suite | After 13a | After 13b | Δ |
|-------|----------:|----------:|--:|
| Backend `pytest -q` | 948 | **973** | +25 |
| Frontend `vitest run` | 223 | **234** | +11 |
| Frontend `npm run build` | green | **green** | — |

Прогон Backend: `973 passed in 221.29s` (`-q --tb=no`, повний suite,
`.venv/bin/python` 3.12). Frontend: `Test Files 26 passed (26),
Tests 234 passed (234)` (`npx vitest run`). Build: `✓ built in 37.81s`,
тільки попередження "chunks > 500 kB" — не регресія цієї фази.

---

## 5. Behaviour matrix

| Налаштування | UI | Latency першого partial | speech_end → final |
|--------------|----|------------------------:|-------------------:|
| `voice_streaming_partials=False` | без ghost-bubble | n/a | 400–800 ms (Whisper) |
| `voice_streaming_partials=True`, `voice_refine_with_whisper=False` | ghost живий, real bubble на final | ≤ 300 ms | ≤ 200 ms (Vosk fast) |
| `+ voice_refine_with_whisper=True` | ghost → real → text replace якщо Whisper суттєво відрізняється | ≤ 300 ms | ≤ 200 ms (Vosk fast) + 1–3 s background refine |

---

## 6. Edge cases (згідно plan §8)

- **Vosk "відкочує" текст** — дебаунс 200 ms згладжує миготіння; ghost
  bubble має `whitespace-pre-wrap` стилізацію через CSS variables
  (`--font-body`, `--fs-sm`) щоб layout не плавав.
- **Дуже коротке мовлення (< 200 ms)** — дебаунс може з'їсти
  єдиний partial, але `final` приходить тим самим Vosk fast-path. UX:
  юзер бачить text відразу як real bubble.
- **mid-utterance reset / duck** — `_reset_internal` дропає streaming
  recognizer + cancel refine task (тест `test_reset_during_streaming_drops_recognizer`).
- **`final_revised` після того як assistant уже відповів** — opt-in,
  default OFF; `replaceLastUserMessage` міняє текст user message in place,
  assistant reply лишається.
- **Tap-to-talk перетинається з always-on partial** — `inputModeRef ==
  'tap'` блокує partial / final_revised обробку у hook (тести
  `partial events are suppressed while tap-to-talk owns the turn` і
  `final_revised is suppressed while tap-to-talk owns the turn`).

---

## 7. Що НЕ робить ця фаза (rolled forward to Phase 14)

- Predictive LLM kickoff на partials.
- Streaming TTS / barge-in.
- Semantic endpointing.
- Real wake-word ONNX (продовжуємо substring-match на Vosk transcript).

---

## 8. Як вимкнути (rollback / soft-disable)

- **UI:** Settings → Голос → "Streaming partials" toggle off.
- **Config / DB:** `voice_streaming_partials=false` (без рестарту
  серверу — нові WS connections отримують нове значення).
- **Whisper refine:** окремий toggle "Whisper refine (advanced)".
- **Worst case:** `git checkout v0.13.0a-quickwins`.
