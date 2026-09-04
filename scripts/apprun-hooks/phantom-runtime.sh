# PHANTOM OS — гак рантайму AppImage.
#
# Його сорсить `AppRun` (див. build_in_container.sh) ПЕРЕД тим, як віддати
# керування оболонці, тобто ще до того, як Tauri породить сайдкар. Усе, що
# тут експортовано, сайдкар успадковує: `spawn_backend_sidecar()` у main.rs
# не робить `env_clear()`, він лише додає свої дві змінні.
#
# ЧОМУ ЦЕ ОКРЕМИЙ ФАЙЛ, А НЕ HEREDOC У ЗБІРЦІ. Гак писався всередині
# `docker run … bash -c ''…''`, тобто в рядку, обгорнутому в ОДИНАРНІ лапки.
# Будь-який апостроф у тілі гака рвав ту обгортку — а тут потрібні і awk, і
# printf, тобто апострофи на кожному кроці. Живучи файлом, гак ще й
# перевіряється окремо, без десятихвилинної збірки.
#
# УВАГА, дві пастки цього місця:
#   1. `AppRun` стоїть під `set -e`. Ненульовий код звідси вбиває застосунок
#      ДО вікна й без жодного слова на екрані. Тому все тіло — у функції, а
#      виклик — через `|| true`.
#   2. `$this_dir` приходить із AppRun; тут його не оголошують.

export GST_PLUGIN_SYSTEM_PATH_1_0="$this_dir/usr/lib/gstreamer-1.0"
export GST_PLUGIN_PATH_1_0="$this_dir/usr/lib/gstreamer-1.0"
export GST_PLUGIN_SCANNER_1_0="$this_dir/usr/lib/gstreamer1.0/gstreamer-1.0/gst-plugin-scanner"
export GST_REGISTRY_1_0="${XDG_CACHE_HOME:-$HOME/.cache}/phantom-os/gstreamer-registry.bin"

# ── TMPDIR: розпаковка сайдкара мусить лягти на ДИСК ─────────────────────
#
# Сайдкар зібраний PyInstaller-ом у onefile: на КОЖНОМУ старті бутлоадер
# розпаковує весь бандл у TMPDIR. Потрібний обсяг (@NEED_MIB@ МіБ) вписала
# сюди сама збірка — з таблиці вмісту ЦЬОГО бінарника, а не з константи,
# яку ніхто не оновить, коли бандл поважчає.
#
# На Arch і Fedora `/tmp` — tmpfs ЗА ЗАМОВЧУВАННЯМ, тобто памʼять. Це не
# лабораторний випадок, а звичайна машина звичайної людини.
#
# ЩО САМЕ ЛАМАЄТЬСЯ. Місця менше, ніж треба, — і запис падає з ENOSPC.
# Бутлоадер каже це так:
#
#     [PYI-…:ERROR] Failed to extract entry: cv2/cv2.abi3.so
#
# і людина йде шукати ваду в компʼютерному зорі, якої там немає. Заміряно
# на сайдкарі з кандидата 1b700934 (b7e56201…), tmpfs заданого розміру:
#
#      280 МіБ -> cv2/cv2.abi3.so
#      700 МіБ -> torch/bin/test_aoti_abi_check
#     1200 МіБ -> torch/test/c10_InlineDeviceGuard_test
#     1540 МіБ -> transformers/models/sam2_video/modeling_sam2_video.py
#     1590 МіБ -> проходить
#
# Тобто імʼя у повідомленні НЕ називає винуватця: воно рухається разом із
# розміром теки й називає лише той запис, на якому скінчилось місце. cv2 —
# 139-й із 17823, а найбільший файл бандла зовсім інший
# (torch/lib/libtorch_cpu.so, 414 МіБ, 465-й). Побачити «cv2» означає, що
# місця було 261–323 МіБ, — а не те, що зламаний OpenCV.
#
# ЧОМУ `df` ТУТ БРЕШЕ. У tmpfs немає власного місця: його сторінки — це
# памʼять і своп, а `df` показує стелю МОНТУВАННЯ, не запас. Заміряно:
# tmpfs зі стелею 4096 МіБ усередині cgroup із межею 900 МіБ — `df` бадьоро
# каже «вільно 4096 МіБ», а розпаковка вмирає. Тому нижче рахується не
# `df`, а МЕНШЕ З ДВОХ: стеля монтування і (для tmpfs) сума вільної памʼяті
# та свопу.
#
# Лікуємо в ПАКУНКУ, а не в пораді: людина не мусить знати про це нічого.
_phantom_tmpdir_setup() {
  local need_mib=@NEED_MIB@
  local user_set="${TMPDIR:-}"
  local cand chosen="" chosen_room=0 room user_room=""

  # Скільки МіБ туди СПРАВДІ можна записати. Порожньо — не змогли виміряти.
  _phantom_room_mib() {
    local d="$1" avail fs mem
    avail="$(df -BM --output=avail "$d" 2>/dev/null | awk 'NR==2{gsub(/M/,"",$1); print $1+0}')"
    # Урізаний df без `--output` (busybox): падаємо на позиційний розбір.
    [ -n "${avail:-}" ] || avail="$(df -PBM "$d" 2>/dev/null | awk 'NR==2{gsub(/M/,"",$4); print $4+0}')"
    [ -n "${avail:-}" ] || return 1
    fs="$(df --output=fstype "$d" 2>/dev/null | awk 'NR==2{print $1}')"
    [ -n "${fs:-}" ] || fs="$(df -PT "$d" 2>/dev/null | awk 'NR==2{print $2}')"
    case "${fs:-}" in
      tmpfs | ramfs)
        mem="$(awk '/^MemAvailable:/{a=$2} /^SwapFree:/{s=$2} END{print int((a+s)/1024)}' \
               /proc/meminfo 2>/dev/null)"
        [ -n "${mem:-}" ] && [ "$mem" -lt "$avail" ] && avail="$mem"
        ;;
    esac
    printf '%s' "$avail"
  }

  # «Існує» — не те саме, що «записна»: під sudo, на змонтованій лише для
  # читання домівці або з порожнім HOME (`/.cache`) mkdir тихо не вдається,
  # і TMPDIR лишався б указувати в нікуди. Питаємо файлову систему єдиним
  # надійним способом — пробуємо записати.
  _phantom_writable() {
    local d="$1" p
    mkdir -p "$d" 2>/dev/null || return 1
    p="$d/.phantom-write-probe.$$"
    ( : > "$p" ) 2>/dev/null || return 1
    rm -f "$p" 2>/dev/null || true
    return 0
  }

  # Кеш користувача — лише коли він СПРАВДІ оголошений. Без HOME (юніт
  # systemd, кіоск, контейнер) «${HOME}/.cache» перетворилось би на теку
  # `.cache` посеред /var/tmp: місце робоче, але вигадане нами, і ніхто
  # ніколи не здогадається його прибрати.
  local xdg=""
  [ -n "${XDG_CACHE_HOME:-}" ] && xdg="$XDG_CACHE_HOME/phantom-os/tmp"
  [ -z "$xdg" ] && [ -n "${HOME:-}" ] && xdg="$HOME/.cache/phantom-os/tmp"

  # Порядок навмисний. Явно виставлений людиною TMPDIR — ПЕРШИЙ: її вибір
  # має вагу, і мовчки затирати його ми не будемо.
  #
  # Список — МАСИВ, а не рядок зі списком. `for cand in ${user_set:+"$user_set"}`
  # виглядає квотованим, але лапки всередині `${…:+…}` не рятують: підстановка
  # проходить розбиття на слова, і TMPDIR на кшталт «/home/…/My Files/tmp»
  # розпався б на два шляхи, жодного з яких не існує.
  local -a cands=()
  [ -n "$user_set" ] && cands+=("$user_set")
  [ -n "$xdg" ] && cands+=("$xdg")
  cands+=("/var/tmp/phantom-os-$(id -u 2>/dev/null || echo 0)")
  cands+=("${TMPDIR:-/tmp}")

  for cand in "${cands[@]}"; do
    [ -n "$cand" ] || continue
    if ! _phantom_writable "$cand"; then
      # Незаписне місце, яке назвала людина, — теж її право знати.
      [ "$cand" = "$user_set" ] && user_room="незаписне"
      continue
    fi
    room="$(_phantom_room_mib "$cand" || true)"
    [ -n "${room:-}" ] || room=0
    # Число мусить лишитись привʼязаним до СВОГО шляху: нижче ми називаємо
    # людині запас саме її теки, а не тієї, яку обрали замість неї.
    [ "$cand" = "$user_set" ] && [ -z "$user_room" ] && user_room="${room} МіБ"
    # Перший, кому вистачає, — і зупиняємось.
    if [ "$room" -ge "$need_mib" ]; then chosen="$cand"; chosen_room="$room"; break; fi
    # Не вистачає — але хай буде найкращим із поганих, щоб не лишитись ні з чим.
    if [ "$room" -gt "$chosen_room" ]; then chosen="$cand"; chosen_room="$room"; fi
  done

  [ -n "$chosen" ] || return 0   # нічого записного не знайшли — TMPDIR не чіпаємо

  # Людина назвала своє місце, і ми йдемо з нього — це мусить бути сказано
  # ВГОЛОС. Мовчазна підміна чужого рішення — той самий клас вади, що й
  # мовчазне падіння: наступного разу ніхто не зрозуміє, чому файли не там.
  if [ -n "$user_set" ] && [ "$chosen" != "$user_set" ]; then
    printf '[phantom] TMPDIR=%s: %s, а розпаковка ядра потребує %s МіБ.\n' \
      "$user_set" "${user_room:-місця не виміряв}" "$need_mib" >&2
    printf '[phantom] Беру %s. Щоб лишилось по-твоєму — дай %s місце й права.\n' \
      "$chosen" "$user_set" >&2
  fi

  # Місця немає НІДЕ. Кажемо це тут і зараз, справжніми словами: інакше
  # єдиним слідом лишиться «Failed to extract entry: cv2/cv2.abi3.so», і
  # людина шукатиме ваду в компʼютерному зорі.
  if [ "$chosen_room" -lt "$need_mib" ]; then
    printf '[phantom] УВАГА: у %s вільно %s МіБ, ядру потрібно %s МіБ.\n' \
      "$chosen" "$chosen_room" "$need_mib" >&2
    printf '[phantom] Якщо старт обірветься на «Failed to extract entry» — це МІСЦЕ,\n' >&2
    printf '[phantom] а не вада того файла, на якому воно скінчилось.\n' >&2
  fi

  export TMPDIR="$chosen"

  # ── Прибирання за померлими ────────────────────────────────────────────
  # Бутлоадер прибирає свою розпаковку при штатному виході, але не після
  # SIGKILL (а oom-guard на цій машині стріляє саме так). Тека росла б на
  # @NEED_MIB@ МіБ за кожну таку смерть, і чистити її нікому.
  #
  # Живу розпаковку від покинутої відрізняємо не за віком, а за фактом: у
  # живого onefile файли з тієї теки ВІДОБРАЖЕНІ в памʼять процесу. Вік
  # (`-mmin +5`) лишається другим замком — на вікно між створенням теки й
  # першим mmap, коли другий примірник щойно стартував.
  # Перелік беремо через `find`, а не globom `"$TMPDIR"/_MEI*`. Glob без
  # збігів поводиться по-різному: bash віддає сам шаблон, zsh падає з «no
  # matches found» — а падіння тут, під `set -e`, коштувало б вікна.
  local d
  while IFS= read -r d; do
    [ -n "$d" ] || continue
    if grep -qsF -- "$d/" /proc/[0-9]*/maps 2>/dev/null; then continue; fi
    rm -rf -- "$d" 2>/dev/null || true
  done <<PHANTOM_MEI
$(find "$TMPDIR" -maxdepth 1 -type d -name "_MEI*" -mmin +5 2>/dev/null)
PHANTOM_MEI
  unset -f _phantom_room_mib _phantom_writable
  return 0
}
# `|| true` — не косметика, див. пастку 1 у шапці файла.
_phantom_tmpdir_setup || true
unset -f _phantom_tmpdir_setup
