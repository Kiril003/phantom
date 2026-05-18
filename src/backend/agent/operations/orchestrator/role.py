"""
AgentRole — one perspective inside a Council.

Each role has its own system prompt + emphasis. The base `AgentRole.deliberate`
calls `ai_router.generate` with the role-tinted prompt and returns a
`RoleStatement`. Failures are caught and delegated to deterministic_personas
(handled by `Council`) so a quota-exhausted provider never silences a role.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any

from ...schemas import (
    CouncilSituation,
    RoleName,
    RoleStatement,
)

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class _RoleProfile:
    name: RoleName
    emoji: str
    headline: str
    emphasis: str
    temperature_hint: float


_ROLE_PROFILES: dict[RoleName, _RoleProfile] = {
    "planner": _RoleProfile(
        name="planner",
        emoji="🗺",
        headline="Planner",
        emphasis=(
            "Ти стратег. Дивишся на задачу як на дерево під-цілей. "
            "Шукаєш найкоротший шлях, без зайвих гілок. Проти нечіткого формулювання."
        ),
        temperature_hint=0.3,
    ),
    "critic": _RoleProfile(
        name="critic",
        emoji="🔎",
        headline="Critic",
        emphasis=(
            "Ти прискіпливий редактор. Шукаєш помилки логіки, прогалини, "
            "розриви між наміром і дією. Якщо є хоч одна слабка ланка — кажеш."
        ),
        temperature_hint=0.2,
    ),
    "executor": _RoleProfile(
        name="executor",
        emoji="🛠",
        headline="Executor",
        emphasis=(
            "Ти практик. Тобі цікаво ЯК зробити ЗАРАЗ. Пропонуєш конкретну "
            "дію (action+args), а не абстракцію. Любиш дрібні reversible кроки."
        ),
        temperature_hint=0.4,
    ),
    "researcher": _RoleProfile(
        name="researcher",
        emoji="📚",
        headline="Researcher",
        emphasis=(
            "Ти дослідник. Питаєш ‘а ми точно знаємо?’ Шукаєш брак фактів, "
            "пропонуєш звідки доповнити (web/доки/пам'ять). Не любиш здогади."
        ),
        temperature_hint=0.4,
    ),
    "risk_assessor": _RoleProfile(
        name="risk_assessor",
        emoji="⚠",
        headline="Risk Assessor",
        emphasis=(
            "Ти інспектор з безпеки. Все міряєш через ‘що може зламатися?’ "
            "Зворотність, дані, людський час, репутаційний наслідок. Кажеш чесно."
        ),
        temperature_hint=0.2,
    ),
    "aesthete": _RoleProfile(
        name="aesthete",
        emoji="🎨",
        headline="Aesthete",
        emphasis=(
            "Ти художник з оком на UX. Дивишся на форму: чи буде красиво, "
            "інтуїтивно, з гідністю. Викликаєшся коли задача про користувача."
        ),
        temperature_hint=0.6,
    ),
    "skeptic": _RoleProfile(
        name="skeptic",
        emoji="🜂",
        headline="Skeptic",
        emphasis=(
            "Ти devil's advocate. Завжди питаєш ‘а якщо ні?’. Знаходиш сценарій "
            "де план провалиться. Не саботуєш — захищаєш від самообману."
        ),
        temperature_hint=0.5,
    ),
    "moderator": _RoleProfile(
        name="moderator",
        emoji="⚖",
        headline="Moderator",
        emphasis=(
            "Ти ведучий. Слухаєш всіх, формулюєш консенсус, обираєш дію. "
            "Якщо думки розійшлись — береш найменш ризиковану з прийнятних."
        ),
        temperature_hint=0.2,
    ),
    "verifier": _RoleProfile(
        name="verifier",
        emoji="✓",
        headline="Verifier",
        emphasis=(
            "Ти останній бар'єр. Перевіряєш чи фінальний результат відповідає "
            "початковому наміру і acceptance-критеріям. Не пропускаєш half-baked."
        ),
        temperature_hint=0.1,
    ),
}


_DELIBERATE_PROMPT = """\
Контекст ситуації, на яку рада зараз дивиться:

KIND: {kind}
МЕТА/SUMMARY: {summary}
ЩО АГЕНТ ПЛАНУЄ ЗРОБИТИ: {proposed_action}
ВНУТРІШНЯ ДУМКА АГЕНТА: {monologue}
ДОДАТКОВИЙ КОНТЕКСТ: {context}

Твоя роль — {role_headline} ({role_name}). Емфаза:
{role_emphasis}

Твоє завдання — повернути ОДИН JSON-об'єкт без коментарів, без markdown:

{{
  "text": "1-3 речення що ти кажеш у вигляді репліки в раді (українською, від першої особи)",
  "confidence": 0.0..1.0,
  "objection_to": [],            // список ролей яким ти заперечуєш (можна порожній)
  "suggests_action": null         // або {{"action": "...", "args": {{}}}} якщо хочеш запропонувати конкретну дію
}}

JSON:"""


class AgentRole:
    """One perspective inside a Council. Stateless — call deliberate() per round."""

    def __init__(self, name: RoleName) -> None:
        if name not in _ROLE_PROFILES:
            raise ValueError(f"unknown role {name!r}")
        self.profile = _ROLE_PROFILES[name]

    @property
    def name(self) -> RoleName:
        return self.profile.name

    @property
    def emoji(self) -> str:
        return self.profile.emoji

    async def deliberate(
        self,
        situation: CouncilSituation,
        *,
        ai_router: Any,
        task_id: str | None = None,
        timeout_s: float = 6.0,
    ) -> RoleStatement | None:
        """Call the LLM in this role's voice. Returns None on any failure so
        the caller (Council) can swap in a deterministic persona statement."""
        prompt = _DELIBERATE_PROMPT.format(
            kind=situation.kind,
            summary=(situation.summary or "")[:600],
            proposed_action=json.dumps(
                situation.proposed_action or {}, ensure_ascii=False, default=str,
            )[:600],
            monologue=(
                situation.monologue.model_dump_json()[:600]
                if situation.monologue is not None
                else "(none)"
            ),
            context=json.dumps(
                situation.context or {}, ensure_ascii=False, default=str,
            )[:600],
            role_headline=self.profile.headline,
            role_name=self.profile.name,
            role_emphasis=self.profile.emphasis,
        )
        try:
            response = await ai_router.generate(
                user_message=prompt,
                system_prompt=(
                    "Ти учасник ради ШІ-агентів. Відповідай ЛИШЕ JSON. "
                    "Жодного markdown, жодних коментарів."
                ),
                history=[],
                task_id=task_id,
            )
        except Exception as exc:
            logger.debug("role %s LLM call failed: %s", self.profile.name, exc)
            return None

        text = (response.content or "").strip()
        if not text:
            return None
        if text.startswith("```"):
            text = text.strip("` \n")
            if text.lower().startswith("json"):
                text = text[4:].strip()
        try:
            data = json.loads(text)
        except Exception:
            start = text.find("{")
            end = text.rfind("}")
            if start < 0 or end <= start:
                return None
            try:
                data = json.loads(text[start:end + 1])
            except Exception:
                return None
        if not isinstance(data, dict):
            return None

        objection_to_raw = data.get("objection_to") or []
        if not isinstance(objection_to_raw, list):
            objection_to_raw = []
        objection_to: list[RoleName] = []
        for r in objection_to_raw:
            if isinstance(r, str) and r in _ROLE_PROFILES:
                objection_to.append(r)  # type: ignore[arg-type]

        suggests_raw = data.get("suggests_action")
        suggests_action = suggests_raw if isinstance(suggests_raw, dict) else None

        try:
            confidence = float(data.get("confidence", 0.5))
        except Exception:
            confidence = 0.5
        confidence = max(0.0, min(1.0, confidence))

        text_field = str(data.get("text") or "").strip()
        if not text_field:
            return None

        return RoleStatement(
            role=self.profile.name,
            text=text_field[:1200],
            confidence=confidence,
            objection_to=objection_to,
            suggests_action=suggests_action,
        )


def build_default_council_roles(*, include_aesthete: bool = False) -> list[AgentRole]:
    """Default 5-role council: Planner, Critic, Executor, RiskAssessor, Skeptic.

    `Aesthete` is opt-in (UI-flavoured tasks only) so casual technical work
    doesn't get bogged down in design debates.
    """
    base: list[RoleName] = ["planner", "critic", "executor", "risk_assessor", "skeptic"]
    if include_aesthete:
        base.append("aesthete")
    return [AgentRole(name) for name in base]


def role_profiles_dict() -> dict[str, dict[str, Any]]:
    """For diagnostic / FE-catalog endpoints."""
    return {
        p.name: {
            "name": p.name,
            "emoji": p.emoji,
            "headline": p.headline,
            "emphasis": p.emphasis,
            "temperature_hint": p.temperature_hint,
        }
        for p in _ROLE_PROFILES.values()
    }


__all__ = [
    "AgentRole",
    "build_default_council_roles",
    "role_profiles_dict",
]
