"""ОДНА адреса для ПК і телефона — доведена спільним вектором.

Той самий файл лежить у двох деревах:
  phantom-os-beta-drop/src/backend/tests/vectors/pc_pair_channel_vector.json
  phantom-companion-drop/core-net/src/test/resources/pc_pair_channel_vector.json
і читається Kotlin-тестом `PcPairChannelVectorTest`.

Це головний доказ хвилі. Розходження в солі, в алфавіті base64 чи в порядку
сторін не дає жодної помилки: обидва боки чесно рахують адреси, обидва чесно
ходять у сховок, і обидва бачать порожньо. Спільний вектор — єдине місце, де
таке розходження стає червоним.
"""
import pytest
import base64
import json
from pathlib import Path

from node import peer_channel, peer_relay as pr

VECTOR = Path(__file__).resolve().parent / "vectors" / "pc_pair_channel_vector.json"
COMPANION_COPY = (
    Path(__file__).resolve().parents[4]
    / "phantom-companion-drop"
    / "core-net/src/test/resources/pc_pair_channel_vector.json"
)


def _vector() -> dict:
    return json.loads(VECTOR.read_text(encoding="utf-8"))


def _raw(text: str) -> bytes:
    return base64.b64decode(text + "=" * (-len(text) % 4))


def test_copies_in_both_trees_are_byte_identical():
    if not COMPANION_COPY.is_file():
        pytest.skip("телефонного дерева поруч немає — звіряти нічого; тихий pass тут ховав би головний доказ хвилі")
    assert COMPANION_COPY.read_bytes() == VECTOR.read_bytes(), (
        "копії вектора розійшлись — один із тестів доводить уже не те, що другий"
    )


def test_node_derives_the_channel_key_from_the_vector():
    v = _vector()
    key = peer_channel.channel_key(
        _raw(v["node"]["x25519_priv_b64"]),
        v["phone"]["x25519_pub_b64"],
        v["node"]["node_id"],
        v["phone"]["peer_id"],
    )
    assert key is not None
    assert base64.b64encode(key).decode() == v["expected"]["pair_key_b64"]


def test_phone_side_derives_THE_SAME_key():
    # Той самий виклик із протилежними ролями. Якби сіль залежала від того,
    # хто «перший», це єдине місце, де воно б проявилось.
    v = _vector()
    key = peer_channel.channel_key(
        _raw(v["phone"]["x25519_priv_b64"]),
        v["node"]["x25519_pub_b64"],
        v["phone"]["peer_id"],
        v["node"]["node_id"],
    )
    assert base64.b64encode(key).decode() == v["expected"]["pair_key_b64"]


def test_relay_key_matches_from_both_sides():
    v = _vector()
    pair = _raw(v["expected"]["pair_key_b64"])
    a = pr.relay_key(pair, v["phone"]["peer_id"], v["node"]["node_id"])
    b = pr.relay_key(pair, v["node"]["node_id"], v["phone"]["peer_id"])
    assert base64.b64encode(a).decode() == v["expected"]["relay_key_b64"]
    assert a == b


def test_mailbox_addresses_match_the_vector():
    v = _vector()
    relay = _raw(v["expected"]["relay_key_b64"])
    epoch = v["epoch"]
    assert (
        pr.msg_tag(relay, v["phone"]["peer_id"], v["node"]["node_id"], epoch)
        == v["expected"]["msg_tag_phone_to_node"]
    )
    assert (
        pr.msg_tag(relay, v["node"]["node_id"], v["phone"]["peer_id"], epoch)
        == v["expected"]["msg_tag_node_to_phone"]
    )
    assert (
        pr.ack_tag(relay, v["phone"]["peer_id"], v["node"]["node_id"], epoch)
        == v["expected"]["ack_tag_phone_to_node"]
    )


def test_letter_and_receipt_live_in_different_boxes():
    # Однакові адреси означали б, що квитанція перезаписує сам лист.
    v = _vector()
    relay = _raw(v["expected"]["relay_key_b64"])
    assert v["expected"]["msg_tag_phone_to_node"] != v["expected"]["ack_tag_phone_to_node"]
    assert pr.is_tag(v["expected"]["msg_tag_phone_to_node"])
    assert pr.is_tag(pr.ack_tag(relay, v["phone"]["peer_id"], v["node"]["node_id"], 1))


def test_phone_peer_id_is_derived_the_phone_way():
    # 16 hex від sha256(UTF-8 байтів BASE64-РЯДКА ключа), не від сирого ключа.
    # Помилка тут входить і в сіль, і в канонічний рядок адреси, і не лишає сліду.
    v = _vector()
    assert (
        peer_channel.peer_id_of(_raw(v["phone"]["ed25519_pub_b64"]))
        == v["phone"]["peer_id"]
    )


def test_the_node_letter_in_the_vector_still_opens_and_still_verifies():
    """Той самий кадр, що читає Kotlin-тест, мусить відчинятись і тут.

    Це не дублювання: якщо вектор колись перегенерують іншим кодом, ця
    перевірка червоніє в тому ж комміті, а не через тиждень на апараті.
    """
    from node import peer_letter as pl

    v = _vector()
    block = v["letter_from_node"]
    pair = _raw(v["expected"]["pair_key_b64"])
    opened = pl.open_envelope(block["frame"], pair)
    assert opened is not None
    assert opened.id == block["id"]
    assert opened.body == block["body"]
    assert opened.from_id == v["node"]["node_id"]
    assert opened.to_id == v["phone"]["peer_id"]
    assert opened.signature == block["signature_b64"]
    assert pl.verify(opened, _raw(v["node"]["ed25519_pub_b64"]), expected_from=opened.from_id)
    # Ключ іншої сторони не проходить — інакше підпис не доводив би нічого.
    assert not pl.verify(opened, _raw(v["phone"]["ed25519_pub_b64"]))
    assert (
        pl.receipt(
            pair, opened.id, opened.from_id, opened.to_id, block["receipt_over_nonce_b64"]
        )
        == block["receipt_b64"]
    )
