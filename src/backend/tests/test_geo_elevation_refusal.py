"""Висота — це вимір, а не число, яке можна порахувати з координат.

`ElevationService.get_elevation` повертав `150.0 + (sin(lat*100) + cos(lon*100)) * 50.0`
і віддавав це трьома публічними шляхами як дані: `GET /map/elevation`,
`POST /map/elevation/profile` і дію агента `map.get_elevation_profile`. Число
було детерміноване, правдоподібне і повністю вигадане — тобто саме той клас
дефекту, який нічого не кидає і виглядає працюючим.

Кожна перевірка тут читає ВІДПОВІДЬ, а не факт «виклик не впав»: відмова
мусить бути видимою назовні, інакше вона нічим не краща за вигадку.
"""
from __future__ import annotations

import pytest

from agent.actions.base import ActionContext
from agent.actions.map.get_elevation_profile import MapGetElevationProfile
from geo.elevation import (
    ELEVATION_UNAVAILABLE,
    ElevationService,
    ElevationUnavailable,
)

KYIV = (50.4501, 30.5234)
LVIV = (49.8397, 24.0297)


class _FakeDem:
    """Джерело, яке справді щось знає — щоб довести, що відмова не вічна стіна."""

    def __init__(self, value: float = 187.5) -> None:
        self.value = value
        self.calls: list[tuple[float, float]] = []

    async def sample(self, lat: float, lon: float) -> float:
        self.calls.append((lat, lon))
        return self.value


def _ctx() -> ActionContext:
    return ActionContext(task_id="t-elev", step_idx=0, workspace_dir="/tmp")


# ── Сам сервіс ───────────────────────────────────────────────────────────────


async def test_service_without_dem_refuses_a_single_point():
    with pytest.raises(ElevationUnavailable):
        await ElevationService().get_elevation(*KYIV)


async def test_service_without_dem_refuses_a_profile():
    with pytest.raises(ElevationUnavailable):
        await ElevationService().get_profile([KYIV, LVIV])


async def test_default_singleton_has_no_source():
    """Синглтон, яким користуються всі три шляхи, не має джерела."""
    from geo.elevation import get_elevation_service

    assert get_elevation_service().available is False


async def test_with_a_dem_the_service_answers():
    dem = _FakeDem(187.5)
    svc = ElevationService(source=dem)

    assert svc.available is True
    assert await svc.get_elevation(*KYIV) == 187.5

    dem.calls.clear()
    profile = await svc.get_profile([KYIV, LVIV])
    assert [s.elevation_m for s in profile] == [187.5, 187.5]
    # Відстань між Києвом і Львовом ≈ 470 км — профіль лишився справжнім.
    assert profile[0].distance_m == 0.0
    assert 460_000 < profile[1].distance_m < 480_000
    assert dem.calls == [KYIV, LVIV]


# ── HTTP: GET /map/elevation ────────────────────────────────────────────────


async def test_get_elevation_refuses_instead_of_answering(auth_root_client):
    res = auth_root_client.get("/api/v1/map/elevation", params={"lat": KYIV[0], "lon": KYIV[1]})

    assert res.status_code == 503
    body = res.json()
    # Найважливіше твердження файлу: у відповіді немає висоти.
    assert "elevation_m" not in body
    assert body["detail"] == ELEVATION_UNAVAILABLE
    assert "Даних про висоту немає" in body["detail"]


async def test_get_elevation_refuses_everywhere_not_just_kyiv(auth_root_client):
    """Стара формула давала різні числа для різних точок; відмова — однакова."""
    for lat, lon in (KYIV, LVIV, (46.4825, 30.7233)):
        res = auth_root_client.get("/api/v1/map/elevation", params={"lat": lat, "lon": lon})
        assert res.status_code == 503, (lat, lon)
        assert "elevation_m" not in res.json()


# ── HTTP: POST /map/elevation/profile ───────────────────────────────────────


async def test_post_profile_refuses_instead_of_drawing_a_ridge(auth_root_client):
    res = auth_root_client.post(
        "/api/v1/map/elevation/profile",
        json={"points": [list(KYIV), list(LVIV)]},
    )

    assert res.status_code == 503
    body = res.json()
    assert "profile" not in body
    assert body["detail"] == ELEVATION_UNAVAILABLE


async def test_post_profile_still_validates_input_before_refusing(auth_root_client):
    """Одна точка — це не шлях; 422 мусить лишитись 422, а не стати 503."""
    res = auth_root_client.post("/api/v1/map/elevation/profile", json={"points": [list(KYIV)]})

    assert res.status_code == 422


# ── Дія агента ──────────────────────────────────────────────────────────────


async def test_agent_action_refuses_so_the_assistant_cannot_read_out_a_height():
    action = MapGetElevationProfile(points=[list(KYIV), list(LVIV)])

    result = await action.execute(_ctx())

    assert result.ok is False
    assert result.error == ELEVATION_UNAVAILABLE
    assert result.error_class == "ElevationUnavailable"
    # Жодних зразків у виході — асистенту нема чого переказати як число.
    assert result.output is None


async def test_agent_action_returns_a_usable_output_when_a_dem_exists(monkeypatch):
    """Гілка успіху ніколи не працювала: `build_map_output` вимагає `mutation`,
    а виклик його не передавав — тобто TypeError на кожному запуску."""
    import geo.elevation as elevation_mod

    monkeypatch.setattr(elevation_mod, "_service", ElevationService(source=_FakeDem(210.0)))

    result = await MapGetElevationProfile(points=[list(KYIV), list(LVIV)]).execute(_ctx())

    assert result.ok is True
    assert result.output["map_mutation"]["op"] == "narrate"
    samples = result.output["extras"]["samples"]
    assert [s["elevation_m"] for s in samples] == [210.0, 210.0]
