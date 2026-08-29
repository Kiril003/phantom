"""Ключі, які вузол уже роздав, мусять пережити його перезапуск.

Це не абстракція: вузол публікує bundle, людина зберігає його в себе і пише
через день. Якщо після рестарту приватні частини втрачені — вона отримає
відмову, не розуміючи чому.
"""
from __future__ import annotations

import pytest

from messenger.crypto.keys import KeyStore
from messenger.crypto.session import Session


def test_bundle_taken_before_a_restart_still_works(tmp_path):
    node = KeyStore.generate(one_time_count=4)
    bundle = node.publish_bundle()
    store_path = tmp_path / "prekeys.bin"
    node.persist_prekeys(store_path)

    # «Наступний запуск»: identity ті самі, prekey ще не згенеровані.
    revived = KeyStore(node._ed, identity_dh=node._identity_dh, one_time_count=0)
    revived.restore_prekeys(store_path)

    frame = Session.initiate(KeyStore.generate(one_time_count=2), bundle).encrypt(b"later")
    _, plaintext = Session.accept(revived, frame)

    assert plaintext == b"later"


def test_a_restart_does_not_hand_the_same_one_time_key_twice(tmp_path):
    node = KeyStore.generate(one_time_count=4)
    store_path = tmp_path / "prekeys.bin"

    first = node.publish_bundle()
    node.persist_prekeys(store_path)

    revived = KeyStore(node._ed, identity_dh=node._identity_dh, one_time_count=0)
    revived.restore_prekeys(store_path)
    second = revived.publish_bundle()

    assert first.one_time_prekey_id != second.one_time_prekey_id


def test_losing_the_prekey_file_does_not_kill_established_sessions(tmp_path):
    """Втрата набору боляча для нових контактів, але не для вже початих розмов."""
    node = KeyStore.generate(one_time_count=4)
    peer = KeyStore.generate(one_time_count=4)
    peer_session = Session.initiate(peer, node.publish_bundle())
    node_session, _ = Session.accept(node, peer_session.encrypt(b"hello"))
    blob = node_session.serialize(node)

    # Файл prekey зник, але identity лишились — сесія відновлюється.
    revived_identity = KeyStore(node._ed, identity_dh=node._identity_dh, one_time_count=0)
    revived_session = Session.restore(revived_identity, blob)

    assert revived_session.decrypt(peer_session.encrypt(b"still here")) == b"still here"
