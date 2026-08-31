#!/usr/bin/env python3
"""Двоє людей, два вузли, дзвінок. Доводить або спростовує — не лагодить.

Навіщо окремо від `two_people_talk.py`. Лист і дзвінок їдуть РІЗНИМИ дорогами:
лист — шифрованим кадром через приймальню, дзвінок — відкритим сигналом на
`/messenger/call/inbound` **без JWT** (свідомо: стукає чужий вузол, токена
нашого він не має). Тому «листи ходять» не доводить про дзвінки нічого.

**Що цей зонд доводить і чого НЕ доводить — сказано вголос, бо саме тут ми
весь час обпікались.**

Доводить: **сигнальну ногу** — що вузол А достукався до вузла Б, що Б цей
сигнал прийняв, і що він при цьому знає, хто дзвонить.

НЕ доводить: що дзвінок зʼєднається. Медіа — це WebRTC, ICE і TURN; без двох
браузерів із мікрофонами цього тут не перевірити. Тому вирок зонда — про
сигнал, і плутати його з «дзвінки працюють» не можна.

Запуск:
    python3 scripts/two_people_call.py

Коди виходу: 0 — сигнал пройшов і Б упізнав того, хто дзвонить;
             1 — не пройшов;
             2 — вузол пустив НЕЗНАЙОМЦЯ (діра, а не успіх).
"""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request

A = "http://127.0.0.1:8001"
B = "http://127.0.0.1:8002"
PIN_A = "/home/kyrylo/phantom_ai/qa-node-2026-08-29/identity/bootstrap_pin"
PIN_B = "/home/kyrylo/phantom_ai/qa-node-b/identity/bootstrap_pin"


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
    pin = open(pin_path).read().strip()
    code, out = call(base, "/auth/login/pin", payload={"username": "phantom", "pin": pin})
    if code != 200:
        raise SystemExit(f"вузол {base} не пустив: {code} {out}")
    return out["token"]


def identity(base: str, token: str) -> dict:
    code, out = call(base, "/messenger/identity", token)
    if code != 200:
        raise SystemExit(f"{base} не віддав ідентичність: {code} {out}")
    return out


def introduce(base: str, token: str, bundle: dict, address: str, name: str) -> str:
    code, contact = call(base, "/messenger/contacts", token, {
        "display_name": name, "bundle": bundle, "peer_address": address,
    })
    if code not in (200, 201):
        raise SystemExit(f"{base} не завів контакт: {code} {contact}")
    return contact["id"]


def main() -> int:
    token_a, token_b = login(A, PIN_A), login(B, PIN_B)
    id_a, id_b = identity(A, token_a), identity(B, token_b)
    print(f"вузол А {id_a['node_id'][:12]}…   вузол Б {id_b['node_id'][:12]}…")

    # Знайомство ВЗАЄМНЕ: без контакту в Б вхід має відмовити, і це правильно.
    contact_b = introduce(A, token_a, id_b["bundle"], B, "Друга людина")
    introduce(B, token_b, id_a["bundle"], A, "Перша людина")

    # ── 1. Сигнал від знайомого ──────────────────────────────────────────────
    code, out = call(A, "/messenger/call/offer", token_a, {
        "call_id": "probe-1", "contact_id": contact_b, "sdp": "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\n",
    })
    print(f"\nсигнал від знайомого: HTTP {code} {json.dumps(out, ensure_ascii=False)[:160]}")
    passed = code == 200 and isinstance(out, dict) and out.get("delivered") is True

    # ── 2. Сигнал від НЕЗНАЙОМЦЯ, прямо у вхід Б ─────────────────────────────
    #
    # Найважливіша половина зонда. Успіх тут — це ДІРА, а не успіх: означає,
    # що будь-який вузол мережі підіймає дзвінок на пристрої людини.
    stranger_code, stranger_out = call(B, "/messenger/call/inbound", "", {
        "kind": "offer", "call_id": "probe-stranger",
        "from_node_id": "0" * 64, "sdp": "v=0\r\n",
    })
    print(f"сигнал від НЕЗНАЙОМЦЯ у вхід Б: HTTP {stranger_code} "
          f"{json.dumps(stranger_out, ensure_ascii=False)[:160]}")

    print()
    if stranger_code == 200:
        print("✗ ВУЗОЛ ПУСКАЄ НЕЗНАЙОМЦЯ: будь-хто в мережі підіймає дзвінок.")
        print("  Якщо вузол піднято ДО правки 31.08 — це очікувано, треба перезапуск.")
        return 2
    if stranger_code == 403:
        print("✓ незнайомець відмовлений (403) — правка на цьому вузлі діє")

    if passed:
        print("✓ сигнальна нога між двома живими вузлами ПРАЦЮЄ")
        print("  (медіа не перевірено: WebRTC/ICE потребує двох браузерів)")
        return 0
    print("✗ сигнал від знайомого не пройшов")
    return 1


if __name__ == "__main__":
    sys.exit(main())
