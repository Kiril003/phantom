#!/usr/bin/env python3
"""PHANTOM OS — збирач sidecar-бекенда ДЛЯ WINDOWS.

Окремий файл, а не гілка в `build_sidecar.sh`, і причина виміряна (06.09.2026):
з 580 рядків того скрипта **151 (26%) на Windows не має сенсу**, а не «важко
перенести» — ворота машини (88 рядків: чужий Gradle, oom-guard, спільний flock
на ЦЬОМУ ноутбуці) і полювання за ctypes-бібліотеками (63 рядки: ldd, ldconfig,
пошук `libsndfile.so` у системі). Друге не потрібне тому, що колесо `soundfile`
під Windows везе `_soundfile_data/libsndfile_x64.dll` **усередині себе**, тож
`--collect-all soundfile` забирає її сам; на Linux у колесі її немає, і саме
тому там стоїть той блок. Розкидати «якщо Windows» по 45 місцях сховало б те
єдине, заради чого той файл цінний.

ЩО ПЕРЕНЕСЕНО ЗВІДТИ ДОСЛІВНО ЗА ЗМІСТОМ (не механіка, а знання):
  1. Відмова без шрифта. Пакунок без DejaVu збирається ЗЕЛЕНО і не малює
     жодної кириличної літери у звіті PDF. Мовчазний пропуск заборонений.
  2. Димова перевірка ПОКЛАДЕНОГО бінарника: скрипт, що каже «готово», не
     запустивши те, що зібрав, — бреше. Перший зелений бандл 29.08 зібрався
     без єдиної помилки і не піднявся взагалі.
  3. Три пласти, яких статичний аналіз PyInstaller не бачить: рядкові
     посилання (`uvicorn.run("main:app")`), реєстри драйверів за іменем
     (`sqlite+aiosqlite`, `bcrypt`, uvloop) і файли, що не є кодом
     (`db/alembic`, маніфести шарів мапи).
  4. Паспорт збірки всередину бандла: запущений продукт мусить уміти сказати,
     з чого він зібраний.

ЧОГО ТУТ НЕМАЄ І ЧОМУ:
  • воріт машини — на раннері CI віртуалка своя, ділити нема з ким;
  • полювання за `.so` — див. вище;
  • `--onefile` — на Windows він НЕ ПОТРІБЕН, і це виміряно, а не вподобання.
    Tauri кладе поруч із застосунком не лише `externalBin`, а й `bundle.
    resources`, і на Windows обидва лягають в ОДИН `$INSTDIR` (NSIS:
    `SetOutPath $INSTDIR` перед обома блоками; WiX: спільний `INSTALLDIR`).
    Бутлоадер PyInstaller шукає `_internal` поруч із собою — знаходить.
    На Linux те саме НЕ працює: там ресурси йдуть у `usr/lib/<product>/`, а
    сайдкар у `usr/bin/`, тож `_internal` опиняється не поруч. Через це
    `build_sidecar.sh` і мусить пекти onefile, платячи ~1,5 ГБ розпаковки на
    кожен старт. Windows цієї ціни не платить.
    Оголошення живе в `tauri.windows.conf.json` — окремому файлі, який Tauri
    підмішує ЛИШЕ для Windows-цілей, щоб на Linux ті самі 500+ МБ не поїхали
    другим примірником у `usr/lib`.

ПІН ПІТОНА — 3.11, і це вимога, а не смак: `chromadb` тягне
`chroma-hnswlib==0.7.6`, у якої колесо win_amd64 є для cp37…cp311 і НЕМАЄ для
cp312. Помилка розвʼязку називає chroma-hnswlib, а не пітон. Подробиці — біля
пінa `chromadb` у `requirements-bundle.txt`.

Стан: НАПИСАНО, ЖОДНОГО РАЗУ НЕ ЗАПУСКАЛОСЬ — Windows-машини в мене немає.
Перший прогін — це і є перевірка. Не називай його зеленим, доки він не пройшов.

Використання (з кореня репозиторію, на Windows):
    py -3.11 scripts/build_sidecar_windows.py
    py -3.11 scripts/build_sidecar_windows.py --skip-smoke
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import NoReturn

TRIPLE = "x86_64-pc-windows-msvc"
ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "src" / "backend"
TAURI = ROOT / "src" / "frontend" / "src-tauri"
DEST = TAURI / "binaries"
BUILD_VENV = Path(os.environ.get("PHANTOM_BUNDLE_VENV", ROOT / ".build" / "venv-bundle-win"))
WORK = ROOT / ".build" / "pyinstaller-win"

FONT_FILES = (
    "DejaVuSans.ttf",
    "DejaVuSans-Bold.ttf",
    "DejaVuSans-Oblique.ttf",
    "DejaVuSans-BoldOblique.ttf",
    "LICENSE",
)

# Ліниві та рядкові імпорти — те саме сімейство, що в build_sidecar.sh.
# Список свідомо той самий: розходження між двома збирачами означало б, що
# Windows-бандл везе не те саме, що Linux, і виявилось би це в людини.
COLLECT_ALL = (
    "torch sentence_transformers transformers tokenizers safetensors "
    "chromadb onnxruntime faster_whisper ctranslate2 vosk soundfile "
    "cv2 shapely segno piper supertonic "
    "pypdf openpyxl striprtf "
    "aiosqlite sqlalchemy alembic passlib bcrypt jose "
    "uvloop httptools websockets zeroconf"
).split()

# Те, що взагалі не є пітонівським кодом: читається з диска за шляхом.
DATA_PAIRS = (
    ("db/alembic", "db/alembic"),
    ("alembic.ini", "."),
    ("geo/layer_registry/manifests", "geo/layer_registry/manifests"),
)


def say(msg: str) -> None:
    print(f"[sidecar-win] {msg}", flush=True)


def die(msg: str, code: int = 1) -> NoReturn:
    print(f"[sidecar-win] ПОМИЛКА: {msg}", file=sys.stderr, flush=True)
    raise SystemExit(code)


def weigh(path: Path, label: str) -> None:
    """Байти І людський розмір: перше порівнюється, друге читається очима."""
    if not path.exists():
        say(f"ВАГА {label}: (немає)")
        return
    total = (
        path.stat().st_size
        if path.is_file()
        else sum(p.stat().st_size for p in path.rglob("*") if p.is_file())
    )
    say(f"ВАГА {label}: {total / 1024 / 1024:.0f} МіБ ({total} Б)")


def venv_python(venv: Path) -> Path:
    """У Windows інтерпретатор живе в `Scripts/`, а не в `bin/`."""
    return venv / "Scripts" / "python.exe"


def pick_python() -> Path:
    """Рівно 3.11. Не «3.11 або новіше» — саме 3.11 (див. шапку про cp312)."""
    explicit = os.environ.get("PHANTOM_BUNDLE_PYTHON")
    candidates: list[list[str]] = []
    if explicit:
        candidates.append([explicit])
    candidates.append(["py", "-3.11"])
    candidates.append(["python3.11"])
    for cand in candidates:
        try:
            out = subprocess.run(
                cand + ["-c", "import sys;print('%d.%d' % sys.version_info[:2]);print(sys.executable)"],
                capture_output=True,
                text=True,
                timeout=30,
            )
        except (OSError, subprocess.SubprocessError):
            continue
        if out.returncode != 0:
            continue
        lines = out.stdout.strip().splitlines()
        if len(lines) < 2:
            continue
        version, exe = lines[0].strip(), lines[1].strip()
        if version == "3.11":
            return Path(exe)
        say(f"пропускаю {' '.join(cand)} — це {version}, а треба рівно 3.11")
    die(
        "не знайшов Python 3.11.\n"
        "  Windows-бандл збирається ЛИШЕ на 3.11: chromadb тягне "
        "chroma-hnswlib==0.7.6,\n"
        "  у якої немає колеса win_amd64 під cp312 (є cp37…cp311).\n"
        "  Постав 3.11 або вкажи PHANTOM_BUNDLE_PYTHON=C:\\...\\python.exe",
        2,
    )


def check_preconditions() -> Path:
    if os.name != "nt":
        die(
            "це збирач ДЛЯ WINDOWS, а запущено не на Windows.\n"
            "  Для Linux є scripts/build_sidecar.sh — у нього інша робота, "
            "не та сама з прапорцем.",
            2,
        )
    entry = BACKEND / "_phantom_entry.py"
    if not entry.is_file():
        die(f"немає {entry} — збирати нічого")
    if not (BACKEND / "requirements-bundle.txt").is_file():
        die(
            "немає requirements-bundle.txt — збірка з requirements.txt заборонена "
            "(інакше в бандл поїде CUDA-стек і playwright)"
        )
    # ШРИФТ — першим, бо відмова тут коштує секунд, а не десяти хвилин.
    fonts = BACKEND / "assets" / "fonts"
    missing = [f for f in FONT_FILES if not (fonts / f).is_file() or (fonts / f).stat().st_size == 0]
    if missing:
        die(
            f"у {fonts} бракує: {' '.join(missing)}\n"
            "  Без них пакунок збереться ЗЕЛЕНО і не намалює жодної кириличної\n"
            "  літери у звіті PDF: на чистій машині системного DejaVu немає\n"
            "  (заміряно — у трьох базових образах нуль шрифтів).\n"
            "  LICENSE — умова розповсюдження, а не документація: немає файла —\n"
            "  немає збірки. Мовчазний пропуск тут заборонений."
        )
    say(f"шрифт: чотири накреслення DejaVu + LICENSE на місці")
    # Конфіг мусить нести `_internal`, інакше onedir-бандл ВСТАНОВИТЬСЯ і не
    # запуститься: Tauri покладе лише сам файл externalBin. Це рівно та форма
    # дефекту, що «зібралось» ≠ «працює», тож перевіряємо ДО збірки.
    wincfg = TAURI / "tauri.windows.conf.json"
    ok = False
    if wincfg.is_file():
        try:
            res = json.loads(wincfg.read_text(encoding="utf8")).get("bundle", {}).get("resources")
        except json.JSONDecodeError as exc:
            die(f"{wincfg} не розбирається: {exc}")
        if isinstance(res, dict):
            ok = any(str(v).strip("/\\") == "_internal" for v in res.values())
        elif isinstance(res, list):
            ok = any("_internal" in str(v) for v in res)
    if not ok:
        die(
            f"{wincfg} не оголошує `bundle.resources` з `_internal`.\n"
            "  Tauri кладе в пакунок лише сам файл externalBin, без сусідніх тек,\n"
            "  тож onedir-бандл встановиться і НЕ ЗАПУСТИТЬСЯ — бутлоадер не\n"
            "  знайде свого `_internal`. Мовчазне «зібралось» тут заборонене."
        )
    say("конфіг: tauri.windows.conf.json несе `_internal` у bundle.resources")
    return entry


def make_venv(pybin: Path) -> None:
    """Середовище могло лишитись від іншого інтерпретатора — перевіряємо ВЕРСІЮ."""
    vpy = venv_python(BUILD_VENV)
    if BUILD_VENV.exists():
        alive = ""
        if vpy.is_file():
            try:
                alive = subprocess.run(
                    [str(vpy), "-c", "import sys;print('%d.%d' % sys.version_info[:2])"],
                    capture_output=True, text=True, timeout=30,
                ).stdout.strip()
            except (OSError, subprocess.SubprocessError):
                alive = ""
        if alive != "3.11":
            say(f"середовище збірки не на 3.11 (побачив {alive or 'нічого'}) — перестворюю")
            shutil.rmtree(BUILD_VENV, ignore_errors=True)
    if not vpy.is_file():
        say(f"створюю середовище збірки: {BUILD_VENV}")
        subprocess.run([str(pybin), "-m", "venv", str(BUILD_VENV)], check=True)
    say(f"збірка на: {subprocess.run([str(vpy), '-V'], capture_output=True, text=True).stdout.strip()}")
    say("ставлю залежності бандла (CPU-торч, без тестових) — це надовго")
    subprocess.run([str(vpy), "-m", "pip", "install", "--quiet", "--upgrade", "pip"], check=True)
    subprocess.run(
        [str(vpy), "-m", "pip", "install", "--quiet", "-r", str(BACKEND / "requirements-bundle.txt")],
        check=True,
    )
    subprocess.run([str(vpy), "-m", "pip", "install", "--quiet", "pyinstaller"], check=True)
    weigh(BUILD_VENV, "середовище збірки")


def write_passport() -> Path:
    """Запущений продукт мусить уміти сказати, з чого він зібраний."""
    def git(*args: str) -> str:
        try:
            return subprocess.run(
                ["git", "-C", str(ROOT), *args], capture_output=True, text=True, timeout=30
            ).stdout.strip()
        except (OSError, subprocess.SubprocessError):
            return ""

    sha = os.environ.get("PHANTOM_BUILD_SHA") or git("rev-parse", "--short=8", "HEAD") or "nogit"
    dirty_env = os.environ.get("PHANTOM_BUILD_DIRTY")
    dirty = bool(int(dirty_env)) if dirty_env else bool(git("status", "--porcelain"))
    version = os.environ.get("PHANTOM_BUILD_VERSION")
    if not version:
        try:
            version = json.loads((TAURI / "tauri.conf.json").read_text(encoding="utf8"))["version"]
        except (OSError, KeyError, json.JSONDecodeError):
            version = "0.0.0"
    WORK.mkdir(parents=True, exist_ok=True)
    info = WORK / "build_info.json"
    info.write_text(
        json.dumps(
            {
                "component": "sidecar",
                "commit": sha,
                "dirty": dirty,
                "version": version,
                "built_at": os.environ.get("PHANTOM_BUILD_AT")
                or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            },
            indent=2,
        ),
        encoding="utf8",
    )
    if dirty:
        say("УВАГА: дерево брудне — паспорт бандла піде з dirty=true")
    say(f"паспорт бандла: коміт {sha}, dirty={dirty}, версія {version}")
    return info


def pyinstaller_args(passport: Path) -> list[str]:
    vpy = venv_python(BUILD_VENV)
    # `--add-data "src:dest"` портативний: PyInstaller 6.22 ділить регуляркою
    # `(^\w:[/\\])|[:;]` — приймає і `:`, і `;`, і пропускає літеру диска.
    # Перевірено в джерелі, а не за спогадом.
    args = [
        "--name", "phantom-backend",
        "--add-data", f"{passport}:.",
        "--distpath", str(WORK / "dist"),
        "--workpath", str(WORK / "work"),
        "--specpath", str(WORK),
        "--noconfirm",
        "--clean",
        "--onedir",
        "--paths", str(BACKEND),
        # `_phantom_entry.py` кличе `uvicorn.run("main:app")` РЯДКОМ — граф
        # імпортів такого не бачить у принципі.
        "--hidden-import", "main",
    ]
    # Пакети бекенда перелічуємо З ДИСКА: список у скрипті протух би на
    # першому ж новому пакеті.
    for pkg in sorted(
        p.parent.name
        for p in BACKEND.glob("*/__init__.py")
        if p.parent.name not in {"tests", ".venv"}
    ):
        args += ["--collect-submodules", pkg]
    for mod in sorted(
        p.stem
        for p in BACKEND.glob("*.py")
        if p.stem != "_phantom_entry" and not p.stem.startswith("test_")
    ):
        args += ["--hidden-import", mod]
    skipped = []
    for pkg in COLLECT_ALL:
        probe = subprocess.run(
            [str(vpy), "-c",
             f"import importlib.util,sys;sys.exit(0 if importlib.util.find_spec({pkg!r}) else 1)"],
            capture_output=True,
        )
        if probe.returncode == 0:
            args += ["--collect-all", pkg]
        else:
            skipped.append(pkg)
    if skipped:
        say(f"не знайдено, пропущено: {' '.join(skipped)}")
    for src_rel, dest_rel in DATA_PAIRS:
        src = BACKEND / src_rel
        if src.exists():
            args += ["--add-data", f"{src}:{dest_rel}"]
        else:
            say(f"дані не знайдено, пропущено: {src_rel}")
    args += ["--add-data", f"{BACKEND / 'assets' / 'fonts'}:assets/fonts"]
    return args


def place(out_name: str) -> Path:
    """onedir: бутлоадер шукає теку з ЖОРСТКО ЗАШИТИМ іменем `_internal`."""
    DEST.mkdir(parents=True, exist_ok=True)
    built = WORK / "dist" / "phantom-backend"
    internal_src = built / "_internal"
    if not internal_src.is_dir():
        die(f"PyInstaller не зробив {internal_src} — розкладка onedir змінилась?")
    internal_dst = DEST / "_internal"
    if internal_dst.exists():
        shutil.rmtree(internal_dst)
    shutil.copytree(internal_src, internal_dst)
    binary = DEST / out_name
    shutil.copy2(built / "phantom-backend.exe", binary)
    weigh(binary, "бінарник (onedir)")
    weigh(internal_dst, "тека _internal")
    return binary


def smoke(binary: Path) -> None:
    """Ганяємо ПОКЛАДЕНУ копію, не ту, що в теці складання.

    Різниця не теоретична: на Linux перша версія перевіряла `dist/`, де
    розкладка завідомо правильна, і пропустила те, що покладений бінарник не
    бачив свого `_internal`. Перевіряти треба той файл, який поїде далі, і з
    того місця, де він лежатиме.
    """
    port = os.environ.get("PHANTOM_SMOKE_PORT", "8099")
    smoke_dir = WORK / "smoke"
    shutil.rmtree(smoke_dir, ignore_errors=True)
    (smoke_dir / "tmp").mkdir(parents=True, exist_ok=True)
    env = dict(os.environ)
    env.update(
        PORT=port,
        PHANTOM_SKIP_TLS="1",
        PHANTOM_SKIP_MDNS="1",
        PHANTOM_SKIP_G2_WARMUP="1",
        TEMP=str(smoke_dir / "tmp"),
        TMP=str(smoke_dir / "tmp"),
        PHANTOM_DATA_DIR=str(smoke_dir / "data"),
        PHANTOM_MODELS_DIR=str(smoke_dir / "models"),
    )
    log = (WORK / "smoke.log").open("wb")
    say(f"димова перевірка: піднімаю ПОКЛАДЕНИЙ бінарник на порту {port}")
    proc = subprocess.Popen([str(binary)], cwd=str(DEST), env=env, stdout=log, stderr=log)
    ok = False
    try:
        for _ in range(90):
            if proc.poll() is not None:
                break
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=3) as r:
                    if r.status == 200:
                        ok = True
                        break
            except (urllib.error.URLError, OSError):
                pass
            time.sleep(2)
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=20)
        except subprocess.TimeoutExpired:
            proc.kill()
        log.close()
    if not ok:
        tail = (WORK / "smoke.log").read_text(encoding="utf8", errors="replace").splitlines()[-15:]
        print("\n".join(tail), file=sys.stderr)
        die("димова перевірка ПРОВАЛЕНА — бандл зібрався, але не обслуговує /health")
    say("димова перевірка ПРОЙДЕНА: /health відповів із бандла")


def main() -> None:
    ap = argparse.ArgumentParser(description="Збирач sidecar-бекенда для Windows")
    ap.add_argument("--skip-smoke", action="store_true",
                    help="не піднімати зібраний бінарник (лише для налагодження самої збірки)")
    ns = ap.parse_args()

    entry = check_preconditions()
    pybin = pick_python()
    say(f"інтерпретатор: {pybin}")
    say(f"triple:        {TRIPLE}")
    say(f"призначення:   {DEST / ('phantom-backend-' + TRIPLE + '.exe')}")

    make_venv(pybin)
    shutil.rmtree(WORK, ignore_errors=True)
    passport = write_passport()
    args = pyinstaller_args(passport)

    say("запускаю PyInstaller (onedir) — це надовго")
    subprocess.run(
        [str(venv_python(BUILD_VENV)), "-m", "PyInstaller", *args, str(entry)],
        cwd=str(BACKEND),
        check=True,
    )
    weigh(WORK / "dist", "весь вихід PyInstaller")

    binary = place(f"phantom-backend-{TRIPLE}.exe")
    if ns.skip_smoke:
        say("димову перевірку ПРОПУЩЕНО на вимогу — це не пройдена перевірка")
    else:
        smoke(binary)
    say(f"готово: {binary}")
    say("перевірка на ЧИСТІЙ машині (без пітона, без моделей) — окремий крок; тут вона НЕ виконана")


if __name__ == "__main__":
    main()
