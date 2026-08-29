"""Ключі месенджера: bundle, підписи, одноразові prekeys.

Тести не піднімають застосунок — тільки messenger.crypto.
"""
from __future__ import annotations

import hashlib
import json

import pytest

from messenger.crypto.keys import (
    BUNDLE_VERSION,
    IDENTITY_DH_CONTEXT,
    KeyStore,
    MessengerKeyError,
    PreKeyUnavailable,
    PublicBundle,
    UntrustedBundle,
    signed_prekey_payload,
)


def _flip(raw: bytes, index: int = 0) -> bytes:
    blob = bytearray(raw)
    blob[index] ^= 0x01
    return bytes(blob)


class TestBundleSerialization:
    def test_json_round_trip(self) -> None:
        bundle = KeyStore.generate(one_time_count=2).publish_bundle()
        restored = PublicBundle.from_json(bundle.to_json())
        assert restored == bundle
        restored.verify()

    def test_json_carries_no_private_material(self) -> None:
        store = KeyStore.generate(one_time_count=1)
        blob = store.publish_bundle().to_json()
        private_raw = store.identity_dh_private.private_bytes_raw()
        assert private_raw.hex() not in blob
        import base64

        assert base64.b64encode(private_raw).decode() not in blob

    def test_bundle_without_one_time_prekey(self) -> None:
        bundle = KeyStore.generate().publish_bundle(with_one_time=False)
        assert bundle.one_time_prekey is None
        assert bundle.one_time_prekey_id is None
        bundle.verify()
        assert PublicBundle.from_json(bundle.to_json()) == bundle

    def test_unknown_version_rejected(self) -> None:
        data = KeyStore.generate().publish_bundle().to_dict()
        data["v"] = BUNDLE_VERSION + 1
        with pytest.raises(UntrustedBundle):
            PublicBundle.from_dict(data)

    def test_missing_field_rejected(self) -> None:
        data = KeyStore.generate().publish_bundle().to_dict()
        del data["identity_dh_sig"]
        with pytest.raises(UntrustedBundle):
            PublicBundle.from_dict(data)

    def test_non_base64_field_rejected(self) -> None:
        data = KeyStore.generate().publish_bundle().to_dict()
        data["identity_dh"] = "не base64!!"
        with pytest.raises(UntrustedBundle):
            PublicBundle.from_dict(data)

    def test_garbage_json_rejected(self) -> None:
        with pytest.raises(UntrustedBundle):
            PublicBundle.from_json("{not json")

    def test_node_id_matches_node_identity_formula(self) -> None:
        store = KeyStore.generate()
        expected = hashlib.sha256(store.identity_ed_public).hexdigest()[:32]
        assert store.node_id == expected
        assert store.publish_bundle().node_id == expected

    def test_dict_declares_node_id(self) -> None:
        bundle = KeyStore.generate().publish_bundle()
        assert json.loads(bundle.to_json())["node_id"] == bundle.node_id


class TestBundleVerification:
    def test_fresh_bundle_verifies(self) -> None:
        store = KeyStore.generate()
        store.publish_bundle().verify(expected_node_id=store.node_id)

    def test_swapped_identity_dh_is_detected(self) -> None:
        """Класичний MITM: чужий DH-ключ під тим самим Ed25519."""
        victim = KeyStore.generate().publish_bundle()
        attacker = KeyStore.generate()
        forged = PublicBundle(
            identity_ed=victim.identity_ed,
            identity_dh=attacker.identity_dh_public,
            identity_dh_sig=victim.identity_dh_sig,
            signed_prekey_id=victim.signed_prekey_id,
            signed_prekey=victim.signed_prekey,
            signed_prekey_sig=victim.signed_prekey_sig,
        )
        with pytest.raises(UntrustedBundle):
            forged.verify()

    def test_swapped_signed_prekey_is_detected(self) -> None:
        victim = KeyStore.generate().publish_bundle()
        attacker = KeyStore.generate().publish_bundle()
        forged = PublicBundle(
            identity_ed=victim.identity_ed,
            identity_dh=victim.identity_dh,
            identity_dh_sig=victim.identity_dh_sig,
            signed_prekey_id=victim.signed_prekey_id,
            signed_prekey=attacker.signed_prekey,
            signed_prekey_sig=victim.signed_prekey_sig,
        )
        with pytest.raises(UntrustedBundle):
            forged.verify()

    def test_renumbered_signed_prekey_is_detected(self) -> None:
        """Номер входить у підпис, тож prekey не можна перенумерувати."""
        victim = KeyStore.generate().publish_bundle()
        forged = PublicBundle(
            identity_ed=victim.identity_ed,
            identity_dh=victim.identity_dh,
            identity_dh_sig=victim.identity_dh_sig,
            signed_prekey_id=victim.signed_prekey_id + 7,
            signed_prekey=victim.signed_prekey,
            signed_prekey_sig=victim.signed_prekey_sig,
        )
        with pytest.raises(UntrustedBundle):
            forged.verify()

    def test_flipped_signature_bit_is_detected(self) -> None:
        victim = KeyStore.generate().publish_bundle()
        forged = PublicBundle(
            identity_ed=victim.identity_ed,
            identity_dh=victim.identity_dh,
            identity_dh_sig=_flip(victim.identity_dh_sig),
            signed_prekey_id=victim.signed_prekey_id,
            signed_prekey=victim.signed_prekey,
            signed_prekey_sig=victim.signed_prekey_sig,
        )
        with pytest.raises(UntrustedBundle):
            forged.verify()

    def test_wholesale_attacker_bundle_needs_node_id_pin(self) -> None:
        """Повністю власний bundle зловмисника самоузгоджений — ловить лише node_id."""
        victim = KeyStore.generate()
        attacker = KeyStore.generate()
        forged = attacker.publish_bundle()
        forged.verify()  # підписи сходяться: перевірка підписів тут безсила
        with pytest.raises(UntrustedBundle):
            forged.verify(expected_node_id=victim.node_id)

    def test_truncated_key_rejected(self) -> None:
        victim = KeyStore.generate().publish_bundle()
        forged = PublicBundle(
            identity_ed=victim.identity_ed,
            identity_dh=victim.identity_dh[:16],
            identity_dh_sig=victim.identity_dh_sig,
            signed_prekey_id=victim.signed_prekey_id,
            signed_prekey=victim.signed_prekey,
            signed_prekey_sig=victim.signed_prekey_sig,
        )
        with pytest.raises(UntrustedBundle):
            forged.verify()

    def test_one_time_prekey_without_id_rejected(self) -> None:
        source = KeyStore.generate().publish_bundle()
        forged = PublicBundle(
            identity_ed=source.identity_ed,
            identity_dh=source.identity_dh,
            identity_dh_sig=source.identity_dh_sig,
            signed_prekey_id=source.signed_prekey_id,
            signed_prekey=source.signed_prekey,
            signed_prekey_sig=source.signed_prekey_sig,
            one_time_prekey_id=None,
            one_time_prekey=source.one_time_prekey,
        )
        with pytest.raises(UntrustedBundle):
            forged.verify()

    def test_signature_payload_is_domain_separated(self) -> None:
        """Підпис identity-DH не повинен годитись як підпис signed prekey."""
        store = KeyStore.generate()
        bundle = store.publish_bundle()
        assert IDENTITY_DH_CONTEXT not in signed_prekey_payload(
            bundle.signed_prekey_id, bundle.signed_prekey
        )
        assert bundle.identity_dh_sig != bundle.signed_prekey_sig


class TestPreKeyLifecycle:
    def test_each_published_bundle_takes_a_fresh_one_time_prekey(self) -> None:
        store = KeyStore.generate(one_time_count=4)
        ids = [store.publish_bundle().one_time_prekey_id for _ in range(4)]
        assert len(set(ids)) == 4
        assert None not in ids

    def test_exhausted_one_time_prekeys_degrade_to_none(self) -> None:
        """Кінець запасу — це bundle без OPK, а не мовчазне повторне видавання."""
        store = KeyStore.generate(one_time_count=1)
        first = store.publish_bundle()
        second = store.publish_bundle()
        assert first.one_time_prekey_id is not None
        assert second.one_time_prekey_id is None

    def test_consumed_one_time_prekey_cannot_be_reused(self) -> None:
        store = KeyStore.generate(one_time_count=2)
        bundle = store.publish_bundle()
        key_id = bundle.one_time_prekey_id
        assert key_id is not None
        store.one_time_private(key_id)
        store.consume_one_time(key_id)
        with pytest.raises(PreKeyUnavailable):
            store.one_time_private(key_id)

    def test_unknown_signed_prekey_id_rejected(self) -> None:
        store = KeyStore.generate()
        with pytest.raises(PreKeyUnavailable):
            store.signed_prekey_private(999)

    def test_rotation_keeps_previous_signed_prekey_usable(self) -> None:
        """Сесії, погоджені на старий prekey, ще в польоті — ключ не викидаємо."""
        store = KeyStore.generate()
        old_id = store.publish_bundle().signed_prekey_id
        store.rotate_signed_prekey()
        new_id = store.publish_bundle().signed_prekey_id
        assert new_id != old_id
        assert store.signed_prekey_private(old_id) is not None
        assert store.signed_prekey_private(new_id) is not None

    def test_rotated_prekey_is_signed_by_the_same_identity(self) -> None:
        store = KeyStore.generate()
        store.rotate_signed_prekey()
        store.publish_bundle().verify(expected_node_id=store.node_id)

    def test_generated_prekeys_are_distinct(self) -> None:
        store = KeyStore.generate(one_time_count=0)
        store.generate_one_time_prekeys(16)
        publics = {
            store.one_time_private(i).public_key().public_bytes_raw()
            for i in range(1, 17)
        }
        assert len(publics) == 16


# ── Prekey-набір мусить пережити рестарт ─────────────────────────────────────


def test_prekeys_survive_a_restart(tmp_path):
    """Після рестарту вузол мусить уміти прочитати того, хто пише йому вперше."""
    from messenger.crypto.session import Session

    bob = KeyStore.generate(one_time_count=4)
    bundle = bob.publish_bundle()
    path = tmp_path / "prekeys.bin"
    bob.persist_prekeys(path)

    alice = KeyStore.generate()
    wire = Session.initiate(alice, bundle).encrypt(b"first contact")

    # Новий процес: ті самі identity-ключі, але prekey-набір ще порожній.
    revived = KeyStore(bob._ed, identity_dh=bob._identity_dh, one_time_count=0)
    revived.restore_prekeys(path)

    _, plaintext = Session.accept(revived, wire)
    assert plaintext == b"first contact"


def test_issued_one_time_prekeys_are_not_reused_after_restart(tmp_path):
    bob = KeyStore.generate(one_time_count=2)
    first = bob.publish_bundle()
    path = tmp_path / "prekeys.bin"
    bob.persist_prekeys(path)

    revived = KeyStore(bob._ed, identity_dh=bob._identity_dh, one_time_count=0)
    revived.restore_prekeys(path)

    # Той самий одноразовий ключ не має піти двом різним співрозмовникам.
    assert revived.publish_bundle().one_time_prekey_id != first.one_time_prekey_id


def test_prekey_file_is_unreadable_without_the_node_key(tmp_path):
    bob = KeyStore.generate(one_time_count=2)
    path = tmp_path / "prekeys.bin"
    bob.persist_prekeys(path)

    with pytest.raises(MessengerKeyError):
        KeyStore.generate().restore_prekeys(path)


def test_prekey_file_does_not_hold_private_keys_in_the_clear(tmp_path):
    bob = KeyStore.generate(one_time_count=2)
    secret = bob.signed_prekey_private(bob.publish_bundle().signed_prekey_id)
    path = tmp_path / "prekeys.bin"
    bob.persist_prekeys(path)

    assert secret.private_bytes_raw() not in path.read_bytes()
