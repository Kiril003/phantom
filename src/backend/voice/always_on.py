"""
Always-on voice orchestrator — Phase 11b.

Wires ``SileroVAD`` + ``WakeSpotter`` + a free-grammar Vosk transcription
pass into the state machine decided during Phase 11a:

    IDLE
      ├─ VAD speech_start        ─▶ SPEECH_DETECTED
      │                              ├─ wake matched, VAD end ─▶ COOLDOWN (10 s)
      │                              └─ no wake match          ─▶ IDLE
      ├─ mic_duck                 ─▶ IDLE (silent drop)
      │
    COOLDOWN
      ├─ speech within window     ─▶ CAPTURING_CONTINUATION
      │                              └─ VAD end                ─▶ COOLDOWN (reset)
      └─ timer fires              ─▶ IDLE

VAD is the master clock. The wake spotter runs alongside but never
produces a final verdict of its own — the orchestrator calls
``wake_spotter.finalise()`` when VAD signals ``speech_end``. That
avoids fighting between two independent silence detectors.

Captured PCM is accumulated into a single utterance buffer during
``SPEECH_DETECTED`` and ``CAPTURING_CONTINUATION``; on wake match (or
on any continuation utterance) the buffer is fed to a fresh free-grammar
Vosk ``KaldiRecognizer`` for the actual transcript that flows to chat.

Emitted event types (via ``event_callback``)::

    {"type": "speech_start"}
    {"type": "speech_end"}
    {"type": "wake", "transcript": str, "confidence": float}
    {"type": "final", "transcript": str, "source": "wake"|"continuation",
                       "confidence": float}
    {"type": "cooldown_start", "window_s": int}
    {"type": "cooldown_end"}
    {"type": "error", "message": str}

No ``partial`` events are emitted in 11b — the MVP returns the full
transcript once VAD reports ``speech_end``. Streaming partials are an
11c enhancement.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Awaitable, Callable, Optional

from voice.vad import SPEECH_END, SPEECH_START, SileroVAD
from voice.wake_spotter import WakeResult, WakeSpotter

logger = logging.getLogger(__name__)


# State constants — exposed for tests / UI
STATE_IDLE = "idle"
STATE_SPEECH_DETECTED = "speech_detected"
STATE_COOLDOWN = "cooldown"
STATE_CAPTURING_CONTINUATION = "capturing_continuation"

EventCallback = Callable[[dict], Awaitable[None]]


class AlwaysOnOrchestrator:
    """Owns the always-on audio pipeline for one WebSocket connection.

    Not thread-safe. ``process_frame`` must be awaited from a single task.
    """

    def __init__(
        self,
        *,
        vad: SileroVAD,
        wake_spotter: WakeSpotter,
        vosk_model,
        sample_rate: int = 16_000,
        continuation_window_s: int = 10,
        event_callback: Optional[EventCallback] = None,
    ) -> None:
        self._vad = vad
        self._wake = wake_spotter
        self._vosk_model = vosk_model
        self._sample_rate = int(sample_rate)
        self._continuation_window_s = int(continuation_window_s)
        self._emit = event_callback

        self._state: str = STATE_IDLE
        self._ducked: bool = False
        self._utterance_pcm: bytearray = bytearray()
        self._cooldown_task: Optional[asyncio.Task] = None

    # ───────────────────── public contract ─────────────────────

    @property
    def state(self) -> str:
        return self._state

    @property
    def is_ducked(self) -> bool:
        return self._ducked

    async def process_frame(self, pcm_bytes: bytes) -> None:
        """Drive the state machine with one PCM frame. Frames are
        arbitrary byte lengths (VAD and WakeSpotter both buffer
        internally). Dropped wholesale when ``is_ducked``."""
        if self._ducked:
            return
        if not pcm_bytes:
            return

        try:
            vad_events = self._vad.process(pcm_bytes)
        except ValueError as exc:
            logger.warning("orchestrator: VAD rejected frame: %s", exc)
            await self._emit_error(f"vad: {exc}")
            return

        if self._state == STATE_IDLE:
            for ev in vad_events:
                if ev == SPEECH_START:
                    await self._enter_speech_detected()

        elif self._state == STATE_SPEECH_DETECTED:
            # Keep the wake spotter informed; ignore its return value —
            # VAD owns the final decision.
            try:
                self._wake.process(pcm_bytes)
            except ValueError as exc:
                logger.warning("orchestrator: wake spotter rejected frame: %s", exc)
            self._utterance_pcm.extend(pcm_bytes)
            for ev in vad_events:
                if ev == SPEECH_END:
                    await self._handle_utterance_end()
                    break

        elif self._state == STATE_COOLDOWN:
            for ev in vad_events:
                if ev == SPEECH_START:
                    await self._enter_continuation()
                    break

        elif self._state == STATE_CAPTURING_CONTINUATION:
            self._utterance_pcm.extend(pcm_bytes)
            for ev in vad_events:
                if ev == SPEECH_END:
                    await self._handle_continuation_end()
                    break

    async def mic_duck(self) -> None:
        """Drop all further frames until ``mic_unduck``. Cancels any
        pending cooldown. Called when TTS playback begins so the TTS
        audio bleeding into the mic can't trigger a self-wake."""
        if self._ducked:
            return
        self._ducked = True
        self._reset_internal()

    async def mic_unduck(self) -> None:
        """Resume processing frames from a clean state."""
        self._ducked = False

    async def reset(self) -> None:
        """Operator / WS ``reset`` command — back to IDLE, drop any
        in-flight utterance, cancel cooldown. Does *not* toggle
        ducking."""
        was_ducked = self._ducked
        self._reset_internal()
        self._ducked = was_ducked

    # ───────────────────── state transitions ─────────────────────

    async def _enter_speech_detected(self) -> None:
        self._state = STATE_SPEECH_DETECTED
        self._wake.reset()
        self._utterance_pcm = bytearray()
        await self._send({"type": "speech_start"})

    async def _handle_utterance_end(self) -> None:
        await self._send({"type": "speech_end"})
        wake_result = self._wake.finalise()

        if wake_result is None or not wake_result.matched:
            # No wake word — return to IDLE, discard buffer.
            self._utterance_pcm = bytearray()
            self._state = STATE_IDLE
            return

        await self._send(
            {
                "type": "wake",
                "transcript": wake_result.transcript,
                "confidence": wake_result.confidence,
            }
        )

        transcript, confidence = await self._transcribe_full(bytes(self._utterance_pcm))
        self._utterance_pcm = bytearray()

        await self._send(
            {
                "type": "final",
                "transcript": transcript,
                "source": "wake",
                "confidence": confidence,
            }
        )
        await self._enter_cooldown()

    async def _enter_continuation(self) -> None:
        self._cancel_cooldown_task()
        self._state = STATE_CAPTURING_CONTINUATION
        self._utterance_pcm = bytearray()
        await self._send({"type": "speech_start"})

    async def _handle_continuation_end(self) -> None:
        await self._send({"type": "speech_end"})
        transcript, confidence = await self._transcribe_full(bytes(self._utterance_pcm))
        self._utterance_pcm = bytearray()
        await self._send(
            {
                "type": "final",
                "transcript": transcript,
                "source": "continuation",
                "confidence": confidence,
            }
        )
        await self._enter_cooldown()

    async def _enter_cooldown(self) -> None:
        self._cancel_cooldown_task()
        self._state = STATE_COOLDOWN
        await self._send(
            {"type": "cooldown_start", "window_s": self._continuation_window_s}
        )
        loop = asyncio.get_event_loop()
        self._cooldown_task = loop.create_task(self._cooldown_timer())

    async def _cooldown_timer(self) -> None:
        try:
            await asyncio.sleep(self._continuation_window_s)
        except asyncio.CancelledError:
            return
        if self._state == STATE_COOLDOWN:
            self._state = STATE_IDLE
            await self._send({"type": "cooldown_end"})

    # ───────────────────── helpers ─────────────────────

    async def _transcribe_full(self, pcm_bytes: bytes) -> tuple[str, float]:
        """Run a fresh free-grammar KaldiRecognizer over the full
        utterance PCM. Runs in an executor because Vosk is blocking
        C++."""
        if not pcm_bytes:
            return "", 0.0
        return await asyncio.to_thread(self._transcribe_full_sync, pcm_bytes)

    def _transcribe_full_sync(self, pcm_bytes: bytes) -> tuple[str, float]:
        import vosk

        rec = vosk.KaldiRecognizer(self._vosk_model, self._sample_rate)
        rec.SetWords(True)
        # Vosk chunking keeps memory bounded for long captures.
        chunk = self._sample_rate * 2  # 1 s of s16le
        for i in range(0, len(pcm_bytes), chunk):
            rec.AcceptWaveform(pcm_bytes[i : i + chunk])
        try:
            payload = json.loads(rec.FinalResult() or "{}")
        except json.JSONDecodeError:
            return "", 0.0
        text = (payload.get("text") or "").strip()
        words = payload.get("result") or []
        if not words:
            return text, 1.0 if text else 0.0
        conf = sum(w.get("conf", 0.0) for w in words) / len(words)
        return text, float(conf)

    def _cancel_cooldown_task(self) -> None:
        if self._cooldown_task is not None and not self._cooldown_task.done():
            self._cooldown_task.cancel()
        self._cooldown_task = None

    def _reset_internal(self) -> None:
        self._state = STATE_IDLE
        self._utterance_pcm = bytearray()
        self._vad.reset()
        self._wake.reset()
        self._cancel_cooldown_task()

    async def _send(self, event: dict) -> None:
        if self._emit is None:
            return
        try:
            await self._emit(event)
        except Exception as exc:  # noqa: BLE001 — callback is user-supplied
            logger.exception(
                "always_on orchestrator: emit callback failed: %s", exc
            )

    async def _emit_error(self, message: str) -> None:
        await self._send({"type": "error", "message": message})
