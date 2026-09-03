"""Двері для зняття кадрів мусять бути мертві в релізі — структурно.

Навіщо вони. Столи, мапа й смуга організму живуть за замком, і це
правильно: 29.08.2026 я прибрав обхід, що впускав як ROOT без ПІНу від
самої лише адреси. Але «доведено на склі» — єдина форма доказу в цьому
домі, а зняти стіл без ПІНу стало неможливо. Двері `?desk=1` показують
оболонку без входу — і лише в збірці розробника.

Чому це не діра, і що саме стереже цей файл:

1. `import.meta.env.DEV` — НЕ прапорець рантайму, а константа, яку vite
   підставляє на етапі збірки. У прод-бандлі гілка стає `if (false)` і
   вирізається; вмикати в релізі просто нічого. Прапорець у рантаймі
   (env, налаштування, заголовок) був би дірою — його можна виставити.
2. Це не автовхід: токен не зʼявляється, `authenticated` лишається false.
   Видно рівно те, що інтерфейс уміє намалювати сам; будь-який захищений
   виклик однаково впреться в замок.

ЧОГО ЦЕЙ СТОРОЖ НЕ БАЧИТЬ ЗА ПОБУДОВОЮ:
* Він читає ДЖЕРЕЛО, а не зібраний бандл. Що vite справді вирізав гілку —
  окреме твердження; перевіряти його треба пошуком по бандлу, і саме це
  робить другий тест, коли бандл поруч є.
* Він не запускає застосунок. «Двері не відчиняються в релізі» остаточно
  доводиться лише спробою — на зібраному AppImage.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

FRONTEND = Path(__file__).resolve().parents[2] / "frontend"
APP_TSX = FRONTEND / "src" / "app" / "App.tsx"
DIST = FRONTEND / "dist"


def _body() -> str:
    return APP_TSX.read_text("utf-8")


def test_door_is_gated_by_a_build_time_constant():
    body = _body()

    assert "devDeskDoorOpen" in body, (
        "двері зникли — або перейменовані; тоді перейменуй і сторожа, "
        "інакше він мовчки перестане щось стерегти"
    )

    fn = re.search(
        r"function devDeskDoorOpen\(\)[^{]*\{(.*?)\n\}", body, re.S
    )
    assert fn, "не знайшов тіла devDeskDoorOpen — сторож осліп"
    inner = fn.group(1)

    # Перший рядок тіла мусить відсікати все, що не DEV. Не «десь у тілі»,
    # а саме першим: інакше нижче може стояти гілка, що спрацює раніше.
    first = next(ln.strip() for ln in inner.splitlines() if ln.strip())
    assert first == "if (!import.meta.env.DEV) return false;", (
        "перша дія дверей мусить бути відсіченням не-DEV збірки, дослівно "
        f"`if (!import.meta.env.DEV) return false;` — а там: {first!r}"
    )

    # Жодного рантаймового важеля: те, що можна виставити на робочій
    # машині, дверима бути не може.
    for lever in ("process.env", "localStorage", "sessionStorage", "PHANTOM_DEV"):
        assert lever not in inner, (
            f"двері дивляться на {lever} — це рантаймовий важіль, його "
            "можна виставити в релізі; має лишитись лише константа збірки"
        )


def test_door_does_not_authenticate_anyone():
    """Двері показують оболонку, а не видають права."""
    body = _body()
    fn = re.search(r"function devDeskDoorOpen\(\)[^{]*\{(.*?)\n\}", body, re.S)
    assert fn
    inner = fn.group(1)
    for forbidden in ("setUser", "setAuthenticated", "token", "SOVEREIGN"):
        assert forbidden not in inner, (
            f"двері торкаються {forbidden} — це вже автовхід, а не показ "
            "оболонки для кадру"
        )


def test_door_is_absent_from_the_production_bundle():
    """Найважливіше твердження — і воно про АРТЕФАКТ, не про джерело."""
    if not DIST.is_dir():
        pytest.skip("зібраного бандла немає — перевіряти нічого")

    hits = [
        p.name
        for p in DIST.rglob("*.js")
        if "devDeskDoorOpen" in p.read_text("utf-8", errors="ignore")
    ]
    assert not hits, (
        "назва дверей знайшлась у прод-бандлі: " + ", ".join(hits[:3]) + ". "
        "Отже гілку не вирізало — двері поїхали б у реліз. Перевір, що "
        "умова саме `import.meta.env.DEV`, а не рантаймова змінна."
    )
