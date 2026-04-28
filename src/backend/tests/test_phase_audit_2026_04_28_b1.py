"""Block B-1 regression tests — audit 2026-04-28 quick wins.

Covers:
  F-04: ContextEngine publishes encoder/buttons fields so state_machine.
        _ghost_trigger can fire from a SensorBatch.
  F-05: ContextEngine starts with backdated last_interaction_ts so cold-boot
        idle guards trip immediately instead of waiting 999 s.
"""

from __future__ import annotations

import time

import pytest


def _make_batch(*, encoder=None, buttons=None):
    from sensors.sensor_parser import SensorBatch
    return SensorBatch(
        version=3,
        timestamp_ms=int(time.time() * 1000),
        type="sensor_batch",
        encoder=encoder,
        buttons=buttons,
    )


class TestF04EncoderButtonsPublished:
    """ContextEngine must surface encoder/buttons so GHOST trigger can read them."""

    def setup_method(self):
        from core.context_engine import ContextEngine
        self.engine = ContextEngine()

    def test_empty_snapshot_has_encoder_and_buttons_keys(self):
        snap = self.engine.get_snapshot()
        assert "encoder" in snap, "encoder key missing — GHOST trigger reads snap['encoder']"
        assert "buttons" in snap, "buttons key missing — GHOST trigger reads snap['buttons']"
        assert snap["encoder"] is None
        assert snap["buttons"] is None

    @pytest.mark.asyncio
    async def test_encoder_data_lifted_into_snapshot(self):
        from sensors.sensor_parser import EncoderData
        batch = _make_batch(
            encoder=EncoderData(position=137, delta=2, button=True, long_press=True)
        )
        snap = await self.engine.update(batch)
        assert snap["encoder"] is not None
        assert snap["encoder"]["long_press"] is True
        assert snap["encoder"]["position"] == 137
        assert snap["encoder"]["delta"] == 2
        assert snap["encoder"]["button"] is True

    @pytest.mark.asyncio
    async def test_buttons_data_lifted_into_snapshot(self):
        from sensors.sensor_parser import ButtonsData
        batch = _make_batch(
            buttons=ButtonsData(rgb_states=(False, True, False), any_pressed=True)
        )
        snap = await self.engine.update(batch)
        assert snap["buttons"] is not None
        assert snap["buttons"]["rgb_states"] == [False, True, False]
        assert snap["buttons"]["any_pressed"] is True

    @pytest.mark.asyncio
    async def test_ghost_trigger_fires_from_real_snapshot(self):
        """Integration: ContextEngine snapshot → state_machine → GHOST."""
        from sensors.sensor_parser import EncoderData, ButtonsData
        from core.state_machine import StateMachine, SystemState

        sm = StateMachine()
        batch = _make_batch(
            encoder=EncoderData(position=200, delta=0, button=True, long_press=True),
            buttons=ButtonsData(rgb_states=(False, True, False), any_pressed=True),
        )
        snap = await self.engine.update(batch)
        transition = sm.evaluate(snap)
        assert transition is not None, (
            "GHOST trigger did not fire — F-04 regression: snapshot lacks encoder/buttons"
        )
        assert transition.to_state == SystemState.GHOST
        assert transition.priority == 0

    @pytest.mark.asyncio
    async def test_encoder_persists_across_batches_without_encoder(self):
        """Firmware ships encoder frames only on edge — value must persist."""
        from sensors.sensor_parser import EncoderData
        await self.engine.update(_make_batch(
            encoder=EncoderData(position=42, delta=0, button=False, long_press=False)
        ))
        # Subsequent batch carries no encoder field — snapshot keeps prior value.
        snap = await self.engine.update(_make_batch())
        assert snap["encoder"] is not None
        assert snap["encoder"]["position"] == 42


class TestF05IdleClockBackdated:
    """ContextEngine cold-boot must report a realistic idle, not 0 s."""

    @pytest.mark.asyncio
    async def test_cold_boot_idle_reads_around_999s(self):
        from core.context_engine import ContextEngine
        engine = ContextEngine()
        snap = await engine.tick()
        idle = snap["history"]["last_interaction_ago_s"]
        # Backdated by 999 s; allow a small jitter window for the tick clock.
        assert idle >= 990, (
            f"Cold-boot idle reads {idle}s — F-05 regression: idle guards "
            "will not trip until first user interaction."
        )

    @pytest.mark.asyncio
    async def test_record_interaction_resets_idle(self):
        from core.context_engine import ContextEngine
        engine = ContextEngine()
        engine.record_interaction()
        snap = await engine.tick()
        idle = snap["history"]["last_interaction_ago_s"]
        assert idle < 5, (
            f"After record_interaction(), idle should be ~0, got {idle}s"
        )

    @pytest.mark.asyncio
    async def test_idle_advances_with_time(self):
        from core.context_engine import ContextEngine
        engine = ContextEngine()
        engine.record_interaction()
        snap1 = await engine.tick()
        await __import__("asyncio").sleep(0.05)
        snap2 = await engine.tick()
        assert snap2["history"]["last_interaction_ago_s"] >= snap1["history"]["last_interaction_ago_s"]
