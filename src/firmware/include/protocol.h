#pragma once

// ── JSON Protocol Keys — ESP32 ↔ Radxa ───────────────────────────────────────
// All short keys to minimize serial bandwidth at 921600 baud.

// Top-level
#define PROTO_VERSION       "v"
#define PROTO_TIMESTAMP     "ts"
#define PROTO_TYPE          "type"

// Message types
#define TYPE_SENSOR_BATCH   "sensor_batch"
#define TYPE_HEARTBEAT      "heartbeat"
#define TYPE_ERROR          "error"

// ── Sensor Batch keys ─────────────────────────────────────────────────────────
// Radar
#define KEY_RADAR           "radar"
#define KEY_RADAR_PRESENT   "present"
#define KEY_RADAR_MOTION_E  "motion_e"
#define KEY_RADAR_STATIC_E  "static_e"
#define KEY_RADAR_DIST      "dist_cm"
#define KEY_RADAR_BREATH    "breath_bpm"

// GPS
#define KEY_GPS             "gps"
#define KEY_GPS_LAT         "lat"
#define KEY_GPS_LON         "lon"
#define KEY_GPS_FIX         "fix"
#define KEY_GPS_SATS        "sats"
#define KEY_GPS_SPEED       "speed"
#define KEY_GPS_ALT         "alt"
#define KEY_GPS_HDOP        "hdop"

// Environment
#define KEY_ENV             "env"
#define KEY_ENV_TEMP        "temp"
#define KEY_ENV_PRESS       "press"
#define KEY_ENV_AQI         "aqi"

// RFID
#define KEY_RFID            "rfid"
#define KEY_RFID_UID        "uid"
#define KEY_RFID_NEW        "new"

// Encoder
#define KEY_ENC             "enc"
#define KEY_ENC_POS         "pos"
#define KEY_ENC_DELTA       "delta"
#define KEY_ENC_BTN         "btn"
#define KEY_ENC_LONG        "long"

// Buttons
#define KEY_BTNS            "btns"

// WiFi
#define KEY_WIFI            "wifi"
#define KEY_WIFI_MAC        "mac"
#define KEY_WIFI_SSID       "ssid"
#define KEY_WIFI_RSSI       "rssi"
#define KEY_WIFI_ENC        "enc"
#define KEY_WIFI_CH         "ch"

// ── Heartbeat keys ────────────────────────────────────────────────────────────
#define KEY_UPTIME_MS       "uptime_ms"
#define KEY_FREE_HEAP       "free_heap"
#define KEY_WIFI_RSSI_HB    "wifi_rssi"

// ── Error keys ────────────────────────────────────────────────────────────────
#define KEY_ERR_SENSOR      "sensor"
#define KEY_ERR_MSG         "msg"
#define KEY_ERR_CODE        "code"

// ── Command keys (Radxa → ESP32) ──────────────────────────────────────────────
#define CMD_TYPE_SERVO      "servo"
#define CMD_SERVO_PAN       "pan"
#define CMD_SERVO_TILT      "tilt"

#define CMD_TYPE_HAPTIC     "haptic"
#define CMD_HAPTIC_PAT      "pat"
#define CMD_HAPTIC_MS       "ms"

#define CMD_TYPE_OLED       "oled"
#define CMD_OLED_MODE       "mode"
#define CMD_OLED_LINES      "lines"
#define CMD_OLED_IDX        "idx"
#define CMD_OLED_ANIM       "anim"

#define CMD_TYPE_RGB        "rgb"
#define CMD_RGB_ID          "id"
#define CMD_RGB_COLOR       "color"
#define CMD_RGB_MODE        "mode"
#define CMD_RGB_SPD         "spd"

#define CMD_TYPE_BUZZ       "buzz"
#define CMD_BUZZ_FREQ       "freq"
#define CMD_BUZZ_MS         "ms"

#define CMD_TYPE_CFG        "cfg"
#define CMD_CFG_KEY         "key"
#define CMD_CFG_VAL         "val"
