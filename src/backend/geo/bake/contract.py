"""Форма правди про випікання — і те, чого в ній не може бути за побудовою.

Цю форму читають три сторони: панель на склі, роутер і спарені телефони через
WS. Тому найдорожче тут не поля, а їхня ВІДСУТНІСТЬ.

ЧОМУ В `bake` НЕМА НІ ВІДСОТКА, НІ ЗАЛИШКУ, НІ ETA. Скільки в файлі доріг —
невідомо, доки файл не прочитано до кінця: .osm.pbf не несе лічильника ліній,
а `osmium.io.Reader` не показує зміщення в потоці. Будь-який відсоток тут був
би поділом на вигадане число — тобто рівно тим «зеленим, що не вміє
почервоніти», яке цей проєкт ловить місяцями. Смуга, що доповзла до 90% і
стоїть годину, бреше голосніше, ніж чесний лічильник, що просто росте.

Тотали є лише там, де їх виміряно ззовні: `download.bytes_total` — це
Content-Length відповіді сервера, `verify.bytes_total` — це розмір файла на
диску. Обидва — факт, а не оцінка, і саме тому їм дозволено бути тоталами.

ЧОМУ НЕМА АБСОЛЮТНИХ ШЛЯХІВ. Знімок їде по WS на спарені телефони. `/home/
<імʼя власника>/...` у тексті помилки — це витік і імені, і структури машини
туди, де він нікому не потрібен. [redact_paths] зрізає його на вході в
[Outcome], а не «на виході, якщо не забудемо».
"""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from typing import Any, Optional

STAGES: tuple[str, ...] = (
    "preflight", "downloading", "verifying", "indexing", "baking",
    "finalizing", "done", "failed", "cancelled",
)
TERMINAL_STAGES: frozenset[str] = frozenset({"done", "failed", "cancelled"})
OUTCOME_KINDS: tuple[str, ...] = ("done", "failed", "cancelled")

# `unknown` дописано до списку лідера свідомо: несподіваний виняток на боці
# батька мусить мати СВОЮ причину, а не позичену. Назвати збій парсера
# «worker_error» означало б послати людину дивитись не туди.
OUTCOME_REASONS: tuple[str, ...] = (
    "low_memory", "low_disk", "network", "checksum", "worker_crashed",
    "worker_error", "corrupt", "osmium_missing", "offline", "unknown_scope",
    "shutdown", "user", "unknown",
)

# Заборонені СЛОВА в імені ключа, а не підрядки: «eta» підрядком сидить у
# `detail_ua`, `meta` і `beta`, тож підрядкова перевірка червоніла б на чесних
# полях і навчила б наступного її вимкнути. Сама впіймалась на цьому 05.09.
FORBIDDEN_KEY_WORDS: frozenset[str] = frozenset({"percent", "progress", "eta"})
FORBIDDEN_KEY_NAMES: frozenset[str] = frozenset({
    "ways_total", "nodes_total", "remaining", "pct", "percentage",
})
_WORDS = re.compile(r"[^a-z0-9]+")

# `//` (схема URL) і слеш після літери (хвіст URL) — не файлові шляхи.
# Адресу джерела в тексті помилки лишаємо: вона допомагає й нічого не видає.
_POSIX_PATH = re.compile(r"(?<![\w:/])/(?:[^\s/]+/)+[^\s/]*")
_WINDOWS_PATH = re.compile(r"(?<![\w])[A-Za-z]:\\(?:[^\s\\]+\\)*[^\s\\]*")


def _shorten(match: "re.Match[str]") -> str:
    tail = match.group(0).replace("\\", "/").rstrip("/").rsplit("/", 1)[-1]
    return "…/" + tail if tail else "…"


def redact_paths(text: str) -> str:
    """Лишити від абсолютного шляху лише останній сегмент."""
    return _WINDOWS_PATH.sub(_shorten, _POSIX_PATH.sub(_shorten, text or ""))


@dataclass(frozen=True, slots=True)
class DownloadProgress:
    """Єдина стадія з чесним тоталом — його назвав сервер."""

    bytes_done: int = 0
    bytes_total: Optional[int] = None
    resumed_from_bytes: int = 0
    rate_bps: Optional[float] = None
    source_last_modified: Optional[str] = None
    from_cache: bool = False

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True, slots=True)
class VerifyProgress:
    """Тотал — розмір файла, який уже лежить на диску."""

    bytes_hashed: int = 0
    bytes_total: int = 0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True, slots=True)
class BakeProgress:
    """Лише лічильники, що ростуть. Жодного знаменника — його не існує.

    `nodes_seen` — None для обсягу-країни, і це не недогляд. Там індекс вузлів
    будує сам osmium у C++ одним викликом: жодного вузла ми не бачимо, тож
    поставити туди 0 означало б сказати «вузлів не було» замість «ми їх не
    рахували». Число там зʼявляється лише в двопрохідному режимі bbox, де ми
    справді проходимо вузли самі.
    `nodes_kept` — None усюди, крім bbox: без рамки нема чого відкидати.
    `input_bytes` і `ram_available_pct` — None, доки не поміряно; нуль тут
    був би невідомим, вдягненим у число.
    """

    nodes_seen: Optional[int] = None
    nodes_kept: Optional[int] = None
    ways_seen: int = 0
    ways_kept: int = 0
    rows_written: int = 0
    cells: int = 0
    elapsed_s: float = 0.0
    ram_available_pct: Optional[float] = None
    input_bytes: Optional[int] = None
    # stat() недопеченого файла й дискового індексу — факт із диска, і єдина
    # ознака життя між зливами партій по 5 000 рядків. Це не тотал і не
    # частка: файл росте, і ніхто не знає, до чого.
    output_bytes: Optional[int] = None
    index_bytes: Optional[int] = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True, slots=True)
class GuardFacts:
    """Числа сторожі памʼяті — щоб скло не зашивало «30» у себе."""

    floor_pct: float
    strikes_to_trip: int
    poll_s: float

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True, slots=True)
class Outcome:
    """Чим скінчилось і чому — однією причиною з відомого списку."""

    kind: str
    reason: Optional[str] = None
    detail_ua: str = ""

    def __post_init__(self) -> None:
        if self.kind not in OUTCOME_KINDS:
            raise ValueError(f"невідомий kind: {self.kind!r}")
        # Успіх — єдиний випадок без причини: жодне зі слів списку не описує
        # «нічого не сталось», а підкласти туди «user» означало б сказати, що
        # пакет спекла воля людини, а не робота.
        if self.reason is None:
            if self.kind != "done":
                raise ValueError(f"{self.kind} мусить назвати причину")
        elif self.reason not in OUTCOME_REASONS:
            raise ValueError(f"невідома reason: {self.reason!r}")
        object.__setattr__(self, "detail_ua", redact_paths(self.detail_ua))

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True, slots=True)
class PackRecord:
    """Пакет, який уже видно в road/ — тобто цілий.

    `format_version` тут — те, що ПРОЧИТАНО з готового файла через
    `PRAGMA user_version`, а не константа, з якою його писали. Константа
    сказала б, що ми хотіли записати; pragma каже, що записалось.
    """

    pack_id: str
    bytes: int
    format_version: int
    sha256: str
    way_count: int
    row_count: int
    cell_count: int
    baked_at: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True, slots=True)
class PreviousBake:
    """Попереднє випікання цього ж обсягу — єдине чесне «скільки це триває».

    Не прогноз: показуємо, скільки зайняло МИНУЛОГО разу на ЦІЙ машині.
    """

    way_count: int
    elapsed_s: float
    baked_at: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True, slots=True)
class JobStatus:
    job_id: str
    scope_id: str
    label_ua: str
    stage: str
    started_at: str
    updated_at: str
    download: DownloadProgress = field(default_factory=DownloadProgress)
    verify: VerifyProgress = field(default_factory=VerifyProgress)
    bake: BakeProgress = field(default_factory=BakeProgress)
    outcome: Optional[Outcome] = None
    pack: Optional[PackRecord] = None
    previous: Optional[PreviousBake] = None
    guard: Optional[GuardFacts] = None

    def __post_init__(self) -> None:
        if self.stage not in STAGES:
            raise ValueError(f"невідома стадія: {self.stage!r}")

    def as_dict(self) -> dict[str, Any]:
        return {
            "job_id": self.job_id,
            "scope_id": self.scope_id,
            "label_ua": self.label_ua,
            "stage": self.stage,
            "started_at": self.started_at,
            "updated_at": self.updated_at,
            "download": self.download.to_dict(),
            "verify": self.verify.to_dict(),
            "bake": self.bake.to_dict(),
            "outcome": self.outcome.to_dict() if self.outcome else None,
            "pack": self.pack.to_dict() if self.pack else None,
            "previous": self.previous.to_dict() if self.previous else None,
            "guard": self.guard.to_dict() if self.guard else None,
        }

    # Лідер назвав метод to_dict(), сусідній агент — as_dict(). Один і той
    # самий словник під двома іменами дешевший за домовляння.
    to_dict = as_dict

    @property
    def is_terminal(self) -> bool:
        return self.stage in TERMINAL_STAGES


def audit_snapshot(snapshot: dict[str, Any]) -> list[str]:
    """Що в цьому знімку порушує правила чесності. Порожньо == чисто.

    Живе тут, а не в тестах, бо межу мусить мати можливість перевірити й той,
    хто додає поле, — а не лише той, хто пише тест.
    """
    faults: list[str] = []

    def walk(node: Any, path: str) -> None:
        if isinstance(node, dict):
            for key, value in node.items():
                here = f"{path}.{key}" if path else str(key)
                lowered = str(key).lower()
                words = set(_WORDS.split(lowered))
                if words & FORBIDDEN_KEY_WORDS or lowered in FORBIDDEN_KEY_NAMES:
                    faults.append(f"заборонений ключ {here}")
                if lowered == "bytes_total" and not path.startswith(
                    ("download", "verify")
                ):
                    faults.append(f"тотал поза download/verify: {here}")
                walk(value, here)
        elif isinstance(node, (list, tuple)):
            for i, value in enumerate(node):
                walk(value, f"{path}[{i}]")
        elif isinstance(node, str):
            if _POSIX_PATH.search(node) or _WINDOWS_PATH.search(node):
                faults.append(f"абсолютний шлях у {path}")

    walk(snapshot, "")
    bake = snapshot.get("bake")
    if isinstance(bake, dict):
        for key in bake:
            if str(key).endswith("_total"):
                faults.append(f"тотал у bake: {key}")
    return faults


def merge_bake_tick(previous: BakeProgress, ev: dict[str, Any]) -> BakeProgress:
    """Злити тік у попередній стан: чого в тіку нема — того й не міняємо.

    Серцебиття несе лише час і памʼять; якби відсутнє поле означало нуль,
    лічильники стрибали б назад на кожному ударі.
    """
    fields = {
        "nodes_seen": previous.nodes_seen, "nodes_kept": previous.nodes_kept,
        "ways_seen": previous.ways_seen, "ways_kept": previous.ways_kept,
        "rows_written": previous.rows_written, "cells": previous.cells,
        "elapsed_s": previous.elapsed_s,
        "ram_available_pct": previous.ram_available_pct,
        "input_bytes": previous.input_bytes,
        "output_bytes": previous.output_bytes, "index_bytes": previous.index_bytes,
    }
    for key in list(fields):
        if key in ev and ev[key] is not None:
            fields[key] = ev[key]
    return BakeProgress(**fields)  # type: ignore[arg-type]


def previous_from_sidecar(sidecar: Optional[dict[str, Any]]) -> Optional[PreviousBake]:
    if not sidecar:
        return None
    pack = sidecar.get("pack") or {}
    bake = sidecar.get("bake") or {}
    try:
        return PreviousBake(way_count=int(pack["way_count"]),
                            elapsed_s=float(bake["elapsed_s"]),
                            baked_at=str(pack["baked_at"]))
    except (KeyError, TypeError, ValueError):
        return None


def status_from_dict(data: dict[str, Any]) -> Optional[JobStatus]:
    try:
        outcome = data.get("outcome")
        pack = data.get("pack")
        prev = data.get("previous")
        guard = data.get("guard")
        return JobStatus(
            job_id=str(data["job_id"]), scope_id=str(data["scope_id"]),
            label_ua=str(data["label_ua"]), stage=str(data["stage"]),
            started_at=str(data["started_at"]), updated_at=str(data["updated_at"]),
            download=DownloadProgress(**data.get("download", {})),
            verify=VerifyProgress(**data.get("verify", {})),
            bake=BakeProgress(**data.get("bake", {})),
            outcome=Outcome(**outcome) if outcome else None,
            pack=PackRecord(**pack) if pack else None,
            previous=PreviousBake(**prev) if prev else None,
            guard=GuardFacts(**guard) if guard else None,
        )
    except (KeyError, TypeError, ValueError):
        return None
