"""Ворота бети: розмова на ПК відповідає.

Виміряно сесією «Система» 03.09.2026 на живому журналі стенда — не здогад,
а три рядки поспіль:

    POST 127.0.0.1:11435/api/chat → 200          ← ollama ВІДПОВІВ
    ai/ollama_provider.py:127  msg = response.message
    AttributeError: 'dict' object has no attribute 'message'
    AIRouter.generate: ollama failed (network)

Розмова на ПК не відповідала ЖОДНОГО разу. Не «іноді», не «повільно» —
жодного, і не могла: `requirements.txt` пінить `ollama==0.3.1`, де
`ChatResponse` це TypedDict, а код писався під обʼєктне API ≥0.4.

Друга половина вади — класифікація. `AttributeError` у НАШОМУ розборі
підіймався як «мережа», тож єдиною порадою людині в полі було «перевір
звʼязок» — при тому, що сервер відповів 200 і перевіряти було нічого.

Форму відповіді сторож бере з ВСТАНОВЛЕНОГО клієнта, а не вигадує: інакше
він доводив би сумісність із бібліотекою, якої в пакунку немає.
"""
from __future__ import annotations

import os

import pytest

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-chat-answers")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-key")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


def _installed_client_returns_mappings() -> bool:
    """Чи віддає ВСТАНОВЛЕНИЙ ollama словники (0.3.x), а не обʼєкти."""
    try:
        from ollama._types import ChatResponse
    except Exception:  # noqa: BLE001
        return False
    return not hasattr(ChatResponse, "model_fields")


def test_the_pinned_client_shape_is_what_we_think_it_is():
    """Спершу доводимо ПОСИЛКУ. Якщо колись піднімуть бібліотеку, цей
    сторож скаже про це прямо, а не мовчки перевірятиме не ту форму."""
    import ollama._types as t

    assert hasattr(t, "ChatResponse"), "у клієнта немає ChatResponse — форма змінилась"


@pytest.mark.asyncio
async def test_a_dict_response_is_read_not_crashed():
    """Головні ворота: форма пінованого клієнта (словники) мусить читатись."""
    from ai.ollama_shape import content_of, message_of, tokens_of, tool_call_of

    response = {
        "model": "qwen2.5:7b",
        "message": {"role": "assistant", "content": "Привіт. Я тут."},
        "eval_count": 12,
        "prompt_eval_count": 30,
    }

    msg = message_of(response)
    assert content_of(msg) == "Привіт. Я тут."
    assert tool_call_of(msg) == (None, {})
    assert tokens_of(response) == 42


@pytest.mark.asyncio
async def test_an_object_response_is_read_too():
    """Після оновлення клієнта форма стане обʼєктною — і не повинна
    зламати розмову вдруге, вже в інший бік."""
    from types import SimpleNamespace

    from ai.ollama_shape import content_of, message_of, tool_call_of

    fn = SimpleNamespace(name="respond_chart", arguments={"title": "т"})
    call = SimpleNamespace(function=fn)
    msg = SimpleNamespace(content="", tool_calls=[call])
    response = SimpleNamespace(message=msg, eval_count=1, prompt_eval_count=2)

    got = message_of(response)
    assert content_of(got) == ""
    assert tool_call_of(got) == ("respond_chart", {"title": "т"})


def test_tool_calls_are_read_from_the_pinned_dict_shape():
    """У 0.3.x виклик інструмента — вкладені словники, не обʼєкти."""
    from ai.ollama_shape import tool_call_of

    msg = {
        "content": "",
        "tool_calls": [
            {"function": {"name": "respond_map", "arguments": {"lat": 50.4}}}
        ],
    }
    assert tool_call_of(msg) == ("respond_map", {"lat": 50.4})


def test_a_parse_failure_is_not_reported_as_a_network_fault():
    """Наша вада не має права виглядати обривом звʼязку: інакше єдиною
    порадою людині буде «перевір мережу», а перевіряти нема чого."""
    from ai.ollama_provider import _classify_ollama_error
    from ai.ollama_shape import OllamaShapeError
    from ai.tool_use import ToolErrorKind

    kind, retriable, _ = _classify_ollama_error(
        OllamaShapeError("у відповіді немає поля message")
    )
    assert kind is not ToolErrorKind.NETWORK
    assert kind is not ToolErrorKind.PROVIDER_UNAVAILABLE
    assert retriable is False, "повторювати наш власний розбір безглуздо"

    kind_attr, _, _ = _classify_ollama_error(
        AttributeError("'dict' object has no attribute 'message'")
    )
    assert kind_attr is not ToolErrorKind.NETWORK, (
        "рівно та вада: AttributeError у розборі звався мережею, і людина "
        "перевіряла звʼязок, якого не бракувало"
    )


def test_a_real_network_fault_is_still_a_network_fault():
    """Зворотний бік: розділивши класи, не можна втратити справжній обрив."""
    from ai.ollama_provider import _classify_ollama_error
    from ai.tool_use import ToolErrorKind

    kind, retriable, _ = _classify_ollama_error(
        ConnectionError("all connection attempts failed")
    )
    assert kind is ToolErrorKind.PROVIDER_UNAVAILABLE
    assert retriable is True


def test_the_provider_no_longer_reaches_for_dotted_message():
    """Сторож на джерело: доки в провайдері лишається `response.message`,
    пінований клієнт валитиме розмову на кожному листі."""
    import pathlib

    path = (
        pathlib.Path(__file__).resolve().parent.parent / "ai" / "ollama_provider.py"
    )
    # Тільки КОД: інакше сторож ловить власний пояснювальний коментар про
    # цю саму ваду й червоніє через себе, а не через продукт.
    src = "\n".join(
        line.split("#", 1)[0] for line in path.read_text(encoding="utf-8").splitlines()
    )
    assert "response.message" not in src, (
        "провайдер знову читає відповідь крапкою — на клієнті 0.3.x це "
        "AttributeError на КОЖНІЙ відповіді"
    )
