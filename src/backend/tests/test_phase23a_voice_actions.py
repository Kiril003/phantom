"""Phase 23-A — voice.say + voice.listen agent actions.

Covers:
* config gating (voice_tts_enabled / voice_mode == off)
* state-machine quietness contract (GHOST/SHADOW silent unless force=True)
* TTS synthesis path → WS broadcast → ActionResult shape
* voice.listen subscribes to event_bus, accepts the next 'final' event,
  rejects events below min_confidence and outside require_substring,
  and unsubscribes cleanly on timeout.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass

import pytest

from agent.actions.base import ActionContext
from agent.actions.voice_listen import VoiceListen
from agent.actions.voice_say import VoiceSay


# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------


@dataclass
class _FakeTTSResult:
    audio_wav: bytes = b"RIFF\x00\x00\x00\x00WAVE"
    engine: str = "fake"
    voice: str = "uk_UA"
    sample_rate: int = 22_050


def _ctx() -> ActionContext:
    return ActionContext(
        task_id="t-23a", step_idx=0, workspace_dir="/tmp", runtime=None,
    )


# -----------------------------------------------------------------------------
# voice.say — config + state gates
# -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_voice_say_skips_when_tts_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    from config import config as cfg
    monkeypatch.setattr(cfg, "voice_tts_enabled", False)

    result = await VoiceSay(text="привіт").execute(_ctx())

    assert result.ok is False
    assert result.output is not None
    assert result.output.get("reason") == "voice_tts_disabled"


@pytest.mark.asyncio
async def test_voice_say_silent_in_ghost_state(monkeypatch: pytest.MonkeyPatch) -> None:
    from config import config as cfg
    from core.state_machine import state_machine
    monkeypatch.setattr(cfg, "voice_tts_enabled", True)
    monkeypatch.setattr(state_machine, "_current", "GHOST", raising=False)

    result = await VoiceSay(text="привіт").execute(_ctx())

    assert result.ok is False
    assert result.output is not None
    assert result.output.get("reason") == "silent_state"
    assert result.output.get("state") == "GHOST"


@pytest.mark.asyncio
async def test_voice_say_force_overrides_silent_state(monkeypatch: pytest.MonkeyPatch) -> None:
    from config import config as cfg
    from core.state_machine import state_machine
    monkeypatch.setattr(cfg, "voice_tts_enabled", True)
    monkeypatch.setattr(state_machine, "_current", "GHOST", raising=False)

    # Stub TTS so we don't actually load a model.
    from voice import pipeline
    async def fake_synth(text: str, voice: str, speed: float):
        return _FakeTTSResult()
    monkeypatch.setattr(pipeline, "synthesize_text", fake_synth)

    # Capture broadcast.
    captured: list[dict] = []
    from api import websocket_hub
    async def fake_broadcast(channel, type_, data, user_id=None):
        captured.append({"channel": channel, "type": type_, "data": data})
    monkeypatch.setattr(websocket_hub.hub, "broadcast", fake_broadcast)

    result = await VoiceSay(text="urgent", force=True).execute(_ctx())

    assert result.ok is True
    assert len(captured) == 1
    assert captured[0]["type"] == "voice_say"
    assert captured[0]["data"]["text"] == "urgent"
    assert captured[0]["data"]["audio_b64"]  # base64 wav present


@pytest.mark.asyncio
async def test_voice_say_emits_in_focus_state(monkeypatch: pytest.MonkeyPatch) -> None:
    """SHADOW/GHOST silent — but FOCUS / DIALOGUE / SENTINEL must speak."""
    from config import config as cfg
    from core.state_machine import state_machine
    monkeypatch.setattr(cfg, "voice_tts_enabled", True)
    monkeypatch.setattr(state_machine, "_current", "FOCUS", raising=False)

    from voice import pipeline
    async def fake_synth(text: str, voice: str, speed: float):
        return _FakeTTSResult()
    monkeypatch.setattr(pipeline, "synthesize_text", fake_synth)

    from api import websocket_hub
    captured: list[dict] = []
    async def fake_broadcast(channel, type_, data, user_id=None):
        captured.append(data)
    monkeypatch.setattr(websocket_hub.hub, "broadcast", fake_broadcast)

    result = await VoiceSay(text="готово").execute(_ctx())

    assert result.ok is True
    assert result.output is not None
    assert result.output["delivered_via"] == "ws"
    assert captured and captured[0]["text"] == "готово"


@pytest.mark.asyncio
async def test_voice_say_synthesis_failure_returns_not_ok(monkeypatch: pytest.MonkeyPatch) -> None:
    from config import config as cfg
    from core.state_machine import state_machine
    monkeypatch.setattr(cfg, "voice_tts_enabled", True)
    monkeypatch.setattr(state_machine, "_current", "FOCUS", raising=False)

    from voice import pipeline
    async def boom(text: str, voice: str, speed: float):
        raise RuntimeError("piper model missing")
    monkeypatch.setattr(pipeline, "synthesize_text", boom)

    result = await VoiceSay(text="тест").execute(_ctx())

    assert result.ok is False
    assert result.output is not None
    assert result.output.get("reason") == "tts_failed"


# -----------------------------------------------------------------------------
# voice.listen — bus subscription + filters + cleanup
# -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_voice_listen_returns_next_final(monkeypatch: pytest.MonkeyPatch) -> None:
    from config import config as cfg
    monkeypatch.setattr(cfg, "voice_mode", "continuous")

    from core.event_bus import event_bus

    async def emit_after_delay() -> None:
        await asyncio.sleep(0.05)
        event_bus.emit(
            "voice.event",
            {"type": "final", "transcript": "увімкни світло", "confidence": 0.92},
        )

    emit_task = asyncio.create_task(emit_after_delay())
    result = await VoiceListen(timeout_s=2.0).execute(_ctx())
    await emit_task

    assert result.ok is True
    assert result.output is not None
    assert result.output["transcript"] == "увімкни світло"
    assert result.output["confidence"] == pytest.approx(0.92)
    # Subscription is torn down — no handlers left bound.
    assert all(
        h.__name__ != "_on_voice_event"
        for h in event_bus._handlers.get("voice.event", [])
    )


@pytest.mark.asyncio
async def test_voice_listen_filters_low_confidence(monkeypatch: pytest.MonkeyPatch) -> None:
    from config import config as cfg
    monkeypatch.setattr(cfg, "voice_mode", "continuous")
    from core.event_bus import event_bus

    async def emit_two() -> None:
        await asyncio.sleep(0.02)
        # Below threshold — must be ignored.
        event_bus.emit(
            "voice.event",
            {"type": "final", "transcript": "noise", "confidence": 0.1},
        )
        await asyncio.sleep(0.02)
        event_bus.emit(
            "voice.event",
            {"type": "final", "transcript": "real query", "confidence": 0.85},
        )

    task = asyncio.create_task(emit_two())
    result = await VoiceListen(timeout_s=2.0, min_confidence=0.5).execute(_ctx())
    await task

    assert result.ok is True
    assert result.output is not None
    assert result.output["transcript"] == "real query"


@pytest.mark.asyncio
async def test_voice_listen_substring_gate(monkeypatch: pytest.MonkeyPatch) -> None:
    from config import config as cfg
    monkeypatch.setattr(cfg, "voice_mode", "continuous")
    from core.event_bus import event_bus

    async def emit_two() -> None:
        await asyncio.sleep(0.02)
        event_bus.emit(
            "voice.event",
            {"type": "final", "transcript": "погода завтра", "confidence": 0.9},
        )
        await asyncio.sleep(0.02)
        event_bus.emit(
            "voice.event",
            {"type": "final", "transcript": "запали світло", "confidence": 0.9},
        )

    task = asyncio.create_task(emit_two())
    result = await VoiceListen(
        timeout_s=2.0, require_substring="світло"
    ).execute(_ctx())
    await task

    assert result.ok is True
    assert result.output is not None
    assert "світло" in result.output["transcript"]


@pytest.mark.asyncio
async def test_voice_listen_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    from config import config as cfg
    monkeypatch.setattr(cfg, "voice_mode", "continuous")

    result = await VoiceListen(timeout_s=0.2).execute(_ctx())

    assert result.ok is False
    assert result.output is not None
    assert result.output.get("reason") == "timeout"
    assert result.output.get("timeout_s") == pytest.approx(0.2)


@pytest.mark.asyncio
async def test_voice_listen_voice_mode_off(monkeypatch: pytest.MonkeyPatch) -> None:
    from config import config as cfg
    monkeypatch.setattr(cfg, "voice_mode", "off")

    result = await VoiceListen(timeout_s=0.5).execute(_ctx())

    assert result.ok is False
    assert result.output is not None
    assert result.output.get("reason") == "voice_mode_off"


# -----------------------------------------------------------------------------
# Registry — both actions wired
# -----------------------------------------------------------------------------


def test_registry_exposes_voice_actions() -> None:
    from agent.actions.registry import registry

    names = registry.names()
    assert "voice.say" in names
    assert "voice.listen" in names

    # Catalog should expose them with proper risk labels.
    catalog = {item["name"]: item for item in registry.catalog()}
    assert catalog["voice.say"]["risk_label"] == "LOW"
    assert catalog["voice.listen"]["risk_label"] == "SAFE"
