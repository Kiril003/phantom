"""Checkpoint snapshot helpers — pure functions building Checkpoint payloads."""
from __future__ import annotations

from agent.schemas import Checkpoint, CheckpointReason, Observation, SelfModel, SubGoal, ThoughtBudget, ReflectionResult


def build(
    *,
    task_id: str,
    reason: CheckpointReason,
    self_model: SelfModel,
    goal: str,
    sub_goals: list[SubGoal],
    active_sub_goal_id: str | None,
    observations: list[Observation],
    thought_budget: ThoughtBudget,
    last_reflection: ReflectionResult | None,
    step_idx: int,
) -> Checkpoint:
    """Build an immutable snapshot of runtime state for persistence."""
    # Cap stored observations to last 50 to keep blob size sane
    obs = observations[-50:] if len(observations) > 50 else list(observations)
    return Checkpoint(
        task_id=task_id,
        reason=reason,
        self_model=self_model,
        goal=goal,
        sub_goals=list(sub_goals),
        active_sub_goal_id=active_sub_goal_id,
        observations=obs,
        thought_budget=thought_budget,
        last_reflection=last_reflection,
        step_idx=step_idx,
    )
