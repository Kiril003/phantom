"""Operator-initiated interrupt for PHANTOM's own speech.

Finding 2 (adversarial design review): the only interruption for
PHANTOM's speech was `incremental_tts.stop_for_user()`, called from
exactly one place in the whole backend — as a side effect of the user
sending a NEW message (`api/routes_chat.py`). There was no explicit
"stop talking" the operator could reach without saying or typing
something else, and no frontend control at all.

`POST /api/v1/voice/stop` is that control. It goes through
`voice/speaking_floor.py` — the one registry every path that puts
PHANTOM's own voice on air joins the moment it starts talking. Both
call sites that start a `SentenceSpeaker` register there identically:

  * api/routes_chat.py:768  — every voice-mode conversational reply.
  * agent/actions/voice_say.py — the agent's proactive announcements.

Both create their speaker via `incremental_tts.start_speaker`, which
calls `SentenceSpeaker.start()` -> `speaking_floor.open(...)`. One
lever, both paths. Every assertion below reads the SPEAKER's own
`_cancelled` flag (or the registry's `is_speaking`) — ground truth,
not "some stop function was invoked".
"""
from __future__ import annotations

import asyncio

import pytest

from agent.actions.base import ActionContext
from agent.actions.voice_say import VoiceSay
from security.jwt_manager import create_token
from voice import incremental_tts, pipeline
from voice.speaking_floor import speaking_floor


def _token_for(user_id: str) -> str:
    token, _expires = create_token(user_id, f"user-{user_id}", "OPERATOR")
    return token


@pytest.fixture(scope="module")
def client():
    """No DB user needed — `require_auth` only verifies the JWT, it never
    looks the user up. A module-scoped app is safe here: every assertion
    below reads the module-level `speaking_floor` / `incremental_tts`
    registries directly, not app-instance state."""
    from fastapi.testclient import TestClient
    from main import create_app

    app = create_app()
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def _swallow_ws_broadcast(monkeypatch):
    """No real WS hub in tests — capture broadcasts instead of dropping
    them, so tests can assert `tts.stop` actually fired."""
    events: list[tuple[str, str, dict]] = []

    async def _fake_broadcast(user_id, type_, payload):
        events.append((user_id, type_, payload))

    monkeypatch.setattr(incremental_tts, "_broadcast", _fake_broadcast)
    return events


class TestStopEndpointCoversChatReplyCallSite:
    """Simulates `api/routes_chat.py:768` directly — that route starts a
    speaker with exactly this call; no DB/session plumbing is needed to
    prove the cancellation contract holds for it."""

    @pytest.mark.asyncio
    async def test_stop_cancels_the_active_speaker_mid_flight(self, client, _swallow_ws_broadcast):
        events = _swallow_ws_broadcast
        user_id = "u-chat-stop"
        speaker = await incremental_tts.start_speaker(user_id, "msg-1", "sess-1")
        assert speaker._cancelled is False
        assert speaking_floor.is_speaking(user_id) is True

        resp = client.post(
            "/api/v1/voice/stop",
            headers={"Authorization": f"Bearer {_token_for(user_id)}"},
        )

        assert resp.status_code == 200
        assert resp.json() == {"stopped": True}
        # Ground truth: the SPEAKER object is cancelled.
        assert speaker._cancelled is True
        assert speaking_floor.is_speaking(user_id) is False
        stops = [p for uid, t, p in events if t == "tts.stop" and uid == user_id]
        assert stops, "no tts.stop broadcast — the UI would keep playing"
        assert stops[0]["message_id"] == "msg-1"

    @pytest.mark.asyncio
    async def test_stop_is_a_no_op_when_nobody_is_speaking(self, client):
        resp = client.post(
            "/api/v1/voice/stop",
            headers={"Authorization": f"Bearer {_token_for('u-nothing-to-stop')}"},
        )
        assert resp.status_code == 200
        assert resp.json() == {"stopped": False}

    @pytest.mark.asyncio
    async def test_stop_scopes_to_the_calling_user_only(self, client):
        user_a, user_b = "u-scope-a", "u-scope-b"
        speaker_a = await incremental_tts.start_speaker(user_a, "m-a", "s")
        speaker_b = await incremental_tts.start_speaker(user_b, "m-b", "s")

        resp = client.post(
            "/api/v1/voice/stop",
            headers={"Authorization": f"Bearer {_token_for(user_a)}"},
        )

        assert resp.json() == {"stopped": True}
        assert speaker_a._cancelled is True
        assert speaker_b._cancelled is False
        assert speaking_floor.is_speaking(user_b) is True
        # cleanup so this speaker doesn't leak into other tests
        await incremental_tts.stop_for_user(user_b)


class TestStopEndpointCoversVoiceSayCallSite:
    """Runs the REAL `agent/actions/voice_say.py` action — the other
    call site of `incremental_tts.start_speaker` — and interrupts it
    mid-utterance through the same endpoint, proving one lever covers
    both origins."""

    @pytest.mark.asyncio
    async def test_stop_cancels_voice_say_mid_utterance(self, client, monkeypatch):
        user_id = "u-say-stop"
        release = asyncio.Event()

        async def _slow_synth(text, voice, speed):
            # Blocks until released — simulates synthesis still in
            # flight when the operator hits stop, so the test proves
            # an interrupt DURING speech, not after it already finished.
            await release.wait()
            from voice.tts_engine import TTSResult
            return TTSResult(audio_wav=b"RIFFxx", sample_rate=22050, engine="fake", voice=voice)

        monkeypatch.setattr(pipeline, "synthesize_text", _slow_synth)
        monkeypatch.setattr(pipeline, "voice_for_text", lambda _t: "uk_UA")

        ctx = ActionContext(
            task_id="t-voice-say-stop", step_idx=0, workspace_dir="/tmp",
            runtime=None, user_id=user_id,
        )
        task = asyncio.create_task(
            # force=True — the default state machine sits in SHADOW between
            # tests, which VoiceSay treats as a quietness gate unrelated to
            # what this test is proving (the stop control, not the gate).
            VoiceSay(
                text="Одне довге речення, яке ще не встигло договорити.",
                force=True,
            ).execute(ctx)
        )
        try:
            for _ in range(200):
                if speaking_floor.is_speaking(user_id):
                    break
                await asyncio.sleep(0.01)
            assert speaking_floor.is_speaking(user_id), "voice.say never registered its voice"

            speaker = incremental_tts._ACTIVE[user_id]
            assert speaker._cancelled is False

            resp = client.post(
                "/api/v1/voice/stop",
                headers={"Authorization": f"Bearer {_token_for(user_id)}"},
            )

            assert resp.json() == {"stopped": True}
            assert speaker._cancelled is True
            assert speaking_floor.is_speaking(user_id) is False
        finally:
            release.set()
            result = await asyncio.wait_for(task, timeout=5)

        # The action itself must see the interruption too — proves this
        # isn't just registry bookkeeping, the proactive speech genuinely
        # never finished.
        assert result.output is not None
        assert result.output.get("interrupted") is True
