"""Images in chat — signed raw URLs + show_image tool."""
from __future__ import annotations

import time

import pytest

from api.routes_files import RAW_MIME, _raw_sig, sign_raw_url


class TestSignedRawUrl:
    def test_sign_and_verify_roundtrip(self):
        url = sign_raw_url("/tmp/photo.png", ttl_s=60)
        assert url.startswith("/api/v1/files/raw?path=")
        assert "sig=" in url and "exp=" in url

    def test_sig_binds_path_and_exp(self):
        exp = int(time.time()) + 60
        sig = _raw_sig("/tmp/a.png", exp)
        assert sig != _raw_sig("/tmp/b.png", exp)
        assert sig != _raw_sig("/tmp/a.png", exp + 1)

    def test_mime_map_is_image_only(self):
        assert ".png" in RAW_MIME and ".jpg" in RAW_MIME
        assert ".html" not in RAW_MIME and ".js" not in RAW_MIME


class TestShowImageTool:
    @pytest.mark.asyncio
    async def test_returns_image_attachment_for_real_file(self, tmp_path, monkeypatch):
        img = tmp_path / "cat.png"
        img.write_bytes(b"\x89PNG\r\n\x1a\n")
        monkeypatch.setattr(
            "tools.file_manager._allowed_roots", lambda: [tmp_path])
        from ai import tool_executor as te
        res = await te.execute_tool(
            "show_image", {"path": str(img), "caption": "кіт"}, "u1")
        assert res["ok"] is True
        att = res["attachment"]
        assert att["type"] == "image"
        assert att["data"]["name"] == "cat.png"
        assert att["data"]["caption"] == "кіт"
        assert att["data"]["url"].startswith("/api/v1/files/raw?")

    @pytest.mark.asyncio
    async def test_rejects_non_image(self, tmp_path, monkeypatch):
        f = tmp_path / "notes.txt"
        f.write_text("x")
        monkeypatch.setattr(
            "tools.file_manager._allowed_roots", lambda: [tmp_path])
        from ai import tool_executor as te
        res = await te.execute_tool("show_image", {"path": str(f)}, "u1")
        assert res.get("error_kind") == "invalid_args"

    @pytest.mark.asyncio
    async def test_rejects_outside_allowlist(self, tmp_path, monkeypatch):
        monkeypatch.setattr(
            "tools.file_manager._allowed_roots", lambda: [tmp_path / "jail"])
        from ai import tool_executor as te
        res = await te.execute_tool(
            "show_image", {"path": "/etc/passwd.png"}, "u1")
        assert res.get("error_kind") == "forbidden"

    def test_auto_render_ships_the_attachment(self):
        from ai.chat_pipeline import _auto_render_envelope
        att = {"type": "image",
               "data": {"url": "/api/v1/files/raw?x", "name": "cat.png",
                        "caption": "кіт"}}
        resp = _auto_render_envelope(
            "show_image", {"ok": True, "result": {"attachment": att}},
            None, provider="gemini")
        assert resp is not None
        assert resp.attachments == [att]
        assert resp.content == "кіт"

    @pytest.mark.asyncio
    async def test_tool_registered_in_catalog_and_safe_list(self):
        from ai.chat_tools import DATA_TOOL_NAMES
        from ai.chat_tool_dispatcher import supported_tools
        assert "show_image" in DATA_TOOL_NAMES
        assert "show_image" in supported_tools()
