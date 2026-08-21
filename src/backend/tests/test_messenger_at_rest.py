"""Локальна історія не має лежати в базі відкритим текстом."""
from __future__ import annotations

import pytest

from messenger.crypto.at_rest import AtRestError, seal, unseal
from messenger.crypto.keys import KeyStore


def test_round_trip():
    store = KeyStore.generate(one_time_count=1)
    text = "Заскочу в маркет і куплю горіхи"

    assert unseal(store, seal(store, text)) == text


def test_plaintext_is_not_visible_in_the_blob():
    store = KeyStore.generate(one_time_count=1)
    text = "номер картки 4441 1144 1111 2222"

    assert text.encode() not in seal(store, text)


def test_another_node_cannot_read_it():
    store = KeyStore.generate(one_time_count=1)
    blob = seal(store, "особисте")

    with pytest.raises(AtRestError):
        unseal(KeyStore.generate(one_time_count=1), blob)


def test_tampering_is_detected():
    store = KeyStore.generate(one_time_count=1)
    blob = bytearray(seal(store, "особисте"))
    blob[-1] ^= 0x01

    with pytest.raises(AtRestError):
        unseal(store, bytes(blob))


def test_blob_is_bound_to_its_message():
    """Переставити запечатане тіло в інше повідомлення не вийде."""
    store = KeyStore.generate(one_time_count=1)
    blob = seal(store, "привіт", aad=b"msg-1")

    with pytest.raises(AtRestError):
        unseal(store, blob, aad=b"msg-2")
