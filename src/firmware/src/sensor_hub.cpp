#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/queue.h>
#include <Wire.h>
#include <SPI.h>
#include <TinyGPS++.h>
#include <MFRC522.h>
#include <Adafruit_BMP085.h>

#include "config.h"
#include "pins.h"
#include "protocol.h"

// External queue declarations (defined in main.cpp)
extern QueueHandle_t sensorDataQueue;
extern QueueHandle_t wifiScanQueue;

// ── LD2410 Radar (UART1) ──────────────────────────────────────────────────────
static HardwareSerial radarSerial(RADAR_UART_NUM);

struct RadarReading {
    bool    present;
    uint8_t motionEnergy;
    uint8_t staticEnergy;
    uint16_t distanceCm;
    float   breathBpm;
    bool    breathValid;
};

// ── GPS GP-02 (UART2) ─────────────────────────────────────────────────────────
static HardwareSerial gpsSerial(GPS_UART_NUM);
static TinyGPSPlus gps;

struct GpsReading {
    float   lat;
    float   lon;
    bool    fix;
    uint8_t satellites;
    float   speedKmh;
    float   altitudeM;
    float   hdop;
};

// ── RFID RC522 ────────────────────────────────────────────────────────────────
static MFRC522 rfidReader(RFID_SS_PIN, RFID_RST_PIN);

// ── Environment (BMP180 + AQI ADC) ───────────────────────────────────────────
static Adafruit_BMP085 bmp;
static bool bmpOk = false;

struct RfidReading {
    char    uid[18];   // hex string e.g. "AB:CD:EF:01"
    bool    present;
    bool    newRead;
};

// ── Encoder state ─────────────────────────────────────────────────────────────
static portMUX_TYPE encoderMux = portMUX_INITIALIZER_UNLOCKED;
static volatile int32_t encoderPosition = 0;
static volatile int32_t encoderDelta    = 0;
static volatile bool    encoderButton   = false;
static volatile uint32_t buttonPressMs  = 0;

// ── Sensor readings ───────────────────────────────────────────────────────────
static RadarReading radarData = {};
static GpsReading   gpsData   = {};
static RfidReading  rfidData  = {};

// ── Local state ───────────────────────────────────────────────────────────────
static uint32_t lastBatchMs              = 0;
static uint32_t lastEnvMs               = 0;
static float    envTemp                 = 0.0f;
static float    envPressure             = 1013.25f;
static int      envAqi                  = 0;
static uint32_t sensor_env_read_interval_ms = 5000;  // 5s default

// ── Batch buffer ──────────────────────────────────────────────────────────────
static char batchBuf[2048];

// ── LD2410 binary frame parser state ─────────────────────────────────────────
static const uint8_t LD2410_HEADER[4] = {0xFD, 0xFC, 0xFB, 0xFA};
static const uint8_t LD2410_TAIL[4]   = {0x04, 0x03, 0x02, 0x01};

enum RadarParseState {
    RADAR_WAIT_HEADER,
    RADAR_READ_LEN,
    RADAR_READ_DATA,
    RADAR_WAIT_TAIL
};
static RadarParseState radarParseState = RADAR_WAIT_HEADER;
static uint8_t  radarHeaderIdx = 0;
static uint8_t  radarLenIdx    = 0;
static uint16_t radarDataLen   = 0;
static uint16_t radarDataIdx   = 0;
static uint8_t  radarFrameBuf[64];
static uint8_t  radarTailIdx   = 0;

// ── Forward declarations ──────────────────────────────────────────────────────
static void readRadar();
static void readGps();
static void readEnv();
static void readRfid();
static void readEncoder();
static void buildBatch(char* buf, size_t bufLen, const char* wifiJson);
static void _parseRadarFrame(const uint8_t* data, uint16_t len);

// ── Encoder interrupt handlers ────────────────────────────────────────────────
static void IRAM_ATTR encoderCLKISR() {
    portENTER_CRITICAL_ISR(&encoderMux);
    bool clk = digitalRead(ENCODER_CLK_PIN);
    bool dt  = digitalRead(ENCODER_DT_PIN);
    if (clk == dt) {
        encoderPosition++;
        encoderDelta++;
    } else {
        encoderPosition--;
        encoderDelta--;
    }
    portEXIT_CRITICAL_ISR(&encoderMux);
}

static void IRAM_ATTR encoderBtnISR() {
    portENTER_CRITICAL_ISR(&encoderMux);
    bool pressed = !digitalRead(ENCODER_SW_PIN);
    encoderButton = pressed;
    if (pressed) {
        buttonPressMs = millis();
    }
    portEXIT_CRITICAL_ISR(&encoderMux);
}

// ── Task entry point ──────────────────────────────────────────────────────────
void taskSensorHub(void* pvParameters) {
    (void)pvParameters;

    // Init I2C
    Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN, I2C_FREQ_HZ);

    // Init BMP180
    bmpOk = bmp.begin();

    // Init Radar UART
    radarSerial.begin(RADAR_UART_BAUD, SERIAL_8N1, RADAR_RX_PIN, RADAR_TX_PIN);

    // Init GPS UART
    gpsSerial.begin(GPS_UART_BAUD, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);

    // Init RFID SPI
    SPI.begin(RFID_SCK_PIN, RFID_MISO_PIN, RFID_MOSI_PIN, RFID_SS_PIN);
    rfidReader.PCD_Init();

    // Init Encoder
    pinMode(ENCODER_CLK_PIN, INPUT_PULLUP);
    pinMode(ENCODER_DT_PIN,  INPUT_PULLUP);
    pinMode(ENCODER_SW_PIN,  INPUT_PULLUP);
    attachInterrupt(digitalPinToInterrupt(ENCODER_CLK_PIN), encoderCLKISR, CHANGE);
    attachInterrupt(digitalPinToInterrupt(ENCODER_SW_PIN),  encoderBtnISR, CHANGE);

    // Init RGB button inputs
    pinMode(RGB_BTN_0_PIN, INPUT_PULLUP);
    pinMode(RGB_BTN_1_PIN, INPUT_PULLUP);
    pinMode(RGB_BTN_2_PIN, INPUT_PULLUP);

    // Init AQI ADC
    pinMode(AQI_ADC_PIN, INPUT);

    for (;;) {
        uint32_t now = millis();

        // Read sensors
        readRadar();
        readGps();

        if (now - lastEnvMs >= sensor_env_read_interval_ms) {
            lastEnvMs = now;
            readEnv();
        }

        readRfid();
        readEncoder();

        // Try to get latest wifi scan from queue (non-blocking)
        char wifiJson[1024] = "null";
        char wifiBuf[1024];
        if (xQueueReceive(wifiScanQueue, wifiBuf, 0) == pdTRUE) {
            strncpy(wifiJson, wifiBuf, sizeof(wifiJson) - 1);
            wifiJson[sizeof(wifiJson) - 1] = '\0';
        }

        // Build and enqueue batch every BATCH_INTERVAL_MS
        if (now - lastBatchMs >= BATCH_INTERVAL_MS) {
            lastBatchMs = now;
            buildBatch(batchBuf, sizeof(batchBuf), wifiJson);
            xQueueSend(sensorDataQueue, batchBuf, 0);
        }

        vTaskDelay(pdMS_TO_TICKS(10));
    }
}

// ── LD2410 frame parser ───────────────────────────────────────────────────────

static void _parseRadarFrame(const uint8_t* data, uint16_t len) {
    // LD2410 basic (0x0202) / engineering (0x0201) report frame.
    // Layout after header+length:
    //   [0..1]  command word
    //   [2]     target state (0=none,1=motion,2=static,3=both)
    //   [3..4]  motion target distance LE (cm)
    //   [5]     motion target energy
    //   [6..7]  static target distance LE (cm)
    //   [8]     static target energy
    //   [9..10] detection distance LE (cm)
    //   [11]    breath value (engineering mode only, signed × 0.5 BPM)
    if (len < 11) return;

    uint16_t cmdWord = (uint16_t)data[0] | ((uint16_t)data[1] << 8);
    if (cmdWord != 0x0201 && cmdWord != 0x0202) return;

    uint8_t  targetState = data[2];
    uint8_t  movEnergy   = data[5];
    uint8_t  statEnergy  = data[8];
    uint16_t detDist     = (uint16_t)data[9] | ((uint16_t)data[10] << 8);

    radarData.present      = (targetState != 0x00);
    radarData.motionEnergy = movEnergy;
    radarData.staticEnergy = statEnergy;
    radarData.distanceCm   = (uint16_t)constrain((int)detDist, 0, RADAR_MAX_DIST_CM);

    if (cmdWord == 0x0201 && len >= 12) {
        int8_t breathRaw = (int8_t)data[11];
        if (breathRaw != 0) {
            radarData.breathBpm   = breathRaw * 0.5f;
            radarData.breathValid = (radarData.breathBpm >= 6.0f && radarData.breathBpm <= 60.0f);
        } else {
            radarData.breathBpm   = 0.0f;
            radarData.breathValid = false;
        }
    } else {
        radarData.breathBpm   = 0.0f;
        radarData.breathValid = false;
    }
}

static void readRadar() {
    while (radarSerial.available()) {
        uint8_t b = (uint8_t)radarSerial.read();
        switch (radarParseState) {
            case RADAR_WAIT_HEADER:
                if (b == LD2410_HEADER[radarHeaderIdx]) {
                    radarHeaderIdx++;
                    if (radarHeaderIdx == 4) {
                        radarHeaderIdx  = 0;
                        radarLenIdx     = 0;
                        radarDataLen    = 0;
                        radarDataIdx    = 0;
                        radarParseState = RADAR_READ_LEN;
                    }
                } else {
                    radarHeaderIdx = 0;
                }
                break;

            case RADAR_READ_LEN:
                if (radarLenIdx == 0) {
                    radarDataLen = b;
                } else {
                    radarDataLen |= (uint16_t)b << 8;
                    if (radarDataLen == 0 || radarDataLen > (uint16_t)sizeof(radarFrameBuf)) {
                        radarParseState = RADAR_WAIT_HEADER;
                        radarHeaderIdx  = 0;
                    } else {
                        radarDataIdx    = 0;
                        radarParseState = RADAR_READ_DATA;
                    }
                }
                radarLenIdx++;
                break;

            case RADAR_READ_DATA:
                radarFrameBuf[radarDataIdx++] = b;
                if (radarDataIdx >= radarDataLen) {
                    radarTailIdx    = 0;
                    radarParseState = RADAR_WAIT_TAIL;
                }
                break;

            case RADAR_WAIT_TAIL:
                if (b == LD2410_TAIL[radarTailIdx]) {
                    radarTailIdx++;
                    if (radarTailIdx == 4) {
                        _parseRadarFrame(radarFrameBuf, radarDataLen);
                        radarParseState = RADAR_WAIT_HEADER;
                        radarHeaderIdx  = 0;
                    }
                } else {
                    radarParseState = RADAR_WAIT_HEADER;
                    radarHeaderIdx  = 0;
                }
                break;
        }
    }
}

// ── GPS reader (TinyGPS++) ────────────────────────────────────────────────────

static void readGps() {
    while (gpsSerial.available()) {
        gps.encode((char)gpsSerial.read());
    }
    if (gps.location.isValid()) {
        gpsData.lat = (float)gps.location.lat();
        gpsData.lon = (float)gps.location.lng();
    }
    gpsData.fix = gps.location.isValid() && gps.location.age() < 2000;
    if (gps.satellites.isValid()) {
        gpsData.satellites = (uint8_t)gps.satellites.value();
    }
    if (gps.speed.isValid()) {
        gpsData.speedKmh = (float)gps.speed.kmph();
    }
    if (gps.altitude.isValid()) {
        gpsData.altitudeM = (float)gps.altitude.meters();
    }
    if (gps.hdop.isValid()) {
        gpsData.hdop = (float)gps.hdop.hdop();
    }
}

// ── Environment reader (BMP180 + AQI ADC) ────────────────────────────────────

static void readEnv() {
    if (bmpOk) {
        envTemp     = bmp.readTemperature();
        envPressure = bmp.readPressure() / 100.0f;  // Pa → hPa
    }

    // AQI via ADC — average AQI_ADC_SAMPLES readings
    uint32_t adcSum = 0;
    for (int i = 0; i < AQI_ADC_SAMPLES; i++) {
        adcSum += (uint32_t)analogRead(AQI_ADC_PIN);
    }
    float mv = ((float)(adcSum / AQI_ADC_SAMPLES) / 4095.0f) * 3300.0f;
    mv = constrain(mv, (float)AQI_ADC_MV_MIN, (float)AQI_ADC_MV_MAX);
    envAqi = (int)(((mv - (float)AQI_ADC_MV_MIN) / (float)(AQI_ADC_MV_MAX - AQI_ADC_MV_MIN)) * 500.0f);
    envAqi = constrain(envAqi, 0, 500);
}

// ── RFID reader (MFRC522) ─────────────────────────────────────────────────────

static void readRfid() {
    rfidData.newRead = false;
    rfidData.present = rfidReader.PICC_IsNewCardPresent();
    if (!rfidData.present) return;
    if (!rfidReader.PICC_ReadCardSerial()) {
        rfidData.present = false;
        return;
    }
    rfidData.newRead = true;
    // Format UID as colon-separated uppercase hex
    int offset = 0;
    for (uint8_t i = 0; i < rfidReader.uid.size && offset < (int)sizeof(rfidData.uid) - 3; i++) {
        offset += snprintf(rfidData.uid + offset, sizeof(rfidData.uid) - (size_t)offset,
                           i > 0 ? ":%02X" : "%02X", rfidReader.uid.uidByte[i]);
    }
    rfidReader.PICC_HaltA();
    rfidReader.PCD_StopCrypto1();
}

// ── Encoder reader ────────────────────────────────────────────────────────────

static void readEncoder() {
    // Position, delta, and button state are updated atomically by ISR.
    // Long press is computed in buildBatch from buttonPressMs.
    (void)0;
}

// ── Batch builder ─────────────────────────────────────────────────────────────

static void buildBatch(char* buf, size_t bufLen, const char* wifiJson) {
    uint32_t now = millis();

    // Read RGB button states
    bool btn0 = !digitalRead(RGB_BTN_0_PIN);
    bool btn1 = !digitalRead(RGB_BTN_1_PIN);
    bool btn2 = !digitalRead(RGB_BTN_2_PIN);

    bool btnLong = encoderButton && (now - buttonPressMs) > ENCODER_LONG_PRESS_MS;

    // Atomically read and reset encoderDelta
    portENTER_CRITICAL(&encoderMux);
    int32_t delta = encoderDelta;
    encoderDelta  = 0;
    portEXIT_CRITICAL(&encoderMux);

    int32_t pos = encoderPosition;  // volatile read; adequate for logging

    // Format optional fields
    char breathBuf[16];
    if (radarData.breathValid) {
        snprintf(breathBuf, sizeof(breathBuf), "%.1f", radarData.breathBpm);
    } else {
        strncpy(breathBuf, "null", sizeof(breathBuf));
    }

    char rfidUidBuf[24];
    if (rfidData.present && rfidData.uid[0] != '\0') {
        snprintf(rfidUidBuf, sizeof(rfidUidBuf), "\"%s\"", rfidData.uid);
    } else {
        strncpy(rfidUidBuf, "null", sizeof(rfidUidBuf));
    }

    int written = snprintf(buf, bufLen,
        "{"
        "\"" PROTO_VERSION "\":%d,"
        "\"" PROTO_TIMESTAMP "\":%lu,"
        "\"" PROTO_TYPE "\":\"" TYPE_SENSOR_BATCH "\","
        "\"" KEY_RADAR "\":{"
            "\"" KEY_RADAR_PRESENT "\":%s,"
            "\"" KEY_RADAR_MOTION_E "\":%d,"
            "\"" KEY_RADAR_STATIC_E "\":%d,"
            "\"" KEY_RADAR_DIST "\":%d,"
            "\"" KEY_RADAR_BREATH "\":%s"
        "},"
        "\"" KEY_GPS "\":{"
            "\"" KEY_GPS_LAT "\":%.6f,"
            "\"" KEY_GPS_LON "\":%.6f,"
            "\"" KEY_GPS_FIX "\":%s,"
            "\"" KEY_GPS_SATS "\":%d,"
            "\"" KEY_GPS_SPEED "\":%.2f,"
            "\"" KEY_GPS_ALT "\":%.1f,"
            "\"" KEY_GPS_HDOP "\":%.2f"
        "},"
        "\"" KEY_ENV "\":{"
            "\"" KEY_ENV_TEMP "\":%.1f,"
            "\"" KEY_ENV_PRESS "\":%.1f,"
            "\"" KEY_ENV_AQI "\":%d"
        "},"
        "\"" KEY_RFID "\":{"
            "\"" KEY_RFID_UID "\":%s,"
            "\"" KEY_RFID_NEW "\":%s"
        "},"
        "\"" KEY_ENC "\":{"
            "\"" KEY_ENC_POS "\":%ld,"
            "\"" KEY_ENC_DELTA "\":%ld,"
            "\"" KEY_ENC_BTN "\":%s,"
            "\"" KEY_ENC_LONG "\":%s"
        "},"
        "\"" KEY_BTNS "\":[%s,%s,%s],"
        "\"" KEY_WIFI "\":%s"
        "}\n",
        PROTOCOL_VERSION,
        (unsigned long)now,
        radarData.present ? "true" : "false",
        radarData.motionEnergy,
        radarData.staticEnergy,
        radarData.distanceCm,
        breathBuf,
        gpsData.lat, gpsData.lon,
        gpsData.fix ? "true" : "false",
        gpsData.satellites,
        gpsData.speedKmh,
        gpsData.altitudeM,
        gpsData.hdop,
        envTemp, envPressure, envAqi,
        rfidUidBuf,
        rfidData.newRead ? "true" : "false",
        (long)pos, (long)delta,
        encoderButton ? "true" : "false",
        btnLong ? "true" : "false",
        btn0 ? "true" : "false",
        btn1 ? "true" : "false",
        btn2 ? "true" : "false",
        wifiJson
    );

    if (written <= 0 || (size_t)written >= bufLen) {
        // Buffer overflow — send minimal heartbeat-style batch
        snprintf(buf, bufLen,
            "{\"" PROTO_VERSION "\":%d,\"" PROTO_TIMESTAMP "\":%lu,"
            "\"" PROTO_TYPE "\":\"" TYPE_SENSOR_BATCH "\"}\n",
            PROTOCOL_VERSION, (unsigned long)now);
    }
}
