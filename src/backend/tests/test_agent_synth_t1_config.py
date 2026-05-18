"""T1 — agent_synth_max_per_task config field exists with correct default."""
from config import config


def test_synth_max_default():
    assert config.agent_synth_max_per_task == 3


def test_synth_max_monkeypatchable(monkeypatch):
    monkeypatch.setattr(config, "agent_synth_max_per_task", 0)
    assert config.agent_synth_max_per_task == 0
    monkeypatch.setattr(config, "agent_synth_max_per_task", 7)
    assert config.agent_synth_max_per_task == 7
