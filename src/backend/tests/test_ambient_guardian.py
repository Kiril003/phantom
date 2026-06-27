"""Ambient guardian — perception → proactive care (slice 1)."""
from agent.cognition.ambient.guardian import AmbientGuardian, AmbientRule
from agent.cognition.ambient.rules import default_rules
from agent.consciousness_stream import ConsciousnessStream


def _snap(**over):
    base = {
        "who": {"user_id": "u1"},
        "env": {"aqi": None, "temp_c": None, "pressure_hpa": None},
        "system": {"disk_percent": 10.0, "cpu_percent": 5.0, "internet_available": True},
        "body": {"stress_level": None},
        "presence": {"user_detected": False},
        "when": {"hour": 12},
    }
    for k, v in over.items():
        base.setdefault(k, {})
        if isinstance(v, dict):
            base[k] = {**base.get(k, {}), **v}
        else:
            base[k] = v
    return base


def test_air_quality_fires_when_unhealthy():
    g = AmbientGuardian(rules=default_rules())
    alerts = g.scan(_snap(env={"aqi": 180}), now=1000.0)
    ids = [a.rule_id for a in alerts]
    assert "air_quality" in ids
    msg = next(a.message for a in alerts if a.rule_id == "air_quality")
    assert "180" in msg


def test_missing_field_never_fires():
    g = AmbientGuardian(rules=default_rules())
    # aqi None, temps None, normal system → nothing environmental/health fires
    alerts = g.scan(_snap(), now=1000.0)
    assert [a for a in alerts if a.rule_id in ("air_quality", "heat", "cold", "high_stress")] == []


def test_debounce_blocks_refire_within_cooldown():
    g = AmbientGuardian(rules=default_rules())
    s = _snap(env={"aqi": 250})
    first = g.scan(s, now=0.0)
    again = g.scan(s, now=60.0)  # cooldown is 2h → still blocked
    later = g.scan(s, now=0.0 + 2 * 3600 + 1)  # past cooldown
    assert any(a.rule_id == "air_quality" for a in first)
    assert not any(a.rule_id == "air_quality" for a in again)
    assert any(a.rule_id == "air_quality" for a in later)


def test_pressure_drop_needs_trend():
    g = AmbientGuardian(rules=default_rules())
    # first scan establishes prev; no drop yet
    g.scan(_snap(env={"pressure_hpa": 1015.0}), now=0.0)
    alerts = g.scan(_snap(env={"pressure_hpa": 1010.0}), now=10.0)  # -5 hPa
    assert any(a.rule_id == "pressure_drop" for a in alerts)


def test_internet_lost_is_edge_triggered():
    g = AmbientGuardian(rules=default_rules())
    g.scan(_snap(system={"internet_available": True}), now=0.0)
    lost = g.scan(_snap(system={"internet_available": False}), now=10.0)
    assert any(a.rule_id == "internet_lost" for a in lost)


def test_disabled_rule_skipped():
    rule = AmbientRule("x", "system", 5, 0.0,
                       lambda s, p: "boom", enabled=False)
    g = AmbientGuardian(rules=[rule])
    assert g.scan(_snap(), now=0.0) == []


def test_broken_rule_does_not_break_scan():
    def boom(s, p):
        raise ValueError("nope")
    g = AmbientGuardian(rules=[AmbientRule("b", "system", 1, 0.0, boom),
                              AmbientRule("ok", "system", 1, 0.0, lambda s, p: "fine")])
    alerts = g.scan(_snap(), now=0.0)
    assert [a.rule_id for a in alerts] == ["ok"]


def test_open_meteo_aqi_parser():
    from geo.sources.environmental import EnvironmentalAdapter
    assert EnvironmentalAdapter.parse_open_meteo_aqi({"current": {"us_aqi": 73}}) == 73.0
    assert EnvironmentalAdapter.parse_open_meteo_aqi({"current": {}}) is None
    assert EnvironmentalAdapter.parse_open_meteo_aqi({}) is None
    assert EnvironmentalAdapter.parse_open_meteo_aqi({"current": {"us_aqi": "bad"}}) is None


def test_set_env_aqi_is_sticky_and_guards_none():
    from core.context_engine import context_engine
    context_engine.set_env_aqi(140.0)
    assert context_engine.get_snapshot()["env"]["aqi"] == 140.0
    context_engine.set_env_aqi(None)  # must not clobber
    assert context_engine.get_snapshot()["env"]["aqi"] == 140.0


def test_consciousness_push_dedups_and_caps():
    cs = ConsciousnessStream()
    cs.push_insight("u1", "a")
    cs.push_insight("u1", "a")  # dup ignored
    for i in range(10):
        cs.push_insight("u1", f"m{i}")
    q = cs._pending_insights["u1"]
    assert len(q) <= 5
    assert q.count("a") <= 1
    assert cs.get_pending_insight("u1") is not None
