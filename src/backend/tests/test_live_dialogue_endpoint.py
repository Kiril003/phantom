"""Черга говорити керує ПК, а не плаский поріг.

`voice/turn_taking.py` існував без жодного споживача: рішення ухвалював
єдиний таймер тиші, тож «так» після запитання чекало стільки ж, скільки
«я думаю, що…». Тут перевіряється, що оркестратор справді питає чергу — і
що пауза на роздум більше не стає відповіддю.

Час у цих тестах справжній, але короткий: межа VAD і сітка тиків збігаються
з опублікованими числами, тож найдовше очікування — 1200 мс уламка.
"""
from __future__ import annotations

import asyncio
import os

import pytest

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-endpoint")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-api-key-for-tests")

from voice import dialogue_constants as C  # noqa: E402
from voice.always_on import MODE_CONTINUOUS, AlwaysOnOrchestrator  # noqa: E402
from voice.streaming_recognizer import FinalEvent, PartialEvent  # noqa: E402
from voice.vad import SPEECH_END, SPEECH_START, SileroVAD  # noqa: E402

FRAME = b"\x10" * 64


class _FakeVAD:
    def __init__(self) -> None:
        self._queue: list[list[str]] = []

    def queue(self, events: list[str]) -> None:
        self._queue.append(events)

    def process(self, _pcm: bytes) -> list[str]:
        return self._queue.pop(0) if self._queue else []

    def reset(self) -> None:
        self._queue.clear()


class _FakeWake:
    def reset(self) -> None:
        return None


class _AskedFloor:
    """Тиха підлога, що памʼятає лише одне: чи PHANTOM щойно поставив запитання."""

    def __init__(self, asked: bool = False) -> None:
        self._asked = asked

    def is_speaking(self) -> bool:
        return False

    def recent(self) -> list[str]:
        return []

    def last_was_question(self) -> bool:
        return self._asked

    async def stop(self, reason: str) -> None:
        return None


_LIVE: list[AlwaysOnOrchestrator] = []


@pytest.fixture(autouse=True)
def _no_task_outlives_the_test():
    yield
    for orch in _LIVE:
        for task in (orch._hold_task, orch._barge_task):
            if task is None or task.done() or task.get_loop().is_closed():
                continue
            task.cancel()
        orch._hold_task = None
        orch._barge_task = None
    _LIVE.clear()


def _make_orch(monkeypatch, *, final_text: str = "", asked: bool = False):
    from config import config

    events: list[dict] = []
    state = {"said": ""}

    class _Rec:
        """Накопичує почуте, як Vosk: свіжий розпізнавач не памʼятає нічого."""

        def __init__(self) -> None:
            self.text = ""

        def feed(self, _pcm: bytes):
            if state["said"]:
                self.text = f"{self.text} {state['said']}".strip()
                state["said"] = ""
            return PartialEvent(text=self.text, stability=3) if self.text else None

        def finalise(self) -> FinalEvent:
            return FinalEvent(text=final_text or self.text, confidence=0.9)

    import voice.streaming_recognizer as sr_mod
    monkeypatch.setattr(sr_mod, "StreamingVoskRecognizer", lambda *_a, **_k: _Rec())

    async def _emit(payload: dict) -> None:
        events.append(payload)

    vad = _FakeVAD()
    orch = AlwaysOnOrchestrator(
        vad=vad,  # type: ignore[arg-type]
        wake_spotter=_FakeWake(),  # type: ignore[arg-type]
        vosk_model=object(),
        event_callback=_emit,
        mode=MODE_CONTINUOUS,
        streaming_partials=True,
        partial_debounce_ms=0,
        silence_timeout_ms=config.voice_silence_timeout_ms,
        speaking=_AskedFloor(asked),
    )
    _LIVE.append(orch)
    return orch, vad, events, state


async def _speak(orch, vad, state, text: str) -> None:
    state["said"] = text
    vad.queue([SPEECH_START])
    await orch.process_frame(FRAME)


async def _fall_silent(orch, vad):
    vad.queue([SPEECH_END])
    await orch.process_frame(FRAME)
    return orch._hold_task


def _decisions(events: list[dict]) -> list[str]:
    return [e["type"] for e in events]


# ── Черга справді керує ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_the_pause_is_not_the_end_of_the_sentence(monkeypatch) -> None:
    """«подзвони мамі але» — уламок: жодного закриття до самої стелі."""
    orch, vad, events, state = _make_orch(monkeypatch)
    await _speak(orch, vad, state, "подзвони мамі але")
    hold = await _fall_silent(orch, vad)

    assert hold is not None, "плаский поріг закрив би репліку відразу"
    assert "final" not in _decisions(events)
    await hold
    assert "final" in _decisions(events)


@pytest.mark.asyncio
async def test_a_dangling_tail_never_gets_the_fast_lane(monkeypatch) -> None:
    """Навіть одразу після запитання PHANTOM: заговорити в паузу на роздум —
    найдорожча помилка з усіх."""
    orch, vad, events, state = _make_orch(monkeypatch, asked=True)
    await _speak(orch, vad, state, "подзвони мамі якщо")
    hold = await _fall_silent(orch, vad)
    assert hold is not None

    await hold
    assert "provisional" not in _decisions(events)


@pytest.mark.asyncio
async def test_an_answer_to_a_question_closes_at_once(monkeypatch) -> None:
    """«так» після запитання: швидка смуга досяжна за побудовою — межа VAD
    нижча за неї, інакше 450 мс не настали б ніколи."""
    orch, vad, events, state = _make_orch(monkeypatch, asked=True)
    assert orch._endpoint_floor_ms < C.COMMIT_AFTER_QUESTION_MS

    await _speak(orch, vad, state, "так")
    hold = await _fall_silent(orch, vad)
    if hold is not None:
        await hold

    finals = [e for e in events if e["type"] == "final"]
    assert finals and finals[0]["transcript"] == "так"


@pytest.mark.asyncio
async def test_one_utterance_survives_a_thinking_pause(monkeypatch) -> None:
    """«подзвони… [пауза] …мамі ввечері» — одна репліка, не дві."""
    orch, vad, events, state = _make_orch(monkeypatch)
    await _speak(orch, vad, state, "подзвони")
    hold = await _fall_silent(orch, vad)
    assert hold is not None

    # Людина заговорила знову — те саме утримання гасне, репліка триває.
    await _speak(orch, vad, state, "мамі ввечері")
    second = await _fall_silent(orch, vad)
    assert second is not None
    await second

    finals = [e for e in events if e["type"] == "final"]
    assert len(finals) == 1, "пауза на роздум розрізала б репліку надвоє"
    assert finals[0]["transcript"] == "подзвони мамі ввечері"
    assert hold.cancelled() or hold.done()
    assert orch._hold_task is None


@pytest.mark.asyncio
async def test_patience_is_visible_and_silent(monkeypatch) -> None:
    """Саме вагання не закривається ніколи — але людина бачить, що її слухають."""
    orch, vad, events, state = _make_orch(monkeypatch)
    await _speak(orch, vad, state, "ееее")
    hold = await _fall_silent(orch, vad)
    assert hold is not None
    orch._turn_taker.patience_ms = 300
    orch._turn_taker.endpoint_max_ms = 600
    await hold

    kinds = _decisions(events)
    assert "patience" in kinds
    assert kinds.count("patience") == 1, "терпіння показують один раз"
    assert "final" not in kinds


@pytest.mark.asyncio
async def test_a_fragment_dies_quietly(monkeypatch) -> None:
    """Репліка, що не закрилась, відпускається без відповіді й без помилки."""
    orch, vad, events, state = _make_orch(monkeypatch)
    await _speak(orch, vad, state, "ееее")
    hold = await _fall_silent(orch, vad)
    assert hold is not None
    orch._turn_taker.endpoint_max_ms = 400
    await hold

    kinds = _decisions(events)
    assert "final" not in kinds
    assert "error" not in kinds
    rejected = [e for e in events if e["type"] == "rejected"]
    assert rejected and rejected[0]["reason"] == "abandoned"


@pytest.mark.asyncio
async def test_the_latch_does_not_outlive_the_utterance(monkeypatch) -> None:
    """`_closed` у черзі — засувка: не знята, вона зробила б НАСТУПНУ репліку
    невидимою назавжди."""
    orch, vad, events, state = _make_orch(monkeypatch)
    await _speak(orch, vad, state, "перша репліка")
    hold = await _fall_silent(orch, vad)
    if hold is not None:
        await hold
    assert not orch._turn_taker.closed

    await _speak(orch, vad, state, "друга репліка")
    hold = await _fall_silent(orch, vad)
    if hold is not None:
        await hold

    finals = [e["transcript"] for e in events if e["type"] == "final"]
    assert finals == ["перша репліка", "друга репліка"]


@pytest.mark.asyncio
async def test_reset_unlatches_the_queue_too(monkeypatch) -> None:
    orch, vad, events, state = _make_orch(monkeypatch)
    await _speak(orch, vad, state, "подзвони мамі але")
    hold = await _fall_silent(orch, vad)
    assert hold is not None

    await orch.reset()
    await asyncio.sleep(0)
    assert hold.cancelled() or hold.done()
    assert orch._hold_task is None
    assert not orch._turn_taker.closed

    await _speak(orch, vad, state, "так")
    hold = await _fall_silent(orch, vad)
    if hold is not None:
        await hold
    assert "final" in _decisions(events)


# ── Числа не розійшлись із опублікованими ────────────────────────────────────


def test_the_vad_floor_is_below_the_fastest_published_tier() -> None:
    """Межа VAD — не рішення, а лише «стало тихо». Якби вона стояла вище за
    250 мс, здогад і швидке закриття були б недосяжні за побудовою — саме
    так воно й було з пласким порогом на 800 мс."""
    from api.routes_voice_stream import SILERO_MODEL_PATH, vad_silence_request_ms
    from config import config

    requested = vad_silence_request_ms("continuous", True)
    assert requested == C.PROVISIONAL_AFTER_QUESTION_MS

    vad = SileroVAD(str(SILERO_MODEL_PATH), silence_ms=requested)
    assert vad.silence_floor_ms < C.PROVISIONAL_AFTER_QUESTION_MS
    assert vad.silence_floor_ms < C.COMMIT_AFTER_QUESTION_MS

    # Без партіалів черги немає — і ключ знову означає єдиний поріг.
    assert (
        vad_silence_request_ms("continuous", False)
        == config.voice_silence_timeout_ms
    )
    assert vad_silence_request_ms("off", True) == config.voice_vad_silence_ms


def test_the_incomplete_ceiling_is_the_configured_one(monkeypatch) -> None:
    """Ключ налаштувань став стелею обірваного хвоста — і черга бере саме його."""
    from config import config

    orch, _vad, _events, _state = _make_orch(monkeypatch)
    assert orch._turn_taker.commit_incomplete_ms == config.voice_silence_timeout_ms
    assert config.voice_silence_timeout_ms == C.COMMIT_INCOMPLETE_MS


def test_a_short_configured_ceiling_cannot_undercut_a_finished_sentence() -> None:
    """Оператор може виставити 300 мс. Уламок від цього не має закриватись
    раніше за завершену фразу — це перевернуло б усе правило."""
    orch = AlwaysOnOrchestrator(
        vad=_FakeVAD(),  # type: ignore[arg-type]
        wake_spotter=_FakeWake(),  # type: ignore[arg-type]
        vosk_model=object(),
        mode=MODE_CONTINUOUS,
        streaming_partials=True,
        silence_timeout_ms=300,
    )
    assert orch._turn_taker.commit_incomplete_ms >= C.COMMIT_MS


def test_without_partials_there_is_no_queue_at_all(monkeypatch) -> None:
    """Класифікувати хвіст нічим — тоді плаский поріг лишається єдиним,
    і це чесніше, ніж вдавати чергу над порожнім текстом."""
    orch = AlwaysOnOrchestrator(
        vad=_FakeVAD(),  # type: ignore[arg-type]
        wake_spotter=_FakeWake(),  # type: ignore[arg-type]
        vosk_model=object(),
        mode=MODE_CONTINUOUS,
        streaming_partials=False,
    )
    assert orch._turn_taker is None
