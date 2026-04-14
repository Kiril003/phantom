# PHANTOM OS — Settings System

## Принцип
КОЖЕН параметр системи доступний через Settings UI. Нічого hardcoded.
Settings зберігаються в SQLite `settings` table (key-value з metadata).
Зміни застосовуються hot-reload через EventBus → WebSocket push.

## Архітектура Settings

```python
# Backend: config.py
class PhantomSettings(BaseSettings):
    """Pydantic Settings з SQLite override."""
    
    @classmethod
    def load(cls) -> "PhantomSettings":
        defaults = cls()  # з .env та defaults
        db_overrides = SettingsDB.get_all()
        for key, value in db_overrides.items():
            setattr(defaults, key, value)
        return defaults
    
    def update(self, key: str, value: Any) -> bool:
        SettingsDB.set(key, value)
        self._apply_hot(key, value)  # hot-reload якщо можливо
        EventBus.emit("settings_changed", {"key": key, "value": value})
        return True
```

## Категорії Налаштувань

### 🧠 AI & Language Model
| Key | Type | Default | Range | Description |
|-----|------|---------|-------|-------------|
| ai.primary_provider | select | gemini | gemini/ollama | Основний AI провайдер |
| ai.fallback_provider | select | ollama | gemini/ollama/none | Fallback провайдер |
| ai.timeout_s | range | 5.0 | 1-30 | Таймаут primary перед fallback |
| ai.gemini_model | string | gemini-2.0-flash | — | Gemini model name |
| ai.gemini_api_key | password | "" | — | API ключ (зашифрований) |
| ai.ollama_model | select | gemma4:e4b | installed | Ollama model |
| ai.ollama_host | string | http://localhost:11434 | — | Ollama server URL |
| ai.temperature | range | 0.7 | 0-2.0 step 0.1 | Креативність |
| ai.max_tokens | range | 2048 | 256-8192 step 256 | Макс. довжина відповіді |
| ai.top_p | range | 0.9 | 0-1.0 step 0.05 | Top-P sampling |
| ai.system_prompt_extra | text | "" | — | Додаткові інструкції |
| ai.response_language | select | auto | auto/uk/en/ru | Мова відповідей |
| ai.initiative_enabled | bool | true | — | AI ініціює розмову |
| ai.initiative_cooldown_s | range | 300 | 30-3600 | Інтервал ініціатив |
| ai.streaming | bool | true | — | Стрімінг відповідей |

### 🧠 Memory
| Key | Type | Default | Range | Description |
|-----|------|---------|-------|-------------|
| memory.top_k | range | 5 | 1-20 | Кількість фактів з ChromaDB |
| memory.importance_threshold | range | 0.3 | 0-1.0 step 0.05 | Мін. важливість для збереження |
| memory.embedding_model | string | all-MiniLM-L6-v2 | — | Sentence transformer model |
| memory.tactical_window_h | range | 24 | 1-168 | Вікно тактичної пам'яті |
| memory.auto_archive_days | range | 90 | 30-365 | Авто-архівація старих фактів |
| memory.max_facts_per_user | range | 10000 | 1000-100000 | Ліміт стратегічної пам'яті |

### 🎤 Voice — STT
| Key | Type | Default | Range | Description |
|-----|------|---------|-------|-------------|
| voice.stt_mode | select | hybrid | hybrid/vosk/whisper | Режим розпізнавання |
| voice.stt_vosk_model | select | uk-v3-lgraph | installed | Vosk модель |
| voice.stt_whisper_model | select | medium | small/medium/large-v3 | Whisper модель |
| voice.stt_whisper_device | select | auto | auto/cpu/cuda | Пристрій Whisper |
| voice.stt_whisper_compute | select | int8 | int8/float16/float32 | Тип обчислень |
| voice.stt_language | select | uk | uk/en/auto | Мова розпізнавання |
| voice.stt_hybrid_threshold | range | 0.3 | 0.1-0.8 step 0.05 | Поріг Levenshtein |
| voice.vad_silence_ms | range | 500 | 200-2000 step 50 | Тиша = кінець фрази |
| voice.vad_speech_pad_ms | range | 200 | 50-500 step 50 | Padding мовлення |

### 🔊 Voice — TTS
| Key | Type | Default | Range | Description |
|-----|------|---------|-------|-------------|
| voice.tts_enabled | bool | true | — | Озвучка увімкнена |
| voice.tts_voice | select | Марина | available | Голос |
| voice.tts_speed | range | 1.0 | 0.5-2.0 step 0.1 | Швидкість |
| voice.tts_alpha | range | 0.3 | 0-1.0 step 0.05 | Тембр (схожість на голос) |
| voice.tts_beta | range | 0.7 | 0-1.0 step 0.05 | Просодія (стиль тексту) |
| voice.tts_diffusion_steps | range | 5 | 1-20 | Якість (більше=краще, повільніше) |
| voice.tts_emotion_scale | range | 1.0 | 0-3.0 step 0.1 | Емоційність |
| voice.tts_state_adaptation | bool | true | — | Адаптація по стану системи |
| voice.wake_words | text | фантом | — | Wake words (через кому) |
| voice.wake_word_enabled | bool | true | — | Детекція wake word |
| voice.auto_listen_in_dialogue | bool | true | — | Авто-слухання в DIALOGUE |

### 📡 Sensors
| Key | Type | Default | Range | Description |
|-----|------|---------|-------|-------------|
| sensor.batch_interval_ms | range | 500 | 100-2000 step 50 | Частота sensor batch |
| sensor.serial_port | string | /dev/ttyUSB0 | — | Serial порт ESP32 |
| sensor.serial_baud | select | 921600 | 115200/460800/921600 | Baud rate |
| sensor.wifi_scan_interval_s | range | 10 | 5-120 step 5 | WiFi scan інтервал |
| sensor.wifi_scan_enabled | bool | true | — | Wardriving on/off |
| sensor.radar_sensitivity | range | 7 | 1-9 | LD2410 чутливість |
| sensor.radar_max_distance_cm | range | 300 | 50-600 step 10 | LD2410 макс. відстань |
| sensor.breathing_detection | bool | true | — | Детекція дихання |
| sensor.gps_enabled | bool | true | — | GPS модуль |
| sensor.env_read_interval_s | range | 5 | 1-60 | BMP180+AQI інтервал |
| sensor.oled_brightness | range | 128 | 0-255 | Яскравість OLED |
| sensor.oled_timeout_s | range | 30 | 0-300 (0=always) | Таймаут OLED |
| sensor.haptic_intensity_ms | range | 200 | 50-1000 | Сила вібрації |
| sensor.buzzer_volume | range | 50 | 0-100 | Гучність buzzer (%) |

### 🎨 UI & Display
| Key | Type | Default | Range | Description |
|-----|------|---------|-------|-------------|
| ui.theme | select | dark | dark/light/auto | Тема |
| ui.density | select | normal | compact/normal/comfortable | Щільність UI |
| ui.color_cyan | color | #00D4FF | — | Основний accent |
| ui.color_warning | color | #FF6B35 | — | Warning колір |
| ui.color_success | color | #39FF14 | — | Success колір |
| ui.color_danger | color | #FF073A | — | Danger колір |
| ui.color_dream | color | #9B8FD4 | — | Dream режим |
| ui.animation_speed | range | 1.0 | 0.5-2.0 step 0.1 | Множник швидкості анімацій |
| ui.status_bar_height | range | 28 | 20-40 | Висота status bar (px) |
| ui.font_size | range | 14 | 10-20 | Базовий розмір шрифту |
| ui.chat_max_messages_visible | range | 50 | 10-200 | Макс. повідомлень в чаті |
| ui.map_default_zoom | range | 15 | 5-19 | Zoom карти за замовч. |
| ui.map_style | select | dark | dark/satellite/streets | Стиль карти |

### 🔒 Security
| Key | Type | Default | Range | Description |
|-----|------|---------|-------|-------------|
| security.auto_login | bool | true | — | Авто-вхід якщо 1 юзер вдома |
| security.session_timeout_m | range | 480 | 30-1440 | Таймаут JWT (хвилини) |
| security.max_pin_attempts | range | 5 | 3-10 | Макс. спроб PIN |
| security.lockout_duration_m | range | 15 | 5-60 | Блокування після невдач |
| security.dangerous_cmd_confirm | bool | true | — | Підтвердження небезпечних команд |
| security.ghost_auto_encrypt | bool | true | — | Авто-шифрування в GHOST |
| security.rate_limit_ai | range | 10 | 1-60 | AI запитів/хвилину |

### ⏰ Tools
| Key | Type | Default | Range | Description |
|-----|------|---------|-------|-------------|
| tools.calendar_first_day | select | mon | mon/sun | Перший день тижня |
| tools.work_hours_start | string | 09:00 | — | Початок робочого часу |
| tools.work_hours_end | string | 18:00 | — | Кінець робочого часу |
| tools.alarm_sound | select | gentle | gentle/alert/custom | Звук будильника |
| tools.timer_sound | select | chime | chime/buzz/voice | Звук таймера |

### 🖥 System
| Key | Type | Default | Range | Description |
|-----|------|---------|-------|-------------|
| system.hostname | string | phantom | — | Ім'я пристрою |
| system.log_level | select | INFO | DEBUG/INFO/WARNING/ERROR | Рівень логів |
| system.sensor_log_retention_days | range | 7 | 1-30 | Зберігання логів сенсорів |
| system.wardriving_db_path | string | /data/wardriving.db | — | Шлях до wardriving DB |
| system.backup_enabled | bool | true | — | Авто-бекап |
| system.backup_interval_h | range | 24 | 1-168 | Інтервал бекапу |
| system.temporal_anchor_interval_s | range | 300 | 60-3600 | Інтервал temporal anchors |

## Settings UI Layout

```
Settings Screen (1024×600)
├── Left sidebar (200px) — categories з іконками
├── Main area (824px) — settings list
│   ├── Category header
│   ├── Setting row: [icon] [label] [control] [reset btn]
│   │   - toggle → Switch
│   │   - range → Slider + number input
│   │   - select → Dropdown
│   │   - string → Text input
│   │   - password → Password input + eye toggle
│   │   - color → Color picker
│   │   - text → Textarea
│   └── Description under each setting (collapsible)
├── Bottom bar: [Export] [Import] [Reset Category] [Reset All]
```

Кожен setting має "?" tooltip з описом.
Зміни застосовуються миттєво (hot-reload).
Settings що потребують restart — помічені іконкою ⟳.
