# Phase 15 — STT на Hexagon NPU (Whisper)

> **Мета фази:** перенести encoder Whisper з CPU на Hexagon NPU (HTP) Radxa Dragon Q6A. Залишити graceful fallback chain `NPU → faster-whisper CPU → vosk → noop`.
> **Цільовий результат:** end-to-end transcribe latency для 3-секундного утерансу ↓ з 400–900 ms (Whisper-small INT8 CPU) до 150–300 ms (encoder QNN HTP + decoder CPU). Backend CPU під transcription ↓ ~60 %.
> **Час на реалізацію:** 6–10 годин (включно з конверсією моделі, яка може вимагати кілька проб).
> **Ризик:** середній. Quantization NPU специфічна, encoder shape константний (Whisper expect 30s mel) — добре лягає на HTP. Decoder з KV-cache залишається на CPU (autoregressive шлях погано квантизується).
> **Вхід:** тег `v0.13.0-streaming-partials`.
> **Вихід:** тег `v0.15.0-npu-stt`.

---

## 0. Hardware/SDK стан (verified)

```
$ uname -m / OS              aarch64 / Ubuntu 24.04.4 LTS
$ /dev/fastrpc-cdsp          present (Hexagon DSP/NPU available via FastRPC)
$ dpkg -l | grep qnn         libqnn1, libqnn-dev, qnn-tools (2.43.0.260128)
$ ls /usr/lib/libQnn*        Cpu, Htp(V68/V69/V73/V75/V79/V81), System present
$ which qnn-context-binary-generator   /usr/bin/qnn-context-binary-generator
$ pip show onnxruntime-qnn   2.1.0 installed in venv
$ pip show onnxruntime       1.25.1 installed in venv
$ pip show optimum           2.1.0 installed in venv
$ pip show transformers      4.57.6
$ pip show torch             2.11.0
```

**ORT-QNN integration model.** Стандартний `onnxruntime` 1.21+ підтримує EP-plugin pattern:
```python
import onnxruntime as ort
import onnxruntime_qnn as oq
ort.register_execution_provider_library("QNNExecutionProvider", oq.get_library_path())
# після цього 'QNNExecutionProvider' з'являється у ort.get_available_providers()
```
Verified live. `provider_options` дозволяє вказати `backend_path` (libQnnHtp.so) і `htp_performance_mode`.

**HTP Stub-версії на пристрої.** До v81 включно. Q6A (Snapdragon QCS8550 / SM8550) має V73 HTP. У провайдер-options передаємо `htp_arch=73`.

---

## 1. Архітектура

```
                                                          ┌──────────────┐
                                                          │ Hexagon NPU  │
                                                          │ (HTP V73)    │
                                                          └──────────────┘
                                                                ▲
   audio.wav (16k mono) ─► log-mel spectrogram (CPU, librosa) ──┤
                                                                │ encoder.onnx
                                                                │ (INT8 quant,
                                                                │  QNN context binary)
                                                                ▼
                                                  encoder_hidden_states (1500, 384/1280)
                                                                │
                                                                ▼
                                            decoder_with_past.onnx (FP32 CPU)
                                                                │
                                                                ▼
                                                  token IDs ► tokenizer ► text
```

**Encoder NPU, decoder CPU.**
- Whisper encoder: фіксований shape (80 mel × 3000 frames для 30s), no autoregressive loop, виключно matmul/conv/layernorm — ідеальне для Hexagon HVX.
- Whisper decoder: autoregressive з KV-cache, dynamic shapes — на NPU потребує static-shape unrolling, це довге і нестабільне. Decoder лишається CPU через ORT `CPUExecutionProvider`.

---

## 2. Що робимо в цій фазі

| # | Зміна | Файли | Очікуваний win |
|---|-------|-------|----------------|
| 1 | Конверсія HF → ONNX (encoder + decoder) | `scripts/convert_whisper_to_qnn.py` | base for NPU path |
| 2 | INT8 квантизація encoder для QNN HTP | те саме | enables HTP execution |
| 3 | `WhisperNPUProvider` (encoder QNN, decoder CPU) | `src/backend/voice/whisper_npu_provider.py` | runtime integration |
| 4 | Інтеграція у `build_stt_provider()` | `src/backend/voice/stt_engine.py` | activation |
| 5 | Config keys + Settings UI toggle | `config.py`, `SettingsPanel.tsx` | operator opt-in |
| 6 | Прогрів NPU контексту на startup | `src/backend/voice/pipeline.py` | first-call latency ↓ |
| 7 | `.gitignore` для `voice/models/whisper-turbo-hf/` + README як скачати | repo root | repo size sane |
| 8 | Tests (graceful fallback, factory, config) | `tests/test_phase15_npu_stt.py` | acceptance gate |

---

## 3. Конверсія моделі

### 3.1 Вибір базової моделі

Скачано `whisper-large-v3-turbo` (1.6 GB). Для NPU це **забагато**:
- HTP context size: 4 MB tightly-coupled SRAM, 256 MB DRAM.
- Quantized large-v3-turbo encoder ≈ 800 MB INT8 → не влізе в HTP context, потребує паджинг → втрата швидкості.

**Замість turbo беремо `openai/whisper-small`** (244M params). INT8 encoder ≈ 60 MB, decoder ≈ 100 MB FP32 на CPU. Українська якість на побутових фразах 90–93 % (vs 96 % у large-turbo) — прийнятно як **NPU primary** з fallback на large-turbo CPU при низькій confidence.

`whisper-turbo-hf/` залишається на диску для випадків коли користувач явно вибрав precision-mode у settings (CPU path).

### 3.2 Скрипт `scripts/convert_whisper_to_qnn.py`

Кроки:
1. **HF → ONNX** через `optimum-cli export onnx --model openai/whisper-small --task automatic-speech-recognition`. Виходить:
   - `encoder_model.onnx`
   - `decoder_model.onnx` (initial step, no past)
   - `decoder_with_past_model.onnx` (subsequent steps, з KV-cache)
2. **ONNX → INT8 quant (encoder тільки)** через `onnxruntime.quantization.quantize_static` з calibration dataset (10 секунд тиші + 10 секунд української мови з тестового корпуса) → `encoder_int8.onnx`.
3. **QNN context binary** через `qnn-context-binary-generator --backend libQnnHtp.so --model encoder_int8.onnx --output_dir voice/models/whisper-small-qnn/` → `encoder_int8.bin`. Це **pre-compiled** для V73 HTP, перший load на NPU миттєвий замість 3–5 секунд online compile.

Output layout:
```
src/backend/voice/models/whisper-small-qnn/
├── encoder_int8.onnx         # ONNX-only fallback (CPU, якщо QNN не доступний)
├── encoder_int8.bin          # QNN HTP context binary, pre-compiled for V73
├── decoder_model.onnx        # FP32 decoder, CPU
├── decoder_with_past_model.onnx
├── tokenizer.json
├── vocab.json
└── preprocessor_config.json
```

### 3.3 Calibration dataset

Quantization потребує representative inputs. Складемо легкий калібратор:
- 5 wav-файлів української мови (запис в дома/тиша/мовлення/музика).
- 5 wav-файлів тиші (для калібровки нижньої межі activation).
- Розмір ~30 MB, лежить у `scripts/calibration/whisper_uk/`.

---

## 4. `WhisperNPUProvider`

```python
class WhisperNPUProvider(STTProvider):
    name = "whisper_npu"

    def __init__(self) -> None:
        import onnxruntime as ort
        import onnxruntime_qnn as oq
        ort.register_execution_provider_library("QNNExecutionProvider", oq.get_library_path())
        # ... build encoder session with QNNExecutionProvider, CPUExecutionProvider fallback ...
        # ... build decoder sessions on CPU ...
        # ... load tokenizer, preprocessor ...

    async def transcribe(self, audio, language) -> STTResult: ...
```

**Provider options для encoder** (визначені в коді):
```python
qnn_options = {
    "backend_path": oq.get_qnn_htp_path(),
    "htp_performance_mode": "high_performance",
    "htp_arch": "73",                    # V73 для QCS8550
    "soc_model": "43",                   # SM8550
    "enable_htp_fp16_precision": "0",    # використовуємо INT8 quant
    "qnn_context_priority": "normal",
}
```

**Decoder loop** — стандартний beam_size=1 greedy:
1. Запустити encoder на NPU → encoder_hidden_states.
2. Прогнати decoder (initial) з `<|startoftranscript|><|uk|><|transcribe|><|notimestamps|>` → next token logits.
3. Argmax → новий токен. Якщо `<|endoftext|>` — стоп.
4. Прогнати `decoder_with_past` з KV-cache до next token. Повторити до `<|endoftext|>` або max_length=448.
5. Tokenizer decode → text.

Confidence: середній softmax probability обраних токенів (proxy замість logprob як у faster-whisper).

---

## 5. Інтеграція у factory

`config.py` додає:
```python
voice_stt_npu_enabled: bool = False     # opt-in (off за замовчуванням до acceptance)
voice_stt_npu_model_path: str = "src/backend/voice/models/whisper-small-qnn"
voice_stt_npu_compute: Literal["int8", "fp16"] = "int8"
```

`stt_engine.py` додає `_try_npu()`:
```python
def _try_npu() -> Optional[STTProvider]:
    if not config.voice_stt_npu_enabled:
        return None
    try:
        return WhisperNPUProvider()
    except Exception as exc:
        logger.info("NPU STT unavailable: %s", exc)
        return None
```

Chain в `build_stt_provider()`:
```python
mode = config.voice_stt_mode  # "hybrid" | "vosk" | "whisper" | "npu"
if mode == "npu":
    chain = [_try_npu, _try_whisper, _try_vosk]
elif mode == "hybrid" and config.voice_stt_npu_enabled:
    chain = [_try_npu, _try_whisper, _try_vosk]
elif mode == "hybrid":
    chain = [_try_whisper, _try_vosk]   # legacy
elif mode == "whisper":
    chain = [_try_whisper, _try_vosk]
elif mode == "vosk":
    chain = [_try_vosk]
```

---

## 6. Settings UI

`SettingsPanel.tsx` додає секцію **STT — NPU**:
- Toggle `voice_stt_npu_enabled` (default off).
- Dropdown `voice_stt_npu_compute` (int8 / fp16).
- Path-display `voice_stt_npu_model_path` (read-only, оператор бачить де модель).
- Status indicator (зелений/червоний) показує чи QNN EP реально завантажений.

`voice_stt_mode` dropdown отримує опцію `"npu"`.

---

## 7. Послідовність комітів

| # | Commit | Файли | Гейт |
|---|--------|-------|------|
| 1 | `phase-15.0: phase doc` | `docs/phase-15-npu-stt/README.md` | review |
| 2 | `phase-15.1: convert script + ignore turbo-hf` | `scripts/convert_whisper_to_qnn.py`, `.gitignore` | manual: script runs and produces .bin |
| 3 | `phase-15.2: WhisperNPUProvider` | `voice/whisper_npu_provider.py`, tests | pytest |
| 4 | `phase-15.3: stt_engine factory` | `voice/stt_engine.py`, `config.py`, tests | pytest |
| 5 | `phase-15.4: pipeline warm-up` | `voice/pipeline.py`, tests | pytest |
| 6 | `phase-15.5: settings UI toggle` | `SettingsPanel.tsx`, tests | vitest |
| 7 | `phase-15.6: tag v0.15.0-npu-stt + acceptance` | `docs/phase-15-npu-stt/ACCEPTANCE.md` | manual smoke |

---

## 8. Acceptance criteria

1. **Conversion.** `scripts/convert_whisper_to_qnn.py` runs to completion з зеленим логом, видає `encoder_int8.bin` size 50–80 MB.
2. **EP registration.** Backend startup log: `QNN EP registered, providers=[..., 'QNNExecutionProvider']`.
3. **Live transcription.** `voice_stt_npu_enabled=true`, push-to-talk запис 3 сек української мови → `engine="whisper_npu"`, text recognised, latency ≤ 350 ms (медіана з 5 спроб).
4. **Fallback.** `voice_stt_npu_enabled=true` + symlink на `encoder_int8.bin` зламано → backend fall back до faster-whisper, без 500-помилки на endpoint.
5. **CPU usage.** Під час безперервного транскрайбу 30s recording, htop показує uvicorn CPU ≤ 40 % (vs 90–100 % при faster-whisper-small CPU).
6. **No regression.** `voice_stt_npu_enabled=false` → поведінка ідентична до Phase 13a.

---

## 9. Ризики та mitigation

- **[H] V73 HTP context binary не сумісний з V75/V79/V81.** Якщо користувач збере на іншому soc — context-binary mismatch. Mitigation: `convert_whisper_to_qnn.py` приймає `--htp-arch` arg, документація показує як перебудувати.
- **[H] INT8 quant калібрація поверх неукраїнського dataset деградує WER.** Mitigation: 10 коротких українських wav у calibration set (4.3.3).
- **[M] `qnn-context-binary-generator` може зафейлитись на specific ops у encoder.** Mitigation: fallback path — лишаємо ONNX-only INT8 encoder без `.bin`. Сесія load повільніший (~3s) але працює.
- **[M] FastRPC permissions.** `/dev/fastrpc-cdsp` має бути readable для user `radxa`. Mitigation: документуємо `sudo chmod 666 /dev/fastrpc-cdsp` (або udev rule).
- **[L] Decoder CPU bottleneck при довгих утерансах (>10s).** Whisper-small decoder на ARM A78 ≈ 80 ms per token, 50 токенів = 4s. Mitigation: PHANTOM utterances типово ≤ 5s; для довших — phase 16 опція decoder NPU.

---

## 10. Що НЕ робить ця фаза

- Decoder на NPU (Phase 16, окрема велика робота з KV-cache static unrolling).
- Streaming chunked encoder (Phase 16).
- Custom acoustic model fine-tune для української — використовуємо stock `openai/whisper-small`.
- Wake-word на NPU — окремо в Phase 14 ONNX wake-word.
- Заміна Vosk: він залишається instant-streaming fallback.
