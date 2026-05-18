# Plan — PHANTOM Companion v2 (Ambitious native Android)

## Context

Оператор хоче амбітний нативний Android-застосунок другого покоління —
**не PWA, не remote-control, не чат-бот**, а повноцінне друге фізичне
втілення тієї самої сутності, що живе на Radxa. Мульти-профіль,
мульти-пристрій ekosystem, on-device LLM як офлайн-fallback, повна
сенсорика, камера як основний input-канал, двосторонній міст до
десктопа (телефон як ROOT-пульт + десктоп як ROOT-пульт телефона),
mesh телефон-телефон без host. Шість станів дзеркаляться. Onboarding
створює профіль, профілі можна додавати, кожен має ізольоване
шифрування. Не зрівняється зі звичними нейронками через персистентну
пам'ять, автономну дію, sensor-awareness, на-пристрої LLM.

**Виконання:** оператор зробить `/compact` після затвердження плану.
Майбутній Claude читає `docs/MOBILE_PHANTOM_AMBITIOUS.md` як єдине
джерело істини, потім стартує Phase 0.

## Recommended approach

**Канонічний документ існує:**
`phantom-os/docs/MOBILE_PHANTOM_AMBITIOUS.md` — 700-рядкова специфікація
з усіма фазами, технологіями, ризиками, ekosystem-логікою, security
shape, compact-survival protocol. Цей plan-файл — короткий
вказівник на нього.

**Загальна структура:**

* Multi-module Gradle composite build у `phantom-os/companion-android/`
  (буде перейменовано з `phantom-os/mobile/` у Phase 0).
* 16 модулів: `core-design`, `core-net`, `core-data`, `core-ai`,
  `core-voice`, `core-vision`, `core-context`, `core-bridge`,
  `core-sensor`, `feature-onboarding`, `feature-pulse`,
  `feature-voice`, `feature-map`, `feature-comms`, `feature-vault`,
  `feature-driver`, `feature-launcher`, `wear`, `app`.
* 9 фаз від Phase 0 (scaffold) до Phase 8 (Telecom):
  - Phase 0 — Discovery & Scaffold (~3 дні)
  - Phase 1 — Identity (~2 тижні): onboarding, multi-profile,
    PIN+biometric+NFC+voice-print
  - Phase 2 — First Body (~2 тижні): Pulse/Voice/Map/Comms/Vault
    functional, WS subscribe, sensor batch, PTT round-trip
  - Phase 3 — Senses (~3 тижні): camera, MediaPipe, OCR, AR, geofence,
    PPG HRV, wardriving
  - Phase 4 — Brain on Edge (~3 тижні): ONNX Runtime + Gemma 3n-E4B
    INT4 + whisper-tiny + StyleTTS2-UA, hybrid router cloud↔local
  - Phase 5 — Driver (~2 тижні): телефон як keyboard/trackpad/screen-
    mirror/file-drop/voice-mic для desktop через нові backend ручки
    `/api/v1/drive/*`
  - Phase 6 — Mesh & Wear (~3 тижні): Wear OS module, BLE LE Audio +
    WiFi-Direct phone-to-phone fallback, approve-on-phone Ed25519
  - Phase 7 — Hub Mode (~2 тижні): launcher replacement, AOD,
    QuickTile, Glance widget, Accessibility Service
  - Phase 8 — Telecom (~3 тижні, opt-in): TelecomManager + InCallService,
    SMS/RCS, spam screening, voicemail-as-AI

**Технологічний стек:** Kotlin 2.0.21, Compose BOM 2024.11, AGP 8.7.3,
Gradle 8.10.2 (вже встановлено на цьому Radxa-хості), Ktor 2.3.13,
SQLCipher 4.6, BouncyCastle 1.78, ONNX Runtime Mobile 1.20, MediaPipe
Tasks 0.10, ML Kit OCR/Barcode, CameraX 1.4, MapLibre Native Android,
ARCore, Filament 1.55 (Phase 5), Wear OS 18.

**Ekosystem поведінка:**
* Один профіль може бути зв'язаний з кількома Radxa-хостами (`pairedHosts[]`).
* Кілька профілів на одному пристрої — кожен ізольований SQLCipher-DB
  з ключем, виведеним з `Argon2id(PIN) ‖ biometric_secret` цього профілю.
* Active body migration: вийшов з кімнати з телефоном — desktop FOCUS
  → phone FOCUS без розриву діалогу (через `ContextEngine.active_body`).
* Mesh-без-host: phone A ↔ phone B через mDNS `_phantom._tcp` + WiFi-Direct
  коли Radxa мертвий, тимчасові `MeshKey` з 24h TTL.

**Вирішено НЕ робити:**
* iOS — Phase 9+, KMM. До цього лише Android.
* Custom ROM — ніколи. Стоковий Android, через Compose/Capacitor.
* Voice cloning довільних мовців (тільки самого ROOT через onboarding).
* Cross-tenant data sharing.
* Backdoor remote-wipe.

## Files

**Канонічна специфікація (читати першою у новій сесії):**
* `phantom-os/docs/MOBILE_PHANTOM_AMBITIOUS.md` — 20 секцій, 700 рядків

**Інші джерела (для контексту):**
* `phantom-os/docs/MOBILE_COMPANION.md` — Tier 1 backend pair flow
* `phantom-os/docs/MOBILE_COMPANION_DESIGN.md` — Compose UI brief
* `phantom-os/docs/VISUAL_SYSTEM.md` — sunrise palette + glass stack
* `phantom-os/CLAUDE.md` — правила кодування

**Існуючий код для перенесення/повторного використання:**
* `phantom-os/mobile/` (мій native Compose scaffold, Tier 1) →
  буде перейменовано на `phantom-os/companion-android/` у Phase 0
  через `git mv` для збереження історії
* `phantom-companion/` (legacy Capacitor PWA) → лишається живим як
  lite-target, не торкаємо окрім bugfixes
* `phantom-os/src/backend/security/pair_crypto.py` — байт-сумісний
  contract, який реалізує `PairCrypto.kt`
* `phantom-os/src/backend/api/routes_pair.py`,
  `routes_mobile_sensors.py`,
  `websocket_hub.py` — backend якому довіряємо

**Backend зміни (parallel track, окремі коміти):**
* `User.profiles[]` schema migration (Phase 1)
* `WSClient.profile_id` filter в `websocket_hub.py` (Phase 1)
* `ContextEngine.active_body` поле (Phase 2)
* Нові ручки `/api/v1/drive/{key,click,upload,move}` (Phase 5)
* `/api/v1/agent/sentinel_trigger` (Phase 3)
* `MeshNode` table + `/api/v1/mesh/*` (Phase 6, опц.)

## First action after `/compact`

Phase 0 виконавчий контракт (~3 дні):

1. `git checkout -b companion-v2-phase-0`
2. `git mv phantom-os/mobile phantom-os/companion-android` —
   зберегти git-історію існуючого native Compose скаффолда
3. Оновити `companion-android/settings.gradle.kts` додавши
   `include`-и для 15 нових модулів
4. У кожному з 15 модулів — порожній `build.gradle.kts` + порожній
   marker-файл `package local.phantom.companion.X; object Module`
5. Перевірити `./gradlew assembleDebug` — APK збирається
6. `git commit -m "companion-v2-phase-0 — composite build scaffold (16 modules)"`

Після Phase 0 — Phase 1 (Identity / multi-profile / onboarding).

## Verification

**Phase 0 acceptance criteria:**
* `JAVA_HOME=/usr/lib/jvm/java-17-openjdk-arm64 ANDROID_HOME=/home/radxa/android-sdk PATH=/home/radxa/gradle-8.10.2/bin:$PATH ./gradlew assembleDebug`
  з кореня `companion-android/` повертає exit 0
* APK файл присутній у
  `companion-android/app/build/outputs/apk/debug/app-debug.apk`
* `adb install -r app-debug.apk` стартує — splash screen видно
* `git log --oneline | head -1` показує коміт із префіксом
  `companion-v2-phase-0`

**End-to-end (після всіх 8 фаз):** §19 у канонічному документі —
10 пунктів Definition of Done, від "оператор ставить APK" до
"24 години foreground service з <8% battery drain".

**Перевірка крос-фазами:**
* Кожен `companion-v2-phase-N` коміт мусить компілятись окремо
* Tests: `vitest` (frontend) + `pytest` (backend) лишаються green
* Кожна фаза має у канонічному документі секцію "acceptance" — її
  пункти — checklist для merge у `autonomous-run`

## Notes

* Auto-mode active: оператор очікує, що після `/compact` я почну
  кодувати без додаткових clarification questions
* Таймлайн всього проєкту: 9 фаз × 1-3 тижні = ~5 місяців реальної
  розробки, але Phase 0+1+2 (mvp paired phone with multi-profile) —
  ~5 тижнів і вже корисно
* Дисковий простір: 2.6 GB Gemma INT4 модель у Phase 4 — попередити
  оператора перед download; default toggle OFF
* Battery: Phase 6+ потребує adaptive sensor sampling (motion=still
  → 1Hz, walking → 50Hz) інакше телефон вмирає за 4 год
* Backward compat: `phantom-companion/` PWA лишається живим, мінімальні
  bugfix-only коміти, нові фічі не йдуть туди
