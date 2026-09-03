"""Стик `read_file` → модель: чотири обіцянки, і кожна вміє почервоніти.

Модуль `tools/document_text.py` існує заради ОДНОГО: щоб модель не діставала
base64 замість змісту, бо тоді вона переказує документ, якого не бачила.
Сторож `test_document_text_guard.py` перевіряє РОЗБИРАЧ. Тут перевіряється
СТИК — те, що підставляється між побайтовою читалкою і промптом, — бо саме
там обіцянка ламалась, поки розбирач лишався зеленим:

  1. двійкове, чийого розширення немає в списку (.docm, .xls, .odp, .epub) і
     файл БЕЗ розширення доїжджали до моделі як base64;
  2. RTF ніколи не доходив до striprtf: це ASCII без нулів, тож читалка звала
     його текстом і стик виходив на першому ж рядку — модель бачила сиру
     розмітку `{\\rtf1...}`;
  3. обрізання тексту було мовчазне, а сусіднє поле `truncated` у тій самій
     відповіді казало False;
  4. стик перевідкривав файл і читав його ЦІЛКОМ (85 МБ → 525 МБ RSS), а
     `asyncio.wait_for` не міг цього перервати, бо робота синхронна всередині
     корутини — цикл подій стояв разом із вебсокетом, голосом і кадром.

Кожен тест тут ходить через СПРАВЖНІЙ `_tool_read_file` (а отже й через
`file_manager.read_file`), а не через підставлений словник: підстановка
словника і є те місце, де попередній сторож не бачив дефектів 1, 2 і 4.
"""
from __future__ import annotations

import asyncio
import re
import time
import zipfile

import pytest

import ai.tool_executor as te
from ai.chat_tools import get_tool_schema
from ai.tool_executor import _tool_read_file, execute_tool
from tools import document_text
from tools.file_manager import read_file as _raw_read

# Стелі беремо з коду, а не з голови: якщо їх там ще немає, тест однаково
# мусить уміти почервоніти — тому значення за замовчуванням, а не ImportError
# на збиранні (він пофарбував би в червоне геть усе, зокрема й непричетне).
LIMIT_CHARS: int = getattr(te, "DOC_TEXT_MAX_CHARS", 200_000)
LIMIT_BYTES: int = getattr(te, "DOCUMENT_MAX_BYTES", 16 * 1024 * 1024)

USER = "seam-test-user"


async def _read(path) -> dict:
    """Те саме, що робить модель: інструмент read_file на справжньому файлі."""
    return await _tool_read_file({"path": str(path)}, USER)


# ── допоміжні справжні файли ──────────────────────────────────────────────────

_DOCX_HEAD = (
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.'
    'org/wordprocessingml/2006/main"><w:body>'
)


def _write_docx(path, paragraphs: list[str]) -> None:
    body = "".join(f"<w:p><w:r><w:t>{t}</w:t></w:r></w:p>" for t in paragraphs)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(
            "[Content_Types].xml",
            '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/'
            'package/2006/content-types"/>',
        )
        z.writestr("word/document.xml", _DOCX_HEAD + body + "</w:body></w:document>")


_RTF_LINE = "Договір оренди № 17. Сума: 48000 грн."


def _write_rtf(path, line: str = _RTF_LINE) -> None:
    """Справжній RTF так, як його пише Word: ASCII, кирилиця через \\uN?."""
    body = "".join(c if ord(c) < 128 else f"\\u{ord(c)}?" for c in line)
    path.write_text(
        "{\\rtf1\\ansi\\ansicpg1251\\deff0{\\fonttbl{\\f0 Times New Roman;}}"
        "\\f0\\fs24 " + body + "}",
        encoding="ascii",
    )


def _slow_extract(seconds: float, text: str = "зміст документа"):
    """Розбирач, що працює РІВНО стільки — синхронно, як справжній."""

    def _fn(path, **kwargs):
        time.sleep(seconds)
        return document_text.Extracted(text, "тест", None)

    return _fn


# ── дефект 1: двійкове не їде в модель як base64 ──────────────────────────────

@pytest.mark.parametrize(
    "name",
    [
        "макрос.docm",       # Word із макросами — звичайний шаблон у діловодстві
        "стара_книга.xls",   # стара книга Excel
        "презентація.odp",   # ODF-презентація
        "книга.epub",
        "договір",           # БЕЗ розширення — те, що приходить у месенджері
        "дамп.чогось_нового",  # формат, якого ще ніхто не бачив
    ],
)
async def test_двійкове_не_доїжджає_до_моделі_як_base64(name, tmp_path):
    """Список форматів завжди відставатиме — тож правило перевернуте.

    Не «ці розширення не можна», а «двійкове не їде в модель узагалі, крім
    того, що вдалося перетворити на текст». Це закриває і невідомий формат, і
    файл без розширення одним реченням, а не переліком.
    """
    p = tmp_path / name
    p.write_bytes(b"PK\x03\x04\x00\x14binary-noise\x00\xff" * 64)
    out = await _read(p)
    assert "content_base64" not in out, f"{name}: base64 доїхав до моделі"
    assert out.get("kind") in ("document", "unreadable"), out.get("kind")
    if out.get("kind") == "unreadable":
        assert out.get("reason"), "відмова без причини читається як «там нічого»"
        assert out.get("say_it"), "моделі не сказано, що про це говорять уголос"


# ── дефект 2: RTF доходить до striprtf ────────────────────────────────────────

async def test_rtf_доходить_до_розбирача_а_не_сира_розмітка(tmp_path):
    """RTF — ASCII без нулів, тож читалка зве його ТЕКСТОМ.

    Стик виходив на першому ж рядку (`kind != binary` → return), і модель
    діставала `{\\rtf1\\ansi...}`. Документ мусить упізнаватись ЗА ІМЕНЕМ,
    незалежно від того, назвала його читалка текстом чи двійковим.
    """
    p = tmp_path / "оренда.rtf"
    _write_rtf(p)
    # Вимір передумови: якщо читалка колись почне звати RTF двійковим, цей
    # тест мусить це показати, а не тихо перевіряти щось інше.
    assert _raw_read(path=str(p))["kind"] == "text", "передумова змінилась"

    out = await _read(p)
    assert "rtf1" not in str(out.get("content", "")), "сира розмітка RTF доїхала до моделі"
    assert out.get("kind") == "document", f"RTF не дійшов до розбирача: {out.get('kind')}"
    assert out.get("extractor") == "striprtf"
    assert "48000" in out.get("text", ""), "текст договору не витягнуто"
    assert "Договір оренди" in out["text"]


# ── дефект 3: обрізання називає себе, truncated не бреше ──────────────────────

_LAST = "ОСТАННІЙ ПУНКТ: договір розривається в односторонньому порядку"


async def test_обрізання_називає_себе_і_truncated_не_бреше(tmp_path):
    """Той самий дефект, лише зсунутий з формату на межу.

    Було: 229 164 символи → chars=200000, обрив посеред слова, reason=None і
    в тій самій відповіді `truncated: False` (поле від побайтової читалки,
    від ліміту 1 МіБ). Модель переказує документ як повний.
    """
    filler = "Сторона зобовʼязується виконати умови цього договору сумлінно. " * 4
    count = LIMIT_CHARS // len(filler) + 40
    _write_docx(
        tmp_path / "великий.docx",
        [f"Пункт {i}. {filler}" for i in range(count)] + [_LAST],
    )
    out = await _read(tmp_path / "великий.docx")

    assert out.get("kind") == "document", out
    assert _LAST not in out["text"], "передумова: документ мав НЕ влізти цілком"
    assert out.get("truncated") is True, "truncated бреше: текст обрізано, а поле каже False"
    assert out.get("truncation"), "обрізання не назвало себе словами"
    assert out.get("say_it"), "моделі не сказано, що казати людині про обрив"
    assert out.get("chars") == len(out["text"]), "chars не збігається з тим, що поїхало"


async def test_документ_що_вліз_не_каже_ніби_обрізаний(tmp_path):
    """Дзеркало: сторож мусить уміти сказати «ні», інакше він каже «так» завжди."""
    _write_docx(tmp_path / "маленький.docx", ["Один короткий абзац.", _LAST])
    out = await _read(tmp_path / "маленький.docx")
    assert out.get("kind") == "document", out
    assert out.get("truncated") is False, out.get("truncated")
    assert not out.get("truncation")
    assert _LAST in out["text"]


# ── дефект 4: стеля на розмір і вільний цикл подій ────────────────────────────

async def test_велетень_навіть_не_відкривається_розбирачем(tmp_path, monkeypatch):
    """`read_file` читає 1 МіБ, а стик перевідкривав шлях і читав файл ЦІЛКОМ.

    Заміряно: 85 400 441 Б → читалка віддала truncated=True за 0,00 с, а стик
    прочитав усе за 1,31 с із піком RSS 525 МБ. Доводимо не «швидко», а те, що
    розбирача НЕ ПОКЛИКАНО: стеля стоїть перед роботою, а не після неї.
    """
    p = tmp_path / "велетень.pdf"
    with p.open("wb") as fh:
        fh.write(b"%PDF-1.4\n\x00")
        fh.truncate(LIMIT_BYTES + 1024 * 1024)  # розріджений — місця не займає

    called: list = []
    real = document_text.extract
    monkeypatch.setattr(
        document_text,
        "extract",
        lambda *a, **kw: (called.append(a), real(*a, **kw))[1],
    )
    out = await _read(p)

    assert not called, "розбирача покликано на файлі понад стелю — стелі немає"
    assert out.get("kind") == "unreadable", out.get("kind")
    assert "content_base64" not in out
    assert "МіБ" in (out.get("reason") or ""), f"стеля не названа: {out.get('reason')}"
    assert out.get("say_it")


async def test_розбір_не_тримає_цикл_подій(tmp_path, monkeypatch):
    """Стороннє серцебиття — єдиний доказ, що цикл вільний.

    Заміряно на теперішньому коді end-to-end: 1 удар замість ~51. Разом із
    циклом стояли вебсокет, голос і кадр — тобто «інструмент читає файл»
    означало «система не дихає».
    """
    _write_docx(tmp_path / "повільний.docx", ["коротко"])
    monkeypatch.setattr(document_text, "extract", _slow_extract(0.5))

    beats = 0

    async def _heart() -> None:
        nonlocal beats
        while True:
            await asyncio.sleep(0.01)
            beats += 1

    task = asyncio.create_task(_heart())
    await asyncio.sleep(0.05)  # хай серце справді почне бити
    before = beats
    t0 = time.monotonic()
    out = await execute_tool("read_file", {"path": str(tmp_path / "повільний.docx")}, USER)
    elapsed = time.monotonic() - t0
    task.cancel()

    got = beats - before
    assert out.get("ok") is True, out
    assert elapsed >= 0.4, "розбирач не відпрацював — вимір ні про що"
    assert got >= 20, (
        f"цикл подій стояв: {got} ударів стороннього серця за {elapsed:.2f} с "
        f"(мало бути ~{int(elapsed / 0.01)})"
    )


async def test_таймаут_справді_ріже(tmp_path, monkeypatch):
    """`asyncio.wait_for(handler, 30)` не може перервати синхронну роботу.

    Відтворено з timeout_s=0.2: результат прийшов за 2,58 с — тобто стеля
    часу існувала лише на папері.
    """
    _write_docx(tmp_path / "довгий.docx", ["коротко"])
    monkeypatch.setattr(document_text, "extract", _slow_extract(1.0))

    t0 = time.monotonic()
    out = await execute_tool(
        "read_file", {"path": str(tmp_path / "довгий.docx")}, USER, timeout_s=0.2
    )
    elapsed = time.monotonic() - t0

    assert out.get("error_kind") == "timeout", out
    assert elapsed < 1.0, f"таймаут 0,2 с повернувся аж за {elapsed:.2f} с"


# ── дефект 5: опис інструмента — правда ───────────────────────────────────────

def test_опис_інструмента_не_обіцяє_чого_немає():
    """Опис їде в модель як контракт. Обіцяв RTF (гілка була мертва) і «ліміт
    1 МіБ» (для документів його не було зовсім). Числа беруться з констант —
    щоб зміна стелі не могла лишити опис брехливим."""
    d = (get_tool_schema("read_file") or {}).get("description", "")
    assert d, "інструмент read_file зник зі схеми"
    assert f"{LIMIT_BYTES // (1024 * 1024)} МіБ" in d, "стеля на документ не названа"
    assert f"{LIMIT_CHARS:,}".replace(",", " ") in d, "стеля на символи не названа"
    assert "truncated" in d, "моделі не сказано, як виглядає обрив"
    assert "base64" in d, "моделі не сказано, що двійкове до неї не їде"


# ── стик і розбирач кажуть про обрив ОДНЕ, і жоден не з'їдає іншого ───────────

SLACK: int = getattr(te, "_TRUNCATION_NOTE_SLACK", 512)

_MARKER = "[показано 200000 символів із 229164 — далі обрізано, не переказуй документ як повний]"


def _fake_extract(text: str, truncated: bool):
    return lambda path, **kwargs: document_text.Extracted(text, "тест", None, truncated=truncated)


async def test_рядок_розбирача_про_обрив_доїжджає_до_моделі(tmp_path, monkeypatch):
    """Розбирач дописує в кінець тексту «показано N символів із M».

    Він цінніший за моє сусіднє поле: модель читає його В ТОМУ САМОМУ рядку,
    що й зміст, і бачить справжнє M. Мій ніж стояв рівно на стелі й зрізав
    його разом із хвостом тіла — тобто сильніша з двох правд гинула на стику.
    """
    _write_docx(tmp_path / "з_маркером.docx", ["коротко"])
    monkeypatch.setattr(
        document_text,
        "extract",
        _fake_extract("я" * LIMIT_CHARS + "\n\n" + _MARKER, True),
    )
    out = await _read(tmp_path / "з_маркером.docx")

    assert out.get("truncated") is True
    assert _MARKER in out.get("text", ""), "розбирач сказав про обрив, а стик це зрізав"
    assert out.get("truncation"), "власне поле стику теж мусить лишитись"


async def test_розбирач_що_знехтував_стелею_однаково_впирається_в_ніж(tmp_path, monkeypatch):
    """Запас під рядок про обрив не сміє стати діркою без дна.

    Якщо розбирач колись поверне мільйон символів і скаже, що не обрізав, —
    у промпт однаково їде не більше, ніж стеля плюс запас, і про обрив
    сказано.
    """
    _write_docx(tmp_path / "без_стелі.docx", ["коротко"])
    monkeypatch.setattr(document_text, "extract", _fake_extract("я" * 1_000_000, False))
    out = await _read(tmp_path / "без_стелі.docx")

    assert out.get("truncated") is True, "стик змовчав про обрив, який зробив сам"
    assert out.get("chars") <= LIMIT_CHARS + SLACK, out.get("chars")
    assert out.get("chars") == len(out["text"])


async def test_власне_поле_стику_не_називає_числа_яких_не_знає(tmp_path, monkeypatch):
    """Число в моєму полі рахувало б і примітку розбирача як зміст документа.

    Тіло 200 001 символ + примітка на 83 → моє поле казало «показано 200084
    символів», тобто 83 символи ПРО обрізання рахувались як обрізаний текст.
    Той самий клас, що й дефекти вище, лише мій власний: число називає не те,
    що обіцяє. Скільки байтів тексту поїхало, каже `chars` — і воно точне;
    скільки з них зміст документа, знає лише той, хто різав, і він це пише в
    кінці самого тексту. Тож моє поле каже ФАКТ обрізання, а не лічбу.
    """
    _write_docx(tmp_path / "з_приміткою.docx", ["коротко"])
    note = "\n\n[показано 200001 символів — далі я не читав, тож не переказуй як повний]"
    monkeypatch.setattr(
        document_text, "extract", _fake_extract("я" * LIMIT_CHARS + note, True)
    )
    out = await _read(tmp_path / "з_приміткою.docx")

    assert out.get("truncated") is True
    assert out.get("truncation")
    assert not re.search(r"\d", out["truncation"]), (
        f"число в полі стику рахує й примітку розбирача: {out['truncation']!r}"
    )
    assert out.get("chars") == len(out["text"]), "chars мусить лишатись точним"


def _overflowing_paragraphs() -> list[str]:
    """Абзаци, яких свідомо більше за стелю — щоб різав САМ розбирач."""
    filler = "Сторона зобовʼязується виконати умови цього договору сумлінно. " * 4
    count = LIMIT_CHARS // len(filler) + 40
    return [f"Пункт {i}. {filler}" for i in range(count)] + [_LAST]


async def test_справжня_примітка_розбирача_вміщується_в_запас(tmp_path):
    """Запас у 512 — константа, і в неї мусить бути шлях до червоного.

    Розбирач дописує в кінець обрізаного тексту власний рядок про обрив, а я
    пропускаю його через запас понад стелю. Поки запас більший за той рядок,
    усе тихо. Якщо рядок колись виросте — я почну зрізати його МОВЧКИ, і
    жоден мій тест на підставному розбирачі цього не побачить: у них хвіст
    свій, вигаданий. Тому тут вимір на СПРАВЖНЬОМУ розбирачі й справжньому
    документі. Константа моя — червоніти має в мене.

    Перевірено, що воно вміє: із запасом 8 замість 512 цей тест падає
    («хвіст розбирача 84 символи проти запасу 8»), а зрізаний хвіст ловить
    друге твердження.
    """
    p = tmp_path / "переповнений.docx"
    _write_docx(p, _overflowing_paragraphs())

    res = document_text.extract(p, max_chars=LIMIT_CHARS + 1)
    assert res.ok, res.reason
    overhang = len(res.text) - LIMIT_CHARS
    assert overhang > 0, "передумова: розбирач мав обрізати й сказати про це"
    assert overhang <= SLACK, (
        f"хвіст розбирача виріс до {overhang} символів проти запасу {SLACK} — "
        "стик почне зрізати його мовчки; підніми _TRUNCATION_NOTE_SLACK"
    )

    out = await _read(p)
    assert out.get("text") == res.text, "стик зрізав те, що розбирач сказав про обрив"
    assert out.get("truncated") is True
