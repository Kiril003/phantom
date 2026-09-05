"""Випікання в ОКРЕМОМУ процесі. Рядок JSON на stdout — увесь протокол.

ЧОМУ ПРОЦЕС, А НЕ ПОТІК. Три виміряні причини, кожної вистачило б окремо:

  * демон oom-guard на цій машині стріляє ЗА ІМЕНЕМ, і `uvicorn` стоїть у
    його списку PREFER першим. Випікання всередині сервера робить сервер
    найтовстішою мішенню — і гине не бейк, а весь продукт;
  * pyosmium віддає обʼєкти по одному, і кожна віддача забирає GIL. Сорок
    хвилин такої роботи в процесі сервера — це сорок хвилин голодного WS-хаба;
  * дитину можна чесно спинити: SIGTERM, пільга, SIGKILL. Потік — ні.

ЧОМУ ІНДЕКС ВИРІШУЄТЬСЯ ТУТ, А НЕ ФІЛЬТРОМ. `FileProcessor.__iter__` ставить
NodeLocationsForWays ПЕРЕД усіма фільтрами, тож bbox-фільтр індексу не
зменшує — він відсіює вже після того, як памʼять зайнято. Тому для міського
обсягу, вирізаного з країни, тут ДВА проходи: перший кладе в індекс лише
вузли всередині рамки, другий іде по дорогах. Для країни навпаки — один
прохід із дисковим індексом.

Оцінка розміру індексу країни: на Києві flex_mem дав 16.0 Б на вузол, а
екстракт України несе 110 998 916 вузлів -> ~1.78 ГБ. Це ОЦІНКА з двох вимірів,
а не поміряне ціле випікання.

ЧОМУ ПІД ЧАС ІНДЕКСУ СЕРЦЕБИТТЯ МОЖЕ ВБИТИ ПРОЦЕС САМЕ. Поки osmium будує
індекс у C++, головний потік не питає нічого — а це найтовстіша хвилина всього
випікання. У цей момент бази ще нема, псувати нічого, тож окремий потік має
право вийти кодом 75 негайно. Коли база вже відкрита, самозупинка йде лише
через кооперативну перевірку на зливі партії, яка встигає закрити SQLite.
"""
from __future__ import annotations

import json
import os
import sys
import threading
import time
from pathlib import Path
from typing import Any, Optional

from .mesh_writer import BATCH_ROWS, MeshWriter
from .watchdog import (
    DEFAULT_FLOOR_PCT, EXIT_SELF_STOPPED, LowMemory, available_pct,
    cooperative_check, read_pressure,
)

HEARTBEAT_S = 2.0
TICK_EVERY_WAYS = 20_000
TICK_EVERY_NODES = 2_000_000

_LOCK = threading.Lock()


def emit(**payload: Any) -> None:
    line = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    with _LOCK:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()


def peak_rss_bytes() -> Optional[int]:
    try:
        for line in Path("/proc/self/status").read_text(encoding="ascii").splitlines():
            if line.startswith("VmHWM:"):
                return int(line.split()[1]) * 1024
    except (OSError, ValueError, IndexError):
        return None
    return None


class Heartbeat(threading.Thread):
    """Ознака життя без жодного вигаданого числа — і сторож на час індексу."""

    def __init__(self, *, floor_pct: float) -> None:
        super().__init__(daemon=True)
        self._stop = threading.Event()
        # Озброєне серцебиття має право вбити процес саме. Роззброюємо його
        # РАНІШЕ, ніж відкриємо SQLite: після цього моменту різкий вихід уже
        # лишав би по собі напівзаписаний файл.
        self._armed = threading.Event()
        self._armed.set()
        self._floor = floor_pct
        self.began = time.monotonic()

    def run(self) -> None:
        while not self._stop.wait(HEARTBEAT_S):
            pct = available_pct()
            emit(ev="tick", elapsed_s=round(time.monotonic() - self.began, 2),
                 ram_available_pct=pct)
            if self._armed.is_set() and pct is not None and pct < self._floor:
                emit(ev="error", reason="low_memory",
                     detail=f"на індексі лишилось {pct:.1f}% RAM "
                            f"(PSI some avg10={read_pressure()})")
                sys.stdout.flush()
                os._exit(EXIT_SELF_STOPPED)

    def disarm(self) -> None:
        self._armed.clear()

    def stop(self) -> None:
        self._armed.clear()
        self._stop.set()


def _in_bbox(lon: float, lat: float, bbox: tuple[float, float, float, float]) -> bool:
    return bbox[0] <= lon <= bbox[2] and bbox[1] <= lat <= bbox[3]


def _index_bbox(src: str, bbox: tuple[float, float, float, float], beat: Heartbeat):
    """Прохід 1: у індекс лягають ТІЛЬКИ вузли всередині рамки."""
    import osmium

    idx = osmium.index.create_map("flex_mem")
    seen = kept = 0
    for node in osmium.FileProcessor(src, osmium.osm.NODE):
        seen += 1
        loc = node.location
        if loc.valid() and _in_bbox(loc.lon, loc.lat, bbox):
            idx.set(node.id, loc)
            kept += 1
        if seen % TICK_EVERY_NODES == 0:
            emit(ev="tick", nodes_seen=seen, nodes_kept=kept,
                 elapsed_s=round(time.monotonic() - beat.began, 2),
                 ram_available_pct=available_pct())
    emit(ev="tick", nodes_seen=seen, nodes_kept=kept,
         elapsed_s=round(time.monotonic() - beat.began, 2),
         ram_available_pct=available_pct())
    return idx, seen, kept


def _bake(argv_src: str, out: str, bbox, index_spec: str, floor_pct: float) -> int:
    import osmium

    began = time.monotonic()
    input_bytes = Path(argv_src).stat().st_size
    nodes_seen: Optional[int] = None
    nodes_kept: Optional[int] = None

    emit(ev="stage", stage="indexing")
    beat = Heartbeat(floor_pct=floor_pct)
    beat.start()
    idx = None
    try:
        if bbox is not None:
            idx, nodes_seen, nodes_kept = _index_bbox(argv_src, bbox, beat)
            fp = osmium.FileProcessor(argv_src, osmium.osm.WAY).with_filter(
                osmium.filter.KeyFilter("highway"))
        else:
            # `.with_locations()` ВИМАГАЄ вузлів у наборі сутностей: без
            # osmium.osm.NODE тут летить RuntimeError("Nodes not read from
            # file"). EntityFilter потім лишає у видачі самі дороги.
            fp = (osmium.FileProcessor(argv_src, osmium.osm.NODE | osmium.osm.WAY)
                  .with_locations(index_spec)
                  .with_filter(osmium.filter.EntityFilter(osmium.osm.WAY))
                  .with_filter(osmium.filter.KeyFilter("highway")))
        iterator = iter(fp)
    finally:
        if bbox is not None:
            beat.stop()

    ways_seen = 0
    writer: Optional[MeshWriter] = None
    stopped_low = False
    try:
        # Перший yield у режимі країни — це і є кінець індексування.
        first = next(iterator, None)
        beat.disarm()
        beat.stop()
        emit(ev="stage", stage="baking")
        writer = MeshWriter(
            Path(out),
            on_flush=lambda: cooperative_check(floor_pct),
            batch_rows=BATCH_ROWS,
        )
        last_tick = time.monotonic()
        obj = first
        while obj is not None:
            ways_seen += 1
            if bbox is None:
                pts = [(n.lat, n.lon) for n in obj.nodes if n.location.valid()]
            else:
                pts = []
                for ref in obj.nodes:
                    try:
                        loc = idx.get(ref.ref)  # type: ignore[union-attr]
                    except KeyError:
                        continue
                    pts.append((loc.lat, loc.lon))
            if len(pts) >= 2:
                writer.add_way(obj.id, pts, {k: v for k, v in obj.tags})
            now = time.monotonic()
            if ways_seen % TICK_EVERY_WAYS == 0 or now - last_tick >= HEARTBEAT_S:
                last_tick = now
                emit(ev="tick", nodes_seen=nodes_seen, nodes_kept=nodes_kept,
                     ways_seen=ways_seen, ways_kept=writer.ways_kept,
                     rows_written=writer.rows_written, cells=writer.cell_count,
                     elapsed_s=round(now - began, 2),
                     ram_available_pct=available_pct(), input_bytes=input_bytes)
            obj = next(iterator, None)
    except LowMemory as exc:
        stopped_low = True
        emit(ev="error", reason="low_memory",
             detail=f"{exc} (PSI some avg10={read_pressure()})")
    finally:
        beat.stop()
        if writer is not None:
            writer.close()

    if stopped_low:
        return EXIT_SELF_STOPPED
    assert writer is not None
    if writer.wide_ways:
        print(f"ліній ширших за 1024 комірки: {writer.wide_ways}", file=sys.stderr)
    emit(ev="done", nodes_seen=nodes_seen, nodes_kept=nodes_kept,
         ways_seen=ways_seen, ways_kept=writer.ways_kept,
         rows_written=writer.rows_written, cells=writer.cell_count,
         elapsed_s=round(time.monotonic() - began, 2),
         ram_available_pct=available_pct(), input_bytes=input_bytes,
         peak_rss_bytes=peak_rss_bytes())
    return 0


def _selftest() -> int:
    """Довести, що osmium ПРАЦЮЄ, а не що він імпортується.

    Дані дира не торкаємось узагалі: цей самотест бігає на машині, яка ще
    жодного разу не запускала продукт.
    """
    import tempfile
    try:
        import osmium
        import osmium.osm.mutable as mutable
    except Exception as exc:
        print(f"osmium_from=?\nFAIL import:{type(exc).__name__}")
        return 1
    print(f"osmium_from={getattr(osmium, '__file__', '?')}")
    try:
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "selftest.osm.pbf")
            writer = osmium.SimpleWriter(path)
            writer.add_node(mutable.Node(id=1, location=(30.5, 50.4)))
            writer.add_node(mutable.Node(id=2, location=(30.6, 50.5)))
            writer.add_way(mutable.Way(id=1, nodes=[1, 2], tags={"highway": "residential"}))
            writer.close()
            found = [
                o.id for o in osmium.FileProcessor(
                    path, osmium.osm.NODE | osmium.osm.WAY)
                .with_locations()
                .with_filter(osmium.filter.EntityFilter(osmium.osm.WAY))
                .with_filter(osmium.filter.KeyFilter("highway"))
            ]
    except OSError as exc:
        print(f"FAIL tempdir:{exc.errno}")
        return 1
    except Exception as exc:
        print(f"FAIL roundtrip:{type(exc).__name__}:{exc}")
        return 1
    if found != [1]:
        print(f"FAIL roundtrip:got {found!r}")
        return 1
    print("OK")
    return 0


def _arg(argv: list[str], name: str, default: Optional[str] = None) -> Optional[str]:
    return argv[argv.index(name) + 1] if name in argv else default


def worker_cli(argv: list[str]) -> int:
    """argv БЕЗ імені програми. Повертає код виходу."""
    if "--selftest" in argv:
        return _selftest()
    try:
        os.nice(10)  # випікання поступається всьому інтерактивному
    except OSError:
        pass
    src = _arg(argv, "--src")
    out = _arg(argv, "--out")
    if not src or not out:
        emit(ev="error", reason="worker_error", detail="бракує --src або --out")
        return 2
    raw_bbox = _arg(argv, "--bbox")
    bbox = tuple(float(x) for x in raw_bbox.split(",")) if raw_bbox else None
    if bbox is not None and len(bbox) != 4:
        emit(ev="error", reason="worker_error", detail="--bbox не з чотирьох чисел")
        return 2
    index_spec = _arg(argv, "--index", "flex_mem") or "flex_mem"
    floor = float(_arg(argv, "--floor-pct", str(DEFAULT_FLOOR_PCT)) or DEFAULT_FLOOR_PCT)
    try:
        return _bake(src, out, bbox, index_spec, floor)
    except ImportError as exc:
        emit(ev="error", reason="osmium_missing", detail=str(exc))
        return 1
    except MemoryError:
        emit(ev="error", reason="low_memory", detail="MemoryError у процесі випікання")
        return EXIT_SELF_STOPPED
    except Exception as exc:
        emit(ev="error", reason="worker_error", detail=f"{type(exc).__name__}: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(worker_cli(sys.argv[1:]))
