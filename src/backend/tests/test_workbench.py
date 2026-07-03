"""Atelier Chat W1/W2 — workbench service, atelier loop, chat tools."""
from __future__ import annotations

import asyncio
import json
from unittest.mock import AsyncMock, patch

import pytest

from workbench.service import (
    MAX_FILE_BYTES,
    WorkbenchError,
    workbench_service,
)


@pytest.fixture(autouse=True)
def _tmp_data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("PHANTOM_DATA_DIR", str(tmp_path))
    yield


async def _mk(brief: str = "збудуй тестовий сайт", title: str = "Test"):
    return await workbench_service.create(title=title, brief=brief, user_id="u1")


class TestService:
    @pytest.mark.asyncio
    async def test_create_and_meta_roundtrip(self):
        ws = await _mk()
        got = workbench_service.get(ws.id)
        assert got.title == "Test"
        assert got.status == "building"
        assert len(got.preview_token) > 20

    @pytest.mark.asyncio
    async def test_write_read_tree(self):
        ws = await _mk()
        n = workbench_service.write_files(ws.id, [
            {"path": "index.html", "content": "<h1>hi</h1>"},
            {"path": "css/style.css", "content": "body{}"},
        ])
        assert n == 2
        assert workbench_service.read_file(ws.id, "index.html") == "<h1>hi</h1>"
        assert {t["path"] for t in workbench_service.tree(ws.id)} == \
            {"index.html", "css/style.css"}

    @pytest.mark.asyncio
    async def test_path_traversal_rejected(self):
        ws = await _mk()
        for bad in ("../evil.html", "/etc/passwd", "a/../../b", ".hidden"):
            with pytest.raises(WorkbenchError):
                workbench_service.write_files(
                    ws.id, [{"path": bad, "content": "x"}])

    @pytest.mark.asyncio
    async def test_file_size_cap(self):
        ws = await _mk()
        with pytest.raises(WorkbenchError) as ei:
            workbench_service.write_files(
                ws.id, [{"path": "big.js", "content": "x" * (MAX_FILE_BYTES + 1)}])
        assert ei.value.kind == "file_too_big"

    @pytest.mark.asyncio
    async def test_preview_token_gate(self):
        ws = await _mk()
        workbench_service.write_files(
            ws.id, [{"path": "index.html", "content": "<p>ok</p>"}])
        target, mime = workbench_service.resolve_preview(
            ws.id, ws.preview_token, "index.html")
        assert mime == "text/html" and target.read_text() == "<p>ok</p>"
        with pytest.raises(WorkbenchError) as ei:
            workbench_service.resolve_preview(ws.id, "wrong", "index.html")
        assert ei.value.kind == "forbidden"

    @pytest.mark.asyncio
    async def test_journal_appends(self):
        ws = await _mk()
        workbench_service.journal(ws.id, "custom", {"a": 1})
        events = [e["event"] for e in workbench_service.read_journal(ws.id)]
        assert events[0] == "created" and "custom" in events

    @pytest.mark.asyncio
    async def test_delete(self):
        ws = await _mk()
        await workbench_service.delete(ws.id)
        with pytest.raises(WorkbenchError):
            workbench_service.get(ws.id)


class TestAtelier:
    @pytest.mark.asyncio
    async def test_build_ships_on_first_pass(self):
        from workbench import atelier
        ws = await _mk(brief="лендінг з заголовком")
        manifest = {"title": "L", "entry": "index.html",
                    "files": [{"path": "index.html",
                               "content": "<h1>Done</h1>"}]}
        verdict = {"verdict": "SHIP", "score": 9,
                   "critique": "готово", "fix_instructions": ""}
        phases: list[str] = []

        async def on_phase(name, data):
            phases.append(name)

        with patch.object(atelier, "_generate",
                          AsyncMock(return_value=manifest)), \
             patch.object(atelier, "_screenshot",
                          AsyncMock(return_value=b"\x89PNG")), \
             patch.object(atelier, "_critique_visual",
                          AsyncMock(return_value=verdict)):
            meta = await atelier.build(ws.id, on_phase=on_phase)

        assert meta["status"] == "ready"
        assert meta["passes"][0]["verdict"] == "SHIP"
        assert meta["passes"][0]["has_screenshot"] is True
        assert phases[:2] == ["generate", "see"]
        assert "ready" in phases
        assert workbench_service.screenshot_path(ws.id, 1).is_file()

    @pytest.mark.asyncio
    async def test_revise_loop_patches_then_ships(self):
        from workbench import atelier
        ws = await _mk(brief="дашборд")
        gen = AsyncMock(side_effect=[
            {"entry": "index.html",
             "files": [{"path": "index.html", "content": "<h1>v1</h1>"}]},
            {"files": [{"path": "index.html", "content": "<h1>v2</h1>"}]},
        ])
        verdicts = AsyncMock(side_effect=[
            {"verdict": "REVISE", "score": 4, "critique": "порожньо",
             "fix_instructions": "додай контент"},
            {"verdict": "SHIP", "score": 8, "critique": "ок",
             "fix_instructions": ""},
        ])
        with patch.object(atelier, "_generate", gen), \
             patch.object(atelier, "_screenshot",
                          AsyncMock(return_value=b"png")), \
             patch.object(atelier, "_critique_visual", verdicts):
            meta = await atelier.build(ws.id)

        assert [p["verdict"] for p in meta["passes"]] == ["REVISE", "SHIP"]
        assert workbench_service.read_file(ws.id, "index.html") == "<h1>v2</h1>"

    @pytest.mark.asyncio
    async def test_blind_fallback_when_no_screenshot(self):
        from workbench import atelier
        ws = await _mk(brief="сторінка")
        manifest = {"entry": "index.html",
                    "files": [{"path": "index.html", "content": "<p>x</p>"}]}
        src_verdict = {"verdict": "SHIP", "score": 6,
                       "critique": "код ок", "fix_instructions": ""}
        with patch.object(atelier, "_generate",
                          AsyncMock(return_value=manifest)), \
             patch.object(atelier, "_screenshot",
                          AsyncMock(return_value=None)), \
             patch.object(atelier, "_critique_source",
                          AsyncMock(return_value=src_verdict)):
            meta = await atelier.build(ws.id)
        assert meta["status"] == "ready"
        assert meta["passes"][0]["blind"] is True

    @pytest.mark.asyncio
    async def test_failure_marks_failed_and_journals(self):
        from workbench import atelier
        ws = await _mk(brief="щось")
        with patch.object(atelier, "_generate",
                          AsyncMock(side_effect=RuntimeError("llm down"))):
            with pytest.raises(RuntimeError):
                await atelier.build(ws.id)
        assert workbench_service.get(ws.id).status == "failed"
        events = [e["event"] for e in workbench_service.read_journal(ws.id)]
        assert "failed" in events


class TestChatTools:
    @pytest.mark.asyncio
    async def test_create_workbench_tool_returns_scene(self):
        from ai import tool_executor as te
        with patch("api.routes_workbench._spawn_build") as spawn:
            res = await te.execute_tool(
                "create_workbench",
                {"title": "Демо", "brief": "збудуй демо-сайт про дрони"},
                "u1")
        assert res["ok"] is True
        assert res["scene"]["kind"] == "workbench"
        data = res["scene"]["data"]
        assert data["status"] == "building"
        assert data["preview_url"].startswith("/api/v1/workbench/")
        assert "t=" in data["preview_url"]
        spawn.assert_called_once()

    @pytest.mark.asyncio
    async def test_create_workbench_rejects_thin_brief(self):
        from ai import tool_executor as te
        res = await te.execute_tool("create_workbench", {"brief": "сайт"}, "u1")
        assert res.get("error_kind") == "invalid_args"

    @pytest.mark.asyncio
    async def test_scene_payload_validates_against_schema(self):
        from ai.scenes import ChatToolScene
        from ai import tool_executor as te
        with patch("api.routes_workbench._spawn_build"):
            res = await te.execute_tool(
                "create_workbench",
                {"brief": "довгий бриф для валідації сцени"}, "u1")
        ChatToolScene(**res["scene"])

    @pytest.mark.asyncio
    async def test_tools_are_in_catalog_and_safe_list(self):
        from ai.chat_tools import DATA_TOOL_NAMES
        from ai.chat_tool_dispatcher import supported_tools
        for name in ("create_workbench", "refine_workbench", "list_workbenches"):
            assert name in DATA_TOOL_NAMES
            assert name in supported_tools()

    def test_auto_render_short_circuits_workbench(self):
        """The card must reach the user instantly — no Step-5 LLM call."""
        from ai.chat_pipeline import _auto_render_envelope
        scene = {"kind": "workbench", "data": {"title": "Плита"}}
        resp = _auto_render_envelope(
            "create_workbench",
            {"ok": True, "result": {"scene": scene}},
            scene, provider="gemini")
        assert resp is not None
        assert resp.attachments == [{"type": "scene", "data": scene}]
        assert "Плита" in resp.content
        # failure envelopes fall through to the normal prose path
        assert _auto_render_envelope(
            "create_workbench", {"ok": False}, scene) is None


class TestAtelierResilience:
    @pytest.mark.asyncio
    async def test_generate_reads_airesponse_content(self):
        """Regression: live run failed with 'AIResponse has no attribute
        text' — _generate must read .content off the router response."""
        from ai.provider import AIResponse
        from workbench import atelier
        manifest = {"entry": "index.html",
                    "files": [{"path": "index.html", "content": "<p>ok</p>"}]}
        fake = AIResponse(content=json.dumps(manifest))
        with patch("ai.provider.ai_router") as router:
            router.generate = AsyncMock(return_value=fake)
            out = await atelier._generate("бриф", "system")
        assert out["files"][0]["path"] == "index.html"

    @pytest.mark.asyncio
    async def test_dead_critic_ships_instead_of_failing(self, tmp_path, monkeypatch):
        """Files exist + every critic down (quota) → SHIP honestly, not FAIL."""
        monkeypatch.setenv("PHANTOM_DATA_DIR", str(tmp_path))
        from workbench import atelier
        ws = await workbench_service.create(
            title="Q", brief="сторінка з квотою", user_id="u1")
        manifest = {"entry": "index.html",
                    "files": [{"path": "index.html", "content": "<p>x</p>"}]}
        with patch.object(atelier, "_generate",
                          AsyncMock(return_value=manifest)), \
             patch.object(atelier, "_screenshot",
                          AsyncMock(return_value=None)), \
             patch.object(atelier, "_critique_source",
                          AsyncMock(side_effect=RuntimeError("429 quota"))):
            meta = await atelier.build(ws.id)
        assert meta["status"] == "ready"
        assert meta["passes"][0]["verdict"] == "SHIP"
        assert "критик недоступний" in meta["passes"][0]["critique"]
