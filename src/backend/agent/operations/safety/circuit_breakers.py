"""
Circuit breakers — per-task ceilings + repeated-error detection.

Loop checks these at every iteration start. Tripped breakers either force
reflection (recoverable) or fail the task (terminal).
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field

from config import config


@dataclass
class TaskBudget:
    started_at: float = field(default_factory=time.monotonic)
    actions_run: int = 0
    consecutive_identical_errors: int = 0
    last_error_class: str | None = None

    def record_action(self) -> None:
        self.actions_run += 1

    def record_result(self, ok: bool, error_class: str | None) -> None:
        if ok:
            self.consecutive_identical_errors = 0
            self.last_error_class = None
            return
        if error_class and error_class == self.last_error_class:
            self.consecutive_identical_errors += 1
        else:
            self.consecutive_identical_errors = 1
            self.last_error_class = error_class

    def elapsed_s(self) -> float:
        return time.monotonic() - self.started_at

    # ── Verdicts ───────────────────────────────────────────────────────────────

    def actions_exceeded(self) -> bool:
        cap = config.agent_max_actions_per_task
        return cap > 0 and self.actions_run >= cap

    def time_exceeded(self) -> bool:
        cap = config.agent_max_elapsed_s_per_task
        return cap > 0 and self.elapsed_s() >= cap

    def errors_repeating(self) -> bool:
        return self.consecutive_identical_errors >= config.agent_max_consecutive_identical_errors


@dataclass
class CircuitVerdict:
    """What the loop should do next, decided by inspecting TaskBudget."""
    fail_now: bool = False
    force_reflect: bool = False
    reason: str = ""


def evaluate(budget: TaskBudget) -> CircuitVerdict:
    if budget.actions_exceeded():
        return CircuitVerdict(fail_now=True, reason="max_actions_per_task")
    if budget.time_exceeded():
        return CircuitVerdict(fail_now=True, reason="max_elapsed_s_per_task")
    if budget.errors_repeating():
        return CircuitVerdict(force_reflect=True, reason="max_consecutive_identical_errors")
    return CircuitVerdict()
