#!/usr/bin/env python3
"""Двоє людей, два вузли, лист туди й назад.

Досі все доведене в месенджері було про НАДСИЛАННЯ: стани, черга, скринька
вихідних, віяр у групі. Цей сценарій доводить інше — що лист **приходить**, і
що відповідь приходить назад. Для цього потрібні два вузли, а не один.

Знайомство робиться ВЗАЄМНИМ навмисно. Саме воно ламало розмову назавжди:
той, хто завів контакт із бандла, тримає власну вихідну сесію й пише
початковим кадром X3DH, а сесія отримувача розібрати його не могла за
побудовою. Виміряно 30.08.2026: односторонньо доходило за 2 с, взаємно — не
доходило ніколи. Полагоджено тим, що початковий кадр має право перезаснувати
сесію (`messenger/inbox.py`).

Запуск:
    python3 scripts/two_people_talk.py

Коди виходу: 0 — обидва напрямки дійшли; 1 — котрийсь ні (з поясненням).
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

#: Скільки чекати на доставку. Пряма дорога між двома вузлами на одній машині
#: займає секунди; довше означає, що кадр не поїхав або не прийнявся.
DEADLINE_S = 30


def call(base: str, path: str, token: str = "", payload: dict | None = None):
    data = json.dumps(payload).encode() if payload is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(f"{base}/api/v1{path}", data=data, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            body = response.read().decode()
            return response.status, (json.loads(body) if body else None)
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode()[:200]


def login(base: str, pin_path: str) -> str:
    pin = open(pin_path).read().strip()
    code, out = call(base, "/auth/login/pin", payload={"username": "phantom", "pin": pin})
    if code != 200:
        raise SystemExit(f"вузол {base} не пустив: {code} {out}")
    return out["token"]


def wait_for(base: str, token: str, needle: str) -> tuple[bool, float, str]:
    """Чи з'явився лист у СПІВРОЗМОВНИКА. Повертає (дійшло, секунди, розмова)."""
    started = time.monotonic()
    while time.monotonic() - started < DEADLINE_S:
        time.sleep(1.5)
        _, conversations = call(base, "/messenger/conversations", token)
        for conversation in conversations or []:
            _, messages = call(
                base, f"/messenger/conversations/{conversation['id']}/messages", token
            )
            for message in messages or []:
                if message.get("body") == needle:
                    return True, time.monotonic() - started, conversation.get("title", "")
    return False, time.monotonic() - started, ""


def introduce(base: str, token: str, their_bundle: dict, their_address: str, name: str) -> str:
    code, contact = call(base, "/messenger/contacts", token, {
        "display_name": name, "bundle": their_bundle, "peer_address": their_address,
    })
    if code == 201:
        return contact["id"]
    # Уже знайомі — беремо наявний контакт, а не заводимо другий.
    _, contacts = call(base, "/messenger/contacts", token)
    for contact in contacts or []:
        if contact.get("display_name") == name:
            return contact["id"]
    raise SystemExit(f"{base}: контакт не заведено — {code} {contact}")


def conversation_with(base: str, token: str, contact_id: str, title: str) -> str:
    _, conversations = call(base, "/messenger/conversations", token)
    for conversation in conversations or []:
        if conversation.get("title") == title:
            return conversation["id"]
    code, created = call(base, "/messenger/conversations", token, {
        # Поле саме `contact_id`: схема мовчки викидає незнайомі ключі, і з
        # `peer_node_id` розмова виходила з `peer=None` та `delivery=local`.
        "title": title, "kind": "direct", "contact_id": contact_id,
    })
    if code != 201:
        raise SystemExit(f"{base}: розмову не створено — {code} {created}")
    return created["id"]


def send(base: str, token: str, conversation_id: str, node_id: str, who: str, text: str) -> str:
    code, sent = call(base, f"/messenger/conversations/{conversation_id}/messages", token, {
        "client_id": f"c_{int(time.time() * 1000)}",
        "author_id": node_id, "author_name": who, "kind": "text", "body": text,
    })
    if code != 200:
        raise SystemExit(f"{base}: лист не прийнято вузлом — {code} {sent}")
    return sent.get("delivery", "?")


def main() -> int:
    token_a, token_b = login(A, PIN_A), login(B, PIN_B)
    _, id_a = call(A, "/messenger/identity", token_a)
    _, id_b = call(B, "/messenger/identity", token_b)
    print(f"А {id_a['node_id'][:16]}   Б {id_b['node_id'][:16]}\n")

    # ВЗАЄМНО — саме той випадок, що ламався.
    contact_b = introduce(A, token_a, id_b["bundle"], B, "Оксана")
    contact_a = introduce(B, token_b, id_a["bundle"], A, "Кирило")
    print("знайомство взаємне: кожен завів контакт іншого")

    conv_a = conversation_with(A, token_a, contact_b, "Оксана")
    stamp = int(time.time())

    there = f"Оксано, ти це бачиш? {stamp}"
    print(f"\nА → Б: {there!r}   delivery={send(A, token_a, conv_a, id_a['node_id'], 'Кирило', there)}")
    ok_there, secs_there, where_there = wait_for(B, token_b, there)
    print(f"   {'ДІЙШЛО' if ok_there else 'НЕ ДІЙШЛО'} за {secs_there:.1f} с"
          + (f", розмова {where_there!r}" if ok_there else ""))
    if not ok_there:
        return 1

    # Відповідь іде ЗВОРОТНОЮ сесією — окремий шлях, і його теж треба довести.
    _, conversations_b = call(B, "/messenger/conversations", token_b)
    conv_b = next(c["id"] for c in conversations_b if c["title"] == where_there)

    back = f"Бачу, Кириле. І ти мене чуєш? {stamp}"
    print(f"\nБ → А: {back!r}   delivery={send(B, token_b, conv_b, id_b['node_id'], 'Оксана', back)}")
    ok_back, secs_back, where_back = wait_for(A, token_a, back)
    print(f"   {'ДІЙШЛО' if ok_back else 'НЕ ДІЙШЛО'} за {secs_back:.1f} с"
          + (f", розмова {where_back!r}" if ok_back else ""))

    print("\n" + ("ОБИДВА НАПРЯМКИ ПРАЦЮЮТЬ" if ok_back else "ЗВОРОТНИЙ НАПРЯМОК НЕ ПРАЦЮЄ"))
    return 0 if ok_back else 1


if __name__ == "__main__":
    raise SystemExit(main())
