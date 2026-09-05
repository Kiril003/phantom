"""Побічні JSON-и: що ми знаємо про завантажений екстракт і про готовий пакет.

Пишемо лише через тимчасовий файл і `os.replace`: недописаний манифест поряд
із цілим пакетом гірший за його відсутність — він виглядає як опис, а описує
половину.

У манифест пакета йде `peak_rss_bytes` — ПОМІРЯНИЙ пік (VmHWM), а не оцінка.
`measured: false` означає «не поміряли», і читач (bake_capability) мусить
трактувати це як невідоме, що опускає стелю, а не як «дешево».
"""
from __future__ import annotations

import json
import os
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Optional

SIDECAR_VERSION = 1


def file_size(path: Path) -> Optional[int]:
    """Розмір або None — «ще нема» не сміє виглядати як «0 байт»."""
    try:
        return Path(path).stat().st_size
    except OSError:
        return None


def read_json(path: Path) -> Optional[dict[str, Any]]:
    """None — файла нема або він побитий. Побитий манифест не є описом."""
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def write_json_atomic(path: Path, data: dict[str, Any]) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".part")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2, sort_keys=True)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


@dataclass(frozen=True, slots=True)
class SourceMeta:
    """Що сервер сказав про екстракт, коли ми його брали.

    `etag` і `last_modified` — не прикраса: без них поновлення докачки Range
    може підклеїти хвіст СЬОГОДНІШНЬОГО файла до вчорашньої голови, і жодна
    перевірка довжини цього не побачить.

    `verified_by` називає, ЧИМ ми повірили файлові: "md5" (сайдкар Geofabrik)
    або "length+header" (точний Content-Length плюс успішний розбір заголовка
    osmium). Мовчазної третьої дороги «прийняли просто так» нема.
    """

    source_id: str
    url: str
    bytes: int
    etag: Optional[str] = None
    last_modified: Optional[str] = None
    md5: Optional[str] = None
    verified_by: str = ""
    fetched_at: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {"sidecar_version": SIDECAR_VERSION, **asdict(self)}

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Optional["SourceMeta"]:
        try:
            return cls(
                source_id=str(data["source_id"]),
                url=str(data["url"]),
                bytes=int(data["bytes"]),
                etag=data.get("etag"),
                last_modified=data.get("last_modified"),
                md5=data.get("md5"),
                verified_by=str(data.get("verified_by", "")),
                fetched_at=str(data.get("fetched_at", "")),
            )
        except (KeyError, TypeError, ValueError):
            return None


def pack_sidecar(
    *, scope_id: str, source: Optional[SourceMeta], pack: dict[str, Any],
    bake: dict[str, Any],
) -> dict[str, Any]:
    """Опис готового пакета. `scope_id` угорі — так його читає bake_capability."""
    return {
        "sidecar_version": SIDECAR_VERSION,
        "scope_id": scope_id,
        "pack": pack,
        "bake": bake,
        "source": source.to_dict() if source else None,
        "attribution": "OpenStreetMap contributors (ODbL)",
    }


def bake_facts(
    *, elapsed_s: float, input_bytes: Optional[int], ways_kept: int,
    rows_written: int, cells: int, peak_rss_bytes: Optional[int],
) -> dict[str, Any]:
    return {
        "elapsed_s": round(float(elapsed_s), 3),
        "input_bytes": input_bytes,
        "ways_kept": ways_kept,
        "rows_written": rows_written,
        "cells": cells,
        "peak_rss_bytes": peak_rss_bytes,
        "measured": peak_rss_bytes is not None,
    }
