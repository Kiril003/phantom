# PHANTOM OS — Quick Start Guide для Claude Code

## 🚀 Як Почати

### Крок 1: Встановити Claude Code
```bash
npm install -g @anthropic-ai/claude-code
```

### Крок 2: Підписка
Для проєкту такого масштабу рекомендую **Claude Max 5x** ($100/міс) або **Max 20x** ($200/міс).
Pro ($20/міс) вистачить на 1-2 фази на день при обережній роботі.

### Крок 3: Скопіювати проєкт
```bash
mkdir phantom-os && cd phantom-os
# Скопіюй всі файли з цього архіву сюди
git init
git add -A
git commit -m "init: PHANTOM OS blueprint"
```

### Крок 4: Перший запуск Claude Code
```bash
cd phantom-os
claude
```
Claude Code автоматично прочитає `CLAUDE.md` і буде знати весь контекст.

### Крок 5: Почати Фазу 0
```
Прочитай docs/phases/PHASE_00_SCAFFOLDING.md і реалізуй повністю.
Типи бери з docs/DATA_MODELS.md.
Конфіги фронтенду — Tailwind кольори з docs/STATE_MACHINE.md (кольорова мова).
Після завершення — запусти перевірку: tsc --noEmit для фронтенду.
```

---

## 📋 Робочий Процес (для кожної фази)

### Перед фазою
```
/clear                    # Очистити контекст від попередньої фази
/model sonnet             # Sonnet для імплементації (80% роботи)
```

### Промпт для фази
```
Прочитай docs/phases/PHASE_XX.md та [відповідні docs/*.md файли].
Реалізуй Фазу XX: [назва].
Використовуй типи з src/shared/types/.
Без моків. Без TODO. Повна реалізація.
Після — запусти тести.
```

### Після завершення блоку роботи
```
/compact                  # Стиснути контекст (КРИТИЧНО для економії токенів)
```

### Після завершення фази
```
# Запусти ревʼюера
Запусти @reviewer на весь код цієї фази.
```

### Комміт
```bash
git add -A
git commit -m "feat(phase-XX): назва фази"
```

---

## 🧠 Стратегія Моделей (Економія Токенів)

| Задача | Модель | Команда |
|--------|--------|---------|
| Дослідження коду | Haiku | `@explorer знайди всі файли що імпортують ContextSnapshot` |
| Імплементація | Sonnet | `/model sonnet` (default) |
| Складна архітектура | Opus | `/model opus` — ТІЛЬКИ для складних рішень |
| Code review | Sonnet | `@reviewer перевір src/backend/core/` |
| Рефакторинг | Sonnet | `/model sonnet` |

**Правило: 80% Sonnet, 15% Haiku (subagents), 5% Opus (архітектура).**

---

## 🔧 VS Code Розширення

### Обов'язкові
- **Claude Code** (або Claude Code for VS Code) — нативна інтеграція
- **ESLint** — лінтинг TypeScript
- **Prettier** — форматування
- **Tailwind CSS IntelliSense** — autocomplete для Tailwind
- **Python** (Microsoft) — Python support
- **Pylance** — Python type checking

### Рекомендовані
- **PlatformIO IDE** — для ESP32 прошивки
- **Thunder Client** — тестування API
- **SQLite Viewer** — перегляд SQLite баз
- **Error Lens** — помилки inline
- **GitLens** — git blame/history

---

## ⚡ Прийоми Економії Токенів

### 1. `.claudeignore` (вже створено)
Виключає node_modules, build, __pycache__ з контексту.

### 2. Subagents замість прямого пошуку
```
# Погано (забруднює контекст):
Знайди всі файли де використовується WebSocket

# Добре (subagent з ізольованим контекстом):
@explorer знайди всі файли де використовується WebSocket
```

### 3. `/compact` після кожного milestone
```
# Закінчив компонент → /compact
# Закінчив модуль → /compact  
# Закінчив фазу → /clear + новий промпт
```

### 4. Worktrees для паралельної роботи
```bash
# Terminal 1: Frontend
claude --worktree phantom-frontend

# Terminal 2: Backend
claude --worktree phantom-backend
```

### 5. Конкретні промпти > розмиті
```
# Погано (Claude читатиме весь проєкт):
Зроби щоб чат працював

# Добре (Claude читає тільки потрібне):
Прочитай docs/API_CONTRACTS.md секцію Chat і src/shared/types/chat.ts.
Реалізуй src/backend/api/routes_chat.py — POST /chat/message ендпоінт.
Використовуй AIProvider з src/backend/ai/provider.py.
```

### 6. CLAUDE.md — лаконічний
CLAUDE.md читається КОЖЕН запит. Він має бути < 200 рядків.
Деталі — в docs/*.md (читаються тільки коли попросиш).

---

## 🔄 Порядок Фаз

```
Фаза 0  → Scaffolding (структура, типи, конфіги)
Фаза 1  → Serial Bridge + ContextEngine (серце)
Фаза 2  → Авторизація (RFID + PIN + JWT)
Фаза 3  → AI Core + Пам'ять (Gemini/Gemma + ChromaDB)
Фаза 4  → UI + Стани (6 layouts + status bar)
Фаза 5  → Чат + Форми (всі типи відповідей)
Фаза 6  → Тактична Карта (MapLibre + wardriving)
Фаза 7  → Voice Pipeline (Whisper+Vosk → StyleTTS2)
Фаза 8  → Face Tracking + OLED sync
Фаза 9  → Linux Control (AI як оператор ОС)
Фаза 10 → Секретні Фічі (всі 10, нативно)
Фаза 11 → Інструменти + Settings UI
Фаза 12 → Безпека + Стабільність
```

**Фази 4-6 можна частково паралелити через worktrees.**
**Фаза 10 ОБОВ'ЯЗКОВО після 0-9 (залежить від усього).**

---

## 🛠 Встановлення Залежностей на Radxa

```bash
# Node.js 20+
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs

# Python 3.11
sudo apt install -y python3.11 python3.11-venv python3-pip

# Ollama
curl -fsSL https://ollama.com/install.sh | sh
ollama pull gemma4:e4b

# faster-whisper залежності
pip install faster-whisper

# Vosk
pip install vosk
# Завантажити модель:
wget https://alphacephei.com/vosk/models/vosk-model-uk-v3-lgraph.zip
unzip vosk-model-uk-v3-lgraph.zip -d /opt/vosk-models/

# StyleTTS2 Ukrainian
# Клонувати patriotyk/styletts2-ukrainian з HuggingFace
# Або використовувати Docker: ALERTua/styletts2-ukrainian-openai-tts-api

# OpenCV
pip install opencv-python-headless

# ChromaDB
pip install chromadb sentence-transformers

# PlatformIO (для ESP32)
pip install platformio
```

---

## ⚠ Часті Помилки

1. **НЕ вставляй все ТЗ в один промпт** — контекст з'їсться миттєво
2. **НЕ забувай /compact** — без нього 3-4 запити = повний контекст
3. **НЕ використовуй Opus для рутини** — це 5x дорожче за Sonnet
4. **НЕ ігноруй subagents** — вони зберігають контекст головної сесії чистим
5. **НЕ починай без git init** — checkpoints Claude Code працюють через git
