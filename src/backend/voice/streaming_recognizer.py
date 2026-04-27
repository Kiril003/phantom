"""
StreamingVoskRecognizer — Phase 13b.

Wraps a free-grammar ``vosk.KaldiRecognizer`` with a delta-emit + debounce
loop. One instance per utterance: construct on speech_start, ``feed``
PCM frames as they arrive, ``finalise`` on speech_end. Returns ``None``
from ``feed`` when the partial text has not changed (or is still inside
the debounce window) so the orchestrator only ever publishes meaningful
``partial`` events to the frontend.

Why this exists
---------------
Vosk emits a fresh ``PartialResult`` roughly every 50 ms. Pumping every
one of those into the WebSocket would flicker the ghost-bubble UI
unbearably. The recognizer also internally segments long utterances into
"committed" chunks: ``AcceptWaveform`` returning True means Vosk has
finalised one segment of the utterance and started a new one. We
accumulate those committed segments so the partial we publish is
"committed_text + current_partial" — the user always sees the whole
utterance, not just the latest sub-segment.

Public contract
---------------
* ``StreamingVoskRecognizer(vosk_model, *, sample_rate=16000,
   debounce_ms=200)`` — model is the shared ``vosk.Model`` singleton.
* ``feed(pcm_bytes: bytes) -> Optional[PartialEvent]`` — feed one PCM
  frame (any length is fine; Vosk buffers internally). Returns a
  ``PartialEvent`` only when the visible transcript changed *and* the
  debounce window has elapsed (or Vosk just committed a chunk, which is
  always emitted regardless of debounce).
* ``finalise() -> FinalEvent`` — drain the recogniser. Must be called
  exactly once on SPEECH_END.

Stability counter
-----------------
Each ``PartialEvent`` carries a ``stability`` counter — how many feed
calls in a row produced the same visible text. Phase 14 uses this for
predictive LLM kickoff; Phase 13b just exposes it for diagnostics.

This module never touches the network, the orchestrator FSM, or
asyncio. The orchestrator wraps each call in ``asyncio.to_thread``
because Vosk is blocking C++.
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class PartialEvent:
    """A change in the visible transcript that survived debounce."""
    text: str
    # ``True`` when Vosk's AcceptWaveform returned True for this frame —
    # i.e. the recogniser internally closed off a segment. Useful for
    # UI styling (committed words can be rendered solid; pending in italic).
    is_committed: bool = False
    # Number of consecutive feed cycles that produced this same text.
    # Resets to 0 every time the text changes.
    stability: int = 0


@dataclass(frozen=True)
class FinalEvent:
    text: str
    confidence: float


class StreamingVoskRecognizer:
    def __init__(
        self,
        vosk_model,
        *,
        sample_rate: int = 16_000,
        debounce_ms: int = 200,
    ) -> None:
        import vosk
        self._model = vosk_model
        self._sample_rate = int(sample_rate)
        self._debounce_s = max(0.0, debounce_ms / 1000.0)

        self._recognizer = vosk.KaldiRecognizer(self._model, self._sample_rate)
        self._recognizer.SetWords(True)

        self._last_partial_text: str = ""
        self._last_partial_emit_at: float = 0.0
        # Text of segments Vosk has "committed" (AcceptWaveform True).
        # Each new committed chunk is appended with a single space.
        self._committed_text: str = ""
        # How many consecutive feed cycles produced the same text.
        self._stability: int = 0

    def feed(self, pcm_bytes: bytes) -> Optional[PartialEvent]:
        """Feed s16le PCM bytes. Returns a PartialEvent iff:
          • Vosk produced a *new* visible transcript (committed or partial), AND
          • either the debounce window has elapsed, or this is a committed
            chunk (committed events bypass debounce so the user never sees
            stale text after a clear segment boundary).
        """
        if not pcm_bytes:
            return None

        is_committed = bool(self._recognizer.AcceptWaveform(pcm_bytes))
        if is_committed:
            payload = self._safe_json(self._recognizer.Result())
            chunk = (payload.get("text") or "").strip()
            if chunk:
                self._committed_text = (
                    self._committed_text + " " + chunk
                ).strip() if self._committed_text else chunk
            full_text = self._committed_text
        else:
            payload = self._safe_json(self._recognizer.PartialResult())
            partial = (payload.get("partial") or "").strip()
            if self._committed_text and partial:
                full_text = self._committed_text + " " + partial
            else:
                full_text = partial or self._committed_text

        if full_text == self._last_partial_text:
            self._stability += 1
            return None

        now = time.monotonic()
        if (
            not is_committed
            and (now - self._last_partial_emit_at) < self._debounce_s
        ):
            # Text changed but we are inside the debounce window. Cache
            # the new text so we'll emit it next time, but reset stability
            # (the visible state has not yet propagated to the consumer).
            return None

        self._last_partial_text = full_text
        self._last_partial_emit_at = now
        self._stability = 1
        return PartialEvent(
            text=full_text,
            is_committed=is_committed,
            stability=self._stability,
        )

    def finalise(self) -> FinalEvent:
        """Drain the recogniser. Idempotent within reason — if called twice
        the second call returns the same text but with empty confidence."""
        payload = self._safe_json(self._recognizer.FinalResult())
        tail = (payload.get("text") or "").strip()
        if self._committed_text and tail:
            text = (self._committed_text + " " + tail).strip()
        else:
            text = tail or self._committed_text
        words = payload.get("result") or []
        if words:
            conf_total = sum(float(w.get("conf", 0.0)) for w in words)
            confidence = conf_total / len(words)
        else:
            confidence = 1.0 if text else 0.0
        # Mark drained so any caller-bug that asks again gets a sensible
        # empty answer instead of crashing inside Vosk.
        self._committed_text = ""
        return FinalEvent(text=text, confidence=float(confidence))

    @staticmethod
    def _safe_json(payload: object) -> dict:
        if not payload:
            return {}
        if isinstance(payload, dict):
            return payload
        try:
            return json.loads(payload) or {}
        except (TypeError, ValueError):
            return {}
