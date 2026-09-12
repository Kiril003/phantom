"""У пакованій збірці двері в локальну мережу відчиняє людина, не продукт.

Виміряно 12.09.2026 на живому пакунку, двічі, незалежно: `158.196.239.126:8443`
слухав на `wlan0` — публічна /21. Згоди ніхто не питав.

Чому цього не спіймав наявний сторож: `_refuse_lan_bind_in_packaged_mode`
(`main.py`) судить `config.host`, тобто ГОЛОВНИЙ HTTP-порт. TLS-слухач і
mDNS-оголошення йдуть власними дорогами повз нього. Це рівно «один if — двоє
дверей», тільки другі двері ширші: слухач сідає на КОЖНУ адресу з
`lan_addresses()`, а mDNS розповідає підмережі імʼя машини, адресу й порт.

Тести нижче судять ФАКТ — що саме слухає на не-петлі, — а не рядок налаштування.
"""
from __future__ import annotations

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

LOOPBACK = {"127.0.0.1", "::1", "0.0.0.0", "::"}


def _listening_non_loopback() -> set[tuple[str, int]]:
    """Сокети ЦЬОГО процесу, що слухають не на петлі. Факт, не намір."""
    import psutil

    out: set[tuple[str, int]] = set()
    for conn in psutil.Process().net_connections(kind="inet"):
        if conn.status != psutil.CONN_LISTEN or not conn.laddr:
            continue
        if conn.laddr.ip not in LOOPBACK:
            out.add((conn.laddr.ip, conn.laddr.port))
    return out


@pytest.mark.asyncio
async def test_packaged_tls_listener_stays_shut_without_consent(monkeypatch):
    from config import config
    from security import tls_listener as tl

    # Під pytest функція виходить раніше за перевірку пакунка — знімаємо цю
    # заглушку, інакше тест доводив би заглушку, а не ворота.
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)
    monkeypatch.delenv("PHANTOM_SKIP_TLS", raising=False)
    monkeypatch.setenv("PHANTOM_PACKAGED", "1")
    monkeypatch.setattr(config, "lan_doors_enabled", False, raising=False)

    # Якби ворота пропустили, ми б дізнались про це тут: сертифікат і бінд —
    # наступні кроки, і обидва мали б впасти в очі.
    called: list[str] = []
    monkeypatch.setattr(
        tl, "lan_addresses", lambda: (_ for _ in ()).throw(
            AssertionError("ворота пропустили: пішли по LAN-адреси")
        )
    )

    before = _listening_non_loopback()
    assert await tl.start_tls_listener(object()) is None, (
        "паковану збірку відчинили в мережу без згоди людини"
    )
    assert _listening_non_loopback() == before, (
        f"зʼявився слухач на не-петлі: {_listening_non_loopback() - before}"
    )
    assert not called


def test_packaged_mdns_stays_silent_without_consent(monkeypatch):
    from config import config
    from discovery import mdns_publisher as mp

    monkeypatch.delenv("PHANTOM_SKIP_MDNS", raising=False)
    monkeypatch.setenv("PHANTOM_PACKAGED", "1")
    monkeypatch.setattr(config, "lan_doors_enabled", False, raising=False)
    monkeypatch.setattr(mp, "_publisher", None, raising=False)
    monkeypatch.setattr(
        mp, "MdnsPublisher", lambda **kw: (_ for _ in ()).throw(
            AssertionError("ворота пропустили: почали оголошення")
        )
    )

    assert mp.start_mdns(port=8000) is False, (
        "пакована збірка оголосила машину в підмережі без згоди"
    )


def test_consent_is_a_setting_the_product_can_persist():
    """Згода мусить жити в налаштуваннях, а не лише в змінній середовища.

    Змінну середовища не поставить людина з вікна продукту, і вона не
    переживе перезапуск. Поле в конфізі переживе і читається назад з бази —
    тобто майбутній перемикач на склі має куди писати.
    """
    from config import config

    assert hasattr(config, "lan_doors_enabled")
    assert config.lan_doors_enabled is False, (
        "двері в мережу відчинені за замовчуванням — рівно те, що ми щойно "
        "лікували"
    )
