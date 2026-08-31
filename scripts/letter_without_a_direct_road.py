#!/usr/bin/env python3
"""Лист, коли пряма дорога НЕ ПРАЦЮЄ. Той випадок, у якому власник за кордоном.

Обидва наявні зонди (`two_people_talk.py`, `two_people_call.py`) зелені лише
тому, що вузли стоять на одній машині й знають адреси одне одного. Удома це
правда; у чужій мережі, за NAT, у мобільному звʼязку — ні. Тобто головний
випадок був неміряним.

Тут контакт заводиться БЕЗ `peer_address` навмисно. Пряма дорога вимкнена не
збоєм, а умовою задачі: перевіряємо саме те, що лишається, коли її немає.

**Що зонд доводить:** що лист доїхав або не доїхав, і ЯКОЮ дорогою — вузол
називає її у полі `transport`.

**Чого не доводить:** нічого про пряму дорогу. Це окремий випадок, і його
доводить `two_people_talk.py`.

Виміряно 31.08.2026 до підключення сховка: дороги немає жодної. `deliver()`
знає пряму, ретранслятор (`relay_url` порожній навмисно — WS-тунель дає 404)
і хмару (порожня). Сховок PH5 розгорнуто й увімкнено, але `RelayCourier`
поза власним файлом ніхто не конструює.

Запуск:
    python3 scripts/letter_without_a_direct_road.py

Коди виходу: 0 — лист доїхав, дорога названа;
             1 — не доїхав за відведений час;
             2 — вузол сказав, що дороги немає (чесно, але лист не поїде).
"""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request

A = "http://127.0.0.1:8001"
B = "http://127.0.0.1:8002"
PIN_A = "/home/kyrylo/phantom_ai/qa-node-2026-08-29/identity/bootstrap_pin"
PIN_B = "/home/kyrylo/phantom_ai/qa-node-b/identity/bootstrap_pin"

#: Сховок асинхронний за задумом: адресат забирає конверт, коли зазирне.
#: Тридцяти секунд вистачає і на пряму, і на пробіг через сервер.
DEADLINE_S = 45


def call(base: str, path: str, token: str = "", payload: dict | None = None):
    data = json.dumps(payload).encode() if payload is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(f"{base}/api/v1{path}", data=data, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            body = response.read().decode()
            return response.status, (json.loads(body) if body else None)
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode()[:300]
    except Exception as exc:  # noqa: BLE001
        return 0, str(exc)[:200]


def login(base: str, pin_path: str) -> str:
    code, out = call(base, "/auth/login/pin", payload={
        "username": "phantom", "pin": open(pin_path).read().strip()})
    if code != 200:
        raise SystemExit(f"вузол {base} не пустив: {code} {out}")
    return out["token"]


def main() -> int:
    token_a, token_b = login(A, PIN_A), login(B, PIN_B)
    _, id_a = call(A, "/messenger/identity", token_a)
    _, id_b = call(B, "/messenger/identity", token_b)

    # Знайомство ВЗАЄМНЕ, як у житті: обидва додали одне одного. У Б адреса є —
    # інакше він не зміг би відповісти; перевіряємо дорогу ВІД А, у якого її
    # немає. Саме так виглядає людина за NAT, що пише тому, хто вдома.
    # Адреса, за якою НІХТО не слухає (порт 9 — discard, вічно закритий).
    #
    # Перша версія просто не передавала `peer_address` — і лист доїхав ПРЯМОЮ
    # за 2 секунди. Бо обидва вузли на одній машині й знаходять одне одного
    # самі. Тобто зонд НЕ створив умови, яку заявляв, і зелений результат
    # говорив про стенд, а не про продукт.
    #
    # Мертва адреса — єдиний спосіб на одній машині відтворити те, що за
    # кордоном буде саме собою: пряма дорога існує на папері й не працює.
    code, contact = call(A, "/messenger/contacts", token_a, {
        "display_name": "Друга людина", "bundle": id_b["bundle"],
        "peer_address": "http://127.0.0.1:9",
    })
    if code not in (200, 201):
        raise SystemExit(f"А не завів контакт: {code} {contact}")
    call(B, "/messenger/contacts", token_b, {
        "display_name": "Перша людина", "bundle": id_a["bundle"], "peer_address": A,
    })

    code, conversation = call(A, "/messenger/conversations", token_a, {
        "title": "Без прямої дороги", "kind": "direct", "contact_id": contact["id"],
    })
    if code != 201:
        raise SystemExit(f"А не завів розмову: {code} {conversation}")

    road = conversation.get("road_ahead")
    print(f"вузол А каже про дорогу наперед: {road!r}")

    marker = f"без прямої дороги {int(time.time())}"
    code, sent = call(A, f"/messenger/conversations/{conversation['id']}/messages", token_a, {
        "client_id": f"c_nodirect_{int(time.time())}", "author_id": "me",
        "author_name": "Перша людина", "kind": "text", "body": marker,
    })
    print(f"надсилання: HTTP {code} стан={(sent or {}).get('delivery_state')!r} "
          f"дорога={(sent or {}).get('transport')!r}")

    started = time.monotonic()
    while time.monotonic() - started < DEADLINE_S:
        time.sleep(2)
        _, rows = call(B, "/messenger/conversations", token_b)
        for row in rows or []:
            _, messages = call(B, f"/messenger/conversations/{row['id']}/messages", token_b)
            for message in messages or []:
                if message.get("body") == marker:
                    took = time.monotonic() - started
                    print(f"\n✓ ДОЇХАВ за {took:.1f} с, дорога: "
                          f"{message.get('transport') or 'не названа'}")
                    return 0

    print(f"\n✗ не доїхав за {DEADLINE_S} с")
    if not road:
        # Вузол сказав це НАПЕРЕД — тобто продукт не бреше, просто дороги
        # немає. Розрізняти ці два випадки обовʼязково: мовчазна невдача і
        # чесна відмова виглядають однаково в журналі, але не для людини.
        print("  вузол попередив наперед: дороги немає жодної (`road_ahead` порожній)")
        return 2
    print(f"  а дорогу наперед вузол називав як {road!r} — отже обіцянка не справдилась")
    return 1


if __name__ == "__main__":
    sys.exit(main())
