#!/usr/bin/env bash
# PHANTOM OS — збірка sidecar-бекенда для оболонки Tauri (Ф6).
#
# Що тут було до 29.08.2026 і чому це довелось замінити: скрипт не кликав
# PyInstaller жодного разу. Він писав двохрядкову заглушку —
# `#!/bin/sh` + `exec uvicorn main:app` — і сам про це чесно казав у
# коментарі («Day-5 will plumb pyinstaller here»). Але `tauri.conf.json`
# уже оголошував `externalBin: ["binaries/phantom-backend"]`, тож зібраний
# bundle віз би «бекенд», який кличе `uvicorn` з машини користувача. На
# чистій машині — саме там, де стоять ворота Ф6 — він не стартує.
#
# Поруч лежала друга недобудована дорога: `src/backend/_phantom_entry.py`
# описує себе як «Nuitka onefile entrypoint, compiled by
# scripts/build/nuitka_build.py». Того скрипта немає й ніколи не було —
# `git log --all` по ньому порожній. Сам вхідник при цьому справний і
# фреймворк-незалежний, тож PyInstaller бере саме його: він робить
# freeze_support до першого імпорту (без цього бандл на Windows стає
# форк-бомбою, бо sentence-transformers, faster-whisper і chromadb
# породжують воркерів), розкладає data/models/frontend поруч із бінарником
# і заганяє кеші HF усередину теки, щоб збірка була самодостатньою.
#
# Вага. Робочий venv — 6,0 ГБ, з них ~4,7 ГБ це CUDA-стек і playwright,
# яким у продукті немає чого робити. Тому збірка йде з окремого
# `requirements-bundle.txt` (CPU-торч), а не з `requirements.txt`.
# Скрипт друкує цифру на кожному кроці: «стало менше» — не звіт.
#
# Використання:
#   scripts/build_sidecar.sh                     # хостовий triple, onedir
#   scripts/build_sidecar.sh --onefile           # один файл (повільніший старт)
#   scripts/build_sidecar.sh aarch64-unknown-linux-gnu
#
# ── ПЕРЕЛІК ДЛЯ WINDOWS-ЗБИРАЧА (заміряно 06.09.2026) ────────────────────────
#
# Windows-сайдкара не існує, і саме через це `msi`/`nsis` у `tauri.conf.json` —
# намір, а не спроможність: `tauri-build` шукає
# `binaries/phantom-backend-x86_64-pc-windows-msvc.exe` і падає ще в build.rs.
# Перш ніж робити цей скрипт двомовним, ось із чого він насправді складається.
#
# Файл: 580 рядків = 318 коду + 232 коментаря + 30 порожніх. «604 рядки bash»
# лякають більше, ніж робота, що за ними стоїть.
#
#   блок                                  рядків  під Windows
#   ────────────────────────────────────────────────────────────────────────
#   ворота машини (flock, /proc, gradle)      88  НЕ ПОТРІБЕН — це про ЦЕЙ
#                                                 ноутбук: сусідній Gradle,
#                                                 oom-guard, спільний замок.
#                                                 На раннері VM своя.
#   ctypes-бібліотеки (ldd/ldconfig/.so)      63  НЕ ПОТРІБЕН — заміряно:
#                                                 колесо soundfile під Windows
#                                                 везе `_soundfile_data/
#                                                 libsndfile_x64.dll` усередині,
#                                                 тож `--collect-all soundfile`
#                                                 забирає її сам. Полювання на
#                                                 .so існує лише тому, що на
#                                                 Linux її в колесі НЕМАЄ.
#   перевірка шрифта (відмова)                52  ПЕРЕНОСИТЬСЯ ДОСЛІВНО
#   паспорт build_info.json                   45  переноситься, `date -u` дрібниця
#   складання аргументів PyInstaller          95  переноситься, крім двох `find
#                                                 -printf` (GNU-only)
#   середовище збірки, pick_python            74  шляхи: `bin/` → `Scripts/`
#   димова перевірка /health                  55  переноситься, інший інструмент
#   розкладка (install -m, cp -a, _internal)  24  переписати
#   решта (шапка, аргументи, weigh)           84  дрібниці
#
# Разом: 151 рядок (26%) на Windows не має СЕНСУ, а не «важко перенести».
#
# Уся непортативність сидить приблизно в 45 рядках КОДУ, і ось вони поіменно:
#   18 — ворота (GATE/flock)      10 — `venv/bin/python`, `bin/pip`
#    3 — `du -sb`                  3 — `/proc`
#    2 — `find -printf`            2 — `install -m`
#    по 1 — ldd, ldconfig, cp -a, free -m, pgrep, stat -c, seq, curl
#
# ЩО Я ПЕРЕВІРИВ І ПОМИЛИВСЯ: спершу записав `--add-data "src:dest"` у
# «переписати», бо на Windows роздільник `;`. Це НЕПРАВДА для нашої версії:
# PyInstaller 6.22.2 ділить регуляркою `(^\w:[/\\])|[:;]` — приймає і `:`, і
# `;`, і свідомо пропускає літеру диска на початку. Тобто всі `--add-data` та
# `--add-binary` у цьому скрипті переносяться БЕЗ ЗМІН. Не переписуй те, що
# працює, за спогадом про те, як воно колись було.
#
# ВИСНОВОК: чесніше написати ОКРЕМИЙ короткий збирач для Windows, ніж робити
# цей двомовним. Два блоки з чотирьох найбільших там просто не потрібні, а
# змішування «якщо Windows» у 45 місцях сховає ту єдину логіку, заради якої цей
# файл узагалі цінний: відмову без шрифта і димову перевірку, що СПРАВДІ
# піднімає зібраний бінарник і стукає в /health.
#
# І один пін, який не можна загубити: Windows-збірка можлива ЛИШЕ на Python
# 3.11 — `chroma-hnswlib==0.7.6` не має колеса win_amd64 під cp312.
# Подробиці — біля пінa `chromadb` у `requirements-bundle.txt`.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="${ROOT}/src/backend"
DEST="${ROOT}/src/frontend/src-tauri/binaries"
BUILD_VENV="${PHANTOM_BUNDLE_VENV:-${ROOT}/.build/venv-bundle}"
WORK="${ROOT}/.build/pyinstaller"

MODE="onedir"
TARGET=""
for arg in "$@"; do
  case "$arg" in
    --onefile) MODE="onefile" ;;
    --onedir)  MODE="onedir" ;;
    -*) echo "невідомий ключ: $arg" >&2; exit 2 ;;
    *) TARGET="$arg" ;;
  esac
done
TARGET="${TARGET:-$(rustc -vV 2>/dev/null | sed -n 's/host: //p' || echo "x86_64-unknown-linux-gnu")}"

say() { printf '[sidecar] %s\n' "$*"; }
weigh() {
  # $1 — шлях, $2 — підпис. Друкуємо байти І людський розмір: перше
  # порівнюється між прогонами, друге читається очима.
  local path="$1" label="$2" bytes human
  if [ ! -e "$path" ]; then say "ВАГА ${label}: (немає)"; return; fi
  bytes="$(du -sb "$path" | cut -f1)"
  human="$(du -sh "$path" | cut -f1)"
  say "ВАГА ${label}: ${human} (${bytes} Б)"
}

# ── Ворота машини ───────────────────────────────────────────────────────
#
# Шлях до замка ЗАШИТИЙ. Латка на справжню подію 03.09: агент, перевіряючи
# сторожа памʼяті, перенаправив змінну зі шляхом до замка на файл у
# скретчпаді. Сторож чесно виміряв памʼять, чесно пропустив — і важкий
# процес стартував поруч із чужою збіркою Gradle, яка тримала СПРАВЖНІЙ
# замок. Ворота обійшли не хитрістю, а ЧЕРЕЗ саму перевірку: перевірялись
# не ті ворота. Підміна лишається рівно для перевірки самого сторожа й
# вимагає сказати це вголос.
GATE_REAL='/tmp/phantom-verify/gate.lock'
GATE="${PHANTOM_GATE:-$GATE_REAL}"
if [ "$GATE" != "$GATE_REAL" ] && [ "${PHANTOM_GATE_TEST:-0}" != "1" ]; then
  echo "[sidecar] PHANTOM_GATE вказує на ${GATE}, а не на ${GATE_REAL} — відмовляюсь." >&2
  echo "[sidecar] PyInstaller тут тримає гігабайти й стає першою ціллю oom-guard." >&2
  echo "[sidecar] Для перевірки САМОГО сторожа: PHANTOM_GATE_TEST=1 — і скажи це вголос." >&2
  exit 6
fi
if [ "${PHANTOM_GATE_TEST:-0}" = "1" ]; then
  echo "[sidecar] УВАГА: тестовий режим воріт, справжній замок ${GATE_REAL} НЕ перевіряється." >&2
fi

if [ -f /.dockerenv ]; then
  # Усередині контейнера воріт немає: /tmp/phantom-verify — поняття хоста,
  # а сюди нас уже впустив `build_in_container.sh`, який їх і питав.
  # Кажемо це вголос, щоб пропуск не читався як пройдена перевірка.
  say "ворота: у контейнері не перевіряю — їх спитав build_in_container.sh на хості"
else
  _gate_holder() {
    local ino
    ino="$(stat -c %i "$GATE" 2>/dev/null)" || return 1
    awk -v ino="$ino" '$2=="FLOCK"{split($6,a,":"); if (a[3]==ino){print $5; exit}}' /proc/locks
  }
  _ppid_of() {  # $1 — pid. Батько, розібраний СТІЙКО.
    # Друге поле /proc/pid/stat — comm у дужках, і воно може містити
    # пробіли: на цій машині живе процес із comm «(npm run dev --p)», для
    # якого наївний `awk '{print $4}'` дає «dev» замість pid 11012. Сторож,
    # що читає сміття як номер процесу, визнав би чужого своїм.
    sed 's/.*) //' "/proc/$1/stat" 2>/dev/null | awk '{print $2}'
  }
  _is_ancestor() {  # $1 — pid
    local p=$$ guard=0
    while [ "${p:-0}" -gt 1 ] && [ "$guard" -lt 64 ]; do
      [ "$p" = "$1" ] && return 0
      p="$(_ppid_of "$p")"
      [ -n "$p" ] || return 1
      guard=$((guard + 1))
    done
    return 1
  }
  mkdir -p "$(dirname "$GATE")" 2>/dev/null || true
  # Замок, який тримає наш же батько (`flock -w 3600 … build_sidecar.sh`),
  # це НЕ зайняті ворота — це ми в них і стоїмо. Тому питаємо pid, а не
  # просто «чи вдається взяти».
  GATE_HOLDER="$(_gate_holder || true)"
  if [ -n "${GATE_HOLDER:-}" ] && ! _is_ancestor "$GATE_HOLDER"; then
    echo "[sidecar] ворота ${GATE} тримає чужий процес (pid ${GATE_HOLDER}):" >&2
    ps -o pid=,args= -p "$GATE_HOLDER" 2>/dev/null | cut -c1-140 >&2 || true
    echo "[sidecar] на машині важке — по одному. Чекай, не лізь." >&2
    exit 7
  fi
  # Рахуємо лише СПРАВЖНІ демони, за comm=java. `pgrep -f` збігається з
  # ТЕКСТОМ САМОЇ ПЕРЕВІРКИ: із цим скриптом, із чужим зондом, що шукає
  # Gradle, і з самим pgrep. Заміряно 03.09: під час перевірки цього ж
  # сторожа `pgrep -f` повернув два «живі Gradle» — справжній демон і
  # ВЛАСНУ ОБОЛОНКУ вимірювача, бо в її рядку запуску стояв цей шаблон.
  # Без справжнього демона поруч сторож відмовив би збірці рівно тому, що
  # хтось інший ПИТАЄ про Gradle, — і відмовив би тихо, бо «не лізу»
  # читається як обережність, а не як дефект. Дужка в шаблоні рятує від
  # себе, але не від чужих зондів без дужки; comm — від усіх.
  _gradle_alive() {
    local p
    for p in $(pgrep -f 'org\.gradle\.wrapper\.GradleWrapperMain' 2>/dev/null); do
      [ "$(cat "/proc/$p/comm" 2>/dev/null)" = java ] && return 0
    done
    return 1
  }
  if _gradle_alive; then
    echo "[sidecar] у ps живий Gradle (java) — зараз збирає сусідня сесія. Не лізу." >&2
    exit 9
  fi
  GATE_MIN_MB="${PHANTOM_MIN_MB:-6000}"
  GATE_FREE_MB="$(free -m | sed -n '2p' | awk '{print $NF}')"
  if [ -n "${GATE_FREE_MB:-}" ] && [ "${GATE_FREE_MB}" -lt "${GATE_MIN_MB}" ]; then
    echo "[sidecar] вільної памʼяті ${GATE_FREE_MB} МБ < ${GATE_MIN_MB} МБ — не запускаю PyInstaller." >&2
    exit 8
  fi
  say "ворота: ${GATE} вільні, памʼять ${GATE_FREE_MB} МБ, Gradle не бачу"
fi

say "triple:      ${TARGET}"
say "режим:       ${MODE}"
say "вхідник:     ${BACKEND}/_phantom_entry.py"
say "призначення: ${DEST}/phantom-backend-${TARGET}"

if [ ! -f "${BACKEND}/_phantom_entry.py" ]; then
  echo "немає ${BACKEND}/_phantom_entry.py — збирати нічого" >&2
  exit 1
fi
if [ ! -f "${BACKEND}/requirements-bundle.txt" ]; then
  echo "немає ${BACKEND}/requirements-bundle.txt — збірка з requirements.txt заборонена" >&2
  echo "(інакше в бандл поїде CUDA-стек і playwright: ~4,7 ГБ зайвого)" >&2
  exit 1
fi

# ── ШРИФТ: перевіряємо ПЕРШИМ, бо відмова тут коштує секунд ───────────────
#
# Виміряно 04.09.2026. У трьох базових образах — debian:12-slim, ubuntu:22.04,
# fedora:40 — шрифтових файлів (.ttf/.otf/.ttc) РІВНО НУЛЬ: жодної з тек, які
# перелічує `_FONT_DIRS` у `agent/missions/pdf_export.py`, там навіть не існує.
# У самому AppImage теж нуль, згадок «dejavu» — нуль. При цьому reportlab у
# бандлі ЖИВИЙ (67 модулів у змісті PYZ). Тобто рушій PDF їхав, а малювати
# кирилицю йому було нічим, і український звіт у пакунку не виходив узагалі.
# На машині розробника DejaVu стоїть системно — тому дефекту не було видно.
#
# Чотири накреслення, а не два. `_reportlab_font()` реєструє грань як
# `path if os.path.isfile(path) else base`, тобто з двома файлами курсив ТИХО
# став би прямим: не помилка, не попередження — просто інший вигляд звіту.
#
# LICENSE — умова розповсюдження, а не документація. Ми веземо чужий шрифт, і
# Bitstream Vera дозволяє це саме за умови, що повідомлення про авторство їде
# РАЗОМ із файлами. Немає файла — немає збірки.
#
# Це ВІДМОВА, а не пропуск: сусідній пласт даних нижче каже «не знайшов,
# пропустив», і саме такий мовчазний пропуск і був би тим дефектом знову.
FONTS_SRC="${BACKEND}/assets/fonts"
FONTS_DEST="assets/fonts"
FONTS_MISSING=""
for f in DejaVuSans.ttf DejaVuSans-Bold.ttf DejaVuSans-Oblique.ttf \
         DejaVuSans-BoldOblique.ttf LICENSE; do
  [ -s "${FONTS_SRC}/${f}" ] || FONTS_MISSING="${FONTS_MISSING} ${f}"
done
if [ -n "${FONTS_MISSING}" ]; then
  echo "[sidecar] у ${FONTS_SRC} бракує:${FONTS_MISSING}" >&2
  echo "[sidecar] Без цих файлів пакунок збереться зелено й не намалює жодної" >&2
  echo "[sidecar] кириличної літери у звіті PDF: на чистій машині системного" >&2
  echo "[sidecar] DejaVu немає — заміряно, у трьох базових образах нуль шрифтів." >&2
  echo "[sidecar] Мовчазний пропуск тут заборонений." >&2
  exit 1
fi
say "шрифт: чотири накреслення DejaVu + LICENSE на місці ($(du -sb "${FONTS_SRC}" | cut -f1) Б)"

# ── 1. Середовище збірки. Окреме від робочого venv — саме тому воно легше.
#
# Інтерпретатор вибираємо навмисно, а не беремо `python3` з PATH. Перший
# прогін 29.08 саме на цьому й ліг: на цій машині `python3` — 3.14, колеса
# під нього ще не збирають, і pip поліз компілювати з джерел. Упало три
# пакети однією хворобою: pydantic-core (pyo3 не підтримує >3.13), shapely
# (нема системного geos_c.h), av (API ffmpeg розійшовся). Жодне з трьох не
# є проблемою проєкту — це просто не той інтерпретатор. Робочий venv стоїть
# на 3.12, бандл мусить збиратись тим самим.
pick_python() {
  local c
  for c in "${PHANTOM_BUNDLE_PYTHON:-}" "${BACKEND}/.venv/bin/python" python3.12 python3.11 python3; do
    [ -n "$c" ] || continue
    command -v "$c" >/dev/null 2>&1 || [ -x "$c" ] || continue
    local v; v="$("$c" -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2>/dev/null)" || continue
    # Нижня межа — 3.11, і вона виміряна, а не взята зі стелі. Спершу тут
    # стояло 3.10, і збірка в контейнері Ubuntu 22.04 (де python3 = 3.10.12)
    # пройшла зелено, а бандл упав на першому ж старті:
    #   ImportError: cannot import name 'StrEnum' from 'enum'  (ai/tool_use.py:18)
    # `enum.StrEnum` з'явився у 3.11. CLAUDE.md і оголошує 3.11 — я просто
    # був щедрішим за проєкт. Верхня межа 3.12 — бо під 3.13+ ще немає
    # бінарних коліс для pydantic-core, shapely і av.
    #
    # УВАГА ДЛЯ WINDOWS: тут 3.12 стоїть ПЕРШИМ у переліку кандидатів вище, і
    # для Linux це правильно. Під Windows це зламало б збірку: chromadb тягне
    # `chroma-hnswlib==0.7.6`, у якої немає колеса win_amd64 під cp312 (є
    # cp37…cp311). Заміряно 06.09.2026 — див. коментар біля пінa chromadb у
    # `requirements-bundle.txt`. Windows-збирач мусить брати саме 3.11, і це
    # вимога, а не збіг; те, що `pc-desktop-ci.yml` уже ставить 3.11, —
    # випадковість, на яку не можна спиратись.
    case "$v" in
      3.11|3.12) echo "$c"; return 0 ;;
    esac
  done
  return 1
}

# Середовище могло лишитись від ІНШОЇ машини. Саме це й сталось 29.08 при
# першому заході в контейнер: на хості `.build/venv-bundle` створювався
# інтерпретатором з uv, у контейнері того шляху немає, symlink повис, і
# `python3 -m venv` на непорожній теці впав із «No such file or directory:
# .../bin/python3». Перевіряємо не наявність файлу, а те, що інтерпретатор
# справді запускається — і зносимо труп, якщо ні.
if [ -e "${BUILD_VENV}" ]; then
  venv_v="$("${BUILD_VENV}/bin/python" -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2>/dev/null || true)"
  case "${venv_v}" in
    3.11|3.12)
      : ;;  # придатне, лишаємо
    "")
      say "середовище збірки нежиттєздатне (інший хост чи інтерпретатор) — перестворюю"
      rm -rf "${BUILD_VENV}" ;;
    *)
      # Перевіряти лише «чи запускається» — замало. Саме так і сталось
      # 29.08 у контейнері: лишилось середовище на 3.10 від попереднього
      # прогону, воно чудово запускалось, і збірка мовчки пішла на ньому
      # знову — аж до «Python shared library libpython3.10.so.1.0 was not
      # found». Версія середовища — така сама його властивість, як
      # працездатність.
      say "середовище збірки на Python ${venv_v}, а потрібен 3.11-3.12 — перестворюю"
      rm -rf "${BUILD_VENV}" ;;
  esac
fi

if [ ! -x "${BUILD_VENV}/bin/python" ]; then
  PYBIN="$(pick_python)" || {
    echo "не знайшов інтерпретатора 3.10–3.12 для збірки бандла." >&2
    echo "на цій машині python3 = $(python3 -V 2>&1); під нього ще немає бінарних коліс," >&2
    echo "і pip піде компілювати pydantic-core/shapely/av з джерел — це впаде." >&2
    echo "постав PHANTOM_BUNDLE_PYTHON=/шлях/до/python3.12 і повтори." >&2
    exit 1
  }
  say "інтерпретатор:  ${PYBIN} ($("${PYBIN}" -V 2>&1))"
  say "створюю середовище збірки: ${BUILD_VENV}"
  "${PYBIN}" -m venv "${BUILD_VENV}"
fi
say "збірка на: $("${BUILD_VENV}/bin/python" -V 2>&1)"
say "ставлю залежності бандла (CPU-торч, без тестових)"
"${BUILD_VENV}/bin/pip" install --quiet --upgrade pip
"${BUILD_VENV}/bin/pip" install --quiet -r "${BACKEND}/requirements-bundle.txt"
"${BUILD_VENV}/bin/pip" install --quiet pyinstaller
weigh "${BUILD_VENV}" "середовище збірки"
weigh "${BACKEND}/.venv" "робочий venv (для порівняння)"

# ── 2. Сама збірка.
rm -rf "${WORK}"
mkdir -p "${WORK}"

# ── Паспорт збірки всередину бандла ──────────────────────────────────────
#
# Виміряно 03.09: у зібраному сайдкарі немає коміта НІДЕ, а `/health`
# віддає зашите "version": "0.1.0" при 0.20.0 у tauri.conf.json. Тобто
# запущений продукт не може сказати, з чого він зібраний, — а це рівно те,
# що потрібно, коли на столі два пакунки й одна скарга.
#
# Значення беремо з середовища, коли нас покликав `build_in_container.sh`:
# він уже спитав дерево ДО збірки, і всередині контейнера `git` може бути
# відсутній зовсім. Свій `git` — лише запасний шлях для запуску з хоста.
BUILD_SHA="${PHANTOM_BUILD_SHA:-$(git -C "${ROOT}" rev-parse --short=8 HEAD 2>/dev/null || echo 'nogit')}"
if [ -n "${PHANTOM_BUILD_DIRTY:-}" ]; then
  BUILD_DIRTY="${PHANTOM_BUILD_DIRTY}"
elif [ -n "$(git -C "${ROOT}" status --porcelain 2>/dev/null || echo dirty)" ]; then
  # Тут навмисно НЕ відмова, на відміну від `build_in_container.sh`.
  # Відмовляти має та дорога, що робить пакунок для людини; цей скрипт
  # ганяють ще й поштучно, під час роботи, коли дерево брудне за
  # визначенням — і жорсткий стоп просто заблокував би сусідні сесії на
  # спільному дереві.
  #
  # Обіцянка від цього не слабшає: заборонено не збирати чорнетку, а видати
  # її за чисту збірку. Паспорт усередині бандла скаже dirty=true, і якщо
  # такий сайдкар потім потрапить у пакунок через етап `front` (де sidecar
  # не перезбирається), два паспорти розійдуться — і це стане видно.
  BUILD_DIRTY=1
  say "УВАГА: дерево брудне — паспорт бандла піде з dirty=true (пакунок такий не збереться без PHANTOM_BUILD_ALLOW_DIRTY=1)"
else
  BUILD_DIRTY=0
fi
BUILD_VERSION="${PHANTOM_BUILD_VERSION:-$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "${ROOT}/src/frontend/src-tauri/tauri.conf.json" 2>/dev/null || echo '0.0.0')}"
BUILD_AT="${PHANTOM_BUILD_AT:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
cat > "${WORK}/build_info.json" <<INFO
{
  "component": "sidecar",
  "commit": "${BUILD_SHA}",
  "dirty": $([ "${BUILD_DIRTY}" = "1" ] && echo true || echo false),
  "version": "${BUILD_VERSION}",
  "built_at": "${BUILD_AT}"
}
INFO
say "паспорт бандла: коміт ${BUILD_SHA}, dirty=${BUILD_DIRTY}, версія ${BUILD_VERSION}"

PYI_ARGS=(
  --name "phantom-backend"
  # Паспорт лягає в корінь бандла, тобто читається як
  # `Path(sys._MEIPASS) / "build_info.json"` — і в onefile, і в onedir.
  --add-data "${WORK}/build_info.json:."
  --distpath "${WORK}/dist"
  --workpath "${WORK}/work"
  --specpath "${WORK}"
  --noconfirm
  --clean
  # Модулі бекенда лежать плоско поруч із вхідником і імпортуються як
  # верхньорівневі (api, core, ai…) — так само, як у dev через main.py.
  --paths "${BACKEND}"
  # `_phantom_entry.py` кличе `uvicorn.run("main:app", ...)` — РЯДКОМ.
  # Статичний аналіз такого посилання не бачить у принципі, тож перший
  # успішний бандл 29.08 зібрався зелено й одразу впав на
  # «Error loading ASGI app. Could not import module "main"». Тому
  # верхньорівневі модулі бекенда доносимо явно, а не сподіваємось.
  --hidden-import main
)

# Модулі бекенда лежать плоско поруч із вхідником і імпортуються як
# верхньорівневі (api, core, ai…). Перелічуємо їх з диска, а не списком у
# скрипті: список протухне на першому ж новому пакеті, диск — ні.
while IFS= read -r pkg; do
  PYI_ARGS+=(--collect-submodules "$pkg")
done < <(
  find "${BACKEND}" -maxdepth 2 -name '__init__.py' -not -path '*/.venv/*' \
    -not -path '*/tests/*' -printf '%h\n' 2>/dev/null \
    | sed "s|^${BACKEND}/||" | grep -v '/' | sort -u
)
while IFS= read -r mod; do
  PYI_ARGS+=(--hidden-import "$mod")
done < <(
  find "${BACKEND}" -maxdepth 1 -name '*.py' -not -name '_phantom_entry.py' \
    -not -name 'test_*' -printf '%f\n' 2>/dev/null | sed 's/\.py$//' | sort -u
)

# Важкі залежності, яких аналіз теж не бачить: їх імпортують ліниво,
# усередині функцій (`memory/embedding_fn.py` бере sentence-transformers
# через chromadb; голос тягне vosk і faster-whisper за станом налаштувань).
# Перший бандл вийшов 154 МБ саме тому, що жодної з них у ньому не було —
# він стартував би і вмер на першому ж записі в пам'ять.
SKIPPED_PKGS=""
#
# Другий пласт — драйвери й бекенди, які їхні бібліотеки піднімають ЗА
# ІМЕНЕМ, рядком. Прогін №2 ліг саме на цьому: `main` уже імпортувався, а
# `db/database.py` упав на `No module named 'aiosqlite'` — SQLAlchemy шукає
# діалект `sqlite+aiosqlite` через реєстр рядків, тож у графі імпортів його
# немає. Те саме сімейство: alembic вантажить міграції шляхом, passlib —
# хендлер `bcrypt` за назвою, uvicorn[standard] — uvloop/httptools, коли
# знайде. Кожен із них видно лише в рантаймі й лише на потрібному шляху.
#
# Третє сімейство — розбирачі документів. Їх імпортує `tools/document_text.py`
# усередині функцій, і саме тому їх легко втратити мовчки: без pypdf модуль не
# падає, він ЧЕСНО ВІДМОВЛЯЄ — «немає бібліотеки», — тож мертвий бандл
# виглядав би як робочий продукт, що просто не вміє PDF. Збираємо цілком:
# pypdf піднімає криптопровайдера за станом файла, openpyxl — читалки за
# типом книги, і жодне з цього не видно в графі імпортів.
for pkg in torch sentence_transformers transformers tokenizers safetensors \
           chromadb onnxruntime faster_whisper ctranslate2 vosk soundfile \
           cv2 shapely segno piper supertonic \
           pypdf openpyxl striprtf \
           aiosqlite sqlalchemy alembic passlib bcrypt jose \
           uvloop httptools websockets zeroconf; do
  # `--collect-all` по невстановленому пакету валить PyInstaller, а імена
  # дистрибутива й модуля збігаються не завжди (piper-tts → piper).
  # Питаємо інтерпретатор збірки, а не вгадуємо.
  if "${BUILD_VENV}/bin/python" -c "import importlib.util,sys; sys.exit(0 if importlib.util.find_spec('$pkg') else 1)" 2>/dev/null; then
    PYI_ARGS+=(--collect-all "$pkg")
  else
    SKIPPED_PKGS="${SKIPPED_PKGS} ${pkg}"
  fi
done
if [ -n "${SKIPPED_PKGS}" ]; then say "не знайдено, пропущено:${SKIPPED_PKGS}"; fi

# Третій пласт — те, що взагалі не є пітонівським кодом. PyInstaller везе
# модулі, а ці теки він не бачить, бо їх читають з диска за шляхом.
# Прогін №3 ліг саме тут: alembic шукав `_internal/db/alembic` і не знайшов
# («Path doesn't exist … Please use the 'init' command»), тож застосунок
# помер на міграціях ще до першого запиту.
#   db/alembic + alembic.ini — env.py, script.py.mako і versions/
#   geo/layer_registry/manifests — реєстр шарів мапи, 26 маніфестів; без
#     них мапа підніметься порожньою, а мапа — найсильніше, що є в продукті
for pair in \
  "db/alembic:db/alembic" \
  "alembic.ini:." \
  "geo/layer_registry/manifests:geo/layer_registry/manifests"; do
  src="${BACKEND}/${pair%%:*}"
  if [ -e "$src" ]; then
    PYI_ARGS+=(--add-data "${src}:${pair##*:}")
  else
    say "дані не знайдено, пропущено: ${pair%%:*}"
  fi
done

# Четвертий пласт — системні бібліотеки, які пітон вантажить ЧЕРЕЗ ctypes,
# а не лінкує. Аналіз PyInstaller їх не бачить у принципі: у графі імпортів
# їх немає, у таблиці лінкування теж.
#
# Знайдено воротами чистої машини 29.08.2026 — контейнер `debian:12-slim`,
# без пітона, без venv, без наших пакетів:
#   OSError: cannot load library 'libsndfile.so': cannot open shared object file
# `soundfile` тягне її саме ctypes-ом, і на машині розробника вона є
# системно, тож дефекту не видно НІКОЛИ. Це і є та різниця між «зібралось»
# і «працює в людини», заради якої ворота існують.
#
# Тягнемо разом із залежностями: сама libsndfile лінкується на кодеки
# (ogg, vorbis, FLAC, opus, mpg123, mp3lame), і без них вона не завантажиться.
say "збираю системні бібліотеки, що вантажаться через ctypes"
CTYPES_LIBS=""
for soname in libsndfile.so.1; do
  libpath="$("${BUILD_VENV}/bin/python" - "$soname" <<'PY' 2>/dev/null
import ctypes.util, sys, subprocess, re
name = sys.argv[1]
# ctypes.util.find_library хоче ім'я без "lib" і без ".so.N"
short = re.sub(r"^lib|\.so.*$", "", name)
p = ctypes.util.find_library(short)
if p and "/" in p:
    print(p)
else:
    out = subprocess.run(["/sbin/ldconfig", "-p"], capture_output=True, text=True).stdout
    for line in out.splitlines():
        if name in line and "=>" in line:
            print(line.split("=>")[-1].strip())
            break
PY
)"
  if [ -z "$libpath" ] || [ ! -e "$libpath" ]; then
    say "УВАГА: ${soname} не знайдено на машині збірки — бандл поїде без неї"
    continue
  fi
  # Сама бібліотека та її нестандартні залежності.
  # Фільтр ПО ІМЕНІ, а не по шляху. Перший захід у контейнер відфільтрував
  # за зразком `^/usr/lib/...`, а в Ubuntu ці бібліотеки лежать у
  # `/lib/x86_64-linux-gnu/`, тож у бандл поїхали `libc.so.6` і `libm.so.6`.
  # Тягнути з собою власний libc — найшвидший спосіб отримати незрозумілі
  # падіння: він розійдеться з системним загрузчиком.
  for dep in "$libpath" $(ldd "$libpath" 2>/dev/null | awk '/=>/ {print $3}' | grep -vE '/(ld-linux[^/]*|libc|libm|libpthread|libdl|librt|libgcc_s)\.so' ); do
    [ -e "$dep" ] || continue
    PYI_ARGS+=(--add-binary "${dep}:.")
    CTYPES_LIBS="${CTYPES_LIBS} $(basename "$dep")"
  done

  # І ще одне ім'я — БЕЗ версії. Перший прогін воріт чистої машини поклав
  # у бандл `libsndfile.so.1`, а `soundfile` просить рівно `libsndfile.so`:
  #     OSError: cannot load library 'libsndfile.so'
  # На системі різницю прибирає симлінк із пакета розробки, у бандлі його
  # немає. Кладемо копію під неверсійним іменем — інакше бібліотека їде
  # разом із застосунком і все одно лишається невидимою для нього.
  unver="$(basename "$libpath" | sed 's/\.so\..*/.so/')"
  if [ "$unver" != "$(basename "$libpath")" ]; then
    mkdir -p "${WORK}/ctypes-alias"
    cp -f "$libpath" "${WORK}/ctypes-alias/${unver}"
    PYI_ARGS+=(--add-binary "${WORK}/ctypes-alias/${unver}:.")
    CTYPES_LIBS="${CTYPES_LIBS} ${unver}(без версії)"
  fi
done
if [ -n "${CTYPES_LIBS}" ]; then say "додано:${CTYPES_LIBS}"; fi

# П'ятий пласт — ШРИФТ. Сам файл уже перевірено на початку скрипта (там, де
# відмова коштує секунд, а не десяти хвилин PyInstaller); тут лишається
# покласти теку в бандл. Призначення `assets/fonts` — та сама домовленість,
# яку читає `_BUNDLE_FONT_SUBDIR` в `agent/missions/pdf_export.py`.
PYI_ARGS+=(--add-data "${FONTS_SRC}:${FONTS_DEST}")
weigh "${FONTS_SRC}" "шрифт DejaVu + LICENSE (їде в бандл як ${FONTS_DEST})"


[ "${MODE}" = "onefile" ] && PYI_ARGS+=(--onefile) || PYI_ARGS+=(--onedir)

say "запускаю PyInstaller (${MODE}) — це надовго"
( cd "${BACKEND}" && "${BUILD_VENV}/bin/pyinstaller" "${PYI_ARGS[@]}" "_phantom_entry.py" )

# ── 3. Розкладання під те, чого чекає Tauri.
mkdir -p "${DEST}"
BIN_OUT="${DEST}/phantom-backend-${TARGET}"
if [ "${MODE}" = "onefile" ]; then
  install -m 0755 "${WORK}/dist/phantom-backend" "${BIN_OUT}"
  weigh "${BIN_OUT}" "бінарник (onefile)"
else
  # onedir: бутлоадер PyInstaller шукає теку з ЖОРСТКО ЗАШИТИМ іменем
  # `_internal`, поруч із собою. Тут я вже помилився один раз: перейменував
  # її на `phantom-backend-internal` (щоб гарніше лягло під Tauri), і
  # покладений бінарник помер з
  # «Failed to load Python shared library …/binaries/_internal/libpython3.12.so.1.0».
  # Димова перевірка цього не спіймала, бо ганяла копію з теки складання,
  # де розкладка правильна. Ім'я не наше — не чіпаємо.
  rm -rf "${DEST}/_internal"
  cp -a "${WORK}/dist/phantom-backend/_internal" "${DEST}/_internal"
  install -m 0755 "${WORK}/dist/phantom-backend/phantom-backend" "${BIN_OUT}"
  weigh "${BIN_OUT}" "бінарник (onedir)"
  weigh "${DEST}/_internal" "тека _internal"
  say "УВАГА: Tauri кладе в bundle лише сам файл externalBin, без сусідніх тек."
  say "Отже `_internal` треба донести окремо (bundle.resources або власний spawn)."
  say "Поки цього немає — AppImage збереться і не запуститься."
fi
weigh "${WORK}/dist" "весь вихід PyInstaller"

# ── 4. Димова перевірка. Без неї «Build complete» нічого не означає:
# перший зелений бандл 29.08 зібрався без єдиної помилки і не піднявся
# взагалі. Скрипт, що каже «готово» не запустивши те, що зібрав, — бреше.
#
# Ганяємо ПОКЛАДЕНУ копію, а не ту, що в теці складання. Різниця не
# теоретична: перша версія перевіряла `dist/`, де розкладка завідомо
# правильна, і пропустила те, що покладений бінарник не бачив свого
# `_internal` через перейменування. Перевіряти треба той файл, який
# поїде далі, і з того місця, де він лежатиме.
SMOKE_PORT="${PHANTOM_SMOKE_PORT:-8099}"
SMOKE_DIR="${WORK}/smoke"
SMOKE_LOG="${WORK}/smoke.log"
rm -rf "${SMOKE_DIR}"; mkdir -p "${SMOKE_DIR}/tmp"

# TMPDIR — НА ДИСК, і це не косметика. Заміряно 03.09 на покладеному
# бінарнику: onefile розпаковує себе в TMPDIR на КОЖНОМУ старті, і розпаковка
# важить 1 584 090 672 Б (1,48 ГіБ). Типовий `/tmp` тут — tmpfs на 7,7 ГБ,
# тобто це памʼять машини, а не диск.
#
# Точно: при штатному завершенні бутлоадер розпаковку прибирає (перевірено —
# після `kill` теки не лишилось). Отже це не витік, а ЖИВА ціна: поки
# бінарник працює, півтора гігабайти RAM зайняті нічим, окрім копії його ж
# нутрощів. Осиротілі `_MEI*` лишаються лише після жорсткої смерті — саме їх
# і рахує попередження вгорі цього скрипта.
#
# Під час збірки поруч живуть docker, PyInstaller і сторож oom-guard, який
# стріляє в найбільший процес; півтора зайвих гігабайти тут вирішують.
say "димова перевірка: піднімаю ПОКЛАДЕНИЙ бінарник на порту ${SMOKE_PORT}"
say "                  TMPDIR=${SMOKE_DIR}/tmp (на диску: onefile розпакує туди ~1,5 ГБ)"
(
  cd "${DEST}"
  PORT="${SMOKE_PORT}" PHANTOM_SKIP_TLS=1 PHANTOM_SKIP_MDNS=1 PHANTOM_SKIP_G2_WARMUP=1 \
    TMPDIR="${SMOKE_DIR}/tmp" \
    PHANTOM_DATA_DIR="${SMOKE_DIR}/data" PHANTOM_MODELS_DIR="${SMOKE_DIR}/models" \
    "./phantom-backend-${TARGET}"
) > "${SMOKE_LOG}" 2>&1 &
SMOKE_PID=$!

SMOKE_OK=0
for _ in $(seq 1 90); do
  if ! kill -0 "${SMOKE_PID}" 2>/dev/null; then break; fi
  if curl -sf -o /dev/null "http://127.0.0.1:${SMOKE_PORT}/health" 2>/dev/null; then SMOKE_OK=1; break; fi
  sleep 2
done
kill "${SMOKE_PID}" 2>/dev/null || true
wait "${SMOKE_PID}" 2>/dev/null || true

if [ "${SMOKE_OK}" = "1" ]; then
  say "димова перевірка ПРОЙДЕНА: /health відповів із бандла"
else
  say "димова перевірка ПРОВАЛЕНА — бандл зібрався, але не обслуговує /health"
  say "останні рядки: ${SMOKE_LOG}"
  tail -n 15 "${SMOKE_LOG}" >&2 || true
  exit 1
fi

say "готово: ${BIN_OUT}"
say "перевірка на ЧИСТІЙ МАШИНІ (контейнер без venv, без моделей) — окремий крок; тут вона НЕ виконана"
