"""Чи обіцяє конверт спарування той TLS, якого немає.

Знайдено 29.08.2026, коли я готував конверт для доведення нитки. Вузол було
піднято з `PHANTOM_SKIP_TLS=1` — слухача на порту пари немає — а `/pair/init`
усе одноклав у конверт **справжній відбиток сертифіката** і адресу
`https://…:8443`.

Причина: відбиток брався з наявності ФАЙЛА (`fingerprint or config… or
"dev-no-pin"`), а файл сертифіката створюється незалежно від того, чи слухач
піднявся. Тобто сентинел «без пінінгу» не спрацьовував ніколи.

Наслідок на пристрої: телефон перемикається на https за цим полем
(`PairingQr.kt` — «toggles the request URL's scheme based on
server_cert_sha256»), прибивається до відбитка й іде на порт, якого ніхто не
слухає. Провал виглядає як мережева проблема, а не як «TLS вимкнено» — і саме
це найдорожче: шукати будуть не там.

Родина та сама, що переслідує проект: **файл існує ≠ слухач живий**.

Лікування: оголошення тепер залежить від `tls_listener.bound` — від того, чи
слухач СТАВ на інтерфейс, а не від того, чи лежить файл. Обидва маршрути, що
складають конверт (`/pair/init` і `/pair/resolve/{pin}`), ходять через один
`_tls_advertisement`, тож розійтися не можуть.

ЦІ ТЕСТИ ЧЕРВОНІЮТЬ НА СТАРОМУ КОДІ — прогнано.
"""
from __future__ import annotations

import pytest


@pytest.fixture
def qr(auth_root_client):
    response = auth_root_client.post("/api/v1/pair/init", json={})
    assert response.status_code == 200, response.text
    return response.json()["qr"]


def test_without_a_live_listener_the_envelope_admits_it(qr):
    """Немає слухача — немає й обіцянки пінінгу.

    У тестовому оточенні слухач TLS не піднімається, тож це і є той випадок,
    заради якого сентинел існує.
    """
    assert qr["server_cert_sha256"] == "dev-no-pin", (
        f"конверт обіцяє відбиток {qr['server_cert_sha256'][:16]}…, "
        "хоча слухача немає"
    )


def test_no_https_endpoint_is_advertised_when_nothing_serves_it(qr):
    """Адреса, за якою ніхто не відповідає, гірша за відсутність адреси:
    телефон піде саме туди й звинуватить мережу."""
    for endpoint in qr.get("endpoints", []):
        assert not str(endpoint.get("url", "")).startswith("https://"), (
            f"оголошено {endpoint['url']}, якого ніхто не слухає"
        )


def test_the_advertised_port_is_the_one_that_answers(qr):
    """Порт у конверті мусить бути тим, який справді відповідає.

    Раніше туди їхав `pair_tls_port` із конфіга — число, яке означало намір,
    а не факт.
    """
    from api.routes_pair import _plain_http_port

    assert qr["port"] == _plain_http_port()


def test_both_envelope_routes_share_one_helper():
    """Сторож на СПОСІБ.

    Конверт складають два маршрути. Доки логіка жила двома копіями, вони
    розійшлись би при першій же правці однієї — саме так і сталося з
    `messages` у месенджері того ж дня.
    """
    import inspect

    from api import routes_pair

    source = inspect.getsource(routes_pair)
    assert source.count("async def _tls_advertisement(") == 1
    assert source.count("await _tls_advertisement(request, lan_ip)") == 2, (
        "очікувано рівно два викликачі: /pair/init і /pair/resolve"
    )
    # Стара умова не має відродитись у жодному з них.
    assert 'or "dev-no-pin"' not in source, (
        "сентинел знову залежить від наявності файла, а не від живого слухача"
    )


def test_liveness_is_read_from_the_listener_not_from_a_file():
    """Питання мусить лишитись «чи слухає», а не «чи є файл»."""
    import inspect

    from api.routes_pair import _tls_is_live

    source = inspect.getsource(_tls_is_live)
    assert "tls_listener" in source and "bound" in source, (
        "перевірка живості більше не дивиться на слухача"
    )
