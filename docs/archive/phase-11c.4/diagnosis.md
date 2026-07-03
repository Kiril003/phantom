# Phase 11c.4 — Diagnosis

## Frame handler call graph

```
routes_voice_stream.py: voice_ws_handler()
  └─ ws.receive() loop
      ├─ binary frame
      │   └─ session.handle_binary(data)
      │       └─ orchestrator.process_frame(pcm_bytes)              [async]
      │           ├─ vad.process(pcm_bytes)                         CPU-BLOCKING (ORT inference, ~5-15ms/call, called every frame)
      │           ├─ wake_spotter.process(pcm_bytes)                CPU-BLOCKING (Vosk AcceptWaveform, ~10-30ms/call, called every frame in SPEECH_DETECTED)
      │           ├─ wake_spotter.finalise()                        CPU-BLOCKING (Vosk FinalResult, ~20-50ms, once per utterance)
      │           ├─ wake_spotter.reset()/_build_recognizer()       CPU-BLOCKING (allocate new KaldiRecognizer, ~5-20ms, on each utterance start/end)
      │           └─ _transcribe_full(buffer)                       ALREADY async via asyncio.to_thread (always_on.py:256)  ✓
      └─ text frame
          └─ session.handle_command(text)                           async, no blocking calls
```

## Confirmed CPU-BLOCKING calls (run on event loop)

| File | Line | Call | Frequency | Latency |
|------|------|------|-----------|---------|
| voice/always_on.py | 113 | `self._vad.process(pcm_bytes)` | every frame (~33-50/sec) | 5-15ms (Silero ORT inference) |
| voice/always_on.py | 128 | `self._wake.process(pcm_bytes)` | every frame in SPEECH_DETECTED | 10-30ms (Vosk AcceptWaveform) |
| voice/always_on.py | 175 | `self._wake.reset()` | once per speech_start | 5-20ms (KaldiRecognizer init) |
| voice/always_on.py | 181 | `self._wake.finalise()` | once per speech_end | 20-50ms (Vosk FinalResult + new recognizer) |
| voice/always_on.py | 286-287 | `self._vad.reset()` / `self._wake.reset()` | reset/duck | 5-20ms |

## Confirmed safe calls (already async)

- `voice/always_on.py:256` — `_transcribe_full` wraps Vosk full-grammar transcription in `asyncio.to_thread(self._transcribe_full_sync, ...)` ✓
- `routes_voice_stream.py:137` — `ws.send_text(...)` is async ✓
- All `_send` / `_emit` callback paths are async ✓

## Logger usage in hot path

No per-frame logging found. Only `logger.warning` on rejected frames (`ValueError` exception path, rare) and `logger.info` on connect/disconnect (once per session). **Task 4 (logger rate-limiting) NOT NEEDED — skipping.**

## Root cause

At the typical 30ms frame cadence (~33 frames/sec), each frame currently spends 5-15ms in Silero ORT inference + 10-30ms in Vosk wake recogniser, both running synchronously on the asyncio event loop. That's 15-45ms of blocking work per 30ms slot. The event loop is starved: HTTP request handlers (including `/health`) wait behind the audio processing, queue grows unbounded, requests time out.

The orchestrator was correctly wrapping the once-per-utterance Whisper-equivalent transcription via `asyncio.to_thread`, but missed the once-per-frame VAD and wake spotter calls — those are the hot path.

## Recommended fix scope

Three surgical changes in `voice/always_on.py`:

1. Wrap `self._vad.process(pcm_bytes)` in `await asyncio.to_thread(...)` (line 113).
2. Wrap `self._wake.process(pcm_bytes)` in `await asyncio.to_thread(...)` (line 128).
3. Wrap `self._wake.finalise()` and `self._wake.reset()` calls in `await asyncio.to_thread(...)` (lines 175, 181, 286-287 where appropriate).

The `_vad`/`_wake` instances are not thread-safe (one instance per WS connection, single task per connection — guaranteed by orchestrator contract), so running their synchronous methods in a thread pool is safe: only one thread at a time per connection because the orchestrator awaits each call sequentially.

No call signature changes — `to_thread` returns the same value the wrapped function returns. No behavioural change. Just a thread-pool hop per call.

## What is NOT changed

- Vosk model loading (one-time at startup)
- Silero ONNX session creation (per-connection, in `__init__`)
- KaldiRecognizer rebuild paths (still synchronous within the thread call)
- Whisper STT (already async)
- TTS pipeline (out of scope)
- Wake-word detection logic (out of scope)
