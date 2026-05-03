# PHANTOM Companion v2 — Ambitious Mobile Plan

> **Single source of truth для нативного Android-застосунку другого покоління.** Документ створено перед compaction; майбутній Claude читає його **першим** після старту нової сесії і вже з нього тягне всю необхідну архітектуру.
>
> **Парні документи (читати разом):**
> - `docs/MOBILE_COMPANION.md` — оригінальна Tier 1 архітектура (pair, WS subscribe, mobile_batch).
> - `docs/MOBILE_COMPANION_DESIGN.md` — Compose UI brief (PhantomTheme, glass stack, шість станів, p-tier шрифти).
> - `docs/VISUAL_SYSTEM.md` — sunrise-warm палітра, glass рівні, six states.
> - `docs/ARCHITECTURE.md`, `docs/STATE_MACHINE.md`, `docs/AI_INTEGRATION.md`, `docs/VOICE_PIPELINE.md`, `docs/SENSOR_PROTOCOL.md` — backend-сторона.
> - `CLAUDE.md` (project root) — правила кодування, заборона моків, no-TODO, 44dp touch targets.

---

## 0. Vision — одне речення

> PHANTOM Companion v2 — це **друге фізичне втілення тієї самої сутності**, що живе на Radxa, але з власним мозком на пристрої: офлайн-LLM, шість станів, повна сенсорика, можливість бути ROOT-ом для десктопа і навпаки, мульти-профіль і мульти-хост, з мережею телефонів-між-собою без сервера як аварійний шлях.

**Не чат-бот. Не remote-control. Не PWA в обгортці.** Повноцінна міні-OS, яка не зрівняється зі звичною ChatGPT-нейронкою через:
- персистентну пам'ять (5 шарів) між сесіями і пристроями;
- автономну дію (DecisionTree рішення без участі користувача);
- сенсорну обізнаність (50+ сигналів проти "лише текст" у GPT);
- крос-пристрій ekosystem (телефон, годинник, десктоп, мережа телефонів);
- on-device LLM як fallback коли мережа мертва.

---

## 1. Чому це потрібно (vs `phantom-companion/` PWA)

PWA впирається в стелю Web API:

| Що потрібно | PWA може? | Native може? |
|-------------|-----------|--------------|
| Постійний foreground service (24/7 WS) | ні (WebView засне у doze) | так |
| Notification Listener (Telegram/SMS/IM bridge) | ні | так |
| TelecomManager / InCallService (своє UI дзвінків) | ні | так |
| Accessibility Service (cross-app overlays) | ні | так |
| On-device LLM (Gemma 3n 4B INT4) | ні (немає GPU API) | так через ONNX Runtime |
| StrongBox Ed25519 ключі | ні | так |
| BLE central+peripheral, WiFi-Direct, NFC | обмежено | повний доступ |
| Filament 3D Familiar з PBR | ні | так |
| Камера з низькою затримкою (CameraX raw) | ні (тільки getUserMedia) | так |
| Lock-screen widget, AOD, Quick Settings tile | ні | так |
| Launcher replacement (homescreen) | ні | так |
| Wear OS bridge (DataLayer API) | ні | так |

**Висновок:** PWA лишається як **lite-варіант** для сторонніх (батьки, друзі), а v2 native — це флагман на твоїх власних пристроях.

---

## 2. Що ми будуємо (high-level)

Native Android (Kotlin + Compose) Companion, який:

1. **Дзеркалить шість станів** (SHADOW/FOCUS/DIALOGUE/SENTINEL/GHOST/DREAM) на телефоні з власним ContextEngine.
2. **Мульти-профіль identity system** з PIN + biometric + NFC + voice-print як 4-факторний unlock.
3. **Парується з phantom-os Radxa AND з іншими Companion-телефонами** (mesh).
4. **Запускає Gemma 3n-E4B / Phi-3 mini локально** через ONNX Runtime Mobile коли мережа недоступна.
5. **Стрімить sensor fusion** на phantom-os і **діє автономно** локально (DecisionTree v2) при offline.
6. **Camera vision tasks**: face tracking, hand-gesture, OCR, AR overlays, scene understanding.
7. **Повний remote-control десктопа**: input forwarding, screen mirroring, файли, голос, виклик будь-якого agent verb.
8. **Опційно — launcher replacement** на виділеному телефоні (homescreen + lock-screen + AOD).
9. **Wear OS module** — годинник як state-pill + haptic alerts.
10. **Mesh-без-host** як аварійний шлях: телефон A ↔ телефон B через BLE LE Audio + WiFi-Direct коли Radxa мертвий.

---

## 3. Архітектура — Gradle composite build

Multi-module проєкт у `phantom-os/companion-android/` (буде перейменовано з `mobile/` у Phase 0):

```
companion-android/
├── settings.gradle.kts              # composite build, 16 modules
├── build.gradle.kts
├── gradle.properties                # aapt2 override → Ubuntu aarch64 (вже працює)
├── gradle/libs.versions.toml
├── core-design/                     # PhantomTheme, glass, components, tokens, animations
├── core-net/                        # Ktor, WS link, pair crypto, cert pin, JWT refresh
├── core-data/                       # Room (non-secret) + SQLCipher Vault, profile store
├── core-ai/                         # ONNX provider, Gemma local, Gemini remote, hybrid router
├── core-voice/                      # whisper-tiny ONNX, StyleTTS2-UA ONNX, AudioRecord pipeline
├── core-vision/                     # MediaPipe Hands+FaceMesh, ML Kit OCR, ARCore overlay
├── core-context/                    # ContextEngine mirror, DecisionTree v2, StateMachine
├── core-bridge/                     # cross-device command bus (drive desktop / drive me)
├── core-sensor/                     # MobileSensorAdapter (GPS+IMU+mic_rms+BLE+WiFi+PPG)
├── feature-onboarding/              # 5-step profile creation, biometric, NFC enrol, voice train
├── feature-pulse/                   # SHADOW/FOCUS home screen
├── feature-voice/                   # DIALOGUE PTT screen
├── feature-map/                     # SENTINEL+wardriving+AR
├── feature-comms/                   # Calls/SMS/IM bridge (Tier 2.5, opt-in)
├── feature-vault/                   # GHOST local-only encrypted store
├── feature-driver/                  # Drive desktop tab (input/screen/file/agent)
├── feature-launcher/                # Optional Home Activity (Phase 7)
├── wear/                            # Wear OS module (composite-shared core-design + core-net)
└── app/                             # Application, MainActivity, NavHost, DI graph
```

**Чому composite build, а не один модуль:**
- Phase 0..2 cold build на цьому Radxa-хості вже ~12 хв; 16 модулів дозволяють Gradle паралелити Kotlin compile (≥2× прискорення на 6+core).
- `wear/` мусить шарити `core-design` + `core-net` без повторного коду — composite шлях це тривіалізує.
- ProGuard rules стають per-module замість мега-файлу на 1000 рядків.

---

## 4. Profile system (мульти-ідентичність на пристрої)

### Дані профілю

```kotlin
@Serializable
data class Profile(
    val id: String,                           // UUID
    val displayName: String,                  // "Кирило", "Гість", "Молодший брат"
    val role: Role,                           // ROOT | OPERATOR | GUEST
    val avatarUrl: String?,                   // local file URI or remote
    val createdAt: Instant,
    val pinHashArgon2: String,                // Argon2id over PIN, salt unique per profile
    val biometricEnrolled: Boolean,           // class 3 fingerprint or face
    val nfcUid: String?,                      // optional hardware tag
    val voicePrintHash: String?,              // optional speaker verification embedding
    val familiarRarity: FamiliarRarity,
    val behavioralModel: ByteArray,           // encrypted blob, AES-256-GCM, key from PIN+biometric
    val pairedHosts: List<PairedHost>,        // multiple Radxa instances
    val trustScore: Float,                    // 0..1, decays without ROOT-approve actions
)

data class PairedHost(
    val hostId: String,                       // unique per Radxa
    val baseUrl: String,
    val deviceJwt: String,                    // EncryptedSharedPreferences
    val deviceEd25519Priv: ByteArray,
    val lastSeenAt: Instant,
    val isPrimary: Boolean,                   // promoted host receives WS subscriptions first
    val capabilities: Set<HostCapability>,    // which channels host advertises
)
```

### Onboarding flow (5 кроків, кожен — окремий Compose екран із Familiar-гідом)

1. **"Хто ти?"** — `displayName`, `avatar` (camera або gallery)
2. **"Захисти"** — PIN (6+ digits), Argon2id 64MB cost
3. **"Дай руку"** — `BiometricPrompt.Builder` з `setUserAuthenticationRequired(true)`, enrol class 3 → отримуємо Keystore-wrapped key
4. **"Дай голос"** *(опц.)* — 30 секунд читання тексту → speaker embedding (ECAPA-TDNN ONNX) → voice-print
5. **"З'єднай світи"** — pair з першим Radxa-хостом (QR scan, перейняти потік з v1)

Profile switcher: long-press на avatar у статусній смузі → biometric → перемикання шифрованого state.

### Anti-pattern guardrails (CLAUDE.md compliance)

- **Жодних profile-mocks.** Кожен профіль реальний, із заповненим полями. Якщо ми створюємо тестовий — він під flag `Profile.isTestFixture=true` і ніколи не з'являється в UI.
- **PIN ніколи не покидає пристрій** (`pin_hash` server-only — це ж правило з phantom-os, тут симетрично).
- **`behavioralModel` шифрується ключем, виведеним з `PIN || biometric_secret`** — навіть root-зловмисник на пристрої без PIN не розшифрує.

---

## 5. Ekosystem — мульти-пристрій + мульти-профіль

### Сценарій A: один профіль, кілька пристроїв (бажаний default)

Кирило → один `Profile.id` → пов'язаний з:
- Radxa "Loft" (домашній)
- Radxa "Office" (робочий)
- Phone Pixel 9 (Companion)
- Phone Galaxy S24 (старий, бекап)
- Watch Pixel Watch 3

**Поведінка:** state переходить між пристроями. Виходиш з кімнати — desktop FOCUS перетікає у телефон FOCUS (active body тримає той, хто має найновіший sensor batch). Familiar pose і memory — однакові скрізь, бо `behavioralModel` живе на серверах і проксується клієнтам. Local-only записи (GHOST) НЕ синкаються між пристроями — це фіча, не баг.

### Сценарій B: мульти-профіль на одному пристрої

Сімейний телефон, 3 профілі:
- Кирило (ROOT)
- Дружина (OPERATOR, обмежений GHOST доступ)
- Гість на день (GUEST, watered-down trust)

**Перемикання:** Long-press avatar → biometric → SQLCipher розблоковує конкретний профіль, інші лишаються заблоковані. Familiar в memory ініціалізується з `behavioralModel` поточного профілю — телефон фактично перетворюється на іншу персону.

### Сценарій C: добавлення додаткового профілю до існуючого облікового запису

Через Settings → Profile → "Додати профіль" — провідник до onboarding, але з додатковим кроком "Прив'язати до Radxa? (як той самий юзер чи новий)". Якщо як той самий — просто отримуєш ще один device JWT. Якщо новий — створюється новий User row на сервері (потребує ROOT-потвердження з вже-парованого пристрою).

### WS hub зміни на боці phantom-os

- `WSClient.profile_id` додається до існуючого `client_id + user_id`.
- Broadcasts можуть фільтрувати по `profile_id` (нова фіча `hub.broadcast(..., profile_id=...)`).
- `ContextEngine.snapshot` тепер має `active_body: 'desktop'|'phone-pixel'|'watch'` поле — щоб LLM знав, ЧИЇМ органом саме користується юзер.

---

## 6. Camera-driven control

Фічі, де телефонна камера керує системою або забезпечує input:

| Фіча | Технологія | Куди йде сигнал |
|------|------------|-----------------|
| Face tracking | MediaPipe FaceMesh | desktop's Familiar peek/wave delta |
| Hand gestures (swipe/point/grab) | MediaPipe Hands | desktop input bridge ("agent.gesture" verb) |
| OCR live | ML Kit Text Recognition v2 | "phantom прочитай це" → desktop chat |
| QR/Barcode | ZXing або ML Kit | pair flow + product lookup |
| AR map overlay | ARCore + MapLibre layer | SENTINEL "що в полі зору" |
| Screen-of-Radxa OCR | ML Kit + scene crop | "phantom, що написано на екрані" |
| Pose estimation | MediaPipe Pose | гра/тренування з Familiar |
| Driving-shame detection | MediaPipe FaceMesh + drowsy-eye classifier | SENTINEL trigger |
| PPG HRV (фінгер на flash) | RGB camera + 30 s window | вже описано в MOBILE_COMPANION.md §3 Tier 2 |

**Ключове рішення:** vision pipeline — окремий foreground service (`PhantomVisionService`), запускається on-demand, ніколи не тримає камеру 24/7 (батарея + прайвасі).

---

## 7. Cross-device control

Двосторонній міст. Команди йдуть в обидва боки.

### Phone → Desktop (Driver tab)

- **Klавіатура / трекпад:** клавіатура з'являється на телефоні, події летять у `POST /api/v1/drive/key` + `/api/v1/drive/click` (нові backend ручки) → `xdotool` на Radxa.
- **Mirror екрана:** desktop запускає `ffmpeg` -> H.264 RTSP на 8554, телефон стрімить через ExoPlayer у Driver панель. Затримка ~150 ms.
- **File transfer:** phone-side picker → multipart до `/api/v1/drive/upload` → пишеться в `~/Downloads/phantom-drop/`.
- **Agent control:** будь-який з 100+ map.* / vault.* / chat.* версів кличеться з телефону через стандартний chat WS — телефон перетворюється на голосовий ROOT-пульт.
- **Voice routing:** телефон як bluetooth-мікрофон → PTT відправляє аудіо на phantom-os `/ws/voice` ніби з desktop-мікрофона.

### Desktop → Phone (Driven tab)

- **Phone-as-display:** dialogue / map / vault екрани можна "розширити" на телефон як другий монітор (server pushes UI state via WS).
- **Notification mirror:** desktop alert → phone push (foreground service notification з accent state).
- **Approve-on-phone:** будь-яка ROOT-операція на desktop може вимагати biometric підтвердження на телефоні (Ed25519 challenge + signed response).
- **Sensor pull:** desktop запитує "поточний GPS / BPM з носія" → phone відповідає.

### Безпека крос-команд

- Усі drive verbs мають `require_root_approval = True` за замовчуванням.
- Policy file `~/.phantom/drive-policy.toml` дозволяє ROOT-у whitelist'ити безпечні дії (key, click) і завжди вимагати biometric для небезпечних (rm, sudo).
- Audit-log кожного drive верба у `Action.where='drive'`.

---

## 8. On-device AI

### Стратегія "hybrid router"

Кожен запит проходить через `core-ai/Router`:

1. **Якщо є мережа і host live** → Gemini 2.0 Flash (вже існуючий шлях).
2. **Якщо мережа є, але prompt sensitive (GHOST state, tagged secret)** → local Gemma INT4 без виходу назовні.
3. **Якщо мережі нема, але host доступний по LAN** → host's local Ollama Gemma 4 27B.
4. **Якщо нічого — повний offline** → on-device Gemma 3n-E4B INT4 локально.

### Технічний стек

| Шар | Що | Розмір | Devices supported |
|-----|----|--------|-------------------|
| LLM | Gemma 3n-E4B INT4 (Google) | ~2.6 GB | Snapdragon 8 Gen 1+, Tensor G3+, ~10-20 tok/s |
| LLM fallback | Phi-3-mini-128k Q4_K_M | ~2.2 GB | Snapdragon 7 Gen 2+, ~5-10 tok/s |
| STT | whisper-tiny ONNX (39 MB) | 39 MB | будь-який ARM64 |
| TTS | StyleTTS2-Ukrainian → ONNX export | ~80 MB | потребує okayish CPU |
| Speaker verification | ECAPA-TDNN ONNX | ~25 MB | будь-який |
| Vision | MediaPipe Tasks (вже Google-baked) | <50 MB total | будь-який |
| Embedding | sentence-transformers MiniLM-L6 ONNX | ~90 MB | для local memory search |

### Завантаження моделей

- В onboarding step "Розумний офлайн?" опційний toggle. Default OFF.
- Якщо ON → першого запуску при WiFi → 2.6 GB download → SHA-256 verify → MMAP into ONNX session.
- В `Settings → AI` слайдер "Прайвасі рівень": 0 = завжди cloud, 100 = завжди local.

---

## 9. State machine на телефоні

Шість станів дзеркаляться. Але телефон ще й **самостійно тригерить переходи**, коли host недоступний:

| State | Тригер на телефоні (без host) | Дія |
|-------|------------------------------|-----|
| SHADOW | Phone face-down, тиша 5+ хв, motion=still | заглушити нотифікації, орб тьмяний |
| FOCUS | Дефолт активного користування | стандартна Pulse UI |
| DIALOGUE | PTT held / wake-word fired / call answered | повноекранний voice |
| SENTINEL | Геофенс exit / акселерометр 3g+ / звук "gunshot/glass" / unknown BSSID density | foreground service notification з sound, GPS dump, біометр-протест перед wipe |
| GHOST | Manual toggle або Vault opened | ВСЕ local-only, sensors off, ШІ→local Gemma, нотіфікації mute |
| DREAM | Bedtime mode / motion=still+orientation=face-down 30+ хв / 2-6 AM | мінімум CPU, прийом тільки SENTINEL trigger |

State-Machine на телефоні — окремий модуль `core-context/PhoneStateMachine`. Subscribe на host's `state` channel, але має own override (override > host).

---

## 10. Security & Privacy

| Шар | Захист |
|-----|--------|
| Pair (TOFU) | X25519 ECDH + HKDF + HMAC + cert-pin SHA256 з QR — як у v1 |
| Device JWT | EncryptedSharedPreferences (AES-256-GCM, MASTER_KEY in Keystore) |
| Long-term Ed25519 | StrongBox-backed (minSdk 31), `setUserAuthenticationRequired(true)` |
| Vault (GHOST) | SQLCipher 4.6, key = HKDF(Argon2id(PIN) ‖ biometric secret) |
| Multi-profile encryption | Per-profile master key, інші профілі заблоковані поки не authd |
| Network | TLS-only release; cleartext дозволено лише на RFC1918 для dev-no-pin Radxa |
| Auto-revoke | 30 днів без активності → `is_dormant=True`, ROOT-confirm на reapproval |
| Mesh trust | Phone-to-phone — окремий клас `MeshKey` з низьким TTL (24h), ніколи не отримує ROOT |
| Telecom data | Opt-in per-channel, OFF by default, GHOST state mute усе |

---

## 11. Phasing — реальна дорожня карта

> Кожна фаза = окремий ATOMIC commit на гілці `companion-v2-phaseN`, з чіткими acceptance критеріями. Якщо фаза розрослась — split на N-a / N-b.

### Phase 0 — "Discovery & Scaffold" (~3 дні)

**Deliverable:** Gradle composite build з 16 порожніми модулями + `app` модулем що компілюється і дає splash screen "Profile picker (placeholder)".

- Перейменувати `phantom-os/mobile/` → `phantom-os/companion-android/`.
- Створити settings.gradle.kts з `include`-ами всіх 16 модулів.
- В кожному модулі: build.gradle.kts + порожній `Module.kt` `// TODO Phase X`.
- Перенести з v1: pair crypto, theme, glass card, orb, pair screen (як референс).
- Acceptance: `./gradlew assembleDebug` зелений, APK ставиться, відкривається на Splash.

### Phase 1 — "Identity" (~2 тижні)

**Deliverable:** повний onboarding flow + multi-profile switcher.

- 5-step onboarding screens у `feature-onboarding`.
- `core-data/ProfileStore` (SQLCipher per-profile DB).
- BiometricPrompt class 3 wrapper.
- NFC tag enrol (foreground dispatch system).
- Voice-print: ECAPA-TDNN ONNX + 30s capture + speaker embedding.
- Profile switcher overlay у `core-design`.
- Acceptance: створив 3 профілі, перемкнувся між ними, кожен має свій avatar+stoogej shifter, GHOST vault видно тільки в активному профілі.

### Phase 2 — "First Body" (~2 тижні)

**Deliverable:** functional Pulse + Voice + Map + Comms + Vault з реальними даними.

- WS link з channel subscribe + JWT refresh + foreground service.
- Sensor batch upload (GPS+IMU+mic_rms).
- PTT voice round-trip (`/ws/voice`).
- Familiar 2D rendering (Lottie/Skottie fallback, Filament — Phase 5).
- Map placeholder (Tier 2 deliverable).
- Acceptance: телефон і Radxa паровані, PTT round-trip < 1s, sensor batch latency < 200ms, push notification на SENTINEL state delivery.

### Phase 3 — "Senses" (~3 тижні)

**Deliverable:** камера + GPS + wardriving + AR.

- CameraX setup в `core-vision`.
- MediaPipe Hands + FaceMesh.
- ML Kit OCR live tab.
- MapLibre Native Android з wardriving layer.
- ARCore overlay для Map.
- Geofence triggers → `POST /api/v1/agent/sentinel_trigger`.
- PPG HRV (палець + flash + 30s).
- Acceptance: face tracking → desktop's Familiar peek work in real time; OCR captures 3+ rows per second; AR markers stable; geofence-cross fire SENTINEL within 5s.

### Phase 4 — "Brain on Edge" (~3 тижні)

**Deliverable:** offline LLM + STT + TTS на пристрої.

- ONNX Runtime Mobile setup.
- Gemma 3n-E4B INT4 download + verify + load.
- whisper-tiny ONNX integrate в PTT pipeline.
- StyleTTS2-Ukrainian → ONNX export → TTS playback з AudioTrack.
- Hybrid router у `core-ai`.
- Acceptance: вимкни WiFi → задай питання → отримай відповідь з local Gemma за <8s end-to-end; TTS звучить як на desktop.

### Phase 5 — "Driver" (~2 тижні)

**Deliverable:** телефон керує десктопом.

- Keyboard / trackpad UI у `feature-driver`.
- ExoPlayer screen mirror (RTSP from desktop's `ffmpeg`).
- File transfer (multipart drag-drop).
- Agent verb command palette (fuzzy search + recent).
- Server changes: `/api/v1/drive/{key,click,upload,move}` ручки + `xdotool` на Radxa.
- Acceptance: набираєш чат на phantom-os з телефону за <20ms keylag; мирор-скрін стабільні 30 fps; file drag-drop на desktop працює.

### Phase 6 — "Mesh & Wear" (~3 тижні)

**Deliverable:** Wear OS module + телефон-телефон fallback.

- `wear/` Gradle module з shared `core-design` + `core-net`.
- DataLayer API watch-phone sync.
- mDNS `_phantom._tcp` discovery.
- BLE LE Audio + WiFi-Direct phone-to-phone fallback.
- Approve-on-phone Ed25519 signed challenges.
- Acceptance: годинник показує state pill, haptic alert на SENTINEL <250ms; два телефони у режимі "phantom-mesh" обмінюються commands без host.

### Phase 7 — "Hub Mode" (~2 тижні)

**Deliverable:** Companion як launcher + AOD + Quick Tile + Accessibility.

- Optional Home Activity (`<category android:name="android.intent.category.HOME"/>`).
- Lock-screen Familiar widget (Glance API).
- Quick Settings Tile (TileService).
- Accessibility Service для cross-app overlay (e.g. translation).
- Always-on-display Familiar peek (notification visibility STRICT).
- Acceptance: ставлю PHANTOM як default launcher, після reboot — phantom homescreen з orb + state; AOD показує тиху Familiar.

### Phase 8 — "Telecom" (~3 тижні, opt-in)

**Deliverable:** TelecomManager-замінник, SMS/RCS bridge.

Описано детально в `MOBILE_COMPANION.md §3 Tier 2.5`. Робимо тільки якщо ROOT явно ввімкне.

---

## 12. Tech stack — pinned versions (на момент Phase 0)

```toml
[versions]
agp = "8.7.3"                        # Android Gradle Plugin (вже працює)
kotlin = "2.0.21"
compose-bom = "2024.11.00"
coroutines = "1.9.0"

ktor = "2.3.13"                      # REST + WS (вже інтегровано в v1)
room = "2.6.1"
sqlcipher = "4.6.1"
bouncycastle = "1.78.1"              # X25519/Ed25519 (вже працює)

onnxruntime = "1.20.0"
mediapipe = "0.10.18"
mlkit-ocr = "16.0.1"
mlkit-barcode = "17.3.0"
camerax = "1.4.0"
exoplayer = "1.4.1"
maplibre = "11.5.1"
arcore = "1.45.0"
filament = "1.55.0"                  # 3D Familiar (Phase 5)

biometric = "1.2.0-alpha05"
security-crypto = "1.1.0-alpha06"

zxing = "3.5.3"
glance = "1.1.1"                     # Lock-screen widget (Phase 7)
wearable = "18.2.0"                  # Wear OS (Phase 6)
```

---

## 13. Backend changes (parallel track)

Telefon потребує цих змін на phantom-os боці:

| Зміна | Phase | Опис |
|-------|-------|------|
| `User.profiles[]` migration | 1 | Multi-profile schema розширення `db/models.py` |
| `WSClient.profile_id` filter | 1 | broadcast(..., profile_id=...) ext в `websocket_hub.py` |
| `ContextEngine.active_body` | 2 | snapshot pole `active_body: 'desktop'\|'phone-X'` |
| `/api/v1/drive/{key,click,upload}` | 5 | `routes_drive.py` + xdotool subprocess |
| `/api/v1/agent/sentinel_trigger` | 3 | thin route → state machine SENTINEL transition |
| `MeshNode` table + `/api/v1/mesh/*` | 6 | phone-to-phone trust registry (опц., може бути цілком on-device) |
| Sticky session affinity | 2 | WS reconnect prefer last `client_id` per profile |

Жодне з цих змін не блокує phone розробку — для phase 0..2 достатньо існуючого backend.

---

## 14. Risks & mitigations

| Ризик | Імовірність | Вплив | Mitigation |
|-------|-------------|-------|------------|
| Cold build > 20 хв на цьому Radxa | висока | ✗ якщо кожен push потребує full build | composite build паралелізм + R8 disabled у dev + Gradle build cache |
| Gemma 4B не влізає в 6GB RAM пристрій | середня | ✗ Phase 4 не злетить | Phi-3-mini fallback (2.2 GB), opt-in download, графічний даунгрейд |
| Battery drain від foreground service + sensor + камера | висока | ✗ телефон вмирає за 4 год | adaptive sampling (motion=still → 1Hz IMU; walking → 50Hz); doze whitelist опційно |
| Multi-profile crypto bugs | середня | ✗ data leak між профілями | exhaustive test matrix у Phase 1, окремий security audit перед Phase 5 |
| Capacitor PWA користувачі будуть забуті | низька | косметика | `phantom-companion/` лишається, мінімальні bug fixes, but no new features |
| Кейстор втратив ключ на firmware OTA | низька | ✗ require re-pair | StrongBox опційний; `KeyGenParameterSpec.setIsStrongBoxBacked(false)` fallback |
| Backend changes блокують phone | середня | ✗ Phase 5 затримка | phone розробляється на existing API; backend changes — окремий PR без блокувань |

---

## 15. Out of scope (explicit guardrails)

- **iOS** — Phase 9+, KMM (Kotlin Multiplatform Mobile) shared `core-net` + `core-data`. До цього часу — лише Android.
- **Custom ROM** — ніколи. Живемо в стоковому Android, через Capacitor / Compose / Wear.
- **Voice cloning довільних мовців** — privacy червона лінія. Тільки голос самого ROOT-юзера, через onboarding step 4.
- **Cross-tenant data sharing** — кожен User повністю ізольований. Multi-host pairing під одним User — OK; multi-user per device — кожен свою БД.
- **Backdoor remote-wipe** — НІКОЛИ. ROOT може revoke device, but not silently wipe іншу people's GHOST vaults.

---

## 16. Compact-survival protocol

Коли наступний Claude стартує після `/compact`:

1. **Прочитати цей файл цілком** (`docs/MOBILE_PHANTOM_AMBITIOUS.md`).
2. Прочитати `docs/MOBILE_COMPANION.md` + `docs/MOBILE_COMPANION_DESIGN.md` + `docs/VISUAL_SYSTEM.md` для UI bridj.
3. Прочитати `CLAUDE.md` (project root) для правил кодування.
4. `git log --oneline | head -30` — зрозуміти що вже зроблено.
5. Перевірити стан `phantom-os/mobile/` (буде перейменовано в Phase 0 → `companion-android/`).
6. Перевірити `phantom-companion/` (legacy PWA, не торкатись окрім бугфіксів).
7. Знайти останній коміт із префіксом `companion-v2-` для визначення поточної фази.
8. Запустити Phase 0 if не закомічено, інакше — наступну незакриту фазу.

**Дефолт:** якщо невпевненість — починати Phase 0 з нуля. Phase 0 — лише scaffolding, не ламає нічого.

---

## 17. Перший рух після старту нової сесії

```
1. cd /home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os
2. git status — переконатись що workspace чистий або mobile/ ще не перейменовано
3. git checkout -b companion-v2-phase-0
4. mv mobile/ companion-android/ (через git mv, зберігаючи історію)
5. settings.gradle.kts — додати 16 module includes
6. Створити порожні build.gradle.kts у кожному з 15 нових модулів
7. У кожному модулі — порожній Kotlin файл-маркер `package local.phantom.companion.X; object Module`
8. ./gradlew assembleDebug — переконатись що все ще компілюється
9. git commit -m "companion-v2-phase-0 — composite build scaffold (16 modules)"
10. Перейти до Phase 1 onboarding
```

---

## 18. Ім'я та applicationId

- **Display name:** "PHANTOM" (як зараз)
- **applicationId production:** `local.phantom.companion`
- **applicationId debug:** `local.phantom.companion.debug` (вже працює)
- **Maven group:** `local.phantom`

Жодних "v2" / "next" / "new" — це той самий пристрій, лише виросла особа.

---

## 19. Definition of Done для всього проєкту

PHANTOM Companion v2 = **готовий**, коли:

1. Кирило ставить APK на свій Pixel.
2. Onboarding створює профіль за 90 секунд.
3. Скан QR з phantom-os pair-екрана за < 5s.
4. PTT round-trip < 800ms на LAN.
5. Очікуваний state переходить між desktop і телефоном без розриву діалогу.
6. Вимкнути WiFi → телефон далі відповідає (offline Gemma).
7. Кирило показує мамі: вона створює профіль `Гість`, отримує обмежений access, не бачить нічиїх GHOST записів.
8. Pixel Watch показує state pill і вібрує на SENTINEL < 250ms.
9. Один день в продакшні без вилітів, з foreground service running 24h, < 8% battery drain.
10. ROOT-операція на phantom-os вимагає biometric на телефоні і фактично спрацьовує тільки якщо телефон signs.

Якщо хоч один пункт зривається — фаза не зарахована, fix forward.

---

## 20. Memory-coordination notes (для майбутнього мене)

- **Не торкатись `phantom-companion/` PWA** окрім bugfix sticky CTA / camera (вже зроблено в commit … ).
- **Не торкатись `phantom-os/mobile/`** окрім перейменування на Phase 0.
- **`phantom-os/src/`** — тут backend. Зміни лише ті, що в §13.
- **Гілки:** `companion-v2-phase-N` per phase, merge у `autonomous-run` коли готово.
- **Кожен phase commit:** `companion-v2-phase-N — short summary` (як `phase-19-mobile-tier1`).

---

> **Закінчення.** Документ ~700 рядків, охоплює архітектуру, фази, стек, ризики, безпеку, ekosystem, мульти-профіль, on-device AI, cross-device control, compact-survival, перший рух. Готовий передати майбутньому собі.
