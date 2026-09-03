"""Чи розповідає вузол незнайомцеві, чиї обличчя він знає.

Знайдено 29.08.2026. `POST /api/v1/face/recognize` не мав замка й на будь-який
надісланий вектор віддавав `username`, `user_id` і `role`. Тобто чужа людина,
що дотягнулась до порту, перебирала мешканців вузла — у продукті, чия суть саме
в тому, щоб не розголошувати, хто тут живе.

ЧОМУ ЗАМОК НІЧОГО НЕ ЗАБРАВ — заміряно, а не припущено:
  • токена ця відповідь ніколи не видавала: способом ВХОДУ розпізнавання не є,
    воно лише наповнює `faceStore` (`useFaceDetection.ts:286-292`);
  • обіцяна в докстрінгу «login suggestion (logged-out)» не була підключена:
    `App.tsx:162` при `!authenticated` віддає `LoginScreen` замість усього
    дерева, а `<Overlays/>` — єдиний споживач циклу розпізнавання — стоїть у
    тому дереві (`App.tsx:300`). До входу цикл не запускався ніколи.
Тобто замок забирає рівно те, що працювало лише для чужого.

ЦЕЙ ТЕСТ МУСИТЬ ЧЕРВОНІТИ НА СТАРОМУ КОДІ — прогнано: до правки повертав 200.
"""
from __future__ import annotations

RECOGNIZE = "/api/v1/face/recognize"

#: Довжина вектора не має значення — важливо, що відповідь не приходить
#: РАНІШЕ за перевірку ключа.
SOME_EMBEDDING = [0.01] * 128


def test_a_stranger_gets_no_answer_at_all(unauth_client):
    """401, і саме до будь-якої роботи з вектором.

    Порядок важить: якби замок стояв ПІСЛЯ звірки, час відповіді сам би
    підказував, чи був збіг.
    """
    response = unauth_client.post(RECOGNIZE, json={"embedding": SOME_EMBEDDING})
    assert response.status_code == 401, (
        f"незнайомець дістав {response.status_code} замість відмови"
    )


def test_the_refusal_leaks_no_name_no_role_no_confidence(unauth_client):
    """Навіть у тілі відмови не має бути ні імені, ні ролі, ні відстані.

    «Не збіглося» теж є відповіддю: вона каже, що вузол когось знає, просто
    не цього. Тому перевіряємо саме вміст.
    """
    body = unauth_client.post(RECOGNIZE, json={"embedding": SOME_EMBEDDING}).text.lower()
    for leak in ("username", "user_id", "role", "confidence", "matched"):
        assert leak not in body, f"у відмові просочилось поле «{leak}»"


def test_an_empty_or_broken_body_is_still_refused_first(unauth_client):
    """Схема не має спрацьовувати раніше за замок.

    Інакше 422 сам по собі каже нападнику, що маршрут існує і якої форми він
    чекає — саме так `work-os` виглядав безпечнішим, ніж був.
    """
    assert unauth_client.post(RECOGNIZE, json={}).status_code == 401
    assert unauth_client.post(RECOGNIZE, json={"embedding": "не вектор"}).status_code == 401


def test_the_route_declares_a_real_auth_dependency():
    """Сторож на СПОСІБ, а не на наслідок: замок мусить бути залежністю,
    видимою в дереві, а не перевіркою всередині тіла обробника."""
    from fastapi.routing import APIRoute

    from main import create_app

    app = create_app()
    names: set[str] = set()
    for route in app.routes:
        if isinstance(route, APIRoute) and route.path == RECOGNIZE:
            stack = list(route.dependant.dependencies)
            while stack:
                node = stack.pop()
                call = getattr(node, "call", None)
                if call is not None:
                    names.add(getattr(call, "__name__", ""))
                stack.extend(getattr(node, "dependencies", []) or [])
            break
    assert "get_current_user" in names, (
        f"на /face/recognize немає залежності автентифікації; знайдено: {sorted(names)}"
    )
