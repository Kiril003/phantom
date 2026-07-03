# Voice Pipeline Rewrite — 3-Phase Roadmap Index

> **Контекст:** користувач хоче "моментальне (живе) спілкування" з PHANTOM. Поточний always-on voice (v0.12.4) має 2.5-4.5 c latency від `speech_end` до `final` і 15-20 % CPU постійно. Логіка реактивна (чекаємо silence → транскрибуємо → шлемо в LLM → шлемо в TTS — все послідовно).
>
> Three-phase rewrite plan, від найдешевшого до найглибшого:

| Phase | Документ | Ціль | Час | Ризик | Тег на виході |
|-------|----------|------|----:|-------|---------------|
| **13a** | [phase-13a-quick-wins/](../phase-13a-quick-wins/README.md) | Прибрати CPU bloat, зменшити STT latency без переписування | 3-5 год | low | `v0.13.0a-quickwins` |
| **13b** | [phase-13b-streaming-partials/](../phase-13b-streaming-partials/README.md) | Streaming partials: користувач БАЧИТЬ свої слова в момент мовлення | 12-18 год | medium | `v0.13.0b-streaming-partials` |
| **14** | [phase-14-saas-grade-voice/](../phase-14-saas-grade-voice/README.md) | Predictive LLM + streaming TTS + barge-in + real wake-word = SaaS-grade | 25-40 год | medium-high | `v0.14.0-saas-grade` |

## Коротко що в кожній фазі

### 13a — Quick wins
1. Whisper "medium" → "small" INT8 (default) — STT 2-3× швидше.
2. **Client-side Silero VAD** через `@ricky0123/vad-web` — не слати аудіо на бек коли тиша — **CPU при тиші ↓ 5×**.
3. Backend energy fast-path skip — страхувальник проти browser-VAD failure.
4. Prewarm Whisper + Vosk на startup — перший STT швидший.

**Наслідок:** end-to-end `speech_end → final` ↓ з 2.5-4.5 c до 0.4-0.8 c. Backend CPU при тиші ↓ з 15-20 % до 2-4 %. **Найбільший single-fix CPU win** — client VAD.

### 13b — Streaming partials
1. Free-grammar Vosk `KaldiRecognizer.PartialResult()` під час мовлення → emit `partial` events кожні ~150-250 ms.
2. Frontend ghost bubble (italic, dimmed, pulsing) показує текст у real-time.
3. Final через Vosk на `speech_end` (< 200 ms).
4. Опційний `final_revised` через Whisper background refine для якості.

**Наслідок:** перший видимий текст через ≤ 300 ms від першого слова. **Психологічно зникає latency** — користувач відчуває "PHANTOM мене чує живо".

### 14 — SaaS-grade
1. **Predictive LLM kickoff** на стабільному partial — починаємо thinking ще до `speech_end`.
2. **Streaming TTS** — синтезуємо по реченню, перший звук через ~500 ms після першого LLM token.
3. **Semantic endpointing** — silence_ms адаптивний (короткий на пунктуацію, довгий на hesitation).
4. **Barge-in** — мікрофон лишається активним під час TTS, AEC subtractає playback, користувач перебиває голосом.
5. **Real wake-word** — openWakeWord ONNX в браузері; backend не торкається CPU доки не почуто "фантом".

**Наслідок:** від `speech_end` до перших TTS звуків — ~500 ms (часто менше, якщо predictive вгадав). **CPU при тиші = 0** в режимі real-wake-word. Це і є SaaS-рівень як ChatGPT Voice / Pi.ai / Sesame.

## Загальні принципи

- **Кожна фаза самодостатня.** 13a корисна без 13b. 13b корисна без 14. 14 потребує 13b як фундамент (streaming infrastructure).
- **Phase 12 hard-won fixes preserved.** Mic singleton, WS singleton, ORT/Vosk singletons, lifespan preload, mic ducking, Vite proxy bypass, Silero context prefix — все зберігається.
- **Feature flags скрізь.** Кожна суттєва зміна в `config.py` як toggle. Можна вимкнути живцем через settings UI.
- **Atomic commits.** Кожна суб-зміна окремий комміт = клишний revert path.
- **Acceptance docs.** Кожна фаза завершується manual smoke + objective measurement в `ACCEPTANCE.md`.

## Що поза scope усіх трьох фаз

- WebRTC transport rewrite. (Розглянуто в phase-13-plan §3.E, відхилено за вартістю.)
- Перехід на Parakeet TDT 0.6B v3 чи whisper.cpp. (Phase-13-plan §3.B, §3.D — потребує benchmark, відкладено.)
- Hardware AEC через ReSpeaker DSP. (Окрема hardware-фаза.)
- Multi-language STT. (Українська-only лишається.)
- Multi-speaker diarization.
- WS H1 (1006 close after first turn) — окрема Phase 12.5 hotfix, паралельно.
- Емоційна адаптація голосу до user mood — Phase 15.

## Послідовність роботи

1. **Зараз:** прочитай 13a README цілком, скажи "го 13a" або "обговорити X".
2. **Після 13a реліз:** використовуй 5+ днів. Збери subjective feedback.
3. **Якщо "малувато":** заходь у 13b. Інакше може й так залишити.
4. **Після 13b реліз:** використовуй 5+ днів. Якщо хочеш ще "до ChatGPT Voice рівня" — заходь у 14.
5. **Phase 14:** 5 sub-phases по 1 робочій сесії кожна. Можна зупинитись після будь-якої.

## Чому не одна гігантська фаза

`docs/phase-13-plan/README.md` рекомендує Option D (мінімальний hotfix, повний рерайт відкласти) бо 25-45 годин в одній фазі = decision fatigue + регресії. Тому ми **розбиваємо** на 13a (швидко) → 13b (інкрементально) → 14 (опційно). Кожна — окрема decision point.
