# PHANTOM Desktop — встановлення на Linux ПК

## Вимоги

- Linux x86_64 або aarch64
- Python 3.11+
- Node.js 18+
- git
- ffmpeg (рекомендовано для голосових функцій)

## Встановлення

```bash
bash scripts/install_desktop.sh
```

Для продуктової установки з активацією ліцензії:

```bash
bash scripts/install_desktop.sh --enforce
```

## Що робить скрипт

1. Перевіряє платформу та залежності; якщо чогось нема — друкує точну команду
   встановлення (apt/dnf/pacman) і виходить.
2. Бере джерело коду: сам репозиторій, якщо скрипт запущено з нього, інакше
   клонує `PHANTOM_REPO_URL` у `$PHANTOM_HOME`.
3. Ставить Python venv у `$PHANTOM_HOME/venv` + `pip install -r requirements.txt`.
4. Збирає фронтенд (`npm ci && npm run build`).
5. Створює `$PHANTOM_HOME/.env` (`PHANTOM_SERIAL_ENABLED=false`, за потреби
   `PHANTOM_LICENSE_ENFORCE=1`), якщо його ще нема.
6. Реєструє `~/.config/systemd/user/phantom.service` і вмикає його
   (`systemctl --user enable --now phantom` + `loginctl enable-linger`).

Змінні середовища: `PHANTOM_HOME` (default `~/.local/share/phantom-os`),
`PHANTOM_SRC`, `PHANTOM_REPO_URL`.

## Оновлення

Запусти скрипт ще раз — він ідемпотентний: оновлює venv/фронтенд/unit-файл,
не чіпає наявний `.env`.

## Видалення

```bash
systemctl --user disable --now phantom
rm -f ~/.config/systemd/user/phantom.service
rm -rf "$PHANTOM_HOME"   # default: ~/.local/share/phantom-os
```

## Після встановлення

- UI: http://localhost:8000
- Активація ліцензії: Налаштування → Ліцензія
- Логи: `journalctl --user -u phantom -f`
