"""
Phase 17b — CustomAgent compiler.

Transforms a saved CustomAgent (cards DAG + recipients + run-time inputs)
into a goal string + structured "plan_seed" hint that the existing
agent_runtime can consume. We deliberately don't bypass the planner: the
agent loop still does its own ReAct + Reflect cycle. The compiled output
just gives the planner a strong starting point so card-driven flows
deterministically produce the same shape.

Public API:
  compile(agent, inputs) -> CompiledRun
    .goal           — substituted goal_template
    .plan_seed      — list[dict] hints for the strategic planner (one per card)
    .recipients     — copy of the agent's recipients for the executor to use
    .summary        — short human-readable description for audit
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from .models import (
    AgentCard,
    AgentCardLink,
    CustomAgent,
    Recipient,
)

logger = logging.getLogger(__name__)


_TEMPLATE_RE = re.compile(r"\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}")


@dataclass
class CompiledRun:
    goal: str
    plan_seed: list[dict[str, Any]]
    recipients: list[Recipient]
    summary: str
    inputs: dict[str, Any] = field(default_factory=dict)


def _builtin_value(name: str, *, user_name: str | None = None) -> str | None:
    if name == "date":
        return datetime.now(tz=timezone.utc).strftime("%Y-%m-%d")
    if name == "datetime":
        return datetime.now(tz=timezone.utc).strftime("%Y-%m-%d %H:%M")
    if name == "user.name" and user_name:
        return user_name
    return None


def _resolve(template: str, inputs: dict[str, Any], user_name: str | None) -> str:
    def _sub(match: re.Match[str]) -> str:
        key = match.group(1)
        if key in inputs:
            v = inputs[key]
            if isinstance(v, (list, tuple)):
                return ", ".join(str(x) for x in v)
            return str(v)
        builtin = _builtin_value(key, user_name=user_name)
        if builtin is not None:
            return builtin
        # Leave unmatched tokens visible so the planner can pick them up as
        # missing-info hints.
        return match.group(0)
    return _TEMPLATE_RE.sub(_sub, template)


def _topo_sort(cards: list[AgentCard], links: list[AgentCardLink]) -> list[AgentCard]:
    """Kahn topological sort. Cards without explicit links keep their order."""
    by_id = {c.id: c for c in cards}
    indegree: dict[str, int] = {c.id: 0 for c in cards}
    successors: dict[str, list[str]] = {c.id: [] for c in cards}
    for link in links:
        if link.from_card_id in by_id and link.to_card_id in by_id:
            successors[link.from_card_id].append(link.to_card_id)
            indegree[link.to_card_id] = indegree.get(link.to_card_id, 0) + 1

    queue = [c for c in cards if indegree.get(c.id, 0) == 0]
    out: list[AgentCard] = []
    while queue:
        c = queue.pop(0)
        out.append(c)
        for sid in successors.get(c.id, []):
            indegree[sid] -= 1
            if indegree[sid] == 0:
                queue.append(by_id[sid])
    if len(out) != len(cards):
        # Cycle — fall back to original order. Validator should catch this.
        logger.warning("studio compiler: card graph has cycle, falling back")
        return list(cards)
    return out


def _card_to_seed(card: AgentCard, inputs: dict[str, Any]) -> dict[str, Any]:
    """Translate a card into a planner hint dict.

    Each hint:
      {
        "card_id": ...,
        "kind": ...,
        "category": ...,
        "title": ...,
        "intent": "human-readable sentence",
        "expected_actions": int,
        "config": {...substituted...},
      }
    """
    config = dict(card.config or {})
    # Light substitution inside string config values.
    for k, v in list(config.items()):
        if isinstance(v, str):
            config[k] = _resolve(v, inputs, user_name=None)

    intent = _intent_for(card)
    return {
        "card_id": card.id,
        "kind": card.kind,
        "category": card.category,
        "title": card.title or card.kind,
        "intent": intent,
        "expected_actions": _expected_actions_for(card),
        "config": config,
    }


def _intent_for(card: AgentCard) -> str:
    if card.title:
        return card.title
    return {
        "web_search": "Знайти потрібну інформацію в інтернеті",
        "rss": "Підтягти останні елементи RSS-стрічки",
        "email_inbox": "Прочитати свіжі листи",
        "file_watch": "Перевірити цільову теку на зміни",
        "api_poll": "Запитати зовнішнє API",
        "db_query": "Виконати запит до власної БД",
        "mobile_sensor": "Зчитати показники з мобільного телефона",
        "summarize": "Згорнути отримані дані в коротке резюме",
        "compare": "Порівняти дані між собою",
        "filter": "Відфільтрувати дані за критерієм",
        "sort": "Відсортувати дані",
        "extract": "Витягти потрібні поля з даних",
        "diff": "Знайти зміни порівняно з минулим прогоном",
        "score": "Оцінити елементи за ваговими правилами",
        "if": "Розгалуження — перевірити умову",
        "branch": "Розгалуження по гілках",
        "loop": "Прокрутити цикл",
        "retry": "Спробувати ще раз з backoff",
        "ask_user": "Запитати у користувача",
        "write_file": "Записати результат у файл",
        "send_email": "Надіслати листа",
        "send_telegram": "Надіслати у Telegram",
        "post_to_api": "Запостити на зовнішнє API",
        "create_report": "Скласти підсумковий звіт",
        "notify": "Сповістити користувача в OS",
        "review_by_council": "Прогнати результат через раду",
    }.get(card.kind, f"Виконати картку {card.kind}")


def _expected_actions_for(card: AgentCard) -> int:
    return {
        "web_search": 1,
        "rss": 1,
        "email_inbox": 1,
        "file_watch": 1,
        "api_poll": 1,
        "db_query": 1,
        "mobile_sensor": 1,
        "summarize": 2,
        "compare": 2,
        "filter": 1,
        "sort": 1,
        "extract": 2,
        "diff": 2,
        "score": 1,
        "if": 1,
        "branch": 1,
        "loop": 3,
        "retry": 2,
        "ask_user": 1,
        "write_file": 1,
        "send_email": 1,
        "send_telegram": 1,
        "post_to_api": 1,
        "create_report": 2,
        "notify": 1,
        "review_by_council": 2,
    }.get(card.kind, 2)


def compile(  # noqa: A001 — match plan vocabulary
    agent: CustomAgent,
    inputs: dict[str, Any] | None = None,
    *,
    user_name: str | None = None,
) -> CompiledRun:
    """Substitute templates + topologically sort cards into a planner-ready seed."""
    inputs = dict(inputs or {})
    sorted_cards = _topo_sort(list(agent.cards), list(agent.links))
    plan_seed = [_card_to_seed(c, inputs) for c in sorted_cards]
    goal = _resolve(agent.goal_template or agent.name, inputs, user_name=user_name)
    summary = (
        f"CustomAgent '{agent.name}' з {len(plan_seed)} карток · "
        f"{len(agent.recipients)} отримувач(ів)."
    )
    return CompiledRun(
        goal=goal,
        plan_seed=plan_seed,
        recipients=list(agent.recipients),
        summary=summary,
        inputs=inputs,
    )


__all__ = ["compile", "CompiledRun"]
