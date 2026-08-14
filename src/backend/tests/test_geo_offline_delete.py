"""Видалення офлайн-регіону мусить прибирати файл, а не рапортувати про намір.

Ендпойнт `DELETE /map/offline/regions/{id}` повертав `{"ok": true}` і не
торкався диска: `PMTilesManager.delete_region` існував і не мав жодного
виклику. Тому кожна перевірка тут читає стан НАЗАД через менеджер і через
файлову систему — сам по собі `ok` і був тим, що ендпойнт уже вмів.
"""
from __future__ import annotations

import os

import pytest

import api.routes_geo_offline as routes_geo_offline
from geo.pmtiles_manager import PMTilesManager


@pytest.fixture
def offline_mgr(tmp_path, monkeypatch) -> PMTilesManager:
    """Менеджер над тимчасовою текою замість справжнього сховища Radxa."""
    mgr = PMTilesManager(str(tmp_path / "offline"))
    monkeypatch.setattr(routes_geo_offline, "_mgr", mgr)
    return mgr


def _write_region(mgr: PMTilesManager, region_id: str) -> str:
    path = os.path.join(mgr.data_dir, f"{region_id}.pmtiles")
    with open(path, "wb") as fh:
        fh.write(b"PMTiles\x03" + b"\x00" * 119)
    return path


async def test_delete_removes_the_region_from_disk(auth_root_client, offline_mgr):
    path = _write_region(offline_mgr, "kyiv_oblast")
    assert offline_mgr.get_region("kyiv_oblast") is not None

    res = auth_root_client.delete("/api/v1/map/offline/regions/kyiv_oblast")

    assert res.status_code == 200
    assert res.json()["ok"] is True
    # Читаємо назад: якщо файл на місці, `ok` був брехнею.
    assert not os.path.exists(path)
    assert offline_mgr.get_region("kyiv_oblast") is None
    assert [r.id for r in offline_mgr.list_regions()] == []


async def test_delete_leaves_the_other_regions_alone(auth_root_client, offline_mgr):
    _write_region(offline_mgr, "kyiv_oblast")
    keep = _write_region(offline_mgr, "lviv_oblast")

    auth_root_client.delete("/api/v1/map/offline/regions/kyiv_oblast")

    assert os.path.exists(keep)
    assert [r.id for r in offline_mgr.list_regions()] == ["lviv_oblast"]


async def test_delete_of_unknown_region_is_404_not_ok(auth_root_client, offline_mgr):
    res = auth_root_client.delete("/api/v1/map/offline/regions/nemaye_takogo")

    assert res.status_code == 404
    assert res.json().get("ok") is not True


async def test_region_id_cannot_escape_the_offline_directory(auth_root_client, offline_mgr, tmp_path):
    """`region_id` іде просто в шлях. Поки видалення нічого не робило, це було
    нешкідливо; з живим `os.remove` це вже стирання чужих файлів."""
    outsider = tmp_path / "chuzhyi.pmtiles"
    outsider.write_bytes(b"PMTiles")

    assert offline_mgr.delete_region("../chuzhyi") is False
    assert offline_mgr.get_region("../chuzhyi") is None
    assert outsider.exists()

    res = auth_root_client.delete("/api/v1/map/offline/regions/..%2Fchuzhyi")

    assert res.status_code in (400, 404)
    assert outsider.exists()


async def test_delete_requires_auth(unauth_client, offline_mgr):
    path = _write_region(offline_mgr, "kyiv_oblast")

    res = unauth_client.delete("/api/v1/map/offline/regions/kyiv_oblast")

    assert res.status_code in (401, 403)
    assert os.path.exists(path)
