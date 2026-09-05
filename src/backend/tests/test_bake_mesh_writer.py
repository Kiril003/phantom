"""Кодек мусить збігатися з телефоном, а версія — з тим, ЩО телефон уміє.

Фікстури тут — справжні .osm.pbf, зібрані `osmium.SimpleWriter` на льоту:
50-мегабайтний екстракт у репозиторії не потрібен, щоб довести кодек.
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

import osmium
import osmium.osm.mutable as mutable
import pytest

from geo.bake.mesh_writer import (
    FORMAT_VERSION, MeshWriter, PIPE_ESCAPE, ROUTING_KEYS, cell_key,
    cells_covering, encode_points, encode_tags, finalize,
)

# Дерево телефона, де живе авторитетний DB_VERSION.
_COMPANION = Path(
    "/home/kyrylo/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-companion/core-sensor/"
    "src/main/java/local/phantom/companion/core/sensor/nav/RoadMeshStore.kt"
)


def _fixture(path: Path) -> Path:
    src = path / "fix.osm.pbf"
    writer = osmium.SimpleWriter(str(src))
    writer.add_node(mutable.Node(id=1, location=(30.500, 50.400)))
    writer.add_node(mutable.Node(id=2, location=(30.510, 50.410)))
    writer.add_node(mutable.Node(id=3, location=(30.520, 50.420)))
    writer.add_way(mutable.Way(id=10, nodes=[1, 2, 3], tags={
        "highway": "primary", "name": "Хрещатик", "oneway": "yes",
        "turn:lanes": "left|through", "motorroad": "yes", "note": "сміття"}))
    writer.add_way(mutable.Way(id=11, nodes=[1, 2], tags={"waterway": "river"}))
    writer.close()
    return src


def test_the_pack_declares_version_two_and_only_the_ways_table(tmp_path):
    """v3 виглядав би повним і не мав би читача — див. шапку mesh_writer."""
    part = tmp_path / "p.db.part"
    with MeshWriter(part) as writer:
        writer.add_way(10, [(50.4, 30.5), (50.41, 30.51)], {"highway": "primary"})
    facts = finalize(part)
    assert facts.format_version == 2
    con = sqlite3.connect(str(part))
    tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    con.close()
    assert tables == {"ways"}, "жоден компаньйон не має читача для stops/rails/routes"


def test_the_version_matches_the_phone_tree_that_actually_ships():
    if not _COMPANION.exists():
        pytest.skip(f"дерева компаньйона нема за {_COMPANION}")
    declared = [
        line for line in _COMPANION.read_text().splitlines()
        if "const val DB_VERSION" in line
    ]
    assert declared, "RoadMeshStore.kt більше не оголошує DB_VERSION"
    assert f"= {FORMAT_VERSION}" in declared[0], (
        f"телефон каже {declared[0].strip()}, пічка пише {FORMAT_VERSION} — "
        "міняти обидва в одному коміті"
    )


def test_format_version_is_read_back_from_the_file_not_from_the_constant(tmp_path):
    """Константа каже, що хотіли записати; pragma каже, що записалось."""
    part = tmp_path / "p.db.part"
    with MeshWriter(part) as writer:
        writer.add_way(1, [(50.4, 30.5), (50.41, 30.51)], {"highway": "residential"})
    con = sqlite3.connect(str(part))
    con.execute("PRAGMA user_version = 3")
    con.commit()
    con.close()
    assert finalize(part).format_version == 3, "finalize повірив константі, а не файлу"


def test_motorroad_stays_out_of_the_whitelist():
    """RoadProfile.kt:80 його читає, але в білому списку його нема.

    Додати його — змінити поведінку маршрутизації на телефоні; це рішення
    власника, а не пічки.
    """
    assert "motorroad" not in ROUTING_KEYS


def test_cell_key_wraps_to_signed_64_like_the_jvm():
    assert cell_key(2520, 1525) == (2520 << 32) ^ 1525
    # Відʼємна довгота маскується як `lo and 0xFFFFFFFFL` у Kotlin — це не
    # знакове розширення, тож ключ лишається додатним.
    assert cell_key(0, -1) == 0xFFFFFFFF
    # А відʼємна широта заганяє старший біт — і значення мусить стати
    # відʼємним, бо в JVM цей long знаковий.
    assert cell_key(-1, 0) < 0


def test_cells_covering_matches_the_phone_grid():
    cells = list(cells_covering(50.40, 30.50, 50.41, 30.51))
    assert cells == [cell_key(2520, 1525)]
    assert len(list(cells_covering(50.40, 30.50, 50.45, 30.55))) == 3 * 3


def test_points_are_six_decimals_and_locale_proof():
    assert encode_points([(50.4, 30.5), (50.41, 30.51)]) == \
        "50.400000,30.500000;50.410000,30.510000"
    assert "," in encode_points([(50.4, 30.5)]) and ";" not in encode_points([(50.4, 30.5)])


def test_tags_follow_whitelist_order_not_input_order():
    encoded = encode_tags({"maxspeed": "50", "highway": "primary", "surface": "asphalt"})
    assert encoded == "highway=primary|surface=asphalt|maxspeed=50"


def test_a_pipe_inside_a_value_is_escaped_so_neighbours_survive():
    """Сира риска розірвала б потік тегів і зліпила б хибну пару."""
    encoded = encode_tags({"highway": "primary", "turn:lanes": "left|through"})
    assert encoded == f"highway=primary|turn:lanes=left{PIPE_ESCAPE}through"
    assert encoded.count("|") == 1
    assert dict(p.split("=", 1) for p in encoded.split("|")) == {
        "highway": "primary", "turn:lanes": f"left{PIPE_ESCAPE}through"}


def test_a_value_with_an_equals_sign_is_dropped_not_mangled():
    assert encode_tags({"highway": "primary", "surface": "a=b"}) == "highway=primary"


def test_tags_outside_the_whitelist_never_reach_the_pack(tmp_path):
    src = _fixture(tmp_path)
    part = tmp_path / "p.db.part"
    with MeshWriter(part) as writer:
        for obj in (osmium.FileProcessor(src, osmium.osm.NODE | osmium.osm.WAY)
                    .with_locations()
                    .with_filter(osmium.filter.EntityFilter(osmium.osm.WAY))
                    .with_filter(osmium.filter.KeyFilter("highway"))):
            writer.add_way(obj.id, [(n.lat, n.lon) for n in obj.nodes if n.location.valid()],
                           {k: v for k, v in obj.tags})
    con = sqlite3.connect(str(part))
    rows = con.execute("SELECT id, name, oneway, tags FROM ways").fetchall()
    con.close()
    assert {r[0] for r in rows} == {10}, "лінія без highway потрапила в пакет"
    assert rows[0][1] == "Хрещатик" and rows[0][2] == 1
    assert "note" not in rows[0][3] and "motorroad" not in rows[0][3]


def test_the_flush_hook_fires_and_can_stop_the_bake(tmp_path):
    """Кооперативна перевірка памʼяті сидить саме на цьому гачку."""
    calls: list[int] = []

    def hook() -> None:
        calls.append(1)
        if len(calls) >= 2:
            raise RuntimeError("памʼять")

    writer = MeshWriter(tmp_path / "p.db.part", on_flush=hook, batch_rows=2)
    with pytest.raises(RuntimeError):
        for i in range(20):
            writer.add_way(i, [(50.4 + i * 0.001, 30.5), (50.41 + i * 0.001, 30.51)],
                           {"highway": "residential"})
    writer.close()
    assert len(calls) == 2


def test_finalize_refuses_a_half_written_file(tmp_path):
    """Обрізаний файл — це саме те, що лишає вбитий worker.

    Заміряно 05.09: `PRAGMA quick_check` ловить обрізання й побиту сторінку
    B-дерева, але НЕ ловить зіпсовані байти всередині рядка — він перевіряє
    структуру, а не вміст. Тому єдине наше твердження про вміст — sha256, і
    воно рахується з готового файла, а не з того, що ми думали записати.
    """
    part = tmp_path / "p.db.part"
    with MeshWriter(part) as writer:
        for i in range(300):
            writer.add_way(i, [(50.4 + i * 0.001, 30.5), (50.41 + i * 0.001, 30.51)],
                           {"highway": "residential", "name": "Х" * 40})
    blob = part.read_bytes()
    part.write_bytes(blob[: len(blob) - 3000])
    with pytest.raises(sqlite3.DatabaseError):
        finalize(part)


def test_finalize_reports_counts_read_from_the_finished_file(tmp_path):
    part = tmp_path / "p.db.part"
    with MeshWriter(part) as writer:
        writer.add_way(1, [(50.40, 30.50), (50.45, 30.55)], {"highway": "primary"})
        writer.add_way(2, [(50.40, 30.50), (50.41, 30.51)], {"highway": "primary"})
    facts = finalize(part)
    assert facts.way_count == 2
    assert facts.row_count == 9 + 1
    assert facts.cell_count == 9
    assert len(facts.sha256) == 64 and facts.bytes == part.stat().st_size
