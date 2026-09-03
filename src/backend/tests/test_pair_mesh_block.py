"""Сітьові ключі всередині доказу `mobile-pair-v1`, а не поруч із ним.

До 03.09.2026 паринг обмінював лише ключі САМОГО паринга. Довічний X25519, з
якого виводиться адреса скриньки у сховку, не їхав нікуди — тож ПК і телефон
рахували різні адреси й жоден не мав як про це дізнатись.

Тут прибиті три речі: хвіст доказу байт-у-байт, сумісність зі старим телефоном
(порожній хвіст) і те, що відщипнути блок від запиту не вийде.
"""
import base64
from pathlib import Path

import pytest

from api.routes_pair import PairClaimRequest
from security.pair_crypto import (
    MeshBlock,
    PairingError,
    build_server_proof,
    mesh_tail,
    verify_client_proof,
)

KOTLIN_SOURCE = (
    Path(__file__).resolve().parents[4]
    / "phantom-companion-drop"
    / "core-net/src/main/java/local/phantom/companion/core/net/pair/PairProofs.kt"
)

PEER_ID = "e176d7ed9ebf922e"
ED = base64.b64encode(bytes(range(200, 232))).decode()
DH = base64.b64encode(bytes(range(1, 33))).decode()

MESH = MeshBlock(peer_id=PEER_ID, pub_ed25519_b64=ED, dh_x25519_b64=DH)


def _hmac(key: bytes, msg: bytes) -> bytes:
    import hashlib
    import hmac

    return hmac.new(key, msg, hashlib.sha256).digest()


def test_tail_is_the_name_and_two_raw_keys():
    assert mesh_tail(MESH) == (
        PEER_ID.encode("utf-8") + bytes(range(200, 232)) + bytes(range(1, 33))
    )


def test_no_block_means_no_tail():
    # Саме це лишає сумісним телефон попередньої збірки: він рахує коротке
    # повідомлення, сервер бачить, що полів немає, і рахує таке саме.
    assert mesh_tail(None) == b""
    assert mesh_tail(MeshBlock("", "", "")) == b""


def test_client_proof_covers_the_block():
    shared = bytes(32)
    device_pub = base64.b64encode(bytes(range(60, 92))).decode()
    proof = base64.b64encode(
        _hmac(
            shared,
            b"pair-1" + bytes(range(60, 92)) + mesh_tail(MESH),
        )
    ).decode()
    verify_client_proof(
        shared_key=shared,
        pair_id="pair-1",
        device_pub_ed25519_b64=device_pub,
        proof_b64=proof,
        mesh=MESH,
    )


def test_stripping_the_block_breaks_the_proof():
    # Посередник, що прибрав сітьові поля, лишив би вузол без ключа й сховок —
    # без спільної адреси. Доказ мусить перестати сходитись.
    shared = bytes(32)
    device_pub = base64.b64encode(bytes(range(60, 92))).decode()
    proof = base64.b64encode(
        _hmac(shared, b"pair-1" + bytes(range(60, 92)) + mesh_tail(MESH))
    ).decode()
    with pytest.raises(PairingError):
        verify_client_proof(
            shared_key=shared,
            pair_id="pair-1",
            device_pub_ed25519_b64=device_pub,
            proof_b64=proof,
            mesh=None,
        )


def test_server_proof_binds_the_node_keys():
    shared = bytes(32)
    node = MeshBlock("2b038b02f23b2ce79479256413a3efca", ED, DH)
    with_node = build_server_proof(shared_key=shared, device_jwt="jwt", node=node)
    without = build_server_proof(shared_key=shared, device_jwt="jwt")
    assert with_node != without
    # Старий телефон перевіряє доказ над самим JWT — цей шлях мусить лишитись.
    assert without == base64.b64encode(_hmac(shared, b"jwt")).decode()


def test_request_reads_the_block_only_when_complete():
    full = PairClaimRequest(
        pair_id="pair-1234",
        client_pub="A" * 44,
        device_pub_ed25519="B" * 44,
        nonce_echo="C" * 32,
        client_proof="D" * 44,
        peer_id=PEER_ID,
        peer_pub_ed25519=ED,
        peer_dh_x25519=DH,
    )
    assert full.mesh() == MESH

    half = full.model_copy(update={"peer_dh_x25519": None})
    # Половина блоку — це не блок: ключ каналу з неї не вивести, і вдавати,
    # що пара «майже готова», означало б обіцяти дорогу, якої немає.
    assert half.mesh() is None


def test_kotlin_and_python_tails_are_the_same_function():
    if not KOTLIN_SOURCE.is_file():
        return  # телефонного дерева поруч немає — звіряти нічого
    text = KOTLIN_SOURCE.read_text(encoding="utf-8")
    assert "fun meshTail(" in text, "хвоста в Kotlin немає — доказ розійдеться"
    assert "b64ToBytes(mesh.pubKeyB64)" in text
    assert "b64ToBytes(mesh.dhPubKeyB64)" in text
