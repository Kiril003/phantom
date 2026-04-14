#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/queue.h>
#include <ArduinoJson.h>

#include "config.h"
#include "pins.h"
#include "protocol.h"

// External queues (defined in main.cpp)
extern QueueHandle_t sensorDataQueue;
extern QueueHandle_t cmdQueue;

// Runtime-configurable intervals (updated via CFG commands)
static uint32_t batchIntervalMs   = BATCH_INTERVAL_MS;
static uint32_t wifiScanIntervalMs = WIFI_SCAN_INTERVAL_MS;
static uint8_t  radarSensitivity   = RADAR_SENSITIVITY;

// ── Forward declarations ──────────────────────────────────────────────────────
void _processCommand(const char* json);

// ── JSON TX Task ──────────────────────────────────────────────────────────────
// Reads batches from sensorDataQueue and sends them over Serial (USB to Radxa).
// Also sends periodic heartbeat.

void taskJsonTx(void* pvParameters) {
    (void)pvParameters;
    char batch[2048];
    TickType_t lastHeartbeat = xTaskGetTickCount();

    for (;;) {
        TickType_t now = xTaskGetTickCount();

        // Send heartbeat every HEARTBEAT_INTERVAL_MS
        if ((now - lastHeartbeat) >= pdMS_TO_TICKS(HEARTBEAT_INTERVAL_MS)) {
            lastHeartbeat = now;
            char hb[128];
            snprintf(hb, sizeof(hb),
                "{\"" PROTO_VERSION "\":%d,"
                "\"" PROTO_TIMESTAMP "\":%lu,"
                "\"" PROTO_TYPE "\":\"" TYPE_HEARTBEAT "\","
                "\"" KEY_UPTIME_MS "\":%lu,"
                "\"" KEY_FREE_HEAP "\":%lu,"
                "\"" KEY_WIFI_RSSI_HB "\":%d}\n",
                PROTOCOL_VERSION,
                (unsigned long)millis(),
                (unsigned long)millis(),
                (unsigned long)ESP.getFreeHeap(),
                WiFi.RSSI()
            );
            Serial.print(hb);
        }

        // Dequeue and send sensor batch (non-blocking)
        if (xQueueReceive(sensorDataQueue, batch, 0) == pdTRUE) {
            Serial.print(batch);
        }

        vTaskDelay(pdMS_TO_TICKS(5));
    }
}

// ── Command RX Task ───────────────────────────────────────────────────────────
// Reads JSON commands from Serial, parses, dispatches via cmdQueue.

void taskCmdRx(void* pvParameters) {
    (void)pvParameters;
    static char lineBuf[512];
    static uint16_t linePos = 0;

    for (;;) {
        while (Serial.available()) {
            char c = Serial.read();
            if (c == '\n' || c == '\r') {
                if (linePos > 0) {
                    lineBuf[linePos] = '\0';
                    _processCommand(lineBuf);
                    linePos = 0;
                }
            } else if (linePos < sizeof(lineBuf) - 1) {
                lineBuf[linePos++] = c;
            }
        }
        vTaskDelay(pdMS_TO_TICKS(5));
    }
}

// ── Command dispatcher ────────────────────────────────────────────────────────

void _processCommand(const char* json) {
    // Use ArduinoJson to parse
    StaticJsonDocument<512> doc;
    DeserializationError err = deserializeJson(doc, json);
    if (err) {
        return;  // malformed command — ignore silently
    }

    const char* type = doc[PROTO_TYPE] | "";

    if (strcmp(type, CMD_TYPE_SERVO) == 0) {
        int pan  = doc[CMD_SERVO_PAN]  | 0;
        int tilt = doc[CMD_SERVO_TILT] | 0;
        // Post to cmdQueue for actuator_ctrl task
        char cmd[64];
        snprintf(cmd, sizeof(cmd), "%s %d %d", CMD_TYPE_SERVO, pan, tilt);
        xQueueSend(cmdQueue, cmd, 0);

    } else if (strcmp(type, CMD_TYPE_HAPTIC) == 0) {
        const char* pat = doc[CMD_HAPTIC_PAT] | "single";
        int ms = doc[CMD_HAPTIC_MS] | HAPTIC_DEFAULT_MS;
        char cmd[64];
        snprintf(cmd, sizeof(cmd), "%s %s %d", CMD_TYPE_HAPTIC, pat, ms);
        xQueueSend(cmdQueue, cmd, 0);

    } else if (strcmp(type, CMD_TYPE_OLED) == 0) {
        // Serialize back and post full JSON to actuator_ctrl
        char cmd[256];
        snprintf(cmd, sizeof(cmd), "%s", json);
        xQueueSend(cmdQueue, cmd, 0);

    } else if (strcmp(type, CMD_TYPE_RGB) == 0) {
        char cmd[128];
        snprintf(cmd, sizeof(cmd), "%s", json);
        xQueueSend(cmdQueue, cmd, 0);

    } else if (strcmp(type, CMD_TYPE_BUZZ) == 0) {
        int freq = doc[CMD_BUZZ_FREQ] | BUZZER_DEFAULT_FREQ_HZ;
        int ms   = doc[CMD_BUZZ_MS]   | BUZZER_DEFAULT_MS;
        char cmd[64];
        snprintf(cmd, sizeof(cmd), "%s %d %d", CMD_TYPE_BUZZ, freq, ms);
        xQueueSend(cmdQueue, cmd, 0);

    } else if (strcmp(type, CMD_TYPE_CFG) == 0) {
        const char* key = doc[CMD_CFG_KEY] | "";
        // Apply runtime config changes
        if (strcmp(key, "batch_interval_ms") == 0) {
            batchIntervalMs = (uint32_t)(doc[CMD_CFG_VAL] | BATCH_INTERVAL_MS);
        } else if (strcmp(key, "wifi_scan_interval") == 0) {
            wifiScanIntervalMs = (uint32_t)(doc[CMD_CFG_VAL] | WIFI_SCAN_INTERVAL_MS) * 1000;
        } else if (strcmp(key, "radar_sensitivity") == 0) {
            radarSensitivity = (uint8_t)(doc[CMD_CFG_VAL] | RADAR_SENSITIVITY);
        }
    }
}

// ── Error reporter ────────────────────────────────────────────────────────────

void reportSensorError(const char* sensor, const char* msg, int code) {
    char err[256];
    snprintf(err, sizeof(err),
        "{\"" PROTO_VERSION "\":%d,"
        "\"" PROTO_TIMESTAMP "\":%lu,"
        "\"" PROTO_TYPE "\":\"" TYPE_ERROR "\","
        "\"" KEY_ERR_SENSOR "\":\"%s\","
        "\"" KEY_ERR_MSG "\":\"%s\","
        "\"" KEY_ERR_CODE "\":%d}\n",
        PROTOCOL_VERSION,
        (unsigned long)millis(),
        sensor, msg, code
    );
    Serial.print(err);
}
