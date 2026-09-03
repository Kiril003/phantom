"""Продукт не мовчить, коли голос є на машині.

Виміряно 31.08 на цій машині: **нейронний український голос лежав робочий і
не використовувався**.

* `supertonic` (MIT) у venv і в бандлі sidecar — 34 згадки всередині бінарника;
* ваги 386 МБ у `~/.cache/supertonic3`, українська в переліку мов;
* прямий виклик давав **3,41 с справжнього звуку** за 3 с;
* а `build_tts_provider` пробував **лише Piper**, двійника якого в PATH немає
  й жодного з пʼяти каталогів голосів теж — тобто гарантовано падав у тишу;
* опція `voice_tts_engine` з трьома значеннями **не читалася ніким**;
* `lifespan_warmup` імпортував `preload_tts`, якої не існувало ніде, і
  `ImportError` лягав у журнал рядком «TTS preload skipped», що виглядає буденно.

Тобто відмова була не в коді синтезу, а в тому, що **його ніхто не питав**.

ЧОГО ЦЕЙ СТОРОЖ НЕ ДОВОДИТЬ: що людина почула звук у колонках. Він доводить,
що продукт **обирає рушій, який уміє говорити, коли той доступний**, і не
падає в тишу мовчки. Далі стоїть пристрій, і це інше твердження.
"""
from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest


def _weights_present() -> bool:
    d = Path.home() / ".cache" / "supertonic3"
    return (d / "onnx").is_dir() and (d / "voice_styles").is_dir()


def test_factory_reads_the_engine_option():
    """Опція, яку ніхто не читає, — це налаштування, що нічого не робить."""
    import inspect

    from voice import tts_engine

    src = inspect.getsource(tts_engine.build_tts_provider)
    assert "voice_tts_engine" in src, (
        "build_tts_provider не читає `voice_tts_engine`. Опція існує в конфізі "
        "з трьома значеннями і мовчки не діє — саме так Supertonic пів року "
        "лишався невибраним."
    )


def test_supertonic_is_offered_before_silence():
    """Тиша — останній варіант, а не другий."""
    import inspect

    from voice import tts_engine

    assert hasattr(tts_engine, "SupertonicTTSProvider"), (
        "провайдера Supertonic немає — рушій, що лежить на машині робочий, "
        "знову нікому запропонувати"
    )
    src = inspect.getsource(tts_engine.build_tts_provider)
    assert "SupertonicTTSProvider" in src, (
        "фабрика не згадує Supertonic: він написаний і не викликаний"
    )


def test_preload_tts_exists_and_is_importable():
    """`lifespan_warmup` імпортує саме це імʼя на кожному старті."""
    from voice import pipeline

    assert hasattr(pipeline, "preload_tts"), (
        "voice.pipeline.preload_tts немає, а lifespan_warmup його імпортує — "
        "ImportError на кожному старті, проковтнутий у warning"
    )


def test_warmup_lane_imports_what_exists():
    """Сторож на сам ланцюг: те, що імпортує смуга розігріву, мусить бути."""
    import inspect

    from lifespan_warmup import _lane_tts_preload

    src = inspect.getsource(_lane_tts_preload)
    assert "preload_tts" in src
    from voice.pipeline import preload_tts  # noqa: F401  — саме те імʼя


@pytest.mark.skipif(
    importlib.util.find_spec("supertonic") is None or not _weights_present(),
    reason="Supertonic або його ваги відсутні на цій машині",
)
def test_when_the_voice_is_installed_the_product_does_not_choose_silence():
    """Головне твердження: є голос — продукт його бере."""
    from voice.tts_engine import build_tts_provider

    provider = build_tts_provider()
    assert provider.name != "silent", (
        f"обрано «{provider.name}», хоча Supertonic і його ваги на машині є. "
        "Саме цей мовчазний вибір і був дефектом."
    )
