"""Pre-existing companion-v2-phase-0 bug: chat_pipeline.run() passes
RESPONSE_FORM_TOOLS *dicts* into ai_router.call_with_tools, but the
gemini provider does `{t.name for t in tools}` → every round-1 tool
pick crashed with "'dict' object has no attribute 'name'", so the model
could never cleanly pick respond_artifact (or any widget) — chat fell
back to weak plain text. ai_router must coerce dicts → ToolSchema at the
seam and pass ToolSchema through untouched.
"""
from ai.provider import _coerce_tool_schemas
from ai.tool_use import ToolSchema


def test_dicts_are_coerced_to_toolschema():
    out = _coerce_tool_schemas(
        [{"name": "respond_artifact", "description": "віджет",
          "parameters": {"type": "object", "properties": {"html": {"type": "string"}}}}]
    )
    assert len(out) == 1
    assert isinstance(out[0], ToolSchema)
    assert out[0].name == "respond_artifact"
    assert out[0].description == "віджет"
    assert out[0].parameters["properties"]["html"]["type"] == "string"


def test_toolschema_passed_through_by_identity():
    ts = ToolSchema(name="x", description="d")
    out = _coerce_tool_schemas([ts])
    assert out[0] is ts


def test_mixed_list_and_dict_without_parameters():
    ts = ToolSchema(name="keep", description="d")
    out = _coerce_tool_schemas([ts, {"name": "bare"}])
    assert out[0] is ts
    assert isinstance(out[1], ToolSchema)
    assert out[1].name == "bare"
    assert out[1].parameters == {"type": "object", "properties": {}}


def test_empty_passthrough():
    assert _coerce_tool_schemas([]) == []
