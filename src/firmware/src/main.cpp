#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/queue.h>
#include <freertos/semphr.h>

#include "config.h"
#include "pins.h"
#include "protocol.h"

// ── FreeRTOS queues ───────────────────────────────────────────────────────────
QueueHandle_t sensorDataQueue;   // sensor_hub → json_tx (batch JSON strings)
QueueHandle_t cmdQueue;          // json_rx → actuator_ctrl (command strings)
QueueHandle_t wifiScanQueue;     // wifi_scanner → sensor_hub (latest scan JSON)

// ── Task declarations (implemented in respective .cpp files) ──────────────────
void taskSensorHub(void* pvParameters);
void taskJsonTx(void* pvParameters);
void taskCmdRx(void* pvParameters);
void taskWifiScanner(void* pvParameters);
void taskActuatorCtrl(void* pvParameters);

// ── Setup ─────────────────────────────────────────────────────────────────────
void setup() {
    // USB Serial to host (Radxa) at 921600 baud
    Serial.begin(SERIAL_BAUD);
    while (!Serial && millis() < 3000) {
        delay(10);
    }

    // Create inter-task queues
    // sensorDataQueue: holds up to 4 full batch JSON strings (2KB each)
    sensorDataQueue = xQueueCreate(4, 2048);
    // cmdQueue: holds up to 8 command strings (512 bytes each)
    cmdQueue = xQueueCreate(8, 512);
    // wifiScanQueue: holds 1 scan result (overwrite semantics via xQueueOverwrite)
    wifiScanQueue = xQueueCreate(1, 4096);

    configASSERT(sensorDataQueue != NULL);
    configASSERT(cmdQueue        != NULL);
    configASSERT(wifiScanQueue   != NULL);

    // ── Spawn FreeRTOS tasks ──────────────────────────────────────────────────

    // Sensor Hub — Core 1, high priority (deterministic timing)
    xTaskCreatePinnedToCore(
        taskSensorHub,
        "sensor_hub",
        STACK_SENSOR,
        NULL,
        TASK_PRIO_SENSOR,
        NULL,
        1
    );

    // Command RX — Core 1, highest priority (responsive to host commands)
    xTaskCreatePinnedToCore(
        taskCmdRx,
        "cmd_rx",
        STACK_CMD_RX,
        NULL,
        TASK_PRIO_CMD_RX,
        NULL,
        1
    );

    // Actuator Control — Core 1, medium priority
    xTaskCreatePinnedToCore(
        taskActuatorCtrl,
        "actuator_ctrl",
        STACK_SENSOR,  // reuse same stack size
        NULL,
        TASK_PRIO_SENSOR - 1,
        NULL,
        1
    );

    // JSON TX — Core 0, medium priority (serial I/O)
    xTaskCreatePinnedToCore(
        taskJsonTx,
        "json_tx",
        STACK_JSON_TX,
        NULL,
        TASK_PRIO_JSON_TX,
        NULL,
        0
    );

    // WiFi Scanner — Core 0, lowest priority (background scan)
    xTaskCreatePinnedToCore(
        taskWifiScanner,
        "wifi_scan",
        STACK_WIFI_SCAN,
        NULL,
        TASK_PRIO_WIFI_SCAN,
        NULL,
        0
    );
}

// ── Loop (idle — FreeRTOS task scheduler owns execution) ─────────────────────
void loop() {
    vTaskDelay(pdMS_TO_TICKS(10000));
}
