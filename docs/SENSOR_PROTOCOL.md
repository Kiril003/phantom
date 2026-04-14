# PHANTOM OS — Sensor Protocol

## 1. Serial Configuration
- Baud rate: 921600
- Data bits: 8, Stop bits: 1, Parity: None
- USB Serial (pyserial-asyncio на Radxa)
- JSON lines: один JSON об'єкт на рядок, terminated by \n

## 2. ESP32 → Radxa (Sensor Batch, кожні 500ms)

```json
{
  "v": 3,
  "ts": 1718000000,
  "type": "sensor_batch",
  "radar": {
    "present": true,
    "motion_e": 45,
    "static_e": 12,
    "dist_cm": 85,
    "breath_bpm": 16
  },
  "gps": {
    "lat": 48.4501,
    "lon": 35.0200,
    "fix": true,
    "sats": 8,
    "speed": 0.2,
    "alt": 155.3,
    "hdop": 1.2
  },
  "env": {
    "temp": 22.3,
    "press": 1013.2,
    "aqi": 42
  },
  "rfid": {
    "uid": null,
    "new": false
  },
  "enc": {
    "pos": 127,
    "delta": 0,
    "btn": false,
    "long": false
  },
  "btns": [false, false, false],
  "wifi": null
}
```

### Примітки по полях:
- `wifi` — **не в кожному batch**. WiFi scan кожні 10s (configurable). Коли немає скану = `null`.
- `radar.breath_bpm` — `null` якщо LD2410 не може визначити (рух або далеко).
- `rfid.new` — `true` тільки один batch після прикладання картки, потім `false`.
- `enc.long` — `true` якщо кнопка утримується > 1s (configurable).
- Стислі ключі для економії bandwidth (motion_e замість motion_energy).

### WiFi Scan Batch (коли є)
```json
{
  "v": 3,
  "ts": 1718000010,
  "type": "sensor_batch",
  "wifi": [
    {"mac": "AA:BB:CC:DD:EE:FF", "ssid": "HomeNet", "rssi": -45, "enc": 3, "ch": 6},
    {"mac": "11:22:33:44:55:66", "ssid": "Neighbor", "rssi": -72, "enc": 4, "ch": 11}
  ]
}
```

## 3. Radxa → ESP32 (Commands, event-driven)

### Servo
```json
{"type": "servo", "pan": -5, "tilt": 2}
```
Values: delta degrees (-90 to +90). ESP32 clamps to physical limits.

### Haptic
```json
{"type": "haptic", "pat": "double", "ms": 200}
```
Patterns: "single", "double", "long", "sos"

### OLED
```json
{"type": "oled", "mode": "text", "lines": ["Привіт", "22:41"]}
{"type": "oled", "mode": "menu", "idx": 2}
{"type": "oled", "mode": "clear"}
{"type": "oled", "mode": "status", "lines": ["FOCUS", "18bpm calm"]}
{"type": "oled", "mode": "anim", "id": "breathing"}
```
OLED SSD1306 128x64. Max 4 рядки тексту, 21 символ на рядок (font 6x8).

### RGB LEDs
```json
{"type": "rgb", "id": 0, "color": "FF0000", "mode": "pulse", "spd": 500}
```
id: 0-2 (три RGB кнопки). Modes: "solid", "pulse", "breathe", "off".
spd: мілісекунди для одного циклу анімації.

### Buzzer
```json
{"type": "buzz", "freq": 1000, "ms": 500}
{"type": "buzz", "freq": 0, "ms": 0}
```
freq=0 → стоп.

### Config (runtime ESP32 settings)
```json
{"type": "cfg", "key": "wifi_scan_interval", "val": 10000}
{"type": "cfg", "key": "radar_sensitivity", "val": 7}
{"type": "cfg", "key": "batch_interval_ms", "val": 500}
```

## 4. ESP32 Error Reporting
```json
{"v": 3, "ts": 1718000000, "type": "error", "sensor": "gps", "msg": "no fix timeout", "code": 3}
{"v": 3, "ts": 1718000000, "type": "error", "sensor": "radar", "msg": "i2c nack", "code": 1}
```

## 5. ESP32 Heartbeat (кожні 5s)
```json
{"v": 3, "ts": 1718000000, "type": "heartbeat", "uptime_ms": 3600000, "free_heap": 125000, "wifi_rssi": -45}
```
Backend відслідковує heartbeat. Якщо немає > 10s → ESP32 disconnected alert.

## 6. Sensor Settings (Configurable via UI)

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| sensor.batch_interval_ms | range | 500 | 100-2000, частота batch |
| sensor.wifi_scan_interval_s | range | 10 | 5-120, WiFi scan interval |
| sensor.wifi_scan_enabled | boolean | true | wardriving on/off |
| sensor.radar_sensitivity | range | 7 | 1-9, LD2410 sensitivity |
| sensor.radar_max_distance_cm | range | 300 | 50-600 |
| sensor.gps_enabled | boolean | true | GPS module on/off |
| sensor.breathing_detection | boolean | true | LD2410 breathing |
| sensor.serial_port | string | /dev/ttyUSB0 | serial device |
| sensor.serial_baud | select | 921600 | 115200/460800/921600 |
| sensor.env_read_interval_s | range | 5 | 1-60, BMP180/AQI |
| sensor.oled_brightness | range | 128 | 0-255 |
| sensor.oled_timeout_s | range | 30 | 0=always on, 5-300 |
| sensor.haptic_intensity | range | 200 | 50-1000ms, vibration |
| sensor.buzzer_volume | range | 50 | 0-100% (PWM duty) |
