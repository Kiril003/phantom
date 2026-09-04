"""Жоден файл тестів не сміє зникнути зі збирання мовчки.

Правило народилось із двох незалежних випадків за добу, і обидва однакові:

  * ПК (03.09, ця сесія): `tests/test_phase09_4b_proactive_stash.py` імпортував
    клас, якого вже немає, а `tests/test_messenger_drop_road.py` мав байтовий
    літерал із кирилицею — SyntaxError. Кожен ОКРЕМО рвав збирання pytest, і
    прогін закінчувався на нулі виконаних тестів. Три поверхи мовчання:
    скриня не збиралась, під нею стояли зняті замки безпеки, а під ними —
    сліпі сторожі. Ніхто не бачив нічого.
  * Телефон (01.09-04.09, знахідка штабу): тести модуля ліцензій не
    компілювались три доби. Модуль просто ЗНИК із переліку задач, а звіти
    сумлінно перелічували інші — і виглядали зеленими.

Спільне: коли зникає сам ФАКТ перевірки, звіт не червоніє. Він коротшає.
А скорочення звіту не помічає ніхто.

Тому цей сторож не перевіряє поведінку продукту взагалі. Він перевіряє, що
КОЖЕН файл тестів у дереві досі можна зібрати — тобто що перелік перевірок
не всох мовчки. Перше число будь-якого прогону — «зібрано N з M», і саме
його треба читати раніше за passed/failed.
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent
TESTS = BACKEND / "tests"


def test_the_suite_still_has_the_files_it_thinks_it_has():
    """Дешева половина: файли на диску є і читаються."""
    files = sorted(TESTS.glob("test_*.py"))
    assert len(files) > 300, (
        f"у дереві лишилось {len(files)} файлів тестів — перевірки зникають "
        "цілими пачками, і це видно тільки якщо рахувати їх окремо"
    )


def test_every_test_file_can_actually_be_collected():
    """Головна половина: pytest МОЖЕ зібрати кожен файл.

    Саме тут ловляться обидва випадки з докстрінга: зниклий символ в
    імпорті й синтаксична помилка. Обидва не червонять свій файл — вони
    забирають його зі звіту разом із усім, що йшло після.
    """
    env = dict(os.environ)
    env["PHANTOM_SKIP_G2_WARMUP"] = "1"
    env["PYTHONPATH"] = str(BACKEND)

    run = subprocess.run(
        [
            sys.executable, "-m", "pytest", "tests/",
            "--collect-only", "-q",
            "--continue-on-collection-errors",
            "-p", "no:cacheprovider",
        ],
        cwd=str(BACKEND),
        env=env,
        capture_output=True,
        text=True,
        timeout=600,
    )

    tail = (run.stdout or "")[-4000:]
    errors = [
        line for line in tail.splitlines()
        if line.startswith("ERROR ") or "error" in line.lower() and "collecting" in line.lower()
    ]
    assert not errors, (
        "ці файли НЕ ЗБИРАЮТЬСЯ — їхні тести зникли зі звіту, не почервонівши:\n"
        + "\n".join(errors[:10])
    )


def test_collection_reports_a_number_we_can_read():
    """Звіт мусить називати, СКІЛЬКИ зібралось. Порожній прогін і повний
    виглядають однаково зеленими, доки цього числа немає."""
    env = dict(os.environ)
    env["PHANTOM_SKIP_G2_WARMUP"] = "1"
    env["PYTHONPATH"] = str(BACKEND)

    run = subprocess.run(
        [
            sys.executable, "-m", "pytest", "tests/",
            "--collect-only", "-q",
            "--continue-on-collection-errors",
            "-p", "no:cacheprovider",
        ],
        cwd=str(BACKEND),
        env=env,
        capture_output=True,
        text=True,
        timeout=600,
    )
    collected = len([l for l in (run.stdout or "").splitlines() if "::" in l])
    assert collected > 3000, (
        f"зібрано лише {collected} тестів — або дерево всохло, або збирання "
        "знову тихо обривається на першому зламаному файлі"
    )
