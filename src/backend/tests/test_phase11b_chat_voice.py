"""
Phase 11b — chat input_method="voice" integration.

Covers the surgical additions to routes_chat.py:
  * SendMessageRequest schema validates input_method and voice_source.
  * User-message metadata carries voice_source / voice_confidence when
    the input is voice.
  * Response payload flips auto_tts=True for voice-originated turns
    (gated by config.voice_tts_enabled so the user can still disable
    TTS even in always-on mode).

We don't spin up the full backend app here — a ValidationError at the
schema layer is the contract. A ``test_e2e_voice_message`` integration
test would be great but routes_chat depends on ChromaDB, the context
engine, the geo bridge, and more — that level of integration is
covered by live verification in the acceptance doc, not by a unit
test.
"""
from __future__ import annotations

import os

import pytest
from pydantic import ValidationError

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase11b-chat")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-api-key-for-tests")

from api.routes_chat import SendMessageRequest  # noqa: E402


class TestInputMethodValidation:
    def test_text_default(self) -> None:
        req = SendMessageRequest(content="hi")
        assert req.input_method == "text"
        assert req.voice_source is None
        assert req.voice_confidence is None

    def test_voice_accepted(self) -> None:
        req = SendMessageRequest(
            content="який час",
            input_method="voice",
            voice_source="wake",
            voice_confidence=0.82,
        )
        assert req.input_method == "voice"
        assert req.voice_source == "wake"
        assert req.voice_confidence == pytest.approx(0.82)

    def test_encoder_accepted(self) -> None:
        req = SendMessageRequest(content="up", input_method="encoder")
        assert req.input_method == "encoder"

    def test_invalid_input_method_rejected(self) -> None:
        with pytest.raises(ValidationError) as info:
            SendMessageRequest(content="hi", input_method="brain")
        assert "input_method" in str(info.value)

    def test_invalid_voice_source_rejected(self) -> None:
        with pytest.raises(ValidationError) as info:
            SendMessageRequest(
                content="hi", input_method="voice", voice_source="dream"
            )
        assert "voice_source" in str(info.value)

    def test_voice_source_continuation_accepted(self) -> None:
        req = SendMessageRequest(
            content="додай ще",
            input_method="voice",
            voice_source="continuation",
        )
        assert req.voice_source == "continuation"

    def test_voice_without_voice_source_allowed(self) -> None:
        """A caller that forgets voice_source still gets a valid request;
        defaults to None. Storage layer handles the missing metadata."""
        req = SendMessageRequest(content="test", input_method="voice")
        assert req.voice_source is None


class TestAutoTTSFlagConstants:
    """The auto_tts decision lives inline in send_message. Verify the
    module-level constants the validator depends on — integration of
    the flag is covered by the live acceptance test."""

    def test_allowed_input_methods_constant(self) -> None:
        from api import routes_chat as rc

        assert "text" in rc._ALLOWED_INPUT_METHODS
        assert "voice" in rc._ALLOWED_INPUT_METHODS
        assert "encoder" in rc._ALLOWED_INPUT_METHODS

    def test_allowed_voice_sources_constant(self) -> None:
        from api import routes_chat as rc

        assert "wake" in rc._ALLOWED_VOICE_SOURCES
        assert "continuation" in rc._ALLOWED_VOICE_SOURCES
