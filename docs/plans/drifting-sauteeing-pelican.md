# Standalone PHANTOM Companion — phone alive without phantom-os

## Context

Оператор: "чому без підключення до десктопного як без рук? та і
функціоналу мало, виправляй". Поточний PWA побудований як
paired-first: Chat мертва без phantom-os (aiRouter повертає
`backend:'queued'`), NowScreen показує лише banner "не пейрнуто",
Inbox порожній. Корисні standalone лише Map, Vault, Me, Senses,
Diag. Це не прийнятно — телефон повинен бути вже-сам-собою-AI-помічник,
а phantom-os додає (а не замінює) можливості.

Цей раунд закладає **standalone-first** основу: чат працює коли
оператор вписав власний Gemini/OpenAI API-ключ; з'являються
local-only Notes / Timer / Weather; NowScreen показує грід корисних
дій замість порожнього "не пейрнуто".

## Working directories

- **PWA:** `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-companion/`
- **Backend:** `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/` (нічого не міняємо цей раунд)

## Track A — Direct AI keys (BIGGEST UNLOCK)

**Мета:** коли phantom-os недосяжний, чат відповідає через
оператор-вводжений Gemini або OpenAI API-ключ напряму з телефону.

**Файли:**
- `src/services/aiRouter.ts` (LINE ~55 `decideRouting`, LINE ~160 `chatTurn`) — розширити `RouterPolicy` на `{ directProviders: ('gemini'|'openai')[] }`. Додати backends `'direct-gemini'` + `'direct-openai'`.
- `src/services/directLlm/gemini.ts` (NEW) — REST до `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent` з ключем у Authorization. Адаптер на ChatTurnResult shape.
- `src/services/directLlm/openai.ts` (NEW) — аналогічно `https://api.openai.com/v1/chat/completions`.
- `src/services/directLlm/index.ts` (NEW) — спільний `selectDirectProvider()` що читає ключі з secureStore і вибирає перший доступний.
- `src/services/native/secureStore.ts` (existing) — нові ключі `profile.{id}.geminiApiKey`, `profile.{id}.openaiApiKey`.
- `src/screens/MeScreen.tsx` — нова `<Section title="AI ключі (standalone)">` після "Foreground service" з masked-input для обох ключів + "🧪 Тест" button (виклик `chatTurn({text:'ping', forceProvider:'direct-...'})`).

**Routing chain:** paired+online phantom-os → direct-gemini (якщо ключ) → direct-openai (якщо ключ) → graceful "запиши свою думку — phantom-os offline" message.

**Tests:**
- `services/__tests__/directLlm.test.ts` — mock fetch, verify request shape + response parse.
- `services/__tests__/aiRouter.test.ts` extend — assert direct-gemini chosen when key set + paired=false.

## Track B — Local Notes (markdown, zero-dep)

**Мета:** quick-capture markdown notes що живуть в localStorage,
працюють без жодного backend, search-friendly.

**Файли:**
- `src/state/notesStore.ts` (NEW) — zustand store: `notes: Note[]`, `upsert/remove/rename`. Persist `phantom.notes.v1`. Кожна нота: `{id, title, body, tags[], pinned, ts, modifiedTs}`.
- `src/screens/NotesScreen.tsx` (NEW) — список + редагований view + search by title/body/tags. Markdown render через мінімальний inline parser (`#`, `-`, `**`, `[ ]` → checkbox, `[x]` checked).
- `src/components/UtilityDrawer.tsx` (existing ENTRIES array) — додати `{to:'/notes', icon:'≡', label:'Нотатки', hint:'Markdown, тільки локально'}`.
- `src/App.tsx` — route `/notes` → `<NotesScreen />`.

**Tests:** `state/__tests__/notesStore.test.ts` — upsert / search / persistence.

## Track C — Local Timer / Pomodoro / Alarm

**Мета:** повний таймерний застосунок з push-нотифікаціями що
працюють навіть коли застосунок закритий (через
`@capacitor/local-notifications` що вже встановлений).

**Файли:**
- `src/state/timerStore.ts` (NEW) — `{timers: Timer[]}` з типами
  `'countdown' | 'alarm' | 'pomodoro'`. Persist `phantom.timers.v1`.
- `src/services/timerScheduler.ts` (NEW) — `scheduleTimer(timer)` ⇒
  Capacitor `LocalNotifications.schedule({id, title, body, schedule:{at}})`.
- `src/screens/TimerScreen.tsx` (NEW) — list + add/edit + start/stop.
  Pomodoro preset (25/5).
- `src/components/UtilityDrawer.tsx` — entry `/timer`.
- `src/App.tsx` — route.

**Tests:** `state/__tests__/timerStore.test.ts` — lifecycle + persist;
`services/__tests__/timerScheduler.test.ts` — mock notifications, verify schedule call.

## Track D — Weather (Open-Meteo, no key)

**Мета:** показати поточну погоду + 24h forecast прямо на NowScreen
коли GPS відомий.

**Файли:**
- `src/services/weatherClient.ts` (NEW) — Open-Meteo `https://api.open-meteo.com/v1/forecast?latitude=...&longitude=...&current=temperature_2m,weather_code,wind_speed_10m&hourly=temperature_2m,precipitation_probability&timezone=auto`. Cache 30 хв.
- `src/components/WeatherCard.tsx` (NEW) — компактна картка: temp + symbol + 24h sparkline.
- `src/screens/NowScreen.tsx` — рендерити `<WeatherCard />` коли `mapStore.deviceLocation` відомий.

**Tests:** `services/__tests__/weatherClient.test.ts` — mock fetch, verify parse.

## Track E — Standalone-aware NowScreen

**Мета:** замість пустого "не пейрнуто" — показати грід доступних
standalone-фіч + один-тап входи: Notes, Timer, Map, Vault, Senses,
Voice (web-speech), Weather.

**Файли:**
- `src/screens/NowScreen.tsx` — новий блок `<StandaloneCapabilitiesGrid />` що з'являється коли `connStatus !== 'online'`. 6 карток: Notes / Timer / Map / Vault / Senses / Weather (якщо GPS) — кожна показує підказку що вона робить локально. Banner "не пейрнуто" перейменовується на "phantom-os offline · ти все одно можеш" з link на /pair.
- `src/components/StandaloneCapabilitiesGrid.tsx` (NEW).

## Track F — Build + commit + handoff

**Мета:** APK r4, memory handoff.

1. `npx tsc --noEmit` — clean
2. `npx vitest run` — 280+ зелено
3. `./scripts/build-apk.sh`
4. Memory handoff `handoff_2026-05-04_standalone_phone.md` + MEMORY.md update
5. APK у `~/Downloads/phantom-companion-standalone.apk`

## Critical files to read before implementation

- `src/services/aiRouter.ts` — поточна 3-режимна логіка
- `src/services/native/secureStore.ts` — для AI keys
- `src/screens/NowScreen.tsx` — щоб розуміти поточний unpaired UX
- `src/screens/MeScreen.tsx` lines 715-735 — для додавання AI keys section
- `src/components/UtilityDrawer.tsx` — ENTRIES array

## Reuse / no-rebuild

- secureStore secureSet/secureGet/secureRemove — готові, використовуємо як є
- LocalNotifications вже встановлений — wrapper `services/native/notify.ts` існує (можна розширити, не переписувати)
- Capacitor Preferences → secureStore wrapper — готовий
- ChatScreen вже має retry + via tag — нам тільки треба нові backends в aiRouter
- vitest.setup.ts polyfills — готові
- Section / Row / PrimaryButton / SecondaryButton patterns в MeScreen — використовуємо для AI keys section

## Verification

```bash
cd /home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-companion
npx tsc --noEmit                                          # strict clean
npx vitest run                                            # 280+ зелено (262 → ~280-300)
./scripts/build-apk.sh                                    # ~6.5-7 MB APK
```

Manual on device:
1. Встанови APK
2. Без пейрингу → відкрий Чат → введи питання → має сказати "phantom-os offline, додай Gemini ключ у /me"
3. Перейди /me → AI ключі (standalone) → встав Gemini key → 🧪 Тест має повернути "ok"
4. Знов Чат → запит → реальна відповідь з тегом "via direct-gemini"
5. /notes → створи кілька → reload → залишились
6. /timer → постав 1-хвилинний → закрий застосунок → зачекай → нотифікація прийшла
7. /now без пейрингу → грід standalone-фіч + WeatherCard (якщо GPS дав координати)

## Out of scope (next round candidates)

- Local Todo (Notes-with-checkboxes покриває MVP)
- Calculator / unit converter / password generator
- Clipboard manager
- Local OCR-to-notes pipeline (Senses вже має OCR; інтеграція пізніше)
- WebLLM on-device model (heavy, потребує WebGPU; direct API key вже покриває use case)
- Local journaling AI prompts
- Phone-to-phone P2P sync для Notes/Timer (потребує signaling сервер)
