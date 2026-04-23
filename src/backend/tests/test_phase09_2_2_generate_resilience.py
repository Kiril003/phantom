"""
Phase 9.2.2 — F-02 generate()/generate_stream() resilience.

Verifies the previously-broken generate path now applies the same cooling /
quota / backoff policy as call_with_tools. Also covers the Ollama error
classifier and BlockedQuotaError propagation.
"""
from __future__ import annotations

import os
import tempfile

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase09-2-2-gen")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-api-key-for-tests")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


@pytest_asyncio.fixture
async def isolated_db(monkeypatch):
    import db.database as _dbm
    import db.models as _dm  # noqa: F401
    import importlib
    if not _dbm.Base.metadata.tables:
        importlib.reload(_dm)
    fd, tmp_file = tempfile.mkstemp(suffix=".db", prefix="phantom_p922g_")
    os.close(fd)
    url = f"sqlite+aiosqlite:///{tmp_file}"
    engine = create_async_engine(url, echo=False, connect_args={"check_same_thread": False})
    async with engine.begin() as conn:
        await conn.run_sync(_dbm.Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(_dbm, "engine", engine)
    monkeypatch.setattr(_dbm, "AsyncSessionLocal", factory)
    yield factory
    await engine.dispose()
    try:
        os.unlink(tmp_file)
    except OSError:
        pass


class _ScriptedGenerateProvider:
    """Provider that emits a scripted sequence of (response | exception) for `generate()`."""

    def __init__(self, sequence):
        self._seq = list(sequence)
        self.calls = 0

    async def generate(self, user_message, system_prompt, history, *, user_id=None, **_ignored):
        from ai.provider import AIResponse
        self.calls += 1
        if not self._seq:
            return AIResponse(content="ok", provider="stub")
        out = self._seq.pop(0)
        if isinstance(out, BaseException):
            raise out
        return out

    async def generate_stream(self, user_message, system_prompt, history, **_ignored):
        # Not used by the generate() tests but required by the interface.
        yield "ok"

    async def health_check(self):
        return True


def _ok(content="ok", provider="gemini"):
    from ai.provider import AIResponse
    return AIResponse(content=content, provider=provider)


def _gemini_quota():
    return Exception(
        "429 RESOURCE_EXHAUSTED. Quota exceeded for metric: "
        "generate_content_free_tier_requests, limit: 20."
    )


def _gemini_429(retry_delay_s=8):
    return Exception(
        f"429 RESOURCE_EXHAUSTED. Please retry. retry_delay {{ seconds: {retry_delay_s} }}"
    )


def _gemini_500():
    return Exception(" 500 INTERNAL")


def _wire(router, primary, fallback):
    router._providers["gemini"] = primary
    if fallback is not None:
        router._providers["ollama"] = fallback


# ═════════════════════════════════════════════════════════════════════════════
# 1. RATE_LIMIT — backoff + retry on the SAME provider
# ═════════════════════════════════════════════════════════════════════════════


class TestGenerateRateLimit:
    @pytest.mark.asyncio
    async def test_generate_rate_limit_backs_off_and_retries(self, isolated_db, monkeypatch):
        from ai import provider as _pm
        from ai.provider import AIRouter

        monkeypatch.setattr(_pm.config, "ai_primary_provider", "gemini")
        monkeypatch.setattr(_pm.config, "ai_fallback_provider", "none")
        monkeypatch.setattr(_pm.config, "ai_call_min_interval_ms", 0)

        sleeps: list[float] = []

        async def fake_sleep(s):
            sleeps.append(s)

        monkeypatch.setattr(_pm.asyncio, "sleep", fake_sleep)

        primary = _ScriptedGenerateProvider([
            _gemini_429(retry_delay_s=2),
            _gemini_429(retry_delay_s=2),
            _ok(),
        ])
        r = AIRouter()
        _wire(r, primary, None)
        result = await r.generate("hi", "sys", [])
        assert result.content == "ok"
        assert primary.calls == 3
        # First sleep should honour retry_delay (=2.0).
        assert sleeps and sleeps[0] == 2.0


# ═════════════════════════════════════════════════════════════════════════════
# 2. QUOTA_EXHAUSTED — primary marked, immediate fallback to ollama
# ═════════════════════════════════════════════════════════════════════════════


class TestGenerateQuotaExhausted:
    @pytest.mark.asyncio
    async def test_quota_falls_through_and_marks_primary(self, isolated_db, monkeypatch):
        from ai import provider as _pm
        from ai.provider import AIRouter

        monkeypatch.setattr(_pm.config, "ai_primary_provider", "gemini")
        monkeypatch.setattr(_pm.config, "ai_fallback_provider", "ollama")
        monkeypatch.setattr(_pm.config, "ai_call_min_interval_ms", 0)
        async def _np(_): pass
        monkeypatch.setattr(_pm.asyncio, "sleep", _np)

        primary = _ScriptedGenerateProvider([_gemini_quota()])
        fallback = _ScriptedGenerateProvider([_ok(content="from-ollama", provider="ollama")])
        r = AIRouter()
        _wire(r, primary, fallback)

        result = await r.generate("hi", "sys", [])
        assert result.content == "from-ollama"
        assert primary.calls == 1, "no rate-limit retries on QUOTA_EXHAUSTED"
        assert "gemini" in r._quota_exhausted
        assert fallback.calls == 1

    @pytest.mark.asyncio
    async def test_both_quota_raises_blocked_quota_error(self, isolated_db, monkeypatch):
        from ai import provider as _pm
        from ai.provider import AIRouter, BlockedQuotaError

        monkeypatch.setattr(_pm.config, "ai_primary_provider", "gemini")
        monkeypatch.setattr(_pm.config, "ai_fallback_provider", "ollama")
        monkeypatch.setattr(_pm.config, "ai_call_min_interval_ms", 0)
        async def _np(_): pass
        monkeypatch.setattr(_pm.asyncio, "sleep", _np)

        primary = _ScriptedGenerateProvider([_gemini_quota()])
        # Ollama-side error that classifies as RATE_LIMIT (429); we manually
        # mark ollama quota_exhausted before calling to simulate "both blocked".
        fallback = _ScriptedGenerateProvider([_ok()])
        r = AIRouter()
        _wire(r, primary, fallback)
        # Pre-mark fallback as quota-exhausted.
        r._quota_exhausted["ollama"] = {"until_utc": "2099-01-01T00:00:00+00:00"}

        with pytest.raises(BlockedQuotaError):
            await r.generate("hi", "sys", [])


# ═════════════════════════════════════════════════════════════════════════════
# 3. PROVIDER_UNAVAILABLE — single retry then fallback
# ═════════════════════════════════════════════════════════════════════════════


class TestGenerateProviderUnavailable:
    @pytest.mark.asyncio
    async def test_500_retries_once_then_falls_through(self, isolated_db, monkeypatch):
        from ai import provider as _pm
        from ai.provider import AIRouter

        monkeypatch.setattr(_pm.config, "ai_primary_provider", "gemini")
        monkeypatch.setattr(_pm.config, "ai_fallback_provider", "ollama")
        monkeypatch.setattr(_pm.config, "ai_call_min_interval_ms", 0)
        async def _np(_): pass
        monkeypatch.setattr(_pm.asyncio, "sleep", _np)

        primary = _ScriptedGenerateProvider([_gemini_500(), _gemini_500()])
        fallback = _ScriptedGenerateProvider([_ok(content="fb", provider="ollama")])
        r = AIRouter()
        _wire(r, primary, fallback)

        result = await r.generate("hi", "sys", [])
        assert result.content == "fb"
        # Primary tried twice (initial + 1 transient retry), then fallback.
        assert primary.calls == 2
        assert "gemini" in r._cooling


# ═════════════════════════════════════════════════════════════════════════════
# 4. Ollama error classification
# ═════════════════════════════════════════════════════════════════════════════


class TestOllamaErrorClassification:
    def test_connection_refused_is_provider_unavailable(self):
        from ai.ollama_provider import _classify_ollama_error
        from ai.tool_use import ToolErrorKind

        kind, retriable, _ = _classify_ollama_error(
            ConnectionError("All connection attempts failed")
        )
        assert kind == ToolErrorKind.PROVIDER_UNAVAILABLE
        assert retriable is True

    def test_timeout_is_timeout(self):
        import asyncio as _a
        from ai.ollama_provider import _classify_ollama_error
        from ai.tool_use import ToolErrorKind
        kind, retriable, _ = _classify_ollama_error(_a.TimeoutError("read timed out"))
        assert kind == ToolErrorKind.TIMEOUT
        assert retriable is True

    def test_429_is_rate_limit_not_quota(self):
        """Ollama 429 = paid gateway in front; transient, not until-midnight."""
        from ai.ollama_provider import _classify_ollama_error
        from ai.tool_use import ToolErrorKind
        kind, retriable, _ = _classify_ollama_error(Exception("429 rate limit hit"))
        assert kind == ToolErrorKind.RATE_LIMIT
        assert retriable is True


# ═════════════════════════════════════════════════════════════════════════════
# 5. Strategic raises BlockedQuotaError when both quota-exhausted
# ═════════════════════════════════════════════════════════════════════════════


class TestStrategicQuotaPropagation:
    @pytest.mark.asyncio
    async def test_strategic_propagates_blocked_quota_via_llm_json(self, isolated_db, monkeypatch):
        from agent.planner import _llm
        from ai.provider import BlockedQuotaError

        async def _raise(prompt, *, task_id=None):
            raise BlockedQuotaError("both quota-exhausted")

        monkeypatch.setattr(_llm, "_call", _raise)
        with pytest.raises(BlockedQuotaError):
            await _llm.llm_json("any prompt", task_id="t1")


# ═════════════════════════════════════════════════════════════════════════════
# 6. Missing task_id logs warning
# ═════════════════════════════════════════════════════════════════════════════


class TestGenerateBudgetWarning:
    @pytest.mark.asyncio
    async def test_generate_without_task_id_logs_warning(self, isolated_db, monkeypatch, caplog):
        import logging as _lg
        from ai import provider as _pm
        from ai.provider import AIRouter

        monkeypatch.setattr(_pm.config, "ai_primary_provider", "gemini")
        monkeypatch.setattr(_pm.config, "ai_fallback_provider", "none")
        monkeypatch.setattr(_pm.config, "ai_call_min_interval_ms", 0)
        monkeypatch.setattr(_pm.config, "agent_require_task_id_for_budget", True)
        async def _np(_): pass
        monkeypatch.setattr(_pm.asyncio, "sleep", _np)

        primary = _ScriptedGenerateProvider([_ok()])
        r = AIRouter()
        _wire(r, primary, None)

        with caplog.at_level(_lg.WARNING, logger="ai.provider"):
            await r.generate("hi", "sys", [])
        assert any("without task_id" in rec.message for rec in caplog.records), (
            f"expected warning about missing task_id; got: {[r.message for r in caplog.records]}"
        )
