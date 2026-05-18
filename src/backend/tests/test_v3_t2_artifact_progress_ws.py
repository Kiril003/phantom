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


# ── Intent gate call site ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_intent_gate_passes_cb_to_build_artifact(monkeypatch):
    """Step 1.5: _wants_artifact path passes on_phase."""
    from ai import chat_pipeline
    from ai.tool_use import ToolCallResult

    received_phases: list[str] = []

    async def fake_build(brief, *, user_id, on_phase=None):
        assert on_phase is not None, "on_phase must be passed"
        await on_phase("draft", "<html/>")
        received_phases.append("draft")
        return brief.title, "<!doctype html><html><body>VIZ</body></html>"

    monkeypatch.setattr("ai.artifact_studio.build_artifact", fake_build)

    # Prevent actual hub broadcast
    class NullHub:
        async def broadcast(self, *a, **kw):
            pass
    monkeypatch.setattr("api.websocket_hub.hub", NullHub())

    # Prevent cwt from being called
    async def _forbidden_cwt(**kw):
        raise AssertionError("cwt must not be called for intent gate")

    monkeypatch.setattr(chat_pipeline.ai_router, "call_with_tools", _forbidden_cwt)

    result = await chat_pipeline.run(
        user_message="візуалізуй алгоритм сортування",
        system_prompt="s", history=[], user_id="u-intent", db=None,  # type: ignore[arg-type]
    )
    assert result.response_form == "artifact"
    assert received_phases == ["draft"]


# ── Salvage call site ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_salvage_passes_cb_to_build_artifact(monkeypatch):
    from ai import chat_pipeline
    from ai.tool_use import ToolCallResult

    received_on_phase = {"called": False}

    async def fake_build(brief, *, user_id, on_phase=None):
        assert on_phase is not None, "on_phase must be passed in salvage path"
        received_on_phase["called"] = True
        return brief.title, "<!doctype html><html><body>SALVAGE</body></html>"

    monkeypatch.setattr("ai.artifact_studio.build_artifact", fake_build)

    class NullHub:
        async def broadcast(self, *a, **kw):
            pass
    monkeypatch.setattr("api.websocket_hub.hub", NullHub())

    async def _stub_cwt(**kw):
        return ToolCallResult(
            tool_name="", arguments={}, provider="gemini", model="s",
            raw_reasoning="ось\n```html\n<!doctype html><body><canvas/></body>\n```\n",
        )

    monkeypatch.setattr(chat_pipeline.ai_router, "call_with_tools", _stub_cwt)

    result = await chat_pipeline.run(
        user_message="напиши щось цікаве будь ласка",
        system_prompt="s", history=[], user_id="u-salvage", db=None,  # type: ignore[arg-type]
    )
    assert result.response_form == "artifact"
    assert received_on_phase["called"]


# ── _widget_response call site ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_widget_response_passes_cb_to_build_artifact(monkeypatch):
    from ai import chat_pipeline
    from ai.tool_use import ToolCallResult

    received_on_phase = {"called": False}

    async def fake_build(brief, *, user_id, on_phase=None):
        assert on_phase is not None, "on_phase must be passed in _widget_response"
        received_on_phase["called"] = True
        return brief.title, "<!doctype html><html><body>WIDGET</body></html>"

    monkeypatch.setattr("ai.artifact_studio.build_artifact", fake_build)

    class NullHub:
        async def broadcast(self, *a, **kw):
            pass
    monkeypatch.setattr("api.websocket_hub.hub", NullHub())

    choice = ToolCallResult(
        tool_name="respond_artifact",
        arguments={"title": "T", "content": "r", "html": "", "capabilities": []},
        provider="gemini", model="s",
    )
    out = await chat_pipeline._widget_response(choice, "u-widget", None)  # type: ignore[arg-type]
    assert out.response_form == "artifact"
    assert received_on_phase["called"]
