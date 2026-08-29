"""PHANTOM не ходить у мережу сам — і найменше під час запису в пам'ять.

Що тут стерегли. `build_embedding_function` пробує підняти модель з диска
(`local_files_only=True`), і доти все гаразд. Але в гілці except раніше
стояв другий виклик — уже без цього прапорця, тобто з походом на
huggingface.co, — а в журнал ішов рядок рівня INFO. Виклик сидить під
`strategic_memory._get_ef()`, тобто на шляху ЗВИЧАЙНОГО запису в пам'ять.
Отже машина користувача мовчки виходила назовні під час дії, яку продукт
обіцяє тримати локальною, і єдиним слідом був рядок у логах.

Тести перевіряють не «є фолбек чи ні», а спостережувану поведінку на
дроті: скільки разів і з якими прапорцями конструюється модель. Мовчазний
похід у мережу тут неможливо зробити зеленим.
"""
from __future__ import annotations

import pytest

from memory.embedding_fn import EmbeddingModelMissing, build_embedding_function

MODEL = "intfloat/multilingual-e5-small"


class _Spy:
    """Записує кожну спробу підняти модель, з усіма прапорцями."""

    def __init__(self) -> None:
        self.calls: list[dict] = []

    @property
    def offline_attempts(self) -> list[dict]:
        return [c for c in self.calls if c.get("local_files_only")]

    @property
    def network_attempts(self) -> list[dict]:
        """Виклик без `local_files_only` — це і є похід у мережу."""
        return [c for c in self.calls if not c.get("local_files_only")]


@pytest.fixture
def spy(monkeypatch) -> _Spy:
    """Підміняє конструктор Chroma так, ніби моделі на диску немає."""
    recorder = _Spy()

    class _Fake:
        def __init__(self, **kwargs) -> None:
            recorder.calls.append(kwargs)
            if kwargs.get("local_files_only"):
                raise OSError("модель не в кеші")

        def __call__(self, input):  # noqa: A002 — протокол Chroma
            return [[0.0] * 384 for _ in input]

    from chromadb.utils import embedding_functions as ef

    monkeypatch.setattr(ef, "SentenceTransformerEmbeddingFunction", _Fake)
    monkeypatch.delenv("PHANTOM_ALLOW_MODEL_DOWNLOAD", raising=False)
    return recorder


def test_missing_model_raises_instead_of_going_to_the_network(spy, monkeypatch):
    monkeypatch.setenv("SENTENCE_TRANSFORMERS_HOME", "/nowhere/st")

    with pytest.raises(EmbeddingModelMissing) as caught:
        build_embedding_function(MODEL)

    # Найважливіше твердження файлу: другого виклику не було взагалі.
    assert spy.network_attempts == [], (
        "модель піднімали без local_files_only — це тихий похід у мережу"
    )
    assert len(spy.offline_attempts) == 1

    # Помилка має бути придатною до дії: назва моделі і де її шукали.
    message = str(caught.value)
    assert MODEL in message
    assert "/nowhere/st" in message
    assert "PHANTOM_ALLOW_MODEL_DOWNLOAD" in message


def test_download_happens_only_when_the_operator_says_so(spy, monkeypatch):
    monkeypatch.setenv("PHANTOM_ALLOW_MODEL_DOWNLOAD", "1")

    fn = build_embedding_function(MODEL)

    assert fn is not None
    assert len(spy.network_attempts) == 1, "явний дозвіл не привів до завантаження"


def test_a_cached_model_never_asks_the_network(monkeypatch):
    """Щасливий шлях лишається офлайновим — жодного зайвого виклику."""
    recorder = _Spy()

    class _Cached:
        def __init__(self, **kwargs) -> None:
            recorder.calls.append(kwargs)

        def __call__(self, input):  # noqa: A002
            return [[0.0] * 384 for _ in input]

    from chromadb.utils import embedding_functions as ef

    monkeypatch.setattr(ef, "SentenceTransformerEmbeddingFunction", _Cached)
    monkeypatch.delenv("PHANTOM_ALLOW_MODEL_DOWNLOAD", raising=False)

    build_embedding_function(MODEL)

    assert len(recorder.calls) == 1
    assert recorder.network_attempts == []
