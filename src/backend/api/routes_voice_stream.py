"""
Voice streaming WebSocket — Phase 11b always-on pipeline.

Endpoint: ``/ws/voice?token=<jwt>``

Contract
--------
Client → server (two kinds of messages):
  * **Binary** frames: raw mono s16le@16 kHz PCM. Arbitrary length
    (SileroVAD + WakeSpotter both buffer internally); typical payload
    is 20–30 ms from the browser AudioWorklet (640–960 bytes).
  * **Text** frames: one JSON object per message. Supported commands:
      {"cmd": "reset"}                       — orchestrator reset
      {"cmd": "mic_duck"}                    — frontend starts TTS
      {"cmd": "mic_unduck"}                  — frontend finished TTS
      {"cmd": "set_confidence", "value": x}  — live-tune wake threshold
      {"cmd": "stop"}                        — tear the session down

Server → client: always JSON, mirrors the orchestrator event contract
with two additions:
  {"type": "ready", "sample_rate": 16000, "frame_size_recommended": 960}
  — sent once immediately after the WS connection is accepted.
  {"type": "config", "confidence_min": float, "continuation_window_s": int}
  — sent after a successful ``set_confidence`` (echo).

Auth: requires a valid JWT (query string). Unauthenticated connects
are closed with policy code 4401 (application-defined, since the
standard 4401 range is reserved for future protocol use).

Always-on is opt-in — the WS will still accept the connection if
``config.voice_always_on_enabled`` is False so the UI can surface a
"disabled in settings" error, but the orchestrator will stay in IDLE
and drop every audio frame. Check the ``ready.enabled`` flag.
"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from config import config
from voice.always_on import AlwaysOnOrchestrator
from voice.pipeline import get_vosk_model
from voice.vad import SileroVAD
from voice.wake_spotter import WakeSpotter

logger = logging.getLogger(__name__)


# WebSocket close codes. 1008 is "policy violation" (standard).
WS_CODE_UNAUTHORIZED = 1008
WS_CODE_UNAVAILABLE = 1011
WS_CODE_NORMAL = 1000

SILERO_MODEL_PATH = (
    Path(__file__).resolve().parent.parent
    / "voice" / "models" / "silero-vad" / "silero_vad.onnx"
)

EXPECTED_FRAME_SIZE_BYTES = 960  # 30 ms @ 16 kHz s16le — advisory


def _safe_path() -> str:
    return str(SILERO_MODEL_PATH)


async def _accept_authenticated(
    ws: WebSocket, token: Optional[str]
) -> Optional[str]:
    """Accept the WS iff token is present and verifies. Returns the
    authenticated user_id or None on rejection (caller should already
    have closed the socket)."""
    if not token:
        await ws.close(code=WS_CODE_UNAUTHORIZED, reason="token required")
        return None
    try:
        from security.jwt_manager import verify_token

        payload = verify_token(token)
    except Exception as exc:
        logger.info("voice WS rejected: token invalid: %s", exc)
        await ws.close(code=WS_CODE_UNAUTHORIZED, reason="token invalid")
        return None
    await ws.accept()
    return payload.user_id


def _build_orchestrator() -> AlwaysOnOrchestrator:
    """Construct a per-connection orchestrator. Raises RuntimeError when
    a required resource (Silero ONNX, Vosk model) is missing so the WS
    handler can close the connection with a helpful reason.

    Phase 12.0 — picks the orchestrator mode from ``config.voice_mode``
    (off / continuous / wake_word). The legacy 11b FSM only runs when
    voice_mode is one of the legacy values (currently never set in
    production); when voice_mode is "off" we still build the orchestrator
    so the WS can advertise readiness, but every frame is a no-op.
    """
    if not SILERO_MODEL_PATH.is_file():
        raise RuntimeError(
            f"Silero VAD ONNX not found at {SILERO_MODEL_PATH} "
            "(expected from phase-11b task 0)"
        )
    vosk_model = get_vosk_model()  # may raise RuntimeError
    # Phase 12.0 — wire voice_silence_timeout_ms into the VAD so SPEECH_END
    # fires after the operator-configured pause length. The 11b default
    # (voice_vad_silence_ms = 500) only kicks in for the legacy FSM.
    mode = config.voice_mode
    if mode in ("continuous", "wake_word"):
        silence_ms = config.voice_silence_timeout_ms
    else:
        silence_ms = config.voice_vad_silence_ms
    vad = SileroVAD(
        _safe_path(),
        sample_rate=16_000,
        silence_ms=silence_ms,
    )
    spotter = WakeSpotter(
        vosk_model,
        wake_words=config.voice_wake_words,
        confidence_min=config.voice_wake_confidence_min,
        sample_rate=16_000,
    )
    return AlwaysOnOrchestrator(
        vad=vad,
        wake_spotter=spotter,
        vosk_model=vosk_model,
        sample_rate=16_000,
        continuation_window_s=config.voice_continuation_window_s,
        mode=mode if mode in ("off", "continuous", "wake_word") else "legacy",
        wake_phrase=config.voice_wake_phrase,
        silence_timeout_ms=config.voice_silence_timeout_ms,
        # Phase 13a.3 — backend energy fast-path; skipped frames don't even
        # touch Silero VAD so idle-state CPU drops noticeably.
        energy_skip_threshold=config.voice_energy_skip_threshold,
        # Phase 13b — Vosk streaming partials + optional Whisper refine.
        streaming_partials=config.voice_streaming_partials,
        partial_debounce_ms=config.voice_partial_debounce_ms,
        refine_with_whisper=config.voice_refine_with_whisper,
        refine_diff_threshold=config.voice_refine_diff_threshold,
    )


class _VoiceSession:
    """Bundles the WS, orchestrator, and outgoing-queue for one client."""

    def __init__(self, ws: WebSocket, user_id: str, client_id: str) -> None:
        self.ws = ws
        self.user_id = user_id
        self.client_id = client_id
        self.orchestrator: Optional[AlwaysOnOrchestrator] = None
        self.closed = False

    async def send(self, payload: dict) -> None:
        if self.closed:
            return
        # Audit-2026-04-29 — wire OLED eye state to voice events.
        # pulse_surprised() and set_voice() existed in oled_animator but
        # were never called from any code path. Now the eyes react to
        # voice activity (surprise on wake detection, "thinking" during
        # listening, idle when speech processing ends).
        try:
            from vision.oled_animator import oled_animator
            event_type = payload.get("type")
            if event_type == "wake":
                oled_animator.pulse_surprised(duration_s=0.6)
            elif event_type == "speech_start":
                oled_animator.set_voice(listening=True)
            elif event_type in ("final", "rejected", "cooldown_end", "speech_end"):
                oled_animator.set_voice(listening=False)
        except Exception:
            pass  # OLED dep missing on cloud / dev deploys is acceptable
        try:
            await self.ws.send_text(json.dumps(payload, ensure_ascii=False))
        except Exception as exc:
            logger.debug("voice WS send failed (%s): %s", self.client_id, exc)
            self.closed = True

    async def attach_orchestrator(self, orch: AlwaysOnOrchestrator) -> None:
        self.orchestrator = orch
        # Bind the event callback so orchestrator events fan out to WS.
        orch._emit = self.send  # type: ignore[assignment]

    async def handle_command(self, text: str) -> None:
        try:
            msg = json.loads(text)
        except json.JSONDecodeError:
            await self.send({"type": "error", "message": "invalid json"})
            return
        cmd = (msg.get("cmd") or "").strip().lower()
        if not cmd:
            await self.send({"type": "error", "message": "missing cmd"})
            return
        orch = self.orchestrator
        if orch is None:
            await self.send({"type": "error", "message": "orchestrator unavailable"})
            return

        if cmd == "reset":
            await orch.reset()
            await self.send({"type": "reset_ack"})
        elif cmd == "mic_duck":
            if config.voice_mic_duck_on_tts:
                await orch.mic_duck()
            await self.send({"type": "mic_duck_ack", "ducked": orch.is_ducked})
        elif cmd == "mic_unduck":
            await orch.mic_unduck()
            await self.send({"type": "mic_duck_ack", "ducked": orch.is_ducked})
        elif cmd == "set_confidence":
            value = msg.get("value")
            try:
                fvalue = float(value)
            except (TypeError, ValueError):
                await self.send({"type": "error", "message": "value must be float"})
                return
            if not (0.0 <= fvalue <= 1.0):
                await self.send(
                    {"type": "error", "message": "value out of [0.0, 1.0]"}
                )
                return
            # WakeSpotter doesn't expose a setter — rebuild with new value.
            new_spotter = WakeSpotter(
                orch._wake._model,  # type: ignore[attr-defined]
                wake_words=",".join(orch._wake.wake_tokens),
                confidence_min=fvalue,
                sample_rate=16_000,
            )
            orch._wake = new_spotter  # type: ignore[assignment]
            await self.send(
                {
                    "type": "config",
                    "confidence_min": fvalue,
                    "continuation_window_s": config.voice_continuation_window_s,
                }
            )
        elif cmd == "stop":
            await self.send({"type": "stopped"})
            await self.ws.close(code=WS_CODE_NORMAL, reason="client stop")
            self.closed = True
        elif cmd == "client_speech_start":
            # Phase 13a.2 — frontend MicVAD reports speech onset. We log
            # for diagnostics; the backend Silero VAD remains authoritative
            # so we do not change orchestrator state. Hook can later be
            # extended to short-circuit silence_windows on this signal.
            logger.debug(
                "voice WS %s: client_speech_start hint", self.client_id
            )
            await self.send({"type": "client_speech_ack", "phase": "start"})
        elif cmd == "client_speech_end":
            logger.debug(
                "voice WS %s: client_speech_end hint", self.client_id
            )
            await self.send({"type": "client_speech_ack", "phase": "end"})
        else:
            await self.send({"type": "error", "message": f"unknown cmd: {cmd}"})

    async def handle_binary(self, data: bytes) -> None:
        orch = self.orchestrator
        if orch is None:
            return
        try:
            await orch.process_frame(data)
        except Exception as exc:
            logger.exception("voice WS frame processing failed: %s", exc)
            await self.send({"type": "error", "message": f"frame: {exc}"})


async def voice_ws_handler(ws: WebSocket, token: Optional[str] = None) -> None:
    """Entry point registered in main.py's ``_register_ws``."""
    user_id = await _accept_authenticated(ws, token)
    if user_id is None:
        return

    client_id = str(uuid.uuid4())
    session = _VoiceSession(ws, user_id, client_id)
    logger.info(
        "voice WS connected: client=%s user=%s voice_mode=%s",
        client_id, user_id, config.voice_mode,
    )

    try:
        # Phase 11c.4 — _build_orchestrator() loads SileroVAD ONNX
        # (ort.InferenceSession is synchronous, ~1-3s per connection on
        # Radxa ARM64) and may load the 300MB Vosk model on first call.
        # Off-load both to keep the event loop responsive during connect.
        orch = await asyncio.to_thread(_build_orchestrator)
    except RuntimeError as exc:
        logger.warning("voice WS unavailable: %s", exc)
        await session.send(
            {"type": "error", "message": f"always-on unavailable: {exc}"}
        )
        await ws.close(code=WS_CODE_UNAVAILABLE, reason="orchestrator init")
        return

    await session.attach_orchestrator(orch)
    # Phase 12.0 — ``enabled`` reflects voice_mode != "off". The frontend
    # uses voice_mode directly now but we keep the boolean for older clients.
    mode = config.voice_mode
    enabled = mode in ("continuous", "wake_word")
    await session.send(
        {
            "type": "ready",
            "sample_rate": 16_000,
            "frame_size_recommended": EXPECTED_FRAME_SIZE_BYTES,
            "enabled": enabled,
            "mode": mode,
            "wake_phrase": config.voice_wake_phrase,
            "silence_timeout_ms": config.voice_silence_timeout_ms,
            "wake_words": config.voice_wake_words,
            "confidence_min": config.voice_wake_confidence_min,
            "continuation_window_s": config.voice_continuation_window_s,
            # Phase 13b — frontend can adapt UI (ghost bubble, etc.)
            # to whether streaming is active and whether Whisper-refine
            # may emit late-arriving final_revised events.
            "streaming_partials": config.voice_streaming_partials,
            "partial_debounce_ms": config.voice_partial_debounce_ms,
            "refine_with_whisper": config.voice_refine_with_whisper,
        }
    )

    try:
        while True:
            message = await ws.receive()
            if message["type"] == "websocket.disconnect":
                break
            # Either 'bytes' (binary frame) or 'text' (JSON command).
            if "bytes" in message and message["bytes"] is not None:
                # Phase 12.0 — frame gate is voice_mode != "off". The
                # orchestrator itself also short-circuits on MODE_OFF so the
                # check is belt-and-suspenders.
                if config.voice_mode != "off":
                    await session.handle_binary(message["bytes"])
            elif "text" in message and message["text"] is not None:
                await session.handle_command(message["text"])
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.error("voice WS loop failed: %s", exc)
    finally:
        session.closed = True
        logger.info("voice WS closed: client=%s", client_id)


def register_voice_ws(app: FastAPI) -> None:
    """Wire the /ws/voice endpoint into the FastAPI app. Idempotent —
    registers only once even if called twice during app factory
    composition."""
    # FastAPI doesn't expose an "is route registered" check for WS; we
    # rely on the module-level guard.
    if getattr(app, "_voice_ws_registered", False):
        return

    @app.websocket("/ws/voice")
    async def _voice_ws(ws: WebSocket, token: Optional[str] = None) -> None:
        await voice_ws_handler(ws, token)

    app._voice_ws_registered = True  # type: ignore[attr-defined]
