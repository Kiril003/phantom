#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/queue.h>
#include <ESP32Servo.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <ArduinoJson.h>

#include "config.h"
#include "pins.h"
#include "protocol.h"

// External queue (defined in main.cpp)
extern QueueHandle_t cmdQueue;

// ── Hardware instances ────────────────────────────────────────────────────────
static Servo servoPan;
static Servo servoTilt;
static Adafruit_SSD1306 oled(OLED_WIDTH, OLED_HEIGHT, &Wire, -1);

// ── Servo state ───────────────────────────────────────────────────────────────
static int panAngle  = SERVO_PAN_CENTER;
static int tiltAngle = SERVO_TILT_CENTER;

// ── Forward declaration ───────────────────────────────────────────────────────
void _executeCommand(const char* cmd);

// ── Actuator control task ─────────────────────────────────────────────────────
// Receives commands from cmdQueue and drives hardware.

void taskActuatorCtrl(void* pvParameters) {
    (void)pvParameters;

    // Init servos
    servoPan.attach(SERVO_PAN_PIN);
    servoTilt.attach(SERVO_TILT_PIN);
    servoPan.write(SERVO_PAN_CENTER);
    servoTilt.write(SERVO_TILT_CENTER);

    // Init OLED
    bool oledOk = oled.begin(SSD1306_SWITCHCAPVCC, SSD1306_ADDR);
    if (oledOk) {
        oled.clearDisplay();
        oled.setTextSize(1);
        oled.setTextColor(SSD1306_WHITE);
        oled.setCursor(0, 0);
        oled.println("PHANTOM OS");
        oled.println("Initializing...");
        oled.display();
    }

    // Init Haptic
    pinMode(HAPTIC_PIN, OUTPUT);
    digitalWrite(HAPTIC_PIN, LOW);

    // Init Buzzer
    pinMode(BUZZER_PIN, OUTPUT);
    digitalWrite(BUZZER_PIN, LOW);

    // Init RGB LEDs (status LED only — full WS2812B in Phase 08)
    pinMode(STATUS_LED_PIN, OUTPUT);

    char cmdBuf[512];

    for (;;) {
        if (xQueueReceive(cmdQueue, cmdBuf, pdMS_TO_TICKS(100)) == pdTRUE) {
            _executeCommand(cmdBuf);
        }
        vTaskDelay(pdMS_TO_TICKS(5));
    }
}

// ── Command executors ─────────────────────────────────────────────────────────

static void _execServo(int panDelta, int tiltDelta) {
    panAngle  = constrain(panAngle  + panDelta,  SERVO_PAN_MIN,  SERVO_PAN_MAX);
    tiltAngle = constrain(tiltAngle + tiltDelta, SERVO_TILT_MIN, SERVO_TILT_MAX);
    servoPan.write(panAngle);
    servoTilt.write(tiltAngle);
}

static void _execHaptic(const char* pattern, int durationMs) {
    if (strcmp(pattern, "single") == 0) {
        digitalWrite(HAPTIC_PIN, HIGH);
        vTaskDelay(pdMS_TO_TICKS(durationMs));
        digitalWrite(HAPTIC_PIN, LOW);
    } else if (strcmp(pattern, "double") == 0) {
        digitalWrite(HAPTIC_PIN, HIGH);
        vTaskDelay(pdMS_TO_TICKS(durationMs / 2));
        digitalWrite(HAPTIC_PIN, LOW);
        vTaskDelay(pdMS_TO_TICKS(80));
        digitalWrite(HAPTIC_PIN, HIGH);
        vTaskDelay(pdMS_TO_TICKS(durationMs / 2));
        digitalWrite(HAPTIC_PIN, LOW);
    } else if (strcmp(pattern, "long") == 0) {
        digitalWrite(HAPTIC_PIN, HIGH);
        vTaskDelay(pdMS_TO_TICKS(durationMs));
        digitalWrite(HAPTIC_PIN, LOW);
    } else if (strcmp(pattern, "sos") == 0) {
        // S: 3 short
        for (int i = 0; i < 3; i++) {
            digitalWrite(HAPTIC_PIN, HIGH);
            vTaskDelay(pdMS_TO_TICKS(150));
            digitalWrite(HAPTIC_PIN, LOW);
            vTaskDelay(pdMS_TO_TICKS(100));
        }
        vTaskDelay(pdMS_TO_TICKS(300));
        // O: 3 long
        for (int i = 0; i < 3; i++) {
            digitalWrite(HAPTIC_PIN, HIGH);
            vTaskDelay(pdMS_TO_TICKS(400));
            digitalWrite(HAPTIC_PIN, LOW);
            vTaskDelay(pdMS_TO_TICKS(100));
        }
        vTaskDelay(pdMS_TO_TICKS(300));
        // S: 3 short
        for (int i = 0; i < 3; i++) {
            digitalWrite(HAPTIC_PIN, HIGH);
            vTaskDelay(pdMS_TO_TICKS(150));
            digitalWrite(HAPTIC_PIN, LOW);
            vTaskDelay(pdMS_TO_TICKS(100));
        }
    }
}

static void _execOled(const char* json) {
    StaticJsonDocument<256> doc;
    if (deserializeJson(doc, json) != DeserializationError::Ok) return;

    const char* mode = doc[CMD_OLED_MODE] | "clear";
    oled.clearDisplay();
    oled.setCursor(0, 0);
    oled.setTextSize(1);

    if (strcmp(mode, "clear") == 0) {
        // Already cleared
    } else if (strcmp(mode, "text") == 0 || strcmp(mode, "status") == 0) {
        JsonArray lines = doc[CMD_OLED_LINES];
        for (const char* line : lines) {
            oled.println(line);
        }
    } else if (strcmp(mode, "menu") == 0) {
        int idx = doc[CMD_OLED_IDX] | 0;
        JsonArray lines = doc[CMD_OLED_LINES];
        int row = 0;
        for (const char* line : lines) {
            if (row == idx) {
                oled.print("> ");
            } else {
                oled.print("  ");
            }
            oled.println(line);
            row++;
        }
    } else if (strcmp(mode, "animation") == 0) {
        const char* animId = doc[CMD_OLED_ANIM] | "";
        if (strcmp(animId, "breathing") == 0) {
            // Simple breathing animation — concentric circles
            oled.drawCircle(64, 32, 10, SSD1306_WHITE);
            oled.drawCircle(64, 32, 20, SSD1306_WHITE);
        }
    }
    oled.display();
}

static void _execBuzzer(int freqHz, int durationMs) {
    if (freqHz == 0) {
        noTone(BUZZER_PIN);
        return;
    }
    tone(BUZZER_PIN, freqHz, durationMs);
}

static void _execRgb(const char* json) {
    // Full WS2812B NeoPixel control in Phase 08
    // Basic status LED toggle for now
    StaticJsonDocument<128> doc;
    if (deserializeJson(doc, json) != DeserializationError::Ok) return;
    const char* mode = doc[CMD_RGB_MODE] | "off";
    digitalWrite(STATUS_LED_PIN, strcmp(mode, "off") != 0 ? HIGH : LOW);
}

// ── Main dispatcher ───────────────────────────────────────────────────────────

void _executeCommand(const char* cmd) {
    // Try to parse as JSON first
    if (cmd[0] == '{') {
        StaticJsonDocument<512> doc;
        if (deserializeJson(doc, cmd) != DeserializationError::Ok) return;
        const char* type = doc[PROTO_TYPE] | "";

        if (strcmp(type, CMD_TYPE_OLED) == 0) {
            _execOled(cmd);
        } else if (strcmp(type, CMD_TYPE_RGB) == 0) {
            _execRgb(cmd);
        }
        return;
    }

    // Space-delimited simple commands from json_protocol.cpp
    char buf[512];
    strncpy(buf, cmd, sizeof(buf) - 1);
    char* type = strtok(buf, " ");
    if (!type) return;

    if (strcmp(type, CMD_TYPE_SERVO) == 0) {
        const char* pan_s  = strtok(NULL, " ");
        const char* tilt_s = strtok(NULL, " ");
        int pan  = atoi(pan_s  ? pan_s  : "0");
        int tilt = atoi(tilt_s ? tilt_s : "0");
        _execServo(pan, tilt);
    } else if (strcmp(type, CMD_TYPE_HAPTIC) == 0) {
        const char* pat  = strtok(NULL, " ");
        const char* ms_s = strtok(NULL, " ");
        if (!pat) pat = "single";
        int ms = ms_s ? atoi(ms_s) : 200;
        _execHaptic(pat, ms);
    } else if (strcmp(type, CMD_TYPE_BUZZ) == 0) {
        const char* freq_s = strtok(NULL, " ");
        const char* ms_s   = strtok(NULL, " ");
        int freq = freq_s ? atoi(freq_s) : 1000;
        int ms   = ms_s   ? atoi(ms_s)   : 200;
        _execBuzzer(freq, ms);
    }
}
