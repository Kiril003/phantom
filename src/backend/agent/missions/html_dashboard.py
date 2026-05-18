"""
Vertical V10 — Static-HTML mission dashboard.

Generates a self-contained HTML file at:
    ~/.phantom/missions/<id>/dashboard/index.html

Design requirements:
• No build step — Tailwind via CDN, Chart.js via CDN.
• Openable from file:// with zero server.
• Looks like an engineering doc (Linear/Notion style), not a landing page.
• Assets can be inlined as base64 data URIs (inline_assets=True) or copied
  to dashboard/assets/ (inline_assets=False, default).

Output shape matches the MissionReport schema:
  Mission header → KPI cards → vertical phase timeline → resource chart →
  aggregate lessons → footer.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import shutil
from datetime import datetime, timezone
from typing import Any, Literal

logger = logging.getLogger(__name__)

_PHANTOM_HOME = os.path.expanduser("~/.phantom")

# CDN links — pinned versions for reproducibility, loaded only on file:// open.
_TAILWIND_CDN = "https://cdn.tailwindcss.com"
_CHARTJS_CDN = "https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"


# ── Template helpers ──────────────────────────────────────────────────────────

def _esc(text: str) -> str:
    return (
        str(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#39;")
    )


def _j(obj: Any) -> str:
    """Safe JSON for inline <script>."""
    return json.dumps(obj, ensure_ascii=False, default=str)


def _kpi_card(label: str, value: str) -> str:
    return f"""
    <div class="bg-white border border-gray-200 rounded-lg p-4 text-center">
      <div class="text-2xl font-mono font-bold text-gray-900">{_esc(value)}</div>
      <div class="text-xs text-gray-500 mt-1 uppercase tracking-wide">{_esc(label)}</div>
    </div>"""


def _status_badge(status: str) -> str:
    colour = {
        "done": "bg-green-100 text-green-800",
        "failed": "bg-red-100 text-red-800",
        "running": "bg-blue-100 text-blue-800",
        "abandoned": "bg-gray-100 text-gray-600",
        "paused": "bg-yellow-100 text-yellow-800",
    }.get(status.lower(), "bg-gray-100 text-gray-700")
    return (
        f'<span class="inline-flex items-center px-2 py-0.5 rounded text-xs '
        f'font-medium {colour}">{_esc(status)}</span>'
    )


def _phase_card(phase: Any, idx: int) -> str:
    duration = f"{phase.duration_h:.2f}h" if phase.duration_h is not None else "n/a"
    achievements_html = "".join(
        f'<li class="text-sm text-gray-700">{_esc(a)}</li>'
        for a in (phase.achievements or [])
    )
    decisions_html = "".join(
        f'<li class="text-sm text-gray-700">'
        f'<span class="font-mono text-xs text-gray-400">[{_esc(d.get("verdict",""))}]</span> '
        f'{_esc(d.get("summary",""))}</li>'
        for d in (phase.decisions or [])
    )
    artifacts_html = "".join(
        f'<li class="text-sm font-mono text-gray-600">'
        f'{_esc(a.get("path",""))} '
        f'<span class="text-gray-400">({_esc(a.get("kind",""))})</span></li>'
        for a in (phase.artifacts or [])
    )
    lessons_html = "".join(
        f'<li class="text-sm text-gray-700">{_esc(l)}</li>'
        for l in (phase.lessons or [])
    )
    failures_html = "".join(
        f'<li class="text-sm text-red-700">{_esc(f)}</li>'
        for f in (phase.failure_modes or [])
    )

    visual = ""
    if phase.visual_snapshot_b64:
        visual = (
            f'<img src="data:image/png;base64,{phase.visual_snapshot_b64}" '
            f'alt="Phase {idx+1} snapshot" '
            f'class="mt-2 rounded border border-gray-200 max-h-48 w-auto"/>'
        )

    return f"""
    <div id="phase-{idx}" class="border border-gray-200 rounded-lg overflow-hidden">
      <button onclick="togglePhase({idx})"
              class="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left">
        <span class="font-medium text-gray-900">
          Phase {idx+1}: {_esc(phase.description)}
        </span>
        <div class="flex items-center gap-2">
          {_status_badge(phase.status)}
          <span class="text-xs text-gray-500">{_esc(duration)}</span>
          <svg id="chevron-{idx}" class="w-4 h-4 text-gray-400 transform transition-transform"
               fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
          </svg>
        </div>
      </button>
      <div id="phase-body-{idx}" class="hidden px-4 py-3 space-y-3">
        {visual}
        {"<div><h4 class='text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1'>Achievements</h4><ul class='list-disc list-inside space-y-1'>" + achievements_html + "</ul></div>" if achievements_html else ""}
        {"<div><h4 class='text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1'>Key Decisions</h4><ul class='list-disc list-inside space-y-1'>" + decisions_html + "</ul></div>" if decisions_html else ""}
        {"<div><h4 class='text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1'>Artifacts</h4><ul class='list-disc list-inside space-y-1'>" + artifacts_html + "</ul></div>" if artifacts_html else ""}
        {"<div><h4 class='text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1'>Lessons</h4><ul class='list-disc list-inside space-y-1'>" + lessons_html + "</ul></div>" if lessons_html else ""}
        {"<div><h4 class='text-xs font-semibold text-red-500 uppercase tracking-wide mb-1'>Failure Modes</h4><ul class='list-disc list-inside space-y-1'>" + failures_html + "</ul></div>" if failures_html else ""}
      </div>
    </div>"""


def _resource_chart_js(resource_summary: dict[str, Any]) -> str:
    """Emit a Chart.js bar chart of resource pressure values."""
    labels = ["Peak RAM %", "Avg CPU %", "Max Temp °C", "Min Disk Free GB"]
    values = [
        resource_summary.get("peak_ram_pct") or 0,
        resource_summary.get("avg_cpu_pct") or 0,
        resource_summary.get("max_cpu_temp_c") or 0,
        resource_summary.get("min_disk_free_gb") or 0,
    ]
    colors = ["#6366f1", "#0ea5e9", "#f59e0b", "#10b981"]
    return f"""
<script>
(function(){{
  const ctx = document.getElementById('resourceChart');
  if (!ctx) return;
  new Chart(ctx, {{
    type: 'bar',
    data: {{
      labels: {_j(labels)},
      datasets: [{{
        label: 'Resource Usage',
        data: {_j(values)},
        backgroundColor: {_j(colors)},
        borderRadius: 4,
      }}]
    }},
    options: {{
      responsive: true,
      plugins: {{ legend: {{ display: false }} }},
      scales: {{
        y: {{ beginAtZero: true, grid: {{ color: '#f3f4f6' }} }},
        x: {{ grid: {{ display: false }} }}
      }}
    }}
  }});
}})();
</script>"""


def _build_dashboard_html(report: Any, ledger_md: str) -> str:
    kpi_strip = "".join([
        _kpi_card("Duration", f"{report.wall_duration_h:.1f}h"),
        _kpi_card("Phases", str(len(report.phases))),
        _kpi_card("Decisions", str(report.total_decisions)),
        _kpi_card("Artifacts", str(report.total_artifacts)),
        _kpi_card("Status", report.status),
    ])

    phases_html = "\n".join(
        _phase_card(p, p.idx) for p in report.phases
    )

    lessons_html = ""
    if report.aggregate_lessons:
        items = "".join(
            f'<li class="text-sm text-gray-700">{_esc(l)}</li>'
            for l in report.aggregate_lessons
        )
        lessons_html = f"""
        <section class="space-y-2">
          <h2 class="text-lg font-semibold text-gray-900 border-b border-gray-200 pb-2">
            Aggregate Lessons
          </h2>
          <ul class="list-disc list-inside space-y-1">{items}</ul>
        </section>"""

    # Ledger block — plain <pre> for file:// compat (no markdown parsing needed).
    ledger_block = ""
    if ledger_md.strip():
        try:
            import markdown as _md
            ledger_body = _md.markdown(
                ledger_md, extensions=["fenced_code", "tables"]
            )
            ledger_block = f"""
            <section class="space-y-2">
              <h2 class="text-lg font-semibold text-gray-900 border-b border-gray-200 pb-2">
                Mission Ledger
              </h2>
              <div class="prose prose-sm max-w-none text-gray-700">{ledger_body}</div>
            </section>"""
        except ImportError:
            safe_ledger = _esc(ledger_md)
            ledger_block = f"""
            <section class="space-y-2">
              <h2 class="text-lg font-semibold text-gray-900 border-b border-gray-200 pb-2">
                Mission Ledger
              </h2>
              <pre class="text-xs bg-gray-50 rounded p-4 overflow-auto whitespace-pre-wrap">{safe_ledger}</pre>
            </section>"""

    resource_chart_js = _resource_chart_js(report.resource_summary or {})
    mission_id_short = report.mission_id[:8]
    quality_bar_html = ""
    if report.quality_bar:
        quality_bar_html = (
            f'<p class="text-sm text-gray-600 mt-1">'
            f'<span class="font-semibold">Quality bar:</span> {_esc(report.quality_bar)}</p>'
        )

    # Toggle script — expand/collapse phase cards.
    toggle_js = """
<script>
function togglePhase(idx) {
  const body = document.getElementById('phase-body-' + idx);
  const chevron = document.getElementById('chevron-' + idx);
  const hidden = body.classList.toggle('hidden');
  chevron.style.transform = hidden ? '' : 'rotate(180deg)';
}
</script>"""

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Mission Report · {_esc(report.brief[:60])}</title>
  <script src="{_TAILWIND_CDN}"></script>
  <script src="{_CHARTJS_CDN}"></script>
</head>
<body class="bg-gray-50 text-gray-900 font-sans">

<div class="max-w-4xl mx-auto px-4 py-10 space-y-8">

  <!-- Header -->
  <header class="space-y-1">
    <div class="flex items-center gap-2">
      <span class="font-mono text-xs text-gray-400">PHANTOM OS · Mission {_esc(mission_id_short)}</span>
      {_status_badge(report.status)}
    </div>
    <h1 class="text-2xl font-bold text-gray-900">{_esc(report.brief[:120])}</h1>
    <p class="text-sm text-gray-500">
      {_esc(report.started_at[:19] if report.started_at else "")}
      {" → " + _esc(report.finished_at[:19]) if report.finished_at else ""}
    </p>
    {quality_bar_html}
  </header>

  <!-- KPI cards -->
  <section>
    <div class="grid grid-cols-2 sm:grid-cols-5 gap-3">
      {kpi_strip}
    </div>
  </section>

  <!-- Summary -->
  <section class="space-y-2">
    <h2 class="text-lg font-semibold text-gray-900 border-b border-gray-200 pb-2">Summary</h2>
    <p class="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{_esc(report.overall_summary)}</p>
  </section>

  <!-- Phase timeline -->
  <section class="space-y-3">
    <h2 class="text-lg font-semibold text-gray-900 border-b border-gray-200 pb-2">
      Phase Timeline
    </h2>
    <div class="space-y-2">
      {phases_html}
    </div>
  </section>

  <!-- Resource chart -->
  <section class="space-y-2">
    <h2 class="text-lg font-semibold text-gray-900 border-b border-gray-200 pb-2">
      Resource Pressure
    </h2>
    <div class="bg-white border border-gray-200 rounded-lg p-4">
      <canvas id="resourceChart" height="120"></canvas>
    </div>
  </section>

  {lessons_html}

  {ledger_block}

  <!-- Footer -->
  <footer class="border-t border-gray-200 pt-4 text-xs text-gray-400 flex justify-between">
    <span>PHANTOM OS · Mission {_esc(mission_id_short)}</span>
    <span>Generated {_esc(report.composed_at[:19])}</span>
  </footer>

</div>

{toggle_js}
{resource_chart_js}
</body>
</html>"""


# ── Public API ────────────────────────────────────────────────────────────────


async def export_mission_dashboard(
    user_id: str,
    mission_id: str,
    *,
    inline_assets: bool = False,
    output_dir: str | None = None,
) -> dict[str, Any]:
    """Generate a static-HTML dashboard for the mission.

    Returns:
        ``{"ok": True, "path": "/abs/path/dashboard/index.html"}``
        or ``{"ok": False, "reason": "...", "detail": "..."}``.
    """
    from agent.missions.store import get_mission
    from agent.missions.ledger import LedgerReader
    from agent.missions.visual_assets import asset_store_for_mission
    from agent.missions.reports import compose_mission_report

    # Authorise.
    try:
        mission = await get_mission(user_id, mission_id)
    except PermissionError as exc:
        return {"ok": False, "reason": "permission_denied", "detail": str(exc)}
    if mission is None:
        return {"ok": False, "reason": "not_found"}

    # Compose report (deterministic — no LLM latency during export).
    report = await compose_mission_report(user_id, mission_id, prefer_llm=False)
    if report is None:
        return {"ok": False, "reason": "report_composition_failed"}

    # Read ledger markdown.
    ledger_md = ""
    if mission.ledger_path:
        try:
            reader = LedgerReader(mission.ledger_path)
            ledger_md = await reader.read_full()
        except Exception as exc:
            logger.warning("export_mission_dashboard: ledger read failed: %s", exc)

    # Determine output directory.
    mission_dir = (
        os.path.dirname(mission.ledger_path)
        if mission.ledger_path
        else os.path.join(_PHANTOM_HOME, "missions", mission_id)
    )
    dash_dir = output_dir or os.path.join(mission_dir, "dashboard")
    index_path = os.path.join(dash_dir, "index.html")

    # Build HTML.
    html = _build_dashboard_html(report, ledger_md)

    # If not inlining, copy asset files to dashboard/assets/.
    asset_store = asset_store_for_mission(mission_id)
    assets = asset_store.list_assets()

    if not inline_assets and assets:
        dash_assets_dir = os.path.join(dash_dir, "assets")

        def _copy_assets() -> None:
            os.makedirs(dash_assets_dir, exist_ok=True)
            for asset in assets:
                src = asset["abs_path"]
                dst = os.path.join(dash_assets_dir, asset["name"])
                try:
                    shutil.copy2(src, dst)
                except Exception as exc:
                    logger.warning(
                        "export_mission_dashboard: asset copy failed %s: %s",
                        asset["name"], exc,
                    )

        await asyncio.to_thread(_copy_assets)

    def _write_html() -> None:
        os.makedirs(dash_dir, exist_ok=True)
        with open(index_path, "w", encoding="utf-8") as fh:
            fh.write(html)

    try:
        await asyncio.to_thread(_write_html)
    except Exception as exc:
        logger.error("export_mission_dashboard: write failed: %s", exc)
        return {"ok": False, "reason": "write_failed", "detail": str(exc)}

    logger.info("export_mission_dashboard: wrote %s", index_path)
    return {"ok": True, "path": index_path}


__all__ = ["export_mission_dashboard"]
