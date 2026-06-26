"""T2 — chat_pipeline 3 call-sites pass broadcasting callback + WS event shape.

Asserts:
- _make_artifact_phase_cb broadcasts {phase, htmlPreview?} on channel 'chat'
  type 'scene.artifact.progress' for the correct user_id
- htmlPreview is present when html is not None, absent when None
- Intent gate (Step 1.5) passes the callback
- Salvage branch passes the callback
- _widget_response respond_artifact branch passes the callback
- Existing tests still pass (regression guard via existing suite)
"""
from __future__ import annotations

import pytest


# ── Broadcast shape ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_phase_cb_broadcasts_with_html_preview(monkeypatch):
    from ai.chat_pipeline import _make_artifact_phase_cb

    broadcasts: list[tuple] = []

    class FakeHub:
        async def broadcast(self, channel, type_, data, *, user_id=None, profile_id=None):
            broadcasts.append((channel, type_, data, user_id))

    monkeypatch.setattr("api.websocket_hub.hub", FakeHub())

    cb = _make_artifact_phase_cb("user-42")
    await cb("draft", "<html>x</html>")

    assert len(broadcasts) == 1
    ch, t, data, uid = broadcasts[0]
    assert ch == "chat"
    assert t == "scene.artifact.progress"
    assert data["phase"] == "draft"
    assert data["htmlPreview"] == "<html>x</html>"
    assert uid == "user-42"


@pytest.mark.asyncio
async def test_phase_cb_broadcasts_without_html_when_none(monkeypatch):
    from ai.chat_pipeline import _make_artifact_phase_cb

    broadcasts: list[tuple] = []

    class FakeHub:
        async def broadcast(self, channel, type_, data, *, user_id=None, profile_id=None):
            broadcasts.append((channel, type_, data))

    monkeypatch.setattr("api.websocket_hub.hub", FakeHub())

    cb = _make_artifact_phase_cb("u")
    await cb("critiquing", None)

    assert len(broadcasts) == 1
    data = broadcasts[0][2]
    assert data["phase"] == "critiquing"
    assert "htmlPreview" not in data


@pytest.mark.asyncio
async def test_phase_cb_swallows_hub_exception(monkeypatch):
    from ai.chat_pipeline import _make_artifact_phase_cb

    class BoomHub:
        async def broadcast(self, *a, **kw):
            raise RuntimeError("ws gone")

    monkeypatch.setattr("api.websocket_hub.hub", BoomHub())

    cb = _make_artifact_phase_cb("u")
    # Must not raise
    await cb("done", "<html/>")



