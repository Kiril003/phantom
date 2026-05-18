from __future__ import annotations

import os
import sys
import types as _pytypes
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-chat-gating")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-api-key-for-tests")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


def _make_text_response(text: str):
    part = SimpleNamespace(text=text)
    part.function_call = None
    candidate = SimpleNamespace(
        content=SimpleNamespace(parts=[part]),
        finish_reason="STOP",
    )
    return SimpleNamespace(
        candidates=[candidate],
        usage_metadata=SimpleNamespace(total_token_count=12),
        text=text,
    )


class _CapturingAioModels:
    def __init__(self):
        self.calls: list[dict] = []

    async def generate_content(self, *, model, contents, config):
        self.calls.append({"model": model, "contents": contents, "config": config})
        return _make_text_response("Просто текст.")


class _FakeClient:
    def __init__(self, models: _CapturingAioModels):
        self.aio = SimpleNamespace(models=models)


@pytest.mark.asyncio
async def test_gemini_plain_chat_does_not_advertise_response_tools_when_disabled(monkeypatch):
    from ai import gemini_provider as gp
    from config import config

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

    models = _CapturingAioModels()
    monkeypatch.setattr(gp, "_get_client", lambda: _FakeClient(models))
    monkeypatch.setattr(config, "chat_tools_enabled", False)

    result = await gp.GeminiProvider().generate(
        "привіт",
        "system",
        [],
        user_id="u-test",
    )

    assert result.content == "Просто текст."
    assert models.calls
    gen_config = models.calls[0]["config"]
    assert "tools" not in gen_config
    assert "tool_config" not in gen_config


@pytest.mark.asyncio
async def test_hydrate_session_memory_from_db_warms_old_session(monkeypatch):
    from api.routes_chat import _hydrate_session_memory_from_db
    from memory.session_memory import session_memory

    session_id = "s-hydrate-regression"
    user_id = "u-hydrate-regression"
    session_memory.clear_session(session_id)

    rows = [
        SimpleNamespace(
            id="m1",
            session_id=session_id,
            user_id=user_id,
            role="user",
            content="Пам'ятай: мій ноутбук називається Nova.",
            response_form="text",
            attachments_json="[]",
            created_at=datetime(2026, 5, 18, 9, 0, tzinfo=timezone.utc),
        ),
        SimpleNamespace(
            id="m2",
            session_id=session_id,
            user_id=user_id,
            role="assistant",
            content="Запам'ятав Nova.",
            response_form="text",
            attachments_json="[]",
            created_at=datetime(2026, 5, 18, 9, 1, tzinfo=timezone.utc),
        ),
    ]

    class _Scalars:
        def all(self):
            return list(reversed(rows))

    class _Result:
        def scalars(self):
            return _Scalars()

    class _DB:
        async def execute(self, _stmt):
            return _Result()

    await _hydrate_session_memory_from_db(
        _DB(), user_id=user_id, session_id=session_id  # type: ignore[arg-type]
    )

    history = session_memory.get_history_dicts(session_id, max_turns=5)
    assert history == [
        {"role": "user", "content": "Пам'ятай: мій ноутбук називається Nova."},
        {"role": "assistant", "content": "Запам'ятав Nova."},
    ]
    session_memory.clear_session(session_id)


@pytest.mark.asyncio
async def test_router_does_not_pass_model_override_to_tool_providers_without_support(monkeypatch):
    from ai import provider as provider_mod
    from ai.provider import AIRouter
    from ai.tool_use import ToolCallResult, ToolErrorKind, ToolSchema, ToolUseError

    async def _no_audit(**_kw):
        return None

    monkeypatch.setattr("ai.tool_use_audit.write_log", _no_audit)
    monkeypatch.setattr(provider_mod.config, "ai_primary_provider", "gemini")
    monkeypatch.setattr(provider_mod.config, "ai_fallback_provider", "ollama")

    class _PrimaryFail:
        async def call_with_tools(self, *, model_override=None, **_kw):
            assert model_override is not None
            return ToolUseError(
                kind=ToolErrorKind.UNKNOWN,
                message="primary failed",
                retriable=False,
                provider="gemini",
                model="stub",
            )

    class _FallbackNoModelOverride:
        async def call_with_tools(self, *, system_prompt, user_message, tools, history=None, user_id=None):
            return ToolCallResult(
                tool_name="respond_text",
                arguments={"content": "ok"},
                provider="ollama",
                model="stub",
            )

    router = AIRouter()
    router._providers = {
        "gemini": _PrimaryFail(),
        "ollama": _FallbackNoModelOverride(),
    }

    out = await router.call_with_tools(
        system_prompt="sys",
        user_message="hi",
        tools=[ToolSchema(name="respond_text", description="", parameters={})],
    )

    assert isinstance(out, ToolCallResult)
    assert out.provider == "ollama"
