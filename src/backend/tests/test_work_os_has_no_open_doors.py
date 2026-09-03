"""Чи має підсистема work-os хоч одні відчинені двері.

Знайдено 29.08.2026 при підготовці бети. `routes_work_os.py` не мав жодного
`Depends` — сім маршрутів приймали будь-кого, хто дотягнувся до порту, тоді як
сусідній `routes_messenger.py` скрізь бере `get_user_or_device_user`.

Чому це побачили лише частково. Сторож `TestD3A9PublicRouteAllowlist` зондує
маршрути БЕЗ ТІЛА, тож ті, що вимагають схему, віддавали 422 — і в його звіт
не потрапляли. Названо було чотири, беззахисними були всі сім. Урок ширший за
цей файл: зонд міряв «чи віддає 200», а не «чи є автентифікація», і різницю
між цими двома питаннями видно лише коли її шукаєш.

Найдорожчий із семи — вебхук. `channel_token` їхав у шляху й НІДЕ не звірявся
(жодного порівняння в дереві), а обробник розсилав подію через
`hub.broadcast("messenger", "incoming_message", ...)` усім під'єднаним
клієнтам. Тобто чужа людина могла намалювати власникові повідомлення в його ж
месенджері — це вкидання, а не витік.

ЦІ ТЕСТИ МУСЯТЬ ЧЕРВОНІТИ НА СТАРОМУ КОДІ — і це прогнано, а не припущено.
Замок тимчасово знято з роутера, набір прогнано: **10 з 11 впали**, зокрема всі
сім маршрутів, обидва «найгірші читачі» й вкидання у месенджер. Пройшов лише
`test_no_handler_quietly_opts_out_of_the_router_lock` — він і не мав червоніти,
бо стереже інший спосіб зламатись (обробник, що знімає з себе замок роутера).
"""
from __future__ import annotations

import pytest

PREFIX = "/api/v1/work-os"

#: Усі сім, а не ті чотири, що їх ловив зонд без тіла.
ALL_ROUTES = [
    ("POST", f"{PREFIX}/webhooks/будь-який-рядок"),
    ("POST", f"{PREFIX}/cli/send"),
    ("GET", f"{PREFIX}/knowledge-search"),
    ("POST", f"{PREFIX}/digest"),
    ("GET", f"{PREFIX}/drive/files"),
    ("GET", f"{PREFIX}/threads/x/canvas"),
    ("PUT", f"{PREFIX}/threads/x/canvas"),
]


@pytest.mark.parametrize("method, path", ALL_ROUTES)
def test_every_work_os_route_demands_a_key(unauth_client, method, path):
    """401, а не 422 і не 200.

    Порядок важливий: замок мусить спрацювати ДО перевірки схеми. Інакше
    відповідь 422 сама по собі каже нападнику, що маршрут існує і якої форми
    він чекає — і саме тому старий стан виглядав безпечнішим, ніж був.
    """
    response = unauth_client.request(method, path, json={})
    assert response.status_code == 401, (
        f"{method} {path} віддав {response.status_code} без ключа"
    )


def test_the_two_worst_readers_do_not_answer_a_stranger(unauth_client):
    """Пошук по знаннях і перелік файлів диска — це читання чужого.

    Виділено окремо, бо саме ці два віддавали 200: не «маршрут існує», а
    справжня видача даних будь-кому.
    """
    assert unauth_client.get(f"{PREFIX}/knowledge-search?q=пароль").status_code == 401
    assert unauth_client.get(f"{PREFIX}/drive/files").status_code == 401


def test_a_stranger_cannot_inject_a_message_into_the_messenger(unauth_client):
    """Вебхук не мусить пускати чужу подію в стрічку власника.

    Токен у шляху брався будь-який — тому тут навмисно взято правдоподібний
    рядок: якби перевірка спиралась на «схожість на токен», цей тест би її
    пропустив.
    """
    response = unauth_client.post(
        f"{PREFIX}/webhooks/ch_a1b2c3d4e5f6",
        json={"commits": [{"id": "deadbeef", "message": "підроблений пуш"}], "ref": "main"},
    )
    assert response.status_code == 401
    assert response.json().get("delivered") is not True


def test_the_lock_lives_on_the_router_not_on_seven_handlers():
    """Замок один, а не сім однакових.

    Сім окремих `Depends` — це сім місць, де наступний обробник забудуть
    прикрити. Тест тримає саме той спосіб, яким це зроблено.
    """
    from api.routes_work_os import router

    assert router.dependencies, "на роутері work-os немає жодної залежності"
    names = [
        getattr(d.dependency, "__name__", "") for d in router.dependencies
    ]
    assert "get_user_or_device_user" in names, (
        f"очікувано get_user_or_device_user, знайдено {names}"
    )


def test_no_handler_quietly_opts_out_of_the_router_lock():
    """Залежність на роутері не заважає окремому обробнику стати публічним —
    достатньо власного `dependencies=[]`. Ловимо саме це."""
    import inspect

    from api import routes_work_os

    source = inspect.getsource(routes_work_os)
    assert "dependencies=[]" not in source.replace(" ", ""), (
        "якийсь обробник знімає з себе замок роутера"
    )
