"""UA oblast / region centroids — Phase 24-F.

Used by the AirRaid + Frontline layers so the frontend can render an
oblast-level marker before the full admin-shape GeoJSON bundle ships
in 24-G. Each entry maps a stable lowercase ASCII id (matching
alarms.in.ua's `oblast` slugs) to a name + centroid + ISO-3166-2
code. Coordinates are the geometric centroid of the oblast polygon
to within ~5 km — operator-readable, not survey-grade.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class OblastCentroid:
    id: str
    name_ua: str
    name_en: str
    iso: str
    lat: float
    lon: float


_CENTROIDS: tuple[OblastCentroid, ...] = (
    OblastCentroid("cherkasy", "Черкаська область", "Cherkasy", "UA-71", 49.20, 31.43),
    OblastCentroid("chernihiv", "Чернігівська область", "Chernihiv", "UA-74", 51.50, 31.30),
    OblastCentroid("chernivtsi", "Чернівецька область", "Chernivtsi", "UA-77", 48.30, 25.94),
    OblastCentroid("crimea", "Автономна Республіка Крим", "Crimea", "UA-43", 45.30, 34.80),
    OblastCentroid("dnipro", "Дніпропетровська область", "Dnipropetrovsk", "UA-12", 48.40, 35.14),
    OblastCentroid("donetsk", "Донецька область", "Donetsk", "UA-14", 48.00, 37.80),
    OblastCentroid("ivano-frankivsk", "Івано-Франківська область", "Ivano-Frankivsk", "UA-26", 48.92, 24.71),
    OblastCentroid("kharkiv", "Харківська область", "Kharkiv", "UA-63", 49.97, 36.30),
    OblastCentroid("kherson", "Херсонська область", "Kherson", "UA-65", 46.65, 33.54),
    OblastCentroid("khmelnytskyi", "Хмельницька область", "Khmelnytskyi", "UA-68", 49.42, 26.99),
    OblastCentroid("kirovohrad", "Кіровоградська область", "Kirovohrad", "UA-35", 48.51, 32.27),
    OblastCentroid("kyiv-city", "Київ", "Kyiv (city)", "UA-30", 50.45, 30.52),
    OblastCentroid("kyiv", "Київська область", "Kyiv (oblast)", "UA-32", 50.10, 30.65),
    OblastCentroid("luhansk", "Луганська область", "Luhansk", "UA-09", 49.00, 38.80),
    OblastCentroid("lviv", "Львівська область", "Lviv", "UA-46", 49.65, 24.05),
    OblastCentroid("mykolaiv", "Миколаївська область", "Mykolaiv", "UA-48", 47.40, 31.78),
    OblastCentroid("odesa", "Одеська область", "Odesa", "UA-51", 46.50, 30.42),
    OblastCentroid("poltava", "Полтавська область", "Poltava", "UA-53", 49.59, 33.97),
    OblastCentroid("rivne", "Рівненська область", "Rivne", "UA-56", 50.91, 26.30),
    OblastCentroid("sevastopol", "Севастополь", "Sevastopol", "UA-40", 44.60, 33.50),
    OblastCentroid("sumy", "Сумська область", "Sumy", "UA-59", 50.91, 34.75),
    OblastCentroid("ternopil", "Тернопільська область", "Ternopil", "UA-61", 49.55, 25.55),
    OblastCentroid("vinnytsia", "Вінницька область", "Vinnytsia", "UA-05", 49.20, 28.61),
    OblastCentroid("volyn", "Волинська область", "Volyn", "UA-07", 51.20, 24.60),
    OblastCentroid("zakarpattia", "Закарпатська область", "Zakarpattia", "UA-21", 48.50, 23.10),
    OblastCentroid("zaporizhzhia", "Запорізька область", "Zaporizhzhia", "UA-23", 47.60, 35.50),
    OblastCentroid("zhytomyr", "Житомирська область", "Zhytomyr", "UA-18", 50.40, 28.70),
)


_BY_ID: dict[str, OblastCentroid] = {c.id: c for c in _CENTROIDS}


def lookup(oblast_id: str) -> OblastCentroid | None:
    return _BY_ID.get(oblast_id.lower())


def all_oblasts() -> tuple[OblastCentroid, ...]:
    return _CENTROIDS
