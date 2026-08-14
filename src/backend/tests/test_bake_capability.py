"""Стеля машини мусить бути поміряна, і невідоме мусить її опускати.

«Чи витримає ПК» було надією. Тут воно стає перевіркою — але перевірка,
що при сумніві каже «так», гірша за її відсутність: вона обіцяє країну
машині, яка не витягне й міста.
"""
from __future__ import annotations

import asyncio

import pytest

from geo.bake_capability import (
    BAKE_SCOPES,
    Measurement,
    _nearest_existing,
    measure_available_ram,
    measure_free_disk,
    offered_scope,
    probe_bake_capability,
    probe_docker,
)

_GIB = 1024 ** 3

BIG_DISK = Measurement(200 * _GIB, True, "/data")
BIG_RAM = Measurement(32 * _GIB, True, "psutil")
DOCKER_OK = Measurement(1, True, "демон відповів: 27.1")
DOCKER_DOWN = Measurement(0, True, "Cannot connect to the Docker daemon")
UNKNOWN = Measurement(None, False, "не вдалося прочитати")


def test_a_strong_machine_is_offered_the_country():
    verdict = offered_scope(disk=BIG_DISK, ram=BIG_RAM, docker=DOCKER_OK)
    assert verdict["scope"] == "country"
    assert verdict["scope_ua"] == "країна"


def test_no_docker_stops_at_oblast_and_says_so():
    verdict = offered_scope(disk=BIG_DISK, ram=BIG_RAM, docker=DOCKER_DOWN)
    assert verdict["scope"] == "oblast"
    assert any("docker" in b for b in verdict["blockers"])


def test_a_small_disk_stops_at_city():
    verdict = offered_scope(
        disk=Measurement(6 * _GIB, True, "/data"), ram=BIG_RAM, docker=DOCKER_OK
    )
    assert verdict["scope"] == "city"
    assert any("область" in b for b in verdict["blockers"])


def test_a_machine_below_the_floor_is_offered_nothing():
    verdict = offered_scope(
        disk=Measurement(1 * _GIB, True, "/data"),
        ram=Measurement(512 * 1024 * 1024, True, "psutil"),
        docker=DOCKER_DOWN,
    )
    assert verdict["scope"] == "none"
    assert verdict["scope_ua"] == "нічого"
    assert verdict["blockers"], "відмовили без жодної причини"


def test_unmeasurable_disk_degrades_downward_never_upward():
    """Не поміряли — значить не обіцяємо. Найнебезпечніша гілка в модулі."""
    verdict = offered_scope(disk=UNKNOWN, ram=BIG_RAM, docker=DOCKER_OK)
    assert verdict["scope"] == "none"
    assert any("не поміряно" in b for b in verdict["blockers"])


def test_unmeasurable_ram_degrades_downward():
    verdict = offered_scope(disk=BIG_DISK, ram=UNKNOWN, docker=DOCKER_OK)
    assert verdict["scope"] == "none"


def test_unmeasurable_docker_only_costs_the_scope_that_needs_it():
    verdict = offered_scope(disk=BIG_DISK, ram=BIG_RAM, docker=UNKNOWN)
    assert verdict["scope"] == "oblast", "невідомий docker не має валити всі обсяги"


def test_scopes_are_ordered_so_a_bigger_scope_never_asks_for_less():
    disks = [s[2] for s in BAKE_SCOPES]
    rams = [s[3] for s in BAKE_SCOPES]
    assert disks == sorted(disks)
    assert rams == sorted(rams)


def test_the_verdict_is_labelled_an_estimate():
    """Скільки RAM їсть збирання графа на всю Україну — ще ніхто не міряв."""
    assert offered_scope(disk=BIG_DISK, ram=BIG_RAM, docker=DOCKER_OK)["estimate"] is True


def test_disk_is_measured_on_the_filesystem_the_packs_would_live_on(tmp_path):
    """Не «/». У користувача може бути крихітний root і великий /home."""
    target = tmp_path / "ще" / "не" / "створено"
    m = measure_free_disk(target)
    assert m.measured is True
    assert m.value is not None and m.value > 0
    assert _nearest_existing(target) == tmp_path


def test_a_path_with_no_existing_ancestor_is_not_guessed(monkeypatch):
    m = measure_free_disk_from_broken_root(monkeypatch)
    assert m.measured is False
    assert m.value is None


def measure_free_disk_from_broken_root(monkeypatch) -> Measurement:
    import geo.bake_capability as mod

    monkeypatch.setattr(mod, "_nearest_existing", lambda _p: None)
    return mod.measure_free_disk(mod.Path("/цього/немає"))


def test_ram_measurement_is_available_not_installed():
    m = measure_available_ram()
    assert m.measured is True
    assert m.value is not None and m.value > 0
    try:
        import psutil
    except ImportError:
        return
    vm = psutil.virtual_memory()
    assert m.value <= vm.total, "доступна памʼять не може бути більшою за встановлену"


async def test_docker_is_probed_by_attempting_it_not_by_finding_a_binary(monkeypatch):
    """Бінарник на місці, демон лежить — `which docker` каже «є», ми кажемо «ні»."""
    import geo.bake_capability as mod

    class _Proc:
        returncode = 1

        async def communicate(self):
            return b"", b"Cannot connect to the Docker daemon at unix:///var/run/docker.sock"

    async def _spawn(*_a, **_kw):
        return _Proc()

    monkeypatch.setattr(mod.asyncio, "create_subprocess_exec", _spawn)
    m = await probe_docker()
    assert m.measured is True
    assert m.value == 0
    assert "Cannot connect" in m.detail


async def test_a_missing_docker_binary_is_a_measurement_not_a_failure(monkeypatch):
    import geo.bake_capability as mod

    async def _spawn(*_a, **_kw):
        raise FileNotFoundError("docker")

    monkeypatch.setattr(mod.asyncio, "create_subprocess_exec", _spawn)
    m = await probe_docker()
    assert m.measured is True and m.value == 0


async def test_a_hung_docker_daemon_does_not_hang_the_endpoint(monkeypatch):
    import geo.bake_capability as mod

    class _Proc:
        returncode = None

        async def communicate(self):
            await asyncio.sleep(3600)

        def kill(self):
            return None

        async def wait(self):
            return 0

    async def _spawn(*_a, **_kw):
        return _Proc()

    monkeypatch.setattr(mod.asyncio, "create_subprocess_exec", _spawn)
    monkeypatch.setattr(mod, "_DOCKER_PROBE_TIMEOUT_S", 0.05)
    m = await asyncio.wait_for(probe_docker(), timeout=5)
    assert m.value == 0 and m.measured is True


async def test_the_endpoint_answers_with_a_named_scope(auth_root_client):
    resp = auth_root_client.get("/api/v1/bake/capability")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["scope"] in {"none", "city", "oblast", "country"}
    assert body["scope_ua"] in {"нічого", "місто", "область", "країна"}
    assert body["measured"]["disk"]["measured"] is True
    assert body["measured"]["ram"]["measured"] is True
    assert body["measured"]["docker"]["measured"] in (True, False)
    assert {s["id"] for s in body["scopes"]} == {"city", "oblast", "country"}


async def test_the_endpoint_needs_auth(unauth_client):
    assert unauth_client.get("/api/v1/bake/capability").status_code in (401, 403)


async def test_the_probe_reports_the_path_it_actually_measured(tmp_path):
    body = await probe_bake_capability(tmp_path / "packs")
    assert body["measured"]["disk"]["path"] == str(tmp_path)
