"""QR має вести на порт, який справді слухають.

Два різні дефекти жили на одному рядку `routes_pair`:

  port=tls_port or getattr(config, "pair_port", 8000)

Поля `pair_port` в конфізі немає — тобто це не запасний варіант, а зашита
вісімка. І гілка жива: `PAIR_TLS_PORT=0` — задокументований спосіб вимкнути
TLS-слухач (`security/tls_listener.py`: `if not port: return None`), після чого
телефону лишається тільки порт uvicorn. Оператор із `PORT=8080` отримував у QR
8000 і бачив «не вдалось підключитись» — помилку, яка ніколи не називає
справжню причину.

Останній тест ловить сам клас: будь-яке `getattr(config, "…")` в модулі паринга
мусить називати поле, яке в конфізі є. Значення за замовчуванням у getattr
перетворює зниклу назву на тиху неправильну відповідь.
"""
from __future__ import annotations

import ast
from pathlib import Path

from api import routes_pair
from config import config


def test_qr_carries_the_tls_port_when_the_listener_is_up(auth_root_client, monkeypatch) -> None:
    monkeypatch.setattr(config, "pair_tls_port", 8443, raising=False)
    monkeypatch.setattr(config, "port", 8000, raising=False)
    resp = auth_root_client.post("/api/v1/pair/init")
    assert resp.status_code == 200, resp.text
    assert resp.json()["qr"]["port"] == 8443


def test_without_tls_the_qr_carries_the_configured_http_port(auth_root_client, monkeypatch) -> None:
    """`PAIR_TLS_PORT=0` + `PORT=8080` мусить дати 8080, а не зашиту 8000."""
    monkeypatch.setattr(config, "pair_tls_port", 0, raising=False)
    monkeypatch.setattr(config, "port", 8080, raising=False)
    resp = auth_root_client.post("/api/v1/pair/init")
    assert resp.status_code == 200, resp.text
    port = resp.json()["qr"]["port"]
    assert port == 8080, f"у QR поїхав порт {port}, якого ніхто не слухає"


def test_short_code_path_answers_with_the_same_port(auth_root_client, monkeypatch) -> None:
    """Вхід за коротким кодом будує той самий QR — і мав ту саму ваду."""
    monkeypatch.setattr(config, "pair_tls_port", 0, raising=False)
    monkeypatch.setattr(config, "port", 8080, raising=False)
    init = auth_root_client.post("/api/v1/pair/init")
    pin = init.json()["pin"]
    resp = auth_root_client.get(f"/api/v1/pair/resolve/{pin}")
    assert resp.status_code == 200, resp.text
    assert resp.json()["port"] == 8080


def test_pair_routes_only_read_config_fields_that_exist() -> None:
    """Ім'я поля, якого немає, — це не запасний варіант, а мовчазна відповідь.

    `getattr(config, "pair_port", 8000)` виглядав як страховка й завжди
    повертав 8000; `getattr(config, "pair_cert_sha256", "")` завжди повертав
    порожній рядок, хоч коментар поруч вимагав ставити його в продакшені —
    тобто телефон вимикав пінінг саме там, де його вмикали.
    """
    src = Path(routes_pair.__file__).read_text(encoding="utf-8")
    names: set[str] = set()
    for node in ast.walk(ast.parse(src)):
        if not isinstance(node, ast.Call):
            continue
        if not (isinstance(node.func, ast.Name) and node.func.id == "getattr"):
            continue
        if len(node.args) < 2:
            continue
        target, attr = node.args[0], node.args[1]
        if not (isinstance(target, ast.Name) and target.id == "config"):
            continue
        if isinstance(attr, ast.Constant) and isinstance(attr.value, str):
            names.add(attr.value)

    assert names, "жодного getattr(config, …) не знайдено — тест перестав щось ловити"
    missing = sorted(n for n in names if not hasattr(config, n))
    assert not missing, (
        f"routes_pair читає поля конфіга, яких немає: {missing}"
    )
