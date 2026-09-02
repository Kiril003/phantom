"""
PHANTOM OS — Nuitka onefile entrypoint.

Compiled by ``scripts/build/nuitka_build.py`` into a single executable.
``main.py`` remains the dev/test entrypoint; this module exists solely to
sequence multiprocessing-freeze, env defaults, and ``sys.path`` priming
**before** any backend module loads. Order matters here — moving any block
will break Nuitka onefile on Windows or the data-path resolver on Linux.

Layout next to the produced binary (created at first launch):

    phantom-os(.exe)
    models/        — downloaded by ``download-models.py`` or first run
    data/          — sqlite + chroma runtime data
    frontend/      — vite build (if shipped alongside)
"""
from __future__ import annotations

import multiprocessing as _mp
import os
import sys
from pathlib import Path


def _binary_dir() -> Path:
    # Nuitka onefile sets ``sys.argv[0]`` to the user-facing binary while
    # ``__file__`` points into the (temporary) extracted bundle. We want the
    # *outer* directory the user sees, so prefer ``sys.argv[0]`` and fall
    # back to ``sys.executable`` for safety on edge cases (symlinks, sudo).
    candidates = [Path(sys.argv[0]).resolve(), Path(sys.executable).resolve()]
    for cand in candidates:
        if cand.is_file():
            return cand.parent
    return Path.cwd()


def _writable_root(binary_root: Path) -> Path:
    """Куди класти дані: поруч із бінарником чи в теку користувача.

    Портативна тека поруч із виконуваним файлом — гарна ідея рівно доти,
    доки та тека доступна на запис. В AppImage вона НЕ доступна: образ
    монтується лише для читання, і `mkdir` падає з
    `OSError: [Errno 30] Read-only file system`. Заміряно 29.08.2026 на
    зібраному AppImage — бекенд помирав на цьому рядку ще до першого
    запиту, а оболонка показувала лише «ядро не піднялося», бо потік
    виводу sidecar тоді ще викидався в нікуди.

    Запасний шлях не вигадуємо: `paths.py` вже має домовленість для
    непортативного випадку — `platformdirs.user_data_dir("PHANTOM",
    "PHANTOM-OS")`, і ADR-DSH-002 прямо каже, що запаковані збірки
    живуть саме там. Перевіряємо запис не припущенням про формат
    пакунка, а спробою: єдиний надійний тест файлової системи — це запис
    у неї.
    """
    probe = binary_root / ".phantom-write-probe"
    try:
        binary_root.mkdir(parents=True, exist_ok=True)
        probe.touch()
        probe.unlink()
        return binary_root
    except OSError:
        import platformdirs

        fallback = Path(platformdirs.user_data_dir("PHANTOM", "PHANTOM-OS"))
        print(
            f"[phantom] тека поруч із бінарником недоступна на запис "
            f"({binary_root}) — дані йдуть у {fallback}",
            file=sys.stderr,
        )
        return fallback


def _bootstrap_env() -> Path:
    root = _writable_root(_binary_dir())
    data_dir = root / "data"
    models_dir = root / "models"
    frontend_dir = _binary_dir() / "frontend"
    data_dir.mkdir(parents=True, exist_ok=True)
    models_dir.mkdir(parents=True, exist_ok=True)

    # Env defaults — only set when operator hasn't overridden. Backend
    # modules read these via ``config.py`` / ``paths.py``.
    os.environ.setdefault("PHANTOM_DATA_DIR", str(data_dir))
    os.environ.setdefault("PHANTOM_MODELS_DIR", str(models_dir))
    os.environ.setdefault("PHANTOM_FRONTEND_DIST", str(frontend_dir))
    os.environ.setdefault(
        "DATABASE_URL",
        f"sqlite+aiosqlite:///{(data_dir / 'phantom.db').as_posix()}",
    )
    os.environ.setdefault("CHROMA_PATH", str(data_dir / "chroma"))

    # Hugging Face / transformers caches — keep them inside our models dir
    # so the portable folder is fully self-contained.
    hf_cache = models_dir / "hf_cache"
    hf_cache.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("HF_HOME", str(hf_cache))
    os.environ.setdefault("HUGGINGFACE_HUB_CACHE", str(hf_cache))
    os.environ.setdefault("TRANSFORMERS_CACHE", str(hf_cache))
    os.environ.setdefault("SENTENCE_TRANSFORMERS_HOME", str(models_dir / "st_cache"))

    # Reproducible logs + safe defaults
    os.environ.setdefault("PYTHONUTF8", "1")
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    os.environ.setdefault("OMP_NUM_THREADS", "4")
    os.environ.setdefault("MKL_NUM_THREADS", "4")

    # Другий замок на телеметрію Chroma. Код бекенда своє робить чесно:
    # кожен `PersistentClient` відкривається з `anonymized_telemetry=False`,
    # і на це навіть стоїть тест, що обходить AST і валиться на будь-якому
    # конструкторі без `settings=`. Але в зібраному бандлі 29.08 у журналі
    # все одно з'явилось `Failed to send telemetry event ClientStartEvent` —
    # тобто бібліотека пробує відправити подію повз наш прапорець, і не
    # відправила лише тому, що в неї розійшлась сигнатура posthog. Покладатись
    # на чужу поламану залежність як на заслін приватності не можна.
    # Chroma читає й змінну середовища — ставимо і її, до першого імпорту.
    os.environ.setdefault("ANONYMIZED_TELEMETRY", "False")

    return root


def _force_utf8_locale() -> None:
    """Не дати чистій машині вбити старт на кодуванні.

    Знайдено 29.08 на розпакованому AppImage, запущеному з порожнім
    оточенням (`env -i`, без LANG і LC_ALL) — тобто рівно так, як його
    запустить systemd-юніт, контейнер або кіоск:

        configparser … encoding="locale" → encodings/ascii.py
        UnicodeDecodeError: 'ascii' codec can't decode byte 0xe2

    Без локалі Python вважає кодуванням ASCII, а `alembic.ini` містить
    тире «—» (U+2014) у коментарях першого рядка. Alembic читає його з
    `encoding="locale"`, давиться на першому ж не-ASCII байті, і застосунок
    помирає на міграціях ще до першого запиту. На машині розробника, де
    LANG=…UTF-8, цього не побачити ніколи.

    Лікуємо не файл, а клас: один коментар можна переписати на дефіс, але
    наступний не-ASCII рядок у будь-якому конфізі поверне ту саму смерть.
    `PYTHONUTF8=1` тут не поможе — його читають ДО старту інтерпретатора, а
    ми вже всередині; перезапускати ж себе в onefile-бандлі означає ще раз
    розпакувати 567 МБ. Тому просто ставимо LC_CTYPE: `locale.getencoding()`
    питає поточну локаль, тож наступні читання підуть у UTF-8.
    """
    import locale

    for candidate in ("C.UTF-8", "en_US.UTF-8", "uk_UA.UTF-8"):
        try:
            locale.setlocale(locale.LC_CTYPE, candidate)
            os.environ.setdefault("LC_CTYPE", candidate)
            return
        except locale.Error:
            continue
    # Жодної UTF-8 локалі в системі. Не падаємо — але й не мовчимо:
    # далі можливий саме той UnicodeDecodeError, заради якого це написано.
    print(
        "[phantom] УВАГА: не знайшов UTF-8 локалі (C.UTF-8/en_US/uk_UA). "
        "Читання конфігів може впасти на не-ASCII символах.",
        file=sys.stderr,
    )


def main() -> None:
    # Nuitka onefile + multiprocessing on Windows: ``freeze_support`` MUST run
    # before the first import that may spawn workers (sentence-transformers,
    # faster-whisper, chromadb HNSW indexer all spawn). Failing this turns
    # the binary into a fork bomb on Windows.
    _mp.freeze_support()
    if sys.platform == "win32":
        try:
            _mp.set_start_method("spawn", force=True)
        except RuntimeError:
            pass  # already set by an earlier import

    _force_utf8_locale()
    _bootstrap_env()

    # Make backend package layout (api, core, ai, ...) importable as
    # top-level modules — matches the dev layout used in ``main.py``.
    backend_dir = Path(__file__).resolve().parent
    if str(backend_dir) not in sys.path:
        sys.path.insert(0, str(backend_dir))

    # Телеметрія Chroma — глушимо ДО того, як хтось підніме перший клієнт,
    # але вже ПІСЛЯ того, як шлях до пакетів бекенда став видимий (інакше
    # імпорт не знайде `memory`). `ANONYMIZED_TELEMETRY=False` вище цього не
    # робить: виміряно, що chromadb 0.5.5 пробує відправити ClientStartEvent
    # повз обидва штатні важелі. Подробиці й доказ — у самому модулі.
    from memory.chroma_telemetry_off import silence

    silence()

    # Lazy imports AFTER env bootstrap so config picks up our paths.
    import uvicorn

    from config import config

    uvicorn.run(
        "main:app",
        host=config.host,
        port=config.port,
        reload=False,
        log_level=config.log_level.lower(),
        access_log=False,
        loop="auto",
        http="auto",
        workers=1,
    )


if __name__ == "__main__":
    main()
