"""`/pair/claim` несе сітьові ключі В ОБИДВА БОКИ — на живому маршруті.

Не арифметика (це `test_pair_mesh_block.py`), а сам обмін: телефон кладе свою
довічну особу в запит, вузол зберігає її в рядку пристрою і віддає свою у
відповіді, підписавши тим самим спільним ключем. Після цього обидва боки
складають ОДНУ адресу — і саме це тут доводиться, останнім твердженням.
"""
from __future__ import annotations

import base64
import hashlib
import hmac

import pytest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ed25519, x25519
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from sqlalchemy import select

from db.models import PairedDevice
from node import peer_channel
from node import peer_relay as pr
from security.pair_crypto import _HKDF_INFO


def _mesh_keys():
    ed = ed25519.Ed25519PrivateKey.generate()
    dh = x25519.X25519PrivateKey.generate()
    ed_pub = ed.public_key().public_bytes_raw()
    dh_pub = dh.public_key().public_bytes_raw()
    return ed, dh, ed_pub, dh_pub


def _claim_body(*, qr: dict, pair_id: str, mesh: bool):
    """Те саме, що робить `PairFlowClient.claim`, включно з хвостом доказу."""
    server_pub = x25519.X25519PublicKey.from_public_bytes(
        base64.b64decode(qr["server_pub"])
    )
    nonce_bytes = base64.b64decode(qr["nonce"])
    client_priv = x25519.X25519PrivateKey.generate()
    shared_key = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=nonce_bytes,
        info=_HKDF_INFO,
    ).derive(client_priv.exchange(server_pub))

    device_priv = ed25519.Ed25519PrivateKey.generate()
    device_pub_raw = device_priv.public_key().public_bytes_raw()

    tail = b""
    extra: dict = {}
    peer = None
    if mesh:
        _ed, _dh, ed_pub, dh_pub = _mesh_keys()
        peer_id = peer_channel.peer_id_of(ed_pub)
        tail = peer_id.encode("utf-8") + ed_pub + dh_pub
        extra = {
            "peer_id": peer_id,
            "peer_pub_ed25519": base64.b64encode(ed_pub).decode(),
            "peer_dh_x25519": base64.b64encode(dh_pub).decode(),
        }
        peer = (peer_id, _dh, dh_pub)

    proof = hmac.new(
        shared_key, pair_id.encode("utf-8") + device_pub_raw + tail, hashlib.sha256
    ).digest()
    body = {
        "pair_id": pair_id,
        "client_pub": base64.b64encode(
            client_priv.public_key().public_bytes_raw()
        ).decode(),
        "device_pub_ed25519": base64.b64encode(device_pub_raw).decode(),
        "nonce_echo": qr["nonce"],
        "client_proof": base64.b64encode(proof).decode(),
        "device": {"name": "Gate Pixel", "model": "gate/v1", "platform": "android"},
        **extra,
    }
    return body, shared_key, peer


@pytest.mark.asyncio
async def test_claim_with_the_block_stores_it_and_answers_with_the_node_keys(
    auth_root_client, unauth_client
):
    init = auth_root_client.post("/api/v1/pair/init")
    assert init.status_code == 200, init.text
    payload = init.json()

    body, shared_key, peer = _claim_body(
        qr=payload["qr"], pair_id=payload["pair_id"], mesh=True
    )
    claim = unauth_client.post("/api/v1/pair/claim", json=body)
    assert claim.status_code == 200, claim.text
    data = claim.json()

    assert data["node_id"] and data["node_pub_ed25519"] and data["node_dh_x25519"]

    # Доказ сервера мусить накривати ключі вузла: інакше посередник підмінив
    # би їх, телефон склав би адресу з чужим ключем і писав би в нікуди.
    expected = base64.b64encode(
        hmac.new(
            shared_key,
            data["device_jwt"].encode("utf-8")
            + data["node_id"].encode("utf-8")
            + base64.b64decode(data["node_pub_ed25519"])
            + base64.b64decode(data["node_dh_x25519"]),
            hashlib.sha256,
        ).digest()
    ).decode()
    assert data["server_proof"] == expected

    from db.database import AsyncSessionLocal

    async with AsyncSessionLocal() as s:
        row = (
            await s.execute(
                select(PairedDevice).where(PairedDevice.id == data["device_id"])
            )
        ).scalar_one()
    peer_id, phone_dh_priv, _phone_dh_pub = peer
    assert row.peer_id == peer_id
    assert row.peer_dh_x25519 == body["peer_dh_x25519"]

    # І головне: ОДНА адреса. Телефон рахує її зі свого приватного ключа й
    # ключа вузла з відповіді; вузол — навпаки. Збіг тут і є вся хвиля.
    from cryptography.hazmat.primitives import serialization

    from messenger.crypto.keys import KeyStore
    from node import pair_drop

    phone_priv_raw = phone_dh_priv.private_bytes(
        serialization.Encoding.Raw,
        serialization.PrivateFormat.Raw,
        serialization.NoEncryption(),
    )
    at_phone = peer_channel.channel_key(
        phone_priv_raw, data["node_dh_x25519"], peer_id, data["node_id"]
    )
    keys = KeyStore.from_node(one_time_count=0)
    at_node = pair_drop.pair_key_of(keys, row)
    assert at_phone and at_phone == at_node

    epoch = pr.epoch_of(1_756_900_000_000)
    relay = pr.relay_key(at_phone, peer_id, data["node_id"])
    assert pr.msg_tag(relay, peer_id, data["node_id"], epoch) == pr.msg_tag(
        pr.relay_key(at_node, keys.node_id, peer_id), peer_id, keys.node_id, epoch
    )


@pytest.mark.asyncio
async def test_a_phone_without_the_block_still_pairs_and_says_it_has_no_store(
    auth_root_client, unauth_client
):
    # Сумісність не на слово: телефон попередньої збірки мусить спаруватись,
    # і список пристроїв мусить сказати про нього «сховка немає», а не мовчати.
    init = auth_root_client.post("/api/v1/pair/init")
    payload = init.json()
    body, _shared, _peer = _claim_body(
        qr=payload["qr"], pair_id=payload["pair_id"], mesh=False
    )
    claim = unauth_client.post("/api/v1/pair/claim", json=body)
    assert claim.status_code == 200, claim.text
    data = claim.json()
    assert data["node_id"] == ""

    devices = auth_root_client.get("/api/v1/pair/devices")
    assert devices.status_code == 200, devices.text
    row = next(d for d in devices.json() if d["id"] == data["device_id"])
    assert row["drop_ready"] is False
