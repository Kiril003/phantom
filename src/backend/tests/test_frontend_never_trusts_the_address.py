"""Фронт не має права робити висновки з того, за якою адресою його відкрили.

Два дефекти одного кореня, обидва знайдені 29.08.2026 на живому AppImage,
жоден не видно ні з коду, ні з тестів — лише запуском запакованого продукту.

1. ВХІД. `authStore.autoLogin` впускав користувача, якщо хост НЕ той, на
   якому в розробці сидить бекенд. У пакунку фронт віддається
   asset-протоколом Tauri, тож умова істинна ЗАВЖДИ: вікно відкрилось —
   і оболонка сама себе впустила як `sovereign_root` з роллю ROOT на рік,
   без ПІНу. Гейта на розробку там не було, хоча рядком вище автор його
   поставив. Межа: `'sovereign_token'` бекенду невідомий (нуль збігів по
   Python), тож це обхід замка в інтерфейсі, а не підвищення прав на
   сервері — але замок і є те, що продукт обіцяє.

2. ЗВ'ЯЗОК. Адреси WebSocket будувались від `window.location`, який в
   asset-протоколі вказує не на sidecar. Наслідок на екрані: «канал обрив /
   ядро мовчить / ресурси мовчить» при HTTP 200 і англійський DOMException
   «The string did not match the expected pattern.» у пейні діалогу.

Тому сторож ловить ВЗІРЕЦЬ, а не рядок: будь-яке рішення від
`window.location` у входу й у побудові адрес до бекенда. Інакше наступний
файл повторить це через тиждень, і дізнаємось ми знову з екрана власника.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

FRONTEND = Path(__file__).resolve().parents[2] / "frontend"
SRC = FRONTEND / "src"

# Місця, яким `window.location` дозволений, бо вони саме про сторінку, а не
# про бекенд: маршрутизація, поточний URL для показу, редиректи всередині
# застосунку. Список навмисно короткий — кожен запис має бути виправданим.
ALLOWED_SUFFIXES = (
    "src/services/backendOrigin.ts",  # типізований доступ до єдиного джерела
    # Стенд vitest: підставляє джерело адреси в jsdom, де скрипта з `public/`
    # немає. Його `ws()` навмисно бере `window.location` — у тестовому
    # середовищі пакунка не існує, і саме так поводиться браузер у розробці.
    # У продукт не потрапляє: єдина згадка — `setupFiles` у vite.config.ts,
    # жоден модуль його не імпортує (перевірено пошуком).
    # У борги його класти не можна: список із недефектами вчить читача, що
    # список — формальність.
    "src/test-setup.ts",
)

# Борг із іменем власника. Ці файли ще будують адреси від `window.location`;
# їх переводить Чат 1 (месенджер) — див. домовленість зі штабом 29.08.
# Список має тільки СКОРОЧУВАТИСЬ. Новий файл сюди не дописуємо: якщо
# вписати — сторож перестане бути сторожем.
# 29.08.2026 — борг погашено, список порожній.
#   messengerNetworkEngine.ts → `wsUrl('/ws')`;
#   useVoiceAlwaysOn.ts       → `directWsUrl('/ws/voice')`.
# Голосовому шляху таки потрібен `location.hostname` у розробці (пряма адреса
# має вести на ту машину, з якої відкрито сторінку, а не на 127.0.0.1 із
# джерела). Цю єдину потребу перенесено в `backendOrigin.ts` — модуль, якому
# `window.location` дозволено, — замість того щоб послабити цього сторожа.
# Порожній список тримати порожнім: новий запис сюди означає, що сторож
# перестав бути сторожем.
KNOWN_DEBT: set[str] = set()

# `src/utils/messengerInvite.ts:188` теж бере `window.location.origin`, але
# там це ПРАВИЛЬНО: адреса йде в текст запрошення, тобто описує сторінку, а
# не спосіб достукатись до бекенда. Тримати його в боргах означало б
# привчати читача, що записи в цьому списку — формальність. У пакунку той
# рядок дасть адресу asset-протоколу, і це вже питання змісту запрошення,
# а не зв'язку; передано власнику окремо.

LOCATION_FOR_BACKEND = re.compile(
    r"window\.location\.(host|href|hostname|origin)",
)

# Другий бік тієї самої монети: відносний `fetch('/api/…')`. У розробці він
# працює, бо vite проксує; у пакунку йде на asset-протокол Tauri, тобто в
# нікуди. Виміряно 29.08.2026 на зібраному AppImage: бекенд віддавав рівно
# одного користувача, а екран входу малював чотирьох — бо `picker()` падав
# і спрацьовував демо-фолбек.
RELATIVE_API_FETCH = re.compile(r"""fetch\(\s*[`'"]/api/""")

# Файли, де це ще лишилось. Клієнт `services/api.ts` переведено; ці ходять
# повз нього прямим `fetch`. Список має тільки СКОРОЧУВАТИСЬ.
#
# Кожен запис перевірено ЗМІСТОМ, а не взірцем: у кожному справді стоїть
# `fetch('/api/v1/…')` у коді, і кожен зламається в пакунку. `services/api.ts`
# у списку НЕМАЄ — там єдиний збіг лежить у коментарі, який пояснює саме цей
# дефект, а коментарі сторож вирізає. Правило дому: список із недефектами
# вчить читача, що список — формальність.
#
# 30.08.2026 — шість записів погашено: `artifactBroker.ts`,
# `SceneArtifactPanel.tsx`, `StandingOrdersOverlay.tsx`, `Overlays.tsx`,
# `BackupRestoreCard.tsx`, `WillPanel.tsx` — усі девʼять викликів тепер ідуть
# через `apiUrl()` з `services/backendOrigin.ts`.
RELATIVE_API_DEBT = {
    "src/services/messengerMedia.ts",  # територія Чата 1
}


def _ts_sources() -> list[Path]:
    return [
        p
        for p in SRC.rglob("*.ts*")
        if "__tests__" not in p.parts and not p.name.endswith(".d.ts")
    ]


def _strip_comments(text: str) -> str:
    """Коментарі — не код. Сторож, що падає на поясненні прибраного, —
    це вже двічі траплялось у домі за один день."""
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    return re.sub(r"^\s*//.*$", "", text, flags=re.M)


def test_login_never_depends_on_the_address():
    """Немає токена → екран входу. Незалежно від того, звідки відкрито."""
    body = _strip_comments((SRC / "stores" / "authStore.ts").read_text("utf-8"))

    assert "location.host" not in body, (
        "вхід знову дивиться на адресу — саме так релізний AppImage "
        "впускав себе як ROOT без ПІНу"
    )

    # Суверенного користувача можна лишати тільки під явним прапорцем
    # розробки або під ознакою іншого продукту — але ніколи під адресою.
    for match in re.finditer(r"SOVEREIGN_OPERATOR_USER", body):
        window = body[max(0, match.start() - 400) : match.start()]
        if "export const" in window[-40:]:
            continue  # саме оголошення константи
        assert (
            "import.meta.env.DEV" in window
            or "PhantomCompanion" in window
        ), (
            "SOVEREIGN_OPERATOR_USER видається без явної ознаки розробки "
            "чи компаньйона — це знову автовхід найвищою роллю"
        )


@pytest.mark.parametrize("path", [p for p in _ts_sources()], ids=lambda p: p.name)
def test_backend_addresses_come_from_one_place(path: Path):
    """`window.location` не може бути джерелом адреси бекенда."""
    rel = path.relative_to(FRONTEND).as_posix()
    if any(rel.endswith(s) for s in ALLOWED_SUFFIXES):
        pytest.skip("єдине джерело адреси — йому можна")
    if rel in KNOWN_DEBT:
        pytest.xfail(f"відомий борг, власник — Чат 1: {rel}")

    body = _strip_comments(path.read_text("utf-8"))
    hits = [m.group(0) for m in LOCATION_FOR_BACKEND.finditer(body)]
    if not hits:
        return

    # Дозволяємо лише там, де поруч немає ознак звернення до бекенда.
    assert not re.search(r"(ws://|wss://|/ws\b|/api/|WebSocket\()", body), (
        f"{rel} будує адресу до бекенда від window.location. "
        "У пакунку це вказує не на sidecar — бери адресу з "
        "services/backendOrigin.ts (wsUrl / apiUrl)."
    )


@pytest.mark.parametrize("path", [p for p in _ts_sources()], ids=lambda p: p.name)
def test_http_calls_go_through_the_one_place(path: Path):
    """Відносний `fetch('/api/…')` у пакунку не доходить до бекенда."""
    rel = path.relative_to(FRONTEND).as_posix()
    if any(rel.endswith(s) for s in ALLOWED_SUFFIXES):
        pytest.skip("єдине джерело адреси — йому можна")
    if rel in RELATIVE_API_DEBT:
        pytest.xfail(f"відомий борг: прямий fetch повз клієнта — {rel}")

    body = _strip_comments(path.read_text("utf-8"))
    assert not RELATIVE_API_FETCH.search(body), (
        f"{rel} робить відносний fetch на /api. У запакованому застосунку "
        "він іде на asset-протокол Tauri, а не на sidecar — виклик просто "
        "не доходить. Бери адресу з services/backendOrigin.ts (apiUrl) або "
        "ходи через services/api.ts."
    )
