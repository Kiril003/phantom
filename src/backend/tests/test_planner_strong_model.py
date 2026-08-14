"""Root cause of 'критична помилка виконання' on EVERY mission: the
strategic planner called ai_router.generate (weak default
gemini-flash-lite + RESPONSE_FORM_TOOLS attached, which defeats Gemini
strict-JSON mime) → the model returned prose ('План дій для отримання
останніх новин.') instead of JSON twice → strategic_planner_invalid_json
→ task aborted. Fix: planner uses generate_raw (NO tools) on a forced
strong model — the proven ArtifactStudio pattern for structured output.
"""
import pytest

from config import config


def test_planner_model_config_default():
    """Asserts the SHIPPED default, not the resolved value.

    `src/backend/.env` legitimately overrides the model for local work, so a
    test that read `config.ai_planner_model` failed on every developer machine
    and passed in CI — which is exactly how a guard stops being read. What must
    hold is that the value we ship is the strong one.
    """
    field = type(config).model_fields["ai_planner_model"]
    assert field.default == "gemini-2.5-pro", (
        f"shipped planner default is {field.default!r} — a weak model here "
        "returned prose instead of JSON and aborted every mission; see this "
        "file's own docstring."
    )
    assert config.ai_planner_max_tokens >= 4096


@pytest.mark.asyncio
async def test_planner_call_uses_generate_raw_strong_model(monkeypatch):
    from agent.cognition.planner import _llm

    seen = {}

    async def fake_raw(*, system_prompt, user_message, model,
                        max_output_tokens, temperature=0.7):
        seen.update(model=model, sp=system_prompt, um=user_message)
        return '{"sub_goals": []}'

    monkeypatch.setattr(_llm.ai_router, "generate_raw", fake_raw)
    out = await _llm._call("PLAN THIS", task_id="t1")
    assert out == '{"sub_goals": []}'
    assert seen["model"] == config.ai_planner_model
    assert "JSON" in seen["sp"]
    assert seen["um"] == "PLAN THIS"


@pytest.mark.asyncio
async def test_llm_json_succeeds_with_strong_model(monkeypatch):
    from agent.cognition.planner import _llm

    async def fake_raw(**kw):
        return '{"sub_goals": [{"description": "fetch news"}]}'

    monkeypatch.setattr(_llm.ai_router, "generate_raw", fake_raw)
    data = await _llm.llm_json("plan: останні новини", task_id="t2")
    assert data["sub_goals"][0]["description"] == "fetch news"
