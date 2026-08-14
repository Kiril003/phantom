"""QR має вести на порт, який справді слухають.

У `routes_pair` порт для QR брався так:

  port=getattr(config, "pair_port", 8000)

Поля `pair_port` в конфізі немає й ніколи не було — тобто це не запасний
варіант, а зашита вісімка під виглядом налаштування. Оператор із `PORT=8080`
отримував у QR 8000 і бачив «не вдалось підключитись» — помилку, яка ніколи
не називає справжню причину. Правильне написання лежало в цьому ж файлі:
`_lan_blockers` уже читав `getattr(config, "port", 8000)`.

Поруч жив другий екземпляр того самого: `getattr(config, "pair_cert_sha256", …)`
теж називав неіснуюче поле, хоч коментар над ним вимагав ставити
`PAIR_CERT_SHA256` у продакшені. Змінна оточення мовчки ігнорувалась, у QR
їхало «dev-no-pin», і телефон вимикав пінінг сертифіката саме в тому
розгортанні, заради якого це писали.

Останній тест ловить сам клас: будь-яке `getattr(config, "…")` в модулі
паринга мусить називати поле, яке в конфізі є. Значення за замовчуванням
перетворює зниклу назву на тиху неправильну відповідь.
"""
from __future__ import annotations

import ast
from pathlib import Path

from api import routes_pair
from config import config


def test_qr_carries_the_configured_http_port_not_a_literal(
    auth_root_client, monkeypatch
) -> None:
    """`PORT=8080` мусить дати 8080, а не зашиту 8000.

    `pair_tls_port` збивається в нуль навмисно: це задокументований спосіб
    лишитись без TLS-слухача (`security/tls_listener.py`: `if not port:
    return None`), після чого телефону лишається тільки порт uvicorn.
    """
    monkeypatch.setattr(config, "pair_tls_port", 0, raising=False)
    monkeypatch.setattr(config, "port", 8080, raising=False)
    resp = auth_root_client.post("/api/v1/pair/init")
    assert resp.status_code == 200, resp.text
    port = resp.json()["qr"]["port"]
    assert port == 8080, f"у QR поїхав порт {port}, якого ніхто не слухає"


def test_pair_routes_only_read_config_fields_that_exist() -> None:
    """Ім'я поля, якого немає, — це не запасний варіант, а мовчазна відповідь."""
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
    assert not missing, f"routes_pair читає поля конфіга, яких немає: {missing}"
