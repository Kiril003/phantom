# PHANTOM Companion — post-compact continuation plan

## Context

`phantom-companion/` (sibling to `phantom-os/`) — мобільна PWA реалізація дизайну з claude.ai/design. Початковий handoff закрив візуал; далі було 3 проходи доробки: видалення Familiar + перехід на real backend stores + усунення overlap-ів, потім real audio pipeline + IndexedDB Vault + Map threat detail + Comms compose + ErrorBoundary + 404 + tests, потім i18n + lazy-loading + AnimatedTabs + theme cross-fade + OrbView easing + reduced-motion + PttButton pressed-state + tagline + pull-to-refresh haptic + Voice auto-scroll + audio-memo service + a11y polish.

User скомпактував контекст і чекає на продовження. Memory snapshot — `~/.claude/projects/.../memory/phantom_companion_state.md` (читай першим після compact).

**Ціль цього проходу:** довести застосунок до повного функціонального покриття — щоб не лишалося напівреалізованих екранів, неперекладених рядків чи "плейсхолдерних" кнопок без логіки.

## Verification baseline (перед стартом цього проходу)

```bash
cd /home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-companion
npm run typecheck    # 0 errors
npm run test         # 7/7 passed
npm run build        # 6 lazy chunks, main 361KB / 116KB gzip
npm run smoke        # 10/10 routes OK, screenshots in /tmp/phantom-shots/
```

Якщо щось не сходиться — спочатку розібратися чому, не починати нову роботу поверх зламаного.

## What ships in this pass (priority order)

### 1. Завершити локалізацію (~30 хв)

`useT()` + `STRINGS` уже існують у `src/i18n/strings.ts`. Локалізовано: Pulse, Voice, Comms, VitalsRow, SplashScreen.

Залишилося:
- `src/screens/MapScreen.tsx` — "All clear", "Threat detail", "Acknowledge", "Close", "Threats" header, layer pills, "radius {n}m".
- `src/screens/VaultScreen.tsx` — "Vault is empty", "Sealed records never leave…", "+ Sealed note", "New sealed note", textarea placeholder, "Cancel"/"Seal & save", "Delete".
- `src/screens/ProfileScreen.tsx` — "Profile", "Not paired", "Edit profile", "Cancel"/"Save", "Forget this device", "Loading…", row labels (Language, Voice profile, Paired, Last seen).
- `src/screens/SettingsScreen.tsx` — Section titles (Theme, System State, Motion, Communications, Device), hints, "Open design showcase".
- `src/screens/PairingScreen.tsx` — "Pair this device", "Open PHANTOM OS…", "Start camera scan", "Camera scan unsupported", "Or paste QR text", "Claim device", step labels.
- `src/screens/InCallScreen.tsx` — "decline"/"AI screen"/"answer", "PHANTOM · context", "No prior context".
- `src/components/EmptyState.tsx` залишити як є (приймає `title`/`hint` як props).

Додати недостатні ключі у `STRINGS.uk` + `STRINGS.en` коли треба.

### 2. Audio-memo flow у Vault (~45 хв)

`src/services/audioMemo.ts` уже реалізує MediaRecorder з opus/webm fallback. Треба підключити до UI:

- У `VaultScreen.tsx` додати другу CTA в empty-state та поряд з sealed-note FAB: "🎙 Голосова нотатка".
- Новий `AudioRecordModal` (компонент): великий мікрофон-orb, 60s ліміт, live waveform via AnalyserNode, кнопки "Скасувати"/"Запечатати".
- При stop → `AudioMemoHandle.stop()` → отримуємо `Blob`. Серіалізуємо в `ArrayBuffer` (через `blob.arrayBuffer()`), шифруємо тим же `vaultCrypto.sealNote` (треба узагальнити — переіменувати у `sealBytes/openBytes` або додати окремі функції для Uint8Array). Зберігаємо у IndexedDB як `kind: 'audio'`, `size: '0:32 · audio/webm'`.
- При unlock записів типу `audio` → відтворити через `URL.createObjectURL(new Blob([decryptedBytes], { type: mime }))` + `<audio controls>`.

Файли: `vaultCrypto.ts` (узагальнити), `vaultStorage.ts` (вже підтримує `kind`), `screens/VaultScreen.tsx`, новий `components/AudioRecordModal.tsx`.

### 3. Comms voicemail playback + dial action (~30 хв)

В `screens/CommsScreen.tsx` для рядків `kind === 'voicemail'` додати в-row playback button (▶) — поки що показує toast "playback queued — backend stub" якщо `audioUrl` не передано. Коли backend почне посилати `audio_url` field у row, відтворювати через прихований `<audio>` element.

Для `kind === 'call'` додати swipe-action або long-press → "🔁 Передзвонити" → `wsHub.send('comms', { kind: 'dial', peer })`.

Розширити `CommsRow` тип: `audioUrl?: string` для voicemail, `phoneNumber?: string` для callback.

### 4. Skeleton loaders при initial WS connect (~20 хв)

Skeleton component уже є (`src/components/Skeleton.tsx`) з shimmer animation. Використати у:
- `PulseScreen` — поки `connectionStore.status === 'connecting'` && `!vitals && !quote`, рендерити 3 placeholder cards замість порожнього стану. Через ~3s якщо так і нема даних → empty states як зараз.
- `CommsScreen` — поки fetching first batch (трекати в `commsStore.loading: boolean`).
- `MapScreen` — те саме для threats.

Логіка: новий hook `useChannelLoading(channel: Channel)` що повертає `true` поки connection !== 'online' AND store ще не отримав жодного payload.

### 5. Map: реальний MapLibre preview (~60 хв)

Зараз — fake gradient + grid + roads via SVG. Підключити `maplibre-gl` (~400KB gzip — суттєво, але виправдано):
- `npm install maplibre-gl`
- Новий компонент `components/MiniMap.tsx` з MapLibre Canvas, що приймає center/zoom/markers через props.
- Tile source: OpenFreeMap (`https://tiles.openfreemap.org/styles/positron`) — безкоштовний, без API ключа.
- Markers — overlay через `<Marker>` з threat pins.
- Lazy-load цей chunk (як інші screens) щоб не роздути main bundle.

Альтернатива (легша): Leaflet ~40KB. Але MapLibre краще для майбутнього AR + offline tiles.

### 6. Кінцевий smoke + commit (~15 хв)

```bash
npm run typecheck && npm run test && npm run build && npm run smoke
```

Усе має бути зеленим. Подивитися 10 screenshots у `/tmp/phantom-shots/`. Якщо все ОК — commit з повідомленням типу:

```
feat(companion): localize all screens, wire audio-memo flow, voicemail playback, skeleton loaders, MapLibre preview

- i18n: complete uk+en coverage across all screens
- vault: audio-memo recording with AES-GCM encryption
- comms: voicemail playback button + callback action
- skeleton loaders during initial WS connect
- MapLibre tiles via OpenFreeMap (lazy-loaded)
- tests: 7/7 still passing
```

## Critical files to know

| File | Why it matters |
|---|---|
| `src/i18n/strings.ts` | додавай нові keys у обидва словники |
| `src/hooks/useT.ts` | `t(key, vars)` хук |
| `src/services/audioMemo.ts` | вже готовий MediaRecorder wrapper |
| `src/services/vaultCrypto.ts` | `sealNote/openNote` — потрібно узагальнити для bytes |
| `src/services/vaultStorage.ts` | IndexedDB CRUD |
| `src/services/wsHub.ts` | `wsHub.send(channel, payload)` |
| `src/state/commsStore.ts` | extend `CommsRow` type if adding fields |
| `src/state/connectionStore.ts` | для skeleton-loading logic |
| `docs/ROADMAP.md` | живий tracker — оновити після кожного завершеного пункту |

## Out of scope для цього проходу

- Capacitor native shell wrap (Phase 6) — окрема велика робота, обговорити з user окремо.
- Real WS backend integration (потребує phantom-os сервер працюючий + pairing endpoints) — поки що тестуємо з seeded localStorage.
- Wear OS extension (Phase 6).
- BLE proximity beacons.

## Verification кінцева

Після всіх 6 пунктів:
1. `npm run typecheck` — 0 errors strict
2. `npm run test` — 7/7+ passing (можливо більше якщо додасте vault audio round-trip)
3. `npm run build` — main bundle не виріс понад 400 KB (MapLibre lazy chunk окремо)
4. `npm run smoke` — всі 10 routes без runtime errors
5. Перейти у Settings → Profile → змінити `language: 'uk' | 'en'` → переглянути всі screens обома мовами вручну (через playwright або в браузері)
6. Vault: записати голосову нотатку → unlock → playback працює
7. Map: показуються реальні tile-кахлі OpenFreeMap (не SVG grid)

Якщо все це зелене — пуш і scheduled follow-up на Capacitor wrap через 2 тижні.
