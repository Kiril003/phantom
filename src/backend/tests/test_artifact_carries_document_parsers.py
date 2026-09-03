"""Ворота на САМОМУ ПАКУНКУ: чи везе AppImage розбирачі документів.

Поруч уже стоять ворота на СПИСКУ
(`test_document_text_guard.py::test_бандл_везе_кожну_бібліотеку_яку_модуль_уміє_попросити`):
вони звіряють кожен `_missing("…")` з `requirements-bundle.txt`. Але список —
це не пакунок. Між ними лежить `scripts/build_sidecar.sh`, PyInstaller і
squashfs, і кожна з цих ланок уміє мовчки загубити бібліотеку.

Ціна помилки саме тут висока через ФОРМУ дефекту. `tools/document_text.py`
без бібліотеки не падає — він чесно відмовляє словами («у цій збірці немає
pypdf, тому PDF я не читаю»). Тобто мертвий пакунок виглядає як робочий
продукт, який просто не вміє PDF. Ніхто не подає баг на оголошену
відмову — її читають як задум. Такий дефект живе роками.

──────────────────────────────────────────────────────────────────────────
ЯК МІРЯЄМО, і чому саме так — усе нижче виміряно 03.09.2026 на артефакті
`.build/out/PHANTOM OS_0.20.0_amd64.AppImage` (724 МБ, зібраний 30.08 18:52).

1. `strings`/`grep` по самому .AppImage — МАРНО. Корисне навантаження
   лежить у squashfs, тобто стиснене: збіги випадкові, промахи теж.
2. `unsquashfs` на цій машині немає, і ставити його заради тесту — це
   вимагати від кожного, хто запустить набір, зайвого пакета.
3. Працює `"<шлях>.AppImage" --appimage-mount`: рантайм AppImage підіймає
   squashfuse і друкує точку монтування першим рядком stdout. Далі це
   звичайна тека, і читання файлів звідти віддає РОЗПАКОВАНІ байти.

4. Всередині — НЕ onedir. Виміряно: `_internal` у пакунку немає взагалі,
   є один onefile-бінарник `usr/bin/phantom-backend` на 567 МБ. Тобто
   теки `pypdf/`, `openpyxl/` шукати нема де: пакети лежать усередині
   архіву PyInstaller.

5. Але імена модулів там ЧИТАЮТЬСЯ прямим текстом. Причина структурна:
   PyInstaller тримає зміст PYZ (`marshal`-словник «модуль → зсув») НЕ
   стиснутим, тож кожне ім'я лежить у бінарнику як звичайні байти.
   Заміряно на цьому артефакті, один прохід по 567 МБ (15 с):

       croniter.      1     pyimod02_importers  1
       segno.         6     base_library.zip    3
       markdown.     30
       reportlab.    96
       ─────────────────
       pypdf.         0  ← жодного
       openpyxl.      0  ← жодного
       striprtf.      0  ← жодного

   Чисто-пітонівські бібліотеки (croniter, segno, markdown) видно так
   само добре, як ті, що везуть .so, — отже нуль у трьох розбирачів це
   вимір, а не сліпота приладу.

ЧОМУ ПОТРІБНА КРАПКА В ГОЛЦІ. Шукаємо `pypdf.`, а не `pypdf`: у змісті PYZ
ім'я пакета майже завжди стоїть із підмодулем (`pypdf._reader`,
`striprtf.striprtf`). Гола назва збіглася б із будь-якою випадковою
згадкою в чужих метаданих — а хибне «бібліотека є» це рівно та зелень,
проти якої стоять ці ворота. Помилятись дозволено лише в бік червоного.

ЧОГО ЦЕЙ СТОРОЖ НЕ ДОВОДИТЬ — читати перед тим, як йому вірити:

* Він доводить, що ІМЕНА МОДУЛІВ у пакунку є. Він не запускає розбирач і
  не витягує текст із PDF усередині пакунка. Остаточний доказ — запустити
  бекенд із пакунка й попросити його прочитати документ; це інші ворота.
* Він порівнює вік артефакта з `mtime` файла `requirements-bundle.txt`.
  `mtime` збивається свіжим `git checkout`. Тому вік вирішує лише те, ЯКИМ
  СЛОВОМ назвати вже знайдену відсутність, і ніколи — чи вона є.
* Він мовчить (`skip`), якщо артефакта немає, якщо FUSE недоступний або
  якщо прилад осліп (див. контроль нижче). Мовчить чесно, з причиною.

КОНТРОЛЬ ПРИЛАДУ. Сам вимір теж може зламатись: інша версія PyInstaller,
увімкнене стиснення PYZ, змінена розкладка пакунка — і тоді прилад покаже
нуль на ВСЬОМУ, а тест закричить «розбирачів немає», хоча вони є. Тому в
той самий прохід шукаємо ще й бібліотеки, оголошені в
`requirements-bundle.txt`, яких цей модуль не просить. Якщо не знайдено
жодних трьох — червоніти нема права: це не вирок пакунку, це сліпий
прилад, і тест пропускається зі сказаною причиною.

ГІГІЄНА МОНТУВАННЯ. Поруч можуть жити ЧУЖІ `/tmp/.mount_*`, з яких
працює живий бекенд іншої сесії. Тому розмонтовуємо рівно свою точку —
ту, яку надрукував НАШ процес, — і робимо це через завершення саме цього
процесу. Жодного `fusermount` по чужих шляхах і жодного глоба по
`/tmp/.mount_*` тут немає навмисно.
"""
from __future__ import annotations

import contextlib
import re
import subprocess
import threading
import time
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]          # …/src/backend
TREE = Path(__file__).resolve().parents[3]             # …/phantom-os-beta
OUT_DIR = TREE / ".build" / "out"
BUNDLE_REQ = BACKEND / "requirements-bundle.txt"
DOC_TEXT = BACKEND / "tools" / "document_text.py"

# Скільки секунд чекати на рядок із точкою монтування. Виміряно: рантайм
# друкує його за ~0,2 с; запас на холодну сторінку кешу й повільний диск.
MOUNT_TIMEOUT = 60.0
# Прохід читає 567 МБ через FUSE за ~15 с. Читаємо шматками, щоб не тримати
# пів гігабайта в пам'яті: машина живе під сторожем пам'яті.
SCAN_CHUNK = 8 << 20
# Скільки сторонніх бібліотек із бандла має побачити прилад, щоб мати право
# на вирок. Заміряно: реально їх видно понад десяток.
MIN_CONTROLS = 3


def _artifact() -> Path | None:
    """Найсвіжіший зібраний AppImage, або None якщо збірки тут не було."""
    if not OUT_DIR.is_dir():
        return None
    apps = sorted(OUT_DIR.glob("*.AppImage"), key=lambda p: p.stat().st_mtime)
    return apps[-1] if apps else None


def _parsers_the_module_can_ask_for() -> set[str]:
    """Імена з `_missing("…")` — те саме джерело, що й у воріт на списку.

    Обидва сторожі читають один список, тож розійтись вони не можуть: додав
    розбирач — обидва питають про нього одразу.
    """
    return set(re.findall(r'_missing\(\s*"([^"]+)"', DOC_TEXT.read_text()))


def _declared_in_bundle() -> set[str]:
    """Імена пакетів із `requirements-bundle.txt`, нормалізовані."""
    names: set[str] = set()
    for line in BUNDLE_REQ.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith(("#", "-")):
            continue
        name = re.split(r"[=<>!~\[;]", line)[0].strip().lower()
        if name:
            names.add(name)
            names.add(name.replace("-", "_"))
    return names


@contextlib.contextmanager
def _mounted(app: Path):
    """Монтує AppImage і віддає точку монтування. Прибирає ЛИШЕ свою."""
    try:
        proc = subprocess.Popen(
            [str(app), "--appimage-mount"],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
        )
    except OSError as exc:  # не виконуваний, немає FUSE, тощо
        pytest.skip(f"AppImage не запускається для монтування: {exc}")

    printed: list[str] = []
    reader = threading.Thread(
        target=lambda: printed.append(proc.stdout.readline()), daemon=True
    )
    reader.start()
    reader.join(MOUNT_TIMEOUT)

    mount = Path(printed[0].strip()) if printed and printed[0].strip() else None
    try:
        if mount is None or not mount.is_dir():
            pytest.skip(
                "AppImage не змонтувався (найімовірніше немає FUSE) — "
                "у пакунок зазирнути нічим"
            )
        # Чекаємо, поки squashfuse справді наповнить точку.
        deadline = time.monotonic() + 30.0
        while not any(mount.iterdir()) and time.monotonic() < deadline:
            time.sleep(0.2)
        yield mount
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=20)
        except subprocess.TimeoutExpired:
            proc.kill()
            with contextlib.suppress(subprocess.TimeoutExpired):
                proc.wait(timeout=20)
        # Свою точку перевіряємо, чужих не торкаємось узагалі.
        if mount is not None and _still_mounted(mount):
            pytest.fail(
                f"не вдалось розмонтувати власну точку {mount} — прибери руками "
                f"(`fusermount -u '{mount}'`), інакше вона висітиме до перезавантаження"
            )


def _still_mounted(mount: Path) -> bool:
    """Чи лишилась точка монтування живою після завершення процесу.

    Свіжо розмонтований FUSE не зникає миттєво: шлях ще існує, а будь-яке
    читання з нього кидає `ENOTCONN`. Це доказ, що розмонтування ВІДБУЛОСЬ,
    а не збій — перший прогін цих воріт упав саме на тому, що виняток
    рахувався за помилку й затулив собою справжній вирок.
    """
    deadline = time.monotonic() + 10.0
    while True:
        try:
            next(mount.iterdir(), None)
        except OSError:
            return False  # ENOTCONN або вже зник — тобто прибрано
        if time.monotonic() >= deadline:
            return True
        time.sleep(0.2)


def _seen_in_onefile(binary: Path, names: set[str]) -> set[str]:
    """Які з `names` лежать у onefile-бінарнику PyInstaller.

    Один прохід по файлу на всі імена одразу: кожен окремий `grep` по цьому
    бінарнику — це повні 567 МБ через FUSE, тобто ~15 с за назву.
    """
    needles: list[tuple[bytes, str]] = []
    for name in names:
        raw = name.lower().encode()
        needles.append((raw + b".", name))  # запис у змісті PYZ
        needles.append((raw + b"/", name))  # шлях у змісті CArchive
    found: set[str] = set()
    tail = b""
    with binary.open("rb") as fh:
        while True:
            buf = fh.read(SCAN_CHUNK)
            if not buf:
                break
            blob = tail + buf
            for needle, name in needles:
                if name not in found and needle in blob:
                    found.add(name)
            if len(found) == len(names):
                break
            # Голка могла лягти на шов між шматками.
            tail = blob[-64:]
    return found


def _probe(mount: Path, names: set[str]) -> tuple[set[str], str]:
    """(що знайдено, чим міряли). Розуміє обидва режими `build_sidecar.sh`."""
    internal = next((p for p in mount.rglob("_internal") if p.is_dir()), None)
    if internal is not None:
        # Режим onedir — пакети лежать теками. Заміряно НЕ було: наявний
        # артефакт onefile. Гілка проста саме тому, що неперевірена.
        have = {p.name.lower() for p in internal.iterdir()}
        return {n for n in names if n.lower() in have}, f"onedir {internal}"

    binary = next((p for p in mount.rglob("phantom-backend") if p.is_file()), None)
    if binary is None:
        pytest.fail(
            "у пакунку немає ні теки `_internal`, ні бінарника `phantom-backend` — "
            "це не «розбирачів бракує», це пакунок без бекенда взагалі. "
            "Перевір `scripts/build_sidecar.sh` і `externalBin` у tauri.conf.json."
        )
    return _seen_in_onefile(binary, names), f"onefile {binary.name}"


def test_artifact_really_carries_the_document_parsers():
    """Пакунок везе кожен розбирач, який модуль уміє попросити.

    Ворота на списку доводять, що бібліотека ОГОЛОШЕНА. Ці — що вона
    ДОЇХАЛА. Між оголошенням і артефактом лежить уся збірка.
    """
    app = _artifact()
    if app is None:
        pytest.skip(
            f"зібраного AppImage немає в {OUT_DIR} — стерегти нічого. "
            "Ці ворота міряють артефакт, а не дерево."
        )

    asked = _parsers_the_module_can_ask_for()
    assert asked, (
        "у `tools/document_text.py` не знайдено жодного `_missing(...)` — "
        "сторож ослаб: або розбирачі переписані, або їх більше немає"
    )
    controls = sorted(_declared_in_bundle() - {a.lower() for a in asked})
    assert controls, "requirements-bundle.txt не дає жодного контролю приладу"

    with _mounted(app) as mount:
        found, how = _probe(mount, asked | set(controls))

    seen_controls = sorted(found & set(controls))
    missing = sorted(a for a in asked if a not in found)

    # ── 1. Спершу питаємо прилад, чи він узагалі бачить.
    if len(seen_controls) < MIN_CONTROLS:
        pytest.skip(
            f"прилад осліп: у пакунку ({how}) не знайдено жодних "
            f"{MIN_CONTROLS} з {len(controls)} сторонніх бібліотек бандла "
            f"(знайдено: {seen_controls or 'жодної'}). Отже нуль на розбирачах "
            "нічого не означає. Найімовірніше змінився пакувальник: інша "
            "версія PyInstaller або увімкнене стиснення змісту PYZ. "
            "Полагодь вимір, перш ніж вірити його вироку."
        )

    # ── 2. Прилад бачить. Тепер його нуль — це вирок.
    if not missing:
        return

    stale = app.stat().st_mtime < BUNDLE_REQ.stat().st_mtime
    where = f"{app.name} ({how}), контроль бачить {seen_controls[:5]}"

    if stale:
        pytest.fail(
            f"пакунок НЕ везе {missing} — але він СТАРІШИЙ за "
            f"requirements-bundle.txt, тож інакше й бути не могло.\n"
            f"  пакунок:      {time.strftime('%Y-%m-%d %H:%M', time.localtime(app.stat().st_mtime))}\n"
            f"  список:       {time.strftime('%Y-%m-%d %H:%M', time.localtime(BUNDLE_REQ.stat().st_mtime))}\n"
            f"  {where}\n"
            "Це вирок АРТЕФАКТУ, а не коду: перезбери "
            "(`scripts/build_sidecar.sh` + пакування) і прожени ще раз. "
            "Доти пакунок відмовлятиме на PDF/XLSX/RTF словами, і це "
            "виглядатиме як задум."
        )

    pytest.fail(
        f"пакунок СВІЖІШИЙ за requirements-bundle.txt і все одно не везе "
        f"{missing} — це справжній дефект збірки.\n"
        f"  {where}\n"
        "Бібліотека оголошена в списку (ворота на списку зелені), але до "
        "артефакта не доїхала. Дивись `scripts/build_sidecar.sh`: "
        "`--collect-all` мовчки пропускає пакет, якого немає в "
        "`.build/venv-bundle` (гілка SKIPPED_PKGS друкує його в лог збірки). "
        "У продукті це буде не помилка, а чесна відмова «немає бібліотеки» — "
        "тобто дефект, на який ніхто не подасть баг."
    )
