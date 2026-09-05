"""Оркестратор: що лишається після зупинки і коли пакет стає видимим.

Worker тут підроблений СКРИПТОМ, а не мокнутим методом: справжній
`create_subprocess_exec`, справжній stdout, справжні коди виходу й сигнали —
бо саме на цьому стику ламається все цікаве. Памʼять — вприснута функція, щоб
сторожа спрацьовувала за 60 мс, а не за 15 с.
"""
from __future__ import annotations

import asyncio
import sqlite3
import sys
from pathlib import Path

import osmium
import osmium.osm.mutable as mutable
import pytest

from geo.bake import catalogue
from geo.bake.contract import JobStatus, audit_snapshot
from geo.bake.job import (
    BakeAboveCeiling, BakeAlreadyRunning, BakeService, BakeUnknownScope,
)
from geo.bake.manifest import SourceMeta, read_json, write_json_atomic

HEALTHY = lambda: (16_000_000, 12_000_000)          # noqa: E731 — 75% вільно
STARVING = lambda: (16_000_000, 1_000_000)          # noqa: E731 — 6% вільно


class Starves:
    """Здорова на передпольоті, голодна після — щоб сторожа стріляла В РОБОТІ."""

    def __init__(self) -> None:
        self.low = False

    def __call__(self) -> tuple[int, int]:
        return STARVING() if self.low else HEALTHY()

FAKE_WORKER = '''
import json, os, signal, sqlite3, sys, time
sys.path.insert(0, os.getcwd())
from geo.bake.mesh_writer import MeshWriter

args = sys.argv[1:]
out = args[args.index("--out") + 1]
mode = os.environ.get("FAKE_BAKE_MODE", "ok")

def emit(**p):
    sys.stdout.write(json.dumps(p) + "\\n")
    sys.stdout.flush()

emit(ev="stage", stage="indexing")
open(out, "wb").close()                    # .db.part зʼявився на диску
emit(ev="stage", stage="baking")

if mode == "hang":
    while True:
        time.sleep(0.02)
if mode == "selfkill":
    os.kill(os.getpid(), signal.SIGKILL)
if mode == "selfstop":
    emit(ev="error", reason="low_memory", detail="лишилось 8.0% RAM")
    sys.exit(75)
if mode == "explode":
    emit(ev="error", reason="worker_error", detail="щось пішло не так")
    sys.exit(1)

os.unlink(out)
with MeshWriter(out) as w:
    w.add_way(10, [(50.40, 30.50), (50.41, 30.51)], {"highway": "primary", "name": "Х"})
    w.add_way(11, [(50.42, 30.52), (50.43, 30.53)], {"highway": "residential"})
if mode == "slow":
    time.sleep(0.4)                        # вікно, у якому пакет ще не видимий
emit(ev="done", ways_seen=2, ways_kept=2, rows_written=2, cells=2,
     elapsed_s=0.12, input_bytes=884, peak_rss_bytes=61_000_000)
'''


def _pbf(path: Path) -> bytes:
    writer = osmium.SimpleWriter(str(path))
    writer.add_node(mutable.Node(id=1, location=(30.5, 50.4)))
    writer.add_node(mutable.Node(id=2, location=(30.6, 50.5)))
    writer.add_way(mutable.Way(id=1, nodes=[1, 2], tags={"highway": "primary"}))
    writer.close()
    return path.read_bytes()


def _seed_extract(root: Path, tmp_path: Path) -> Path:
    """Перевірений екстракт уже на диску — отже, мережа не потрібна взагалі."""
    dest = root / ".src" / "ukraine.osm.pbf"
    dest.parent.mkdir(parents=True, exist_ok=True)
    body = _pbf(tmp_path / "real.osm.pbf")
    dest.write_bytes(body)
    write_json_atomic(Path(str(dest) + ".meta.json"), SourceMeta(
        source_id="ukraine", url=catalogue.SOURCES["ukraine"].url, bytes=len(body),
        verified_by="md5", fetched_at="2026-09-05T00:00:00+00:00").to_dict())
    return dest


def _service(root: Path, tmp_path: Path, *, mem=HEALTHY, events=None) -> BakeService:
    fake = tmp_path / "fake_worker.py"
    fake.write_text(FAKE_WORKER)
    return BakeService(
        on_event=events, root=root, mem_reader=mem, watchdog_interval_s=0.02,
        worker_argv=lambda args: [sys.executable, str(fake), *args])


async def _drain(service: BakeService, timeout: float = 20.0) -> None:
    for _ in range(int(timeout / 0.02)):
        status = service.current()
        if status is not None and status.is_terminal:
            return
        await asyncio.sleep(0.02)
    raise AssertionError(f"випікання не скінчилось: {service.current()}")


class Recorder:
    """Все, що почув би роутер — плюс знімок теки road/ у ту саму мить."""

    def __init__(self, road: Path) -> None:
        self.road = road
        self.log: list[tuple[str, str, list[str]]] = []

    async def __call__(self, kind, status):
        self.log.append((kind, status.stage,
                         sorted(p.name for p in self.road.glob("*.db"))))
        assert audit_snapshot(status.as_dict()) == [], status.as_dict()


# ── успіх ──────────────────────────────────────────────────────────────

async def test_no_db_appears_in_road_until_finalize_has_finished(tmp_path, monkeypatch):
    """Файл `road/*.db` — і є твердження «пакет цілий». Півпакета там бути не може."""
    monkeypatch.setenv("FAKE_BAKE_MODE", "slow")
    root = tmp_path / "map_packs"
    recorder = Recorder(root / "road")
    service = _service(root, tmp_path, events=recorder)
    _seed_extract(root, tmp_path)

    await service.start("kyiv")
    await _drain(service)

    kinds = [k for k, _, _ in recorder.log]
    visible_at = kinds.index("pack.visible")
    assert all(files == [] for _, _, files in recorder.log[:visible_at]), \
        "пакет було видно ще до finalize"
    assert recorder.log[visible_at][2] == ["phantom_road_mesh.kyiv.db"]
    assert kinds[-1] == "job.finished"
    # І в теці .tmp не лишилось нічого недопеченого.
    assert list((root / ".tmp").glob("*.db.part")) == []


async def test_a_finished_pack_declares_version_two_read_back_from_the_file(tmp_path):
    root = tmp_path / "map_packs"
    service = _service(root, tmp_path)
    _seed_extract(root, tmp_path)
    await service.start("kyiv")
    await _drain(service)

    status = service.current()
    assert status.stage == "done" and status.outcome.kind == "done"
    assert status.pack.format_version == 2
    assert status.pack.way_count == 2 and len(status.pack.sha256) == 64

    db = root / "road" / "phantom_road_mesh.kyiv.db"
    con = sqlite3.connect(str(db))
    assert con.execute("PRAGMA user_version").fetchone()[0] == 2
    con.close()

    sidecar = read_json(root / "road" / "phantom_road_mesh.kyiv.json")
    assert sidecar["scope_id"] == "kyiv"
    assert sidecar["bake"]["peak_rss_bytes"] == 61_000_000
    assert sidecar["bake"]["measured"] is True


async def test_the_real_worker_bakes_through_the_service_as_invoked_in_a_dev_tree(tmp_path):
    """Підроблений worker довів оркестратор і НЕ довів рядок запуску.

    Тут worker справжній, а команду будує сам BakeService — тобто перевіряється
    саме `-m geo.bake.worker` з cwd на теці бекенда. Двічі за два дні в цьому
    проєкті підсистема виявлялась написаною, покритою тестами й не викликаною;
    підроблений процес відтворює цю пастку дослівно.
    """
    root = tmp_path / "map_packs"
    service = BakeService(root=root, mem_reader=HEALTHY, watchdog_interval_s=0.05)
    _seed_extract(root, tmp_path)

    await service.start("kyiv")
    await _drain(service, timeout=60.0)

    status = service.current()
    assert status.outcome.kind == "done", status.outcome.to_dict()
    assert status.pack.format_version == 2 and status.pack.way_count == 1
    # Двопрохідний режим bbox справді рахує вузли — і каже число, а не нуль.
    assert status.bake.nodes_seen == 2 and status.bake.nodes_kept == 2
    assert status.bake.ways_kept == 1
    assert (root / "road" / "phantom_road_mesh.kyiv.db").exists()


async def test_a_second_bake_reports_the_previous_one_instead_of_predicting(tmp_path):
    root = tmp_path / "map_packs"
    service = _service(root, tmp_path)
    _seed_extract(root, tmp_path)
    await service.start("kyiv")
    await _drain(service)
    again = await service.start("kyiv")
    await _drain(service)
    assert again.previous is not None and again.previous.way_count == 2
    assert again.previous.elapsed_s > 0


# ── самозупинка ────────────────────────────────────────────────────────

async def test_the_watchdog_trip_kills_the_part_and_keeps_the_extract(tmp_path, monkeypatch):
    monkeypatch.setenv("FAKE_BAKE_MODE", "hang")
    root = tmp_path / "map_packs"
    reader = Starves()
    service = _service(root, tmp_path, mem=reader)
    extract = _seed_extract(root, tmp_path)

    await service.start("kyiv")
    reader.low = True                      # памʼять зникла вже під час роботи
    await _drain(service)

    status = service.current()
    assert status.outcome.reason == "low_memory"
    assert status.stage == "failed"
    assert list((root / ".tmp").glob("*.db.part")) == [], "недопечене лишилось на диску"
    assert extract.exists(), "екстракт викинули — він коштував гігабайти трафіку"
    assert list((root / "road").glob("*.db")) == []


async def test_a_worker_that_stops_itself_with_75_is_low_memory_not_a_crash(
    tmp_path, monkeypatch
):
    """Кооперативна зупинка встигає закрити SQLite — і мусить читатись інакше."""
    monkeypatch.setenv("FAKE_BAKE_MODE", "selfstop")
    root = tmp_path / "map_packs"
    service = _service(root, tmp_path)  # памʼять здорова: сторожа не спрацює
    _seed_extract(root, tmp_path)
    await service.start("kyiv")
    await _drain(service)

    status = service.current()
    assert status.outcome.reason == "low_memory"
    assert "8.0%" in status.outcome.detail_ua


async def test_a_killed_worker_is_worker_crashed_not_low_memory(tmp_path, monkeypatch):
    monkeypatch.setenv("FAKE_BAKE_MODE", "selfkill")
    root = tmp_path / "map_packs"
    service = _service(root, tmp_path)
    extract = _seed_extract(root, tmp_path)
    await service.start("kyiv")
    await _drain(service)

    status = service.current()
    assert status.outcome.reason == "worker_crashed", status.outcome.to_dict()
    assert "9" in status.outcome.detail_ua
    assert extract.exists()
    assert list((root / ".tmp").glob("*.db.part")) == []


async def test_a_worker_error_keeps_its_own_reason(tmp_path, monkeypatch):
    monkeypatch.setenv("FAKE_BAKE_MODE", "explode")
    root = tmp_path / "map_packs"
    service = _service(root, tmp_path)
    _seed_extract(root, tmp_path)
    await service.start("kyiv")
    await _drain(service)
    assert service.current().outcome.reason == "worker_error"


async def test_cancelling_says_cancelled_not_failed(tmp_path, monkeypatch):
    monkeypatch.setenv("FAKE_BAKE_MODE", "hang")
    root = tmp_path / "map_packs"
    service = _service(root, tmp_path)
    _seed_extract(root, tmp_path)
    await service.start("kyiv")
    for _ in range(200):
        if service.current().stage == "baking":
            break
        await asyncio.sleep(0.02)
    assert await service.cancel("user") is True
    await _drain(service)

    status = service.current()
    assert status.stage == "cancelled" and status.outcome.reason == "user"
    assert list((root / "road").glob("*.db")) == []
    # Копія на склі розходиться саме тут — тож факт мусить бути в знімку.
    assert "збережено" in status.outcome.detail_ua
    assert (root / ".src" / "ukraine.osm.pbf").exists()


async def test_cancelling_with_keep_download_false_drops_the_extract_and_says_so(
    tmp_path, monkeypatch
):
    monkeypatch.setenv("FAKE_BAKE_MODE", "hang")
    root = tmp_path / "map_packs"
    service = _service(root, tmp_path)
    extract = _seed_extract(root, tmp_path)
    await service.start("kyiv")
    for _ in range(200):
        if service.current().stage == "baking":
            break
        await asyncio.sleep(0.02)
    assert await service.cancel("user", keep_download=False) is True
    await _drain(service)
    assert "прибрано" in service.current().outcome.detail_ua
    assert not extract.exists()


@pytest.mark.parametrize("setting, survives", [(True, True), (False, False)])
async def test_the_owner_toggle_actually_reaches_the_cancel_default(
    tmp_path, monkeypatch, setting, survives
):
    """05.09 цей перемикач резолвився в константу: хибне імʼя імпорту під
    `except Exception`. Тест питає ПОВЕДІНКУ — чи лишився файл, — а не функцію."""
    from config import config

    monkeypatch.setattr(config, "bake_keep_source_extracts", setting)
    monkeypatch.setenv("FAKE_BAKE_MODE", "hang")
    root = tmp_path / "map_packs"
    service = _service(root, tmp_path)
    extract = _seed_extract(root, tmp_path)
    await service.start("kyiv")
    for _ in range(200):
        if service.current().stage == "baking":
            break
        await asyncio.sleep(0.02)
    await service.cancel("user")            # keep_download=None -> налаштування
    await _drain(service)
    assert extract.exists() is survives


async def test_refresh_source_keeps_the_old_extract_when_preflight_refuses(tmp_path):
    """«Взяти свіжіший» не сміє означати «лишитись без жодного»."""
    import httpx

    def dead(request):
        raise httpx.ConnectError("no route", request=request)

    root = tmp_path / "map_packs"
    service = BakeService(
        root=root, mem_reader=HEALTHY,
        client_factory=lambda: httpx.AsyncClient(transport=httpx.MockTransport(dead)))
    extract = _seed_extract(root, tmp_path)
    with pytest.raises(BakeAboveCeiling):
        await service.start("kyiv", refresh_source=True)
    assert extract.exists(), "старий витяг викинули, а нового не буде"
    # А без refresh той самий сервіс береться за роботу з файла на диску.
    assert (await service.start("kyiv")).stage == "preflight"
    await service.cancel("user")
    await _drain(service)


async def test_a_restart_mid_bake_is_marked_interrupted_not_left_baking_forever(tmp_path):
    """Панель, що через 40 хвилин показує «пече» мертвому процесу, бреше."""
    root = tmp_path / "map_packs"
    (root / ".jobs").mkdir(parents=True)
    write_json_atomic(root / ".jobs" / "last.json", JobStatus(
        job_id="dead", scope_id="ukraine", label_ua="Україна", stage="baking",
        started_at="2026-09-05T13:10:00+00:00",
        updated_at="2026-09-05T13:52:00+00:00").as_dict())

    reborn = _service(root, tmp_path)
    assert reborn.current().stage == "baking"          # до підмітання — стара брехня
    await reborn.sweep_orphans()
    marked = reborn.current()
    assert marked.stage == "failed" and marked.outcome.reason == "shutdown"
    assert "13:52" in marked.outcome.detail_ua
    assert marked.job_id == "dead"


async def test_the_snapshot_carries_the_guard_numbers_so_glass_never_hardcodes_thirty(
    tmp_path
):
    root = tmp_path / "map_packs"
    service = _service(root, tmp_path)
    _seed_extract(root, tmp_path)
    started = await service.start("kyiv")
    assert started.guard.floor_pct == 30.0
    assert started.guard.strikes_to_trip == 3
    assert started.guard.poll_s == 0.02
    assert started.as_dict()["guard"] == {"floor_pct": 30.0, "strikes_to_trip": 3,
                                          "poll_s": 0.02}
    await _drain(service)


async def test_output_bytes_is_null_before_the_file_exists_and_a_real_size_after(tmp_path):
    root = tmp_path / "map_packs"
    seen: list = []

    async def ev(kind, status):
        seen.append((kind, status.stage, status.bake.output_bytes))

    service = _service(root, tmp_path, events=ev)
    _seed_extract(root, tmp_path)
    await service.start("kyiv")
    await _drain(service)
    assert seen[0] == ("job.started", "preflight", None)
    progress = [b for k, _, b in seen if k == "job.progress"]
    assert progress and progress[-1] > 0, seen


# ── ворота на вході ────────────────────────────────────────────────────

async def test_an_unknown_scope_is_refused_by_name(tmp_path):
    service = _service(tmp_path / "map_packs", tmp_path)
    with pytest.raises(BakeUnknownScope):
        await service.start("атлантида")


async def test_a_second_start_while_one_runs_is_refused(tmp_path, monkeypatch):
    monkeypatch.setenv("FAKE_BAKE_MODE", "hang")
    root = tmp_path / "map_packs"
    service = _service(root, tmp_path)
    _seed_extract(root, tmp_path)
    await service.start("kyiv")
    with pytest.raises(BakeAlreadyRunning):
        await service.start("kyiv")
    await service.cancel("user")
    await _drain(service)


async def test_an_unmeasured_source_size_refuses_the_scope_in_ukrainian(tmp_path):
    """Невідоме опускає стелю. Оцінку замість невдалого виміру не підставляємо."""
    import httpx

    def dead(request):
        raise httpx.ConnectError("no route", request=request)

    root = tmp_path / "map_packs"
    service = BakeService(
        root=root, mem_reader=HEALTHY,
        client_factory=lambda: httpx.AsyncClient(transport=httpx.MockTransport(dead)))
    with pytest.raises(BakeAboveCeiling) as caught:
        await service.start("ukraine")
    assert "не поміряно" in str(caught.value)


async def test_preflight_refuses_below_the_floor_before_a_single_byte_is_fetched(tmp_path):
    """Проба міряє байти, сторожа стріляє по відсотку. Заміряно 05.09: 17,8 %
    вільних проти підлоги 30 % — людина натиснула б, скачала 900 МБ і стала.
    Відмова мусить прийти ДО натискання, тим самим числом і з іменем причини."""
    root = tmp_path / "map_packs"
    service = _service(root, tmp_path, mem=STARVING)
    _seed_extract(root, tmp_path)
    with pytest.raises(BakeAboveCeiling) as caught:
        await service.start("kyiv")
    assert caught.value.reason == "low_memory"
    assert "6.2 %" in str(caught.value) and "30 %" in str(caught.value)
    assert service.current() is None, "робота не мала навіть початись"


async def test_memory_state_says_exactly_what_the_guard_would_do(tmp_path):
    starving = _service(tmp_path / "a", tmp_path, mem=STARVING).memory_state()
    assert starving["would_stop"] is True and starving["measured"] is True
    assert starving["floor_pct"] == 30.0 and starving["ram_available_pct"] == 6.25
    healthy = _service(tmp_path / "b", tmp_path, mem=HEALTHY).memory_state()
    assert healthy["would_stop"] is False
    blind = _service(tmp_path / "c", tmp_path,
                     mem=lambda: (_ for _ in ()).throw(OSError())).memory_state()
    assert blind["measured"] is False and blind["would_stop"] is False
    assert blind["ram_available_pct"] is None


async def test_an_unreadable_memory_reading_refuses_rather_than_hopes(tmp_path):
    """Невідоме опускає стелю: сліпа сторожа нікого не захистить."""
    root = tmp_path / "map_packs"
    service = _service(root, tmp_path, mem=lambda: (_ for _ in ()).throw(OSError()))
    _seed_extract(root, tmp_path)
    with pytest.raises(BakeAboveCeiling) as caught:
        await service.start("kyiv")
    assert caught.value.reason == "unmeasured"


async def test_the_pack_file_name_is_pack_id_plus_db_so_the_passport_can_print_it(tmp_path):
    """Шляху в знімку нема (він їде на телефони), але імʼя файла детерміноване."""
    root = tmp_path / "map_packs"
    service = _service(root, tmp_path)
    _seed_extract(root, tmp_path)
    await service.start("kyiv")
    await _drain(service)
    pack = service.current().pack
    assert pack.pack_id == "phantom_road_mesh.kyiv"
    assert (root / "road" / f"{pack.pack_id}.db").exists()
    assert (root / "road" / f"{pack.pack_id}.json").exists()


async def test_cancel_rejects_a_reason_outside_the_vocabulary(tmp_path):
    with pytest.raises(ValueError):
        await _service(tmp_path / "map_packs", tmp_path).cancel("operator")


# ── стан переживає перезапуск ──────────────────────────────────────────

async def test_the_last_job_survives_a_restart_of_the_service(tmp_path):
    root = tmp_path / "map_packs"
    service = _service(root, tmp_path)
    _seed_extract(root, tmp_path)
    await service.start("kyiv")
    await _drain(service)

    reborn = _service(root, tmp_path)
    restored = reborn.current()
    assert restored is not None
    assert restored.scope_id == "kyiv" and restored.stage == "done"
    assert restored.pack.format_version == 2


async def test_orphans_from_a_previous_run_do_not_survive_startup(tmp_path):
    root = tmp_path / "map_packs"
    service = _service(root, tmp_path)
    tmp = root / ".tmp"
    tmp.mkdir(parents=True, exist_ok=True)
    (tmp / "kyiv.abc.db.part").write_bytes(b"half-baked")
    (tmp / "ukraine.abc.idx").write_bytes(b"index")
    (tmp / "ukraine.osm.pbf.part").write_bytes(b"partial")

    assert await service.sweep_orphans() == 2
    assert not (tmp / "kyiv.abc.db.part").exists()
    assert not (tmp / "ukraine.abc.idx").exists()
    # Недокачаний екстракт — НЕ сирота: він поновлюваний і коштує трафіку.
    assert (tmp / "ukraine.osm.pbf.part").exists()


# ── поверхня для роутера ───────────────────────────────────────────────

async def test_list_scopes_shows_no_size_when_the_size_is_not_measured(tmp_path):
    import httpx

    def dead(request):
        raise httpx.ConnectError("no route", request=request)

    service = BakeService(
        root=tmp_path / "map_packs",
        client_factory=lambda: httpx.AsyncClient(transport=httpx.MockTransport(dead)))
    scopes = await service.list_scopes()
    assert {s["id"] for s in scopes} == {s.id for s in catalogue.SCOPES}
    for entry in scopes:
        assert entry["source_bytes"] is None
        assert entry["needs_disk_bytes"] is None
        assert entry["remote"]["measured"] is False and entry["remote"]["detail"]


async def test_source_state_and_drop_report_what_is_really_on_disk(tmp_path):
    root = tmp_path / "map_packs"
    service = _service(root, tmp_path)
    assert await service.source_state("вигадана") is None
    assert (await service.source_state("ukraine"))["present"] is False
    assert await service.drop_source("ukraine") is False

    _seed_extract(root, tmp_path)
    state = await service.source_state("ukraine")
    assert state["present"] is True and state["verified_by"] == "md5"
    assert await service.drop_source("ukraine") is True
    assert (await service.source_state("ukraine"))["present"] is False


async def test_every_event_the_router_would_broadcast_is_honest(tmp_path):
    root = tmp_path / "map_packs"
    recorder = Recorder(root / "road")
    service = _service(root, tmp_path, events=recorder)
    _seed_extract(root, tmp_path)
    await service.start("kyiv")
    await _drain(service)
    kinds = {k for k, _, _ in recorder.log}
    assert {"job.started", "job.stage", "job.progress", "pack.visible",
            "job.finished"} <= kinds


def test_the_keep_extracts_switch_actually_follows_the_owner_setting():
    """Перемикач мусить ВИМИКАТИ, а не лише існувати.

    Перший підпис брав `from config import settings`, тоді як модуль експортує
    `config` (`config.py:1058`). ImportError ковтало голе `except Exception`, і
    функція повертала True завжди: власник міг зняти галочку в Налаштуваннях, а
    876 МБ екстракту лишались на диску. Зелених тестів це не чіпало — жоден не
    питав, чи ЗМІНЮЄТЬСЯ відповідь.

    Тому тут перевіряється не «функція повертає bool», а що обидва положення
    перемикача дають РІЗНИЙ результат. Такий тест неможливо пройти мертвим
    читачем налаштування.
    """
    from config import config
    from geo.bake.job import _keep_extracts_by_default

    before = getattr(config, "bake_keep_source_extracts", True)
    try:
        config.bake_keep_source_extracts = True
        assert _keep_extracts_by_default() is True
        config.bake_keep_source_extracts = False
        assert _keep_extracts_by_default() is False, (
            "читач налаштування мертвий: вимкнення нічого не вимикає"
        )
    finally:
        config.bake_keep_source_extracts = before
