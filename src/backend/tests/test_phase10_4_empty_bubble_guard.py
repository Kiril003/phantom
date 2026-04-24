"""
Phase 10.4 — Empty-bubble guard in gemini_provider.

Pre-10.4 the plain-text branch had NO empty-content fallback: when Gemini
returned a candidate with empty text parts (e.g. MAX_TOKENS finish_reason
with the system prompt eating the budget), content="" leaked into the DB
and the chat UI rendered blank bubbles.

Fix 1 of Phase 10.4: symmetric guard on both branches + finish_reason
logged in the warning so future empties are debuggable.
"""
from __future__ import annotations

import os
import types as _pytypes
from types import SimpleNamespace

import pytest

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase10-4")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-api-key-for-tests")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


def _make_part(*, fn_name: str | None = None, fn_args: dict | None = None, text: str | None = None):
    if fn_name is not None:
        fc = SimpleNamespace(name=fn_name, args=(fn_args or {}))
        return SimpleNamespace(function_call=fc, text=None)
    p = SimpleNamespace(text=text)
    p.function_call = None
    return p


def _make_response(*, parts: list, response_text: str = "", total_tokens: int = 42, finish_reason=None):
    candidate = SimpleNamespace(
        content=SimpleNamespace(parts=parts),
        finish_reason=finish_reason,
    )
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
    from ai import gemini_provider as gp
    monkeypatch.setattr(gp, "_build_gemini_tools", lambda *a, **kw: [])
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
async def test_plain_text_branch_empty_response_gets_ukrainian_filler(caplog, monkeypatch):
    """Pure plain-text response (no function_call, no text parts, no response.text) now gets a filler."""
    from ai import gemini_provider as gp

    # Part with function_call=None and text=None — emulates MAX_TOKENS empty candidate.
    empty_part = SimpleNamespace(function_call=None, text=None)
    response = _make_response(parts=[empty_part], response_text="", finish_reason="MAX_TOKENS")
    monkeypatch.setattr(gp, "_get_client", lambda: _FakeClient(response))

    provider = gp.GeminiProvider()
    with caplog.at_level("WARNING", logger="ai.gemini_provider"):
        result = await provider.generate("є?", "system", [])

    assert result.content == "Не встиг сформулювати — перепитай?"
    assert result.response_form == "text"
    assert result.attachments == []
    warnings = [r for r in caplog.records if r.levelname == "WARNING"]
    assert any("empty plain-text" in r.getMessage() for r in warnings)
    # finish_reason must appear in the warning for debuggability.
    assert any("MAX_TOKENS" in r.getMessage() for r in warnings)


@pytest.mark.asyncio
async def test_plain_text_with_real_text_unchanged(monkeypatch):
    """Regression guard: plain text with real content still routes correctly."""
    from ai import gemini_provider as gp

    text_part = SimpleNamespace(function_call=None, text="Привіт, друже!")
    response = _make_response(parts=[text_part], response_text="")
    monkeypatch.setattr(gp, "_get_client", lambda: _FakeClient(response))

    provider = gp.GeminiProvider()
    result = await provider.generate("хей", "system", [])

    assert result.content == "Привіт, друже!"
    assert result.response_form == "text"
    assert result.attachments == []


@pytest.mark.asyncio
async def test_respond_terminal_empty_content_with_attachment_preserved(monkeypatch):
    """respond_terminal with empty content + attachment → keep content empty (terminal card shows).

    Form=terminal is NOT in the expects_content set, so attachment-only
    survival is preserved.
    """
    from ai import gemini_provider as gp

    term_args = {
        "content": "",
        "command": "ls -la",
    }
    response = _make_response(
        parts=[_make_part(fn_name="respond_terminal", fn_args=term_args)],
        response_text="",
    )
    monkeypatch.setattr(gp, "_get_client", lambda: _FakeClient(response))

    provider = gp.GeminiProvider()
    result = await provider.generate("run ls", "system", [])

    assert result.response_form == "terminal"
    assert result.content == ""
    assert len(result.attachments) == 1
    assert result.attachments[0]["type"] == "terminal_output"


@pytest.mark.asyncio
async def test_respond_text_empty_logs_finish_reason(caplog, monkeypatch):
    """The Phase 10.4 warning must include finish_reason for debuggability."""
    from ai import gemini_provider as gp

    response = _make_response(
        parts=[_make_part(fn_name="respond_text", fn_args={"content": ""})],
        response_text="",
        finish_reason="SAFETY",
    )
    monkeypatch.setattr(gp, "_get_client", lambda: _FakeClient(response))

    provider = gp.GeminiProvider()
    with caplog.at_level("WARNING", logger="ai.gemini_provider"):
        await provider.generate("hi", "system", [])

    warnings = [r for r in caplog.records if r.levelname == "WARNING"]
    assert any(
        "finish_reason=SAFETY" in r.getMessage() or "SAFETY" in r.getMessage()
        for r in warnings
    )
