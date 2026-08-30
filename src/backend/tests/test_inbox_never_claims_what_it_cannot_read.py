"""Вузол не каже «прийнято» тому, чого не зміг прочитати.

Знайдено 30.08.2026 на двох живих вузлах. Маршрут `/messenger/inbox` мав
умову `... and not matching_contacts`, тобто помилку розшифрування він ковтав
саме тоді, коли **відправник відомий** — у звичайному випадку між двома
людьми, — і повертав `{"accepted": True}` з кодом 200.

Виміряно: той самий нечитабельний кадр
  * від НЕВІДОМОГО відправника → **400** із чесною причиною;
  * від ВІДОМОГО контакту      → **200 «прийнято»**.

Наслідок наскрізний: відправник по 200 ставив листу «надіслано», отримувач не
заводив ані розмови, ані рядка, у журнал не писалось нічого. **Лист зникав, і
жодна зі сторін не мала способу про це дізнатись.**

Це та сама хвороба, що й решта знайденого за добу, але в найдорожчому місці:
не «інтерфейс не показав стану», а **сам протокол підтвердив доставку того,
чого не отримав**.

Межа, яку тест тримає окремо: порожній результат БЕЗ помилки лишається
успіхом. Службовий `delete` на те, чого в нас не було, і кадр про невідому
групу — це прочитані кадри, після яких свідомо немає рядка. Плутати їх із
нечитабельним кадром не можна: перше — виконано, друге — втрачено.
"""
from __future__ import annotations

import pytest

API = "/api/v1/messenger"
#: Не кадр PHANTOM: будь-які байти, які сесія розібрати не може.
GARBAGE = "de" * 200


def _identity(client) -> dict:
    response = client.get(f"{API}/identity")
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.anyio
async def test_unreadable_frame_from_a_stranger_is_refused(auth_root_client, unauth_client):
    """Базова лінія: від незнайомця вузол уже відмовляв правильно."""
    response = unauth_client.post(
        f"{API}/inbox",
        json={"frame": GARBAGE, "from_node_id": "0" * 32, "reply_address": ""},
    )
    assert response.status_code == 400, response.text


@pytest.mark.anyio
async def test_unreadable_frame_from_a_known_contact_is_also_refused(
    auth_root_client, unauth_client
):
    """Головний тест: знайомство відправника НЕ робить кадр прочитаним.

    Саме тут вузол казав «прийнято» — і саме тут лист зникав.
    """
    from messenger.crypto.keys import KeyStore

    peer = KeyStore.generate(one_time_count=4)
    added = auth_root_client.post(
        f"{API}/contacts",
        json={
            "display_name": "Знайомий",
            "bundle": peer.publish_bundle().to_dict(),
            "peer_address": "http://127.0.0.1:9",
        },
    )
    assert added.status_code == 201, added.text
    peer_node_id = added.json()["peer_node_id"]

    response = unauth_client.post(
        f"{API}/inbox",
        json={"frame": GARBAGE, "from_node_id": peer_node_id, "reply_address": ""},
    )

    # До правки тут було 200 {"accepted": true} — тобто підтвердження
    # доставки того, чого вузол не прочитав.
    assert response.status_code == 400, (
        "вузол підтвердив прийом нечитабельного кадру лише тому, що знає "
        f"відправника: {response.status_code} {response.text}"
    )
    assert response.json()["detail"], "відмова мусить нести причину"


@pytest.mark.anyio
async def test_the_answer_does_not_depend_on_knowing_the_sender(
    auth_root_client, unauth_client
):
    """Один і той самий кадр — одна й та сама відповідь.

    Різниця у відповіді за ознакою «чи знаємо ми відправника» була б ще й
    підказкою чужому: 200 проти 400 казало б, що цей вузол має контакт із
    таким `from_node_id`.
    """
    from messenger.crypto.keys import KeyStore

    peer = KeyStore.generate(one_time_count=4)
    known = auth_root_client.post(
        f"{API}/contacts",
        json={
            "display_name": "Ще один знайомий",
            "bundle": peer.publish_bundle().to_dict(),
            "peer_address": "http://127.0.0.1:9",
        },
    ).json()["peer_node_id"]

    from_known = unauth_client.post(
        f"{API}/inbox", json={"frame": GARBAGE, "from_node_id": known, "reply_address": ""}
    )
    from_stranger = unauth_client.post(
        f"{API}/inbox", json={"frame": GARBAGE, "from_node_id": "f" * 32, "reply_address": ""}
    )

    assert from_known.status_code == from_stranger.status_code
