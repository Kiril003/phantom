"""Стеля машини мусить бути поміряна, і невідоме мусить її опускати.

«Чи витримає ПК» було надією. Тут воно стає перевіркою — але перевірка,
що при сумніві каже «так», гірша за її відсутність: вона обіцяє країну
машині, яка не витягне й міста.

05.09.2026 звідси зник docker. Це не спрощення, а виправлення БРЕХНІ:
`needs_docker=True` на обсязі «країна» описував світ, у якому випікання
йде в контейнері, — а воно вже йде в самому процесі через pyosmium. Умова,
що вимагає того, чого код не питає, відмовляла б цілком спроможній машині
й називала б причиною демон, до якого випікання не звертається. Тести тут
переписані на те, що справді міряється: чи ЗАПУСКАЄТЬСЯ робітник.
"""
from __future__ import annotations

import asyncio
import json

import pytest

from geo.bake_capability import (
    BAKE_SCOPES,
    Measurement,
    _nearest_existing,
    bake_worker_argv,
    measure_available_ram,
    measure_free_disk,
    offered_scope,
    probe_bake_capability,
    probe_osmium,
    read_measured_peaks,
    required_ram,
)

_GIB = 1024 ** 3

BIG_DISK = Measurement(200 * _GIB, True, "/data")
BIG_RAM = Measurement(32 * _GIB, True, "psutil")
OSMIUM_OK = Measurement(1, True, "osmium з /bundle/osmium/__init__.py")
OSMIUM_BROKEN = Measurement(0, True, "ModuleNotFoundError: No module named 'osmium'")
UNKNOWN = Measurement(None, False, "не вдалося прочитати")


def test_a_strong_machine_is_offered_the_country():
    verdict = offered_scope(disk=BIG_DISK, ram=BIG_RAM, osmium=OSMIUM_OK)
    assert verdict["scope"] == "country"
    assert verdict["scope_ua"] == "країна"


def test_a_small_disk_stops_at_city():
    verdict = offered_scope(
        disk=Measurement(6 * _GIB, True, "/data"), ram=BIG_RAM, osmium=OSMIUM_OK
    )
    assert verdict["scope"] == "city"
    assert any("область" in b for b in verdict["blockers"])


def test_a_machine_below_the_floor_is_offered_nothing():
    verdict = offered_scope(
        disk=Measurement(1 * _GIB, True, "/data"),
        ram=Measurement(512 * 1024 * 1024, True, "psutil"),
        osmium=OSMIUM_BROKEN,
    )
    assert verdict["scope"] == "none"
    assert verdict["scope_ua"] == "нічого"
    assert verdict["blockers"], "відмовили без жодної причини"


def test_unmeasurable_disk_degrades_downward_never_upward():
    """Не поміряли — значить не обіцяємо. Найнебезпечніша гілка в модулі."""
    verdict = offered_scope(disk=UNKNOWN, ram=BIG_RAM, osmium=OSMIUM_OK)
    assert verdict["scope"] == "none"
    assert any("не поміряно" in b for b in verdict["blockers"])


def test_unmeasurable_ram_degrades_downward():
    assert offered_scope(disk=BIG_DISK, ram=UNKNOWN, osmium=OSMIUM_OK)["scope"] == "none"


def test_a_broken_worker_takes_away_every_scope_including_the_city():
    """Без робітника не печеться НІЩО — і це не «майже все», а рівно все.

    Раніше цю роль грав docker, і він знімав лише «країну»: решта обсягів
    його не потребувала. Тепер залежність спільна, тож і відмова спільна —
    обіцяти «місто» машині, яка не може запустити робітника, було б тією
    самою обіцянкою країни, що й раніше, лише меншою.
    """
    verdict = offered_scope(disk=BIG_DISK, ram=BIG_RAM, osmium=OSMIUM_BROKEN)
    assert verdict["scope"] == "none"
    assert all("робітник" in b for b in verdict["blockers"])


def test_an_unmeasurable_worker_lowers_the_ceiling_it_never_raises_it():
    """Правило 2 на новій залежності: не змогли перевірити — не обіцяємо."""
    verdict = offered_scope(disk=BIG_DISK, ram=BIG_RAM, osmium=UNKNOWN)
    assert verdict["scope"] == "none"
    assert any("не вдалося перевірити" in b for b in verdict["blockers"])


def test_docker_is_gone_from_the_shape_entirely():
    """Сторож проти повернення: жодна колонка BAKE_SCOPES не про docker."""
    assert all(len(row) == 4 for row in BAKE_SCOPES)
    import geo.bake_capability as mod

    assert not hasattr(mod, "probe_docker"), "проба docker повернулась"


def test_scopes_are_ordered_so_a_bigger_scope_never_asks_for_less():
    disks = [s[2] for s in BAKE_SCOPES]
    rams = [s[3] for s in BAKE_SCOPES]
    assert disks == sorted(disks)
    assert rams == sorted(rams)


def test_the_verdict_is_labelled_an_estimate():
    assert offered_scope(disk=BIG_DISK, ram=BIG_RAM, osmium=OSMIUM_OK)["estimate"] is True


def test_per_scope_reasons_carry_no_label_prefix():
    """`/bake/scopes` показує причину під назвою обсягу — префікс там був би
    повтором. Обидві форми рахуються в одному місці, щоб не розійтись."""
    verdict = offered_scope(
        disk=Measurement(6 * _GIB, True, "/data"), ram=BIG_RAM, osmium=OSMIUM_OK
    )
    assert verdict["per_scope"]["city"]["eligible"] is True
    oblast = verdict["per_scope"]["oblast"]
    assert oblast["eligible"] is False
    assert oblast["blockers"] and not any(b.startswith("область:") for b in oblast["blockers"])


# ── Поміряний пік памʼяті ────────────────────────────────────────────────────


def test_a_measured_peak_above_the_estimate_replaces_it():
    """«U5 у плані» перестає бути обіцянкою: перший спечений пакет лишає
    число, і наступна відповідь спирається на нього."""
    assert required_ram("city", 2 * _GIB, {"city": 5 * _GIB}) == 5 * _GIB


def test_a_measured_peak_below_the_estimate_never_lowers_the_bar():
    """Одна вдала спроба на одному витягу нічого не доводить про інші.

    Асиметрія тут і є правилом 2: вниз — так, угору — ніколи.
    """
    assert required_ram("city", 2 * _GIB, {"city": 1 * _GIB}) == 2 * _GIB


def test_a_measured_peak_can_take_a_scope_away():
    verdict = offered_scope(
        disk=BIG_DISK,
        ram=Measurement(10 * _GIB, True, "psutil"),
        osmium=OSMIUM_OK,
        peaks={"country": 24 * _GIB},
    )
    assert verdict["scope"] == "oblast", "поміряний пік не опустив стелю"


def test_peaks_are_read_from_pack_sidecars(tmp_path):
    (tmp_path / "kyiv.json").write_text(
        json.dumps({"scope_id": "city", "bake": {"peak_rss_bytes": 812345678}}),
        encoding="utf-8",
    )
    assert read_measured_peaks(tmp_path) == {"city": 812345678}


def test_an_unmeasured_peak_is_not_a_cheap_one(tmp_path):
    """Робітника вбили раніше, ніж він прочитав VmHWM.

    Число без прапорця `measured` — не вимір. Узяти його як вимір означало б
    відтворити рівно ту ваду, проти якої написаний увесь модуль.
    """
    (tmp_path / "x.json").write_text(
        json.dumps({"scope_id": "city", "bake": {"peak_rss_bytes": 1, "measured": False}}),
        encoding="utf-8",
    )
    assert read_measured_peaks(tmp_path) == {}


def test_a_broken_sidecar_never_takes_down_the_answer(tmp_path):
    (tmp_path / "junk.json").write_text("{це не json", encoding="utf-8")
    (tmp_path / "ok.json").write_text(
        json.dumps({"scope_id": "oblast", "peak_rss_bytes": 5}), encoding="utf-8"
    )
    assert read_measured_peaks(tmp_path) == {"oblast": 5}


# ── Виміри машини ────────────────────────────────────────────────────────────


def test_disk_is_measured_on_the_filesystem_the_packs_would_live_on(tmp_path):
    """Не «/». У користувача може бути крихітний root і великий /home."""
    target = tmp_path / "ще" / "не" / "створено"
    m = measure_free_disk(target)
    assert m.measured is True
    assert m.value is not None and m.value > 0
    assert _nearest_existing(target) == tmp_path


def test_a_path_with_no_existing_ancestor_is_not_guessed(monkeypatch):
    import geo.bake_capability as mod

    monkeypatch.setattr(mod, "_nearest_existing", lambda _p: None)
    m = mod.measure_free_disk(mod.Path("/цього/немає"))
    assert m.measured is False and m.value is None


def test_ram_measurement_is_available_not_installed():
    m = measure_available_ram()
    assert m.measured is True
    assert m.value is not None and m.value > 0
    try:
        import psutil
    except ImportError:
        return
    assert m.value <= psutil.virtual_memory().total


# ── Проба робітника ──────────────────────────────────────────────────────────


def test_the_probe_spawns_the_same_worker_the_bake_would_use():
    """Один виробник argv на пробу і на випікання.

    Інакше проба доводила б один шлях запуску, а продукт ішов би іншим —
    зелене, що нічого не стереже.
    """
    argv = bake_worker_argv("--selftest")
    assert argv[-1] == "--selftest"
    assert "geo.bake.worker" in argv or "--bake-worker" in argv


async def test_osmium_is_probed_by_running_it_not_by_finding_the_module(monkeypatch):
    """Модуль на місці, .so зібрані під іншу лібц — `find_spec` каже «є»."""
    import geo.bake_capability as mod

    class _Proc:
        returncode = 1

        async def communicate(self):
            return b"", b"ImportError: libbz2.so.1.0: cannot open shared object file"

    monkeypatch.setattr(mod.asyncio, "create_subprocess_exec", lambda *a, **k: _spawn(_Proc()))
    m = await probe_osmium()
    assert m.measured is True and m.value == 0
    assert "libbz2" in m.detail


async def _spawn(proc):
    return proc


async def test_a_working_worker_reports_where_its_osmium_came_from(monkeypatch):
    import geo.bake_capability as mod

    class _Proc:
        returncode = 0

        async def communicate(self):
            return b"osmium_from=/tmp/_MEI42/osmium/__init__.py\nOK\n", b""

    monkeypatch.setattr(mod.asyncio, "create_subprocess_exec", lambda *a, **k: _spawn(_Proc()))
    m = await probe_osmium()
    assert m.measured is True and m.value == 1
    assert "_MEI42" in m.detail, "шлях — єдине, що відрізняє свою прив'язку від чужої"


async def test_a_zero_exit_without_the_path_line_is_still_a_refusal(monkeypatch):
    """Мовчання про шлях — не згода. Нуль без доказу нічого не доводить."""
    import geo.bake_capability as mod

    class _Proc:
        returncode = 0

        async def communicate(self):
            return b"OK\n", b""

    monkeypatch.setattr(mod.asyncio, "create_subprocess_exec", lambda *a, **k: _spawn(_Proc()))
    m = await probe_osmium()
    assert m.measured is True and m.value == 0


async def test_a_missing_interpreter_is_a_measurement_not_a_failure(monkeypatch):
    import geo.bake_capability as mod

    async def _boom(*_a, **_kw):
        raise FileNotFoundError("python")

    monkeypatch.setattr(mod.asyncio, "create_subprocess_exec", _boom)
    m = await probe_osmium()
    assert m.measured is True and m.value == 0


async def test_a_fork_failure_is_unknown_not_a_no(monkeypatch):
    """Не змогли навіть спробувати — кажемо «не знаю», і стеля падає."""
    import geo.bake_capability as mod

    async def _boom(*_a, **_kw):
        raise OSError(11, "Resource temporarily unavailable")

    monkeypatch.setattr(mod.asyncio, "create_subprocess_exec", _boom)
    m = await probe_osmium()
    assert m.measured is False and m.value is None


async def test_a_hung_worker_does_not_hang_the_endpoint(monkeypatch):
    import geo.bake_capability as mod

    class _Proc:
        returncode = None

        async def communicate(self):
            await asyncio.sleep(3600)

        def kill(self):
            return None

        async def wait(self):
            return 0

    monkeypatch.setattr(mod.asyncio, "create_subprocess_exec", lambda *a, **k: _spawn(_Proc()))
    monkeypatch.setattr(mod, "_OSMIUM_PROBE_TIMEOUT_S", 0.05)
    m = await asyncio.wait_for(probe_osmium(), timeout=5)
    assert m.measured is False, "мовчання робітника — це «не знаю», а не «так»"


# ── Наскрізно ────────────────────────────────────────────────────────────────


async def test_the_endpoint_answers_with_a_named_scope(auth_root_client):
    resp = auth_root_client.get("/api/v1/bake/capability")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["scope"] in {"none", "city", "oblast", "country"}
    assert body["scope_ua"] in {"нічого", "місто", "область", "країна"}
    assert body["measured"]["disk"]["measured"] is True
    assert body["measured"]["ram"]["measured"] is True
    assert body["measured"]["osmium"]["measured"] in (True, False)
    assert "docker" not in body["measured"], "docker повернувся у відповідь"
    assert {s["id"] for s in body["scopes"]} == {"city", "oblast", "country"}
    for scope in body["scopes"]:
        assert scope["needs_osmium"] is True
        assert "needs_docker" not in scope
        assert "measured_peak_rss_bytes" in scope


async def test_the_endpoint_needs_auth(unauth_client):
    assert unauth_client.get("/api/v1/bake/capability").status_code in (401, 403)


async def test_the_probe_reports_the_path_it_actually_measured(tmp_path):
    body = await probe_bake_capability(tmp_path / "packs")
    assert body["measured"]["disk"]["path"] == str(tmp_path)
