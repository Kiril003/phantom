"""Чи можна обійти екран входу з ПІНом.

Знайдено 29.08.2026 під час підготовки бети. `POST /api/v1/auth/quick-join`
не мав ЖОДНОЇ автентифікації і містив три діри в одному обробнику:

  1. нове ім'я `kiril` / `root` / `admin` → роль ROOT одразу, без пароля
     (`role = "ROOT" if user_count == 0 or clean_username in (...)`);
  2. НАЯВНИЙ користувач із НЕПРАВИЛЬНИМ ПІНом усе одно входив — перевірка
     була, але вердикт її ігнорував:
         if not verify_secret(req.pin, user.pin_hash):
             logger.warning("quick-join: pin mismatch ... continuing")
     і виконання тривало до видачі токена;
  3. ПІН був необов'язковим: без нього звірки не відбувалось узагалі.

Наслідок: екран входу з ПІНом не був замком. Будь-хто, хто дотягнувся до
порту, входив ким завгодно — зокрема ROOT-ом. Прикривала лише прив'язка до
петлі, тобто продукт був безпечний рівно доти, доки недосяжний — а весь сенс
вузла в тому, щоб бути досяжним із телефона.

Маршрут знято цілком: у фронті його не кликав ніхто (`api.ts` мав обгортку
`quickJoin`, до якої не було жодного звернення), у тестах — теж. Це була
спадщина демо-стенда, а не жива дорога.

ЦІ ТЕСТИ МУСЯТЬ ЧЕРВОНІТИ НА СТАРОМУ КОДІ. Перевірено проти версії до
правки: перші два падали (маршрут відповідав 200), третій проходив.
"""
from __future__ import annotations

import pytest

QUICK_JOIN = "/api/v1/auth/quick-join"
LOGIN_PIN = "/api/v1/auth/login/pin"

#: Саме ці імена старий код підносив до ROOT без жодної перевірки.
PRIVILEGED_NAMES = ["root", "admin", "kiril"]


@pytest.mark.parametrize("username", PRIVILEGED_NAMES)
def test_no_one_can_mint_a_root_account_without_a_key(unauth_client, username):
    """Найгірша з трьох дір: ім'я замість пароля.

    Старий код на цей самий запит віддавав 200 і токен ROOT.
    """
    response = unauth_client.post(
        QUICK_JOIN,
        json={"username": username, "display_name": "хто завгодно"},
    )
    assert response.status_code == 404, (
        f"«{username}» без жодного ключа отримав {response.status_code}. "
        "Ім'я не може бути підставою для найвищої ролі."
    )


def test_the_route_is_gone_not_merely_locked(unauth_client):
    """Знято, а не прикрито автентифікацією.

    Прикрити було б гірше: маршрут лишився б у поверхні, і наступний, хто
    шукатиме «швидкий вхід», знову зняв би з нього замок.
    """
    assert unauth_client.post(QUICK_JOIN, json={"username": "будь-хто"}).status_code == 404
    assert unauth_client.get(QUICK_JOIN).status_code == 404


def test_an_existing_user_cannot_be_entered_with_a_wrong_pin(unauth_client):
    """Друга діра: перевірка була, вердикт її ігнорував.

    `phantom` — це ROOT, який реально живе в базі стенда. Старий обробник на
    неправильний ПІН писав рядок у журнал і ПРОДОВЖУВАВ до видачі токена.
    """
    response = unauth_client.post(
        QUICK_JOIN,
        json={"username": "phantom", "pin": "000000"},
    )
    assert response.status_code == 404
    assert "token" not in (response.json() if response.headers.get("content-type", "").startswith("application/json") else {})


def test_the_pin_screen_is_the_lock_and_it_holds(unauth_client):
    """А тепер — що замок таки є там, де має бути.

    Він тут не для регресії, а щоб різниця була видима: одна дорога до ПІНа
    перевіряла, друга — ні, і саме друга робила першу декоративною.

    ПАСТКА ЦЬОГО НАБОРУ, через яку я вже раз хибно вирішив, що є друга діра:
    `conftest._mock_bootstrap_pin_for_tests` навмисно мокає бутстрап-ПІН у
    «000000», щоб старі тести входили як `phantom`/`000000`. Тобто в цьому
    оточенні «000000» — ПРАВИЛЬНИЙ ПІН, і вхід із ним чесно дає 200. Свідомо
    неправильний тут — будь-який інший.
    """
    response = unauth_client.post(
        LOGIN_PIN,
        json={"username": "phantom", "pin": "999999"},
    )
    assert response.status_code == 401, (
        "Вхід з явно неправильним ПІНом мусить бути відмовою, а не записом "
        "у журнал."
    )
    assert "token" not in response.json()


def test_nothing_in_the_tree_registers_or_calls_the_removed_route():
    """Сторож проти повернення.

    Шукає ОГОЛОШЕННЯ маршруту й ВИКЛИКИ, а не згадки: пояснення, чому його
    знято, мусять лишитись у коді, інакше наступний ітератор просто додасть
    «швидкий вхід» знову, не знаючи, чим це було.
    """
    import re
    from pathlib import Path

    root = Path(__file__).resolve().parents[2]
    # Оголошення маршруту на бекенді або звернення до нього з клієнта.
    patterns = [
        re.compile(r"""@router\.(post|get)\(\s*["']/quick-join"""),
        re.compile(r"""["']/auth/quick-join["']"""),
        re.compile(r"""\bquickJoin\s*\("""),
        re.compile(r"""\bquick_join\s*\("""),
    ]
    hits = []
    for pattern_glob in ("*.ts", "*.tsx", "*.py"):
        for path in root.rglob(pattern_glob):
            if set(path.parts) & {".venv", "node_modules", "dist", "build", "__pycache__"}:
                continue
            if path.name == Path(__file__).name:
                continue
            try:
                text = path.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            for rx in patterns:
                if rx.search(text):
                    hits.append(f"{path.relative_to(root)} ({rx.pattern[:30]})")
                    break
    assert not hits, f"маршрут повернувся у: {hits}"
