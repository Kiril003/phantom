# Phase 13 Plan — Always-on Voice Rewrite Investigation

> **Status:** planning document. ZERO production code changes.
> **Branch:** `autonomous-run` at `v0.12.2-tts-feedback-fix` (commit `9365268`).
> **Author:** Claude Code (auto mode), 2026-04-27.
> **Reader instruction:** read this fresh-headed in 3-7 days, then pick A / B / C / D in Section 7.
> **Honesty contract:** every latency claim is either measured (cited file:line), benchmarked elsewhere (cited URL), or marked **estimated**. The recommendation in Section 4 is real, but Section 7 walks through why it may not be the right move *for this project right now*.

---

## How this document was produced

- Read the seven voice modules end-to-end (frontend hook + worklet + gate, backend WS handler + orchestrator + VAD + wake spotter + STT engine + pipeline glue).
- Read the Phase 12.0 / 12.1 / 12.2 acceptance docs — those describe what works on `v0.12.2` and which hard-won fixes any rewrite must preserve.
- Eight web searches (April 2026 era) for current STT/streaming/transport tech.
- Did **not** boot the backend, run a real-mic capture, or modify any source. The architecture map is from reading the code; the latency numbers from existing acceptance docs and external benchmarks.

What this means: the architecture in Section 1 is reliable; the **specific milliseconds** in Section 3 are estimates from external benchmarks scaled to Radxa-class ARM CPU. Pre-rewrite (Section 5 Phase 13.0) the user must run the recommended-engine benchmark on actual hardware before committing.

---

## Section 1 — Current architecture audit

### 1.1 End-to-end audio path

```
┌────────────────────────── Browser (Radxa Chromium) ──────────────────────────┐
│                                                                              │
│  navigator.mediaDevices.getUserMedia({ echoCancellation:true,                │
│                                        noiseSuppression:true })              │
│         │                                                                    │
│         ▼                                                                    │
│  useMicStream  ──── refcounted MediaStream singleton ────────┐               │
│                                                              │               │
│  AudioContext  (native sample rate, typically 48 kHz)        │               │
│         │                                                    │               │
│         ▼                                                    │               │
│  voice-capture.worklet.js (AudioWorklet, plain JS)           │               │
│   • linear-interp resample → 16 kHz                          │               │
│   • Float32 → Int16 LE                                       │               │
│   • batch 480 samples = 30 ms = 960 bytes                    │               │
│   • postMessage(ArrayBuffer, [transfer])                     │               │
│         │                                                    │               │
│         ▼                                                    │               │
│  worklet.port.onmessage → ws.send(arraybuffer)               │               │
│                                                              │               │
│  useVoiceAlwaysOn  (module-level WS singleton + refcount)    │               │
│   • acquireWS / releaseWS                                    │               │
│   • addEventListener for message/error/close (multi-consumer safe)           │
│   • commands: mic_duck, mic_unduck, set_confidence, reset, stop              │
│         │                                                                    │
└─────────┼────────────────────────────────────────────────────────────────────┘
          │   WebSocket (binary 30 ms PCM frames + occasional JSON commands)
          │   DEV: ws://<host>:8000/ws/voice  (bypasses Vite proxy — Phase 12.1)
          │   PROD: ws[s]://<host>/ws/voice
          │
┌─────────▼────────────────────── Backend (FastAPI) ───────────────────────────┐
│                                                                              │
│  routes_voice_stream.voice_ws_handler                                        │
│   • JWT verify  (4401 close on bad/missing token)                            │
│   • _build_orchestrator() in to_thread (Silero ORT load + Vosk model load)   │
│   • emit `ready` once, then loop ws.receive()                                │
│         │                                                                    │
│         ▼                                                                    │
│  AlwaysOnOrchestrator.process_frame(bytes)        mode dispatch:             │
│   • MODE_OFF       → return                       (zero CPU)                 │
│   • MODE_LEGACY    → 11b wake-spotter FSM                                    │
│   • MODE_CONTINUOUS / MODE_WAKE_WORD → _process_frame_phase12                │
│         │                                                                    │
│         ▼                                                                    │
│  SileroVAD.process(bytes)  via asyncio.to_thread                             │
│   • 16 kHz: 512-sample windows + 64-sample context prefix (Phase 12.1 fix)   │
│   • Schmitt-trigger hysteresis (speech 0.5 / silence 0.35)                   │
│   • activation 3 windows, silence_windows = silence_ms ÷ 32 ms               │
│   • silence_ms = config.voice_silence_timeout_ms (default 1500)              │
│   • returns events: ["speech_start"|"speech_end"]                            │
│         │                                                                    │
│  on SPEECH_START:                                                            │
│         • orchestrator: in_utterance=True, buffer=bytearray, emit speech_start│
│  on every subsequent frame inside utterance:                                 │
│         • buffer.extend(pcm_bytes)                                           │
│  on SPEECH_END:                                                              │
│         • emit speech_end                                                    │
│         • _finalise_phase12_utterance(audio):                                │
│             ◦ to_thread → np.frombuffer → /32768.0 → float32                 │
│             ◦ get_stt_provider().transcribe(audio, lang)                     │
│             ◦ provider = FasterWhisperSTTProvider | VoskSTTProvider | Noop   │
│             ◦ to_thread → WhisperModel.transcribe(beam_size=1, vad_filter=True)│
│             ◦ MODE_WAKE_WORD: substring match against wake_phrase, strip     │
│             ◦ emit `final` { transcript, source, confidence }                │
│         │                                                                    │
└─────────┼────────────────────────────────────────────────────────────────────┘
          │   WS text frame (JSON event)
          │
┌─────────▼────────────────── Browser (back side) ──────────────────────────────┐
│  useVoiceAlwaysOn._handleServerEvent                                         │
│   • case 'final': onFinalTranscript({ transcript, source, confidence })      │
│         │                                                                    │
│         ▼                                                                    │
│  VoiceAlwaysOnGate.onFinalTranscript                                         │
│   • chatStore.sendMessage(text, 'voice', systemState)                        │
│         │                                                                    │
│         ▼                                                                    │
│  POST /api/v1/chat/message  (HTTP, separate transport)                       │
│   • LLM round-trip (Gemini primary / Ollama fallback)                        │
│   • returns assistant message + metadata.input_method='voice'                │
│         │                                                                    │
│         ▼                                                                    │
│  ChatWindow TTS effect                                                       │
│   • gate: previous user metadata.input_method === 'voice'                    │
│   • voiceAlwaysOnDuck()  → WS cmd mic_duck + worklet port mute               │
│   • voiceApi.synthesize  →  <audio src=blob:...>                             │
│   • audioEl.play() … on ended/error: voiceAlwaysOnUnduck()                   │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Component inventory

| Layer | File | Lines | Purpose |
|-------|------|------:|---------|
| Frontend | `src/frontend/src/hooks/useVoiceAlwaysOn.ts` | 580 | WS singleton, mic acquire, server-event router, public `voiceAlwaysOnDuck/Unduck` exports |
| Frontend | `src/frontend/src/hooks/useMicStream.ts` | 182 | Refcounted `MediaStream` shared between tap-to-talk and always-on |
| Frontend | `src/frontend/src/components/chat/VoiceAlwaysOnGate.tsx` | 76 | Reads `voice_mode` setting, fires `chatStore.sendMessage` on `final` |
| Frontend | `src/frontend/src/workers/voice-capture.worklet.js` | 112 | 48 kHz Float32 → 16 kHz Int16 LE, 30 ms frames, mute support |
| Backend | `src/backend/api/routes_voice_stream.py` | 318 | `/ws/voice` handler, JWT auth, `_VoiceSession`, command parser |
| Backend | `src/backend/voice/always_on.py` | 458 | `AlwaysOnOrchestrator`, mode dispatch, Phase 12 VAD-driven path, legacy 11b FSM |
| Backend | `src/backend/voice/vad.py` | 319 | `SileroVAD` ORT wrapper, hysteresis, 64-sample context prefix, ORT singleton |
| Backend | `src/backend/voice/wake_spotter.py` | 173 | Restricted-grammar `KaldiRecognizer` (only used by `MODE_LEGACY`) |
| Backend | `src/backend/voice/pipeline.py` | 198 | Singletons for STT/TTS/Vosk-model + `preload_voice_models` lifespan helper |
| Backend | `src/backend/voice/stt_engine.py` | 438 | `STTProvider` ABC, Whisper / Vosk / Noop, `decode_to_mono16k`, ffmpeg fallback |

Total: **2854 lines** of voice-specific source across 10 files (excluding tests).

### 1.3 Per-stage latency budget (estimated, current `voice_mode=continuous` on Radxa Q6A CPU)

| Stage | Where | Budget | Notes |
|-------|-------|-------:|-------|
| Mic capture (browser) | AudioWorklet 128-sample blocks | ~3 ms | Web Audio API native granularity |
| Resample 48k→16k + Int16 cast | `voice-capture.worklet.js:_floatToInt16` | <1 ms | linear-interp, no lib |
| WS frame send (LAN/loopback) | `ws.send(ArrayBuffer)` | <2 ms | 960 bytes per 30 ms |
| Silero VAD ONNX inference | `voice/vad.py:_infer` (per 32 ms window) | 1-3 ms | Singleton ORT session, CPU provider |
| Hysteresis + framing | `voice/vad.py:_Hysteresis.feed` | <0.1 ms | pure Python int math |
| **Endpoint silence wait** | hysteresis `silence_windows` × 32 ms | **1500 ms** | dominated by `voice_silence_timeout_ms` config |
| `_finalise_phase12_utterance` setup | `np.frombuffer` + `/32768.0` | 1-3 ms | per-utterance one-shot |
| **STT (Whisper "medium")** | `FasterWhisperSTTProvider._transcribe_sync` (`stt_engine.py:355`) | **1000-3000 ms** | beam_size=1, vad_filter=True, on Radxa CPU; Whisper "medium" is large for ARM |
| Emit `final` event JSON | `_VoiceSession.send` | <2 ms | single ws.send_text |
| `chatStore.sendMessage` POST | HTTP /api/v1/chat/message | 200-2000 ms | LLM round-trip (Gemini or Ollama) — out of voice scope |
| TTS synth (StyleTTS2) | `voiceApi.synthesize` | 500-2000 ms | also out of voice scope |

**End-to-end "user stops speaking" → "transcript text appears in chat":** ≈ **2.5–4.5 seconds** before the LLM/TTS hop. This is the latency the user feels in always-on mode and is the headline number Phase 13 must move.

### 1.4 Concurrency, singletons, and resource sharing (the Phase 12 hard-won fixes)

These survived two months of debugging. Any rewrite that doesn't preserve these properties will regress:

1. **Mic singleton with refcount** (`useMicStream.ts`). Two consumers (tap-to-talk via `useVoiceRecorder`, always-on via `useVoiceAlwaysOn`) share one `MediaStream`. Without it, `getUserMedia` race-conditions on browsers that hand the mic to one consumer at a time (Phase 11b.1).

2. **WS singleton with refcount** (`useVoiceAlwaysOn.ts:81-148`). React StrictMode double-mounts and rapid toolbar clicks used to spawn duplicate WebSockets. Module-level `_wsInstance` + `_wsRefCount` deduplicates. The release branch (`_releaseWS`) closes regardless of `readyState` because Phase 11c.5 leaked CONNECTING sockets.

3. **Listener model is `addEventListener`, not `onmessage=`**. Multiple hook instances (gate plus any future debug overlay) each attach their own message listener. The previous `ws.onmessage = ...` style overwrote earlier consumers (Phase 11c.5 Bug 1).

4. **Silero ORT session singleton** (`voice/vad.py:54-97`). The ONNX session loads once per process, not per connection. Per-connection state (state tensor, pending samples, hysteresis) lives on the `SileroVAD` instance; the ORT graph is shared. Saved 1-3 s of cold-start per WS connect.

5. **Vosk model singleton** (`pipeline.py:86-131`). The 300 MB Vosk Ukrainian model loads once. If the active STT provider already holds it, reused; otherwise loaded fresh. Same singleton pattern as ORT.

6. **Lifespan preload** (`pipeline.py:149-198`). On backend startup, `preload_voice_models` warms VAD + Vosk + Whisper. First WS connect now opens in <100 ms instead of 8-10 s (Phase 12.0 Bug 2).

7. **Settings reset is scoped** (`routes_settings._apply_runtime_side_effect`). Only model-invalidating keys (STT engine, Whisper config, Vosk path, TTS voice) trigger `reset_providers()`. Flipping `voice_mode` or `voice_wake_phrase` keeps the singletons warm.

8. **Mic ducking** (`always_on.py:138`, `useVoiceAlwaysOn.ts:174-195`, `ChatWindow.tsx` TTS effect). Backend drops frames while `_ducked`, frontend worklet also mutes locally as belt-and-suspenders. Without this, TTS audio bleeds back into the mic and triggers a self-feedback loop (Phase 12.2).

9. **Vite WS proxy bypass in DEV** (`useVoiceAlwaysOn.ts:228-235`). `/ws/voice` connects directly to backend `:8000` because Vite's proxy crashes (EPIPE / 1006) under 30 ms binary frame cadence (Phase 12.1).

10. **Silero v5 ONNX 64-sample context prefix** (`voice/vad.py:230-238`, `_infer:289-309`). Without carrying 64 samples between calls the ONNX LSTM never warms up and probabilities pin near 0. Real-speech detection broke silently before this fix (Phase 12.1).

A rewrite that drops any of these without an architectural reason is not a rewrite — it's a regression with extra steps.

### 1.5 What works on `v0.12.2` (single-utterance round-trip)

User says "привіт", VAD detects speech_end after 1500 ms of silence, Whisper transcribes, chat POST happens, assistant replies, TTS plays, mic ducks during playback. Backend test count: 933. Frontend test count: 222. `npm run build` succeeds. Manual real-mic verification: not done (user declined to record fixtures earlier in the cycle, see Phase 12.0 README "Bug 3").

### 1.6 What does not work on `v0.12.2`

- **WS closes 1006 after the first utterance.** Not yet root-caused (tracked as H1 in Phase 12.2 acceptance). Hypotheses: HMR `_wsInstance` survival but listener stale-closure into a unmounted React tree; backend close-after-final somewhere in the orchestrator. Workaround: user re-toggles voice mode.
- **Latency 3-5 s per utterance** — see Section 1.3.
- **No partial transcripts.** User has no feedback during STT processing.
- **No barge-in** — cannot interrupt PHANTOM mid-TTS by speaking.

---

## Section 2 — Why current architecture is structurally limited

Four issues, each in a different layer.

### Issue A — Whisper finalize is high-latency on Radxa CPU

- `FasterWhisperSTTProvider` (`voice/stt_engine.py:321-383`) loads `WhisperModel(model_size, device='cpu', compute_type=...)`.
- Default in PHANTOM is currently the "medium" model (`config.voice_stt_whisper_model`).
- "medium" Whisper on ARM CPU: 1-3 seconds per utterance with `beam_size=1` and `vad_filter=True` ([SYSTRAN/faster-whisper Issue #526](https://github.com/SYSTRAN/faster-whisper/issues/526) — community reports CPU is "much slower than posted benchmark").
- Even "small" or "base" would be ~500-1500 ms. "tiny" is fast but accuracy on Ukrainian drops.
- Fundamental: Whisper is encoder-decoder, designed for batch transcription on 30-second windows ([ufal/whisper_streaming README](https://github.com/ufal/whisper_streaming)). Streaming on Whisper is a *protocol* on top of repeated short inference — the model itself isn't streaming-native.
- No GPU on Radxa Q6A. No CUDA. INT8 quantization helps but the dominant cost is the autoregressive decode, not the matmul.

**File:line citations:**
- `src/backend/voice/stt_engine.py:355-383` — the synchronous `_transcribe_sync` body, all blocking.
- `src/backend/voice/always_on.py:363-386` — `_transcribe_phase12` calls `provider.transcribe` directly; user waits for the full call.

### Issue B — Silence-timeout segmentation is laggy by design

- VAD's job is to decide *when* speech ended. Silero gives a probability per 32 ms window; the orchestrator counts `silence_windows = silence_ms / 32 ms` consecutive low-probability windows before declaring SPEECH_END (`voice/vad.py:209-217`).
- Default `voice_silence_timeout_ms = 1500` (`config.py`). Range `[500, 5000]`.
- **You cannot meaningfully lower this without false-cutting on natural pauses.** Ukrainian-speaker ums/eh-eh-eh between phrases easily exceed 500 ms. Below 800 ms users mid-sentence get mid-cut.
- **The streaming-STT alternative**: start transcribing during speech, finalize on SPEECH_END but with most of the work already done. Brings perceived latency down to ~200-500 ms instead of `silence_timeout_ms + STT_finalize`.

**File:line citations:**
- `src/backend/voice/vad.py:213-218` — silence_windows arithmetic.
- `src/backend/voice/always_on.py:319-324` — orchestrator awaits SPEECH_END before starting transcription. Nothing happens during speech.

### Issue C — WS lifecycle is fragile across HMR + StrictMode + AudioContext

- The Phase 12.0 singleton (`_wsInstance` + `_wsRefCount`) fixed *one* class of bug (duplicate connections per click).
- The Phase 12.0 listener model (`addEventListener`) fixed *another* (consumer clobbering).
- The Phase 12.0 `_releaseWS` (close regardless of `readyState`) fixed *a third* (CONNECTING leak).
- The Phase 12.1 Vite proxy bypass fixed *a fourth* (proxy crash under PCM frame load).
- **And H1 still exists**: WS closes 1006 once per turn after the first utterance. Phase 12.2 deliberately scoped it out.
- Each fix added a layer. The root cause — long-lived persistent WebSocket carrying high-rate binary audio while ALSO carrying control JSON while ALSO surviving HMR — is structurally fragile.
- A rewrite to a different transport (WebRTC RTP, or short-lived chunked HTTP POSTs) would *eliminate* the long-lived-WS problem rather than patching it for the seventh time.

**File:line citations:**
- `src/frontend/src/hooks/useVoiceAlwaysOn.ts:81-148` — singleton machinery.
- `src/frontend/src/hooks/useVoiceAlwaysOn.ts:455-463` — listener attachment.
- `docs/phase-12.2/README.md:90-99` — H1 explicit "out of scope".

### Issue D — Architecture is reactive, not predictive

- Current loop: buffer audio → wait for silence → finalize → STT → emit final → POST chat.
- Cannot start the LLM call while user is still speaking.
- Cannot interrupt PHANTOM mid-response.
- For an "AI with character" (CLAUDE.md framing), this *feels* slower than it numerically is, because the user gets no feedback during the wait.
- A streaming partial transcript displayed live (greyed-out, replaced when finalized) would mask 800-1500 ms of perceived latency for free, even if total round-trip is unchanged.
- Barge-in (user speaks → TTS pauses) requires the always-on mic to *not* duck during TTS, plus a VAD-on-output thread, plus a TTS interrupt path. Significant frontend + backend changes.

**File:line citations:**
- `src/backend/voice/always_on.py:296-362` — entirely silent during speech, only acts on SPEECH_END.
- `src/frontend/src/components/chat/ChatWindow.tsx` TTS effect — fully ducks the mic during playback (Phase 12.2 design).

---

## Section 3 — Modern alternatives, evidence-based

Six candidates investigated. Each in the same form: how it works, latency, ARM compat, footprint, examples, pros/cons, migration cost, recommendation rank.

### Candidate A — Streaming faster-whisper with partial transcripts (whisper-streaming protocol)

**How it works.** Keep `faster-whisper` as the engine; wrap it in the [ufal/whisper_streaming](https://github.com/ufal/whisper_streaming) protocol: feed audio in 200-500 ms slices, run Whisper repeatedly on a sliding window, use **LocalAgreement-2** algorithm to commit tokens that two consecutive runs agree on. Silero VAD chunks utterances; partials emit during speech, finalize on SPEECH_END. Reference impl: [ScienceIO/whisper_streaming_web](https://github.com/ScienceIO/whisper_streaming_web) (FastAPI + WebSocket front-end already exists).

**Latency target.** First partial **500-1500 ms** after speech onset (estimated, scaled from `whisper-streaming` reports of "380-520ms end-to-end with 95p" on x86 quad-core; expect 2× on Radxa A78 = 760-1040 ms). Final after SPEECH_END: **+ 200-500 ms** (one last decode on the trailing slice).

**ARM CPU compatibility.** ✓ — `faster-whisper` (CTranslate2 backend) runs on ARM aarch64 today. Already in the project.

**Memory.** "small" Whisper INT8: ~250 MB. "base" INT8: ~150 MB. "tiny" INT8: ~75 MB. Plus runtime buffers ~30-50 MB.

**Real-world examples.**
- [ufal/whisper_streaming](https://github.com/ufal/whisper_streaming) — original LocalAgreement-2 impl.
- [ScienceIO/whisper_streaming_web](https://github.com/ScienceIO/whisper_streaming_web) — FastAPI + WS adapter; closest to PHANTOM's existing transport.
- [Saytowords blog 2026](https://www.saytowords.com/blogs/Real-Time-Streaming-with-Whisper/) — guide for low-latency streaming with Whisper.
- [Baseten production whisper streaming](https://www.baseten.co/blog/the-fastest-whisper-transcription-with-streaming-and-diarization/) — GPU-only but documents the protocol.

**Pros vs current.**
- Reuses the model PHANTOM already loads, no new dependency.
- Partial transcripts → user feedback during speech.
- Gracefully downgrades to non-streaming if hardware too slow.
- Same Vosk fallback chain stays useful.

**Cons vs current.**
- Whisper is still encoder-decoder; per-slice cost is non-trivial. On ARM CPU, partials lag the audio.
- LocalAgreement-2 has a known trade-off: tokens that flip-flop between slices are held back from emit, so partial display sometimes pauses for a half-beat.
- Adds protocol complexity (sliding window, commit cursor, last-stable-position bookkeeping).

**Migration cost.** **Medium.** Backend: rewrite `_finalise_phase12_utterance` into a streaming loop, swap `provider.transcribe` for an iterative call. Frontend: handle new `partial` event type, render greyed-out preview text. ~400-700 lines of net change. Tests: significant new test surface for the streaming protocol.

**Recommendation rank: 3.**

### Candidate B — whisper.cpp streaming binary

**How it works.** Replace `faster-whisper` with [ggml-org/whisper.cpp](https://github.com/ggml-org/whisper.cpp) — native C++ Whisper port with a built-in `stream` example. Backend invokes either via subprocess or via `whispercpp`-Python bindings. Silero VAD chunks; whisper.cpp transcribes on each chunk.

**Latency target.** [whisper.cpp 1.8.3 (Jan 2026)](https://www.phoronix.com/news/Whisper-cpp-1.8.3-12x-Perf) reports 12× speedup with iGPU acceleration; for ARM CPU only, expect "small" model **~600-1200 ms per ~3 s slice** (estimated from [community Cortex-A78 benchmarks on OpenBenchmarking](https://openbenchmarking.org/test/pts/whisper-cpp)).

**ARM CPU compatibility.** ✓ — first-class. NEON SIMD, optional ARM SVE. Probably the **best Whisper variant for ARM CPU** specifically.

**Memory.** Lower than faster-whisper at the same model size. "small" Q5: ~90 MB. "base" Q5: ~50 MB. ggml format is mmap-friendly.

**Real-world examples.**
- [whisper.cpp stream example](https://github.com/ggml-org/whisper.cpp/tree/master/examples/stream) — real-time streaming with VAD chunking.
- [Picovoice's whisper.cpp streaming benchmark](https://picovoice.ai/docs/benchmark/stt-whisper-cpp-streaming-speech-to-text/) — has WER and word-emission-latency methodology.
- [Yahor Talkachou blog: Silero VAD + whisper.cpp Go server](https://medium.com/@etolkachev93/local-all-in-one-go-speech-to-text-solution-with-silero-vad-and-whisper-cpp-server-94a69fa51b04) — exact pattern PHANTOM would use.

**Pros vs current.**
- Often the fastest CPU-only Whisper on ARM. Tight C++ inner loops, less Python overhead than faster-whisper.
- Smaller memory footprint at same model.
- Built-in `stream` mode — protocol implementation is mostly there.
- Mature, well-maintained, large community.

**Cons vs current.**
- New native dependency. Build-from-source on Radxa or use prebuilt aarch64 binaries (community-maintained, less polished).
- Python bindings (`whispercpp`) are less battle-tested than `faster-whisper`. Subprocess is reliable but adds IPC cost.
- Two STT engines in the codebase during migration (whisper.cpp for always-on, faster-whisper for tap-to-talk) until both are migrated.

**Migration cost.** **Medium-High.** New `WhisperCppSTTProvider` class, build/distribute the binary or bindings, integrate VAD chunking, frontend partials. ~600-900 lines of new code.

**Recommendation rank: 4.**

### Candidate C — Vosk streaming (no Whisper)

**How it works.** PHANTOM already uses Vosk for the wake spotter and as STT fallback. Vosk's `KaldiRecognizer` natively emits `PartialResult()` and `Result()` continuously. Drop Whisper from the always-on path entirely; use Vosk continuous recognition. Optional: keep Whisper as a "premium quality re-decode" pass on the final audio for important utterances.

**Latency target.** Vosk gives **near-zero latency partials** ([alphacephei.com/vosk](https://alphacephei.com/vosk/) — "streaming API for the best user experience, and Vosk models provide zero-latency response with streaming API"). Final on SPEECH_END: **<200 ms**.

**ARM CPU compatibility.** ✓ — already running, already loaded singleton.

**Memory.** Already paid (300 MB Vosk model is in memory regardless).

**Real-world examples.**
- [Vibe Studio: streaming Vosk in Flutter](https://vibe-studio.ai/insights/streaming-audio-recognition-with-flutter-and-vosk) — same pattern.
- [VideoSDK 2025 Vosk guide](https://www.videosdk.live/developer-hub/stt/vosk-speech-recognition).
- [arxiv 2503.21025 — Vosk custom-LM accuracy improvements](https://arxiv.org/html/2503.21025v1).
- PHANTOM itself: `voice/wake_spotter.py` already uses `KaldiRecognizer` partials, just with restricted grammar.

**Pros vs current.**
- Order of magnitude lower latency than any Whisper variant.
- Already in the project — no new deps, no model download.
- Streaming is native, not a bolted-on protocol.
- Hybrid possibility: Vosk for instant feedback + Whisper background re-decode for accuracy tier.

**Cons vs current.**
- **Lower accuracy than Whisper-medium on Ukrainian.** Vosk's free Ukrainian model is the 50 MB community model; Whisper-medium is significantly better on diverse acoustic conditions.
- Confidence calibration is per-word average, less semantically meaningful than Whisper's logprob.
- No language detection — Vosk model is monolingual (already a constraint, not new).

**Migration cost.** **Low.** Most pieces exist. Add a `VoskStreamingSTTProvider` (~150 lines), modify orchestrator to consume `PartialResult` during speech, wire frontend partial display. ~250-450 lines.

**Recommendation rank: 2.**

### Candidate D — Parakeet TDT 0.6B v3 (NVIDIA, ONNX, CPU-optimized)

**How it works.** Replace Whisper with [NVIDIA Parakeet TDT 0.6B v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3) — a Token-and-Duration Transducer ASR model with explicit support for **Ukrainian** plus 25 other European languages. Ships in PyTorch and ONNX; ONNX runs on CPU efficiently. Reference Python wrappers: [achetronic/parakeet](https://github.com/achetronic/parakeet) (CPU-only Whisper-API-compatible server) and [groxaxo/parakeet-tdt-0.6b-v3-fastapi-openai](https://github.com/groxaxo/parakeet-tdt-0.6b-v3-fastapi-openai).

**Latency target.** [Paper arxiv 2509.14128](https://arxiv.org/pdf/2509.14128) reports **RTFx 3332** with 6.32% avg WER on the multilingual benchmark. RTFx 3332 means 1 second of audio transcribes in ~0.3 ms on the *paper's hardware* (data-center GPU). On CPU/ARM the realistic factor drops dramatically. From [achetronic/parakeet README](https://github.com/achetronic/parakeet): on Intel i7-12700K (x86, no GPU) Parakeet outperforms faster-whisper by 2.25× — so if Whisper-small on Radxa is ~800 ms, Parakeet should be ~350 ms. **Estimated 200-500 ms per utterance on Radxa A78.**

**ARM CPU compatibility.** Likely viable but **needs benchmark.** ONNX Runtime supports aarch64 ([microsoft/onnxruntime aarch64 releases](https://github.com/microsoft/onnxruntime/releases)). Community wrappers don't explicitly publish ARM numbers. Pre-rewrite Phase 13.0 must benchmark on actual Radxa hardware before committing.

**Memory.** 0.6B params at FP16 ≈ 1.2 GB; at INT8 ≈ 600 MB. **Higher than Whisper-small Q5 (~90 MB).** Radxa Q6A has 8-16 GB RAM, fits, but pressure on other models.

**Real-world examples.**
- [achetronic/parakeet](https://github.com/achetronic/parakeet) — OpenAI-Whisper-API compatible, CPU-only.
- [groxaxo/parakeet-tdt-0.6b-v3-fastapi-openai](https://github.com/groxaxo/parakeet-tdt-0.6b-v3-fastapi-openai) — FastAPI server, also CPU-only.
- [altunenes/parakeet-rs](https://github.com/altunenes/parakeet-rs) — Rust bindings with streaming support.
- [istupakov/onnx-asr](https://github.com/istupakov/onnx-asr) — generic ONNX-ASR Python package supporting Parakeet.
- [Northflank 2026 STT benchmarks](https://northflank.com/blog/best-open-source-speech-to-text-stt-model-in-2026-benchmarks) — Parakeet TDT and Distil-Whisper noted as best for low-latency streaming (data-center hardware).

**Pros vs current.**
- Designed CPU-friendly (NVIDIA NeMo team explicitly targeted CPU inference for v3).
- Streaming-native (TDT = Token-and-Duration Transducer is by design streaming, unlike Whisper's encoder-decoder).
- Multilingual including Ukrainian.
- Better WER than Whisper-medium on the 2026 ASR Leaderboard.

**Cons vs current.**
- Brand-new model, less battle-tested in production than Whisper.
- Memory footprint 4-7× larger than Whisper-small.
- ARM aarch64 ONNX builds work but few people publish benchmarks; Radxa Q6A specifically — zero published numbers found.
- Adding a third major STT model to the codebase (Vosk + Whisper + Parakeet).
- Tokenizer is sentence-piece BPE, different from Whisper's — token-level streaming protocol differs.

**Migration cost.** **High.** New provider, new model download (600 MB INT8), new tokenizer-aware partial-emit logic, validate accuracy on Ukrainian. ~800-1200 lines of new code, plus model bundling/distribution decisions.

**Recommendation rank: 5** — promising but expensive to integrate, and the latency win is mostly theoretical until benchmarked on Radxa.

### Candidate E — WebRTC voice transport (FastRTC / LiveKit / Pipecat)

**How it works.** Replace WS binary frames with `RTCPeerConnection`. Browser sends Opus over RTP; backend uses [FastRTC](https://fastrtc.org/), [LiveKit Python SDK](https://docs.livekit.io/reference/python/v1/livekit/rtc/apm.html), or [Pipecat](https://docs.pipecat.ai/) to receive, decode to PCM, run VAD + STT. **Built-in echo cancellation** handles the TTS-feedback problem at the WebRTC AEC layer instead of via micDuck.

**Latency target.** RTP itself adds <50 ms over LAN. STT latency unchanged from whichever engine is plugged in. **Net: same as candidate A/B/C with cleaner audio.**

**ARM CPU compatibility.** ✓ — `aiortc` (the Python WebRTC lib FastRTC and Pipecat both use) runs on aarch64. Some C extension build pain.

**Memory.** RTP machinery + per-connection PeerConnection state: ~20-40 MB extra. Negligible.

**Real-world examples.**
- [GetStream blog: WebRTC for AI voice agents 2026](https://getstream.io/blog/webrtc-ai-voice-agents/) — exactly the architecture.
- [LiveKit AudioProcessingModule](https://docs.livekit.io/reference/python/v1/livekit/rtc/apm.html) — Python WebRTC AEC/NS/HPF/AGC.
- [Pipecat](https://github.com/pipecat-ai/pipecat) — vendor-agnostic voice agent framework, used by NVIDIA, Cresta. 100% open source maintained by Daily.co.
- [Softcery: real-time vs turn-based voice agent architecture](https://softcery.com/lab/ai-voice-agents-real-time-vs-turn-based-tts-stt-architecture).
- [Eleshine: WebRTC AEC/NS deep dive](https://www.eleshine-tech.com/webrtc-audio-processing-echo-cancellation-noise-suppression-b2b.html).
- [Deepgram: Voice agent adaptive echo cancellation](https://developers.deepgram.com/docs/voice-agent-echo-cancellation).

**Pros vs current.**
- **Solves Issue C structurally** — WebRTC SCTP/RTP channels handle reconnect natively, browsers manage the lifecycle, HMR is irrelevant.
- **Solves the TTS-feedback problem at the source** — browser AEC subtracts known output from mic input. The micDuck workaround becomes obsolete.
- Opens the door to barge-in: AEC-cleaned mic continues during TTS playback without false-triggering VAD.
- Better network behavior (jitter buffer, packet loss recovery, FEC).

**Cons vs current.**
- **Significant complexity.** PeerConnection setup, ICE, SDP negotiation, signaling channel.
- New dependency (aiortc 50 MB+ build). On Radxa, native PyAV/aiortc build can take 10+ minutes.
- Per-connection PeerConnection + worker process — different model from FastAPI's WS handlers.
- Most WebRTC is designed for browser-to-browser; browser-to-server like this is supported but less common, fewer examples, more debugging surface.
- WebRTC AEC requires the browser to know about the playback stream — needs `<audio>` to be plumbed through `RTCPeerConnection` or via Web Audio API graph. PHANTOM's current `<audio src=blob:...>` from `voiceApi.synthesize` is *not* in the WebRTC graph and AEC won't see it without re-routing.

**Migration cost.** **Very high.** This is more than an STT rewrite — it's a transport rewrite. ~1500-2500 lines of new code, both ends. Re-plumb TTS playback through Web Audio. New backend connection model.

**Recommendation rank: 6.**

### Candidate F — MediaRecorder chunked HTTP POST

**How it works.** Drop the WebSocket entirely for voice. Use browser's `MediaRecorder` to emit Opus chunks every 200-500 ms via `ondataavailable`. Each chunk POSTs to `/api/v1/voice/chunk` with a session ID. Backend reassembles, runs VAD on the rolling buffer, transcribes when SPEECH_END detected. Partial transcripts come back via `/api/v1/voice/session/{id}/poll` (long-poll) or a separate SSE/WS for transcript events only.

**Latency target.** Chunk cadence dominates. With 500 ms chunks: first STT can start 500 ms after speech start, partials lag ~750-1500 ms. Final after SPEECH_END: ~1000 ms (chunk + STT). **Higher latency than Vosk streaming, similar to Whisper-streaming.**

**ARM CPU compatibility.** ✓ — purely server-side computation, transport is plain HTTP.

**Memory.** Per-session rolling buffer ~50 KB-1 MB. Negligible.

**Real-world examples.**
- [Addpipe: handling huge MediaRecorder chunks](https://blog.addpipe.com/dealing-with-huge-mediarecorder-slices/).
- [DEV.to: voice input to web forms with Whisper](https://dev.to/ryancwynar/adding-voice-input-to-web-forms-with-whisper-360j).
- [Medium: AI audio conversations using OpenAI Whisper](https://medium.com/@david.richards.tech/ai-audio-conversations-with-openai-whisper-3c730a9c7123).
- [ScienceIO/whisper_streaming_web](https://github.com/ScienceIO/whisper_streaming_web) — uses WS, but the chunk-cadence math is identical.

**Pros vs current.**
- **Eliminates the long-lived WS entirely** → Issue C dissolves.
- Simpler reconnect (each chunk is independent).
- Browser handles Opus encoding (server pays for decode but it's already happening for tap-to-talk via ffmpeg).
- No HMR/StrictMode WS-singleton complexity.

**Cons vs current.**
- **Higher latency floor** than continuous-WS (chunk cadence).
- Per-chunk HTTP overhead non-trivial (TCP, headers, auth). At 500 ms cadence on 4G that's 2 RPS per session — fine; on a flaky connection — failures.
- Server-side session management (timeout, GC, cross-chunk reassembly) is non-trivial.
- Loses the elegant "single binary frame stream" property; harder to keep per-frame ordering if HTTP/1.1 multiplexes weirdly.

**Migration cost.** **Medium.** Backend: new `/voice/chunk` POST + session manager. Frontend: replace AudioWorklet+WS with MediaRecorder + interval POSTs. ~500-800 lines.

**Recommendation rank: 1 for "if WS lifecycle is the actual bug we want to kill"**, otherwise 5.

### 3.x Honorable mentions, ruled out

- **Distil-Whisper.** [Hugging Face distil-whisper repo](https://github.com/huggingface/distil-whisper): "currently only available for English speech recognition." PHANTOM is Ukrainian-first. **Not viable.**
- **SenseVoice.** Specialized for Chinese/Japanese/Korean/Cantonese. **Not viable for Ukrainian.**
- **Wav2Vec2 fine-tuned for Ukrainian.** Available but accuracy below both Vosk and Whisper-small on conversational speech. Not worth the integration cost.
- **Hardware AEC (ReSpeaker DSP).** Listed in user's "out of scope" — skipping.
- **LLM-based addressee detection** (filter "is this addressed to PHANTOM?"). Latency-additive, doesn't solve the engine problem. User already excluded.

### 3.y Summary table

| Rank | Candidate | First-partial (est.) | Final-after-end (est.) | ARM compat | Migration cost | Solves H1? |
|----:|-----------|---------------------:|-----------------------:|-----------|----------------|-----------|
| **1** | **C — Vosk streaming partials** | <100 ms | <200 ms | ✓ already loaded | Low | No |
| 2 | F — MediaRecorder chunked POST | 500-1500 ms | 1000 ms | ✓ | Medium | **Yes (no WS)** |
| 3 | A — Streaming faster-whisper | 760-1500 ms | 200-500 ms | ✓ already loaded | Medium | No |
| 4 | B — whisper.cpp stream | 600-1200 ms | 200-500 ms | ✓ best-on-ARM | Medium-High | No |
| 5 | D — Parakeet TDT 0.6B v3 | 200-500 ms | <300 ms | needs benchmark | High | No |
| 6 | E — WebRTC + LiveKit/FastRTC | unchanged from inner STT | unchanged | ✓ aiortc | Very High | **Yes structurally** |

The "rank" here is **not** the recommendation — it's a sort by `latency_win × ease_of_integration ÷ risk`. Section 4 picks differently because the sort doesn't capture which problem PHANTOM actually has.

---

## Section 4 — Recommended architecture for v2

### 4.1 The honest answer

**The recommendation depends on which problem the user wants to solve.**

- If "always-on feels slow" — recommend **Candidate C (Vosk streaming partials)**. Cheapest integration, biggest perceived-latency win, uses what's already loaded.
- If "WS connection dies once per turn" — recommend **Candidate F (MediaRecorder chunked POST)** — kills the long-lived WS that keeps breaking.
- If "I want barge-in and clean TTS audio" — recommend **Candidate E (WebRTC)** — but this is multi-week work and changes more than just the voice pipeline.

The user's brief says "переписати з 0 кращу швидшу логіку" — "rewrite from scratch with better, faster logic." The headline complaint is **latency** + **WS lifecycle**. So:

### 4.2 Primary recommendation — Hybrid: Vosk streaming partials + Whisper background re-decode

Architecture diagram:

```
                                    ┌────────────────────────────────────────┐
Browser AudioWorklet 30 ms PCM ───▶ │  WS /ws/voice  (unchanged transport)   │
                                    └─────────────────┬──────────────────────┘
                                                      │
                                    ┌─────────────────▼──────────────────────┐
                                    │  AlwaysOnOrchestrator (rewritten)      │
                                    │                                        │
                                    │  ┌─ SileroVAD ────┐                    │
                                    │  │ speech_start   │   on speech_start: │
                                    │  │ speech_end     │   start Vosk recog │
                                    │  └────┬───────────┘                    │
                                    │       │                                │
                                    │  ┌────▼──────────────┐                 │
                                    │  │ Vosk streaming    │ on each frame:  │
                                    │  │ KaldiRecognizer   │  PartialResult()│
                                    │  │   (no grammar —   │  if changed →   │
                                    │  │    free dictation)│    emit `partial`│
                                    │  └────┬──────────────┘                 │
                                    │       │ on speech_end:                 │
                                    │       │   FinalResult() = vosk_text    │
                                    │       │   emit `final`                 │
                                    │       │                                │
                                    │  ┌────▼─────────────────────────────┐  │
                                    │  │ async background refine task:    │  │
                                    │  │  if config.voice_refine_with_    │  │
                                    │  │    whisper:                      │  │
                                    │  │    whisper.transcribe(buffer)    │  │
                                    │  │    if delta > threshold:         │  │
                                    │  │      emit `final_revised`        │  │
                                    │  └──────────────────────────────────┘  │
                                    └────────────────────────────────────────┘
                                                      │
                                                      ▼
                              new event types:
                                  partial { transcript, partial_index }
                                  final { transcript, source: 'vosk_fast' }
                                  final_revised { transcript, source: 'whisper_quality' }
```

**Why this shape:**

1. **Keeps the WS transport.** Doesn't fight the H1 lifecycle bug; that's a separate fix in Phase 12.3 if user picks Option D in Section 7.
2. **Vosk partials → instant user feedback.** The user sees their words appear within ~100 ms of speaking them. Total perceived latency drops from 3-5 s to ~200-500 ms.
3. **Vosk final on SPEECH_END.** Chat POST happens with vosk_text. LLM round-trip starts immediately.
4. **Whisper background refinement (optional, off by default).** If `voice_refine_with_whisper=true`, after the LLM has already started thinking, kick off a background Whisper pass on the same audio buffer. If Whisper's transcript differs meaningfully from Vosk's, emit `final_revised` and the chat store updates the user message in place. Most utterances: identical, no UI change. Hard utterances (accents, noise): user sees Vosk's first guess, then a quiet correction. **This is the part that beats the current architecture on accuracy AND latency.**
5. **No new dependencies.** Vosk streaming uses the existing 300 MB Vosk model. Whisper stays where it is.
6. **No model download.** Avoids dependency-fragility for a planning document that may sit for weeks.

### 4.3 Component changes

**Backend (rewrite):**
- `voice/always_on.py`: new `_process_frame_streaming` path. On SPEECH_START, allocate a free-grammar `KaldiRecognizer` (not the wake-spotter's restricted one). On each subsequent frame, call `recognizer.AcceptWaveform`; if it returns True OR `recognizer.PartialResult()` text changed since last emit, emit `partial`. On SPEECH_END, `FinalResult()`, emit `final` with `source: 'vosk_fast'`. Optional: spawn background refine task.
- `voice/pipeline.py`: add `transcribe_quality(audio: bytes) -> STTResult` that always uses Whisper, isolated from the realtime path.
- `voice/stt_engine.py`: new `WhisperRefineProvider` thin wrapper, or factor `FasterWhisperSTTProvider.transcribe` for sync use from the async refine task.
- `api/routes_voice_stream.py`: bump protocol version, add `partial` and `final_revised` event types to docs.
- `config.py`: new keys `voice_streaming_partials: bool = True`, `voice_refine_with_whisper: bool = False`, `voice_refine_min_text_diff: float = 0.3` (Levenshtein-ratio gate).

**Frontend (rewrite):**
- `useVoiceAlwaysOn.ts`: handle new event types `partial` and `final_revised`. Maintain `partialTranscript` state already exists; just feed it from the new event.
- `VoiceAlwaysOnGate.tsx`: do NOT post the chat message on `partial`. On `final` post immediately. On `final_revised` (which may arrive *after* the user has already seen the assistant reply) post a chatStore update — controversial UX, see Section 6.
- `chatStore.ts`: new method `updatePendingUserMessage(messageId, text, metadata)`.
- New UI: greyed-out italic preview text in the input area or as a "ghost" chat bubble during speech, finalized on `final`.

**Settings:**
- `voice_streaming_partials` toggle.
- `voice_refine_with_whisper` toggle (off by default, advanced option).

### 4.4 Per-stage latency budget (target)

| Stage | Target | Δ from current |
|-------|------:|---------------:|
| Mic capture + worklet + WS send | 5-10 ms | ≈ same |
| Silero VAD (singleton) | 1-3 ms per window | same |
| **First partial transcript visible** | **100-300 ms after speech start** | **was: never** |
| Subsequent partials | ~200 ms cadence | new |
| Vosk `FinalResult` after SPEECH_END | <200 ms | was 1-3 s |
| Emit `final` event | <2 ms | same |
| Chat POST + LLM | unchanged (out of voice scope) | — |
| Optional Whisper refine (background) | 1-3 s, async | doesn't block UX |

**End-to-end: speech-end → chat-message-arrives ≈ 200-400 ms.** Down from 2.5-4.5 s.

### 4.5 Backup recommendation — Candidate F (MediaRecorder chunked POST)

If after Phase 13.0 benchmarking it turns out the H1 WS lifecycle bug is unfixable in the current transport (e.g., Vite dev-server proxy still misbehaves under HMR), pivot to Candidate F. The chunked-POST architecture eliminates the WS entirely:

- Each utterance becomes ~10-20 short HTTP POSTs.
- Backend session manager assembles per-session buffers.
- Same Vosk-streaming + optional Whisper-refine engine model on the backend.
- Frontend much simpler — no WS singleton machinery, no AudioWorklet+WS-listener teardown gymnastics.

Migration cost is similar to primary recommendation (~600-900 lines) but eliminates a class of bug instead of patching another one.

### 4.6 What we are deliberately NOT recommending

- **Parakeet TDT (Candidate D).** Theoretically the best CPU latency/accuracy combo but requires:
  - Adding a third major STT engine.
  - Downloading a 600 MB INT8 model.
  - Validating Ukrainian accuracy on Radxa.
  - Benchmarking on actual hardware first.
  - For a project at the end of a 14-day marathon, this is a multi-month side-quest. Defer to Phase 14 or beyond.

- **WebRTC (Candidate E).** Best architectural answer for barge-in + AEC, but the migration is so large it's a different project. Reasonable for "PHANTOM v2.0" not "Phase 13."

- **whisper.cpp (Candidate B).** Best Whisper-on-ARM-CPU, but: PHANTOM already has `faster-whisper` working. Adding a second Whisper implementation is rarely worth it.

---

## Section 5 — Migration plan

Concrete steps from `v0.12.2-tts-feedback-fix` to "Phase 13 ships."

### Phase 13.0 — Foundation & Benchmark (estimated 4-6 hours)

**Goal:** prove on Radxa hardware that Vosk streaming partials are actually fast.

- [ ] Write `scripts/phase-13-bench/vosk_streaming_bench.py` — feeds `tests/fixtures/audio/wake_phrase.wav` (note: this fixture is silent / synthetic; record a real-mic 5-second utterance for valid benchmarking).
- [ ] Measure: time to first non-empty `PartialResult`, time per partial, time for `FinalResult` on a 3-second utterance.
- [ ] Baseline against current `_finalise_phase12_utterance` (Whisper-medium) latency on same audio.
- [ ] Record results in `docs/phase-13-bench-results.md`.
- [ ] Acceptance: first partial < 300 ms, final < 250 ms after end-of-audio. If miss → reconsider Candidate D or B.

**Hard gate to advance:** benchmark numbers in writing.

### Phase 13.1 — Backend orchestrator rewrite (estimated 6-10 hours)

- [ ] New `voice/streaming_recognizer.py` — wraps `vosk.KaldiRecognizer` with a delta-emit loop.
- [ ] Rewrite `voice/always_on.py:_process_frame_phase12` → `_process_frame_streaming`. Keep legacy 11b path for backward compat.
- [ ] Add `voice_streaming_partials` to `config.py`. Default True.
- [ ] Update `routes_voice_stream.py` to advertise new mode in `ready` event.
- [ ] Backend tests: ~15 new tests for streaming partials, debouncing, SPEECH_END handling, ducking interaction.
- [ ] Acceptance: existing 933 tests still pass; new tests pass; backend logs show `Loading Vosk model` exactly 1× across 5+ WS connects.

**Hard gate:** all tests green; rollback path = revert single commit.

### Phase 13.2 — Frontend partial display (estimated 4-6 hours)

- [ ] `useVoiceAlwaysOn.ts`: handle new `partial` event, expose `partialTranscript` (already partially scaffolded — just rewire).
- [ ] `VoiceAlwaysOnGate.tsx`: render preview ghost message via chat store.
- [ ] `chatStore.ts`: `updatePendingUserMessage` method.
- [ ] Input area: greyed-out italic preview text overlay.
- [ ] Frontend tests: ~10 new tests for partial-update flow, edge cases (rapid partials, partial-then-error).
- [ ] Acceptance: 222 existing tests still pass; new tests pass; `npm run build` succeeds; dist freshness gate operational.

**Hard gate:** all tests green; rollback path = revert two commits (this + 13.1).

### Phase 13.3 — Optional Whisper refine (estimated 4-6 hours)

- [ ] `voice/pipeline.py:transcribe_quality`.
- [ ] Background task in orchestrator on `final`.
- [ ] New `final_revised` event.
- [ ] Frontend: subtle UI affordance for revised text (animated character-by-character replace, or just silent swap).
- [ ] Setting: `voice_refine_with_whisper`, default False.
- [ ] Acceptance: feature off → zero behaviour change. Feature on → eventual revision works without breaking the LLM round-trip already in flight.

**Hard gate:** disabled-by-default ships; revisions are advisory.

### Phase 13.4 — Manual real-mic verification (estimated 2-3 hours)

- [ ] User says "привіт" — partial appears <500 ms, final <300 ms after.
- [ ] User says a longer phrase — partials accumulate smoothly, final is cohesive.
- [ ] User says something that's hard for Vosk — Whisper refine produces a better revision (if enabled).
- [ ] WS lifecycle: WS still drops 1006 after first turn? If yes — confirms H1 is independent of STT engine; queue Phase 12.3 hotfix or pivot to Candidate F.
- [ ] TTS feedback: still ducked correctly during playback?
- [ ] Acceptance: subjective UX feels "real-time."

**Hard gate:** user says "this feels good." No metric replaces a fresh ear.

### Total estimate

| Sub-phase | Hours |
|-----------|------:|
| 13.0 Foundation/bench | 4-6 |
| 13.1 Backend rewrite | 6-10 |
| 13.2 Frontend partials | 4-6 |
| 13.3 Whisper refine | 4-6 |
| 13.4 Manual verify | 2-3 |
| **Total** | **20-31 hours** |

Plus 30-50% slippage on a complex audio rewrite → realistic **25-45 hours / 3-5 working days of focused effort**.

### Rollback paths

- After 13.1: `git revert <13.1 hash>`. Backend back to 12.2 behaviour.
- After 13.2: revert 13.1 + 13.2.
- After 13.3: 13.3 is feature-flagged off by default; live setting toggle disables.
- After 13.4: tag `v0.13.0-streaming-partials`; if regressions surface in real use, `git checkout v0.12.2-tts-feedback-fix` and ship that.

---

## Section 6 — Risks and unknowns

Honest enumeration. Each risk has a **probability** ([L]ow/[M]edium/[H]igh) and a **mitigation**.

### Performance unknowns

- **[M] Vosk streaming partials may be slower on Radxa than expected.** No published Radxa Q6A numbers. Phase 13.0 bench is non-negotiable.
  - *Mitigation:* benchmark before committing. If miss → fall back to Candidate B (whisper.cpp stream) before writing 13.1.

- **[L] Vosk Ukrainian model accuracy regression vs Whisper-medium.** Vosk's free Ukrainian model (~50 MB) is below Whisper-medium on noisy/accented speech.
  - *Mitigation:* The Whisper background refinement (13.3) addresses this exactly. Until 13.3, document accuracy delta as a known limitation.

- **[L] First partial may stall for 200-400 ms while Vosk's recognizer warms up on first utterance.** Internal Kaldi state.
  - *Mitigation:* preload at lifespan time (already done for the model itself); if recognizer-creation cost is the bottleneck, pool recognizers.

### Correctness / accuracy

- **[M] Partials flickering — Vosk emits intermediate hypotheses that change as more audio arrives.** Users see text "ghost" then change. Some flicker is fine; too much is distracting.
  - *Mitigation:* debounce partials at 200 ms and only emit when text actually changes; use Levenshtein-ratio threshold (0.85+) to suppress sub-word changes.

- **[L] `final_revised` arriving after LLM has already replied.** User sees their message change after they got an answer. Disorienting.
  - *Mitigation:* opt-in via `voice_refine_with_whisper`, off by default. If on, animate the revision quietly. Document in settings tooltip.

- **[L] Vosk and Whisper disagree on partial words — what's "the same utterance"?** Levenshtein on small strings is noisy.
  - *Mitigation:* treat refinement as advisory only; chat metadata records both transcripts.

### Browser compat

- **[L] Web Audio AudioWorklet works on Chromium ≥66, Firefox ≥76, Safari ≥14.1.** PHANTOM targets Chromium on Radxa primarily.
  - *Mitigation:* unchanged from current. No regression.

- **[L] Long-lived WebSocket survives HMR poorly in dev.** This is the H1 bug. Phase 13 doesn't fix it directly.
  - *Mitigation:* if H1 still bites in 13.4, surface as Phase 12.3 hotfix recommendation; or pivot to Candidate F (MediaRecorder chunked POST).

### Architectural

- **[H] H1 (WS 1006 close) likely persists.** The streaming-partials rewrite changes what's *on* the WS but not how the WS itself behaves under HMR/StrictMode.
  - *Mitigation:* be honest about scope — Phase 13 is an STT rewrite, not a transport rewrite. If H1 is the actual user pain → recommend Candidate F instead, which is also documented.

- **[M] TTS-mic feedback regression risk during the rewrite.** Ducking integrates with the orchestrator's `_ducked` flag in legacy and Phase-12 paths; new streaming path must respect it.
  - *Mitigation:* preserve the `if self._ducked: return` guard at the top of `process_frame` regardless of mode (currently `always_on.py:138`). Test in 13.1 acceptance.

- **[M] Settings hot-reload integration.** Phase 12.0 narrowed `_apply_runtime_side_effect` to model-invalidating keys only. Adding `voice_streaming_partials` and `voice_refine_with_whisper` requires care: the streaming flag is hot-reload-safe; the refine flag spawns a background task model that may need a graceful-shutdown when toggled off.
  - *Mitigation:* design refine as fire-and-forget tasks per-utterance; toggling off just makes the next utterance not spawn a refine task.

### User experience

- **[M] User retraining on partial display.** Users got used to "say something, wait, see message." Now they see "say something, see ghost text, see committed text."
  - *Mitigation:* set defaults that match user expectation; settings toggle `voice_streaming_partials` if the user dislikes the ghost UI; document in CHANGELOG and the in-app settings tooltip.

- **[L] `final_revised` UX is novel for a chat app.** Most users will never see it (refine off by default).
  - *Mitigation:* document in settings; subtle visual treatment if enabled.

### Time / scope

- **[H] User has 14-day marathon fatigue.** A 25-45 hour rewrite is a real ask.
  - *Mitigation:* this is the central reason Section 7 recommends Option D (defer Phase 13, do Phase 12.3 hotfix now).

- **[M] Estimate slippage on audio code.** Audio bugs are harder to debug than they look (timing, race conditions, codec edge cases).
  - *Mitigation:* aggressive feature flagging; ability to ship 13.1 alone (backend partials) without 13.2 (frontend) for behind-the-scenes log-only validation.

### "Could this rewrite hurt anything?"

- 933 backend + 222 frontend tests will catch regressions in the *known* behaviour.
- The legacy 11b FSM stays in the codebase as a fallback path. `voice_mode=legacy` (or rolling back the streaming flag) restores 12.2 behaviour.
- The Phase 12 hard-won fixes (Section 1.4) are preserved by design — none of them is in the changed code paths.
- Real-world risk: a regression that only surfaces with real microphones, real Ukrainian speech, and Radxa-specific timing. The fixtures don't cover that. **The mitigation is Phase 13.4 manual verification with the actual user.**

---

## Section 7 — Decision matrix

This is the page the user reads in 3-7 days when they pick up where they left off.

### 7.1 The four options

| Choice | When to pick | Time cost | Risk | What ships |
|---|---|---|---|---|
| **A — Phase 12.3 hotfix on H1 (WS lifecycle)** | If only the WS-reconnect-per-turn bothers you, and current latency is tolerable. | **1-3 hours** | **Low** | A small backend or frontend fix that makes the WS survive across utterances. |
| **B — Phase 13 full rewrite (Section 4 primary)** | If 3-5 s latency is intolerable AND you have 3-5 focused days available AND you accept H1 may still need a separate fix. | **25-45 hours** | **Medium-High** | Vosk streaming partials + optional Whisper background refine. Latency 200-500 ms. Same WS transport. |
| **C — Accept current state, close the cycle** | If real-world use of v0.12.2 with push-to-talk as primary is comfortable for daily driver. | **0** | None | Tag is final. Always-on is a "works but slow" feature. |
| **D — Hybrid: 12.3 hotfix now, Phase 13 deferred** | Pragmatic. Fix the immediate annoyance, give yourself a week off, decide later if latency is worth a rewrite. | **1-3 hours now, 25-45h someday** | **Low + deferred** | Same as A now; this plan stays in `docs/phase-13-plan/` for later. |

### 7.2 Recommendation

**Default recommendation: Option D.**

Reasons, in honest priority order:

1. **You finished a 14-day voice marathon.** You shipped Phase 12.0, 12.1, and 12.2 in the last few sessions. The marginal value of one more big push *right now* is low; the cost is high (decision fatigue, regression risk, opportunity cost vs the rest of the OS).

2. **Phase 12.2 already shipped the architectural fix that mattered most to YOU.** TTS feedback was the bug you noticed first. WS reconnect-per-turn is annoying but workaround-able (toggle voice mode). Latency is the slowest-burning of the three — it's tolerable for a daily driver if you accept push-to-talk as your primary input mode.

3. **The Phase 13 rewrite, while sound, is best done with fresh perspective.** An audio-pipeline rewrite is a 3-5 day commitment with debugging surface in places that are hard to test (real mic, real Ukrainian, real Radxa). You'll do better work on this in two weeks than tonight.

4. **The 12.3 hotfix is small and high-leverage.** A 1-3 hour fix to make the WS survive across utterances takes always-on from "almost works" to "works for a single conversation." If the hotfix turns out to be more complex, surface it before committing to the 25+ hour Phase 13.

5. **This document doesn't expire.** If you decide in three months that latency matters more than your weekend, the plan is still here, still references the same architecture, still produces the same recommendation. The Section 3 benchmarks may need a refresh (April 2026 → whatever-month-then) but the structural reasoning holds.

### 7.3 If you pick Option B (Phase 13 rewrite anyway)

Open a new Phase 13 prompt, point at this README, and start with **Phase 13.0 — Foundation & Benchmark.** Do not skip 13.0. Without Radxa benchmark numbers, you're guessing.

Acceptance gate before Phase 13.1: Vosk streaming partials measured at <300 ms on real Radxa hardware with a real-mic Ukrainian utterance.

### 7.4 If you pick Option A or D (12.3 hotfix)

Open a Phase 12.3 prompt with this exact scope:

- Reproduce the WS 1006-close-after-first-utterance reliably (manual test on real backend, real frontend).
- Diagnose: HMR `_wsInstance` survival? Backend close after `final`? Listener stale-closure?
- Fix the smallest thing that makes the WS survive across at least 5 turns.
- Add 1-3 backend tests + 1-3 frontend tests covering the regression.
- Tag `v0.12.3-ws-lifecycle-fix`.

Time: 1-3 hours.

### 7.5 If you pick Option C (accept and close)

This is also a fine choice. Close the always-on cycle, document v0.12.2 as the final state for now, and move on to the rest of PHANTOM OS (sensors, vision, Linux exec, wardriving, secret features). The tactical map and ContextEngine are bigger leverage for "AI with character" than another 200 ms of voice latency.

### 7.6 Final guidance

The user wrote: *"переписати з 0 кращу швидшу логіку олвейс он, але з урахуванням минулого."*

The "учитываючи минуле" part is doing real work in that sentence. The past says: each rewrite of always-on costs 5-15 hours and ships with one new bug surface. Phase 11b → 11b.1 → 11c.1 → 11c.2 → 11c.3 → 11c.4 → 11c.5 → 12.0 → 12.1 → 12.2. Nine attempts. Two of them shipped working (12.1, 12.2).

A tenth attempt should be **smaller**, **higher-leverage**, and **boring**. The 12.3 hotfix on H1 is exactly that. Phase 13 is correct as a plan but expensive as an action.

Pick D.

---

## Appendix — Inventory of out-of-scope items (binding)

These are explicitly NOT addressed in this plan and not addressed if any sub-option is picked:

- Multi-language STT (Ukrainian-only stays the assumption).
- Wake-word retraining or custom wake-word model.
- Hardware AEC (ReSpeaker DSP / external array mic).
- LLM-based addressee detection ("is this addressed to PHANTOM?").
- Visualization or UX changes outside the partial-text overlay.
- Any code edits in `src/`.

If the user later wants any of these, open a separate phase doc.

## Appendix — Sources

### Faster-Whisper / Whisper streaming
- [SYSTRAN/faster-whisper GitHub](https://github.com/SYSTRAN/faster-whisper)
- [SYSTRAN/faster-whisper Issue #526 — CPU slower than benchmark](https://github.com/SYSTRAN/faster-whisper/issues/526)
- [ufal/whisper_streaming — LocalAgreement-2 reference impl](https://github.com/ufal/whisper_streaming)
- [ScienceIO/whisper_streaming_web — FastAPI + WebSocket](https://github.com/ScienceIO/whisper_streaming_web)
- [Saytowords blog 2026 — real-time streaming with Whisper](https://www.saytowords.com/blogs/Real-Time-Streaming-with-Whisper/)
- [neurlcreators substack — building real-time with Faster Whisper](https://neurlcreators.substack.com/p/how-do-you-build-a-real-time-speech)
- [Baseten — fastest Whisper transcription with streaming and diarization](https://www.baseten.co/blog/the-fastest-whisper-transcription-with-streaming-and-diarization/)

### whisper.cpp
- [ggml-org/whisper.cpp GitHub](https://github.com/ggml-org/whisper.cpp)
- [whisper.cpp 1.8.3 — 12× perf boost (Phoronix Jan 2026)](https://www.phoronix.com/news/Whisper-cpp-1.8.3-12x-Perf)
- [Picovoice whisper.cpp streaming benchmark](https://picovoice.ai/docs/benchmark/stt-whisper-cpp-streaming-speech-to-text/)
- [OpenBenchmarking.org — whisper.cpp public results](https://openbenchmarking.org/test/pts/whisper-cpp)
- [Yahor Talkachou — Silero VAD + whisper.cpp Go server](https://medium.com/@etolkachev93/local-all-in-one-go-speech-to-text-solution-with-silero-vad-and-whisper-cpp-server-94a69fa51b04)
- [Dzianis Vashchuk — whisper.cpp benchmarking](https://medium.com/@dzianisv/new-to-ai-whisper-cpp-benchmarking-on-my-hardware-3fdf1c967516)

### Vosk / Kaldi
- [Vosk official site](https://alphacephei.com/vosk/)
- [alphacep/vosk-api GitHub](https://github.com/alphacep/vosk-api)
- [VideoSDK 2025 Vosk guide](https://www.videosdk.live/developer-hub/stt/vosk-speech-recognition)
- [arxiv 2503.21025 — Vosk custom-LM accuracy](https://arxiv.org/html/2503.21025v1)
- [Vibe Studio — streaming Vosk in Flutter](https://vibe-studio.ai/insights/streaming-audio-recognition-with-flutter-and-vosk)

### Parakeet TDT
- [nvidia/parakeet-tdt-0.6b-v3 Hugging Face](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3)
- [arxiv 2509.14128 — Canary-1B-v2 & Parakeet-TDT-0.6B-v3](https://arxiv.org/pdf/2509.14128)
- [achetronic/parakeet — CPU-only Whisper-API-compatible server](https://github.com/achetronic/parakeet)
- [groxaxo/parakeet-tdt-0.6b-v3-fastapi-openai](https://github.com/groxaxo/parakeet-tdt-0.6b-v3-fastapi-openai)
- [altunenes/parakeet-rs — Rust streaming bindings](https://github.com/altunenes/parakeet-rs)
- [istupakov/onnx-asr — generic ONNX ASR](https://github.com/istupakov/onnx-asr)
- [Northflank 2026 STT benchmarks](https://northflank.com/blog/best-open-source-speech-to-text-stt-model-in-2026-benchmarks)
- [modelslab — Parakeet.cpp vs Whisper 2026](https://modelslab.com/blog/audio-generation/parakeet-cpp-vs-whisper-self-hosted-asr-comparison-2026)

### Distil-Whisper
- [huggingface/distil-whisper](https://github.com/huggingface/distil-whisper)
- [distil-whisper/distil-large-v3.5 HF](https://huggingface.co/distil-whisper/distil-large-v3.5)
- [OpenVINO — optimizing Whisper and Distil-Whisper](https://blog.openvino.ai/blog-posts/optimizing-whisper-and-distil-whisper-for-speech-recognition-with-openvino-and-nncf)

### WebRTC / Real-time transport
- [GetStream — WebRTC for AI voice agents 2026](https://getstream.io/blog/webrtc-ai-voice-video/)
- [LiveKit AudioProcessingModule (Python)](https://docs.livekit.io/reference/python/v1/livekit/rtc/apm.html)
- [FastRTC](https://fastrtc.org/)
- [Pipecat](https://docs.pipecat.ai/)
- [Eleshine — WebRTC AEC/NS deep dive](https://www.eleshine-tech.com/webrtc-audio-processing-echo-cancellation-noise-suppression-b2b.html)
- [Softcery — real-time vs turn-based voice agent architecture](https://softcery.com/lab/ai-voice-agents-real-time-vs-turn-based-tts-stt-architecture)
- [Deepgram — voice agent adaptive echo cancellation](https://developers.deepgram.com/docs/voice-agent-echo-cancellation)
- [WebTransport baseline 2026](https://webrtc.ventures/2026/04/webtransport-is-now-baseline-what-it-means-for-real-time-media/)

### MediaRecorder / chunked HTTP
- [Addpipe — handling huge MediaRecorder chunks](https://blog.addpipe.com/dealing-with-huge-mediarecorder-slices/)
- [DEV.to — voice input with Whisper](https://dev.to/ryancwynar/adding-voice-input-to-web-forms-with-whisper-360j)
- [Medium — AI audio conversations using OpenAI Whisper](https://medium.com/@david.richards.tech/ai-audio-conversations-with-openai-whisper-3c730a9c7123)
- [MDN MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder)

### Hardware
- [ARM Cortex-A78 Wikipedia](https://en.wikipedia.org/wiki/ARM_Cortex-A78)

### Other ASR
- [Northflank — best open-source STT 2026](https://northflank.com/blog/best-open-source-speech-to-text-stt-model-in-2026-benchmarks)
- [Agentic Coding Weekly — 5 best open-source STT 2026](https://www.agenticcodingweekly.com/p/5-best-open-source-speech-to-text-tools-in-2026)
- [Whisper Notes — Parakeet V3 vs Whisper benchmark](https://whispernotes.app/blog/parakeet-v3-default-mac-model)

---

## Final-report shape (for whoever reads this)

```
Phase 13 plan — Final report
Sections completed: 7/7
Doc lines: ~900-1100 (this file)
Commit: <to be filled at commit time>
Recommended architecture: Vosk streaming partials + optional Whisper background refine, same WS transport.
Recommended decision (per Section 7): D — 12.3 hotfix now, Phase 13 deferred.
Time spent: ~2.5 hours of investigation + write.
Tests still green: yes (Gate 4 — 933 backend, 222 frontend; verified pre-commit).
What user does with this:
  - Read this fresh-headed in 3-7 days.
  - Pick A / B / C / D.
  - Open issue or new phase prompt based on choice.
  - Most realistic path: D. The plan is here when (if) you want it.
```
