#include <Arduino.h>
#include <WiFi.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/queue.h>

#include "config.h"
#include "protocol.h"

// External queue (defined in main.cpp)
extern QueueHandle_t wifiScanQueue;

// Runtime-configurable (updated via CFG command)
static uint32_t scanIntervalMs = (uint32_t)WIFI_SCAN_INTERVAL_MS;
static bool scanEnabled = true;

// ── WiFi Scanner Task ─────────────────────────────────────────────────────────
// Passive scan every scanIntervalMs.
// Results serialized to JSON and posted to wifiScanQueue.
// sensor_hub.cpp picks up the latest scan result and includes it in batch.

void taskWifiScanner(void* pvParameters) {
    (void)pvParameters;

    // Set WiFi to station mode, no connection — scan only
    WiFi.mode(WIFI_STA);
    WiFi.disconnect();
    vTaskDelay(pdMS_TO_TICKS(100));

    static char scanJson[4096];

    for (;;) {
        if (!scanEnabled) {
            vTaskDelay(pdMS_TO_TICKS(1000));
            continue;
        }

        // Perform passive scan (non-blocking start)
        int n = WiFi.scanNetworks(false, true, false, 200);  // passive, show hidden, all channels, 200ms per ch

        if (n > 0) {
            int written = 0;
            scanJson[0] = '[';
            written = 1;
            int count = min(n, (int)WIFI_SCAN_MAX_NETS);

            for (int i = 0; i < count; i++) {
                // Get MAC as string
                uint8_t* bssid = WiFi.BSSID(i);
                char mac[18];
                snprintf(mac, sizeof(mac), "%02X:%02X:%02X:%02X:%02X:%02X",
                    bssid[0], bssid[1], bssid[2], bssid[3], bssid[4], bssid[5]);

                // Escape SSID
                String ssid = WiFi.SSID(i);
                ssid.replace("\"", "\\\"");

                int chunk = snprintf(
                    scanJson + written,
                    sizeof(scanJson) - written,
                    "%s{"
                    "\"" KEY_WIFI_MAC "\":\"%s\","
                    "\"" KEY_WIFI_SSID "\":\"%s\","
                    "\"" KEY_WIFI_RSSI "\":%d,"
                    "\"" KEY_WIFI_ENC "\":%d,"
                    "\"" KEY_WIFI_CH "\":%d"
                    "}",
                    i > 0 ? "," : "",
                    mac,
                    ssid.c_str(),
                    WiFi.RSSI(i),
                    (int)WiFi.encryptionType(i),
                    WiFi.channel(i)
                );

                if (chunk <= 0 || written + chunk >= (int)sizeof(scanJson) - 2) {
                    break;
                }
                written += chunk;
            }

            scanJson[written++] = ']';
            scanJson[written] = '\0';

            WiFi.scanDelete();

            // Post to queue (overwrite old result if not consumed)
            xQueueOverwrite(wifiScanQueue, scanJson);
        } else {
            WiFi.scanDelete();
        }

        vTaskDelay(pdMS_TO_TICKS(scanIntervalMs));
    }
}
