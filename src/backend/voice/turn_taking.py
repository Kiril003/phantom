"""«Чи людина договорила?» — рішення за словами, не за секундоміром.

Один поріг тиші не може бути правильним: 800 мс — це одночасно надто повільно
після «так» і надто швидко після «я думаю, що…». Фраза, обірвана на «але», не
закінчена, скільки б тиші за нею не було.

Чистий модуль: без asyncio, без Vosk, без годинника. Годуєш тиками — отримуєш
рішення. Близнюк на телефоні:
phantom-companion/core-voice/.../voice/turn/TurnTaker.kt
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum

from voice.dialogue_constants import (
    COMMIT_AFTER_QUESTION_MS,
    COMMIT_INCOMPLETE_MS,
    COMMIT_MS,
    ENDPOINT_MAX_MS,
    PATIENCE_MS,
    PROVISIONAL_AFTER_QUESTION_MS,
    PROVISIONAL_MS,
    STABLE_TICKS_FOR_PROVISIONAL,
)


class TailClass(str, Enum):
    COMPLETE = "complete"
    INCOMPLETE = "incomplete"
    FILLER = "filler"
    EMPTY = "empty"


class TurnDecision(str, Enum):
    WAIT = "wait"
    PROVISIONAL = "provisional"
    COMMIT = "commit"
    #: Довга тиша після уламка: показуємо, що досі слухаємо, і жодного звуку.
    PATIENCE = "patience"
    #: Стеля паузи вичерпана — уламок відпускається без відповіді й без помилки.
    ABANDON = "abandon"


_WORD_SPLIT = re.compile(r"\s+")
_REPEATS = re.compile(r"(.)\1+")
_CLAUSE_HANGERS = ",;:—–-"
_TRIM_CHARS = ".!?…\"«»()"
_APOSTROPHES = str.maketrans({"’": "'", "ʼ": "'"})


@dataclass(frozen=True)
class TailLexicon:
    """Лексикон — дані, а не код: інша мова підставляється, а не дописується."""

    dangling: frozenset[str]
    fillers: frozenset[str]

    def classify(self, text: str) -> TailClass:
        clean = (text or "").strip()
        if not clean:
            return TailClass.EMPTY
        if clean[-1] in _CLAUSE_HANGERS:
            return TailClass.INCOMPLETE

        words = [w for w in _WORD_SPLIT.split(clean) if w]
        if not words:
            return TailClass.EMPTY
        if all(self._is_filler(w) for w in words):
            return TailClass.FILLER

        last = words[-1]
        if self._is_filler(last):
            return TailClass.INCOMPLETE
        if self._normalize(last) in self.dangling:
            return TailClass.INCOMPLETE
        return TailClass.COMPLETE

    def _is_filler(self, word: str) -> bool:
        n = self._normalize(word)
        if n in self.fillers:
            return True
        # «е», «ееее», «еееееее» — те саме вагання різної довжини; перелічувати
        # їх безнадійно, тому повтори однієї літери схлопуються перед звірянням.
        return _REPEATS.sub(r"\1", n) in self.fillers

    @staticmethod
    def _normalize(word: str) -> str:
        return word.lower().translate(_APOSTROPHES).strip(_TRIM_CHARS)


UKRAINIAN = TailLexicon(
    dangling=frozenset({
        "і", "й", "та", "а", "але", "або", "чи", "бо", "що", "щоб", "аби",
        "якщо", "якби", "коли", "поки", "доки", "тому", "тобто", "себто",
        "ніж", "наче", "ніби", "мов", "хоч", "хоча", "проте", "однак",
        "зате", "адже", "оскільки", "тож", "тоді",
        "в", "у", "на", "до", "з", "зі", "із", "від", "для", "про", "за",
        "під", "над", "при", "без", "через", "між", "біля", "коло",
        "після", "перед", "повз", "крізь", "серед", "поза", "попри",
        "щодо", "разом", "як",
        "ну", "ще", "оце", "отже",
    }),
    fillers=frozenset({
        "е", "ее", "еее", "ем", "емм", "емме", "хм", "хмм", "м", "мм",
        "ммм", "а-а", "и-и", "ааа", "еее-е",
    }),
)

ENGLISH = TailLexicon(
    dangling=frozenset({
        "and", "or", "but", "so", "because", "if", "when", "while",
        "that", "which", "to", "of", "in", "on", "at", "for", "with",
        "from", "about", "into", "than", "as", "the", "a", "an",
    }),
    fillers=frozenset({"uh", "uhh", "um", "umm", "hmm", "hm", "er", "err"}),
)


class TurnTaker:
    def __init__(
        self,
        lexicon: TailLexicon = UKRAINIAN,
        *,
        provisional_after_question_ms: int = PROVISIONAL_AFTER_QUESTION_MS,
        provisional_ms: int = PROVISIONAL_MS,
        commit_after_question_ms: int = COMMIT_AFTER_QUESTION_MS,
        commit_ms: int = COMMIT_MS,
        commit_incomplete_ms: int = COMMIT_INCOMPLETE_MS,
        patience_ms: int = PATIENCE_MS,
        endpoint_max_ms: int = ENDPOINT_MAX_MS,
        stable_ticks_for_provisional: int = STABLE_TICKS_FOR_PROVISIONAL,
    ) -> None:
        self.lexicon = lexicon
        self.provisional_after_question_ms = int(provisional_after_question_ms)
        self.provisional_ms = int(provisional_ms)
        self.commit_after_question_ms = int(commit_after_question_ms)
        self.commit_ms = int(commit_ms)
        self.commit_incomplete_ms = int(commit_incomplete_ms)
        self.patience_ms = int(patience_ms)
        self.endpoint_max_ms = int(endpoint_max_ms)
        self.stable_ticks_for_provisional = int(stable_ticks_for_provisional)

        self._last_partial = ""
        self._stable_ticks = 0
        self._provisional_fired = False
        self._closed = False

    def reset(self) -> None:
        self._last_partial = ""
        self._stable_ticks = 0
        self._provisional_fired = False
        self._closed = False

    def on_speech_resumed(self) -> None:
        self._provisional_fired = False
        self._closed = False

    @property
    def speculated(self) -> bool:
        return self._provisional_fired

    @property
    def closed(self) -> bool:
        return self._closed

    def on_tick(
        self, silence_ms: int, partial: str, after_question: bool = False,
    ) -> TurnDecision:
        text = (partial or "").strip()
        if text == self._last_partial:
            self._stable_ticks += 1
        else:
            self._stable_ticks = 0
        self._last_partial = text

        if self._closed:
            return TurnDecision.WAIT
        if silence_ms > self.endpoint_max_ms:
            self._closed = True
            return TurnDecision.ABANDON

        tail = self.lexicon.classify(text)
        if tail is TailClass.EMPTY:
            return TurnDecision.WAIT

        if tail is TailClass.FILLER:
            return (
                TurnDecision.PATIENCE
                if silence_ms >= self.patience_ms
                else TurnDecision.WAIT
            )

        if tail is TailClass.INCOMPLETE:
            if silence_ms >= self.commit_incomplete_ms:
                return self._commit()
            if silence_ms >= self.patience_ms:
                return TurnDecision.PATIENCE
            return TurnDecision.WAIT

        commit_at = (
            self.commit_after_question_ms if after_question else self.commit_ms
        )
        provisional_at = (
            self.provisional_after_question_ms
            if after_question
            else self.provisional_ms
        )
        if silence_ms >= commit_at:
            return self._commit()
        if (
            silence_ms >= provisional_at
            and not self._provisional_fired
            and self._stable_ticks >= self.stable_ticks_for_provisional
        ):
            self._provisional_fired = True
            return TurnDecision.PROVISIONAL
        return TurnDecision.WAIT

    def _commit(self) -> TurnDecision:
        self._closed = True
        return TurnDecision.COMMIT


__all__ = [
    "ENGLISH",
    "UKRAINIAN",
    "TailClass",
    "TailLexicon",
    "TurnDecision",
    "TurnTaker",
]
