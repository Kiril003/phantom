"""Дорога ПК↔телефон у сховку: одна адреса й один конверт, який обидва читають.

Збіг адрес сам по собі нічого не доставляє. У скриньці лежить не кадр храповика
ПК, а конверт PH3 з `PeerMessage` всередині — мова телефона. Тут доводиться, що
вузол уміє скласти ТУ САМУ адресу з запису пристрою і відчинити ТОЙ САМИЙ
конверт, а його відповідь підписана ключем, який телефон дістав у паринзі.
"""
import base64
from dataclasses import dataclass
from typing import Optional

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey

from messenger.crypto.keys import KeyStore
from node import pair_drop, peer_channel
from node import peer_letter as pl
from node import peer_relay as pr


@dataclass
class FakeDevice:
    """Рівно ті поля `PairedDevice`, які читає дорога."""

    peer_id: Optional[str]
    peer_pub_ed25519: Optional[str]
    peer_dh_x25519: Optional[str]
    device_name: str = "Pixel"
    revoked_at: Optional[object] = None


def _b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii")


class Phone:
    """Телефон настільки, наскільки він потрібен дорозі: два ключі й ім'я."""

    def __init__(self) -> None:
        self.ed = Ed25519PrivateKey.generate()
        self.dh = X25519PrivateKey.generate()
        self.ed_pub = self.ed.public_key().public_bytes(
            serialization.Encoding.Raw, serialization.PublicFormat.Raw
        )
        self.dh_pub = self.dh.public_key().public_bytes(
            serialization.Encoding.Raw, serialization.PublicFormat.Raw
        )
        self.dh_priv = self.dh.private_bytes(
            serialization.Encoding.Raw,
            serialization.PrivateFormat.Raw,
            serialization.NoEncryption(),
        )
        self.id = peer_channel.peer_id_of(self.ed_pub)

    def device(self) -> FakeDevice:
        return FakeDevice(
            peer_id=self.id,
            peer_pub_ed25519=_b64(self.ed_pub),
            peer_dh_x25519=_b64(self.dh_pub),
        )

    def pair_key(self, node_id: str) -> bytes:
        return peer_channel.channel_key(
            self.dh_priv, _b64(_node_dh_pub()), self.id, node_id
        )


_KEYS = KeyStore.generate(one_time_count=1)


def _node_dh_pub() -> bytes:
    return _KEYS.identity_dh_public


def test_node_and_phone_derive_the_same_pair_key():
    phone = Phone()
    from_node = pair_drop.pair_key_of(_KEYS, phone.device())
    from_phone = phone.pair_key(_KEYS.node_id)
    assert from_node
    assert from_node == from_phone


def test_a_record_without_keys_has_no_road_and_says_so():
    # Пара, наведена до обміну ключами. «Немає ключа» мусить читатись як стан,
    # а не як порожній ключ, який виглядав би адресою нізвідки.
    stale = FakeDevice(peer_id=None, peer_pub_ed25519=None, peer_dh_x25519=None)
    assert pair_drop.drop_ready(stale) is False
    assert pair_drop.pair_key_of(_KEYS, stale) == b""
    assert pair_drop.mailbox_of(_KEYS, stale) is None


def test_the_mailbox_the_node_polls_is_the_one_the_phone_writes_to():
    phone = Phone()
    box = pair_drop.mailbox_of(_KEYS, phone.device())
    assert box is not None and box.peer_id == phone.id

    epoch = pr.epoch_of(1_756_900_000_000)
    # Вузол чекає лист САМЕ там, куди його кладе телефон: sender=телефон,
    # recipient=вузол. Переставиш сторони — обидва «праві» й обидва глухі.
    plan = pr.plan(_KEYS.node_id, [box], 1_756_900_000_000)
    phone_relay = pr.relay_key(phone.pair_key(_KEYS.node_id), phone.id, _KEYS.node_id)
    written = pr.msg_tag(phone_relay, phone.id, _KEYS.node_id, epoch)
    assert written in plan.slots
    assert plan.slots[written].kind == pr.Kind.LETTER
    assert len(plan.tags) == pr.FETCH_TAGS


def test_node_opens_a_letter_the_phone_sealed():
    phone = Phone()
    pair = phone.pair_key(_KEYS.node_id)
    letter = pl.sign(
        pl.PeerLetter(
            id="m-1",
            from_id=phone.id,
            to_id=_KEYS.node_id,
            body="перевірка дороги",
            sent_at_ms=1_756_900_000_000,
        ),
        phone.ed,
    )
    frame, _nonce = pl.seal_envelope(letter, pair)

    opened = pl.open_envelope(frame, pair_drop.pair_key_of(_KEYS, phone.device()))
    assert opened == letter
    assert pl.verify(opened, phone.ed_pub, expected_from=phone.id)


def test_a_letter_re_addressed_on_the_envelope_does_not_open():
    # Чинний кадр, перекладений в іншу скриньку або переадресований на
    # конверті, мусить лишитись закритим: адреса входить в автентифікацію.
    phone = Phone()
    pair = phone.pair_key(_KEYS.node_id)
    letter = pl.sign(
        pl.PeerLetter("m-2", phone.id, _KEYS.node_id, "тіло", 1),
        phone.ed,
    )
    frame, _ = pl.seal_envelope(letter, pair)
    tampered = frame.replace(f'"to":"{_KEYS.node_id}"', '"to":"deadbeefdeadbeef"')
    assert pl.open_envelope(tampered, pair) is None


def test_a_signature_from_another_phone_is_not_believed():
    phone, stranger = Phone(), Phone()
    letter = pl.sign(
        pl.PeerLetter("m-3", phone.id, _KEYS.node_id, "тіло", 1), stranger.ed
    )
    assert pl.verify(letter, phone.ed_pub, expected_from=phone.id) is False


def test_the_reply_rides_the_same_road_and_the_phone_can_check_it():
    phone = Phone()
    pair = pair_drop.pair_key_of(_KEYS, phone.device())
    node_ed = Ed25519PrivateKey.generate()
    node_ed_pub = node_ed.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw
    )
    reply = pl.sign(
        pl.PeerLetter("r-1", _KEYS.node_id, phone.id, "відповідь", 2), node_ed
    )
    frame, _ = pl.seal_envelope(reply, pair)

    # Телефон відчиняє СВОЇМ ключем каналу — тим самим, що вивів сам.
    opened = pl.open_envelope(frame, phone.pair_key(_KEYS.node_id))
    assert opened == reply
    assert pl.verify(opened, node_ed_pub, expected_from=_KEYS.node_id)


def test_receipt_binds_the_copy_the_store_actually_held():
    phone = Phone()
    pair = phone.pair_key(_KEYS.node_id)
    letter = pl.sign(pl.PeerLetter("m-4", phone.id, _KEYS.node_id, "тіло", 3), phone.ed)
    frame, nonce = pl.seal_envelope(letter, pair)
    relay = pr.relay_key(pair, _KEYS.node_id, phone.id)
    wrapped = pr.wrap(frame, relay, pr.msg_tag(relay, phone.id, _KEYS.node_id, 1))
    assert pr.nonce_of(wrapped.blob) is not None

    mark = pl.receipt(pair, letter.id, letter.from_id, letter.to_id, pr.nonce_of(wrapped.blob))
    assert mark and len(mark) == 43
    # Квитанція на ІНШУ копію того самого листа — інша: без прив'язки до
    # nonce будь-хто, хто бачив ідентифікатор, відповідав би «доставлено».
    other = pl.receipt(pair, letter.id, letter.from_id, letter.to_id, nonce)
    assert other != mark
