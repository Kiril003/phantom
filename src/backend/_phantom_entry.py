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


def _adopt_legacy_db(legacy: Path, target: Path) -> None:
    """Забрати базу зі старого місця, якщо продукт її там лишив.

    До 04.09.2026 запакована збірка клала базу в КОРІНЬ теки даних
    (`<дані>/phantom.db`), бо `_bootstrap_env` рахував шлях сам; дерево клало
    її в `<дані>/sqlite/`. Тепер виробник шляху один — `paths.resolve_data_dir`.

    Переїзд робиться тільки тоді, коли на новому місці НІЧОГО немає: інакше ми
    затерли б живу базу старою. `-wal` і `-shm` їдуть разом — лишити їх позаду
    означало б викинути незакріплені транзакції. `rename` у межах однієї теки
    даних атомарний, тож напівперенесеного стану не буває.

    Тиха відмова тут була б гіршою за виняток: людина побачила б порожній
    вузол і не дізналась, що її база лежить поруч. Тому не мовчимо.
    """
    if not legacy.is_file() or target.exists():
        return
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        for suffix in ("", "-wal", "-shm"):
            src = legacy.with_name(legacy.name + suffix)
            if src.exists():
                src.rename(target.with_name(target.name + suffix))
    except OSError as exc:
        print(
            f"[phantom] не переніс базу {legacy} -> {target} ({exc}). "
            "Стара база лишилась на місці; перенеси її руками, інакше вузол "
            "заведе порожню.",
            file=sys.stderr,
        )
        return
    print(f"[phantom] база переїхала: {legacy} -> {target}", file=sys.stderr)


def _bootstrap_env() -> Path:
    root = _writable_root(_binary_dir())
    data_dir = root / "data"
    models_dir = root / "models"
    frontend_dir = _binary_dir() / "frontend"
    # Тек тут НЕ створюємо: поки не спитано середовище, ми ще не знаємо, які
    # з них справді в силі. Раніше цей рядок безумовно робив `<binary>/data`
    # і `<binary>/models` навіть тоді, коли оператор оголосив інші — і поруч
    # із бінарником лишались порожні теки, що виглядають як робочий стан
    # продукту. Створює той цикл нижче, який працює з дійсними шляхами.

    # Env defaults — only set when operator hasn't overridden. Backend
    # modules read these via ``config.py`` / ``paths.py``.
    os.environ.setdefault("PHANTOM_DATA_DIR", str(data_dir))
    os.environ.setdefault("PHANTOM_MODELS_DIR", str(models_dir))
    os.environ.setdefault("PHANTOM_FRONTEND_DIST", str(frontend_dir))

    # ── Похідні шляхи беремо з того, що СПРАВДІ в силі ────────────────────
    #
    # Тут була розбіжність, і вона виміряна 03.09 на ЗАПАКОВАНОМУ сайдкарі.
    # Запуск був такий:
    #     PHANTOM_DATA_DIR=…/proof-before/data
    #     PHANTOM_MODELS_DIR=…/proof-before/models
    # тобто оператор сказав, де його дані. `setdefault` вище це поважає —
    # і `paths.py` слухняно поклав туди ключі вузла, sqlite/ і geo/. Але
    # решта блоку рахувалась не з середовища, а з локальних `data_dir` /
    # `models_dir`, тобто з теки ПОРУЧ ІЗ БІНАРНИКОМ. Наслідок на диску:
    #
    #     …/proof-before/data/identity/node_ed25519.key      ← сказане
    #     …/binaries/data/phantom.db                         ← зроблене
    #     …/binaries/data/chroma/.embedding_model            ← зроблене
    #
    # Продукт розклав власний стан по ДВОХ теках і жодного разу не
    # поскаржився: база й векторна памʼять поїхали в одне місце, все інше —
    # в інше. Те саме з моделями: HF_HOME/HUGGINGFACE_HUB_CACHE вказували на
    # `<binary>/models/hf_cache` при `PHANTOM_MODELS_DIR`, що вказував геть
    # деінде. А `memory/embedding_fn.model_state()` — те, що показує людині
    # стан памʼяті на склі — читає рівно ці три змінні. Тобто оператор,
    # який поставив модель у ОГОЛОШЕНУ ним теку моделей, і далі бачив би
    # «модель не встановлена». Мовчазна брехня саме того ґатунку, проти
    # якого весь цей шар і написаний.
    #
    # Лікуємо клас, а не випадок: нижче ЖОДЕН шлях не рахується з
    # `_binary_dir()` наосліп — усі читаються назад із середовища, тож
    # «оголошене» і «зроблене» не можуть розійтись за побудовою.
    data_dir = Path(os.environ["PHANTOM_DATA_DIR"])
    models_dir = Path(os.environ["PHANTOM_MODELS_DIR"])
    for label, target in (("PHANTOM_DATA_DIR", data_dir), ("PHANTOM_MODELS_DIR", models_dir)):
        try:
            target.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            # Не мовчимо і не підміняємо тихцем на свою теку: оператор
            # назвав це місце сам, і підміна знову розвела б сказане з
            # зробленим — лише на крок пізніше й непомітніше.
            print(
                f"[phantom] {label}={target} недоступна на запис ({exc}). "
                "Або дай права на цю теку, або прибери змінну — тоді дані "
                "підуть поруч із бінарником чи в теку користувача.",
                file=sys.stderr,
            )
            raise

    # ── Де лежить база: ОДИН виробник шляху, не два ───────────────────────
    #
    # Тут стояло `data_dir / "phantom.db"` — тобто КОРІНЬ теки даних. А
    # `config.database_url` рахує той самий шлях інакше:
    # `paths.resolve_data_dir("sqlite") / "phantom.db"`, тобто ПІДТЕКУ. Двоє
    # рахували одне й те саме різними способами, і в запакованій збірці
    # перемагав цей рядок (env б-є default_factory), а в дереві — той.
    #
    # Наслідок на диску, виміряний у пакунку:
    #
    #     <дані>/phantom.db          ← справжня база
    #     <дані>/sqlite/phantom.db   ← 0 байтів
    #
    # У дереві — навпаки. Порожній файл виглядає як база й нею не є: хто
    # переноситиме дані між установками, візьме приманку і «втратить» усе.
    # Мовчки, бо обидва місця існують і жодне не скаржиться.
    #
    # Лікуємо не випадок, а причину: шлях питаємо в того самого
    # `paths.resolve_data_dir`, з якого його бере `config.py`. Тепер
    # розійтись їм нема як — виробник один. `setdefault` лишається: якщо
    # оператор назвав свою базу, вона й далі його.
    from paths import resolve_data_dir  # noqa: PLC0415 — після PHANTOM_DATA_DIR

    db_target = resolve_data_dir("sqlite") / "phantom.db"
    os.environ.setdefault("DATABASE_URL", f"sqlite+aiosqlite:///{db_target.as_posix()}")
    os.environ.setdefault("CHROMA_PATH", str(resolve_data_dir("chroma")))

    # Переїзд бази зі старого місця. Без нього виправлення вище коштувало б
    # рівно того, від чого рятує: у кожного, хто вже ставив бету, база лежить
    # у корені теки даних, і вузол, почавши дивитись у `sqlite/`, не знайшов
    # би її й мовчки завів порожню — чати, памʼять і налаштування виглядали б
    # як стерті.
    #
    # Робимо це ЛИШЕ коли в силі саме наш шлях: якщо оператор назвав свою
    # базу через DATABASE_URL, ми не знаємо його розкладки й не чіпаємо нічого.
    if os.environ["DATABASE_URL"].endswith(db_target.as_posix()):
        _adopt_legacy_db(data_dir / "phantom.db", db_target)

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

    # Make backend package layout (api, core, ai, ...) importable as
    # top-level modules — matches the dev layout used in ``main.py``.
    backend_dir = Path(__file__).resolve().parent
    if str(backend_dir) not in sys.path:
        sys.path.insert(0, str(backend_dir))

    # ── `--selftest-pdf`: чи намалює ЦЕЙ пакунок кирилицю ─────────────────
    #
    # Стоїть ДО `_bootstrap_env()` навмисно: самоперевірці не потрібні ні
    # тека даних, ні моделі, ні кеш HF, і створювати їх заради неї означало б
    # лишити на диску сліди продукту, який навіть не піднімався.
    #
    # Навіщо прапорець узагалі. Рушій PDF у бандлі був живий, а українського
    # звіту не виходило: шрифту не було ні в пакунку, ні на чистій машині —
    # і побачити це можна було лише в людини. Ворота чистої машини не мають
    # ні пітона, ні venv (це їхня суть), тож спитати «а намалюй» можна тільки
    # сам пакунок. Це не тестовий гак: рівно ця команда відповідає людині,
    # у якої «звіт вийшов порожній», за одну секунду й без нашої участі.
    if len(sys.argv) > 1 and sys.argv[1] == "--selftest-pdf":
        from agent.missions.pdf_export import selftest_cli

        raise SystemExit(selftest_cli(sys.argv[2] if len(sys.argv) > 2 else None))

    # ── `--bake-worker` / `--selftest-bake`: випікання дорожніх пакетів ────
    #
    # Тут, ДО `_bootstrap_env()`, і з тієї ж причини, що й PDF вище: ані
    # робітникові, ані його самоперевірці не потрібні ні тека даних, ні
    # моделі, ні кеш HF. Створити їх заради самоперевірки означало б лишити
    # на чистій машині сліди продукту, який жодного разу не піднімався, — а
    # саме на чистій машині ця команда й має сенс.
    #
    # Чому робітник узагалі окремий процес, а не корутина в бекенді. Випікання
    # тримає в памʼяті індекс вузлів на весь витяг — найважче, що продукт
    # взагалі робить. Демон oom-guard стріляє в НАЙБІЛЬШИЙ процес за іменем;
    # поки випікання жило б усередині `uvicorn`, кожен великий пакет ставив би
    # під постріл увесь вузол разом із чатом і мережею. Окремим процесом гине
    # рівно випікання, і воно про це вміє сказати.
    #
    # `--selftest-bake` — це псевдонім до `--bake-worker --selftest`, а не
    # другий шлях: ворота пакунка мусять питати рівно того робітника, якого
    # запустить продукт. Він друкує `osmium_from=<шлях>`, і саме цей рядок
    # доводить, що прив'язка взята З ПАКУНКА, а не з системного python поруч.
    # «Бібліотека є в списку» і «бібліотека є в бандлі» — різні твердження,
    # і в цьому домі друге вже брехало першим.
    if len(sys.argv) > 1 and sys.argv[1] in ("--bake-worker", "--selftest-bake"):
        from geo.bake.worker import worker_cli

        rest = sys.argv[2:]
        if sys.argv[1] == "--selftest-bake":
            rest = ["--selftest", *rest]
        raise SystemExit(worker_cli(rest))

    _bootstrap_env()

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
