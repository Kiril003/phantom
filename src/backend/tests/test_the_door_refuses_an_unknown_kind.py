"""Двері мусять ВІДМОВИТИ невідомому типу, а не впасти разом із ним.

Сусідній сторож `test_unknown_frame_kind_says_so.py` доводить НУТРОЩІ:
`wrap_frame` кидає `ValueError` на тип поза `WIRE_KINDS`. Але двері про це не
знали. `MessageIn.kind` був вільним рядком (`kind: str = "text"`), `try`
навколо `prepare_frame` ловив лише `OutboxError`, а глобального обробника
`ValueError` у `main.py` немає. Тож автентифікований клієнт, що слав
`{"kind":"poll"}` у розмову з людиною, діставав **500** — поломку вузла
замість «такого не приймаю».

І це наслідок появи самого сторожа. Доти `wrap_frame` мовчки випускав будь-що
на дріт: вада не зникала, вона просто жила на ЧУЖОМУ екрані. Сторож переніс її
до нас — і саме тут її треба було дочинити, а не лишити у вигляді 500.

Ліки стоять на ВХОДІ, а не в `except`: `MessageIn.kind: Literal[WIRE_KINDS]`.
Відмова приходить від СХЕМИ — до першої дії обробника й до першого запису в
базу. Перелік береться звідти ж, звідки його читає дріт, а не копіюється:
копія розійшлася б із дротом тихо, і в день додавання типу схема мовчки
відкидала б справжній кадр.

Чому клієнт стенда тут свій. `TestClient` за замовчуванням ПЕРЕКИДАЄ виняток
обробника в тест замість того, щоб віддати відповідь, — тобто ховає рівно те,
що ми доводимо: що бачить справжній клієнт по той бік uvicorn. З
`raise_server_exceptions=False` межа поводиться як справжній сервер, і 500
видно як 500.
"""
from __future__ import annotations

import uuid

import pytest

from messenger.blobs import WIRE_KINDS

API = "/api/v1/messenger"


@pytest.fixture(autouse=True)
def no_roads(monkeypatch):
    """Жодної дороги: цей сторож про ДВЕРІ, не про доставку.

    Без цього прогін дзвонив би у справжній сховок (`relay_store_url` за
    замовчуванням — `https://phantom-license.fly.dev`), і код відповіді почав
    би залежати від чужого сервера. Мовчазна мережа не має права ані
    пофарбувати цей тест зеленим, ані почервонити його.
    """
    from config import config

    monkeypatch.setattr(config, "relay_enabled", False)
    monkeypatch.setattr(config, "relay_url", "")
    monkeypatch.setattr(config, "relay_store_enabled", False)
    monkeypatch.setattr(config, "supabase_mailbox_url", "")
    monkeypatch.setattr(config, "supabase_anon_key", "")
    monkeypatch.setattr(config, "messenger_public_address", "")


@pytest.fixture
async def door_client(auth_root_user, auth_root_token):
    """Той самий стенд, що й `auth_root_client` із `tests/conftest.py`, з
    однією різницею — межа не ховає поломку обробника від тесту."""
    from fastapi.testclient import TestClient
    from main import create_app

    app = create_app()
    with TestClient(app, raise_server_exceptions=False) as c:
        c.headers.update({"Authorization": f"Bearer {auth_root_token}"})
        yield c


def _conversation_with_a_person(client) -> str:
    """Розмова 1:1 — саме вона доводить кадр до `wrap_frame`.

    Нотатки собі (`contact_id` порожній) до дроту не доходять узагалі, тож на
    них вади не видно: доказ вимагає співрозмовника.
    """
    from messenger.crypto.keys import KeyStore

    peer = KeyStore.generate(one_time_count=2)
    contact = client.post(
        f"{API}/contacts",
        json={"display_name": "Марта", "bundle": peer.publish_bundle().to_dict()},
    )
    assert contact.status_code == 201, contact.text
    created = client.post(
        f"{API}/conversations",
        json={"title": "Марта", "kind": "direct", "contact_id": contact.json()["id"]},
    )
    assert created.status_code == 201, created.text
    return created.json()["id"]


def _letter(kind: str) -> dict:
    return {
        "client_id": f"door-{uuid.uuid4().hex[:8]}",
        "author_id": "owner",
        "author_name": "Власник",
        "kind": kind,
        "body": '{"question":"Коли виїжджаємо?","options":["зараз","на світанку"]}',
    }


def test_a_real_kind_goes_through_the_door_to_the_wire(door_client):
    """Спершу — що доказ не порожній.

    Без цього «не 500» на невідомому типі могло б означати лише те, що ми не
    дійшли до `wrap_frame`: не той власник, немає розмови, 404.
    """
    conversation = _conversation_with_a_person(door_client)

    sent = door_client.post(
        f"{API}/conversations/{conversation}/messages", json=_letter("text")
    )

    assert sent.status_code == 200, sent.text


def test_an_unknown_kind_is_refused_at_the_door_not_inside(door_client):
    """Головне: клієнт дістає ВІДМОВУ, а не поломку вузла."""
    conversation = _conversation_with_a_person(door_client)

    answer = door_client.post(
        f"{API}/conversations/{conversation}/messages", json=_letter("poll")
    )

    assert answer.status_code != 500, (
        "невідомий тип валить обробник: клієнт бачить поломку вузла замість "
        f"відмови — {answer.status_code} {answer.text[:300]}"
    )
    assert 400 <= answer.status_code < 500, answer.text


def test_the_refused_letter_never_became_a_line_in_the_feed(door_client):
    """Відмова мусить статись ДО запису.

    Інакше в стрічці лишається лист, якого не отримав ніхто, — та сама тиха
    брехня, від якої рятує черга повторів.
    """
    conversation = _conversation_with_a_person(door_client)
    letter = _letter("poll")

    door_client.post(f"{API}/conversations/{conversation}/messages", json=letter)

    feed = door_client.get(f"{API}/conversations/{conversation}/messages")
    assert feed.status_code == 200, feed.text
    assert [m for m in feed.json() if m["client_id"] == letter["client_id"]] == [], (
        "кадр відмовлено, а рядок у стрічці лишився"
    )


def test_the_door_names_exactly_what_the_wire_carries():
    """Сторож на СПОСІБ, а не на наслідок.

    Двері мусять ПОСИЛАТИСЬ на `WIRE_KINDS`, а не носити його копію. Копія
    розходиться при першій же зміні й тихо: тип, доданий у дріт і забутий у
    схемі, дав би 422 на справжній кадр.
    """
    from typing import get_args

    from api.routes_messenger import MessageIn

    allowed = get_args(MessageIn.model_fields["kind"].annotation)

    assert allowed == tuple(WIRE_KINDS), (
        "перелік дверей розійшовся з переліком дроту", allowed, WIRE_KINDS
    )
