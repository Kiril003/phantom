"""Що взагалі можна спекти — і жодного числа, яке протухає.

Тут лежить ЛИШЕ особистість джерела: id, українська назва, хост, шлях, а для
обсягу-прямокутника — його рамка. Розміру файлів тут нема свідомо.

ЧОМУ НЕ ВПИСАНО РОЗМІРИ. `europe/ukraine-latest.osm.pbf` перезбирається щодня.
Виміряні ввечері «876 МБ» до ранку стають упевненим числом, за яким уже нічого
не стоїть, — і ніщо не почервоніє, бо константа не вміє. Розмір беремо HEAD-ом
під час роботи й носимо як [Remote]: вимір, що має право не вдатись. Коли
`measured` == False, число не показуємо НІДЕ, а причину кладемо в `detail`.

Рамка Києва — навпаки, справжня константа: це НАШ обраний виріз (geo-stack/
prepare.sh:19), а не чужий артефакт, що змінюється без нас.

Обласних і міських обсягів, крім Києва, тут поки нема: `geo/place_catalogue.py`
є в дереві phantom-os, але НЕ в цьому. Доки його сюди не перенесено, вибір
«область» був би списком назв без жодної рамки за ними.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Optional

_MIB = 1024 ** 2
_GIB = 1024 ** 3

GEOFABRIK_HOST = "https://download.geofabrik.de"


@dataclass(frozen=True, slots=True)
class Source:
    """Один екстракт Geofabrik. Розміру в ньому нема й не буде."""

    id: str
    label_ua: str
    path: str

    @property
    def url(self) -> str:
        return f"{GEOFABRIK_HOST}/{self.path}"

    @property
    def md5_url(self) -> str:
        return self.url + ".md5"


@dataclass(frozen=True, slots=True)
class Scope:
    """Обсяг випікання. `bbox` — (min_lon, min_lat, max_lon, max_lat) або None."""

    id: str
    label_ua: str
    source_id: str
    tier: str  # "city" | "country" — узгоджено з bake_capability.BAKE_SCOPES
    bbox: Optional[tuple[float, float, float, float]] = None

    @property
    def pack_id(self) -> str:
        return f"phantom_road_mesh.{self.id}"


SOURCES: dict[str, Source] = {
    s.id: s
    for s in (
        Source("ukraine", "Україна", "europe/ukraine-latest.osm.pbf"),
        Source("poland", "Польща", "europe/poland-latest.osm.pbf"),
        Source("romania", "Румунія", "europe/romania-latest.osm.pbf"),
        Source("slovakia", "Словаччина", "europe/slovakia-latest.osm.pbf"),
        Source("hungary", "Угорщина", "europe/hungary-latest.osm.pbf"),
        Source("moldova", "Молдова", "europe/moldova-latest.osm.pbf"),
    )
}

# ── ПРАВИЛО, ЯКЕ НЕ МОЖНА «ОПТИМІЗУВАТИ» ─────────────────────────────────
#
# Дрібніший за країну обсяг ЗАВЖДИ береться з витягу КРАЇНИ і ріжеться рамкою
# локально. Ніколи не додавайте сюди обласний чи міський URL Geofabrik, навіть
# коли качати 876 МБ заради Києва здається марнотратством.
#
# Причина не в трафіку, а в тому, що видно збоку. Запит
# `ukraine-latest.osm.pbf` каже спостерігачеві рівно «хтось цікавиться
# Україною» — це майже нічого. Запит витягу однієї області каже «хтось
# цікавиться САМЕ ЦИМ районом», і для продукту, яким користуються у воюючій
# країні, різниця не теоретична. Локальне нарізання дає той самий пакет без
# цього сліду; ціна — один раз завантажений файл, який ми й так лишаємо на
# диску (`bake_keep_source_extracts`, за замовчуванням True).
#
# Рішення продукту 05.09.2026. Сам похід на Geofabrik лишається питанням
# власника; це правило звужує те, що похід розголошує.
SCOPES: tuple[Scope, ...] = (
    Scope("kyiv", "Київ", "ukraine", "city", (30.10, 50.15, 30.90, 50.66)),
    Scope("ukraine", "Україна", "ukraine", "country"),
    Scope("poland", "Польща", "poland", "country"),
    Scope("romania", "Румунія", "romania", "country"),
    Scope("slovakia", "Словаччина", "slovakia", "country"),
    Scope("hungary", "Угорщина", "hungary", "country"),
    Scope("moldova", "Молдова", "moldova", "country"),
)

_BY_ID: dict[str, Scope] = {s.id: s for s in SCOPES}


@dataclass(frozen=True, slots=True)
class Remote:
    """Розмір джерела як ВИМІР, а не як факт. `measured` False — числа нема."""

    bytes: Optional[int] = None
    last_modified: Optional[str] = None
    measured: bool = False
    measured_at: Optional[str] = None
    detail: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def scope(scope_id: str) -> Optional[Scope]:
    return _BY_ID.get(scope_id)


def source_of(scope_obj: Scope) -> Source:
    return SOURCES[scope_obj.source_id]


# ── ОЦІНКИ, І ТАК І ПІДПИСАНІ ──────────────────────────────────────────
# Кожна цифра нижче — оцінка з однієї-двох точок виміру, а не поміряна стеля.
# Правило одне: невідоме ПІДІЙМАЄ вимогу, ніколи не опускає.

# Київ 5 вересня 2026: екстракт 39 МБ -> пакет 51 МБ. Одна точка, тому для
# обсягу-прямокутника, вирізаного з країни, це ВЕРХНЯ межа (міський пакет —
# підмножина країнного), а не передбачення.
PACK_BYTES_PER_SOURCE_BYTE = 1.35

# flex_mem на Києві: 16.0 Б на вузол. Екстракт України 876 МБ несе 110 998 916
# вузлів -> 0.121 вузла на байт. Два виміри, перемножені: ~1.94 Б RAM на байт
# екстракту. Це ОЦІНКА, а не поміряне ціле випікання.
INDEX_BYTES_PER_SOURCE_BYTE = 16.0 * 0.121
_RAM_HEADROOM = 1.5

# Підлоги за рівнем — ті самі, що вже показує bake_capability, щоб продукт не
# називав дві різні стелі для однієї машини.
TIER_RAM_FLOOR: dict[str, int] = {"city": 2 * _GIB, "country": 8 * _GIB}


def estimate_pack_bytes(source_bytes: Optional[int]) -> Optional[int]:
    if source_bytes is None:
        return None
    return int(source_bytes * PACK_BYTES_PER_SOURCE_BYTE)


def estimate_needs_disk(source_bytes: Optional[int]) -> Optional[int]:
    """Екстракт лишається на диску, поряд лягає новий пакет і ще стоїть старий."""
    if source_bytes is None:
        return None
    pack = int(source_bytes * PACK_BYTES_PER_SOURCE_BYTE)
    return source_bytes + 2 * pack + 512 * _MIB


def estimate_needs_ram(scope_obj: Scope, source_bytes: Optional[int]) -> Optional[int]:
    """Для країни — індекс усіх вузлів. Для прямокутника — лише підлога рівня.

    Двопрохідний індекс міста тримає ТІЛЬКИ вузли всередині рамки, а яка це
    частка країни — не поміряно. Тому для «міста» ми не вигадуємо частку (це
    опустило б вимогу невідомим), а лишаємось на вже оголошеній підлозі рівня.
    """
    floor = TIER_RAM_FLOOR[scope_obj.tier]
    if scope_obj.bbox is not None or source_bytes is None:
        return floor
    return max(floor, int(source_bytes * INDEX_BYTES_PER_SOURCE_BYTE * _RAM_HEADROOM))
