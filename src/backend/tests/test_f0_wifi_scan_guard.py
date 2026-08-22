"""Ф0: geo/wifi_scan.py на цій гілці ВІДСУТНІЙ — а чотири закомічені виклики
є (routes_map: /map/wifi_scan, /map/here, /map/wifi_observe; routes_symbiote:
_learn_from_phone_radio). До guard'а кожен з них 500-ив голим ImportError.

Файл свідомо НЕ дописуємо — він має повернутися з rescue-гілки після вердикту
власника. Ці тести фіксують чесну поведінку за його відсутності:

  * три HTTP-шляхи → 503 з тілом «сканер відсутній на цій гілці»;
  * /here відмовляє ДО запису точки (жодної пів-зробленої роботи);
  * фонове донавчання симбіота пропускає пакет видимо-в-лозі,
    не валячи телефонний виклик.

Якщо wifi_scan.py колись приїде — тести скажуть про це skip'ом,
а не фальшивим червоним.
"""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

REFUSAL = "сканер відсутній на цій гілці"


def _scanner_present() -> bool:
    try:
        import geo.wifi_scan  # noqa: F401
        return True
    except ImportError:
        return False


pytestmark = pytest.mark.skipif(
    _scanner_present(),
    reason="geo/wifi_scan.py приїхав з rescue-гілки — guard більше не активний",
)


def _client() -> TestClient:
    from main import app

    return TestClient(app)


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _location_history_count() -> int:
    from sqlalchemy import func, select

    from db.database import AsyncSessionLocal
    from db.models import LocationHistory

    async with AsyncSessionLocal() as s:
        return (
            await s.execute(select(func.count()).select_from(LocationHistory))
        ).scalar_one()


def test_wifi_scan_returns_503_not_500(auth_root_token) -> None:
    resp = _client().get("/api/v1/map/wifi_scan", headers=_auth(auth_root_token))
    assert resp.status_code == 503
    assert resp.json()["detail"] == REFUSAL


def test_here_returns_503_and_writes_nothing(auth_root_token) -> None:
    """Відмова мусить бути атомарною: точка оператора НЕ лягає в історію,
    коли радіо-частину виконати нічим — інакше успіх на вигляд і
    пів-роботи по суті."""
    before = asyncio.run(_location_history_count())

    resp = _client().post(
        "/api/v1/map/here",
        json={"lat": 50.4501, "lon": 30.5234, "accuracy_m": 15.0},
        headers=_auth(auth_root_token),
    )
    assert resp.status_code == 503
    assert resp.json()["detail"] == REFUSAL

    after = asyncio.run(_location_history_count())
    assert after == before, "503 не має лишати по собі записаних рядків"


def test_wifi_observe_returns_503_not_500(auth_root_token) -> None:
    resp = _client().post(
        "/api/v1/map/wifi_observe",
        json={"lat": 50.4501, "lon": 30.5234, "accuracy_m": 25.0},
        headers=_auth(auth_root_token),
    )
    assert resp.status_code == 503
    assert resp.json()["detail"] == REFUSAL


@pytest.mark.asyncio
async def test_symbiote_radio_learn_swallows_missing_scanner() -> None:
    """Фоновий шлях: жодного raise — телефонний виклик, що приніс пакет
    радіо, не має 500-ити через відсутній на гілці файл. Guard повертає
    керування ДО будь-якого звернення до БД чи presence_store, що й
    доводить db=None."""
    from api.routes_symbiote import _learn_from_phone_radio

    device = SimpleNamespace(user_id="u-test", id="d-test")
    await _learn_from_phone_radio(None, device, "AABBCCDDEEFF,-60")
