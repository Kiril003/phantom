"""Чи кладе месенджер те, що обіцяє прийняти.

Знайдено 29.08.2026, коли я сіяв стенд і сам на це спіймався: створив дві
розмови з готовою стрічкою, отримав **201** на обидві, прочитав назад —
порожньо. Поле `ConversationIn.messages` існувало в схемі з коментарем
«Готова стрічка для показової розмови», а `create_conversation` його не читав
узагалі. Той самий `ConversationIn` вживає ще й `/bootstrap`, і ОТОЙ маршрут
читав його справно: одна схема, два маршрути, дві поведінки під одним ім'ям.

Засівання винесено у спільного `_seed_messages`, тож розійтися вдруге вони вже
структурно не можуть.

Пройшовши по файлу тим самим питанням — «які поля схема приймає, а обробник
жодного разу не читає» — знайшлось ще одне: `MessageIn.ciphertext`. Лист із
самим лише шифротекстом лягав ПОРОЖНІМ і повертав 200.
"""
from __future__ import annotations

import uuid

CONV = "/api/v1/messenger/conversations"


def _seed(n: int, who: str = "olena") -> list[dict]:
    return [
        {
            "client_id": f"{who}-{i}-{uuid.uuid4().hex[:6]}",
            "author_id": who,
            "author_name": who.capitalize(),
            "kind": "text",
            "body": f"рядок №{i}",
        }
        for i in range(1, n + 1)
    ]


def test_a_conversation_created_with_a_thread_actually_has_it(auth_root_client):
    """201 мусить означати «покладено», а не «прийнято й забуто».

    Саме тут я і спіймався: успіх був чесний за кодом і брехливий за суттю.
    """
    created = auth_root_client.post(
        CONV, json={"title": f"Стрічка {uuid.uuid4().hex[:6]}", "messages": _seed(5)}
    )
    assert created.status_code == 201, created.text
    conversation_id = created.json()["id"]

    back = auth_root_client.get(f"{CONV}/{conversation_id}/messages")
    assert back.status_code == 200
    assert len(back.json()) == 5, "розмову створено, а стрічка зникла"


def test_the_seeded_bodies_survive_the_round_trip(auth_root_client):
    """Не лише кількість: вміст мусить бути тим самим.

    Історія лягає запечатаною, тож перевіряємо саме читання назад — інакше
    тест пройшов би на п'яти порожніх рядках.
    """
    created = auth_root_client.post(
        CONV, json={"title": f"Вміст {uuid.uuid4().hex[:6]}", "messages": _seed(3)}
    )
    conversation_id = created.json()["id"]
    bodies = [m.get("body") for m in auth_root_client.get(f"{CONV}/{conversation_id}/messages").json()]
    assert bodies == ["рядок №1", "рядок №2", "рядок №3"], bodies


def test_an_empty_thread_is_still_a_valid_conversation(auth_root_client):
    """Порожній список — не помилка: більшість розмов саме так і починається."""
    created = auth_root_client.post(CONV, json={"title": f"Порожня {uuid.uuid4().hex[:6]}"})
    assert created.status_code == 201
    assert auth_root_client.get(f"{CONV}/{created.json()['id']}/messages").json() == []


def test_both_routes_seed_through_the_same_helper():
    """Сторож на СПОСІБ, а не на наслідок.

    Доки засівання жило двома копіями, розбіжність була питанням часу. Тест
    падає, якщо хтось знову напише власний цикл замість спільного помічника.
    """
    import inspect

    from api import routes_messenger

    source = inspect.getsource(routes_messenger)
    assert source.count("def _seed_messages(") == 1, "помічник роздвоївся"
    assert source.count("_seed_messages(session, row") == 2, (
        "очікувано рівно два викликачі: /conversations і /bootstrap"
    )


def test_a_client_supplied_ciphertext_is_refused_not_swallowed(auth_root_client):
    """Лист із самим шифротекстом мусить дістати відмову, а не тишу.

    Маршрут пломбує історію ключем СПОКОЮ вузла з id рядка в AAD; чуже
    запечатане тим ключем не відкриється ніколи. Доти таке повідомлення
    лягало порожнім і поверталось 200.
    """
    created = auth_root_client.post(CONV, json={"title": f"Шифр {uuid.uuid4().hex[:6]}"})
    conversation_id = created.json()["id"]

    response = auth_root_client.post(
        f"{CONV}/{conversation_id}/messages",
        json={
            "client_id": uuid.uuid4().hex,
            "author_id": "olena",
            "author_name": "Олена",
            "kind": "text",
            "ciphertext": "00" * 32,
        },
    )
    assert response.status_code == 400, (
        f"готовий шифротекст прийнято з кодом {response.status_code}"
    )
    assert auth_root_client.get(f"{CONV}/{conversation_id}/messages").json() == [], (
        "відмова відмовою, а порожній рядок усе одно ліг"
    )


def test_no_schema_field_is_accepted_and_then_ignored():
    """Родинний сторож: жодне поле схеми не має лишатись непрочитаним.

    Саме це питання — «що обробник ПРИЙМАЄ й ігнорує», а не «що він робить» —
    і знайшло обидва випадки вище.
    """
    import ast
    import inspect

    from api import routes_messenger

    source = inspect.getsource(routes_messenger)
    tree = ast.parse(source)

    models: dict[str, list[str]] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef) and any(
            getattr(base, "id", "") == "BaseModel" for base in node.bases
        ):
            models[node.name] = [
                stmt.target.id
                for stmt in node.body
                if isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name)
            ]

    ignored: list[str] = []
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        if not any(
            isinstance(d, ast.Call)
            and isinstance(d.func, ast.Attribute)
            and d.func.attr in ("get", "post", "patch", "put", "delete")
            for d in node.decorator_list
        ):
            continue
        body = ast.get_source_segment(source, node) or ""
        for arg in node.args.args:
            model = getattr(arg.annotation, "id", None)
            if model not in models:
                continue
            for field in models[model]:
                if f"{arg.arg}.{field}" not in body:
                    ignored.append(f"{node.name}: {model}.{field}")

    assert not ignored, (
        "схема приймає поля, яких обробник не читає — 201/200 буде брехнею:\n  "
        + "\n  ".join(ignored)
    )
