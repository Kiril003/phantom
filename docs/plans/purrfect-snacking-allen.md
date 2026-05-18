# Audit: Що ще не працює / не пропрацьовано

## Context

Після phase-22-E + phase-27-b (settings/chat візуальні діета-проходи) операторе питає що ще лишилося. Цей план — пріоритезований реєстр відкритих фронтів. Скоп: **інвентаризація**, без виконання. Приймаєш — виконую по черзі окремими атомарними phase-комітами.

Корінь репо: `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os`. Гілка: `companion-v2-phase-0`.

---

## A. Companion Android v2 — Phase 0 НЕ КОМПІЛИТЬСЯ

Untracked у git: 18 module-каталогів + зміни в build/settings/libs.versions. Скоп Phase 0 з `docs/MOBILE_PHANTOM_AMBITIOUS.md` §11: 16 модулів + `:app` + `:wear`, `./gradlew assembleDebug` зелений.

**Реальний стан:**
- 19 модулів у `companion-android/settings.gradle.kts` (рядки 46–70) ✓ всі прописані
- 15 з 19 — пусті заглушки (`AndroidManifest.xml` + одна Module.kt-marker або взагалі нуль `.kt` файлів)
- `:app` має 24 `.kt` файли (живий, з PhantomApp/MainActivity/PhantomLink/screens/components)
- Тільки `core-design`, `core-net`, `core-data` мають Module.kt-маркер; решта 12 (`core-ai`, `core-voice`, `core-vision`, `core-context`, `core-bridge`, `core-sensor`, всі `feature-*`, `wear`) — повністю порожні `src/main/java/`
- **`gradlew` (виконуваний) ВІДСУТНІЙ** у `companion-android/`. `gradle/wrapper/` існує, але самого скрипта нема → нічим запустити збірку
- Жоден з 16 порожніх модулів не має `build.gradle.kts` із плагіном `com.android.library` → AGP не зможе їх обійти навіть з gradlew

**A1 — Blockers Phase 0:**
1. Згенерувати `gradlew` + `gradlew.bat` (або скопіювати з `phantom-companion/`)
2. Додати у кожен з 16 порожніх модулів мінімальний `build.gradle.kts` (`com.android.library` + namespace + Kotlin) + `Module.kt` marker, щоб композитна збірка пройшла
3. Закомітити untracked модулі один атомарним phase-0 commit
4. Запустити `./gradlew assembleDebug` → зелений APK (acceptance criterion з §19)

**Файли:** `companion-android/{gradlew,gradlew.bat}`, `companion-android/{core-ai,core-voice,core-vision,core-context,core-bridge,core-sensor}/build.gradle.kts`, `companion-android/feature-{onboarding,pulse,voice,map,comms,vault,driver,launcher}/build.gradle.kts`, `companion-android/wear/build.gradle.kts`, плюс відповідні `Module.kt` маркери.

---

## B. Backend — реальні діри (не «mock`и`», а гнилі плейсхолдери)

**B1 — Hub.dispatch() raises NotImplementedError**
- `src/backend/ai/hub.py:179-183`. Picker/list/route_state працюють, але виклик dispatch() падає. Імпорт є, тому одна неуважна зміна на чат-pipeline кине `500`.
- Або реалізувати dispatch (просто делегувати в активний `AIProvider`), або кинути deprecation ворнінг + сховати dispatch з public API до Day-5.

**B2 — Visual Grounding stub**
- `src/backend/agent/actions/grounded.py:26-36`. `GroundedParam.resolve()` raises NotImplementedError якщо grounder is None. Phase 24-V (visual see→click) уже залежить від цього у фоні.
- Реалізувати fallback на screenshot+OCR pipeline (вже є у phase 24-V) або задокументувати feature gate.

**B3 — Sensor settings без firmware**
- `src/backend/sensors/command_sender.py:5-13` приймає `radar_sens`, `radar_max`, `breath_on`, `gps_on`, `wifi_ival`, `oled_bri` — UI пише, бекенд логує, ESP32 ігнорує. 6 ключів настройок з мітками `[soon]`.
- Або (а) додати у `src/firmware/src/json_protocol.cpp` парсинг цих 6 полів + застосування в actuator_ctrl, або (б) сховати ключі з реєстру settings до того, як firmware догнало.

**B4 — Archive Memory без AES**
- `src/backend/memory/archive_memory.py:6-9`. `security_ghost_auto_encrypt` config-ключ є, ефекту нема. GHOST records — plaintext.
- Реалізувати AES-256-GCM sealing (інфраструктура з phase 25-A vault уже має примітиви — `src/backend/security/crypto.py`), або вимкнути ключ.

**B5 — Speaker resolver returns None**
- `src/backend/voice/identity/resolver.py:24-52`. Always-on speaker labelling завжди повертає `None`. Frozen signature до Day-5.
- Документувати в UI що speaker recognition вимкнено, або зняти його з налаштувань.

---

## C. Frontend — справжні баги (не косметика)

**C1 — Hardcoded `ai_provider: 'gemini'` у streamingMessageShape**
- `src/frontend/src/components/chat/ChatWindow.tsx:51`. Streaming bubbles завжди показують «gemini» незалежно від реального провайдера.
- Замінити на `useSystemStore((s) => s.context?.system?.ai_provider) ?? 'gemini'` (вже використовується для `activeProvider` у тому ж файлі, рядок 120).

**C2 — `console.log` на кожен рендер App**
- `src/frontend/src/app/App.tsx:132`. Спамить продакшен консоль.
- Видалити.

**C3 — Touch target violations <44×44**
- `src/frontend/src/components/agent/FeedbackButtons.tsx:39-40` — 28×28 (worst, 16px нижче WCAG)
- `ChatWindow.tsx:547-548` — voice button 26×26 (у session list, не на input rail)
- `ChatWindow.tsx:380-381` — close button 32×32 (теж sessions list)
- Wrap у `minWidth: 44, minHeight: 44` зберігаючи візуальний розмір через padding.

**C4 — `console.warn` спам у production stores**
- `src/frontend/src/stores/agentStore.ts` (4×), `studioStore.ts` (6×), `mapStore.ts:181`. Defensive logging — не порушує CLAUDE.md, але засмічує консоль.
- Замінити на `// noop` або throw до error-boundary.

---

## D. Структурний борг — компоненти-монстри (>400 LOC)

| LOC | Файл |
|----:|------|
| 2445 | `src/frontend/src/components/settings/SettingsPanel.tsx` |
| 1333 | `src/frontend/src/components/map/TacticalMap.tsx` |
| 1179 | `src/frontend/src/components/core/Overlays.tsx` |
| 1125 | `src/frontend/src/components/chat/ChatWindow.tsx` |
| 952 | `src/frontend/src/components/studio/AgentStudioOverlay.tsx` |
| 862 | `src/frontend/src/components/settings/MobilePairing.tsx` |

CLAUDE.md: "Keep files under 500 lines". Усі 6 порушують. SettingsPanel — 6× ліміт. Розщеплення — окрема, велика робота (~1 день кожен файл), не для авто-режиму.

---

## E. Hidden debt — `СКОРО` бейдж

`SettingsPanel.tsx:1048-1062` рендерить `СКОРО` коли `def.unimplemented === true`. Бекенд зараз фільтрує такі ключі взагалі (`UNIMPLEMENTED_KEYS` у `routes_settings.py`), тому бейдж зараз не видно. Один backend flip → купа half-implemented рядків з’явиться. **Рекомендація:** прибрати дед-код бейджа доки немає experimental view; або реалізувати experimental view як офіційну фічу.

---

## Recommended Action Order

Якщо ти схвалиш план, я виконую в такій послідовності (кожен пункт — окремий атомарний phase-X commit, тести як gate):

1. **C1 + C2 + C3** (chat hardcoded provider, App console.log, touch targets) — швидкі правки, високий impact, ~30 хв
2. **A1** (Companion v2 Phase 0 unblocking — gradlew + 16 порожніх module gradle файлів + Module.kt маркери + один атомарний commit) — це найбільший зависняк сесії, ~45 хв
3. **B1** (AIHub.dispatch — або реалізувати, або сховати з public API) — ~30 хв
4. **B3** (sensor settings — або firmware reach, або зняти ключі) — потребує рішення оператора чи firmware-роботу робити зараз
5. **B4** (archive AES) — повторне використання `security/crypto.py`, ~1 год
6. **D1** (SettingsPanel split на ~5 під-файлів) — окрема довша робота, не в авто-режимі

## Verification

- Після C-серії: `npm test` у `src/frontend` (chat + settings suites = 60 тестів)
- Після A1: `cd companion-android && ./gradlew assembleDebug` → зелений APK
- Після B1: `pytest src/backend/tests` (повний suite, 141+ тестів)
- Після B3/B4/B5: relevant pytest pattern (`pytest -k sensor` etc.)
