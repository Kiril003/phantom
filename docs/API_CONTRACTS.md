# PHANTOM OS — API Contracts

Base URL: `http://localhost:8000/api/v1`
WebSocket: `ws://localhost:8000/ws`
Auth: JWT в httponly cookie + WS initial auth message

## 1. Authentication

### POST /auth/login/rfid
```json
Request:  { "uid_hash": "string" }
Response: { "user": User, "token": "jwt_string", "expires_at": "ISO8601" }
Error:    { "detail": "Unknown RFID", "code": "RFID_UNKNOWN" }
```

### POST /auth/login/pin
```json
Request:  { "username": "string", "pin": "string" }
Response: { "user": User, "token": "jwt_string", "expires_at": "ISO8601" }
```

### POST /auth/refresh
```json
Response: { "token": "jwt_string", "expires_at": "ISO8601" }
```

### GET /auth/me
```json
Response: User (повний об'єкт з preferences і behavioral_model)
```

### POST /auth/logout
```json
Response: { "ok": true }
```

## 2. Chat

### POST /chat/message
```json
Request: {
  "content": "string",
  "input_method": "voice" | "text" | "encoder",
  "session_id": "string | null"     // null = new session
}
Response: {
  "message": ChatMessage,
  "session_id": "string"
}
```
Note: AI response also pushed via WebSocket `chat` channel for streaming.

### GET /chat/sessions?limit=20&offset=0
```json
Response: { "sessions": ChatSession[], "total": number }
```

### GET /chat/sessions/{session_id}/messages
```json
Response: { "messages": ChatMessage[] }
```

### DELETE /chat/sessions/{session_id}
```json
Response: { "ok": true }
```

## 3. Context

### GET /context/current
```json
Response: ContextSnapshot (повний поточний знімок)
```

### GET /context/history?minutes=60
```json
Response: { "snapshots": ContextSnapshot[], "interval_ms": 500 }
```

### GET /context/state
```json
Response: { "state": SystemState, "since": "ISO8601", "previous": SystemState }
```

## 4. Voice

### POST /voice/tts
```json
Request: {
  "text": "string",
  "voice": "string",          // voice name
  "speed": 1.0,
  "emotion_scale": 1.0
}
Response: audio/wav stream
```

### POST /voice/stt
```json
Request: audio/wav binary (multipart/form-data)
Response: { "text": "string", "confidence": 0.95, "engine": "whisper" | "vosk", "language": "uk" }
```

### WebSocket /ws — voice channel
```json
Client→Server: { "channel": "voice", "action": "start_listening" }
Server→Client: { "channel": "voice", "type": "partial", "text": "привіт як", "engine": "vosk" }
Server→Client: { "channel": "voice", "type": "final", "text": "привіт як справи", "engine": "whisper" }
Server→Client: { "channel": "voice", "type": "tts_start", "duration_ms": 2300 }
Server→Client: { "channel": "voice", "type": "tts_end" }
```

## 5. Settings

### GET /settings
```json
Response: { "categories": SettingsCategory[] }
```

### GET /settings/{key}
```json
Response: { "key": "ai.primary_provider", "value": "gemini", "definition": SettingDefinition }
```

### PUT /settings/{key}
```json
Request:  { "value": "ollama" }
Response: { "key": "ai.primary_provider", "value": "ollama", "requires_restart": false }
```
Side effect: broadcast via WebSocket `settings` channel

### POST /settings/reset
```json
Request:  { "category": "ai" }    // або null для всього
Response: { "ok": true, "reset_count": 12 }
```

### POST /settings/export
```json
Response: { "settings": Record<string, unknown>, "exported_at": "ISO8601" }
```

### POST /settings/import
```json
Request:  { "settings": Record<string, unknown> }
Response: { "ok": true, "imported_count": 45, "skipped": 3 }
```

## 6. Map & Wardriving

### GET /map/wardriving?bounds=lat1,lon1,lat2,lon2&since=ISO8601
```json
Response: { "records": WardrivingRecord[], "total": number }
```

### GET /map/heatmap?bounds=lat1,lon1,lat2,lon2
```json
Response: { "points": [{ "lat": number, "lon": number, "weight": number }] }
```

### GET /map/pois?category=intel
```json
Response: { "pois": MapPOI[] }
```

### POST /map/pois
```json
Request:  MapPOI (без id і created_at)
Response: MapPOI (повний)
```

### GET /map/track?hours=2
```json
Response: { "points": [{ "lat": number, "lon": number, "ts": "ISO8601", "speed": number }] }
```

## 7. Linux Control

### POST /linux/execute
```json
Request: {
  "command": "string",
  "timeout_s": 30,
  "confirmed": false            // true якщо юзер підтвердив dangerous
}
Response: {
  "id": "string",
  "status": "running" | "completed" | "error" | "needs_confirm",
  "stdout": "string",
  "stderr": "string",
  "exit_code": number | null,
  "dangerous": boolean,
  "explanation": "string"        // AI пояснення що робить команда
}
```
Note: streaming output через WebSocket `terminal` channel

### GET /linux/resources
```json
Response: {
  "cpu_percent": number,
  "ram_used_mb": number,
  "ram_total_mb": number,
  "disk_used_gb": number,
  "disk_total_gb": number,
  "temperature_c": number | null,
  "load_average": [number, number, number]
}
```

## 8. Tools

### POST /tools/timer
```json
Request:  { "duration_s": 300, "label": "Чай" }
Response: { "id": "string", "ends_at": "ISO8601" }
```

### POST /tools/alarm
```json
Request:  { "time": "07:30", "repeat": "daily" | "weekdays" | "once", "label": "Підйом" }
Response: { "id": "string", "next_trigger": "ISO8601" }
```

### GET /tools/calendar?range=week
```json
Response: { "events": CalendarEvent[] }
```

### POST /tools/calendar/events
```json
Request:  CalendarEvent (без id)
Response: CalendarEvent
```

## 9. Users (ROOT only)

### GET /users
### POST /users
### PUT /users/{id}
### DELETE /users/{id}
### PUT /users/{id}/role

## 10. WebSocket Hub Protocol

### Connection
```
ws://localhost:8000/ws?token=JWT_TOKEN
```

### Message Format (all channels)
```json
{
  "channel": "sensor" | "state" | "chat" | "voice" | "terminal" | "alert" | "map" | "settings",
  "type": "string",             // channel-specific event type
  "data": { ... },              // payload
  "ts": 1718000000000           // unix ms
}
```

### Client → Server messages
```json
{ "channel": "chat", "type": "message", "data": { "content": "string", "input_method": "text" } }
{ "channel": "voice", "type": "start_listening", "data": {} }
{ "channel": "voice", "type": "stop_listening", "data": {} }
{ "channel": "terminal", "type": "input", "data": { "command_id": "string", "input": "y\n" } }
{ "channel": "settings", "type": "update", "data": { "key": "string", "value": "any" } }
```

### Server → Client messages (key examples)
```json
{ "channel": "state", "type": "transition", "data": { "from": "SHADOW", "to": "DIALOGUE", "trigger": "voice_input" } }
{ "channel": "chat", "type": "stream", "data": { "message_id": "string", "delta": "chunk of text", "done": false } }
{ "channel": "chat", "type": "stream", "data": { "message_id": "string", "delta": "", "done": true, "message": ChatMessage } }
{ "channel": "alert", "type": "priority", "data": { "level": 1, "title": "Невідома присутність", "body": "LD2410 виявив рух" } }
```
