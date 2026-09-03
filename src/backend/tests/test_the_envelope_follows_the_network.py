"""Конверт QR мусить нести адресу, ЖИВУ В МИТЬ запиту.

Виміряно 03.09.2026 Сесією 6: мережа машини змінилась під живим вузлом —
`192.168.137.0/24` зникла, wlan0 став `158.196.237.8/21`. Вузол не
перезапускали. Якби конверт ніс адресу, запамʼятовану на старті, QR вів би
в мертву мережу, а провал виглядав би як «телефон не бачить компʼютер» —
шукали б у Wi-Fi, у фаєрволі, у чому завгодно, крім справжньої причини.

Ці сторожі тримають три речі:
  * адреса в конверті береться СВІЖОЮ на кожен /pair/init, без перезапуску;
  * у `endpoints` їдуть УСІ придатні адреси, а не одна вгадана;
  * `/health` каже, де слухає TLS зараз.

Про сертифікат — окремо, бо це питання ставили як дефект, а він ним не є.
Сертифікат вузла створено на старі адреси (SAN: 127.0.0.1,
192.168.137.175), і при зміні IP він НЕ перевидається. Це нічого не ламає:
телефон закріплює виключно ВІДБИТОК — `PinnedTrust.SinglePinTrustManager`
звіряє sha256 листа, а `hostnameVerifier` там `{ _, _ -> true }`, тобто
SAN не перевіряється взагалі. Єдина істина — відбиток, і саме він мусить
збігатися; перевидавати сертифікат на кожну зміну адреси означало б
міняти відбиток і ламати вже спаровані телефони.
"""
from __future__ import annotations

import os

import pytest

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-envelope-net")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-key")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


def test_the_envelope_is_built_from_live_addresses_not_startup_ones(monkeypatch):
    """Зміна адреси інтерфейсу видно в конверті БЕЗ перезапуску."""
    from api import routes_pair

    monkeypatch.setattr(routes_pair, "_name_resolves", lambda: False)
    monkeypatch.setattr(routes_pair, "_relay_endpoint", lambda: None)

    import security.tls_listener as tls

    monkeypatch.setattr(tls, "lan_addresses", lambda: ["192.168.137.175"])
    host_before, eps_before = routes_pair._addressing(8443, "192.168.137.175")

    # Мережа змінилась. Вузол той самий, процес той самий.
    monkeypatch.setattr(tls, "lan_addresses", lambda: ["158.196.237.8"])
    host_after, eps_after = routes_pair._addressing(8443, "158.196.237.8")

    urls_before = [e["url"] for e in eps_before]
    urls_after = [e["url"] for e in eps_after]

    assert "https://192.168.137.175:8443" in urls_before
    assert "https://158.196.237.8:8443" in urls_after
    assert "https://192.168.137.175:8443" not in urls_after, (
        "конверт несе адресу, якої в машини вже немає — QR веде в мертву "
        "мережу, і провал виглядатиме як «телефон не бачить компʼютер»"
    )


def test_all_usable_addresses_ride_not_just_one(monkeypatch):
    """Одна вгадана адреса — це ставка. Телефон пробує кандидатів по черзі,
    тож дешевше дати всі, ніж угадати."""
    from api import routes_pair

    monkeypatch.setattr(routes_pair, "_name_resolves", lambda: False)
    monkeypatch.setattr(routes_pair, "_relay_endpoint", lambda: None)

    import security.tls_listener as tls

    monkeypatch.setattr(tls, "lan_addresses", lambda: ["10.0.0.5", "158.196.237.8"])

    _, endpoints = routes_pair._addressing(8443, "10.0.0.5")
    urls = [e["url"] for e in endpoints]

    assert "https://10.0.0.5:8443" in urls
    assert "https://158.196.237.8:8443" in urls


def test_health_says_where_tls_listens_now():
    from fastapi.testclient import TestClient

    from main import app

    body = TestClient(app).get("/health").json()

    assert "tls_listening" in body, (
        "де слухає TLS, можна було дізнатись лише через `ss` — а QR веде саме туди"
    )
    for field in ("bound", "port", "enabled"):
        assert field in body["tls_listening"]


def test_the_phone_pins_the_fingerprint_not_the_hostname():
    """Доводимо, ЧОМУ застаріле SAN не є дефектом — джерелом телефона, а не
    припущенням. Якщо телефон колись почне звіряти хост, цей сторож
    почервоніє, і рішення про перевидачу сертифіката доведеться ухвалити
    свідомо, а не виявити на склі."""
    from pathlib import Path

    kotlin = (
        Path(__file__).resolve().parents[4]
        / "phantom-companion-drop"
        / "core-net/src/main/java/local/phantom/companion/core/net/pair/PinnedTrust.kt"
    )
    if not kotlin.is_file():
        pytest.skip("телефонного дерева поруч немає — звіряти нічого")

    src = kotlin.read_text(encoding="utf-8")
    assert "hostnameVerifier { _, _ -> true }" in src, (
        "телефон почав звіряти хост — тоді сертифікат вузла треба перевидавати "
        "при кожній зміні IP, а це міняє відбиток і ламає спаровані апарати"
    )
    assert "SinglePinTrustManager" in src
