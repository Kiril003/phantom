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


def _capture_speech(monkeypatch, *, boom: bool = False) -> list[dict]:
    """Проактивна мова їде тим самим шляхом, що й відповідь у чаті —
    `voice/incremental_tts.py`. Ловимо саме те, що йде в ефір."""
    captured: list[dict] = []

    async def fake_synth(text: str, voice: str, speed: float):
        if boom:
            raise RuntimeError("piper model missing")
        return _FakeTTSResult()

    async def fake_broadcast(user_id, type_, payload):
        captured.append({"channel": "chat", "type": type_, "data": payload})

    from voice import incremental_tts, pipeline
    monkeypatch.setattr(pipeline, "synthesize_text", fake_synth)
    monkeypatch.setattr(pipeline, "voice_for_text", lambda _t: "uk_UA")
    monkeypatch.setattr(incremental_tts, "_broadcast", fake_broadcast)
    return captured


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

    captured = _capture_speech(monkeypatch)

    result = await VoiceSay(text="urgent", force=True).execute(_ctx())

    assert result.ok is True
    # Канал `chat` — єдиний, у якого є програвач (services/ttsPlayer.ts).
    # Стара подія `agent.stream`/`voice_say` не мала жодного споживача.
    assert [c["channel"] for c in captured] == ["chat"] * 3
    sentences = [c for c in captured if c["type"] == "tts.sentence"]
    assert len(sentences) == 1
    assert sentences[0]["data"]["text"] == "urgent"
    assert sentences[0]["data"]["audio_b64"]  # base64 wav present


@pytest.mark.asyncio
async def test_voice_say_emits_in_focus_state(monkeypatch: pytest.MonkeyPatch) -> None:
    """SHADOW/GHOST silent — but FOCUS / DIALOGUE / SENTINEL must speak."""
    from config import config as cfg
    from core.state_machine import state_machine
    monkeypatch.setattr(cfg, "voice_tts_enabled", True)
    monkeypatch.setattr(state_machine, "_current", "FOCUS", raising=False)

    captured = _capture_speech(monkeypatch)

    result = await VoiceSay(text="готово").execute(_ctx())

    assert result.ok is True
    assert result.output is not None
    assert result.output["delivered_via"] == "chat_tts"
    assert result.output["sentences_spoken"] == 1
    sentences = [c for c in captured if c["type"] == "tts.sentence"]
    assert sentences and sentences[0]["data"]["text"] == "готово"


@pytest.mark.asyncio
async def test_voice_say_synthesis_failure_returns_not_ok(monkeypatch: pytest.MonkeyPatch) -> None:
    from config import config as cfg
    from core.state_machine import state_machine
    monkeypatch.setattr(cfg, "voice_tts_enabled", True)
    monkeypatch.setattr(state_machine, "_current", "FOCUS", raising=False)

    captured = _capture_speech(monkeypatch, boom=True)

    result = await VoiceSay(text="тест").execute(_ctx())

    # Заявити «сказав» можна лише за тим, що пішло в ефір, — а не пішло нічого.
    assert result.ok is False
    assert result.output is not None
    assert result.output["sentences_spoken"] == 0
    assert result.side_effects == []
    assert [c for c in captured if c["type"] == "tts.sentence"] == []


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
