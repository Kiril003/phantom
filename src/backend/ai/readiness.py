"""Хто справді може відповісти — на відміну від того, кого обрали.

Знайдено Сесією 3 на живому стенді 03.09.2026: `/health` віддавав
`ai_active: "gemini"` на вузлі, де ключа Gemini немає взагалі (ні `.env`,
ні змінної середовища з таким імʼям). Скло чесно повторювало це поле й
казало людині «Gemini · хмара · ключ» — стверджуючи провайдера, який без
ключа не відповість жодного разу.

Це та сама вада, що «Поруч» і геокодер сьогодні: **вподобання видавали за
стан**. Різниця лише в тому, що там мовчало джерело даних, а тут — той, хто
має говорити.

Ціна перевірки. `/health` полить смуга організму раз на секунди, тож похід
у мережу тут заборонений: він дав би або лаг на кожному кадрі, або спалену
квоту. Тому:
  * Gemini — перевіряємо НАЯВНІСТЬ ключа, не його валідність. Різницю між
    «ключ є» і «ключ робочий» лишаємо чесно неназваною: назвати її можна
    тільки справжнім запитом, а він щосекунди неприйнятний;
  * Ollama — локальний хост, коротка проба з кешем.

І окремо розрізняємо «хост живий» та «модель у памʼяті»: на цій машині
`api/ps` показував нуль завантажених моделей, тобто перший лист підняв би
4,7 ГБ. Для людини це різниця між миттєвою відповіддю й хвилиною чекання,
і ховати її під одним словом «готовий» означало б обіцяти те, чого нема.
"""
from __future__ import annotations

import logging
import time
from typing import Any

from config import config

logger = logging.getLogger(__name__)

#: Проба локального хоста живе секунди: смуга організму питає часто, а
#: ollama не зникає між двома кадрами.
_TTL_S = 10.0
_cache: dict[str, Any] = {"at": 0.0, "value": None}


def _gemini_state() -> tuple[bool, str | None]:
    if not str(getattr(config, "ai_gemini_api_key", "") or "").strip():
        return False, "ключа Gemini немає — хмарна модель не відповість"
    return True, None


async def _ollama_state() -> tuple[bool, str | None, bool | None]:
    """(готовий, причина, чи модель у памʼяті)."""
    host = str(getattr(config, "ai_ollama_host", "") or "").rstrip("/")
    model = str(getattr(config, "ai_ollama_model", "") or "")
    if not host:
        return False, "локальний хост моделі не налаштований", None

    try:
        import httpx

        async with httpx.AsyncClient(timeout=1.5) as client:
            tags = await client.get(f"{host}/api/tags")
            tags.raise_for_status()
            installed = [m.get("name") for m in (tags.json().get("models") or [])]
            if model and model not in installed:
                return (
                    False,
                    f"хост відповідає, але моделі {model} на ньому немає",
                    False,
                )
            loaded: bool | None = None
            try:
                ps = await client.get(f"{host}/api/ps")
                ps.raise_for_status()
                running = [m.get("name") for m in (ps.json().get("models") or [])]
                loaded = bool(model) and model in running
            except Exception:  # noqa: BLE001 — «не знаю» краще за вигадане False
                loaded = None
    except Exception as exc:  # noqa: BLE001
        logger.debug("ollama readiness probe failed: %s", exc)
        return False, f"локальна модель не відповідає ({type(exc).__name__})", None

    return True, None, loaded


async def ai_readiness() -> dict[str, Any]:
    """Стан обох провайдерів для `/health`. Ніколи не кидає."""
    now = time.monotonic()
    cached = _cache.get("value")
    if cached is not None and (now - float(_cache["at"])) < _TTL_S:
        return dict(cached)

    primary = str(getattr(config, "ai_primary_provider", "") or "")
    fallback = str(getattr(config, "ai_fallback_provider", "") or "")

    async def state_of(name: str):
        if name == "gemini":
            ready, reason = _gemini_state()
            return ready, reason, None
        if name == "ollama":
            return await _ollama_state()
        return None, f"провайдер {name!r} невідомий цьому вузлу", None

    try:
        p_ready, p_reason, _ = await state_of(primary)
        f_ready, f_reason, f_loaded = await state_of(fallback)
    except Exception as exc:  # noqa: BLE001 — стан не валить /health
        logger.debug("ai readiness failed: %s", exc)
        return {
            "ai_ready": None,
            "ai_ready_reason": f"стан не прочитано: {type(exc).__name__}",
            "ai_fallback_ready": None,
            "ai_fallback_reason": None,
            "ai_fallback_model_loaded": None,
        }

    value = {
        "ai_ready": p_ready,
        "ai_ready_reason": p_reason,
        "ai_fallback_ready": f_ready,
        "ai_fallback_reason": f_reason,
        # None = не питали або не змогли спитати. «Хост живий» і «модель у
        # памʼяті» — різні обіцянки людині.
        "ai_fallback_model_loaded": f_loaded,
    }
    _cache["at"] = now
    _cache["value"] = value
    return dict(value)


def reset_cache() -> None:
    _cache["at"] = 0.0
    _cache["value"] = None
