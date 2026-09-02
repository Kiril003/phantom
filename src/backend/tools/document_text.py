"""Текст із документа — або чесне «не вмію», і ніколи base64 у модель.

**Навіщо цей модуль існує.** `file_manager.read_file` — побайтова читалка:
UTF-8 без нулів віддається як текст, усе інше як base64. Для файлового
браузера у вебі це правильно (зображення так і показують). Для МОДЕЛІ це
отрута: на питання «що в цьому договорі» вона діставала стіну base64 і
переказувала документ, якого не бачила. Мовчання джерела набувало форми,
яку споживач читає як зміст.

**Межа стоїть у відповіді, а не в документації.** Якщо бібліотеки розбору в
цій збірці немає — інструмент каже це словами й називає формат. «Наче вміємо»
не буває: саме воно й породжує вигадку.

**Імпорти навмисно ліниві.** Модуль працює без жодної нової залежності:
без `pypdf`/`openpyxl` він просто відмовляє чесно, а щойно бібліотеку
внесуть у збірку — витяг вмикається сам, без правок коду.

**OOXML і ODF розбираються стандартною бібліотекою — навмисно.** DOCX, PPTX,
ODT і ODS — це zip із XML. Заміряно 03.09.2026: `python-docx` тягне `lxml` і
важить 14,9 МБ із 21,2 МБ усього набору, а віддає той САМИЙ текст, що обхід
розмітки — звірено посимвольно на документі з абзацами й таблицею. Ба
більше, він віддає спочатку всі абзаци, потім усі таблиці, тобто губить
порядок документа. Тож у пакунок їдуть лише `pypdf`, `openpyxl` і
`striprtf` — 6,7 МБ, а не 21,2.
"""

from __future__ import annotations

import re
import zipfile
from html import unescape
from pathlib import Path

# Формати, які ЛЮДИНА називає документом. Для них base64 у модель
# заборонений: або текст, або сказана вголос відмова.
DOCUMENT_EXTS: frozenset[str] = frozenset(
    {".pdf", ".docx", ".xlsx", ".xlsm", ".rtf", ".odt", ".ods", ".doc", ".pptx"}
)

IMAGE_EXTS: frozenset[str] = frozenset(
    {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".heic", ".heif", ".gif", ".tiff", ".tif"}
)


class Extracted:
    """Результат витягу. Три стани, і жоден із них не мовчить."""

    __slots__ = ("text", "extractor", "reason")

    def __init__(self, text: str | None, extractor: str | None, reason: str | None):
        self.text = text
        self.extractor = extractor
        self.reason = reason

    @property
    def ok(self) -> bool:
        return self.text is not None


def is_document(name: str) -> bool:
    return Path(name).suffix.lower() in DOCUMENT_EXTS


def is_image(name: str) -> bool:
    return Path(name).suffix.lower() in IMAGE_EXTS


def extract(path: str | Path, *, max_chars: int = 200_000) -> Extracted:
    """Дістати текст. Ніколи не кидає: збій — це названа причина, не виняток."""
    p = Path(path)
    ext = p.suffix.lower()
    try:
        if ext == ".pdf":
            return _pdf(p, max_chars)
        if ext == ".docx":
            return _docx(p, max_chars)
        if ext in (".xlsx", ".xlsm"):
            return _xlsx(p, max_chars)
        if ext == ".rtf":
            return _rtf(p, max_chars)
        if ext in (".odt", ".ods"):
            return _odf(p, max_chars)
        if ext == ".doc":
            return Extracted(None, None, "старий формат .doc (не OOXML) — не розбираю")
        if ext == ".pptx":
            return _pptx(p, max_chars)
    except Exception as exc:  # noqa: BLE001 — причина мусить доїхати словами
        return Extracted(None, None, f"файл не піддався розбору: {type(exc).__name__}")
    return Extracted(None, None, f"формат {ext or 'без розширення'} не належить до документів")


def _missing(lib: str, fmt: str) -> Extracted:
    return Extracted(
        None,
        None,
        f"у цій збірці немає бібліотеки {lib}, тому {fmt} я не читаю; "
        "не переказуй вміст, якого не бачив",
    )


def _cut(text: str, max_chars: int) -> str:
    return text if len(text) <= max_chars else text[:max_chars]


def _pdf(p: Path, max_chars: int) -> Extracted:
    try:
        from pypdf import PdfReader  # noqa: PLC0415 — лінивий навмисно
    except ImportError:
        return _missing("pypdf", "PDF")
    reader = PdfReader(str(p))
    parts: list[str] = []
    for page in reader.pages:
        parts.append(page.extract_text() or "")
        if sum(len(x) for x in parts) > max_chars:
            break
    text = "\n".join(parts).strip()
    if not text:
        # Сканований PDF: сторінки є, тексту немає. Це ВИМІР, і його треба
        # назвати — інакше порожнеча читається як «у документі нічого».
        return Extracted(
            None,
            "pypdf",
            f"це сканований PDF ({len(reader.pages)} стор.): текстового шару немає, "
            "а розпізнавання зображень у цій збірці немає",
        )
    return Extracted(_cut(text, max_chars), "pypdf", None)


def _zip_member(p: Path, member: str) -> str:
    with zipfile.ZipFile(p) as z:
        return z.read(member).decode("utf-8", errors="ignore")


def _flatten(raw: str) -> str:
    """Зняти розмітку — але ЛИШЕ після того, як межі вже стали символами.

    Порядок тут не косметика. Текст в OOXML порізаний на прогони (`<w:t>`)
    по межах правопису й форматування, тож зняти теги першим ділом означає
    злити абзаци в одну кашу без жодного рядка. Спершу межі, потім теги.
    """
    text = unescape(re.sub(r"<[^>]+>", "", raw))
    # Комірка таблиці містить абзац, тож її кінець дає і "\n", і "\t".
    # Рядок таблиці мусить лишитись рядком.
    text = re.sub(r"\n+\t", "\t", text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    return "\n".join(x for x in text.split("\n") if x.strip()).strip()


def _docx(p: Path, max_chars: int) -> Extracted:
    """DOCX — zip із XML, як і ODT; `python-docx` сюди не потрібен.

    Заміряно 03.09.2026 на документі з заголовком, абзацами й таблицею 3×3:
    цей обхід дає посимвольно ТОЙ САМИЙ текст, що `python-docx`, і зберігає
    порядок документа, який той губить (спершу всі абзаци, потім усі
    таблиці). Ціна відмови від нього — мінус 14,9 МБ у пакунку разом з lxml.
    """
    raw = _zip_member(p, "word/document.xml")
    raw = re.sub(r"<w:tab\b[^>]*/>", "\t", raw)
    raw = re.sub(r"<w:(?:br|cr)\b[^>]*/>", "\n", raw)
    raw = re.sub(r"</w:p>", "\n", raw)
    raw = re.sub(r"</w:tc>", "\t", raw)
    raw = re.sub(r"</w:tr>", "\n", raw)
    text = _flatten(raw)
    if not text:
        return Extracted(None, "zipfile+xml", "документ порожній або тримає лише зображення")
    return Extracted(_cut(text, max_chars), "zipfile+xml", None)


def _pptx(p: Path, max_chars: int) -> Extracted:
    """PPTX — той самий zip із XML: текст слайда живе в `<a:t>`.

    Слайди впорядковуємо за номером у назві, а не за порядком у zip: він
    довільний, і презентація приїхала б моделі перетасованою.
    """
    chunks: list[str] = []
    with zipfile.ZipFile(p) as z:
        names = [n for n in z.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)]
        names.sort(key=lambda n: int(re.search(r"(\d+)", n.rsplit("/", 1)[1]).group(1)))
        for i, name in enumerate(names, 1):
            raw = z.read(name).decode("utf-8", errors="ignore")
            raw = re.sub(r"</a:p>", "\n", raw)
            raw = re.sub(r"</a:tc>", "\t", raw)
            raw = re.sub(r"</a:tr>", "\n", raw)
            body = _flatten(raw)
            if body:
                chunks.append(f"# слайд {i}\n{body}")
    text = "\n\n".join(chunks)
    if not text:
        # Слайди є, тексту немає — це вимір, і його треба назвати, інакше
        # порожнеча читається як «у презентації нічого».
        return Extracted(
            None, "zipfile+xml", f"у презентації {len(names)} слайд(ів) і жодного тексту"
        )
    return Extracted(_cut(text, max_chars), "zipfile+xml", None)


def _xlsx(p: Path, max_chars: int) -> Extracted:
    try:
        from openpyxl import load_workbook  # noqa: PLC0415
    except ImportError:
        return _missing("openpyxl", "XLSX")
    wb = load_workbook(str(p), read_only=True, data_only=True)
    lines: list[str] = []
    for ws in wb.worksheets:
        lines.append(f"# аркуш: {ws.title}")
        for row in ws.iter_rows(values_only=True):
            cells = ["" if c is None else str(c) for c in row]
            if any(c for c in cells):
                lines.append("\t".join(cells))
            if sum(len(x) for x in lines) > max_chars:
                break
    wb.close()
    text = "\n".join(lines).strip()
    return Extracted(_cut(text, max_chars), "openpyxl", None) if text else Extracted(
        None, "openpyxl", "книга порожня"
    )


def _rtf(p: Path, max_chars: int) -> Extracted:
    try:
        from striprtf.striprtf import rtf_to_text  # noqa: PLC0415
    except ImportError:
        return _missing("striprtf", "RTF")
    text = rtf_to_text(p.read_text(encoding="utf-8", errors="ignore")).strip()
    return Extracted(_cut(text, max_chars), "striprtf", None) if text else Extracted(
        None, "striprtf", "документ порожній"
    )


def _odf(p: Path, max_chars: int) -> Extracted:
    """ODF — це zip із XML. Розбираємо стандартною бібліотекою, без залежностей.

    Ті самі межі, що й у DOCX, тільки іменами ODF: раніше тут стояв лише
    `<text:p>`, тож комірки таблиці ODS зліплювались в один рядок.
    """
    raw = _zip_member(p, "content.xml")
    raw = re.sub(r"<text:tab\b[^>]*/>", "\t", raw)
    raw = re.sub(r"<text:line-break\b[^>]*/>", "\n", raw)
    raw = re.sub(r"</text:(?:p|h)>", "\n", raw)
    raw = re.sub(r"</table:table-cell>", "\t", raw)
    raw = re.sub(r"</table:table-row>", "\n", raw)
    text = _flatten(raw)
    return Extracted(_cut(text, max_chars), "zipfile+xml", None) if text else Extracted(
        None, "zipfile+xml", "документ порожній"
    )
