"""Взяти екстракт — і ніколи не прийняти його мовчки.

ЧОМУ ДОКАЧКА ПЕРЕВІРЯЄ ETag. `europe/ukraine-latest.osm.pbf` перезбирається
щодня. Range-докачка вчорашнього хвоста до сьогоднішньої голови дала б файл
ПРАВИЛЬНОЇ довжини й неправильного вмісту: жоден лічильник байтів цього не
побачить. Тому Range іде тільки тоді, коли ETag або Last-Modified збіглися з
тим, що ми записали, коли починали; інакше недокачане викидаємо.

ЧОМУ ПЕРЕВІРКА МАЄ ІМʼЯ. Geofabrik публікує `.md5` поряд з файлом; коли він є,
віримо йому. Коли його нема — приймаємо лише за ТОЧНИМ збігом Content-Length і
успішним розбором заголовка osmium, і записуємо в манифест, чим саме повірили
(`verified_by`). Третьої дороги — «прийняли, бо докачалось» — нема.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional

import httpx

from .catalogue import Remote, Source
from .manifest import SourceMeta, read_json, write_json_atomic

logger = logging.getLogger(__name__)

CHUNK = 1 << 20
_TIMEOUT = httpx.Timeout(connect=15.0, read=60.0, write=60.0, pool=15.0)
_USER_AGENT = "PHANTOM-OS road-pack baker (+offline map packs)"

ProgressFn = Callable[["DownloadTick"], None]
ClientFactory = Callable[[], httpx.AsyncClient]


class DownloadError(RuntimeError):
    """Причина — з набору contract.OUTCOME_REASONS, деталь — для людини."""

    def __init__(self, reason: str, detail_ua: str) -> None:
        super().__init__(detail_ua)
        self.reason = reason
        self.detail_ua = detail_ua


@dataclass(frozen=True, slots=True)
class DownloadTick:
    bytes_done: int
    bytes_total: Optional[int]
    resumed_from_bytes: int
    rate_bps: Optional[float]
    source_last_modified: Optional[str]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def default_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=_TIMEOUT, follow_redirects=True,
        headers={"User-Agent": _USER_AGENT},
    )


def _as_transport_error(exc: Exception, what: str) -> DownloadError:
    if isinstance(exc, (httpx.ConnectError, httpx.ConnectTimeout)):
        return DownloadError("offline", f"{what}: мережі нема або хост недосяжний")
    return DownloadError("network", f"{what}: {type(exc).__name__}")


async def probe_remote(
    source: Source, *, client_factory: ClientFactory = default_client
) -> Remote:
    """Розмір джерела HEAD-ом. Невдача — це `measured: False`, не виняток."""
    try:
        async with client_factory() as client:
            resp = await client.head(source.url)
            resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        return Remote(measured=False, detail=f"сервер відповів {exc.response.status_code}")
    except (httpx.HTTPError, OSError) as exc:
        return Remote(measured=False, detail=_as_transport_error(exc, "HEAD").detail_ua)
    raw = resp.headers.get("content-length")
    if raw is None or not raw.isdigit():
        return Remote(
            last_modified=resp.headers.get("last-modified"), measured=False,
            measured_at=_now(), detail="сервер не назвав Content-Length",
        )
    return Remote(
        bytes=int(raw), last_modified=resp.headers.get("last-modified"),
        measured=True, measured_at=_now(), detail="HEAD",
    )


def osmium_header_ok(path: Path) -> tuple[bool, str]:
    """Чи це взагалі .osm.pbf — питаємо в osmium, а не в розширення файла.

    Формат називаємо ЯВНО. Файл на цьому кроці зветься `*.osm.pbf.part`, і сам
    osmium виводить формат саме з розширення: без явного "pbf" він відмовляє
    кожному ще не опублікованому файлу — тобто перевірка завжди казала б
    «побитий», і жодне завантаження не пройшло б. Спіймано тестом 05.09.
    """
    try:
        import osmium
    except ImportError as exc:  # pragma: no cover - у тесті osmium є
        return False, f"osmium недоступний: {exc}"
    try:
        reader = osmium.io.Reader(osmium.io.File(str(path), "pbf"))
        try:
            reader.header()
        finally:
            reader.close()
    except Exception as exc:
        return False, f"osmium не прочитав заголовок: {type(exc).__name__}"
    return True, "osmium прочитав заголовок"


def hash_md5(path: Path, on_progress: Optional[Callable[[int, int], None]] = None) -> str:
    total = path.stat().st_size
    digest = hashlib.md5()
    done = 0
    with open(path, "rb") as fh:
        while True:
            chunk = fh.read(CHUNK)
            if not chunk:
                break
            digest.update(chunk)
            done += len(chunk)
            if on_progress is not None:
                on_progress(done, total)
    return digest.hexdigest()


async def fetch_md5_sidecar(
    source: Source, *, client_factory: ClientFactory = default_client
) -> Optional[str]:
    """None означає «сайдкара нема», а не «перевірка пройшла»."""
    try:
        async with client_factory() as client:
            resp = await client.get(source.md5_url)
        if resp.status_code != 200:
            return None
    except (httpx.HTTPError, OSError):
        return None
    first = resp.text.strip().split()
    return first[0].lower() if first and len(first[0]) == 32 else None


def _resumable(meta_path: Path, etag: Optional[str], last_mod: Optional[str]) -> bool:
    data = read_json(meta_path)
    if not data:
        return False
    same_etag = etag is not None and data.get("etag") == etag
    same_date = last_mod is not None and data.get("last_modified") == last_mod
    return bool(same_etag or same_date)


async def download(
    source: Source, *, part_path: Path, on_progress: ProgressFn,
    cancelled: Optional[asyncio.Event] = None,
    client_factory: ClientFactory = default_client,
) -> SourceMeta:
    """Завантажити в `part_path`. Повертає опис — файл ще НЕ перевірений."""
    part_path = Path(part_path)
    part_path.parent.mkdir(parents=True, exist_ok=True)
    meta_path = Path(str(part_path) + ".meta.json")

    async with client_factory() as client:
        try:
            head = await client.head(source.url)
            head.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise DownloadError("network", f"сервер відповів {exc.response.status_code}") from exc
        except (httpx.HTTPError, OSError) as exc:
            raise _as_transport_error(exc, "HEAD") from exc

        etag = head.headers.get("etag")
        last_mod = head.headers.get("last-modified")
        raw_total = head.headers.get("content-length")
        total = int(raw_total) if raw_total and raw_total.isdigit() else None

        start = 0
        if part_path.exists():
            if _resumable(meta_path, etag, last_mod):
                start = part_path.stat().st_size
            else:
                # Свіжий файл на сервері — старий хвіст уже з іншого файла.
                part_path.unlink()
                meta_path.unlink(missing_ok=True)
        if total is not None and start >= total:
            start = 0
            part_path.unlink(missing_ok=True)

        write_json_atomic(meta_path, {"etag": etag, "last_modified": last_mod,
                                      "url": source.url, "started_at": _now()})

        headers = {"Range": f"bytes={start}-"} if start else {}
        done = start
        began = time.monotonic()
        try:
            async with client.stream("GET", source.url, headers=headers) as resp:
                if start and resp.status_code == 200:
                    # Сервер проігнорував Range — пишемо з нуля, а не в хвіст.
                    start = done = 0
                elif start and resp.status_code != 206:
                    resp.raise_for_status()
                resp.raise_for_status()
                mode = "ab" if start else "wb"
                with open(part_path, mode) as fh:
                    async for chunk in resp.aiter_bytes(CHUNK):
                        if cancelled is not None and cancelled.is_set():
                            raise DownloadError("user", "скасовано власником")
                        fh.write(chunk)
                        done += len(chunk)
                        spent = time.monotonic() - began
                        on_progress(DownloadTick(
                            bytes_done=done, bytes_total=total,
                            resumed_from_bytes=start,
                            rate_bps=(done - start) / spent if spent > 0.5 else None,
                            source_last_modified=last_mod,
                        ))
        except httpx.HTTPStatusError as exc:
            raise DownloadError("network", f"сервер відповів {exc.response.status_code}") from exc
        except (httpx.HTTPError, OSError) as exc:
            raise _as_transport_error(exc, "завантаження") from exc

    return SourceMeta(
        source_id=source.id, url=source.url, bytes=part_path.stat().st_size,
        etag=etag, last_modified=last_mod, fetched_at=_now(),
    )


def verify(
    part_path: Path, meta: SourceMeta, *, expected_md5: Optional[str],
    on_progress: Optional[Callable[[int, int], None]] = None,
) -> SourceMeta:
    """Прийняти файл — або сказати, чому ні. Мовчазного «так» тут нема."""
    size = Path(part_path).stat().st_size
    if expected_md5:
        actual = hash_md5(Path(part_path), on_progress)
        if actual != expected_md5:
            raise DownloadError("checksum", "md5 не збігся з тим, що назвав сервер")
        verified_by = "md5"
    else:
        if meta.bytes != size or size == 0:
            raise DownloadError("checksum", f"довжина {size} Б не збіглася з обіцяною")
        ok, detail = osmium_header_ok(Path(part_path))
        if not ok:
            raise DownloadError("corrupt", detail)
        if on_progress is not None:
            on_progress(size, size)
        verified_by = "length+header"
    return SourceMeta(
        source_id=meta.source_id, url=meta.url, bytes=size, etag=meta.etag,
        last_modified=meta.last_modified, md5=expected_md5,
        verified_by=verified_by, fetched_at=meta.fetched_at or _now(),
    )


def publish_source(part_path: Path, dest_path: Path, meta: SourceMeta) -> None:
    """Перевірений екстракт стає видимим одним `os.replace`."""
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    os.replace(part_path, dest_path)
    write_json_atomic(Path(str(dest_path) + ".meta.json"), meta.to_dict())
    Path(str(part_path) + ".meta.json").unlink(missing_ok=True)


def stored_source(dest_path: Path) -> Optional[SourceMeta]:
    """Що вже лежить у .src/ — або None, якщо там нема ПЕРЕВІРЕНОГО файла."""
    if not dest_path.exists():
        return None
    data = read_json(Path(str(dest_path) + ".meta.json"))
    if not data:
        return None
    meta = SourceMeta.from_dict(data)
    if meta is None or not meta.verified_by:
        return None
    return meta if meta.bytes == dest_path.stat().st_size else None


def remote_from_stored(meta: SourceMeta) -> Remote:
    """Файл уже на диску — його розмір поміряний найнадійніше з можливих."""
    return Remote(
        bytes=meta.bytes, last_modified=meta.last_modified, measured=True,
        measured_at=meta.fetched_at, detail=f"файл на диску ({meta.verified_by})",
    )


def sink(_tick: Any) -> None:
    """Прогрес нікуди — для викликів, яким він не потрібен."""
