"""Оркестратор випікання: від вибору обсягу до атомарної публікації.

ЧОМУ ПАКЕТ ЗʼЯВЛЯЄТЬСЯ ОДНИМ РУХОМ. Наявність файла `road/*.db` — це і є
твердження «пакет цілий»: інших ознак ніде нема, і телефон, і карта питають
саме файл. Тому все випікання йде в `.tmp/` під іншим імʼям, і лише коли
`quick_check` сказав ok, а лічильники прочитано з готового файла, робиться
`os.replace` — на ТІЙ САМІЙ файловій системі, тож або старий пакет, або новий,
третього стану не існує. Сайдкар їде після пакета: опис без пакета — сміття,
пакет без опису — усе ще робочий пакет.

ЩО ЛИШАЄТЬСЯ ПІСЛЯ ЗУПИНКИ. Недопечена база гине, ЗАВАНТАЖЕНИЙ ЕКСТРАКТ
лишається. Він коштував гігабайти трафіку й нічим не завинив; повторна спроба
починається з випікання, а не з качання.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import time
import uuid
from dataclasses import replace as dc_replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional

from . import catalogue, download
from .catalogue import Remote, Scope
from .contract import (
    DownloadProgress, GuardFacts, JobStatus, Outcome, PackRecord, VerifyProgress,
    merge_bake_tick, previous_from_sidecar, status_from_dict,
)
from .manifest import (
    SourceMeta, bake_facts, file_size, pack_sidecar, read_json, write_json_atomic,
)
from .mesh_writer import FORMAT_VERSION, finalize
from .watchdog import (
    DEFAULT_FLOOR_PCT, EXIT_SELF_STOPPED, POLL_INTERVAL_S, STRIKES_TO_TRIP,
    MemoryWatchdog, clamp_floor, memory_state, read_meminfo,
)

logger = logging.getLogger(__name__)

BACKEND_DIR = Path(__file__).resolve().parents[2]
REMOTE_TTL_S = 6 * 3600
EventFn = Callable[[str, JobStatus], Awaitable[None]]


class BakeAlreadyRunning(RuntimeError): pass  # 409


class BakeAboveCeiling(RuntimeError):  # 412 — str(exc) показують операторові
    def __init__(self, reason: str, message_ua: str) -> None:
        super().__init__(message_ua)
        self.reason = reason  # low_memory | low_disk | unmeasured — для копії на склі


class BakeUnknownScope(RuntimeError): pass  # 404


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _gib(value: Optional[int]) -> str:
    return "?" if value is None else f"{value / 1024 ** 3:.1f} ГіБ"


def _keep_extracts_by_default() -> bool:
    """Без try/except: 05.09 хибне імʼя імпорту під `except Exception` робило
    перемикач у Налаштуваннях мертвим. Відсутній атрибут покриває getattr."""
    from config import config

    return bool(getattr(config, "bake_keep_source_extracts", True))


class BakeService:
    """Один бейк за раз. Стан живе у файлах, не лише в памʼяті процесу."""

    def __init__(
        self, *, on_event: Optional[EventFn] = None, root: Optional[Path] = None,
        floor_pct: float = DEFAULT_FLOOR_PCT,
        client_factory: download.ClientFactory = download.default_client,
        mem_reader: Callable[[], tuple[int, int]] = read_meminfo,
        watchdog_interval_s: float = POLL_INTERVAL_S,
        worker_argv: Optional[Callable[[list[str]], list[str]]] = None,
    ) -> None:
        self._on_event = on_event
        self._root = Path(root) if root else None
        self._floor_pct = floor_pct
        self._client_factory = client_factory
        self._mem_reader = mem_reader
        self._watchdog_interval_s = watchdog_interval_s
        self._worker_argv = worker_argv or self._default_worker_argv
        self._keep_download = True
        self._refresh_source = False
        self._status: Optional[JobStatus] = None
        self._task: Optional[asyncio.Task[None]] = None
        self._cancel = asyncio.Event()
        self._cancel_reason = "user"
        self._lock = asyncio.Lock()

    # ── теки ───────────────────────────────────────────────────────────
    @property
    def root(self) -> Path:
        if self._root is None:
            from geo.bake_capability import pack_root

            self._root = pack_root()
        return self._root

    def _dir(self, name: str) -> Path:
        # `ensure_data_dirs()` цієї теки не створює — вона наша, і робимо її ми.
        path = self.root / name
        path.mkdir(parents=True, exist_ok=True)
        return path

    def _pack_db(self, scope_id: str) -> Path:
        return self._dir("road") / f"phantom_road_mesh.{scope_id}.db"

    def _pack_json(self, scope_id: str) -> Path:
        return self._dir("road") / f"phantom_road_mesh.{scope_id}.json"

    def _src(self, source_id: str) -> Path:
        return self._dir(".src") / f"{source_id}.osm.pbf"

    # ── публічна поверхня ──────────────────────────────────────────────
    def current(self) -> Optional[JobStatus]:
        if self._status is None:
            return status_from_dict(read_json(self._dir(".jobs") / "last.json") or {})
        return self._status

    async def sweep_orphans(self) -> int:
        """Недопечене з минулого запуску не переживає старт продукту.

        І робота, яку вбив перезапуск, не має права далі значитись «пече»:
        last.json зі стадією посередині — це твердження про процес, якого
        більше нема. Позначаємо його тут, бо саме тут продукт стартує.
        """
        last_path = self._dir(".jobs") / "last.json"
        stale = status_from_dict(read_json(last_path) or {})
        if stale is not None and not stale.is_terminal and self._status is None:
            write_json_atomic(last_path, dc_replace(
                stale, stage="failed", updated_at=_now(),
                outcome=Outcome("failed", "shutdown",
                                f"ядро перезапустилось під час випікання (стадія "
                                f"{stale.stage}); останній знак життя — {stale.updated_at}"),
            ).as_dict())
        removed = 0
        tmp = self._dir(".tmp")
        for path in list(tmp.glob("*.db.part")) + list(tmp.glob("*.idx")):
            try:
                path.unlink()
                removed += 1
            except OSError as exc:
                logger.warning("не вдалося прибрати %s: %s", path.name, exc)
        return removed

    async def list_scopes(self) -> list[dict[str, Any]]:
        remotes = await self._remotes()
        out: list[dict[str, Any]] = []
        for scope in catalogue.SCOPES:
            remote = remotes.get(scope.source_id, Remote())
            size = remote.bytes if remote.measured else None
            out.append({
                "id": scope.id, "label_ua": scope.label_ua, "source_id": scope.source_id,
                "source_bytes": size,
                "needs_disk_bytes": catalogue.estimate_needs_disk(size),
                "needs_ram_bytes": catalogue.estimate_needs_ram(scope, size),
                "estimate": True, "remote": remote.to_dict(),
                "pack": read_json(self._pack_json(scope.id)),
            })
        return out

    def memory_state(self) -> dict[str, Any]:
        """Показання сторожі для стану спокою — тим самим читачем, що й у роботі."""
        return memory_state(self._floor_pct, self._mem_reader, self._watchdog_interval_s)

    async def source_state(self, source_id: str) -> Optional[dict[str, Any]]:
        if source_id not in catalogue.SOURCES:
            return None
        meta = download.stored_source(self._src(source_id))
        return {"id": source_id, "present": meta is not None,
                "bytes": meta.bytes if meta else None,
                "fetched_at": meta.fetched_at if meta else None,
                "verified_by": meta.verified_by if meta else None}

    async def drop_source(self, source_id: str) -> bool:
        path = self._src(source_id)
        if not path.exists():
            return False
        path.unlink()
        Path(str(path) + ".meta.json").unlink(missing_ok=True)
        return True

    async def start(self, scope_id: str, *, refresh_source: bool = False) -> JobStatus:
        scope = catalogue.scope(scope_id)
        if scope is None:
            raise BakeUnknownScope(f"невідомий обсяг: {scope_id}")
        async with self._lock:
            if self._task is not None and not self._task.done():
                raise BakeAlreadyRunning("випікання вже триває")
            # Свіжий витяг міряємо HEAD-ом, але старий НЕ викидаємо, доки
            # передполіт не пройдено: людина натиснула «взяти свіжіший», а не
            # «лишити мене без жодного».
            await self._preflight(scope, ignore_stored=refresh_source)
            self._refresh_source = refresh_source
            self._cancel = asyncio.Event()
            self._cancel_reason = "user"
            self._keep_download = _keep_extracts_by_default()
            self._status = JobStatus(
                job_id=uuid.uuid4().hex[:12], scope_id=scope.id,
                label_ua=scope.label_ua, stage="preflight",
                started_at=_now(), updated_at=_now(),
                previous=previous_from_sidecar(read_json(self._pack_json(scope.id))),
                guard=GuardFacts(floor_pct=clamp_floor(self._floor_pct),
                                 strikes_to_trip=STRIKES_TO_TRIP,
                                 poll_s=self._watchdog_interval_s),
            )
            await self._publish("job.started")
            self._task = asyncio.create_task(self._run(scope))
        return self._status

    async def cancel(self, reason: str, *, keep_download: Optional[bool] = None) -> bool:
        """`keep_download` — те, що людина щойно натиснула; None — налаштування.

        Викинути 900 МБ уже завантаженого через те, що людина передумала
        ПЕКТИ, — це покарати її за передумування. Тому замовчування «лишити»,
        а явний вибір людини важить більше за збережену вподобу.
        """
        if reason not in ("user", "shutdown"):
            raise ValueError(f"причина скасування поза словником: {reason!r}")
        if self._task is None or self._task.done():
            return False
        self._keep_download = (
            _keep_extracts_by_default() if keep_download is None else bool(keep_download))
        self._cancel_reason = reason
        self._cancel.set()
        return True

    # ── внутрішнє ──────────────────────────────────────────────────────
    async def _remote(self, source_id: str, *, ignore_stored: bool = False) -> Remote:
        """Розмір ОДНОГО джерела, з кешем.

        Передпольоту чужі країни не цікавлять: раніше він питав усі шість, і
        старт Києва впирався в пʼять сторонніх хостів — заміряно 05.09,
        `start()` повертався через 56 с при 1,4 с самого випікання.
        """
        stored = None if ignore_stored else download.stored_source(self._src(source_id))
        if stored is not None:
            return download.remote_from_stored(stored)
        cache_path = self._dir(".jobs") / "remote.json"
        cache = read_json(cache_path) or {}
        entry = cache.get(source_id)
        if entry and time.time() - float(entry.get("_at", 0)) < REMOTE_TTL_S:
            return Remote(**{k: v for k, v in entry.items() if k != "_at"})
        remote = await download.probe_remote(
            catalogue.SOURCES[source_id], client_factory=self._client_factory)
        # Читання-зміна-запис без жодного await всередині, тож паралельні
        # виклики в gather() не затирають записів один одного.
        cache = read_json(cache_path) or {}
        cache[source_id] = {**remote.to_dict(), "_at": time.time()}
        write_json_atomic(cache_path, cache)
        return remote

    async def _remotes(self) -> dict[str, Remote]:
        ids = list(catalogue.SOURCES)
        found = await asyncio.gather(*[self._remote(i) for i in ids])
        return dict(zip(ids, found))

    async def _preflight(self, scope: Scope, *, ignore_stored: bool = False) -> None:
        from geo.bake_capability import measure_free_disk

        remote = await self._remote(scope.source_id, ignore_stored=ignore_stored)
        if not remote.measured:
            raise BakeAboveCeiling("unmeasured", f"розмір джерела не поміряно "
                                   f"({remote.detail or 'причина невідома'}) — обіцяти нема на чому")
        need_disk = catalogue.estimate_needs_disk(remote.bytes)
        disk = measure_free_disk(self.root)
        if not disk.measured:
            raise BakeAboveCeiling("unmeasured", f"вільне місце не поміряно ({disk.detail})")
        if (disk.value or 0) < (need_disk or 0):
            raise BakeAboveCeiling("low_disk", f"вільного місця {_gib(disk.value)}, а треба "
                                   f"щонайменше {_gib(need_disk)} (оцінка)")
        # Те саме число, по якому стріляє сторожа, — ДО того, як щось скачано.
        mem = self.memory_state()
        if not mem["measured"]:
            raise BakeAboveCeiling("unmeasured", "доступну памʼять не поміряно — сторожа сліпа")
        if mem["would_stop"]:
            raise BakeAboveCeiling("low_memory", f"вільної памʼяті зараз {mem['ram_available_pct']:.1f} %, "
                                   f"підлога {mem['floor_pct']:.0f} % — піч зупинила б себе на першому записі")

    async def _publish(self, kind: str) -> None:
        if self._status is None:
            return
        if kind in ("job.started", "job.stage", "job.finished"):
            write_json_atomic(self._dir(".jobs") / "last.json", self._status.as_dict())
        if self._on_event is not None:
            try:
                await self._on_event(kind, self._status)
            except Exception:
                logger.exception("слухач подій випікання впав")

    def _set(self, **fields: Any) -> None:
        assert self._status is not None
        self._status = dc_replace(self._status, updated_at=_now(), **fields)

    async def _stage(self, stage: str) -> None:
        self._set(stage=stage)
        await self._publish("job.stage")

    async def _run(self, scope: Scope) -> None:
        part_db = self._dir(".tmp") / f"{scope.id}.{self._status.job_id}.db.part"  # type: ignore[union-attr]
        idx_path = self._dir(".tmp") / f"{scope.id}.{self._status.job_id}.idx"  # type: ignore[union-attr]
        began = time.monotonic()
        try:
            meta = await self._obtain_source(scope)
            outcome, facts, peak = await self._spawn_worker(scope, meta, part_db, idx_path)
            if outcome is not None:
                await self._finish(outcome, part_db, idx_path)
                return
            await self._stage("finalizing")
            record = self._publish_pack(scope, meta, part_db, facts, peak, began)
            self._set(pack=record)
            await self._publish("pack.visible")
            await self._finish(Outcome("done", None, "пакет готовий"), part_db, idx_path)
        except download.DownloadError as exc:
            await self._finish(Outcome(
                "cancelled" if exc.reason == "user" else "failed",
                exc.reason, exc.detail_ua), part_db, idx_path)
        except Exception as exc:  # несподіване мусить мати СВОЮ причину
            logger.exception("випікання %s впало", scope.id)
            await self._finish(Outcome("failed", "unknown", f"{type(exc).__name__}: {exc}"),
                               part_db, idx_path)

    async def _obtain_source(self, scope: Scope) -> SourceMeta:
        source = catalogue.source_of(scope)
        if self._refresh_source:
            await self.drop_source(source.id)  # тепер ми справді качаємо
        stored = download.stored_source(self._src(source.id))
        if stored is not None:
            self._set(download=DownloadProgress(
                bytes_done=stored.bytes, bytes_total=stored.bytes,
                source_last_modified=stored.last_modified, from_cache=True))
            return stored

        await self._stage("downloading")
        part = self._dir(".tmp") / f"{source.id}.osm.pbf.part"
        loop = asyncio.get_running_loop()
        pending: list[download.DownloadTick] = []

        async def pump() -> None:
            while True:
                await asyncio.sleep(0.5)
                if not pending:
                    continue
                tick = pending[-1]
                pending.clear()
                self._set(download=DownloadProgress(
                    bytes_done=tick.bytes_done, bytes_total=tick.bytes_total,
                    resumed_from_bytes=tick.resumed_from_bytes,
                    rate_bps=tick.rate_bps,
                    source_last_modified=tick.source_last_modified))
                await self._publish("job.progress")

        pump_task = asyncio.create_task(pump())
        try:
            meta = await download.download(
                source, part_path=part, on_progress=pending.append,
                cancelled=self._cancel, client_factory=self._client_factory)
        finally:
            pump_task.cancel()

        await self._stage("verifying")
        md5 = await download.fetch_md5_sidecar(source, client_factory=self._client_factory)
        meta = await loop.run_in_executor(None, lambda: download.verify(
            part, meta, expected_md5=md5,
            on_progress=lambda d, t: self._set(verify=VerifyProgress(d, t))))
        download.publish_source(part, self._src(source.id), meta)
        await self._publish("job.progress")
        return meta

    def _default_worker_argv(self, args: list[str]) -> list[str]:
        if getattr(sys, "frozen", False):
            return [sys.executable, "--bake-worker", *args]
        return [sys.executable, "-m", "geo.bake.worker", *args]

    async def _spawn_worker(
        self, scope: Scope, meta: SourceMeta, part_db: Path, idx_path: Path,
    ) -> tuple[Optional[Outcome], dict[str, Any], Optional[int]]:
        args = ["--src", str(self._src(meta.source_id)), "--out", str(part_db),
                "--floor-pct", str(self._floor_pct)]
        if scope.bbox is not None:
            args += ["--bbox", ",".join(str(v) for v in scope.bbox)]
        else:
            # Індекс країни не влазить у RAM з запасом — кладемо його на диск,
            # на ту саму ФС, де вже підтверджено місце.
            args += ["--index", f"sparse_file_array,{idx_path}"]
        argv = self._worker_argv(args)
        await self._stage("indexing")
        proc = await asyncio.create_subprocess_exec(
            *argv, cwd=str(BACKEND_DIR), stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE)

        guard = MemoryWatchdog(floor_pct=self._floor_pct, reader=self._mem_reader,
                               interval_s=self._watchdog_interval_s)
        facts: dict[str, Any] = {}
        last_error: Optional[tuple[str, str]] = None
        watch = asyncio.create_task(guard.guard(proc))
        killer = asyncio.create_task(self._await_cancel(proc))
        try:
            assert proc.stdout is not None
            async for raw in proc.stdout:
                try:
                    ev = json.loads(raw)
                except ValueError:
                    continue
                kind = ev.pop("ev", "")
                if kind == "stage":
                    await self._stage(str(ev.get("stage", "baking")))
                elif kind in ("tick", "done"):
                    facts.update({k: v for k, v in ev.items() if v is not None})
                    bake = merge_bake_tick(self._status.bake, ev)  # type: ignore[union-attr]
                    self._set(bake=dc_replace(bake, output_bytes=file_size(part_db),
                                              index_bytes=file_size(idx_path)))
                    await self._publish("job.progress")
                elif kind == "error":
                    last_error = (str(ev.get("reason", "worker_error")),
                                  str(ev.get("detail", "")))
            code = await proc.wait()
        finally:
            killer.cancel()
            if proc.returncode is None:
                proc.kill()
            await watch
        peak = facts.get("peak_rss_bytes") or guard.peak_rss_bytes

        if self._cancel.is_set():
            return Outcome("cancelled", self._cancel_reason, "зупинено на прохання"), facts, peak
        if guard.tripped or code == EXIT_SELF_STOPPED:
            detail = last_error[1] if last_error else (
                f"памʼяті лишалось {guard.last_pct:.1f}%" if guard.last_pct else
                "памʼять впала нижче підлоги")
            return Outcome("failed", "low_memory", detail), facts, peak
        if code < 0:
            return Outcome("failed", "worker_crashed",
                           f"процес випікання отримав сигнал {-code}"), facts, peak
        if code != 0:
            reason, detail = last_error or ("worker_error", f"код виходу {code}")
            return Outcome("failed", reason, detail), facts, peak
        return None, facts, peak

    async def _await_cancel(self, proc: "asyncio.subprocess.Process") -> None:
        await self._cancel.wait()
        if proc.returncode is None:
            proc.terminate()

    def _publish_pack(
        self, scope: Scope, meta: SourceMeta, part_db: Path,
        facts: dict[str, Any], peak: Optional[int], began: float,
    ) -> PackRecord:
        pack_facts = finalize(part_db)
        if pack_facts.format_version != FORMAT_VERSION:
            raise RuntimeError(
                f"user_version у готовому файлі {pack_facts.format_version}, "
                f"а не {FORMAT_VERSION}")
        os.replace(part_db, self._pack_db(scope.id))
        record = PackRecord(
            pack_id=scope.pack_id, bytes=pack_facts.bytes,
            format_version=pack_facts.format_version, sha256=pack_facts.sha256,
            way_count=pack_facts.way_count, row_count=pack_facts.row_count,
            cell_count=pack_facts.cell_count, baked_at=_now())
        write_json_atomic(self._pack_json(scope.id), pack_sidecar(
            scope_id=scope.id, source=meta, pack=record.to_dict(),
            bake=bake_facts(
                elapsed_s=facts.get("elapsed_s", time.monotonic() - began),
                input_bytes=facts.get("input_bytes", meta.bytes),
                ways_kept=pack_facts.way_count, rows_written=pack_facts.row_count,
                cells=pack_facts.cell_count, peak_rss_bytes=peak)))
        return record

    async def _finish(self, outcome: Outcome, part_db: Path, idx_path: Path) -> None:
        # Недопечена база гине завжди; екстракт — лише якщо людина так сказала.
        part_db.unlink(missing_ok=True)
        idx_path.unlink(missing_ok=True)
        scope = catalogue.scope(self._status.scope_id) if self._status else None
        if outcome.kind == "cancelled":
            tail = ("завантажене збережено, повтор його не качатиме знову"
                    if self._keep_download else
                    "завантажене прибрано, повтор почне з початку")
            outcome = Outcome("cancelled", outcome.reason, f"{outcome.detail_ua}; {tail}")
            if not self._keep_download and scope:
                await self.drop_source(scope.source_id)
                part = self._dir(".tmp") / f"{scope.source_id}.osm.pbf.part"
                part.unlink(missing_ok=True)
                Path(str(part) + ".meta.json").unlink(missing_ok=True)
        self._set(stage=outcome.kind, outcome=outcome)
        await self._publish("job.finished")
