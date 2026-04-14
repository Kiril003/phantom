#pragma once

// ── Serial Protocol ───────────────────────────────────────────────────────────
#define SERIAL_BAUD         921600
#define PROTOCOL_VERSION    3
#define BATCH_INTERVAL_MS   500

// ── WiFi Scanner ──────────────────────────────────────────────────────────────
#define WIFI_SCAN_INTERVAL_MS   10000   // 10s default (configurable via JSON cmd)
#define WIFI_SCAN_MAX_NETS      20

// ── Radar (LD2410) ────────────────────────────────────────────────────────────
#define RADAR_UART_BAUD     256000
#define RADAR_SENSITIVITY   7           // 1-9
#define RADAR_MAX_DIST_CM   300

// ── GPS (GP-02) ───────────────────────────────────────────────────────────────
#define GPS_UART_BAUD       9600
#define GPS_TIMEOUT_MS      2000

// ── I2C (BMP180, SSD1306) ─────────────────────────────────────────────────────
#define I2C_FREQ_HZ         400000

// ── AQI ADC ───────────────────────────────────────────────────────────────────
#define AQI_ADC_SAMPLES     10
#define AQI_ADC_MV_MIN      100
#define AQI_ADC_MV_MAX      3300

// ── Encoder ───────────────────────────────────────────────────────────────────
#define ENCODER_LONG_PRESS_MS   1000

// ── Servo ─────────────────────────────────────────────────────────────────────
#define SERVO_PAN_MIN       0
#define SERVO_PAN_MAX       180
#define SERVO_PAN_CENTER    90
#define SERVO_TILT_MIN      30
#define SERVO_TILT_MAX      150
#define SERVO_TILT_CENTER   90

// ── Haptic ────────────────────────────────────────────────────────────────────
#define HAPTIC_DEFAULT_MS   200

// ── OLED ──────────────────────────────────────────────────────────────────────
#define OLED_WIDTH          128
#define OLED_HEIGHT         64
#define OLED_TIMEOUT_MS     30000
#define OLED_BRIGHTNESS     128

// ── Buzzer ────────────────────────────────────────────────────────────────────
#define BUZZER_DEFAULT_FREQ_HZ  1000
#define BUZZER_DEFAULT_MS       200

// ── Heartbeat ─────────────────────────────────────────────────────────────────
#define HEARTBEAT_INTERVAL_MS   5000

// ── FreeRTOS Task Priorities ──────────────────────────────────────────────────
#define TASK_PRIO_SENSOR    3
#define TASK_PRIO_JSON_TX   2
#define TASK_PRIO_CMD_RX    4
#define TASK_PRIO_WIFI_SCAN 1

// ── FreeRTOS Stack Sizes (words) ──────────────────────────────────────────────
#define STACK_SENSOR        4096
#define STACK_JSON_TX       4096
#define STACK_CMD_RX        4096
#define STACK_WIFI_SCAN     8192
