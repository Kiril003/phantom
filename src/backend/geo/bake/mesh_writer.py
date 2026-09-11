"""Кодек і таблиця `ways` — байт у байт те, що читає телефон.

════════════════════════════════════════════════════════════════════════
ЧОМУ ТУТ 2, А НЕ 3. Це найдорожче рішення в усьому випіканні.

Ми пишемо `PRAGMA user_version = 2` і ТІЛЬКИ таблицю `ways`. Ні `stops`, ні
`rails`, ні `routes`.

Поруч, у /home/.../road-mesh-bake/mesh_bake.py, того ж вечора зʼявився
DB_VERSION 3 з транспортними таблицями, і його docstring стверджує, що схему
«replicated EXACTLY from core-sensor/nav/RoadMeshStore.kt (DB_VERSION 3)».
Заміряно 5 вересня 2026, читанням самих файлів:

  * phantom-companion/.../nav/RoadMeshStore.kt:196  ->  DB_VERSION = 2
  * wt-roadpack-android @ wave/roadpack-reach-05sep:225  ->  DB_VERSION = 2
  * TransitCodec / TransitStore для транспорту З ПАКЕТА — не існує в жодному
    дереві компаньйона (є лише TransitCodecTest.kt у чужому worktree
    wt-transit-05sep, тобто тест без спожитого продукту).

Тобто трійка сьогодні описує дерево, якого телефон не має. Пакет v3 виглядав
би повним — 65 тисяч зупинок, маршрути, колії, +9 МБ — і не мав би ЖОДНОГО
читача. Це рівно той клас дефекту, який цей проєкт ловить щотижня: написане,
але не викликане; зелене, що не вміє почервоніти. Гірше: телефон з
DB_VERSION 2 відкриє файл, у якого user_version 3, і SQLiteOpenHelper вважає
це пониженням версії — тобто пакет не просто буде неповним, він буде
ВІДМОВЛЕНИМ, і винним здаватиметься телефон.

Коли дерево телефона оголосить 3 РАЗОМ із читачем, ця константа й транспортний
прохід міняються в одному коміті, що цитує той файл і той рядок.
════════════════════════════════════════════════════════════════════════
"""
from __future__ import annotations

import hashlib
import math
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterable, Optional, Sequence

FORMAT_VERSION = 2
CELL_DEG = 0.02          # RoadMeshStore.CELL_DEG
MASK32 = 0xFFFFFFFF
U64 = 0xFFFFFFFFFFFFFFFF
BATCH_ROWS = 5_000       # і одиниця кооперативної перевірки памʼяті

# RoadWayCodec.ROUTING_KEYS у порядку ОГОЛОШЕННЯ: encodeTags обходить білий
# список, а не вхід, тож саме цей порядок вирішує байти.
#
# `motorroad` — ДОДАНО 05.09.2026 за рішенням продукту, і він тут у хвості
# навмисно. Це не клас дороги, а властивість: «правила як на автомагістралі» —
# без пішоходів, без велосипедистів. `RoadProfile.kt:80` читає `tags`
# ["motorroad"] і відмовляє пішому, але ключ не стояв у жодному білому списку,
# тож правило не могло спрацювати НІ НА ЯКОМУ пакеті. Маршрут, що зникне після
# цієї зміни, — маршрут, якого не мало бути.
#
# Чому працює без правки Kotlin: `RoadMeshStore.decodeTags` (рядок 273) НЕ
# фільтрує за білим списком — він розбирає кожну пару `k=v`. Білий список
# керує лише КОДУВАННЯМ. Тому досить, щоб ключ писала пічка.
#
# Чому в КІНЦІ, а не поруч з `access`, куди він просився б за змістом: порядок
# тут вирішує байти (encodeTags обходить список, а не вхід). Дописаний у хвіст
# ключ лишає взаємний порядок усіх наявних пар незмінним, тож пакет «до» і
# «після» відрізняються рівно однією доданою парою. Вставка в середину
# переписала б кожен рядок і зробила б будь-яку звірку з попереднім пакетом
# нечитабельною. Сусідня пічка (`road-mesh-bake/mesh_bake.py`) мусить додати
# його ТУДИ Ж, інакше два пекарі розійдуться байтами.
#
# Ключі lanes…destination у головному дереві компаньйона сьогодні не читає
# ніхто: v2-й RoadWayCodec.ROUTING_KEYS має 17 ключів. Вони тут заради
# байтової тотожності двох пічок; це вантаж, а не функція.
ROUTING_KEYS: tuple[str, ...] = (
    "highway", "access", "foot", "vehicle", "motor_vehicle", "bicycle",
    "service", "surface", "maxspeed", "lit", "bridge", "tunnel",
    "junction", "sidewalk", "smoothness", "width", "incline",
    "lanes", "turn:lanes", "turn:lanes:forward", "turn:lanes:backward",
    "destination",
    "motorroad",
    "ford",
)

# RoadWayCodec.PIPE_ESCAPE. У головному дереві v2 розекранування ще нема, тож
# `turn:lanes=left%7Cthrough` там читається дослівно й нічим не керує. Але без
# екранування сира риска РОЗІРВАЛА Б потік тегів і зліпила б хибну пару —
# тобто escape тут захищає сусідні ключі, а не власний.
PIPE_ESCAPE = "%7C"

_TRUE_ONEWAY = frozenset({"yes", "1", "true"})

_CREATE_WAYS = (
    "CREATE TABLE ways("
    "cell INTEGER NOT NULL, id INTEGER NOT NULL, name TEXT, "
    "oneway INTEGER NOT NULL, pts TEXT NOT NULL, tags TEXT, "
    "PRIMARY KEY(cell, id))"
)
_INSERT_WAY = (
    "INSERT OR REPLACE INTO ways(cell,id,name,oneway,pts,tags) "
    "VALUES(?,?,?,?,?,?)"
)


def cell_key(la: int, lo: int) -> int:
    """(la shl 32) xor (lo and 0xFFFFFFFFL), звужене до знакового 64 — як у JVM."""
    v = ((la << 32) ^ (lo & MASK32)) & U64
    return v - (1 << 64) if v >= (1 << 63) else v


def cells_covering(
    min_lat: float, min_lon: float, max_lat: float, max_lon: float
) -> Iterable[int]:
    """Порт RoadMeshStore.cellsCovering.

    Стелі MAX_COVER_CELLS (1024) тут нема, і це відрізняється від телефона
    свідомо: там вона рятує від зіпсованої лінії через континент, тут дорогу
    краще записати зайвими рядками, ніж мовчки викинути. Скільки ліній
    перетнули б ту стелю — worker рахує й пише в лог.
    """
    lat_from = math.floor(min_lat / CELL_DEG)
    lat_to = math.floor(max_lat / CELL_DEG)
    lon_from = math.floor(min_lon / CELL_DEG)
    lon_to = math.floor(max_lon / CELL_DEG)
    for la in range(lat_from, lat_to + 1):
        for lo in range(lon_from, lon_to + 1):
            yield cell_key(la, lo)


def encode_points(pts: Sequence[tuple[float, float]]) -> str:
    """RoadWayCodec.encodePoints: 'lat,lon;lat,lon;…', 6 знаків, Locale.US."""
    return ";".join("%.6f,%.6f" % (lat, lon) for lat, lon in pts)


def encode_tags(
    props: dict[str, Any], keys: Sequence[str] = ROUTING_KEYS
) -> str:
    """RoadWayCodec.encodeTags: 'k=v|k=v', порядок білого списку, порожні геть.

    Значення з '=' пропускаємо: його ні на що замінити, не зруйнувавши пару.
    """
    out: list[str] = []
    for k in keys:
        v = props.get(k)
        if v is None:
            continue
        v = str(v)
        if not v or "=" in v:
            continue
        out.append(k + "=" + v.replace("|", PIPE_ESCAPE))
    return "|".join(out)


@dataclass(frozen=True, slots=True)
class PackFacts:
    """Те, що прочитано з ГОТОВОГО файла, а не те, з чим його писали."""

    bytes: int
    format_version: int
    sha256: str
    way_count: int
    row_count: int
    cell_count: int


class MeshWriter:
    """Пише .db.part. Не публікує нічого — публікація живе в [finalize]."""

    def __init__(
        self, path: Path, *, on_flush: Optional[Callable[[], None]] = None,
        batch_rows: int = BATCH_ROWS,
    ) -> None:
        self.path = Path(path)
        self._on_flush = on_flush
        self._batch_rows = batch_rows
        self._batch: list[tuple[Any, ...]] = []
        self._cells: set[int] = set()
        self.ways_kept = 0
        self.rows_written = 0
        self.wide_ways = 0  # ліній, ширших за телефонну стелю MAX_COVER_CELLS
        self._con = sqlite3.connect(str(self.path))
        # Журнал і fsync вимкнено: файл усе одно нічого не варт, доки не
        # пройшов finalize, а падіння посеред випікання лікується повторним
        # випіканням, не відкотом.
        self._con.execute("PRAGMA journal_mode=OFF")
        self._con.execute("PRAGMA synchronous=OFF")
        self._con.execute(_CREATE_WAYS)

    def __enter__(self) -> "MeshWriter":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    def add_way(
        self, way_id: int, pts: Sequence[tuple[float, float]],
        props: dict[str, Any],
    ) -> int:
        if len(pts) < 2:
            return 0
        lats = [p[0] for p in pts]
        lons = [p[1] for p in pts]
        enc = encode_points(pts)
        name = props.get("name")
        oneway = 1 if props.get("oneway") in _TRUE_ONEWAY else 0
        tags = encode_tags(props)
        added = 0
        for cell in cells_covering(min(lats), min(lons), max(lats), max(lons)):
            self._batch.append((cell, way_id, name, oneway, enc, tags))
            self._cells.add(cell)
            added += 1
        if added > 1024:
            self.wide_ways += 1
        self.ways_kept += 1
        self.rows_written += added
        if len(self._batch) >= self._batch_rows:
            self.flush()
        return added

    def flush(self) -> None:
        if self._batch:
            self._con.executemany(_INSERT_WAY, self._batch)
            self._batch.clear()
        # Гачок кооперативної зупинки. Кидає — значить, зупиняємось; SQLite
        # закриється в close() через __exit__, а не лишиться напіврозірваним.
        if self._on_flush is not None:
            self._on_flush()

    @property
    def cell_count(self) -> int:
        return len(self._cells)

    def close(self) -> None:
        if self._con is None:
            return
        if self._batch:
            self._con.executemany(_INSERT_WAY, self._batch)
            self._batch.clear()
        self._con.execute(f"PRAGMA user_version = {FORMAT_VERSION}")
        self._con.commit()
        self._con.close()
        self._con = None  # type: ignore[assignment]


def finalize(part_path: Path) -> PackFacts:
    """Прочитати готовий файл і сказати, що в ньому НАСПРАВДІ.

    Порядок навмисний: спершу цілісність (`quick_check`), і лише потім
    лічильники — рахувати рядки в побитому файлі означало б рапортувати
    впевнене число з розваленого сховища.
    """
    part_path = Path(part_path)
    con = sqlite3.connect(f"file:{part_path}?mode=ro", uri=True)
    try:
        check = con.execute("PRAGMA quick_check").fetchone()
        if not check or str(check[0]).lower() != "ok":
            raise sqlite3.DatabaseError(f"quick_check: {check[0] if check else '?'}")
        version = int(con.execute("PRAGMA user_version").fetchone()[0])
        ways = int(con.execute("SELECT COUNT(DISTINCT id) FROM ways").fetchone()[0])
        rows = int(con.execute("SELECT COUNT(*) FROM ways").fetchone()[0])
        cells = int(con.execute("SELECT COUNT(DISTINCT cell) FROM ways").fetchone()[0])
    finally:
        con.close()
    digest = hashlib.sha256()
    with open(part_path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return PackFacts(
        bytes=part_path.stat().st_size,
        format_version=version,
        sha256=digest.hexdigest(),
        way_count=ways,
        row_count=rows,
        cell_count=cells,
    )
