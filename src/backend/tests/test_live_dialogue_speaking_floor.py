"""Голосів два — важіль один.

`SentenceSpeaker` озвучує відповідь у чаті, `_VoiceSession.say` дає агентові
заговорити самому. Вони не знають один про одного, і перехоплення, що спиняє
лише першого, лишає другого договорювати поверх людини.

Тут же перевіряється знімок сказаного: питати, що людина почула, ПІСЛЯ
знищення доріжки — означає дістати порожньо.
"""
from __future__ import annotations

import asyncio
import os

import pytest

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-floor")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-api-key-for-tests")

from voice.speaking_floor import SpeakingFloor, UserFloor  # noqa: E402

USER = "user-floor"


def _capture(
    monkeypatch,
    *,
    blocking: bool = False,
    engine: str = "supertonic",
    on_sentence=None,
    on_synth=None,
) -> tuple[list[tuple[str, dict]], list[asyncio.Event]]:
    """Підміняє синтез і мовлення в ефір; повертає, що саме пішло назовні."""
    broadcasts: list[tuple[str, dict]] = []
    gates: list[asyncio.Event] = []

    class _Result:
        def __init__(self) -> None:
            self.engine = engine
            self.audio_wav = b"RIFF"
            self.sample_rate = 16_000
            self.voice = "ua"

    async def _synth(_text, voice, speed):
        if on_synth is not None:
            on_synth(voice, speed)
        if blocking:
            gate = asyncio.Event()
            gates.append(gate)
            await gate.wait()
        return _Result()

    async def _broadcast(_user: str, type_: str, payload: dict) -> None:
        broadcasts.append((type_, payload))
        if type_ == "tts.sentence" and on_sentence is not None:
            on_sentence()

    from voice import incremental_tts
    import voice.pipeline as pipeline
    monkeypatch.setattr(incremental_tts, "_broadcast", _broadcast)
    monkeypatch.setattr(pipeline, "synthesize_text", _synth)
    monkeypatch.setattr(pipeline, "voice_for_text", lambda _t: "ua")

    from config import config as cfg
    monkeypatch.setattr(cfg, "voice_tts_enabled", True)
    return broadcasts, gates


# ── Реєстр сам по собі ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_one_lever_stops_every_voice() -> None:
    floor = SpeakingFloor()
    stopped: list[str] = []

    async def _stop_a(reason: str) -> None:
        stopped.append(f"a:{reason}")

    async def _stop_b(reason: str) -> None:
        stopped.append(f"b:{reason}")

    floor.open(USER, "chat", _stop_a)
    floor.open(USER, "agent", _stop_b)
    assert floor.is_speaking(USER)

    await floor.stop(USER, "barge_in")

    assert stopped == ["a:barge_in", "b:barge_in"]
    assert not floor.is_speaking(USER)


@pytest.mark.asyncio
async def test_a_stopper_that_throws_does_not_leave_a_ghost_speaker() -> None:
    """Інакше користувач лишався б «мовцем» назавжди, і мікрофон — глухим."""
    floor = SpeakingFloor()
    reached: list[str] = []

    async def _explodes(_reason: str) -> None:
        raise RuntimeError("синтез уже помер")

    async def _works(reason: str) -> None:
        reached.append(reason)

    floor.open(USER, "broken", _explodes)
    floor.open(USER, "fine", _works)

    await floor.stop(USER, "barge_in")

    assert reached == ["barge_in"]
    assert not floor.is_speaking(USER)


@pytest.mark.asyncio
async def test_what_is_in_the_air_is_what_was_broadcast() -> None:
    floor = SpeakingFloor()

    async def _stop(_reason: str) -> None:
        return None

    floor.open(USER, "chat", _stop)
    floor.note(USER, "chat", "Маршрут прокладено.")
    floor.note(USER, "chat", "Виїзд за десять хвилин.")

    assert floor.recent(USER) == [
        "Маршрут прокладено.", "Виїзд за десять хвилин.",
    ]
    floor.close(USER, "chat")
    assert floor.recent(USER) == []


@pytest.mark.asyncio
async def test_the_question_outlives_the_turn_that_asked_it() -> None:
    """Швидка смуга спирається на «PHANTOM щойно спитав» — а хід, у якому
    він спитав, на той момент уже закритий."""
    floor = SpeakingFloor()

    async def _stop(_reason: str) -> None:
        return None

    floor.open(USER, "chat", _stop)
    floor.note(USER, "chat", "Який саме маршрут?")
    floor.close(USER, "chat")

    assert floor.last_was_question(USER)


def test_empty_lines_are_not_speech() -> None:
    floor = SpeakingFloor()
    floor._voices.setdefault(USER, {})
    floor.note(USER, "chat", "   ")
    assert floor.last_was_question(USER) is False
    assert floor.recent(USER) == []


# ── Обидва справжні шляхи озвучки ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_the_chat_voice_registers_and_a_barge_in_silences_it(
    monkeypatch,
) -> None:
    from voice import incremental_tts
    from voice.speaking_floor import speaking_floor

    broadcasts: list[tuple[str, dict]] = []

    async def _fake_broadcast(_user: str, type_: str, payload: dict) -> None:
        broadcasts.append((type_, payload))

    class _Result:
        engine = "supertonic"
        audio_wav = b"RIFF"
        sample_rate = 16_000

    async def _fake_synth(_text, _voice, _speed):
        return _Result()

    monkeypatch.setattr(incremental_tts, "_broadcast", _fake_broadcast)
    import voice.pipeline as pipeline
    monkeypatch.setattr(pipeline, "synthesize_text", _fake_synth)
    monkeypatch.setattr(pipeline, "voice_for_text", lambda _t: "ua")

    speaker = incremental_tts.SentenceSpeaker("u1", "m1", "s1")
    speaker.start()
    try:
        await speaker.feed("Маршрут прокладено. Виїзд за десять хвилин. ")
        for _ in range(20):
            await asyncio.sleep(0)
            if len(speaking_floor.recent("u1")) >= 2:
                break

        assert speaking_floor.is_speaking("u1")
        # Знімок беруть у мить обриву, до знищення доріжки.
        in_the_air = speaking_floor.recent("u1")
        assert in_the_air == ["Маршрут прокладено.", "Виїзд за десять хвилин."]

        await UserFloor(speaking_floor, "u1").stop("barge_in")

        assert not speaking_floor.is_speaking("u1")
        assert speaking_floor.recent("u1") == [], "після обриву питати вже пізно"
        stops = [p for t, p in broadcasts if t == "tts.stop"]
        assert stops and stops[0]["reason"] == "barge_in"
    finally:
        await speaker.cancel(notify=False)


@pytest.mark.asyncio
async def test_a_barge_in_cuts_the_agent_off_mid_reply(monkeypatch) -> None:
    """Проактивна репліка агента — той самий важіль, що й відповідь у чаті.
    Досі вона їхала цілою брилою, якої не міг спинити ніхто."""
    from agent.actions.base import ActionContext
    from agent.actions.voice_say import VoiceSay
    from voice import incremental_tts
    from voice.speaking_floor import speaking_floor

    broadcasts, gates = _capture(monkeypatch, blocking=True)
    ctx = ActionContext(
        task_id="t-1", step_idx=0, workspace_dir="/tmp", user_id="u2",
    )
    task = asyncio.create_task(
        VoiceSay(text="Перше речення. Друге речення.", force=True).execute(ctx)
    )
    for _ in range(50):
        await asyncio.sleep(0)
        if speaking_floor.is_speaking("u2") and gates:
            break
    assert speaking_floor.is_speaking("u2"), "агент не зареєстрував свій голос"

    await UserFloor(speaking_floor, "u2").stop("barge_in")
    gates[0].set()
    result = await asyncio.wait_for(task, timeout=5)

    assert len(gates) == 1, "синтез другого речення навіть не починався"
    sentences = [p for t, p in broadcasts if t == "tts.sentence"]
    assert [p["text"] for p in sentences] == []
    assert any(t == "tts.stop" for t, _ in broadcasts)
    assert result.ok is False
    assert result.output["interrupted"] is True
    assert not speaking_floor.is_speaking("u2")
    assert incremental_tts._ACTIVE.get("u2") is None


@pytest.mark.asyncio
async def test_the_agent_declares_its_words_to_the_echo_filter(
    monkeypatch,
) -> None:
    """Без цього власний голос PHANTOM повертається з мікрофона й лягає в
    чат як слова оператора."""
    from agent.actions.base import ActionContext
    from agent.actions.voice_say import VoiceSay
    from voice.self_echo import is_probable_echo
    from voice.speaking_floor import speaking_floor

    seen: list[list[str]] = []
    broadcasts, _ = _capture(monkeypatch, on_sentence=lambda: seen.append(
        speaking_floor.recent("u4")
    ))
    ctx = ActionContext(
        task_id="t-2", step_idx=0, workspace_dir="/tmp", user_id="u4",
    )
    result = await VoiceSay(
        text="Маршрут прокладено через Сокільники.", force=True,
    ).execute(ctx)

    assert result.ok is True
    assert result.output["sentences_spoken"] == 1
    # Те, що лунало, було видиме реєстрові ще під час озвучки.
    assert seen and seen[-1] == ["Маршрут прокладено через Сокільники."]
    assert is_probable_echo("маршрут прокладено через", seen[-1])
    assert not speaking_floor.is_speaking("u4")


@pytest.mark.asyncio
async def test_a_reminder_does_not_cut_the_operator_off(monkeypatch) -> None:
    """Підлога зайнята — нагадування чекає наступного тику, а не ріже
    відповідь на півслові."""
    from agent.actions.base import ActionContext
    from agent.actions.voice_say import VoiceSay
    from voice.speaking_floor import speaking_floor

    broadcasts, _ = _capture(monkeypatch)

    async def _stop(_reason: str) -> None:
        return None

    speaking_floor.open("u5", "chat", _stop)
    try:
        ctx = ActionContext(
            task_id="t-3", step_idx=0, workspace_dir="/tmp", user_id="u5",
        )
        result = await VoiceSay(text="Нагадування.", force=True).execute(ctx)
    finally:
        speaking_floor.close("u5", "chat")

    assert result.ok is False
    assert result.output["reason"] == "voice_busy"
    assert broadcasts == [], "жодного звуку поверх відповіді"


@pytest.mark.asyncio
async def test_the_agent_never_claims_a_silence_it_produced(
    monkeypatch,
) -> None:
    """Синтез не вдався — дія мусить сказати про це, а не «spoke: …»."""
    from agent.actions.base import ActionContext
    from agent.actions.voice_say import VoiceSay

    broadcasts, _ = _capture(monkeypatch, engine="silent")
    ctx = ActionContext(
        task_id="t-4", step_idx=0, workspace_dir="/tmp", user_id="u6",
    )
    result = await VoiceSay(text="Тихо.", force=True).execute(ctx)

    assert result.ok is False
    assert result.output["sentences_spoken"] == 0
    assert result.side_effects == []
    assert [t for t, _ in broadcasts if t == "tts.sentence"] == []


@pytest.mark.asyncio
async def test_the_voice_override_reaches_the_synthesizer(monkeypatch) -> None:
    """Поле оголошене в схемі дії — воно мусить щось робити."""
    from agent.actions.base import ActionContext
    from agent.actions.voice_say import VoiceSay

    asked: list[tuple[str, float]] = []
    _capture(monkeypatch, on_synth=lambda v, s: asked.append((v, s)))
    ctx = ActionContext(
        task_id="t-5", step_idx=0, workspace_dir="/tmp", user_id="u7",
    )
    await VoiceSay(
        text="Тест.", voice="en_US-amy", speed=1.5, force=True,
    ).execute(ctx)

    assert asked == [("en_US-amy", 1.5)]
