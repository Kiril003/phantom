"""Порожньо поруч і мовчить джерело — це різні відповіді.

Знайдено Сесією 3 на живому стенді, з логом: `/api/v1/map/nearby` віддавав
200 і `{"remembered": [], "osm": [], "pois": []}`, а поруч у тому ж лозі
стояло `agent.localization.adapters.overpass: Overpass query failed: All
connection attempts failed`. Скло не мало ЖОДНОГО способу відрізнити «тут
справді нічого немає» від «джерело не відповіло» — і чесно малювало
«ОКОЛИЦІ · ДАНИХ НЕМАЄ». Відмова, вбрана в порожній успіх.

Причина була закладена свідомо й описана в докстрінгу маршруту: «any error
returns an empty slice for that source rather than raising». Намір
правильний — один мовчазний адаптер не має валити всю відповідь. Ціна
намеру не була сплачена: назовні не їхало нічого, крім порожнечі.

Тому сторож тримає МЕЖУ HTTP, а не внутрішню функцію: адаптер кидає —
у тілі відповіді мусить бути `osm_status: "unreachable"`, а не порожній
"ok". І навпаки: вимкнене джерело мусить називатись "disabled", бо
«вимкнено оператором» і «не достукались» ведуть людину в різні боки.
"""
from __future__ import annotations

import os

import pytest

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-nearby-status")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-key")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")

KYIV = {"lat": 50.4501, "lon": 30.5234, "radius_m": 500}


def _nearby(client) -> dict:
    res = client.get("/api/v1/map/nearby", params=KYIV)
    assert res.status_code == 200, res.text
    return res.json()


def test_silent_overpass_is_named_not_an_empty_success(
    auth_root_client, monkeypatch
):
    """Адаптер кидає — стан мусить сказати про це словом."""
    from config import config

    monkeypatch.setattr(config, "agent_overpass_enabled", True)

    class _Dead:
        async def features_near(self, *a, **kw):
            raise ConnectionError("All connection attempts failed")

    import agent.localization.adapters.overpass as ov

    monkeypatch.setattr(ov, "get_default_overpass", lambda: _Dead())

    body = _nearby(auth_root_client)

    assert body["osm"] == []
    assert body["osm_status"] == "unreachable", (
        "мовчазний Overpass віддав порожній успіх — скло знову не відрізнить "
        "«нічого немає» від «джерело не відповіло»"
    )
    assert body["osm_detail"], "стан мусить нести причину, а не лише ярлик"
    assert "All connection attempts failed" in body["osm_detail"]


def test_disabled_source_is_not_called_unreachable(auth_root_client, monkeypatch):
    """«Вимкнено оператором» і «не достукались» ведуть людину в різні боки:
    перше лікується перемикачем, друге — мережею."""
    from config import config

    monkeypatch.setattr(config, "agent_overpass_enabled", False)

    body = _nearby(auth_root_client)

    assert body["osm"] == []
    assert body["osm_status"] == "disabled"
    assert body["osm_detail"] is None


def test_a_working_source_says_ok_and_carries_its_finds(
    auth_root_client, monkeypatch
):
    """Зворотний бік: коли джерело відповіло, стан не має лякати."""
    from config import config

    monkeypatch.setattr(config, "agent_overpass_enabled", True)

    class _Feature:
        osm_id = 1
        name = "Кав'ярня"
        type = "cafe"
        lat = 50.4502
        lon = 30.5235
        tags: dict = {}
        distance_m = 12

    class _Live:
        async def features_near(self, *a, **kw):
            return [_Feature()]

    import agent.localization.adapters.overpass as ov

    monkeypatch.setattr(ov, "get_default_overpass", lambda: _Live())

    body = _nearby(auth_root_client)

    assert body["osm_status"] == "ok"
    assert body["osm_detail"] is None
    assert [f["name"] for f in body["osm"]] == ["Кав'ярня"]


def test_geocode_does_not_call_an_outage_nothing_found(
    auth_root_client, monkeypatch
):
    """Та сама вада, знайдена поруч у тому ж файлі, і дорожча за першу.

    `/map/geocode` віддавав `{"results": []}` на будь-який збій геокодера —
    докстрінг прямо казав «the caller shows "нічого не знайдено"». Але
    людина, яка ввела адресу й дістала «нічого не знайдено», ПОЧИНАЄ
    ДІЯТИ: перевіряє написання, скорочує запит, шукає інакше. Тобто
    неправда про джерело перетворюється на змарнований час людини.
    """
    class _Dead:
        async def geocode(self, *a, **kw):
            raise ConnectionError("Nominatim unreachable")

    import agent.localization.adapters.nominatim as nom

    monkeypatch.setattr(nom, "get_default_nominatim", lambda: _Dead())

    res = auth_root_client.post("/api/v1/map/geocode", json={"query": "Хрещатик 1"})
    assert res.status_code == 200, res.text
    body = res.json()

    assert body["results"] == []
    assert body["status"] == "unreachable", (
        "мовчазний геокодер знову подається як «нічого не знайдено»"
    )
    assert "Nominatim unreachable" in body["detail"]


def test_geocode_says_ok_when_it_really_found_nothing(
    auth_root_client, monkeypatch
):
    """Зворотний бік: справжня порожнеча мусить лишитись порожнечею."""
    class _Empty:
        async def geocode(self, *a, **kw):
            return []

    import agent.localization.adapters.nominatim as nom

    monkeypatch.setattr(nom, "get_default_nominatim", lambda: _Empty())

    body = auth_root_client.post(
        "/api/v1/map/geocode", json={"query": "цього немає ніде"}
    ).json()

    assert body["results"] == []
    assert body["status"] == "ok"
    assert body["detail"] is None


def test_every_slice_carries_a_status(auth_root_client, monkeypatch):
    """Скло мусить питати стан однаково в усіх трьох джерел, а не памʼятати,
    у якого з них він буває."""
    from config import config

    monkeypatch.setattr(config, "agent_overpass_enabled", False)

    body = _nearby(auth_root_client)

    for slice_name in ("remembered", "osm", "pois"):
        assert f"{slice_name}_status" in body, (
            f"{slice_name} їде без стану — саме так і зʼявляється порожнеча, "
            "про яку не можна нічого спитати"
        )
