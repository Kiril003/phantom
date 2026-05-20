"""Dedicated artifact generation — Gemini 2.5 Pro, big budget, draft →
rubric self-critique → rewrite. Independent of the chat model/budget."""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Awaitable, Callable

from ai.provider import ai_router
from config import config

logger = logging.getLogger(__name__)

PhaseCallback = Callable[[str, "str | None"], Awaitable[None]]


class ArtifactStudioError(Exception):
    """Raised when the draft pass yields no usable document — callers
    degrade (never a dead bubble / never a raw code dump)."""


@dataclass
class Brief:
    title: str
    request: str
    hint: str = ""


_FENCE_RE = re.compile(r"```(?:[a-zA-Z0-9_+-]*)\n(.*?)\n?```", re.DOTALL)
_DOC_RE = re.compile(r"<!doctype html.*?</html\s*>", re.IGNORECASE | re.DOTALL)


def _strip_to_document(text: str) -> str | None:
    if not text:
        return None
    for m in _FENCE_RE.finditer(text):
        body = m.group(1).strip()
        if re.search(r"<!doctype html|<html[\s>]|<body[\s>]", body, re.IGNORECASE):
            return body
    m = _DOC_RE.search(text)
    if m:
        return m.group(0).strip()
    if re.search(r"<body[\s>]", text, re.IGNORECASE):
        return text.strip()
    return None


ELITE_SYSTEM_PROMPT = (
    "Ти — елітний інженер-дизайнер інтерактивних артефактів. "
    "Згенеруй ОДИН повний самодостатній HTML-документ — закінчений, "
    "високоякісний продукт.\n"
    "ВИМОГИ:\n"
    "• ПОВНА СВОБОДА ДИЗАЙНУ: Створюй унікальний, вражаючий візуал. "
    "Вибирай кольорову гаму, стиль та типографіку відповідно до запиту.\n"
    "• АДАПТИВНІСТЬ: Артефакт має ідеально заповнювати 100% ширини та висоти "
    "контейнера. Використовуй сучасні методи верстки (Flexbox, Grid).\n"
    "• ІНТЕРАКТИВНІСТЬ ТА АНІМАЦІЯ: Додавай глибоку інтерактивність та "
    "осмислені анімації, якщо це доречно.\n"
    "• НУЛЬ ЗАГЛУШОК: Жодних TODO чи порожніх елементів.\n"
    "• САМОДОСТАТНІСТЬ: Всі стилі та скрипти мають бути всередині документа. "
    "Нічого не завантажуй з мережі.\n"
    "ВИВІД: ТІЛЬКИ документ (від <!doctype html> до </html>). Без прози."
)


CRITIQUE_SYSTEM_PROMPT = (
    "Ти — арт-директор. Оціни HTML-артефакт.\n"
    "1. Чи відповідає дизайн високим стандартам якості?\n"
    "2. Чи заповнює він весь доступний простір адаптивно?\n"
    "3. Чи є він повністю робочим та самодостатнім?\n"
    "Якщо все чудово — відповідай `OK`. Інакше — перепиши документ ПОВНІСТЮ, "
    "зробивши його досконалим."
)


def _brief_message(b: Brief) -> str:
    parts = [f"НАЗВА: {b.title}".strip(), f"ЗАПИТ КОРИСТУВАЧА:\n{b.request}".strip()]
    if b.hint.strip():
        parts.append(
            "ЧЕРНЕТКА-СИГНАЛ (якщо є, врахуй намір, але зроби професійніше):\n"
            f"{b.hint[:4000]}"
        )
    return "\n\n".join(p for p in parts if p)


async def build_artifact(
    brief: Brief,
    *,
    user_id: str,
    on_phase: PhaseCallback | None = None,
) -> tuple[str, str]:
    """Return (title, html). Draft pass then ≤ ai_artifact_max_revisions
    critique/rewrite passes; stop early on `OK`. Raises
    ArtifactStudioError if the draft pass yields no document.
    """
    async def _emit(phase: str, preview: str | None) -> None:
        if on_phase is not None:
            try:
                await on_phase(phase, preview)
            except Exception as exc:  # noqa: BLE001
                logger.debug("artifact on_phase callback failed (%s): %s", phase, exc)

    # Resolve model: if 'auto', use the primary gemini model
    model = config.ai_artifact_model
    if model == "auto":
        model = config.ai_gemini_model

    try:
        draft_text = await ai_router.generate_raw(
            system_prompt=ELITE_SYSTEM_PROMPT,
            user_message=_brief_message(brief),
            model=model,
            max_output_tokens=config.ai_artifact_max_tokens,
            temperature=0.8,
        )
    except Exception as exc:
        raise ArtifactStudioError(f"draft pass failed: {exc}") from exc

    html = _strip_to_document(draft_text)
    if not html:
        raise ArtifactStudioError("draft pass produced no HTML document")

    await _emit("draft", html)

    for _ in range(max(0, int(config.ai_artifact_max_revisions))):
        await _emit("critiquing", None)
        try:
            verdict = await ai_router.generate_raw(
                system_prompt=CRITIQUE_SYSTEM_PROMPT,
                user_message=html,
                model=model,
                max_output_tokens=config.ai_artifact_max_tokens,
                temperature=0.4,
            )
        except Exception as exc:
            logger.warning("artifact_studio critique pass failed: %s", exc)
            break
        if verdict.strip() == "OK":
            break
        improved = _strip_to_document(verdict)
        if not improved:
            break
        html = improved
        await _emit("polishing", html)

    await _emit("done", html)
    return brief.title, html
