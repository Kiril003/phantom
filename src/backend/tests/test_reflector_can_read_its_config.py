"""Крок міркування агента падав NameError на кожному виклику.

Знайдено 04.09.2026 у скрині: `agent/cognition/planner/reflector.py:96`
читає `config.ai_reflector_model`, а `config` у тому модулі не імпортовано
взагалі. Тобто КОЖЕН виклик `reflect()` кидав `NameError: name 'config' is
not defined`, і в лозі це виглядало як «agent loop crash for task …» — не
як відсутній імпорт, а як загадкове падіння петлі. Сусідні модулі
(`_llm.py`, `tactical.py`) імпортують `config` правильно; розійшовся рівно
один файл, і ніхто цього не бачив, бо скриня не добігала до кінця.

Про ФОРМУ цього сторожа — окремо, бо вона теж коштувала уроку.

Спершу я написала розумну перевірку: розбір AST кожного модуля
планувальника, пошук імен, до яких код звертається через крапку, але яких у
модулі немає. Вона **двічі збрехала**. Спершу зеленим — я обходила вузол
присвоєння разом із ПРАВОЮ частиною, тож `data = f(config.x)` клала
`config` у «присвоєні», і сторож не червонів на тій самій ваді, заради якої
писався (зняла імпорт — 14 зелених). Потім червоним — оголосила дірками
`_inspect` (локальний імпорт у функції), `db`, `o`, `sg` (змінні включень).

Тому розумну перевірку прибрано. Лишились дві прості, які можуть
почервоніти й не вміють збрехати. Складний сторож, що двічі сказав
неправду, гірший за два простих.
"""
from __future__ import annotations

import importlib
import os
import pathlib

import pytest

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-reflector-config")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-key")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")

PLANNER = (
    pathlib.Path(__file__).resolve().parent.parent
    / "agent" / "cognition" / "planner"
)
MODULES = sorted(p.stem for p in PLANNER.glob("*.py") if p.stem != "__init__")


@pytest.mark.parametrize("name", MODULES)
def test_planner_module_imports_cleanly(name):
    importlib.import_module(f"agent.cognition.planner.{name}")


def test_reflector_has_the_config_it_reads():
    """Точна вада, без узагальнень: модуль ЧИТАЄ `config.ai_reflector_model`,
    тож `config` мусить бути в його просторі імен."""
    from agent.cognition.planner import reflector

    assert hasattr(reflector, "config"), (
        "у reflector немає `config`, хоч рядок 96 його читає — кожен виклик "
        "reflect() падатиме NameError, а в лозі це виглядатиме як "
        "«agent loop crash for task …», тобто вести розбір не туди"
    )
    assert reflector.config.ai_reflector_model, (
        "поле моделі рефлектора порожнє — читати його немає сенсу"
    )


def test_the_line_that_crashed_is_still_the_one_we_guard():
    """Сторож привʼязаний до КОНКРЕТНОГО читання. Якщо його приберуть,
    ця перевірка перестане щось означати — хай тоді впаде й скаже про це."""
    source = (PLANNER / "reflector.py").read_text(encoding="utf-8")
    assert "config.ai_reflector_model" in source, (
        "reflector більше не читає config.ai_reflector_model — сторож вище "
        "стереже те, чого немає; перепиши його під теперішній код"
    )
