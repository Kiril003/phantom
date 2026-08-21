"""Контакт — це ключі співрозмовника і число, яке звіряють голосом."""
from __future__ import annotations

import pytest

from messenger.crypto.keys import KeyStore


def _peer_bundle() -> dict:
    """Bundle «іншого вузла» — те, що прилетить по QR або з рук у руки."""
    return KeyStore.generate(one_time_count=4).publish_bundle().to_dict()


@pytest.mark.anyio
async def test_identity_gives_a_shareable_bundle(auth_root_client):
    body = auth_root_client.get("/api/v1/messenger/identity").json()

    assert len(body["node_id"]) > 0
    assert set(body["bundle"]) >= {"identity_ed", "identity_dh", "signed_prekey", "node_id"}
    # Приватних частин у тому, чим діляться, бути не може.
    assert "private" not in str(body["bundle"]).lower()


@pytest.mark.anyio
async def test_adding_a_contact_establishes_a_session(auth_root_client):
    resp = auth_root_client.post(
        "/api/v1/messenger/contacts",
        json={"display_name": "Марта", "bundle": _peer_bundle()},
    )

    assert resp.status_code == 201
    contact = resp.json()
    assert contact["session_ready"] is True
    # Підпис у bundle не робить людину перевіреною — це вирішує звірка числа.
    assert contact["verified"] is False
    assert len(contact["safety_number"]) == 60
    assert len(contact["safety_number_pretty"].split()) == 12


@pytest.mark.anyio
async def test_forged_bundle_is_rejected(auth_root_client):
    broken = _peer_bundle()
    # Псуємо підпис identity-DH: саме він привʼязує DH-ключ до Ed25519 вузла.
    broken["identity_dh_sig"] = "00" * 64

    resp = auth_root_client.post(
        "/api/v1/messenger/contacts",
        json={"display_name": "Хтось", "bundle": broken},
    )

    assert resp.status_code == 400


@pytest.mark.anyio
async def test_adding_the_same_peer_twice_does_not_duplicate(auth_root_client):
    bundle = _peer_bundle()
    first = auth_root_client.post(
        "/api/v1/messenger/contacts", json={"display_name": "Марта", "bundle": bundle}
    ).json()
    second = auth_root_client.post(
        "/api/v1/messenger/contacts", json={"display_name": "Марта", "bundle": bundle}
    ).json()

    assert first["id"] == second["id"]


@pytest.mark.anyio
async def test_verification_is_an_explicit_act(auth_root_client):
    contact = auth_root_client.post(
        "/api/v1/messenger/contacts",
        json={"display_name": "Олексій", "bundle": _peer_bundle()},
    ).json()
    assert contact["verified"] is False

    after = auth_root_client.post(
        f"/api/v1/messenger/contacts/{contact['id']}/verify"
    ).json()

    assert after["verified"] is True


@pytest.mark.anyio
async def test_foreign_contact_cannot_be_verified(auth_root_client, auth_operator_client):
    contact = auth_root_client.post(
        "/api/v1/messenger/contacts",
        json={"display_name": "Приватний", "bundle": _peer_bundle()},
    ).json()

    resp = auth_operator_client.post(
        f"/api/v1/messenger/contacts/{contact['id']}/verify"
    )

    assert resp.status_code == 404
