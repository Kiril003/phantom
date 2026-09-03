"""Сторож проти вигаданого змісту документа.

Два роди дефектів, і другий гірший за перший.

**Мовчання, що читається як зміст.** `read_file` — побайтова читалка: усе, що
не UTF-8, їде у промпт як base64. Модель діставала стіну base64 і переказувала
документ, якого не бачила. Так само мовчать зниклі колонтитули, нотатки
доповідача й порожні клітинки формул: неповний документ доїжджає як повний.

**Вигадка з виглядом джерела.** Гірше за мовчання — текст, якого в документі
НЕМАЄ: видалене в режимі правок, зліплене з новим («4800072000»); викинуте
речення про штраф, що приїхало першим рядком; сума кошторису, приліплена до
чужої позиції. Модель не має як це запідозрити — воно виглядає рівно як зміст,
і людина не має підстав не вірити.

──────────────────────────────────────────────────────────────────────────
ЯК ЦЕЙ НАБІР ПОБУДОВАНО, і чому саме так.

1. **Каталог фікстур із ВІДОМИМ очікуваним текстом.** Для кожного документа
   людиною записано, що модель мусить побачити (`must_see` — часто дослівно
   ввесь витяг) і чого побачити НЕ мусить (`must_not_see`). Очікування не
   обчислюється тим самим правилом, що й код: інакше тест доводить лише те,
   що код дорівнює сам собі. Так уже було з порядком слайдів — тест сам
   іменував файли slide1/2/10 і перевіряв сортування за числом в імені.

2. **Загальний сторож класу «склеїв»: жодного числа у витягу, якого немає в
   джерелі.** Числа з витягу мусять бути підмножиною чисел із УСІХ текстових
   вузлів пакунка — узятих із сирої розмітки, ДО будь-якого склеювання. Він
   ловить не окремий прояв, а весь клас: «4800072000» немає в жодному вузлі,
   там є лише «48000» і «72000». Це доказ на ПОВЕДІНЦІ, а не на реалізації,
   і він женеться по кожній фікстурі, а не лише по тій, де дефект відомий.

3. **Спершу чесна відмова, лише потім ліки.** Поки розбирач умів збрехати,
   він мусив мовчати з названою причиною. Тести відмови стоять нижче окремим
   розділом і перевіряють, що причина КОНКРЕТНА — називає, що саме в цьому
   файлі завадило, а не «не вмію».

Розмітка у фікстурах не вигадана: вона знята з файлів, які пишуть Word 2019,
LibreOffice і openpyxl, і скорочена до мінімуму, що зберігає дефект.
"""

import pathlib
import re
import sys
import zipfile
from html import unescape

import pytest

from ai.tool_executor import _document_aware
from tools import document_text

# ── будівники фікстур ──────────────────────────────────────────────────────
# Простори імен узяті з файлів, які пише Word: mc/wps потрібні для
# AlternateContent, без них розмітка була б несправжня.
_DOC_HEAD = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
    ' xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"'
    ' xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">'
)


def _docx(path, body: str, extra: dict[str, str] | None = None):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(
            "[Content_Types].xml",
            '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/'
            'package/2006/content-types"/>',
        )
        z.writestr("word/document.xml", _DOC_HEAD + "<w:body>" + body + "</w:body></w:document>")
        for name, blob in (extra or {}).items():
            z.writestr(name, blob)
    return path


def _p(text: str) -> str:
    return f'<w:p><w:r><w:t xml:space="preserve">{text}</w:t></w:r></w:p>'


def _tc(*paras: str, pr: str = "") -> str:
    inner = "".join(_p(x) if x else "<w:p></w:p>" for x in paras)
    return f"<w:tc>{'<w:tcPr>' + pr + '</w:tcPr>' if pr else ''}{inner}</w:tc>"


def _tr(*cells: str) -> str:
    return "<w:tr>" + "".join(cells) + "</w:tr>"


def _odt(path, body: str, suffix_ok: bool = True):
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("mimetype", "application/vnd.oasis.opendocument.text")
        z.writestr(
            "content.xml",
            '<?xml version="1.0"?><office:document-content xmlns:office="o" xmlns:text="t"'
            ' xmlns:table="tb" xmlns:dc="dc"><office:body><office:text>'
            + body
            + "</office:text></office:body></office:document-content>",
        )
    return path


def _slide(body: str) -> str:
    return (
        '<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/'
        'drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/'
        f"presentationml/2006/main\"><p:cSld><p:spTree><a:p><a:r><a:t>{body}"
        "</a:t></a:r></a:p></p:spTree></p:cSld></p:sld>"
    )


def _pptx(path, slides: dict[str, str], parts: dict[str, str] | None = None):
    with zipfile.ZipFile(path, "w") as z:
        for name, body in slides.items():
            z.writestr(name, _slide(body))
        for name, blob in (parts or {}).items():
            z.writestr(name, blob)
    return path


def _presentation(rids: list[str], targets: dict[str, str]) -> dict[str, str]:
    """`ppt/presentation.xml` + звʼязки — єдине авторитетне джерело порядку."""
    sld = "".join(f'<p:sldId id="{256 + i}" r:id="{r}"/>' for i, r in enumerate(rids))
    rel = "".join(f'<Relationship Id="{k}" Target="{v}"/>' for k, v in targets.items())
    return {
        "ppt/presentation.xml": '<?xml version="1.0"?><p:presentation xmlns:p="p" xmlns:r="r">'
        f"<p:sldIdLst>{sld}</p:sldIdLst></p:presentation>",
        "ppt/_rels/presentation.xml.rels": '<?xml version="1.0"?><Relationships xmlns="R">'
        f"{rel}</Relationships>",
    }


# ── каталог фікстур ────────────────────────────────────────────────────────
class Case:
    """Документ, і що людина очікує від нього побачити."""

    __slots__ = ("name", "path", "expect", "must_see", "must_not_see", "why")

    def __init__(self, name, path, *, expect=None, must_see=(), must_not_see=(), why=""):
        self.name = name
        self.path = path
        self.expect = expect  # дослівний очікуваний витяг, якщо він короткий
        self.must_see = tuple(must_see)
        self.must_not_see = tuple(must_not_see)
        self.why = why


def _build(d: pathlib.Path) -> list[Case]:
    out: list[Case] = []

    # 1. Договір із увімкненим режимом правок: юрист замінив 48000 на 72000.
    out.append(Case(
        "правки_docx",
        _docx(d / "правки.docx",
              '<w:p><w:r><w:t xml:space="preserve">Вартість робіт становить </w:t></w:r>'
              '<w:del w:id="1" w:author="Юрист" w:date="2026-09-01T10:00:00Z">'
              '<w:r><w:delText xml:space="preserve">48000</w:delText></w:r></w:del>'
              '<w:ins w:id="2" w:author="Юрист" w:date="2026-09-01T10:00:00Z">'
              "<w:r><w:t>72000</w:t></w:r></w:ins>"
              '<w:r><w:t xml:space="preserve"> грн.</w:t></w:r></w:p>'),
        expect="Вартість робіт становить 72000 грн.",
        must_not_see=("4800072000", "48000", "Юрист"),
        why="чинна редакція — 72000; 48000 викреслено, його в документі вже немає",
    ))

    # 2. ODT, де tracked-changes стоїть НА ПОЧАТКУ office:text.
    out.append(Case(
        "правки_odt",
        _odt(d / "правки.odt",
             '<text:tracked-changes><text:changed-region text:id="ct1"><text:deletion>'
             "<office:change-info><dc:creator>Юрист</dc:creator><dc:date>2026-09-01</dc:date>"
             "</office:change-info>"
             "<text:p>Сторона зобовʼязується сплатити штраф 100000 грн.</text:p>"
             "</text:deletion></text:changed-region></text:tracked-changes>"
             "<text:p>Договір про надання послуг</text:p>"
             "<text:p>Штрафні санкції не застосовуються.</text:p>"),
        expect="Договір про надання послуг\nШтрафні санкції не застосовуються.",
        must_not_see=("100000", "Юрист", "2026-09-01"),
        why="штраф ВИКРЕСЛЕНО; на питання «чи є штрафи» правильна відповідь — ні",
    ))

    # 3. Кошторис: порожня перша комірка в рядку продовження і в підсумку.
    out.append(Case(
        "кошторис_docx",
        _docx(d / "кошторис.docx", _p("Кошторис №4") + "<w:tbl>"
              + _tr(_tc("№"), _tc("Найменування"), _tc("К-сть"), _tc("Ціна"), _tc("Сума"))
              + _tr(_tc("1"), _tc("Генератор Honda"), _tc("2"), _tc("48000"), _tc("96000"))
              + _tr(_tc(""), _tc("у т.ч. доставка"), _tc(""), _tc(""), _tc("3000"))
              + _tr(_tc("2"), _tc("Кабель"), _tc("10"), _tc("300"), _tc("3000"))
              + _tr(_tc(""), _tc("РАЗОМ"), _tc(""), _tc(""), _tc("102000"))
              + "</w:tbl>"),
        expect="Кошторис №4\n"
               "№\tНайменування\tК-сть\tЦіна\tСума\n"
               "1\tГенератор Honda\t2\t48000\t96000\n"
               "\tу т.ч. доставка\t\t\t3000\n"
               "2\tКабель\t10\t300\t3000\n"
               "\tРАЗОМ\t\t\t102000",
        why="102000 — це підсумок кошторису, а не сума за позицією «Кабель»",
    ))

    # 4. «Реквізити сторін»: 2 колонки × 5 абзаців у комірці.
    out.append(Case(
        "реквізити_docx",
        _docx(d / "реквізити.docx", _p("Реквізити сторін") + "<w:tbl>" + _tr(
            _tc("ВИКОНАВЕЦЬ:", "ТОВ «Схід»", "р/р UA111111111111", "ЄДРПОУ 11111111",
                "Директор ___ Петренко І.І."),
            _tc("ЗАМОВНИК:", "ФОП Коваль О.О.", "р/р UA999999999999", "ЄДРПОУ 99999999",
                "___ Коваль О.О."),
        ) + "</w:tbl>"),
        must_see=("Реквізити сторін",),
        why="рахунок UA1111… належить ВИКОНАВЦЮ, UA9999… — ЗАМОВНИКУ; "
            "на питання «куди платити» помилка означає гроші не на той рахунок",
    ))

    # 5. Колонтитул із грифом і виноска із застереженням.
    out.append(Case(
        "колонтитул_docx",
        _docx(d / "колонтитул.docx",
              _p("Договір №17") + _p("Ціна: 48000 грн.")
              + '<w:p><w:r><w:footnoteReference w:id="2"/></w:r></w:p>',
              {
                  "word/header1.xml": '<?xml version="1.0"?><w:hdr xmlns:w="w"><w:p><w:r>'
                  "<w:t>ДЛЯ СЛУЖБОВОГО КОРИСТУВАННЯ. Прим. № 2</w:t></w:r></w:p></w:hdr>",
                  "word/footer1.xml": '<?xml version="1.0"?><w:ftr xmlns:w="w"><w:p><w:r>'
                  "<w:t>Сторінка 1 з 12</w:t></w:r></w:p></w:ftr>",
                  "word/footnotes.xml": '<?xml version="1.0"?><w:footnotes xmlns:w="w">'
                  '<w:footnote w:id="2"><w:p><w:r>'
                  "<w:t>Ціна може бути переглянута щоквартально.</w:t></w:r></w:p>"
                  "</w:footnote></w:footnotes>",
              }),
        must_see=("Договір №17", "ДЛЯ СЛУЖБОВОГО КОРИСТУВАННЯ. Прим. № 2",
                  "Ціна може бути переглянута щоквартально."),
        why="гриф обмеження доступу лежить у колонтитулі, а не в тілі документа",
    ))

    # 6. Службові поля: TOC і MERGEFIELD.
    out.append(Case(
        "поля_docx",
        _docx(d / "поля.docx",
              '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>'
              '<w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText>'
              '</w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>'
              '<w:hyperlink w:anchor="_Toc12345"><w:r><w:t>1. Предмет договору</w:t></w:r>'
              "<w:r><w:tab/></w:r><w:r><w:t>3</w:t></w:r></w:hyperlink>"
              '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'
              '<w:p><w:r><w:t xml:space="preserve">Замовник: </w:t></w:r>'
              '<w:r><w:instrText xml:space="preserve"> MERGEFIELD Nazva_Zamovnyka '
              "\\* MERGEFORMAT </w:instrText></w:r><w:r><w:t>ТОВ «Схід»</w:t></w:r></w:p>"),
        expect="1. Предмет договору\t3\nЗамовник: ТОВ «Схід»",
        must_not_see=("TOC", "MERGEFIELD", "MERGEFORMAT", "_Toc12345"),
        why="instrText — інструкція для Word; читач бачить лише результат поля",
    ))

    # 7. Текстове поле так, як його пише Word: Choice(wps) + Fallback(VML).
    out.append(Case(
        "текстове_поле_docx",
        _docx(d / "поле.docx", _p("Договір №17")
              + "<w:p><w:r><mc:AlternateContent>"
              '<mc:Choice Requires="wps"><w:drawing><wp:inline xmlns:wp="wp">'
              '<a:graphic xmlns:a="a"><a:graphicData><wps:wsp><wps:txbx><w:txbxContent>'
              "<w:p><w:r><w:t>УВАГА: остаточна ціна 72000 грн</w:t></w:r></w:p>"
              "</w:txbxContent></wps:txbx></wps:wsp></a:graphicData></a:graphic></wp:inline>"
              "</w:drawing></mc:Choice>"
              '<mc:Fallback><w:pict><v:shape xmlns:v="v"><v:textbox><w:txbxContent>'
              "<w:p><w:r><w:t>УВАГА: остаточна ціна 72000 грн</w:t></w:r></w:p>"
              "</w:txbxContent></v:textbox></v:shape></w:pict></mc:Fallback>"
              "</mc:AlternateContent></w:r></w:p>" + _p("Підпис")),
        expect="Договір №17\nУВАГА: остаточна ціна 72000 грн\nПідпис",
        why="Word пише кожне текстове поле двічі; читач бачить його ОДИН раз",
    ))

    # 8. Незаекранований '>' в атрибуті — так пише Word структурні теги.
    out.append(Case(
        "кутник_docx",
        _docx(d / "sdt.docx",
              '<w:sdt><w:sdtPr><w:alias w:val="Розділ > Підрозділ"/><w:tag w:val="p>1"/>'
              "</w:sdtPr><w:sdtContent>" + _p("Сума до сплати: 100000 грн")
              + "</w:sdtContent></w:sdt>" + _p("Наступний абзац")),
        expect="Сума до сплати: 100000 грн\nНаступний абзац",
        must_not_see=('Підрозділ"', '"/>'),
        why="хвіст розрізаного атрибута доїжджав як текст документа",
    ))

    # 9. Обʼєднані комірки: gridSpan=2 у підсумковому рядку.
    out.append(Case(
        "обʼєднані_комірки_docx",
        _docx(d / "обʼєднані.docx", "<w:tbl>"
              + _tr(_tc("Позиція"), _tc("Ціна"), _tc("Сума"))
              + _tr(_tc("Кабель"), _tc("300"), _tc("3000"))
              + _tr(_tc("РАЗОМ", pr='<w:gridSpan w:val="2"/>'), _tc("3000"))
              + "</w:tbl>"),
        expect="Позиція\tЦіна\tСума\nКабель\t300\t3000\nРАЗОМ\t\t3000",
        why="обʼєднана комірка займає дві колонки; без цього 3000 стає в колонку «Ціна»",
    ))

    # 10. Комірка з двома абзацами — адреса в один рядок таблиці.
    out.append(Case(
        "адреса_docx",
        _docx(d / "адреса.docx", "<w:tbl>"
              + _tr(_tc("Адреса"), _tc("вул. Шевченка, 1", "м. Київ, 01001"))
              + _tr(_tc("Телефон"), _tc("+380441234567"))
              + "</w:tbl>"),
        must_see=("Телефон\t+380441234567",),
        why="обидва рядки адреси належать комірці «Адреса», а не окремим рядкам таблиці",
    ))

    # 11. PPTX: імена файлів навмисно СУПЕРЕЧАТЬ порядку показу.
    #     У зіпі slide1 — це висновок, а показують його ТРЕТІМ.
    out.append(Case(
        "нарада_pptx",
        _pptx(d / "нарада.pptx",
              {"ppt/slides/slide1.xml": "Висновок: відмовитись від закупівлі",
               "ppt/slides/slide2.xml": "Ризики",
               "ppt/slides/slide3.xml": "Титул: закупівля генераторів"},
              _presentation(["rId3", "rId2", "rId1"],
                            {"rId1": "slides/slide1.xml", "rId2": "slides/slide2.xml",
                             "rId3": "slides/slide3.xml"})),
        expect="# слайд 1\nТитул: закупівля генераторів\n\n"
               "# слайд 2\nРизики\n\n"
               "# слайд 3\nВисновок: відмовитись від закупівлі",
        why="порядок показу — це <p:sldIdLst>; PowerPoint не перейменовує файли "
            "при перестановці, тож ім'я файла про порядок не свідчить",
    ))

    # 12. PPTX із нотатками доповідача; номер нотатки НЕ дорівнює номеру слайда.
    parts = _presentation(["rId1", "rId2"],
                          {"rId1": "slides/slide1.xml", "rId2": "slides/slide2.xml"})
    parts["ppt/slides/_rels/slide1.xml.rels"] = (
        '<?xml version="1.0"?><Relationships xmlns="R"><Relationship Id="rId1"'
        ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
        'notesSlide" Target="../notesSlides/notesSlide7.xml"/></Relationships>'
    )
    parts["ppt/notesSlides/notesSlide7.xml"] = (
        '<?xml version="1.0"?><p:notes xmlns:a="a" xmlns:p="p"><a:p><a:r>'
        "<a:t>НОТАТКА: справжня причина відмови — брак коштів</a:t></a:r></a:p></p:notes>"
    )
    out.append(Case(
        "нотатки_pptx",
        _pptx(d / "нотатки.pptx",
              {"ppt/slides/slide1.xml": "Титул", "ppt/slides/slide2.xml": "Ризики"}, parts),
        expect="# слайд 1\nТитул\n\n"
               "# нотатки доповідача\nНОТАТКА: справжня причина відмови — брак коштів\n\n"
               "# слайд 2\nРизики",
        why="звʼязок слайд→нотатка читається з rels, а не вгадується з числа в імені",
    ))

    # 13. ODT без таблиць.
    out.append(Case(
        "нотатка_odt",
        _odt(d / "нотатка.odt", "<text:p>перший рядок</text:p><text:p>другий рядок</text:p>"),
        expect="перший рядок\nдругий рядок",
        why="найпростіший ODF мусить лишитись найпростішим",
    ))

    # 14. ODS: комірки таблиці.
    out.append(Case(
        "кошторис_ods",
        _odt(d / "кошторис.ods",
             "<table:table><table:table-row>"
             "<table:table-cell><text:p>генератор</text:p></table:table-cell>"
             "<table:table-cell><text:p>48000</text:p></table:table-cell>"
             "</table:table-row></table:table>"),
        expect="генератор\t48000",
        why="комірки ODS не зліплюються в один рядок",
    ))
    return out


@pytest.fixture(scope="module")
def cases(tmp_path_factory) -> dict[str, Case]:
    return {c.name: c for c in _build(tmp_path_factory.mktemp("документи"))}


def _xlsx_case(path):
    """XLSX робиться окремо: openpyxl пише формули БЕЗ кешу — як 1С і будь-який експорт."""
    load = pytest.importorskip("openpyxl")
    wb = load.Workbook()
    ws = wb.active
    ws.title = "кошторис"
    ws.append(["позиція", "к-сть", "ціна", "сума"])
    ws.append(["генератор", 2, 48000, "=B2*C2"])
    ws.append(["кабель", 10, 300, "=B3*C3"])
    ws.append(["РАЗОМ", None, None, "=SUM(D2:D3)"])
    wb.save(path)
    return path


ALL = [c.name for c in _build(pathlib.Path("/nonexistent"))] if False else [
    "правки_docx", "правки_odt", "кошторис_docx", "реквізити_docx", "колонтитул_docx",
    "поля_docx", "текстове_поле_docx", "кутник_docx", "обʼєднані_комірки_docx",
    "адреса_docx", "нарада_pptx", "нотатки_pptx", "нотатка_odt", "кошторис_ods",
]


# ── головний сторож: жодного вигаданого числа ──────────────────────────────
_NUM = re.compile(r"\d+")
_CHARDATA = re.compile(r">([^<]*)<")


def _source_numbers(path) -> set[str]:
    """Числа з УСІХ текстових вузлів пакунка — із сирої розмітки, до склеювання.

    Береться саме символьний вміст (`>…<`), а не атрибути: `w:id="1"` та
    `w:date="2026-09-01"` — це службові дані, яких у витягу бути не може, і
    зараховувати їх у джерело означало б ослабити сторож.
    """
    nums: set[str] = set()
    with zipfile.ZipFile(path) as z:
        for name in z.namelist():
            if not name.endswith(".xml"):
                continue
            raw = z.read(name).decode("utf-8", errors="ignore")
            for chunk in _CHARDATA.findall(raw):
                nums |= set(_NUM.findall(unescape(chunk)))
    return nums


def _output_numbers(text: str) -> set[str]:
    """Числа з витягу, окрім рядків, які додав САМ модуль.

    Викидаємо рядки-позначки («# слайд 3», «# аркуш: …») і рядок про
    обрізання: їхні числа походять із модуля, а не з документа, тож питати з
    них джерело безглуздо. Усе інше — текст документа й підлягає доказу.
    """
    body = [ln for ln in text.split("\n") if not ln.startswith("#") and not ln.startswith("[")]
    return set(_NUM.findall("\n".join(body)))


@pytest.mark.parametrize("name", ALL)
def test_жодного_числа_якого_немає_в_джерелі(name, cases):
    """Клас «склеїв» цілком, а не окремі його прояви.

    На режимі правок червоніє негайно: «4800072000» немає в жодному текстовому
    вузлі — там є лише «48000» і «72000». Той самий сторож ловить склеєні
    рядки таблиці, зліплені колонки й будь-яке майбутнє склеювання, якого ще
    ніхто не бачив.
    """
    case = cases[name]
    res = document_text.extract(case.path)
    if not res.ok:
        pytest.skip(f"витяг чесно відмовлено: {res.reason}")
    invented = _output_numbers(res.text) - _source_numbers(case.path)
    assert not invented, (
        f"у витягу числа, яких немає в жодному текстовому вузлі документа: "
        f"{sorted(invented)}\nвитяг:\n{res.text}"
    )


def test_сторож_чисел_уміє_почервоніти(cases):
    """Сам прилад теж мусить уміти показати червоне — інакше він декорація."""
    case = cases["правки_docx"]
    підроблено = "Вартість робіт становить 4800072000 грн."
    assert _output_numbers(підроблено) - _source_numbers(case.path) == {"4800072000"}


# ── очікуваний текст, записаний людиною ────────────────────────────────────
@pytest.mark.parametrize("name", ALL)
def test_витяг_дорівнює_очікуваному(name, cases):
    case = cases[name]
    res = document_text.extract(case.path)
    assert res.ok, f"{case.why}\nвідмова: {res.reason}"
    if case.expect is not None:
        assert res.text == case.expect, case.why
    for frag in case.must_see:
        assert frag in res.text, f"{frag!r} не доїхало — {case.why}\n{res.text}"
    for frag in case.must_not_see:
        assert frag not in res.text, f"{frag!r} доїхало, а не мало — {case.why}\n{res.text}"


def test_рахунок_лишається_при_своїй_стороні(cases):
    """Окремо, бо це не «текст збігся», а «звʼязок не розірвався».

    Табуляція стояла лише після ОСТАННЬОГО абзацу комірки, тож рахунок
    UA1111… і рахунок UA9999… переставали бути привʼязаними до сторін.
    """
    res = document_text.extract(cases["реквізити_docx"].path)
    assert res.ok, res.reason
    row = [x for x in res.text.split("\n") if "UA111111111111" in x]
    assert len(row) == 1, f"рядок таблиці розпався на кілька: {res.text!r}"
    cells = row[0].split("\t")
    assert len(cells) == 2, f"колонок не дві: {cells}"
    assert "ВИКОНАВЕЦЬ" in cells[0] and "UA111111111111" in cells[0], cells[0]
    assert "ЗАМОВНИК" in cells[1] and "UA999999999999" in cells[1], cells[1]
    assert "UA999999999999" not in cells[0] and "UA111111111111" not in cells[1]


def test_обидва_рядки_адреси_належать_своїй_комірці(cases):
    res = document_text.extract(cases["адреса_docx"].path)
    assert res.ok, res.reason
    row = [x for x in res.text.split("\n") if x.startswith("Адреса")]
    assert len(row) == 1, f"комірка з двома абзацами розірвала рядок: {res.text!r}"
    assert "вул. Шевченка, 1" in row[0] and "м. Київ, 01001" in row[0], row[0]


def test_колонтитул_і_виноска_позначені_і_стоять_після_тіла(cases):
    """Гриф мусить бути видимим — і не мусить читатись як абзац договору."""
    res = document_text.extract(cases["колонтитул_docx"].path)
    assert res.ok, res.reason
    assert "колонтитул" in res.text and "виноск" in res.text, res.text
    assert res.text.index("Договір №17") < res.text.index("ДЛЯ СЛУЖБОВОГО"), res.text


# ── XLSX ───────────────────────────────────────────────────────────────────
def test_формула_без_кешу_каже_це_а_не_віддає_порожнечу(tmp_path):
    """`data_only=True` бере кеш, якого в згенерованому файлі немає.

    openpyxl, 1С і будь-який експорт пишуть `<f>` без `<v>`. Колонка «сума»
    приїжджала порожньою, а рядка «РАЗОМ» фактично не було — мовчки. Файли,
    збережені самим Excel, кеш мають, тому на них дефект невидимий.
    """
    x = _xlsx_case(tmp_path / "кошторис.xlsx")
    res = document_text.extract(x)
    assert res.ok, res.reason
    lines = res.text.split("\n")
    assert lines[0] == "# аркуш: кошторис"
    разом = [ln for ln in lines if ln.startswith("РАЗОМ")]
    assert len(разом) == 1, res.text
    tail = разом[0].split("\t")[-1]
    assert tail != "", "підсумок віддано порожнечею"
    assert "SUM(D2:D3)" in tail, f"формулу не названо: {tail!r}"
    assert "не збереж" in tail or "без" in tail, tail
    assert "B2*C2" in res.text, "формула рядка теж мовчить"


def test_xlsx_із_числами_читається_як_раніше(tmp_path):
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
    assert res.text == "# аркуш: кошторис\nпозиція\tк-сть\nгенератор\t2"


# ── стеля на розпакований розмір ───────────────────────────────────────────
def test_стеля_на_розпакований_розмір_відмовляє_словами(tmp_path):
    """404 КБ на диску розгорталися в 120 МБ XML і 939 МБ RSS.

    Роздування ≈8×: `z.read` → `unescape` → чотири `re.sub`, кожен робить повну
    копію. Чотиримегабайтний .docx зі стисненням 300:1 дав би ~9,5 ГБ, тобто
    вбивство бекенда сторожем памʼяті. Стеля мусить стояти на РОЗПАКОВАНОМУ
    розмірі (`ZipInfo.file_size`), тобто ДО розпакування.
    """
    assert document_text.MAX_XML_BYTES < 20 * 1024 * 1024, "стеля вища за пробу — проба сліпа"
    bomb = tmp_path / "бомба.docx"
    piece = b"<w:p><w:r><w:t>text</w:t></w:r></w:p>" * 4000
    with zipfile.ZipFile(bomb, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        with z.open("word/document.xml", "w") as f:
            f.write(b'<?xml version="1.0"?><w:document xmlns:w="w"><w:body>')
            for _ in range(140):  # ~20 МБ розпакованого XML
                f.write(piece)
            f.write(b"</w:body></w:document>")
    assert bomb.stat().st_size < 1_000_000, "проба зіпсована: файл на диску не малий"
    res = document_text.extract(bomb)
    assert not res.ok, "20 МБ XML розгорнулись у памʼять без жодної стелі"
    assert "МБ" in res.reason and "стел" in res.reason, res.reason


def _показане(text: str) -> tuple[str, int]:
    """Розділити витяг на тіло й ЗАЯВЛЕНЕ в примітці число показаних символів."""
    body, _, note = text.rpartition("\n\n")
    assert note.startswith("[показано "), f"примітки про обрізання немає: {text!r}"
    return body, int(re.search(r"показано (\d+)", note).group(1))


def test_обрізання_каже_себе_вголос(tmp_path):
    """Мовчазне обрізання — це неповний документ, поданий як повний."""
    d = _docx(tmp_path / "довгий.docx", _p("Договір №17") + _p("Ціна: 48000 грн."))
    ціле = document_text.extract(d)
    assert ціле.ok and len(ціле.text) > 20 and not ціле.truncated
    res = document_text.extract(d, max_chars=20)
    assert res.ok, res.reason
    assert res.truncated, "прапорець обрізання не піднято"
    assert "не переказуй" in res.text
    body, заявлено = _показане(res.text)
    assert заявлено == len(body), (
        f"примітка каже «показано {заявлено}», а показано насправді {len(body)}"
    )


def test_обрізання_не_перебільшує_показане(tmp_path):
    """Число в примітці — теж число у витягу, і воно теж мусить бути правдою.

    `text[:max_chars].rstrip()` знімає хвостовий пробіл або перенос, тож
    показаних символів МЕНШЕ, ніж попрошено. Примітка, яка друкує попрошене,
    завищує саму себе — рівно той клас, проти якого стоїть сторож чисел,
    тільки цього разу число вигадав сам модуль.
    """
    d = _docx(tmp_path / "довгий.docx", _p("Договір №17") + _p("Ціна: 48000 грн."))
    # 12 символів припадають рівно на перенос рядка після «Договір №17».
    res = document_text.extract(d, max_chars=12)
    assert res.ok, res.reason
    body, заявлено = _показане(res.text)
    assert body == "Договір №17", body
    assert заявлено == 11, f"заявлено {заявлено} показаних символів замість 11"


def test_обрізання_рівно_на_межі_не_мовчить(tmp_path):
    """Найтихіший випадок: обхід спинився НА стелі, тож різати вже нічого.

    Обхід зупиняється, щойно набрано `max_chars`, — і тоді довжина витягу
    дорівнює стелі, а не перевищує її. Перевірка «довше за стелю?» такого не
    бачить, і другий абзац зникає без жодного слова. Прапорець `truncated`
    при цьому лишався False, тобто стик отримував «повний документ».
    """
    d = _docx(tmp_path / "довгий.docx", _p("Договір №17") + _p("Ціна: 48000 грн."))
    res = document_text.extract(d, max_chars=11)
    assert res.ok, res.reason
    assert "48000" not in res.text, "проба зіпсована: нічого не загубилось"
    assert res.truncated, "вміст загублено, а прапорець каже «повний документ»"
    body, заявлено = _показане(res.text)
    assert заявлено == len(body) == 11


def test_обрізання_відомого_цілком_тексту_називає_повний_розмір(tmp_path):
    """Коли текст зібрано ПОВНІСТЮ й лише потім обрізано — розмір оригіналу відомий.

    RTF читається одним шматком, тож тут можна сказати не лише «показано N»,
    а й «із M». Там, де обхід спинився на півдорозі, M невідоме — і вигадувати
    його не можна: часткова сума виглядала б як розмір документа.
    """
    pytest.importorskip("striprtf")
    r = tmp_path / "договір.rtf"
    r.write_text(r"{\rtf1\ansi Договір оренди № 17. Сума: 48000 грн.}", encoding="utf-8")
    ціле = document_text.extract(r)
    assert ціле.ok and len(ціле.text) > 20, ціле.reason
    res = document_text.extract(r, max_chars=20)
    assert res.ok and res.truncated
    body, заявлено = _показане(res.text)
    assert заявлено == len(body)
    assert f"із {len(ціле.text)}" in res.text, f"повний розмір не названо: {res.text!r}"


# ── причина відмови людською мовою ─────────────────────────────────────────
def _reason(path):
    res = document_text.extract(path)
    assert not res.ok, f"{path} несподівано прочитався"
    assert res.reason
    assert not re.search(r"[A-Za-z]+Error", res.reason), f"імʼя класу Python у причині: {res.reason}"
    return res.reason


def test_docx_що_насправді_pdf_каже_це(tmp_path):
    p = tmp_path / "угода.docx"
    p.write_bytes(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\ntrailer<<>>")
    assert "PDF" in _reason(p)


def test_zip_без_потрібної_частини_каже_чим_він_є(tmp_path):
    p = tmp_path / "звіт.docx"
    with zipfile.ZipFile(p, "w") as z:
        z.writestr("xl/workbook.xml", "<x/>")
    r = _reason(p)
    assert "XLSX" in r or "Excel" in r, r


def test_порожній_файл_каже_що_він_порожній(tmp_path):
    p = tmp_path / "нуль.pdf"
    p.write_bytes(b"")
    assert "порожн" in _reason(p)


def test_файл_під_паролем_називає_пароль(tmp_path):
    """Найдорожча відмова: людина не дізнається, що треба просто ввести пароль.

    PDF під паролем і XLSX під паролем (OLE-контейнер) давали
    `FileNotDecryptedError` і `BadZipFile` — тобто були невідрізненні від
    пошкодженого файла.
    """
    pypdf = pytest.importorskip("pypdf")
    canvas = pytest.importorskip("reportlab.pdfgen.canvas")
    src = tmp_path / "чистий.pdf"
    c = canvas.Canvas(str(src))
    c.drawString(70, 780, "sekretno")
    c.save()
    w = pypdf.PdfWriter()
    w.append(str(src))
    w.encrypt("pass123")
    locked = tmp_path / "під_паролем.pdf"
    with open(locked, "wb") as f:
        w.write(f)
    assert "парол" in _reason(locked)

    ole = tmp_path / "під_паролем.xlsx"
    ole.write_bytes(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 512)
    assert "парол" in _reason(ole)


# ── межа: base64 документа ─────────────────────────────────────────────────
def test_справжній_документ_доїжджає_текстом_а_не_base64(tmp_path):
    """Гілка `document` мусить ВИКОНАТИСЬ, інакше сторож перевіряє порожнечу.

    Раніше всі три фікстури були `b"%PDF-1.4\\x00\\x01binary-noise"`, тобто
    жодного разу не розбиралися: усі три йшли в `unreadable`, а відсутність
    `content_base64` там забезпечує безумовний dict-comprehension.
    """
    d = _docx(tmp_path / "звіт.docx", _p("Договір №17") + _p("Ціна: 48000 грн."))
    got = {"kind": "binary", "path": str(d), "name": "звіт.docx",
           "size": d.stat().st_size, "content_base64": "UEsDBBQ="}
    out = _document_aware(got)
    assert "content_base64" not in out, "base64 документа доїхав до моделі"
    assert out["kind"] == "document", out
    assert "Договір №17" in out["text"] and out["chars"] == len(out["text"])


def test_нечитаний_документ_відмовляє_словами(tmp_path):
    p = tmp_path / "угода.pdf"
    p.write_bytes(b"%PDF-1.4\n\x00\x01binary-noise")
    out = _document_aware({"kind": "binary", "path": str(p), "name": "угода.pdf",
                           "size": 26, "content_base64": "JVBERi0xLjQK"})
    assert "content_base64" not in out
    assert out["kind"] == "unreadable"
    assert out["reason"] and out.get("say_it")


def test_зображення_не_описується(tmp_path):
    p = tmp_path / "скан.jpg"
    p.write_bytes(b"\xff\xd8\xff\xe0binary")
    out = _document_aware({"kind": "binary", "path": str(p), "name": "скан.jpg",
                           "size": 10, "content_base64": "/9j/"})
    assert "content_base64" not in out
    assert out["kind"] == "unreadable"
    assert "зображення" in out["reason"]


def test_текстовий_файл_проходить_недоторканим():
    got = {"kind": "text", "path": "/x/a.md", "name": "a.md", "content": "привіт"}
    assert _document_aware(got) == got


# ── межа стоїть у відповіді ────────────────────────────────────────────────
def test_відсутня_бібліотека_каже_це_вголос(tmp_path, monkeypatch):
    """Без pypdf відповідь мусить назвати і формат, і бібліотеку.

    Бібліотеку гасимо навмисно: `sys.modules[name] = None` змушує `import`
    кинути ImportError, і гілка відмови виконується завжди — інакше тест
    пропускався б рівно там, де мусить працювати.
    """
    monkeypatch.setitem(sys.modules, "pypdf", None)
    p = tmp_path / "а.pdf"
    p.write_bytes(b"%PDF-1.4\n\x00\x01")
    res = document_text.extract(p)
    assert not res.ok, "з погашеним pypdf витяг не мав відбутися"
    assert "pypdf" in res.reason and "PDF" in res.reason
    assert "не переказуй" in res.reason


def test_docx_не_тягне_важкого_розбирача(tmp_path, monkeypatch):
    """Рішення про вагу — тут, а не в коментарі.

    Раніше на цьому місці стояло `assert res.extractor == "zipfile+xml"` —
    рядковий літерал із самого модуля, тобто істина тесту дорівнювала ключу
    коду. Тепер важкі розбирачі ПОГАШЕНІ: якщо витяг колись піде через
    python-docx чи lxml, імпорт кине ImportError і тест почервоніє. Заміряно
    03.09.2026: python-docx + lxml = 14,9 МБ і той самий текст.
    """
    for heavy in ("docx", "lxml", "pptx", "odf", "defusedxml"):
        monkeypatch.setitem(sys.modules, heavy, None)
    d = _docx(tmp_path / "угода.docx",
              _p("Договір") + "<w:tbl>" + _tr(_tc("позиція"), _tc("ціна")) + "</w:tbl>"
              + _p("Підпис"))
    res = document_text.extract(d)
    assert res.ok, res.reason
    assert res.text == "Договір\nпозиція\tціна\nПідпис", res.text


def test_прогони_одного_абзацу_зростаються_абзаци_ні(tmp_path):
    """OOXML ріже текст на прогони по межах правопису — межі мусять вижити."""
    d = _docx(tmp_path / "прогони.docx",
              "<w:p><w:r><w:t>Договір </w:t></w:r><w:r><w:t>№17</w:t></w:r></w:p>" + _p("Підпис"))
    res = document_text.extract(d)
    assert res.ok, res.reason
    assert res.text == "Договір №17\nПідпис"


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


# ── журнал знятих відмов ───────────────────────────────────────────────────
# Перед ліками модуль спершу навчили МОВЧАТИ там, де він умів збрехати:
# `_ризик()` віддавав названу відмову на режим правок, обʼєднані комірки й
# рядок, що починається порожньою коміркою, а колонтитул згадувався рядком
# «[у документі є колонтитул — я його не показую]». Це був самодостатній
# крок: модуль ставав біднішим, але не брехливим.
#
# Кожна з тих відмов знята рівно тоді, коли на її місце став доведений
# розбір, і доказ лежить вище:
#
#   режим правок DOCX      → test_витяг_дорівнює_очікуваному[правки_docx]
#                            + сторож чисел (саме там «4800072000» і жив)
#   режим правок ODT       → test_витяг_дорівнює_очікуваному[правки_odt]
#   порожня перша комірка  → test_витяг_дорівнює_очікуваному[кошторис_docx]
#   обʼєднані комірки      → test_витяг_дорівнює_очікуваному[обʼєднані_комірки_docx]
#   колонтитул і виноски   → test_колонтитул_і_виноска_позначені_і_стоять_після_тіла
#
# Тест нижче стежить, щоб відмови не поверталися тишком: якщо розбір колись
# зламають, ці документи мусять почервоніти в тестах вище, а не тихо
# перетворитись на відмову, яку читають як задум.
@pytest.mark.parametrize("name", ALL)
def test_жоден_документ_із_каталогу_більше_не_відмовляється(name, cases):
    res = document_text.extract(cases[name].path)
    assert res.ok, (
        f"документ знову віддається відмовою замість тексту: {res.reason}\n"
        f"{cases[name].why}"
    )
