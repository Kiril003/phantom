# PHASE 24 — OMNIMAP (Map Reimagining) + 24-PRE Repair

## Context

Користувач замовив **повне переосмислення мапи PHANTOM** із багатьма цілями:
1. Вбудувати **багато безкоштовних/корисних API** (тайли, маршрути, погода, OSINT, супутник, авіація, маринаристика, RF, Ukraine-specific).
2. Інтегрувати AI як **єдину систему** — кожна функція мапи доступна з чату/голосу.
3. Підтримати **туристичні + користувацькі + хакерські + дослідницькі** сценарії.
4. Дуже адаптивна, багато налаштувань, 1000+ функціоналу.

Окремо користувач повідомив: **«натискаю на кнопки і 0 реакції — ніби нічого не обробляється або не інтегровано з картою візуально»**. Діагностичні агенти знайшли:
- **TacticalMap.tsx:414-420** — Satellite та Compass кнопки відрендерені без `onClick` → клік = no-op.
- **TacticalMap.tsx:268-276** — вся data-load шарів gated `if (!ready)`, де `ready` ставиться лише після `map.on('load')`. Якщо стиль не завантажився (мережа/key/CORS) → `ready=false` → шари мовчки не вантажаться → виглядає як «кнопки не реагують».
- **api.ts** — мережеві помилки ковтаються через `.catch(() => {})` без видимої сигналізації.

Мета: запропонувати поетапний амбіційний план, який **спочатку чинить наявне** (24-PRE), а потім будує OmniMap (24-A → 24-Z).

Повний детальний документ уже існує: `docs/phases/PHASE_24_OMNIMAP.md` (1026 рядків) — він і є канонічна специфікація. Цей файл — короткий план виконання.

## Recommended Approach

Реалізуємо у такому порядку, кожен блок = окремий commit з тестами:

### 24-PRE — Diagnostic & Repair (~1 day, must ship first)
1. **Полагодити Satellite кнопку**: `onClick` перемикає `mapStore.styleId` між `dark`|`streets`|`satellite`; вже є `mapTokens.ts` стилі → додати селектор + persist в settings (`ui_map_style`).
2. **Полагодити Compass кнопку**: підписатись на `map.on('rotate')`, відображати real bearing у chip, click → `map.rotateTo(0, {duration: 400})`.
3. **Surface map-style/load errors**: замінити `.catch(() => {})` у TacticalMap.tsx:271 на `.catch(err => useToastStore.getState().pushError(...))`. Додати `map.on('error', ...)` слухач, що пише у ServicesHealthBanner.
4. **Add `ready` timeout fallback**: якщо за 5s `ready` не true → показати inline error «Mapbox style failed to load — check connectivity». Додати retry-кнопку.
5. **Auth-token UX**: коли `phantom:unauthorized` event — показати toast «Сесія прострочена», redirect на `/login`.
6. **Tests**: vitest для toggle-style action, для error toast pipeline; Playwright screenshot diff на стилі dark/streets/satellite.
7. **Commit**: `phase-24-pre — repair stub HUD buttons + surface map errors`.

### 24-A — Layer Registry + Map Cache + Attribution (~1 day)
- `src/backend/geo/layer_registry/` (Pydantic + YAML).
- 12 manifests для існуючих шарів (base/presence/wardriving/heatmap/intel/recon/facts + 5 нових).
- `MapCache` (memory + SQLite + disk, TTL).
- Frontend `AttributionDrawer.tsx` + `useAttribution` хук.
- API: `GET /map/layers`, `POST /map/layers/<id>/enable`.
- Tests: registry validation, cache TTL, attribution dedup.

### 24-B — Agent Action Surface (12 базових verbs) (~1 day)
- `src/backend/agent/actions/map/`: `open_map`, `set_view`, `flyto`, `add_marker`, `query_nearby`, `geocode`, `reverse_geocode`, `list_layers`, `enable_layer`, `disable_layer`, `snapshot`, `explain_view`.
- Реєстрація у `agent/actions/registry.py`.
- WebSocket channel `map.*`.
- Frontend `useMapAgentBridge.ts` хук (subscribes до WS, мутує map).
- Tests: contract per action, end-to-end chat→action→map mutation.

### 24-C → 24-Z — повний OmniMap stack
26 ship-блоків з повними деталями у `docs/phases/PHASE_24_OMNIMAP.md`:
- **24-C** — Routing facade (BRouter offline + ORS online)
- **24-D** — OmniMap shell + HUD redesign
- **24-E** — Layer Library + 20 нових layer manifests
- **24-F** — Live awareness layers (air-raid UA, frontline, blackout)
- **24-G** — Offline region manager (PMTiles)
- **24-H** — Time machine + change detection
- **24-I** — Geofence engine
- **24-J** — OSINT/Recon layers (Hacker mode, ROOT-only)
- **24-K** — Tour guide + Recon brief (AI narrative)
- **24-L** — Astronomy bundle (TLE, ISS, sun/moon, aurora)
- **24-M** — Marine + Aviation (AIS, ADS-B, airports, airspace)
- **24-N** — Energy & infra deep (substations, solar, wind)
- **24-O** — Mobile companion map sync
- **24-P** — GHOST mode + sealed zones (AES-256-GCM)
- **24-Q** — Annotations + free-form drawing
- **24-R** — Translation + multilingual labels
- **24-S** — Wardriving 2.0 (auto-correlate Wi-Fi/cell)
- **24-T** — Photo & street imagery (Mapillary, Flickr, Wikimedia)
- **24-U** — Performance + clustering (vector layer migration)
- **24-V** — Voice ↔ Map full duplex
- **24-W** — Settings UI complete (12 секцій)
- **24-X** — Easter eggs (Mars, Corona, DREAM time-lapse)
- **24-Y** — Documentation + wiki integration
- **24-Z** — Polish + 7-day soak + acceptance video

**Цільові метрики acceptance**:
- ≥80 шарів у реєстрі (40 у v1)
- ≥100 chat-actions з тестами
- 60 fps з 5k маркерів + 6 шарів + ADS-B live на Radxa Dragon Q6A
- GHOST mode = zero outbound traffic
- Voice ≥95% accuracy на 30 фікс-фразах
- Offline-first працює без інтернету (Protomaps + Photon + BRouter + Overpass-local + GLO-30 DEM)

## Critical Files

### Існуюче — reuse
- `src/frontend/src/components/map/TacticalMap.tsx` (1126 LOC) — ремонт у 24-PRE, потім shrink у 24-D
- `src/frontend/src/components/map/MapContext.tsx`, `mapTokens.ts`, `MarkerCard.tsx`, `NearbyPanel.tsx`, `TimelineDrawer.tsx`, `ServicesHealthBanner.tsx`
- `src/frontend/src/components/map/layers/*.tsx` (7 існуючих шарів — обернути в registry-driven)
- `src/frontend/src/stores/mapStore.ts` — extended до `omnimapStore.ts` з compat shim
- `src/backend/api/routes_map.py` (500 LOC) — extended з 11 → 60+ ендпоінтів
- `src/backend/memory/geo_integration.py`, `geo_query.py`, `geo_extractor.py` — reused
- `src/backend/wardriving/heatmap.py`, `collector.py` — reused
- `src/backend/agent/localization/sources/browser_geolocation.py`, `adapters/overpass.py` — reused
- `src/shared/types/wardriving.ts` + new `src/shared/types/map.ts`

### Нове — створити
- `src/backend/geo/` (новий домен — registry, cache, attribution, sources/, routing/, tilesets/, intelligence/)
- `src/backend/agent/actions/map/` (100+ chat-action файлів)
- `src/backend/api/routes_geo_layers.py`, `routes_geo_routing.py`, `routes_geo_tiles.py`, `routes_geo_offline.py`, `routes_geo_intel.py`
- `src/frontend/src/components/map/OmniMap.tsx`, `hud/*`, `layers/*` (40+ нових шарів), `cards/*`, `panels/*`, `hooks/*`, `state/*`
- `src/frontend/src/utils/pmtilesProtocol.ts` (MapLibre custom protocol)

### Тестові
- `src/backend/tests/test_phase24_<X>_*.py` — pytest contract per action, registry validation, cache TTL
- `src/frontend/src/__tests__/phase24_<X>/*.test.tsx` — vitest для store/hooks/components
- `src/frontend/playwright/phase24/` — screenshot diff на 1024×600 для кожного SystemState

## Verification

### Per-block (after every 24-X commit)
1. **Backend**: `cd src/backend && pytest tests/test_phase24_<X>_*.py -v` — 100% pass
2. **Frontend**: `cd src/frontend && npx vitest run src/__tests__/phase24_<X>` — 100% pass
3. **Type check**: `cd src/frontend && npx tsc --noEmit` — strict, 0 errors
4. **Lint**: `cd src/frontend && npx eslint src/components/map src/stores src/services` — 0 errors
5. **Visual diff**: `cd src/frontend && npx playwright test phase24/` — diff ≤ 0.1%

### Manual smoke tests (24-PRE specifically)
1. Open `/map` route, click each HUD button, verify:
   - **Satellite chip** → tile style switches to satellite, attribution updates
   - **Compass chip** → shows current bearing in real-time, click resets to north
   - **Layer chips** (base/presence/wardriving/heatmap/intel/recon/facts) → markers appear/disappear, network tab shows successful API call
   - **Zoom +/−**, **Center to Me**, **Drop POI** — already work, verify no regression
2. Disconnect network, reload `/map` → expect inline error «Style failed to load» with retry button (not silent black map)
3. Expire JWT (DevTools → Application → localStorage → delete `phantom_token`) → click any layer → expect toast «Сесія прострочена», redirect `/login`

### End-of-phase acceptance (24-Z)
1. 5-хвилинне відео-демо: голосом українською без жодного кліку — tour-guide → recon-brief → air-raid alert → offline download → ghost drop. Артефакт: `docs/phase-24-acceptance-demo.mp4`
2. 7-day soak run на Radxa: telemetry зібрана; перевірка memory leak, fps stable, no crash
3. Final тести: `pytest -k phase24` + `vitest --run phase24` + `playwright phase24/` всі зелені
4. Acceptance markdown: `docs/PHASE_24_OMNIMAP_ACCEPTANCE.md`

### Reference document
Повна специфікація: `docs/phases/PHASE_24_OMNIMAP.md` — 16 секцій:
- Vision, Doctrine (10 принципів)
- Architecture (backend + frontend + AI bridge)
- Layer Registry + 80-шарова таблиця
- 100+ agent action surface (повний список)
- Settings (12 секцій)
- UI/UX (1024×600 layout)
- Mobile companion
- Offline-first stack (~66 GB)
- Privacy/GHOST/sealed
- Tests doctrine
- 26 ship-блоків деталі
- Risks + mitigations
- Acceptance criteria
