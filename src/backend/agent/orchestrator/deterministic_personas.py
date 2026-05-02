"""
Phase 17 — Skeleton-mode council statements.

When `ai_router.generate` is unreachable (quota / Ollama down / both), each
AgentRole still needs to "speak" so the UI keeps showing the deliberation
drama. This module produces deterministic `RoleStatement`s built from the
situation snapshot using rule-based heuristics.

Goal: useful enough that the consensus is correct most of the time on
plain-language cases, while making it visually obvious that the council is
in skeleton mode (a pinned banner on the FE; we set
`generation_strategy="deterministic"` on the resulting `CouncilDecision`).
"""
from __future__ import annotations

import re
from typing import Any

from ..schemas import (
    CouncilSituation,
    CouncilSituationKind,
    RoleName,
    RoleStatement,
)


# Patterns that indicate destructive intent — RiskAssessor uses them to push
# back when the proposed_action mentions any of these tokens.
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
        text = (
            "Не варто гадати — переходимо до прицільного запиту. "
            "Можна ставити вузьке питання користувачу."
        )
        confidence = 0.65
    elif situation.kind == "strategic_revise":
        text = (
            "Стратегію треба переглянути. Ріжемо зайве і ставимо одну "
            "наступну під-ціль із чітким acceptance-критерієм."
        )
        confidence = 0.55
    elif situation.kind == "before_destructive":
        text = (
            "Перш ніж робити незворотну дію — додаємо точку відкату або "
            "запитуємо явну згоду. Навіть якщо це коштує одну ітерацію."
        )
        confidence = 0.7
    else:
        text = (
            "Тримаймо курс. Якщо є під-ціль із acceptance-критерієм — "
            "наступний крок відомий, виконуємо."
        )
        confidence = 0.5
    return RoleStatement(role="planner", text=text, confidence=confidence)


def _critic_statement(situation: CouncilSituation) -> RoleStatement:
    blob = _proposed_action_blob(situation)
    objections: list[RoleName] = []
    text = "Поки що не бачу очевидних дірок. Готовий пропустити."
    confidence = 0.5
    if _PLACEHOLDER_TOKENS.search(blob) or _PLACEHOLDER_TOKENS.search(situation.summary):
        text = (
            "В намірі є плейсхолдери (TODO/FIXME). Не випускаємо такий результат — "
            "це не ‘готово’, це ‘поки що’."
        )
        confidence = 0.85
        objections = ["executor"]
    elif situation.monologue is not None and situation.monologue.confidence < 0.4:
        text = (
            "Виконавець сам сумнівається (confidence нижче 0.4). Перевіряємо ще "
            "раз acceptance-критерії — якщо немає — формулюємо."
        )
        confidence = 0.7
        objections = ["executor"]
    elif situation.kind == "quality_gate":
        text = (
            "Перед випуском прогон по acceptance-критеріях, синтаксис, "
            "посилання. Якщо хоч одне не пройшло — ревізія."
        )
        confidence = 0.7
    return RoleStatement(
        role="critic",
        text=text,
        confidence=confidence,
        objection_to=objections,
    )


def _executor_statement(situation: CouncilSituation) -> RoleStatement:
    pa = situation.proposed_action or {}
    if isinstance(pa, dict) and pa.get("action"):
        action = str(pa.get("action"))
        args = pa.get("args")
        text = f"Готовий виконати ‘{action}’. Аргументи зрозумілі."
        return RoleStatement(
            role="executor",
            text=text,
            confidence=0.6,
            suggests_action={"action": action, "args": args or {}},
        )
    if situation.kind == "info_need":
        return RoleStatement(
            role="executor",
            text="Без додаткового вводу не зможу робити кроки далі — потрібна відповідь.",
            confidence=0.5,
        )
    return RoleStatement(
        role="executor",
        text="Конкретної дії в ситуації не бачу. Очікую формулювання.",
        confidence=0.4,
    )


def _researcher_statement(situation: CouncilSituation) -> RoleStatement:
    if situation.kind == "info_need":
        return RoleStatement(
            role="researcher",
            text=(
                "Можу спробувати знайти відповідь у вебі чи в стратегічній пам'яті "
                "перш ніж лізти до користувача. Швидкий пошук — недорогий."
            ),
            confidence=0.6,
        )
    if situation.kind == "strategic_revise":
        return RoleStatement(
            role="researcher",
            text=(
                "Перш ніж переглядати стратегію — я б перевірив чи всі ввідні "
                "дані актуальні. Можливо змінилися джерела."
            ),
            confidence=0.5,
        )
    return RoleStatement(
        role="researcher",
        text="З мого боку зараз достатньо контексту, додаткових пошуків не пропоную.",
        confidence=0.4,
    )


def _risk_assessor_statement(situation: CouncilSituation) -> RoleStatement:
    blob = _proposed_action_blob(situation)
    if _DANGEROUS_TOKENS.search(blob):
        return RoleStatement(
            role="risk_assessor",
            text=(
                "В дії я бачу руйнівний шаблон. Без явної згоди користувача "
                "або dry-run не пропускаю."
            ),
            confidence=0.9,
            objection_to=["executor"],
        )
    if situation.kind == "before_destructive":
        return RoleStatement(
            role="risk_assessor",
            text=(
                "Дія потенційно незворотна. Або робимо чекпойнт перед, або "
                "звужуємо до dry-run."
            ),
            confidence=0.75,
        )
    if situation.kind == "low_confidence":
        return RoleStatement(
            role="risk_assessor",
            text=(
                "При низькій впевненості шанс зашкодити користувачу зростає. "
                "Якщо результат буде потім важко відмінити — краще запитати."
            ),
            confidence=0.6,
        )
    return RoleStatement(
        role="risk_assessor",
        text="Помітних ризиків поки не бачу. Не блокую.",
        confidence=0.5,
    )


def _skeptic_statement(situation: CouncilSituation) -> RoleStatement:
    if situation.kind in {"strategic_revise", "low_confidence"}:
        return RoleStatement(
            role="skeptic",
            text=(
                "А якщо рішення не спрацює — у нас є запасний план? Якщо ні, "
                "то перш ніж робити, формулюємо що саме робитимемо при провалі."
            ),
            confidence=0.55,
        )
    if situation.kind == "before_destructive":
        return RoleStatement(
            role="skeptic",
            text=(
                "Уявіть найгірше: дія стерла потрібне. Чи в цьому випадку у нас "
                "є хоч одне джерело відновлення?"
            ),
            confidence=0.7,
        )
    return RoleStatement(
        role="skeptic",
        text="Можливо ми пропускаємо ‘нічого не робити’ як варіант. Він теж легітимний.",
        confidence=0.4,
    )


def _aesthete_statement(situation: CouncilSituation) -> RoleStatement:
    return RoleStatement(
        role="aesthete",
        text=(
            "Якщо вихід побачить людина — переконаймося що форма зрозуміла з "
            "першого погляду. Без надмірних деталей."
        ),
        confidence=0.5,
    )


def _moderator_statement(
    situation: CouncilSituation,
    statements: list[RoleStatement],
) -> RoleStatement:
    """Builds a 'best-of' summary statement and a chosen action."""
    objections = sum(len(s.objection_to) for s in statements)
    confidences = [s.confidence for s in statements] or [0.5]
    avg_conf = sum(confidences) / len(confidences)
    has_block = any(
        s.role in {"critic", "risk_assessor"} and s.objection_to
        for s in statements
    )
    if has_block:
        verdict_text = (
            "Чую заперечення з боку Critic/RiskAssessor. Поки що не пропускаю — "
            "пропоную або revise, або запит до користувача."
        )
        confidence = max(0.3, avg_conf - 0.15)
    elif objections == 0:
        verdict_text = (
            "Заперечень немає. Йдемо за пропозицією Executor як найменш ризикованою."
        )
        confidence = avg_conf
    else:
        verdict_text = (
            "Є зауваження, але без блокерів. Робимо найбезпечніший варіант, "
            "тоді переоцінюємо."
        )
        confidence = max(0.4, avg_conf - 0.05)
    chosen = None
    for s in statements:
        if s.suggests_action and s.role == "executor":
            chosen = s.suggests_action
            break
    return RoleStatement(
        role="moderator",
        text=verdict_text,
        confidence=min(1.0, max(0.0, confidence)),
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
