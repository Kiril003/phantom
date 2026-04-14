"""
Phase 01 — Serial Bridge + ContextEngine tests.
Covers: SensorParser, CommandSender, ContextEngine, StateMachine, EventBus, DecisionTree.
No real serial hardware needed — uses mock JSON inputs.
"""
from __future__ import annotations

import asyncio
import json
import pytest
import time
from unittest.mock import AsyncMock, MagicMock, patch


# ─────────────────────────────────────────────────────────────────────────────
# SensorParser tests
# ─────────────────────────────────────────────────────────────────────────────

class TestSensorParser:
    def setup_method(self):
        from sensors.sensor_parser import SensorParser
        self.parser = SensorParser()

    def test_parse_full_batch(self):
        raw = json.dumps({
            "v": 3, "ts": 1718000000, "type": "sensor_batch",
            "radar": {"present": True, "motion_e": 45, "static_e": 12,
                      "dist_cm": 85, "breath_bpm": 16},
            "gps": {"lat": 48.45, "lon": 35.02, "fix": True, "sats": 8,
                    "speed": 0.2, "alt": 155.3, "hdop": 1.2},
            "env": {"temp": 22.3, "press": 1013.2, "aqi": 42},
            "rfid": {"uid": None, "new": False},
            "enc": {"pos": 127, "delta": 0, "btn": False, "long": False},
            "btns": [False, False, False],
            "wifi": None,
        })
        from sensors.sensor_parser import SensorBatch
        result = self.parser.parse(raw)
        assert isinstance(result, SensorBatch)
        assert result.radar is not None
        assert result.radar.present is True
        assert result.radar.motion_energy == 45
        assert result.radar.breath_bpm == 16.0
        assert result.gps is not None
        assert result.gps.fix is True
        assert result.gps.satellites == 8
        assert result.env is not None
        assert result.env.temp_c == pytest.approx(22.3)
        assert result.encoder is not None
        assert result.encoder.position == 127
        assert result.buttons is not None
        assert result.buttons.any_pressed is False

    def test_parse_heartbeat(self):
        raw = json.dumps({
            "v": 3, "ts": 5000000, "type": "heartbeat",
            "uptime_ms": 3600000, "free_heap": 125000, "wifi_rssi": -45,
        })
        from sensors.sensor_parser import HeartbeatMessage
        result = self.parser.parse(raw)
        assert isinstance(result, HeartbeatMessage)
        assert result.uptime_ms == 3600000
        assert result.free_heap == 125000
        assert result.wifi_rssi == -45

    def test_parse_error_message(self):
        raw = json.dumps({
            "v": 3, "ts": 1000, "type": "error",
            "sensor": "gps", "msg": "no fix timeout", "code": 3,
        })
        from sensors.sensor_parser import ErrorMessage
        result = self.parser.parse(raw)
        assert isinstance(result, ErrorMessage)
        assert result.sensor == "gps"
        assert result.code == 3

    def test_parse_batch_null_breath(self):
        """breath_bpm null when radar cannot determine."""
        raw = json.dumps({
            "v": 3, "ts": 1000, "type": "sensor_batch",
            "radar": {"present": True, "motion_e": 80, "static_e": 5,
                      "dist_cm": 50, "breath_bpm": None},
        })
        from sensors.sensor_parser import SensorBatch
        result = self.parser.parse(raw)
        assert isinstance(result, SensorBatch)
        assert result.radar is not None
        assert result.radar.breath_bpm is None

    def test_parse_wifi_networks(self):
        raw = json.dumps({
            "v": 3, "ts": 1000, "type": "sensor_batch",
            "wifi": [
                {"mac": "AA:BB:CC:DD:EE:FF", "ssid": "Home", "rssi": -45, "enc": 3, "ch": 6},
                {"mac": "11:22:33:44:55:66", "ssid": "Guest", "rssi": -72, "enc": 4, "ch": 11},
            ],
        })
        from sensors.sensor_parser import SensorBatch
        result = self.parser.parse(raw)
        assert isinstance(result, SensorBatch)
        assert result.wifi_nets is not None
        assert len(result.wifi_nets) == 2
        assert result.wifi_nets[0].ssid == "Home"
        assert result.wifi_nets[1].rssi == -72

    def test_parse_invalid_json_returns_none(self):
        result = self.parser.parse("not json {{{")
        assert result is None

    def test_parse_unknown_type_returns_none(self):
        raw = json.dumps({"v": 3, "ts": 1000, "type": "unknown_type"})
        result = self.parser.parse(raw)
        assert result is None

    def test_parse_encoder_long_press(self):
        raw = json.dumps({
            "v": 3, "ts": 1000, "type": "sensor_batch",
            "enc": {"pos": 255, "delta": 5, "btn": True, "long": True},
        })
        from sensors.sensor_parser import SensorBatch
        result = self.parser.parse(raw)
        assert isinstance(result, SensorBatch)
        assert result.encoder is not None
        assert result.encoder.long_press is True
        assert result.encoder.delta == 5


# ─────────────────────────────────────────────────────────────────────────────
# CommandSender tests
# ─────────────────────────────────────────────────────────────────────────────

class TestCommandSender:
    def test_serialize_servo(self):
        from sensors.command_sender import serialize_command
        data = serialize_command({"type": "servo", "pan_delta": -5, "tilt_delta": 2})
        parsed = json.loads(data.decode().strip())
        assert parsed["type"] == "servo"
        assert parsed["pan"] == -5
        assert parsed["tilt"] == 2

    def test_serialize_haptic(self):
        from sensors.command_sender import serialize_command
        data = serialize_command({"type": "haptic", "pattern": "double", "duration_ms": 300})
        parsed = json.loads(data.decode().strip())
        assert parsed["type"] == "haptic"
        assert parsed["pat"] == "double"
        assert parsed["ms"] == 300

    def test_serialize_oled_text(self):
        from sensors.command_sender import serialize_command
        data = serialize_command({"type": "oled", "mode": "text", "lines": ["Hello", "World"]})
        parsed = json.loads(data.decode().strip())
        assert parsed["type"] == "oled"
        assert parsed["mode"] == "text"
        assert parsed["lines"] == ["Hello", "World"]

    def test_serialize_rgb(self):
        from sensors.command_sender import serialize_command
        data = serialize_command({"type": "rgb", "id": 1, "color": "FF0000", "mode": "pulse", "speed_ms": 500})
        parsed = json.loads(data.decode().strip())
        assert parsed["type"] == "rgb"
        assert parsed["id"] == 1
        assert parsed["color"] == "FF0000"
        assert parsed["spd"] == 500

    def test_serialize_config(self):
        from sensors.command_sender import serialize_command
        data = serialize_command({"type": "config", "key": "radar_sensitivity", "value": 7})
        parsed = json.loads(data.decode().strip())
        assert parsed["type"] == "cfg"
        assert parsed["key"] == "radar_sensitivity"
        assert parsed["val"] == 7

    def test_serialize_unknown_raises(self):
        from sensors.command_sender import serialize_command
        with pytest.raises(ValueError):
            serialize_command({"type": "invalid_type"})

    def test_line_terminator(self):
        from sensors.command_sender import serialize_command
        data = serialize_command({"type": "oled", "mode": "clear"})
        assert data.endswith(b"\n")


# ─────────────────────────────────────────────────────────────────────────────
# EventBus tests
# ─────────────────────────────────────────────────────────────────────────────

class TestEventBus:
    def setup_method(self):
        from core.event_bus import EventBus
        self.bus = EventBus()  # fresh instance for each test

    def test_subscribe_and_emit_sync(self):
        received = []
        self.bus.subscribe("test_event", lambda data: received.append(data))
        self.bus.emit("test_event", {"value": 42})
        assert len(received) == 1
        assert received[0]["value"] == 42

    def test_multiple_subscribers(self):
        results = []
        self.bus.subscribe("evt", lambda d: results.append("a"))
        self.bus.subscribe("evt", lambda d: results.append("b"))
        self.bus.emit("evt", {})
        assert set(results) == {"a", "b"}

    def test_unsubscribe(self):
        results = []
        unsub = self.bus.subscribe("evt", lambda d: results.append(d))
        self.bus.emit("evt", 1)
        unsub()
        self.bus.emit("evt", 2)
        assert results == [1]

    def test_no_subscribers_no_error(self):
        self.bus.emit("nonexistent_event", {})  # should not raise

    @pytest.mark.asyncio
    async def test_async_emit(self):
        results = []
        async def async_handler(data):
            results.append(data)
        self.bus.subscribe("async_evt", async_handler)
        await self.bus.emit_async("async_evt", "hello")
        assert results == ["hello"]

    def test_clear_specific_event(self):
        results = []
        self.bus.subscribe("to_clear", lambda d: results.append(d))
        self.bus.clear("to_clear")
        self.bus.emit("to_clear", 99)
        assert results == []


# ─────────────────────────────────────────────────────────────────────────────
# ContextEngine tests
# ─────────────────────────────────────────────────────────────────────────────

class TestContextEngine:
    def setup_method(self):
        from core.context_engine import ContextEngine
        self.engine = ContextEngine()

    def _make_batch(self, **kwargs):
        from sensors.sensor_parser import SensorBatch, RadarData, GPSData, EnvData
        batch = SensorBatch(version=3, timestamp_ms=int(time.time() * 1000), type="sensor_batch")
        if "radar" in kwargs:
            batch.radar = kwargs["radar"]
        if "gps" in kwargs:
            batch.gps = kwargs["gps"]
        if "env" in kwargs:
            batch.env = kwargs["env"]
        return batch

    @pytest.mark.asyncio
    async def test_update_returns_snapshot(self):
        from sensors.sensor_parser import RadarData
        batch = self._make_batch(
            radar=RadarData(present=True, motion_energy=30, static_energy=10,
                            distance_cm=80, breath_bpm=16.0)
        )
        snapshot = await self.engine.update(batch)
        assert "timestamp" in snapshot
        assert "body" in snapshot
        assert snapshot["body"]["breathing_bpm"] == pytest.approx(16.0)
        assert snapshot["body"]["breathing_state"] == "calm"

    @pytest.mark.asyncio
    async def test_stress_classification_elevated(self):
        from sensors.sensor_parser import RadarData
        batch = self._make_batch(
            radar=RadarData(present=True, motion_energy=60, static_energy=5,
                            distance_cm=100, breath_bpm=25.0)
        )
        snapshot = await self.engine.update(batch)
        assert snapshot["body"]["breathing_state"] == "elevated"
        assert snapshot["body"]["stress_level"] > 0.5

    @pytest.mark.asyncio
    async def test_gps_update(self):
        from sensors.sensor_parser import GPSData
        batch = self._make_batch(
            gps=GPSData(lat=48.45, lon=35.02, fix=True, satellites=8,
                        speed_kmh=0.0, altitude_m=155.0, hdop=1.2)
        )
        snapshot = await self.engine.update(batch)
        assert snapshot["where"]["lat"] == pytest.approx(48.45)
        assert snapshot["where"]["fix"] is True

    @pytest.mark.asyncio
    async def test_env_update(self):
        from sensors.sensor_parser import EnvData
        batch = self._make_batch(
            env=EnvData(temp_c=22.5, pressure_hpa=1013.0, aqi=35)
        )
        snapshot = await self.engine.update(batch)
        assert snapshot["env"]["temp_c"] == pytest.approx(22.5)
        assert snapshot["env"]["aqi"] == 35

    @pytest.mark.asyncio
    async def test_history_accumulates(self):
        from sensors.sensor_parser import RadarData
        for i in range(5):
            batch = self._make_batch(
                radar=RadarData(present=True, motion_energy=i*10, static_energy=5,
                                distance_cm=100, breath_bpm=16.0)
            )
            await self.engine.update(batch)
        history = self.engine.get_history(minutes=5)
        assert len(history) == 5

    def test_set_state(self):
        self.engine.set_state("FOCUS")
        snap = self.engine.get_snapshot()
        assert snap["system"]["state"] == "FOCUS"

    @pytest.mark.asyncio
    async def test_tick_updates_time(self):
        snap1 = await self.engine.tick()
        assert "timestamp" in snap1
        await asyncio.sleep(0.01)
        snap2 = await self.engine.tick()
        assert snap2["timestamp"] >= snap1["timestamp"]

    def test_memory_hints(self):
        hints = ["fact1", "fact2", "fact3"]
        self.engine.set_memory_hints(hints)
        snap = self.engine.get_snapshot()
        assert snap["memory_hints"] == hints

    def test_memory_hints_max_5(self):
        hints = [f"hint{i}" for i in range(10)]
        self.engine.set_memory_hints(hints)
        snap = self.engine.get_snapshot()
        assert len(snap["memory_hints"]) == 5


# ─────────────────────────────────────────────────────────────────────────────
# StateMachine tests
# ─────────────────────────────────────────────────────────────────────────────

class TestStateMachine:
    def setup_method(self):
        from core.state_machine import StateMachine
        self.sm = StateMachine()

    def _snap(self, **overrides) -> dict:
        base = {
            "when": {"hour": 14, "work_hours": True, "is_night": False, "day_of_week": "mon"},
            "body": {"breathing_bpm": 16.0, "stress_level": 0.2,
                     "motion_energy": 20, "static_energy": 5, "user_distance_cm": 80,
                     "breathing_state": "calm"},
            "presence": {"user_detected": True, "user_distance_cm": 80,
                         "other_detected": False, "other_distance_cm": None},
            "history": {"last_interaction_ago_s": 10, "last_state_change_ago_s": 30,
                        "mood_trend": "stable", "active_timers": 0, "pending_events_1h": 0},
            "system": {"state": "SHADOW", "uptime_s": 100, "cpu_percent": 20.0,
                       "ram_percent": 40.0, "disk_percent": 10.0,
                       "wifi_connected": True, "internet_available": True,
                       "ai_provider": "gemini", "stt_engine": "whisper"},
            "who": {"user_id": "user1", "username": "test", "role": "ROOT",
                    "auth_method": "pin", "confidence": 1.0},
            "where": {"lat": 48.45, "lon": 35.02, "fix": True, "satellites": 8,
                      "speed_kmh": 0.0, "place_known": True, "place_name": "Home",
                      "first_visit": False},
            "env": {"temp_c": 22.0, "pressure_hpa": 1013.0, "aqi": 30},
            "encoder": None,
            "buttons": None,
            "memory_hints": [],
        }
        # Deep merge overrides
        for k, v in overrides.items():
            if isinstance(v, dict) and k in base and isinstance(base[k], dict):
                base[k].update(v)
            else:
                base[k] = v
        return base

    def test_initial_state_is_shadow(self):
        from core.state_machine import SystemState
        assert self.sm.current_state == SystemState.SHADOW

    def test_shadow_to_focus_on_work_context(self):
        snap = self._snap(
            when={"hour": 10, "work_hours": True, "is_night": False},
            presence={"user_detected": True, "user_distance_cm": 80,
                      "other_detected": False, "other_distance_cm": None},
            history={"last_interaction_ago_s": 30, "last_state_change_ago_s": 10,
                     "mood_trend": "stable", "active_timers": 0, "pending_events_1h": 0},
        )
        transition = self.sm.evaluate(snap)
        from core.state_machine import SystemState
        assert transition is not None
        assert transition.to_state == SystemState.FOCUS

    def test_shadow_no_transition_when_idle(self):
        snap = self._snap(
            history={"last_interaction_ago_s": 999, "last_state_change_ago_s": 200,
                     "mood_trend": "stable", "active_timers": 0, "pending_events_1h": 0},
        )
        # SHADOW with long idle and no work hours → stay in SHADOW
        snap["when"]["work_hours"] = False
        transition = self.sm.evaluate(snap)
        assert transition is None or transition.to_state == "SHADOW"

    def test_sentinel_on_threat(self):
        snap = self._snap(
            presence={"user_detected": True, "user_distance_cm": 80,
                      "other_detected": True, "other_distance_cm": 150},
            where={"lat": None, "lon": None, "fix": False, "satellites": 0,
                   "speed_kmh": 0, "place_known": False, "place_name": None,
                   "first_visit": True},
        )
        transition = self.sm.evaluate(snap)
        from core.state_machine import SystemState
        assert transition is not None
        assert transition.to_state == SystemState.SENTINEL

    def test_dream_on_night_sleep_breathing(self):
        snap = self._snap(
            when={"hour": 2, "work_hours": False, "is_night": True},
            body={"breathing_bpm": 12.0, "stress_level": 0.1,
                  "motion_energy": 5, "static_energy": 2,
                  "user_distance_cm": 50, "breathing_state": "sleep"},
        )
        transition = self.sm.evaluate(snap)
        from core.state_machine import SystemState
        assert transition is not None
        assert transition.to_state == SystemState.DREAM

    def test_focus_to_shadow_on_no_interaction(self):
        self.sm.force_transition("FOCUS", "test")
        snap = self._snap(
            history={"last_interaction_ago_s": 300, "last_state_change_ago_s": 300,
                     "mood_trend": "stable", "active_timers": 0, "pending_events_1h": 0},
        )
        snap["when"]["work_hours"] = False
        transition = self.sm.evaluate(snap)
        from core.state_machine import SystemState
        assert transition is not None
        assert transition.to_state == SystemState.SHADOW

    def test_ghost_trigger_from_any_state(self):
        snap = self._snap(
            encoder={"position": 100, "delta": 0, "button": True, "long_press": True},
            buttons={"rgb_states": [False, True, False], "any_pressed": True},
        )
        transition = self.sm.evaluate(snap)
        from core.state_machine import SystemState
        assert transition is not None
        assert transition.to_state == SystemState.GHOST
        assert transition.priority == 0

    def test_ghost_toggle_back_to_shadow(self):
        self.sm.force_transition("GHOST", "test")
        snap = self._snap(
            encoder={"position": 100, "delta": 0, "button": True, "long_press": True},
            buttons={"rgb_states": [False, True, False], "any_pressed": True},
        )
        transition = self.sm.evaluate(snap)
        from core.state_machine import SystemState
        assert transition is not None
        assert transition.to_state == SystemState.SHADOW

    def test_force_transition_is_not_auto(self):
        t = self.sm.force_transition("DIALOGUE", "user_tap")
        assert t.auto is False
        assert t.to_state == "DIALOGUE"

    def test_sentinel_clears_on_no_threat(self):
        self.sm.force_transition("SENTINEL", "test")
        snap = self._snap(
            presence={"user_detected": True, "user_distance_cm": 80,
                      "other_detected": False, "other_distance_cm": None},
            where={"lat": 48.45, "lon": 35.02, "fix": True, "satellites": 8,
                   "speed_kmh": 0, "place_known": True, "place_name": "Home",
                   "first_visit": False},
        )
        transition = self.sm.evaluate(snap)
        from core.state_machine import SystemState
        assert transition is not None
        assert transition.to_state == SystemState.SHADOW


# ─────────────────────────────────────────────────────────────────────────────
# DecisionTree tests
# ─────────────────────────────────────────────────────────────────────────────

class TestDecisionTree:
    def setup_method(self):
        from core.decision_tree import DecisionTree
        self.dt = DecisionTree()

    def _snap(self, state="FOCUS", stress=0.3, bpm=16.0, aqi=30, pending_events=0, idle_s=10) -> dict:
        return {
            "system": {"state": state, "ai_provider": "gemini", "stt_engine": "whisper",
                       "uptime_s": 100, "cpu_percent": 20.0, "ram_percent": 40.0,
                       "disk_percent": 10.0, "wifi_connected": True, "internet_available": True},
            "body": {"breathing_bpm": bpm, "stress_level": stress,
                     "motion_energy": 20, "static_energy": 5,
                     "user_distance_cm": 80, "breathing_state": "calm"},
            "env": {"temp_c": 22.0, "pressure_hpa": 1013.0, "aqi": aqi},
            "history": {"last_interaction_ago_s": idle_s, "last_state_change_ago_s": 30,
                        "mood_trend": "stable", "active_timers": 0,
                        "pending_events_1h": pending_events},
            "when": {"hour": 14, "work_hours": True, "is_night": False},
            "presence": {"user_detected": True, "user_distance_cm": 80,
                         "other_detected": False, "other_distance_cm": None},
        }

    def test_high_stress_triggers_alert(self):
        snap = self._snap(stress=0.8, bpm=30.0)
        actions = self.dt.evaluate(snap)
        kinds = [a.kind for a in actions]
        assert "alert" in kinds

    def test_high_aqi_triggers_alert(self):
        snap = self._snap(aqi=200)
        actions = self.dt.evaluate(snap)
        kinds = [a.kind for a in actions]
        assert "alert" in kinds

    def test_normal_conditions_no_critical_alert(self):
        snap = self._snap(stress=0.2, bpm=16.0, aqi=30)
        actions = self.dt.evaluate(snap)
        critical = [a for a in actions if a.priority <= 1]
        assert len(critical) == 0

    def test_sentinel_state_triggers_rgb_actuator(self):
        snap = self._snap(state="SENTINEL")
        actions = self.dt.evaluate(snap)
        rgb_actions = [a for a in actions if a.kind == "actuator" and a.payload.get("type") == "rgb"]
        assert len(rgb_actions) > 0

    def test_has_pending_initiative_starts_false(self):
        assert self.dt.has_pending_initiative() is False

    def test_consume_initiative_returns_none_when_empty(self):
        action = self.dt.consume_initiative()
        assert action is None

    def test_consume_initiative_pops_ai_speak(self):
        # Elevated stress in FOCUS triggers ai_speak via _check_health
        snap = self._snap(state="FOCUS", stress=0.65, bpm=16.0)
        actions = self.dt.evaluate(snap)
        ai_actions = [a for a in actions if a.kind == "ai_speak"]
        if ai_actions:
            assert self.dt.has_pending_initiative() is True
            consumed = self.dt.consume_initiative()
            assert consumed is not None
            assert consumed.kind == "ai_speak"
            # After consuming, pending count decreased
            remaining = [a for a in self.dt._pending if a.kind == "ai_speak"]
            assert len(remaining) == len(ai_actions) - 1

    def test_pending_events_triggers_ai_speak(self):
        snap = self._snap(pending_events=1)
        actions = self.dt.evaluate(snap)
        ai_speak = [a for a in actions if a.kind == "ai_speak"]
        assert len(ai_speak) > 0
        assert any(a.reason == "calendar_reminder" for a in ai_speak)

    def test_dream_state_rgb_actuator(self):
        snap = self._snap(state="DREAM")
        actions = self.dt.evaluate(snap)
        rgb = [a for a in actions if a.kind == "actuator" and a.payload.get("type") == "rgb"]
        assert len(rgb) > 0
        assert rgb[0].payload.get("mode") == "breathe"

    def test_ghost_state_rgb_off(self):
        snap = self._snap(state="GHOST")
        actions = self.dt.evaluate(snap)
        rgb = [a for a in actions if a.kind == "actuator" and a.payload.get("type") == "rgb"]
        assert len(rgb) > 0
        assert rgb[0].payload.get("mode") == "off"
        assert rgb[0].priority == 0  # highest priority


# ─────────────────────────────────────────────────────────────────────────────
# SerialBridge tests
# ─────────────────────────────────────────────────────────────────────────────

class TestSerialBridge:
    def setup_method(self):
        from sensors.serial_bridge import SerialBridge
        self.bridge = SerialBridge()

    def test_not_connected_initially(self):
        assert self.bridge.is_connected is False

    def test_last_heartbeat_inf_when_never_received(self):
        assert self.bridge.last_heartbeat_ago == float("inf")

    def test_on_batch_registers_callback(self):
        async def cb(batch): pass
        self.bridge.on_batch(cb)
        assert len(self.bridge._on_batch) == 1

    def test_on_heartbeat_registers_callback(self):
        async def cb(hb): pass
        self.bridge.on_heartbeat(cb)
        assert len(self.bridge._on_heartbeat) == 1

    def test_on_disconnect_registers_callback(self):
        self.bridge.on_disconnect(lambda: None)
        assert len(self.bridge._on_disconnect) == 1

    @pytest.mark.asyncio
    async def test_dispatch_batch_invokes_callback(self):
        from sensors.sensor_parser import SensorBatch
        received = []
        async def cb(batch): received.append(batch)
        self.bridge.on_batch(cb)
        batch = SensorBatch(version=3, timestamp_ms=1000, type="sensor_batch")
        await self.bridge._dispatch(batch)
        assert len(received) == 1
        assert received[0] is batch

    @pytest.mark.asyncio
    async def test_dispatch_heartbeat_updates_last_heartbeat(self):
        from sensors.sensor_parser import HeartbeatMessage
        import time
        hb = HeartbeatMessage(version=3, timestamp_ms=1000, uptime_ms=5000,
                              free_heap=100000, wifi_rssi=-45)
        before = time.monotonic()
        await self.bridge._dispatch(hb)
        assert self.bridge._last_heartbeat >= before

    @pytest.mark.asyncio
    async def test_dispatch_error_does_not_raise(self):
        from sensors.sensor_parser import ErrorMessage
        err = ErrorMessage(version=3, timestamp_ms=1000,
                           sensor="gps", msg="timeout", code=3)
        await self.bridge._dispatch(err)  # should not raise

    @pytest.mark.asyncio
    async def test_stop_when_not_started_is_safe(self):
        await self.bridge.stop()  # should not raise

    def test_watchdog_detects_stale_heartbeat(self):
        import time
        self.bridge._connected = True
        self.bridge._last_heartbeat = time.monotonic() - 15.0
        assert self.bridge.last_heartbeat_ago > 10.0

    @pytest.mark.asyncio
    async def test_dispatch_batch_multiple_callbacks_all_called(self):
        from sensors.sensor_parser import SensorBatch
        results = []
        async def cb1(b): results.append(1)
        async def cb2(b): results.append(2)
        self.bridge.on_batch(cb1)
        self.bridge.on_batch(cb2)
        await self.bridge._dispatch(SensorBatch(version=3, timestamp_ms=1000, type="sensor_batch"))
        assert set(results) == {1, 2}
