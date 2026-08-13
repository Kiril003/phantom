"""ПК чує власний динамік. Ці вектори вирішують, чи відрізнить він людину
від себе — самим текстом, без жодного мікрофона.
"""
from __future__ import annotations

import pytest

from voice.dialogue_constants import STOP_WORDS
from voice.self_echo import is_probable_echo, normalize_tokens

_SPOKEN = [
    "Зараз перевірю маршрут.",
    "На трасі чисто, виїзд через міст.",
]


# ── Це ми самі ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "partial",
    [
        "зараз перевірю маршрут",
        "Зараз перевірю маршрут!",
        "ЗАРАЗ ПЕРЕВІРЮ",
        "на трасі чисто",
        "перевірю маршрут на трасі",
        "трасі чисто виїзд міст",
    ],
)
def test_our_own_words_are_recognised_as_echo(partial: str) -> None:
    assert is_probable_echo(partial, _SPOKEN) is True


def test_garbled_leak_still_reads_as_echo() -> None:
    # Ехо приходить із пропущеними словами — і саме так його чує Vosk.
    assert is_probable_echo("зараз маршрут", _SPOKEN) is True


# ── Це людина ────────────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "partial",
    [
        "стоп",
        "ні не туди",
        "а що з пальним",
        "постав таймер на десять хвилин",
    ],
)
def test_real_speech_is_not_suppressed(partial: str) -> None:
    assert is_probable_echo(partial, _SPOKEN) is False


def test_same_words_in_another_order_are_a_person() -> None:
    # Порядок — і є різниця між луною та людиною, що вживає ті самі слова.
    assert is_probable_echo("маршрут перевірю зараз", _SPOKEN) is False


def test_nothing_spoken_means_nothing_to_suppress() -> None:
    assert is_probable_echo("зараз перевірю маршрут", []) is False
    assert is_probable_echo("зараз перевірю маршрут", None) is False


def test_empty_partial_is_never_echo() -> None:
    assert is_probable_echo("", _SPOKEN) is False
    assert is_probable_echo("   ", _SPOKEN) is False


# ── Стоп-слова ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("word", STOP_WORDS)
def test_stop_word_passes_while_we_are_not_saying_it(word: str) -> None:
    assert is_probable_echo(word, _SPOKEN) is False


@pytest.mark.parametrize("word", STOP_WORDS)
def test_stop_word_inside_our_own_sentence_is_suppressed(word: str) -> None:
    spoken = [f"Скажи «{word}», якщо треба зупинити."]
    assert is_probable_echo(word, spoken) is True


# ── Межі ─────────────────────────────────────────────────────────────────────

def test_normalisation_survives_punctuation_and_apostrophes() -> None:
    assert normalize_tokens("П’ять, — шість…") == ["п'ять", "шість"]
    assert normalize_tokens("") == []


@pytest.mark.parametrize("bad", [0.0, -0.5, 1.5])
def test_impossible_threshold_is_rejected_loudly(bad: float) -> None:
    # Поріг 0 зробив би машину глухою назавжди і без жодного сліду.
    with pytest.raises(ValueError):
        is_probable_echo("будь-що", _SPOKEN, min_coverage=bad)


def test_long_reply_does_not_swallow_a_short_human_line() -> None:
    spoken = [
        "Маршрут прокладено через міст, далі трасою на північ.",
        "Пального вистачить на двісті кілометрів.",
        "Погода без опадів, видимість добра.",
    ]
    assert is_probable_echo("а якщо через ліс", spoken) is False
