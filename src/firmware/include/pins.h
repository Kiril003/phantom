#pragma once

// ── ESP32-S3 Hardware Pin Mapping ─────────────────────────────────────────────

// ── Serial (Radxa Host) ───────────────────────────────────────────────────────
// Uses built-in USB serial (UART0 / CDC)

// ── Radar LD2410 (UART1) ──────────────────────────────────────────────────────
#define RADAR_TX_PIN        17
#define RADAR_RX_PIN        18
#define RADAR_UART_NUM      1

// ── GPS GP-02 (UART2) ─────────────────────────────────────────────────────────
#define GPS_TX_PIN          19
#define GPS_RX_PIN          20
#define GPS_UART_NUM        2

// ── I2C Bus (BMP180 + SSD1306 OLED) ──────────────────────────────────────────
#define I2C_SDA_PIN         8
#define I2C_SCL_PIN         9
#define BMP180_ADDR         0x77
#define SSD1306_ADDR        0x3C

// ── RFID RC522 (SPI) ──────────────────────────────────────────────────────────
#define RFID_SS_PIN         10
#define RFID_RST_PIN        11
#define RFID_SCK_PIN        12
#define RFID_MOSI_PIN       13
#define RFID_MISO_PIN       14

// ── AQI Sensor (ADC) ──────────────────────────────────────────────────────────
#define AQI_ADC_PIN         4   // GPIO4 / ADC1_CH3

// ── Rotary Encoder ────────────────────────────────────────────────────────────
#define ENCODER_CLK_PIN     5
#define ENCODER_DT_PIN      6
#define ENCODER_SW_PIN      7

// ── RGB Buttons (3x) ──────────────────────────────────────────────────────────
#define RGB_BTN_0_PIN       1
#define RGB_BTN_1_PIN       2
#define RGB_BTN_2_PIN       3
#define RGB_LED_0_PIN       38
#define RGB_LED_1_PIN       39
#define RGB_LED_2_PIN       40
// RGB LEDs are WS2812B-style, controlled via RMT or FastLED

// ── Servo (SG92R) ─────────────────────────────────────────────────────────────
#define SERVO_PAN_PIN       15
#define SERVO_TILT_PIN      16

// ── Haptic Motor ──────────────────────────────────────────────────────────────
#define HAPTIC_PIN          21  // Via MOSFET

// ── Buzzer ────────────────────────────────────────────────────────────────────
#define BUZZER_PIN          47  // Passive buzzer via MOSFET

// ── Status LED (built-in) ─────────────────────────────────────────────────────
#define STATUS_LED_PIN      48
