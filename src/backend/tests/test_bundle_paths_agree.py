"""Оголошений шлях і зроблений шлях мусять бути одним шляхом.

Виміряно 03.09.2026 на ЗАПАКОВАНОМУ сайдкарі (не на dev-дереві). Запуск був
такий — оператор сказав, де його дані:

    PHANTOM_DATA_DIR=…/proof-before/data
    PHANTOM_MODELS_DIR=…/proof-before/models

`paths.py` це поважав, і туди справді лягли ключі вузла, sqlite/ і geo/. Але
`_phantom_entry._bootstrap_env()` рахував похідні шляхи не з середовища, а з
власної теки поруч із бінарником. На диску вийшло дві правди одночасно:

    …/proof-before/data/identity/node_ed25519.key      ← сказане
    …/binaries/data/phantom.db                         ← зроблене
    …/binaries/data/chroma/.embedding_model            ← зроблене

Продукт розклав власний стан по двох теках і жодного разу не поскаржився.

Найгостріше це б'є по памʼяті. `memory/embedding_fn.model_state()` — те, що
показує людині «модель встановлена / не встановлена» — читає рівно ті змінні,
які виставляє цей вхідник: SENTENCE_TRANSFORMERS_HOME, HUGGINGFACE_HUB_CACHE,
$HF_HOME/hub. Поки вони рахувались із теки бінарника, оператор, який поклав
модель у ОГОЛОШЕНУ ним теку моделей, і далі читав би «модель не встановлена».
Мовчазна брехня: скло каже одне, диск має інше, помилки немає ніде.

ЧОМУ ЦЕ ПЕРЕВІРЯЄТЬСЯ ПОВЕДІНКОЮ, А НЕ ЗВІРЯННЯМ РЯДКІВ.
Порівняти два шляхи рядками означало б записати сьогоднішню домовленість
двічі — у коді й у тесті — і зелено пройти повз будь-яку її зміну. Тому
головний сторож тут інший: кладемо модель туди, куди показав вхідник, і
питаємо `model_state()`, чи вона є. Якщо дві половини розійдуться будь-коли й
з будь-якої причини, ця відповідь стане «немає» — і тест почервоніє.

ЧОГО ЦЕЙ СТОРОЖ НЕ БАЧИТЬ:
* Він не запускає заморожений бінарник — лише той самий код у dev-дереві.
  PyInstaller може зламати `_binary_dir()` так, як тут не видно.
* Він нічого не каже про те, чи модель СПРАВДІ вантажиться: перевіряється
  наявність на диску, як її бачить `model_state`, а не робочий енкодер.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

import _phantom_entry
from memory.embedding_fn import model_state

MODEL = "intfloat/multilingual-e5-small"
#: Розкладка кешу hub, яку розбирає `model_state`.
MODEL_FLAT = "models--intfloat--multilingual-e5-small"

#: Усе, що `_bootstrap_env` виставляє й що ми міряємо. Чистимо перед кожним
#: прогоном: `setdefault` поважає будь-яке значення, що вже лежить у
#: середовищі, тож брудне середовище зробило б тест зеленим ні про що.
_TOUCHED = (
    "PHANTOM_DATA_DIR",
    "PHANTOM_MODELS_DIR",
    "PHANTOM_FRONTEND_DIST",
    "DATABASE_URL",
    "CHROMA_PATH",
    "HF_HOME",
    "HUGGINGFACE_HUB_CACHE",
    "TRANSFORMERS_CACHE",
    "SENTENCE_TRANSFORMERS_HOME",
)


@pytest.fixture
def bootstrap(tmp_path, monkeypatch):
    """Проганяє `_bootstrap_env()` у пісочниці й повертає (env, binary_root).

    `_bootstrap_env` пише прямо в `os.environ` через `setdefault`, тобто повз
    monkeypatch — тому середовище знімаємо й повертаємо цілком.
    """
    saved = dict(os.environ)

    binary_root = tmp_path / "binary"
    binary_root.mkdir()
    # Інакше вхідник візьме теку самого pytest і насмітить поруч із ним.
    monkeypatch.setattr(_phantom_entry, "_binary_dir", lambda: binary_root)

    def run(*, data: Path | None = None, models: Path | None = None) -> dict[str, str]:
        for var in _TOUCHED:
            os.environ.pop(var, None)
        if data is not None:
            os.environ["PHANTOM_DATA_DIR"] = str(data)
        if models is not None:
            os.environ["PHANTOM_MODELS_DIR"] = str(models)
        _phantom_entry._bootstrap_env()
        return dict(os.environ)

    try:
        yield run, binary_root
    finally:
        os.environ.clear()
        os.environ.update(saved)


def test_declared_data_dir_owns_db_and_chroma(bootstrap, tmp_path):
    """База й векторна памʼять ідуть у ту теку, яку назвав оператор."""
    run, binary_root = bootstrap
    declared = tmp_path / "declared-data"
    env = run(data=declared)

    assert Path(env["CHROMA_PATH"]) == declared / "chroma", (
        "CHROMA_PATH не в оголошеній теці даних — відбиток моделі й вектори "
        f"поїдуть повз PHANTOM_DATA_DIR: {env['CHROMA_PATH']}"
    )
    # `in` тут — навмисно слабка перевірка «взагалі в тій теці». Сильну —
    # «у ТОМУ САМОМУ файлі, що й у config.py» — робить тест нижче. Саме ця
    # слабкість і пропустила 04.09 роздвоєння бази: обидва шляхи
    # (<дані>/phantom.db і <дані>/sqlite/phantom.db) містять str(declared),
    # тож підрядок був зелений, поки на диску лежали дві різні бази.
    assert str(declared) in env["DATABASE_URL"], (
        f"DATABASE_URL не в оголошеній теці даних: {env['DATABASE_URL']}"
    )
    assert not (binary_root / "data").exists(), (
        "поруч із бінарником зʼявилась тека data, хоча оператор оголосив "
        "іншу — саме так продукт і роздвоював власний стан"
    )


def test_entry_and_config_name_the_same_database_file(bootstrap, tmp_path):
    """Два виробники шляху до бази мусять називати ОДИН файл.

    Виміряно 04.09.2026 в пакунку. Шлях до бази рахували двоє, і по-різному:

        _phantom_entry._bootstrap_env()  ->  <дані>/phantom.db
        config.PhantomConfig.database_url ->  <дані>/sqlite/phantom.db

    У запакованій збірці перемагав вхідник (env б-є `default_factory`), у
    дереві — config. Тобто та сама програма клала базу у два різні місця
    залежно від того, як її запустили, і мовчала про це. На диску лишалась
    приманка: `<дані>/sqlite/phantom.db` на 0 байтів — файл, який виглядає
    як база й нею не є. Хто переносив би дані між установками, узяв би його
    й «загубив» усе.

    Сторож питає не рядок, а ЗГОДУ: беремо те, що виставив вхідник, і те,
    що порахував би config САМ, якби вхідник мовчав. Розійдуться будь-коли й
    з будь-якої причини — тут почервоніє. Літерала шляху тут навмисно немає:
    записаний двічі, він проходив би повз будь-яку зміну домовленості.
    """
    run, _ = bootstrap
    declared = tmp_path / "declared-data"
    entry_url = run(data=declared)["DATABASE_URL"]

    from config import PhantomConfig

    os.environ.pop("DATABASE_URL", None)
    # `_env_file=None` — щоб не приїхав DATABASE_URL із чийогось `.env` і не
    # зробив цей тест зеленим ні про що.
    config_url = PhantomConfig(_env_file=None).database_url

    assert entry_url == config_url, (
        "вхідник і config називають РІЗНІ бази:\n"
        f"  _phantom_entry: {entry_url}\n"
        f"  config.py:      {config_url}\n"
        "У пакунку виграє перший, у дереві другий — тобто продукт кладе стан "
        "у два місця залежно від способу запуску, і в порожньому лишається "
        "приманка на 0 байтів."
    )


def test_database_does_not_sit_at_the_root_of_the_data_dir(bootstrap, tmp_path):
    """Дзеркало до попереднього: саме той шлях, який був у пакунку, — не наш.

    Тест вище стереже ЗГОДУ двох виробників; він лишився б зеленим, якби
    обидва раптом переїхали в корінь теки даних. Цей називає вимір: база
    живе в підтеці `sqlite/`, як і решта видів даних (`chroma/`, `tls/`,
    `identity/`), а не поруч із ними в корені.
    """
    run, _ = bootstrap
    declared = tmp_path / "declared-data"
    env = run(data=declared)

    db_file = Path(env["DATABASE_URL"].split("///", 1)[1])
    assert db_file.parent != declared, (
        f"база лягла в КОРІНЬ теки даних ({db_file}) — рівно те, що вже "
        "розвело пакунок і дерево"
    )
    from paths import resolve_data_dir

    assert db_file.parent == resolve_data_dir("sqlite"), (
        f"база не в підтеці, яку оголошує paths.resolve_data_dir('sqlite'): "
        f"{db_file.parent}"
    )


def test_legacy_db_at_data_root_is_adopted(bootstrap, tmp_path):
    """База зі СТАРОГО місця мусить переїхати сама.

    Виправлення шляху без переїзду коштувало б рівно того, від чого воно
    рятує: у кожного, хто вже ставив бету, база лежить у корені теки даних, і
    вузол, почавши дивитись у `sqlite/`, завів би порожню. Людина побачила б
    стерті чати й памʼять — тобто саме «втратив усе», лише з іншого боку.
    """
    run, _ = bootstrap
    declared = tmp_path / "declared-data"
    declared.mkdir()
    legacy = declared / "phantom.db"
    legacy.write_bytes(b"REAL-DB-BYTES" * 100)
    (declared / "phantom.db-wal").write_bytes(b"wal")
    (declared / "phantom.db-shm").write_bytes(b"shm")

    env = run(data=declared)
    moved = Path(env["DATABASE_URL"].split("///", 1)[1])

    assert moved.is_file(), f"база не переїхала: {moved} не існує"
    assert moved.read_bytes() == b"REAL-DB-BYTES" * 100, "переїхали не ті байти"
    assert not legacy.exists(), "стара база лишилась поруч — знову дві правди на диску"
    for suffix in ("-wal", "-shm"):
        assert moved.with_name(moved.name + suffix).is_file(), (
            f"{suffix} лишився позаду — це викинуті незакріплені транзакції"
        )


def test_adoption_never_overwrites_a_live_db(bootstrap, tmp_path):
    """Дзеркало: якщо на новому місці ВЖЕ є база, стара її не затирає.

    Без цього переїзд сам став би тим знищенням даних, проти якого написаний:
    достатньо було б колись запустити пакунок обома способами.
    """
    run, _ = bootstrap
    declared = tmp_path / "declared-data"
    (declared / "sqlite").mkdir(parents=True)
    live = declared / "sqlite" / "phantom.db"
    live.write_bytes(b"LIVE-DB" * 500)
    stale = declared / "phantom.db"
    stale.write_bytes(b"STALE-DB")

    env = run(data=declared)
    target = Path(env["DATABASE_URL"].split("///", 1)[1])

    assert target == live
    assert live.read_bytes() == b"LIVE-DB" * 500, "живу базу затерто старою"
    assert stale.is_file(), "стару базу видалено, хоча переїзд не відбувся"


def test_declared_models_dir_owns_every_hf_cache(bootstrap, tmp_path):
    """Усі чотири кеші моделей ростуть з оголошеної теки моделей."""
    run, binary_root = bootstrap
    declared = tmp_path / "declared-models"
    env = run(models=declared)

    for var in (
        "HF_HOME",
        "HUGGINGFACE_HUB_CACHE",
        "TRANSFORMERS_CACHE",
        "SENTENCE_TRANSFORMERS_HOME",
    ):
        assert Path(env[var]).is_relative_to(declared), (
            f"{var}={env[var]} лежить поза PHANTOM_MODELS_DIR={declared}. "
            "Стан памʼяті на склі читає саме цю змінну, тож модель, покладена "
            "в оголошену теку, читалась би як відсутня"
        )
    assert not (binary_root / "models").exists(), (
        "поруч із бінарником зʼявилась тека models, хоча оголошена інша"
    )


@pytest.mark.parametrize("cache_var", ["HUGGINGFACE_HUB_CACHE", "SENTENCE_TRANSFORMERS_HOME"])
def test_model_state_finds_model_where_entry_pointed(bootstrap, tmp_path, cache_var):
    """Головний сторож: кладемо модель туди, куди показав вхідник, — і стан
    памʼяті мусить її побачити.

    Це та сама перевірка, що й у людини на склі, лише без скла. Розійдуться
    дві половини — тут стане `present=False`, і причина буде названа.
    """
    run, _ = bootstrap
    declared = tmp_path / "declared-models"
    env = run(models=declared)

    planted = Path(env[cache_var]) / MODEL_FLAT
    planted.mkdir(parents=True)

    state = model_state(MODEL)
    assert state["present"] is True, (
        f"модель покладено в {planted} — тобто рівно туди, куди показує "
        f"{cache_var}, який виставив сам вхідник, — а стан памʼяті каже "
        f"«не встановлена». Шукав тут: {state.get('searched')}"
    )
    assert Path(state["path"]) == Path(env[cache_var])


def test_model_state_still_says_missing_when_nothing_planted(bootstrap, tmp_path):
    """Дзеркало до попереднього: без моделі стан мусить уміти сказати «немає».

    Без цього перевірка вище була б зеленим, що не вміє почервоніти —
    `present=True` міг би приїхати з домашнього кешу машини розробника.
    """
    run, _ = bootstrap
    declared = tmp_path / "declared-models"
    run(models=declared)

    # Домашній кеш — останній корінь у `_cache_roots()`, і на цій машині
    # модель у ньому лежить. Прибираємо HOME у порожню теку, інакше тест
    # звітував би про кеш розробника, а не про пакунок.
    fake_home = tmp_path / "empty-home"
    fake_home.mkdir()
    os.environ["HOME"] = str(fake_home)

    state = model_state(MODEL)
    assert state["present"] is False, (
        "модель знайшлась там, де її не клали — сторож вище нічого не стереже"
    )
    assert state["reason"], "стан без моделі мусить нести причину для людини"


def test_bare_env_keeps_everything_next_to_binary(bootstrap):
    """Без оголошень усе лишається поруч із бінарником — як і було."""
    run, binary_root = bootstrap
    env = run()

    assert Path(env["PHANTOM_DATA_DIR"]) == binary_root / "data"
    assert Path(env["PHANTOM_MODELS_DIR"]) == binary_root / "models"
    assert Path(env["CHROMA_PATH"]) == binary_root / "data" / "chroma"
    assert Path(env["HF_HOME"]) == binary_root / "models" / "hf_cache"


def test_unwritable_declared_dir_is_loud(bootstrap, tmp_path):
    """Непридатна оголошена тека — гучна відмова, а не тиха підміна.

    Підмінити її на свою було б знову розвести сказане зі зробленим: продукт
    працював би, пишучи не туди, куди йому веліли.
    """
    if os.geteuid() == 0:
        pytest.skip("під root права на запис не заважають")
    run, _ = bootstrap
    locked = tmp_path / "locked"
    locked.mkdir(mode=0o500)
    try:
        with pytest.raises(OSError):
            run(data=locked / "data")
    finally:
        locked.chmod(0o700)


def test_entry_module_is_the_one_pyinstaller_freezes():
    """Щоб тест не стеріг копію, якої немає в пакунку."""
    entry = Path(_phantom_entry.__file__).resolve()
    assert entry.name == "_phantom_entry.py"
    assert entry.parent.name == "backend", (
        f"вхідник знайдено не там, де його бере build_sidecar.sh: {entry}"
    )
    assert sys.version_info[:2] >= (3, 11)
