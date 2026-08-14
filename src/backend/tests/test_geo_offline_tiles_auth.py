"""Офлайн-регіони мапи роздавались без жодної перевірки.

`GET /map/offline/tiles/{region_id}.pmtiles` брав тільки `region_id` і `request`,
тоді як усі три сусідні маршрути в тому ж файлі несуть `Depends(require_auth)`.
Застосунок слухає на LAN, тож будь-хто в тій самій мережі міг перелічити й
викачати завантажені оператором регіони.

Range тут не декорація: pmtiles читає архів саме діапазонами, тому «з автентифікацією
досі працює» треба доводити на 206, а не лише на 200.
"""
from __future__ import annotations

import os

import pytest

import api.routes_geo_offline as routes_geo_offline
from geo.pmtiles_manager import PMTilesManager

# 127 байт заголовка PMTiles v3 + впізнаваний хвіст, щоб бачити, що саме віддали.
BODY = b"PMTiles\x03" + bytes(range(120)) + b"KYIV-OBLAST-TAIL"


@pytest.fixture
def offline_mgr(tmp_path, monkeypatch) -> PMTilesManager:
    mgr = PMTilesManager(str(tmp_path / "offline"))
    monkeypatch.setattr(routes_geo_offline, "_mgr", mgr)
    return mgr


def _write_region(mgr: PMTilesManager, region_id: str = "kyiv_oblast") -> str:
    path = os.path.join(mgr.data_dir, f"{region_id}.pmtiles")
    with open(path, "wb") as fh:
        fh.write(BODY)
    return path


URL = "/api/v1/map/offline/tiles/kyiv_oblast.pmtiles"


# ── Без токена ──────────────────────────────────────────────────────────────


async def test_unauthenticated_request_is_rejected(unauth_client, offline_mgr):
    _write_region(offline_mgr)

    res = unauth_client.get(URL)

    assert res.status_code in (401, 403)
    # Читаємо тіло: 401 із файлом усередині — це не відмова.
    assert b"KYIV-OBLAST-TAIL" not in res.content


async def test_unauthenticated_range_request_is_rejected(unauth_client, offline_mgr):
    """Саме так pmtiles і стукає — заголовком Range, а не цілим файлом."""
    _write_region(offline_mgr)

    res = unauth_client.get(URL, headers={"Range": "bytes=0-15"})

    assert res.status_code in (401, 403)
    assert res.status_code != 206
    assert BODY[:16] not in res.content


async def test_unauthenticated_request_cannot_even_probe_existence(unauth_client, offline_mgr):
    """Для невідомого регіону відповідь мусить бути та сама, що для відомого —
    інакше 404 vs 401 самі перелічують, що оператор завантажив."""
    _write_region(offline_mgr)

    known = unauth_client.get(URL)
    unknown = unauth_client.get("/api/v1/map/offline/tiles/nemaye_takogo.pmtiles")

    assert known.status_code == unknown.status_code


# ── З токеном ───────────────────────────────────────────────────────────────


async def test_authenticated_request_still_serves_the_whole_file(auth_root_client, offline_mgr):
    _write_region(offline_mgr)

    res = auth_root_client.get(URL)

    assert res.status_code == 200
    assert res.content == BODY
    assert res.headers["accept-ranges"] == "bytes"
    assert res.headers["content-length"] == str(len(BODY))


async def test_authenticated_range_request_still_returns_206(auth_root_client, offline_mgr):
    _write_region(offline_mgr)

    res = auth_root_client.get(URL, headers={"Range": "bytes=0-15"})

    assert res.status_code == 206
    assert res.content == BODY[:16]
    assert res.headers["content-range"] == f"bytes 0-15/{len(BODY)}"
    assert res.headers["content-length"] == "16"


async def test_authenticated_tail_range_still_works(auth_root_client, offline_mgr):
    """Відкритий кінець `bytes=N-` — теж із репертуару pmtiles."""
    _write_region(offline_mgr)
    start = len(BODY) - 16

    res = auth_root_client.get(URL, headers={"Range": f"bytes={start}-"})

    assert res.status_code == 206
    assert res.content == b"KYIV-OBLAST-TAIL"


async def test_authenticated_request_for_a_missing_region_is_404(auth_root_client, offline_mgr):
    res = auth_root_client.get("/api/v1/map/offline/tiles/nemaye_takogo.pmtiles")

    assert res.status_code == 404
