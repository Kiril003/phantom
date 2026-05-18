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
    "Ти — елітний інженер-дизайнер інтерактивних артефактів рівня Claude. "
    "Згенеруй ОДИН повний самодостатній HTML-документ — закінчений продукт, "
    "не демо.\n"
    "ВИМОГИ:\n"
    "• Виразний, оригінальний візуал — НЕ генеричний AI-вигляд. Продумана "
    "типографіка, простір, кольорова система, глибина.\n"
    "• Заповни поверхню 1024×600 landscape повністю. Без крихітних "
    "елементів по центру, без скролу хост-екрана.\n"
    "• Осмислена анімація що несе сенс (стан, перехід, дані) — не "
    "декоративна.\n"
    "• Повна інтерактивність якщо бриф це передбачає: робочі контролі, "
    "стан, зворотний звʼязок.\n"
    "• НУЛЬ заглушок: жодних TODO, lorem, '// implement', порожніх "
    "обробників, мертвих кнопок.\n"
    "• НУЛЬ мережі: inline CSS/JS, <canvas>/SVG, зображення лише data:. "
    "Жодних CDN/зовнішніх бібліотек/fetch/WebSocket.\n"
    "• Доступність: клавіатура + ARIA. Стійкий JS — жодних неперехоплених "
    "виключень.\n"
    "ВИВІД: ТІЛЬКИ документ (від <!doctype html> до </html>). Без прози, "
    "без markdown-огорожі, без пояснень."
)

CRITIQUE_SYSTEM_PROMPT = (
    "Ти — суворий арт-директор. Оціни HTML-артефакт за рубрикою. Якщо "
    "КОЖНА вісь проходить — відповідай РІВНО `OK` (два символи, нічого "
    "більше). Інакше — поверни ПОВНІСТЮ переписаний кращий документ "
    "(тільки документ, без прози, без огорожі), що усуває найслабші осі.\n"
    "РУБРИКА:\n"
    "1. Візуальна насиченість і оригінальність (не генерично).\n"
    "2. Повнота — нуль заглушок/мертвих контролів.\n"
    "3. Глибина інтерактивності відповідно до брифа.\n"
    "4. Влучання в поверхню 1024×600 без overflow.\n"
    "5. Осмисленість анімації.\n"
    "6. Продуктивність — без jank, обмежені цикли.\n"
    "7. Самодостатність — нуль мережі/CDN."
)


def _brief_message(b: Brief) -> str:
    parts = [f"НАЗВА: {b.title}".strip(), f"ЗАПИТ КОРИСТУВАЧА:\n{b.request}".strip()]
    if b.hint.strip():
        parts.append(
            "ЧЕРНЕТКА-НАТЯК (лише як сигнал наміру, НЕ копіюй, зроби "
            f"набагато краще):\n{b.hint[:4000]}"
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

    When ``on_phase`` is supplied it is awaited at each generation phase:
      on_phase("draft", html)       — after draft html is extracted
      on_phase("critiquing", None)  — before each critique/rewrite pass
      on_phase("polishing", html)   — after a critique rewrites html
      on_phase("done", html)        — at the very end

    Absent callback ⇒ byte-identical existing behaviour.
    """
    async def _emit(phase: str, preview: str | None) -> None:
        if on_phase is not None:
            try:
                await on_phase(phase, preview)
            except Exception as exc:  # noqa: BLE001
                logger.debug("artifact on_phase callback failed (%s): %s", phase, exc)

    try:
        draft_text = await ai_router.generate_raw(
            system_prompt=ELITE_SYSTEM_PROMPT,
            user_message=_brief_message(brief),
            model=config.ai_artifact_model,
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
                model=config.ai_artifact_model,
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
