#!/usr/bin/env bash
# PHANTOM Desktop — інсталер для Linux ПК (без ESP32/сенсорів).
# Ідемпотентний: повторний запуск оновлює наявну установку.
#
# Використання:
#   bash scripts/install_desktop.sh              # dev-режим (без license enforcement)
#   bash scripts/install_desktop.sh --enforce     # продуктова установка (з активацією ліцензії)
#
# Змінні середовища:
#   PHANTOM_HOME     — куди встановлювати (default: ~/.local/share/phantom-os)
#   PHANTOM_SRC      — джерело коду (default: цей репозиторій, якщо скрипт лежить у ньому)
#   PHANTOM_REPO_URL — git-репо для клонування, якщо PHANTOM_SRC не репо
#                      (default: https://github.com/phantom-os/phantom-os.git)
set -euo pipefail

# ── Кольоровий друк ───────────────────────────────────────────────────────────
if [ -t 1 ]; then
    C_INFO=$'\033[1;36m'; C_OK=$'\033[1;32m'; C_WARN=$'\033[1;33m'; C_ERR=$'\033[1;31m'; C_RESET=$'\033[0m'
else
    C_INFO=""; C_OK=""; C_WARN=""; C_ERR=""; C_RESET=""
fi
step() { printf '%s==>%s %s\n' "$C_INFO" "$C_RESET" "$1"; }
ok()   { printf '%s✓%s %s\n' "$C_OK" "$C_RESET" "$1"; }
warn() { printf '%s⚠%s %s\n' "$C_WARN" "$C_RESET" "$1"; }
err()  { printf '%s✗%s %s\n' "$C_ERR" "$C_RESET" "$1" >&2; }

# ── Прапорці ───────────────────────────────────────────────────────────────────
ENFORCE_LICENSE=0
for arg in "$@"; do
    case "$arg" in
        --enforce) ENFORCE_LICENSE=1 ;;
        *) err "Невідомий прапорець: $arg"; exit 1 ;;
    esac
done

PHANTOM_HOME="${PHANTOM_HOME:-$HOME/.local/share/phantom-os}"
PHANTOM_REPO_URL="${PHANTOM_REPO_URL:-https://github.com/phantom-os/phantom-os.git}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT_CANDIDATE="$(cd "$SCRIPT_DIR/.." && pwd)"

echo ""
echo "=== PHANTOM Desktop — Інсталер ==="
echo ""

# ── Крок 1: платформа ─────────────────────────────────────────────────────────
step "Перевірка платформи"

detect_pkg_manager() {
    if command -v apt-get &>/dev/null; then echo "apt"
    elif command -v dnf &>/dev/null; then echo "dnf"
    elif command -v pacman &>/dev/null; then echo "pacman"
    else echo "unknown"
    fi
}

install_hint() {
    local pkg_apt="$1" pkg_dnf="$2" pkg_pacman="$3"
    case "$PKG_MGR" in
        apt)     echo "sudo apt-get update && sudo apt-get install -y $pkg_apt" ;;
        dnf)     echo "sudo dnf install -y $pkg_dnf" ;;
        pacman)  echo "sudo pacman -S --needed $pkg_pacman" ;;
        *)       echo "(встанови '$pkg_apt' / '$pkg_dnf' / '$pkg_pacman' вручну — пакетний менеджер не розпізнано)" ;;
    esac
}

PKG_MGR="$(detect_pkg_manager)"

OS_NAME="$(uname -s)"
if [ "$OS_NAME" != "Linux" ]; then
    err "PHANTOM Desktop підтримує лише Linux. Виявлено: $OS_NAME"
    exit 1
fi

ARCH="$(uname -m)"
case "$ARCH" in
    x86_64|aarch64) ok "Архітектура: $ARCH" ;;
    *)
        err "Непідтримувана архітектура: $ARCH (потрібна x86_64 або aarch64)"
        exit 1
        ;;
esac
ok "ОС: Linux"

# ── Крок 2: залежності ────────────────────────────────────────────────────────
step "Перевірка залежностей"

MISSING=0

find_python311() {
    for candidate in python3.11 python3.12 python3.13 python3; do
        if command -v "$candidate" &>/dev/null; then
            local ver
            ver="$("$candidate" -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2>/dev/null || echo "0.0")"
            local major="${ver%%.*}"
            local minor="${ver#*.}"
            if [ "$major" -eq 3 ] && [ "$minor" -ge 11 ]; then
                echo "$candidate"
                return 0
            fi
        fi
    done
    return 1
}

if PYTHON_BIN="$(find_python311)"; then
    ok "Python: $PYTHON_BIN ($("$PYTHON_BIN" --version 2>&1))"
else
    err "Потрібен python3 версії >= 3.11, знайдено: $(command -v python3 &>/dev/null && python3 --version 2>&1 || echo "не знайдено")"
    echo "  Встанови: $(install_hint "python3.11 python3.11-venv" "python3.11" "python")"
    MISSING=1
fi

if command -v node &>/dev/null; then
    NODE_MAJOR="$(node -e 'console.log(process.versions.node.split(".")[0])')"
    if [ "$NODE_MAJOR" -ge 18 ]; then
        ok "Node.js: $(node --version)"
    else
        err "Потрібен Node.js >= 18, знайдено: $(node --version)"
        echo "  Встанови: $(install_hint "nodejs npm" "nodejs npm" "nodejs npm")"
        MISSING=1
    fi
else
    err "Node.js не знайдено"
    echo "  Встанови: $(install_hint "nodejs npm" "nodejs npm" "nodejs npm")"
    MISSING=1
fi

if command -v git &>/dev/null; then
    ok "git: $(git --version)"
else
    err "git не знайдено"
    echo "  Встанови: $(install_hint "git" "git" "git")"
    MISSING=1
fi

if command -v ffmpeg &>/dev/null; then
    ok "ffmpeg: $(ffmpeg -version | head -n1)"
else
    warn "ffmpeg не знайдено — деякі голосові функції (обробка аудіо) можуть не працювати."
    echo "  Встанови: $(install_hint "ffmpeg" "ffmpeg" "ffmpeg")"
fi

if [ "$MISSING" -eq 1 ]; then
    err "Встанови відсутні залежності і запусти скрипт знову."
    exit 1
fi

# ── Крок 3: джерело коду ──────────────────────────────────────────────────────
step "Підготовка джерела коду"

if [ -n "${PHANTOM_SRC:-}" ]; then
    ok "PHANTOM_SRC заданий явно: $PHANTOM_SRC"
elif [ -f "$REPO_ROOT_CANDIDATE/src/backend/main.py" ]; then
    PHANTOM_SRC="$REPO_ROOT_CANDIDATE"
    ok "Скрипт запущено з репозиторію: $PHANTOM_SRC"
else
    PHANTOM_SRC="$PHANTOM_HOME/src-checkout"
    if [ -d "$PHANTOM_SRC/.git" ]; then
        step "Оновлення наявного checkout ($PHANTOM_SRC)"
        git -C "$PHANTOM_SRC" pull --ff-only
    else
        step "Клонування $PHANTOM_REPO_URL → $PHANTOM_SRC"
        mkdir -p "$PHANTOM_HOME"
        git clone "$PHANTOM_REPO_URL" "$PHANTOM_SRC"
    fi
fi

if [ ! -f "$PHANTOM_SRC/src/backend/main.py" ]; then
    err "Не знайдено src/backend/main.py у $PHANTOM_SRC — джерело коду некоректне."
    exit 1
fi

mkdir -p "$PHANTOM_HOME"
ok "PHANTOM_HOME: $PHANTOM_HOME"

# ── Крок 4: backend venv + залежності ────────────────────────────────────────
step "Backend: Python venv + pip install"

VENV_DIR="$PHANTOM_HOME/venv"
if [ ! -d "$VENV_DIR" ]; then
    "$PYTHON_BIN" -m venv "$VENV_DIR"
    ok "Створено venv: $VENV_DIR"
else
    ok "venv вже існує: $VENV_DIR"
fi

# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"
pip install --upgrade pip --quiet
pip install -r "$PHANTOM_SRC/src/backend/requirements.txt" --quiet
deactivate
ok "Python-залежності встановлено"

# ── Крок 5: frontend build ────────────────────────────────────────────────────
step "Frontend: npm ci + build"

(
    cd "$PHANTOM_SRC/src/frontend"
    npm ci
    npm run build
)
ok "Frontend зібрано"

# ── Крок 6: конфіг ────────────────────────────────────────────────────────────
step "Конфігурація"

ENV_FILE="$PHANTOM_HOME/.env"
if [ ! -f "$ENV_FILE" ]; then
    {
        echo "# PHANTOM Desktop — конфіг згенеровано інсталером $(date -Iseconds)"
        echo "PHANTOM_SERIAL_ENABLED=false"
        echo "PHANTOM_FRONTEND_DIST=$PHANTOM_SRC/src/frontend/dist"
        if [ "$ENFORCE_LICENSE" -eq 1 ]; then
            echo "PHANTOM_LICENSE_ENFORCE=1"
        fi
    } > "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    ok "Створено $ENV_FILE"
else
    ok "Конфіг вже існує, не перезаписую: $ENV_FILE"
    if [ "$ENFORCE_LICENSE" -eq 1 ] && ! grep -q '^PHANTOM_LICENSE_ENFORCE=' "$ENV_FILE"; then
        echo "PHANTOM_LICENSE_ENFORCE=1" >> "$ENV_FILE"
        ok "Додано PHANTOM_LICENSE_ENFORCE=1 у наявний конфіг"
    fi
    if ! grep -q '^PHANTOM_FRONTEND_DIST=' "$ENV_FILE"; then
        echo "PHANTOM_FRONTEND_DIST=$PHANTOM_SRC/src/frontend/dist" >> "$ENV_FILE"
        ok "Додано PHANTOM_FRONTEND_DIST у наявний конфіг"
    fi
fi

# ── Крок 7: systemd user unit ─────────────────────────────────────────────────
step "systemd (user) — служба phantom"

SYSTEMD_USER_DIR="$HOME/.config/systemd/user"
UNIT_FILE="$SYSTEMD_USER_DIR/phantom.service"
mkdir -p "$SYSTEMD_USER_DIR"

cat > "$UNIT_FILE" <<EOF
[Unit]
Description=PHANTOM OS Desktop backend
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$PHANTOM_SRC/src/backend
EnvironmentFile=$ENV_FILE
ExecStart=$VENV_DIR/bin/uvicorn main:app --host 0.0.0.0 --port 8000
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
EOF
ok "Записано $UNIT_FILE"

SYSTEMD_OK=1
if command -v systemctl &>/dev/null && systemctl --user show-environment &>/dev/null; then
    systemctl --user daemon-reload
    systemctl --user enable --now phantom
    ok "Службу phantom увімкнено та запущено (systemctl --user)"
    if command -v loginctl &>/dev/null; then
        loginctl enable-linger "$USER" 2>/dev/null || warn "Не вдалося увімкнути linger — служба зупиниться після виходу з сесії. Запусти вручну: loginctl enable-linger $USER"
    fi
else
    SYSTEMD_OK=0
    warn "systemd user session недоступна в цьому середовищі."
    echo "  Запусти вручну:"
    echo "    source $VENV_DIR/bin/activate"
    echo "    cd $PHANTOM_SRC/src/backend"
    echo "    set -a; source $ENV_FILE; set +a"
    echo "    uvicorn main:app --host 0.0.0.0 --port 8000"
fi

# ── Фінал ──────────────────────────────────────────────────────────────────────
echo ""
echo "=== Встановлення завершено ==="
echo ""
echo "  UI:        http://localhost:8000"
if [ "$ENFORCE_LICENSE" -eq 1 ]; then
    echo "  Ліцензія:  активуй ключ у Налаштування → Ліцензія (обов'язково для роботи)"
else
    echo "  Ліцензія:  enforcement вимкнено (dev-режим); для продукту запускай з --enforce"
fi
if [ "$SYSTEMD_OK" -eq 1 ]; then
    echo "  Логи:      journalctl --user -u phantom -f"
    echo "  Статус:    systemctl --user status phantom"
else
    echo "  Логи:      виводяться у консоль (ручний запуск, systemd недоступний)"
fi
echo ""
