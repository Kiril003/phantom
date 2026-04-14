#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/queue.h>
#include <freertos/semphr.h>

#include "config.h"
#include "pins.h"
#include "protocol.h"

// ── FreeRTOS queues ───────────────────────────────────────────────────────────
QueueHandle_t sensorDataQueue;   // sensor_hub → json_protocol
QueueHandle_t cmdQueue;          // json_protocol → actuator_ctrl
QueueHandle_t wifiScanQueue;     // wifi_scanner → json_protocol

// ── Task forward declarations ─────────────────────────────────────────────────
void taskSensorHub(void* pvParameters);
void taskJsonTx(void* pvParameters);
void taskCmdRx(void* pvParameters);
void taskWifiScanner(void* pvParameters);

// ── Setup ─────────────────────────────────────────────────────────────────────
void setup() {
    // USB Serial to host (Radxa)
    Serial.begin(SERIAL_BAUD);
    while (!Serial && millis() < 3000) {
        delay(10);
    }

    // Create inter-task queues
    sensorDataQueue = xQueueCreate(4, 512);   // 4 batches × 512 bytes
    cmdQueue        = xQueueCreate(8, 256);   // 8 commands × 256 bytes
    wifiScanQueue   = xQueueCreate(2, 4096);  // 2 scan results × 4KB

    // Spawn FreeRTOS tasks — pinned to cores for determinism
    xTaskCreatePinnedToCore(
        taskSensorHub,
        "sensor_hub",
        STACK_SENSOR,
        NULL,
        TASK_PRIO_SENSOR,
        NULL,
        1  // Core 1 — sensor reading
    );

    xTaskCreatePinnedToCore(
        taskCmdRx,
        "cmd_rx",
        STACK_CMD_RX,
        NULL,
        TASK_PRIO_CMD_RX,
        NULL,
        1  // Core 1 — high priority command receive
    );

    xTaskCreatePinnedToCore(
        taskJsonTx,
        "json_tx",
        STACK_JSON_TX,
        NULL,
        TASK_PRIO_JSON_TX,
        NULL,
        0  // Core 0 — serial TX
    );

    xTaskCreatePinnedToCore(
        taskWifiScanner,
        "wifi_scan",
        STACK_WIFI_SCAN,
        NULL,
        TASK_PRIO_WIFI_SCAN,
        NULL,
        0  // Core 0 — background scan
    );
}

// ── Loop (idle — FreeRTOS manages everything) ─────────────────────────────────
void loop() {
    vTaskDelay(pdMS_TO_TICKS(10000));
}

// ── Task: Sensor Hub ──────────────────────────────────────────────────────────
// Reads all sensors every BATCH_INTERVAL_MS and posts to sensorDataQueue.
// Implemented in sensor_hub.cpp
void taskSensorHub(void* pvParameters) {
    (void)pvParameters;
    // Full implementation in sensor_hub.cpp (Phase 01)
    for (;;) {
        vTaskDelay(pdMS_TO_TICKS(BATCH_INTERVAL_MS));
    }
}

// ── Task: JSON TX ─────────────────────────────────────────────────────────────
// Takes sensor batches from queue, serializes to JSON, sends over Serial.
// Also sends heartbeat every HEARTBEAT_INTERVAL_MS.
// Implemented in json_protocol.cpp
void taskJsonTx(void* pvParameters) {
    (void)pvParameters;
    TickType_t lastHeartbeat = xTaskGetTickCount();

    for (;;) {
        TickType_t now = xTaskGetTickCount();

        // Heartbeat
        if ((now - lastHeartbeat) >= pdMS_TO_TICKS(HEARTBEAT_INTERVAL_MS)) {
            lastHeartbeat = now;
            // Full implementation in json_protocol.cpp (Phase 01)
        }

        vTaskDelay(pdMS_TO_TICKS(10));
    }
}

// ── Task: Command RX ──────────────────────────────────────────────────────────
// Reads JSON commands from Serial, parses, dispatches to actuator_ctrl.
// Implemented in json_protocol.cpp + actuator_ctrl.cpp
void taskCmdRx(void* pvParameters) {
    (void)pvParameters;
    for (;;) {
        if (Serial.available()) {
            // Full implementation in json_protocol.cpp (Phase 01)
        }
        vTaskDelay(pdMS_TO_TICKS(5));
    }
}

// ── Task: WiFi Scanner ────────────────────────────────────────────────────────
// Passive WiFi scan every WIFI_SCAN_INTERVAL_MS.
// Results posted to wifiScanQueue for inclusion in next batch.
// Implemented in wifi_scanner.cpp
void taskWifiScanner(void* pvParameters) {
    (void)pvParameters;
    for (;;) {
        vTaskDelay(pdMS_TO_TICKS(WIFI_SCAN_INTERVAL_MS));
    }
}
