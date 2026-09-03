"""Вузол не має казати «не вмію» там, де вміє.

Знайдено сесією «Система» 03.09.2026 читанням, із рядками:
  * `ai/tool_executor.py` — `search_web` без ключа Gemini віддавав глуху
    відмову «web search unavailable via local model»;
  * `agent/actions/web.py::WebSearch` — DuckDuckGo, БЕЗ жодного ключа,
    RiskLevel.SAFE, у реєстрі дій;
  * `ai/chat_tools.py` — `agent.delegate` є серед інструментів розмови,
    тобто шлях до цього пошуку з діалогу існував;
  * але опис delegate, який ЧИТАЄ МОДЕЛЬ, називав лише «Security Auditor,
    Backend Dev, UX Designer» — про пошук ні слова.

На стенді ключа Gemini немає (`/health` каже `ai_ready: false`). Отже
розмова чесно казала людині «не вмію шукати», маючи справний пошук за один
виклик. Це не брак спроможності — це знання, яке не доходило до того, хто
ухвалює рішення. Найдорожчий різновид німоти: все працює, ніхто не знає.

Сторожі тримають три речі:
  * без ключа `search_web` ШУКАЄ, а не відмовляє;
  * результат НАЗИВАЄ джерело (`engine`), бо «знайдено в Google» і
    «знайдено в DuckDuckGo» — різні обіцянки щодо повноти;
  * опис `agent.delegate` згадує пошук, інакше модель знову не дізнається.
"""
from __future__ import annotations

import os

import pytest

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-keyless-search")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-key")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


@pytest.mark.asyncio
async def test_without_a_key_the_node_searches_instead_of_refusing(monkeypatch):
    from ai import tool_executor
    from config import config

    monkeypatch.setattr(config, "ai_gemini_api_key", "")

    class _Result:
        ok = True
        output = {
            "query": "погода",
            "results": [
                {"title": "Погода", "url": "https://e.x/1", "snippet": "хмарно"},
            ],
        }

    async def fake_execute(self, ctx):
        return _Result()

    import agent.actions.web as web

    monkeypatch.setattr(web.WebSearch, "execute", fake_execute)

    out = await tool_executor._tool_search_web({"query": "погода"}, "u1")

    assert out.get("ok") is True, (
        f"без ключа вузол знову відмовляє, маючи справний пошук: {out}"
    )
    assert out["sources"], "пошук нічого не повернув"
    assert out["sources"][0]["url"] == "https://e.x/1"


@pytest.mark.asyncio
async def test_the_answer_names_which_engine_found_it(monkeypatch):
    """«Знайдено в Google» і «знайдено в DuckDuckGo» — різні обіцянки щодо
    повноти; видавати одне за інше означало б обіцяти те, чого нема."""
    from ai import tool_executor
    from config import config

    monkeypatch.setattr(config, "ai_gemini_api_key", "")

    class _Result:
        ok = True
        output = {"results": []}

    async def fake_execute(self, ctx):
        return _Result()

    import agent.actions.web as web

    monkeypatch.setattr(web.WebSearch, "execute", fake_execute)

    out = await tool_executor._tool_search_web({"query": "будь-що"}, "u1")

    assert out.get("engine") == "duckduckgo"


@pytest.mark.asyncio
async def test_a_failing_search_is_named_not_silently_empty(monkeypatch):
    from ai import tool_executor
    from config import config

    monkeypatch.setattr(config, "ai_gemini_api_key", "")

    class _Result:
        ok = False
        error = "web_search_failed: ConnectError"
        output = None

    async def fake_execute(self, ctx):
        return _Result()

    import agent.actions.web as web

    monkeypatch.setattr(web.WebSearch, "execute", fake_execute)

    out = await tool_executor._tool_search_web({"query": "будь-що"}, "u1")

    assert out.get("ok") is not True
    assert "ConnectError" in str(out), "порожній успіх замість названої відмови"


def test_the_model_is_told_the_agent_can_search():
    """Модель ухвалює рішення за ОПИСОМ. Доки опис мовчав про пошук, шлях
    існував і був невидимий."""
    from ai.chat_tools import CHAT_DATA_TOOLS

    delegate = next(
        (t for t in CHAT_DATA_TOOLS if t.get("name") == "agent.delegate"), None
    )
    assert delegate is not None, "agent.delegate зник з інструментів розмови"
    text = delegate["description"].lower()
    assert "шукати" in text or "пошук" in text, (
        "опис delegate не згадує пошук — модель знову казатиме «не вмію», "
        "маючи справний пошук за один виклик"
    )


def test_no_stock_photo_host_in_any_backend_response():
    """Аватарка бота тягнулась із images.unsplash.com: дані події справжні,
    картинка декоративна — але щоб її показати, польовий пристрій ходив у
    фотобанк і повідомляв третій стороні, що застосунок працює і коли."""
    import pathlib
    import re

    backend = pathlib.Path(__file__).resolve().parent.parent
    offenders: list[str] = []
    for path in backend.rglob("*.py"):
        if ".venv" in path.parts or "tests" in path.parts:
            continue
        for num, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            code = line.split("#", 1)[0]
            if re.search(r"unsplash|images\.pexels|cdn\.pixabay", code):
                offenders.append(f"{path.name}:{num}")
    assert not offenders, (
        "відповідь бекенда веде пристрій у стоковий фотобанк: " + ", ".join(offenders)
    )
