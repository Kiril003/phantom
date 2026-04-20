"""
Chat-fix — empty Gemini function_call response fallback.

Gemini in mode="AUTO" intermittently emits respond_text(content="") with no
sibling text parts, producing empty chat bubbles. The GeminiProvider.generate()
path now cascades: fn_args.content -> text_parts -> response.text -> "…"
placeholder (with WARNING log). When attachments exist (e.g. respond_chart),
empty content is preserved because the chart renders the data.
"""
from __future__ import annotations

import os
import types as _pytypes
from types import SimpleNamespace

import pytest

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-chatfix-empty")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-api-key-for-tests")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


def _make_part(*, fn_name: str | None = None, fn_args: dict | None = None, text: str | None = None):
    """Build a fake google-genai Part with either function_call or text."""
    if fn_name is not None:
        fc = SimpleNamespace(name=fn_name, args=(fn_args or {}))
        return SimpleNamespace(function_call=fc, text=None)
    # Pure text part: no function_call attribute present.
    p = SimpleNamespace(text=text)
    # `hasattr(part, "function_call")` must be False OR the attr must be falsy.
    p.function_call = None
    return p


def _make_response(*, parts: list, response_text: str = "", total_tokens: int = 42):
    candidate = SimpleNamespace(content=SimpleNamespace(parts=parts))
    usage = SimpleNamespace(total_token_count=total_tokens)
    return SimpleNamespace(
        candidates=[candidate],
        usage_metadata=usage,
        text=response_text,
    )


class _FakeAioModels:
    def __init__(self, response):
        self._response = response

    async def generate_content(self, *, model, contents, config):
        return self._response


class _FakeClient:
    def __init__(self, response):
        self.aio = SimpleNamespace(models=_FakeAioModels(response))


@pytest.fixture(autouse=True)
def _disable_gemini_tools(monkeypatch):
    # Avoid pulling in google.genai.types just to build tool declarations.
    from ai import gemini_provider as gp
    monkeypatch.setattr(gp, "_build_gemini_tools", lambda: [])
    # GenerateContentConfig ends up called with tools=[] + types.ToolConfig(...).
    # Stub out types usage by replacing generate_content's config path — easiest:
    # stub out types.GenerateContentConfig, ToolConfig, FunctionCallingConfig,
    # and SafetySetting to plain dicts so import doesn't need google-genai.
    import sys
    fake_types = _pytypes.ModuleType("google.genai.types")
    fake_types.GenerateContentConfig = lambda **kw: kw  # type: ignore[attr-defined]
    fake_types.ToolConfig = lambda **kw: kw  # type: ignore[attr-defined]
    fake_types.FunctionCallingConfig = lambda **kw: kw  # type: ignore[attr-defined]
    fake_types.SafetySetting = lambda **kw: kw  # type: ignore[attr-defined]
    fake_genai = _pytypes.ModuleType("google.genai")
    fake_genai.types = fake_types  # type: ignore[attr-defined]
    fake_google = sys.modules.get("google") or _pytypes.ModuleType("google")
    fake_google.genai = fake_genai  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "google", fake_google)
    monkeypatch.setitem(sys.modules, "google.genai", fake_genai)
    monkeypatch.setitem(sys.modules, "google.genai.types", fake_types)


@pytest.mark.asyncio
async def test_empty_function_call_with_no_text_returns_placeholder_and_warns(caplog, monkeypatch):
    """fn returns content='' AND no text_parts AND no response.text → '…' + WARNING."""
    from ai import gemini_provider as gp

    response = _make_response(
        parts=[_make_part(fn_name="respond_text", fn_args={"content": ""})],
        response_text="",
    )
    monkeypatch.setattr(gp, "_get_client", lambda: _FakeClient(response))

    provider = gp.GeminiProvider()
    with caplog.at_level("WARNING", logger="ai.gemini_provider"):
        result = await provider.generate("привіт", "system", [])

    assert result.content == "…"
    assert result.response_form == "text"
    assert result.attachments == []
    warnings = [r for r in caplog.records if r.levelname == "WARNING"]
    assert any("empty respond_text function_call" in r.getMessage() for r in warnings)


@pytest.mark.asyncio
async def test_empty_function_call_falls_back_to_text_parts(monkeypatch):
    """fn returns content='' BUT sibling text parts exist → use joined text_parts."""
    from ai import gemini_provider as gp

    response = _make_response(
        parts=[
            _make_part(fn_name="respond_text", fn_args={"content": ""}),
            _make_part(text="Привіт,"),
            _make_part(text="людино!"),
        ],
        response_text="ignored-sdk-accumulator",
    )
    monkeypatch.setattr(gp, "_get_client", lambda: _FakeClient(response))

    provider = gp.GeminiProvider()
    result = await provider.generate("hello", "system", [])

    # text_parts take precedence over response.text (joined with spaces)
    assert result.content == "Привіт, людино!"
    assert result.response_form == "text"
    assert result.attachments == []


@pytest.mark.asyncio
async def test_empty_function_call_falls_back_to_response_text(monkeypatch):
    """fn content='' AND no sibling text parts → use response.text from SDK."""
    from ai import gemini_provider as gp

    response = _make_response(
        parts=[_make_part(fn_name="respond_text", fn_args={"content": ""})],
        response_text="sdk-fallback-content",
    )
    monkeypatch.setattr(gp, "_get_client", lambda: _FakeClient(response))

    provider = gp.GeminiProvider()
    result = await provider.generate("hello", "system", [])

    assert result.content == "sdk-fallback-content"
    assert result.response_form == "text"
    assert result.attachments == []


@pytest.mark.asyncio
async def test_empty_content_with_attachments_is_preserved(monkeypatch):
    """respond_chart with empty content + real chart data → keep content empty; chart renders."""
    from ai import gemini_provider as gp

    chart_args = {
        "content": "",
        "chart_type": "bar",
        "data": [{"name": "A", "value": 1}, {"name": "B", "value": 2}],
        "title": "Demo",
        "x_key": "name",
        "y_keys": ["value"],
    }
    response = _make_response(
        parts=[_make_part(fn_name="respond_chart", fn_args=chart_args)],
        response_text="",
    )
    monkeypatch.setattr(gp, "_get_client", lambda: _FakeClient(response))

    provider = gp.GeminiProvider()
    result = await provider.generate("plot", "system", [])

    # Attachment present → we do NOT override empty content with placeholder.
    assert result.content == ""
    assert result.response_form == "chart"
    assert len(result.attachments) == 1
    assert result.attachments[0]["type"] == "chart_data"
