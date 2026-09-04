"""Запрошення з телефона дістає названу відмову, а не «неприйнятний bundle».

Знайдено штабом 04.09.2026 на стику ПК↔телефон. Людина бере код зі СВОГО
телефона, вставляє в поле контакта на ПК — і дістає `400 «неприйнятний
bundle»`. Відмова описує НАШ розбір (не зійшовся `PublicBundle.from_compact`),
а не її дію й не те, що робити далі. Декодера PH2 у цьому вузлі немає
взагалі: єдина згадка формату в бекенді — рядок документації у
`node/peer_channel.py`.

Рішення штабу на бету: мосту форматів НЕ будуємо (це окрема хвиля), але
перестаємо мовчати не про те. Правда коротка: телефон додається не
запрошенням, а спаруванням — код показує сам ПК, телефон його сканує. Саме
ця дорога (mobile-pair-v1) і працює в живому циклі.

Сторож тримає три речі:
  * PH2-рядок дає 400 із ПРИЧИНОЮ ПРО ТЕЛЕФОН, а не про bundle;
  * причина каже, ЩО РОБИТИ (спарувати), а не лише що не так;
  * звичайний кривий bundle і далі дістає свою стару відмову — розділивши
    випадки, не можна проковтнути решту.
"""
from __future__ import annotations

import os

import pytest

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-ph2-refusal")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-key")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")

# СПРАВЖНІЙ код телефона, складений за `PeerInvite.kt::encode`, а не схожий
# на нього: три частини через ':' — префікс, тіло base64url
# (peerId|імʼя|Ed25519|X25519|хост|порт) і контрольна сума FNV-1a у hex.
# Вигаданий зразок ловився б за префіксом так само, але брехав би про те,
# ЩО САМЕ вставляє людина — а сторож із вигаданим артефактом рано чи пізно
# доводить не те, що написано в його імені.
PHONE_INVITE = (
    "PH2:OWYyYzFhN2I1ZTBkNGMzYXzQotC10LvQtdGE0L7QvSDQmtC40YDQuNC70LB8Wm05dlltRnlSV1F5TlRVeE9WQjFZa3RsZVVKaGMyVTJOSFYwYVd4ZlgxOHxabTl2WW1GeVdESTFOVEU1VUhWaVMyVjVRbUZ6WlRZMGRYUnBiRjlmWDE4fHww:9181d6c3"
)


def _add_contact(client, **body):
    return client.post(
        "/api/v1/messenger/contacts",
        json={"display_name": "телефон", **body},
    )


def test_a_phone_invite_is_named_not_called_a_bad_bundle(auth_root_client):
    res = _add_contact(auth_root_client, compact=PHONE_INVITE)

    assert res.status_code == 400, res.text
    detail = str(res.json().get("detail", ""))
    assert "телефон" in detail.lower(), (
        f"відмова знову описує наш розбір, а не дію людини: {detail!r}"
    )
    assert "bundle" not in detail.lower(), (
        "у відповіді лишилось слово про наш внутрішній формат — для людини "
        "воно не означає нічого"
    )


def test_the_refusal_says_what_to_do_instead(auth_root_client):
    """Відмова без виходу — глухий кут. Тут вихід є, і він короткий:
    телефон додається спаруванням, код показує ПК."""
    detail = str(
        _add_contact(auth_root_client, compact=PHONE_INVITE).json().get("detail", "")
    ).lower()

    assert "спарув" in detail or "скану" in detail, (
        f"людині сказали «ні» і не сказали куди йти: {detail!r}"
    )


def test_lowercase_and_padded_prefixes_are_caught_too(auth_root_client):
    """Люди вставляють код із пробілом попереду й у будь-якому регістрі."""
    for text in (f"  {PHONE_INVITE}", PHONE_INVITE.replace("PH2:", "ph2:")):
        res = _add_contact(auth_root_client, compact=text)
        assert res.status_code == 400
        assert "телефон" in str(res.json().get("detail", "")).lower(), text


def test_an_ordinary_broken_bundle_still_gets_its_own_refusal(auth_root_client):
    """Зворотний бік: виділивши телефонний випадок, не можна перетворити
    всі відмови на розмову про телефон."""
    res = _add_contact(auth_root_client, compact="це-просто-сміття")

    assert res.status_code == 400
    detail = str(res.json().get("detail", "")).lower()
    assert "телефон" not in detail, (
        "звичайне сміття тепер подається як запрошення з телефона — "
        "це вже інша неправда, у зворотний бік"
    )
