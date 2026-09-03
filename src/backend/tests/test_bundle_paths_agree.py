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
    assert str(declared) in env["DATABASE_URL"], (
        f"DATABASE_URL не в оголошеній теці даних: {env['DATABASE_URL']}"
    )
    assert not (binary_root / "data").exists(), (
        "поруч із бінарником зʼявилась тека data, хоча оператор оголосив "
        "іншу — саме так продукт і роздвоював власний стан"
    )


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
