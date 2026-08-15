import pytest

from ai.response_formatter import parse_function_call, RESPONSE_FORM_TOOLS, _FORM_MAP
from config import config

ART = "<!doctype html><body><canvas id=c></canvas><script>1</script></body>"


def test_artifact_config_defaults():
    assert config.chat_artifacts_enabled is True


def test_respond_artifact_in_catalog():
    assert any(t["name"] == "respond_artifact" for t in RESPONSE_FORM_TOOLS)
    # chat-teardown §2.2 — must be a legal `ResponseForm` member
    # (chat.ts:4-18), NOT the `react_artifact` SceneKind/ChatToolScene
    # discriminator (chat.ts:613). Those are two different names on
    # purpose; see `_FORM_TO_SCENE_KIND` in response_formatter.py.
    assert _FORM_MAP["respond_artifact"] == "artifact"


def test_parse_artifact_builds_panel(monkeypatch):
    monkeypatch.setattr(config, "chat_artifacts_enabled", True)
    form, content, atts = parse_function_call(
        "respond_artifact",
        {"title": "Pulse", "code": "export default function App() {}"},
    )
    assert form == "artifact"
    art = next(a for a in atts if a["type"] == "artifact_data")
    assert art["data"]["title"] == "Pulse"
    assert art["data"]["code"] == "export default function App() {}"


# ── chat-teardown §2.2 — wire-contract guard ────────────────────────────────
#
# `response_form` is typed `ResponseForm` on the frontend (a closed
# 14-member union in src/shared/types/chat.ts) but travels as a bare
# `str` on the backend with no schema enforcement. Nothing stopped
# `_FORM_MAP` from mapping a tool name to an illegal value — it happened
# for real ("react_artifact", fixed above) and went unnoticed because
# the offending messages always also carried a `scene` envelope, so
# `ResponseRenderer`'s default branch (which would have silently
# rendered it as plain markdown) never actually ran in practice.
#
# This test does not depend on that specific historical string — it
# proves the general guard: ANY illegal value reaching the end of
# `parse_function_call` must raise, not travel. Before the guard
# existed, this failed with "DID NOT RAISE" (illegal_form ==
# "not_a_real_response_form" — trivially not a valid form under any
# circumstance — sailed straight through). Injecting the entry via
# monkeypatch rather than hardcoding today's real bug means this test
# still means something even after "react_artifact" itself is a
# distant memory.
def test_parse_function_call_rejects_illegal_response_form(monkeypatch):
    monkeypatch.setitem(_FORM_MAP, "respond_bogus_widget", "not_a_real_response_form")
    with pytest.raises(ValueError, match="not_a_real_response_form"):
        parse_function_call("respond_bogus_widget", {})


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


# ── ArtifactStudio reroute (companion-v2 visualization overhaul) ─────────────

def test_build_artifact_scene_attachment_shape():
    from ai.response_formatter import build_artifact_scene_attachment

    att = build_artifact_scene_attachment("Пульс", ART)
    assert att["type"] == "scene"
    scene = att["data"]
    assert scene["kind"] == "artifact"
    assert scene["reveal"]["policy"] == "instant"
    assert len(scene["panels"]) == 1
    panel = scene["panels"][0]
    assert panel["kind"] == "artifact"
    assert panel["data"]["html"] == ART
    assert panel["data"]["title"] == "Пульс"
    assert panel["data"]["capabilities"] == []


def test_build_artifact_scene_attachment_with_prose():
    from ai.response_formatter import build_artifact_scene_attachment

    att = build_artifact_scene_attachment("X", ART, prose="Ось твій дашборд")
    panels = att["data"]["panels"]
    assert [p["kind"] for p in panels] == ["text", "artifact"]
    assert panels[0]["data"]["markdown"] == "Ось твій дашборд"


@pytest.mark.asyncio
async def test_widget_response_reroutes_to_studio(monkeypatch):
    from ai import chat_pipeline
    from ai.tool_use import ToolCallResult

    monkeypatch.setattr(config, "chat_artifacts_enabled", True)
    seen = {}

    async def fake_build(brief, *, user_id, on_phase=None):
        seen["brief"] = brief
        if on_phase is not None:
            await on_phase("draft", ART)
        return "Пульс", ART

    monkeypatch.setattr("ai.artifact_studio.build_artifact", fake_build)

    deltas: list[str] = []

    async def on_delta(chunk: str) -> None:
        deltas.append(chunk)

    choice = ToolCallResult(
        tool_name="respond_artifact",
        arguments={"title": "Пульс", "spec": "дашборд серцебиття"},
        provider="gemini", model="m",
    )
    resp = await chat_pipeline._widget_response(
        choice, "u", None,  # type: ignore[arg-type]
        user_message="покажи пульс", on_delta=on_delta,
    )
    assert resp.response_form == "text"
    assert resp.provider == "gemini"
    scene = next(a for a in resp.attachments if a["type"] == "scene")
    assert scene["data"]["kind"] == "artifact"
    assert scene["data"]["panels"][0]["data"]["html"] == ART
    assert "покажи пульс" in seen["brief"].request
    assert "дашборд серцебиття" in seen["brief"].request
    assert deltas  # liveness status reached the stream


@pytest.mark.asyncio
async def test_widget_response_studio_failure_salvages_html_hint(monkeypatch):
    from ai import chat_pipeline
    from ai.artifact_studio import ArtifactStudioError
    from ai.tool_use import ToolCallResult

    monkeypatch.setattr(config, "chat_artifacts_enabled", True)

    async def fake_build(brief, *, user_id, on_phase=None):
        raise ArtifactStudioError("gemini down")

    monkeypatch.setattr("ai.artifact_studio.build_artifact", fake_build)

    choice = ToolCallResult(
        tool_name="respond_artifact",
        arguments={"title": "X", "spec": "s", "code": ART},
        provider="gemini", model="m",
    )
    resp = await chat_pipeline._widget_response(
        choice, "u", None,  # type: ignore[arg-type]
        user_message="візуалізуй",
    )
    scene = next(a for a in resp.attachments if a["type"] == "scene")
    assert scene["data"]["panels"][0]["data"]["html"] == ART


@pytest.mark.asyncio
async def test_widget_response_studio_failure_react_code_falls_to_legacy(monkeypatch):
    from ai import chat_pipeline
    from ai.artifact_studio import ArtifactStudioError
    from ai.tool_use import ToolCallResult

    monkeypatch.setattr(config, "chat_artifacts_enabled", True)

    async def fake_build(brief, *, user_id, on_phase=None):
        raise ArtifactStudioError("gemini down")

    monkeypatch.setattr("ai.artifact_studio.build_artifact", fake_build)

    choice = ToolCallResult(
        tool_name="respond_artifact",
        arguments={"title": "X", "spec": "s", "code": "export default function App() {}"},
        provider="gemini", model="m",
    )
    resp = await chat_pipeline._widget_response(
        choice, "u", None,  # type: ignore[arg-type]
        user_message="візуалізуй",
    )
    # chat-teardown §2.2 — response_form must stay a legal ResponseForm
    # member ("artifact"); the raw-code Sandpack renderer is still
    # reached, but via message.scene.kind == "react_artifact", not via
    # this field. See _FORM_TO_SCENE_KIND in response_formatter.py.
    assert resp.response_form == "artifact"
    art = next(a for a in resp.attachments if a["type"] == "artifact_data")
    assert art["data"]["code"] == "export default function App() {}"
    scene = next(a for a in resp.attachments if a["type"] == "scene")
    assert scene["data"]["kind"] == "react_artifact"


@pytest.mark.asyncio
async def test_widget_response_studio_failure_no_code_apologizes(monkeypatch):
    from ai import chat_pipeline
    from ai.artifact_studio import ArtifactStudioError
    from ai.tool_use import ToolCallResult

    monkeypatch.setattr(config, "chat_artifacts_enabled", True)

    async def fake_build(brief, *, user_id, on_phase=None):
        raise ArtifactStudioError("gemini down")

    monkeypatch.setattr("ai.artifact_studio.build_artifact", fake_build)

    choice = ToolCallResult(
        tool_name="respond_artifact",
        arguments={"title": "X", "spec": "s"},
        provider="gemini", model="m",
    )
    resp = await chat_pipeline._widget_response(
        choice, "u", None,  # type: ignore[arg-type]
        user_message="візуалізуй",
    )
    assert resp.response_form == "text"
    assert resp.content.strip()  # graceful apology, never an empty bubble
