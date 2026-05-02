"""
Phase 17b — CustomAgent validation.

Pre-flight checks before saving / running a CustomAgent. Returns a list of
issues (severity + message). Empty list = OK. Used by routes_studio's POST
+ PATCH paths and by the runner before it actually starts.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable

from .models import CustomAgent


@dataclass(frozen=True)
class ValidationIssue:
    severity: str  # "blocker" | "warning"
    field: str
    message: str


_MIN_NAME_LEN = 2
_MAX_NAME_LEN = 160
_MAX_CARDS = 32


def _has_cycle(agent: CustomAgent) -> bool:
    by_id = {c.id for c in agent.cards}
    successors: dict[str, set[str]] = {cid: set() for cid in by_id}
    for link in agent.links:
        if link.from_card_id in by_id and link.to_card_id in by_id:
            successors[link.from_card_id].add(link.to_card_id)
    visited: set[str] = set()
    stack: set[str] = set()

    def _dfs(node: str) -> bool:
        if node in stack:
            return True
        if node in visited:
            return False
        visited.add(node)
        stack.add(node)
        for nxt in successors.get(node, ()):
            if _dfs(nxt):
                return True
        stack.discard(node)
        return False

    for cid in by_id:
        if _dfs(cid):
            return True
    return False


def validate_agent(agent: CustomAgent) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []

    name = (agent.name or "").strip()
    if len(name) < _MIN_NAME_LEN:
        issues.append(ValidationIssue("blocker", "name", "Імʼя надто коротке."))
    if len(name) > _MAX_NAME_LEN:
        issues.append(ValidationIssue("blocker", "name", "Імʼя надто довге."))

    if not agent.goal_template or not agent.goal_template.strip():
        issues.append(ValidationIssue(
            "warning", "goal_template",
            "Шаблон цілі порожній — агент стартуватиме з імʼя.",
        ))

    if len(agent.cards) > _MAX_CARDS:
        issues.append(ValidationIssue(
            "blocker", "cards", f"Забагато карток ({len(agent.cards)} > {_MAX_CARDS})",
        ))

    if not agent.cards:
        issues.append(ValidationIssue(
            "blocker", "cards", "Має бути хоча б одна картка.",
        ))

    # Reference integrity for links.
    by_id = {c.id for c in agent.cards}
    for link in agent.links:
        if link.from_card_id not in by_id:
            issues.append(ValidationIssue(
                "blocker", "links", f"link.from {link.from_card_id} не існує",
            ))
        if link.to_card_id not in by_id:
            issues.append(ValidationIssue(
                "blocker", "links", f"link.to {link.to_card_id} не існує",
            ))

    if _has_cycle(agent):
        issues.append(ValidationIssue(
            "blocker", "links", "В графі карток виявлено цикл — він має бути DAG.",
        ))

    # Recipients sanity.
    for r in agent.recipients:
        if r.channel == "email" and not _looks_like_email(r.target):
            issues.append(ValidationIssue(
                "warning", f"recipients[{r.id}]",
                "Не схоже на email — перевір target.",
            ))
        if not r.target:
            issues.append(ValidationIssue(
                "blocker", f"recipients[{r.id}]", "Recipient без target.",
            ))

    # Schedule sanity.
    sched = agent.schedule
    if sched.kind == "interval" and (sched.interval_s or 0) < 30:
        issues.append(ValidationIssue(
            "warning", "schedule.interval_s",
            "Інтервал менший за 30s — агент горітиме надто часто.",
        ))
    if sched.kind == "cron" and not (sched.cron_expr or "").strip():
        issues.append(ValidationIssue(
            "blocker", "schedule.cron_expr", "Cron-розклад без виразу.",
        ))
    if sched.kind == "one_shot_future" and sched.fire_at is None:
        issues.append(ValidationIssue(
            "blocker", "schedule.fire_at", "Одноразовий розклад без часу запуску.",
        ))

    return issues


def has_blockers(issues: Iterable[ValidationIssue]) -> bool:
    return any(i.severity == "blocker" for i in issues)


_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _looks_like_email(s: str) -> bool:
    return bool(_EMAIL_RE.match(s or ""))


__all__ = ["ValidationIssue", "validate_agent", "has_blockers"]
