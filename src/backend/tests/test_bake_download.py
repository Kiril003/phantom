"""Докачка і приймання екстракта. Мовчазного «так» тут бути не може.

Мережа підроблена `httpx.MockTransport` — тобто справжнім клієнтом httpx, а не
мокнутим нашим кодом: перевіряємо ПОВЕДІНКУ по HTTP, а не виклики методів.
"""
from __future__ import annotations

import asyncio
import hashlib

import httpx
import osmium
import osmium.osm.mutable as mutable
import pytest

from geo.bake import download
from geo.bake.catalogue import Source
from geo.bake.download import DownloadError
from geo.bake.manifest import SourceMeta, read_json, write_json_atomic

SRC = Source("ukraine", "Україна", "europe/ukraine-latest.osm.pbf")


def _pbf(path) -> bytes:
    writer = osmium.SimpleWriter(str(path))
    writer.add_node(mutable.Node(id=1, location=(30.5, 50.4)))
    writer.add_node(mutable.Node(id=2, location=(30.6, 50.5)))
    writer.add_way(mutable.Way(id=1, nodes=[1, 2], tags={"highway": "primary"}))
    writer.close()
    return path.read_bytes()


def _server(body: bytes, *, etag="\"v1\"", last_modified="Fri, 05 Sep 2026 00:00:00 GMT",
            md5: bytes | None = None, honour_range=True, seen=None):
    def handler(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append((request.method, str(request.url), dict(request.headers)))
        headers = {"ETag": etag, "Last-Modified": last_modified}
        if str(request.url).endswith(".md5"):
            if md5 is None:
                return httpx.Response(404)
            return httpx.Response(200, content=md5)
        if request.method == "HEAD":
            return httpx.Response(200, headers={**headers,
                                                "Content-Length": str(len(body))})
        rng = request.headers.get("range")
        if rng and honour_range:
            start = int(rng.split("=", 1)[1].split("-")[0])
            return httpx.Response(206, content=body[start:], headers=headers)
        return httpx.Response(200, content=body, headers=headers)

    return lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler))


# ── HEAD як вимір, а не як факт ────────────────────────────────────────

async def test_a_measured_size_says_so_and_an_unmeasured_one_carries_no_number():
    remote = await download.probe_remote(SRC, client_factory=_server(b"x" * 1234))
    assert remote.measured and remote.bytes == 1234

    def dead(request):
        raise httpx.ConnectError("no route", request=request)

    offline = await download.probe_remote(
        SRC, client_factory=lambda: httpx.AsyncClient(transport=httpx.MockTransport(dead)))
    assert offline.measured is False and offline.bytes is None and offline.detail


async def test_a_server_without_content_length_is_unmeasured_not_zero():
    def handler(request):
        return httpx.Response(200, headers={"Transfer-Encoding": "chunked"})

    remote = await download.probe_remote(
        SRC, client_factory=lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    assert remote.measured is False and remote.bytes is None


# ── докачка ────────────────────────────────────────────────────────────

async def test_a_matching_etag_resumes_from_the_stored_tail(tmp_path):
    body = b"A" * 4000 + b"B" * 4000
    part = tmp_path / "u.osm.pbf.part"
    part.write_bytes(body[:4000])
    write_json_atomic(tmp_path / "u.osm.pbf.part.meta.json",
                      {"etag": "\"v1\"", "last_modified": "x", "url": SRC.url})
    seen: list = []
    ticks: list = []
    meta = await download.download(SRC, part_path=part, on_progress=ticks.append,
                                  client_factory=_server(body, seen=seen))
    assert part.read_bytes() == body and meta.bytes == 8000
    ranges = [h.get("range") for m, u, h in seen if m == "GET"]
    assert ranges == ["bytes=4000-"]
    assert ticks[-1].resumed_from_bytes == 4000


async def test_a_changed_etag_throws_the_stale_tail_away(tmp_path):
    """`-latest` перезбирається щодня: вчорашній хвіст дав би ПРАВИЛЬНУ довжину
    й неправильний вміст, і жоден лічильник байтів цього не побачив би."""
    body = b"NEW" * 3000
    part = tmp_path / "u.osm.pbf.part"
    part.write_bytes(b"OLD" * 1000)
    write_json_atomic(tmp_path / "u.osm.pbf.part.meta.json",
                      {"etag": "\"v0\"", "last_modified": "вчора", "url": SRC.url})
    seen: list = []
    await download.download(SRC, part_path=part, on_progress=download.sink,
                            client_factory=_server(body, seen=seen))
    assert part.read_bytes() == body
    assert [h.get("range") for m, u, h in seen if m == "GET"] == [None]


async def test_a_part_without_a_sidecar_is_never_resumed(tmp_path):
    body = b"Z" * 900
    part = tmp_path / "u.osm.pbf.part"
    part.write_bytes(b"Z" * 400)
    seen: list = []
    await download.download(SRC, part_path=part, on_progress=download.sink,
                            client_factory=_server(body, seen=seen))
    assert part.read_bytes() == body


async def test_a_server_that_ignores_range_is_written_from_zero(tmp_path):
    body = b"Q" * 2000
    part = tmp_path / "u.osm.pbf.part"
    part.write_bytes(b"Q" * 500)
    write_json_atomic(tmp_path / "u.osm.pbf.part.meta.json",
                      {"etag": "\"v1\"", "last_modified": "x", "url": SRC.url})
    await download.download(SRC, part_path=part, on_progress=download.sink,
                            client_factory=_server(body, honour_range=False))
    assert part.read_bytes() == body, "хвіст приклеївся до недокачаної голови"


async def test_a_cancelled_download_says_user_not_network(tmp_path):
    cancelled = asyncio.Event()
    cancelled.set()
    with pytest.raises(DownloadError) as caught:
        await download.download(SRC, part_path=tmp_path / "u.part",
                                on_progress=download.sink, cancelled=cancelled,
                                client_factory=_server(b"x" * 100))
    assert caught.value.reason == "user"


async def test_an_unreachable_host_is_offline_not_a_crash(tmp_path):
    def dead(request):
        raise httpx.ConnectError("no route", request=request)

    with pytest.raises(DownloadError) as caught:
        await download.download(
            SRC, part_path=tmp_path / "u.part", on_progress=download.sink,
            client_factory=lambda: httpx.AsyncClient(transport=httpx.MockTransport(dead)))
    assert caught.value.reason == "offline"


# ── приймання: кожен «так» має імʼя ────────────────────────────────────

async def test_the_md5_sidecar_is_used_when_it_exists_and_named_in_the_manifest(tmp_path):
    body = _pbf(tmp_path / "real.osm.pbf")
    digest = hashlib.md5(body).hexdigest()
    target = tmp_path / "u.osm.pbf.part"
    target.write_bytes(body)
    found = await download.fetch_md5_sidecar(
        SRC, client_factory=_server(body, md5=f"{digest}  ukraine.osm.pbf".encode()))
    assert found == digest
    meta = download.verify(target, SourceMeta("ukraine", SRC.url, len(body)),
                           expected_md5=found)
    assert meta.verified_by == "md5"


def test_a_wrong_md5_is_refused_as_checksum(tmp_path):
    target = tmp_path / "u.part"
    target.write_bytes(b"payload")
    with pytest.raises(DownloadError) as caught:
        download.verify(target, SourceMeta("ukraine", SRC.url, 7),
                        expected_md5="0" * 32)
    assert caught.value.reason == "checksum"


async def test_a_missing_md5_sidecar_is_none_not_a_pass(tmp_path):
    assert await download.fetch_md5_sidecar(SRC, client_factory=_server(b"x", md5=None)) is None


def test_without_md5_only_exact_length_plus_a_real_osmium_header_passes(tmp_path):
    body = _pbf(tmp_path / "real.osm.pbf")
    target = tmp_path / "u.part"
    target.write_bytes(body)
    meta = download.verify(target, SourceMeta("ukraine", SRC.url, len(body)),
                           expected_md5=None)
    assert meta.verified_by == "length+header", "прийняли, не назвавши чим"


def test_a_length_that_disagrees_is_refused(tmp_path):
    body = _pbf(tmp_path / "real.osm.pbf")
    target = tmp_path / "u.part"
    target.write_bytes(body)
    with pytest.raises(DownloadError) as caught:
        download.verify(target, SourceMeta("ukraine", SRC.url, len(body) + 1),
                        expected_md5=None)
    assert caught.value.reason == "checksum"


def test_a_file_of_the_right_length_that_is_not_a_pbf_is_refused(tmp_path):
    """Довжина збіглась — а це не .osm.pbf. Питаємо osmium, а не розширення."""
    target = tmp_path / "u.part"
    target.write_bytes(b"\x00" * 512)
    with pytest.raises(DownloadError) as caught:
        download.verify(target, SourceMeta("ukraine", SRC.url, 512), expected_md5=None)
    assert caught.value.reason == "corrupt"


def test_publishing_moves_the_file_and_leaves_a_readable_manifest(tmp_path):
    body = _pbf(tmp_path / "real.osm.pbf")
    part = tmp_path / "tmp" / "u.osm.pbf.part"
    part.parent.mkdir()
    part.write_bytes(body)
    write_json_atomic(tmp_path / "tmp" / "u.osm.pbf.part.meta.json", {"etag": "x"})
    dest = tmp_path / "src" / "ukraine.osm.pbf"
    meta = download.verify(part, SourceMeta("ukraine", SRC.url, len(body)), expected_md5=None)
    download.publish_source(part, dest, meta)

    assert not part.exists() and dest.exists()
    assert read_json(tmp_path / "src" / "ukraine.osm.pbf.meta.json")["verified_by"] == \
        "length+header"
    stored = download.stored_source(dest)
    assert stored is not None and stored.bytes == len(body)


def test_an_unverified_file_on_disk_is_not_a_stored_source(tmp_path):
    """Файл без імені перевірки — це не «вже завантажене», це просто файл."""
    dest = tmp_path / "ukraine.osm.pbf"
    dest.write_bytes(b"abc")
    write_json_atomic(tmp_path / "ukraine.osm.pbf.meta.json",
                      {"source_id": "ukraine", "url": SRC.url, "bytes": 3})
    assert download.stored_source(dest) is None


def test_a_stored_file_whose_size_moved_is_not_trusted(tmp_path):
    dest = tmp_path / "ukraine.osm.pbf"
    dest.write_bytes(b"abcd")
    write_json_atomic(tmp_path / "ukraine.osm.pbf.meta.json",
                      {"source_id": "ukraine", "url": SRC.url, "bytes": 3,
                       "verified_by": "md5"})
    assert download.stored_source(dest) is None
