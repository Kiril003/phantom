"""Позначки на листі: вузол уміє їх ставити, знімати й рахувати.

Це перший випадок за два дні, коли ми йдемо в ПРАВИЛЬНОМУ порядку: спершу
кінцева точка на вузлі, потім жест на екрані. Досі було навпаки — фронт уже
має тип `Reaction` і малює позначки під бульбашкою, а вузол не мав про них
нічого. Саме так у продукті й з'явились вигадані дані: екран будували раніше
за джерело, і йому нічим було наповнитись, окрім вигадки.

Межа, яку тест тримає вголос: маршрут **не везе** позначку співрозмовнику.
Для цього потрібен новий тип на дроті, а правило `unwrap_frame` вимагає, щоб
обидва боки спершу вміли сказати «не вмію показати». На старій збірці кадр
реакції став би текстовим рядком у стрічці — сміттям замість тихого
ігнорування. Це рішення про протокол, і воно за двома боками разом.
"""
from __future__ import annotations

import pytest

API = "/api/v1/messenger"


def _conversation_with_message(client, body: str = "перший лист") -> tuple[str, str]:
    created = client.post(f"{API}/conversations", json={"title": "Позначки", "kind": "direct"})
    assert created.status_code == 201, created.text
    conversation_id = created.json()["id"]
    sent = client.post(
        f"{API}/conversations/{conversation_id}/messages",
        json={
            "client_id": f"c_react_{body[:8]}",
            "author_id": "me",
            "author_name": "Кирило",
            "kind": "text",
            "body": body,
        },
    )
    assert sent.status_code == 200, sent.text
    return conversation_id, sent.json()["id"]


def _react(client, conversation_id: str, message_id: str, emoji: str):
    return client.post(
        f"{API}/conversations/{conversation_id}/messages/{message_id}/reactions",
        json={"emoji": emoji},
    )


@pytest.mark.anyio
async def test_a_reaction_appears_and_says_it_is_mine(auth_root_client):
    conversation_id, message_id = _conversation_with_message(auth_root_client, "лист про згоду")

    response = _react(auth_root_client, conversation_id, message_id, "👍")
    assert response.status_code == 200, response.text

    reactions = response.json()["reactions"]
    assert len(reactions) == 1
    assert reactions[0]["emoji"] == "👍"
    assert reactions[0]["count"] == 1
    # `mine` — щоб клієнт не вгадував за іменем, кого показати натиснутим.
    assert reactions[0]["mine"] is True


@pytest.mark.anyio
async def test_pressing_the_same_mark_twice_removes_it(auth_root_client):
    """Перемикач, а не лічильник.

    Без цього подвійний тап на повільному звʼязку давав би дві позначки там,
    де людина хотіла нуль.
    """
    conversation_id, message_id = _conversation_with_message(auth_root_client, "лист туди-назад")

    _react(auth_root_client, conversation_id, message_id, "🔥")
    second = _react(auth_root_client, conversation_id, message_id, "🔥")

    assert second.json()["reactions"] == []


@pytest.mark.anyio
async def test_different_marks_live_side_by_side(auth_root_client):
    conversation_id, message_id = _conversation_with_message(auth_root_client, "лист із двома")

    _react(auth_root_client, conversation_id, message_id, "👍")
    response = _react(auth_root_client, conversation_id, message_id, "❤️")

    emojis = {r["emoji"] for r in response.json()["reactions"]}
    assert emojis == {"👍", "❤️"}


@pytest.mark.anyio
async def test_the_mark_survives_a_reread(auth_root_client):
    """Позначка живе у вузлі, а не в пам'яті вкладки.

    Саме тут ламались усі попередні «спроможності»: дія міняла локальний стан
    і зникала при перезавантаженні.
    """
    conversation_id, message_id = _conversation_with_message(auth_root_client, "лист, що переживе")
    _react(auth_root_client, conversation_id, message_id, "🛡️")

    rows = auth_root_client.get(f"{API}/conversations/{conversation_id}/messages").json()
    mine = next(r for r in rows if r["id"] == message_id)

    assert [r["emoji"] for r in mine["reactions"]] == ["🛡️"]


@pytest.mark.anyio
async def test_a_letter_without_marks_says_empty_not_unknown(auth_root_client):
    conversation_id, _ = _conversation_with_message(auth_root_client, "лист без позначок")

    rows = auth_root_client.get(f"{API}/conversations/{conversation_id}/messages").json()

    # Порожній список означає «жодної», а не «не знаємо»: вузол завжди знає
    # власні позначки, і `null` тут був би брехнею про незнання.
    assert rows[0]["reactions"] == []


@pytest.mark.anyio
async def test_a_tombstone_takes_no_marks(auth_root_client):
    """На видаленому листі позначка виглядала б відповіддю на порожнечу.

    Надгробок лишає саме «видалити ДЛЯ ВСІХ»: видалення для себе прибирає
    рядок цілком, і туди позначку не поставити з іншої причини — листа немає.
    Перша версія цього тесту цього не знала й чекала 409 там, де правильна
    відповідь 404; вада була в очікуванні, не в коді.
    """
    conversation_id, message_id = _conversation_with_message(auth_root_client, "лист під знос")
    dropped = auth_root_client.delete(
        f"{API}/conversations/{conversation_id}/messages/{message_id}?for_everyone=true"
    )
    assert dropped.status_code in (200, 204), dropped.text

    response = _react(auth_root_client, conversation_id, message_id, "👍")
    assert response.status_code == 409


@pytest.mark.anyio
async def test_a_letter_deleted_for_myself_is_simply_gone(auth_root_client):
    """Межа поруч: для себе — рядка немає взагалі, тож 404, а не 409."""
    conversation_id, message_id = _conversation_with_message(auth_root_client, "лист лише мій")
    auth_root_client.delete(f"{API}/conversations/{conversation_id}/messages/{message_id}")

    assert _react(auth_root_client, conversation_id, message_id, "👍").status_code == 404


@pytest.mark.anyio
async def test_a_stranger_message_id_is_refused(auth_root_client):
    conversation_id, _ = _conversation_with_message(auth_root_client, "лист один")
    other_conversation, other_message = _conversation_with_message(auth_root_client, "лист два")

    # Ідентифікатор із ЧУЖОЇ розмови: маршрут мусить впізнати підміну, а не
    # поставити позначку кудись.
    response = _react(auth_root_client, conversation_id, other_message, "👍")
    assert response.status_code == 404
    assert other_conversation != conversation_id


@pytest.mark.anyio
async def test_an_empty_mark_is_refused(auth_root_client):
    conversation_id, message_id = _conversation_with_message(auth_root_client, "лист із пробілом")

    response = _react(auth_root_client, conversation_id, message_id, "   ")
    assert response.status_code == 422
