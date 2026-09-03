"""Текст із документа — або чесне «не вмію», і ніколи base64 у модель.

**Навіщо цей модуль існує.** `file_manager.read_file` — побайтова читалка:
UTF-8 без нулів віддається як текст, усе інше як base64. Для файлового
браузера у вебі це правильно (зображення так і показують). Для МОДЕЛІ це
отрута: на питання «що в цьому договорі» вона діставала стіну base64 і
переказувала документ, якого не бачила. Мовчання джерела набувало форми,
яку споживач читає як зміст.

**Гірше за мовчання — вигадка з виглядом джерела.** Знімати розмітку
регулярками наосліп означає складати текст, якого в документі НЕМАЄ:
викреслене в режимі правок зліплюється з новим у неіснуюче число
(48000 + 72000 = «4800072000»), підсумок кошторису приліплюється до чужої
позиції, рахунок однієї сторони відвʼязується від її назви. Модель не має
як це запідозрити — воно виглядає рівно як зміст. Тому межі документа
розбираються СТРУКТУРНО: один прохід, який знає `<w:tc>`/`<w:tr>` як межі,
а не прибирання наслідків регуляркою постфактум.

**Межа стоїть у відповіді, а не в документації.** Якщо бібліотеки розбору в
цій збірці немає — інструмент каже це словами й називає формат. «Наче вміємо»
не буває: саме воно й породжує вигадку. З тієї самої причини вголос
називаються колонтитули й виноски, нотатки доповідача, формули без
збереженого значення та будь-яке обрізання: неповний документ, поданий як
повний, — та сама брехня, тільки навпаки.

**Причина відмови — для людини, а не для стектрейсу.** `FileNotDecryptedError`
не каже українською нічого, а головне — не відрізняє файл під паролем від
пошкодженого, тож людина не дізнається, що треба просто ввести пароль.

**Імпорти навмисно ліниві.** Модуль працює без жодної нової залежності:
без `pypdf`/`openpyxl` він просто відмовляє чесно, а щойно бібліотеку
внесуть у збірку — витяг вмикається сам, без правок коду.

**OOXML і ODF розбираються стандартною бібліотекою — навмисно.** DOCX, PPTX,
ODT і ODS — це zip із XML. Заміряно 03.09.2026: `python-docx` тягне `lxml` і
важить 14,9 МБ із 21,2 МБ усього набору, а віддає той САМИЙ текст, що обхід
розмітки, ще й губить порядок документа (спершу всі абзаци, потім усі
таблиці). Тож у пакунок їдуть лише `pypdf`, `openpyxl` і `striprtf` —
6,7 МБ, а не 21,2.
"""

from __future__ import annotations

import posixpath
import re
import zipfile
from html import unescape
from itertools import zip_longest
from pathlib import Path

# Формати, які ЛЮДИНА називає документом. Для них base64 у модель
# заборонений: або текст, або сказана вголос відмова.
DOCUMENT_EXTS: frozenset[str] = frozenset(
    {".pdf", ".docx", ".xlsx", ".xlsm", ".rtf", ".odt", ".ods", ".doc", ".pptx"}
)

IMAGE_EXTS: frozenset[str] = frozenset(
    {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".heic", ".heif", ".gif", ".tiff", ".tif"}
)

# Стеля на РОЗПАКОВАНИЙ розмір XML, звірена з `ZipInfo.file_size` ДО читання.
# Заміряно 03.09.2026: `document.xml` на 120 МБ (файл на диску 404 КБ) давав
# пік RSS 939 МБ — роздування ≈8× через ланцюг повних копій рядка. Чотири
# мегабайти зі стисненням 300:1 дали б ~9,5 ГБ, тобто бекенд гине від
# сторожа памʼяті, а причина виглядає як «сама впала».
MAX_XML_BYTES: int = 16 * 1024 * 1024

# Межа абзацу ВСЕРЕДИНІ комірки. Рядок таблиці мусить лишитись ОДНИМ рядком,
# інакше рахунок UA1111… відвʼязується від сторони, якій належить, — тому
# абзаци комірки не можна розділяти переносом.
CELL_PARA_SEP = " · "


class Extracted:
    """Результат витягу. Стани названі, і жоден із них не мовчить."""

    __slots__ = ("text", "extractor", "reason", "truncated")

    def __init__(
        self,
        text: str | None,
        extractor: str | None,
        reason: str | None,
        truncated: bool = False,
    ):
        self.text = text
        self.extractor = extractor
        self.reason = reason
        # Прапорець, а не лише маркер у тексті: стик `read_file → модель` має
        # власну стелю, і якщо наша виявиться нижчою, він побачить коротку
        # довжину й скаже моделі `truncated: False` поруч із обрізаним
        # текстом. Прапорець знімає цей здогад.
        self.truncated = truncated

    @property
    def ok(self) -> bool:
        return self.text is not None


class _Refuse(Exception):
    """Причина відмови, вже сказана людською мовою."""


def is_document(name: str) -> bool:
    return Path(name).suffix.lower() in DOCUMENT_EXTS


def is_image(name: str) -> bool:
    return Path(name).suffix.lower() in IMAGE_EXTS


def extract(path: str | Path, *, max_chars: int = 200_000) -> Extracted:
    """Дістати текст. Ніколи не кидає: збій — це названа причина, не виняток."""
    p = Path(path)
    ext = p.suffix.lower()
    try:
        if ext in DOCUMENT_EXTS:
            _guard_file(p)
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
            return Extracted(
                None,
                None,
                "це старий двійковий формат Word (.doc), а не .docx — "
                "відкрийте його й збережіть як .docx, тоді прочитаю",
            )
        if ext == ".pptx":
            return _pptx(p, max_chars)
    except _Refuse as exc:
        return Extracted(None, None, str(exc))
    except Exception:  # noqa: BLE001 — причина мусить доїхати словами
        return Extracted(None, None, _damaged(p))
    return Extracted(None, None, f"формат {ext or 'без розширення'} не належить до документів")


def _missing(lib: str, fmt: str) -> Extracted:
    return Extracted(
        None,
        None,
        f"у цій збірці немає бібліотеки {lib}, тому {fmt} я не читаю; "
        "не переказуй вміст, якого не бачив",
    )


def _cut(text: str, max_chars: int) -> str:
    """Обрізати — і СКАЗАТИ це. Мовчазне обрізання = неповне, подане як повне."""
    if len(text) <= max_chars:
        return text
    return (
        text[:max_chars].rstrip()
        + f"\n\n[показано {max_chars} символів із {len(text)} — далі обрізано, "
        "не переказуй документ як повний]"
    )


def _ready(text: str, extractor: str, max_chars: int) -> Extracted:
    return Extracted(_cut(text, max_chars), extractor, None, truncated=len(text) > max_chars)


# ── людські причини відмови ───────────────────────────────────────────────
_OLE = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
# Імена потоків у OLE-контейнері лежать у UTF-16LE.
_ENCRYPTED = "EncryptedPackage".encode("utf-16-le")


def _head(p: Path, n: int = 8) -> bytes:
    try:
        with p.open("rb") as f:
            return f.read(n)
    except OSError:
        return b""


def _guard_file(p: Path) -> None:
    """Три причини, які видно ще до відкриття, — і кожна називає себе."""
    if not p.exists():
        raise _Refuse("файла немає за цим шляхом")
    if p.is_dir():
        raise _Refuse("це тека, а не файл")
    try:
        size = p.stat().st_size
    except OSError:
        return
    if size == 0:
        raise _Refuse("файл порожній — у ньому 0 байт, читати нічого")


def _damaged(p: Path) -> str:
    """Останній рубіж: причини не впізнано, але людині все одно щось сказати."""
    if _head(p).startswith(b"%PDF-") and p.suffix.lower() != ".pdf":
        return f"файл названо {p.suffix}, а всередині PDF — перейменуйте його на .pdf"
    return (
        "файл не піддався розбору — схоже, він пошкоджений або збережений "
        "у форматі, якого я не знаю; не переказуй вміст, якого не бачив"
    )


def _not_a_zip(p: Path, kind: str) -> str:
    """DOCX/XLSX/PPTX — це zip. Якщо зіпа немає, причин рівно кілька, і всі відомі."""
    head = _head(p)
    if head.startswith(b"%PDF-"):
        return (
            f"файл названо {p.suffix}, а всередині PDF — "
            "перейменуйте його на .pdf, і я прочитаю"
        )
    if head.startswith(b"{\\rtf"):
        return f"файл названо {p.suffix}, а всередині RTF — перейменуйте його на .rtf"
    if head.startswith(_OLE):
        # Ключова відмінність: під паролем файл ЧИТАЄТЬСЯ, щойно пароль ввести.
        # Мовчазне «пошкоджений» позбавляло людину саме цього знання.
        try:
            with p.open("rb") as f:
                blob = f.read(65536)
        except OSError:
            blob = b""
        if _ENCRYPTED in blob:
            return (
                "файл захищений паролем: відкрийте його з паролем і збережіть "
                "копію без пароля — тоді прочитаю"
            )
        return (
            "файл або захищений паролем, або збережений у старому двійковому "
            "форматі Office. Якщо під паролем — збережіть копію без пароля; "
            f"якщо старий — відкрийте й «Зберегти як» {kind}"
        )
    if head.startswith(b"PK"):
        return f"це {kind}-контейнер, але пошкоджений: архів не відкривається"
    return (
        f"це не {kind}: всередині немає zip-контейнера. Схоже, файлу підмінили "
        "розширення або він пошкоджений"
    )


_WHAT_IS_INSIDE = (
    ("word/document.xml", "DOCX (документ Word)"),
    ("xl/workbook.xml", "XLSX (книга Excel)"),
    ("ppt/presentation.xml", "PPTX (презентація PowerPoint)"),
    ("content.xml", "документ ODF (LibreOffice)"),
)


def _wrong_container(z: zipfile.ZipFile, want: str) -> str:
    names = set(z.namelist())
    for probe, human in _WHAT_IS_INSIDE:
        if probe in names and probe != want:
            return (
                f"у контейнері немає частини {want} — натомість усередині "
                f"{human}; розширення не збігається зі змістом"
            )
    return f"у контейнері немає частини {want}: це zip, але не той документ, яким його назвали"


def _open_zip(p: Path, kind: str) -> zipfile.ZipFile:
    _guard_file(p)
    try:
        return zipfile.ZipFile(p)
    except zipfile.BadZipFile:
        raise _Refuse(_not_a_zip(p, kind)) from None


class _Budget:
    """Скільки РОЗПАКОВАНОГО XML цьому документові ще дозволено."""

    __slots__ = ("left",)

    def __init__(self) -> None:
        self.left = MAX_XML_BYTES

    def take(self, name: str, size: int) -> None:
        if size > self.left:
            raise _Refuse(
                f"розпакований {name} важить {_mb(size)} — разом із рештою частин "
                f"це вище за стелю {_mb(MAX_XML_BYTES)}, і я не розгортаю такий "
                "файл у памʼять; це або бомба стиснення, або документ, який "
                "варто відкрити в редакторі"
            )
        self.left -= size


def _mb(n: int) -> str:
    return f"{n / 1024 / 1024:.1f} МБ"


def _member(z: zipfile.ZipFile, name: str, budget: _Budget) -> str:
    try:
        info = z.getinfo(name)
    except KeyError:
        raise _Refuse(_wrong_container(z, name)) from None
    budget.take(name, info.file_size)
    return z.read(name).decode("utf-8", errors="ignore")


# ── структурний обхід розмітки ────────────────────────────────────────────
# Один прохід, без повних копій рядка. Тег матчиться разом із лапками, тож
# незаекранований '>' усередині значення атрибута (`w:val="Розділ > Підрозділ"`
# — так пише Word структурні теги) більше не ріже тег навпіл і не висипає
# хвіст атрибута у текст документа.
_SCAN = re.compile(
    r"<!--.*?-->"
    r"|<\?.*?\?>"
    r"|<!\[CDATA\[(?P<cdata>.*?)\]\]>"
    r"|<!(?:[^>\"']|\"[^\"]*\"|'[^']*')*>"
    r"|<(?P<close>/?)(?P<name>[A-Za-z_][\w.:-]*)(?P<attrs>(?:[^>\"']|\"[^\"]*\"|'[^']*')*)>",
    re.S,
)


def _attr(attrs: str, name: str) -> str | None:
    m = re.search(r"\b" + re.escape(name) + r'\s*=\s*"([^"]*)"', attrs)
    return m.group(1) if m else None


def _count(attrs: str, names: tuple[str, ...]) -> int:
    """Скільки колонок стосується комірки. 64 — стеля проти роздутих ODF-повторів."""
    best = 1
    for n in names:
        raw = _attr(attrs, n)
        if raw and raw.isdigit():
            best = max(best, min(int(raw), 64))
    return best


class _Grammar:
    """Одні й ті самі межі, названі іменами свого формату."""

    __slots__ = ("text", "para", "cell", "row", "tab", "brk", "skip", "span_el",
                 "span_attr", "repeat_attr")

    def __init__(self, *, text, para, cell, row, tab, brk, skip,
                 span_el=None, span_attr=(), repeat_attr=()):
        self.text = text  # None → символьний вміст будь-де всередині абзацу
        self.para = para
        self.cell = cell
        self.row = row
        self.tab = tab
        self.brk = brk
        self.skip = skip
        self.span_el = span_el or {}
        self.span_attr = span_attr
        self.repeat_attr = repeat_attr


# WordprocessingML. Текст беремо ЛИШЕ з `<w:t>`, тож `<w:delText>` (викреслене)
# і `<w:instrText>` (інструкція поля на кшталт `TOC \o "1-3" \h \z \u`) не
# мають шансу доїхати; піддерева `<w:del>`/`<w:moveFrom>` викидаються ще й
# цілком — щоб правка, вкладена в правку, теж не пролізла. `mc:Fallback` —
# це VML-двійник, який Word пише поруч із `mc:Choice` для КОЖНОГО текстового
# поля й кожної виноски-хмаринки; без цього їхній текст їхав двічі.
_W = _Grammar(
    text={"w:t"},
    para={"w:p"},
    cell={"w:tc"},
    row={"w:tr"},
    tab={"w:tab", "w:ptab"},
    brk={"w:br", "w:cr"},
    skip={"w:del", "w:delText", "w:moveFrom", "w:instrText", "w:delInstrText", "mc:Fallback"},
    span_el={"w:gridSpan": "w:val"},
)

# DrawingML (PPTX): текст слайда живе в `<a:t>`.
_A = _Grammar(
    text={"a:t"},
    para={"a:p"},
    cell={"a:tc"},
    row={"a:tr"},
    tab=frozenset(),
    brk={"a:br"},
    skip={"mc:Fallback"},
    span_attr=("gridSpan",),
)

# ODF. Тут символьний вміст лежить просто в абзаці (та в `<text:span>`), тож
# іменованих текстових вузлів немає — беремо все, що всередині абзацу.
# `<text:tracked-changes>` стоїть на ПОЧАТКУ `office:text`, тому викреслене
# речення приїжджало найпершим рядком, ще й з іменем рецензента й датою.
_ODF = _Grammar(
    text=None,
    para={"text:p", "text:h"},
    cell={"table:table-cell"},
    row={"table:table-row"},
    tab={"text:tab"},
    brk={"text:line-break"},
    skip={"text:tracked-changes"},
    span_attr=("table:number-columns-spanned",),
    repeat_attr=("table:number-columns-repeated",),
)


class _Out:
    """Збирач тексту, який знає про абзаци, комірки й рядки таблиці."""

    __slots__ = ("limit", "full", "_lines", "_n", "_buf", "_cells", "_rows")

    def __init__(self, limit: int) -> None:
        self.limit = limit
        self.full = False
        self._lines: list[str] = []
        self._n = 0
        self._buf: list[str] = []
        self._cells: list[list] = []  # [абзаци, скільки колонок, скільки повторів]
        self._rows: list[list[str]] = []

    def text(self, s: str) -> None:
        if s:
            self._buf.append(s)

    def _put(self, line: str) -> None:
        if self._cells:  # вкладена таблиця — її рядок стає абзацом комірки
            self._cells[-1][0].append(line.strip())
            return
        if self._lines:
            self._n += 1
        self._n += len(line)
        self._lines.append(line)
        if self._n >= self.limit:
            self.full = True

    def end_para(self) -> None:
        s = "".join(self._buf)
        self._buf.clear()
        if not s.strip():
            return
        # У комірці абзац обрізається з обох боків; на рівні документа лівий
        # відступ (`<w:tab/>` на початку пункту) — це зміст, і він лишається.
        self._put(s.strip() if self._cells else s.rstrip())

    def start_row(self) -> None:
        self.end_para()
        self._rows.append([])

    def end_row(self) -> None:
        self.end_para()
        if not self._rows:
            return
        # Порожні комірки лишаються порожніми полями: саме вони тримають
        # колонки на місці, і саме на них ламався кожен рядок «РАЗОМ».
        line = "\t".join(self._rows.pop())
        if line.strip():
            self._put(line)

    def start_cell(self, span: int = 1, repeat: int = 1) -> None:
        self.end_para()
        self._cells.append([[], span, repeat])

    def set_span(self, n: int) -> None:
        if n > 1 and self._cells:
            self._cells[-1][1] = min(n, 64)

    def end_cell(self) -> None:
        self.end_para()
        if not self._cells:
            return
        paras, span, repeat = self._cells.pop()
        txt = CELL_PARA_SEP.join(x for x in paras if x)
        if not self._rows:
            if txt:
                self._put(txt)
            return
        row = self._rows[-1]
        row.append(txt)
        row.extend([""] * (span - 1))  # обʼєднана комірка тримає свої колонки
        row.extend([txt] * (repeat - 1))  # повторена — повторює свій вміст

    def flush(self) -> str:
        while self._cells:
            self.end_cell()
        while self._rows:
            self.end_row()
        self.end_para()
        return "\n".join(self._lines)


def _walk(raw: str, g: _Grammar, limit: int) -> str:
    """Один прохід по розмітці: межі стають символами, відкинуте не доїжджає."""
    out = _Out(limit)
    pos = 0
    depth = 0
    skip_at: int | None = None
    take = 0  # відкриті текстові вузли (для ODF — відкриті абзаци)
    named = g.text is not None
    for m in _SCAN.finditer(raw):
        if take > 0 and skip_at is None and m.start() > pos:
            out.text(unescape(raw[pos:m.start()]))
        pos = m.end()
        name = m.group("name")
        if name is None:
            cd = m.group("cdata")
            if cd and take > 0 and skip_at is None:
                out.text(cd)
            continue
        attrs = m.group("attrs") or ""
        if m.group("close"):
            if skip_at is not None:
                if depth == skip_at:
                    skip_at = None
                depth -= 1
                continue
            if name in g.para:
                out.end_para()
                if not named:
                    take = max(0, take - 1)
            elif name in g.cell:
                out.end_cell()
            elif name in g.row:
                out.end_row()
            elif named and name in g.text:
                take = max(0, take - 1)
            depth -= 1
            if out.full:
                break
            continue
        if attrs.rstrip().endswith("/"):  # порожній елемент
            if skip_at is None:
                if name in g.tab:
                    out.text("\t")
                elif name in g.brk:
                    out.end_para()
                elif name in g.span_el:
                    val = _attr(attrs, g.span_el[name]) or ""
                    if val.isdigit():
                        out.set_span(int(val))
            continue
        depth += 1
        if skip_at is not None:
            continue
        if name in g.skip:
            skip_at = depth
        elif name in g.row:
            out.start_row()
        elif name in g.cell:
            out.start_cell(_count(attrs, g.span_attr), _count(attrs, g.repeat_attr))
        elif name in g.para:
            if not named:
                take += 1
        elif named and name in g.text:
            take += 1
    return out.flush()


# ── PDF ────────────────────────────────────────────────────────────────────
def _pdf(p: Path, max_chars: int) -> Extracted:
    try:
        from pypdf import PdfReader  # noqa: PLC0415 — лінивий навмисно
    except ImportError:
        return _missing("pypdf", "PDF")
    try:
        reader = PdfReader(str(p))
        encrypted = bool(reader.is_encrypted)
    except Exception:  # noqa: BLE001
        raise _Refuse(_pdf_broken(p)) from None
    if encrypted:
        # Порожній пароль відкриває PDF, замкнений лише «паролем власника»;
        # якщо не відкрив — це справжній пароль користувача, і його треба
        # НАЗВАТИ, інакше людина шукатиме пошкодження там, де його немає.
        try:
            opened = reader.decrypt("")
        except Exception:  # noqa: BLE001
            opened = 0
        if not opened:
            raise _Refuse(
                "PDF захищений паролем — без пароля я його не відкрию; "
                "надішліть копію без пароля або зніміть його в переглядачі"
            )
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
    return _ready(text, "pypdf", max_chars)


def _pdf_broken(p: Path) -> str:
    if not _head(p).startswith(b"%PDF-"):
        return "файл названо .pdf, але всередині не PDF — розширення не збігається зі змістом"
    return "PDF пошкоджений: заголовок є, а структура файла не читається"


# ── DOCX ───────────────────────────────────────────────────────────────────
# Частини, які лежать ПОЗА `word/document.xml` і яких раніше не було у витягу
# взагалі. Порядок кортежу — це порядок у витягу: спершу верхні колонтитули,
# потім нижні, потім виноски й кінцеві виноски.
_MARGINS = (
    (re.compile(r"^word/header\d*\.xml$"), "колонтитул"),
    (re.compile(r"^word/footer\d*\.xml$"), "колонтитул"),
    (re.compile(r"^word/footnotes\.xml$"), "виноски"),
    (re.compile(r"^word/endnotes\.xml$"), "виноски"),
)


def _docx(p: Path, max_chars: int) -> Extracted:
    """DOCX — zip із XML, як і ODT; `python-docx` сюди не потрібен."""
    budget = _Budget()
    with _open_zip(p, "DOCX") as z:
        body = _walk(_member(z, "word/document.xml", budget), _W, max_chars)
        margins = _margins(z, budget, max_chars)
    if not body and not margins:
        return Extracted(None, "zipfile+xml", "документ порожній або тримає лише зображення")
    return _ready("\n\n".join(x for x in (body, margins) if x), "zipfile+xml", max_chars)


def _margins(z: zipfile.ZipFile, budget: _Budget, max_chars: int) -> str:
    """Колонтитули й виноски — веземо їх, позначивши, чим вони є.

    ЧОМУ ВЕЗЕМО, А НЕ ПРОСТО НАЗИВАЄМО, ЩО ВОНИ Є. Обидва варіанти чесні, але
    відповідають на різні питання. «У документі є колонтитул, я його не
    показую» знімає з інструмента брехню й лишає людину без відповіді: на
    питання «чи є гриф обмеження доступу» модель однаково не відповість —
    хоча байти лежать у тому самому зіпі й коштують один прохід тим самим
    розбирачем. Мовчати про те, що тримаєш у руках, — не скромність. Саме
    тут і живе гриф «ДЛЯ СЛУЖБОВОГО КОРИСТУВАННЯ»: це не оздоба сторінки,
    це режим поводження з документом.

    Позначка обовʼязкова: без неї гриф читається як абзац договору, а номер
    сторінки — як його текст. І стоять вони ПІСЛЯ тіла, щоб документ
    починався своїм заголовком; протилежне — рівно та вада, через яку
    викреслене в ODT приїжджало першим рядком.
    """
    groups: dict[str, list[str]] = {}
    names = sorted(z.namelist())
    for rx, label in _MARGINS:
        for name in names:
            if not rx.match(name):
                continue
            bucket = groups.setdefault(label, [])
            try:
                text = _walk(_member(z, name, budget), _W, max_chars)
            except _Refuse as exc:
                bucket.append(f"[{name} не показано: {exc}]")
                continue
            # Word повторює той самий колонтитул для першої/парних/непарних
            # сторінок — та сама фраза тричі це шум, а не зміст.
            if text and text not in bucket:
                bucket.append(text)
    out: list[str] = []
    for label in ("колонтитул", "виноски"):
        if groups.get(label):
            out.append(f"# {label}\n" + "\n".join(groups[label]))
    return "\n\n".join(out)


# ── PPTX ───────────────────────────────────────────────────────────────────
_SLIDE = re.compile(r"ppt/slides/slide\d+\.xml")
_RELATIONSHIP = re.compile(r"<Relationship\b((?:[^>\"']|\"[^\"]*\")*)>")
_SLDID = re.compile(r"<p:sldId\b((?:[^>\"']|\"[^\"]*\")*)>")


def _rel_path(base: str, target: str) -> str:
    t = target.replace("\\", "/")
    return posixpath.normpath(t[1:] if t.startswith("/") else posixpath.join(base, t))


def _pptx_order(z: zipfile.ZipFile, names: set[str]) -> list[str]:
    """Авторитетний порядок показу — `<p:sldIdLst>` плюс звʼязки, а не імена файлів.

    Переставляючи слайди, PowerPoint НЕ перейменовує `slideN.xml`. Тому
    сортування за числом в імені віддавало презентацію з `sldIdLst` = 3,2,1
    перевернутою — висновок подавався моделі як титул.
    """
    by_number = sorted(
        (n for n in names if _SLIDE.fullmatch(n)),
        key=lambda n: int(re.search(r"(\d+)", n.rsplit("/", 1)[1]).group(1)),
    )
    try:
        pres = z.read("ppt/presentation.xml").decode("utf-8", errors="ignore")
        rels = z.read("ppt/_rels/presentation.xml.rels").decode("utf-8", errors="ignore")
    except (KeyError, zipfile.BadZipFile):
        return by_number
    target: dict[str, str] = {}
    for m in _RELATIONSHIP.finditer(rels):
        rid, tgt = _attr(m.group(1), "Id"), _attr(m.group(1), "Target")
        if rid and tgt:
            target[rid] = _rel_path("ppt", tgt)
    ordered: list[str] = []
    for m in _SLDID.finditer(pres):
        member = target.get(_attr(m.group(1), "r:id") or "")
        if member in names and member not in ordered:
            ordered.append(member)
    if not ordered:
        return by_number
    # Слайд, якого немає в списку показу, все одно не губимо мовчки.
    ordered += [n for n in by_number if n not in ordered]
    return ordered


def _pptx_notes(z: zipfile.ZipFile, names: set[str], slide: str) -> str | None:
    """Нотатки доповідача: звʼязок ЧИТАЄТЬСЯ, а не вгадується з числа в імені."""
    base = slide.rsplit("/", 1)[1]
    rel = f"ppt/slides/_rels/{base}.rels"
    if rel in names:
        raw = z.read(rel).decode("utf-8", errors="ignore")
        for m in _RELATIONSHIP.finditer(raw):
            tgt = _attr(m.group(1), "Target") or ""
            if "notesSlide" in tgt:
                cand = _rel_path("ppt/slides", tgt)
                if cand in names:
                    return cand
        return None  # звʼязки є, нотаток серед них немає — це відповідь
    m = re.search(r"(\d+)", base)
    cand = f"ppt/notesSlides/notesSlide{m.group(1)}.xml" if m else ""
    return cand if cand in names else None


def _pptx(p: Path, max_chars: int) -> Extracted:
    """PPTX — той самий zip із XML: текст слайда живе в `<a:t>`."""
    budget = _Budget()
    chunks: list[str] = []
    with _open_zip(p, "PPTX") as z:
        names = set(z.namelist())
        order = _pptx_order(z, names)
        if not order:
            raise _Refuse(_wrong_container(z, "ppt/slides/slideN.xml"))
        for i, member in enumerate(order, 1):
            part = [f"# слайд {i}"]
            body = _walk(_member(z, member, budget), _A, max_chars)
            if body:
                part.append(body)
            notes_member = _pptx_notes(z, names, member)
            if notes_member:
                notes = _walk(_member(z, notes_member, budget), _A, max_chars)
                if notes:
                    part.append("\n# нотатки доповідача\n" + notes)
            if len(part) > 1:
                chunks.append("\n".join(part))
            if sum(len(x) for x in chunks) > max_chars:
                break
    if not chunks:
        # Слайди є, тексту немає — це вимір, і його треба назвати, інакше
        # порожнеча читається як «у презентації нічого».
        return Extracted(
            None, "zipfile+xml", f"у презентації {len(order)} слайд(ів) і жодного тексту"
        )
    return _ready("\n\n".join(chunks), "zipfile+xml", max_chars)


# ── XLSX ───────────────────────────────────────────────────────────────────
def _xlsx(p: Path, max_chars: int) -> Extracted:
    try:
        from openpyxl import load_workbook  # noqa: PLC0415
    except ImportError:
        return _missing("openpyxl", "XLSX")
    # Спершу відкриваємо zip самі: openpyxl на файлі під паролем кидає
    # BadZipFile, і причина доїжджала іменем класу замість слова «пароль».
    with _open_zip(p, "XLSX") as z:
        if "xl/workbook.xml" not in set(z.namelist()):
            raise _Refuse(_wrong_container(z, "xl/workbook.xml"))
    # Два проходи навмисно. `data_only=True` бере КЕШ обчислення, якого в
    # програмно згенерованому файлі (openpyxl, 1С, будь-який експорт) немає:
    # колонка «сума» приїжджала порожньою, а рядка «РАЗОМ» фактично не було —
    # мовчки. Другий прохід бачить самі формули, і різниця між ними — це
    # рівно ті комірки, про які треба сказати вголос. Заміряно 03.09.2026 на
    # 40 000 рядків: 1,18 с проти 1,57 с, тобто +33%, а не вдвічі.
    values = load_workbook(str(p), read_only=True, data_only=True)
    formulas = load_workbook(str(p), read_only=True, data_only=False)
    lines: list[str] = []
    total = 0
    try:
        for wsv, wsf in zip(values.worksheets, formulas.worksheets):
            head = f"# аркуш: {wsv.title}"
            lines.append(head)
            total += len(head) + 1
            pairs = zip(wsv.iter_rows(values_only=True), wsf.iter_rows(values_only=True))
            for rv, rf in pairs:
                cells: list[str] = []
                seen = False
                for value, formula in zip_longest(rv, rf):
                    if value is None and isinstance(formula, str) and formula.startswith("="):
                        cells.append(f"[формула {formula} без збереженого значення]")
                        seen = True
                    elif value is None:
                        cells.append("")
                    else:
                        cells.append(str(value))
                        seen = True
                if seen:
                    line = "\t".join(cells)
                    lines.append(line)
                    total += len(line) + 1
                if total > max_chars:
                    break
            if total > max_chars:
                break
    finally:
        values.close()
        formulas.close()
    text = "\n".join(lines).strip()
    if not text:
        return Extracted(None, "openpyxl", "книга порожня")
    return _ready(text, "openpyxl", max_chars)


# ── RTF ────────────────────────────────────────────────────────────────────
def _rtf(p: Path, max_chars: int) -> Extracted:
    try:
        from striprtf.striprtf import rtf_to_text  # noqa: PLC0415
    except ImportError:
        return _missing("striprtf", "RTF")
    text = rtf_to_text(p.read_text(encoding="utf-8", errors="ignore")).strip()
    if not text:
        return Extracted(None, "striprtf", "документ порожній")
    return _ready(text, "striprtf", max_chars)


# ── ODF ────────────────────────────────────────────────────────────────────
def _odf(p: Path, max_chars: int) -> Extracted:
    """ODF — це zip із XML. Розбираємо стандартною бібліотекою, без залежностей."""
    budget = _Budget()
    with _open_zip(p, "ODF") as z:
        text = _walk(_member(z, "content.xml", budget), _ODF, max_chars)
    if not text:
        return Extracted(None, "zipfile+xml", "документ порожній")
    return _ready(text, "zipfile+xml", max_chars)
