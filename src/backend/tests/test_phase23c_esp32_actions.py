"""Phase 23-C — esp32.servo_aim + esp32.buzzer_alert agent actions.

Covers:
* servo_aim happy path (helper called with right deltas)
* servo_aim zero-zero short-circuit
* servo_aim serial disconnected → ok=False
* servo_aim hold_ms actually awaits asyncio.sleep
* servo_aim helper raises → ok=False with error_class
* buzzer_alert each named pattern emits the expected number of calls
* buzzer_alert repeat multiplies the call count
* buzzer_alert serial disconnected on first call → no further calls
* registry exposes both with the right risk labels
"""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock

import pytest

from agent.actions.base import ActionContext
from agent.actions.esp32_aim import ESP32BuzzerAlert, ESP32ServoAim


def _ctx() -> ActionContext:
    return ActionContext(
        task_id="t-23c", step_idx=0, workspace_dir="/tmp", runtime=None,
    )


# -----------------------------------------------------------------------------
# servo_aim
# -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_servo_aim_happy_path(monkeypatch: pytest.MonkeyPatch) -> None:
    from sensors import command_sender as cs

    fake_servo = AsyncMock(return_value=True)
    monkeypatch.setattr(cs.command_sender, "servo", fake_servo, raising=False)

    result = await ESP32ServoAim(pan_delta=15, tilt_delta=-10).execute(_ctx())

    assert result.ok is True
    assert result.output == {"pan_delta": 15, "tilt_delta": -10, "hold_ms": 0}
    fake_servo.assert_awaited_once_with(15, -10)
    assert any("pan+15° tilt-10°" in s for s in result.side_effects)


@pytest.mark.asyncio
async def test_servo_aim_zero_delta_short_circuits(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from sensors import command_sender as cs

    fake_servo = AsyncMock(return_value=True)
    monkeypatch.setattr(cs.command_sender, "servo", fake_servo, raising=False)

    result = await ESP32ServoAim(pan_delta=0, tilt_delta=0).execute(_ctx())

    assert result.ok is False
    assert result.output is not None
    assert result.output.get("reason") == "no_delta"
    fake_servo.assert_not_awaited()


@pytest.mark.asyncio
async def test_servo_aim_serial_disconnected(monkeypatch: pytest.MonkeyPatch) -> None:
    from sensors import command_sender as cs

    fake_servo = AsyncMock(return_value=False)
    monkeypatch.setattr(cs.command_sender, "servo", fake_servo, raising=False)

    result = await ESP32ServoAim(pan_delta=10).execute(_ctx())

    assert result.ok is False
    assert result.error_class == "SerialDisconnected"
    assert result.output is not None
    assert result.output.get("reason") == "serial_disconnected"


@pytest.mark.asyncio
async def test_servo_aim_hold_ms_awaits_sleep(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from sensors import command_sender as cs
    from agent.actions import esp32_aim

    fake_servo = AsyncMock(return_value=True)
    monkeypatch.setattr(cs.command_sender, "servo", fake_servo, raising=False)

    seen_sleeps: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        seen_sleeps.append(seconds)

    monkeypatch.setattr(esp32_aim.asyncio, "sleep", fake_sleep)

    result = await ESP32ServoAim(pan_delta=5, hold_ms=250).execute(_ctx())

    assert result.ok is True
    assert seen_sleeps == [pytest.approx(0.25)]


@pytest.mark.asyncio
async def test_servo_aim_helper_raises_returns_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from sensors import command_sender as cs

    async def boom(*args, **kwargs):
        raise RuntimeError("serial port locked")

    monkeypatch.setattr(cs.command_sender, "servo", boom, raising=False)

    result = await ESP32ServoAim(pan_delta=10).execute(_ctx())

    assert result.ok is False
    assert result.error_class == "RuntimeError"
    assert "serial port locked" in (result.error or "")


# -----------------------------------------------------------------------------
# buzzer_alert
# -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_buzzer_alert_chirp_single_call(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from sensors import command_sender as cs
    from agent.actions import esp32_aim

    fake_buzzer = AsyncMock(return_value=True)
    monkeypatch.setattr(cs.command_sender, "buzzer", fake_buzzer, raising=False)

    async def fake_sleep(_seconds: float) -> None:
        return None

    monkeypatch.setattr(esp32_aim.asyncio, "sleep", fake_sleep)

    result = await ESP32BuzzerAlert(pattern="chirp", freq_hz=1500).execute(_ctx())

    assert result.ok is True
    assert fake_buzzer.await_count == 1
    fake_buzzer.assert_awaited_with(freq_hz=1500, duration_ms=120)
    assert result.output is not None
    assert result.output["pattern"] == "chirp"
    assert result.output["freq_hz"] == 1500


@pytest.mark.asyncio
async def test_buzzer_alert_pattern_call_counts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Each named pattern should emit the expected number of buzzer calls."""
    from sensors import command_sender as cs
    from agent.actions import esp32_aim

    expected_counts = {"chirp": 1, "ack": 2, "alert": 3, "siren": 3}

    async def fake_sleep(_seconds: float) -> None:
        return None

    monkeypatch.setattr(esp32_aim.asyncio, "sleep", fake_sleep)

    for pattern, expected_calls in expected_counts.items():
        fake_buzzer = AsyncMock(return_value=True)
        monkeypatch.setattr(
            cs.command_sender, "buzzer", fake_buzzer, raising=False,
        )
        result = await ESP32BuzzerAlert(pattern=pattern).execute(_ctx())  # type: ignore[arg-type]
        assert result.ok is True, f"{pattern} should succeed"
        assert fake_buzzer.await_count == expected_calls, (
            f"pattern={pattern} expected {expected_calls} calls, "
            f"got {fake_buzzer.await_count}"
        )


@pytest.mark.asyncio
async def test_buzzer_alert_siren_uses_swept_freqs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Siren must override freq_hz with its own 800→1200→800 sweep."""
    from sensors import command_sender as cs
    from agent.actions import esp32_aim

    fake_buzzer = AsyncMock(return_value=True)
    monkeypatch.setattr(cs.command_sender, "buzzer", fake_buzzer, raising=False)

    async def fake_sleep(_seconds: float) -> None:
        return None

    monkeypatch.setattr(esp32_aim.asyncio, "sleep", fake_sleep)

    # Caller sets freq_hz=999 — siren should ignore it.
    result = await ESP32BuzzerAlert(pattern="siren", freq_hz=999).execute(_ctx())

    assert result.ok is True
    awaited_freqs = [
        call.kwargs["freq_hz"] for call in fake_buzzer.await_args_list
    ]
    assert awaited_freqs == [800, 1200, 800]


@pytest.mark.asyncio
async def test_buzzer_alert_repeat_multiplies(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from sensors import command_sender as cs
    from agent.actions import esp32_aim

    fake_buzzer = AsyncMock(return_value=True)
    monkeypatch.setattr(cs.command_sender, "buzzer", fake_buzzer, raising=False)

    async def fake_sleep(_seconds: float) -> None:
        return None

    monkeypatch.setattr(esp32_aim.asyncio, "sleep", fake_sleep)

    # ack = 2 calls per repeat, repeat=3 → 6 total
    result = await ESP32BuzzerAlert(pattern="ack", repeat=3).execute(_ctx())

    assert result.ok is True
    assert fake_buzzer.await_count == 6
    assert result.output is not None
    assert result.output["repeat"] == 3


@pytest.mark.asyncio
async def test_buzzer_alert_serial_disconnect_aborts_early(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """First buzzer call returns False → no further calls should run."""
    from sensors import command_sender as cs
    from agent.actions import esp32_aim

    fake_buzzer = AsyncMock(return_value=False)
    monkeypatch.setattr(cs.command_sender, "buzzer", fake_buzzer, raising=False)

    async def fake_sleep(_seconds: float) -> None:
        return None

    monkeypatch.setattr(esp32_aim.asyncio, "sleep", fake_sleep)

    # alert = 3 calls per repeat, but first one fails → stop after 1
    result = await ESP32BuzzerAlert(pattern="alert", repeat=2).execute(_ctx())

    assert result.ok is False
    assert result.error_class == "SerialDisconnected"
    assert fake_buzzer.await_count == 1


# -----------------------------------------------------------------------------
# Registry
# -----------------------------------------------------------------------------


def test_registry_exposes_phase_23c_actions() -> None:
    from agent.actions.registry import registry

    names = registry.names()
    assert "esp32.servo_aim" in names
    assert "esp32.buzzer_alert" in names

    catalog = {item["name"]: item for item in registry.catalog()}
    assert catalog["esp32.servo_aim"]["risk_label"] == "SAFE"
    assert catalog["esp32.buzzer_alert"]["risk_label"] == "LOW"
    # Servo args
    assert "pan_delta" in catalog["esp32.servo_aim"]["args"]
    assert "tilt_delta" in catalog["esp32.servo_aim"]["args"]
    assert "hold_ms" in catalog["esp32.servo_aim"]["args"]
    # Buzzer args
    assert "pattern" in catalog["esp32.buzzer_alert"]["args"]
    assert "freq_hz" in catalog["esp32.buzzer_alert"]["args"]
    assert "repeat" in catalog["esp32.buzzer_alert"]["args"]
