import pytest

from ai.response_formatter import parse_function_call, RESPONSE_FORM_TOOLS, _FORM_MAP
from config import config

ART = "<!doctype html><body><canvas id=c></canvas><script>1</script></body>"


def test_artifact_config_defaults():
    assert config.chat_artifacts_enabled is True


def test_respond_artifact_in_catalog():
    assert any(t["name"] == "respond_artifact" for t in RESPONSE_FORM_TOOLS)
    assert _FORM_MAP["respond_artifact"] == "react_artifact"


def test_parse_artifact_builds_panel(monkeypatch):
    monkeypatch.setattr(config, "chat_artifacts_enabled", True)
    form, content, atts = parse_function_call(
        "respond_artifact",
        {"title": "Pulse", "code": "export default function App() {}"},
    )
    assert form == "react_artifact"
    art = next(a for a in atts if a["type"] == "artifact_data")
    assert art["data"]["title"] == "Pulse"
    assert art["data"]["code"] == "export default function App() {}"


def test_parse_artifact_no_code_degrades_to_text(monkeypatch):
    monkeypatch.setattr(config, "chat_artifacts_enabled", True)
    form, _, atts = parse_function_call(
        "respond_artifact", {"title": "x", "code": ""})
    assert form == "text"


def test_parse_artifact_disabled_degrades_to_text(monkeypatch):
    monkeypatch.setattr(config, "chat_artifacts_enabled", False)
    form, _, atts = parse_function_call(
        "respond_artifact", {"title": "x", "code": "export default function App() {}"})
    assert form == "text"


@pytest.mark.asyncio
async def test_artifact_action_proxies_to_dispatcher(monkeypatch):
    import api.routes_chat as rc
    seen = {}

    async def fake_dispatch(name, args, *, user_id, db):
        seen["call"] = (name, args, user_id)
        return {"ok": True, "name": name, "result": {"echo": args}}

    monkeypatch.setattr("ai.chat_tool_dispatcher.dispatch", fake_dispatch)

    class U:
        id = "u-test"

    out = await rc.artifact_action(
        rc.ArtifactActionRequest(tool="get_system_metrics", args={"x": 1}),
        db=None, user=U(),
    )
    assert out == {"ok": True, "name": "get_system_metrics",
                   "result": {"echo": {"x": 1}}}
    assert seen["call"] == ("get_system_metrics", {"x": 1}, "u-test")


@pytest.mark.asyncio
async def test_save_artifact_as_studio_card(tmp_path, monkeypatch):
    from agent.studio import models as sm
    card = sm.make_artifact_card(
        title="Pulse", html="<b>x</b>", capabilities=["read:context"])
    assert card.kind == "artifact"
    assert card.config["html"] == "<b>x</b>"
    assert card.config["capabilities"] == ["read:context"]


# ── B1: deterministic salvage — raw ```html answer → artifact ──────────────

FENCE = "```"


# Removed TestArtifactSalvage as the salvage feature was deprecated in favor of A2UI.

@pytest.mark.asyncio
async def test_run_no_salvage_when_disabled(monkeypatch):
    from ai import chat_pipeline
    from ai.tool_use import ToolCallResult

    monkeypatch.setattr(config, "chat_response_widgets_enabled", True)
    monkeypatch.setattr(config, "chat_artifacts_enabled", False)

    async def _stub_cwt(**kw):
        return ToolCallResult(
            tool_name="", arguments={}, provider="gemini", model="s",
            raw_reasoning=f"текст\n{FENCE}html\n{ART}\n{FENCE}\n",
        )

    monkeypatch.setattr(chat_pipeline.ai_router, "call_with_tools", _stub_cwt)
    result = await chat_pipeline.run(
        user_message="html не артефакт тест", system_prompt="s", history=[],
        user_id="u", db=None,  # type: ignore[arg-type]
    )
    assert result.response_form != "artifact"
