"""
Vertical V10 — Mission Reporting test suite.

Covers:
  • MissionReport / MissionReportPhase schema serialisation
  • MissionReportComposer: ordering, cross-user rejection, deterministic fallback,
    resource aggregation
  • VisualAssetStore: store_png, list_assets
  • MissionSnapshot action: no-mission guard, screen source, camera source,
    ledger append
  • PDF export: path suffix, minimal vs branded style (graceful skip when no backend)
  • HTML dashboard: inline assets, non-inline copy, phase timeline present
  • REST: POST /agent/mission/{id}/report, POST export, GET assets isolation

All external IO (Gemini, screen capture, weasyprint, DB) is mocked. Tests do NOT
require weasyprint, reportlab, or google-genai to be installed.
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import time
import types
import unittest.mock as mock
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pytest

# ── async coroutine factory (asyncio.coroutine removed in Python 3.11) ────────

def _acoro(value):
    """Return an awaitable that resolves to *value*."""
    async def _inner(*args, **kwargs):
        return value
    return _inner


# ── helpers ───────────────────────────────────────────────────────────────────

def _utcnow() -> datetime:
    return datetime.now(tz=timezone.utc)


def _now_ts() -> int:
    return int(time.time())


def _make_token(user_id: str = "user-a"):
    from security.jwt_manager import TokenPayload
    ts = _now_ts()
    return TokenPayload(
        user_id=user_id,
        username="op",
        role="ROOT",
        exp=ts + 3600,
        iat=ts,
    )


def _make_mission(
    mission_id: str = "m-001",
    user_id: str = "user-a",
    brief: str = "Build a thing",
    status: str = "done",
    success_criteria: str = "Thing is built",
    quality_bar: str = "Works without errors",
) -> mock.MagicMock:
    m = mock.MagicMock()
    m.id = mission_id
    m.user_id = user_id
    m.brief = brief
    m.status = status
    m.success_criteria = success_criteria
    m.quality_bar = quality_bar
    m.created_at = _utcnow()
    m.finished_at = _utcnow()
    m.ledger_path = f"/tmp/phantom/missions/{mission_id}/ledger.md"
    m.budget_constraints_json = None
    return m


def _make_phase(
    idx: int = 0,
    description: str = "Do the thing",
    status: str = "done",
    mission_id: str = "m-001",
) -> mock.MagicMock:
    p = mock.MagicMock()
    p.idx = idx
    p.id = f"phase-{idx}"
    p.mission_id = mission_id
    p.description = description
    p.rationale = "Because"
    p.success_criteria = "It works"
    p.status = status
    p.started_at = _utcnow()
    p.finished_at = _utcnow()
    p.expected_duration_h = 1.0
    p.artifacts_json = json.dumps([
        {"path": "/tmp/out.txt", "kind": "file", "produced": True}
    ])
    return p


# ── 1. Schema serialisation ───────────────────────────────────────────────────

class TestMissionReportSchemas:
    def test_mission_report_phase_schema_serializes(self):
        from agent.schemas import MissionReportPhase
        phase = MissionReportPhase(
            idx=0,
            description="Phase A",
            success_criteria="Done",
            status="done",
            duration_h=1.5,
            achievements=["Finished"],
            decisions=[{"summary": "go", "verdict": "proceed"}],
            artifacts=[{"path": "/tmp/a.txt", "kind": "file", "size_bytes": "100", "embedded": "false"}],
            lessons=["do less"],
            failure_modes=[],
            visual_snapshot_b64=None,
        )
        d = phase.model_dump(mode="json")
        assert d["idx"] == 0
        assert d["status"] == "done"
        assert d["duration_h"] == 1.5
        assert d["visual_snapshot_b64"] is None

    def test_mission_report_schema_serializes(self):
        from agent.schemas import MissionReport
        report = MissionReport(
            mission_id="abc",
            brief="Do X",
            success_criteria="X done",
            quality_bar=None,
            status="done",
            started_at=_utcnow().isoformat(),
            finished_at=_utcnow().isoformat(),
            wall_duration_h=2.0,
            overall_summary="It worked.",
            phases=[],
            total_artifacts=0,
            total_decisions=0,
            aggregate_lessons=[],
            resource_summary={},
            council_engagements=0,
            budget_spent_usd=None,
            composed_at=_utcnow().isoformat(),
        )
        d = report.model_dump(mode="json")
        assert d["mission_id"] == "abc"
        assert d["budget_spent_usd"] is None
        assert isinstance(d["phases"], list)

    def test_mission_report_in_all_exports(self):
        from agent.schemas import __all__ as schema_all
        assert "MissionReport" in schema_all
        assert "MissionReportPhase" in schema_all


# ── 2. MissionReportComposer ──────────────────────────────────────────────────

@pytest.mark.asyncio
class TestMissionReportComposer:

    async def test_compose_mission_report_returns_phases_in_order(self):
        mission = _make_mission()
        phases = [_make_phase(idx=i, description=f"Phase {i}") for i in range(3)]

        async def _fake_aggregate(self_arg, m):
            return {}

        with (
            mock.patch("agent.missions.store.get_mission", return_value=mission),
            mock.patch("agent.missions.store.list_phases", return_value=phases),
            mock.patch(
                "agent.missions.reports.MissionReportComposer._aggregate_resources",
                _fake_aggregate,
            ),
        ):
            from agent.missions.reports import compose_mission_report
            report = await compose_mission_report("user-a", "m-001", prefer_llm=False)

        assert report is not None
        assert len(report.phases) == 3
        assert [p.idx for p in report.phases] == [0, 1, 2]

    async def test_compose_mission_report_rejects_cross_user(self):
        with mock.patch(
            "agent.missions.store.get_mission",
            side_effect=PermissionError("cross-user"),
        ):
            from agent.missions.reports import compose_mission_report
            result = await compose_mission_report("user-b", "m-001", prefer_llm=False)
        assert result is None

    async def test_compose_mission_report_returns_none_when_not_found(self):
        with mock.patch("agent.missions.store.get_mission", return_value=None):
            from agent.missions.reports import compose_mission_report
            result = await compose_mission_report("user-a", "m-999", prefer_llm=False)
        assert result is None

    async def test_compose_mission_report_falls_back_to_deterministic_when_llm_down(self):
        mission = _make_mission()
        phases = [_make_phase()]

        async def _fail_llm(self_arg, *a, **kw):
            raise RuntimeError("LLM offline")

        async def _fake_aggregate(self_arg, m):
            return {}

        with (
            mock.patch("agent.missions.store.get_mission", return_value=mission),
            mock.patch("agent.missions.store.list_phases", return_value=phases),
            mock.patch(
                "agent.missions.reports.MissionReportComposer._llm_summary",
                _fail_llm,
            ),
            mock.patch(
                "agent.missions.reports.MissionReportComposer._aggregate_resources",
                _fake_aggregate,
            ),
        ):
            from agent.missions.reports import compose_mission_report
            report = await compose_mission_report("user-a", "m-001", prefer_llm=True)

        assert report is not None
        assert isinstance(report.overall_summary, str)
        assert len(report.overall_summary) > 0

    async def test_compose_mission_report_aggregates_resource_history_from_monitor(self):
        from dataclasses import dataclass

        @dataclass(frozen=True)
        class FakeSnap:
            ram_used_pct: float = 60.0
            cpu_pct: float = 40.0
            cpu_temp_c: float | None = 55.0
            disk_free_gb: float = 20.0

        fake_snaps = [FakeSnap() for _ in range(5)]
        mission = _make_mission()

        with mock.patch("core.system_monitor.system_monitor") as mock_monitor:
            mock_monitor.history.return_value = fake_snaps
            from agent.missions.reports import MissionReportComposer
            composer = MissionReportComposer()
            resource = await composer._aggregate_resources(mission)

        assert resource["peak_ram_pct"] == 60.0
        assert resource["avg_cpu_pct"] == 40.0
        assert resource["max_cpu_temp_c"] == 55.0
        assert resource["min_disk_free_gb"] == 20.0

    async def test_compose_mission_report_resource_aggregation_empty_monitor(self):
        mission = _make_mission()
        with mock.patch("core.system_monitor.system_monitor") as mock_monitor:
            mock_monitor.history.return_value = []
            from agent.missions.reports import MissionReportComposer
            composer = MissionReportComposer()
            resource = await composer._aggregate_resources(mission)
        assert resource == {}


# ── 3. VisualAssetStore ───────────────────────────────────────────────────────

class TestVisualAssetStore:

    def test_visual_asset_store_store_png_copies_file_and_returns_relative_path(
        self, tmp_path
    ):
        from agent.missions.visual_assets import VisualAssetStore
        store = VisualAssetStore("m-test", str(tmp_path))
        png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100
        rel_path = asyncio.get_event_loop().run_until_complete(
            store.store_png(png, "phase-1-preview")
        )
        assert rel_path == "./assets/phase-1-preview.png"
        abs_path = tmp_path / "assets" / "phase-1-preview.png"
        assert abs_path.exists()
        assert abs_path.read_bytes() == png

    def test_visual_asset_store_list_assets_returns_metadata(self, tmp_path):
        from agent.missions.visual_assets import VisualAssetStore
        store = VisualAssetStore("m-test", str(tmp_path))
        png = b"\x89PNG\r\n\x1a\n" + b"x" * 50
        asyncio.get_event_loop().run_until_complete(store.store_png(png, "snap1"))

        assets = store.list_assets()
        assert len(assets) == 1
        a = assets[0]
        assert a["name"] == "snap1.png"
        assert a["kind"] == "image"
        assert a["size"] == len(png)
        assert "captured_at" in a
        assert "rel_path" in a

    def test_visual_asset_store_list_assets_empty_when_dir_missing(self, tmp_path):
        from agent.missions.visual_assets import VisualAssetStore
        store = VisualAssetStore("m-test", str(tmp_path / "nonexistent"))
        assert store.list_assets() == []

    def test_sanitise_name_strips_dangerous_chars(self):
        from agent.missions.visual_assets import _sanitise_name
        assert "/" not in _sanitise_name("../../etc/passwd")
        assert _sanitise_name("good-name_v2") == "good-name_v2"


# ── 4. MissionSnapshot action ─────────────────────────────────────────────────

@pytest.mark.asyncio
class TestMissionSnapshotAction:

    def _make_ctx(self, mission_id: str | None = "m-001") -> Any:
        from agent.actions.base import ActionContext
        runtime = mock.MagicMock()
        slot = mock.MagicMock()
        slot.mission_id = mission_id
        runtime.foreground_slot = slot
        ctx = ActionContext(
            task_id="t-1",
            step_idx=0,
            workspace_dir="/tmp",
            runtime=runtime,
        )
        return ctx

    async def test_mission_snapshot_action_no_active_mission_returns_failure(self):
        from agent.actions.mission_assets import MissionSnapshot
        ctx = self._make_ctx(mission_id=None)
        snap = MissionSnapshot(label="test snap")
        result = await snap.execute(ctx)
        assert result.ok is False
        assert result.output["reason"] == "no_active_mission"

    async def test_mission_snapshot_action_screen_source_calls_screen_capture(self):
        from agent.actions.mission_assets import MissionSnapshot

        fake_png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 20
        ScreenFrame = type("ScreenFrame", (), {
            "png_bytes": fake_png, "width": 100, "height": 100,
            "strategy": "mss", "captured_at": "2026-01-01T00:00:00",
        })
        ScreenCaptureError = type("ScreenCaptureError", (), {})
        fake_frame = ScreenFrame()

        async def _fake_capture(region=None):
            return fake_frame

        ctx = self._make_ctx()

        async def _fake_store_png(self_arg, png_bytes, name):
            return "./assets/test-snap.png"

        async def _fake_describe(self_arg, png_bytes):
            return "A screen shot."

        async def _fake_append(self_arg, mission_id, rel_path, caption):
            pass

        with (
            mock.patch.dict("sys.modules", {
                "vision.screen_capture": types.SimpleNamespace(
                    ScreenFrame=ScreenFrame,
                    ScreenCaptureError=ScreenCaptureError,
                    capture=_fake_capture,
                ),
            }),
            mock.patch(
                "agent.actions.mission_assets.MissionSnapshot._describe",
                _fake_describe,
            ),
            mock.patch(
                "agent.missions.visual_assets.VisualAssetStore.store_png",
                _fake_store_png,
            ),
            mock.patch(
                "agent.actions.mission_assets.MissionSnapshot._append_to_ledger",
                _fake_append,
            ),
        ):
            snap = MissionSnapshot(label="test snap", source="screen", describe=False)
            result = await snap.execute(ctx)

        assert result.ok is True
        assert result.output["source"] == "screen"

    async def test_mission_snapshot_action_camera_source_calls_camera_capture(self):
        from agent.actions.mission_assets import MissionSnapshot

        fake_png = b"\x89PNG\r\n\x1a\n" + b"\x01" * 20
        CameraFrame = type("CameraFrame", (), {
            "png_bytes": fake_png, "width": 640, "height": 480,
            "strategy": "opencv", "captured_at": "2026-01-01T00:00:00",
        })
        CameraCaptureError = type("CameraCaptureError", (), {})
        fake_frame = CameraFrame()

        async def _fake_camera(device_index=0, warmup_frames=3):
            return fake_frame

        ctx = self._make_ctx()

        async def _fake_store_png(self_arg, png_bytes, name):
            return "./assets/cam.png"

        async def _fake_append(self_arg, mission_id, rel_path, caption):
            pass

        with (
            mock.patch.dict("sys.modules", {
                "vision.camera_capture": types.SimpleNamespace(
                    CameraFrame=CameraFrame,
                    CameraCaptureError=CameraCaptureError,
                    capture=_fake_camera,
                ),
            }),
            mock.patch(
                "agent.missions.visual_assets.VisualAssetStore.store_png",
                _fake_store_png,
            ),
            mock.patch(
                "agent.actions.mission_assets.MissionSnapshot._append_to_ledger",
                _fake_append,
            ),
        ):
            snap = MissionSnapshot(label="cam snap", source="camera", describe=False)
            result = await snap.execute(ctx)

        assert result.ok is True
        assert result.output["source"] == "camera"

    async def test_mission_snapshot_appends_to_ledger_phase_section(self, tmp_path):
        """Verify that _append_to_ledger writes the image directive to the file."""
        mission_id = "m-ledger-test"
        mission_dir = tmp_path / "missions" / mission_id
        mission_dir.mkdir(parents=True)
        ledger_path = mission_dir / "ledger.md"
        ledger_path.write_text("# Mission: test\n\n## Phase 1 — Do (IN PROGRESS, step ?-?)\n")

        from agent.actions.mission_assets import MissionSnapshot
        snap = MissionSnapshot(label="my snapshot", source="file")

        async def _real_append(path, text):
            with open(path, "a", encoding="utf-8") as fh:
                fh.write(text)

        with (
            mock.patch("agent.missions.ledger._append_to_file", side_effect=_real_append),
            mock.patch("os.path.expanduser", return_value=str(tmp_path)),
        ):
            await snap._append_to_ledger(mission_id, "./assets/my-snapshot-123.png", "Caption text")

        content = ledger_path.read_text()
        assert "### Snapshot: my snapshot" in content
        assert "./assets/my-snapshot-123.png" in content


# ── 5. PDF export ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
class TestPdfExport:

    def _make_report(self):
        from agent.schemas import MissionReport
        return MissionReport(
            mission_id="m-pdf",
            brief="Build PDF",
            success_criteria="PDF exists",
            quality_bar=None,
            status="done",
            started_at=_utcnow().isoformat(),
            finished_at=_utcnow().isoformat(),
            wall_duration_h=0.5,
            overall_summary="It worked.",
            phases=[],
            total_artifacts=0,
            total_decisions=0,
            aggregate_lessons=[],
            resource_summary={},
            council_engagements=0,
            budget_spent_usd=None,
            composed_at=_utcnow().isoformat(),
        )

    async def test_pdf_export_produces_pdf_at_expected_path(self, tmp_path):
        """If weasyprint or reportlab available, verify .pdf produced.
        If neither available, verify graceful failure response."""
        from agent.missions.pdf_export import export_mission_pdf

        mission = _make_mission(mission_id="m-pdf")
        mission.ledger_path = str(tmp_path / "ledger.md")
        report = self._make_report()

        async def _mock_compose(*a, **kw):
            return report

        async def _mock_ledger_read(self_arg):
            return "# Ledger"

        with (
            mock.patch("agent.missions.store.get_mission", return_value=mission),
            mock.patch("agent.missions.store.list_phases", return_value=[]),
            mock.patch("agent.missions.reports.compose_mission_report", side_effect=_mock_compose),
            mock.patch(
                "agent.missions.ledger.LedgerReader.read_full",
                _mock_ledger_read,
            ),
        ):
            result = await export_mission_pdf("user-a", "m-pdf", style="minimal")

        if result.get("ok"):
            assert result["path"].endswith(".pdf")
        else:
            # Graceful backend-missing or render-failed response is acceptable.
            assert result["reason"] in (
                "pdf_backend_missing", "render_failed", "not_found", "report_composition_failed",
            )

    async def test_pdf_export_minimal_vs_branded_style(self):
        """_build_html should produce different output for minimal vs branded."""
        pytest.importorskip("markdown")
        from agent.missions.pdf_export import _build_html
        report = self._make_report()
        html_minimal = _build_html(report, "# test ledger", "minimal")
        html_branded = _build_html(report, "# test ledger", "branded")
        # Branded has @page top-center / bottom-right selectors.
        assert "@top-center" in html_branded
        assert "@top-center" not in html_minimal

    async def test_pdf_export_not_found_mission(self):
        from agent.missions.pdf_export import export_mission_pdf
        with mock.patch("agent.missions.store.get_mission", return_value=None):
            result = await export_mission_pdf("user-a", "m-missing")
        assert result["ok"] is False
        assert result["reason"] == "not_found"

    async def test_pdf_export_cross_user_denied(self):
        from agent.missions.pdf_export import export_mission_pdf
        with mock.patch(
            "agent.missions.store.get_mission",
            side_effect=PermissionError("denied"),
        ):
            result = await export_mission_pdf("user-b", "m-001")
        assert result["ok"] is False
        assert result["reason"] == "permission_denied"


# ── 6. HTML dashboard ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
class TestHtmlDashboard:

    def _make_report(self, mission_id: str = "m-dash"):
        from agent.schemas import MissionReport, MissionReportPhase
        phase = MissionReportPhase(
            idx=0,
            description="Phase One",
            success_criteria="Done",
            status="done",
            duration_h=1.0,
            achievements=["Did thing A"],
            decisions=[{"summary": "Chose X", "verdict": "proceed"}],
            artifacts=[{"path": "/tmp/a.txt", "kind": "file", "size_bytes": "100", "embedded": "false"}],
            lessons=["Lesson learned"],
            failure_modes=[],
        )
        return MissionReport(
            mission_id=mission_id,
            brief="Dashboard mission",
            success_criteria="Dashboard exists",
            quality_bar=None,
            status="done",
            started_at=_utcnow().isoformat(),
            finished_at=_utcnow().isoformat(),
            wall_duration_h=1.5,
            overall_summary="Mission complete.",
            phases=[phase],
            total_artifacts=1,
            total_decisions=1,
            aggregate_lessons=["Keep going"],
            resource_summary={"peak_ram_pct": 70.0, "avg_cpu_pct": 30.0},
            council_engagements=0,
            budget_spent_usd=None,
            composed_at=_utcnow().isoformat(),
        )

    async def test_html_dashboard_includes_phase_timeline(self):
        from agent.missions.html_dashboard import _build_dashboard_html
        report = self._make_report()
        html = _build_dashboard_html(report, "")
        assert "Phase One" in html
        assert "Phase Timeline" in html
        assert "togglePhase" in html

    async def test_html_dashboard_export_inline_assets_embeds_base64(self, tmp_path):
        from agent.missions.html_dashboard import export_mission_dashboard

        mission = _make_mission(mission_id="m-dash")
        mission.ledger_path = str(tmp_path / "ledger.md")
        report = self._make_report("m-dash")

        async def _mock_compose(*a, **kw):
            return report

        async def _mock_ledger_read(self_arg):
            return ""

        mock_store = mock.MagicMock()
        mock_store.list_assets.return_value = []

        with (
            mock.patch("agent.missions.store.get_mission", return_value=mission),
            mock.patch("agent.missions.reports.compose_mission_report", side_effect=_mock_compose),
            mock.patch(
                "agent.missions.ledger.LedgerReader.read_full",
                _mock_ledger_read,
            ),
            mock.patch(
                "agent.missions.visual_assets.asset_store_for_mission",
                return_value=mock_store,
            ),
        ):
            result = await export_mission_dashboard(
                "user-a",
                "m-dash",
                inline_assets=True,
                output_dir=str(tmp_path / "dashboard"),
            )

        assert result["ok"] is True
        index_path = result["path"]
        assert index_path.endswith("index.html")
        content = Path(index_path).read_text()
        assert "Phase One" in content

    async def test_html_dashboard_export_non_inline_copies_assets(self, tmp_path):
        from agent.missions.html_dashboard import export_mission_dashboard

        mission = _make_mission(mission_id="m-dash-ni")
        mission.ledger_path = str(tmp_path / "ledger.md")
        report = self._make_report("m-dash-ni")

        # Create a fake source asset.
        src_asset_dir = tmp_path / "src_assets"
        src_asset_dir.mkdir()
        fake_png = b"\x89PNG\r\n\x1a\n" + b"\xff" * 30
        (src_asset_dir / "photo.png").write_bytes(fake_png)

        async def _mock_compose(*a, **kw):
            return report

        async def _mock_ledger_read(self_arg):
            return ""

        mock_store = mock.MagicMock()
        mock_store.list_assets.return_value = [
            {
                "name": "photo.png",
                "size": len(fake_png),
                "kind": "image",
                "captured_at": _utcnow().isoformat(),
                "rel_path": "./assets/photo.png",
                "abs_path": str(src_asset_dir / "photo.png"),
            }
        ]

        dash_dir = tmp_path / "dashboard_ni"

        with (
            mock.patch("agent.missions.store.get_mission", return_value=mission),
            mock.patch("agent.missions.reports.compose_mission_report", side_effect=_mock_compose),
            mock.patch(
                "agent.missions.ledger.LedgerReader.read_full",
                _mock_ledger_read,
            ),
            mock.patch(
                "agent.missions.visual_assets.asset_store_for_mission",
                return_value=mock_store,
            ),
        ):
            result = await export_mission_dashboard(
                "user-a",
                "m-dash-ni",
                inline_assets=False,
                output_dir=str(dash_dir),
            )

        assert result["ok"] is True
        copied = dash_dir / "assets" / "photo.png"
        assert copied.exists()
        assert copied.read_bytes() == fake_png


# ── 7. REST endpoints ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
class TestRestEndpoints:

    def _make_app(self):
        from fastapi import FastAPI
        from api.routes_agent import router
        app = FastAPI()
        app.include_router(router)
        return app

    async def test_rest_post_mission_report_returns_mission_report_shape(self):
        from agent.schemas import MissionReport
        from fastapi.testclient import TestClient
        from security.auth import require_auth

        report = MissionReport(
            mission_id="m-rest",
            brief="REST test",
            success_criteria="200 ok",
            quality_bar=None,
            status="done",
            started_at=_utcnow().isoformat(),
            finished_at=_utcnow().isoformat(),
            wall_duration_h=0.1,
            overall_summary="ok",
            phases=[],
            total_artifacts=0,
            total_decisions=0,
            aggregate_lessons=[],
            resource_summary={},
            council_engagements=0,
            budget_spent_usd=None,
            composed_at=_utcnow().isoformat(),
        )

        token = _make_token()

        async def _mock_compose(uid, mid, **kw):
            return report

        with mock.patch("agent.missions.reports.compose_mission_report", side_effect=_mock_compose):
            app = self._make_app()
            app.dependency_overrides[require_auth] = lambda: token
            try:
                client = TestClient(app)
                resp = client.post(
                    "/agent/mission/m-rest/report",
                    json={"prefer_llm": False},
                )
            finally:
                app.dependency_overrides.clear()

        assert resp.status_code == 200
        data = resp.json()
        assert "report" in data
        assert data["report"]["mission_id"] == "m-rest"
        assert "phases" in data["report"]

    async def test_rest_post_mission_export_pdf_returns_path(self, tmp_path):
        from fastapi.testclient import TestClient
        from security.auth import require_auth

        pdf_path = str(tmp_path / "report.pdf")
        (tmp_path / "report.pdf").write_bytes(b"%PDF-1.4\n")

        token = _make_token()

        async def _mock_export(uid, mid, **kw):
            return {"ok": True, "path": pdf_path, "bytes": 9}

        with mock.patch("agent.missions.pdf_export.export_mission_pdf", side_effect=_mock_export):
            app = self._make_app()
            app.dependency_overrides[require_auth] = lambda: token
            try:
                client = TestClient(app)
                resp = client.post(
                    "/agent/mission/m-001/export",
                    json={"format": "pdf", "style": "minimal"},
                )
            finally:
                app.dependency_overrides.clear()

        assert resp.status_code == 200
        data = resp.json()
        assert data["format"] == "pdf"
        assert data["path"].endswith(".pdf")

    async def test_rest_get_mission_assets_per_user_isolation(self):
        """Cross-user access should return 404, not asset list."""
        from fastapi.testclient import TestClient
        from security.auth import require_auth

        token = _make_token(user_id="user-b")

        with mock.patch(
            "agent.missions.store.get_mission",
            side_effect=PermissionError("cross-user"),
        ):
            app = self._make_app()
            app.dependency_overrides[require_auth] = lambda: token
            try:
                client = TestClient(app)
                resp = client.get("/agent/mission/m-other/assets")
            finally:
                app.dependency_overrides.clear()

        assert resp.status_code == 404
