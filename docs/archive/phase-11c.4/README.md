# Phase 11c.4 — Backend async fix for voice WS pipeline

## Bug fixed

Once `/ws/voice` accepted a client and the always-on orchestrator started
to build, the entire backend froze: every other HTTP endpoint
(`/health`, `/api/v1/settings/*`, chat) stopped responding. Reproduced
twice during Phase 11c.3, and reliably reproduced at the start of this
phase. The frontend "click Always-On" path was unusable.

## Root cause

**Self-deadlock on a non-reentrant `threading.Lock` in `voice/pipeline.py`.**

`voice/pipeline.py` declared `_lock = threading.Lock()` and used it as a
double-checked-locking guard around three lazy singletons: `_stt`,
`_tts`, `_vosk_model`. The always-on path calls `get_vosk_model()`,
which acquires `_lock`, and inside that critical section calls
`get_stt_provider()`, which **acquires the same `_lock` again on the
same thread**. With a non-reentrant `Lock`, the second `acquire` blocks
indefinitely — the worker building the orchestrator never returns, and
since this all happened on the asyncio event loop thread (before this
phase, `_build_orchestrator()` was a sync call inside the WS handler),
the entire FastAPI process froze.

Three secondary issues compounded the freeze before the deadlock was
even reached:

1. `voice/always_on.AlwaysOnOrchestrator.process_frame()` called Silero
   VAD ONNX inference (`vad.process`) and Vosk wake recogniser
   (`wake_spotter.process`) **synchronously on the event loop** for
   every audio frame (~33-50/sec). Even without the deadlock, those
   blocking C++ calls (5-15ms VAD + 10-30ms Vosk per frame) starved
   `/health` and every other coroutine.

2. `routes_voice_stream.voice_ws_handler()` called `_build_orchestrator()`
   synchronously after `ws.accept()`. That builds Silero ONNX + Vosk
   model in-thread, taking 1-30s, blocking the event loop the whole
   time.

3. `routes_settings._apply_runtime_side_effect()` ran synchronously on
   the event loop. For `voice_*` keys it calls
   `voice.pipeline.reset_providers()` which acquires the same `_lock`.
   When a worker thread held `_lock` for a slow Vosk load (or, after
   the RLock fix, for a legitimate long load), the synchronous
   `with _lock` on the event loop blocked every other coroutine.

## Fixes

| # | File | Change | Commit |
|---|------|--------|--------|
| 1 | `voice/always_on.py` | Wrap `vad.process`, `wake_spotter.process`, `wake_spotter.reset`, `wake_spotter.finalise` in `asyncio.to_thread` | `038b923` |
| 2 | `api/routes_voice_stream.py` | Wrap `_build_orchestrator()` call in `asyncio.to_thread` | `48406d8` |
| 3 | `api/routes_settings.py` | Wrap `_apply_runtime_side_effect()` call in `asyncio.to_thread` | `48406d8` |
| 4 | `voice/pipeline.py` | Switch `_lock` from `threading.Lock` to `threading.RLock` to fix self-deadlock | `dfae1c3` |

`_transcribe_full` (Whisper-equivalent post-wake transcription) was
already wrapped in `asyncio.to_thread` from Phase 11b — confirmed
during diagnosis (Task 0). No logger storm in the hot path — Task 4
skipped.

## Verification

### Live frame-flow test (Task 5 — the ship gate)

Procedure: backend running, login via PIN, PUT
`voice_always_on_enabled=True`, open `/ws/voice`, wait for `ready`,
send 100 silent PCM frames at 30ms cadence. Concurrently poll
`/health` every 200ms throughout the entire WS lifecycle.

```
[ws] connecting...
[ws] connected after 65ms
[poll 00] /health 200    6.1ms OK
... (39 more polls during build) ...
[poll 40] /health 200   70.8ms OK
[ws] ready msg after 8462ms total
[poll 41-55] /health 200 (sub-13ms each, during frame flow)
[ws] sent 100 frames
[poll 56-57] /health 200 (sub-10ms)
[ws] closed
[settings] always_on=False (restored)

=== /health summary (n=58) min=2.4ms max=70.8ms mean=8.2ms
over 500ms gate: 0
PASS
```

- WS handshake: 65ms
- Cold-start orchestrator build (Silero ONNX + 1.4GB Vosk Ukrainian
  model): 8.5s in worker thread, **event loop never blocked**
- 100 silent frames flowed through the always-on pipeline
- 58 concurrent `/health` polls during build + frame flow:
  **min=2.4ms, max=70.8ms, mean=8.2ms** — gate is `<500ms`
- 0 polls over the 500ms gate → **PASS**

Before Phase 11c.4: `/health` timed out at 5s as soon as
`/ws/voice` accepted a client; `PUT /settings` timed out at 10s any
time the always-on lock was held; the worker thread sat in a futex
forever (verified via `/proc/$pid/task/*/wchan` showing 58 threads in
`futex_do_wait`).

### Existing tests

- Backend: **883 / 883** pass (was 883)
- Frontend unit: **211 / 211** pass (no frontend code modified)
- E2E: **8 / 8** pass (`8 passed (48.9s)`)
- `npm run build`: `✓ built in 46.27s`
- `scripts/check-dist-fresh.sh`: `OK: dist/ is fresh.`
- `scripts/check-hook-consumers.sh`: `OK: every hook has a production consumer.`

## What user should now see

1. Toggle Always-On in toolbar → button lights up, mic permission
   prompt fires
2. Backend `PUT /settings/voice_always_on_enabled` returns within
   normal latency (no longer hangs)
3. WS `/ws/voice` opens; first time after restart takes ~8.5s for the
   `ready` event because the 1.4GB Vosk model + Silero ONNX have to
   load. Subsequent connects (model cached in process) return ready
   in <100ms.
4. Backend continues responding to `/health`, `/api/v1/settings/*`,
   `/api/v1/chat`, etc., the entire time. No more whole-process
   freeze.
5. Saying "фантом" → wake event fires; following utterance is
   transcribed via Vosk and pushed through the chat router as before.

## Known limitations / out of scope

- **First-connection latency**: ~8.5s on a fresh server. The 1.4GB
  `vosk-model-uk-v3` simply takes that long to load on Radxa ARM64.
  Model loading itself is not in Phase 11c.4 scope; the fix here is
  about not blocking the event loop during the load. A follow-up
  could pre-load the model at app startup so the first WS connect
  returns immediately.
- TTS is still synchronous from the event loop's perspective (lower
  frequency, less critical). Out of scope.
- Multi-language STT, addressee classifier — Phase 11c.5+.

## Files changed

```
src/backend/voice/pipeline.py            | +7 -1
src/backend/voice/always_on.py           | +12 -4
src/backend/api/routes_voice_stream.py   | +6 -1
src/backend/api/routes_settings.py       | +9 -1
docs/phase-11c.4/diagnosis.md            | new
docs/phase-11c.4/README.md               | new
```

No frontend changes. No new dependencies. No model swap. No
architectural rewrite.

## Tag

`v0.11c.4-async-voice`
