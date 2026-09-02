"""Пакунок відкриває рівно одне вікно, і жодне з них не адресується хешем.

Знайдено 30.08 на ЗІБРАНОМУ AppImage, у справжньому WebKitGTK: застосунок
піднімався **двома вікнами**, і обидва показували замок із ПІН-падом.

Механіка була така, і кожна ланка окремо виглядала нешкідливо:
* `tauri.conf.json` оголошував друге вікно `familiar_council`
  (420×650, без рамки, поверх усіх) з адресою `index.html#/council`;
* оголошене вікно Tauri відкриває **завжди** — `visible: false` там не стояло;
* мітку `familiar_council` не згадував ні фронт, ні Rust: показати чи сховати
  його не міг ніхто;
* маршруту `/council` не існує ніде в дереві;
* а головне — застосунок на `BrowserRouter` (`App.tsx`), тобто **хеш роутер
  ігнорує повністю**. Тож `#/council` не «веде не туди», він не веде нікуди:
  шлях лишається `/`, і друге вікно малює звичайний застосунок, тобто замок.

Наслідок для людини: продукт стартує двома вікнами, обидва просять ПІН.
Наслідок для машини: другий WebView — це ДРУГА повна копія застосунку, з
власним підключенням до ядра й власним опитуванням.

Чому цього не бачив жоден із 906 тестів: вони живуть у jsdom і в chromium, а
вікна оголошені в конфізі оболонки. Кімнату, у якій ця хвороба буває, не
міряв ніхто — див. дев'ятий закон дому.

Сторож перевіряє КЛАС, а не цей випадок:
  1. скільки вікон відкриється на старті;
  2. чи не адресується котресь із них хешем при `BrowserRouter`.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

TAURI_DIR = Path(__file__).resolve().parents[2] / "frontend" / "src-tauri"
CONF = TAURI_DIR / "tauri.conf.json"
APP_TSX = Path(__file__).resolve().parents[2] / "frontend" / "src" / "app" / "App.tsx"


def _windows() -> list[dict]:
    if not CONF.is_file():
        pytest.skip("tauri.conf.json недоступний")
    cfg = json.loads(CONF.read_text())
    section = cfg.get("app") or cfg.get("tauri") or {}
    return section.get("windows", [])


def test_package_opens_exactly_one_window_at_startup():
    """Кожне зайве вікно — це друга копія застосунку перед очима людини."""
    startup = [w for w in _windows() if w.get("visible") is not False]
    labels = [w.get("label") for w in startup]
    assert len(startup) == 1, (
        f"на старті відкриється вікон: {len(startup)} — {labels}.\n"
        "Оголошене вікно Tauri відкриває ЗАВЖДИ. Якщо вікно потрібне лише за\n"
        "запитом — створюй його з Rust (`WebviewWindowBuilder`) у мить, коли\n"
        "воно справді знадобилось, або постав `\"visible\": false`.\n"
        "Друге вікно — це другий WebView, тобто друга копія застосунку з\n"
        "власним зʼєднанням до ядра."
    )


def test_no_window_is_addressed_by_hash_while_the_app_uses_browserrouter():
    """Хеш при `BrowserRouter` не веде не туди — він не веде нікуди."""
    if not APP_TSX.is_file():
        pytest.skip("App.tsx недоступний")
    uses_browser_router = "BrowserRouter" in APP_TSX.read_text()
    if not uses_browser_router:
        pytest.skip("застосунок більше не на BrowserRouter — правило не діє")

    hashed = [
        (w.get("label"), w.get("url"))
        for w in _windows()
        if "#" in (w.get("url") or "")
    ]
    assert not hashed, (
        f"вікна адресуються хешем при BrowserRouter: {hashed}.\n"
        "Роутер хеш ІГНОРУЄ: шлях лишається '/', і вікно мовчки малює головний\n"
        "екран замість наміченого. Помилки не буде — буде не той екран.\n"
        "Або переходь на HashRouter, або став справжній шлях в url."
    )

def test_csp_keeps_eval_shut():
    """`unsafe-eval` не має з'явитися в CSP пакунка непомітно.

    30.08 у месенджері знайдено `new Function(...)` на коді з віджета
    (`CodeRunnerWidgetEmbed`). У пакунку він **не виконується** — CSP Tauri
    містить `script-src 'self'` без `unsafe-eval`, тож рушій кидає `EvalError`.
    Тобто нас тримає не код віджета, а один рядок конфіга.

    ЧОГО ЦЕЙ СТОРОЖ НЕ ДОВОДИТЬ, і це важливо не переказати ширше:
    він доводить, що **дозволу немає в конфізі**, а не що людина побачила
    відмову на склі. Другого в контейнері не перевірити взагалі: CSP додає
    РАНТАЙМ Tauri у заголовки власного протоколу, а в зібраному `index.html`
    його немає жодною згадкою — тобто той самий файл, відкритий звичайним
    WebKit, виконав би все вільно й дав би ХИБНЕ червоне. Спостерегти
    справжню відмову можна лише в запущеному застосунку, а екран, де живе
    віджет, — за ПІНом власника. Це названий борг, не забутий.
    """
    ws = _windows()  # переконуємось, що конфіг узагалі читається
    assert ws, "конфіг Tauri порожній — сторож нічого не стереже"

    cfg = json.loads(CONF.read_text())
    section = cfg.get("app") or cfg.get("tauri") or {}
    csp = (section.get("security") or {}).get("csp") or ""
    assert csp, (
        "CSP у конфізі порожній. Без нього `new Function` у віджеті коду "
        "виконуватиметься в контексті головного вікна застосунку."
    )
    assert "unsafe-eval" not in csp, (
        f"у CSP з'явився `unsafe-eval`:\n  {csp}\n"
        "Це вмикає `new Function` та `eval` у всьому застосунку. У месенджері "
        "є віджет, який виконує код саме так — доти його тримав лише цей рядок."
    )
