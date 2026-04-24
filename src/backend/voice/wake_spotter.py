"""
Wake-word spotter — Phase 11b always-on voice pipeline.

Wraps a restricted-grammar Vosk ``KaldiRecognizer`` around an already-loaded
``vosk.Model``. The grammar limits the recogniser to the wake-word tokens
plus Vosk's ``[unk]`` filler — every non-wake utterance is collapsed into
``[unk]`` noise so any occurrence of the wake word in the transcript is
both cheap to detect and unambiguous.

Critical design constraint from the Phase 11a audit: do **not** load a
second ``vosk.Model``. The caller passes the model that
``VoskSTTProvider`` already keeps resident (~300 MB). This class only
owns its own ``KaldiRecognizer`` (which is effectively free — pointers
into the shared model + a small decoder state).

Public contract
---------------
* ``WakeSpotter(vosk_model, *, wake_words="фантом", confidence_min=0.6,
   sample_rate=16000)``
* ``process(pcm_bytes: bytes) -> WakeResult | None`` — feeds raw s16le
  PCM. Returns ``None`` while the current utterance is still in
  progress (Vosk hasn't hit an internal silence boundary), or a
  ``WakeResult`` when the recogniser finalised an utterance. Caller
  checks ``result.matched`` to decide whether to fire wake.
* ``finalise() -> WakeResult | None`` — force a final decode. Called
  by the orchestrator when VAD signals ``speech_end`` so we don't wait
  on Vosk's internal silence timer. Resets the recogniser for the next
  utterance.
* ``reset() -> None`` — rebuild the recogniser (clears decoder state
  and any pending audio). Called when mic ducking begins.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Iterable

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class WakeResult:
    matched: bool
    confidence: float
    transcript: str


def _build_grammar(wake_words: Iterable[str]) -> str:
    """Vosk grammar JSON: a flat array of allowed tokens plus ``[unk]``
    to soak up everything that isn't a wake word."""
    cleaned = sorted({w.strip().lower() for w in wake_words if w and w.strip()})
    if not cleaned:
        raise ValueError("wake_words must contain at least one non-empty token")
    return json.dumps(cleaned + ["[unk]"], ensure_ascii=False)


class WakeSpotter:
    """Restricted-grammar wake-word detector. One instance per WebSocket
    connection. Not thread-safe — call from a single task."""

    def __init__(
        self,
        vosk_model,
        *,
        wake_words: str | Iterable[str] = "фантом",
        confidence_min: float = 0.6,
        sample_rate: int = 16_000,
    ) -> None:
        if isinstance(wake_words, str):
            tokens = [t for t in wake_words.split(",") if t.strip()]
        else:
            tokens = list(wake_words)
        self._wake_tokens = [t.strip().lower() for t in tokens if t.strip()]
        if not self._wake_tokens:
            raise ValueError("wake_words must contain at least one token")
        self._confidence_min = float(confidence_min)
        self._sample_rate = int(sample_rate)
        self._model = vosk_model
        self._grammar = _build_grammar(self._wake_tokens)
        self._recognizer = None
        self._build_recognizer()

    def _build_recognizer(self) -> None:
        # Imported lazily so unit tests that mock the recogniser don't
        # require vosk to be importable.
        import vosk

        self._recognizer = vosk.KaldiRecognizer(
            self._model, self._sample_rate, self._grammar
        )
        self._recognizer.SetWords(True)

    def reset(self) -> None:
        self._build_recognizer()

    @property
    def wake_tokens(self) -> tuple[str, ...]:
        return tuple(self._wake_tokens)

    @property
    def confidence_min(self) -> float:
        return self._confidence_min

    def process(self, pcm_bytes: bytes) -> WakeResult | None:
        """Feed PCM. Returns a WakeResult only at utterance boundaries
        (Vosk internal silence trigger); ``None`` while the utterance
        is still ongoing."""
        if not pcm_bytes:
            return None
        if len(pcm_bytes) % 2 != 0:
            raise ValueError(
                f"pcm_bytes length must be even (s16le); got {len(pcm_bytes)}"
            )
        assert self._recognizer is not None
        utterance_complete = self._recognizer.AcceptWaveform(pcm_bytes)
        if not utterance_complete:
            return None
        payload = self._recognizer.Result() or "{}"
        return self._consume_payload(payload, rebuild=True)

    def finalise(self) -> WakeResult | None:
        """Force a final result (VAD says speech_end). Always returns a
        WakeResult so the orchestrator can always see the last
        utterance, even a silent one."""
        assert self._recognizer is not None
        payload = self._recognizer.FinalResult() or "{}"
        return self._consume_payload(payload, rebuild=True)

    def _consume_payload(
        self, payload: str, *, rebuild: bool
    ) -> WakeResult | None:
        try:
            decoded = json.loads(payload)
        except json.JSONDecodeError:
            logger.warning("WakeSpotter: invalid JSON from Vosk: %r", payload[:80])
            if rebuild:
                self._build_recognizer()
            return None

        text = (decoded.get("text") or "").strip().lower()
        words = decoded.get("result") or []
        confidence = self._avg_confidence(words)

        # Filter out [unk]-only transcripts early — they never match.
        word_set = {w.strip() for w in text.split() if w.strip()}
        matched_tokens = word_set & set(self._wake_tokens)
        matched = bool(matched_tokens) and confidence >= self._confidence_min

        if rebuild:
            self._build_recognizer()

        return WakeResult(
            matched=matched,
            confidence=confidence,
            transcript=text,
        )

    @staticmethod
    def _avg_confidence(words: list[dict]) -> float:
        if not words:
            return 0.0
        total = 0.0
        count = 0
        for w in words:
            # Ignore [unk] entries for confidence averaging — they drag
            # confidence down and aren't the signal we're checking.
            token = (w.get("word") or "").strip().lower()
            if token == "[unk]":
                continue
            total += float(w.get("conf", 0.0))
            count += 1
        return float(total / count) if count else 0.0
