#!/usr/bin/env bash
# PHANTOM OS — повна збірка ПК у контейнері зі старою glibc (Ф6).
#
# Чому не на хості. Виміряно 29.08.2026: AppImage, зібраний на цій машині
# (glibc 2.44), не запускається ні на Debian 12 (2.36), ні на Debian 13
# (2.41) — оболонка вимагає GLIBC_2.39, притягнуті бібліотеки до 2.43.
# Закон динамічного лінкування: зібране під новішою glibc не працює на
# старішій. Отже збираємо під найстарішою, яку підтримуємо.
#
# Ubuntu 22.04 = glibc 2.35, і цього досить для всіх живих дистрибутивів.
# Образ описаний у `scripts/build-env.Dockerfile`.
#
# Використання:
#   flock -w 3600 /tmp/phantom-verify/gate.lock scripts/build_in_container.sh
#   flock -w 3600 /tmp/phantom-verify/gate.lock scripts/build_in_container.sh sidecar
#
# Замок обовʼязковий: машина одна, і важке на ній — по одному. Скрипт сам
# перевіряє, чи ворота не тримає ЧУЖИЙ процес, і чи не живий поруч Gradle.
# Шлях до замка зашитий; підмінити його можна лише для перевірки самого
# сторожа, і лише вголос (PHANTOM_GATE_TEST=1).
#
# Коди виходу, які означають «не зараз», а не «зламалось»:
#   6 — PHANTOM_GATE підмінено без PHANTOM_GATE_TEST=1
#   7 — ворота тримає чужий процес
#   8 — вільної памʼяті менше за поріг (типово 6000 МБ)
#   9 — на машині живий Gradle
#   1 — дерево не дорівнює коміту (обхід: PHANTOM_BUILD_ALLOW_DIRTY=1,
#       і тоді артефакт отримує «-dirty» в імені)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="${PHANTOM_BUILD_IMAGE:-phantom-build:22.04}"
STAGE="${1:-all}"

# Кожен запуск AppImage лишає розпаковку `/tmp/_MEI*` на ~400 МБ — і не
# прибирає її НІХТО. `/tmp` тут tmpfs, тобто це памʼять машини, а не диск.
# Це не витік у коді, а витік у звичці, тому хай кричить саме.
# `|| true` тут не косметика. У скрипта `set -euo pipefail`, а `ls` без
# збігів повертає 2 — і pipefail проносить це через `wc`, тобто присвоєння
# «падає», а `set -e` мовчки вбиває ВСЮ збірку ще до першого рядка виводу.
# Саме так це й сталось 30.08: попередження, написане щоб зробити тихий
# витік гучним, само вбило збірку тихо.
_mei=$(ls -d /tmp/_MEI* 2>/dev/null | wc -l) || _mei=0
if [ "$_mei" -gt 0 ]; then
  echo "[увага] осиротілих розпаковок PyInstaller у /tmp: ${_mei} ($(du -sh --total /tmp/_MEI* 2>/dev/null | tail -1 | cut -f1))"
  echo "        прибрати: rm -rf /tmp/_MEI*   (памʼять машини, не диск)"
fi

say() { printf '[контейнер] %s\n' "$*"; }
die() { printf '[контейнер] %s\n' "$*" >&2; exit 1; }

# ── Ворота машини ───────────────────────────────────────────────────────
#
# Шлях до замка ЗАШИТИЙ, і це латка на справжню подію, не педантизм:
# 03.09 агент, перевіряючи сторожа памʼяті, перенаправив змінну зі шляхом
# до замка на файл у скретчпаді. Сторож чесно виміряв памʼять, чесно
# пропустив — і важкий процес стартував поруч із чужою збіркою Gradle, яка
# тримала СПРАВЖНІЙ замок. Ворота обійшли не хитрістю, а ЧЕРЕЗ саму
# перевірку: перевірялись не ті ворота.
#
# Тому підміна лишається рівно для одного випадку — перевірити самого
# сторожа — і вимагає сказати це вголос окремою змінною. Мовчазної підміни
# більше немає.
GATE_REAL='/tmp/phantom-verify/gate.lock'
GATE="${PHANTOM_GATE:-$GATE_REAL}"
if [ "$GATE" != "$GATE_REAL" ] && [ "${PHANTOM_GATE_TEST:-0}" != "1" ]; then
  echo "[контейнер] PHANTOM_GATE вказує на ${GATE}, а не на ${GATE_REAL} — відмовляюсь." >&2
  echo "[контейнер] Замок штабу підмінювати не можна: docker і PyInstaller тут" >&2
  echo "[контейнер] їдять гігабайти й стають першою ціллю сторожа памʼяті." >&2
  echo "[контейнер] Для перевірки САМОГО сторожа: PHANTOM_GATE_TEST=1 — і скажи це вголос." >&2
  exit 6
fi
if [ "${PHANTOM_GATE_TEST:-0}" = "1" ]; then
  echo "[контейнер] УВАГА: тестовий режим воріт, справжній замок ${GATE_REAL} НЕ перевіряється." >&2
fi

# Хто ТРИМАЄ замок. Просте `flock -n` тут не годиться: рекомендований запуск
# — `flock -w 3600 <замок> ./scripts/build_in_container.sh`, тобто замок
# тримає наш ЖЕ батько, і глуха відмова відмовляла б власному правильному
# виклику. Тому питаємо /proc/locks, чий це pid, і дивимось, чи він серед
# наших предків: свій — проходимо, чужий — стоп.
_gate_holder() {
  local ino
  ino="$(stat -c %i "$GATE" 2>/dev/null)" || return 1
  awk -v ino="$ino" '$2=="FLOCK"{split($6,a,":"); if (a[3]==ino){print $5; exit}}' /proc/locks
}
_ppid_of() {  # $1 — pid. Батько, розібраний СТІЙКО.
  # `awk '{print $4}'` тут брехав би: друге поле /proc/pid/stat — це comm у
  # дужках, і воно може містити пробіли. На цій машині просто зараз живе
  # процес із comm «(npm run dev --p)», і наївний розбір давав для нього
  # «dev» замість pid 11012. Сторож, що читає сміття як номер процесу,
  # визнав би чужого своїм. Тому ріжемо все до останньої «) » — після неї
  # поля рахуються надійно: state, ppid, …
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
GATE_HOLDER="$(_gate_holder || true)"
if [ -n "${GATE_HOLDER:-}" ] && ! _is_ancestor "$GATE_HOLDER"; then
  echo "[контейнер] ворота ${GATE} тримає чужий процес (pid ${GATE_HOLDER}):" >&2
  ps -o pid=,args= -p "$GATE_HOLDER" 2>/dev/null | cut -c1-140 >&2 || true
  echo "[контейнер] на машині важке — по одному. Чекай, не лізь." >&2
  exit 7
fi

# Gradle тут не сусід, а конкурент: він тримає купу на гігабайти, і сторож
# oom-guard стріляє в НАЙБІЛЬШИЙ процес. Двічі за тиждень так гинула саме
# збірка, а не той, хто зайняв памʼять.
# Рахуємо лише СПРАВЖНІ демони, за comm=java. `pgrep -f` збігається з ТЕКСТОМ
# САМОЇ ПЕРЕВІРКИ: з цим скриптом, з чужим зондом, що шукає Gradle, і з самим
# pgrep. Заміряно 03.09: три «живі Gradle» виявились оболонкою, чекачем збірки
# і пошуком — жоден не java, а `gradlew` у цьому дереві не існує взагалі (тут
# Python і Tauri). Сторож відмовляв би збірці саме тоді, коли хтось інший лише
# ПИТАЄ про Gradle, — і відмовляв би тихо, бо це читається як обережність.
# Дужка в шаблоні рятує від себе, але не від чужих зондів без дужки; comm — від
# усіх.
_gradle_alive() {
  local p
  for p in $(pgrep -f 'org\.gradle\.wrapper\.GradleWrapperMain' 2>/dev/null); do
    [ "$(cat "/proc/$p/comm" 2>/dev/null)" = java ] && return 0
  done
  return 1
}
if _gradle_alive; then
  echo "[контейнер] у ps живий Gradle (java) — зараз збирає сусідня сесія. Не лізу." >&2
  exit 9
fi

GATE_MIN_MB="${PHANTOM_MIN_MB:-6000}"
GATE_FREE_MB="$(free -m | sed -n '2p' | awk '{print $NF}')"
if [ -n "${GATE_FREE_MB:-}" ] && [ "${GATE_FREE_MB}" -lt "${GATE_MIN_MB}" ]; then
  echo "[контейнер] вільної памʼяті ${GATE_FREE_MB} МБ < ${GATE_MIN_MB} МБ — не запускаю docker." >&2
  echo "[контейнер] oom-guard застрелив би його як найбільший процес." >&2
  exit 8
fi
say "ворота: ${GATE} вільні, памʼять ${GATE_FREE_MB} МБ, Gradle не бачу"

# ── дерево: лише коміт ──────────────────────────────────────────────────
#
# Форма взята з `phantom-companion-integration/scripts/release.sh` — там це
# вже стоїть після того, як реліз телефона 03.09 зібрався зеленим із дерева,
# яке переписували ПІД ЧАС збірки. На ПК цієї перевірки не було взагалі:
# `-v "${ROOT}:/work"` монтує дерево цілком, тобто в пакунок їде рівно те,
# що лежить на диску в цю секунду, а не те, що є в історії. Виміряно, що це
# вже кусає: закомічені тести читають файли, яких у жодному коміті немає,
# тож «доведено на пакунку» не переносилось на SHA — а саме SHA потім
# називає сайт.
#
# Замок серіалізує ЗБІРКИ, а не правки: поки docker жує десять хвилин,
# сусідня сесія спокійно пише у ті самі файли. Тому питаємо стан дерева
# ДО того, як щось запущено.
DIRTY="$(git -C "${ROOT}" status --porcelain 2>/dev/null || echo '?? git-недоступний')"
DIRTY_SUFFIX=""
if [ -n "$DIRTY" ]; then
  if [ "${PHANTOM_BUILD_ALLOW_DIRTY:-0}" != "1" ]; then
    echo "[контейнер] дерево не дорівнює коміту — пакунок із такого дерева невідтворюваний:" >&2
    awk 'NR<=12' <<< "$DIRTY" >&2
    # Саме `if`, а не `[ … ] && echo`. Під `set -e` хибний тест робить
    # весь список `&&` невдалим, і скрипт помирає ПРЯМО ТУТ — з кодом 1,
    # але без наступного рядка. Тобто при 12 і менше брудних файлах
    # оператор отримав би мовчазну відмову й ніколи не побачив, що обхід
    # узагалі існує. Перевірено: у прогоні 03.09 рядків було 14, і лише
    # тому підказка надрукувалась.
    if [ "$(wc -l <<< "$DIRTY")" -gt 12 ]; then
      echo "  … усього $(wc -l <<< "$DIRTY") рядків" >&2
    fi
    die "закомітьте або приберіть зміни, потім запускайте знову (git stash тут заборонено — дерево спільне). Свідомо збираю чорнетку: PHANTOM_BUILD_ALLOW_DIRTY=1"
  fi
  # Обхід є, але він не безкоштовний: артефакт мусить сам себе видавати.
  # Без цього суфікса брудна збірка виглядає на диску точно як чиста, і
  # через день ніхто вже не скаже, котра з двох поїхала власнику.
  DIRTY_SUFFIX="-dirty"
  say "УВАГА: дерево брудне ($(wc -l <<< "$DIRTY") рядків), але PHANTOM_BUILD_ALLOW_DIRTY=1."
  say "       Артефакт поїде з «-dirty» у назві — відтворити його з коміту НЕМОЖЛИВО."
fi

# `--short=8` — та сама довжина, що в релізі телефона, щоб дві половини
# продукту називали коміт однаково.
HEAD_SHA="$(git -C "${ROOT}" rev-parse --short=8 HEAD 2>/dev/null || echo 'nogit')"

# Версію читаємо з `tauri.conf.json`, а не пишемо числом у скрипті. Тут уже
# стояв літерал «0.20.0» в імені для appimagetool: варто підняти версію в
# конфізі — і пакунок мовчки лишився б зі старою назвою, а сайт назвав би
# третю. Одне джерело правди, і воно те саме, з якого збирає сам tauri.
VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' \
  "${ROOT}/src/frontend/src-tauri/tauri.conf.json" 2>/dev/null || echo "0.0.0")"
[ "${VERSION}" != "0.0.0" ] || die "не прочитав version із tauri.conf.json — далі йшла б збірка з вигаданим номером"

# Ім'я артефакту несе коміт. До цього в `.build/out/` лежали два AppImage з
# однаковими іменами й різних комітів, і сказати, котрий звідки, не міг
# ніхто. Сайт (platform-site) бере вагу й суму з політики сервера — йому
# потрібні саме ім'я з SHA і файл `.sha256` поруч.
APPIMAGE_NAME="PHANTOM OS_${VERSION}_${HEAD_SHA}${DIRTY_SUFFIX}_amd64.AppImage"
BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

say "коміт:  ${HEAD_SHA}${DIRTY_SUFFIX} (дерево $([ -n "$DIRTY" ] && echo брудне || echo чисте))"
say "версія: ${VERSION}"

if ! docker image inspect "${IMAGE}" >/dev/null 2>&1; then
  say "образу ${IMAGE} немає — збираю з scripts/build-env.Dockerfile"
  docker build -f "${ROOT}/scripts/build-env.Dockerfile" -t "${IMAGE}" "${ROOT}"
fi

# Кеші назовні, щоб повторні збірки не починались з нуля. Всередині
# контейнера вони лягають у ті самі місця, де їх шукають cargo й pip.
CACHE="${ROOT}/.build/container-cache"
mkdir -p "${CACHE}/cargo" "${CACHE}/pip" "${CACHE}/npm"

# `node_modules` і `target` — ІМЕНОВАНІ томи docker, а не теки з хоста.
# Спершу тут стояв bind-mount, і `tauri` з нього падав із
# `Bus error (core dumped)` — навіть на `--version`. Причина не в памʼяті
# (перевірено: 214 ГБ диску, 5,8 ГБ вільної RAM, shm піднято до 2 ГБ):
# npm розкладає в node_modules сотні симлінків і робить масові
# перейменування, і через bind-mount дерево виходило неповним — `npm ci`
# рапортував «781 пакет», а `.bin/tauri` не існував. Іменований том живе у
# файловій системі docker і поводиться як звичайна тека.
NODE_VOL="phantom-beta-node-modules"
TARGET_VOL="phantom-beta-cargo-target"
for vol in "${NODE_VOL}" "${TARGET_VOL}"; do
  docker volume inspect "${vol}" >/dev/null 2>&1 || docker volume create "${vol}" >/dev/null
done

say "образ:  ${IMAGE}"
say "етап:   ${STAGE}"
say "дерево: ${ROOT}"

# `--user` навмисно НЕ ставимо: rustup і apt у образі належать root, а
# запуск від чужого uid ламає обидва. Натомість наприкінці повертаємо
# власника артефактів, інакше на хості вони лишаються root-івськими.
# `--shm-size` навмисно: типові 64 МБ у docker замалі для збірки фронту, і
# закінчується це не зрозумілою помилкою, а `Bus error (core dumped)` у
# node — сигналом, за яким причину не вгадаєш. Заміряно 29.08: із 64 МБ
# `tauri build` падав саме так, при 214 ГБ вільного диску й вільній памʼяті.
docker run --rm \
  --shm-size=2g \
  --memory="${PHANTOM_BUILD_MEM:-5g}" --cpus="${PHANTOM_BUILD_CPUS:-6}" \
  -v "${ROOT}:/work" \
  -v "${CACHE}/cargo:/root/.cargo/registry" \
  -v "${CACHE}/pip:/root/.cache/pip" \
  -v "${CACHE}/npm:/root/.npm" \
  -v "${NODE_VOL}:/work/src/frontend/node_modules" \
  -v "${TARGET_VOL}:/work/src/frontend/src-tauri/target" \
  -e STAGE="${STAGE}" \
  -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" \
  -e PHANTOM_BUILD_SHA="${HEAD_SHA}" \
  -e PHANTOM_BUILD_DIRTY="$([ -n "$DIRTY" ] && echo 1 || echo 0)" \
  -e PHANTOM_BUILD_VERSION="${VERSION}" \
  -e PHANTOM_BUILD_AT="${BUILT_AT}" \
  -e APPIMAGE_NAME="${APPIMAGE_NAME}" \
  "${IMAGE}" bash -euo pipefail -c '
    cd /work

    echo "[контейнер] glibc: $(ldd --version | head -1)"
    echo "[контейнер] python: $(python3 -V)"

    # ── sidecar ────────────────────────────────────────────────────────
    # Той самий скрипт, що й на хості: чотири пласти пакування від
    # оточення не залежать. Змінюється лише підлога glibc.
    #
    # `front` пропускає цей етап навмисно й ЯВНО. PyInstaller тут іде
    # близько десяти хвилин і тримає помітну памʼять; коли правка тільки в
    # фронті, переганяти його щоразу — марно. Пропуск саме окремим етапом,
    # а не «розумною» перевіркою свіжості: вгадувати, чи бандл застарів,
    # означало б колись зібрати AppImage зі старим ядром і не помітити.
    if [ "$STAGE" = "front" ]; then
      echo "[контейнер] етап front — sidecar НЕ перезбирається, береться наявний"
      test -f src/frontend/src-tauri/binaries/phantom-backend-x86_64-unknown-linux-gnu \
        || { echo "[контейнер] але його немає — спершу прожени етап sidecar"; exit 1; }
      # onedir без своєї теки — це бінарник, що НЕ ЗАПУСТИТЬСЯ: бутлоадер
      # шукає `_internal` поруч і мовчки вмирає, не знайшовши.
      test -d src/frontend/src-tauri/binaries/_internal \
        || { echo "[контейнер] сайдкар є, а теки _internal немає — це onefile-збірка; прожени етап sidecar заново"; exit 1; }
    else
      # ONEDIR, а не onefile — і це повернення до типового режиму збирача,
      # не обхід. Заміряно 12.09.2026 на артефакті b5463b2a, три прогони
      # поспіль із чищенням `_MEI*`: розпаковка onefile коштує 9,5 с МЕДІАНИ
      # (6,3 / 9,5 / 9,7) і ~1,6 ГБ запису — при КОЖНОМУ старті. Власник
      # назвав такий старт «нереально повільним».
      #
      # Причина, записана 06.09 («на Linux onedir неможливий, бо бандлер
      # Tauri кладе ресурси в usr/lib/<product>/, а сайдкар у usr/bin/»),
      # стосувалась пакування DEB. Цей AppImage бандлер не збирає: нижче ми
      # самі беремо AppDir, самі його латаємо й самі кличемо appimagetool —
      # отже розкладка наша, і `_internal` кладемо поруч із сайдкаром.
      ./scripts/build_sidecar.sh
    fi

    if [ "$STAGE" = "sidecar" ]; then
      chown -R "$HOST_UID:$HOST_GID" .build src/frontend/src-tauri/binaries 2>/dev/null || true
      exit 0
    fi

    # ── фронт + оболонка + AppImage ────────────────────────────────────
    # Абсолютний шлях і друк стану — навмисно. Двічі поспіль `npm ci` тут
    # падав з EUSAGE «немає package-lock.json», хоча файл на місці й
    # читається; діагностувати наосліп по відносному `cd` неможливо.
    cd /work/src/frontend
    echo "[контейнер] cwd=$(pwd) HOME=$HOME lock=$([ -f package-lock.json ] && echo є || echo НЕМА)"
    # `node_modules` і `target` підмонтовані ОКРЕМИМИ томами, тобто хостові
    # сюди не видно взагалі. Це навмисно: у node_modules лежать бінарні
    # модулі, а в target — файли обʼєктного коду, і те й те зібране під glibc
    # хоста. Перевіряти «чи існує тека» тут було б тією самою помилкою,
    # що й «чи існує інтерпретатор» — вона існує, вона просто не та.
    # Питаємо не «чи є файл», а «чи запускається CLI». `-x` тут брехав:
    # `node_modules/.bin/tauri` — це симлінк на `.../cli/tauri.js`, і біт
    # виконання стоїть не завжди, тож перевірка казала «немає» при цілком
    # робочих модулях і щоразу тягла зайвий `npm ci`. Той самий клас, що
    # «файл існує» замість «інтерпретатор запускається» — сьогодні вже
    # четвертий раз.
    if ! ./node_modules/.bin/tauri --version >/dev/null 2>&1; then
      echo "[контейнер] tauri CLI не запускається — ставлю залежності"
      npm install --no-audit --no-fund
    else
      echo "[контейнер] tauri CLI на місці: $(./node_modules/.bin/tauri --version 2>&1 | head -1)"
    fi
    ./node_modules/.bin/tauri build --bundles appimage

    # ── Плагіни GStreamer у пакунок ────────────────────────────────────
    #
    # Чому це окремим кроком ПІСЛЯ tauri: linuxdeploy кладе в пакунок ЯДРО
    # GStreamer (бо на нього лінкується webkit), але не плагіни — їх ніхто
    # на етапі лінкування не питає, вони вантажаться в рантаймі.
    # Наслідок був виміряний на артефакті 30.08: ядро з пакунка (1.20.3,
    # нав’язане через RPATH) прийняло **1 плагін із 396**, бо на машині
    # власника плагіни зібрані під її версію ядра. Тобто звук мовчав скрізь.
    #
    # Ядро без плагінів гірше за жоден GStreamer: застосунок стартує без
    # єдиної скарги й мовчить рівно тоді, коли звук потрібен.
    APPDIR="$(find src-tauri/target -maxdepth 5 -name "*.AppDir" -type d | head -1)"
    if [ -z "$APPDIR" ]; then
      echo "[контейнер] AppDir не знайдено — перепакувати нічим"; exit 1
    fi
    echo "[контейнер] докладаю плагіни GStreamer у: $APPDIR"

    GSTSRC=/usr/lib/x86_64-linux-gnu/gstreamer-1.0
    mkdir -p "$APPDIR/usr/lib/gstreamer-1.0"
    cp -a "$GSTSRC"/*.so "$APPDIR/usr/lib/gstreamer-1.0/"
    mkdir -p "$APPDIR/usr/lib/gstreamer1.0/gstreamer-1.0"
    cp -a /usr/lib/x86_64-linux-gnu/gstreamer1.0/gstreamer-1.0/gst-plugin-scanner \
          "$APPDIR/usr/lib/gstreamer1.0/gstreamer-1.0/"

    # Залежності САМИХ плагінів. `libgstlibav.so` тягне libavcodec, якого в
    # пакунку немає — на етапі лінкування оболонки його ніхто не питав.
    # Плагін без своєї бібліотеки не завантажиться, і це знову буде тиша без
    # скарги. Фільтруємо за БАЗОВИМ ІМЕНЕМ, а не за шляхом: те, що дає ядро
    # (libc, ld-linux, libm, libpthread) класти в пакунок не можна.
    for so in "$APPDIR/usr/lib/gstreamer-1.0"/*.so; do
      ldd "$so" 2>/dev/null | awk "/=> \// {print \$3}"
    done | sort -u \
      | grep -vE "/(ld-linux[^/]*|libc|libm|libpthread|libdl|librt|libgcc_s)\.so" \
      | while read -r dep; do
          base="$(basename "$dep")"
          [ -e "$APPDIR/usr/lib/$base" ] || cp -aL "$dep" "$APPDIR/usr/lib/" 2>/dev/null || true
        done

    # Сайдкар знаходимо ТУТ, бо його треба вже двом: гаку рантайму (щоб
    # виміряти, скільки місця просить розпаковка) і паспорту збірки нижче.
    # Один пошук, одна відповідь — двома `find` вони могли б розійтись.
    SIDECAR="$(find "$APPDIR" -name "phantom-backend*" -type f | head -1)"
    [ -n "$SIDECAR" ] || { echo "[контейнер] сайдкара в AppDir немає — далі нема про що говорити"; exit 1; }

    # ── `_internal` ПОРУЧ ІЗ САЙДКАРОМ ─────────────────────────────────────
    # Tauri копіює в AppDir лише сам файл `externalBin`; теки-супутниці він не
    # знає. Бутлоадер PyInstaller шукає `_internal` рівно поруч із собою і без
    # неї вмирає мовчки — жодного рядка, лише процес, якого нема. Тому кладемо
    # її тут, до appimagetool, і перевіряємо, що вона доїхала.
    # Шлях ВІД КОРЕНЯ дерева, а не відносний: цей блок виконується з
    # `/work/src/frontend` (туди перейшли заради tauri build), і відносний
    # `src/frontend/...` мовчки вказував у нікуди — перевірка казала
    # «збірка onefile» на цілком onedir-сайдкарі, і пакунок їхав без теки.
    INTERNAL_SRC="/work/src/frontend/src-tauri/binaries/_internal"
    if [ -d "$INTERNAL_SRC" ]; then
      rm -rf "$(dirname "$SIDECAR")/_internal"
      cp -a "$INTERNAL_SRC" "$(dirname "$SIDECAR")/_internal"
      test -f "$(dirname "$SIDECAR")/_internal/base_library.zip" \
        || { echo "[контейнер] _internal доїхала без base_library.zip — це не тека PyInstaller"; exit 1; }
      echo "[контейнер] _internal поруч із сайдкаром: $(du -sh "$(dirname "$SIDECAR")/_internal" | cut -f1)"
    else
      echo "[контейнер] _internal немає — збірка onefile, покладаюсь на розпаковку в рантаймі"
    fi

    # ── Скільки місця просить розпаковка onefile ────────────────────────
    #
    # Число НЕ константа. Константа тут була б зеленим, що не вміє
    # почервоніти: бандл важчає щомісяця, а «1700 МіБ» у гаку лишалось би
    # назавжди — і гак спокійно обирав би теку, якої вже не вистачає.
    # Тому питаємо сам бінарник: у CArchive PyInstaller-а є таблиця вмісту,
    # і сума РОЗПАКОВАНИХ розмірів у ній — рівно те, що ляже в TMPDIR.
    NEED_BYTES="$(python3 - "$SIDECAR" <<"PYTOC"
import struct, sys
M = b"MEI\014\013\012\013\016"
f = open(sys.argv[1], "rb")
f.seek(0, 2); n = f.tell()
tail = 4 * 1024 * 1024
f.seek(max(0, n - tail)); b = f.read()
i = b.rfind(M)
if i < 0:
    print(0); sys.exit(0)
o = max(0, n - tail) + i
f.seek(o)
magic, pkg, toff, tlen, pyv, pylib = struct.unpack("!8sIIii64s", f.read(88))
f.seek(o + 88 - pkg + toff); t = f.read(tlen)
pos = 0; total = 0
while pos + 18 <= len(t):
    elen, dpos, dlen, ulen, flag, typ = struct.unpack("!iIIIBc", t[pos:pos + 18])
    if elen <= 18 or pos + elen > len(t):
        break
    total += ulen; pos += elen
print(total)
PYTOC
)"
    # У onedir таблиці вмісту немає взагалі — і це не збій читання, а
    # відсутність розпаковки: гакові нема чого міряти, бо нема чого класти.
    if [ -d "$(dirname "$SIDECAR")/_internal" ]; then
      NEED_BYTES=0
      echo "[контейнер] onedir: розпаковки в рантаймі немає, гак проситиме 0 МіБ"
    else
      [ "${NEED_BYTES:-0}" -gt 0 ] \
        || { echo "[контейнер] не прочитав таблицю вмісту сайдкара — гак лишився б без міри"; exit 1; }
    fi
    # +10%: 17 тисяч файлів округляються вгору по блоках файлової системи
    # (~35 МіБ), решта — запас, щоб не лишити машину рівно в нулі.
    NEED_MIB=$(( NEED_BYTES / 1048576 * 11 / 10 ))
    echo "[контейнер] розпаковка сайдкара: ${NEED_BYTES} Б, гак проситиме ${NEED_MIB} МіБ"

    # Гак рантайму. Живе ФАЙЛОМ у дереві (scripts/apprun-hooks/), а не
    # heredoc-ом тут: цей блок обгорнутий в одинарні лапки docker-виклику, і
    # будь-який апостроф усередині awk чи printf рвав би обгортку. Плюс
    # файл можна перевірити окремо, без десятихвилинної збірки.
    # `target` — іменований том, тобто AppDir переживає збірки, і AppRun у
    # ньому може бути з ПОПЕРЕДНЬОЇ збірки. Гак раніше звався
    # phantom-gstreamer.sh, тож треба прибрати і файл, і рядок, який його
    # кличе — саме в такому порядку думок.
    #
    # Прибрати лише файл було б гірше, ніж не чіпати нічого: AppRun стоїть
    # під `set -e`, і `source` неіснуючого файла вбиває застосунок ще до
    # вікна, мовчки. Перевірено на AppRun із кандидата 1b700934: після
    # видалення самого файла там лишалось «source …/phantom-gstreamer.sh»,
    # тобто пакунок, який не стартує взагалі.
    rm -f "$APPDIR/apprun-hooks/phantom-gstreamer.sh"
    sed -i "\|apprun-hooks/phantom-gstreamer\.sh|d" "$APPDIR/AppRun"
    # Саме `if`, а не `grep && { … }`. Форма з `&&` тут працює лише тому, що
    # стоїть у СЕРЕДИНІ скрипта: `set -e` милує невдале перше слово списку.
    # Опинившись останньою в блоці, вона віддала б код 1 при цілком
    # справному стані — так уже гинула перевірка брудного дерева вище.
    if grep -q "phantom-gstreamer.sh" "$APPDIR/AppRun"; then
      echo "[контейнер] у AppRun лишився виклик старого гака — зупиняюсь"; exit 1
    fi
    cp /work/scripts/apprun-hooks/phantom-runtime.sh \
       "$APPDIR/apprun-hooks/phantom-runtime.sh"
    sed -i "s|@NEED_MIB@|${NEED_MIB}|g" "$APPDIR/apprun-hooks/phantom-runtime.sh"
    # Незамінений маркер означав би `local need_mib=@NEED_MIB@` — тобто гак,
    # що мовчки нічого не порівнює. Питаємо явно.
    if grep -q "@NEED_MIB@" "$APPDIR/apprun-hooks/phantom-runtime.sh"; then
      echo "[контейнер] у гаку лишився незамінений @NEED_MIB@ — зупиняюсь"; exit 1
    fi

    # AppRun від linuxdeploy сорсить гаки ПОІМЕННО. Тобто просто покласти
    # файл поруч — недостатньо, його ніхто не прочитає: та сама «написане,
    # але не викликане», лише в оболонці.
    if ! grep -q "phantom-runtime.sh" "$APPDIR/AppRun"; then
      sed -i "s|^exec .*AppRun.wrapped|source \"\$this_dir\"/apprun-hooks/phantom-runtime.sh\n&|" \
        "$APPDIR/AppRun"
    fi
    grep -q "phantom-runtime.sh" "$APPDIR/AppRun" \
      || { echo "[контейнер] гак не під’єднано до AppRun — зупиняюсь"; exit 1; }

    echo "[контейнер] плагінів у пакунку: $(ls "$APPDIR/usr/lib/gstreamer-1.0"/*.so | wc -l)"

    # ── Паспорт збірки У ДАНИХ ПАКУНКА ─────────────────────────────────
    #
    # Виміряно 03.09: в артефакті не було SHA НІДЕ. `/health` віддавав
    # зашите "version": "0.1.0" при 0.20.0 у tauri.conf.json, а в
    # `.build/out/` лежали два AppImage з однаковими іменами — і з якого
    # коміту котрий, не сказав би ніхто.
    #
    # Кладемо поруч із самим сайдкаром, а не в довільну теку ресурсів:
    # `_phantom_entry._binary_dir()` вже вміє знаходити це місце (так само
    # він шукає `frontend/`), тож бекенд зможе прочитати власний коміт без
    # жодного нового механізму розвʼязування шляхів.
    # `$SIDECAR` знайдено вище, разом із міркою для гака рантайму.
    SIDECAR_SUM="$(sha256sum "$SIDECAR" | cut -d" " -f1)"
    cat > "$(dirname "$SIDECAR")/build_info.json" <<INFO
{
  "component": "appimage",
  "commit": "${PHANTOM_BUILD_SHA}",
  "dirty": $([ "${PHANTOM_BUILD_DIRTY}" = "1" ] && echo true || echo false),
  "version": "${PHANTOM_BUILD_VERSION}",
  "built_at": "${PHANTOM_BUILD_AT}",
  "sidecar_sha256": "${SIDECAR_SUM}",
  "appimage": "${APPIMAGE_NAME}"
}
INFO
    echo "[контейнер] паспорт збірки: $(dirname "$SIDECAR")/build_info.json (сайдкар ${SIDECAR_SUM})"

    # ── Наскрізно: чи намалює САЙДКАР кирилицю СВОЇМ шрифтом ────────────
    #
    # Виміряно 04.09: у пакунку не було жодного шрифтового файла, а reportlab
    # був живий — тобто рушій PDF їхав, і український звіт виходив порожнім
    # рівно в людини, ніколи в нас. Тепер шрифт їде всередині сайдкара
    # (`assets/fonts`), і ця перевірка питає не «чи лежить файл», а «намалюй».
    #
    # Ключове тут — ДРУГА умова. Образ збірки має системний DejaVu, тож сам
    # успіх нічого не доводив би: `_FONT_DIRS` знайшов би системний шрифт і
    # пакунок без свого лишився б зеленим. Тому вимагаємо, щоб `font_dir`
    # вказував УСЕРЕДИНУ розпакованого onefile (${SELFTMP}/_MEI…), а не в
    # /usr/share/fonts. Це та сама різниця, що між «бібліотека є в списку» і
    # «бібліотека є в бандлі».
    #
    # TMPDIR — на /work (диск хоста): onefile розпаковує себе на ~1,5 ГіБ.
    SELFTMP=/work/.build/selftest-tmp
    rm -rf "$SELFTMP"; mkdir -p "$SELFTMP"
    SELFPDF="$SELFTMP/selftest.pdf"
    echo "[контейнер] питаю сайдкар: намалюй звіт кирилицею"
    if ! TMPDIR="$SELFTMP" "$SIDECAR" --selftest-pdf "$SELFPDF" > "$SELFTMP/out.log" 2>&1; then
      echo "[контейнер] сайдкар НЕ намалював кирилицю:"
      cat "$SELFTMP/out.log"
      exit 1
    fi
    cat "$SELFTMP/out.log"
    SELF_DIR="$(grep -m1 "font_dir=" "$SELFTMP/out.log" | sed "s/.*font_dir=//")"
    # Умова та сама — «шрифт НАШ, а не системний», — але вона має ДВІ форми,
    # бо розкладок дві. У onefile бандл розпаковується в TMPDIR, і наш шрифт
    # лежить у `${SELFTMP}/_MEI…`. У onedir розпаковки немає взагалі: шрифт
    # лежить у `_internal/assets/fonts` поруч із сайдкаром, тобто В ПАКУНКУ.
    # Перевірка, написана лише під першу форму, оголосила б другу провалом —
    # що вона й зробила 12.09.2026 на цілком здоровій збірці.
    # АБСОЛЮТНИЙ, і це третій за вечір випадок того самого: `$SIDECAR`
    # знайдений відносним шляхом (`find src-tauri/...`), а сайдкар друкує
    # `font_dir` абсолютним — тож порівняння не збігалось НІКОЛИ, і здорова
    # збірка оголошувалась провалом. Відносний шлях не описує, звідки його
    # читають; там, де його порівнюють із чужим, він мусить стати абсолютним.
    INTERNAL_DIR="$(cd "$(dirname "$SIDECAR")" && pwd)/_internal"
    case "$SELF_DIR" in
      "$SELFTMP"/*)
        echo "[контейнер] шрифт узято З ПАКУНКА (onefile): $SELF_DIR" ;;
      "$INTERNAL_DIR"/*)
        echo "[контейнер] шрифт узято З ПАКУНКА (onedir): $SELF_DIR" ;;
      *)
        echo "[контейнер] шрифт узято НЕ з пакунка, а з: ${SELF_DIR:-(не сказано)}"
        echo "[контейнер] отже на машині без DejaVu звіт був би порожній — зупиняюсь."
        exit 1 ;;
    esac
    SELF_BYTES="$(stat -c %s "$SELFPDF" 2>/dev/null || echo 0)"
    [ "${SELF_BYTES}" -gt 0 ] || { echo "[контейнер] PDF нульового розміру"; exit 1; }
    echo "[контейнер] PDF з українським текстом: ${SELF_BYTES} Б"
    # Доказ лишаємо на диску: розпаковку (1,5 ГіБ) прибираємо, сам PDF — ні.
    # Порожній звіт від непорожнього відрізняє людина, відкривши файл.
    mv -f "$SELFPDF" /work/.build/selftest-cyrillic.pdf
    rm -rf "$SELFTMP"

    # ── Наскрізно: чи спече САЙДКАР пакет СВОЇМ osmium ──────────────────
    #
    # Той самий різновид перевірки, що й шрифт вище, і та сама пастка. Образ
    # збірки має системний python з osmium, тож сам успіх нічого не доводив
    # би: робітник міг би взяти чужу привʼязку й лишити пакунок зеленим.
    # Тому вимагаємо, щоб `osmium_from=` вказував УСЕРЕДИНУ розпакованого
    # onefile (${BAKETMP}/_MEI…), а не в /usr/lib/python3.
    #
    # Питаємо не `import osmium`, а справжній обхід витягу у тимчасовому
    # файлі: імпорт доводить, що модуль знайдено, і нічого не каже про те,
    # чи поїхали з ним вісім .so і вкладені libbz2/liblz4. Різниця між
    # «бібліотека є в списку» і «бібліотека є в бандлі» вже коштувала цьому
    # дому одного порожнього звіту.
    BAKETMP=/work/.build/selftest-bake-tmp
    rm -rf "$BAKETMP"; mkdir -p "$BAKETMP"
    echo "[контейнер] питаю сайдкар: чи спечеш ти взагалі"
    if ! TMPDIR="$BAKETMP" "$SIDECAR" --selftest-bake > "$BAKETMP/out.log" 2>&1; then
      echo "[контейнер] сайдкар НЕ може пекти:"
      cat "$BAKETMP/out.log"
      exit 1
    fi
    cat "$BAKETMP/out.log"
    BAKE_FROM="$(grep -m1 "osmium_from=" "$BAKETMP/out.log" | sed "s/.*osmium_from=//")"
    case "$BAKE_FROM" in
      "$BAKETMP"/*)
        echo "[контейнер] osmium узято З ПАКУНКА: $BAKE_FROM" ;;
      *)
        echo "[контейнер] osmium узято НЕ з пакунка, а з: ${BAKE_FROM:-(не сказано)}"
        echo "[контейнер] отже на машині без системного pyosmium не спеклося б нічого — зупиняюсь."
        exit 1 ;;
    esac
    rm -rf "$BAKETMP"

    # Перепаковуємо. Стару збірку прибираємо, щоб `find` нижче не виніс її.
    rm -f src-tauri/target/release/bundle/appimage/*.AppImage
    ARCH=x86_64 appimagetool "$APPDIR" \
      "src-tauri/target/release/bundle/appimage/${APPIMAGE_NAME}" \
      >/dev/null 2>&1 \
      || { echo "[контейнер] appimagetool не зібрав пакунок"; exit 1; }
    echo "[контейнер] перепаковано"

    # ── Наскрізно: чи відкриє рушій справжній файл ──────────────────────
    #
    # Усе попереднє доводило, що ЯДРО приймає плагіни. Це інше твердження:
    # чи розбере файл сам WebKit — той рушій, у якому живе продукт. Між
    # ними лежить увесь шар медіа-плеєра WebKit, і саме він жорстко вимагав
    # `autoaudiosink`.
    #
    # Питаємо `loadedmetadata` з ненульовою тривалістю, а не `canPlayType`:
    # друге — обіцянка, і вона в цьому домі вже брехала.
    #
    # Зразок навмисно зроблений СУЧАСНИМ кодувальником (1.28) — це випадок
    # власника: новий файл проти нашого ядра 1.20.
    OGG=/work/src/backend/tests/fixtures/audio/tone.ogg
    PROBE=/work/scripts/webkit_can_play.py
    if [ ! -f "$OGG" ] || [ ! -f "$PROBE" ]; then
      # Мовчазний пропуск тут був би зеленим, що не вміє почервоніти:
      # ворота зникли б, а збірка й далі казала б «готово».
      echo "[контейнер] немає зразка ($OGG) або зонда ($PROBE) — перевірку провести НІЧИМ"
      exit 1
    fi
    echo "[контейнер] питаю сам WebKit, чи відкриє файл"
    if GST_PLUGIN_SYSTEM_PATH_1_0="$APPDIR/usr/lib/gstreamer-1.0" \
       GST_PLUGIN_SCANNER="$APPDIR/usr/lib/gstreamer1.0/gstreamer-1.0/gst-plugin-scanner" \
       WEBKIT_DISABLE_COMPOSITING_MODE=1 LIBGL_ALWAYS_SOFTWARE=1 \
       xvfb-run -a python3 "$PROBE" "$OGG"; then
      echo "[контейнер] WebKit відкрив файл — звук доведений наскрізно"
    else
      echo "[контейнер] WebKit НЕ відкрив файл — звук у пакунку НЕ доведений"
      exit 1
    fi

    # `target` — іменований том, тобто з хоста його не видно. Артефакт
    # треба винести назовні явно, інакше збірка «пройшла», а дати нема чого.
    #
    # Виносимо ПОІМЕННО, а не «усе свіже за дві години». `-newermt` вигрібав
    # би й чужі AppImage, що трапились у томі, і мовчки поклав би поруч
    # артефакт з іншої збірки — рівно та плутанина двох пакунків, від якої
    # тут і зʼявилось імʼя з комітом.
    mkdir -p /work/.build/out
    OUT_SRC="src-tauri/target/release/bundle/appimage/${APPIMAGE_NAME}"
    [ -f "$OUT_SRC" ] || { echo "[контейнер] немає ${OUT_SRC} — виносити нічого"; exit 1; }
    cp -f "$OUT_SRC" "/work/.build/out/${APPIMAGE_NAME}"

    # Сума рахується з ВИНЕСЕНОГО файла, а не з того, що в томі: сайт
    # роздаватиме саме цю копію, і саме її має описувати `.sha256`.
    ( cd /work/.build/out && sha256sum "${APPIMAGE_NAME}" > "${APPIMAGE_NAME}.sha256" )
    echo "[контейнер] винесено:"
    ls -la /work/.build/out/ || true
    echo "[контейнер] сума: $(cat "/work/.build/out/${APPIMAGE_NAME}.sha256")"

    cd /work
    chown -R "$HOST_UID:$HOST_GID" .build src/frontend/src-tauri/binaries \
      src/frontend/dist 2>/dev/null || true
  '

# ── У пакунок не їде майстерня ───────────────────────────────────────────
#
# Дзеркало воріт телефона (`phantom-companion/scripts/release.sh`, 04.09).
# Перевіряємо ТУТ, на хості, а не в контейнері: `--appimage-mount` підіймає
# squashfuse, а /dev/fuse у збірковий контейнер не проброшено — ворота там
# просто не змогли б відкрити пакунок і мовчки б його пропустили.
#
# Ворота стоять ПІСЛЯ винесення і суми навмисно: судять рівно той файл, який
# роздаватиме сайт, а не проміжний у томі. Червоне тут означає, що артефакт
# лежить на диску, але віддавати його не можна.
if [ "$STAGE" != "sidecar" ]; then
  ART="${ROOT}/.build/out/${APPIMAGE_NAME}"
  [ -f "$ART" ] || die "етап «${STAGE}» мав дати ${APPIMAGE_NAME}, а його нема — судити нічого"
  say "ворота пакунка: чи не везе AppImage мап джерел і показових вікон"
  "${ROOT}/scripts/package_carries_no_sources.py" --self-test \
    || die "прилад воріт пакунка не пройшов самоперевірку"
  "${ROOT}/scripts/package_carries_no_sources.py" "$ART" \
    || die "пакунок відмовлено: ${APPIMAGE_NAME} не роздавати"
fi

say "готово"
