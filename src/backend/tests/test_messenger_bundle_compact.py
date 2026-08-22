"""Ключ мусить влазити в QR, який телефон бере з першого разу."""
from __future__ import annotations

import pytest

from messenger.crypto.keys import KeyStore, PublicBundle, UntrustedBundle


def test_compact_is_much_shorter_than_json():
    bundle = KeyStore.generate(one_time_count=2).publish_bundle()

    compact = bundle.to_compact()

    assert len(compact) < len(bundle.to_json()) / 1.5


def test_round_trip_keeps_every_field():
    bundle = KeyStore.generate(one_time_count=2).publish_bundle()

    back = PublicBundle.from_compact(bundle.to_compact())

    assert back.to_dict() == bundle.to_dict()
    back.verify(expected_node_id=bundle.node_id)


def test_round_trip_without_a_one_time_key():
    bundle = KeyStore.generate(one_time_count=1).publish_bundle(with_one_time=False)

    back = PublicBundle.from_compact(bundle.to_compact())

    assert back.one_time_prekey is None
    assert back.to_dict() == bundle.to_dict()


def test_a_truncated_key_is_refused():
    compact = KeyStore.generate(one_time_count=2).publish_bundle().to_compact()

    with pytest.raises(UntrustedBundle):
        PublicBundle.from_compact(compact[: len(compact) // 2])


def test_garbage_is_refused():
    with pytest.raises(UntrustedBundle):
        PublicBundle.from_compact("це точно не ключ")
    with pytest.raises(UntrustedBundle):
        PublicBundle.from_compact("")


def test_a_tampered_key_fails_verification_not_parsing():
    """Розібрати підроблений ключ можна — довіритись йому не можна."""
    bundle = KeyStore.generate(one_time_count=2).publish_bundle()
    other = KeyStore.generate(one_time_count=2).publish_bundle()
    forged = PublicBundle(
        identity_ed=bundle.identity_ed,
        identity_dh=other.identity_dh,
        identity_dh_sig=bundle.identity_dh_sig,
        signed_prekey_id=bundle.signed_prekey_id,
        signed_prekey=bundle.signed_prekey,
        signed_prekey_sig=bundle.signed_prekey_sig,
    )

    parsed = PublicBundle.from_compact(forged.to_compact())
    with pytest.raises(UntrustedBundle):
        parsed.verify()
