# PHANTOM OS — Data Models

Всі типи живуть в `src/shared/types/` і імпортуються і frontend і backend.
Backend дублює як Pydantic models в `src/backend/db/models.py`.

## 1. System States

```typescript
// src/shared/types/system.ts

export enum SystemState {
  SHADOW = 'SHADOW',       // Пасивний нагляд
  FOCUS = 'FOCUS',         // Робочий режим
  DIALOGUE = 'DIALOGUE',   // Розмова з AI
  SENTINEL = 'SENTINEL',   // Охорона/загроза
  GHOST = 'GHOST',         // Невидимий запис
  DREAM = 'DREAM',         // Нічний режим
}

export interface StateTransition {
  from: SystemState;
  to: SystemState;
  trigger: string;            // людське пояснення тригеру
  timestamp: number;          // unix ms
  auto: boolean;              // true = система вирішила, false = user
}
```

## 2. Context Snapshot (серце системи)

```typescript
// src/shared/types/context.ts

export interface ContextSnapshot {
  timestamp: number;
  
  who: {
    user_id: string | null;
    username: string | null;
    confidence: number;         // 0-1
    auth_method: 'rfid' | 'pin' | 'auto' | 'breathing' | null;
    role: 'ROOT' | 'OPERATOR' | 'GUEST' | null;
  };
  
  where: {
    lat: number | null;
    lon: number | null;
    fix: boolean;
    satellites: number;
    speed_kmh: number;
    place_known: boolean;       // чи є в базі POI
    place_name: string | null;  // назва якщо відомо
    first_visit: boolean;
  };
  
  when: {
    time: string;               // HH:MM
    hour: number;               // 0-23
    day_of_week: string;        // mon/tue/...
    date: string;               // YYYY-MM-DD
    work_hours: boolean;        // визначається з calendar/pattern
    is_night: boolean;          // 23:00-06:00
  };
  
  body: {
    breathing_bpm: number | null;
    breathing_state: 'sleep' | 'calm' | 'normal' | 'elevated' | 'stressed';
    stress_level: number;       // 0-1
    motion_energy: number;      // 0-100 від LD2410
    static_energy: number;      // 0-100 від LD2410
    user_distance_cm: number | null;
  };
  
  env: {
    temp_c: number | null;
    pressure_hpa: number | null;
    aqi: number | null;
  };
  
  presence: {
    user_detected: boolean;
    user_distance_cm: number | null;
    other_detected: boolean;    // хтось крім юзера
    other_distance_cm: number | null;
  };
  
  history: {
    last_interaction_ago_s: number;
    last_state_change_ago_s: number;
    mood_trend: 'improving' | 'stable' | 'declining';
    active_timers: number;
    pending_events_1h: number;  // calendar events in next hour
  };
  
  memory_hints: string[];       // top-5 relevant facts з ChromaDB

  system: {
    state: SystemState;
    uptime_s: number;
    cpu_percent: number;
    ram_percent: number;
    disk_percent: number;
    wifi_connected: boolean;
    internet_available: boolean;
    ai_provider: 'gemini' | 'ollama';
    stt_engine: 'whisper' | 'vosk';
  };
}
```

## 3. Sensor Batch (ESP32 → Radxa)

```typescript
// src/shared/types/sensors.ts

export interface SensorBatch {
  v: number;                    // protocol version = 3
  ts: number;                   // ESP32 millis()
  type: 'sensor_batch';
  
  radar: {
    present: boolean;
    motion_energy: number;      // 0-100
    static_energy: number;      // 0-100
    distance_cm: number;
    breath_bpm: number | null;  // null якщо не можна визначити
  } | null;
  
  gps: {
    lat: number;
    lon: number;
    fix: boolean;
    satellites: number;
    speed_kmh: number;
    altitude_m: number;
    hdop: number;
  } | null;
  
  env: {
    temp_c: number;
    pressure_hpa: number;
    aqi: number;
  } | null;
  
  rfid: {
    uid: string | null;         // hex string, null якщо немає картки
    new_read: boolean;          // true тільки на момент прикладання
  } | null;
  
  encoder: {
    position: number;           // absolute position
    delta: number;              // зміна з останнього batch
    button: boolean;            // натиснуто зараз
    long_press: boolean;        // утримання > 1s
  } | null;
  
  buttons: {
    rgb_states: [boolean, boolean, boolean]; // 3 RGB кнопки
    any_pressed: boolean;
  } | null;
  
  wifi_nets: Array<{
    mac: string;
    ssid: string;
    rssi: number;
    encryption: number;         // ESP32 wifi_auth_mode_t
    channel: number;
  }> | null;                    // null якщо не час для скану
}
```

## 4. Actuator Commands (Radxa → ESP32)

```typescript
// src/shared/types/commands.ts

export type ActuatorCommand = 
  | { type: 'servo'; pan_delta: number; tilt_delta: number }
  | { type: 'haptic'; pattern: 'single' | 'double' | 'long' | 'sos'; duration_ms: number }
  | { type: 'oled'; mode: 'clear' | 'text' | 'menu' | 'status' | 'animation';
      lines?: string[]; menu_idx?: number; animation_id?: string }
  | { type: 'rgb'; id: number; color: string; mode: 'solid' | 'pulse' | 'breathe' | 'off';
      speed_ms?: number }
  | { type: 'buzzer'; freq_hz: number; duration_ms: number; pattern?: 'single' | 'double' | 'melody' }
  | { type: 'config'; key: string; value: string | number };
```

## 5. User & Auth

```typescript
// src/shared/types/user.ts

export type UserRole = 'ROOT' | 'OPERATOR' | 'GUEST';

export interface User {
  id: string;                   // UUID
  username: string;
  role: UserRole;
  rfid_uid_hash: string | null; // bcrypt hash
  pin_hash: string | null;      // bcrypt hash
  avatar_url: string | null;
  created_at: string;
  last_seen_at: string;
  
  preferences: UserPreferences;
  behavioral_model: BehavioralModel;
}

export interface UserPreferences {
  language: 'uk' | 'en' | 'ru';
  tts_voice: string;            // назва голосу StyleTTS2
  tts_speed: number;            // 0.5-2.0, default 1.0
  tts_enabled: boolean;
  stt_enabled: boolean;
  wake_word: string;            // "фантом", "hey phantom", custom
  theme: 'auto' | 'dark' | 'light';
  ui_density: 'compact' | 'normal' | 'comfortable';
  notification_sound: boolean;
  haptic_feedback: boolean;
  map_default_zoom: number;
  calendar_first_day: 'mon' | 'sun';
  work_hours_start: string;     // "09:00"
  work_hours_end: string;       // "18:00"
  null_space_trigger: string;   // фраза для NULL SPACE (секретна фіча)
}

export interface BehavioralModel {
  response_preference: string;          // e.g. "короткі відповіді після 22:00"
  stress_patterns: string;              // e.g. "підвищений стрес вт-чт вранці"
  vocabulary: string[];                 // власні слова/фрази юзера
  decision_style: string;              
  trust_level: number;                  // 0-1, зростає з часом
  honest_gap: number;                   // 0-1, різниця слова↔дії
  preferred_topics: string[];
  avoid_topics: string[];               // визначається AI, ніколи не питає прямо
  interaction_count: number;
  days_active: number;
  breathing_signature: number[] | null; // FFT fingerprint, null якщо < 20 днів
  language_stats: Record<string, number>; // відсоток використання мов
}
```

## 6. Chat & Messages

```typescript
// src/shared/types/chat.ts

export type ResponseForm = 
  | 'text' 
  | 'markdown' 
  | 'chart'           // Recharts inline
  | 'diagram'         // D3 animated
  | 'map'             // Leaflet mini
  | 'terminal'        // Linux command output
  | 'code'            // syntax highlighted
  | 'metric_cards'    // числові дані з трендом
  | 'mixed';          // комбінація

export interface ChatMessage {
  id: string;
  session_id: string;
  user_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  response_form: ResponseForm;
  metadata: {
    state_at_time: SystemState;
    context_snapshot_id: string;
    ai_provider: 'gemini' | 'ollama';
    latency_ms: number;
    tokens_used: number;
    tone: string;               // визначений AI
    input_method: 'voice' | 'text' | 'encoder';
  };
  attachments: ChatAttachment[];
  created_at: string;
}

export interface ChatAttachment {
  type: 'chart_data' | 'map_markers' | 'terminal_output' | 'code_block' | 'metric_card';
  data: Record<string, unknown>;
}

export interface ChatSession {
  id: string;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  message_count: number;
  summary: string | null;       // AI-generated session summary
  state_history: StateTransition[];
}
```

## 7. Memory Models

```typescript
// src/shared/types/memory.ts

export interface MemoryFact {
  id: string;
  user_id: string;
  layer: 'session' | 'tactical' | 'strategic' | 'archive';
  category: 'fact' | 'preference' | 'event' | 'pattern' | 'decision' | 'emotion' | 'thought_stream';
  content: string;
  importance: number;           // 0-1
  embedding_id: string | null;  // ChromaDB ID for strategic
  source_session_id: string;
  created_at: string;
  accessed_at: string;          // останнє звернення
  access_count: number;
  is_sealed: boolean;           // true = archive/dead zone
  decay_factor: number;         // 0-1, як швидко забувати
}

export interface TemporalAnchor {
  id: string;
  user_id: string;
  timestamp: string;
  lat: number | null;
  lon: number | null;
  place_name: string | null;
  activity_summary: string;     // AI-generated "що робив"
  state: SystemState;
  mood: string;
}
```

## 8. Wardriving

```typescript
// src/shared/types/wardriving.ts

export interface WardrivingRecord {
  id: number;
  mac: string;
  ssid: string;
  rssi: number;
  encryption: string;
  channel: number;
  lat: number;
  lon: number;
  first_seen: string;
  last_seen: string;
  seen_count: number;
}

export interface MapPOI {
  id: string;
  user_id: string;
  lat: number;
  lon: number;
  name: string;
  category: 'intel' | 'threat' | 'saved' | 'home' | 'work' | 'custom';
  notes: string;
  icon: string;
  is_secret: boolean;           // тільки в GHOST
  created_at: string;
}
```

## 9. Settings (зберігаються в SQLite)

```typescript
// src/shared/types/settings.ts

export interface SettingsCategory {
  id: string;
  label: string;
  icon: string;
  settings: SettingDefinition[];
}

export interface SettingDefinition {
  key: string;                  // dot-notation: "ai.primary_provider"
  label: string;
  description: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'range' | 'color' | 'text';
  default: unknown;
  value: unknown;
  options?: Array<{ value: string; label: string }>;  // for select
  min?: number;                 // for range/number
  max?: number;
  step?: number;
  unit?: string;                // "ms", "°C", "%"
  requires_restart: boolean;
  category: string;
  visible_to: UserRole[];       // хто бачить цей setting
}
```

## 10. Pydantic Backend Models

```python
# src/backend/db/models.py — SQLAlchemy ORM

# Кожна TypeScript interface має відповідну SQLAlchemy модель:
# User → users table
# ChatMessage → chat_messages table
# ChatSession → chat_sessions table
# MemoryFact → memory_facts table
# TemporalAnchor → temporal_anchors table
# WardrivingRecord → wardriving_records table
# MapPOI → map_pois table
# Setting → settings table (key-value з metadata)
# StateTransition → state_transitions table (лог)
# SensorLog → sensor_logs table (timeseries, 7d rotation)

# Pydantic schemas в окремих файлах:
# src/backend/api/schemas/*.py — request/response models
```
