# PHANTOM OS — оточення збірки з НАВМИСНО старою glibc.
#
# Навіщо. 29.08.2026 ворота чистої машини показали, що AppImage, зібраний
# на цьому ноутбуці, не запускається практично ніде:
#
#   glibc машини збірки        2.44
#   phantom-os-shell вимагає   GLIBC_2.39
#   бібліотеки в бандлі        до GLIBC_2.43
#   debian:12-slim  (2.36)     падає
#   debian:trixie   (2.41)     теж падає
#
# Це не дефект коду, а закон динамічного лінкування: зібране під новішою
# glibc не працює на старішій. Отже збирати треба під найстарішою, яку ми
# збираємося підтримувати, а не під найновішою, яка випадково стоїть у
# розробника.
#
# Ubuntu 22.04 = glibc 2.35. Перевірено, що потрібний webkit тут є:
#   libwebkit2gtk-4.1-dev  2.50.4-0ubuntu0.22.04.1
# (Tauri v2 вимагає саме 4.1; на 22.04 він приїхав бекпортом, тож
# «22.04 не підходить під Tauri 2» — поширена, але хибна думка.)
#
# Python тут 3.10 — і це в межах, які приймає `build_sidecar.sh`
# (3.10-3.12). Верхня межа стоїть не з примхи: під 3.14 колеса ще не
# збирають, і pip іде компілювати pydantic-core, shapely та av з джерел.
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8

# Python 3.11 із deadsnakes. Штатний у 22.04 — 3.10, і його НЕ досить:
# перша збірка в контейнері вийшла зеленою і впала на старті з
#   ImportError: cannot import name 'StrEnum' from 'enum'
# `enum.StrEnum` з'явився у 3.11, і саме 3.11 оголошено в CLAUDE.md.
# Це той випадок, коли «зібралось» і «працює» розходяться на один клас.
RUN apt-get update && apt-get install -y --no-install-recommends \
      software-properties-common gpg-agent \
 && add-apt-repository -y ppa:deadsnakes/ppa \
 && rm -rf /var/lib/apt/lists/*

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential curl file git pkg-config ca-certificates \
      python3.11 python3.11-venv python3.11-dev \
      libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev \
      libayatana-appindicator3-dev libssl-dev patchelf desktop-file-utils \
      libsndfile1 \
      fuse libfuse2 zsync \
 && rm -rf /var/lib/apt/lists/*

# ── Плагіни GStreamer: без них у пакунку НЕМАЄ ЗВУКУ ──────────────────────
#
# Виміряно 30.08 на артефакті. `libwebkit2gtk-4.1-dev` затягує ЯДРО GStreamer
# і базові плагіни, і linuxdeploy кладе ядро в пакунок. Але:
#   * пакунок нав'язує СВОЄ ядро (1.20.3) через RPATH — це видно в `ldd`;
#   * плагіни ж бралися з машини власника, де вони зібрані під ЇЇ версію;
#   * а плагіни прив'язані до версії ядра.
# Зонд через `dlopen` показав: ядро з пакунка прийняло **1 плагін із 396**,
# системне ядро на тій самій машині — 391. Тобто звук мовчав би скрізь,
# окрім машини з рівно 1.20.
#
# Три пакети нижче — не «повний набір про всяк випадок», а точний перелік
# того, чого бракувало:
#   pulseaudio/alsa — самі ВИХОДИ. `autodetect` (тобто `autoaudiosink`) у
#     базовому наборі вже був, але він лише ОБИРАЄ вихід; обирати не було з
#     чого. Та сама фігура на щабель нижче: селектор є, предмета вибору немає.
#   libav — звичайні кодеки (AAC/H.264/MP3), без яких веб-медіа не грає.
RUN apt-get update && apt-get install -y --no-install-recommends \
      gstreamer1.0-pulseaudio gstreamer1.0-alsa gstreamer1.0-libav \
 && rm -rf /var/lib/apt/lists/*

# ── Наскрізна перевірка звуку САМИМ рушієм ────────────────────────────────
#
# `scripts/webkit_can_play.py` (Чат 1) підіймає окреме вікно WebKit2 4.1 і
# питає в нього `loadedmetadata` з ненульовою тривалістю — тобто не обіцянку
# (`canPlayType` уже раз збрехала), а факт, що рушій розібрав контейнер.
#
# Чому в контейнері, а не на хості: тут ядро GStreamer, плагіни, WebKit і
# python-gi — усі з ОДНОГО набору 22.04. На хості вони різних версій, і
# тоді мале число говорить про стенд, а не про пакунок. Чат 1 сам на це
# наступив: пакунковий glib підмінився інтерпретаторові, і зонд помер на
# `import gi`, ще не дійшовши до предмета виміру.
#
# `xvfb` — бо WebKit вимагає дисплей і контекст GL; `OffscreenWindow` не
# годиться, перевірено.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3-gi gir1.2-webkit2-4.1 gir1.2-gtk-3.0 xvfb \
 && rm -rf /var/lib/apt/lists/*

# Node — для vite і tauri-cli. Ставимо з nodesource, бо в 22.04 лежить 12.
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

# Rust — стабільний, без інтерактиву.
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
      | sh -s -- -y --default-toolchain stable --profile minimal
ENV PATH="/root/.cargo/bin:${PATH}"

# linuxdeploy у контейнері не має FUSE — хай розпаковує себе сам.
# Без цього збірка AppImage падає з «failed to run linuxdeploy», і причину
# Tauri ковтає.
# Явно кажемо збірці, яким інтерпретатором користуватись: у образі поруч
# живуть 3.10 (штатний) і 3.11 (deadsnakes), і `python3` показує на 3.10.
# Покладатись на PATH тут — це та сама помилка, через яку перша збірка на
# хості пішла на 3.14.
ENV PHANTOM_BUNDLE_PYTHON=/usr/bin/python3.11

# appimagetool — щоб перепакувати AppDir після того, як ми доклали в нього
# плагіни GStreamer. Tauri тягне свій інструмент у `~/.cache` при кожній
# збірці й не лишає його, тож власний примірник у образі — єдиний спосіб
# мати перепакування детермінованим.
RUN curl -fsSL -o /usr/local/bin/appimagetool \
      https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage \
 && chmod +x /usr/local/bin/appimagetool

ENV APPIMAGE_EXTRACT_AND_RUN=1
# Той самий NO_STRIP, що й на хості: strip усередині linuxdeploy старий і
# не знає секції `.relr.dyn` у сучасних бібліотеках.
ENV NO_STRIP=1

WORKDIR /work
