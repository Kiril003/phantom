"""Спільний словник двох поверхонь. Значення тут списані з
phantom-companion/docs/live-dialogue-contract.md — якщо їх змінять на одній
поверхні, цей файл має впасти раніше, ніж людина почує двох різних
співрозмовників.
"""
from __future__ import annotations

from voice import dialogue_constants as C


def test_acknowledgements_are_the_published_three_in_order() -> None:
    assert C.ACK_LINES == ("зараз", "секунду", "думаю")


def test_the_rule_behind_the_acknowledgements_travels_with_them() -> None:
    # Рецензент по інший бік може дотримати правила, лише якщо воно поруч.
    assert "«так»" in C.ACK_RULE
    assert "минулого часу" in C.ACK_RULE
    assert "так" not in C.ACK_LINES


def test_turn_timings_match_the_contract() -> None:
    assert (C.PROVISIONAL_AFTER_QUESTION_MS, C.COMMIT_AFTER_QUESTION_MS) == (250, 450)
    assert (C.PROVISIONAL_MS, C.COMMIT_MS) == (350, 700)
    assert C.COMMIT_INCOMPLETE_MS == 1200
    assert C.PATIENCE_MS == 2500
    assert C.ENDPOINT_MAX_MS == 8000


def test_barge_in_numbers_match_the_contract() -> None:
    assert C.BARGE_IN_CONFIRM_MS == 700
    assert C.BARGE_IN_DUCK_GAIN == 0.25  # −12 дБ
    assert C.NEVER_SILENT_MS == 1500


def test_stop_words_are_exactly_two() -> None:
    # Кожне зайве слово — це слово, яке людина мусить запам'ятати.
    assert C.STOP_WORDS == ("стоп", "фантом")


def test_interrupt_mark_keeps_only_what_was_heard() -> None:
    assert C.interrupt_mark("почув до сюди") == "⟦перервано після: «почув до сюди»⟧"
    assert C.interrupt_mark("я" * 200) == (
        C.INTERRUPT_MARK_PREFIX
        + "я" * C.INTERRUPT_HEARD_TAIL_CHARS
        + C.INTERRUPT_MARK_SUFFIX
    )


def test_interrupt_mark_of_nothing_heard_is_still_honest() -> None:
    # Порожня позначка краща за вигаданий хвіст: обрив стався, слів не було.
    assert C.interrupt_mark("") == "⟦перервано після: «»⟧"
