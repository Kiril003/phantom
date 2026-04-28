"""Tier-A H-3 + H-4 regressions — Day-2 audit D2-A3 + D2-A4.

H-3 (D2-A3): NPU/MMS providers populate STTResult.engine_error on
inference failure. Day-1 wired the field but the route ignored it; the
silent-empty-transcript bug stayed observable. Day-2 surfaces the
failure as 503 + resets the wedged session so the next call rebuilds.

H-4 (D2-A4): FastAPI registers @app.middleware("http") in LIFO so the
LAST-registered middleware ends up OUTERMOST. Day-1 had correlation-id
registered first and counter second, inverting the documented invariant.
H-4 swaps the order so correlation-id is outermost again.
"""

from __future__ import annotations

import io

import pytest


# ── H-3 — engine_error → 503 + session reset ─────────────────────────────────


class _BoomSTT:
    """STT provider stub that always returns engine_error populated."""

    def __init__(self):
        self.calls = 0

    async def transcribe(self, audio, language):
        from voice.stt_engine import STTResult

        self.calls += 1
        return STTResult(
            text="",
            confidence=0.0,
            engine="whisper_npu",
            language=language,
            engine_error=f"whisper_npu_generate_failed: synthetic_call_{self.calls}",
        )


def _wav_bytes() -> bytes:
    # 0.1 s of silence at 16 kHz, mono — enough to satisfy the route's
    # decoder before the mock provider takes over.
    import wave
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16_000)
        w.writeframes(b"\x00\x00" * 1600)
    return buf.getvalue()


class TestH3EngineErrorRoute:
    def test_engine_error_returns_503(self, auth_root_client):
        from voice import pipeline as voice_pipeline
        boom = _BoomSTT()
        voice_pipeline._stt = boom
        try:
            res = auth_root_client.post(
                "/api/v1/voice/stt",
                files={"file": ("clip.wav", _wav_bytes(), "audio/wav")},
            )
        finally:
            voice_pipeline.reset_providers()

        assert res.status_code == 503, (
            f"D2-A3 regression: provider engine_error did not surface as 503; "
            f"got {res.status_code}"
        )
        body = res.json()
        assert "STT engine error" in body["detail"]
        assert "synthetic_call_1" in body["detail"]
        assert boom.calls == 1


class TestH3WhisperNpuSessionReset:
    def test_provider_resets_model_after_failure(self):
        from voice.whisper_npu_provider import WhisperNPUProvider

        prov = WhisperNPUProvider.__new__(WhisperNPUProvider)

        # Stand-in processor: callable + returns an object with the field
        # _transcribe_sync reads (`input_features`).
        class _FakeInputs:
            input_features = object()

        class _FakeProcessor:
            def __call__(self, *_a, **_kw):
                return _FakeInputs()

        class _BoomModel:
            def generate(self, *_a, **_kw):
                raise RuntimeError("HTP wedged synthetic")

        prov._processor = _FakeProcessor()
        prov._model = _BoomModel()
        prov._mode = "qnn-htp"
        # Make _ensure_model a no-op so the test doesn't try to load
        # real Whisper weights.
        prov._ensure_model = lambda: None  # type: ignore[assignment]

        import numpy as np
        result = prov._transcribe_sync(np.zeros(16_000, dtype=np.float32), "uk")

        assert result.engine_error is not None
        assert "whisper_npu_generate_failed" in result.engine_error
        # Provider must clear refs so _ensure_model rebuilds on next call.
        assert prov._model is None, (
            "D2-A3 regression: WhisperNPU did not reset _model after forward failure"
        )
        assert prov._processor is None


class TestH3MmsNpuSessionReset:
    @pytest.mark.asyncio
    async def test_provider_resets_session_after_failure(self):
        from voice.mms_npu_provider import MMSNPUProvider

        class _BoomSession:
            def get_inputs(self):
                class _I:
                    name = "x"
                return [_I()]

            def run(self, *_a, **_k):
                raise RuntimeError("HTP wedged synthetic")

        class _Tok:
            pad_token_id = 0

            def decode(self, *_a, **_k):
                return ""

        prov = MMSNPUProvider.__new__(MMSNPUProvider)
        prov._session = _BoomSession()
        prov._tokenizer = _Tok()
        prov._lang = "uk"
        prov._mode = "qnn-htp"
        prov._max_samples = 16_000 * 3

        import numpy as np
        result = prov._transcribe_sync(np.zeros(16_000, dtype=np.float32), "uk")
        assert result.engine_error is not None
        assert "mms_npu_forward_failed" in result.engine_error
        assert prov._session is None, (
            "D2-A3 regression: MMSNPU did not reset _session after forward failure"
        )


# ── H-4 — middleware order ────────────────────────────────────────────────────


class TestH4MiddlewareOrder:
    def test_correlation_id_wraps_counter(self):
        # FastAPI's user_middleware list is consulted in REVERSE for
        # incoming requests: a later entry wraps earlier entries.
        # Day-2 D2-A4 needs correlation_id_middleware to wrap
        # http_requests_counter_middleware (so the contextvar is set
        # before the counter increments). Other middlewares (e.g. the
        # B-2 security-headers handler) may be even more outer — that's
        # fine because they don't read the contextvar.
        from main import create_app
        from observability import correlation_id_middleware, http_requests_counter_middleware

        app = create_app()
        http_dispatchers = []
        for m in app.user_middleware:
            kwargs = getattr(m, "kwargs", {}) or {}
            dispatch = kwargs.get("dispatch")
            if dispatch is not None:
                http_dispatchers.append(dispatch)

        try:
            counter_idx = http_dispatchers.index(http_requests_counter_middleware)
            corr_idx = http_dispatchers.index(correlation_id_middleware)
        except ValueError as exc:
            pytest.fail(f"middleware not registered: {exc}")

        # Starlette's add_middleware uses `user_middleware.insert(0, ...)`
        # and then build_middleware_stack iterates `reversed(user_middleware)`,
        # so a LOWER index in user_middleware == registered later ==
        # OUTER wrapper. correlation_id must have a lower idx than the
        # counter for the contextvar to be set when the counter runs.
        assert corr_idx < counter_idx, (
            "D2-A4 regression: correlation_id middleware does NOT wrap "
            "http_requests_counter middleware. The contextvar is reset "
            "before the counter runs, so logged exceptions inside the "
            "counter middleware lose their correlation id. "
            f"(idx: corr={corr_idx} counter={counter_idx})"
        )

    def test_correlation_id_round_trip_still_works(self, unauth_client):
        # Smoke: even after the middleware swap, the correlation-id
        # contract holds — incoming header echoes, missing one is generated.
        res = unauth_client.get(
            "/healthz",
            headers={"X-Correlation-Id": "test-h4-12345"},
        )
        assert res.headers["X-Correlation-Id"] == "test-h4-12345"

    def test_counter_runs_inside_correlation_id(self, unauth_client):
        # Burn one request, then scrape /metrics. The http_requests_total
        # counter must have a row for /healthz — proves the counter
        # middleware ran on that request even though it's now innermost.
        unauth_client.get("/healthz")
        body = unauth_client.get("/metrics").text
        assert "phantom_http_requests_total" in body
        assert "/healthz" in body
