# PHANTOM Companion — Mobile (Android-first) Design Plan

## Context

Користувач просить спроєктувати мобільний застосунок-супутник для PHANTOM OS, що спарюється з десктопом по QR-коду і несе профіль користувача. Поточний стан коду (підтверджено розвідкою):

- Pairing / device registry — **повністю відсутні**. Auth є тільки PIN/RFID + JWT (HS256, TTL 480 хв, refresh 1 год grace).
- WebSocketHub існує і вже multi-client per user, канали `sensor` (snapshot 500ms), `chat`, `context`, `familiar` (manifestation), `map` (wardriving_update); subscribe/unsubscribe API не існує — клієнт отримує все.
- `/ws/voice?token=<jwt>` приймає 16k PCM і повертає JSON; `POST /api/v1/voice/tts` віддає WAV. Це готовий бекенд для push-to-talk з телефона.
- `SensorBatch` має optional поля radar/gps/env/wifi_nets; телефонні сенсори природньо підключаються через паралельний `MobileSensorAdapter` без зміни ContextEngine.
- Visual DNA канонізована: sunrise-warm (`#f8f7f5` / `#f4af25`), 6 станів зі своїм accent + motion-scale, glass stack 12/24/32px blur, шрифти Space Grotesk + Manrope + JetBrains Mono + Playfair Italic, Familiar — 3D GLB з 7 позами, керується серверним broadcast.
- Android < 12 не має `backdrop-filter` blur; Familiar GLB 130×182 на 1024×600 → 45×60 на 6" portrait — потрібен fallback (Skottie/Lottie) і per-tier render path.

Мета — задокументувати продумане бачення продукту так, щоб (а) бекенд-розширення під pairing+subscribe можна було імплементувати окремою фазою, (б) Android-клієнт можна було згенерувати/нарощувати з єдиного дизайн-брифу, (в) візуальна ДНК PHANTOM перенеслася 1:1 без Material You, без generic Android tropes.

## Recommendation

Створити **два markdown-документи** в `phantom-os/docs/` і нічого більше зараз не торкати в коді. План документації, не імплементації — імплементація буде окремими PR'ами по фазах.

### File 1 — `phantom-os/docs/MOBILE_COMPANION.md`

Повний дизайн-документ продукту, ~2000 слів, українською. Структура (фінал склав Plan-агент, перевірено проти реального стану коду):

1. **Vision** — друге фізичне втілення тієї ж сутності, не remote-control.
2. **Pillars (7)** — single identity / phone is sense organ / visual DNA inviolable / offline-graceful / privacy is geometry / TOFU + revoke / latency is a feature.
3. **Feature Map — 3 рівні**:
   - **Tier 1 (MVP, 2 тижні):** pairing, profile sync, push-to-talk на існуючий `/ws/voice`, live context strip із підпискою на `sensor`+`context`, alerts через foreground notifications, Familiar mobile, settings remote.
   - **Tier 2 (3–5 тижні):** MobileSensorAdapter (GPS+IMU+BLE+WiFi-scan як `SensorBatch`), wardriving у кишені, AR map (MapLibre+ARCore), геофенс→SENTINEL, PPG HRV через камеру, companion-screen.
   - **Tier 3 (6–9 тижні):** Wear OS, Tasker-style automations, GHOST vault з SQLCipher+biometric, approve-on-phone для ROOT-операцій (Ed25519 device-key), mesh-relay, co-pilot mode.
4. **Pairing Protocol** — точний flow: QR (60s TTL) з `pair_id`, `server_pub` (X25519), `server_cert_sha256`, `nonce`. Три ендпойнти `/api/v1/pair/{init,claim,status}`. ECDH→HKDF→HMAC обмін, device long-term Ed25519 у Android Keystore (StrongBox). Cert-pin SHA256 з QR як anti-MITM на LAN без CA. Revocation + 30d auto-revoke.
5. **Data Sync Model** — whitelist полів `User.preferences_json` (theme/language/voice/familiar/notifications); server-only (`pin_hash`, `rfid_uid_hash`, `behavioral_model_json`); phone-only (GHOST-vault, Keystore key); strategic memory — opt-in per record; conflict — last-write-wins з `_meta.{key}_updated_at`.
6. **Транспорт і real-time** — HTTPS+cert-pin (Caddy у prod, mkcert у dev); розширення hub-у керуючими повідомленнями `subscribe`/`unsubscribe` (зворотньо-сумісне з десктопом через `channels=None`); foreground service "PHANTOM Link" з exponential backoff; PTT round-trip budget ≤ 800ms.
7. **Android Architecture для МАКСИМАЛЬНОЇ швидкості** — Kotlin + Jetpack Compose (одна причина: `Modifier.graphicsLayer.renderEffect` для glass blur, чого немає у Flutter/RN); App Startup + Hilt+Lazy + Baseline Profiles + R8 full + per-ABI splits; cold-start <400ms; `@Stable`/`@Immutable` всюди; Filament для GLB Familiar з Skottie-fallback; Room+WAL для кешу, SQLCipher окремо для Vault; Ktor (CIO) поверх OkHttp pool; persistent WS у foreground service з pre-warm на BOOT_COMPLETED через WorkManager.
8. **UI / Layout** — bottom nav 5 tabs: Pulse / Voice / Map / Chat / Vault. Familiar global overlay у нижньому правому. ASCII-схеми для кожного.
9. **Security & Privacy** — Keystore HW-backed device key, BiometricPrompt class 3, EncryptedSharedPreferences для JWT, network_security_config з cleartext=false і CertificatePinner.
10. **Phasing** — 3 фази по 1–3 тижні, success-criteria кількісні (cold-start, PTT round-trip, battery 8h, wardriving latency).
11. **Файли, які треба створити** — список (`mobile/` Gradle composite + backend changes у наступному PR).

### File 2 — `phantom-os/docs/MOBILE_COMPANION_DESIGN.md`

UI-бриф для Claude Code (з якого ШІ генерує Compose-код для кожного екрану). Структура:

1. **Design DNA → Compose theme** — маппинг токенів `sunrise-warm`/`amber-night`/`cyberdeck-cold` у `PhantomTheme` з `ColorScheme` per-state; шрифти через `androidx.compose.ui.text.font.GoogleFont`.
2. **Component recipes** — props/state/animation specs для:
   - `GlassCard(level, blurDp)` з RenderEffect та frosted-PNG fallback для API<31.
   - `OrbView(state, motionScale, audioLevel)` — Canvas, breath cycle 2s, audio-reactive.
   - `FamiliarCanvas(pose, mood)` — Filament `SurfaceView` + Skottie fallback.
   - `StateAccent` (CompositionLocal провайдер accent).
   - `VitalsRow(bpm, breath, stress)`.
   - `PttButton(onPress, onRelease, level)`.
3. **5 wireframes (ASCII)** — Pulse/Voice/Map/Chat/Vault: gridlines, focus order, reactive zones.
4. **Motion specs** — `animateFloatAsState` для motion-scale, `rememberInfiniteTransition` для breath, `AnimatedContent` + `SizeTransform` 320ms FastOutSlowIn для state transitions.
5. **Accessibility** — TalkBack labels, vibration patterns як non-visual cue, 48dp touch targets.
6. **Anti-patterns (явно заборонене)** — без Material You / dynamic color; без сірого app bar; без стандартних `AlertDialog`/`Snackbar`; без default splash logo; без Material icons (lucide-android only); без Activity-state у composable.

## Critical files referenced (read-only, для контексту імплементації наступної фази)

- `phantom-os/src/backend/api/websocket_hub.py` — точка розширення `subscribe`/`unsubscribe`.
- `phantom-os/src/backend/api/routes_auth.py` — сусід для нового `routes_pair.py`.
- `phantom-os/src/backend/db/models.py` — місце для нової таблиці `UserDevice`.
- `phantom-os/src/backend/security/jwt_manager.py` — додати claim `aud="device"` + `device_id`.
- `phantom-os/src/backend/security/login_lockout.py` — шаблон для `pairing_lockout`.
- `phantom-os/src/backend/sensors/sensor_parser.py` — `SensorBatch` приймає optional `mobile`-блок.
- `phantom-os/src/backend/wardriving/collector.py` — телефонний WiFi-scan уже сюди фітиться.
- `phantom-os/src/frontend/src/styles/tokens.css` — джерело істини для перекладу токенів у Compose theme.
- `phantom-os/src/frontend/src/components/familiar/PhantomFamiliar.tsx` + `Familiar3D.tsx` — pose mapping для Compose-port.
- `phantom-os/docs/VISUAL_SYSTEM.md` — обов'язкове джерело для design брифу.

## Verification

- Прочитати обидва файли цілком після створення; вони — самодостатні дизайн-артефакти.
- Перехресна узгодженість: посилання на канали і ендпойнти у Companion збігаються з тим, що реально є в `websocket_hub.py` / `routes_voice_stream.py` / `routes_voice.py` / `wardriving/collector.py`.
- Token mapping (sunrise-warm) у Design-файлі дзеркалить значення з `tokens.css` (hex збігається).
- Anti-patterns секція явно забороняє все, що ламає Visual DNA (Material You, сірий header, стандартні діалоги).
- Файли НЕ створюють і не змінюють жодного коду — суто документація. Імплементація pairing/subscribe/Android-клієнта — окрема фаза, окремий план.

## Out of scope (свідомо не робимо в цьому проході)

- Додавання `mobile/` Gradle root, Compose-коду, Android Manifest.
- Зміни у backend (нова `UserDevice` table, `routes_pair.py`, hub subscribe).
- Зміни у `frontend/` (UI генерації QR на десктопі).
- iOS клієнт (роздум — Phase 4+, через KMM `core-net`+`core-data`).
