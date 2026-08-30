"""Пошук бачить усю історію вузла, а не останній рядок.

Навіщо цей маршрут узагалі з'явився. Тіла повідомлень лежать запечатаними
(`ciphertext`); на живому QA-вузлі рядків із відкритим `body` було **нуль із
25**. Отже прочитати їх може лише той, у кого ключі at-rest, а це вузол.
Клієнт має в пам'яті щонайбільше останні 200 листів ТІЄЇ розмови, яку
відкривали, — а бічна панель звірялась узагалі лише з `lastSnippet`, тобто з
ОСТАННІМ повідомленням кожного чату.

Виміряно на склі до правки: «№5» (останній рядок) знаходився, а «№2» і «№9»
з тих самих розмов — ні. Плейсхолдер при цьому обіцяв «Пошук людей, тем,
**повідомлень**…». Людина робила з цього єдиний можливий висновок: листа не
існує.

Тому головний тест тут — не «пошук щось знаходить», а **«знаходить те, що НЕ
є останнім рядком»**. Саме цю межу стара реалізація й не переступала.
"""
from __future__ import annotations

from uuid import uuid4

import pytest

API = "/api/v1/messenger"


def _mark(word: str) -> str:
    """Мітка, унікальна на КОЖЕН виклик.

    База в межах процесу одна, а кожен тест біжить двічі — під asyncio і під
    trio. Мітка на рівні модуля цього не рятує: обидва проходи взяли б ту
    саму, другий побачив би рядки першого, і `len(hits) == 1` впало б не
    через дефект, а через сусіда. Тому тест, якому потрібне те саме слово
    двічі, зберігає його в змінну.
    """
    return f"{word}-{uuid4().hex[:8]}"


def _conversation(client, title: str, lines: list[str]) -> str:
    created = client.post(f"{API}/conversations", json={"title": title, "kind": "direct"})
    assert created.status_code == 201, created.text
    conversation_id = created.json()["id"]
    for i, line in enumerate(lines):
        sent = client.post(
            f"{API}/conversations/{conversation_id}/messages",
            json={
                "client_id": f"c_{title}_{i}",
                "author_id": "me",
                "author_name": "Кирило",
                "kind": "text",
                "body": line,
            },
        )
        assert sent.status_code == 200, sent.text
    return conversation_id


def _search(client, query: str, **params) -> dict:
    response = client.get(f"{API}/search", params={"q": query, **params})
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.anyio
async def test_finds_a_message_that_is_not_the_last_one(auth_root_client):
    """Той самий випадок, що падав на склі."""
    tag = _mark("гілка")
    _conversation(auth_root_client, "Довга гілка", [f"{tag} рядок №{i}" for i in range(1, 18)])

    last = _search(auth_root_client, f"{tag} рядок №17")
    middle = _search(auth_root_client, f"{tag} рядок №9")
    first = _search(auth_root_client, f"{tag} рядок №1 ")

    assert len(last["hits"]) == 1
    # До правки тут був нуль — і саме це читалось як «такого немає».
    assert len(middle["hits"]) == 1
    assert middle["hits"][0]["snippet"].endswith("№9")
    assert first["hits"], "перший рядок історії теж мусить знаходитись"


@pytest.mark.anyio
async def test_looks_across_every_conversation_not_just_the_open_one(auth_root_client):
    tag = _mark("зустріч")
    _conversation(auth_root_client, "Північ", [f"{tag} біля вежі"])
    _conversation(auth_root_client, "Південь", [f"{tag} біля мосту"])

    found = _search(auth_root_client, tag)

    titles = {hit["conversation_title"] for hit in found["hits"]}
    assert {"Північ", "Південь"} <= titles


@pytest.mark.anyio
async def test_reads_sealed_bodies(auth_root_client):
    """Доводимо, що шукається саме розпечатане, а не якийсь відкритий залишок.

    Якби маршрут звірявся з колонкою `body`, він знайшов би нуль: на
    сьогоднішньому вузлі вона порожня в усіх рядках.
    """
    word = _mark("ковадло")
    conversation_id = _conversation(auth_root_client, "Запечатане", [f"унікальне слово {word}"])

    rows = auth_root_client.get(f"{API}/conversations/{conversation_id}/messages").json()
    assert rows[0]["ciphertext"] is None, "назовні шифротекст не віддаємо"

    found = _search(auth_root_client, word)
    assert len(found["hits"]) == 1
    assert found["hits"][0]["conversation_id"] == conversation_id


@pytest.mark.anyio
async def test_says_how_much_it_looked_at(auth_root_client):
    """«Нічого не знайдено» і «далі я не дивився» — різні відповіді.

    Без цих полів клієнт не може відрізнити одне від одного, а мовчазне
    обрізання читається як «такого немає». Саме так пошук і брехав досі.
    """
    _conversation(auth_root_client, "Облік", ["один", "два", "три"])

    found = _search(auth_root_client, "не-існує-такого-слова")

    assert found["hits"] == []
    assert found["scanned"] > 0, "мусить сказати, що дивився"
    assert found["truncated"] is False


@pytest.mark.anyio
async def test_finds_by_author_too(auth_root_client):
    created = auth_root_client.post(
        f"{API}/conversations", json={"title": "Автор", "kind": "direct"}
    ).json()
    who = _mark("Мирослава")
    auth_root_client.post(
        f"{API}/conversations/{created['id']}/messages",
        json={
            "client_id": f"c_author_{who}",
            "author_id": "peer",
            "author_name": who,
            "kind": "text",
            "body": "тіло без імені всередині",
        },
    )

    found = _search(auth_root_client, who.lower())
    assert any(hit["author_name"] == who for hit in found["hits"])


@pytest.mark.anyio
async def test_deleted_messages_do_not_come_back_through_search(auth_root_client):
    """Надгробок не має воскрешати текст.

    Видалене не показують у стрічці; якби пошук його віддавав, він став би
    обхідним шляхом до того, що людина вважала прибраним.
    """
    ghost = _mark("привид")
    conversation_id = _conversation(auth_root_client, "Прибране", [ghost])
    message_id = auth_root_client.get(
        f"{API}/conversations/{conversation_id}/messages"
    ).json()[0]["id"]
    dropped = auth_root_client.delete(f"{API}/conversations/{conversation_id}/messages/{message_id}")
    assert dropped.status_code in (200, 204), dropped.text

    assert _search(auth_root_client, ghost)["hits"] == []


@pytest.mark.anyio
async def test_empty_query_returns_nothing_rather_than_everything(auth_root_client):
    _conversation(auth_root_client, "Порожній запит", ["будь-що"])

    for query in ("", "   "):
        found = _search(auth_root_client, query)
        assert found["hits"] == []
        assert found["scanned"] == 0


@pytest.mark.anyio
async def test_search_is_case_insensitive(auth_root_client):
    phrase = _mark("Північний Вхід")
    _conversation(auth_root_client, "Регістр", [phrase])

    assert _search(auth_root_client, phrase.lower())["hits"]
    assert _search(auth_root_client, phrase.upper())["hits"]


@pytest.mark.anyio
async def test_history_needs_authentication(auth_root_client, unauth_client):
    """Пошук ходить лише по розмовах власника.

    Це найдешевше місце, де можна випадково віддати чуже: маршрут іде не по
    одній розмові з перевіркою прав, а по всіх одразу.
    """
    secret = _mark("барвінок")
    _conversation(auth_root_client, "Приватне", [f"таємне слово {secret}"])

    outsider = unauth_client.get(f"{API}/search", params={"q": secret})
    assert outsider.status_code in (401, 403), outsider.text
