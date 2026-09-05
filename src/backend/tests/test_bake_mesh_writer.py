"""Кодек мусить збігатися з телефоном, а версія — з тим, ЩО телефон уміє.

Фікстури тут — справжні .osm.pbf, зібрані `osmium.SimpleWriter` на льоту:
50-мегабайтний екстракт у репозиторії не потрібен, щоб довести кодек.
"""
from __future__ import annotations

import re
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


def test_motorroad_is_now_in_the_whitelist():
    """Рішення змінилось 05.09.2026 — і цей сторож змінюється разом із ним.

    Раніше тут стояло `assert "motorroad" not in ROUTING_KEYS` з приміткою, що
    додати ключ — рішення власника, а не пічки. Рішення ухвалено: `motorroad`
    це не клас дороги, а властивість «правила як на автомагістралі», і без неї
    `RoadProfile.kt:80` не міг відмовити пішому НІ НА ЯКОМУ пакеті.

    Лишаю сторожа на місці, а не видаляю: він тепер стереже протилежне
    твердження і саме тому не дасть тихо відкотити зміну назад.
    """
    assert "motorroad" in ROUTING_KEYS


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
    # `note` — поза білим списком, тож у пакет не їде.
    assert "note" not in rows[0][3]


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


def test_motorroad_reaches_the_pack_so_the_phone_rule_can_fire():
    """Правило, яке не могло спрацювати, тепер має чим спрацювати.

    `RoadProfile.kt:80` читає `tags["motorroad"]` і відмовляє пішому на трасі з
    автомагістральними правилами. До 05.09.2026 ключа не було в жодному білому
    списку, тож жоден пакет його не ніс і правило було мертвим на всіх даних.

    Тест перевіряє не «ключ є у списку» (це переказ константи), а що значення
    ДОЇЖДЖАЄ в закодований рядок і виживає розбір — тобто саме те, чого
    бракувало. І окремо — що він СТОЇТЬ В КІНЦІ: порядок вирішує байти, і
    вставка в середину мовчки розсинхронізувала б нас із сусідньою пічкою.
    """
    from geo.bake.mesh_writer import ROUTING_KEYS, encode_tags

    assert ROUTING_KEYS[-1] == "motorroad", (
        "motorroad мусить лишатись останнім: інакше кожна наявна пара змінює "
        "позицію і звірка з попереднім пакетом стає нечитабельною"
    )

    encoded = encode_tags({"highway": "trunk", "motorroad": "yes"})
    assert "motorroad=yes" in encoded
    # Дзеркало розбирача телефона (`RoadMeshStore.decodeTags`): він НЕ фільтрує
    # за білим списком, тому пара доїжджає до `tags["motorroad"]` без жодної
    # правки Kotlin.
    decoded = dict(p.split("=", 1) for p in encoded.split("|") if "=" in p)
    assert decoded["motorroad"] == "yes"


def test_a_road_without_motorroad_carries_no_empty_pair():
    """Відсутній ключ не стає порожньою парою — інакше «немає даних» на телефоні
    прочиталось би як «motorroad=», тобто значення."""
    from geo.bake.mesh_writer import encode_tags

    assert "motorroad" not in encode_tags({"highway": "residential"})


# ── ОДИН ЗАКОН, ЧОТИРИ ФАЙЛИ ─────────────────────────────────────────────
#
# `ROUTING_KEYS` живе в нашій `mesh_writer.py`, у сусідній печі
# `road-mesh-bake/mesh_bake.py` і в котлінському `RoadMeshStore.kt` (у кількох
# деревах). Це рівно той механізм, що породив вихідну ваду: один закон у
# кількох файлах, розходження нікого не червонить.
#
# Прибрати копію ми не можемо: продукт не сміє залежати в РАНТАЙМІ від файла
# поза своїм деревом (у пакунок він не поїде). Але ТЕСТ може прочитати всі
# джерела й відмовитись бути зеленим, коли вони розійшлись.
#
# Відсутнє джерело пропускаємо — але гучно, через `skip` із причиною, а не
# тихим `return`: «файла нема» і «файли збігаються» мусять виглядати
# по-різному, інакше сторож почне мовчки хвалити порожнечу.

_SIBLING_BAKER = Path("/home/kyrylo/phantom_ai/road-mesh-bake/mesh_bake.py")
_KOTLIN_STORES = (
    Path("/home/kyrylo/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-companion/core-sensor/"
         "src/main/java/local/phantom/companion/core/sensor/nav/RoadMeshStore.kt"),
)


def _python_keys(path: Path) -> list[str]:
    src = re.sub(r"#[^\n]*", "", path.read_text(encoding="utf-8"))
    m = re.search(r"ROUTING_KEYS[^=]*=\s*\(", src)
    assert m, f"{path}: не знайшов ROUTING_KEYS"
    i, depth, j = m.end(), 1, m.end()
    while depth:
        depth += (src[j] == "(") - (src[j] == ")")
        j += 1
    return re.findall(r'"([^"]+)"', src[i:j - 1])


def _kotlin_keys(path: Path) -> list[str]:
    # Коментарі знімаємо ПЕРШИМИ: попередній зонд зупинявся на дужці всередині
    # коментаря й доповідав власне обмеження як число ключів у файлі.
    src = re.sub(r"//[^\n]*", "", path.read_text(encoding="utf-8"))
    m = re.search(r"ROUTING_KEYS\s*=\s*listOf\(", src)
    assert m, f"{path}: не знайшов ROUTING_KEYS"
    i, depth, j = m.end(), 1, m.end()
    while depth:
        depth += (src[j] == "(") - (src[j] == ")")
        j += 1
    return re.findall(r'"([^"]+)"', src[i:j - 1])


def test_our_key_list_matches_the_sibling_baker_exactly():
    """Дві печі печуть ОДИН артефакт — тут потрібна дослівна рівність.

    Порядок входить у байти (`encode_tags` обходить список, а не вхід), тож
    розбіжність тут означає два різні пакети з однаковою назвою.
    """
    if not _SIBLING_BAKER.exists():
        pytest.skip(f"сусідньої печі нема на диску: {_SIBLING_BAKER}")
    assert list(ROUTING_KEYS) == _python_keys(_SIBLING_BAKER)


@pytest.mark.parametrize("store", _KOTLIN_STORES, ids=lambda p: p.parts[5])
def test_no_key_the_phone_writes_is_missing_from_our_packs(store: Path):
    """Асиметрія, яку легко проґавити: телефон не лише ЧИТАЄ пакети — він САМ
    пише теги для тайлів з Overpass (`AppContainer` → `put` → `encodeTags`),
    і там білий список Kotlin таки застосовується.

    Тому ключ, який знає Kotlin і не знає піч, дає правило, що спрацьовує
    ЗАЛЕЖНО ВІД ТОГО, ЗВІДКИ ПРИЇХАЛА ДОРОГА — і людина ніколи не зрозуміє,
    чому маршрут поводиться по-різному в тому самому місці.

    Зворотний бік (ми попереду Kotlin) НЕ падіння: `decodeTags` не фільтрує за
    списком, тож зайвий ключ у пакеті телефон прочитає. Тому перевіряємо
    напрямок, а не рівність — інакше сторож був би червоним щоразу, коли одна
    зі сторін просто йде першою.
    """
    if not store.exists():
        pytest.skip(f"дерева телефона нема на диску: {store}")
    phone = _kotlin_keys(store)
    missing = [k for k in phone if k not in ROUTING_KEYS]
    assert not missing, (
        f"телефон пише ці ключі, а піч їх не несе: {missing} — "
        "правило оживатиме залежно від походження дороги"
    )
    # Спільна підмножина мусить іти в ТОМУ САМОМУ порядку: він вирішує байти.
    common_ours = [k for k in ROUTING_KEYS if k in phone]
    common_theirs = [k for k in phone if k in ROUTING_KEYS]
    assert common_ours == common_theirs, (
        "спільні ключі йдуть у різному порядку — два кодувальники дадуть "
        "різні байти на тих самих тегах"
    )
