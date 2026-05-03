# PHANTOM Companion — Mobile (Android-first) Design

> Документ-проєкт мобільного супутника PHANTOM OS. Версія 0.1.
> Парний документ: `docs/MOBILE_COMPANION_DESIGN.md` — UI-бриф для Claude Code (Compose).
> Імплементацію (backend pairing, Android-клієнт) **не починаємо в цьому проході** — лише фіксуємо архітектуру.

---

## 1. Vision

PHANTOM Companion — це **друге фізичне втілення тієї самої сутності**, що живе на Radxa Dragon Q6A. Не remote-control. Не chat-клієнт. Не "phantom-mobile webview". Коли власник іде з кімнати, частина PHANTOM іде з ним: продовжує слухати ROOT-голос, носить профіль, рапортує контекст у браслет, ловить WiFi для wardriving-карти, зберігає sealed-нотатки в GHOST-сховище, дає дозвіл на критичні дії одним дотиком пальця. Це периферійний орган тіла, яким керує той самий ContextEngine на сервері — телефон лише інше вікно у ту ж свідомість, із власною сенсорикою і власною роллю в SENTINEL-режимі.

---

## 2. Pillars

1. **Single identity, two bodies.** Один JWT-простір, одна `User.preferences_json`, один Familiar. Жодного "mobile account" — лише `UserDevice`, прив'язаний до існуючого юзера.
2. **Phantom is the brain, phone is a sense organ.** Тяжкі обчислення (LLM, STT, TTS, ContextEngine) ніколи не дублюються на телефоні. Телефон шле сирі сигнали в існуючу `SensorBatch` schema, отримує готові рішення.
3. **Visual DNA inviolable.** sunrise-warm, шість станів, glass stack, Familiar — переносяться 1:1, з RenderEffect-fallback для Android < 12, без жодного Material You.
4. **Offline-graceful, online-honest.** Без сервера телефон тримає Vault, кеш Familiar pose, останній snapshot контексту, чергу wardriving-точок — і явно показує "PHANTOM не на зв'язку".
5. **Privacy is geometry, not policy.** Sensitive поля (`pin_hash`, `rfid_uid_hash`, `behavioral_model_json`) фізично ніколи не покидають сервер. GHOST-vault шифрується ключем з Android Keystore і ніколи не синхронізується.
6. **Trust-on-First-Use, revoke-on-distrust.** Парування — одноразовий QR; ROOT може відкликати девайс з десктопа за два кліки. Без "sign in with Google".
7. **Latency is a feature.** Push-to-talk цикл ≤ 800 ms, sensor stream tick узгоджений з 500 ms ContextEngine, UI cold-start < 400 ms.

---

## 3. Feature Map

### Tier 1 — Core (MVP, фаза 1, 2 тижні)

- **Pairing & device profile.** QR з десктопа на 60 секунд → телефон отримує device JWT + cert pin + копію profile snapshot. Маппинг: нові ендпойнти `POST /api/v1/pair/init`, `POST /pair/claim`, `GET /pair/status` (див. §4).
- **Profile sync.** Двостороння синхронізація whitelist-полів `User.preferences_json` (тема, мова, voice profile, familiar rarity). Канал — `PATCH /auth/me` + WS `context/preferences_changed`.
- **Push-to-talk голос.** Hold-button → телефон стрімить s16le@16k PCM на існуючий `/ws/voice?token=<jwt>`, отримує `partial`/`final`/`rejected` JSON, грає TTS-WAV з `POST /api/v1/voice/tts`.
- **Live context strip.** Підписка на канал `sensor` (snapshot 500 ms) + `context` (state_transition, standing_orders) → vitals, поточний state, "next 1 hour" hint.
- **Alerts.** Канал `agent.stream` (`proactive.pending_action`) + state-transitions у SENTINEL → системні нотифікації з actionable buttons (acknowledge / silence) через foreground service.
- **Familiar mobile.** Підписка на `familiar/manifestation`; рендер 7 поз через Filament (GLB) з Lottie/Skottie fallback на Android < 12 і low-end SoC.
- **Settings remote.** Дзеркало `/components/settings` десктопа: тема, voice profile, familiar rarity, notification rules. PUT через існуючі settings-роути.

### Tier 2 — Companion (фаза 2, 3–5 тижні)

- **Phone as sensor.** `MobileSensorAdapter` foreground-сервіс шле розширений `SensorBatch` під ключем `mobile`: GPS, IMU (motion class), мікрофонний RMS (без сирого аудіо), BLE proximity, WiFi scan. Транспорт — нова HTTP-роута `POST /api/v1/sensors/mobile_batch` (та сама pydantic-схема, optional поля).
- **Wardriving collector у кишені.** Той самий `WiFiNetwork.upsert` через `wardriving/collector.py`; телефон у режимі walk-around працює як друга рука Phantom-сенсорів. Маппинг — існуючий канал `map/wardriving_update`.
- **AR tactical map.** MapLibre Native Android + ARCore-overlay: коли телефон тримають горизонтально — мапа; вертикально — AR-стрілки на найближчі POI/threats з даних `MapPOI` і живі WiFi-точки.
- **Geofence triggers → SENTINEL.** Android Geofencing API; при перетині — `POST /agent/sentinel_trigger` (нова тонка роута, делегує в існуючу state-machine). Реакція ROOT'а — SENTINEL state-broadcast.
- **PPG HRV via camera.** Палець на flash + камера → 30 s вимір; результат шле як вузький `SensorBatch.body{bpm,hrv}` (поле `body` уже є). ContextEngine використовує без змін.
- **Companion screen.** Телефон як вторинний дисплей: відкриває full-screen DIALOGUE-layout з тим же state, синхронно реагує на state_transition. Без Cast/Miracast — звичайний WS-fed view.

### Tier 2.5 — Communications (фаза 2.5, 1–2 тижні після Tier 2)

Тут телефон починає реально замінювати "звичайний месенджер". PHANTOM не просто слухає голос — він стає **operator у будь-якій розмові**, веде історію, перекладає, заглушує спам, дублює sms у Strategic Memory, дозволяє начитати відповідь голосом.

- **Native dialer & calls.** Використовуємо системний `TelecomManager` + `InCallService` — PHANTOM Companion реєструється як **alternative phone UI**. Вхідний дзвінок: повноекранний glass-screen з accent-state, FamiliarCanvas в pose `pointing` на caller-аватар, AI-під-картка ("останні 3 контакти з цим номером, останній sms 2 дні тому"). Вихідний — голосове "Phantom, набери Олега" → STT через існуючий `/ws/voice` → fuzzy-match по `Contact.display_name` → `TelecomManager.placeCall`.
- **Live call transcription + summary.** Під час дзвінка стрімимо мікрофон + earpiece audio (через `MediaRecorder.AudioSource.VOICE_CALL`, потребує ROOT-permission на деяких прошивках; fallback — лише local mic) на існуючий `/ws/voice` з прапорцем `mode=call_capture`. Бекенд віддає `partial`/`final` як завжди + у post-call hook стискає в `CallSummary` через LLM. Зберігаємо у новій таблиці `Call` (id, peer, started_at, ended_at, direction, transcript_id, summary, sentiment).
- **SMS / RCS bridge.** Реєструємось як `RoleManager.ROLE_SMS` (опційно, default-handler не перехоплюємо без явного toggle у Settings). Усі SMS дзеркалимо двостороннє у новий канал `comms` бекенду:
  - `POST /api/v1/comms/sms` — відправити;
  - WS `comms/inbound_sms`, `comms/outbound_sms`, `comms/delivery_report`;
  - усе зберігається в таблиці `Message` (channel=sms|rcs|chat, peer, body, ts, ai_reply_suggested).
  PHANTOM авто-генерує **suggested replies** через LLM з урахуванням `behavioral_model` (тон як у користувача); пропозиція показується chip-rows над клавіатурою; user-tap → одразу send.
- **Voice-to-text dictation для відповідей.** В будь-якому повідомленні (SMS/Chat/external IM via Notification Listener) — long-press на input field → mic overlay → диктує мовою → STT → text. Те саме API, що PTT.
- **Smart screening.** Невідомі номери: AI-prompt бере перші 5 секунд аудіо, ставить питання "хто це і з якого приводу", транскрибує відповідь, показує користувачу як rich-card з кнопками "answer / decline / mark spam / save contact". Спам-номери сервер агрегує у `BlockedNumbers` (per-user); WS канал `comms/spam_intel` ділиться між девайсами.
- **Translate-on-the-fly (DIALOGUE bridge).** Якщо peer розмовляє іншою мовою — PHANTOM TTS повторює репліку українською у earpiece з 800ms затримкою (через TTS WAV stream в `AudioTrack` поверх call-audio); user відповідає українською → TTS на peer-мові у speakerphone. Опційно, потребує `voice.bilingual_mode` у preferences.
- **Notification Listener bridge.** Захоплюємо повідомлення з Telegram/Signal/WhatsApp через `NotificationListenerService` (read-only), показуємо у єдиному `Comms`-табі поряд з SMS, генеруємо AI-suggested-replies, але **не відправляємо без явного user-action** (через `Notification.Action.RemoteInput`).
- **Voicemail як AI-секретар.** Якщо абонент не бере — PHANTOM відповідає його голосом ("зараз не зручно говорити, що передати?"), записує меседж, транскрибує, кидає у `Comms` з пушем "voicemail від Олега, 18s, ✱гарячий✱".
- **Contacts sync (one-way pull).** Системні контакти підтягуються лише локально (Android `ContactsContract`) і збагачуються AI-нотатками з PHANTOM strategic memory (`MemoryFact.where=contact_<id>`). Контакти НЕ заливаємо на сервер — лише `contact_id_hash` для зв'язку з пам'яттю.
- **Comms tab у нижній навігації.** Замість "Chat" вкладку перейменовуємо на **Comms**, у ній сегменти: Calls / SMS / Phantom Chat / IM-bridges. Phantom Chat (наш існуючий `/chat/message`) лишається там же — це просто розмови з самим PHANTOM.

**Оновлений Bottom Nav:** Pulse · Voice · Map · **Comms** · Vault (Chat поглинається у Comms).

**Privacy-flag.** Усі call/sms-фічі — **opt-in per channel** в Settings → Communications. Default OFF. У GHOST-state PHANTOM не транскрибує і не зберігає нічого з comms — лише пропускає системний дзвінок без AI-overlay.

### Tier 3 — Mesh / Ambitious (фаза 3, 6–9 тижні)

- **Wear OS extension.** Окремий Gradle-модуль `wear/`, спільний core через composite build. Підписка лише на `state` + `proactive.pending_action`; haptic patterns per state (SENTINEL — gallop, GHOST — single tap).
- **Tasker-style automations.** Локальні правила "якщо state=DREAM і час 06:30 → запусти alarm scene"; виконуються на телефоні навіть при offline-PHANTOM, потім синхронізуються у `standing_orders`.
- **GHOST vault.** SQLCipher-таблиця `ghost_records` (text, photo, audio-memo). Ключ — HKDF з biometric-unlocked Keystore-key. Поле `sync=local-only` гарантує: ніколи не покидає телефон. Видно лише в state GHOST.
- **Approve-on-phone for ROOT operations.** Десктоп ініціює "promote to ROOT" / "execute privileged tool" → телефон отримує WS push з nonce → biometric prompt → підпис device-key (Ed25519) → `POST /pair/sign_challenge`. Це і є мобільний другий фактор для ROOT.
- **Mesh relay.** Якщо PHANTOM offline (no LAN) — телефон тимчасово приймає роль relay: інші клієнти з'єднуються до телефонної копії WS-hub'а в read-only mode і отримують останні broadcast-кадри з кешу. Виявлення — mDNS `_phantom-relay._tcp`.
- **Co-pilot mode у авто.** Великий orb + лише голос + map; auto-detect через Bluetooth car-profile; силою висока motion-scale 1.3× і обмежений набір актуаторів.

---

## 4. Pairing Protocol

QR живе 60 секунд. Криптографія — **ephemeral X25519 ECDH + HKDF-SHA256 + device long-term Ed25519 keypair у Android Keystore (StrongBox якщо доступно)**. Без TLS CA, з cert-pinning через SHA-256 у QR. Один шифр-стек, без альтернатив — менше площа атаки.

### Що в QR (JSON, потім base45 → ZXing)

```json
{
  "v": 1,
  "host": "phantom.local",
  "ip": "192.168.7.42",
  "port": 8000,
  "pair_id": "<uuid>",
  "server_pub": "<x25519 pubkey, base64>",
  "server_cert_sha256": "<hex>",
  "exp": 1746230400,
  "nonce": "<24 random bytes b64>"
}
```

### Endpoint 1: `POST /api/v1/pair/init` (десктоп → server, auth: ROOT JWT)

Сервер генерує ephemeral X25519 keypair `(s_priv, s_pub)`, зберігає в memory-only `PairingSessions{pair_id → {s_priv, s_pub, nonce, expires_at, created_by_user_id}}`, повертає тіло QR. Десктоп малює QR.

### Endpoint 2: `POST /api/v1/pair/claim` (телефон → server, no auth)

Телефон сканує QR → перевіряє `server_cert_sha256` проти отриманого з TLS handshake (mkcert у dev, Caddy у prod). Якщо збіглось — генерує власну X25519 ephemeral пару `(c_priv, c_pub)` + Ed25519 device long-term keypair у Keystore (alias `phantom_companion_device_key`, requires biometry для подальшого signing). Тіло запиту:

```json
{
  "pair_id": "...",
  "client_pub": "<x25519 pubkey b64>",
  "device_pub_ed25519": "<long-term pub b64>",
  "device": {"name": "Pixel 9", "model": "google/pixel9", "android": 35},
  "nonce_echo": "<from QR>",
  "client_proof": "<HMAC(K, pair_id||device_pub) b64>"
}
```

де `K = HKDF-Extract(salt=nonce, ikm=ECDH(c_priv, server_pub))`. Сервер: повторює ECDH, перевіряє HMAC, створює рядок `UserDevice` (user_id = `created_by_user_id` із session), випускає **device JWT** з `aud="device"`, claim `device_id`, TTL 30 днів, refresh-grace 7 днів. Сервер відповідає:

```json
{
  "device_jwt": "...",
  "device_id": "...",
  "user": { "...": "..." },
  "server_proof": "<HMAC(K, device_jwt) b64>"
}
```

Клієнт перевіряє `server_proof`, якщо ок — зберігає device JWT у `EncryptedSharedPreferences` (Keystore-wrapped), знищує `c_priv` із пам'яті.

### Endpoint 3: `GET /api/v1/pair/status?pair_id=...`

Десктоп long-poll або краще — підписується на канал `pair` через існуючий WS hub. Коли `claim` успішний — broadcast `pair/claimed` з `device_id` + `user_id`; десктоп показує "Pixel 9 paired with finace387, revoke?" toast.

### Anti-MITM на LAN без CA

SHA-256 cert-pin у QR — атакуючий не знає сертифіката Caddy і не може підмінити сесію. У dev mkcert видає stable cert, у prod — Caddy internal CA з тим же fingerprint.

### TOFU & revocation

Перше парування — TOFU через QR (фізична присутність ROOT). Ревокація: `DELETE /api/v1/devices/{device_id}` (потребує ROOT JWT) → встановлює `revoked_at`, broadcast `device/revoked` → телефон при наступному WS-handshake отримує 401 + `code=device_revoked` і чистить локальний store. Auto-revoke: `last_seen_at` старше 30 днів → `is_dormant=True`, при поверненні потрібен ROOT-confirm (модалка на десктопі з approve-button).

---

## 5. Data Sync Model

**Whitelist (двосторонньо синхронізується через `preferences_json`):** `language`, `theme`, `voice.profile_id`, `voice.wake_word`, `familiar.rarity`, `familiar.manifest_frequency`, `notifications.{channel→{enabled, quiet_hours}}`, `map.default_layer`, `co_pilot.auto_enable`.

**Server-only, NEVER sync to phone:** `pin_hash`, `rfid_uid_hash`, `behavioral_model_json` (поведінкова модель — sensitive, тримається сервером), сирі `ChatMessage.content` старші 7 днів (телефон тримає лише останні 100 повідомлень на сесію), `MemoryFact` де `is_sealed=True`.

**Phone-only, NEVER sync to server:** GHOST-vault записи (`sync=local-only`), Keystore device key (private), кеш PCM (TTL 5 s), GPS-точки старші ніж 24 години якщо користувач не натиснув "donate to wardriving".

**Strategic Memory snippets — opt-in per record.** Інтерфейс Vault показує локальну нотатку з кнопкою "Promote to MemoryFact" → явний `POST /memory/facts` з `layer`, `category`. Без масової вивантаги.

**Conflict resolution: last-write-wins per field з `updated_at` timestamp.** Vector clocks і CRDT — overkill: телефон і десктоп майже ніколи не редагують один і той самий ключ одночасно. Поле `preferences._meta.{key}_updated_at` дозволяє визначити переможця. Сервер — авторитет; телефон при WS-reconnect отримує `context/preferences_snapshot` і мерджить лише ті ключі, де серверний timestamp новіший.

---

## 6. Транспорт і real-time

**HTTPS + cert-pin на LAN.** dev — mkcert; prod — Caddy reverse-proxy з internal CA. Cleartext вимкнено в `network_security_config.xml` (ось чому QR несе cert-fingerprint).

**WS subscription model — нове розширення hub'а.** Зараз `WebSocketHub.broadcast` шле всім (або всім клієнтам user_id). Для мобільного це марнотратно: телефон не хоче `agent.stream` raw-логи. Додаємо `subscribe`/`unsubscribe` керуючі повідомлення:

```text
client → server: {"control": "subscribe", "channels": ["sensor","context","familiar","chat","state","map"]}
client → server: {"control": "unsubscribe", "channels": ["map"]}
```

Реалізація — додати `WSClient.channels: set[str] | None` (None = всі, для backwards-compat з десктопом). У `broadcast` фільтр: `if client.channels is not None and channel not in client.channels: skip`. Це невелика правка `websocket_hub.py` без зміни сигнатури `broadcast(...)`.

**Foreground service "PHANTOM Link"** тримає WS у живому стані, з notification-pill "FOCUS · paired with Loft". При doze/standby — exponential backoff 1→2→5→15→60 s. На boot-completed — pre-warm через WorkManager `OneTimeWorkRequest`.

**Voice WS — окремий потік.** Існуючий `/ws/voice?token=<jwt>` залишається бінарним, телефон відкриває його лише на час hold-button. Push-to-talk: `start_press` → відкрити WS → стрімити PCM кадрами 20 ms → `release` → надіслати `{"control":"end_utterance"}` → чекати `final` → `POST /voice/tts` для відтворення відповіді → закрити WS. Латентність бюджет: capture 20 ms + send 30 ms + STT+LLM 400 ms + TTS 200 ms + playback start 50 ms + UI 100 ms = **≤ 800 ms круг**.

---

## 7. Android Architecture для МАКСИМАЛЬНОЇ швидкості

**Kotlin + Jetpack Compose.** Вибір однієї причини: тіла `@Composable` поєднуються з `@Stable`/`@Immutable` data-класами і Skia-рендером Compose так, що на 120 Hz панелі ми отримуємо передбачуваний frame budget — Flutter не дає нативного `RenderEffect` blur (потрібного для Glass stack), Compose Multiplatform на Android відсікає актуальні Wear OS API, RN навіть не претендує на цей рівень контролю над renderpass'ами.

### Стартові оптимізації

- **App Startup library** + `androidx.startup.Initializer` — без `Application#onCreate` fan-out.
- **Hilt + `Lazy<>`** для всіх non-critical-path залежностей (Room, Coil, MapLibre).
- **Baseline Profiles** генеруємо через Macrobenchmark на сценаріях Pulse-launch і PTT-press; ціль cold-start < 400 ms на Pixel 6a.
- **R8 full-mode + ResourceShrinker + per-ABI splits** (arm64-v8a only для прод-релізу, x86_64 — для емулятора debug).
- **WorkManager pre-warm WS** у `OnBootReceiver` (BOOT_COMPLETED) — спить, але connection slot уже в hub'і.

### 60/120 Hz UI

`@Stable`/`@Immutable` на всі snapshot-моделі (`PulseState`, `VitalsRow`); `derivedStateOf` для агрегатів; уникати lambda-capture у hot path; `Modifier.graphicsLayer { renderEffect = blurEffect }` замість сторонніх blur-ліб.

### Render stack

- **Filament** (Google) для GLB Familiar — повний PBR, IBL для glass, ~6 MB APK delta.
- **Lottie/Skottie** як fallback для Android < 12 і low-end devices (Filament детектує SoC tier).
- **MapLibre Native Android** для карти; ARCore overlay лише на Tier-2.

### Local DB

- **Room + WAL** для не-секретних кешів (sensor snapshot rolling buffer, chat-cache, map tiles).
- **SQLCipher** окремий DB-файл для GHOST vault, ключ — HKDF з Keystore-wrapped master.

### Networking

- **Ktor client (CIO engine)** — Kotlin-native, multiplatform-ready (на майбутнє для iOS), сумісний з multipart і WS з коробки.
- **OkHttp connection pool** під ним для HTTP/2 keep-alive.
- **Persistent WebSocket** у власному `PhantomLinkService` з Mutex-protected reconnect.

### Image

- **Coil 3** з prefetch аватарів при `/auth/me` response.

### Foreground service "PHANTOM Link"

`type=dataSync`, persistent-notification з live-станом і motion-scale (як на десктопі — pill із currentState).

### Wear OS

Окремий Gradle-модуль `wear/` через **composite build**, шарить `core-design`, `core-net`, `core-data`. Спілкується з телефоном через DataLayer API (Wearable). На watch — лише state pill, vitals (BPM), і haptic-only alerts.

---

## 8. UI / Layout strategy для 6" portrait

Bottom navigation, **5 tabs:** Pulse · Voice · Map · Chat · Vault. Кнопки навігації — glass-card з accent-tint поточного state.

- **Pulse (адаптує SHADOW)** — full-bleed скрол: top — `VitalsRow` (BPM/breath/stress chips), нижче — `OrbView` 70% width (state-color, motion-scale), ще нижче — `StatePill` з standing_orders preview, "Next 1 hour" suggestion card з proactive-engine. Familiar peek з нижнього-правого кута.
- **Voice (адаптує DIALOGUE)** — full-screen orb, transcript scrolls вгорі, PTT-button у нижній чверті (giant 96 dp circle), tap → push-to-talk hold; long-press → continuous mode; swipe-up на button → відкрити Chat. Familiar в pose `pointing` під час final.
- **Map (адаптує SENTINEL + wardriving)** — MapLibre full-screen, segmented layer-switcher pill зверху (wardriving / POIs / heatmap / phantom GPS), bottom-sheet з threats-list (з SENTINEL-state); FAB для AR-mode (Tier 2).
- **Chat** — persistent sessions list як ліва-edge swipe-drawer; основа — повідомлення (glass-card), share-sheet входить як attachment. State-accent border на свого юзера messages.
- **Vault** — biometric-gate splash → list of GHOST-records (notes / photos / audio-memos), кожен — frosted glass card, accent emerald (GHOST), sync-indicator завжди показує "local-only".

**Familiar global overlay** — `Box(Modifier.fillMaxSize())` верхнього рівня, `Modifier.align(BottomEnd)`, реагує на manifestation broadcast і peek/wave/point на UI-elements (через серверні координати в polar-form, телефон сам мапить на свій layout).

---

## 9. Security & Privacy

- **Android Keystore HW-backed** для device Ed25519 keypair; StrongBox якщо є; `setUserAuthenticationRequired(true)` для приватного ключа — кожен sign challenge вимагає biometric prompt.
- **EncryptedSharedPreferences** (AES-GCM, MASTER_KEY in Keystore) для device JWT, cert-pin SHA, server URL.
- **BiometricPrompt class 3** — Vault open і ROOT-approve operations.
- **`network_security_config.xml`:** `cleartextTrafficPermitted=false`; user CA disabled у release; cert-pinning по SHA-256 з QR (через OkHttp `CertificatePinner`).
- **GHOST records** маркуються `local_only=True` і ніколи не з'являються в request bodies.
- **Auto-revoke after 30 d dormancy:** сервер позначає `is_dormant`, телефон при поверненні запускає flow "ROOT must confirm device return" (модалка на десктопі з approve-button).
- **Token rotation:** device JWT TTL 30 днів, refresh — лише з валідним device-key signature; sliding window.

---

## 10. Phasing (Roadmap до релізу)

- **Phase 1 — "First Body" (тижні 1–2).** Deliverable: APK у дебаг-режимі парується з phantom-os через QR, синкає `preferences_json`, тримає WS з підпискою на `sensor`+`context`+`familiar`, малює Pulse + Voice tabs з Familiar 2D-fallback, push-to-talk голос round-trip. Success: cold-start < 500 ms, PTT round-trip < 1 s, парування з нуля < 30 s.
- **Phase 2 — "Senses" (тижні 3–5).** Deliverable: foreground service з MobileSensorAdapter (GPS+IMU+WiFi-scan), Map tab з MapLibre + wardriving layer, geofence → SENTINEL, Familiar 3D через Filament. Success: 8 h battery з підключеним сервісом < 6%, wardriving upsert latency < 200 ms.
- **Phase 3 — "Mesh" (тижні 6–9).** Deliverable: GHOST Vault (SQLCipher + biometric), approve-on-phone для ROOT-операцій, Wear OS module з state-pill і haptic alerts, AR overlay на Map. Success: ROOT-approve latency < 1.5 s, watch-haptic на SENTINEL transition < 250 ms.

---

## 11. Файли, які треба створити

- `docs/MOBILE_COMPANION.md` — цей документ.
- `docs/MOBILE_COMPANION_DESIGN.md` — UI-бриф для Claude Code (див. парний файл).
- `mobile/` — Android root, Gradle composite build:
  - `mobile/app` — Application, navigation, DI graph, foreground service.
  - `mobile/core-design` — токени, Compose theme, GlassCard/OrbView/FamiliarCanvas/StateAccent/VitalsRow/PttButton.
  - `mobile/core-net` — Ktor client, WS link, pairing protocol, certificate pinner.
  - `mobile/core-data` — Room schemas, SQLCipher Vault, preferences sync engine.
  - `mobile/feature-pulse`, `feature-voice`, `feature-map`, `feature-chat`, `feature-vault` — по одному модулю на таб.
  - `mobile/wear` — Wear OS app (Phase 3).
- Backend-зміни (наслідок цього плану, не сам файл документа):
  - нова таблиця `UserDevice` у `src/backend/db/models.py`;
  - роути `/api/v1/pair/{init,claim,status}` у `src/backend/api/routes_pair.py`;
  - розширення `WSClient` зі set-of-channels у `src/backend/api/websocket_hub.py`;
  - роута `POST /api/v1/sensors/mobile_batch` як тонка делегація у вже існуючий sensor pipeline.

---

## 12. Out of scope для цього документа

- Compose-код, Android Manifest, Gradle-файли — у наступному PR.
- Implementation pairing (server-side) — у фазі 1 окремим планом.
- iOS клієнт — Phase 4+, через KMM спільні модулі `core-net` + `core-data`.
- Покриття state-machine: SHADOW/FOCUS/DIALOGUE/SENTINEL/GHOST/DREAM керуються СЕРВЕРНОЮ state-machine; телефон лише дзеркалить.
