"""Сторож проти base64 документа у промпті.

Червоніє, якщо стик `read_file` → модель знову почне віддавати base64 на
документ або зображення. Саме ця підстановка робила «мовчання джерела»
невідрізненним від змісту: модель діставала стіну base64 і переказувала
документ, якого не бачила.
"""

import pathlib
import re
import sys
import zipfile

import pytest

from ai.tool_executor import _document_aware
from tools import document_text


def _binary_result(name: str, tmp_path) -> dict:
    """Те, що віддає побайтова читалка сьогодні: kind=binary + base64."""
    p = tmp_path / name
    p.write_bytes(b"%PDF-1.4\n\x00\x01binary-noise")
    return {
        "kind": "binary",
        "path": str(p),
        "name": name,
        "size": 26,
        "content_base64": "JVBERi0xLjQK",
    }


@pytest.mark.parametrize("name", ["угода.pdf", "звіт.docx", "кошторис.xlsx"])
def test_документ_ніколи_не_їде_в_модель_як_base64(name, tmp_path):
    out = _document_aware(_binary_result(name, tmp_path))
    assert "content_base64" not in out, "base64 документа доїхав до моделі"
    assert out["kind"] in ("document", "unreadable")
    if out["kind"] == "unreadable":
        # Відмова мусить НАЗИВАТИ причину: порожнеча без причини читається
        # моделлю як «у документі нічого немає».
        assert out["reason"], "відмова без причини"
        assert out.get("say_it")


def test_зображення_не_описується(tmp_path):
    out = _document_aware(_binary_result("скан.jpg", tmp_path))
    assert "content_base64" not in out
    assert out["kind"] == "unreadable"
    assert "зображення" in out["reason"]


def test_текстовий_файл_проходить_недоторканим():
    got = {"kind": "text", "path": "/x/a.md", "name": "a.md", "content": "привіт"}
    assert _document_aware(got) == got


def test_відсутня_бібліотека_каже_це_вголос(tmp_path, monkeypatch):
    """Без pypdf відповідь мусить назвати і формат, і бібліотеку.

    Раніше цей тест пропускався, щойно pypdf у середовищі був, — тобто рівно
    там, де він мусить працювати, він не міг почервоніти. Тепер бібліотеку
    гасимо навмисно: `sys.modules[name] = None` змушує `import` кинути
    ImportError, і гілка відмови виконується завжди.
    """
    monkeypatch.setitem(sys.modules, "pypdf", None)
    res = document_text.extract(_binary_result("а.pdf", tmp_path)["path"])
    assert not res.ok, "з погашеним pypdf витяг не мав відбутися"
    assert "pypdf" in res.reason and "PDF" in res.reason
    assert "не переказуй" in res.reason


def test_pdf_читається_справжній(tmp_path):
    """Гілка УСПІХУ, а не лише відмови: справжній двосторінковий PDF."""
    reportlab_canvas = pytest.importorskip("reportlab.pdfgen.canvas")
    pdf = tmp_path / "акт.pdf"
    c = reportlab_canvas.Canvas(str(pdf))
    c.drawString(70, 780, "Akt pryjmannja-peredachi No 12")
    c.showPage()
    c.drawString(70, 780, "Storinka druha")
    c.showPage()
    c.save()
    res = document_text.extract(pdf)
    assert res.ok, res.reason
    assert "Akt pryjmannja-peredachi No 12" in res.text
    assert "Storinka druha" in res.text, "друга сторінка загубилась"


def test_сканований_pdf_називає_себе(tmp_path):
    """PDF зі сторінками й без тексту — це вимір, а не порожнеча."""
    reportlab_canvas = pytest.importorskip("reportlab.pdfgen.canvas")
    pdf = tmp_path / "скан.pdf"
    c = reportlab_canvas.Canvas(str(pdf))
    c.showPage()
    c.save()
    res = document_text.extract(pdf)
    assert not res.ok
    assert "сканований" in res.reason and "1 стор" in res.reason


def test_xlsx_читається_справжній(tmp_path):
    load = pytest.importorskip("openpyxl")
    wb = load.Workbook()
    ws = wb.active
    ws.title = "кошторис"
    for row in (("позиція", "к-сть"), ("генератор", 2)):
        ws.append(row)
    xlsx = tmp_path / "кошторис.xlsx"
    wb.save(xlsx)
    res = document_text.extract(xlsx)
    assert res.ok, res.reason
    assert "# аркуш: кошторис" in res.text
    assert "генератор\t2" in res.text


def _docx_bytes(path, body_xml: str) -> None:
    """Мінімальний, але СПРАВЖНІЙ docx: та сама розмітка, що пише Word."""
    with zipfile.ZipFile(path, "w") as z:
        z.writestr(
            "[Content_Types].xml",
            '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/'
            'package/2006/content-types"/>',
        )
        z.writestr(
            "word/document.xml",
            '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.'
            f'org/wordprocessingml/2006/main"><w:body>{body_xml}</w:body></w:document>',
        )


def test_docx_читається_без_lxml_і_тримає_таблицю(tmp_path):
    """DOCX бере стандартна бібліотека — це рішення про вагу, і воно тут же.

    Заміряно 03.09.2026: python-docx + lxml = 14,9 МБ і той САМИЙ текст.
    Якщо цей тест колись почервоніє через розбирача — вага повертається в
    пакунок свідомо, а не тому, що ніхто не помітив.
    """
    docx = tmp_path / "угода.docx"
    _docx_bytes(
        docx,
        "<w:p><w:r><w:t>Договір </w:t></w:r><w:r><w:t>№17</w:t></w:r></w:p>"
        "<w:tbl><w:tr>"
        "<w:tc><w:p><w:r><w:t>позиція</w:t></w:r></w:p></w:tc>"
        "<w:tc><w:p><w:r><w:t>ціна</w:t></w:r></w:p></w:tc>"
        "</w:tr><w:tr>"
        "<w:tc><w:p><w:r><w:t>генератор</w:t></w:r></w:p></w:tc>"
        "<w:tc><w:p><w:r><w:t>48000</w:t></w:r></w:p></w:tc>"
        "</w:tr></w:tbl>"
        "<w:p><w:r><w:t>Підпис</w:t></w:r></w:p>",
    )
    res = document_text.extract(docx)
    assert res.ok, res.reason
    assert res.extractor == "zipfile+xml", "DOCX поїхав через сторонню бібліотеку"
    # Прогони одного абзацу мусять зростись, абзаци — ні.
    assert "Договір №17" in res.text
    # Рядок таблиці лишається рядком, комірки — табуляцією.
    assert "позиція\tціна" in res.text
    assert "генератор\t48000" in res.text
    # Порядок документа збережено: підпис ПІСЛЯ таблиці (python-docx це губить).
    assert res.text.index("Підпис") > res.text.index("48000")


def test_pptx_більше_не_відмова_і_тримає_порядок_слайдів(tmp_path):
    """Слайди в zip лежать у довільному порядку — впорядковуємо за номером."""
    pptx = tmp_path / "нарада.pptx"
    with zipfile.ZipFile(pptx, "w") as z:
        # Пишемо навмисно НЕ по порядку, і 10-й — щоб зловити сортування рядком.
        for n, body in ((10, "Десятий"), (2, "Другий"), (1, "Перший")):
            z.writestr(
                f"ppt/slides/slide{n}.xml",
                '<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.'
                'org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/'
                f'presentationml/2006/main"><a:p><a:r><a:t>{body}</a:t></a:r></a:p></p:sld>',
            )
    res = document_text.extract(pptx)
    assert res.ok, res.reason
    assert res.text.index("Перший") < res.text.index("Другий") < res.text.index("Десятий")
    assert "# слайд 1" in res.text


def test_бандл_везе_кожну_бібліотеку_яку_модуль_уміє_попросити(tmp_path):
    """Сторож досяжності: відмова «немає бібліотеки» не має бути правдою в пакунку.

    Модуль написаний так, що без бібліотеки він не падає, а чесно відмовляє.
    Це саме та форма, у якій мертвий пакунок виглядає як робочий продукт:
    користувач бачить «PDF я не читаю» і вірить, що так і задумано. Тому
    ворота стоять не на коді, а на списку, з якого збирається бандл.
    """
    bundle = (
        pathlib.Path(document_text.__file__).resolve().parents[1] / "requirements-bundle.txt"
    ).read_text()
    declared = {
        line.split("==")[0].split(">=")[0].strip().lower()
        for line in bundle.splitlines()
        if line.strip() and not line.lstrip().startswith(("#", "-"))
    }
    src = pathlib.Path(document_text.__file__).read_text()
    asked = set(re.findall(r'_missing\(\s*"([^"]+)"', src))
    assert asked, "жодного _missing не знайдено — сторож ослаб, перевір розбирачі"
    missing = {lib for lib in asked if lib.lower() not in declared}
    assert not missing, (
        f"модуль уміє попросити {sorted(missing)}, а бандл їх не везе — "
        "у пакунку цей формат мовчки перетвориться на відмову"
    )


def test_odt_читається_без_жодної_нової_залежності(tmp_path):
    """ODF — це zip із XML: витяг працює стандартною бібліотекою."""
    p = tmp_path / "нотатка.odt"
    with zipfile.ZipFile(p, "w") as z:
        z.writestr(
            "content.xml",
            '<?xml version="1.0"?><office:document-content>'
            "<text:p>перший рядок</text:p><text:p>другий рядок</text:p>"
            "</office:document-content>",
        )
    res = document_text.extract(p)
    assert res.ok, res.reason
    assert "перший рядок" in res.text and "другий рядок" in res.text
