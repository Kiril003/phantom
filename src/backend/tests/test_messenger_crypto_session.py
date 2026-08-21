"""Наскрізний обмін: X3DH + Double Ratchet через фасад Session.

Тести не піднімають застосунок — тільки messenger.crypto.
"""
from __future__ import annotations

import os

import pytest

from messenger.crypto.keys import (
    KeyStore,
    PreKeyUnavailable,
    PublicBundle,
    UntrustedBundle,
)
from messenger.crypto.ratchet import AuthenticationFailed, RatchetError
from messenger.crypto.session import (
    MAGIC,
    PREAMBLE_LEN,
    TYPE_MESSAGE,
    TYPE_PREKEY,
    Session,
    SessionError,
)
from messenger.crypto.x3dh import X3DHError

_PREFIX = len(MAGIC) + 1


def _connect(
    with_one_time: bool = True,
) -> tuple[KeyStore, KeyStore, Session, Session]:
    """Аліса ініціює, Боб приймає. Повертає обидві сесії вже після першого кадру."""
    alice_store = KeyStore.generate(one_time_count=4)
    bob_store = KeyStore.generate(one_time_count=4)
    bundle = bob_store.publish_bundle(with_one_time=with_one_time)
    alice = Session.initiate(alice_store, bundle, expected_node_id=bob_store.node_id)
    bob, first = Session.accept(bob_store, alice.encrypt(b"__hello__"))
    assert first == b"__hello__"
    return alice_store, bob_store, alice, bob


def _flip(raw: bytes, index: int) -> bytes:
    blob = bytearray(raw)
    blob[index] ^= 0x01
    return bytes(blob)


class TestHandshake:
    def test_first_message_opens_the_session(self) -> None:
        alice_store, bob_store, alice, bob = _connect()
        assert bob.peer_node_id != alice.peer_node_id
        assert bob.peer_identity_ed == alice_store.identity_ed_public
        assert alice.peer_identity_ed == bob_store.identity_ed_public
        assert bob.established is True

    def test_both_directions(self) -> None:
        _, _, alice, bob = _connect()
        assert bob.decrypt(alice.encrypt("від Аліси".encode())) == "від Аліси".encode()
        assert alice.decrypt(bob.encrypt("від Боба".encode())) == "від Боба".encode()

    def test_long_conversation(self) -> None:
        _, _, alice, bob = _connect()
        for i in range(20):
            payload = f"а-{i}".encode()
            assert bob.decrypt(alice.encrypt(payload)) == payload
            payload = f"б-{i}".encode()
            assert alice.decrypt(bob.encrypt(payload)) == payload

    def test_works_without_a_one_time_prekey(self) -> None:
        _, _, alice, bob = _connect(with_one_time=False)
        assert bob.decrypt(alice.encrypt("без OPK".encode())) == "без OPK".encode()
        assert alice.decrypt(bob.encrypt("теж без OPK".encode())) == "теж без OPK".encode()

    def test_unicode_and_binary_payloads(self) -> None:
        _, _, alice, bob = _connect()
        for payload in (
            "Привіт, світе — 🔐\n\tкінець".encode(),
            b"",
            bytes(range(256)),
            os.urandom(200_000),
        ):
            assert bob.decrypt(alice.encrypt(payload)) == payload

    def test_two_peers_get_independent_sessions(self) -> None:
        alice_store = KeyStore.generate()
        bob_store = KeyStore.generate()
        carol_store = KeyStore.generate()
        to_bob = Session.initiate(alice_store, bob_store.publish_bundle())
        to_carol = Session.initiate(alice_store, carol_store.publish_bundle())

        for_bob = to_bob.encrypt("тільки Бобу".encode())
        bob, plaintext = Session.accept(bob_store, for_bob)
        assert plaintext == "тільки Бобу".encode()
        with pytest.raises((AuthenticationFailed, X3DHError, PreKeyUnavailable)):
            Session.accept(carol_store, for_bob)
        carol, plaintext = Session.accept(carol_store, to_carol.encrypt("тільки Керол".encode()))
        assert plaintext == "тільки Керол".encode()
        assert carol.peer_node_id == bob.peer_node_id  # обидві сесії від Аліси

    def test_peer_node_id_is_the_node_address(self) -> None:
        alice_store, bob_store, alice, bob = _connect()
        assert alice.peer_node_id == bob_store.node_id
        assert bob.peer_node_id == alice_store.node_id

    def test_string_input_rejected(self) -> None:
        _, _, alice, _ = _connect()
        with pytest.raises(TypeError):
            alice.encrypt("рядок")  # type: ignore[arg-type]

    def test_responder_can_reply_immediately(self) -> None:
        _, _, alice, bob = _connect()
        assert alice.decrypt(bob.encrypt("одразу".encode())) == "одразу".encode()


class TestWireFormat:
    def test_frame_is_magic_tagged(self) -> None:
        _, _, alice, _ = _connect()
        wire = alice.encrypt(b"x")
        assert wire[: len(MAGIC)] == MAGIC

    def test_prekey_preamble_rides_until_acknowledged(self) -> None:
        """Поки Аліса не почула Боба, вона не знає, чи він звів сесію."""
        alice_store = KeyStore.generate()
        bob_store = KeyStore.generate()
        alice = Session.initiate(alice_store, bob_store.publish_bundle())
        bob, _ = Session.accept(bob_store, alice.encrypt("перше".encode()))

        second = alice.encrypt("друге".encode())
        assert second[len(MAGIC)] == TYPE_PREKEY
        assert alice.established is False
        assert bob.decrypt(second) == "друге".encode()

        alice.decrypt(bob.encrypt("чую".encode()))
        third = alice.encrypt("третє".encode())
        assert third[len(MAGIC)] == TYPE_MESSAGE
        assert alice.established is True
        assert bob.decrypt(third) == "третє".encode()

    def test_ciphertext_does_not_leak_plaintext(self) -> None:
        _, _, alice, _ = _connect()
        secret = b"CARD-4111-1111-1111-1111"
        wire = alice.encrypt(secret)
        assert secret not in wire

    def test_unknown_magic_rejected(self) -> None:
        _, _, alice, bob = _connect()
        wire = alice.encrypt(b"x")
        with pytest.raises(SessionError):
            bob.decrypt(b"XXXX" + wire[len(MAGIC):])

    def test_unknown_frame_type_rejected(self) -> None:
        _, _, alice, bob = _connect()
        wire = alice.encrypt(b"x")
        with pytest.raises(SessionError):
            bob.decrypt(wire[: len(MAGIC)] + b"\x7f" + wire[_PREFIX:])

    def test_truncated_preamble_rejected(self) -> None:
        alice_store = KeyStore.generate()
        bob_store = KeyStore.generate()
        alice = Session.initiate(alice_store, bob_store.publish_bundle())
        wire = alice.encrypt("перше".encode())
        with pytest.raises(SessionError):
            Session.accept(bob_store, wire[: _PREFIX + PREAMBLE_LEN - 10])

    def test_session_must_start_with_a_prekey_frame(self) -> None:
        _, bob_store, alice, bob = _connect()
        alice.decrypt(bob.encrypt(b"ack"))
        plain_frame = alice.encrypt("звичайний кадр".encode())
        assert plain_frame[len(MAGIC)] == TYPE_MESSAGE
        with pytest.raises(SessionError):
            Session.accept(bob_store, plain_frame)

    def test_non_bytes_frame_rejected(self) -> None:
        _, _, _, bob = _connect()
        with pytest.raises(TypeError):
            bob.decrypt("не байти")  # type: ignore[arg-type]


class TestOutOfOrderAndLoss:
    def test_shuffled_delivery(self) -> None:
        _, _, alice, bob = _connect()
        wires = [alice.encrypt(f"m{i}".encode()) for i in range(6)]
        for i in (3, 0, 5, 1, 4, 2):
            assert bob.decrypt(wires[i]) == f"m{i}".encode()

    def test_lost_message_does_not_stall_the_conversation(self) -> None:
        _, _, alice, bob = _connect()
        wires = [alice.encrypt(f"m{i}".encode()) for i in range(4)]
        del wires[1]  # мережа з'їла кадр назавжди
        for wire, expected in zip(wires, (b"m0", b"m2", b"m3")):
            assert bob.decrypt(wire) == expected
        assert alice.decrypt(bob.encrypt("розмова триває".encode())) == "розмова триває".encode()

    def test_late_message_from_the_previous_epoch(self) -> None:
        _, _, alice, bob = _connect()
        early = alice.encrypt("рано відправлено".encode())
        assert alice.decrypt(bob.encrypt("хід Боба".encode())) == "хід Боба".encode()
        fresh = alice.encrypt("нова епоха".encode())

        assert bob.decrypt(fresh) == "нова епоха".encode()
        assert bob.decrypt(early) == "рано відправлено".encode()

    def test_reply_lost_then_recovered(self) -> None:
        _, _, alice, bob = _connect()
        bob.encrypt("втрачена відповідь".encode())
        assert alice.decrypt(bob.encrypt("друга спроба".encode())) == "друга спроба".encode()


class TestKeySubstitution:
    def test_substituted_identity_dh_in_bundle_is_detected(self) -> None:
        alice_store = KeyStore.generate()
        bob_store = KeyStore.generate()
        mallory = KeyStore.generate()
        real = bob_store.publish_bundle()
        forged = PublicBundle(
            identity_ed=real.identity_ed,
            identity_dh=mallory.identity_dh_public,
            identity_dh_sig=real.identity_dh_sig,
            signed_prekey_id=real.signed_prekey_id,
            signed_prekey=real.signed_prekey,
            signed_prekey_sig=real.signed_prekey_sig,
        )
        with pytest.raises(UntrustedBundle):
            Session.initiate(alice_store, forged)

    def test_substituted_signed_prekey_in_bundle_is_detected(self) -> None:
        alice_store = KeyStore.generate()
        bob_store = KeyStore.generate()
        mallory = KeyStore.generate().publish_bundle()
        real = bob_store.publish_bundle()
        forged = PublicBundle(
            identity_ed=real.identity_ed,
            identity_dh=real.identity_dh,
            identity_dh_sig=real.identity_dh_sig,
            signed_prekey_id=real.signed_prekey_id,
            signed_prekey=mallory.signed_prekey,
            signed_prekey_sig=real.signed_prekey_sig,
        )
        with pytest.raises(UntrustedBundle):
            Session.initiate(alice_store, forged)

    def test_whole_bundle_swap_is_caught_by_the_node_id_pin(self) -> None:
        """Ретранслятор підсунув bundle власного вузла замість Бобового."""
        alice_store = KeyStore.generate()
        bob_store = KeyStore.generate()
        mallory_store = KeyStore.generate()
        with pytest.raises(UntrustedBundle):
            Session.initiate(
                alice_store,
                mallory_store.publish_bundle(),
                expected_node_id=bob_store.node_id,
            )

    def test_forged_identity_in_the_preamble_is_detected(self) -> None:
        """Аліса підписує свій DH-ключ; підміна Ed25519 у преамбулі не проходить."""
        alice_store = KeyStore.generate()
        bob_store = KeyStore.generate()
        mallory = KeyStore.generate()
        alice = Session.initiate(alice_store, bob_store.publish_bundle())
        wire = bytearray(alice.encrypt("перше".encode()))
        wire[_PREFIX:_PREFIX + 32] = mallory.identity_ed_public
        with pytest.raises(X3DHError):
            Session.accept(bob_store, bytes(wire))

    def test_forged_ephemeral_in_the_preamble_is_detected(self) -> None:
        alice_store = KeyStore.generate()
        bob_store = KeyStore.generate()
        mallory = KeyStore.generate()
        alice = Session.initiate(alice_store, bob_store.publish_bundle())
        wire = bytearray(alice.encrypt("перше".encode()))
        start = _PREFIX + 32 + 32 + 64
        wire[start:start + 32] = mallory.identity_dh_public
        with pytest.raises(AuthenticationFailed):
            Session.accept(bob_store, bytes(wire))

    def test_preamble_swapped_on_a_later_frame_is_detected(self) -> None:
        """AAD накриває преамбулу, тож підмінити її на льоту не вийде."""
        alice_store = KeyStore.generate()
        bob_store = KeyStore.generate()
        mallory_store = KeyStore.generate()
        alice = Session.initiate(alice_store, bob_store.publish_bundle())
        bob, _ = Session.accept(bob_store, alice.encrypt("перше".encode()))

        mallory = Session.initiate(mallory_store, bob_store.publish_bundle())
        mallory_preamble = mallory.encrypt(b"x")[_PREFIX:_PREFIX + PREAMBLE_LEN]
        second = alice.encrypt("друге".encode())
        forged = second[:_PREFIX] + mallory_preamble + second[_PREFIX + PREAMBLE_LEN:]
        with pytest.raises(SessionError):
            bob.decrypt(forged)
        assert bob.decrypt(second) == "друге".encode()

    def test_stripped_preamble_is_detected(self) -> None:
        alice_store = KeyStore.generate()
        bob_store = KeyStore.generate()
        alice = Session.initiate(alice_store, bob_store.publish_bundle())
        bob, _ = Session.accept(bob_store, alice.encrypt("перше".encode()))
        second = alice.encrypt("друге".encode())
        stripped = (
            second[: len(MAGIC)]
            + bytes([TYPE_MESSAGE])
            + second[_PREFIX + PREAMBLE_LEN:]
        )
        with pytest.raises(AuthenticationFailed):
            bob.decrypt(stripped)

    def test_tampered_ciphertext_is_detected(self) -> None:
        _, _, alice, bob = _connect()
        wire = alice.encrypt("переказати 100".encode())
        with pytest.raises(AuthenticationFailed):
            bob.decrypt(_flip(wire, len(wire) - 1))

    def test_forgery_does_not_kill_the_session(self) -> None:
        _, _, alice, bob = _connect()
        good = alice.encrypt("справжнє".encode())
        with pytest.raises(AuthenticationFailed):
            bob.decrypt(_flip(good, len(good) - 3))
        assert bob.decrypt(good) == "справжнє".encode()

    def test_one_time_prekey_is_burned_after_use(self) -> None:
        """Повтор першого кадру не має відкрити сесію вдруге."""
        alice_store = KeyStore.generate(one_time_count=2)
        bob_store = KeyStore.generate(one_time_count=2)
        alice = Session.initiate(alice_store, bob_store.publish_bundle())
        first = alice.encrypt("перше".encode())
        Session.accept(bob_store, first)
        with pytest.raises(PreKeyUnavailable):
            Session.accept(bob_store, first)

    def test_failed_first_frame_does_not_burn_the_prekey(self) -> None:
        """Спалений на підробці prekey — це безкоштовний DoS на новий контакт."""
        alice_store = KeyStore.generate()
        bob_store = KeyStore.generate(one_time_count=2)
        bundle = bob_store.publish_bundle()
        alice = Session.initiate(alice_store, bundle)
        first = alice.encrypt("перше".encode())
        with pytest.raises(AuthenticationFailed):
            Session.accept(bob_store, _flip(first, len(first) - 1))
        bob, plaintext = Session.accept(bob_store, first)
        assert plaintext == "перше".encode()


class TestForwardSecrecy:
    def test_replayed_frame_is_rejected(self) -> None:
        _, _, alice, bob = _connect()
        wire = alice.encrypt("один раз".encode())
        assert bob.decrypt(wire) == "один раз".encode()
        with pytest.raises(AuthenticationFailed):
            bob.decrypt(wire)

    def test_captured_state_cannot_read_earlier_messages(self) -> None:
        _, _, alice, bob = _connect()
        history = [alice.encrypt(f"старе-{i}".encode()) for i in range(4)]
        for i, wire in enumerate(history):
            assert bob.decrypt(wire) == f"старе-{i}".encode()

        stolen = Session(
            bob._ratchet.snapshot(), bob.peer_identity_ed, bob._peer_identity_dh
        )
        for wire in history:
            with pytest.raises(AuthenticationFailed):
                stolen.decrypt(wire)

    def test_stale_state_cannot_read_a_later_epoch(self) -> None:
        _, _, alice, bob = _connect()
        stale = Session(
            bob._ratchet.snapshot(), bob.peer_identity_ed, bob._peer_identity_dh
        )
        for _ in range(2):
            assert alice.decrypt(bob.encrypt("хід Боба".encode())) == "хід Боба".encode()
            assert bob.decrypt(alice.encrypt("хід Аліси".encode())) == "хід Аліси".encode()
        fresh = alice.encrypt("нове повідомлення".encode())

        assert bob.decrypt(fresh) == "нове повідомлення".encode()
        with pytest.raises(AuthenticationFailed):
            stale.decrypt(fresh)

    def test_repeated_plaintext_never_repeats_on_the_wire(self) -> None:
        _, _, alice, _ = _connect()
        assert len({alice.encrypt("так".encode()) for _ in range(20)}) == 20


class TestUnimplementedSurface:
    def test_session_persistence_is_explicitly_absent(self) -> None:
        _, _, alice, _ = _connect()
        with pytest.raises(NotImplementedError):
            alice.serialize()
        with pytest.raises(NotImplementedError):
            Session.restore(b"")

    def test_responder_without_a_received_frame_cannot_encrypt(self) -> None:
        from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey

        from messenger.crypto.ratchet import DoubleRatchet

        ratchet = DoubleRatchet.for_responder(
            os.urandom(32), X25519PrivateKey.generate(), b"ad"
        )
        session = Session(ratchet, b"\x00" * 32, b"\x00" * 32)
        with pytest.raises(RatchetError):
            session.encrypt("передчасно".encode())
