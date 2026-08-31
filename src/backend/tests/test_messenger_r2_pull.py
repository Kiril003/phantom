"""Одержувач забирає своє вкладення з хмари — і замітає за собою.

Тягне саме вузол АДРЕСАТА і саме своє: імʼя обʼєкта починається з його
власного node_id, а ідентифікатор блоба лежить під пломбою в тілі листа —
без ключів вузла не дізнатись навіть того, що просити.

Наприкінці файла — те саме коло проти СПРАВЖНЬОГО S3-сумісного сервера. Воно
мовчить, доки в env немає адреси й ключів: у репозиторії їх не буде ніколи.
"""
from __future__ import annotations

import hashlib
import json
import os

import httpx
import pytest
from tests.conftest import owner_of
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from db.database import AsyncSessionLocal
from db.models import MessengerBlob, User
from messenger.blobs import blob_path, new_blob_id, park_blob, read_bytes, wrap_frame
from messenger.crypto.keys import KeyStore
from messenger.crypto.session import Session
from messenger.inbox import accept_frame
from messenger.r2 import R2Road, fetch_object
from messenger.redelivery import fetch_parked_blobs

ROAD = R2Road(
    endpoint="https://acc.r2.cloudflarestorage.com",
    bucket="phantom-blobs",
    access_key="R2_ACCESS_KEY_FOR_TESTS",
    secret_key="R2_SECRET_KEY_FOR_TESTS_do_not_log_me",
)


@pytest.mark.anyio
async def test_the_recipient_takes_its_blob_and_sweeps_the_cloud(auth_root_client):
    """Ключ приїхав у стрічці, байтів немає — вузол іде по них у хмару.

    І одразу прибирає за собою: блоб уже на диску, а місце в бакеті скінченне.
    """
    kyrylo = KeyStore.generate(one_time_count=4)   # ми (одержувач)
    marta = KeyStore.generate(one_time_count=4)    # відправник
    ciphertext = os.urandom(1024)
    blob_id = new_blob_id()
    asked: list[tuple[str, str]] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        asked.append((request.method, request.url.path))
        if request.method == "GET":
            return httpx.Response(200, content=ciphertext)
        return httpx.Response(204)

    body = json.dumps({
        "name": "фото.png", "size": 10, "mime": "image/png",
        "sha256": hashlib.sha256(ciphertext).hexdigest(), "blob_id": blob_id,
        "key_hex": os.urandom(32).hex(), "nonce_hex": os.urandom(12).hex(),
    })

    async with AsyncSessionLocal() as session:
        owner = owner_of(auth_root_client)
        frame = Session.initiate(marta, kyrylo.publish_bundle()).encrypt(
            wrap_frame("image", body).encode()
        )
        await accept_frame(session, kyrylo, owner, frame)
        # Байтів немає: у бульбашці це «очікує передачі».
        assert read_bytes(blob_id) is None

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            taken = await fetch_parked_blobs(
                session, kyrylo, owner, road=ROAD, client=client
            )
        assert taken == 1
        row = await session.get(MessengerBlob, blob_id)

    assert read_bytes(blob_id) == ciphertext
    assert row is not None and row.direction == "in" and row.state == "stored"
    assert row.sha256 == hashlib.sha256(ciphertext).hexdigest()
    assert row.peer_node_id == marta.node_id
    # Просили СВОЄ імʼя — ключ починається з node_id цього вузла.
    assert asked[0] == ("GET", f"/phantom-blobs/{kyrylo.node_id}/{blob_id}")
    # І прибрали за собою тим самим ключем.
    assert asked[1] == ("DELETE", f"/phantom-blobs/{kyrylo.node_id}/{blob_id}")

    blob_path(blob_id).unlink()


@pytest.mark.anyio
async def test_an_empty_cloud_changes_nothing(auth_root_client):
    """Хмара мовчить — вузол не вигадує ані байтів, ані рядка обліку."""
    kyrylo = KeyStore.generate(one_time_count=4)
    marta = KeyStore.generate(one_time_count=4)
    blob_id = new_blob_id()

    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        return httpx.Response(404)

    body = json.dumps({"blob_id": blob_id, "name": "файл.bin", "size": 3})
    async with AsyncSessionLocal() as session:
        owner = owner_of(auth_root_client)
        frame = Session.initiate(marta, kyrylo.publish_bundle()).encrypt(
            wrap_frame("file", body).encode()
        )
        await accept_frame(session, kyrylo, owner, frame)

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            assert await fetch_parked_blobs(
                session, kyrylo, owner, road=ROAD, client=client
            ) == 0
        assert await session.get(MessengerBlob, blob_id) is None
    assert read_bytes(blob_id) is None


@pytest.mark.anyio
async def test_without_credentials_the_recipient_asks_no_one(auth_root_client, monkeypatch):
    import messenger.redelivery as redelivery

    def _never(*args, **kwargs):  # pragma: no cover
        raise AssertionError("без креденшелів дороги немає")

    monkeypatch.setattr(redelivery, "r2_road", lambda config: None)
    monkeypatch.setattr(redelivery, "fetch_object", _never)

    async with AsyncSessionLocal() as session:
        owner = owner_of(auth_root_client)
        keys = KeyStore.generate(one_time_count=2)
        assert await fetch_parked_blobs(session, keys, owner) == 0


# ── Те саме коло, але проти справжнього S3 ───────────────────────────────────
#
# Запускається лише з env: R2_LIVE_ENDPOINT, R2_LIVE_BUCKET, R2_LIVE_ACCESS_KEY,
# R2_LIVE_SECRET_KEY. Бакет має існувати. Годиться і локальний MinIO, і R2
# власника — підпис і дорога однакові.

_LIVE = R2Road(
    endpoint=os.environ.get("R2_LIVE_ENDPOINT", ""),
    bucket=os.environ.get("R2_LIVE_BUCKET", ""),
    access_key=os.environ.get("R2_LIVE_ACCESS_KEY", ""),
    secret_key=os.environ.get("R2_LIVE_SECRET_KEY", ""),
)

live_only = pytest.mark.skipif(
    not all((_LIVE.endpoint, _LIVE.bucket, _LIVE.access_key, _LIVE.secret_key)),
    reason="живого S3 немає: R2_LIVE_* не задані",
)

PNG = (
    b"\x89PNG\r\n\x1a\n"
    b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde"
    b"\x00\x00\x00\x0cIDATx\x9cc```\x00\x00\x00\x04\x00\x01\xf6\x178U"
    b"\x00\x00\x00\x00IEND\xaeB`\x82"
)


@live_only
@pytest.mark.anyio
async def test_a_photo_crosses_a_real_bucket_and_stays_unreadable_there(auth_root_client):
    """Повне коло: браузер шифрує → хмара везе → адресат забирає й читає.

    Хмара тут чужа реалізація AWS-підпису: якби наш SigV4 був хоч трохи не
    той, PUT повернув би 403 і тест став би червоним, а не зеленим.
    """
    kyrylo = KeyStore.generate(one_time_count=4)   # адресат
    marta = KeyStore.generate(one_time_count=4)    # відправник

    key, nonce = os.urandom(32), os.urandom(12)
    ciphertext = AESGCM(key).encrypt(nonce, PNG, None)
    blob_id = new_blob_id()

    # Вузол відправника: прямої адреси немає, тож блоб їде в хмару.
    assert await park_blob(blob_id, ciphertext, kyrylo.node_id, road=_LIVE) is True

    body = json.dumps({
        "name": "фото.png", "size": len(PNG), "mime": "image/png",
        "sha256": hashlib.sha256(ciphertext).hexdigest(), "blob_id": blob_id,
        "key_hex": key.hex(), "nonce_hex": nonce.hex(),
    })

    async with AsyncSessionLocal() as session:
        owner = owner_of(auth_root_client)
        frame = Session.initiate(marta, kyrylo.publish_bundle()).encrypt(
            wrap_frame("image", body).encode()
        )
        # Ключ до файла не їде ані в кадрі, ані в хмару.
        assert key.hex().encode() not in frame
        assert key not in ciphertext

        await accept_frame(session, kyrylo, owner, frame)
        assert read_bytes(blob_id) is None
        assert await fetch_parked_blobs(session, kyrylo, owner, road=_LIVE) == 1

    on_disk = read_bytes(blob_id)
    assert on_disk == ciphertext
    # У хмарі лежав шифротекст: ані сигнатури PNG, ані шматка файла.
    assert b"\x89PNG" not in on_disk and b"IHDR" not in on_disk
    # А з ключем із тіла — той самий файл байт у байт.
    assert AESGCM(key).decrypt(nonce, on_disk, None) == PNG
    # І бакет по собі прибрано.
    assert await fetch_object(_LIVE, f"{kyrylo.node_id}/{blob_id}") is None

    blob_path(blob_id).unlink()
