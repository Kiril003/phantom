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

_RL_MONO = None  # lazy-loaded


def _reportlab_font() -> str:
    global _RL_MONO
    if _RL_MONO is None:
        try:
            from reportlab.pdfbase import pdfmetrics
            _RL_MONO = "Courier"
        except Exception:
            _RL_MONO = "Courier"
    return _RL_MONO


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

    header_text = "PHANTOM OS" if style == "branded" else ""

    def _para(text: str, style=normal) -> Paragraph:
        safe = _esc(text[:2000])
        return Paragraph(safe, style)

    story = []
    if header_text:
        story.append(_para(f"<b>{header_text}</b>", h1))
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
    except Exception as exc:
        logger.warning("pdf_export: reportlab render failed: %s", exc)

    raise _PdfBackendMissing(
        "Neither weasyprint nor reportlab is installed. "
        "Install at least one: pip install weasyprint  OR  pip install reportlab"
    )


__all__ = ["export_mission_pdf"]
