"""Живі українські репліки як тестові вектори.

Відповісти на «подзвони мамі» за 700 мс — добре; відповісти на «подзвони,
якщо» — катастрофа, бо людина ще думала. Таблиця спільна з телефоном
(tests/data/turn_taking_vectors.json), тому кожен рядок тут — ще й захист від
розходження двох поверхонь.
"""
from __future__ import annotations

import json
import pathlib

import pytest

from voice import dialogue_constants as C
from voice.turn_taking import UKRAINIAN, TailClass, TurnDecision, TurnTaker

_VECTORS_PATH = pathlib.Path(__file__).resolve().parent / "data" / "turn_taking_vectors.json"
_TABLE = json.loads(_VECTORS_PATH.read_text(encoding="utf-8"))
_VECTORS = _TABLE["vectors"]
_TICK = C.ENDPOINT_TICK_MS


def _ids(vectors: list[dict]) -> list[str]:
    return [f"{v['partial']!r}{'?' if v['after_question'] else ''}" for v in vectors]


def _run(taker: TurnTaker, vector: dict, until_ms: int) -> list[tuple[int, TurnDecision]]:
    """Проганяє тишу тиками й повертає всі не-WAIT рішення з мітками часу."""
    seen: list[tuple[int, TurnDecision]] = []
    t = 0
    while t <= until_ms:
        d = taker.on_tick(t, vector["partial"], vector["after_question"])
        if d is not TurnDecision.WAIT:
            seen.append((t, d))
        t += _TICK
    return seen


# ── Спільна таблиця не розійшлась із кодом ───────────────────────────────────

def test_published_policy_matches_constants() -> None:
    p = _TABLE["policy_ms"]
    assert p["provisional_after_question"] == C.PROVISIONAL_AFTER_QUESTION_MS
    assert p["provisional"] == C.PROVISIONAL_MS
    assert p["commit_after_question"] == C.COMMIT_AFTER_QUESTION_MS
    assert p["commit"] == C.COMMIT_MS
    assert p["commit_incomplete"] == C.COMMIT_INCOMPLETE_MS
    assert p["patience"] == C.PATIENCE_MS
    assert p["endpoint_max"] == C.ENDPOINT_MAX_MS
    assert p["tick"] == C.ENDPOINT_TICK_MS
    assert p["stable_ticks_for_provisional"] == C.STABLE_TICKS_FOR_PROVISIONAL


def test_defaults_come_from_the_shared_constants() -> None:
    t = TurnTaker()
    assert t.provisional_after_question_ms == C.PROVISIONAL_AFTER_QUESTION_MS
    assert t.provisional_ms == C.PROVISIONAL_MS
    assert t.commit_after_question_ms == C.COMMIT_AFTER_QUESTION_MS
    assert t.commit_ms == C.COMMIT_MS
    assert t.commit_incomplete_ms == C.COMMIT_INCOMPLETE_MS
    assert t.patience_ms == C.PATIENCE_MS
    assert t.endpoint_max_ms == C.ENDPOINT_MAX_MS


# ── Класифікація хвоста ──────────────────────────────────────────────────────

@pytest.mark.parametrize("vector", _VECTORS, ids=_ids(_VECTORS))
def test_tail_class(vector: dict) -> None:
    assert UKRAINIAN.classify(vector["partial"]) == TailClass(vector["tail"])


# ── Політика черги ───────────────────────────────────────────────────────────

@pytest.mark.parametrize("vector", _VECTORS, ids=_ids(_VECTORS))
def test_commit_lands_exactly_when_published(vector: dict) -> None:
    commits = [
        (at, d) for at, d in _run(TurnTaker(), vector, until_ms=5_000)
        if d is TurnDecision.COMMIT
    ]
    if vector["commit_ms"] is None:
        assert commits == [], f"«{vector['partial']}» не мала закриватись"
        return
    assert commits, f"«{vector['partial']}» не закрилась узагалі"
    assert commits[0][0] == vector["commit_ms"]
    assert len(commits) == 1, "закриття буває рівно одне на репліку"


@pytest.mark.parametrize("vector", _VECTORS, ids=_ids(_VECTORS))
def test_provisional_lands_exactly_when_published(vector: dict) -> None:
    guesses = [
        (at, d) for at, d in _run(TurnTaker(), vector, until_ms=5_000)
        if d is TurnDecision.PROVISIONAL
    ]
    if vector["provisional_ms"] is None:
        assert guesses == [], (
            f"обірваний хвіст «{vector['partial']}» не має швидкої смуги ніколи"
        )
        return
    assert [at for at, _ in guesses] == [vector["provisional_ms"]]


def test_unstable_partial_holds_the_guess_back() -> None:
    taker = TurnTaker()
    assert taker.on_tick(350, "постав") is TurnDecision.WAIT
    assert taker.on_tick(400, "постав таймер") is TurnDecision.WAIT
    assert taker.on_tick(450, "постав таймер на") is TurnDecision.WAIT
    assert not taker.speculated


def test_resumed_speech_cancels_the_guess_and_reopens_the_turn() -> None:
    # «подзвони… [пауза] …мамі ввечері» — одна репліка, не дві.
    taker = TurnTaker()
    seen = _run(taker, {"partial": "подзвони", "after_question": False}, until_ms=400)
    assert seen and seen[0][1] is TurnDecision.PROVISIONAL
    assert taker.speculated

    taker.on_speech_resumed()
    assert not taker.speculated

    commits = [
        at for at, d in _run(
            taker, {"partial": "подзвони мамі ввечері", "after_question": False}, 1_000,
        )
        if d is TurnDecision.COMMIT
    ]
    assert commits == [C.COMMIT_MS]


def test_patience_is_silent_and_never_closes_a_filler() -> None:
    taker = TurnTaker()
    seen = _run(taker, {"partial": "ееее", "after_question": False}, until_ms=4_000)
    assert all(d is TurnDecision.PATIENCE for _, d in seen)
    assert seen and seen[0][0] == C.PATIENCE_MS


def test_after_commit_the_taker_is_silent_until_reset() -> None:
    taker = TurnTaker()
    commits = [
        at for at, d in _run(taker, {"partial": "добре", "after_question": False}, 800)
        if d is TurnDecision.COMMIT
    ]
    assert commits == [C.COMMIT_MS]
    assert taker.on_tick(3_000, "добре") is TurnDecision.WAIT
    taker.reset()
    assert taker.on_tick(0, "") is TurnDecision.WAIT


# ── Кожне очікування має досяжний вихід ──────────────────────────────────────

@pytest.mark.parametrize(
    "partial", ["подзвони мамі", "подзвони мамі але", "ееее", "   ", ""],
    ids=["complete", "incomplete", "filler", "blank", "empty"],
)
def test_every_tail_class_reaches_a_terminal_decision(partial: str) -> None:
    """Уламок помирає тихо: цикл закриття гасне з будь-якого стану."""
    taker = TurnTaker()
    terminal: tuple[int, TurnDecision] | None = None
    t = 0
    while t <= C.ENDPOINT_MAX_MS + 20 * _TICK:
        d = taker.on_tick(t, partial)
        if d in (TurnDecision.COMMIT, TurnDecision.ABANDON):
            terminal = (t, d)
            break
        t += _TICK
    assert terminal is not None, f"«{partial}» крутилась би вічно"
    assert terminal[0] <= C.ENDPOINT_MAX_MS + _TICK
    assert taker.closed
    # Далі — жодного другого термінального рішення.
    assert taker.on_tick(terminal[0] + _TICK, partial) is TurnDecision.WAIT
    assert taker.on_tick(60_000, partial) is TurnDecision.WAIT


def test_abandon_is_what_ends_an_utterance_that_never_commits() -> None:
    taker = TurnTaker()
    assert taker.on_tick(C.ENDPOINT_MAX_MS, "ееее") is TurnDecision.PATIENCE
    assert taker.on_tick(C.ENDPOINT_MAX_MS + _TICK, "ееее") is TurnDecision.ABANDON
