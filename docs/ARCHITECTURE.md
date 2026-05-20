# PHANTOM OS — Архітектура Системи

> **УВАГА: Оновлення Архітектури (Swarm Transition)**
> Система наразі перебуває в процесі міграції до архітектури **Total Coverage Autonomous Swarm**, що передбачає 6 рівнів агентної взаємодії, включаючи MARS (Multi-Agent Review System), генеративний UI та графову пам'ять. 
> Детальний маніфест та стратегія впровадження описані у [`docs/architecture/total-coverage-swarm.md`](architecture/total-coverage-swarm.md).

## 1. Огляд Архітектури

```
┌─────────────────────────────────────────────────────────────┐
│                    PHANTOM OS — Radxa Dragon Q6A             │
│                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌───────────────┐  │
│  │   React 18   │◄──►│  WebSocket   │◄──►│   FastAPI     │  │
│  │   Frontend   │    │    Hub       │    │   Backend     │  │
│  │  (Vite+TS)   │    │  (channels)  │    │  (asyncio)    │  │
│  └──────┬───────┘    └──────────────┘    └───────┬───────┘  │
│         │                                         │          │
│         │            ┌──────────────┐              │          │
│         └───────────►│ REST API     │◄─────────────┘          │
│                      │ /api/v1/*    │                         │
│                      └──────────────┘                         │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │                  CORE ENGINE LAYER                    │    │
│  │                                                       │    │
│  │  ContextEngine ──► DecisionTree ──► StateMachine     │    │
│  │       ▲                                    │          │    │
│  │       │              EventBus ◄────────────┘          │    │
│  │       │                 │                             │    │
│  │  ┌────┴─────┐    ┌─────┴──────┐   ┌──────────────┐  │    │
│  │  │ Sensors  │    │  AI Core   │   │   Memory     │  │    │
│  │  │ Bridge   │    │ Gemini/    │   │ Session/     │  │    │
│  │  │ (Serial) │    │ Ollama     │   │ Tactical/    │  │    │
│  │  └────┬─────┘    └────────────┘   │ Strategic/   │  │    │
│  │       │                            │ Archive      │  │    │
│  │       │          ┌──────────────┐  └──────────────┘  │    │
│  │       │          │ Voice        │                     │    │
│  │       │          │ STT+TTS     │                     │    │
│  │       │          │ Pipeline    │                     │    │
│  │       │          └──────────────┘                     │    │
│  └───────┼──────────────────────────────────────────────┘    │
│          │                                                    │
│  ┌───────┴──────────────────────────┐                        │
│  │    Serial Bridge (921600 baud)    │                        │
│  └───────┬──────────────────────────┘                        │
└──────────┼───────────────────────────────────────────────────┘
           │ USB Serial
┌──────────┴───────────────────────────────────────────────────┐
│                    ESP32-S3 (FreeRTOS)                        │
│                                                              │
│  ┌────────┐ ┌─────┐ ┌──────┐ ┌─────┐ ┌──────┐ ┌─────────┐ │
│  │LD2410  │ │GP-02│ │BMP180│ │AQI  │ │RC522 │ │WiFi Scan│ │
│  │ radar  │ │ GPS │ │T/P   │ │ADC  │ │RFID  │ │wardrive │ │
│  └────────┘ └─────┘ └──────┘ └─────┘ └──────┘ └─────────┘ │
│                                                              │
│  ┌────────┐ ┌─────────┐ ┌──────┐ ┌───────┐ ┌────────────┐  │
│  │SG92R   │ │SSD1306  │ │Rotary│ │RGB    │ │Vibro+Buzz  │  │
│  │servo   │ │OLED     │ │Enc.  │ │LEDs   │ │feedback    │  │
│  └────────┘ └─────────┘ └──────┘ └───────┘ └────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

## 2. Потік Даних (Data Flow)

### 2.1 Sensor → Decision (кожні 500ms)
```
ESP32 sensor_hub task (FreeRTOS)
  → JSON batch збирається з усіх сенсорів
  → Serial TX → USB → Radxa
  → serial_bridge.py → sensor_parser.py → typed SensorBatch
  → context_engine.py → будує ContextSnapshot
  → decision_tree.py → оцінює priorities
  → state_machine.py → можливий transition
  → event_bus.py → публікує зміни
  → websocket_hub.py → пушить на frontend
```

### 2.2 User → AI → Response
```
User input (voice / touch / encoder)
  → frontend captures → WebSocket / REST
  → routes_chat.py → отримує поточний ContextSnapshot
  → prompt_builder.py → формує prompt з:
      - system prompt (personality + current state)
      - memory retrieval (ChromaDB top-5 relevant)
      - behavioral_model (tone adaptation)
      - user message
  → ai/provider.py → configured Gemini model || Ollama fallback
  → response_formatter.py → AI вибирає форму (text/chart/map/terminal/mixed)
  → WebSocket push → frontend renders
  → memory записує interaction
```

### 2.3 Voice Pipeline (Full Duplex)
```
Microphone (always listening in DIALOGUE state)
  → wake_word.py → hotword detected?
    YES → voice_pipeline.py activates
      → Vosk streaming (instant partial results → UI)
      → faster-whisper / NPU Whisper refinement where configured
      → якщо розбіжність > threshold → refined transcript wins
      → transcript → routes_chat.py (як текстовий input)
  → AI response text
    → tts_engine.py → Piper voice (StyleTTS2 is future work)
    → audio stream → speaker
    → анімація аватару синхронізується з аудіо
```

## 3. WebSocket Channels

Один WebSocket з'єднання, мультиплексований по каналах:

| Channel | Direction | Payload | Frequency |
|---------|-----------|---------|-----------|
| `sensor` | server→client | ContextSnapshot | 500ms |
| `state` | server→client | SystemState change | on event |
| `chat` | bidirectional | ChatMessage | on event |
| `voice` | server→client | STT partial/final, TTS status | streaming |
| `terminal` | server→client | Command output stream | streaming |
| `alert` | server→client | Priority notifications | on event |
| `map` | server→client | New wardriving/GPS data | 2s batch |
| `settings` | bidirectional | Config changes | on event |

## 4. Рівні Кешування

| Рівень | Що | TTL | Storage |
|--------|-----|-----|---------|
| L1 | ContextSnapshot | 500ms | Python dict in memory |
| L2 | Tactical memory | 24h | SQLite |
| L3 | Strategic memory | ∞ | ChromaDB vectors |
| L4 | Sensor timeseries | 7d | SQLite (rotate) |
| L5 | Wardriving DB | ∞ | SQLite (dedicated) |
| L6 | Ghost records | ∞ | AES-256 encrypted files |

## 5. Concurrency Model

Backend працює на **asyncio event loop**:
- Serial bridge: asyncio task (pyserial-asyncio)
- WebSocket hub: FastAPI WebSocket з asyncio
- AI inference: async HTTP (Gemini API) / async subprocess (Ollama)
- Face tracking: окремий thread (OpenCV блокуючий) → asyncio Queue
- STT/TTS: окремі threads → asyncio Queue
- SQLite: aiosqlite через SQLAlchemy async
- ChromaDB: thread pool executor (ChromaDB sync)

**Правило: НІКОЛИ не блокувати event loop. Все що блокує → thread + Queue.**

## 6. Security Layers

```
Layer 1: RFID/PIN → JWT token (httponly cookie + WS auth)
Layer 2: RBAC (ROOT/OPERATOR/GUEST) per endpoint
Layer 3: Dangerous Linux commands → UI confirm dialog
Layer 4: GHOST encryption → AES-256-GCM, key = RFID UID derived
Layer 5: Rate limiting (10 AI req/min per user)
Layer 6: Input sanitization (all user inputs, especially Linux commands)
```

## 7. Конфігурація (Все Через UI)

Кожен параметр системи доступний через Settings UI і зберігається в SQLite `settings` table.
Backend при старті читає з DB, падає на defaults якщо немає.
Зміни через Settings → WebSocket → backend hot-reload (без перезапуску).

Категорії налаштувань описані в `docs/SETTINGS_SYSTEM.md`.
