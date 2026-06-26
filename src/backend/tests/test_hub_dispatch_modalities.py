from __future__ import annotations

import pytest
from unittest.mock import MagicMock, patch, AsyncMock

from ai.hub import AIHub, ProviderCapability, NoCapabilityError
from db.database import get_session
from db.models import User
from voice.stt_engine import STTResult
from voice.tts_engine import TTSResult
from observability import ai_hub_dispatch_total, ai_hub_route_decision_total


@pytest.fixture
def clean_hub():
    h = AIHub()
    h.reset_for_tests()
    return h


@pytest.mark.asyncio
async def test_dispatch_embeddings(clean_hub):
    clean_hub.register(
        ProviderCapability(
            provider="test-embeddings",
            task_class="embeddings",
            modality="text",
            latency_ms_p50=10.0,
            quality_tier="balanced",
            locality="local",
            available=True,
        )
    )

    fake_ef = MagicMock()
    fake_ef.return_value = [[0.1, 0.2, 0.3]]

    with patch("memory.strategic_memory._get_ef", return_value=fake_ef):
        # 1. Single string input
        res = await clean_hub.dispatch("embeddings", {"input": "hello"})
        assert res == [0.1, 0.2, 0.3]
        fake_ef.assert_called_with(["hello"])

        # 2. Batch list input
        res_batch = await clean_hub.dispatch("embeddings", {"input": ["hello", "world"]})
        assert res_batch == [[0.1, 0.2, 0.3]]
        fake_ef.assert_called_with(["hello", "world"])


@pytest.mark.asyncio
async def test_dispatch_voice_stt(clean_hub):
    clean_hub.register(
        ProviderCapability(
            provider="test-stt",
            task_class="voice_stt",
            modality="audio",
            latency_ms_p50=15.0,
            quality_tier="high",
            locality="local",
            available=True,
        )
    )

    fake_stt_result = STTResult(
        text="привіт фантом",
        confidence=0.95,
        engine="whisper",
        language="uk",
    )

    # 1. Dispatch with audio_bytes
    with patch("voice.pipeline.transcribe_blob", return_value=fake_stt_result) as mock_transcribe:
        res = await clean_hub.dispatch("voice_stt", {"audio_bytes": b"fake-wav-data", "language": "uk"})
        assert res["text"] == "привіт фантом"
        assert res["engine"] == "whisper"
        mock_transcribe.assert_called_once_with(b"fake-wav-data", "uk")

    # 2. Dispatch with raw audio array
    import numpy as np
    fake_audio = np.zeros(16000, dtype=np.float32)
    fake_provider = MagicMock()
    fake_provider.transcribe = AsyncMock(return_value=fake_stt_result)

    with patch("voice.pipeline.get_stt_provider", return_value=fake_provider):
        res_raw = await clean_hub.dispatch("voice_stt", {"audio": fake_audio})
        assert res_raw["text"] == "привіт фантом"
        fake_provider.transcribe.assert_called_once_with(fake_audio, "auto")


@pytest.mark.asyncio
async def test_dispatch_voice_tts(clean_hub):
    clean_hub.register(
        ProviderCapability(
            provider="test-tts",
            task_class="voice_tts",
            modality="audio",
            latency_ms_p50=20.0,
            quality_tier="high",
            locality="local",
            available=True,
        )
    )

    fake_tts_result = TTSResult(
        audio_wav=b"fake-wav-response",
        sample_rate=22050,
        engine="piper",
        voice="uk-default",
    )

    with patch("voice.pipeline.synthesize_text", return_value=fake_tts_result) as mock_synth:
        res = await clean_hub.dispatch("voice_tts", {"text": "привіт", "voice": "uk-default", "speed": 1.1})
        assert res["engine"] == "piper"
        assert res["bytes"] == len(b"fake-wav-response")
        mock_synth.assert_called_once_with("привіт", "uk-default", 1.1)


@pytest.mark.asyncio
@pytest.mark.integration
async def test_dispatch_vision_enroll_and_recognize(clean_hub):
    clean_hub.register(
        ProviderCapability(
            provider="test-vision",
            task_class="vision",
            modality="image",
            latency_ms_p50=30.0,
            quality_tier="high",
            locality="local",
            available=True,
        )
    )

    import uuid
    from db.database import init_db
    await init_db()

    # Create a user
    user_id = str(uuid.uuid4())
    async with get_session() as db:
        user = User(
            id=user_id,
            username=f"vision_test_{user_id[:8]}",
            role="ROOT",
            preferences_json="{}",
        )
        db.add(user)
        await db.commit()

    # 1. Enroll face
    # We pass 8-dimensional dummy embeddings
    samples = [[0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]]
    enroll_payload = {
        "user_id": user_id,
        "samples": samples,
    }
    enroll_res = await clean_hub.dispatch("vision", enroll_payload)
    assert enroll_res["ok"] is True
    assert enroll_res["sample_count"] == 1
    assert enroll_res["dim"] == 8

    # 2. Recognize face
    recognize_payload = {
        "embedding": [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
        "threshold": 0.8,
    }
    recognize_res = await clean_hub.dispatch("vision", recognize_payload)
    assert recognize_res["matched"] is True
    assert recognize_res["user_id"] == user_id


@pytest.mark.asyncio
async def test_dispatch_fallback_chain(clean_hub):
    # Two providers registered: broken has lower latency but fails, working has higher latency but works
    clean_hub.register(
        ProviderCapability(
            provider="broken-provider",
            task_class="embeddings",
            modality="text",
            latency_ms_p50=10.0,
            quality_tier="balanced",
            locality="local",
            available=True,
        )
    )
    clean_hub.register(
        ProviderCapability(
            provider="working-provider",
            task_class="embeddings",
            modality="text",
            latency_ms_p50=20.0,
            quality_tier="balanced",
            locality="local",
            available=True,
        )
    )

    call_count = 0
    def fake_ef_side_effect(inputs):
        nonlocal call_count
        call_count += 1
        # Determine which provider is active. Since dispatch calls them in sequence,
        # we can fail on the first call and succeed on the second.
        if call_count == 1:
            raise RuntimeError("Broken provider error")
        return [[0.5, 0.6, 0.7]]

    fake_ef = MagicMock(side_effect=fake_ef_side_effect)

    with patch("memory.strategic_memory._get_ef", return_value=fake_ef):
        res = await clean_hub.dispatch("embeddings", {"input": "hello"})
        assert res == [0.5, 0.6, 0.7]
        # Verify both providers were attempted (2 calls total)
        assert call_count == 2
