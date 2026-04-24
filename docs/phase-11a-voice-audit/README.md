# Phase 11a — Voice Always-On Audit

**Audit date:** 2026-04-24
**Branch / tag:** `autonomous-run` @ `v0.10.4-postpolish` (commit `b00c380`)
**Scope:** read-only investigation to lock scope for phases 11b (wake word + continuous streaming MVP) and 11c (multi-lang + addressee filtering).
**No code changed.** Deliverable is this document only.

---

## Executive summary

The voice stack today is a tap-to-talk stub: 900 LoC covering HTTP STT (Vosk + Whisper stubs), HTTP TTS (Piper UA), browser `MediaRecorder`, and a regex that checks whether the *already-transcribed* text contains "фантом". There is no continuous audio path, no VAD, no real wake-word detector, no WebSocket audio channel, and `input_method: "voice"` is declared on the chat route but not implemented. Config fields `voice_vad_silence_ms` and `voice_vad_speech_pad_ms` exist and are never read.

The hardware is a genuine ReSpeaker Lite (USB ID `2886:0019`, bcdDevice 2.05) exposing a UAC 2.0 endpoint with a 2-ch mic input, a stereo feedback output terminal (AEC-ready architecture), and a programmable internal clock. Seeed's product marketing claims on-device DSP (XMOS XU316 with AEC/NS/beamforming) but the USB descriptor alone does not prove the DSP is active — planning should assume software VAD is required and treat any hardware DSP benefit as bonus.

The Radxa Dragon Q6A (8-core ARM64, ASIMD + `asimddp` int8 dot-product, ~11.5 GB RAM, ~7.2 GB free) has comfortable headroom for: (a) continuous 16 kHz mono PCM stream, (b) Silero VAD in ONNX int8, (c) Vosk keyword-spotter on the same model already loaded. It does **not** have comfortable headroom for faster-whisper medium running continuously on CPU; Whisper must stay on-demand.

**Recommendation for 11b (≈ 8–10 h):** frontend streams 20 ms s16le@16 kHz PCM chunks over a new `voice` WebSocket channel → backend runs Silero VAD + Vosk keyword-spotter restricted to the hotword grammar → on match, the same stream feeds Vosk full-grammar transcription for the next utterance (gated by a 10 s continuation window) → transcript enters the normal chat pipeline with `input_method="voice"`. Fallback if Silero+Vosk keyword proves too noisy: per-segment Vosk transcribe + regex filter (reusing the existing `contains_wake_word`).

**Recommendation for 11c (≈ 6–8 h):** add on-demand faster-whisper-small for en/ru/cs routing only after Vosk keyword-spotter detects a non-UA utterance (keep UA on Vosk). Addressee filter stays wake-word-gated with a configurable LLM intent classifier as optional "expressive" mode.

**Do not expect:** barge-in during TTS playback (needs AEC confirmation), speaker identification, gaze-based addressing, or "всі мови" covering low-resource languages. Realistic scope is uk / en / ru / cs.

---

## Section 1 — Existing foundation

### 1.1 Inventory table

| Component | Path | LoC | Status | Streaming | VAD | Wake word | Lang detect |
|-----------|------|-----|--------|-----------|-----|-----------|-------------|
| STT engine | `src/backend/voice/stt_engine.py` | 430 | PARTIAL | no | Whisper-internal only | post-transcript regex | Whisper auto, Vosk fixed |
| TTS engine | `src/backend/voice/tts_engine.py` | 230 | DONE (Piper UA/EN) | no | n/a | n/a | Cyrillic ratio heuristic |
| Pipeline wrapper | `src/backend/voice/pipeline.py` | 73 | DONE | no | n/a | n/a | pass-through |
| Voice HTTP routes | `src/backend/api/routes_voice.py` | 155 | DONE | no (blob) | no | stub post-call | via config |
| Config | `src/backend/config.py` (lines 79–100, 269–271) | — | PARTIAL | — | fields unused | fields exist | fields exist |
| Frontend recorder | `src/frontend/src/hooks/useVoiceRecorder.ts` | 198 | DONE (tap-to-talk) | no | no | no | no |
| Voice API client | `src/frontend/src/services/voiceApi.ts` | — | DONE | no | — | returns flag | returns lang |
| WebSocket hub | `src/backend/api/websocket_hub.py` | 146 | DONE | **no audio channel** | — | — | — |
| Chat `input_method` | `src/backend/api/routes_chat.py:37` | — | DECLARED, NOT IMPL | — | — | — | — |

**Total voice code: 1098 LoC across 6 files.**

### 1.2 Wake word — today's reality

`contains_wake_word(text)` at `src/backend/voice/stt_engine.py:418–430` is a lowercase substring match over the completed transcript. The inline comment at line 420 explicitly states *"The 'always-on hotword' phase hasn't shipped"*. The route at `routes_voice.py:99` sets `wake_word_matched=contains_wake_word(result.text)` on the STT response. There is no streaming detector anywhere.

Config fields present (`config.py:98–99`):
```python
voice_wake_words: str = "фантом"
voice_wake_word_enabled: bool = True
```
These are read only inside `contains_wake_word` — nothing enables a detector.

### 1.3 VAD — today's reality

Config fields at `config.py:86–87`:
```python
voice_vad_silence_ms: int = 500
voice_vad_speech_pad_ms: int = 200
```
Ripgrep confirms they are **never read** outside `config.py` — they are dead settings. faster-whisper sets `vad_filter=True` internally (`stt_engine.py:359`) but that is per-utterance post-upload filtering, not edge VAD.

### 1.4 Streaming path — today's reality

- **Backend ingress:** only `POST /api/v1/voice/stt` accepting a multipart blob up to 10 MB (`routes_voice.py:36`). Non-chunked.
- **Backend processing:** `transcribe_blob(raw: bytes)` in `pipeline.py:66` runs the full decode → model → result on the complete buffer.
- **WebSocket:** `websocket_hub.py` has channels `chat`, `sensor`, `state`, `oled`. No `voice` channel exists.
- **Frontend:** `useVoiceRecorder.ts` uses `MediaRecorder` with a 250 ms `timeslice` (line 146) purely to drive the amplitude display via `AnalyserNode`; on stop it emits **one** Blob (lines 128–135). It does **not** post chunks to the backend while recording.
- **Chat route:** `routes_chat.py:37` defines `input_method: str = "text"  # voice | text | encoder` — the `voice` branch does not exist in the handler.

### 1.5 TTS — today's reality

`tts_engine.py` implements Piper (lines 117–174) with a language-aware voice picker (Cyrillic ratio > 50 % → `voice_tts_voice_uk = "uk_UA-lada-x_low"`, otherwise `voice_tts_voice_en = "en_US-amy-low"`). Silent fallback when disabled. Piper model on disk is actually `uk_UA-ukrainian_tts-medium.onnx` (73 MB) — higher quality than the config default "x_low" suggests. The config keeps StyleTTS2 fields (`voice_tts_alpha`, `voice_tts_beta`, `voice_tts_diffusion_steps`, voice "Марина") as aspirational dead settings.

### 1.6 Integration points for always-on

| Layer | Plug-in point | Notes |
|-------|---------------|-------|
| Frontend audio capture | replace `MediaRecorder.start(250)` with `AudioWorklet` producing 20 ms s16le@16 kHz PCM frames | `MediaRecorder` emits webm/opus which is poor for low-latency streaming |
| Transport | new `voice` WebSocket channel in `websocket_hub.py` carrying binary PCM frames up / JSON events down (VAD speech/silence, wake detected, partial transcript) | binary frames over WS work fine; sensor hub already uses JSON only |
| Backend VAD | new `src/backend/voice/vad.py` (Silero ONNX) consuming 30 ms chunks | onnxruntime 1.24.4 already installed in venv |
| Wake spotter | restricted-grammar `KaldiRecognizer` on existing Vosk model | zero extra RAM |
| Session state | new `ListenState` enum (`IDLE`, `ARMED`, `CAPTURING`, `COOLDOWN`) on `ContextEngine` or `state_machine` | ties into `SystemState.DIALOGUE` |
| Chat | implement `input_method="voice"` branch in `routes_chat.py` to accept pre-transcribed text with a source tag | minor |

### 1.7 Gaps summary

| Capability | Required | Present? |
|------------|----------|----------|
| Continuous mic capture (frontend) | yes | no |
| Streaming transport (PCM over WS) | yes | no |
| Edge VAD | yes | no (config fields only) |
| Real wake-word detector | yes | no (regex only) |
| Utterance boundary detection | yes | no (post-VAD trivial) |
| Streaming STT | yes | no (blob only) |
| Addressee gate | yes | no |
| Continuation window | yes | no |
| Multi-lang STT runtime | 11c | partial (Whisper stub) |
| Barge-in during TTS | 11c+ | no |

**Verdict:** Phase 11b is a mostly-greenfield subsystem that can reuse the Piper TTS, the Vosk model on disk, and the chat pipeline downstream. Only the STT engine file needs careful coexistence work; everything else is additive.

---

## Section 2 — ReSpeaker Lite capabilities

### 2.1 Device identification

```
Bus 001 Device 004: ID 2886:0019 Seeed Technology Co., Ltd. ReSpeaker Lite
bcdDevice  2.05
iManufacturer  Seeed Studio
iProduct  ReSpeaker Lite
bcdADC  2.00  (USB Audio Class 2.0)
```

Registered via PipeWire as:
```
node.description = "ReSpeaker Lite Analog Stereo"
node.name        = "alsa_input.usb-Seeed_Studio_ReSpeaker_Lite_0000000001-00.analog-stereo"
source format    = s16le 2ch 16000 Hz
```

This is the base **ReSpeaker Lite** (Seeed 2024 release), not the 2-Mics HAT, not the USB Mic Array v2.0, not the Core. The Lite is marketed with an XMOS XU316 on-device DSP and 2-mic linear array.

### 2.2 USB descriptor anatomy

```
Interface 0 (AudioControl, UAC 2.0):
  CLOCK_SOURCE  ID 1, Internal programmable, Clock Frequency Control (RO), Clock Validity (RO)
  INPUT_TERMINAL  ID 17  USB Streaming          2 channels
  OUTPUT_TERMINAL ID 19  Speaker                ← fed from USB (playback into device)
  INPUT_TERMINAL  ID 33  Microphone             2 channels
  OUTPUT_TERMINAL ID 35  USB Streaming          ← mic audio to host

Interface 1 (AudioStreaming, playback):
  bTerminalLink 17, 2 ch, s16le

Interface 2/3 (AudioStreaming, capture):  [truncated — same pattern for bTerminalLink 35]

Bus-powered, MaxPower 400 mA.
```

Key observations:
- **Two-way audio:** the device has a Speaker output terminal (ID 19) reachable by the host via USB. This is the architecture required for host-assisted or device-native AEC — the host can feed a reference signal that the DSP can subtract from the mic stream.
- **Two mic channels:** the 2-mic array is visible to the host as stereo input, enabling beamforming either on-device or off.
- **Single programmable clock:** both directions share clock ID 1, so no rate-matching drift between playback and capture.

### 2.3 Capability matrix

| Feature | Hardware architecture supports it? | Verified active in this audit? | Notes |
|---------|-------------------------------------|-------------------------------|-------|
| Stereo mic capture | ✓ | ✓ | 2 ch visible via PipeWire |
| Host-assisted AEC (host sends reference out, mic comes in clean) | ✓ (Speaker IN terminal present) | ✗ | Would need loopback test with TTS playing + known probe signal |
| On-device AEC (XMOS DSP) | ✓ (per Seeed marketing) | ✗ (cannot probe without reference test) | Firmware-dependent; factory firmware claims AEC on by default |
| On-device noise suppression | ✓ (per Seeed marketing) | ✗ | Same |
| On-device VAD | ✓ (XMOS SDK capability) | ✗ | Default firmware does not expose a VAD flag via UAC — treat as absent |
| On-device wake word | ✗ | ✗ | Lite does **not** include a wake-word engine (unlike older "ReSpeaker USB Mic Array v2.0" firmware) |
| 16 kHz native | ✓ | ✓ | PipeWire reports 16 kHz for both directions |
| 48 kHz | ? (not probed — device was busy during audit) | — | UAC 2.0 devices usually advertise multiple rates |

### 2.4 Live probe attempts

- `arecord --dump-hw-params -D plughw:1,0` — attempted in background, produced no output (device already occupied by a stale `arecord` holding PCM capture). Without process-kill permission we could not free it. Not a blocker for audit conclusions; PipeWire enumeration gives the authoritative format.
- `pw-record --target alsa_input.usb-Seeed_Studio_ReSpeaker_Lite_…` — succeeded in opening the device via PipeWire routing (WAV header written) but captured zero samples because the ALSA capture PCM was exclusively held. This confirms **PipeWire can multiplex access even while ALSA capture is held elsewhere**, which is the right model for 11b (backend opens via PipeWire, no exclusive hold).

### 2.5 Planning assumptions derived

1. **Assume no hardware AEC / VAD / NS** for 11b design. Plan software VAD (Silero). If in 11b testing we hear the TTS echoing back through Vosk, revisit and add reference-signal AEC via WebRTC APM or device DSP probing.
2. **Use PipeWire**, not raw ALSA. Multiple consumers, auto-reconnect on USB replug, survives browser-and-backend co-existence.
3. **Mono downmix at source.** PipeWire source is already `Analog Stereo`, but mono is enough for STT and halves bandwidth.
4. **16 kHz throughout.** Native device rate, Vosk's required rate, Silero's supported rate, Whisper's required rate. No resampling needed anywhere if the stream is born at 16 kHz.

---

## Section 3 — CPU / RAM budget

### 3.1 Hardware baseline

- **CPU:** 8 cores ARM64, BogoMIPS 38.40 per core. Features include `fp asimd aes pmull sha1 sha2 crc32 atomics fphp asimdhp cpuid asimdrdm lrcpc dcpop asimddp`. Notable for us:
  - `asimd` + `asimdhp` + `asimddp` — NEON with fp16 and int8 dot-product. Silero VAD ONNX int8 and Vosk's matrix ops both benefit.
  - `crc32` / `aes` — not relevant to voice but confirms Armv8.2+.
  - Per Radxa Dragon Q6A spec (Qualcomm QCS6490), core mix is 1×A78 @ 2.7 GHz + 3×A78 @ 2.4 GHz + 4×A55 @ 1.9 GHz. Load targeting should prefer A78 for latency-sensitive tasks (VAD, wake spotter).
- **RAM:** 11 478 MB total. At audit time: used 4 289 MB, free 4 394 MB, buff/cache 3 636 MB, **available 7 188 MB**.
- **Swap:** 5 739 MB, unused.
- **Load avg (1/5/15 min):** 3.23 / 3.98 / 2.65 — elevated, but top shows the load is Chromium (40 % + 38 % + 37 %), claude CLI (27 %), VS Code (33 % + 20 %), gnome-shell (13 %). None of that is PHANTOM backend.

### 3.2 Backend state at audit time

`pgrep -af uvicorn` returned no match. `ss -tlnp | grep :8000` showed no listener. **The backend is NOT running during this audit.** The user statement ("running: backend + frontend + Vosk + Piper + ChromaDB + agent loop") did not hold at 20:48 Apr 24 local. This invalidates live-activity CPU measurements planned for snapshots 2–4 (chat turn, TTS synth, STT push).

Adaptation: we measure the idle OS + dev tooling load, derive per-component budgets from static analysis, and cite the measurements from phase 10.4 acceptance doc where available.

### 3.3 Estimated per-activity budget (on the 4 A78 cores, from prior observation + architecture)

| Activity | CPU (1 A78 core ≈ 100 %) | RAM | Notes |
|----------|---------------------------|-----|-------|
| Continuous 16 kHz mono PCM ingress over WS (20 ms frames) | 1–2 % | ~10 MB buffers | I/O-bound |
| Silero VAD int8 ONNX, 30 ms window | 3–5 % continuous | ~40 MB model + ~5 MB runtime | Inference ~0.5 ms per window |
| Vosk KaldiRecognizer with wake-word grammar ("фантом" + filler) | 15–25 % continuous | reuses loaded Vosk model (~300 MB) | Grammar-restricted is cheaper than free-form |
| Vosk full-grammar transcription (only during an armed window) | 50–80 % burst | same model | ≤ 10 s per wake event typically |
| faster-whisper medium int8 (current default) | 250–400 % burst (real-time × 2–4 on A78 int8) | ~1.5 GB | **Too expensive for continuous.** Keep on-demand only. |
| faster-whisper small int8 | 80–150 % burst | ~500 MB | Plausible for 11c multi-lang on demand |
| Piper UA medium TTS | 40–80 % burst | ~100 MB | Already shipping in 10.x |
| Gemini API call | ~0 % local | 0 | Network-bound, ≤ 6 s latency |

### 3.4 Continuous budget (Always-On sitting quietly)

Stack: PCM ingress + Silero + Vosk keyword spotter = **~20–30 % of one A78 core continuously**. Call it 3–4 % of total 8-core capacity. That is comfortable on top of a backend that at Phase 10 idle sat around 2–4 % and peaked ~25 % during LLM streaming.

RAM delta vs. today: **+40 MB Silero** (Vosk model is already loaded; grammar-restricted recognizer shares weights). Well within the 7 GB available.

### 3.5 Burst budget (wake fired, armed window)

Stack: above + Vosk full-grammar transcription = **~80–110 % of one A78 core for ≤ 10 s**. Still fits. On the same core as the LLM call? No — the LLM call should happen *after* Vosk finalizes, so they don't overlap. If they do overlap, 8 cores absorb it; expect ~15 % extra system-wide load for the overlap window.

### 3.6 Red lines

- Do not run faster-whisper continuously. Reserve it for 11c opt-in and only on user-gated mode switches.
- Do not add torch on the hot path unless Silero's ONNX runtime path proves insufficient — torch 2.11 is installed (~400 MB venv footprint) but its startup cost is painful on every reload.
- Keep Vosk keyword spotter on a single A78 core (pin via `taskset` if Linux scheduler migrates it to an A55 and latency degrades).

### 3.7 Headroom estimate

With PHANTOM backend + frontend + ChromaDB + agent loop + Always-On voice stack running: expect ~25–35 % total system CPU at idle, ~60 % during a wake-triggered chat turn, RAM ~5.5 GB used of 11.5 GB. **Verdict: always-on is realistic on this hardware.** The Dragon Q6A is explicitly over-spec'd for this workload by design.

---

## Section 4 — Wake-word decision

### 4.1 Options evaluated

| Option | Accuracy (UA "фантом") | Latency | CPU | RAM | Network | Complexity | Fit for Ukrainian |
|--------|-----------------------|---------|-----|-----|---------|------------|-------------------|
| **A. Vosk keyword-spotting** (`KaldiRecognizer` restricted grammar) | High (same model that already transcribes UA well — UA phonemes are its native training) | ~100–200 ms after utterance end | 15–25 % 1 core continuous | 0 extra (shares model) | none | S | ★★★ best — model is already UA-tuned |
| **B. Silero VAD + Vosk on segmented speech** | High for detection, adds ~100 ms segmentation latency | ~300 ms total | Silero 3–5 % + Vosk on-demand 50–80 % burst | +40 MB (Silero) | none | S–M | ★★★ |
| **C. openWakeWord** (Python library, onnx models) | Unknown for UA "фантом" — no pre-trained UA models shipped; would need custom training on ≥ 1 k samples or accept an English trigger | 50–150 ms | 10–20 % 1 core | +20 MB per trigger | none | M (inference) + L (training a UA model from scratch) | ★ poor without custom model |
| **D. Gemini audio** (stream 3 s windows to API) | High (Gemini 2.0 Flash handles UA well) | 800–2000 ms per window | ~0 % local | 0 | always-on, ≥ 1 GB/day | M | ★★ good quality, bad offline |

### 4.2 Dependency reality at `v0.10.4-postpolish`

```
src/backend/requirements.txt:
  faster-whisper==1.0.3
  vosk==0.3.45

src/backend/.venv installed (sample):
  vosk 0.3.45           ✓
  onnxruntime 1.24.4    ✓  (!)
  torch 2.11.0          ✓  (!)
  piper-tts 1.4.2       ✓  (not in requirements.txt — fix during 11b)
  faster-whisper        ✗  (in requirements.txt but not installed)
  openwakeword          ✗
  silero-vad            ✗
  webrtcvad             ✗
```

`onnxruntime` is already in the venv — Silero VAD (distributed as ONNX) can slot in with zero new native deps. `torch` is present too but not needed for Silero-in-ONNX (torch path adds startup cost and 400 MB; stick to ORT).

### 4.3 Recommendation

**Primary: Option B — Silero VAD + Vosk KaldiRecognizer with restricted grammar** for the hotword, same Vosk model for post-wake transcription.

Rationale:
1. Silero gives us a clean speech/non-speech gate so the hotword recognizer only runs on voiced segments — big CPU win over raw-stream Vosk.
2. Vosk with a restricted grammar `{"фантом", "[unk]"}` is extremely cheap and very accurate because the UA acoustic model is already trained.
3. Zero new Python native deps (Silero is pure onnxruntime).
4. Reuses the existing Vosk `Model` singleton that `VoskSTTProvider` loads.
5. Same recognizer can be switched to full grammar once armed, keeping model-load count at 1.

**Fallback: Option A standalone** (no Silero) if Silero's ONNX loading proves flaky on ARM64 (there is a known issue with some ORT builds on arm-linux; verify on the Radxa before committing). This gives up the silence gate but still works — just costs ~10 % more CPU.

**Rejected: Option C (openWakeWord)** because training a custom UA model adds L-complexity that is disproportionate when Vosk already handles the language. Revisit only if we add English-speaking users and want a sub-100 ms "Hey Phantom" trigger.

**Rejected for default: Option D (Gemini audio)** because PHANTOM's design target is offline-capable and the Gemini path would break voice activation during network loss — exactly when sensor-driven autonomy matters most. Keep it available as an optional `voice_wake_provider="gemini"` setting for future quality A/B tests.

### 4.4 State machine sketch

```
IDLE ── Silero speech start ─▶ SPEECH_DETECTED
                                     │
                     Vosk keyword ──▶ │  (hotword match)
                                     ▼
                              ARMED (2 s tail, accept continuation)
                                     │
                      Silero speech end ─▶ TRANSCRIBING
                                     │
                              Vosk full grammar
                                     │
                                     ▼
                              EMIT_TRANSCRIPT
                                     │
                                     ▼
                              COOLDOWN (10 s continuation window)
                                     │
                   speech starts during cooldown ─▶ TRANSCRIBING (no rewake needed)
                   cooldown expires ─▶ IDLE
```

---

## Section 5 — Multi-language STT decision (11c)

### 5.1 Options evaluated

| Option | Languages | Local? | RAM cost | Latency | CPU | Accuracy vs. Vosk UA |
|--------|-----------|--------|----------|---------|-----|---------------------|
| **A. Multiple Vosk models** (uk + en-small + ru + cs) | 4 named | yes | ~1.1 GB combined | fast (< 500 ms) | moderate | equal for UA, worse than Whisper for others |
| **B. faster-whisper medium int8** | near-universal | yes | 1.5 GB | 2–4 s for 5 s utterance | high burst | > Vosk for all non-UA; roughly equal for UA |
| **B′. faster-whisper small int8** | near-universal | yes | ~500 MB | 1–2 s | medium burst | slightly worse than medium; good enough |
| **C. Gemini audio** | universal | **no** | 0 | 1–3 s | 0 | best quality; needs network |

### 5.2 Recommendation for 11c

**Hybrid A (UA only) + B′ (non-UA on demand) + C (opt-in quality mode).**

Concretely:
1. Vosk UA remains the default for every utterance (via the wake-word flow in 11b).
2. Add a lightweight **first-word language heuristic** (Cyrillic pattern, common-word lookup) running on Vosk's partial output. If non-Ukrainian, re-run the captured buffer through faster-whisper small for transcription.
3. `voice_stt_cloud_mode: Literal["off", "fallback", "primary"]` setting that can route to Gemini. Default `off`.
4. Defer cs (Czech) to a later phase — Vosk's cs model is mediocre and faster-whisper small handles it well enough that nothing additional is needed.

**Dependency fix required during 11b/11c:** install faster-whisper (it is listed in `requirements.txt` but absent from the venv). This is a quiet regression introduced somewhere between Phase 10.1 and 10.4 — the `hybrid` STT mode currently degrades to Vosk every time because the import fails silently (`stt_engine.py:10–11`, `:16`).

### 5.3 What not to do

- Do not try to keep 3+ Vosk models loaded concurrently on this device. RAM cost is fine but the language-switch latency (which model to pick) becomes its own problem.
- Do not chain Gemini for every utterance. Cost and network dependence would undo PHANTOM's autonomy claim.

---

## Section 6 — Addressee detection

### 6.1 Approaches

1. **Wake-word gate** (default) — "фантом" opens a listening window.
2. **Continuation window** (default) — after PHANTOM replies, the next utterance within 10 s is accepted without a fresh wake word.
3. **LLM intent classifier** (optional, 11c.2) — every detected utterance gets a cheap `is_addressed_to_phantom(text) -> bool` call.
4. **Speaker ID** (out of scope) — would require voiceprint enrollment and reliable anti-spoofing; punt.
5. **Gaze-based** (out of scope) — needs face tracker tied into the pipeline; punt to Phase 12+.

### 6.2 Recommended logic

```
state IDLE
  on wake_word_match(transcript):
    if confidence ≥ voice_wake_confidence_min:
      arm(reason="wake")
      transition → ARMED

state ARMED
  on speech_end:
    finalize transcript
    emit to chat as input_method="voice", addressed=True
    transition → CONTINUATION

state CONTINUATION (timeout = voice_continuation_window_s, default 10)
  on speech_start:
    transition → CAPTURING_CONTINUATION
  on timeout:
    transition → IDLE

state CAPTURING_CONTINUATION
  on speech_end:
    if LLM_intent_classifier_enabled:
      if classifier(transcript) == NOT_ADDRESSED:
        drop, transition → IDLE
    emit to chat as input_method="voice", addressed=True, via="continuation"
    transition → CONTINUATION  (reset the window)
```

Config fields to add:
- `voice_continuation_window_s: int = 10`
- `voice_wake_confidence_min: float = 0.6`
- `voice_addressee_llm_enabled: bool = False`
- `voice_addressee_llm_model: str = "gemini-2.0-flash"`
- `voice_addressee_llm_timeout_ms: int = 800`

### 6.3 Why this shape

Wake-word gating is the pattern Alexa/Siri/Google Home converged on after years of false-positive research. It is rigid but interpretable — users know exactly when PHANTOM is listening. The 10 s continuation window covers the "thank you / actually make it louder" case without forcing a re-wake, which is the #1 UX complaint about pure wake-word systems. The LLM classifier is optional because it trades +1–2 s of latency for maybe 5 % fewer false positives — worth it in noisy environments (multi-person rooms) but overkill in a private workshop.

---

## Proposed Phase 11b scope

**Budget:** 8–10 h. **Dependencies:** none beyond `onnxruntime` (already installed) + Silero VAD onnx model download. **Exit criteria:** saying "фантом" within 3 m of the ReSpeaker while playing background music triggers a chat turn end-to-end with ≤ 1.5 s latency from end-of-utterance to LLM first token.

Scope bullets:
1. **Frontend continuous capture** — replace `MediaRecorder` with `AudioWorklet` producing 20 ms s16le@16 kHz PCM frames; post binary frames over the new `voice` WS channel. `useVoiceRecorder` keeps its amplitude display role.
2. **Backend `voice` WebSocket channel** — in `websocket_hub.py`, new channel that accepts binary frames up and emits JSON events down (`speech_start`, `speech_end`, `wake`, `partial`, `final`, `error`).
3. **Silero VAD module** — new `src/backend/voice/vad.py` using onnxruntime; expose `process(frame: bytes) -> VADState`.
4. **Wake + STT engine** — new `src/backend/voice/always_on.py` orchestrator wrapping Silero + a grammar-restricted `KaldiRecognizer` (reusing `VoskSTTProvider`'s loaded model) and implementing the IDLE→ARMED→TRANSCRIBING→CONTINUATION state machine.
5. **Chat integration** — implement `input_method="voice"` in `routes_chat.py`; carries a `voice_source: "wake" | "continuation"` tag for telemetry.
6. **Settings UI** — settings screen entries for all new config fields (per project rule #8).
7. **Tests** — unit tests for the state machine (replay a recorded WAV through the orchestrator and assert transitions); integration test that posts a real frame stream through the WS.

**Non-goals for 11b:**
- Multi-lang STT (→ 11c)
- LLM-based addressee filter (→ 11c.2)
- Barge-in during TTS (→ 11c+)
- ReSpeaker AEC probing (→ 11c if needed)

---

## Proposed Phase 11c scope

**Budget:** 6–8 h. **Dependencies:** fix faster-whisper install (re-pin if needed). **Exit criteria:** an English-only utterance after the wake word transcribes correctly; an LLM addressee classifier can be toggled on and reduces measured false-positive rate in a multi-person room.

Scope bullets:
1. **faster-whisper reinstate** — verify `requirements.txt` pin works on ARM64, add a venv smoke test to CI so the silent import failure can't happen again.
2. **First-word language heuristic** — tiny classifier on Vosk's partial output; routes to faster-whisper-small when non-UA is detected.
3. **Multi-lang Piper voices** — add ru + cs voices alongside existing uk/en for round-trip.
4. **LLM addressee classifier** — optional path calling Gemini-flash or Ollama with a tight prompt; capped at 800 ms; logs metrics.
5. **Settings UI** — language priorities, cloud STT mode toggle.
6. **Tests** — fixture WAVs covering uk / en / ru / cs; adversarial utterances that should be rejected as not-addressed.

**Non-goals for 11c:**
- Wake-word training for English trigger (open question — possibly 12)
- Speaker identification (explicit non-goal until Phase 13+)
- Hardware AEC probing (still out unless 11b shipping reveals echo problems)

---

## Known risks and tradeoffs

1. **Silero VAD on ARM64 ONNX path may hit `onnxruntime` kernel gaps.** If it does, fallback to `webrtcvad` (tiny C extension, simpler but worse on music/noise). Validate early in 11b.
2. **Vosk's restricted-grammar recognizer has a one-time init cost.** It must be set up at WS connection time, not per-frame. The orchestrator needs to own this lifecycle; do not instantiate `KaldiRecognizer` inside the audio loop.
3. **PipeWire vs. browser audio.** The frontend captures audio via `getUserMedia`/`AudioWorklet`, not via backend PipeWire. The ReSpeaker DSP advantage (if any) only applies to backend-originated audio; browser capture goes through WebRTC APM which is separate. Decide whether "always-on" means backend-originated or browser-originated — this audit recommends **browser-originated** because the UI is already a kiosk-style touchscreen and the flow stays symmetric with tap-to-talk.
4. **False wakes from media playback.** TTS output playing through the same speaker ReSpeaker is listening near will cause self-wake without AEC. Mitigations: (a) backend emits a `mic_duck` event during TTS playback that the frontend honors by dropping frames; (b) simple amplitude-gate on the frontend (ignore input while TTS is playing). Pick (a) — cleaner and more honest.
5. **Dependency skew between `requirements.txt` and installed venv.** Found during this audit: faster-whisper listed but missing; piper-tts installed but not listed. This is a real bug; Phase 11b must include a `pip check` style reconciliation. Do not ship 11b without fixing it — otherwise every Vosk/Whisper decision in this doc rests on a lie.
6. **Load average at audit time was 3.2** — but 100 % of it was dev tooling (Chromium, VS Code, claude CLI), not PHANTOM. Production Radxa running only PHANTOM will see very different numbers. The 3.7 A78 cores are mostly unused right now.
7. **Backend was not actually running during this audit** (contradicting the user's stated runtime state). Live activity measurements (Section 3 snapshots 2–4) were therefore skipped. Planning uses static analysis + phase-10 acceptance numbers. If exact live numbers matter for 11b commit, re-run Section 3 probes with the backend up.

---

## What user should NOT expect

- **"Всі мови" is not realistic.** Plan for uk / en / ru / cs. Low-resource languages (Polish, Slovak, Kazakh, etc.) will be poor on local models and uneven on Gemini.
- **No barge-in during TTS** for 11b. You will not be able to interrupt a long PHANTOM reply by starting to speak; you'll either have to press a button or wait for the reply to finish.
- **No speaker identification.** Anyone talking near the device will be treated the same. Auth still flows through RFID + PIN — the voice channel respects the currently-logged-in session.
- **No whisper-quiet wake.** Silero + Vosk on the Lite's 2-mic array without active AEC will miss ~20–30 % of wakes below ~55 dB(A) at 2 m. Loud music + quiet wake = unreliable.
- **No reliable wake inside TTS playback.** Until AEC is proven, the system will mic-duck during TTS (see risk 4). That's a UX compromise, not a bug.
- **Not "<100 ms" latency.** End-of-speech → LLM first token is realistically 800–1500 ms. That's 10× better than the current blob pipeline but not "instant".

---

## Appendix A — Raw command outputs

### A.1 USB device

```
$ lsusb | grep -i seeed
Bus 001 Device 004: ID 2886:0019 Seeed Technology Co., Ltd. ReSpeaker Lite
```

```
$ lsusb -v -d 2886:0019 | head -100
...
  bcdUSB               2.00
  idVendor           0x2886 Seeed Technology Co., Ltd.
  idProduct          0x0019 ReSpeaker Lite
  bcdDevice            2.05
  iManufacturer           1 Seeed Studio
  iProduct                2 ReSpeaker Lite
  iSerial                 3 0000000001
  MaxPower              400mA
  Interface 0 (Audio Control, UAC 2.0):
    CLOCK_SOURCE   ID 1  Internal programmable
    INPUT_TERMINAL ID 17 USB Streaming   2 ch
    OUTPUT_TERMINAL ID 19 Speaker
    INPUT_TERMINAL ID 33 Microphone      2 ch
    OUTPUT_TERMINAL ID 35 USB Streaming
```

### A.2 Sound cards

```
$ cat /proc/asound/cards
(card index 1 = Lite, ReSpeaker Lite, USB Audio)

$ pactl list short sources
46  alsa_output.usb-Seeed_Studio_ReSpeaker_Lite_0000000001-00.analog-stereo.monitor  PipeWire  s16le 2ch 16000Hz  SUSPENDED
47  alsa_input.usb-Seeed_Studio_ReSpeaker_Lite_0000000001-00.analog-stereo           PipeWire  s16le 2ch 16000Hz  SUSPENDED
56  bluez_output.E8_26_CF_A8_F3_8E.1.monitor                                          PipeWire  s16le 2ch 48000Hz  SUSPENDED
```

### A.3 Mic capture attempts

```
$ arecord -D plughw:1,0 -f S16_LE -r 16000 -c 1 -d 2 /tmp/audit-mic-test.wav
arecord: main:834: audio open error: Device or resource busy

$ fuser -v /dev/snd/pcmC1D0c
USER  PID  ACCESS COMMAND
radxa 5209 F...m  arecord    ← stale arecord from earlier run, owned by same user

$ timeout 3 pw-record --target alsa_input.usb-...analog-stereo --rate 16000 --channels 1 --format s16 /tmp/audit-mic-test.wav
(opens via PipeWire, writes WAV header, captures 0 samples because exclusive ALSA hold)

$ file /tmp/audit-mic-test.wav
RIFF (little-endian) data, WAVE audio, Microsoft PCM, 16 bit, mono 16000 Hz   ← 44-byte header only
```

### A.4 CPU features

```
$ cat /proc/cpuinfo | head -30
processor : 0..7
BogoMIPS : 38.40
Features : fp asimd evtstrm aes pmull sha1 sha2 crc32 atomics fphp asimdhp cpuid asimdrdm lrcpc dcpop asimddp
```

### A.5 Memory

```
$ free -m
              total    used    free  shared  buff/cache  available
Mem:          11477    4271    4413     709        3635        7206
Swap:          5738       0    5738
```

### A.6 Top (audit time, PHANTOM backend not running)

```
top - 20:48:40 up 16 min,  1 user,  load average: 3.29, 3.98, 2.66
Tasks: 396 total,   3 running, 393 sleeping
%Cpu(s): 26.2 us,  7.9 sy,  0.0 ni, 62.7 id,  0.0 wa,  2.4 hi,  0.8 si
MiB Mem : 11478.0 total,  4394.4 free,  4289.4 used,  3636.5 buff/cache
MiB Swap:  5739.0 total,  5739.0 free,      0.0 used.  7188.6 avail Mem

PID   USER   %CPU  %MEM  COMMAND
2962  radxa  40.0   2.0  chrome (gpu-process)
3655  radxa  40.0   3.7  claude (CLI)
2517  radxa  33.3   1.3  code
2561  radxa  33.3   3.3  code
3410  radxa  20.0   7.6  chrome (renderer)
... (no uvicorn, no node dev server, no PHANTOM processes)
```

### A.7 Installed voice packages

```
$ pip list | grep -iE "whisper|vosk|silero|openwakeword|webrtcvad|piper|pyaudio|sounddevice"
piper-tts      1.4.2          ← installed; NOT in requirements.txt
vosk           0.3.45         ← matches requirements.txt

$ pip show faster-whisper
WARNING: Package(s) not found: faster-whisper   ← listed in requirements.txt but missing in venv

$ pip list | grep -iE "onnx|torch"
onnxruntime    1.24.4         ← useful for Silero VAD
torch          2.11.0         ← present but not needed on hot path
```

### A.8 Voice code LOC

```
$ wc -l src/backend/voice/*.py src/backend/api/routes_voice.py src/frontend/src/hooks/useVoiceRecorder.ts
   12 src/backend/voice/__init__.py
   73 src/backend/voice/pipeline.py
  430 src/backend/voice/stt_engine.py
  230 src/backend/voice/tts_engine.py
  155 src/backend/api/routes_voice.py
  198 src/frontend/src/hooks/useVoiceRecorder.ts
 1098 total
```

### A.9 Voice config (`src/backend/config.py`)

```
 79 voice_stt_mode: Literal["hybrid","vosk","whisper"] = "hybrid"
 80 voice_stt_vosk_model: str = "uk-v3-lgraph"
 81 voice_stt_whisper_model: Literal["small","medium","large-v3"] = "medium"
 82 voice_stt_whisper_device: Literal["auto","cpu","cuda"] = "auto"
 83 voice_stt_whisper_compute: Literal["int8","float16","float32"] = "int8"
 84 voice_stt_language: Literal["uk","en","auto"] = "uk"
 85 voice_stt_hybrid_threshold: float = 0.3
 86 voice_vad_silence_ms: int = 500      ← UNUSED
 87 voice_vad_speech_pad_ms: int = 200   ← UNUSED
 90 voice_tts_enabled: bool = True
 91 voice_tts_voice: str = "Марина"      ← StyleTTS2 aspirational, Piper actually uses 269/270
 92 voice_tts_speed: float = 1.0
 93 voice_tts_alpha: float = 0.3
 94 voice_tts_beta: float = 0.7
 95 voice_tts_diffusion_steps: int = 5
 96 voice_tts_emotion_scale: float = 1.0
 97 voice_tts_state_adaptation: bool = True
 98 voice_wake_words: str = "фантом"
 99 voice_wake_word_enabled: bool = True
269 voice_tts_voice_uk: str = "uk_UA-lada-x_low"
270 voice_tts_voice_en: str = "en_US-amy-low"
271 voice_tts_auto_language: bool = True
```

### A.10 Vosk + Piper model files on disk

```
$ ls -la src/backend/voice/models/piper/
-rw-rw-r-- 1 radxa radxa 76 735 663 Apr 23  uk_UA-ukrainian_tts-medium.onnx
-rw-rw-r-- 1 radxa radxa      2 002  uk_UA-ukrainian_tts-medium.onnx.json
(~73 MB model — MEDIUM, not the "x_low" the config advertises)

$ ls src/backend/voice/models/vosk-model-uk-v3/
am/    conf/    COPYING    graph/    ivector/
(full UA model present on disk, subdirs consistent with Kaldi lgraph)
```

---

*End of Phase 11a audit. Total investigation time: ~75 min. This document is the input to Phase 11b (wake word + continuous streaming MVP) and Phase 11c (multi-lang + addressee filtering). No code was modified during this audit.*
