"""Памʼять, якої немає, мусить сказати про себе словами.

У пакунок бети модель ембедингів не їде навмисно — як і голосові моделі
29.08. Плюс `_phantom_entry` переносить HF_HOME у `<user_data>/models/hf_cache`,
який на кожній машині порожній. Отже перший же запис у стратегічну памʼять
кидає ``EmbeddingModelMissing``, а той гине в ``except Exception`` десь на
шляху виклику.

Для людини це виглядало так: памʼять є, вона нічого не запамʼятовує, і ніде
жодного напису — ні в застосунку, ні в /health. Мовчання набувало форми
робочої підсистеми.

Ці сторожі тримають три речі:
  * стан читається З ДИСКА, без мережі й без побудови моделі — тобто його
    видно саме тоді, коли памʼять НЕ працює;
  * стан ніколи не кидає (інакше він упаде разом з тим, про що звітує);
  * /health несе його назовні, щоб скло мало що показати.
"""
from __future__ import annotations

import os

import pytest

from memory.embedding_fn import EmbeddingModelMissing, model_state

MODEL = "intfloat/multilingual-e5-small"

CACHE_VARS = (
    "SENTENCE_TRANSFORMERS_HOME",
    "HUGGINGFACE_HUB_CACHE",
    "HF_HOME",
)


@pytest.fixture
def bare_machine(tmp_path, monkeypatch):
    """Машина без жодної моделі: усі кеші вказують у порожнє, і дім теж —
    інакше сторож побачив би модель розробника й був би зеленим за
    побудовою на цій машині й лише на ній."""
    empty = tmp_path / "empty-cache"
    empty.mkdir()
    for var in CACHE_VARS:
        monkeypatch.setenv(var, str(empty))
    monkeypatch.setenv("HOME", str(tmp_path / "nobody"))
    monkeypatch.delenv("PHANTOM_ALLOW_MODEL_DOWNLOAD", raising=False)
    return empty


def test_missing_model_is_a_named_state_not_silence(bare_machine):
    state = model_state(MODEL)

    assert state["present"] is False
    assert state["model"] == MODEL
    # Причина — для людини, і мусить називати саме модель, а не «error».
    assert MODEL in state["reason"]
    assert len(state["reason"]) > 40, "причина мусить бути реченням, не кодом"
    # І мусить бути видно, що назовні ми не пішли самі.
    assert state["download_allowed"] is False
    assert "PHANTOM_ALLOW_MODEL_DOWNLOAD" in state["reason"]
    # Де саме шукали — інакше «не знайдено» не можна перевірити руками.
    assert state["searched"], "стан мусить називати переглянуті місця"


def test_present_model_is_seen_in_the_hub_layout(bare_machine):
    """Розкладка кешу hub: models--<org>--<name>. Якщо перевірка її не
    знає, вона казатиме «немає» на цілком встановленій моделі."""
    (bare_machine / ("models--" + MODEL.replace("/", "--"))).mkdir()

    state = model_state(MODEL)

    assert state["present"] is True
    assert state["reason"] is None
    assert state["path"] == str(bare_machine)


def test_allowing_the_download_changes_what_we_promise(bare_machine, monkeypatch):
    monkeypatch.setenv("PHANTOM_ALLOW_MODEL_DOWNLOAD", "1")

    state = model_state(MODEL)

    assert state["present"] is False
    assert state["download_allowed"] is True
    assert "PHANTOM_ALLOW_MODEL_DOWNLOAD" not in state["reason"], (
        "коли завантаження вже дозволене, радити його вдруге — брехня про стан"
    )


def test_state_never_raises_even_on_a_broken_cache_path(tmp_path, monkeypatch):
    """Стан памʼяті не має права стати причиною поломки того, що про нього
    звітує: він читається саме тоді, коли навколо вже щось не так.

    Нульовий байт тут НЕ перевіряємо навмисно — `os.environ` його просто не
    приймає, тож такий тест доводив би властивість середовища, а не коду.
    Беремо те, що справді трапляється: кеш вказує на файл, а не на теку;
    на нечитабельний шлях; і на імʼя, довше за межу файлової системи."""
    not_a_dir = tmp_path / "cache-is-a-file"
    not_a_dir.write_text("не тека", encoding="utf-8")
    monkeypatch.setenv("SENTENCE_TRANSFORMERS_HOME", str(not_a_dir))
    monkeypatch.setenv("HUGGINGFACE_HUB_CACHE", "/proc/self/mem")
    monkeypatch.setenv("HF_HOME", str(tmp_path / ("x" * 400)))

    state = model_state(MODEL)

    assert state["present"] in (True, False)
    assert state["model"] == MODEL


def test_refusal_carries_its_own_type():
    """Той, хто ловить, мусить уміти відрізнити «немає моделі» від
    «зламався Chroma» — інакше єдиною реакцією буде broad-except, і ми
    повернемось до тієї самої мовчанки."""
    assert issubclass(EmbeddingModelMissing, RuntimeError)


def test_health_carries_the_memory_state():
    """Скло не має іншого джерела: без цього поля єдиним проявом мертвої
    памʼяті лишається тиша."""
    os.environ.setdefault("JWT_SECRET_KEY", "test-secret-memory-state")
    os.environ.setdefault("AI_GEMINI_API_KEY", "fake-key")
    os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")

    from fastapi.testclient import TestClient

    from main import app

    body = TestClient(app).get("/health").json()

    assert "memory_model" in body, (
        "/health мовчить про памʼять — саме через це мертву памʼять "
        "не було видно нізвідки"
    )
    assert body["memory_model"]["model"], "стан мусить називати модель"
