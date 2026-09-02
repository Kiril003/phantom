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
#   scripts/build_in_container.sh            # sidecar + оболонка + AppImage
#   scripts/build_in_container.sh sidecar    # лише sidecar

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
  -v "${ROOT}:/work" \
  -v "${CACHE}/cargo:/root/.cargo/registry" \
  -v "${CACHE}/pip:/root/.cache/pip" \
  -v "${CACHE}/npm:/root/.npm" \
  -v "${NODE_VOL}:/work/src/frontend/node_modules" \
  -v "${TARGET_VOL}:/work/src/frontend/src-tauri/target" \
  -e STAGE="${STAGE}" \
  -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" \
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
    else
      ./scripts/build_sidecar.sh --onefile
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

    # Гак, що каже ядру, де шукати плагіни. `_1_0` — саме та назва змінної,
    # яку читає GStreamer 1.x; без суфікса вона теж є, ставимо обидві.
    cat > "$APPDIR/apprun-hooks/phantom-gstreamer.sh" <<HOOK
export GST_PLUGIN_SYSTEM_PATH_1_0="\$this_dir/usr/lib/gstreamer-1.0"
export GST_PLUGIN_PATH_1_0="\$this_dir/usr/lib/gstreamer-1.0"
export GST_PLUGIN_SCANNER_1_0="\$this_dir/usr/lib/gstreamer1.0/gstreamer-1.0/gst-plugin-scanner"
export GST_REGISTRY_1_0="\${XDG_CACHE_HOME:-\$HOME/.cache}/phantom-os/gstreamer-registry.bin"
HOOK

    # AppRun від linuxdeploy сорсить РІВНО ОДИН гак, за іменем. Тобто просто
    # покласти файл поруч — недостатньо, його ніхто не прочитає: та сама
    # «написане, але не викликане», лише в оболонці.
    if ! grep -q "phantom-gstreamer.sh" "$APPDIR/AppRun"; then
      sed -i "s|^exec .*AppRun.wrapped|source \"\$this_dir\"/apprun-hooks/phantom-gstreamer.sh\n&|" \
        "$APPDIR/AppRun"
    fi
    grep -q "phantom-gstreamer.sh" "$APPDIR/AppRun" \
      || { echo "[контейнер] гак не під’єднано до AppRun — зупиняюсь"; exit 1; }

    echo "[контейнер] плагінів у пакунку: $(ls "$APPDIR/usr/lib/gstreamer-1.0"/*.so | wc -l)"

    # Перепаковуємо. Стару збірку прибираємо, щоб `find` нижче не виніс її.
    rm -f src-tauri/target/release/bundle/appimage/*.AppImage
    ARCH=x86_64 appimagetool "$APPDIR" \
      "src-tauri/target/release/bundle/appimage/PHANTOM OS_0.20.0_amd64.AppImage" \
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
    mkdir -p /work/.build/out
    find src-tauri/target -name "*.AppImage" -newermt "-2 hours" \
      -exec cp -f {} /work/.build/out/ \;
    echo "[контейнер] винесено:"
    ls -la /work/.build/out/ || true

    cd /work
    chown -R "$HOST_UID:$HOST_GID" .build src/frontend/src-tauri/binaries \
      src/frontend/dist 2>/dev/null || true
  '

say "готово"
