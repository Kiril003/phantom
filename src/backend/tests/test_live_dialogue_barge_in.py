"""ПК чує, поки говорить.

Досі кожен кадр із мікрофона викидався на час озвучки: перебити машину було
неможливо в принципі. Тут перевіряється поступка у два кроки — миттєве
стишення й убивство на першому НЕ-ехо слові — і те, заради чого вона взагалі
працює: PHANTOM не перебиває сам себе, бо знає, що саме зараз промовляє.

Жодного мікрофона, жодного динаміка: VAD і розпізнавач — підставні, рішення
приймаються за текстом.
"""
from __future__ import annotations

import asyncio
import os

import pytest

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-barge-in")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-api-key-for-tests")

from voice import dialogue_constants as C  # noqa: E402
from voice.always_on import MODE_CONTINUOUS, AlwaysOnOrchestrator  # noqa: E402
from voice.streaming_recognizer import FinalEvent, PartialEvent  # noqa: E402
from voice.vad import SPEECH_END, SPEECH_START  # noqa: E402

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
    """Ці шляхи його не викликають, але reset() чіпає всіх."""

    def reset(self) -> None:
        return None


class _FakeFloor:
    """Реєстр голосів: хто говорить, що саме, і чи його спинили."""

    def __init__(self, spoken: list[str] | None = None, speaking: bool = True) -> None:
        self._spoken = list(spoken or [])
        self._speaking = speaking
        self.stops: list[str] = []

    def is_speaking(self) -> bool:
        return self._speaking

    def recent(self) -> list[str]:
        return list(self._spoken)

    def last_was_question(self) -> bool:
        return bool(self._spoken) and self._spoken[-1].rstrip().endswith("?")

    async def stop(self, reason: str) -> None:
        self.stops.append(reason)
        self._speaking = False


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


def _make_orch(
    *,
    partials: list[PartialEvent | None] | None = None,
    final_text: str = "",
    floor: _FakeFloor | None = None,
    on_build=None,
    monkeypatch=None,
):
    events: list[dict] = []
    script = list(partials or [])

    class _Rec:
        def feed(self, _pcm: bytes):
            return script.pop(0) if script else None

        def finalise(self) -> FinalEvent:
            return FinalEvent(text=final_text, confidence=0.9)

    def _factory(*_a, **_kw):
        if on_build is not None:
            on_build()
        return _Rec()

    import voice.streaming_recognizer as sr_mod
    monkeypatch.setattr(sr_mod, "StreamingVoskRecognizer", _factory)

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
        speaking=floor,
    )
    _LIVE.append(orch)
    return orch, vad, events


def _types(events: list[dict]) -> list[str]:
    return [e["type"] for e in events]


# ── Крок перший: глухота скінчилась ──────────────────────────────────────────


@pytest.mark.asyncio
async def test_the_pc_hears_while_it_speaks(monkeypatch) -> None:
    """Кадр під час озвучки більше не зникає: VAD його бачить, репліка йде."""
    floor = _FakeFloor(spoken=["Я поставив таймер."])
    orch, vad, events = _make_orch(floor=floor, monkeypatch=monkeypatch)

    vad.queue([SPEECH_START])
    await orch.process_frame(FRAME)

    assert "speech_start" in _types(events)
    assert orch._in_utterance


@pytest.mark.asyncio
async def test_the_duck_leaves_before_any_stt_work(monkeypatch) -> None:
    """Поступка чутна за десятки мілісекунд, а побудова розпізнавача коштує
    десятки мілісекунд — тож вона мусить бути ПІСЛЯ."""
    seen_at_build: list[int] = []
    floor = _FakeFloor(spoken=["Я поставив таймер."])
    orch, vad, events = _make_orch(
        floor=floor,
        on_build=lambda: seen_at_build.append(len(events)),
        monkeypatch=monkeypatch,
    )

    vad.queue([SPEECH_START])
    await orch.process_frame(FRAME)

    assert events[0]["type"] == "barge_in_duck"
    assert events[0]["gain"] == C.BARGE_IN_DUCK_GAIN
    assert events[0]["confirm_ms"] == C.BARGE_IN_CONFIRM_MS
    assert seen_at_build == [1], "розпізнавач будувався раніше за стишення"


# ── Крок другий: слово вбиває, кашель — ні ───────────────────────────────────


@pytest.mark.asyncio
async def test_a_word_kills_the_reply(monkeypatch) -> None:
    floor = _FakeFloor(spoken=["Маршрут прокладено через Сокільники."])
    orch, vad, events = _make_orch(
        floor=floor,
        partials=[PartialEvent(text="ні зачекай", stability=1)],
        monkeypatch=monkeypatch,
    )

    vad.queue([SPEECH_START])
    await orch.process_frame(FRAME)

    commits = [e for e in events if e["type"] == "barge_in_commit"]
    assert commits and commits[0]["transcript"] == "ні зачекай"
    assert floor.stops == ["barge_in"], "другий голос лишився б говорити"
    assert not orch.barge_in_open
    assert orch._barge_task is None


@pytest.mark.asyncio
async def test_our_own_echo_does_not_interrupt_us(monkeypatch) -> None:
    """Найдорожча помилка: машина чує власний динамік і перебиває себе."""
    floor = _FakeFloor(spoken=["Маршрут прокладено через Сокільники."])
    orch, vad, events = _make_orch(
        floor=floor,
        partials=[PartialEvent(text="маршрут прокладено через", stability=1)],
        monkeypatch=monkeypatch,
    )

    vad.queue([SPEECH_START])
    await orch.process_frame(FRAME)

    assert "barge_in_commit" not in _types(events)
    assert floor.stops == []
    assert orch.barge_in_open, "вікно мало лишитись відкритим до кінця"


@pytest.mark.asyncio
async def test_a_cough_costs_a_dip_not_the_reply(monkeypatch) -> None:
    """Звук без слова: гучність просідає й повертається, відповідь їде далі."""
    floor = _FakeFloor(spoken=["Маршрут прокладено."])
    orch, vad, events = _make_orch(floor=floor, monkeypatch=monkeypatch)

    vad.queue([SPEECH_START])
    await orch.process_frame(FRAME)
    vad.queue([SPEECH_END])
    await orch.process_frame(FRAME)

    kinds = _types(events)
    assert "barge_in_duck" in kinds
    assert "barge_in_commit" not in kinds
    release = [e for e in events if e["type"] == "barge_in_release"]
    assert release and release[0]["reason"] == "silence"
    assert floor.stops == []


# ── Кожна засувка має вихід ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_the_window_closes_even_when_the_frames_stop(monkeypatch) -> None:
    """Кадри йдуть лише поки клієнтський VAD чує мову. Кашель обриває їх на
    півслові — і без власного годинника гучність лишилась би просілою до
    кінця відповіді."""
    floor = _FakeFloor(spoken=["Маршрут прокладено."])
    orch, vad, events = _make_orch(floor=floor, monkeypatch=monkeypatch)

    vad.queue([SPEECH_START])
    await orch.process_frame(FRAME)
    assert orch.barge_in_open

    # Жодного кадру більше — тільки час.
    await asyncio.sleep(C.BARGE_IN_CONFIRM_MS / 1000.0 + 0.15)

    release = [e for e in events if e["type"] == "barge_in_release"]
    assert release, "гучність лишилась би просілою до кінця відповіді"
    assert release[0]["reason"] == "timeout"
    assert not orch.barge_in_open
    assert orch._barge_task is None


@pytest.mark.asyncio
async def test_reset_gives_the_volume_back(monkeypatch) -> None:
    floor = _FakeFloor(spoken=["Маршрут прокладено."])
    orch, vad, events = _make_orch(floor=floor, monkeypatch=monkeypatch)

    vad.queue([SPEECH_START])
    await orch.process_frame(FRAME)
    await orch.reset()

    release = [e for e in events if e["type"] == "barge_in_release"]
    assert release and release[0]["reason"] == "reset"
    assert not orch.barge_in_open
    assert orch._barge_task is None


@pytest.mark.asyncio
async def test_the_fallback_duck_gives_the_volume_back_too(monkeypatch) -> None:
    floor = _FakeFloor(spoken=["Маршрут прокладено."])
    orch, vad, events = _make_orch(floor=floor, monkeypatch=monkeypatch)

    vad.queue([SPEECH_START])
    await orch.process_frame(FRAME)
    await orch.mic_duck()

    assert "barge_in_release" in _types(events)
    assert not orch.barge_in_open


@pytest.mark.asyncio
async def test_the_reply_ending_gives_the_volume_back(monkeypatch) -> None:
    floor = _FakeFloor(spoken=["Маршрут прокладено."])
    orch, vad, events = _make_orch(floor=floor, monkeypatch=monkeypatch)

    vad.queue([SPEECH_START])
    await orch.process_frame(FRAME)
    floor._speaking = False
    await orch.set_tts_active(False)

    release = [e for e in events if e["type"] == "barge_in_release"]
    assert release and release[0]["reason"] == "tts_ended"


@pytest.mark.asyncio
async def test_a_committed_barge_in_does_not_leave_the_mic_marked(
    monkeypatch,
) -> None:
    """Клієнт може не встигнути сказати mic_unduck — ми спинили мову самі,
    тож заявка про озвучку вичерпана нами ж."""
    floor = _FakeFloor(spoken=["Маршрут прокладено."])
    orch, vad, _events = _make_orch(
        floor=floor,
        partials=[PartialEvent(text="ні зачекай", stability=1)],
        monkeypatch=monkeypatch,
    )
    await orch.set_tts_active(True)

    vad.queue([SPEECH_START])
    await orch.process_frame(FRAME)

    assert orch.tts_active is False


# ── PHANTOM не пише в чат сам собі ───────────────────────────────────────────


@pytest.mark.asyncio
async def test_its_own_voice_never_reaches_the_chat(monkeypatch) -> None:
    floor = _FakeFloor(spoken=["Маршрут прокладено через Сокільники."])
    orch, vad, events = _make_orch(
        floor=floor,
        partials=[PartialEvent(text="маршрут прокладено", stability=1)],
        final_text="маршрут прокладено через сокільники",
        monkeypatch=monkeypatch,
    )

    vad.queue([SPEECH_START])
    await orch.process_frame(FRAME)
    floor._speaking = False
    vad.queue([SPEECH_END])
    await orch.process_frame(FRAME)
    hold = orch._hold_task
    if hold is not None:
        await hold

    kinds = _types(events)
    assert "final" not in kinds
    rejected = [e for e in events if e["type"] == "rejected"]
    assert rejected and rejected[0]["reason"] == "self_echo"


@pytest.mark.asyncio
async def test_a_person_talking_over_the_tail_still_gets_through(
    monkeypatch,
) -> None:
    floor = _FakeFloor(spoken=["Маршрут прокладено через Сокільники."])
    orch, vad, events = _make_orch(
        floor=floor,
        partials=[PartialEvent(text="постав", stability=1)],
        final_text="постав таймер на десять хвилин",
        monkeypatch=monkeypatch,
    )

    vad.queue([SPEECH_START])
    await orch.process_frame(FRAME)
    floor._speaking = False
    vad.queue([SPEECH_END])
    await orch.process_frame(FRAME)
    hold = orch._hold_task
    if hold is not None:
        await hold

    finals = [e for e in events if e["type"] == "final"]
    assert finals and finals[0]["transcript"] == "постав таймер на десять хвилин"


@pytest.mark.asyncio
async def test_the_winner_of_the_floor_is_not_judged_twice(monkeypatch) -> None:
    """Репліка, що виграла перехоплення, вже довела, що вона не ехо —
    повторна перевірка на закритті викинула б справжні слова людини."""
    floor = _FakeFloor(spoken=["Повторіть будь ласка адресу."])
    orch, vad, events = _make_orch(
        floor=floor,
        partials=[PartialEvent(text="ні", stability=1)],
        final_text="повторіть будь ласка адресу",
        monkeypatch=monkeypatch,
    )

    vad.queue([SPEECH_START])
    await orch.process_frame(FRAME)
    assert "barge_in_commit" in _types(events)
    vad.queue([SPEECH_END])
    await orch.process_frame(FRAME)
    hold = orch._hold_task
    if hold is not None:
        await hold

    finals = [e for e in events if e["type"] == "final"]
    assert finals and finals[0]["transcript"] == "повторіть будь ласка адресу"


@pytest.mark.asyncio
async def test_silence_of_the_speaker_leaves_the_utterance_alone(
    monkeypatch,
) -> None:
    """Без озвучки перевірки на ехо немає взагалі — інакше чужа фраза,
    схожа на давню відповідь, зникала б без сліду."""
    floor = _FakeFloor(spoken=["Маршрут прокладено."], speaking=False)
    orch, vad, events = _make_orch(
        floor=floor,
        partials=[PartialEvent(text="маршрут", stability=1)],
        final_text="маршрут прокладено",
        monkeypatch=monkeypatch,
    )

    vad.queue([SPEECH_START])
    await orch.process_frame(FRAME)
    assert "barge_in_duck" not in _types(events)
    vad.queue([SPEECH_END])
    await orch.process_frame(FRAME)
    hold = orch._hold_task
    if hold is not None:
        await hold

    finals = [e for e in events if e["type"] == "final"]
    assert finals and finals[0]["transcript"] == "маршрут прокладено"


# ── Через команду WS, як воно й приходить із браузера ────────────────────────


@pytest.mark.asyncio
async def test_mic_duck_command_no_longer_deafens_the_pc(monkeypatch) -> None:
    """Той самий шлях, яким браузер повідомляє про озвучку: раніше після
    нього VAD не бачив жодного кадру."""
    from api.routes_voice_stream import _VoiceSession
    from config import config

    monkeypatch.setattr(config, "voice_mic_duck_on_tts", False)

    sent: list[str] = []

    class _WS:
        async def send_text(self, payload: str) -> None:
            sent.append(payload)

    floor = _FakeFloor(spoken=["Маршрут прокладено."])
    orch, vad, _events = _make_orch(floor=floor, monkeypatch=monkeypatch)
    session = _VoiceSession(_WS(), "user-1", "client-1")  # type: ignore[arg-type]
    await session.attach_orchestrator(orch)

    await session.handle_command('{"cmd": "mic_duck"}')
    vad.queue([SPEECH_START])
    await session.handle_binary(FRAME)

    assert any("speech_start" in payload for payload in sent), (
        "кадр зник дорогою — ПК знову глухий на час озвучки"
    )
    assert any("barge_in_duck" in payload for payload in sent)
    assert orch.is_ducked is False
    assert orch.tts_active is True


@pytest.mark.asyncio
async def test_the_fallback_regime_is_still_one_key_away(monkeypatch) -> None:
    from api.routes_voice_stream import _VoiceSession
    from config import config

    monkeypatch.setattr(config, "voice_mic_duck_on_tts", True)

    class _WS:
        async def send_text(self, _payload: str) -> None:
            return None

    floor = _FakeFloor(spoken=["Маршрут прокладено."])
    orch, vad, events = _make_orch(floor=floor, monkeypatch=monkeypatch)
    session = _VoiceSession(_WS(), "user-1", "client-1")  # type: ignore[arg-type]
    await session.attach_orchestrator(orch)

    await session.handle_command('{"cmd": "mic_duck"}')
    assert orch.is_ducked is True

    vad.queue([SPEECH_START])
    await session.handle_binary(FRAME)
    assert "speech_start" not in _types(events)


@pytest.mark.asyncio
async def test_a_client_that_never_says_it_finished_is_not_believed_forever(
    monkeypatch,
) -> None:
    """Вкладку закрили посеред відповіді — `mic_unduck` не надійде вже ніколи."""
    floor = _FakeFloor(spoken=["Маршрут прокладено."], speaking=False)
    orch, _vad, _events = _make_orch(floor=floor, monkeypatch=monkeypatch)

    await orch.set_tts_active(True)
    assert orch.tts_active is True

    await orch.reset()
    assert orch.tts_active is False


@pytest.mark.asyncio
async def test_shutdown_leaves_no_task_running(monkeypatch) -> None:
    floor = _FakeFloor(spoken=["Маршрут прокладено."])
    orch, vad, _events = _make_orch(floor=floor, monkeypatch=monkeypatch)

    vad.queue([SPEECH_START])
    await orch.process_frame(FRAME)
    task = orch._barge_task
    assert task is not None

    await orch.shutdown()
    await asyncio.sleep(0)
    assert task.cancelled() or task.done()
    assert orch._barge_task is None
