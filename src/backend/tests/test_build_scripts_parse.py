"""Скрипти збірки мусять розбиратися оболонкою — включно з коментарями.

29.08.2026 контейнерна збірка двічі впала з «npm ci: немає
package-lock.json», хоча файл лежав на місці й читався, а npm писав свій
журнал у ХОСТОВИЙ шлях, якого в контейнері не існує. Причина знайшлась не
в npm і не в томах:

    docker run … bash -c '
        …
        # модулі, а в target — обʼєктні файли, …
        …
    '

Внутрішній скрипт передається в контейнер усередині одинарних лапок, а в
українському слові стояв звичайний апостроф. Він закрив лапки достроково —
і залишок скрипта пішов виконуватись НА ХОСТІ. Симптом виліз за три кроки
від причини.

Це третій за один день випадок, коли текст, написаний як пояснення, став
частиною механізму (перші два: сторожі, що падали на коментарях, які
пояснювали прибране). У цьому проєкті прийнято писати густі коментарі
українською — отже кожне місце, де текст потрапляє в оболонку, мусить це
витримувати, а не покладатись на те, що автор згадає про апостроф.

ЧОГО ЦЕЙ СТОРОЖ НЕ БАЧИТЬ:
* `bash -n` перевіряє РОЗБІР, а не поведінку. Скрипт може розібратись і
  робити не те; це не його питання.
* Він не заходить у вкладені лапки глибше, ніж це робить сам bash: якщо
  всередині рядка лежить синтаксично коректний, але змістовно хибний
  фрагмент — сторож промовчить.
* Він нічого не знає про `sh`/`zsh`; перевіряє тим bash, що є в системі.
"""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parents[2].parent / "scripts"


def _shell_scripts() -> list[Path]:
    if not SCRIPTS.is_dir():
        return []
    out = [p for p in SCRIPTS.glob("*.sh") if p.is_file()]
    return sorted(out)


@pytest.mark.parametrize("script", _shell_scripts(), ids=lambda p: p.name)
def test_shell_script_parses(script: Path):
    bash = shutil.which("bash")
    if not bash:
        pytest.skip("bash недоступний")

    proc = subprocess.run(
        [bash, "-n", str(script)], capture_output=True, text=True, timeout=60
    )
    assert proc.returncode == 0, (
        f"{script.name} не розбирається оболонкою:\n{proc.stderr.strip()}\n"
        "Найчастіша причина в цьому дереві — звичайний апостроф в "
        "українському коментарі всередині одинарних лапок "
        "(«обʼєктні» пишемо через U+02BC, не через ')."
    )


_INNER_MARK = "bash -euo pipefail -c"


def _inner_bodies(script: Path) -> list[str]:
    """Тіла вкладених `bash -c \'…\'`, які виконуються В КОНТЕЙНЕРІ.

    Для зовнішньої оболонки таке тіло — просто рядок, тож `bash -n` по файлу
    його НЕ розбирає. Саме там 30.08 удруге за два дні зламався скрипт: у
    слові «нав\'язане» стояв звичайний апостроф, він закрив лапки, і зовнішній
    розбір це помітив лише випадково — бо решта рядка теж стала кодом.
    Якби залишок склався в синтаксично коректний фрагмент, файл розібрався б
    зелено, а в контейнер поїхало б не те.
    """
    text = script.read_text()
    out: list[str] = []
    at = 0
    while True:
        m = text.find(_INNER_MARK, at)
        if m < 0:
            return out
        open_q = text.find("\'", m)
        if open_q < 0:
            return out
        close_q = text.find("\n  \'", open_q)
        if close_q < 0:
            return out
        out.append(text[open_q + 1 : close_q])
        at = close_q + 1


@pytest.mark.parametrize("script", _shell_scripts(), ids=lambda p: p.name)
def test_inner_container_body_parses(script: Path, tmp_path: Path):
    """Те, що поїде в контейнер, мусить розбиратись саме по собі."""
    bash = shutil.which("bash")
    if not bash:
        pytest.skip("bash недоступний")

    bodies = _inner_bodies(script)
    if not bodies:
        pytest.skip(f"у {script.name} немає вкладеного `bash -c`")

    for i, body in enumerate(bodies):
        f = tmp_path / f"{script.stem}-inner-{i}.sh"
        f.write_text(body)
        proc = subprocess.run(
            [bash, "-n", str(f)], capture_output=True, text=True, timeout=60
        )
        assert proc.returncode == 0, (
            f"тіло вкладеного `bash -c` №{i} у {script.name} не "
            f"розбирається:\n{proc.stderr.strip()}\n"
            "Зовнішній `bash -n` цього не бачить — для нього це рядок."
        )


def test_there_are_scripts_to_check():
    """Щоб порожній перелік не читався як зелений результат."""
    assert _shell_scripts(), (
        f"у {SCRIPTS} немає жодного .sh — або шлях змінився, і тоді цей "
        "сторож мовчки перестав щось стерегти"
    )
