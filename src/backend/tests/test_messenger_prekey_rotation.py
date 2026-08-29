"""Підписаний prekey не має жити вічно.

Без ротації один скомпрометований ключ відкривав би нові сесії скільки
завгодно довго — рівно те, від чого має захищати форвард-секретність.
"""
from __future__ import annotations

import time

from messenger.crypto.keys import KeyStore
from messenger.crypto.session import Session


def test_a_fresh_key_is_not_rotated():
    node = KeyStore.generate(one_time_count=2)

    assert node.rotate_if_stale() is False


def test_a_stale_key_is_replaced():
    node = KeyStore.generate(one_time_count=2)
    before = node.publish_bundle().signed_prekey_id

    rotated = node.rotate_if_stale(now=time.time() + KeyStore.SIGNED_PREKEY_MAX_AGE_S + 1)

    assert rotated is True
    assert node.publish_bundle().signed_prekey_id != before


def test_the_previous_generation_still_accepts_a_frame_in_flight():
    """Хто взяв bundle до ротації, мусить доїхати."""
    node = KeyStore.generate(one_time_count=4)
    old_bundle = node.publish_bundle()
    node.rotate_if_stale(now=time.time() + KeyStore.SIGNED_PREKEY_MAX_AGE_S + 1)

    frame = Session.initiate(KeyStore.generate(one_time_count=2), old_bundle).encrypt(b"in flight")
    _, plaintext = Session.accept(node, frame)

    assert plaintext == b"in flight"


def test_generations_past_retention_are_dropped():
    node = KeyStore.generate(one_time_count=2)
    node.rotate_if_stale(now=time.time() + KeyStore.SIGNED_PREKEY_MAX_AGE_S + 1)

    dropped = node.forget_old_signed(now=time.time() + KeyStore.SIGNED_PREKEY_RETENTION_S + 1)

    assert dropped == 1


def test_the_current_generation_is_never_dropped():
    node = KeyStore.generate(one_time_count=2)

    dropped = node.forget_old_signed(now=time.time() + KeyStore.SIGNED_PREKEY_RETENTION_S * 10)

    assert dropped == 0
    assert node.publish_bundle().signed_prekey_id


def test_running_low_on_one_time_keys_is_visible():
    node = KeyStore.generate(one_time_count=2)

    assert node.one_time_low() is True
    node.generate_one_time_prekeys(32)
    assert node.one_time_low() is False
