# Phase 15b — Instant-tier STT на NPU (MMS-1B + CTC)

> **Мета фази:** дати моментальний (sub-100 ms) STT-відгук, повністю на Hexagon HTP, без будь-якого CPU-decoder loop. Залишити Whisper-Turbo як precision-tier refine для важливих утерансів.
> **Цільовий результат:** end-to-end transcribe latency для 3-сек укр-утерансу ↓ до 60–90 ms (vs 400–900 ms Phase 15 hybrid + 200–600 ms Phase 13a CPU). UI бачить текст одразу як користувач відпустив кнопку.
> **Вхід:** тег `v0.15.0-npu-stt`.
> **Вихід:** тег `v0.15.1-mms-instant`.

---

## 0. Чому MMS, а не Whisper-Turbo

| Критерій | Whisper-Turbo (Phase 15) | MMS-1B + CTC (Phase 15b) |
|---|---|---|
| Архітектура | encoder-decoder, autoregressive | wav2vec2 + CTC head, single forward |
| HTP-friendly? | encoder-only (decoder→CPU) | весь граф |
| Latency 3-сек укр | 600–1000 ms | **60–90 ms** |
| WER укр (короткі команди) | ~6 % | ~9 % |
| Multilingual | 99 мов native | 1162 мови (per-lang adapter) |
| Розмір compiled .bin | 800+ MB (encoder) | ~280 MB (повний граф) |
| Працює одночасно з face-tracking? | паджинг → деградація | вільно |

Whisper фундаментально не може бути "моментальним" на NPU: KV-cache decoder вимагає dynamic shapes, чого HTP не підтримує. MMS — non-autoregressive, один matmul-граф, природно лягає на Hexagon HVX.

**MMS не замінює Whisper. Це instant-tier.** Whisper-Turbo лишається precision-tier refine: якщо MMS confidence < threshold, бекенд проганяє turbo (encoder NPU + decoder CPU) у фоні і випускає `final_revised`. Користувач не помічає затримки бо bubble уже на екрані.

---

## 1. Архітектура

```
   audio.wav (16k mono, ≤ 30s) ─► pad/trim → [1, 480000] f32
                                                      │
                                                      ▼
                            ┌──────────────────────────────────────┐
                            │ Hexagon HTP V68 / QCS6490            │
                            │ encoder_int8.bin (QNN context binary)│
                            │ wav2vec2 backbone + lang adapter +   │
                            │ CTC head → logits[1, 1500, vocab_len]│
                            └──────────────────────────────────────┘
                                                      │
                                                      ▼
                              CTC argmax → collapse repeats →
                              drop pad token → tokenizer.decode
                                                      │
                                                      ▼
                              text + confidence (mean softmax max)
```

Один forward pass, без decoder loop, без KV-cache. CPU робота: argmax на ~1500-frame logits + tokenizer decode (≈ 1 ms).

---

## 2. Per-language bundles

MMS shares wav2vec2 backbone across 1162 мов; per-language adapter (~3 MB) і LM head (~25 KB на vocab). Для NPU все merge'ається в один граф під час AI Hub compile, тому **кожна мова — окремий .bin**.

Bundle layout:
```
src/backend/voice/models/mms-<lang>-qnn/
├── encoder_int8.bin           # QNN HTP context binary, V68
├── encoder_int8.onnx          # FP32 ONNX, CPU fallback
├── tokenizer_config.json      # AutoTokenizer for that language
├── special_tokens_map.json
├── vocab.json                 # CTC vocabulary
├── preprocessor_config.json
└── meta.json                  # {lang, sample_rate, max_samples}
```

Switching language = `voice_stt_mms_lang` setting → reset_providers() → next request loads new bundle. ~80 ms cold start (load + first HTP context resident).

---

## 3. Що робимо в цій фазі

| # | Зміна | Файли | Гейт |
|---|-------|-------|------|
| 1 | AI Hub compile script (per-lang) | `scripts/aihub_compile_mms.py` | manual: видає ≤ 300 MB .bin |
| 2 | `MMSNPUProvider` — single forward + CTC | `voice/mms_npu_provider.py` | pytest |
| 3 | Factory chain + config keys + validators | `voice/stt_engine.py`, `config.py` | pytest |
| 4 | Settings UI (auto-rendered + diagnostics) | `routes_settings.py` | pytest |
| 5 | Tests (factory, validators, CTC decode, framing) | `tests/test_phase15b_mms_npu.py` | pytest |
| 6 | Acceptance + tag | `docs/phase-15b-mms-stt/ACCEPTANCE.md` | manual smoke |

---

## 4. Config keys

```python
voice_stt_mode: Literal[..., "mms"] = "hybrid"  # extended
voice_stt_mms_enabled: bool = False             # opt-in
voice_stt_mms_lang: str = "ukr"                 # ISO-639-3
voice_stt_mms_bundle_dir: str = "src/backend/voice/models"
voice_stt_mms_compute: Literal["int8", "fp16"] = "int8"
voice_stt_mms_refine_with_turbo: bool = False   # dual-tier knob
voice_stt_mms_refine_confidence_min: float = 0.85
```

Validators (config.py) reject:
- `voice_stt_mms_lang` empty / non-ASCII / поза [2, 5] символів
- `voice_stt_mms_refine_confidence_min` поза [0, 1]
- `voice_stt_mms_compute` не з {"int8", "fp16"}

---

## 5. Factory chain

```
mode == "vosk"      → [_try_vosk]
mode == "mms"       → [_try_mms, _try_npu, _try_whisper, _try_vosk]
mode == "npu"       → mms_first ? full_chain : [_try_npu, _try_whisper, _try_vosk]
mode == "whisper"   → mms_first || npu_first ? full_chain : [_try_whisper, _try_vosk]
mode == "hybrid"    → same as "whisper"
```

де `full_chain = [_try_mms?, _try_npu?, _try_whisper, _try_vosk]` — MMS строго першим, потім Whisper-NPU, потім CPU paths.

---

## 6. Acceptance criteria

1. **Compile.** `scripts/aihub_compile_mms.py --lang ukr` повертає 0, видає `mms-1b-ukr.bin` 250–300 MB. AI Hub job URL у логах.
2. **Provider load.** Backend log: `MMSNPU: session up (lang=ukr mode=qnn-context-binary(...) providers=[..., 'QNNExecutionProvider'] on_npu=True)`.
3. **Latency.** Push-to-talk запис 3 сек укр-мови → engine="mms_npu", text recognised, **median latency ≤ 120 ms** з 5 спроб.
4. **CPU usage.** Під час безперервного транскрайбу 30s, htop показує uvicorn CPU ≤ 15 % (vs 40 % Phase 15 hybrid, 90 % Phase 13a CPU-only).
5. **Fallback.** `voice_stt_mms_enabled=true` + bundle dir перейменований → backend fall back на whisper-NPU/Whisper, без 500.
6. **Coexistence.** Face-tracker запущений + MMS активний → STT latency деградує ≤ 30 ms, FT FPS лишається ≥ 25.
7. **No regression.** `voice_stt_mms_enabled=false` → поведінка ідентична Phase 15.

---

## 7. Ризики і mitigation

- **[H] Quantization деградує WER на укр.** AI Hub стандартний w8a16 калібрується на загальному audio; українська — рідкісніша. Mitigation: мережити job з custom calibration set (10 укр wav-ів, 10 тиші) — додамо в `--calibration-data` коли AI Hub API підтримає user-provided для compile-job.
- **[M] Per-language bundle size росте при підтримці > 5 мов.** 5 × 280 MB = 1.4 GB на диску. Mitigation: lazy-load (тільки активна мова в RAM), решта на disk.
- **[M] HTP context size.** 280 MB INT8 ваги добре влазять у DRAM-mapped HTP region (256 MB tightly + 256 MB shared). Якщо AI Hub compile видасть "context too large" — fall back на ONNX-only INT8 з QNN online-compile (повільніше cold start ~1.5 s, transcribe той самий).
- **[L] Decoder-tier refine race condition.** Якщо turbo-refine у фоні поверне результат коли користувач уже отримав відповідь — skip. Дізнавачу не показуємо стару inflight транскрипцію після того як він уже забув її.

---

## 8. Що НЕ робить ця фаза

- Auto language detection (Phase 15c — окрема невелика робота через MMS LID).
- On-device LM rescoring (KenLM CPU rescoring доступне в HF, дає -2 % WER, але +30 ms — окремий toggle далі).
- Streaming chunked encoder (MMS expect 30s window; для довших — VAD-сегментацію використовуємо як зараз).
- Decoder-only NPU для Whisper (Phase 16).
- Custom українське acoustic fine-tune (Phase 17 опціонально, потребує 100+ годин кaplied speech data).
