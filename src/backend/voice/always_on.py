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

# Phase 12.0 — voice_mode values.
MODE_LEGACY = "legacy"          # 11b wake-word + continuation FSM
MODE_OFF = "off"                # no-op on every frame
MODE_CONTINUOUS = "continuous"  # VAD-driven STT, no wake gate
MODE_WAKE_WORD = "wake_word"    # VAD-driven STT then substring match

# Phrases that are valid Phase 12 modes (vs. the legacy default).
PHASE12_MODES = {MODE_OFF, MODE_CONTINUOUS, MODE_WAKE_WORD}

EventCallback = Callable[[dict], Awaitable[None]]
TranscribeFn = Callable[[bytes], Awaitable[tuple[str, float]]]


def _string_similarity(a: str, b: str) -> float:
    """SequenceMatcher ratio in [0, 1]. 1 = identical. Used by Phase 13b
    background Whisper refine to decide if the Whisper transcript differs
    from Vosk's enough to publish a `final_revised` event. stdlib only —
    no Levenshtein dependency for one comparison per utterance."""
    if not a and not b:
        return 1.0
    if not a or not b:
        return 0.0
    import difflib
    return float(
        difflib.SequenceMatcher(None, a.strip().lower(), b.strip().lower()).ratio()
    )


def _peak_energy_normalised(pcm_bytes: bytes) -> float:
    """Cheap peak-amplitude check on raw s16le PCM. 1.0 = full-scale.

    Phase 13a.3 — used by the orchestrator's idle fast-path to skip the
    Silero VAD ONNX inference (~5-15 ms per frame on Radxa A78) when the
    incoming PCM is clearly silent. Peak (max abs) is cheaper than RMS
    and a single non-zero sample lets Silero make its own better decision.

    Audit-2026-04-28 F-62: previously this allocated a numpy array per
    frame (33 Hz/connection during continuous voice). `audioop.max` is
    a single stdlib C call with no allocation. audioop is deprecated in
    Python 3.13 and removed in 3.14, so we keep a numpy fallback for
    forward compatibility.
    """
    if not pcm_bytes:
        return 0.0
    try:
        import audioop  # type: ignore[import-not-found]
        return audioop.max(pcm_bytes, 2) / 32768.0
    except Exception:  # noqa: BLE001 — fall back to numpy on Python ≥ 3.14
        try:
            import numpy as np
            arr = np.frombuffer(pcm_bytes, dtype=np.int16)
            if arr.size == 0:
                return 0.0
            return float(np.abs(arr).max()) / 32768.0
        except Exception:  # noqa: BLE001 — last-resort: assume not silent
            return 1.0


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
        # Phase 12.0 — VAD-driven mode + optional wake phrase. The default
        # MODE_LEGACY keeps every 11b orchestrator test passing without
        # changes; routes_voice_stream.py picks a Phase-12 mode from
        # ``config.voice_mode`` at WS connect time.
        mode: str = MODE_LEGACY,
        wake_phrase: str = "",
        silence_timeout_ms: int = 1500,
        transcribe_fn: Optional[TranscribeFn] = None,
        # Phase 13a.3 — peak-amplitude threshold below which idle frames
        # are dropped without invoking Silero VAD. 0.0 disables the fast-path.
        energy_skip_threshold: float = 0.0,
        # ── Phase 13b — streaming partial transcripts ──────────────────────
        # When True, on speech_start the orchestrator allocates a
        # StreamingVoskRecognizer and emits ``partial`` events as the
        # user speaks. ``final`` is then sourced from Vosk's FinalResult
        # (fast path) instead of a Whisper full-utterance call.
        streaming_partials: bool = False,
        partial_debounce_ms: int = 200,
        # When True (and streaming_partials is True), kick off a
        # background Whisper pass on the buffered audio after the Vosk
        # final has been emitted. If Whisper's transcript differs from
        # Vosk's by more than (1 - refine_diff_threshold), emit a
        # ``final_revised`` event with the Whisper text.
        refine_with_whisper: bool = False,
        refine_diff_threshold: float = 0.85,
    ) -> None:
        self._vad = vad
        self._wake = wake_spotter
        self._vosk_model = vosk_model
        self._sample_rate = int(sample_rate)
        self._continuation_window_s = int(continuation_window_s)
        self._emit = event_callback

        self._mode = mode
        self._wake_phrase = (wake_phrase or "").lower().strip()
        self._silence_timeout_ms = int(silence_timeout_ms)
        self._energy_skip_threshold = max(0.0, float(energy_skip_threshold))
        # Tests inject a stub; production callers leave it None and we
        # delegate to voice.pipeline.transcribe at finalisation time.
        self._transcribe_fn = transcribe_fn

        self._state: str = STATE_IDLE
        self._ducked: bool = False
        self._utterance_pcm: bytearray = bytearray()
        self._cooldown_task: Optional[asyncio.Task] = None
        # Phase 12 modes track whether we're inside an utterance buffer.
        self._in_utterance: bool = False

        # Phase 13b — streaming partials configuration + per-utterance state.
        self._streaming_partials = bool(streaming_partials)
        self._partial_debounce_ms = max(0, int(partial_debounce_ms))
        self._refine_with_whisper = bool(refine_with_whisper)
        self._refine_diff_threshold = float(refine_diff_threshold)
        # Active streaming recognizer for the current utterance; None when idle.
        self._streaming_rec = None
        # Pending Whisper background refinement task. Cancelled on reset.
        self._refine_task: Optional[asyncio.Task] = None

    # ───────────────────── public contract ─────────────────────

    @property
    def state(self) -> str:
        return self._state

    @property
    def is_ducked(self) -> bool:
        return self._ducked

    @property
    def mode(self) -> str:
        return self._mode

    async def process_frame(self, pcm_bytes: bytes) -> None:
        """Drive the state machine with one PCM frame. Frames are
        arbitrary byte lengths (VAD and WakeSpotter both buffer
        internally). Dropped wholesale when ``is_ducked``."""
        if self._ducked:
            return
        if not pcm_bytes:
            return

        # Phase 12.0 — mode dispatch. "off" silently drops frames so
        # voice_mode='off' has zero CPU cost beyond the WS receive itself.
        if self._mode == MODE_OFF:
            return
        if self._mode in (MODE_CONTINUOUS, MODE_WAKE_WORD):
            await self._process_frame_phase12(pcm_bytes)
            return

        # Legacy 11b path — wake spotter + continuation window.
        try:
            # Phase 11c.4 — Silero ONNX inference is CPU-bound (5-15ms per
            # 30ms frame); running it on the event loop blocks all HTTP
            # handlers including /health. Off-load to the default thread pool.
            vad_events = await asyncio.to_thread(self._vad.process, pcm_bytes)
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
                # Phase 11c.4 — Vosk AcceptWaveform is synchronous C++,
                # ~10-30ms per frame; same to_thread treatment as VAD.
                await asyncio.to_thread(self._wake.process, pcm_bytes)
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
        # Phase 11c.4 — KaldiRecognizer construction is C++ allocation
        # (~5-20ms); off-load to keep the event loop free.
        await asyncio.to_thread(self._wake.reset)
        self._utterance_pcm = bytearray()
        await self._send({"type": "speech_start"})

    async def _handle_utterance_end(self) -> None:
        await self._send({"type": "speech_end"})
        # Phase 11c.4 — Vosk FinalResult + recognizer rebuild (~20-50ms).
        wake_result = await asyncio.to_thread(self._wake.finalise)

        if wake_result is None or not wake_result.matched:
            # No wake word — return to IDLE, discard buffer.
            self._utterance_pcm = bytearray()
            self._state = STATE_IDLE
            await self._send({"type": "rejected"})
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

    # ─────────────── Phase 12.0 — VAD-driven mode handlers ───────────────

    async def _process_frame_phase12(self, pcm_bytes: bytes) -> None:
        """Continuous + wake_word handler. VAD owns SPEECH_START / SPEECH_END
        with hysteresis (silence_timeout_ms wired into SileroVAD's silence_ms).
        We accumulate PCM during the utterance and emit either a final
        transcript (continuous) or a substring-gated transcript (wake_word).
        """
        # Phase 13a.3 — energy fast-path. When idle (not yet inside an
        # utterance) AND peak amplitude is below threshold, skip Silero
        # ONNX entirely. Frames inside an utterance always go through VAD
        # so SPEECH_END is never lost. The browser-side VAD (Phase 13a.2)
        # already drops most silence; this is the backend belt-and-braces.
        if (
            not self._in_utterance
            and self._energy_skip_threshold > 0.0
            and _peak_energy_normalised(pcm_bytes) < self._energy_skip_threshold
        ):
            return
        try:
            vad_events = await asyncio.to_thread(self._vad.process, pcm_bytes)
        except ValueError as exc:
            logger.warning("orchestrator(p12): VAD rejected frame: %s", exc)
            await self._emit_error(f"vad: {exc}")
            return

        if SPEECH_START in vad_events:
            self._in_utterance = True
            self._utterance_pcm = bytearray()
            self._utterance_pcm.extend(pcm_bytes)
            # Phase 13b — fresh streaming recognizer per utterance. The
            # underlying vosk.Model is shared (singleton); only the
            # KaldiRecognizer instance is per-utterance.
            if self._streaming_partials and self._vosk_model is not None:
                try:
                    from voice.streaming_recognizer import StreamingVoskRecognizer
                    self._streaming_rec = await asyncio.to_thread(
                        StreamingVoskRecognizer,
                        self._vosk_model,
                        sample_rate=self._sample_rate,
                        debounce_ms=self._partial_debounce_ms,
                    )
                except Exception as exc:  # noqa: BLE001
                    logger.warning(
                        "orchestrator(p12): streaming recognizer build "
                        "failed (%s); falling back to non-streaming",
                        exc,
                    )
                    self._streaming_rec = None
            await self._send({"type": "speech_start"})
        elif self._in_utterance:
            self._utterance_pcm.extend(pcm_bytes)

        # Phase 13b — feed the streaming recognizer if we have one.
        # Off-load to to_thread because Vosk AcceptWaveform is blocking C++.
        if self._in_utterance and self._streaming_rec is not None:
            try:
                partial_event = await asyncio.to_thread(
                    self._streaming_rec.feed, pcm_bytes
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "orchestrator(p12): streaming feed failed: %s", exc
                )
                partial_event = None
            if partial_event is not None and partial_event.text:
                await self._send({
                    "type": "partial",
                    "transcript": partial_event.text,
                    "is_committed": partial_event.is_committed,
                    "stability": partial_event.stability,
                })

        if SPEECH_END in vad_events and self._in_utterance:
            self._in_utterance = False
            await self._send({"type": "speech_end"})
            audio = bytes(self._utterance_pcm)
            self._utterance_pcm = bytearray()
            # Phase 13b — fast-path final from Vosk if streaming is on.
            if self._streaming_rec is not None:
                rec = self._streaming_rec
                self._streaming_rec = None
                await self._finalise_streaming(rec, audio)
            else:
                await self._finalise_phase12_utterance(audio)

    async def _finalise_phase12_utterance(self, audio: bytes) -> None:
        if not audio:
            return
        try:
            text, confidence = await self._transcribe_phase12(audio)
        except Exception as exc:  # noqa: BLE001 — provider may fail mid-call
            logger.warning("orchestrator(p12): transcribe failed: %s", exc)
            await self._emit_error(f"stt: {exc}")
            await self._send({"type": "rejected"})
            return

        text = (text or "").strip()
        if not text:
            await self._send({"type": "rejected"})
            return

        try:
            from core.context_engine import context_engine
            context_engine.record_heard_speech(text)
        except Exception as exc:
            logger.warning("orchestrator: failed to record heard speech: %s", exc)

        if self._mode == MODE_WAKE_WORD:
            if not self._wake_phrase:
                # Defensive — config validator forbids empty, but if we
                # got here with an empty phrase, drop everything to avoid
                # accidentally publishing private speech.
                await self._send({"type": "rejected"})
                return
            if self._wake_phrase not in text.lower():
                # Wake phrase missing — silently drop, no chat message.
                await self._send({"type": "rejected"})
                return
            stripped = self._strip_wake_phrase(text)
            if not stripped:
                await self._send({"type": "rejected"})
                return
            text = stripped

        await self._send(
            {
                "type": "final",
                "transcript": text,
                "source": self._mode,  # "continuous" or "wake_word"
                "confidence": confidence,
            }
        )

    # ─────────────── Phase 13b — streaming finalise ─────────────────────

    async def _finalise_streaming(self, rec, audio: bytes) -> None:
        """Drain the streaming recognizer to produce a fast-path Vosk
        ``final`` event. Optionally schedule a background Whisper pass
        whose result may emit ``final_revised`` when it disagrees enough.
        """
        try:
            final_event = await asyncio.to_thread(rec.finalise)
        except Exception as exc:  # noqa: BLE001
            logger.warning("orchestrator(p13b): finalise failed: %s", exc)
            await self._emit_error(f"stt: {exc}")
            await self._send({"type": "rejected"})
            return

        text = (final_event.text or "").strip()
        if not text:
            await self._send({"type": "rejected"})
            return

        try:
            from core.context_engine import context_engine
            context_engine.record_heard_speech(text)
        except Exception as exc:
            logger.warning("orchestrator: failed to record heard speech: %s", exc)

        # Wake-word gating. Identical to the non-streaming Whisper path
        # so behaviour stays consistent regardless of voice_streaming_partials.
        if self._mode == MODE_WAKE_WORD:
            if not self._wake_phrase or self._wake_phrase not in text.lower():
                await self._send({"type": "rejected"})
                return
            stripped = self._strip_wake_phrase(text)
            if not stripped:
                await self._send({"type": "rejected"})
                return
            text = stripped

        await self._send(
            {
                "type": "final",
                "transcript": text,
                "source": "vosk_fast",
                "confidence": float(final_event.confidence),
            }
        )

        # Phase 13b — opt-in background Whisper refinement. Fired off as
        # a fire-and-forget task so the chat / LLM round-trip already in
        # flight on the frontend is not blocked.
        if self._refine_with_whisper and audio:
            self._cancel_refine_task()
            self._refine_task = asyncio.create_task(
                self._background_whisper_refine(audio, text)
            )

    async def _background_whisper_refine(
        self, audio: bytes, vosk_text: str
    ) -> None:
        """Run Whisper on the buffered audio. If the transcript differs from
        Vosk's by more than the configured ratio, emit ``final_revised``."""
        try:
            whisper_text, whisper_conf = await self._transcribe_phase12(audio)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            logger.debug("whisper refine failed: %s", exc)
            return
        whisper_text = (whisper_text or "").strip()
        if not whisper_text:
            return
        ratio = _string_similarity(vosk_text, whisper_text)
        if ratio >= self._refine_diff_threshold:
            return  # close enough — Vosk transcript stays
        await self._send(
            {
                "type": "final_revised",
                "transcript": whisper_text,
                "source": "whisper_quality",
                "confidence": float(whisper_conf),
                "diff_ratio": ratio,
            }
        )

    def _cancel_refine_task(self) -> None:
        if self._refine_task is not None and not self._refine_task.done():
            self._refine_task.cancel()
        self._refine_task = None

    async def _transcribe_phase12(self, audio: bytes) -> tuple[str, float]:
        """Use the injected ``transcribe_fn`` if present (tests do this);
        otherwise dispatch to the active STT provider via ``voice.pipeline``.
        Audio is mono s16le 16kHz PCM."""
        if self._transcribe_fn is not None:
            return await self._transcribe_fn(audio)

        # Lazy import — keeps test stubs from pulling in the whole STT
        # subsystem when they only care about the orchestrator FSM.
        import numpy as np
        from config import config
        from voice.pipeline import get_stt_provider

        if not audio:
            return "", 0.0

        def _to_float() -> "np.ndarray":
            pcm = np.frombuffer(audio, dtype=np.int16)
            return pcm.astype(np.float32) / 32768.0

        wave = await asyncio.to_thread(_to_float)
        provider = get_stt_provider()
        result = await provider.transcribe(wave, config.voice_stt_language)
        return (result.text or "").strip(), float(result.confidence)

    def _strip_wake_phrase(self, text: str) -> str:
        """Remove the first occurrence of the wake phrase (case-insensitive)
        from the transcript and trim leftover punctuation/whitespace.
        The phrase is always lower-cased on construction."""
        lower = text.lower()
        idx = lower.find(self._wake_phrase)
        if idx < 0:
            return text
        before = text[:idx]
        after = text[idx + len(self._wake_phrase):]
        cleaned = (before + after).strip()
        # Strip leading punctuation that often follows a wake word
        # ("фантом, який час" → ", який час" → "який час").
        cleaned = cleaned.lstrip(",.;:!?-—").strip()
        return cleaned

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
        self._in_utterance = False
        self._vad.reset()
        self._wake.reset()
        self._cancel_cooldown_task()
        # Phase 13b — drop in-progress streaming recognizer + cancel any
        # pending Whisper refinement task. Mid-utterance reset / duck must
        # not leak background work into the next session.
        self._streaming_rec = None
        self._cancel_refine_task()

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
