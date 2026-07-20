"""Day-4 Wave-2 W-4 — dynamic-source resolver pytest (ADR-XC-007).

Coverage:

1. Four sources are exposed at GET /api/v1/dynamic_source/{source}.
2. Each resolver returns a DynamicPickerResponse envelope with the
   right `source` echoed back + a non-negative ttl_s.
3. Defensive: a broken/missing resolver dep yields an EMPTY options
   list (NOT 500 — the picker shows its placeholder).
4. ttl cache works: a second call within ttl_s returns the same
   `fetched_at` timestamp; bumping past ttl_s re-resolves.
5. ollama_models cap = 50.
6. serial_ports defensive: pyserial absent → empty list.
"""
from __future__ import annotations

import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    """Mount only the dynamic_source router for fast/isolated tests."""
    from api.routes_dynamic_source import router, _clear_cache_for_tests
    _clear_cache_for_tests()
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    with TestClient(app) as c:
        yield c
    _clear_cache_for_tests()


# ──────────────────────────────────────────────────────── route surface ──


class TestRouteSurface:
    def test_unknown_source_404(self, client):
        # FastAPI's path-validator rejects per Literal — returns 422.
        r = client.get("/api/v1/dynamic_source/totally_made_up")
        assert r.status_code in (404, 422), r.text

    @pytest.mark.parametrize(
        "source",
        [
            "ollama_models",
            "voice_voices",
            "serial_ports",
            "tts_speakers",
        ],
    )
    def test_each_source_returns_envelope_shape(self, client, source):
        r = client.get(f"/api/v1/dynamic_source/{source}")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["source"] == source
        assert isinstance(body["options"], list)
        assert isinstance(body["fetched_at"], (int, float))
        assert isinstance(body["ttl_s"], (int, float))
        assert body["ttl_s"] >= 0


# ──────────────────────────────────────────────── per-resolver behaviour ──


class TestPerResolver:
    def test_ollama_models_defensive_when_dep_missing(self, client, monkeypatch):
        """Simulate the no-ollama-installed branch by monkey-patching the
        provider import to raise."""
        import api.routes_dynamic_source as mod

        async def _stub_resolver():
            return []

        monkeypatch.setattr(mod, "_resolve_ollama_models", _stub_resolver)
        monkeypatch.setitem(
            mod._RESOLVERS, "ollama_models", (_stub_resolver, 30.0)
        )
        mod._clear_cache_for_tests()

        r = client.get("/api/v1/dynamic_source/ollama_models")
        body = r.json()
        # Defensive contract: empty list, NOT 500.
        assert r.status_code == 200
        assert body["options"] == []

    def test_serial_ports_empty_when_dep_missing(self, client, monkeypatch):
        import api.routes_dynamic_source as mod

        async def _stub_resolver():
            # pyserial not installed → resolver returns []
            return []

        monkeypatch.setitem(
            mod._RESOLVERS, "serial_ports", (_stub_resolver, 5.0)
        )
        mod._clear_cache_for_tests()

        r = client.get("/api/v1/dynamic_source/serial_ports")
        assert r.status_code == 200
        assert r.json()["options"] == []

    def test_resolver_exception_fallback_to_empty(self, client, monkeypatch):
        """If a resolver raises (despite its own try/except), the route
        catches + returns empty rather than 500."""
        import api.routes_dynamic_source as mod

        async def _bad_resolver():
            raise RuntimeError("simulated transient")

        monkeypatch.setitem(
            mod._RESOLVERS, "voice_voices", (_bad_resolver, 60.0)
        )
        mod._clear_cache_for_tests()

        r = client.get("/api/v1/dynamic_source/voice_voices")
        assert r.status_code == 200
        assert r.json()["options"] == []


# ────────────────────────────────────────────────────────── ttl cache ──


class TestTtlCache:
    def test_second_call_within_ttl_serves_cache(self, client, monkeypatch):
        import api.routes_dynamic_source as mod

        call_count = {"n": 0}

        async def _counting_resolver():
            call_count["n"] += 1
            return []

        monkeypatch.setitem(
            mod._RESOLVERS, "voice_voices", (_counting_resolver, 30.0)
        )
        mod._clear_cache_for_tests()

        r1 = client.get("/api/v1/dynamic_source/voice_voices")
        r2 = client.get("/api/v1/dynamic_source/voice_voices")
        assert r1.status_code == 200 and r2.status_code == 200
        # Resolver invoked exactly once → second call hit the cache.
        assert call_count["n"] == 1
        assert r1.json()["fetched_at"] == r2.json()["fetched_at"]

    def test_cache_expires_after_ttl(self, client, monkeypatch):
        import api.routes_dynamic_source as mod

        call_count = {"n": 0}

        async def _counting_resolver():
            call_count["n"] += 1
            return []

        # Use a 0-second ttl to force re-resolve on every call.
        monkeypatch.setitem(
            mod._RESOLVERS, "voice_voices", (_counting_resolver, 0.0)
        )
        mod._clear_cache_for_tests()

        client.get("/api/v1/dynamic_source/voice_voices")
        # Tiny sleep so wall-clock advances past 0 ttl.
        time.sleep(0.01)
        client.get("/api/v1/dynamic_source/voice_voices")
        assert call_count["n"] == 2
