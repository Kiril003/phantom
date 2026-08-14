# PHANTOM OS — Інженерний Контекст

## Що це
Живий AI-асистент. Не дашборд, не чат-бот — автономна система з характером,
що спостерігає, адаптується, передбачає і діє. Працює на будь-якому десктопі з
мінімально-необхідними характеристиками (пакується через Tauri: AppImage/deb/msi/nsis).
Мінімальний екран: 1024×600 — це підлога, не полотно. Radxa Dragon Q6A — колишня
перша ціль, тепер лише один із можливих хостів; ESP32-S3 — опційний аксесуар.

## Архітектура (Мозок + Тіла)
- **Мозок**: десктоп-застосунок / Linux x86-64 · ARM64, Windows (Tauri shell + FastAPI sidecar)
  - Frontend: React 18 + Vite 5 + TypeScript (strict) + Tailwind CSS + Framer Motion
  - Backend: Python 3.11 + FastAPI + asyncio + uvicorn
  - DB: SQLite (structured) + ChromaDB (vector memory)
  - AI: Gemini 2.0 Flash API (primary) → Ollama + Gemma 4 27B e4b (local fallback)
  - STT: faster-whisper (primary, GPU) → Vosk (instant streaming fallback, CPU)
  - TTS: StyleTTS2 Ukrainian (patriotyk/styletts2-ukrainian checkpoint)
  - CV: OpenCV (face tracking → servo delta)
- **Тіла** (через symbiote — permission-gated команди, store-and-forward):
  - Телефон-компаньйон — канонічне сенсорне тіло: phone.locate, phone.wifi_scan,
    phone.ring/notify/speak (див. `src/backend/symbiote/commands.py`)
  - ESP32-S3 — ОПЦІЙНИЙ аксесуар / FreeRTOS + PlatformIO (serial_enabled, за замовчуванням може бути відсутній)
    - Sensors → JSON batch 500ms → Serial 921600 baud → ПК
    - Actuators ← event-driven JSON commands ← ПК

## Стек версій
React 18, Vite 5, TypeScript 5.4+ strict, Tailwind 3.4, Framer Motion 11,
Zustand 4, TanStack Query 5, MapLibre GL 4, Recharts 2, D3 7,
Python 3.11, FastAPI 0.111+, Pydantic 2, SQLAlchemy 2 (async), ChromaDB 0.5+,
google-genai >= 1.0, ollama-python, faster-whisper, vosk, pyserial-asyncio

## Головний Архітектурний Принцип
ContextEngine — центральний для ВСІХ рішень. Кожен сенсор → ContextEngine → DecisionTree → Action|Memory.
Стани системи (SHADOW/FOCUS/DIALOGUE/SENTINEL/GHOST/DREAM) — головний UI/поведінковий каркас.

## Правила Кодування (НЕПОРУШНІ)
1. **Ніяких моків, TODO, заглушок, скорочень** — кожен файл повна реалізація
2. **Touch targets: min 44×44px** — тач-екрани підтримуються, точність миші не припускається
3. **UI: 1024×600 — мінімум, не полотно** — на мінімумі без overflow і без скролу на головних
   екранах; на більших екранах інтерфейс ДОБИРАЄ контент (док-панелі, більше рядків), а не
   розтягується і не зумиться. Жодного `transform: scale()`, жодного min-width > 1024
4. **Gemini завжди має fallback на Ollama** — timeout 5s → fallback
5. **faster-whisper завжди має fallback на Vosk** — для стрімінгу
6. **Секретні фічі — нативна поведінка** — без коментарів 'secret', без документації в UI
7. **Всі типи — спільні** — `src/shared/types/` імпортується і фронтом і бекендом
8. **Всі конфіги — з UI** — settings screen для КОЖНОГО параметра
9. **Анімації = інформація** — кожна анімація несе сенс, декоративних нуль
10. **Тести після кожної фази** — pytest backend, vitest frontend

## Структура Проєкту
```
phantom-os/
├── CLAUDE.md                          # ← ЦЕЙ ФАЙЛ
├── docs/                              # Специфікації (читати перед кожною фазою)
│   ├── ARCHITECTURE.md
│   ├── DATA_MODELS.md
│   ├── API_CONTRACTS.md
│   ├── STATE_MACHINE.md
│   ├── AI_INTEGRATION.md
│   ├── VOICE_PIPELINE.md
│   ├── SENSOR_PROTOCOL.md
│   ├── SECRET_FEATURES.md
│   ├── SETTINGS_SYSTEM.md
│   └── phases/
│       ├── PHASE_00_SCAFFOLDING.md
│       ├── PHASE_01_SERIAL_CONTEXT.md
│       └── ... (до PHASE_12)
├── src/
│   ├── shared/                        # Спільні типи frontend ↔ backend
│   │   └── types/
│   ├── frontend/                      # React 18 + Vite
│   │   ├── src/
│   │   │   ├── app/                   # App shell, routing, providers
│   │   │   ├── components/            # UI компоненти
│   │   │   │   ├── core/              # StatusBar, Avatar, StateIndicator
│   │   │   │   ├── chat/              # ChatWindow, MessageBubble, ResponseForms
│   │   │   │   ├── map/               # TacticalMap, Layers, MarkerCards
│   │   │   │   ├── settings/          # SettingsPanel, SettingsGroups
│   │   │   │   ├── auth/              # LoginScreen, PinPad, RFIDScanner
│   │   │   │   ├── terminal/          # TerminalWidget, LiveOutput
│   │   │   │   └── tools/             # Timer, Alarm, Calendar, FileManager
│   │   │   ├── stores/                # Zustand stores
│   │   │   ├── hooks/                 # Custom React hooks
│   │   │   ├── services/              # WebSocket, API clients
│   │   │   ├── layouts/               # State-driven layouts (Shadow, Focus, etc.)
│   │   │   ├── styles/                # Tailwind config, CSS variables, animations
│   │   │   └── utils/
│   │   ├── public/
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   ├── tailwind.config.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   ├── backend/                       # Python FastAPI
│   │   ├── main.py                    # App factory, lifespan, middleware
│   │   ├── config.py                  # Pydantic Settings (all configurable)
│   │   ├── core/
│   │   │   ├── context_engine.py      # СЕРЦЕ — збирає snapshot, оцінює
│   │   │   ├── decision_tree.py       # Priority-based autonomous decisions
│   │   │   ├── state_machine.py       # SystemState FSM з transitions
│   │   │   └── event_bus.py           # Internal pub/sub
│   │   ├── ai/
│   │   │   ├── provider.py            # AIProvider interface + factory
│   │   │   ├── gemini_provider.py     # Gemini 2.0 Flash via google-genai
│   │   │   ├── ollama_provider.py     # Ollama Gemma 4 local
│   │   │   ├── prompt_builder.py      # Dynamic prompt з context + memory + tone
│   │   │   ├── response_formatter.py  # AI вибирає форму відповіді
│   │   │   └── personality.py         # Тон, адаптація по осях (biosignal/trust/time)
│   │   ├── memory/
│   │   │   ├── session_memory.py      # Оперативна (поточна сесія)
│   │   │   ├── tactical_memory.py     # Тактична (24h window)
│   │   │   ├── strategic_memory.py    # ChromaDB вічна пам'ять
│   │   │   ├── archive_memory.py      # Sealed / Dead Zone
│   │   │   └── user_model.py          # behavioral_model per user
│   │   ├── voice/
│   │   │   ├── stt_engine.py          # STT interface + hybrid Whisper/Vosk
│   │   │   ├── tts_engine.py          # StyleTTS2 Ukrainian wrapper
│   │   │   ├── wake_word.py           # Hotword detection
│   │   │   └── voice_pipeline.py      # Full duplex voice loop
│   │   ├── sensors/                   # драйвер ОПЦІЙНОГО аксесуара ESP32
│   │   │   ├── serial_bridge.py       # pyserial-asyncio ESP32 ↔ ПК
│   │   │   ├── sensor_parser.py       # JSON batch → typed SensorSnapshot
│   │   │   └── command_sender.py      # ПК → ESP32 commands
│   │   ├── vision/
│   │   │   ├── face_tracker.py        # OpenCV face detection → servo delta
│   │   │   └── camera_manager.py      # Camera lifecycle, frame pipeline
│   │   ├── security/
│   │   │   ├── auth.py                # RFID + PIN + auto-login
│   │   │   ├── jwt_manager.py         # JWT create/verify/refresh
│   │   │   ├── crypto.py              # AES-256 for GHOST records
│   │   │   └── permissions.py         # ROOT/OPERATOR/GUEST RBAC
│   │   ├── linux/
│   │   │   ├── executor.py            # Sandboxed subprocess + timeout
│   │   │   ├── resource_monitor.py    # RAM/CPU/disk awareness
│   │   │   └── dangerous_patterns.py  # Blocklist + UI confirm
│   │   ├── tools/
│   │   │   ├── timer_service.py
│   │   │   ├── alarm_service.py
│   │   │   ├── calendar_service.py
│   │   │   └── file_manager.py
│   │   ├── wardriving/
│   │   │   ├── collector.py           # WiFi/BLE scan → SQLite
│   │   │   └── heatmap.py             # RSSI → heatmap data
│   │   ├── api/
│   │   │   ├── routes_auth.py
│   │   │   ├── routes_chat.py
│   │   │   ├── routes_context.py
│   │   │   ├── routes_settings.py
│   │   │   ├── routes_map.py
│   │   │   ├── routes_linux.py
│   │   │   ├── routes_tools.py
│   │   │   ├── routes_voice.py
│   │   │   └── websocket_hub.py       # Центральний WS multiplexer
│   │   ├── db/
│   │   │   ├── database.py            # async SQLAlchemy engine
│   │   │   ├── models.py              # SQLAlchemy ORM models
│   │   │   └── migrations/
│   │   ├── tests/
│   │   └── requirements.txt
│   └── firmware/                      # ESP32-S3 PlatformIO (опційний аксесуар)
│       ├── platformio.ini
│       ├── src/
│       │   ├── main.cpp
│       │   ├── sensor_hub.cpp         # FreeRTOS task: read all sensors
│       │   ├── json_protocol.cpp      # Build/parse JSON batches
│       │   ├── actuator_ctrl.cpp      # Servo, buzzer, haptic, RGB, OLED
│       │   └── wifi_scanner.cpp       # Wardriving scan task
│       ├── include/
│       │   ├── config.h
│       │   ├── pins.h
│       │   └── protocol.h
│       └── lib/
├── scripts/
│   ├── setup.sh                       # Full environment setup
│   ├── dev.sh                         # Start dev (frontend + backend)
│   └── deploy.sh                      # Production deploy
├── .claudeignore
├── .gitignore
└── README.md
```

## Поточна Фаза
Перед початком: прочитай docs/ файли що стосуються фази.
Формула: `Прочитай docs/phases/PHASE_XX.md + відповідні docs/*.md → реалізуй → тести`

## Команди Dev
```bash
# Frontend
cd src/frontend && npm run dev          # Vite dev server :5173
cd src/frontend && npm run build        # Production build
cd src/frontend && npx vitest           # Tests

# Backend
cd src/backend && uvicorn main:app --reload --host 0.0.0.0 --port 8000
cd src/backend && pytest               # Tests

# ESP32 (лише якщо аксесуар присутній)
cd src/firmware && pio run             # Build
cd src/firmware && pio run -t upload   # Flash
```


## 🎨 Візуал
Перед будь-якою роботою з UI — прочитай `docs/VISUAL_SYSTEM.md` повністю.
