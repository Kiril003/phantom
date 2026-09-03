"""Міграція, що застосувалась і не записалась, гірша за міграцію, що впала.

Виміряно 03.09.2026 на базі стенда, під час живого циклу сховку:

    $ alembic upgrade head
    INFO  Running upgrade c7d19f4a2e81 -> a7c31f0b95e2, paired device mesh keys
    exit=0
    $ sqlite3 … 'select version_num from alembic_version'
    c7d19f4a2e81        ← стара ревізія

Три колонки СПРАВДІ зʼявились у `paired_devices`, а версія лишилась старою.
База пішла в півстан, і мовчки: наступний `upgrade head` спробував би додати
ті самі колонки вдруге й упав би на «duplicate column name» — а виглядало б
це як зламана міграція, а не як незакомічений стан.

Механіка. У SQLAlchemy 2.x `engine.connect()` відкриває транзакцію, яку на
виході ВІДКОЧУЮТЬ, якщо не закомітити. DDL у SQLite alembic робить поза
транзакцією («Will assume non-transactional DDL»), тому схема доїжджала, а
запис версії — звичайний UPDATE усередині тієї транзакції — зникав разом із
нею. `env.py` не мав `await connection.commit()`.

Сторож тримає обидва боки: і сам рядок у джерелі, і поведінку на справжній
тимчасовій базі — бо джерело можна переписати інакше, а поведінка мусить
лишитись.
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent
ENV_PY = BACKEND / "db" / "alembic" / "env.py"


def test_the_async_path_commits_its_version_write():
    """Джерело: без коміту запис версії відкочується разом із транзакцією."""
    src = ENV_PY.read_text(encoding="utf-8")
    assert "await connection.commit()" in src, (
        "CLI-шлях міграцій не комітить — база лишиться в півстані: схема "
        "нова, версія стара, а наступний upgrade упаде на «duplicate column»"
    )


def test_a_real_upgrade_records_its_revision(tmp_path):
    """Поведінка на справжній базі: після `upgrade head` версія мусить
    ЧИТАТИСЬ назад. Саме цього не перевіряв ніхто — і саме тому півстан
    прожив непоміченим."""
    import sqlite3

    db = tmp_path / "probe.db"
    env = dict(os.environ)
    env["PHANTOM_DATABASE_URL"] = f"sqlite+aiosqlite:///{db}"
    env["DATABASE_URL"] = f"sqlite+aiosqlite:///{db}"
    env["PHANTOM_SKIP_G2_WARMUP"] = "1"
    env["PYTHONPATH"] = str(BACKEND)

    run = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=str(BACKEND),
        env=env,
        capture_output=True,
        text=True,
        timeout=280,
    )
    if run.returncode != 0:
        pytest.skip(f"alembic не піднявся в цьому середовищі: {run.stderr[-200:]}")
    if not db.is_file():
        pytest.skip("змінна адреси бази не підхопилась — перевіряти нічого")

    con = sqlite3.connect(db)
    try:
        rows = con.execute("select version_num from alembic_version").fetchall()
    except sqlite3.OperationalError:
        pytest.fail(
            "після успішного upgrade таблиці версій немає — міграція "
            "застосувалась і не записалась"
        )
    finally:
        con.close()

    assert rows and rows[0][0], (
        "upgrade віддав 0, а версія в базі порожня — рівно той півстан, "
        "через який наступний upgrade падає на «duplicate column»"
    )
