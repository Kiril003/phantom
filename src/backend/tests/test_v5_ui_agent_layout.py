"""T1 — ui_agent_layout config field (V5)."""
import pytest
from config import PhantomConfig


def test_ui_agent_layout_default():
    cfg = PhantomConfig()
    assert cfg.ui_agent_layout == "conversation"


def test_ui_agent_layout_telemetry():
    cfg = PhantomConfig(ui_agent_layout="telemetry")
    assert cfg.ui_agent_layout == "telemetry"


def test_ui_agent_layout_invalid():
    with pytest.raises(Exception):
        PhantomConfig(ui_agent_layout="dense")
