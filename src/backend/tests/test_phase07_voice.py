"""
Phase 07 — Voice pipeline tests.

Covers:
  * Audio decoding + 16 kHz resample (`decode_to_mono16k`).
  * Wake-word helper respects config.voice_wake_word_enabled / voice_wake_words.
  * Provider factories honour voice_stt_mode and voice_tts_enabled.
  * /voice/stt + /voice/tts routes with injected mock providers.
  * /voice/status surfaces the active engine names.

All tests are mock-based — they do NOT load a real Vosk / Piper model
so they run on a CI machine without voice_models/ on disk.
"""
from __future__ import annotations

import io
import os
import wave
from unittest.mock import patch

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase07")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-api-key-for-tests")

from config import config  # noqa: E402
from voice import pipeline as voice_pipeline  # noqa: E402
from voice.stt_engine import (  # noqa: E402
    NoopSTTProvider,
    STTProvider,
    STTResult,
    TARGET_SAMPLE_RATE,
    build_stt_provider,
    contains_wake_word,
    decode_to_mono16k,
    to_pcm16_bytes,
)
from voice.tts_engine import (  # noqa: E402
    SilentTTSProvider,
    TTSProvider,
    TTSResult,
    build_tts_provider,
)


# ── Helpers ───────────────────────────────────────────────────────────────────


def _sine_wav(sample_rate: int, duration_s: float = 0.5, freq: float = 440.0) -> bytes:
    """Synthesize a tiny sine-wave WAV for decoder tests."""
    t = np.linspace(0, duration_s, int(sample_rate * duration_s), endpoint=False, dtype=np.float32)
    wave_f = (0.3 * np.sin(2 * np.pi * freq * t)).astype(np.float32)
    buf = io.BytesIO()
    sf.write(buf, wave_f, sample_rate, format="WAV", subtype="PCM_16")
    return buf.getvalue()


class _MockSTT(STTProvider):
    name = "mock"

    def __init__(self, text: str = "привіт фантом", language: str = "uk") -> None:
        self.text = text
        self.language = language
        self.calls: list[tuple[int, str]] = []

    async def transcribe(self, audio, language):
        self.calls.append((len(audio), language))
        return STTResult(
            text=self.text,
            confidence=0.95,
            engine="mock",
            language=self.language,
        )


class _MockTTS(TTSProvider):
    name = "mock"

    def __init__(self) -> None:
        self.calls: list[tuple[str, str, float]] = []

    async def synthesize(self, text, voice, speed):
        self.calls.append((text, voice, speed))
        # Produce a valid 100 ms silent WAV so the response is a legal audio blob.
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(22_050)
            w.writeframes(b"\x00\x00" * 2_205)
        return TTSResult(
            audio_wav=buf.getvalue(),
            sample_rate=22_050,
            engine="mock",
            voice=voice,
        )


@pytest.fixture(autouse=True)
def _reset_providers():
    """Every test starts with no cached providers so factory tests are independent."""
    voice_pipeline.reset_providers()
    yield
    voice_pipeline.reset_providers()


@pytest.fixture
def client():
    from main import app
    with TestClient(app) as c:
        yield c


# ═══════════════════════════════════════════════════════════════════════════════
# Audio utilities
# ═══════════════════════════════════════════════════════════════════════════════


class TestAudioDecoding:

    def test_decode_16k_wav_preserves_samples(self):
        blob = _sine_wav(TARGET_SAMPLE_RATE, duration_s=0.5)
        audio = decode_to_mono16k(blob)
        assert audio.dtype == np.float32
        assert len(audio) == int(TARGET_SAMPLE_RATE * 0.5)
        # Sine wave should have energy
        assert float(np.abs(audio).mean()) > 0.01

    def test_decode_44k_wav_resamples_to_16k(self):
        blob = _sine_wav(44_100, duration_s=0.5)
        audio = decode_to_mono16k(blob)
        # ±2 samples slack around exact 8 000 — linear resampler rounds.
        assert abs(len(audio) - int(TARGET_SAMPLE_RATE * 0.5)) <= 2

    def test_decode_stereo_downmixes_to_mono(self):
        sr = TARGET_SAMPLE_RATE
        t = np.linspace(0, 0.3, int(sr * 0.3), endpoint=False, dtype=np.float32)
        stereo = np.stack([np.sin(2 * np.pi * 440 * t), np.sin(2 * np.pi * 880 * t)], axis=1)
        buf = io.BytesIO()
        sf.write(buf, stereo, sr, format="WAV", subtype="PCM_16")
        audio = decode_to_mono16k(buf.getvalue())
        assert audio.ndim == 1

    def test_decode_empty_raises(self):
        with pytest.raises(ValueError):
            decode_to_mono16k(b"")

    def test_decode_garbage_raises(self):
        with pytest.raises(ValueError):
            decode_to_mono16k(b"not actually an audio file " * 20)

    def test_to_pcm16_bytes_clips(self):
        # Values outside [-1, 1] should be clipped, not overflow-wrap.
        audio = np.array([1.5, -1.5, 0.0, 0.5], dtype=np.float32)
        pcm = to_pcm16_bytes(audio)
        assert len(pcm) == 8  # 4 samples × 2 bytes
        # int16 values at max positive / max negative then 0 then ~half.
        int_view = np.frombuffer(pcm, dtype="<i2")
        assert int_view[0] == 32_767
        assert int_view[1] == -32_767
        assert int_view[2] == 0


# ═══════════════════════════════════════════════════════════════════════════════
# Wake word
# ═══════════════════════════════════════════════════════════════════════════════


class TestWakeWord:

    def test_disabled_by_default_returns_false(self):
        config.voice_wake_word_enabled = False
        assert contains_wake_word("Фантом, що там?") is False

    def test_enabled_and_matches(self):
        config.voice_wake_word_enabled = True
        config.voice_wake_words = "фантом"
        assert contains_wake_word("Фантом, що там?") is True

    def test_enabled_no_match_returns_false(self):
        config.voice_wake_word_enabled = True
        config.voice_wake_words = "фантом"
        assert contains_wake_word("Просто балачка") is False

    def test_multiple_wake_words_comma_separated(self):
        config.voice_wake_word_enabled = True
        config.voice_wake_words = "phantom, привіт друг"
        assert contains_wake_word("Ну привіт друг, як ти?") is True

    def test_empty_wake_words_returns_false(self):
        config.voice_wake_word_enabled = True
        config.voice_wake_words = ""
        assert contains_wake_word("anything") is False


# ═══════════════════════════════════════════════════════════════════════════════
# Provider factories
# ═══════════════════════════════════════════════════════════════════════════════


class TestProviderFactories:

    def test_stt_falls_back_to_noop_when_nothing_loads(self):
        # Force both providers to fail → factory should return NoopSTTProvider.
        with patch("voice.stt_engine._try_whisper", return_value=None), \
             patch("voice.stt_engine._try_vosk", return_value=None):
            provider = build_stt_provider()
            assert isinstance(provider, NoopSTTProvider)

    def test_stt_mode_vosk_skips_whisper(self):
        config.voice_stt_mode = "vosk"
        with patch("voice.stt_engine._try_whisper") as whisper_mock, \
             patch("voice.stt_engine._try_vosk", return_value=None):
            build_stt_provider()
            whisper_mock.assert_not_called()  # vosk-only must not probe whisper

    def test_tts_disabled_returns_silent(self):
        config.voice_tts_enabled = False
        provider = build_tts_provider()
        assert isinstance(provider, SilentTTSProvider)

    def test_tts_enabled_tries_piper_then_falls_back(self):
        config.voice_tts_enabled = True
        # Force Piper construction to fail so the factory must fall back.
        with patch(
            "voice.tts_engine.PiperTTSProvider",
            side_effect=RuntimeError("piper model missing"),
        ):
            provider = build_tts_provider()
            assert isinstance(provider, SilentTTSProvider)

    @pytest.mark.asyncio
    async def test_silent_tts_produces_valid_wav(self):
        provider = SilentTTSProvider()
        result = await provider.synthesize("hello", "voice-x", 1.0)
        # WAV must decode cleanly with libsndfile.
        data, sr = sf.read(io.BytesIO(result.audio_wav))
        assert sr == 22_050
        assert data.ndim == 1

    @pytest.mark.asyncio
    async def test_noop_stt_returns_empty_transcript(self):
        provider = NoopSTTProvider()
        audio = np.zeros(1600, dtype=np.float32)
        result = await provider.transcribe(audio, "uk")
        assert result.text == ""
        assert result.engine == "noop"


# ═══════════════════════════════════════════════════════════════════════════════
# Routes
# ═══════════════════════════════════════════════════════════════════════════════


class TestVoiceRoutes:

    def test_stt_round_trip_with_mock_provider(self, client):
        mock = _MockSTT(text="тест транскрипт")
        voice_pipeline._stt = mock  # inject

        wav = _sine_wav(TARGET_SAMPLE_RATE)
        res = client.post(
            "/api/v1/voice/stt",
            files={"file": ("clip.wav", wav, "audio/wav")},
        )
        assert res.status_code == 200, res.text
        data = res.json()
        assert data["text"] == "тест транскрипт"
        assert data["engine"] == "mock"
        assert data["confidence"] == 0.95
        assert "wake_word_matched" in data
        # Provider saw the decoded audio.
        assert len(mock.calls) == 1

    def test_stt_rejects_empty_payload(self, client):
        voice_pipeline._stt = _MockSTT()
        res = client.post(
            "/api/v1/voice/stt",
            files={"file": ("empty.wav", b"", "audio/wav")},
        )
        assert res.status_code == 400

    def test_stt_rejects_undecodable_blob(self, client):
        voice_pipeline._stt = _MockSTT()
        res = client.post(
            "/api/v1/voice/stt",
            files={"file": ("garbage.wav", b"not-a-wav" * 100, "audio/wav")},
        )
        assert res.status_code == 400

    def test_stt_wake_word_flag_reflects_config(self, client):
        voice_pipeline._stt = _MockSTT(text="фантом, покажи погоду")
        config.voice_wake_word_enabled = True
        config.voice_wake_words = "фантом"
        wav = _sine_wav(TARGET_SAMPLE_RATE)
        res = client.post(
            "/api/v1/voice/stt",
            files={"file": ("clip.wav", wav, "audio/wav")},
        )
        assert res.status_code == 200
        assert res.json()["wake_word_matched"] is True

    def test_tts_returns_audio_wav(self, client):
        mock = _MockTTS()
        voice_pipeline._tts = mock

        res = client.post(
            "/api/v1/voice/tts",
            json={"text": "привіт", "voice": "some-voice", "speed": 1.0},
        )
        assert res.status_code == 200, res.text
        assert res.headers["content-type"].startswith("audio/wav")
        assert res.headers.get("x-engine") == "mock"
        # Body must be a valid WAV.
        data, sr = sf.read(io.BytesIO(res.content))
        assert sr == 22_050
        # Mock was invoked with what we sent.
        assert mock.calls[0][0] == "привіт"
        assert mock.calls[0][1] == "some-voice"

    def test_tts_falls_back_to_config_voice_when_empty(self, client):
        mock = _MockTTS()
        voice_pipeline._tts = mock
        config.voice_tts_voice = "configured-voice"
        # Phase 9.2 introduced language-aware auto-selection. Disable it so
        # this test continues to validate the legacy fallback contract.
        prev_auto = config.voice_tts_auto_language
        config.voice_tts_auto_language = False
        try:
            res = client.post(
                "/api/v1/voice/tts",
                json={"text": "hi", "voice": "", "speed": 1.0},
            )
            assert res.status_code == 200
            assert mock.calls[0][1] == "configured-voice"
        finally:
            config.voice_tts_auto_language = prev_auto

    def test_tts_rejects_empty_text(self, client):
        voice_pipeline._tts = _MockTTS()
        res = client.post("/api/v1/voice/tts", json={"text": "", "voice": "x", "speed": 1.0})
        assert res.status_code == 422  # pydantic min_length=1

    def test_status_endpoint_reports_active_engines(self, client):
        voice_pipeline._stt = _MockSTT()
        voice_pipeline._tts = _MockTTS()
        res = client.get("/api/v1/voice/status")
        assert res.status_code == 200
        data = res.json()
        assert data["stt_engine"] == "mock"
        assert data["tts_engine"] == "mock"
        assert "tts_enabled" in data


# ═══════════════════════════════════════════════════════════════════════════════
# Settings integration
# ═══════════════════════════════════════════════════════════════════════════════


class TestVoiceSettingsIntegration:

    def test_voice_keys_not_in_unimplemented_when_wired(self):
        """Guardrail: activated voice keys must NOT carry the [soon] tag."""
        from api.routes_settings import UNIMPLEMENTED_KEYS
        activated = {
            "voice_stt_mode",
            "voice_stt_language",
            "voice_tts_enabled",
            "voice_tts_voice",
            "voice_tts_speed",
        }
        assert activated.isdisjoint(UNIMPLEMENTED_KEYS), (
            f"keys still marked [soon]: {activated & UNIMPLEMENTED_KEYS}"
        )

    def test_voice_settings_put_resets_pipeline_cache(self, client, tmp_path):
        """An *invalidating* voice_* PUT must drop the cached provider.

        Phase 12.0 (commit 00fc745) narrowed reset_providers() to keys
        that genuinely change the loaded model. Runtime params like
        voice_tts_speed must NOT trash the singleton — that defeats the
        startup preload (Bug 2 in phase-11c.5/known-issues.md). This
        test pins both halves of the contract.
        """
        # Authenticate.
        r = client.post(
            "/api/v1/auth/login/pin",
            json={"username": "phantom", "pin": "000000"},
        )
        assert r.status_code == 200, r.text
        token = r.json()["token"]

        # Half A — runtime-only key (voice_tts_speed) MUST NOT reset cache.
        voice_pipeline._stt = _MockSTT()
        voice_pipeline._tts = _MockTTS()
        r = client.put(
            "/api/v1/settings/voice_tts_speed",
            headers={"Authorization": f"Bearer {token}"},
            json={"value": 1.2},
        )
        assert r.status_code == 200, r.text
        assert voice_pipeline._stt is not None, (
            "voice_tts_speed is a runtime-only key — must not invalidate "
            "the singleton (see Phase 12.0 invalidating_keys allow-list)"
        )
        assert voice_pipeline._tts is not None

        # Half B — invalidating key (voice_stt_language) MUST reset.
        r = client.put(
            "/api/v1/settings/voice_stt_language",
            headers={"Authorization": f"Bearer {token}"},
            json={"value": "uk"},
        )
        assert r.status_code == 200, r.text
        assert voice_pipeline._stt is None, (
            "voice_stt_language is in the invalidating allow-list and must "
            "drop the cached STT provider"
        )
        assert voice_pipeline._tts is None

        # Clean up persisted overrides.
        from db import settings_repo
        import asyncio as _asyncio
        _asyncio.get_event_loop().run_until_complete(
            settings_repo.delete(["voice_tts_speed", "voice_stt_language"])
        )
