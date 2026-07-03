"""B1 liveness — incremental sentence TTS.

Whole-reply TTS meant the voice started AFTER the full LLM answer
landed. This module speaks the reply as it is generated: the chat
delta stream is sentence-split on the fly, each complete sentence is
synthesized (Piper via `voice.pipeline.synthesize_text`) and shipped
to the operator UI as a `chat`/`tts.sentence` WS event with base64
WAV. A new user message interrupts playback via `chat`/`tts.stop`.

One speaker per user at a time — starting a new one cancels the old.
Synthesis runs on a worker task consuming an ordered queue, so the
HTTP chat turn is never blocked on audio.
"""
from __future__ import annotations

import asyncio
import base64
import logging
import re

from config import config

logger = logging.getLogger(__name__)

# Sentence ends at ., !, ?, or … followed by whitespace/EOL. Newlines
# (list items, headings) also flush — they are natural pause points.
_BOUNDARY_RE = re.compile(r"(?<=[.!?…])\s+|\n+")
_MIN_SENTENCE_CHARS = 4

_FENCE_RE = re.compile(r"```.*?(?:```|$)", re.DOTALL)
_INLINE_CODE_RE = re.compile(r"`[^`]*`")
_URL_RE = re.compile(r"https?://\S+")
_MD_LINK_RE = re.compile(r"\[([^\]]*)\]\([^)]*\)")
_MD_MARKS_RE = re.compile(r"[*_#>|~]+")


def speakable(text: str) -> str:
    """Strip what must not be read aloud: code blocks, URLs, markdown
    marks. The chat bubble keeps the original text — this is voice only."""
    out = _FENCE_RE.sub(" ", text or "")
    out = _INLINE_CODE_RE.sub(" ", out)
    out = _MD_LINK_RE.sub(r"\1", out)
    out = _URL_RE.sub(" ", out)
    out = _MD_MARKS_RE.sub(" ", out)
    return re.sub(r"\s{2,}", " ", out).strip()


def split_complete_sentences(buffer: str) -> tuple[list[str], str]:
    """Split `buffer` into (complete sentences, unfinished tail)."""
    pieces = _BOUNDARY_RE.split(buffer)
    if len(pieces) <= 1:
        return [], buffer
    tail = pieces[-1]
    done = [p.strip() for p in pieces[:-1] if p and p.strip()]
    return done, tail


class SentenceSpeaker:
    """Sentence-streaming synthesizer bound to one assistant message."""

    def __init__(self, user_id: str, message_id: str, session_id: str) -> None:
        self.user_id = user_id
        self.message_id = message_id
        self.session_id = session_id
        self._buffer = ""
        self._seq = 0
        self._queue: asyncio.Queue[str | None] = asyncio.Queue()
        self._worker: asyncio.Task | None = None
        self._cancelled = False
        self.accepted_any = False

    def start(self) -> None:
        self._worker = asyncio.create_task(
            self._run_worker(), name=f"tts-speaker-{self.message_id[:8]}",
        )

    async def feed(self, delta: str) -> None:
        """Accept a text delta; enqueue any sentences it completes."""
        if self._cancelled or not delta:
            return
        self._buffer += delta
        sentences, self._buffer = split_complete_sentences(self._buffer)
        for s in sentences:
            self._enqueue(s)

    async def finish(self) -> None:
        """Flush the unfinished tail and let the worker drain + exit.
        Does NOT wait for playback — the chat turn must not block."""
        if self._cancelled:
            return
        tail, self._buffer = self._buffer.strip(), ""
        if tail:
            self._enqueue(tail)
        await self._queue.put(None)

    async def cancel(self, *, notify: bool = True) -> None:
        """Stop synthesis and tell the UI to stop playback."""
        if self._cancelled:
            return
        self._cancelled = True
        if self._worker is not None:
            self._worker.cancel()
        if notify:
            await _broadcast(
                self.user_id, "tts.stop",
                {"message_id": self.message_id, "session_id": self.session_id},
            )

    def _enqueue(self, sentence: str) -> None:
        text = speakable(sentence)
        if len(text) < _MIN_SENTENCE_CHARS:
            return
        self.accepted_any = True
        self._queue.put_nowait(text)

    async def _run_worker(self) -> None:
        from voice.pipeline import synthesize_text
        from voice.tts_engine import select_voice_for_text

        while True:
            text = await self._queue.get()
            if text is None:
                return
            try:
                result = await synthesize_text(
                    text,
                    select_voice_for_text(text),
                    config.voice_tts_speed,
                )
                if result.engine == "silent":
                    continue
                self._seq += 1
                await _broadcast(
                    self.user_id, "tts.sentence",
                    {
                        "message_id": self.message_id,
                        "session_id": self.session_id,
                        "seq": self._seq,
                        "text": text,
                        "audio_b64": base64.b64encode(result.audio_wav).decode("ascii"),
                        "sample_rate": result.sample_rate,
                    },
                )
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 — one bad sentence never kills the stream
                logger.warning("incremental TTS sentence failed: %s", exc)


async def _broadcast(user_id: str, type_: str, payload: dict) -> None:
    try:
        from api.websocket_hub import hub
        await hub.broadcast("chat", type_, payload, user_id=user_id)
    except Exception as exc:  # noqa: BLE001
        logger.debug("incremental TTS broadcast failed (%s): %s", type_, exc)


# ── per-user registry ─────────────────────────────────────────────────────────

_ACTIVE: dict[str, SentenceSpeaker] = {}


async def start_speaker(
    user_id: str, message_id: str, session_id: str,
) -> SentenceSpeaker:
    """Create + start a speaker for this turn, interrupting the previous one."""
    await stop_for_user(user_id)
    speaker = SentenceSpeaker(user_id, message_id, session_id)
    speaker.start()
    _ACTIVE[user_id] = speaker
    return speaker


async def stop_for_user(user_id: str) -> None:
    """Interrupt: cancel the user's active speaker and stop UI playback."""
    speaker = _ACTIVE.pop(user_id, None)
    if speaker is not None:
        await speaker.cancel()


__all__ = [
    "SentenceSpeaker",
    "speakable",
    "split_complete_sentences",
    "start_speaker",
    "stop_for_user",
]
