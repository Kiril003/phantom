# Plan — Resume Companion v2 mini-OS (native-first, PWA fast-follow)

## Context

Дві сесії шипили паралельно і обірвалися: одна закривала Phase 26 team-org на `phantom-os` (закрита успішно — `db7bd1f`), друга на гілці `companion-v2-phase-0` майже зробила Phase 0 нативного Android Companion v2 ("mini-OS") — створила 16 модулів + wear + app, але **жодного коміту** немає. 18 untracked теk + 3 modified gradle-файли висять у робочому дереві.

Memory + canonical 553-line plan (`docs/MOBILE_PHANTOM_AMBITIOUS.md`) каже: **mini-OS = `phantom-os/companion-android/` (native Compose)**, а `phantom-companion/` PWA = лайт-таргет, тільки багфікси. Оператор обрав «обидва паралельно»: native Phase 0 закрити + Phase 1 стартувати, PWA — швидкий аудит і виправлення відкритих багів як fast follow-up.

Мета цього плану — підняти стан, закрити Phase 0 атомарним комітом, починати Phase 1 (Identity) і паралельно прибрати залишкові PWA баги.

## Поточний стан (verified)

- **Гілка:** `companion-v2-phase-0` (top: `5a77732 phase-22-D`, не пов'язано з Companion)
- **Phase 0 структура:** ✅ повна (`settings.gradle.kts` вмикає 16 модулів + wear + app; `build.gradle.kts` рутовий; `gradle/libs.versions.toml` з 58 deps; кожен модуль має `build.gradle.kts`, `AndroidManifest.xml`, `Module.kt` маркер; app має реальні MainActivity + PhantomLinkService + signing config + debug.keystore)
- **`./gradlew assembleDebug` не запускався до зеленого** — `app/build/outputs/apk/debug/` порожній
- **Не закомічено:** 3 modified + 18 untracked
- **`README.md`:** ще згадує старий шлях `mobile/` (стале)
- **PWA `phantom-companion/`:** Phases 0–5 закриті по README, остання правка PairingScreen R4 03.05 20:52 (auto-camera + scrollable layout + scan banner)

## Pillar A — Закрити Phase 0 native (atomic, ~30 хв)

### A.1 Sanity-перевірка scaffold перед збіркою
- Прочитати `companion-android/settings.gradle.kts`, `build.gradle.kts`, `gradle/libs.versions.toml`, `gradle.properties`
- Прочитати `app/build.gradle.kts` + `app/src/main/AndroidManifest.xml`
- Спот-чек 2-3 модулів: `core-design/build.gradle.kts`, `feature-onboarding/build.gradle.kts`
- Підтвердити, що `aapt2` override на aarch64-native ще на місці (`/usr/lib/android-sdk/build-tools/debian/aapt2`) — Google's x86_64-only буде падати на Radxa

### A.2 Збірка
```bash
cd /home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/companion-android
JAVA_HOME=/usr/lib/jvm/java-17-openjdk-arm64 \
ANDROID_HOME=/home/radxa/android-sdk \
/home/radxa/gradle-8.10.2/bin/gradle assembleDebug --no-daemon --info
```
- Очікую зелений + APK у `app/build/outputs/apk/debug/app-debug.apk`
- Якщо червоне: фіксити мінімально (намespace clash, kotlin compose plugin, AGP мiсметч), повторити

### A.3 README hygiene
- `companion-android/README.md`: замінити stale `mobile/` → `companion-android/` у build-script прикладах (знайдено агентом)

### A.4 Atomic commit
```bash
git add companion-android
git commit -m "companion-v2-phase-0 — composite build scaffold (16 modules + wear + app)

- 9 core modules: core-design, core-net, core-data, core-ai, core-voice, core-vision, core-context, core-bridge, core-sensor
- 7 feature modules: feature-onboarding, feature-pulse, feature-voice, feature-map, feature-comms, feature-vault, feature-driver, feature-launcher
- wear + app
- Version catalog pinned (AGP 8.7.3, Kotlin 2.0.21, Compose BOM 2024.11.00, Ktor 2.3.13)
- assembleDebug → app-debug.apk green on aarch64

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

**Файли (Pillar A):**
- `companion-android/README.md` (edit only)
- 18 untracked module dirs (add+commit, no edits)

## Pillar B — PWA blocker fixes (PRIORITY — apparent on device, before Pillar C)

Оператор щойно показав 2 конкретні баги на встановленому Capacitor APK:

> ❶ `Помилка з'єднання: CLEARTEXT communication to 158.196.114.238 not permitted by network security policy`
> ❷ `на сканування коду через камеру взагалі 0 реакції`

Ці два пов'язані: камера ймовірно сканує QR коректно, потім додаток робить `POST /api/v1/pair/claim` HTTP на Radxa LAN IP `158.196.114.238` — Android блокує cleartext (default API 28+) → exception проковтнутий, UI німий → "0 реакції". Дві симптоми, можливо одна першопричина.

### B.1 Discovery (read-only, ~10 хв)
- `phantom-companion/android/app/src/main/AndroidManifest.xml` — є `usesCleartextTraffic`? є `networkSecurityConfig`?
- `phantom-companion/android/app/src/main/res/xml/network_security_config.xml` — існує? якщо так — які домени дозволені
- `phantom-companion/src/screens/PairingScreen.tsx` + `phantom-companion/src/services/pairing*.ts` — який plugin для QR? (`@capacitor-mlkit/barcode-scanning` ймовірно). Як обробляється result? Є `try/catch` навколо post-scan API виклику? Чи surface'иться error до UI?
- `phantom-companion/src/services/api*.ts` (or `httpClient.ts`) — base URL configurable? чи hardcoded HTTP?
- `phantom-companion/capacitor.config.ts` — `server.cleartext`? `server.allowNavigation`?
- `phantom-companion/android/app/src/main/AndroidManifest.xml` — `<uses-permission android:name="android.permission.CAMERA">`?

### B.2 Fix 1 — Cleartext for LAN Radxa (atomic commit)

Створити/розширити `phantom-companion/android/app/src/main/res/xml/network_security_config.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <!-- LAN-only HTTP for paired Radxa hosts -->
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">158.196.114.238</domain>
    <!-- common LAN ranges; restrict to RFC1918 + link-local -->
    <domain-pattern>10.*</domain-pattern>
  </domain-config>
  <!-- everything else: HTTPS only -->
  <base-config cleartextTrafficPermitted="false">
    <trust-anchors><certificates src="system"/></trust-anchors>
  </base-config>
</network-security-config>
```
Wire в `AndroidManifest.xml` через `<application android:networkSecurityConfig="@xml/network_security_config" ...>`.

`<domain-pattern>` синтаксис не існує у Android — fallback на множинні `<domain>` записи для типових RFC1918 prefixes (`192.168.*.*`, `10.*.*.*`, `172.16-31.*.*`). У реальній імплементації виверну: статично додати `192.168.0.0/16`, `10.0.0.0/8`, `172.16.0.0/12` через окремі `<domain>` теги АБО (простіше) дозволити cleartext тільки для конкретно сейв'нутих pairedHosts hostnames через runtime config patching. Для першого фіксу — **whitelist конкретних IP, що зустрічаються в pair flow + все RFC1918** (compromise — operator явно йшов на LAN, не public internet).

Альтернатива (брутальна): `android:usesCleartextTraffic="true"` у Manifest. Не рекомендую — відкриває все.

Після фіксу: `cd phantom-companion && npm run build && npx cap sync android && cd android && ./gradlew assembleDebug` → перевстановити APK на пристрій → ретест pair.

Atomic commit: `phantom-companion — allow cleartext on RFC1918 LAN for Radxa pair`

### B.3 Fix 2 — Surface scanner errors / no-op investigation (atomic commit)

Залежно від знахідок B.1:
- Якщо QR-scan callback є але exception проковтнутий → wrap у `try/catch`, push toast / inline error у `PairingScreen` ("Не вдалося приєднатися: <reason>")
- Якщо плагін взагалі не ініціалізується → перевірити permission flow на Android (CAMERA + у деяких версіях `BarcodeScanning` потребує окремого `permission.requestPermissions`)
- Якщо код-стрім читається але `claim` не викликається → fix the wiring
- Можливо B.2 cleartext-фікс уже покриє Fix 2 — у такому випадку добавити лише user-visible error на network errors, щоб така ситуація не була мовчазною знов

Atomic commit: `phantom-companion — surface pair errors on QR scan failure`

### B.4 Verify on device
1. `cd phantom-companion && npm run build` зелений
2. `npx cap sync android` no errors
3. `cd android && ./gradlew assembleDebug` → APK у `app/build/outputs/apk/debug/app-debug.apk`
4. `adb install -r ...apk` (через USB або Tasker push)
5. Smoke: відкрити PairingScreen → відсканувати QR з desktop pair-screen → отримати ✅ "Підключено" АБО зрозумілу помилку

**Файли (Pillar B):**
- `phantom-companion/android/app/src/main/res/xml/network_security_config.xml` (створити)
- `phantom-companion/android/app/src/main/AndroidManifest.xml` (edit)
- `phantom-companion/src/screens/PairingScreen.tsx` (edit — error surfacing)
- можливо `phantom-companion/src/services/pairing*.ts` або `api*.ts` (edit — try/catch + retry)

## Pillar C — Phase 1 Identity (kickoff, ~2-3 год активної розробки)

Не намагатися закрити всю фазу 1 за один проход (за canonical doc — 2 тижні). Стартувати foundation атомарними комітами по одній субзадачі за раз.

### C.1 Profile entity + Room + SQLCipher (commit 1)
- `core-data/src/main/java/local/phantom/companion/core/data/profile/Profile.kt` — data class + sealed Role + FamiliarRarity + PairedHost (signature з §3 canonical doc)
- `core-data/src/main/java/local/phantom/companion/core/data/profile/ProfileDao.kt` — Room DAO (insert/update/delete/getById/getAll/observeActive)
- `core-data/src/main/java/local/phantom/companion/core/data/profile/ProfileEntity.kt` — Room @Entity з SQLCipher
- `core-data/src/main/java/local/phantom/companion/core/data/PhantomDatabase.kt` — RoomDatabase з SupportFactory (SQLCipher key from EncryptedSharedPreferences)
- `core-data/src/test/java/.../ProfileDaoTest.kt` — 5+ unit-тестів (CRUD + active switch)

### C.2 Argon2id PIN + BouncyCastle (commit 2)
- `core-data/src/main/java/.../profile/PinHasher.kt` — Argon2id 64MB cost, salt 16B random per profile, верифікація constant-time
- `core-data/src/test/java/.../PinHasherTest.kt` — фіксований hash для known PIN+salt (regression), різні саліти дають різні хеші, verify повертає true/false

### C.3 Onboarding navigation skeleton (commit 3)
- `feature-onboarding/src/main/java/.../OnboardingNavHost.kt` — Compose Navigation з 5 кроками (`who`, `pin`, `bio`, `voice?`, `pair`)
- `feature-onboarding/src/main/java/.../OnboardingViewModel.kt` — Hilt @HiltViewModel, тримає progress + draft Profile у Flow
- `feature-onboarding/src/main/java/.../screens/WhoAreYouScreen.kt` — перший крок (displayName + avatar pick)
- 5 stub screens (інші 4) з placeholder text + кнопкою Next
- `app/src/main/java/local/phantom/companion/MainActivity.kt` — оновити entry point: якщо profile == null → onboarding, інакше → Pulse stub

### C.4 PIN screen — Argon2id integration (commit 4)
- `feature-onboarding/.../screens/SetPinScreen.kt` — 6+ digit pad, confirm second time, hash через PinHasher → запис у драфт
- Touch targets ≥ 56dp (canonical primary)

### C.5 Biometric class 3 (commit 5)
- `core-data/.../profile/BiometricEnroller.kt` — обгортка над `androidx.biometric:1.2.0-alpha05` BiometricPrompt + Keystore-wrapped key (StrongBox if available)
- `feature-onboarding/.../screens/BiometricEnrollScreen.kt` — UI + skip-on-unsupported

### C.6 Profile switcher + persistence wire-up (commit 6)
- Long-press avatar → biometric prompt → SQLCipher unlock per-profile
- Smoke флоу: створити профіль → перезапустити APK → профіль є → swap

**Кожен крок: build green → unit-тести green → atomic commit. Без батчів.**

**Файли (Pillar C):** ~25 нових файлів у `core-data/`, `feature-onboarding/`, `app/`.

## Reuse / existing assets

- Pair crypto з `phantom-os/mobile/` (історичний) — портувати у `core-net/pair/PairCrypto.kt` Phase 2, не зараз
- `OrbView`, `GlassCard`, `PhantomTheme` — існують у v1 mobile, перенести у `core-design/` Phase 1.5 (для onboarding UX)
- Backend pair endpoints (`/api/v1/pair/init|claim|status`) вже задеплоєні на phantom-os (Phase 19) — ніяких змін бекенду для Phase 0–1 не треба
- Existing `app/src/main/java/.../MainActivity.kt` (38 LOC) — мінімально розширити, не переписувати

## Verification (end-to-end)

### Phase 0 ✓ DoD
1. `cd companion-android && /home/radxa/gradle-8.10.2/bin/gradle assembleDebug` → BUILD SUCCESSFUL
2. `ls app/build/outputs/apk/debug/app-debug.apk` → exists
3. `git log --oneline -1 -- companion-android/` → top commit `companion-v2-phase-0 ...`
4. `git status` → робоче дерево чисте на companion-android (окрім нових Phase 1 робіт)

### PWA ✓ DoD
1. `cd phantom-companion && npm run build` → green
2. Якщо були фікси: `cd phantom-companion && npm run test` (vitest) → green

### Phase 1 ✓ Per-commit DoD
1. Кожен коміт: `gradle :core-data:test :feature-onboarding:test` → green
2. Після C.6: APK на пристрої проходить full onboarding (5 кроків), створює зашифрований профіль, переживає cold-restart
3. `gradle assembleDebug` далі зелений на кожному коміті

### Manual smoke (Phase 1 finale)
- `adb install -r app-debug.apk`
- Open app → онбординг → ввести ім'я → PIN 6 цифр → biometric enrol → skip voice → skip pair (Phase 2)
- Force-stop → relaunch → авто-логін на свіжо створений профіль

## Out of scope (для цього плану)

- Phase 1 voice ECAPA-TDNN ONNX (опційний крок, доробляється у наступному циклі)
- Phase 1 QR pair (це Phase 2 First Body — інший план)
- Phase 2-8 з canonical doc — окремі плани
- iOS, custom ROM, voice clone arbitrary speakers, mesh — explicitly excluded by §16
- Будь-які зміни у `phantom-os/src/backend/` (Phase 0–1 не потребують backend mods)
- Touch-up `phantom-companion/` поза bug-fix scope

## Critical files index

| File | Role |
|------|------|
| `phantom-os/docs/MOBILE_PHANTOM_AMBITIOUS.md` | Canonical 553-line plan, sections referenced |
| `phantom-os/docs/MOBILE_COMPANION.md` | Tier 1 pair flow constraints |
| `phantom-os/docs/MOBILE_COMPANION_DESIGN.md` | Compose UI brief (themes, glass levels, anti-patterns) |
| `phantom-os/companion-android/settings.gradle.kts` | 16-module composite include |
| `phantom-os/companion-android/gradle/libs.versions.toml` | Pinned dep catalog |
| `phantom-os/companion-android/app/build.gradle.kts` | App application plugin + signing |
| `phantom-os/companion-android/core-data/build.gradle.kts` | (Phase 1) додати Room + SQLCipher + BouncyCastle deps |
| `phantom-os/companion-android/feature-onboarding/build.gradle.kts` | (Phase 1) додати compose + navigation + biometric deps |
| `phantom-companion/package.json` | PWA scripts (npm run build/test) |

## Execution order (зведено)

Перепорядкована послідовність — PWA blocker'и перед Phase 1, бо без них пейринг не працює і native Phase 1 онбординг не зможе зайти в Phase 2 без робочого pair flow:

1. **Pillar A** — close Phase 0 native (verify build → atomic commit). ~30 хв.
2. **Pillar B** — PWA blocker fixes (cleartext + scanner UX). ~30 хв. **Розблокує оператора прямо зараз.**
3. **Pillar C.1 → C.6** — Phase 1 native foundation, atomic commits. ~2-3 год активної розробки.
4. Final smoke (native APK end-to-end onboarding + PWA pair on phone) + handoff memory update.
