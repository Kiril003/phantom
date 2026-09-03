"""Відповідь ollama читається однаково, якою б формою вона не приїхала.

Знайдено сесією «Система» 03.09.2026 на живому журналі стенда:

    POST 127.0.0.1:11435/api/chat → 200          ← ollama ВІДПОВІВ
    ai/ollama_provider.py:127  msg = response.message
    AttributeError: 'dict' object has no attribute 'message'
    AIRouter.generate: ollama failed (network)

Тобто розмова на ПК не відповідала ЖОДНОГО разу — не «іноді», не «повільно»,
а жодного. `requirements.txt` пінить `ollama==0.3.1`, де `ChatResponse` — це
TypedDict (перевірено на встановленому пакеті: `model_fields` немає, лише
анотації), а код писався під обʼєктне API ≥0.4.

Чому не «підняти бібліотеку». Пакунок бети везе саме цей venv, і зміна
версії клієнта напередодні релізу — це зміна того, що поїде людям, заради
косметики виклику. Дешевше й чесніше навчитись читати ОБИДВІ форми: сьогодні
приїде dict, після оновлення — обʼєкт, і жодна з них не зламає розмову.

І окремо про класи відмов. `AttributeError` у розборі відповіді підіймався
як «ollama failed (network)» — тобто наша власна вада вбиралась у мережеву.
Людина в полі перевіряла б звʼязок, якого не бракувало: сервер відповів 200.
Тому тут два різні винятки, і провайдер їх розрізняє.
"""
from __future__ import annotations

from typing import Any


class OllamaShapeError(RuntimeError):
    """Відповідь приїхала, але ми не змогли її прочитати.

    НЕ мережа: сервер відповів. Окремий тип, щоб маршрутизатор не називав
    нашу ваду розбору обривом звʼязку — інакше єдиною порадою людині буде
    «перевір мережу», а перевіряти там нема чого.
    """


def _get(obj: Any, key: str) -> Any:
    """Поле однаково з dict і з обʼєкта."""
    if obj is None:
        return None
    if isinstance(obj, dict):
        return obj.get(key)
    return getattr(obj, key, None)


def message_of(response: Any) -> Any:
    msg = _get(response, "message")
    if msg is None:
        raise OllamaShapeError(
            "у відповіді ollama немає поля `message` "
            f"(тип {type(response).__name__}) — форму клієнта не розпізнано"
        )
    return msg


def content_of(message: Any) -> str:
    return str(_get(message, "content") or "")


def tool_call_of(message: Any) -> tuple[str | None, dict[str, Any]]:
    """(імʼя функції, аргументи) або (None, {}) — обидві форми клієнта.

    У 0.3.x це вкладені словники, у ≥0.4 — обʼєкти з `.function.name`.
    """
    calls = _get(message, "tool_calls") or []
    if not calls:
        return None, {}
    first = calls[0]
    fn = _get(first, "function")
    name = _get(fn, "name")
    raw = _get(fn, "arguments")
    args = dict(raw) if isinstance(raw, dict) else {}
    return (str(name) if name else None), args


def tokens_of(response: Any) -> int:
    evaluated = _get(response, "eval_count") or 0
    prompt = _get(response, "prompt_eval_count") or 0
    try:
        return int(evaluated) + int(prompt)
    except (TypeError, ValueError):
        return 0
