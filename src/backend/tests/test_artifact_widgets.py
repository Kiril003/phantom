import pytest

from ai.response_formatter import parse_function_call, RESPONSE_FORM_TOOLS, _FORM_MAP
from config import config

ART = "<!doctype html><body><canvas id=c></canvas><script>1</script></body>"


def test_artifact_config_defaults():
    assert config.chat_artifacts_enabled is False
    assert config.chat_response_widgets_enabled is False
    assert config.chat_artifact_html_cap_bytes == 262144


def test_respond_artifact_in_catalog():
    assert any(t["name"] == "respond_artifact" for t in RESPONSE_FORM_TOOLS)
    assert _FORM_MAP["respond_artifact"] == "artifact"


def test_parse_artifact_builds_panel(monkeypatch):
    monkeypatch.setattr(config, "chat_artifacts_enabled", True)
    form, content, atts = parse_function_call(
        "respond_artifact",
        {"title": "Pulse", "html": ART, "capabilities": ["read:context"]},
    )
    assert form == "artifact"
    art = next(a for a in atts if a["type"] == "artifact_data")
    assert art["data"]["html"] == ART
    assert art["data"]["title"] == "Pulse"
    assert art["data"]["capabilities"] == ["read:context"]
    scene = next(a for a in atts if a["type"] == "scene")
    assert scene["data"]["kind"] == "artifact"
    assert scene["data"]["panels"][0]["kind"] == "artifact"


def test_parse_artifact_no_capabilities_succeeds(monkeypatch):
    monkeypatch.setattr(config, "chat_artifacts_enabled", True)
    form, _, atts = parse_function_call(
        "respond_artifact", {"title": "x", "html": ART})
    assert form == "artifact"
    art = next(a for a in atts if a["type"] == "artifact_data")
    assert art["data"]["capabilities"] == []


def test_parse_artifact_oversize_degrades_to_text(monkeypatch):
    monkeypatch.setattr(config, "chat_artifacts_enabled", True)
    monkeypatch.setattr(config, "chat_artifact_html_cap_bytes", 10)
    form, _, atts = parse_function_call(
        "respond_artifact", {"title": "x", "html": ART, "capabilities": []})
    assert form == "text"
    assert not any(a["type"] == "artifact_data" for a in atts)


def test_parse_artifact_bad_capability_degrades_to_text(monkeypatch):
    monkeypatch.setattr(config, "chat_artifacts_enabled", True)
    form, _, atts = parse_function_call(
        "respond_artifact",
        {"title": "x", "html": ART, "capabilities": ["read:context", "fs:write"]})
    assert form == "text"


def test_parse_artifact_disabled_degrades_to_text(monkeypatch):
    monkeypatch.setattr(config, "chat_artifacts_enabled", False)
    form, _, atts = parse_function_call(
        "respond_artifact", {"title": "x", "html": ART, "capabilities": []})
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


class TestArtifactSalvage:
    def test_extract_pulls_html_doc_and_prose(self):
        from ai.chat_pipeline import _extract_artifact_html

        text = (
            "Ось дихальний таймер 4-7-8.\n\n"
            f"{FENCE}html\n{ART}\n{FENCE}\n\n"
            "Скажи якщо треба інші кольори."
        )
        out = _extract_artifact_html(text)
        assert out is not None
        html, prose = out
        assert html.strip() == ART
        assert FENCE not in prose and "<!doctype" not in prose
        assert "дихальний таймер" in prose
        assert "інші кольори" in prose

    def test_extract_ignores_non_html_code_fence(self):
        from ai.chat_pipeline import _extract_artifact_html

        assert _extract_artifact_html(
            f"ось скрипт\n{FENCE}python\nprint(1)\n{FENCE}\n"
        ) is None

    def test_extract_none_on_plain_text(self):
        from ai.chat_pipeline import _extract_artifact_html

        assert _extract_artifact_html("просто відповідь без коду") is None

    @pytest.mark.asyncio
    async def test_run_salvages_raw_html_into_artifact(self, monkeypatch):
        from ai import chat_pipeline
        from ai.tool_use import ToolCallResult

        monkeypatch.setattr(config, "chat_response_widgets_enabled", True)
        monkeypatch.setattr(config, "chat_artifacts_enabled", True)

        raw = (
            "Ось пульсуючий віджет.\n\n"
            f"{FENCE}html\n{ART}\n{FENCE}\n"
        )

        async def _stub_cwt(**kw):
            return ToolCallResult(
                tool_name="",
                arguments={},
                provider="gemini",
                model="stub",
                raw_reasoning=raw,
            )

        dispatch_calls: list = []
        generate_calls: list = []

        async def _forbidden_dispatch(name, args, *, user_id, db):
            dispatch_calls.append(name)
            return {"ok": False}

        async def _forbidden_generate(**kw):
            generate_calls.append(kw)
            from ai.provider import AIResponse
            return AIResponse(content="nope", provider="x")

        monkeypatch.setattr(chat_pipeline.ai_router, "call_with_tools", _stub_cwt)
        async def _echo_build(brief, *, user_id, on_phase=None):
            return brief.title, brief.hint
        monkeypatch.setattr("ai.artifact_studio.build_artifact", _echo_build)
        monkeypatch.setattr("ai.chat_tool_dispatcher.dispatch", _forbidden_dispatch)
        monkeypatch.setattr(chat_pipeline.ai_router, "generate", _forbidden_generate)

        result = await chat_pipeline.run(
            user_message="напиши щось цікаве будь ласка",
            system_prompt="sys",
            history=[],
            user_id="u-test",
            db=None,  # type: ignore[arg-type]
        )

        assert result.response_form == "artifact", result.response_form
        arts = [
            a for a in (result.attachments or [])
            if isinstance(a, dict) and a.get("type") == "artifact_data"
        ]
        assert arts, result.attachments
        assert arts[0]["data"]["html"].strip() == ART
        # PHANTOM still converses — prose kept, raw code NOT dumped.
        assert FENCE not in result.content
        assert "<!doctype" not in result.content
        assert "віджет" in result.content.lower()
        assert not dispatch_calls and not generate_calls

    @pytest.mark.asyncio
    async def test_run_no_salvage_when_disabled(self, monkeypatch):
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
            user_message="x", system_prompt="s", history=[],
            user_id="u", db=None,  # type: ignore[arg-type]
        )
        assert result.response_form != "artifact"
