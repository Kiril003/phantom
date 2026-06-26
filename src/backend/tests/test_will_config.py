import os

os.environ.setdefault("JWT_SECRET_KEY", "t")
os.environ.setdefault("AI_GEMINI_API_KEY", "k")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


def test_will_defaults():
    from config import config
    assert config.will_enabled is False
    assert config.will_tick_interval_s == 300
    assert config.will_daily_llm_calls == 200
    assert config.will_daily_token_cap == 300_000
    assert config.will_reflect_hour_local == 4
    assert config.will_max_active_day_goals == 3
