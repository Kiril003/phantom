"""
Vertical V10 — Mission PDF export.

Converts a MissionReport + ledger.md + asset directory into a single PDF file.

Strategy (graceful degradation):
1. Try weasyprint  — full HTML→PDF with CSS styling, embedded images.
2. Fallback to reportlab — plain-text PDF, still complete content.
3. If neither is installed, return a failure dict with reason="pdf_backend_missing".

The produced PDF lands at:
    ~/.phantom/missions/<id>/report.pdf

Styles:
  "minimal"  — clean typography, no branding chrome.
  "branded"  — PHANTOM OS monospace header/footer per page.

Neither style requires a build step. The HTML template is inline Python
strings — no Jinja2, no npm. Tailwind classes are NOT used here because
weasyprint does not load remote CDN sheets. Inline CSS only.

Deps (add to requirements.txt if not present):
    markdown     — converts ledger.md to HTML for weasyprint path
    weasyprint   — HTML → PDF (optional; CI can skip)
    reportlab    — plain PDF fallback (optional)
"""
from __future__ import annotations

import asyncio
import logging
import os
import sys
from datetime import datetime, timezone
from typing import Any, Literal

logger = logging.getLogger(__name__)

_PHANTOM_HOME = os.path.expanduser("~/.phantom")


# ── CSS styles ────────────────────────────────────────────────────────────────

_CSS_MINIMAL = """
@page { margin: 2cm; }
body { font-family: 'DejaVu Sans', Helvetica, sans-serif; font-size: 10pt;
       line-height: 1.5; color: #1a1a1a; }
h1 { font-size: 18pt; border-bottom: 2px solid #333; padding-bottom: 6pt; }
h2 { font-size: 13pt; margin-top: 18pt; color: #222; }
h3 { font-size: 11pt; color: #333; }
code { font-family: 'DejaVu Sans Mono', monospace; font-size: 9pt;
       background: #f4f4f4; padding: 1pt 3pt; }
pre  { background: #f4f4f4; padding: 8pt; overflow-wrap: break-word; }
ul   { margin-left: 18pt; }
li   { margin-bottom: 3pt; }
.meta { color: #555; font-size: 9pt; }
.kpi  { display: inline-block; margin-right: 24pt; }
.kpi-val { font-size: 16pt; font-weight: bold; }
.kpi-lbl { font-size: 8pt; color: #666; display: block; }
"""

_CSS_BRANDED = _CSS_MINIMAL + """
@page {
    @top-center { content: "PHANTOM OS — " string(mission-title);
                  font-family: 'DejaVu Sans Mono', monospace;
                  font-size: 8pt; color: #555; }
    @bottom-right { content: "Page " counter(page) " / " counter(pages)
                              " · " string(mission-id-short);
                    font-size: 8pt; color: #555; }
}
h1 { string-set: mission-title content(text); }
.mission-id-short { string-set: mission-id-short content(text); }
"""

_HTML_TEMPLATE = """\
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><style>{css}</style></head>
<body>
<h1>{title}</h1>
<p class="meta mission-id-short">Mission: {mission_id_short} &nbsp;·&nbsp; Generated: {generated_at}</p>

<h2>Overview</h2>
<div>
  <span class="kpi"><span class="kpi-val">{phase_count}</span><span class="kpi-lbl">phases</span></span>
  <span class="kpi"><span class="kpi-val">{duration_h:.1f}h</span><span class="kpi-lbl">wall clock</span></span>
  <span class="kpi"><span class="kpi-val">{total_decisions}</span><span class="kpi-lbl">decisions</span></span>
  <span class="kpi"><span class="kpi-val">{total_artifacts}</span><span class="kpi-lbl">artifacts</span></span>
  <span class="kpi"><span class="kpi-val">{status}</span><span class="kpi-lbl">status</span></span>
</div>

<h2>Mission Brief</h2>
<p>{brief}</p>

<h2>Success Criteria</h2>
<p>{success_criteria}</p>

<h2>Summary</h2>
<p>{overall_summary}</p>

{phases_html}

{resources_html}

{lessons_html}

{ledger_html}
</body>
</html>
"""

_PHASE_TEMPLATE = """\
<h2>Phase {num}: {description}</h2>
<p class="meta">Status: {status} &nbsp;·&nbsp; Duration: {duration}</p>
{achievements_html}
{decisions_html}
{artifacts_html}
{lessons_html}
"""

# ── HTML helpers ──────────────────────────────────────────────────────────────


def _ul(items: list[str], empty_label: str = "(none)") -> str:
    if not items:
        return f"<p class='meta'>{empty_label}</p>"
    lis = "".join(f"<li>{_esc(item)}</li>" for item in items)
    return f"<ul>{lis}</ul>"


def _esc(text: str) -> str:
    return (
        str(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _phase_html(phase: Any) -> str:
    duration = f"{phase.duration_h:.2f}h" if phase.duration_h is not None else "n/a"
    num = phase.idx + 1

    achievements_html = (
        "<h3>Achievements</h3>" + _ul(phase.achievements)
        if phase.achievements else ""
    )
    decisions_html = ""
    if phase.decisions:
        rows = "".join(
            f"<li>{_esc(d.get('summary', ''))} "
            f"<em>({_esc(d.get('verdict', ''))})</em></li>"
            for d in phase.decisions
        )
        decisions_html = f"<h3>Key Decisions</h3><ul>{rows}</ul>"

    artifacts_html = ""
    if phase.artifacts:
        rows = "".join(
            f"<li><code>{_esc(a.get('path', ''))}</code> "
            f"[{_esc(a.get('kind', ''))}]</li>"
            for a in phase.artifacts
        )
        artifacts_html = f"<h3>Artifacts</h3><ul>{rows}</ul>"

    lessons_html = (
        "<h3>Lessons</h3>" + _ul(phase.lessons)
        if phase.lessons else ""
    )

    return _PHASE_TEMPLATE.format(
        num=num,
        description=_esc(phase.description),
        status=_esc(phase.status),
        duration=duration,
        achievements_html=achievements_html,
        decisions_html=decisions_html,
        artifacts_html=artifacts_html,
        lessons_html=lessons_html,
    )


def _build_html(report: Any, ledger_md: str, style: str) -> str:
    from agent.schemas import MissionReport  # local import to avoid circulars

    css = _CSS_BRANDED if style == "branded" else _CSS_MINIMAL

    phases_html = "\n".join(_phase_html(p) for p in report.phases)

    res = report.resource_summary or {}
    resource_lines = [
        f"Peak RAM: {res.get('peak_ram_pct', 'n/a')}%",
        f"Avg CPU: {res.get('avg_cpu_pct', 'n/a')}%",
        f"Max CPU temp: {res.get('max_cpu_temp_c', 'n/a')} °C",
        f"Min disk free: {res.get('min_disk_free_gb', 'n/a')} GB",
    ]
    resources_html = "<h2>Resource Summary</h2>" + _ul(resource_lines)

    lessons_html = (
        "<h2>Aggregate Lessons</h2>" + _ul(report.aggregate_lessons)
        if report.aggregate_lessons else ""
    )

    # Convert ledger markdown to HTML if markdown library available.
    if ledger_md.strip():
        try:
            import markdown as _md
            ledger_body = _md.markdown(
                ledger_md,
                extensions=["fenced_code", "tables"],
            )
        except ImportError:
            ledger_body = f"<pre>{_esc(ledger_md)}</pre>"
        ledger_html = f"<h2>Mission Ledger</h2>{ledger_body}"
    else:
        ledger_html = ""

    mission_id_short = report.mission_id[:8]

    return _HTML_TEMPLATE.format(
        css=css,
        title=_esc(report.brief[:120]),
        mission_id_short=mission_id_short,
        generated_at=_esc(report.composed_at),
        phase_count=len(report.phases),
        duration_h=report.wall_duration_h,
        total_decisions=report.total_decisions,
        total_artifacts=report.total_artifacts,
        status=_esc(report.status),
        brief=_esc(report.brief),
        success_criteria=_esc(report.success_criteria),
        overall_summary=_esc(report.overall_summary),
        phases_html=phases_html,
        resources_html=resources_html,
        lessons_html=lessons_html,
        ledger_html=ledger_html,
    )


# ── weasyprint path ───────────────────────────────────────────────────────────


def _write_pdf_weasyprint(html: str, out_path: str) -> None:
    import weasyprint  # type: ignore[import]
    weasyprint.HTML(string=html).write_pdf(out_path)


# ── reportlab fallback ────────────────────────────────────────────────────────

#: Родини, у яких є кирилиця. Vera, що йде в комплекті з reportlab, її НЕ має:
#: український звіт вийшов би з порожнім тілом, бо Helvetica/Vera мовчки
#: пропускають гліфи, яких не знають, замість помилки.
#:
#: До 04.09.2026 тут стояли ЛИШЕ системні теки — і це робило рушій PDF мертвим
#: у пакунку. Заміряно: у `debian:12-slim`, `ubuntu:22.04` і `fedora:40`
#: шрифтових файлів рівно НУЛЬ, жодної з перелічених нижче тек там навіть не
#: існує; у самому AppImage — теж нуль. reportlab при цьому в бандлі живий,
#: тобто рушій їхав, а малювати кирилицю йому було нічим. На машині розробника
#: DejaVu стоїть системно, тож дефект не було видно НІКОЛИ — той самий клас, що
#: `libsndfile` через ctypes: «є на моїй машині» читається як «є».

#: Тека зі шрифтами ВСЕРЕДИНІ пакунка. Спосіб розвʼязування взято ОДИН-В-ОДИН
#: із `build_info._bundle_dirs()` — `sys._MEIPASS` для onefile, відкіт на теку
#: виконуваного файла, — а не написано заново. Причина конкретна: 03.09 пакунок
#: уже казав про одне місце, а писав в інше, і стан читався як «не встановлено»
#: поруч зі встановленим. Два різні розвʼязувачі шляху до одного бандла — це та
#: сама розбіжність, лише закладена наперед. Кладе туди файли `--add-data
#: "${BACKEND}/assets/fonts:assets/fonts"` у `scripts/build_sidecar.sh`; ім'я
#: підтеки нижче — друга половина тієї ж домовленості.
_BUNDLE_FONT_SUBDIR = os.path.join("assets", "fonts")


def _bundled_font_dirs() -> tuple[str, ...]:
    """Теки шрифтів усередині бандла PyInstaller — порожньо, якщо не в бандлі."""
    dirs: list[str] = []
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        dirs.append(os.path.join(str(meipass), _BUNDLE_FONT_SUBDIR))
    try:
        exe_dir = os.path.dirname(os.path.realpath(sys.executable))
    except (OSError, ValueError):
        exe_dir = ""
    if exe_dir:
        dirs.append(os.path.join(exe_dir, _BUNDLE_FONT_SUBDIR))
    return tuple(dirs)


#: Пакунок — ПЕРШИМ: він знає свій вміст точно, система — як пощастить.
#: Системні теки лишаються далі, тож на десктопі з уже поставленим DejaVu
#: поведінка не змінюється взагалі.
_FONT_DIRS = _bundled_font_dirs() + (
    "/usr/share/fonts/TTF",                  # Arch
    "/usr/share/fonts/truetype/dejavu",      # Debian, Ubuntu
    "/usr/share/fonts/dejavu",               # Fedora, RHEL
    "/usr/local/share/fonts",
    os.path.expanduser("~/.local/share/fonts"),
    os.path.expanduser("~/.fonts"),
)

_FONT_FILES = (
    ("DejaVuSans.ttf", "DejaVuSans-Bold.ttf", "DejaVuSans-Oblique.ttf", "DejaVuSans-BoldOblique.ttf"),
)

_RL_FAMILY: str | None | Literal[False] = None  # None — ще не шукали, False — немає
#: Тека, з якої родину справді взято. Без неї «шрифт знайдено» не відрізнити
#: від «шрифт знайдено В ПАКУНКУ»: на десктопі розробника обидва однакові.
_RL_FAMILY_DIR: str | None = None


def _reportlab_font() -> str | None:
    """Ім'я зареєстрованої родини з кирилицею, або None."""
    global _RL_FAMILY, _RL_FAMILY_DIR
    if _RL_FAMILY is not None:
        return _RL_FAMILY or None

    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.lib.fonts import addMapping

    for regular, bold, italic, bold_italic in _FONT_FILES:
        for directory in _FONT_DIRS:
            base = os.path.join(directory, regular)
            if not os.path.isfile(base):
                continue
            family = os.path.splitext(regular)[0]
            faces = {
                family: base,
                f"{family}-Bold": os.path.join(directory, bold),
                f"{family}-Italic": os.path.join(directory, italic),
                f"{family}-BoldItalic": os.path.join(directory, bold_italic),
            }
            try:
                for name, path in faces.items():
                    pdfmetrics.registerFont(TTFont(name, path if os.path.isfile(path) else base))
                addMapping(family, 0, 0, family)
                addMapping(family, 1, 0, f"{family}-Bold")
                addMapping(family, 0, 1, f"{family}-Italic")
                addMapping(family, 1, 1, f"{family}-BoldItalic")
            except Exception as exc:
                logger.warning("pdf_export: font %s unusable (%s)", base, exc)
                continue
            _RL_FAMILY = family
            _RL_FAMILY_DIR = directory
            return family

    _RL_FAMILY = False
    return None


def _needs_unicode(text: str) -> bool:
    return any(ord(ch) > 0xFF for ch in text)


def _write_pdf_reportlab(report: Any, ledger_md: str, style: str, out_path: str) -> None:
    from reportlab.lib.pagesizes import A4  # type: ignore[import]
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import cm
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, HRFlowable,
    )
    from reportlab.lib import colors

    styles = getSampleStyleSheet()
    h1 = styles["Heading1"]
    h2 = styles["Heading2"]
    h3 = styles["Heading3"]
    normal = styles["Normal"]

    family = _reportlab_font()
    if family:
        for st in (h1, h2, h3, normal):
            st.fontName = family if st is normal else f"{family}-Bold"
    else:
        # Вбудовані шрифти reportlab не мають кирилиці й не скаржаться — вони
        # просто нічого не малюють. Порожній звіт гірший за чесну помилку.
        probe = " ".join(
            [report.brief, report.overall_summary, report.success_criteria]
            + [p.description for p in report.phases]
        )
        if _needs_unicode(probe):
            # Саме `sys.frozen`, а не «чи непорожній _bundled_font_dirs()»:
            # відкіт на теку виконуваного файла є ЗАВЖДИ, і за ним пакунок від
            # dev-запуску не відрізнити — порада поїхала б навпаки.
            if getattr(sys, "frozen", False):
                # У пакунку порада «постав системний шрифт» веде людину не туди:
                # свій DejaVu ми ВЕЗЕМО з собою, тож сюди можна дійти лише якщо
                # збірка його загубила. Кажемо це прямо — інакше дефект збірки
                # виглядав би як недоукомплектована машина користувача.
                raise _FontMissing(
                    "No Unicode font found inside the package, and this report "
                    "contains non-Latin text. The bundled DejaVu at "
                    f"{_BUNDLE_FONT_SUBDIR} is missing — this is a build defect, "
                    "not a missing system package. Rebuild the sidecar."
                )
            raise _FontMissing(
                "No Unicode font found, and this report contains non-Latin text. "
                "Install DejaVu (Debian/Ubuntu: fonts-dejavu-core, Arch: ttf-dejavu, "
                "Fedora: dejavu-sans-fonts), or install weasyprint for the HTML path."
            )

    header_text = "PHANTOM OS" if style == "branded" else ""

    def _para(text: str, style=normal) -> Paragraph:
        safe = _esc(text[:2000])
        return Paragraph(safe, style)

    story = []
    if header_text:
        # _esc екранує кутові дужки, тож розмітка Paragraph тут не працює —
        # раніше сторінка починалася рядком "<b>PHANTOM OS</b>". Heading1 і так
        # жирний.
        story.append(_para(header_text, h1))
        story.append(HRFlowable(width="100%"))
        story.append(Spacer(1, 0.3 * cm))

    story.append(_para(report.brief[:160], h1))
    story.append(_para(
        f"Mission: {report.mission_id[:8]} · Status: {report.status} · "
        f"Duration: {report.wall_duration_h:.1f}h · Generated: {report.composed_at}",
        normal,
    ))
    story.append(Spacer(1, 0.4 * cm))
    story.append(_para("Summary", h2))
    story.append(_para(report.overall_summary, normal))
    story.append(Spacer(1, 0.4 * cm))

    for phase in report.phases:
        story.append(_para(
            f"Phase {phase.idx + 1}: {phase.description}", h2,
        ))
        story.append(_para(
            f"Status: {phase.status}  Duration: "
            f"{f'{phase.duration_h:.2f}h' if phase.duration_h else 'n/a'}",
            normal,
        ))
        if phase.achievements:
            story.append(_para("Achievements", h3))
            for a in phase.achievements:
                story.append(_para(f"• {a}", normal))
        if phase.lessons:
            story.append(_para("Lessons", h3))
            for l in phase.lessons:
                story.append(_para(f"• {l}", normal))
        story.append(Spacer(1, 0.3 * cm))

    if report.aggregate_lessons:
        story.append(_para("Aggregate Lessons", h2))
        for l in report.aggregate_lessons:
            story.append(_para(f"• {l}", normal))

    doc = SimpleDocTemplate(out_path, pagesize=A4)
    doc.build(story)


# ── Public API ────────────────────────────────────────────────────────────────


async def export_mission_pdf(
    user_id: str,
    mission_id: str,
    *,
    include_assets: bool = True,
    style: Literal["minimal", "branded"] = "minimal",
) -> dict[str, Any]:
    """Render the mission as a single PDF.

    Returns:
        On success: ``{"ok": True, "path": "/abs/path/report.pdf", "bytes": N}``.
        On failure: ``{"ok": False, "reason": "...", "detail": "..."}``.

    The PDF lands at ``~/.phantom/missions/<id>/report.pdf``.
    """
    from agent.missions.store import get_mission, list_phases
    from agent.missions.ledger import LedgerReader
    from agent.missions.reports import compose_mission_report

    # Fetch and authorise.
    try:
        mission = await get_mission(user_id, mission_id)
    except PermissionError as exc:
        return {"ok": False, "reason": "permission_denied", "detail": str(exc)}
    if mission is None:
        return {"ok": False, "reason": "not_found", "detail": f"mission {mission_id} not found"}

    # Compose report — prefer deterministic to avoid LLM latency inside export.
    report = await compose_mission_report(
        user_id, mission_id, prefer_llm=False,
    )
    if report is None:
        return {"ok": False, "reason": "report_composition_failed"}

    # Read ledger markdown.
    ledger_md = ""
    if mission.ledger_path:
        try:
            reader = LedgerReader(mission.ledger_path)
            ledger_md = await reader.read_full()
        except Exception as exc:
            logger.warning("export_mission_pdf: ledger read failed: %s", exc)

    # Determine output path.
    mission_dir = os.path.dirname(mission.ledger_path) if mission.ledger_path else ""
    if not mission_dir:
        mission_dir = os.path.join(
            os.path.expanduser("~/.phantom"), "missions", mission_id
        )
    out_path = os.path.join(mission_dir, "report.pdf")

    def _sync_write() -> None:
        os.makedirs(mission_dir, exist_ok=True)
        _write_pdf(report, ledger_md, style, out_path)

    try:
        await asyncio.to_thread(_sync_write)
    except _PdfBackendMissing as exc:
        return {"ok": False, "reason": "pdf_backend_missing", "detail": str(exc)}
    except Exception as exc:
        logger.error("export_mission_pdf: render failed: %s", exc)
        return {"ok": False, "reason": "render_failed", "detail": str(exc)}

    try:
        size = os.path.getsize(out_path)
    except OSError:
        size = 0

    return {"ok": True, "path": out_path, "bytes": size}


class _PdfBackendMissing(RuntimeError):
    pass


class _FontMissing(RuntimeError):
    """Бекенд є, але намалювати цей текст нічим. Не привід казати «встанови reportlab»."""


def _write_pdf(report: Any, ledger_md: str, style: str, out_path: str) -> None:
    """Try weasyprint, then reportlab, then raise _PdfBackendMissing."""
    # weasyprint path
    try:
        import weasyprint  # type: ignore[import] # noqa: F401
        html = _build_html(report, ledger_md, style)
        _write_pdf_weasyprint(html, out_path)
        logger.debug("pdf_export: wrote via weasyprint → %s", out_path)
        return
    except ImportError:
        logger.debug("pdf_export: weasyprint not installed, trying reportlab")
    except Exception as exc:
        logger.warning("pdf_export: weasyprint render failed (%s), trying reportlab", exc)

    # reportlab fallback
    try:
        import reportlab  # type: ignore[import] # noqa: F401
        _write_pdf_reportlab(report, ledger_md, style, out_path)
        logger.debug("pdf_export: wrote via reportlab → %s", out_path)
        return
    except ImportError:
        logger.debug("pdf_export: reportlab not installed either")
    except _FontMissing:
        raise
    except Exception as exc:
        logger.warning("pdf_export: reportlab render failed: %s", exc)

    raise _PdfBackendMissing(
        "Neither weasyprint nor reportlab is installed. "
        "Install at least one: pip install weasyprint  OR  pip install reportlab"
    )


# ── Самоперевірка: чи намалює ЦЕЙ вузол кирилицю ──────────────────────────────
#
# Навіщо це в продукті, а не в тестах. «Файл шрифта лежить у пакунку» — не
# доказ, і саме на цій різниці проєкт ловиться регулярно: 04.09 reportlab у
# бандлі був цілком живий (67 модулів у змісті PYZ), а український звіт не
# виходив узагалі, бо шрифту не було ні в пакунку, ні в базових образах. Тому
# питаємо не наявність, а РЕЗУЛЬТАТ, і тим самим кодом, яким продукт малює
# справжній звіт: `_reportlab_font()` → `_write_pdf_reportlab()` → байти на
# диску, у яких видно вбудовану родину.
#
# Оголошується як прапорець `_phantom_entry.py --selftest-pdf`, тож ворота
# чистої машини (і людина, у якої «звіт порожній») питають ПАКУНОК, а не
# дерево розробника.

#: Навмисно з тих літер, на яких ламаються неповні кириличні шрифти: ґ, є, і,
#: ї, апостроф і лапки-ялинки.
_SELFTEST_TEXT = "Ґанок, їжак, єдиний з'їзд — «Місія виконана»."


def selftest_cyrillic(out_path: str) -> dict[str, Any]:
    """Намалювати PDF з українським текстом. Кидає `_FontMissing`, якщо нічим.

    Повертає `{"path", "bytes", "family", "font_dir", "embedded", "faces"}`.
    `embedded` — чи видно назву родини всередині самого файла: reportlab
    вбудовує підмножину гліфів під іменем виду `AAAAAA+DejaVuSans`, і це
    відрізняє «намальовано нашим шрифтом» від «файл ненульовий».
    """
    from agent.schemas import MissionReport, MissionReportPhase

    report = MissionReport(
        mission_id="selftest" + "0" * 24,
        brief=_SELFTEST_TEXT,
        success_criteria="PDF ненульового розміру з кирилицею всередині.",
        quality_bar=None,
        status="succeeded",
        started_at="1970-01-01T00:00:00Z",
        finished_at="1970-01-01T00:00:00Z",
        wall_duration_h=0.0,
        overall_summary=_SELFTEST_TEXT,
        phases=[
            MissionReportPhase(
                idx=0,
                description=_SELFTEST_TEXT,
                success_criteria=_SELFTEST_TEXT,
                status="succeeded",
                duration_h=0.0,
                achievements=[_SELFTEST_TEXT],
                decisions=[],
                artifacts=[],
                lessons=[_SELFTEST_TEXT],
                failure_modes=[],
            )
        ],
        total_artifacts=0,
        total_decisions=0,
        aggregate_lessons=[_SELFTEST_TEXT],
        resource_summary={},
        council_engagements=0,
        budget_spent_usd=None,
        composed_at="1970-01-01T00:00:00Z",
    )

    # Саме `_write_pdf_reportlab`, а не `_write_pdf`: перший — та дорога, якою
    # продукт справді малює звіт у пакунку (weasyprint у бандл не їде, він
    # закоментований у requirements). Обгортка вище лише перебирає бекенди й
    # ховала б причину відмови за «render_failed».
    _write_pdf_reportlab(report, "", "branded", out_path)

    size = os.path.getsize(out_path)
    family = _RL_FAMILY or ""
    embedded = False
    if family:
        with open(out_path, "rb") as fh:
            embedded = family.encode("ascii", "ignore") in fh.read()

    # Скільки РІЗНИХ файлів стоїть за чотирма гранями. Питання не педантичне:
    # `_reportlab_font()` реєструє грань як `path if os.path.isfile(path) else
    # base`, тобто з неповним комплектом курсив ТИХО стає прямим і жоден лог
    # про це не скаже. Рахуємо саме файли, а не імена — імена є завжди.
    faces = 0
    if family:
        from reportlab.pdfbase import pdfmetrics

        seen = set()
        for name in (family, f"{family}-Bold", f"{family}-Italic", f"{family}-BoldItalic"):
            try:
                fname = pdfmetrics.getFont(name).face.filename  # type: ignore[attr-defined]
            except Exception:
                continue
            if fname:
                seen.add(os.path.realpath(str(fname)))
        faces = len(seen)

    return {
        "path": out_path,
        "bytes": size,
        "family": family,
        "font_dir": _RL_FAMILY_DIR or "",
        "embedded": embedded,
        "faces": faces,
    }


def selftest_cli(out_path: str | None = None) -> int:
    """Обгортка для `--selftest-pdf`. 0 — намальовано, 1 — ні. Друкує причину."""
    import tempfile

    if not out_path:
        out_path = os.path.join(tempfile.gettempdir(), "phantom-selftest-pdf.pdf")

    def _say(line: str) -> None:
        print(f"[selftest-pdf] {line}", flush=True)

    _say(f"frozen={bool(getattr(sys, 'frozen', False))}")
    _say("dirs=" + os.pathsep.join(_FONT_DIRS))
    try:
        res = selftest_cyrillic(out_path)
    except Exception as exc:  # _FontMissing і будь-яка інша поломка рушія
        _say(f"FAIL {type(exc).__name__}: {exc}")
        return 1

    _say(f"font_dir={res['font_dir']}")
    _say(f"family={res['family']}")
    _say(f"path={res['path']}")
    _say(f"bytes={res['bytes']}")
    _say(f"embedded={int(bool(res['embedded']))}")
    _say(f"faces={res['faces']}")
    if res["bytes"] <= 0:
        _say("FAIL: файл нульового розміру")
        return 1
    if res["faces"] < 4:
        _say(
            f"FAIL: різних файлів накреслень {res['faces']} із 4 — курсив тихо "
            "малювався б прямим"
        )
        return 1
    if not res["embedded"]:
        # Ненульовий файл без вбудованої родини — це саме той «зелений
        # порожній звіт», проти якого весь цей модуль.
        _say("FAIL: родину не вбудовано у PDF")
        return 1
    _say("OK")
    return 0


__all__ = ["export_mission_pdf", "selftest_cyrillic", "selftest_cli"]
