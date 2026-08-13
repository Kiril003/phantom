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
from voice.speaking_floor import speaking_floor

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

    def __init__(
        self,
        user_id: str,
        message_id: str,
        session_id: str,
        *,
        voice: str = "",
        speed: float = 0.0,
    ) -> None:
        self.user_id = user_id
        self.message_id = message_id
        self.session_id = session_id
        # Порожні = автовибір голосу за текстом і швидкість із налаштувань.
        self.voice = voice
        self.speed = speed
        self._buffer = ""
        self._seq = 0
        self._queue: asyncio.Queue[str | None] = asyncio.Queue()
        self._worker: asyncio.Task | None = None
        self._cancelled = False
        self.accepted_any = False

    @property
    def spoken_sentences(self) -> int:
        """Скільки речень справді пішло в ефір. Нуль означає тишу — і той,
        хто заявляє, що сказав щось уголос, має звіряти саме це."""
        return self._seq

    async def wait_done(self) -> bool:
        """Чекає, поки хід доспіває. False — його перебили на півслові."""
        worker = self._worker
        if worker is None:
            return not self._cancelled
        # `await worker` підняло б CancelledError у того, кого НЕ скасовували.
        await asyncio.wait({worker})
        return not worker.cancelled()

    def start(self) -> None:
        speaking_floor.open(self.user_id, self, self.interrupt)
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

    async def cancel(self, *, notify: bool = True, reason: str = "replaced") -> None:
        """Stop synthesis and tell the UI to stop playback."""
        if self._cancelled:
            return
        self._cancelled = True
        speaking_floor.close(self.user_id, self)
        if self._worker is not None:
            self._worker.cancel()
        if notify:
            await _broadcast(
                self.user_id, "tts.stop",
                {
                    "message_id": self.message_id,
                    "session_id": self.session_id,
                    "reason": reason,
                },
            )

    async def interrupt(self, reason: str) -> None:
        """Важіль перехоплення: знімає мовця з реєстру голосів і глушить UI."""
        if _ACTIVE.get(self.user_id) is self:
            _ACTIVE.pop(self.user_id, None)
        await self.cancel(reason=reason)

    def _enqueue(self, sentence: str) -> None:
        text = speakable(sentence)
        if len(text) < _MIN_SENTENCE_CHARS:
            return
        self.accepted_any = True
        self._queue.put_nowait(text)

    async def _run_worker(self) -> None:
        from voice.pipeline import synthesize_text, voice_for_text

        try:
            while True:
                text = await self._queue.get()
                if text is None:
                    # UI глушить мікрофон на весь потік, тож мусить знати кінець.
                    await _broadcast(
                        self.user_id, "tts.end",
                        {"message_id": self.message_id, "session_id": self.session_id},
                    )
                    return
                try:
                    result = await synthesize_text(
                        text,
                        self.voice or voice_for_text(text),
                        self.speed or config.voice_tts_speed,
                    )
                    if result.engine == "silent":
                        continue
                    self._seq += 1
                    # Реєстр дізнається про речення ПЕРЕД тим, як воно піде в
                    # ефір: інакше лишається щілина, у якій звук уже лунає, а
                    # фільтр самопрослуховування ще не знає його слів.
                    speaking_floor.note(self.user_id, self, text)
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
        finally:
            # Хід скінчився будь-яким шляхом — реєстр не має вважати нас мовцем.
            speaking_floor.close(self.user_id, self)


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
    *, voice: str = "", speed: float = 0.0,
) -> SentenceSpeaker:
    """Create + start a speaker for this turn, interrupting the previous one."""
    await stop_for_user(user_id)
    speaker = SentenceSpeaker(user_id, message_id, session_id, voice=voice, speed=speed)
    speaker.start()
    _ACTIVE[user_id] = speaker
    # Забиваємо повідомлення до першої дельти: інакше другий шлях озвучки в
    # UI (ціла відповідь) скаже те саме вдруге.
    await _broadcast(
        user_id, "tts.begin",
        {"message_id": message_id, "session_id": session_id},
    )
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
