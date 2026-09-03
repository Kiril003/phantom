"""Обраний провайдер і той, хто відповість, — різні речі.

Виміряно Сесією 3 на живому стенді 03.09.2026: `/health` віддавав
`ai_active: "gemini"` на вузлі, де ключа Gemini немає ніде — ні `.env`, ні
змінної середовища з таким імʼям. Скло чесно повторило це поле й сказало
людині «Gemini · хмара · ключ», тобто пообіцяло провайдера, який без ключа
не відповість жодного разу.

Родина та сама, що «Поруч» і геокодер сьогодні: **вподобання видали за
стан**. Різниця лише в тому, що там мовчало джерело даних, а тут — той, хто
має говорити.

Сторожі тримають чотири речі:
  * без ключа `ai_ready` = false і причина словами (не «error», не порожньо);
  * з ключем — true і жодної причини;
  * стан НЕ ходить у хмару: інакше смуга організму, яка полить /health раз
    на секунди, платила б квотою за кожен кадр;
  * «хост живий» і «модель у памʼяті» лишаються різними полями — для людини
    це різниця між миттєвою відповіддю й хвилиною чекання.
"""
from __future__ import annotations

import os

import pytest

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-ai-ready")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-key")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


@pytest.fixture(autouse=True)
def _fresh():
    from ai.readiness import reset_cache

    reset_cache()
    yield
    reset_cache()


def _health() -> dict:
    from fastapi.testclient import TestClient

    from main import app

    return TestClient(app).get("/health").json()


def test_no_key_means_not_ready_and_says_why(monkeypatch):
    from config import config

    monkeypatch.setattr(config, "ai_primary_provider", "gemini")
    monkeypatch.setattr(config, "ai_gemini_api_key", "")

    body = _health()

    assert body["ai_active"] == "gemini", "обраний провайдер лишається видимим"
    assert body["ai_ready"] is False, (
        "вузол каже «gemini» там, де ключа немає — скло повторить це людині "
        "як обіцянку, якої ніхто не виконає"
    )
    assert body["ai_ready_reason"], "причина мусить бути, і словами"
    assert "ключ" in body["ai_ready_reason"].lower()


def test_a_configured_key_is_ready_without_asking_google(monkeypatch):
    """Наявність ключа — достатньо. Перевіряти валідність означало б ходити
    в мережу на КОЖЕН /health; різницю між «ключ є» і «ключ робочий» краще
    лишити чесно неназваною, ніж платити за неї щосекунди."""
    import httpx

    from config import config

    monkeypatch.setattr(config, "ai_primary_provider", "gemini")
    monkeypatch.setattr(config, "ai_gemini_api_key", "AIza-таке-собі")

    def _boom(*a, **kw):
        raise AssertionError("/health пішов у мережу — цього робити не можна")

    monkeypatch.setattr(httpx.AsyncClient, "get", _boom)
    monkeypatch.setattr(httpx.AsyncClient, "post", _boom)

    from config import config as cfg

    # Запасний теж не має нікуди ходити в цьому тесті.
    monkeypatch.setattr(cfg, "ai_fallback_provider", "none")

    body = _health()

    assert body["ai_ready"] is True
    assert body["ai_ready_reason"] is None


def test_a_dead_local_model_is_named_not_hidden(monkeypatch):
    from config import config

    monkeypatch.setattr(config, "ai_fallback_provider", "ollama")
    monkeypatch.setattr(config, "ai_ollama_host", "http://127.0.0.1:1")

    body = _health()

    assert body["ai_fallback_ready"] is False
    assert body["ai_fallback_reason"], "мовчазна локальна модель мусить сказати чому"


def test_host_alive_and_model_loaded_stay_separate(monkeypatch):
    """На цій машині `api/ps` показував НУЛЬ завантажених моделей: хост
    живий, а перший лист підняв би 4,7 ГБ. Одним словом «готовий» це
    описати не можна."""
    from ai import readiness

    monkeypatch.setattr(readiness.config, "ai_fallback_provider", "ollama")

    async def fake(*a, **kw):
        return True, None, False  # хост відповів, модель не в памʼяті

    monkeypatch.setattr(readiness, "_ollama_state", fake)
    readiness.reset_cache()

    body = _health()

    assert body["ai_fallback_ready"] is True
    assert body["ai_fallback_model_loaded"] is False, (
        "«хост живий» і «модель у памʼяті» злиті в одне — людина чекатиме "
        "миттєвої відповіді там, де буде хвилина завантаження"
    )
