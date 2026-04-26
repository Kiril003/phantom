"""
Phase 11b — /ws/voice WebSocket contract tests.

We don't reach for the full auth/login flow here. Instead we
monkeypatch ``security.jwt_manager.verify_token`` so the WS handler
sees any token as valid, and we inject a fake orchestrator so VAD and
Vosk never actually load in-process.

What this file covers:
  * Connection rejected without a token.
  * Connection rejected with an invalid token.
  * Connection accepted with a valid token and emits a ``ready``
    event on open.
  * Binary frames are forwarded to orchestrator.process_frame when
    always-on is enabled.
  * Binary frames are silently dropped when always-on is disabled.
  * JSON commands (reset, mic_duck, mic_unduck, set_confidence, stop,
    unknown) are dispatched.
  * Orchestrator events emitted via the bound callback land on the
    WebSocket as JSON.
"""
from __future__ import annotations

import os
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase11b")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-api-key-for-tests")


# ──────────────────── fixtures ────────────────────


@pytest.fixture
def fake_orchestrator(monkeypatch):
    """Patch api.routes_voice_stream._build_orchestrator so we never
    touch Silero ONNX or Vosk during the WS test."""
    from api import routes_voice_stream

    orch = AsyncMock(name="orchestrator")
    orch.is_ducked = False
    orch.state = "idle"
    # is_ducked / state are attributes — keep as non-async properties.
    orch._emit = None
    orch.process_frame = AsyncMock()
    orch.mic_duck = AsyncMock()
    orch.mic_unduck = AsyncMock()
    orch.reset = AsyncMock()
    # WakeSpotter stub for set_confidence rebuild path.
    wake = MagicMock()
    wake._model = MagicMock(name="vosk_model")
    wake.wake_tokens = ("фантом",)
    orch._wake = wake

    def _builder():
        return orch

    monkeypatch.setattr(routes_voice_stream, "_build_orchestrator", _builder)
    yield orch


@pytest.fixture
def valid_token(monkeypatch):
    """Make verify_token accept any non-empty string and return a user."""
    from security import jwt_manager

    payload = MagicMock(user_id="test-user-11b")
    monkeypatch.setattr(jwt_manager, "verify_token", lambda token: payload)
    yield "any-token"


@pytest.fixture
def always_on_enabled(monkeypatch):
    """Phase 12.0 — voice_mode replaces voice_always_on_enabled. Setting
    mode to 'continuous' enables the binary-frame path the same way the
    legacy True flag did pre-12.0."""
    from config import config

    monkeypatch.setattr(config, "voice_mode", "continuous", raising=False)
    monkeypatch.setattr(config, "voice_always_on_enabled", True, raising=False)


@pytest.fixture
def always_on_disabled(monkeypatch):
    from config import config

    monkeypatch.setattr(config, "voice_mode", "off", raising=False)
    monkeypatch.setattr(config, "voice_always_on_enabled", False, raising=False)


@pytest.fixture
def voice_ws_app(fake_orchestrator):
    """Minimal FastAPI app with only the voice WS endpoint registered —
    avoids spinning up the rest of PHANTOM for each test."""
    from api.routes_voice_stream import register_voice_ws

    app = FastAPI()
    register_voice_ws(app)
    return app


# ──────────────────── connection auth ────────────────────


class TestVoiceWSAuth:
    def test_no_token_closes_connection(self, voice_ws_app) -> None:
        client = TestClient(voice_ws_app)
        with pytest.raises(Exception):
            with client.websocket_connect("/ws/voice"):
                pass  # server should close before any message

    def test_invalid_token_closes_connection(
        self, voice_ws_app, monkeypatch
    ) -> None:
        from security import jwt_manager

        def _bad(token):
            raise ValueError("bad token")

        monkeypatch.setattr(jwt_manager, "verify_token", _bad)
        client = TestClient(voice_ws_app)
        with pytest.raises(Exception):
            with client.websocket_connect("/ws/voice?token=whatever"):
                pass

    def test_valid_token_accepts_and_emits_ready(
        self, voice_ws_app, valid_token, always_on_enabled
    ) -> None:
        client = TestClient(voice_ws_app)
        with client.websocket_connect(f"/ws/voice?token={valid_token}") as ws:
            msg = ws.receive_json()
            assert msg["type"] == "ready"
            assert msg["sample_rate"] == 16_000
            assert msg["frame_size_recommended"] == 960
            assert msg["enabled"] is True
            # Wake words and thresholds surfaced so the frontend can
            # show the operator what's live.
            assert "wake_words" in msg
            assert "confidence_min" in msg
            assert "continuation_window_s" in msg


# ──────────────────── binary frame path ────────────────────


class TestBinaryFrames:
    def test_frame_forwarded_when_always_on_enabled(
        self, voice_ws_app, valid_token, always_on_enabled, fake_orchestrator
    ) -> None:
        client = TestClient(voice_ws_app)
        with client.websocket_connect(f"/ws/voice?token={valid_token}") as ws:
            ws.receive_json()  # consume ready
            frame = b"\x00\x01" * 480
            ws.send_bytes(frame)
            # Let the server process
            ws.send_text('{"cmd": "reset"}')
            ack = ws.receive_json()
            assert ack["type"] == "reset_ack"
        # process_frame was awaited once with the frame
        assert fake_orchestrator.process_frame.await_count >= 1
        first_call = fake_orchestrator.process_frame.await_args_list[0]
        assert first_call.args[0] == frame

    def test_frame_dropped_when_always_on_disabled(
        self, voice_ws_app, valid_token, always_on_disabled, fake_orchestrator
    ) -> None:
        client = TestClient(voice_ws_app)
        with client.websocket_connect(f"/ws/voice?token={valid_token}") as ws:
            ws.receive_json()  # ready (enabled=False)
            ws.send_bytes(b"\x00\x01" * 480)
            ws.send_text('{"cmd": "reset"}')
            ws.receive_json()  # reset_ack
        # Frame was silently dropped
        assert fake_orchestrator.process_frame.await_count == 0


# ──────────────────── JSON commands ────────────────────


class TestCommands:
    def _connect(self, app, token):
        client = TestClient(app)
        conn = client.websocket_connect(f"/ws/voice?token={token}")
        return conn

    def test_mic_duck_and_unduck(
        self, voice_ws_app, valid_token, always_on_enabled, fake_orchestrator
    ) -> None:
        with self._connect(voice_ws_app, valid_token) as ws:
            ws.receive_json()
            ws.send_text('{"cmd": "mic_duck"}')
            m1 = ws.receive_json()
            assert m1["type"] == "mic_duck_ack"
            ws.send_text('{"cmd": "mic_unduck"}')
            m2 = ws.receive_json()
            assert m2["type"] == "mic_duck_ack"
        fake_orchestrator.mic_duck.assert_awaited()
        fake_orchestrator.mic_unduck.assert_awaited()

    def test_reset_ack(
        self, voice_ws_app, valid_token, always_on_enabled, fake_orchestrator
    ) -> None:
        with self._connect(voice_ws_app, valid_token) as ws:
            ws.receive_json()
            ws.send_text('{"cmd": "reset"}')
            ack = ws.receive_json()
        assert ack["type"] == "reset_ack"
        fake_orchestrator.reset.assert_awaited()

    def test_set_confidence_valid(
        self, voice_ws_app, valid_token, always_on_enabled,
        fake_orchestrator, monkeypatch,
    ) -> None:
        # We need WakeSpotter to be constructable — patch its ctor so
        # it doesn't touch vosk.
        from api import routes_voice_stream as r

        fake_spotter = MagicMock(
            _model=MagicMock(), wake_tokens=("фантом",),
        )
        monkeypatch.setattr(
            r, "WakeSpotter", lambda *a, **kw: fake_spotter
        )
        with self._connect(voice_ws_app, valid_token) as ws:
            ws.receive_json()
            ws.send_text('{"cmd": "set_confidence", "value": 0.75}')
            m = ws.receive_json()
        assert m["type"] == "config"
        assert m["confidence_min"] == pytest.approx(0.75)

    def test_set_confidence_invalid_value(
        self, voice_ws_app, valid_token, always_on_enabled, fake_orchestrator
    ) -> None:
        with self._connect(voice_ws_app, valid_token) as ws:
            ws.receive_json()
            ws.send_text('{"cmd": "set_confidence", "value": "huh"}')
            err = ws.receive_json()
        assert err["type"] == "error"
        assert "float" in err["message"]

    def test_set_confidence_out_of_range(
        self, voice_ws_app, valid_token, always_on_enabled, fake_orchestrator
    ) -> None:
        with self._connect(voice_ws_app, valid_token) as ws:
            ws.receive_json()
            ws.send_text('{"cmd": "set_confidence", "value": 2.0}')
            err = ws.receive_json()
        assert err["type"] == "error"
        assert "range" in err["message"] or "0.0" in err["message"]

    def test_unknown_cmd_emits_error(
        self, voice_ws_app, valid_token, always_on_enabled, fake_orchestrator
    ) -> None:
        with self._connect(voice_ws_app, valid_token) as ws:
            ws.receive_json()
            ws.send_text('{"cmd": "dance"}')
            err = ws.receive_json()
        assert err["type"] == "error"
        assert "unknown" in err["message"].lower()

    def test_invalid_json_emits_error(
        self, voice_ws_app, valid_token, always_on_enabled, fake_orchestrator
    ) -> None:
        with self._connect(voice_ws_app, valid_token) as ws:
            ws.receive_json()
            ws.send_text("not-json{{{")
            err = ws.receive_json()
        assert err["type"] == "error"
        assert "invalid json" in err["message"].lower()

    def test_missing_cmd_emits_error(
        self, voice_ws_app, valid_token, always_on_enabled, fake_orchestrator
    ) -> None:
        with self._connect(voice_ws_app, valid_token) as ws:
            ws.receive_json()
            ws.send_text('{"nope": 1}')
            err = ws.receive_json()
        assert err["type"] == "error"
        assert "cmd" in err["message"].lower()


# ──────────────────── orchestrator → WS event fanout ────────────────────


class TestEventFanout:
    def test_orchestrator_emit_lands_on_ws(
        self, voice_ws_app, valid_token, always_on_enabled, fake_orchestrator
    ) -> None:
        """After ready, call orchestrator._emit (bound by the handler)
        and verify the JSON lands on the socket."""
        client = TestClient(voice_ws_app)
        with client.websocket_connect(f"/ws/voice?token={valid_token}") as ws:
            ws.receive_json()  # ready
            # Fire a binary frame so the server spins through one
            # receive iteration; that's when the callback binding is
            # definitely active.
            ws.send_bytes(b"\x00" * 320)
            # Now invoke the emit callback that the WS handler bound.
            import asyncio
            emit = fake_orchestrator._emit
            assert emit is not None, "handler didn't bind event callback"
            # emit is an async function that sends over the live ws;
            # TestClient.websocket_connect uses its own loop — use
            # asyncio.get_event_loop() in the application thread.
            # Simpler: have the fake's process_frame trigger the emit
            # before returning.
            # We do that via monkeypatching after the fact:
            async def _emit_wake(frame):
                await emit({
                    "type": "wake",
                    "transcript": "фантом",
                    "confidence": 0.8,
                })
            fake_orchestrator.process_frame.side_effect = _emit_wake
            ws.send_bytes(b"\x00" * 320)
            event = ws.receive_json()
            assert event["type"] == "wake"
            assert event["transcript"] == "фантом"
            assert event["confidence"] == pytest.approx(0.8)
