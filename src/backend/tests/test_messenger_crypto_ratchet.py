"""Double Ratchet: порядок доставки, втрати, підробки, forward secrecy.

Тести не піднімають застосунок — тільки messenger.crypto.
"""
from __future__ import annotations

import os

import pytest
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey

from messenger.crypto.keys import x25519_public_raw
from messenger.crypto.ratchet import (
    HEADER_LEN,
    MAX_SKIP,
    AuthenticationFailed,
    DoubleRatchet,
    Header,
    RatchetError,
    SkipLimitExceeded,
)

_AD = b"test-associated-data"


def _pair(associated_data: bytes = _AD) -> tuple[DoubleRatchet, DoubleRatchet]:
    root = os.urandom(32)
    responder_dh = X25519PrivateKey.generate()
    initiator = DoubleRatchet.for_initiator(
        root, x25519_public_raw(responder_dh), associated_data
    )
    responder = DoubleRatchet.for_responder(root, responder_dh, associated_data)
    return initiator, responder


def _flip(raw: bytes, index: int) -> bytes:
    blob = bytearray(raw)
    blob[index] ^= 0x01
    return bytes(blob)


class TestHappyPath:
    def test_first_message_and_reply(self) -> None:
        alice, bob = _pair()
        wire = alice.encrypt("привіт".encode())
        assert bob.decrypt(wire) == "привіт".encode()
        back = bob.encrypt("чую".encode())
        assert alice.decrypt(back) == "чую".encode()

    def test_long_ping_pong_keeps_ratcheting(self) -> None:
        alice, bob = _pair()
        for i in range(25):
            payload = f"a{i}".encode()
            assert bob.decrypt(alice.encrypt(payload)) == payload
            payload = f"b{i}".encode()
            assert alice.decrypt(bob.encrypt(payload)) == payload

    def test_burst_in_one_direction(self) -> None:
        alice, bob = _pair()
        wires = [alice.encrypt(f"m{i}".encode()) for i in range(50)]
        for i, wire in enumerate(wires):
            assert bob.decrypt(wire) == f"m{i}".encode()

    def test_empty_payload_round_trips(self) -> None:
        alice, bob = _pair()
        assert bob.decrypt(alice.encrypt(b"")) == b""

    def test_large_payload_round_trips(self) -> None:
        alice, bob = _pair()
        blob = os.urandom(512 * 1024)
        assert bob.decrypt(alice.encrypt(blob)) == blob

    def test_responder_cannot_send_before_receiving(self) -> None:
        """У відповідача ще немає черги відправки — це відмова, а не тиша."""
        _, bob = _pair()
        assert bob.can_send is False
        with pytest.raises(RatchetError):
            bob.encrypt("передчасно".encode())

    def test_repeated_plaintext_yields_distinct_ciphertext(self) -> None:
        alice, _ = _pair()
        wires = {alice.encrypt("той самий текст".encode()) for _ in range(20)}
        assert len(wires) == 20

    def test_string_input_rejected(self) -> None:
        alice, _ = _pair()
        with pytest.raises(TypeError):
            alice.encrypt("рядок")  # type: ignore[arg-type]


class TestOutOfOrder:
    def test_shuffled_within_one_chain(self) -> None:
        alice, bob = _pair()
        wires = [alice.encrypt(f"m{i}".encode()) for i in range(5)]
        for i in (2, 0, 4, 1, 3):
            assert bob.decrypt(wires[i]) == f"m{i}".encode()

    def test_reverse_order(self) -> None:
        alice, bob = _pair()
        wires = [alice.encrypt(f"m{i}".encode()) for i in range(8)]
        for i in reversed(range(8)):
            assert bob.decrypt(wires[i]) == f"m{i}".encode()

    def test_out_of_order_across_a_dh_ratchet(self) -> None:
        """Кадр нової епохи приходить першим — pn мусить догнати стару чергу."""
        alice, bob = _pair()
        a0 = alice.encrypt(b"a0")
        a1 = alice.encrypt(b"a1")
        assert bob.decrypt(a0) == b"a0"
        reply = bob.encrypt(b"b0")
        assert alice.decrypt(reply) == b"b0"
        a2 = alice.encrypt(b"a2")  # уже під новим ключем храповика

        assert bob.decrypt(a2) == b"a2"
        assert bob.decrypt(a1) == b"a1"  # відсталий кадр попередньої епохи

    def test_two_epochs_interleaved(self) -> None:
        alice, bob = _pair()
        first_epoch = [alice.encrypt(f"x{i}".encode()) for i in range(3)]
        assert bob.decrypt(first_epoch[0]) == b"x0"
        assert alice.decrypt(bob.encrypt(b"turn")) == b"turn"
        second_epoch = [alice.encrypt(f"y{i}".encode()) for i in range(3)]

        for wire, expected in (
            (second_epoch[2], b"y2"),
            (first_epoch[2], b"x2"),
            (second_epoch[0], b"y0"),
            (first_epoch[1], b"x1"),
            (second_epoch[1], b"y1"),
        ):
            assert bob.decrypt(wire) == expected


class TestLostMessages:
    def test_permanently_lost_message_does_not_block_the_chain(self) -> None:
        alice, bob = _pair()
        wires = [alice.encrypt(f"m{i}".encode()) for i in range(5)]
        del wires[2]  # це повідомлення мережа з'їла назавжди
        for wire, expected in zip(wires, (b"m0", b"m1", b"m3", b"m4")):
            assert bob.decrypt(wire) == expected

    def test_late_arrival_after_a_gap(self) -> None:
        alice, bob = _pair()
        wires = [alice.encrypt(f"m{i}".encode()) for i in range(4)]
        assert bob.decrypt(wires[0]) == b"m0"
        assert bob.decrypt(wires[3]) == b"m3"
        assert bob.decrypt(wires[1]) == b"m1"
        assert bob.decrypt(wires[2]) == b"m2"

    def test_lost_reply_does_not_break_the_next_turn(self) -> None:
        alice, bob = _pair()
        assert bob.decrypt(alice.encrypt(b"a0")) == b"a0"
        bob.encrypt(b"lost reply")  # кадр не доїхав до Аліси
        assert alice.decrypt(bob.encrypt(b"b1")) == b"b1"

    def test_skip_limit_is_enforced(self) -> None:
        """Занадто далекий номер — це вже атака на пам'ять, не запізнення."""
        alice, bob = _pair()
        for _ in range(MAX_SKIP + 5):
            wire = alice.encrypt(b"filler")
        with pytest.raises(SkipLimitExceeded):
            bob.decrypt(wire)

    def test_skip_just_below_the_limit_is_accepted(self) -> None:
        alice, bob = _pair()
        for _ in range(MAX_SKIP):
            wire = alice.encrypt(b"filler")
        assert bob.decrypt(wire) == b"filler"


class TestForgery:
    def test_flipped_ciphertext_byte_rejected(self) -> None:
        alice, bob = _pair()
        wire = alice.encrypt("платіж підтверджено".encode())
        with pytest.raises(AuthenticationFailed):
            bob.decrypt(_flip(wire, len(wire) - 1))

    def test_flipped_header_counter_rejected(self) -> None:
        alice, bob = _pair()
        wire = alice.encrypt("текст".encode())
        with pytest.raises(AuthenticationFailed):
            bob.decrypt(_flip(wire, HEADER_LEN - 1))

    def test_substituted_ratchet_public_key_rejected(self) -> None:
        """Підміна DH-ключа в заголовку — головний вектор MITM на храповику."""
        alice, bob = _pair()
        wire = alice.encrypt("текст".encode())
        attacker = x25519_public_raw(X25519PrivateKey.generate())
        forged = attacker + wire[32:]
        with pytest.raises(AuthenticationFailed):
            bob.decrypt(forged)

    def test_all_zero_ratchet_key_rejected(self) -> None:
        alice, bob = _pair()
        wire = alice.encrypt("текст".encode())
        with pytest.raises(AuthenticationFailed):
            bob.decrypt(b"\x00" * 32 + wire[32:])

    def test_forgery_does_not_corrupt_the_session(self) -> None:
        """Стан рухається лише після тега — інакше одним кадром вбивають розмову."""
        alice, bob = _pair()
        good = alice.encrypt("перше".encode())
        later = alice.encrypt("друге".encode())
        with pytest.raises(AuthenticationFailed):
            bob.decrypt(_flip(good, len(good) - 1))
        assert bob.decrypt(good) == "перше".encode()
        assert bob.decrypt(later) == "друге".encode()

    def test_wrong_associated_data_rejected(self) -> None:
        """AD прибиває особи: чужа AD = чужа сесія."""
        root = os.urandom(32)
        responder_dh = X25519PrivateKey.generate()
        alice = DoubleRatchet.for_initiator(
            root, x25519_public_raw(responder_dh), b"alice<->bob"
        )
        impostor = DoubleRatchet.for_responder(root, responder_dh, b"alice<->mallory")
        with pytest.raises(AuthenticationFailed):
            impostor.decrypt(alice.encrypt("текст".encode()))

    def test_extra_aad_must_match(self) -> None:
        alice, bob = _pair()
        wire = alice.encrypt("текст".encode(), aad=b"frame-prefix")
        with pytest.raises(AuthenticationFailed):
            bob.decrypt(wire, aad=b"frame-prefiy")
        assert bob.decrypt(wire, aad=b"frame-prefix") == "текст".encode()

    def test_frame_from_another_session_rejected(self) -> None:
        alice, _ = _pair()
        _, other_bob = _pair()
        with pytest.raises(AuthenticationFailed):
            other_bob.decrypt(alice.encrypt("текст".encode()))

    def test_truncated_frame_rejected(self) -> None:
        alice, bob = _pair()
        wire = alice.encrypt("текст".encode())
        with pytest.raises(AuthenticationFailed):
            bob.decrypt(wire[:HEADER_LEN + 4])

    def test_header_length_is_validated(self) -> None:
        with pytest.raises(RatchetError):
            Header.unpack(b"\x00" * (HEADER_LEN - 1))


class TestForwardSecrecy:
    def test_replay_of_a_delivered_message_fails(self) -> None:
        """Ключ повідомлення знищується одразу після використання."""
        alice, bob = _pair()
        wire = alice.encrypt("один раз".encode())
        assert bob.decrypt(wire) == "один раз".encode()
        with pytest.raises(AuthenticationFailed):
            bob.decrypt(wire)

    def test_stolen_current_state_cannot_read_past_traffic(self) -> None:
        """Головна обіцянка FS: захоплення стану сьогодні не відкриває вчорашнє."""
        alice, bob = _pair()
        wires = [alice.encrypt(f"m{i}".encode()) for i in range(4)]
        for i, wire in enumerate(wires):
            assert bob.decrypt(wire) == f"m{i}".encode()

        stolen = bob.snapshot()  # зловмисник зняв стан Боба саме зараз
        for wire in wires:
            with pytest.raises(AuthenticationFailed):
                stolen.decrypt(wire)

    def test_old_epoch_state_cannot_read_new_epoch(self) -> None:
        alice, bob = _pair()
        assert bob.decrypt(alice.encrypt(b"a0")) == b"a0"
        stale = bob.snapshot()  # стан однієї епохи назад

        assert alice.decrypt(bob.encrypt(b"b0")) == b"b0"
        assert bob.decrypt(alice.encrypt(b"a1")) == b"a1"
        assert alice.decrypt(bob.encrypt(b"b1")) == b"b1"
        fresh = alice.encrypt(b"a2")

        assert bob.decrypt(fresh) == b"a2"
        with pytest.raises(AuthenticationFailed):
            stale.decrypt(fresh)

    def test_skipped_key_is_dropped_once_used(self) -> None:
        alice, bob = _pair()
        wires = [alice.encrypt(f"m{i}".encode()) for i in range(3)]
        assert bob.decrypt(wires[2]) == b"m2"
        assert bob.decrypt(wires[0]) == b"m0"
        with pytest.raises(AuthenticationFailed):
            bob.decrypt(wires[0])
