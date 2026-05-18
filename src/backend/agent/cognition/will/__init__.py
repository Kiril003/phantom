"""
Will Engine v1 (Phase 28).
Provides the fundamental drives, values, identity, and goal-stack.
"""
from .drives import drive_system
from .values import values_system
from .identity import identity_system
from .goal_stack import goal_stack, Goal

__all__ = [
    "drive_system",
    "values_system",
    "identity_system",
    "goal_stack",
    "Goal",
]
