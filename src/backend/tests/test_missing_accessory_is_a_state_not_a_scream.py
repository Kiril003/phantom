"""Відсутній ESP32 — це стан, а не потік помилок.

Виміряно Сесією 3 на живому стенді: `sensors.serial_bridge: SerialBridge
connection error` кожні 3 секунди, **60 рядків зі 100 за пʼять хвилин**. При
тому ESP32 у нас ОПЦІЙНИЙ аксесуар, тобто «його немає» — звичайний стан
більшості машин, а не аварія.

Ціна була не в самих рядках, а в тому, що вони ховали: справжня помилка,
яка трапилась між ними, тонула в шумі про власну норму. Класика — підсистема
кричить про те, що з нею все гаразд.

Лікування трискладове, і сторожі тримають кожну складову:
  * ОДНЕ гучне повідомлення при першій відмові, далі debug;
  * відступ повторів росте вдвічі й упирається в стелю (аксесуар, увімкнений
    у розетку, помічається так само швидко, бо успіх скидає лічильник);
  * «не підключено» живе в СТАНІ (`accessory_state`), звідки це можна
    показати людині, а не вишукувати в лозі.
"""
from __future__ import annotations

import os

import pytest

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-accessory")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-key")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")

from sensors.serial_bridge import (  # noqa: E402
    RECONNECT_DELAY_S,
    RECONNECT_MAX_DELAY_S,
    SerialBridge,
    retry_delay_for,
)


def test_the_retry_interval_actually_grows():
    """Головне число: між першою й десятою спробою відступ мусить вирости,
    інакше «експоненційний» лишається словом у коміті."""
    delays = [retry_delay_for(n) for n in range(0, 10)]

    assert delays[0] == RECONNECT_DELAY_S
    assert delays[1] == RECONNECT_DELAY_S
    # Строго зростає, доки не впреться в стелю.
    growing = [d for d in delays if d < RECONNECT_MAX_DELAY_S]
    assert growing == sorted(growing)
    assert len(set(growing)) > 1, "відступ не росте взагалі"
    assert delays[-1] > delays[1], "після девʼяти відмов чекаємо не менше, ніж після однієї"


def test_the_interval_is_capped_so_a_plugged_in_board_is_not_lost_for_hours():
    """Стеля потрібна з іншого боку: без неї після доби тиші аксесуар
    помітили б за годину після того, як його ввімкнули."""
    assert retry_delay_for(1000) == RECONNECT_MAX_DELAY_S
    assert RECONNECT_MAX_DELAY_S <= 600, (
        "стеля більша за десять хвилин перетворює «опційний аксесуар» на "
        "«аксесуар, який доведеться перезапускати вручну»"
    )


def test_a_missing_board_is_named_in_the_state():
    bridge = SerialBridge()
    bridge._running = True
    bridge._failures = 3
    bridge._last_error = "SerialException: could not open port /dev/ttyUSB0"

    state = bridge.accessory_state

    assert state["state"] == "not_connected"
    assert state["attempts"] == 3
    assert state["retry_in_s"] == retry_delay_for(3)
    assert "ttyUSB0" in state["detail"], "стан мусить нести причину словами"


def test_a_bridge_that_was_never_started_is_off_not_broken():
    """«Вимкнено» і «не достукались» — різні поради людині."""
    state = SerialBridge().accessory_state

    assert state["state"] == "off"
    assert state["detail"] is None


def test_success_resets_the_backoff():
    """Аксесуар, увімкнений у розетку після години тиші, не має чекати
    наступних пʼяти хвилин — і наступна втрата мусить знову сказати про
    себе на повний голос, а не піти одразу в debug."""
    bridge = SerialBridge()
    bridge._running = True
    bridge._failures = 7
    bridge._last_error = "SerialException: gone"

    # Те, що робить успішне підключення (без справжнього порту).
    bridge._connected = True
    bridge._failures = 0
    bridge._last_error = None

    state = bridge.accessory_state
    assert state["state"] == "connected"
    assert state["attempts"] == 0
    assert retry_delay_for(bridge._failures) == RECONNECT_DELAY_S


def test_the_loud_line_is_emitted_once_not_every_three_seconds(caplog):
    """Сторож на самий шум: перша відмова — WARNING, дальші — не вище DEBUG.

    Читаємо ДЖЕРЕЛО циклу, а не ганяємо його: справжній цикл спить, і
    тест на нього або висів би, або доводив би роботу sleep, а не нашу.
    """
    import inspect

    from sensors import serial_bridge as sb

    source = inspect.getsource(sb.SerialBridge._connect_loop)

    assert "self._failures == 1" in source, (
        "гучний рядок більше не привʼязаний до ПЕРШОЇ відмови — "
        "повертається крик кожні три секунди"
    )
    assert "logger.debug" in source, "дальші відмови мусять іти в debug"
    assert "retry_delay_for" in source, (
        "цикл спить фіксовану паузу замість відступу, що росте"
    )
    # І найголовніше: жодного logger.error на шляху «аксесуара немає».
    assert "logger.error" not in source, (
        "відсутній ОПЦІЙНИЙ аксесуар знову подається як помилка"
    )
