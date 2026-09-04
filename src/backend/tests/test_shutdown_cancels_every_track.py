"""Людина закрила вікно — вузол мусить вимкнутись, а не вдавати.

Виміряно Сесією 2 у воротах 04.09.2026: один прогін завис на **16 хвилин**
у `kill; wait`, і вузол писав у лог спроби ШІ ще **13 хвилин ПІСЛЯ SIGTERM**.
Оболонка шле саме SIGTERM, коли людина закриває застосунок — тобто людина
закривала PHANTOM, а він тримав памʼять, теку даних і порти ще чверть години.

ПРИЧИНА, знайдена читанням, а не здогадом (обидві половини потрібні):

1. `main.py` питав `agent_runtime.current_task is not None` — а це
   TRACK-ЗАЛЕЖНИЙ аксесор: він читає ContextVar `current_track`, який у
   контексті lifespan дорівнює "foreground" (`runtime.py:349-356`). Задача,
   що йшла ФОНОВОЮ доріжкою, робила умову хибною, і гачок вимкнення не
   спрацьовував ЖОДНОГО разу.
2. Навіть якби спрацював — `stop()` без `task_id` цілиться лише в передню
   доріжку (`runtime.py:1150-1168`). `background_runner` не скасовував ніхто.

Тобто цикл повторів до провайдера ШІ жив далі не тому, що «не слухає
скасування», а тому, що **скасування до нього не доходило**. Різниця
принципова: таймаут зверху лікував би симптом і лишив би причину.

Сторожі нижче тримають саме причину, не симптом.
"""
from __future__ import annotations

import asyncio
import inspect
import os
import pathlib

import pytest

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-shutdown")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-key")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")

BACKEND = pathlib.Path(__file__).resolve().parent.parent


@pytest.mark.asyncio
async def test_stop_all_cancels_the_background_runner_too():
    """Головне: фонова доріжка теж гаситься.

    Саме її ніхто не скасовував, і саме на ній жив цикл повторів ШІ.
    """
    from agent.kernel.runtime import AgentRuntime

    rt = AgentRuntime()
    started = asyncio.Event()

    async def never_ends():
        started.set()
        while True:               # цикл повторів у мініатюрі
            await asyncio.sleep(0.05)

    rt.background_runner = asyncio.create_task(never_ends())
    await started.wait()

    cancelled = await rt.stop_all(timeout_s=2.0)

    assert cancelled == 1, "фоновий бігун не потрапив під скасування"
    assert rt.background_runner.cancelled() or rt.background_runner.done(), (
        "фоновий бігун пережив вимкнення — вузол житиме після SIGTERM"
    )


@pytest.mark.asyncio
async def test_stop_all_cancels_both_tracks_at_once():
    from agent.kernel.runtime import AgentRuntime

    rt = AgentRuntime()

    async def never_ends():
        while True:
            await asyncio.sleep(0.05)

    rt.task_runner = asyncio.create_task(never_ends())
    rt.background_runner = asyncio.create_task(never_ends())
    await asyncio.sleep(0.05)

    assert await rt.stop_all(timeout_s=2.0) == 2


@pytest.mark.asyncio
async def test_shutdown_does_not_hang_on_a_task_that_ignores_cancellation():
    """Вимкнення не має права висіти. Задача, що ковтає CancelledError, —
    рідкість, але саме через неї ворота стояли 16 хвилин; тут межа своя."""
    from agent.kernel.runtime import AgentRuntime

    rt = AgentRuntime()

    async def stubborn():
        while True:
            try:
                await asyncio.sleep(0.05)
            except asyncio.CancelledError:
                pass  # свідомо ігнорує — найгірший випадок

    rt.background_runner = asyncio.create_task(stubborn())
    await asyncio.sleep(0.05)

    started = asyncio.get_event_loop().time()
    await rt.stop_all(timeout_s=0.5)
    elapsed = asyncio.get_event_loop().time() - started

    assert elapsed < 3.0, (
        f"вимкнення чекало {elapsed:.1f} с на задачу, яка ігнорує скасування — "
        "саме так зʼявляються шістнадцятихвилинні ворота"
    )
    rt.background_runner.cancel()


def test_the_shutdown_hook_no_longer_asks_a_track_dependent_question():
    """Сторож на джерело: доки гачок питає `current_task`, він сліпий до
    фонової доріжки — бо в контексті lifespan ContextVar каже "foreground"."""
    src = (BACKEND / "main.py").read_text(encoding="utf-8")
    code = "\n".join(line.split("#", 1)[0] for line in src.splitlines())

    assert "agent_runtime.stop_all()" in code, (
        "гачок вимкнення більше не гасить усі доріжки"
    )
    assert "agent_runtime.current_task is not None" not in code, (
        "гачок знову питає track-залежний current_task — на фоновій доріжці "
        "умова буде хибною, і вимкнення знову пропустить агента"
    )


def test_stop_all_exists_and_is_awaitable():
    from agent.kernel.runtime import AgentRuntime

    assert inspect.iscoroutinefunction(AgentRuntime.stop_all)
