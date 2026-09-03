"""Вузол мусить казати те, що СПРАВДІ зібрано, а не літерал у коді.

Три голоси, три різні числа — виміряно 03.09.2026 на живому стенді:
  `/healthz`          → "0.19.0-jarvis-online"   (літерал в observability.py)
  `/health`           → "0.1.0"                  (літерал у main.py)
  `tauri.conf.json`   → "0.20.0"                 (те, що бачить людина)
Жоден із трьох не був повʼязаний із тим, що зібрано. Скарга «в мене
зламалось на версії N» була недоказовою за побудовою: невідомо, яку саме
версію бачив той, хто скаржиться.

При цьому `scripts/build_sidecar.sh` уже клав у бандл справжній паспорт —
`build_info.json` із комітом, dirty, версією й часом. Його не читав НІХТО.
Паспорт без читача — це той самий клас, що «написане й не викликане».

Сторожі тримають три речі:
  * паспорт із бандла ЧИТАЄТЬСЯ (і разом із ним — коміт та dirty);
  * без паспорта версія береться з дерева, а не вигадується;
  * у коді не лишилось зашитих номерів версії.
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

import pytest

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-build-info")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-key")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")

BACKEND = Path(__file__).resolve().parent.parent


@pytest.fixture(autouse=True)
def _fresh_cache():
    """Паспорт кешується на процес — інакше перший тест зафіксував би
    відповідь для решти."""
    from build_info import build_info

    build_info.cache_clear()
    yield
    build_info.cache_clear()


def test_a_bundled_passport_is_actually_read(tmp_path, monkeypatch):
    """Те, заради чого все: паспорт, покладений збіркою, доходить назовні."""
    (tmp_path / "build_info.json").write_text(
        json.dumps(
            {
                "component": "sidecar",
                "commit": "d1cffa6abc",
                "dirty": False,
                "version": "9.9.9-test",
                "built_at": "2026-09-03T19:00:00Z",
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(sys, "_MEIPASS", str(tmp_path), raising=False)

    from build_info import build_info

    info = build_info()

    assert info["version"] == "9.9.9-test"
    assert info["commit"] == "d1cffa6abc"
    assert info["dirty"] is False
    assert info["source"] == "bundle", (
        "джерело мусить бути назване: «0.20.0» з дерева розробника не "
        "відрізнити від «0.20.0» зі справжнього пакунка інакше"
    )


def test_a_dirty_build_says_so(tmp_path, monkeypatch):
    """`dirty` — головне поле паспорта: саме воно відрізняє реліз від
    «зібрано з недописаного дерева»."""
    (tmp_path / "build_info.json").write_text(
        json.dumps({"commit": "abc", "dirty": True, "version": "0.20.0"}),
        encoding="utf-8",
    )
    monkeypatch.setattr(sys, "_MEIPASS", str(tmp_path), raising=False)

    from build_info import build_info

    assert build_info()["dirty"] is True


def test_without_a_passport_the_version_comes_from_the_tree_not_thin_air(
    monkeypatch,
):
    monkeypatch.delattr(sys, "_MEIPASS", raising=False)

    from build_info import build_info

    info = build_info()

    assert info["source"] == "tauri.conf.json"
    assert re.match(r"^\d+\.\d+\.\d+", info["version"]), info["version"]
    # Невідоме позначаємо, а не вигадуємо: у дереві розробника «чисто» не
    # доведене, тож dirty тут None, а не False.
    assert info["dirty"] is None


def test_a_broken_passport_does_not_take_the_node_down(tmp_path, monkeypatch):
    """Версія потрібна саме тоді, коли щось пішло не так."""
    (tmp_path / "build_info.json").write_text("{це не json", encoding="utf-8")
    monkeypatch.setattr(sys, "_MEIPASS", str(tmp_path), raising=False)

    from build_info import build_info

    assert build_info()["version"]


def test_health_carries_commit_and_dirty(monkeypatch):
    """Сайт бере версію з політики сервера; без цих полів сайт і продукт
    називали б різні версії, і звірити їх не міг би ніхто."""
    monkeypatch.delattr(sys, "_MEIPASS", raising=False)

    from fastapi.testclient import TestClient

    from main import app

    body = TestClient(app).get("/health").json()

    assert "build" in body, "/health мовчить про те, що зібрано"
    for field in ("version", "commit", "dirty", "source"):
        assert field in body["build"], f"паспорт без поля {field}"
    assert body["version"] == body["build"]["version"]


def test_no_version_literals_left_in_the_code():
    """Сторож на саму ваду: доки номер зашитий рядком, він розійдеться з
    тим, що зібрано, — і ми цього знову не помітимо."""
    offenders: list[str] = []
    for path in (BACKEND / "main.py", BACKEND / "observability.py"):
        for num, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            code = line.split("#", 1)[0]
            # Тільки ПРИСВОЄННЯ версії: інакше сторож ловить IP-адреси
            # (127.0.0.1) і сам стає причиною червоного.
            if re.search(r'version\s*[=:]\s*"\d+\.\d+\.\d+', code):
                offenders.append(f"{path.name}:{num}: {line.strip()[:70]}")
    assert not offenders, (
        "версія зашита літералом замість паспорта збірки:\n" + "\n".join(offenders)
    )
