"""Число для звірки мусить збігатися в обох і розходитися при підміні."""
from __future__ import annotations

from messenger.crypto.keys import KeyStore
from messenger.crypto.safety import SAFETY_GROUPS, format_safety_number, safety_number


def _pair():
    a, b = KeyStore.generate(one_time_count=1), KeyStore.generate(one_time_count=1)
    return a, b


def _number(own: KeyStore, peer: KeyStore) -> str:
    return safety_number(
        own.identity_ed_public, own.identity_dh_public,
        peer.identity_ed_public, peer.identity_dh_public,
    )


def test_both_sides_see_the_same_number():
    alice, bob = _pair()

    assert _number(alice, bob) == _number(bob, alice)


def test_a_man_in_the_middle_changes_the_number():
    alice, bob = _pair()
    mallory = KeyStore.generate(one_time_count=1)

    # Аліса думає, що говорить із Бобом, а насправді з Меллорі.
    assert _number(alice, mallory) != _number(alice, bob)


def test_number_is_sixty_digits_in_twelve_groups():
    alice, bob = _pair()
    number = _number(alice, bob)

    assert len(number) == SAFETY_GROUPS * 5
    assert number.isdigit()
    assert len(format_safety_number(number).split()) == SAFETY_GROUPS


def test_number_is_stable_across_calls():
    alice, bob = _pair()

    assert _number(alice, bob) == _number(alice, bob)
