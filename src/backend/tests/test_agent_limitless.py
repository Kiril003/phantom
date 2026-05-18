"""V1 — limitless execution: caps become operator-configurable with
`<=0` meaning unbound. Lets the agent run arbitrarily long / unlimited
actions / unlimited LLM calls, per the operator's explicit mandate on
his own ROOT device. Safety *mechanisms* (sandbox / unsafe_mode / risk
gate) are untouched — only the numeric quotas become unbound-capable.
"""
from config import config


def test_limitless_config_defaults():
    assert config.agent_bash_timeout_s == 120
    assert config.agent_bash_output_cap_bytes == 16384
    assert config.agent_unbound_default is False


def test_task_budget_caps_unbound_when_zero(monkeypatch):
    from agent.operations.safety.circuit_breakers import TaskBudget

    b = TaskBudget()
    b.actions_run = 9999
    monkeypatch.setattr(config, "agent_max_actions_per_task", 0)
    assert b.actions_exceeded() is False
    monkeypatch.setattr(config, "agent_max_actions_per_task", 20)
    b.actions_run = 20
    assert b.actions_exceeded() is True

    monkeypatch.setattr(config, "agent_max_elapsed_s_per_task", 0)
    b.started_at -= 10_000.0  # pretend the task has run ~2.7h
    assert b.time_exceeded() is False
    monkeypatch.setattr(config, "agent_max_elapsed_s_per_task", 600)
    assert b.time_exceeded() is True


def test_llm_cap_for_unbound_when_zero(monkeypatch):
    from agent.kernel import runtime as rt

    monkeypatch.setattr(config, "agent_max_llm_calls_per_task", 0)
    assert rt._llm_cap_for(background=False) == 0
    monkeypatch.setattr(config, "agent_max_llm_calls_per_task", 50)
    assert rt._llm_cap_for(background=False) == 50
    monkeypatch.setattr(config, "agent_max_llm_calls_per_background_task", 0)
    assert rt._llm_cap_for(background=True) == 0
    monkeypatch.setattr(config, "agent_max_llm_calls_per_background_task", 10)
    assert rt._llm_cap_for(background=True) == 10


def test_bash_caps_config_driven_and_field_unbound(monkeypatch):
    from agent.actions import bash as b

    monkeypatch.setattr(config, "agent_bash_timeout_s", 0)
    assert b._bash_timeout_cap() == 0
    monkeypatch.setattr(config, "agent_bash_timeout_s", 120)
    assert b._bash_timeout_cap() == 120
    monkeypatch.setattr(config, "agent_bash_output_cap_bytes", 0)
    assert b._bash_output_cap() == 0
    monkeypatch.setattr(config, "agent_bash_output_cap_bytes", 16384)
    assert b._bash_output_cap() == 16384
    # timeout_s field no longer hard-capped at 120 → limitless caller
    assert b.BashRun(cmd="echo hi", timeout_s=99999).timeout_s == 99999
