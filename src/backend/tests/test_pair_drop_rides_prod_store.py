"""Лист ПК↔телефон їде через ЖИВИЙ сховок за адресою пари.

Це не модель і не локальний двійник сервера: конверт кладеться в
`https://phantom-license.fly.dev/relay/drop` за адресою, складеною з ключа
каналу пари, забирається `/relay/fetch` і прибирається `/relay/burn`.

Що саме доводиться:
  * адресу пари ПК↔телефон сховок приймає як звичайну адресу PH5;
  * конверт сталої довжини (одна з трьох корзин) проходить контракт сервера;
  * забраний конверт відчиняється ключем СВОЄЇ скриньки і всередині лежить
    той самий конверт PH3, який телефон уміє читати, з чинним підписом.

Чого НЕ доводиться: що телефон його забрав. Другий бік тут — той самий процес.
Повний цикл — на апараті, в іншій сесії.

Мережа: рівно три запити (drop, fetch, burn) при ліміті 120/хв на IP. Сховок
мовчить — тест пропускається зі сказаною причиною, а не зеленіє мовчки.
"""
from __future__ import annotations

import base64
import os
import time
import uuid

import httpx
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey

from messenger.crypto.keys import KeyStore
from node import pair_drop, peer_channel
from node import peer_letter as pl
from node import peer_relay as pr
from node.relay_courier import Burned, Fetched, Held, Offline, RelayCourier

STORE = os.environ.get("PHANTOM_DROP_STORE", "https://phantom-license.fly.dev")


class _Phone:
    def __init__(self) -> None:
        self.ed = Ed25519PrivateKey.generate()
        dh = X25519PrivateKey.generate()
        self.ed_pub = self.ed.public_key().public_bytes(
            serialization.Encoding.Raw, serialization.PublicFormat.Raw
        )
        self.dh_pub = dh.public_key().public_bytes(
            serialization.Encoding.Raw, serialization.PublicFormat.Raw
        )
        self.dh_priv = dh.private_bytes(
            serialization.Encoding.Raw,
            serialization.PrivateFormat.Raw,
            serialization.NoEncryption(),
        )
        self.id = peer_channel.peer_id_of(self.ed_pub)


class _Device:
    """Запис пристрою рівно в тих полях, які читає дорога."""

    def __init__(self, phone: _Phone) -> None:
        self.peer_id = phone.id
        self.peer_pub_ed25519 = base64.b64encode(phone.ed_pub).decode()
        self.peer_dh_x25519 = base64.b64encode(phone.dh_pub).decode()
        self.device_name = "gate"


@pytest.mark.asyncio
async def test_a_phone_letter_rides_the_live_store_at_the_pair_address():
    keys = KeyStore.generate(one_time_count=0)
    phone = _Phone()
    device = _Device(phone)

    # Ключ каналу — з ОБОХ боків окремо, як у житті: жодна сторона не питає
    # другу. Розійдись вони — адреси розійшлись би теж, і тест став би
    # зеленим за побудовою: обидва боки чесно клали б у свої скриньки.
    node_pair = pair_drop.pair_key_of(keys, device)
    phone_pair = peer_channel.channel_key(
        phone.dh_priv,
        base64.b64encode(keys.identity_dh_public).decode(),
        phone.id,
        keys.node_id,
    )
    assert node_pair and node_pair == phone_pair

    now_ms = int(time.time() * 1000)
    epoch = pr.epoch_of(now_ms)
    relay = pr.relay_key(phone_pair, phone.id, keys.node_id)
    tag = pr.msg_tag(relay, phone.id, keys.node_id, epoch)
    assert pr.is_tag(tag)

    letter = pl.sign(
        pl.PeerLetter(
            id=uuid.uuid4().hex,
            from_id=phone.id,
            to_id=keys.node_id,
            body="лист крізь живий сховок",
            sent_at_ms=now_ms,
        ),
        phone.ed,
    )
    frame, _nonce = pl.seal_envelope(letter, phone_pair)
    wrapped = pr.wrap(frame, relay, tag)
    assert wrapped is not None and len(wrapped.blob) in pr.BLOB_SIZES

    # Коди відповідей — частина доказу, а не журнал: «дійшло» без коду
    # неможливо перевірити чужими очима.
    codes: list[str] = []

    async def _note(response: httpx.Response) -> None:
        codes.append(f"{response.request.url.path} {response.status_code}")

    async with httpx.AsyncClient(timeout=15.0, event_hooks={"response": [_note]}) as http:
        courier = RelayCourier(STORE, client=http)

        held = await courier.drop(tag, wrapped.blob)
        if isinstance(held, Offline):
            pytest.skip(f"сховок мовчить: {held.reason}")
        assert isinstance(held, Held), f"сховок не взяв конверт: {held!r}"

        # Забір завжди питає рівно 64 імені — інакше число саме стає підписом.
        box = pair_drop.mailbox_of(keys, device)
        assert box is not None
        plan = pr.plan(keys.node_id, [box], now_ms)
        assert tag in plan.slots and len(plan.tags) == pr.FETCH_TAGS

        fetched = await courier.fetch(plan.tags)
        if isinstance(fetched, Offline):
            pytest.skip(f"сховок мовчить на заборі: {fetched.reason}")
        assert isinstance(fetched, Fetched), f"сховок не віддав пошту: {fetched!r}"

        ours = [item for item in fetched.letters if item.tag == tag]
        assert ours, "конверт не лежить під адресою пари — адреси розійшлись"

        text = pr.unwrap(ours[0].blob, relay, tag)
        assert text is not None, "конверт не відчинився ключем СВОЄЇ скриньки"
        opened = pl.open_envelope(text, node_pair)
        assert opened is not None and opened.body == letter.body
        assert pl.verify(opened, phone.ed_pub, expected_from=phone.id)

        burned = await courier.burn([item.id for item in ours if item.id])
        # Не спалити — не помилка дороги (копія доживе до TTL), але сказати
        # про це треба вголос, а не лишити мовчазний слід у чужому сховку.
        assert isinstance(burned, (Burned, Offline)), f"спалення відмовлено: {burned!r}"

    print("сховок відповів:", " | ".join(codes))
    assert [c.split()[1] for c in codes] == ["200", "200", "200"], codes
