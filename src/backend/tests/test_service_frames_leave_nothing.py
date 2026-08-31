"""Службовий кадр невідомого типу не лишає у стрічці НІЧОГО.

Навіщо ознака взагалі. Правило дому: перш ніж додавати тип на дріт, обидва
боки мусять уміти сказати «не вмію показати». Для листа це правильно — людина
бачить, що прийшло щось нове, і оновлюється. Для **службової** дії (реакція,
позначка прочитання, згода в опитуванні) це навпаки **сміття посеред
розмови**: замість тихого ігнорування в стрічку лягає рядок «ця версія не
вміє показати», і людина вирішує, що продукт зламався.

Тому в конверт додано ознаку `s=1`. Саме в **конверт**, а не в тіло: тіло
читають ПІСЛЯ розбору типу, тобто запізно — рішення «мовчки відкинути» треба
ухвалити раніше, ніж стало відомо, що типу ми не знаємо.

Ознака виводиться з ТИПУ (`SERVICE_KINDS`), а не передається параметром:
параметр викликач забуде, і кадр поїде без неї — а помітно це стане лише на
чужій збірці.

Чого ознака НЕ рятує, і це сказано вголос: збірку, яка про саму ознаку ще не
знає. Вона побачить незнайомий тип і видасть той самий рядок. Це захист для
ВСІХ МАЙБУТНІХ збірок, а не для наявних.
"""
from __future__ import annotations

import pytest

from tests.conftest import owner_of

from messenger import blobs
from messenger.blobs import SERVICE_KINDS, SERVICE_TOKEN, unwrap_frame, wrap_frame

API = "/api/v1/messenger"


def test_a_service_kind_carries_the_mark_in_the_envelope():
    frame = wrap_frame("delete", "c_origin_1", origin_id="c_1")

    head = frame.partition("\n")[0]
    assert SERVICE_TOKEN in head, "ознака мусить бути в конверті, а не в тілі"


def test_an_ordinary_letter_carries_no_mark():
    frame = wrap_frame("text", "звичайний лист", origin_id="c_2")

    assert SERVICE_TOKEN not in frame.partition("\n")[0]


def test_an_unknown_service_kind_is_dropped_silently(monkeypatch):
    """Головна вимога: НІЧОГО, а не рядок.

    Кадр будуємо реалізацією — тимчасово розширивши перелік, — а розбираємо
    збіркою, де типу вже немає. Складати конверт рукою не можна: одного разу
    я вигадав роздільники, кадр не розпізнався як конверт узагалі й пішов
    старим шляхом «просто текст», тобто вектор нічого не доводив.
    """
    monkeypatch.setattr(blobs, "WIRE_KINDS", blobs.WIRE_KINDS + ("reaction",))
    monkeypatch.setattr(blobs, "SERVICE_KINDS", blobs.SERVICE_KINDS + ("reaction",))
    frame = wrap_frame("reaction", '{"emoji":"👍"}', origin_id="c_3")
    assert SERVICE_TOKEN in frame.partition("\n")[0]

    monkeypatch.setattr(blobs, "WIRE_KINDS", tuple(
        k for k in blobs.WIRE_KINDS if k != "reaction"
    ))
    kind, body, origin, group = unwrap_frame(frame)

    # Порожній тип — умовний знак «мовчки відкинь». Ані тексту, ані origin:
    # нічого, з чого приймач міг би зліпити рядок у стрічці.
    assert (kind, body, origin, group) == ("", "", "", "")


def test_an_unknown_ORDINARY_kind_still_says_it_cannot_show(monkeypatch):
    """Контроль: для ЛИСТА чесна відмова лишається правильною.

    Якби ознака накрила й звичайні типи, людина перестала б дізнаватись, що
    їй прийшло щось нове, — і замість «оновіть застосунок» отримала б тишу.
    """
    monkeypatch.setattr(blobs, "WIRE_KINDS", blobs.WIRE_KINDS + ("hologram",))
    frame = wrap_frame("hologram", "тіло", origin_id="c_4")
    monkeypatch.setattr(blobs, "WIRE_KINDS", tuple(
        k for k in blobs.WIRE_KINDS if k != "hologram"
    ))

    kind, body, _, _ = unwrap_frame(frame)

    assert kind == "text"
    assert "не вміє його показати" in body


def test_delete_is_the_service_kind_we_already_had():
    # `delete` був службовим ще до ознаки: він нічого не додає у стрічку, а
    # працює над наявним рядком. Тепер це записано в одному місці.
    assert "delete" in SERVICE_KINDS
    assert "text" not in SERVICE_KINDS


@pytest.mark.anyio
async def test_the_thread_does_not_change_after_an_unknown_service_frame(
    auth_root_client, monkeypatch
):
    """Доказ поверненням, як просив ШТАБ: стрічка ДО і ПІСЛЯ однакова."""
    from db.database import AsyncSessionLocal
    from api.routes_messenger import _keys
    from messenger.crypto.keys import KeyStore
    from messenger.crypto.session import Session
    from messenger.inbox import accept_frame

    created = auth_root_client.post(
        f"{API}/conversations", json={"title": "Тиша", "kind": "direct"}
    ).json()
    auth_root_client.post(
        f"{API}/conversations/{created['id']}/messages",
        json={
            "client_id": "c_before", "author_id": "me", "author_name": "Кирило",
            "kind": "text", "body": "єдиний лист",
        },
    )
    before = auth_root_client.get(f"{API}/conversations/{created['id']}/messages").json()

    peer = KeyStore.generate(one_time_count=4)
    ours = _keys()
    theirs = Session.initiate(peer, ours.publish_bundle())

    monkeypatch.setattr(blobs, "WIRE_KINDS", blobs.WIRE_KINDS + ("reaction",))
    monkeypatch.setattr(blobs, "SERVICE_KINDS", blobs.SERVICE_KINDS + ("reaction",))
    frame = theirs.encrypt(wrap_frame("reaction", '{"emoji":"🔥"}', origin_id="c_x").encode())
    monkeypatch.setattr(blobs, "WIRE_KINDS", tuple(
        k for k in blobs.WIRE_KINDS if k != "reaction"
    ))

    owner = owner_of(auth_root_client)
    async with AsyncSessionLocal() as session:
        row = await accept_frame(session, ours, owner, frame, None, road="direct")
        await session.commit()

    assert row is None, "службовий кадр не має ставати рядком"

    after = auth_root_client.get(f"{API}/conversations/{created['id']}/messages").json()
    assert [m["id"] for m in after] == [m["id"] for m in before]
