"""
Фаза 9.4b — ініціативна петля не перебиває зайняту людину.

Три поведінки, кожна жива й сьогодні:
  1) людина щойно щось робила (< 1,5 хв) і думка не термінова (priority < 8)
     — вголос НЕ кажемо, думку відкладаємо;
  2) priority >= 8 проходить попри зайнятість — термінове не відкладають;
  3) щойно людина відійшла — відкладене вимовляється й черга чиститься.

Чому файл переписано (03.09): він імпортував `StashedProactive` і
`loop._stashed` — списку в памʼяті самої петлі. Відкладання давно
переїхало в `memory.session_memory` (`defer_thought` / `get_deferred_thoughts`),
класу не стало, і **весь бекендовий прогін падав на збиранні** через цей
один імпорт: жоден тест бекенда не виконувався взагалі. Сторож лишається,
бо поведінка справжня — саме тут уже ховалась вада, коли думки парковались,
лунав earcon `thought_parked`, і не спливало нічого.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone

import pytest

from agent.cognition.proactive.loop import ProactiveLoop
from memory.session_memory import session_memory

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase094b-stash")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-key")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")

SESSION = "session-phase094b"


def _utcnow() -> datetime:
    return datetime.now(tz=timezone.utc)


@pytest.fixture(autouse=True)
def _clean_session():
    """Черга відкладеного — синглтон на процес; лишити її брудною означає
    отруїти сусідні тести."""
    session_memory.clear_deferred_thoughts(SESSION)
    yield
    session_memory.clear_deferred_thoughts(SESSION)


def _loop(monkeypatch) -> ProactiveLoop:
    from agent.kernel.runtime import AgentRuntime

    loop = ProactiveLoop(AgentRuntime())

    async def session_id() -> str:
        return SESSION

    monkeypatch.setattr(loop, "_most_recent_session_id", session_id)
    return loop


def _speech_sink(loop, monkeypatch) -> list[str]:
    said: list[str] = []

    async def fake_emit(msg, reason, priority, ctx, causality=""):
        said.append(msg)

    monkeypatch.setattr(loop, "_emit_speech", fake_emit)
    return said


@pytest.mark.asyncio
async def test_thought_deferred_while_user_is_focused(monkeypatch):
    """Людина зайнята, думка не термінова — мовчимо й відкладаємо."""
    loop = _loop(monkeypatch)

    async def ctx():
        return {
            "minutes_since_user": 0.5,
            "emotion": None,
            "triggers": [],
            "active_concerns": [],
        }

    async def decide(_ctx):
        return {
            "kind": "speak",
            "message": "відкладена думка",
            "reason": "test",
            "priority": 5,
        }

    monkeypatch.setattr(loop, "_build_context", ctx)
    monkeypatch.setattr(loop, "_should_consider_speaking", lambda c: True)
    monkeypatch.setattr(loop, "_decide", decide)
    said = _speech_sink(loop, monkeypatch)

    await loop._maybe_speak()

    assert said == []
    parked = session_memory.get_deferred_thoughts(SESSION)
    assert len(parked) == 1
    assert parked[0].content == "відкладена думка"
    assert parked[0].kind == "speak"


@pytest.mark.asyncio
async def test_urgent_speaks_even_if_user_is_focused(monkeypatch):
    """priority >= 8 не відкладають: термінове має право перебити."""
    loop = _loop(monkeypatch)

    async def ctx():
        return {"minutes_since_user": 0.5}

    async def decide(_ctx):
        return {"kind": "speak", "message": "термінове", "priority": 9}

    monkeypatch.setattr(loop, "_build_context", ctx)
    monkeypatch.setattr(loop, "_should_consider_speaking", lambda c: True)
    monkeypatch.setattr(loop, "_decide", decide)
    said = _speech_sink(loop, monkeypatch)

    await loop._maybe_speak()

    assert said == ["термінове"]
    assert session_memory.get_deferred_thoughts(SESSION) == []


@pytest.mark.asyncio
async def test_deferred_surfaces_when_user_steps_away(monkeypatch):
    """Людина відійшла — відкладене нарешті звучить, і черга чиститься.

    Саме ця ланка колись була мертвою: сторож на порожньому `_stashed`
    не пускав `_flush_stash` ніколи."""
    loop = _loop(monkeypatch)
    session_memory.defer_thought(
        session_id=SESSION,
        kind="speak",
        content="стара думка",
        priority=5,
        value=0.5,
        metadata={"reason": "r", "causality": "c"},
    )

    async def ctx():
        return {"minutes_since_user": 2.0}

    monkeypatch.setattr(loop, "_build_context", ctx)
    # Нової думки не буде — доводимо саме випуск відкладеного.
    monkeypatch.setattr(loop, "_should_consider_speaking", lambda c: False)
    said = _speech_sink(loop, monkeypatch)

    await loop._maybe_speak()

    assert any("стара думка" in m for m in said)
    assert session_memory.get_deferred_thoughts(SESSION) == []
