# Фаза 1 — Serial Bridge + ContextEngine

## Мета
Основа всього. ESP32 JSON → ContextEngine → стани системи.

## Файли
- `src/backend/sensors/serial_bridge.py` — pyserial-asyncio reader/writer
- `src/backend/sensors/sensor_parser.py` — JSON → typed SensorBatch
- `src/backend/sensors/command_sender.py` — typed commands → JSON → Serial TX
- `src/backend/core/context_engine.py` — SensorBatch → ContextSnapshot
- `src/backend/core/state_machine.py` — FSM з transitions table
- `src/backend/core/decision_tree.py` — priority evaluation
- `src/backend/core/event_bus.py` — asyncio pub/sub
- `src/backend/api/websocket_hub.py` — WS multiplexer (повна реалізація)
- `src/backend/api/routes_context.py` — GET /context/current, /history, /state
- `src/firmware/src/sensor_hub.cpp` — FreeRTOS read task
- `src/firmware/src/json_protocol.cpp` — JSON batch builder
- `src/firmware/src/actuator_ctrl.cpp` — command executor

## Прочитай перед початком
- `docs/SENSOR_PROTOCOL.md`
- `docs/STATE_MACHINE.md`
- `docs/DATA_MODELS.md` (SensorBatch, ContextSnapshot, SystemState)
- `docs/API_CONTRACTS.md` (WebSocket channels, Context endpoints)

## Критерії
- [ ] Serial bridge підключається до ESP32 (або mock serial для тестів)
- [ ] ContextEngine збирає snapshot кожні 500ms
- [ ] StateMachine коректно переходить між станами
- [ ] WebSocket пушить snapshot на клієнт
- [ ] pytest: 10+ тестів на context_engine і state_machine

## Залежності: Фаза 0

---

# Фаза 2 — Авторизація

## Файли
- `src/backend/security/auth.py` — RFID + PIN + auto-login logic
- `src/backend/security/jwt_manager.py` — JWT create/verify/refresh
- `src/backend/security/permissions.py` — RBAC decorator
- `src/backend/api/routes_auth.py`
- `src/frontend/src/components/auth/LoginScreen.tsx`
- `src/frontend/src/components/auth/PinPad.tsx`
- `src/frontend/src/components/auth/RFIDScanner.tsx`
- `src/frontend/src/stores/authStore.ts`

## Прочитай: DATA_MODELS.md (User), API_CONTRACTS.md (Auth), ARCHITECTURE.md (Security)
## Залежності: Фаза 0, 1 (serial bridge для RFID)

---

# Фаза 3 — AI Core + Пам'ять

## Файли
- `src/backend/ai/provider.py` — AIProvider interface
- `src/backend/ai/gemini_provider.py` — Gemini 2.0 Flash
- `src/backend/ai/ollama_provider.py` — Ollama Gemma 4
- `src/backend/ai/prompt_builder.py` — dynamic prompt
- `src/backend/ai/response_formatter.py` — форми відповідей
- `src/backend/ai/personality.py` — tone calculation
- `src/backend/memory/session_memory.py`
- `src/backend/memory/tactical_memory.py`
- `src/backend/memory/strategic_memory.py` — ChromaDB
- `src/backend/memory/archive_memory.py`
- `src/backend/memory/user_model.py` — behavioral model

## Прочитай: AI_INTEGRATION.md, DATA_MODELS.md (Memory, BehavioralModel)
## Залежності: Фаза 0, 1, 2

---

# Фаза 4 — UI + Стани

## Файли
- `src/frontend/src/layouts/ShadowLayout.tsx`
- `src/frontend/src/layouts/FocusLayout.tsx`
- `src/frontend/src/layouts/DialogueLayout.tsx`
- `src/frontend/src/layouts/SentinelLayout.tsx`
- `src/frontend/src/layouts/GhostLayout.tsx`
- `src/frontend/src/layouts/DreamLayout.tsx`
- `src/frontend/src/layouts/StateRouter.tsx` — auto-switch layouts
- `src/frontend/src/components/core/StatusBar.tsx`
- `src/frontend/src/components/core/Avatar.tsx`
- `src/frontend/src/components/core/StateIndicator.tsx`
- `src/frontend/src/stores/systemStore.ts`

## Прочитай: STATE_MACHINE.md (Поведінка По Станах), DATA_MODELS.md (SystemState)
## Залежності: Фаза 0, 1 (WebSocket для real-time state)

---

# Фаза 5 — Чат + Форми Відповідей

## Файли
- `src/frontend/src/components/chat/ChatWindow.tsx`
- `src/frontend/src/components/chat/MessageBubble.tsx`
- `src/frontend/src/components/chat/ResponseRenderer.tsx` — renders all forms
- `src/frontend/src/components/chat/ChartResponse.tsx` — Recharts
- `src/frontend/src/components/chat/DiagramResponse.tsx` — D3
- `src/frontend/src/components/chat/MapResponse.tsx` — mini Leaflet
- `src/frontend/src/components/chat/TerminalResponse.tsx`
- `src/frontend/src/components/chat/MetricCards.tsx`
- `src/frontend/src/components/chat/CodeBlock.tsx`
- `src/frontend/src/stores/chatStore.ts`
- `src/backend/api/routes_chat.py`

## Прочитай: DATA_MODELS.md (ChatMessage, ResponseForm), API_CONTRACTS.md (Chat)
## Залежності: Фаза 0, 1, 2, 3, 4

---

# Фаза 6 — Тактична Карта

## Файли
- `src/frontend/src/components/map/TacticalMap.tsx` — MapLibre GL
- `src/frontend/src/components/map/layers/*.tsx` — Base, Presence, Wardriving, Intel, Recon
- `src/frontend/src/components/map/MarkerCard.tsx`
- `src/frontend/src/components/map/HeatmapLayer.tsx`
- `src/backend/wardriving/collector.py` — WiFi→SQLite
- `src/backend/wardriving/heatmap.py` — RSSI data
- `src/backend/api/routes_map.py`

## Прочитай: DATA_MODELS.md (Wardriving, MapPOI), API_CONTRACTS.md (Map)
## Залежності: Фаза 0, 1, 4

---

# Фаза 7 — Voice Pipeline

## Файли
- `src/backend/voice/stt_engine.py` — hybrid Whisper + Vosk
- `src/backend/voice/tts_engine.py` — StyleTTS2 Ukrainian
- `src/backend/voice/wake_word.py` — hotword via Vosk
- `src/backend/voice/voice_pipeline.py` — full duplex
- `src/backend/api/routes_voice.py`
- `src/frontend/src/components/chat/VoiceIndicator.tsx`
- `src/frontend/src/hooks/useVoice.ts`

## Прочитай: VOICE_PIPELINE.md, API_CONTRACTS.md (Voice)
## Залежності: Фаза 0, 1, 3, 5

---

# Фаза 8 — Face Tracking + Secondary UI

## Файли
- `src/backend/vision/face_tracker.py` — OpenCV → servo delta
- `src/backend/vision/camera_manager.py` — camera lifecycle
- `src/firmware/src/actuator_ctrl.cpp` — servo control update
- OLED sync, encoder navigation

## Залежності: Фаза 0, 1

---

# Фаза 9 — Linux Control

## Файли
- `src/backend/linux/executor.py` — sandboxed subprocess
- `src/backend/linux/resource_monitor.py` — RAM/CPU/disk
- `src/backend/linux/dangerous_patterns.py` — blocklist
- `src/backend/api/routes_linux.py`
- `src/frontend/src/components/terminal/TerminalWidget.tsx`
- `src/frontend/src/components/terminal/LiveOutput.tsx`

## Прочитай: API_CONTRACTS.md (Linux Control)
## Залежності: Фаза 0, 1, 2, 3, 5

---

# Фаза 10 — Секретні Фічі

## Файли
- Всі 10 функцій з docs/SECRET_FEATURES.md
- Інтеграція з existing modules (memory, AI, sensors)
- НАТИВНА поведінка — без коментарів 'secret'

## Прочитай: SECRET_FEATURES.md (ОБОВ'ЯЗКОВО)
## Залежності: Фаза 0-9 (all)

---

# Фаза 11 — Інструменти + Календар + Settings UI

## Файли
- `src/backend/tools/timer_service.py`
- `src/backend/tools/alarm_service.py`
- `src/backend/tools/calendar_service.py`
- `src/backend/tools/file_manager.py`
- `src/backend/api/routes_tools.py`
- `src/backend/api/routes_settings.py`
- `src/frontend/src/components/tools/*.tsx`
- `src/frontend/src/components/settings/SettingsPanel.tsx`
- `src/frontend/src/components/settings/SettingRow.tsx`
- `src/frontend/src/components/settings/controls/*.tsx` — Switch, Slider, ColorPicker, etc.

## Прочитай: SETTINGS_SYSTEM.md, API_CONTRACTS.md (Tools, Settings)
## Залежності: Фаза 0-5

---

# Фаза 12 — Безпека + Стабільність

## Файли
- JWT refresh logic hardening
- Rate limiting middleware
- Watchdog process (auto-restart)
- Error boundaries (React)
- GHOST AES-256 encryption
- Input sanitization everywhere
- Integration tests (full pipeline)

## Залежності: ALL previous phases
