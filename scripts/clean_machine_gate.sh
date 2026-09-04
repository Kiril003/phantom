#!/usr/bin/env bash
#
# ВОРОТА ЧИСТОЇ МАШИНИ
# ====================
#
# Навіщо. `scripts/build_sidecar.sh` закінчується рядком:
#
#     «перевірка на ЧИСТІЙ МАШИНІ (контейнер без venv, без моделей) —
#      окремий крок; тут вона НЕ виконана»
#
# Цей окремий крок ніколи не був написаний. Водночас коментар у тому ж
# скрипті (біля збирання ctypes-бібліотек) посилається на «ворота чистої
# машини 29.08.2026», які знайшли `OSError: cannot load library
# 'libsndfile.so'`. Тобто найважливіший доказ продукту — «воно працює не
# лише в того, хто його зібрав» — жив як СПОГАД ПРО ВИМІР. Повторити його
# не міг ніхто, і чи він досі правдивий, не знав ніхто.
#
# Цей файл — той вимір, записаний як код.
#
# ЩО САМЕ ДОВОДИТЬСЯ, на кожному образі:
#   1. пакунок розпаковується й СТАРТУЄ там, де немає ні пітона, ні venv,
#      ні наших пакетів — голий образ, жодного `apt install`;
#   2. `/health` віддає 200;
#   3. скільки маршрутів несе вузол — ЧИСЛОМ. Ворота НЕ порівнюють його з
#      зашитим очікуванням: розбіжність — це вимір, а не провал. Порівняння
#      з попереднім числом робить людина;
#   4. ПАСПОРТ: `/health` називає версію й коміт із `build_info.json`
#      всередині пакунка, а не зашитий літерал «0.1.0».
#   5. TLS: вузол у пакунку СЛУХАЄ порт пари, і його сертифікат дає
#      відбиток — той, що поїде в QR. Міряється СЛУХАЧ, не файл.
#
# ЩО ЦІ ВОРОТА НЕ ДОВОДЯТЬ (чесно, щоб ніхто не подумав інакше):
#   * скло. У контейнері немає дисплея, тож `phantom-os-shell` (Tauri) тут
#     не піднімається. Доводиться СІДЕКАР — той бінарник, що обслуговує
#     `/health` і всі маршрути. Вигляд вікна доводиться на склі, не тут.
#   * поведінка на залізі власника: інші ядро, драйвери, звук.
#   * рукостискання TLS. Зонд — голий bash, йому нема чим його зробити, і для
#     твердження «слухач став» воно не потрібне. Що саме віддає сертифікат
#     телефону — доводить телефон, не ці ворота.
#
# ЯК ЗАПУСКАТИ:
#   scripts/clean_machine_gate.sh                       # свіжий артефакт
#   scripts/clean_machine_gate.sh --artifact PATH       # конкретний
#   scripts/clean_machine_gate.sh --images debian:12-slim
#   scripts/clean_machine_gate.sh --timeout 300
#
# ДОВЕДЕННЯ ЧЕРВОНОГО (правило проєкту: зелене нічого не варте, поки не
# доведено, що воно вміє почервоніти):
#   scripts/clean_machine_gate.sh --artifact /немає/такого   # порожня ціль
#   scripts/clean_machine_gate.sh --artifact ОБРІЗАНИЙ.AppImage
#   scripts/clean_machine_gate.sh --artifact СТАРИЙ.AppImage # без паспорта
#   scripts/clean_machine_gate.sh --skip-tls --images debian:12-slim
#     ↑ п'ятий стовп: слухача немає, і це видно ІМЕННО на слухачі.
#
set -uo pipefail

# ─────────────────────────────────────────────────────────────────────────
# Розташування
# ─────────────────────────────────────────────────────────────────────────
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${HERE}/.." && pwd)"

# Робоча тека — НА ДИСКУ, і це не косметика.
#
# Заміряно (див. build_sidecar.sh): onefile розпаковує себе в TMPDIR на
# КОЖНОМУ старті, і розпаковка важить 1 584 090 672 Б (1,48 ГіБ). Плюс сам
# AppImage розкладається ще на ~0,94 ГіБ. `/tmp` на цій машині — tmpfs, себто
# ПАМʼЯТЬ: покласти туди 2,4 ГіБ означає зʼїсти памʼять спільної машини й
# підставити чужу збірку під oom-guard. Тому працюємо в теці на nvme.
WORK_ROOT="${PHANTOM_GATE_WORK:-${HOME}/.cache/phantom-clean-gate}"

LOCK_DIR="/tmp/phantom-verify"
LOCK="${LOCK_DIR}/gate.lock"

# ─────────────────────────────────────────────────────────────────────────
# Умовчання
# ─────────────────────────────────────────────────────────────────────────
IMAGES_DEFAULT="debian:12-slim ubuntu:22.04 fedora:40"
ARTIFACT=""
IMAGES="${IMAGES_DEFAULT}"

# Старт довгий і це ЗАМІРЯНО, а не припущено: 37–47 с до першої відповіді
# `/health` (розпакування onefile + прогрів Chroma, Vosk, MiniLM). Короткий
# фіксований таймаут — задокументована вада цього проєкту: заставка колись
# оголошувала провал на 30-й секунді при цілком справному ядрі. Тому стеля
# щедра, і ворота кажуть «не піднявся» лише після неї.
TIMEOUT=240
PORT=8000
LOCK_WAIT=900
SKIP_TLS=0          # вмикається прапорцем або авто-повтором
MEM_FLOOR_MB=6144
KEEP=0
TLS_FELL_BACK=0

say()  { printf '  %s\n' "$*"; }
head1() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die()  { printf '\n[ВОРОТА] ПОМИЛКА: %s\n' "$*" >&2; exit 2; }

usage() {
  sed -n '2,54p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 0
}

while [ $# -gt 0 ]; do
  case "$1" in
    --artifact)  ARTIFACT="${2-}"; shift 2 ;;
    --images)    IMAGES="${2-}";   shift 2 ;;
    --timeout)   TIMEOUT="${2-}";  shift 2 ;;
    --port)      PORT="${2-}";     shift 2 ;;
    --lock-wait) LOCK_WAIT="${2-}"; shift 2 ;;
    --skip-tls)  SKIP_TLS=1; shift ;;
    --keep)      KEEP=1; shift ;;
    -h|--help)   usage ;;
    *) die "невідомий аргумент: $1" ;;
  esac
done

# ─────────────────────────────────────────────────────────────────────────
# Ціль
# ─────────────────────────────────────────────────────────────────────────
# Порожня / неіснуюча ціль мусить давати ЧЕРВОНЕ З ПРИЧИНОЮ, а не «щось не
# так». Це перший із трьох доказів, що ворота вміють червоніти.
if [ -z "${ARTIFACT}" ]; then
  ARTIFACT="$(ls -1t "${ROOT}"/.build/out/*.AppImage 2>/dev/null | head -1 || true)"
  [ -n "${ARTIFACT}" ] || die "у .build/out немає жодного .AppImage — нема чого перевіряти"
  say "ціль не вказано, беру найсвіжішу: $(basename "${ARTIFACT}")"
fi
[ -e "${ARTIFACT}" ] || die "ціль не існує: '${ARTIFACT}' — перевіряти нічого"
[ -f "${ARTIFACT}" ] || die "ціль не є файлом: '${ARTIFACT}'"
[ -s "${ARTIFACT}" ] || die "ціль порожня (0 байт): '${ARTIFACT}'"
ARTIFACT="$(cd "$(dirname "${ARTIFACT}")" && pwd)/$(basename "${ARTIFACT}")"

# Ціль мусить бути схожа на AppImage ДО того, як ми піднімемо контейнер:
# інакше «не піднялось» через 240 с не відрізнити від «це взагалі не пакунок».
# Тип 2 має сигнатуру `AI\x02` на зсуві 8 всередині ELF-заголовка.
magic="$(head -c 12 "${ARTIFACT}" | od -An -tx1 | tr -d ' \n')"
case "${magic}" in
  7f454c46*414902*) : ;;
  *) die "ціль не є AppImage типу 2 (сигнатура '${magic}'): '${ARTIFACT}'" ;;
esac

ART_SIZE=$(stat -c %s "${ARTIFACT}")
ART_NAME="$(basename "${ARTIFACT}")"

# ─────────────────────────────────────────────────────────────────────────
# Сторожі спільної машини
# ─────────────────────────────────────────────────────────────────────────
# Машина спільна. Кожна з цих перевірок стоїть тут тому, що її відсутність
# уже коштувала комусь збірки.
preflight() {
  local why="$1"

  # Gradle рахуємо ЛИШЕ за comm=java. `pgrep -f GradleWrapperMain` збігається
  # з текстом самої перевірки: сьогодні це тричі дало хибні «живі Gradle» —
  # оболонка, чекач і сам pgrep. Ім'я процесу з /proc/<pid>/comm бреше не може.
  local alive=0 p
  for p in $(pgrep -f GradleWrapperMain 2>/dev/null); do
    [ "$(cat "/proc/$p/comm" 2>/dev/null)" = java ] && alive=$((alive + 1))
  done
  if [ "${alive}" -gt 0 ]; then
    say "СТОП (${why}): живих Gradle (comm=java): ${alive} — чужа збірка в роботі"
    return 1
  fi

  local avail
  avail=$(( $(grep -m1 MemAvailable /proc/meminfo | tr -dc '0-9') / 1024 ))
  if [ "${avail}" -lt "${MEM_FLOOR_MB}" ]; then
    say "СТОП (${why}): вільно ${avail} МБ, потрібно ≥ ${MEM_FLOOR_MB} МБ"
    return 1
  fi

  say "сторожі (${why}): Gradle 0, вільно ${avail} МБ"
  return 0
}

command -v docker >/dev/null || die "немає docker"
docker info >/dev/null 2>&1 || die "docker не відповідає"
mkdir -p "${LOCK_DIR}" || die "не створити ${LOCK_DIR}"
mkdir -p "${WORK_ROOT}" || die "не створити ${WORK_ROOT}"

# ─────────────────────────────────────────────────────────────────────────
# Прибирання за собою
# ─────────────────────────────────────────────────────────────────────────
RUN_ID="$$"
CONTAINERS=()
WORKDIRS=()
CHILDREN=()

# ─── Замок уже тримає предок? ───────────────────────────────────────────
# 03.09 цей скрипт загорнули у `flock -w 7200 <замок> clean_machine_gate.sh`,
# не помітивши, що він бере ТОЙ САМИЙ замок сам, усередині. Зовнішній тримав,
# внутрішній чекав на зовнішній — тобто на себе, і не міг дочекатись ніколи.
# За ним стало чотири чужі черги. Скрипт мовчав: із його боку все виглядало
# як «чекаю на замок, хтось інший будує».
#
# Тому питаємо не «чи вільний замок» (він і не буде вільний — його тримає
# наш же предок), а «чи не тримає його ХТОСЬ ІЗ НАШИХ ПРЕДКІВ». Дивимось на
# відкриті дескриптори, а не на /proc/locks: там записаний pid того, хто
# блокування СТВОРИВ, і він може бути вже мертвим, поки саме блокування живе
# на успадкованому описі файла. Сьогодні ця різниця двічі дала протилежні
# хибні висновки.
_ppid_of() {  # $1 — pid. Друге поле /proc/pid/stat — comm у дужках, і воно
  # може містити пробіли: `awk '{print $4}'` для процесу з comm «(npm run dev
  # --p)» повертає «dev» замість номера. Ріжемо все до останньої «) ».
  sed 's/.*) //' "/proc/$1/stat" 2>/dev/null | awk '{print $2}'
}
_holds_gate() {  # $1 — pid. Чи тримає він ВІДКРИТИМ саме цей файл замка.
  local f t
  for f in /proc/"$1"/fd/*; do
    [ -L "${f}" ] || continue
    t="$(readlink "${f}" 2>/dev/null)" || continue
    [ "${t}" = "${LOCK}" ] && return 0
  done
  return 1
}
_ancestor_holding_gate() {
  local p guard=0
  p="$(_ppid_of $$)"
  while [ -n "${p:-}" ] && [ "${p:-0}" -gt 1 ] && [ "${guard}" -lt 64 ]; do
    if _holds_gate "${p}"; then printf '%s' "${p}"; return 0; fi
    p="$(_ppid_of "${p}")"
    guard=$((guard + 1))
  done
  return 1
}

cleanup() {
  local c d k
  # Спершу ДІТИ. 03.09 скрипт убили, а його `flock … docker run` лишився
  # сиротою (ppid=1) — і тримав дескриптор замка, водночас стоячи в черзі
  # ЗА НИМ САМИМ. Дочекатись він не міг ніколи, а звільнити не міг тим
  # більше. Чергу розблокувала стороння сесія, знявши мій труп руками.
  for k in "${CHILDREN[@]:-}"; do
    [ -n "${k}" ] || continue
    kill -TERM "${k}" 2>/dev/null || true
  done
  sleep 1
  for k in "${CHILDREN[@]:-}"; do
    [ -n "${k}" ] || continue
    kill -KILL "${k}" 2>/dev/null || true
  done
  for c in "${CONTAINERS[@]:-}"; do
    [ -n "${c}" ] || continue
    docker rm -f "${c}" >/dev/null 2>&1 || true
  done
  [ "${KEEP}" = "1" ] && { say "--keep: теки лишено: ${WORKDIRS[*]:-}"; return; }
  for d in "${WORKDIRS[@]:-}"; do
    [ -n "${d}" ] || continue
    # Контейнер працює від root, тож частина файлів у прив'язаній теці —
    # root-овські, і `rm` від користувача їх не візьме. Прибираємо тим самим
    # правом, яким створили.
    if [ -d "${d}" ] && ! rm -rf "${d}" 2>/dev/null; then
      docker run --rm --network none -v "${d}:/doomed" busybox \
        sh -c 'rm -rf /doomed/..?* /doomed/.[!.]* /doomed/*' >/dev/null 2>&1 || true
      rm -rf "${d}" 2>/dev/null || true
    fi
  done
}
trap cleanup EXIT INT TERM

# Виклик тієї перевірки. Написана й не викликана вона була б рівно тим
# дефектом, проти якого весь цей файл: сторож, що існує лише в коді.
if _anc="$(_ancestor_holding_gate)"; then
  printf '\n[ВОРОТА] ВІДМОВА: замок %s уже тримає мій же предок (pid %s):\n' "${LOCK}" "${_anc}" >&2
  ps -o pid=,args= -p "${_anc}" 2>/dev/null | cut -c1-140 >&2 || true
  printf '[ВОРОТА] Я беру цей замок САМ, на кожен образ. Загорнутий у flock,\n' >&2
  printf '[ВОРОТА] я чекав би на власного предка — тобто на себе, і не дочекався б\n' >&2
  printf '[ВОРОТА] ніколи, тримаючи чергу всієї машини. Запусти БЕЗ обгортки:\n' >&2
  printf '[ВОРОТА]   ./scripts/clean_machine_gate.sh --artifact <шлях>\n' >&2
  exit 11
fi

# ─────────────────────────────────────────────────────────────────────────
# Вантаж, що їде в контейнер
# ─────────────────────────────────────────────────────────────────────────
# Правило: у контейнері НІЧОГО НЕ ВСТАНОВЛЮЄМО. Жодного apt/dnf. Інакше це
# вже не «чиста машина», а «машина, яку ми полагодили під себе».
#
# Тому зонд — на голому bash: `/dev/tcp` є вбудованим у bash усіх трьох
# образів, а `cat`/`grep` є в кожному. Ні curl, ні python3, ні jq не
# потрібні — і саме тому вимір не може випадково скористатись пітоном, чию
# відсутність він і покликаний доводити.
write_payload() {
  cat > "$1" <<'PAYLOAD'
#!/usr/bin/env bash
set -u
PORT="${GATE_PORT:-8000}"
TIMEOUT="${GATE_TIMEOUT:-240}"
HOST_UID="${GATE_UID:-0}"
HOST_GID="${GATE_GID:-0}"

kv() { printf 'KV %s=%s\n' "$1" "$2"; }

# ── 0. довести, що машина справді гола ───────────────────────────────────
for t in python python3 pip pip3; do
  command -v "$t" >/dev/null 2>&1 && kv "FOUND_$t" "$(command -v "$t")"
done
kv BARE_PYTHON "$(command -v python3 >/dev/null 2>&1 && echo NO || echo YES)"
kv OS "$( (. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME") || echo unknown)"

# ── 1. розпакувати пакунок ───────────────────────────────────────────────
# У контейнері зазвичай немає FUSE, тож змонтувати AppImage не вийде.
# `--appimage-extract` вбудовано в рантайм типу 2 і FUSE не потребує.
cd /work || { kv FATAL "no /work"; exit 90; }
t0=$SECONDS
if ! /artifact.AppImage --appimage-extract >/work/extract.log 2>&1; then
  kv EXTRACT_OK 0
  kv EXTRACT_TAIL "$(tail -3 /work/extract.log | tr '\n' ' ' | tr -d '"')"
  exit 91
fi
BIN=/work/squashfs-root/usr/bin
if [ ! -x "${BIN}/phantom-backend" ]; then
  kv EXTRACT_OK 0
  kv EXTRACT_TAIL "розпаковано, але phantom-backend відсутній"
  exit 92
fi
kv EXTRACT_OK 1
kv EXTRACT_SECONDS $((SECONDS - t0))
kv EXTRACT_BYTES "$(du -sb /work/squashfs-root 2>/dev/null | cut -f1)"

# ── 2. паспорт, ЯК ЙОГО НЕСЕ ПАКУНОК ─────────────────────────────────────
# Це очікування читаємо з самого пакунка, а не зашиваємо у ворота: інакше
# ворота доводили б збіг із власною константою, а не з тим, що зібрано.
grab() { grep -o "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" "$2" 2>/dev/null \
         | head -1 | sed 's/.*:[[:space:]]*"//; s/"$//'; }
if [ -f "${BIN}/build_info.json" ]; then
  kv PKG_PASSPORT 1
  kv PKG_VERSION "$(grab version "${BIN}/build_info.json")"
  kv PKG_COMMIT  "$(grab commit  "${BIN}/build_info.json")"
else
  kv PKG_PASSPORT 0
fi

# ── 3. підняти сідекар ───────────────────────────────────────────────────
# TMPDIR — на прив'язану теку (диск), бо onefile розпакує туди ~1,5 ГБ на
# КОЖНОМУ старті. Це жива ціна, не разова.
# Тека даних названа ОДИН раз: її ж читає перевірка відбитка нижче
# (`security/tls_identity.cert_path()` = <дані>/tls/node-cert.pem). Двома
# літералами вони розійшлись би при першій же правці — і зонд шукав би
# сертифікат не там, де його поклав вузол, звітуючи «сертифіката немає».
DATA_DIR=/work/data
mkdir -p /work/tmp "${DATA_DIR}" /work/models
cd "${BIN}" || exit 93
env_extra=()
[ "${GATE_SKIP_TLS:-0}" = "1" ] && env_extra+=("PHANTOM_SKIP_TLS=1")
t1=$SECONDS
env TMPDIR=/work/tmp PORT="${PORT}" HOME=/work \
    PHANTOM_DATA_DIR="${DATA_DIR}" PHANTOM_MODELS_DIR=/work/models \
    "${env_extra[@]}" \
    ./phantom-backend >/work/backend.log 2>&1 &
PID=$!

# Зупинка з ПОВІДЦЕМ — вимір, а не косметика. 04.09 цей крок затримав ворота
# на 16 хвилин: після SIGTERM пакунок ЖИВ, писав у лог спроби ШІ ще 13 хвилин
# по сигналу, а `wait` чекав на нього без кінця — тримаючи замок спільної
# машини й чужі черги за собою. Тепер «не вмер від SIGTERM» — це ЧИСЛО у
# звіті, а не зависання: те саме правило, що й для проби з'єднання вище.
stop_node() {
  local w=0
  kill "${PID}" 2>/dev/null
  while kill -0 "${PID}" 2>/dev/null && [ "${w}" -lt 20 ]; do sleep 1; w=$((w + 1)); done
  if kill -0 "${PID}" 2>/dev/null; then
    kv SIGTERM_IGNORED_S "${w}"
    kill -9 "${PID}" 2>/dev/null
  else
    kv EXIT_AFTER_SIGTERM_S "${w}"
  fi
  wait "${PID}" 2>/dev/null
}

# ── 4. чекати на /health, ДОВГО ──────────────────────────────────────────
http_get() { # $1 шлях, $2 файл тіла -> друкує рядок статусу
  local line status
  exec 3<>"/dev/tcp/127.0.0.1/${PORT}" 2>/dev/null || return 1
  printf 'GET %s HTTP/1.0\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n' "$1" >&3
  IFS= read -r status <&3 || { exec 3<&- 3>&-; return 1; }
  while IFS= read -r line <&3; do line="${line%$'\r'}"; [ -z "$line" ] && break; done
  cat <&3 >"$2"
  exec 3<&- 3>&-
  printf '%s' "${status%$'\r'}"
}

STATUS=""; TTFH=""
while [ $((SECONDS - t1)) -lt "${TIMEOUT}" ]; do
  if ! kill -0 "${PID}" 2>/dev/null; then
    kv PROC_DIED_AFTER $((SECONDS - t1)); break
  fi
  if STATUS="$(http_get /health /work/health.json)" && [ -n "${STATUS}" ]; then
    TTFH=$((SECONDS - t1)); break
  fi
  STATUS=""
  sleep 2
done

if [ -z "${STATUS}" ]; then
  kv HEALTH_REACHED 0
  kv WAITED $((SECONDS - t1))
  kv LOG_TAIL "$(tail -12 /work/backend.log | tr '\n' '|' | tr -d '"')"
  stop_node
  chown -R "${HOST_UID}:${HOST_GID}" /work 2>/dev/null
  exit 94
fi
kv HEALTH_REACHED 1
kv TTFH "${TTFH}"
kv HEALTH_STATUS "${STATUS}"

# ── 5. паспорт, ЯК ЙОГО НАЗИВАЄ ЖИВИЙ ВУЗОЛ ──────────────────────────────
kv HEALTH_VERSION "$(grab version /work/health.json)"
kv HEALTH_COMMIT  "$(grab commit  /work/health.json)"
kv HEALTH_SOURCE  "$(grab source  /work/health.json)"
kv HEALTH_HEAD    "$(head -c 400 /work/health.json | tr -d '\n' | tr -d '"' | cut -c1-380)"

# ── 6. маршрути — ЧИСЛОМ ─────────────────────────────────────────────────
# Два незалежні лічильники, щоб число не спиралось на один взірець:
#   PATHS — ключі-шляхи в `paths` (по одному на шлях);
#   OPS   — операції (шлях×метод), рахуємо за operationId.
if OSTATUS="$(http_get /openapi.json /work/openapi.json)" && [ -n "${OSTATUS}" ]; then
  kv OPENAPI_STATUS "${OSTATUS}"
  kv OPENAPI_BYTES "$(stat -c %s /work/openapi.json 2>/dev/null || echo 0)"
  kv ROUTES_PATHS "$(grep -oE '"/[^"]*"[[:space:]]*:[[:space:]]*\{[[:space:]]*"(get|post|put|patch|delete|head|options|trace)"' /work/openapi.json 2>/dev/null | wc -l)"
  kv ROUTES_OPS   "$(grep -o '"operationId"' /work/openapi.json 2>/dev/null | wc -l)"
else
  kv OPENAPI_STATUS "недосяжно"
fi

# ── 6b. TLS: СЛУХАЧ і ВІДБИТОК ───────────────────────────────────────────
# Останній стовп агентських воріт бети: чи вузол У ПАКУНКУ слухає https і чи
# має відбиток, який поїде в QR.
#
# Міряємо СЛУХАЧА, а не файл, і це не педантизм. Продукт уже провів цю межу
# сам: `api/routes_pair.py::_tls_is_live()` дивиться на `listener.bound`, а не
# на наявність сертифіката — бо файл створюється незалежно від того, чи слухач
# піднявся. Був випадок, коли відбиток був справжній, конверт вів на
# `https://…:8443`, а слухача не було: телефон чесно йшов туди, де нікого
# немає, і провал виглядав як мережева проблема. Родина та сама, що «файл
# існує ≠ інтерпретатор запускається».
#
# Порт НЕ зашитий: його називає сам вузол у /health.tls_listening.port, а туди
# він потрапляє з config.pair_tls_port. Якщо вузол його не назве — стовп
# недоведений, і так і буде сказано; підставляти 8443 «бо зазвичай так» —
# означало б доводити збіг із власною константою.
tls_block="$(grep -o '"tls_listening"[[:space:]]*:[[:space:]]*{[^}]*}' /work/health.json 2>/dev/null | head -1)"
TLS_PORT="$(printf '%s' "${tls_block}" | grep -o '"port"[[:space:]]*:[[:space:]]*[0-9]\{1,\}' | grep -o '[0-9]\{1,\}$' | head -1)"
kv TLS_PORT "${TLS_PORT:-}"
# Слова вузла про себе. Вони йдуть у звіт ПОРУЧ із виміром, а не замість
# нього: розбіжність між «enabled» і тим, що приймає з'єднання, — саме те,
# заради чого цей стовп існує.
claim_bound="$(printf '%s' "${tls_block}" | grep -o '"bound"[[:space:]]*:[[:space:]]*\[[^]]*\]' | sed 's/.*\[//; s/\]//' | tr -d '"' | tr ',' ' ')"
kv TLS_CLAIM_BOUND "${claim_bound}"
kv TLS_CLAIM_ENABLED "$(printf '%s' "${tls_block}" | grep -o '"enabled"[[:space:]]*:[[:space:]]*[a-z]\{1,\}' | sed 's/.*:[[:space:]]*//')"

h2ip4() { printf '%d.%d.%d.%d' "0x${1:6:2}" "0x${1:4:2}" "0x${1:2:2}" "0x${1:0:2}"; }

# Повідець на з'єднання — заміряно, а не про всяк випадок. Адреса зі слів
# вузла може бути НЕДОСЯЖНОЮ (03.09 мережа машини змінилась під живим вузлом,
# і `bound` показував стару адресу). Голий `/dev/tcp` на таку адресу висить до
# таймауту ядра: на цій машині проба на мовчазну адресу не повернулась за 2
# хвилини. Вимір, що зависає, — не вимір. `timeout` — з тих самих coreutils,
# що `base64`; якщо його немає, кажемо про це і йдемо без повідця.
HAVE_TIMEOUT=0
command -v timeout >/dev/null 2>&1 && HAVE_TIMEOUT=1
kv TLS_TOOL_TIMEOUT "${HAVE_TIMEOUT}"
tcp_ok() {
  if [ "${HAVE_TIMEOUT}" = "1" ]; then
    # Адреси йдуть АРГУМЕНТАМИ, не підстановкою в текст команди: одна з них
    # приходить із JSON, який склав вузол, і в дорогу до `bash -c` їй нема чого.
    timeout 5 bash -c 'exec 3<>/dev/tcp/$0/$1' "$1" "$2" >/dev/null 2>&1
  else
    (exec 3<>"/dev/tcp/$1/$2") >/dev/null 2>&1
  fi
}

KERNEL=""; KNOCKED=""; CONNECTED=""
if [ -n "${TLS_PORT:-}" ] && [ "${TLS_PORT:-0}" != "0" ]; then
  hexport="$(printf '%04X' "${TLS_PORT}")"
  # ЯДРО, а не слова вузла: у /proc/net/tcp стан 0A — це LISTEN. Ця частина
  # не залежить від жодного нашого інструмента і від жодної обіцянки процесу.
  for pf in /proc/net/tcp /proc/net/tcp6; do
    [ -r "${pf}" ] || continue
    while read -r _sl loc _rem st _rest; do
      [ "${st}" = "0A" ] || continue
      [ "${loc#*:}" = "${hexport}" ] || continue
      hx="${loc%%:*}"
      if [ "${#hx}" -eq 8 ]; then KERNEL="${KERNEL}$(h2ip4 "${hx}") "
      else KERNEL="${KERNEL}v6:${hx} "; fi
    done < "${pf}"
  done
  # Стукаємо туди, куди має сенс: адреси з ядра, адреси зі слів вузла, і
  # loopback. Одне ПРИЙНЯТЕ з'єднання = слухач став. Порожньо скрізь —
  # слухача немає, і це вже не питання тлумачення.
  seen=""
  for a in ${KERNEL} ${claim_bound} 127.0.0.1; do
    case "${a}" in v6:*) continue ;; esac
    # Адреси зі слів вузла — це текст із JSON. У дорогу до `/dev/tcp/` йде
    # лише те, що схоже на IPv4; решта — у звіт як «не адреса», не в шлях.
    case "${a}" in *[!0-9.]*|"") continue ;; esac
    case " ${seen} " in *" ${a} "*) continue ;; esac
    seen="${seen}${a} "
    KNOCKED="${KNOCKED}${a} "
    if tcp_ok "${a}" "${TLS_PORT}"; then CONNECTED="${a}"; break; fi
  done
  # Окремо й навмисно: слухач сідає на LAN-адреси й НЕ на loopback
  # (`tls_listener.lan_addresses()` викидає loopback). Телефон дзвонить на
  # LAN-адресу, тож 0 тут — не вада, а очікуваний вимір.
  if tcp_ok 127.0.0.1 "${TLS_PORT}"; then kv TLS_LOOPBACK 1; else kv TLS_LOOPBACK 0; fi
fi
kv TLS_KERNEL_LISTEN "${KERNEL% }"
kv TLS_KNOCKED "${KNOCKED% }"
kv TLS_CONNECT "${CONNECTED}"

# Відбиток — ТИМ САМИМ способом, що й продукт
# (`security/tls_identity.cert_fingerprint_sha256`): PEM → DER → sha256,
# нижній регістр без роздільників. `base64` і `sha256sum` — з coreutils; якщо
# в образі їх немає, стовп тут НЕДОВЕДЕНИЙ, і так і буде написано. Обхід не
# вигадуємо: вимір, який доставляє собі інструменти, більше нічого не доводить.
CERT="${DATA_DIR}/tls/node-cert.pem"
kv TLS_CERT_PATH "${CERT}"
have_b64=0; have_sha=0
command -v base64    >/dev/null 2>&1 && have_b64=1
command -v sha256sum >/dev/null 2>&1 && have_sha=1
kv TLS_TOOL_BASE64 "${have_b64}"
kv TLS_TOOL_SHA256 "${have_sha}"
if [ -f "${CERT}" ]; then kv TLS_CERT_PRESENT 1; else kv TLS_CERT_PRESENT 0; fi
if [ -f "${CERT}" ] && [ "${have_b64}" = "1" ] && [ "${have_sha}" = "1" ]; then
  sed -n '/BEGIN CERTIFICATE/,/END CERTIFICATE/{/CERTIFICATE/d;p;}; /END CERTIFICATE/q' "${CERT}" \
    | tr -d '\r\n ' | base64 -d >/work/node-cert.der 2>/dev/null
  kv TLS_CERT_DER "$(stat -c %s /work/node-cert.der 2>/dev/null || echo 0)"
  kv TLS_FINGERPRINT "$(sha256sum /work/node-cert.der 2>/dev/null | cut -d' ' -f1)"
fi

# ── 7. прибрати ──────────────────────────────────────────────────────────
stop_node
kv LOG_TAIL "$(tail -4 /work/backend.log | tr '\n' '|' | tr -d '"')"
chown -R "${HOST_UID}:${HOST_GID}" /work 2>/dev/null
exit 0
PAYLOAD
  chmod +x "$1"
}

# ─────────────────────────────────────────────────────────────────────────
# Один образ
# ─────────────────────────────────────────────────────────────────────────
declare -A R          # результати останнього прогону
RES_LINES=()

run_image() {
  local img="$1" skip_tls="$2"
  local tag; tag="$(echo "${img}" | tr ':/' '__')"
  local work="${WORK_ROOT}/${RUN_ID}-${tag}"
  local name="phantom-gate-${RUN_ID}-${tag}"
  local out="${work}/gate.out"

  rm -rf "${work}"; mkdir -p "${work}"
  WORKDIRS+=("${work}")
  CONTAINERS+=("${name}")
  write_payload "${work}/payload.sh"

  # Скидаємо результати ДО будь-якого виходу: інакше відмова сторожів лишила б
  # у R числа попереднього образу, і звіт назвав би чужий вимір своїм.
  unset R; declare -gA R
  R[IMAGE]="${img}"; R[SKIP_TLS]="${skip_tls}"

  if ! preflight "${img}"; then R[RC]=70; return 70; fi

  say "беру замок і піднімаю ${img} (стеля очікування /health — ${TIMEOUT} с)"

  # Замок беремо САМЕ такою формою. `exec 9>lock; flock 9` тут не годиться:
  # той flock завершується одразу, а в /proc/locks лишається запис із МЕРТВИМ
  # pid, після чого сторожі вважають вільний замок чужим. Це вже коштувало
  # одного циклу. `flock -w N <файл> <команда>` тримає замок рівно поки живе
  # команда — і відпускає його, чим би та не скінчилась.
  # У фоні — навмисно, не для паралельності: інакше pid дитини нам невідомий,
  # і `trap cleanup` не має чого знімати. Саме такий безіменний нащадок і
  # осиротів 03.09.
  flock -w "${LOCK_WAIT}" "${LOCK}" \
    docker run --rm --name "${name}" \
      --memory 5g --memory-swap 5g \
      -e GATE_PORT="${PORT}" -e GATE_TIMEOUT="${TIMEOUT}" \
      -e GATE_SKIP_TLS="${skip_tls}" \
      -e GATE_UID="$(id -u)" -e GATE_GID="$(id -g)" \
      -v "${ARTIFACT}:/artifact.AppImage:ro" \
      -v "${work}:/work" \
      "${img}" bash /work/payload.sh >"${out}" 2>&1 &
  local child=$!
  CHILDREN+=("${child}")
  local rc=0
  wait "${child}" || rc=$?

  unset R; declare -gA R
  local k v line
  while IFS= read -r line; do
    case "${line}" in
      KV\ *) k="${line#KV }"; v="${k#*=}"; k="${k%%=*}"; R["${k}"]="${v}" ;;
    esac
  done <"${out}"
  R[RC]="${rc}"
  R[IMAGE]="${img}"
  R[SKIP_TLS]="${skip_tls}"
  return "${rc}"
}

# ─────────────────────────────────────────────────────────────────────────
# Суд над одним прогоном
# ─────────────────────────────────────────────────────────────────────────
# Кожна перевірка називає СВОЮ причину. «Ні» без причини не відрізнити від
# «ні» через зламаний вимір — саме через це попередній доказ і згнив.
verdict() {
  local img="${R[IMAGE]}" fails=()

  head1 "── ${img} ──"
  say "образ: ${R[OS]:-?}   пітона на машині немає: ${R[BARE_PYTHON]:-?}"

  # Смерть від стелі памʼяті контейнера — це вада ВИМІРУ, а не продукту, і
  # називати її «пакунок не працює» означало б брехати про причину.
  if [ "${R[RC]:-0}" = "137" ]; then
    printf '  \033[31mЧЕРВОНЕ\033[0m — %s\n' "ВИМІР ЗІПСОВАНО: контейнер убито за памʼяттю (137), стеля 5g замала"
    RES_LINES+=("ЧЕРВОНЕ ${img}  вимір зіпсовано: OOM контейнера, не вада пакунка")
    return 1
  fi

  # 1. стартує
  if [ "${R[EXTRACT_OK]:-0}" != "1" ]; then
    fails+=("ПАКУНОК НЕ РОЗПАКУВАВСЯ: ${R[EXTRACT_TAIL]:-без подробиць}")
  else
    say "розпаковано за ${R[EXTRACT_SECONDS]:-?} с ($(( ${R[EXTRACT_BYTES]:-0} / 1048576 )) МіБ)"
  fi

  if [ "${R[HEALTH_REACHED]:-0}" != "1" ]; then
    if [ -n "${R[PROC_DIED_AFTER]:-}" ]; then
      fails+=("СІДЕКАР ПОМЕР через ${R[PROC_DIED_AFTER]} с: ${R[LOG_TAIL]:-лог порожній}")
    elif [ "${R[EXTRACT_OK]:-0}" = "1" ]; then
      fails+=("/health МОВЧАВ ${R[WAITED]:-?} с: ${R[LOG_TAIL]:-лог порожній}")
    fi
  else
    say "перша відповідь /health — на ${R[TTFH]} с"
    # 2. /health = 200
    case "${R[HEALTH_STATUS]:-}" in
      *" 200 "*|*" 200") say "статус: ${R[HEALTH_STATUS]}" ;;
      *) fails+=("/health віддав НЕ 200: '${R[HEALTH_STATUS]:-нічого}'") ;;
    esac
    # 3. маршрути — ЧИСЛОМ, без порівняння із зашитим
    if [ -n "${R[ROUTES_PATHS]:-}" ]; then
      say "МАРШРУТІВ: ${R[ROUTES_PATHS]} шляхів, ${R[ROUTES_OPS]} операцій"
      say "  (число, не ворота: порівняння з попереднім робить людина)"
    else
      fails+=("/openapi.json недосяжний — маршрути не полічено (${R[OPENAPI_STATUS]:-?})")
    fi
    # 4. ПАСПОРТ
    if [ "${R[PKG_PASSPORT]:-0}" != "1" ]; then
      fails+=("ПАКУНОК БЕЗ ПАСПОРТА: build_info.json немає поруч із бінарником")
    fi
    local hv="${R[HEALTH_VERSION]:-}" hs="${R[HEALTH_SOURCE]:-}"
    if [ "${hv}" = "0.1.0" ]; then
      fails+=("ПАСПОРТ МЕРТВИЙ: /health каже зашите «0.1.0» — вузол не читає build_info.json")
    elif [ "${hs}" != "bundle" ]; then
      fails+=("ПАСПОРТ НЕ З ПАКУНКА: source='${hs:-немає}' (версія '${hv:-немає}'), а мусив бути 'bundle'")
    elif [ "${R[PKG_PASSPORT]:-0}" = "1" ]; then
      if [ "${hv}" != "${R[PKG_VERSION]:-}" ]; then
        fails+=("ВЕРСІЇ РОЗІЙШЛИСЬ: /health '${hv}' vs пакунок '${R[PKG_VERSION]:-}'")
      elif [ "${R[HEALTH_COMMIT]:-}" != "${R[PKG_COMMIT]:-}" ]; then
        fails+=("КОМІТИ РОЗІЙШЛИСЬ: /health '${R[HEALTH_COMMIT]:-}' vs пакунок '${R[PKG_COMMIT]:-}'")
      else
        say "ПАСПОРТ ЖИВИЙ: версія ${hv}, коміт ${R[HEALTH_COMMIT]}, джерело ${hs}"
        say "  (збігається з build_info.json усередині пакунка)"
      fi
    fi

    # 5. TLS: СЛУХАЧ (не файл) і ВІДБИТОК
    if [ -z "${R[TLS_PORT]:-}" ] || [ "${R[TLS_PORT]:-0}" = "0" ]; then
      fails+=("ПОРТ TLS НЕВІДОМИЙ: /health не назвав tls_listening.port — стовп не доведено (зашивати 8443 не буду)")
    elif [ -n "${R[TLS_CONNECT]:-}" ]; then
      say "СЛУХАЧ TLS Є: ${R[TLS_CONNECT]}:${R[TLS_PORT]} прийняв зʼєднання"
      say "  порт із конфігу вузла (health.tls_listening.port), LISTEN у ядрі: ${R[TLS_KERNEL_LISTEN]:-—}"
      say "  loopback :${R[TLS_PORT]} не слухається (${R[TLS_LOOPBACK]:-?}) — так і має бути, слухач сидить на LAN"
    else
      fails+=("СЛУХАЧА НЕМАЄ: :${R[TLS_PORT]} не прийняв зʼєднання (стукав: ${R[TLS_KNOCKED]:-нікуди}; LISTEN у ядрі: ${R[TLS_KERNEL_LISTEN]:-нічого}; вузол каже enabled=${R[TLS_CLAIM_ENABLED]:-?}, bound=${R[TLS_CLAIM_BOUND]:-порожньо})")
    fi

    # Розбіжність між словом вузла і виміром — окремим рядком, бо вона
    # означає зламаний ВУЗОЛ або зламаний ЗОНД, і мовчати про неї не можна.
    if [ "${R[TLS_CLAIM_ENABLED]:-}" = "true" ] && [ -z "${R[TLS_CONNECT]:-}" ]; then
      fails+=("ВУЗОЛ КАЖЕ НЕПРАВДУ ПРО СЕБЕ: health.tls_listening.enabled=true, а зʼєднання на :${R[TLS_PORT]:-?} не приймається")
    elif [ "${R[TLS_CLAIM_ENABLED]:-}" = "false" ] && [ -n "${R[TLS_CONNECT]:-}" ]; then
      fails+=("ВУЗОЛ КАЖЕ НЕПРАВДУ ПРО СЕБЕ: health.tls_listening.enabled=false, а :${R[TLS_PORT]} приймає зʼєднання на ${R[TLS_CONNECT]}")
    fi

    # Відбиток. Це ДРУГА, окрема перевірка: сертифікат може бути на місці без
    # слухача (саме так і було в тому провалі), а слухач без сертифіката не
    # підніметься взагалі. Тому кожна називає свою причину окремо.
    if [ "${R[TLS_TOOL_BASE64]:-0}" != "1" ] || [ "${R[TLS_TOOL_SHA256]:-0}" != "1" ]; then
      fails+=("ВІДБИТОК НЕ ДОВЕДЕНО на цьому образі — вада ВИМІРУ, не пакунка: base64=${R[TLS_TOOL_BASE64]:-?}, sha256sum=${R[TLS_TOOL_SHA256]:-?}")
    elif [ "${R[TLS_CERT_PRESENT]:-0}" != "1" ]; then
      fails+=("СЕРТИФІКАТА НЕМАЄ: ${R[TLS_CERT_PATH]:-?} — відбитка для QR не існує")
    elif [ "${R[TLS_CERT_DER]:-0}" -lt 100 ] 2>/dev/null; then
      # Порожній DER дав би sha256 порожнечі — 64 бездоганні шістнадцяткові
      # знаки, тобто зелене на нічому. Довжина перевіряється ПЕРЕД формою.
      fails+=("СЕРТИФІКАТ ПОРОЖНІЙ АБО ЗІПСОВАНИЙ: DER ${R[TLS_CERT_DER]:-0} Б — це не сертифікат")
    elif ! printf '%s' "${R[TLS_FINGERPRINT]:-}" | grep -qE '^[0-9a-f]{64}$'; then
      fails+=("ВІДБИТОК НЕ ПОРАХОВАНО: '${R[TLS_FINGERPRINT]:-порожньо}' (DER ${R[TLS_CERT_DER]:-0} Б)")
    else
      say "ВІДБИТОК: ${R[TLS_FINGERPRINT]}"
      say "  (PEM→DER ${R[TLS_CERT_DER]} Б→sha256 — тим самим способом, що cert_fingerprint_sha256)"
    fi
  fi

  # Не стовп, але число, за яке заплачено 16 хвилинами замка спільної машини:
  # чи вмирає пакунок від SIGTERM. Оболонка на склі шле саме його, коли людина
  # закриває вікно.
  if [ -n "${R[SIGTERM_IGNORED_S]:-}" ]; then
    say "SIGTERM: пакунок НЕ завершився за ${R[SIGTERM_IGNORED_S]} с — довелось SIGKILL"
  elif [ -n "${R[EXIT_AFTER_SIGTERM_S]:-}" ]; then
    say "SIGTERM: пакунок завершився за ${R[EXIT_AFTER_SIGTERM_S]} с"
  fi

  [ "${R[SKIP_TLS]}" = "1" ] && say "УВАГА: пройдено з PHANTOM_SKIP_TLS=1, не в умовчальному режимі"

  if [ ${#fails[@]} -eq 0 ]; then
    printf '  \033[32mЗЕЛЕНЕ\033[0m — %s\n' "${img}"
    RES_LINES+=("ЗЕЛЕНЕ  ${img}  маршрутів=${R[ROUTES_PATHS]}/${R[ROUTES_OPS]}  версія=${R[HEALTH_VERSION]}  коміт=${R[HEALTH_COMMIT]}  /health за ${R[TTFH]}с  tls=${R[TLS_CONNECT]}:${R[TLS_PORT]}  відбиток=${R[TLS_FINGERPRINT]:0:12}…$([ "${R[SKIP_TLS]}" = 1 ] && echo '  [SKIP_TLS]')")
    return 0
  fi
  local f
  for f in "${fails[@]}"; do printf '  \033[31mЧЕРВОНЕ\033[0m — %s\n' "${f}"; done
  RES_LINES+=("ЧЕРВОНЕ ${img}  ${fails[0]}")
  return 1
}

# ─────────────────────────────────────────────────────────────────────────
# Хід
# ─────────────────────────────────────────────────────────────────────────
head1 "ВОРОТА ЧИСТОЇ МАШИНИ"
say "ціль:   ${ART_NAME}"
say "розмір: $(( ART_SIZE / 1048576 )) МіБ"
say "sha256: $(sha256sum "${ARTIFACT}" | cut -c1-16)…"
say "образи: ${IMAGES}"
say "робоча тека: ${WORK_ROOT} (на диску, НЕ в tmpfs)"

RED=0
for img in ${IMAGES}; do
  docker image inspect "${img}" >/dev/null 2>&1 || {
    head1 "── ${img} ──"; say "образу немає локально, тягну"; docker pull "${img}" >/dev/null 2>&1 || {
      RES_LINES+=("ЧЕРВОНЕ ${img}  образ недоступний"); RED=1; continue; }
  }

  run_image "${img}" "${SKIP_TLS}"; rc=$?

  # Відомий обхід: конфлікт із TLS-слухачем на порту пари. Пробуємо ЛИШЕ якщо
  # умовчальний режим не піднявся — і тоді це гучно пишеться у звіт, бо
  # «пройдено з обходом» і «пройдено» — різні твердження.
  if [ "${rc}" = "94" ] && [ "${SKIP_TLS}" = "0" ]; then
    # Повтор ДІАГНОСТИЧНИЙ, не рятівний. Він каже, ЧОМУ не піднялось — але
    # зеленого дати не може, і ось чому. Шлях телефон↔ПК один: спарування,
    # а `api/routes_pair.py` не обіцяє https, коли слухач не став. Тобто з
    # PHANTOM_SKIP_TLS=1 конверт чесно віддасть відкритий порт без відбитка
    # — продукт поведеться ПРАВИЛЬНО, а ворота показали б «пройдено».
    # «Пройдено» і «пройдено з вимкненим TLS» — різні твердження, і друге
    # для воріт бети не є проходженням.
    say "умовчальний режим не підняв /health — повторюю з PHANTOM_SKIP_TLS=1 (ЛИШЕ щоб назвати причину)"
    run_image "${img}" 1
    TLS_FELL_BACK=1
    RES_LINES+=("ЧЕРВОНЕ ${img}  умовчальний режим не піднявся; з вимкненим TLS — піднявся")
    say "ВИРОК: не пройдено. Обхід не рахується проходженням для воріт бети."
    RED=1
    continue
  fi

  if [ "${R[RC]:-1}" = "70" ]; then
    RES_LINES+=("ПРОПУЩЕНО ${img}  машина зайнята (Gradle/памʼять)"); RED=1; continue
  fi
  verdict || RED=1
done

head1 "ПІДСУМОК"
for l in "${RES_LINES[@]:-}"; do say "${l}"; done
say ""
if [ "${TLS_FELL_BACK}" = "1" ]; then
  say ""
  say "УВАГА: щонайменше один образ піднявся ЛИШЕ з PHANTOM_SKIP_TLS=1."
  say "Це не проходження: шлях телефон↔ПК — спарування, і конверт не обіцяє"
  say "https, коли слухач не став. З вимкненим TLS конверт чесно віддає"
  say "відкритий порт без відбитка — тобто продукт поводиться правильно, а"
  say "ворота показали б зелене на тому, чого доводити не можна."
fi
say "НЕ ДОВЕДЕНО цими воротами: скло (Tauri-оболонка потребує дисплея),"
say "поведінка на залізі власника, і будь-що поза сідекаром."
say "Про TLS доведено рівно два твердження: слухач на порту пари ПРИЙМАЄ"
say "зʼєднання, і сертифікат вузла дає відбиток. Рукостискання зонд не"
say "робить (голий bash), тож «телефон побачить саме цей відбиток» —"
say "не звідси: це доводить телефон."

exit "${RED}"
