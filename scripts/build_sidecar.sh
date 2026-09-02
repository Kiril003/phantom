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
PYI_ARGS=(
  --name "phantom-backend"
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
rm -rf "${SMOKE_DIR}"; mkdir -p "${SMOKE_DIR}"
say "димова перевірка: піднімаю ПОКЛАДЕНИЙ бінарник на порту ${SMOKE_PORT}"
(
  cd "${DEST}"
  PORT="${SMOKE_PORT}" PHANTOM_SKIP_TLS=1 PHANTOM_SKIP_MDNS=1 PHANTOM_SKIP_G2_WARMUP=1 \
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
