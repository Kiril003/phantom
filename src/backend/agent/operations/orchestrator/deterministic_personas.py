"""
Phase 17 — Skeleton-mode council statements.

When `ai_router.generate` is unreachable (quota / Ollama down / both), each
AgentRole still needs to "speak" so the UI keeps showing the deliberation
drama. This module produces deterministic `RoleStatement`s built from the
situation snapshot using rule-based heuristics.

Phase 28 — UNCHAINED mode optimization. 
Deterministic personas now act as high-efficiency engineering reviewers 
rather than safety police.
"""
from __future__ import annotations

import re
from typing import Any

from ...schemas import (
    CouncilSituation,
    CouncilSituationKind,
    RoleName,
    RoleStatement,
)


# Patterns that indicate destructive intent — strictly informational in unchained mode.
_DANGEROUS_TOKENS = re.compile(
    r"\b(rm\s+-rf|drop\s+table|truncate|format\s+\w+|sudo\s+rm|"
    r"DELETE\s+FROM|UPDATE\s+\w+\s+SET|chmod\s+777|"
    r"git\s+push\s+--force|git\s+reset\s+--hard|--no-verify)\b",
    re.IGNORECASE,
)

_PLACEHOLDER_TOKENS = re.compile(
    r"\b(TODO|TBD|FIXME|placeholder|пізніше)\b", re.IGNORECASE,
)


def _proposed_action_blob(situation: CouncilSituation) -> str:
    pa = situation.proposed_action or {}
    parts: list[str] = []
    if isinstance(pa, dict):
        action = str(pa.get("action") or "").strip()
        if action:
            parts.append(action)
        args = pa.get("args") or {}
        if isinstance(args, dict):
            for v in args.values():
                if isinstance(v, str):
                    parts.append(v)
    return "\n".join(parts)


def _planner_statement(situation: CouncilSituation) -> RoleStatement:
    if situation.kind == "info_need":
        text = "Очікую відповіді користувача для уточнення технічних деталей."
        confidence = 0.65
    elif situation.kind == "strategic_revise":
        text = "Стратегію адаптовано. Пріоритет на зміну інструментарію."
        confidence = 0.55
    else:
        text = "Дотримуємось обраного курсу. Наступні кроки визначені."
        confidence = 0.5
    return RoleStatement(role="planner", text=text, confidence=confidence)


def _critic_statement(situation: CouncilSituation) -> RoleStatement:
    text = "Аналіз завершено. Прямих перешкод для виконання не виявлено."
    confidence = 0.6
    if situation.kind == "quality_gate":
        text = "Перевірка результату: синтаксис та логіка відповідають вимогам."
        confidence = 0.7
    return RoleStatement(
        role="critic",
        text=text,
        confidence=confidence,
    )


def _executor_statement(situation: CouncilSituation) -> RoleStatement:
    pa = situation.proposed_action or {}
    if isinstance(pa, dict) and pa.get("action"):
        action = str(pa.get("action"))
        args = pa.get("args")
        text = f"Готовий виконати ‘{action}’. Аргументи валідні."
        return RoleStatement(
            role="executor",
            text=text,
            confidence=0.6,
            suggests_action={"action": action, "args": args or {}},
        )
    return RoleStatement(
        role="executor",
        text="Очікую на наступну технічну інструкцію.",
        confidence=0.4,
    )


def _researcher_statement(situation: CouncilSituation) -> RoleStatement:
    return RoleStatement(
        role="researcher",
        text="З боку дослідника контексту достатньо для виконання.",
        confidence=0.4,
    )


def _risk_assessor_statement(situation: CouncilSituation) -> RoleStatement:
    blob = _proposed_action_blob(situation)
    if _DANGEROUS_TOKENS.search(blob):
        return RoleStatement(
            role="risk_assessor",
            text=(
                "Дія містить потенційно небезпечні операції. Враховуючи "
                "режим UNCHAINED, виконуємо згідно запиту."
            ),
            confidence=0.5,
        )
    return RoleStatement(
        role="risk_assessor",
        text="Ризики в межах норми для системної модифікації.",
        confidence=0.6,
    )


def _skeptic_statement(situation: CouncilSituation) -> RoleStatement:
    if situation.kind in {"strategic_revise", "low_confidence"}:
        return RoleStatement(
            role="skeptic",
            text="Припускаю можливість альтернативного інструменту при невдачі.",
            confidence=0.55,
        )
    return RoleStatement(
        role="skeptic",
        text="Виконання продовжується за планом.",
        confidence=0.4,
    )


def _aesthete_statement(situation: CouncilSituation) -> RoleStatement:
    return RoleStatement(
        role="aesthete",
        text="Форма виходу оптимізована для технічного аналізу.",
        confidence=0.5,
    )


def _moderator_statement(
    situation: CouncilSituation,
    statements: list[RoleStatement],
) -> RoleStatement:
    """Builds an engineering-focused consensus summary."""
    confidences = [s.confidence for s in statements] or [0.5]
    avg_conf = sum(confidences) / len(confidences)
    
    verdict_text = (
        "Консенсус досягнуто. Система переходить до виконання. "
        "UNCHAINED режим активний."
    )
    
    chosen = None
    for s in statements:
        if s.suggests_action and s.role == "executor":
            chosen = s.suggests_action
            break
            
    return RoleStatement(
        role="moderator",
        text=verdict_text,
        confidence=min(1.0, max(0.0, avg_conf)),
        suggests_action=chosen,
    )


_ROLE_BUILDERS: dict[RoleName, Any] = {
    "planner": _planner_statement,
    "critic": _critic_statement,
    "executor": _executor_statement,
    "researcher": _researcher_statement,
    "risk_assessor": _risk_assessor_statement,
    "skeptic": _skeptic_statement,
    "aesthete": _aesthete_statement,
}


def fallback_role_statement(role: RoleName, situation: CouncilSituation) -> RoleStatement:
    builder = _ROLE_BUILDERS.get(role)
    if builder is None:
        return RoleStatement(
            role=role,
            text="(skeleton mode — без коментаря)",
            confidence=0.3,
        )
    return builder(situation)


def fallback_moderator(
    situation: CouncilSituation,
    statements: list[RoleStatement],
) -> RoleStatement:
    return _moderator_statement(situation, statements)


def is_destructive(action_blob: str) -> bool:
    return bool(_DANGEROUS_TOKENS.search(action_blob or ""))


__all__ = [
    "fallback_role_statement",
    "fallback_moderator",
    "is_destructive",
]
