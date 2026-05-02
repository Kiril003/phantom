"""
Phase 17b — Conversational BuilderSession.

PHANTOM walks the operator through creating a CustomAgent in chat. The session
is a state machine: each step asks one focused question (re-using
`agent.needs.InfoNeed`), the user answers, the next step's question is
prepared with auto-suggested options that depend on the running draft.

Pipeline:
  1) start_builder(initial_intent) → returns first prompt + draft handle.
  2) advance(draft_id, answer) → records answer, prepares next prompt or
     finalises (saves agent → returns CustomAgent + run-now hint).

State is kept in-process (process-restart loses unfinished drafts; users can
re-start). Answers feed the auto-suggester deterministically; LLM auto-
suggestion is opt-in and falls back to templates when offline.

This module is wire-friendly: chat tool dispatcher exposes
`studio.start_builder` and `studio.builder_step` so the user can interact via
plain conversation.
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal

from .catalog import list_catalog
from .models import (
    AgentCard,
    AgentCardKind,
    CustomAgent,
    Recipient,
    Schedule,
)
from .repository import save_agent
from ..schemas import InfoNeed, InfoNeedOption

logger = logging.getLogger(__name__)


BuilderStep = Literal[
    "name",
    "description",
    "goal_template",
    "sources",
    "transforms",
    "outputs",
    "recipients",
    "schedule",
    "preview",
    "saved",
]

_STEP_ORDER: list[BuilderStep] = [
    "name",
    "description",
    "goal_template",
    "sources",
    "transforms",
    "outputs",
    "recipients",
    "schedule",
    "preview",
    "saved",
]


@dataclass
class BuilderDraft:
    id: str
    owner_user_id: str
    initial_intent: str
    name: str = ""
    description: str = ""
    goal_template: str = ""
    sources: list[AgentCardKind] = field(default_factory=list)
    transforms: list[AgentCardKind] = field(default_factory=list)
    outputs: list[AgentCardKind] = field(default_factory=list)
    recipients: list[Recipient] = field(default_factory=list)
    schedule: Schedule = field(default_factory=Schedule)
    step: BuilderStep = "name"
    started_at: datetime = field(default_factory=lambda: datetime.now(tz=timezone.utc))


_BUILDER_DRAFTS: dict[str, BuilderDraft] = {}


def _now() -> datetime:
    return datetime.now(tz=timezone.utc)


def _suggest_name(intent: str) -> list[str]:
    """Deterministic 3 alternatives derived from the user's intent words."""
    base = (intent or "Мій агент").strip().split()
    head = " ".join(base[:5]) if base else "Мій агент"
    return [
        head[:60],
        f"{head[:30]} — щоденно".strip(),
        f"Помічник: {head[:50]}".strip(),
    ][:3]


def _suggest_goal_template(name: str, intent: str) -> str:
    intent_clean = (intent or name).strip()
    return f"{intent_clean} — на {{{{date}}}}, користувач {{{{user.name}}}}"


def _category_options(category: str) -> list[InfoNeedOption]:
    out: list[InfoNeedOption] = []
    for entry in list_catalog():
        if entry["category"] == category:
            out.append(InfoNeedOption(
                id=entry["kind"],
                label=entry["title"],
                description=entry["description"],
                example=None,
            ))
    return out


def _recipient_options() -> list[InfoNeedOption]:
    return [
        InfoNeedOption(id="telegram", label="Telegram", description="Чат / канал по chat_id"),
        InfoNeedOption(id="email", label="Email", description="Будь-який email"),
        InfoNeedOption(id="chat_self", label="У PHANTOM-чат", description="Постити сюди ж у розмову"),
        InfoNeedOption(id="phantom_notify", label="OS-сповіщення", description="Сповіщення на пристрої"),
        InfoNeedOption(id="file", label="Файл", description="Збереження на диск"),
    ]


def _schedule_options() -> list[InfoNeedOption]:
    return [
        InfoNeedOption(id="manual", label="Вручну", description="Запускати кнопкою"),
        InfoNeedOption(id="daily_morning", label="Щодня вранці", description="08:00 щоранку"),
        InfoNeedOption(id="hourly", label="Щогодини", description="Раз на годину"),
        InfoNeedOption(id="weekly_monday", label="Щотижня (Пн)", description="Понеділок 09:00"),
        InfoNeedOption(id="custom_cron", label="Свій cron", description="Власний cron-вираз"),
    ]


def _build_info_need(draft: BuilderDraft) -> InfoNeed:
    """Compose the current step's typed prompt."""
    common = {"task_id": f"builder:{draft.id}"}

    if draft.step == "name":
        suggestions = _suggest_name(draft.initial_intent)
        return InfoNeed(
            kind="single_choice",
            question="Як назвемо агента?",
            hint="Можеш обрати з варіантів або відповісти своїм текстом.",
            options=[
                InfoNeedOption(id=s, label=s) for s in suggestions
            ],
            placeholder="Власна назва",
            required=True,
            **common,
        )
    if draft.step == "description":
        return InfoNeed(
            kind="text",
            question="Опиши коротко що робить цей агент.",
            hint="Зрозуміло за один-два рядки. Можна пропустити.",
            required=False,
            placeholder="Наприклад: щоранку шле зведенку погоди в Telegram.",
            **common,
        )
    if draft.step == "goal_template":
        return InfoNeed(
            kind="text",
            question="Сформулюй мету агента (можна з {{плейсхолдерами}}).",
            hint="Підтримуються {{date}}, {{datetime}}, {{user.name}} та твої власні поля.",
            default=_suggest_goal_template(draft.name, draft.initial_intent),
            required=True,
            **common,
        )
    if draft.step == "sources":
        return InfoNeed(
            kind="multi_choice",
            question="Звідки агенту брати дані?",
            hint="Обери одне або кілька джерел.",
            options=_category_options("source"),
            required=True,
            **common,
        )
    if draft.step == "transforms":
        return InfoNeed(
            kind="multi_choice",
            question="Що зробити з даними перед виходом?",
            hint="Опціонально — можна пропустити.",
            options=_category_options("transform"),
            required=False,
            **common,
        )
    if draft.step == "outputs":
        return InfoNeed(
            kind="multi_choice",
            question="Куди агенту віддавати результат?",
            hint="Обери один або кілька каналів виходу.",
            options=_category_options("output"),
            required=True,
            **common,
        )
    if draft.step == "recipients":
        return InfoNeed(
            kind="multi_choice",
            question="Кому надсилати?",
            hint="Можна додати кілька адресатів — далі ти вкажеш їх target'и.",
            options=_recipient_options(),
            required=False,
            **common,
        )
    if draft.step == "schedule":
        return InfoNeed(
            kind="single_choice",
            question="Як часто запускати?",
            options=_schedule_options(),
            default="manual",
            required=True,
            **common,
        )
    # preview — operator confirms (or backs out)
    summary = (
        f"Агент: «{draft.name}»\n"
        f"Мета: {draft.goal_template}\n"
        f"Джерела: {', '.join(draft.sources) or '—'}\n"
        f"Трансформації: {', '.join(draft.transforms) or '—'}\n"
        f"Виходи: {', '.join(draft.outputs) or '—'}\n"
        f"Адресати: {', '.join(r.channel for r in draft.recipients) or '—'}\n"
        f"Розклад: {draft.schedule.kind}"
    )
    return InfoNeed(
        kind="confirm",
        question="Зберегти агента з такими налаштуваннями?",
        hint=summary,
        required=True,
        **common,
    )


def _next_step(current: BuilderStep) -> BuilderStep:
    idx = _STEP_ORDER.index(current)
    if idx + 1 >= len(_STEP_ORDER):
        return current
    return _STEP_ORDER[idx + 1]


def _apply_answer(draft: BuilderDraft, answer: Any) -> None:
    if draft.step == "name":
        draft.name = str(answer or "").strip()[:160] or "Мій агент"
    elif draft.step == "description":
        draft.description = str(answer or "").strip()[:2000]
    elif draft.step == "goal_template":
        draft.goal_template = str(answer or "").strip()[:4000]
    elif draft.step == "sources":
        draft.sources = [a for a in (answer or []) if isinstance(a, str)]
    elif draft.step == "transforms":
        draft.transforms = [a for a in (answer or []) if isinstance(a, str)]
    elif draft.step == "outputs":
        draft.outputs = [a for a in (answer or []) if isinstance(a, str)]
    elif draft.step == "recipients":
        # Each picked channel becomes a placeholder Recipient — operator can
        # set targets later in the visual builder. The conversational path
        # keeps this lightweight.
        draft.recipients = [
            Recipient(channel=ch, target="", label=ch)
            for ch in (answer or [])
            if isinstance(ch, str)
        ]
    elif draft.step == "schedule":
        sched_map = {
            "manual": Schedule(kind="manual"),
            "daily_morning": Schedule(kind="cron", cron_expr="0 8 * * *"),
            "hourly": Schedule(kind="interval", interval_s=3600),
            "weekly_monday": Schedule(kind="cron", cron_expr="0 9 * * 1"),
            "custom_cron": Schedule(kind="cron", cron_expr=""),
        }
        draft.schedule = sched_map.get(str(answer), Schedule())


def _draft_to_agent(draft: BuilderDraft) -> CustomAgent:
    cards: list[AgentCard] = []
    for kind in draft.sources:
        cards.append(AgentCard(kind=kind, category="source", title=kind, config={}))
    for kind in draft.transforms:
        cards.append(AgentCard(kind=kind, category="transform", title=kind, config={}))
    for kind in draft.outputs:
        cards.append(AgentCard(kind=kind, category="output", title=kind, config={}))
    return CustomAgent(
        owner_user_id=draft.owner_user_id,
        name=draft.name or "Мій агент",
        description=draft.description,
        goal_template=draft.goal_template,
        cards=cards,
        recipients=draft.recipients,
        schedule=draft.schedule,
    )


# ── Public API ────────────────────────────────────────────────────────────


@dataclass
class BuilderTurn:
    draft_id: str
    step: BuilderStep
    info_need: InfoNeed | None
    finished: bool = False
    saved_agent_id: str | None = None
    summary: str | None = None


def start_builder(*, owner_user_id: str, initial_intent: str = "") -> BuilderTurn:
    draft = BuilderDraft(
        id=str(uuid.uuid4()),
        owner_user_id=owner_user_id,
        initial_intent=initial_intent.strip(),
    )
    _BUILDER_DRAFTS[draft.id] = draft
    info_need = _build_info_need(draft)
    return BuilderTurn(draft_id=draft.id, step=draft.step, info_need=info_need)


async def advance(*, draft_id: str, answer: Any) -> BuilderTurn:
    draft = _BUILDER_DRAFTS.get(draft_id)
    if draft is None:
        raise KeyError(f"unknown builder draft {draft_id}")

    if draft.step == "preview":
        # Confirm step.
        if not bool(answer):
            # user declined → drop draft.
            _BUILDER_DRAFTS.pop(draft_id, None)
            return BuilderTurn(
                draft_id=draft_id, step="preview", info_need=None,
                finished=True, summary="скасовано користувачем",
            )
        agent = _draft_to_agent(draft)
        await save_agent(agent)
        _BUILDER_DRAFTS.pop(draft_id, None)
        return BuilderTurn(
            draft_id=draft_id, step="saved", info_need=None,
            finished=True, saved_agent_id=agent.id,
            summary=f"Збережено агента «{agent.name}» з {len(agent.cards)} картками.",
        )

    _apply_answer(draft, answer)
    draft.step = _next_step(draft.step)
    if draft.step == "saved":
        # Should not happen in normal flow (preview always precedes saved)
        return BuilderTurn(
            draft_id=draft_id, step="saved", info_need=None,
            finished=True,
        )
    info_need = _build_info_need(draft)
    return BuilderTurn(
        draft_id=draft_id, step=draft.step, info_need=info_need,
    )


def cancel(draft_id: str) -> bool:
    return _BUILDER_DRAFTS.pop(draft_id, None) is not None


def list_drafts() -> list[BuilderDraft]:
    return list(_BUILDER_DRAFTS.values())


__all__ = [
    "BuilderTurn",
    "BuilderDraft",
    "BuilderStep",
    "start_builder",
    "advance",
    "cancel",
    "list_drafts",
]
