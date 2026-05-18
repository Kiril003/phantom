# MAP-AI-1 .. MAP-AI-14 — План deep-AI map integration

## Context

PHANTOM Companion вже має production-grade map-стек (MAP-1..MAP-6, 13 файлів, ~2560 LOC) — провайдери тайлів, Nominatim search, reverse-geocode, offline регіони, in-chat MapWidget. **Проте ШІ працює з мапою лише як з output-каналом**: `[LOCATION:lat,lon]` ін'єкція + повернення `{"type":"map", payload:{...}}` віджета. Жодних tool-calls, жодного програмного доступу до search/route/geofence, жодної інтеграції з симбіонт-модулями (Memory Palace, Mood Arc, RollingBuffer, AnchorRouter, SensorChannel).

Результат: AI може **показати** мапу, але не може **діяти** з нею. Це ~60% від conversational map, 0% від agentic map.

Vision-документ обіцяє spatial-symbiote з пам'яттю місць, haptic-навігацією, mesh family-presence, mood-aware маршрутами, sub-meter accuracy. Все це **вже instantiated** в `:core-*` модулях, але **не wired** в AI/UI пайплайн.

**Мета цього плану:** 14 атомарних фаз які:
- закладають foundation для tool-calls (AI може програмно діяти)
- покривають parity з конкурентами (POI search, routing, geofencing)
- додають **унікальні** symbiote-capabilities яких ні в Google Maps + Gemini, ні в Apple Maps + Siri **структурно не може бути** (бо vision забороняє хмару, тому що privacy-by-design є фічею, а не обмеженням)

**Calendar: ~25 тижнів solo** на критичний шлях; symbiote-фази 12/13/14 можуть йти паралельно з 8/9/10 (різні модулі).

## Рішення прийняті з користувачем

- **Routing**: OSRM-cloud перший тиждень для розблокування demo, потім Valhalla embedded як constitutional default (GHOST-compatible, ~50MB APK weight per region tiles). Обидва за `RoutingEngine` інтерфейсом, перемикач у `MapPreferences`.
- **Порядок**: Foundation-first (MAP-AI-1/2/3 → mid → symbiote). Mіцна база замість швидкого demo.
- **Tool-call wire format**: універсальний JSON-schema `{"tool":"name","args":{...}}`. Gemini route transl'ить native `functionCall` part. Один dispatcher, один parser, один security funnel. Gemma 3-2B = bottleneck — структурний JSON ок, native function-call envelope = ні.
- **Geofence**: WorkManager polling над існуючим `LocationContextProvider`. НЕ Google `GeofencingClient` (тягне Play Services, порушує GHOST аксіому).
- **Tool authorization**: tiered, не universal. Read-only (search, route preview, memory lookup) — silent. Mutations (`SaveOfflineRegion`, `RegisterGeofence`, `MatterCommand`) — explicit confirmation через існуючий `question` widget. Destructive (avoidance polygon, revoke share) — long-press constitutional gesture.

---

## Foundation tier (тижні 0-7)

### MAP-AI-1 — Tool-call surface на AIRouter (2 тиж)

**Exit:** unit test шле `AIIntent.WithTools(tools=listOf(WeatherTool, RouteTool))`, `RoutedAIRouter` повертає `AIChunk.ToolCall("route", {from,to,mode})`, dispatcher в `:app` resolve'ить, re-invoke `complete()` з результатом appended як SYSTEM turn, AI fіналізується через `AIChunk.Final`.

**Modify:**
- `core-ai/src/main/java/local/phantom/companion/core/ai/AIIntent.kt` — додати `WithTools` variant + `Tool` schema record
- `core-ai/src/main/java/local/phantom/companion/core/ai/AIResponse.kt:8` — `AIChunk.ToolCall(name,argsJson,callId)` + `AIChunk.ToolResult` echo
- `core-ai/src/main/java/local/phantom/companion/core/ai/route/GeminiCloudRoute.kt:173-205` — emit `tools[]` + `tool_config`; parse `functionCall` part з `extractCandidateParts:208`
- `core-ai/src/main/java/local/phantom/companion/core/ai/route/GemmaLocalRoute.kt:47-64` — інжект JSON-schema template; streaming JSON sniffer що `{"tool":"x","args":{…}}` open token конвертує в `ToolCall` chunk і aborts further generation
- `core-ai/src/main/java/local/phantom/companion/core/ai/route/RoutedAIRouter.kt` — pass ToolCall through, never retry
- `feature-stream/src/main/java/local/phantom/companion/feature/stream/StreamViewModel.kt:737-810` — loop: collect → if ToolCall, dispatcher, re-issue intent
- `app/src/main/java/local/phantom/companion/data/AppContainer.kt` — `ToolDispatcher` registry

**Create:**
- `core-ai/src/main/java/local/phantom/companion/core/ai/tool/AiTool.kt` — interface `name, jsonSchema, suspend fun invoke(args:JsonObject):JsonElement`
- `core-ai/src/main/java/local/phantom/companion/core/ai/tool/ToolDispatcher.kt`
- `core-ai/src/main/java/local/phantom/companion/core/ai/tool/ToolRegistry.kt`

**Reuse:** existing tool shape pattern at `core-ai/.../tool/WeatherTool.kt:37` як reference; `Json` instance з `GeminiCloudRoute.companion`.

**Depends on:** nothing.

---

### MAP-AI-2 — Map context blocks (1 тиж)

**Exit:** prompt offline + GPS active показує `[OFFLINE_REGIONS:…]`, `[SPATIAL_MEMORY:nearby]`, `[GEOFENCES:active]`, `[ROUTE_HISTORY:30d]` лінії в `enrichedContext`; existing `[LOCATION:…]` order preserved.

**Modify:**
- `feature-stream/.../StreamViewModel.kt:737-777` — 4 нові блоки, preserve `[ОПЕРАТОР ВИБРАВ]` last
- `feature-stream/.../persist/ContextStamper.kt` — persist hashed identifiers, ніколи raw chamber content

**Create:**
- `core-ai/.../context/OfflineRegionsContextProvider.kt`
- `core-ai/.../context/SpatialMemoryContextProvider.kt`
- `core-ai/.../context/GeofenceContextProvider.kt`
- `core-ai/.../context/RouteHistoryContextProvider.kt`

**Reuse:** pattern з `core-ai/.../context/LocationContextProvider.kt`; `SpatialMemoryStore.nearest()` (chamber `"earth"`, projection lat→x, lon→y, alt→z).

**Depends on:** none.

---

### MAP-AI-3 — Map-aware AppAction verbs (1 тиж)

**Exit:** AI emit'ить `{"action":"navigate_to","lat":…,"lon":…,"mode":"walk"}` всередині `app-action` payload, маршрут відкривається в in-chat MapWidget без виходу з Phantom.

**Modify:**
- `feature-godmode/src/main/java/local/phantom/companion/feature/godmode/engine/AppAction.kt:21-60` — додати `NavigateTo(lat,lon,mode)`, `SearchPlace(query)`, `ShowOnMap(geometryJson)`, `SaveOfflineRegion(bbox)`
- `feature-godmode/.../engine/AppAction.kt:183-232` — extend `AppActionParser.parseSingle` when (verb)
- `feature-godmode/.../engine/AccessibilityActionDispatcher.kt:122-145` — describe + execute
- `feature-godmode/.../engine/AppActionAuthorizer.kt` — whitelist `LOW_RISK` крім `SaveOfflineRegion` (MEDIUM)

**Create:**
- `feature-godmode/.../engine/MapActionRouter.kt` — translate `NavigateTo` → `WidgetIntent` для existing MapWidget

**Reuse:** existing `app-action` widget JSON shape end-to-end; `AppActionAliases.KNOWN`.

**Depends on:** nothing (combines naturally з MAP-AI-1).

---

## Mid-tier (тижні 7-18)

### MAP-AI-4 — Nominatim + Overpass tool-calls (1.5 тиж)

**Exit:** "що навколо" emit'ить `AIChunk.ToolCall("nearby_search",{q:"cafe",radius_m:500})`, dispatcher invoke'ить Overpass, AI streams list з `{"type":"map", points:[…]}` widget bubble.

**Modify:**
- `feature-stream/.../ui/widget/MapWidget.kt` — verify marker schema
- `core-ai/.../tool/ToolRegistry.kt`

**Create:**
- `feature-stream/.../ui/map/OverpassClient.kt` — mirror `NominatimClient` з 1.1s rate limiter + 24h Room cache для category POIs
- `core-ai/.../tool/NominatimTool.kt`
- `core-ai/.../tool/OverpassTool.kt`

**Reuse:** `NominatimClient` (rate-limited); `TileProvider` Coil cache.

**Depends on:** MAP-AI-1, MAP-AI-3.

---

### MAP-AI-5 — Routing engine (3 тиж, OSRM-cloud первий тиждень + Valhalla embedded далі)

**Exit:** `route(from,to,mode)` tool повертає polyline + ETA + UA-localized turn instructions; works offline once Valhalla tiles для bbox завантажені.

**Week 1 (OSRM cloud):**
- `:core-routing` новий Gradle module: `RoutingEngine` interface + `OsrmCloudEngine` (Ktor REST до self-hostable OSRM behind WireGuard)
- `core-routing/.../RouteTool.kt`
- `core-routing/.../TurnByTurnLocalizer.kt`
- `feature-stream/.../ui/widget/RouteWidget.kt` consume turn-by-turn array

**Week 2-3 (Valhalla embedded):**
- `:core-routing/.../ValhallaLocalEngine.kt` — JNI binding до libvalhalla.so (~50MB armv8a)
- Tiles managed через існуючий `OfflineRegionsManager`
- `MapPreferences` toggle Valhalla/OSRM/auto

**Modify:**
- `feature-stream/.../ui/widget/RouteWidget.kt`
- `core-ai/.../tool/ToolRegistry.kt`
- `feature-stream/.../ui/map/OfflineRegionsManager.kt` — accept Valhalla tile types

**Reuse:** `OfflineRegionsManager` bbox tracking; `MapPreferences`.

**Depends on:** MAP-AI-1.

---

### MAP-AI-6 — Geofence engine + AnchorRouter integration (2 тиж)

**Exit:** оператор каже "коли я наближаюсь до дому — увімкни світло"; AI emit'ить `register_geofence` tool-call; on next arrival, `MatterTool.run_scene("home_lights_on")` fires automatically, stream item shows "✔ виконано".

**Modify:**
- `core-offload/.../AnchorRouter.kt` — broaden `AnchorVerb` на geofence events з `dwell_s` param
- `core-ai/.../tool/ToolRegistry.kt`

**Create:**
- `:core-geofence` module:
  - `GeofenceEntity` (Room), `GeofenceStore`
  - `GeofenceMonitor` foreground service polling через `FusedLocationProviderClient` reflection-light wrapper (keeps module Google-Services-free)
  - `RegisterGeofenceTool`
  - `MatterCommandTool` stub bridge

**Reuse:** `AnchorRouter` event bus; `LocationContextProvider` 5-step chain.

**Depends on:** MAP-AI-1, MAP-AI-2.

---

### MAP-AI-7 — Memory Palace ↔ map bridge (1.5 тиж)

**Exit:** оператор tap'ає pin на `MapScreen`, matching `MemoryEntity.title` floats у bubble; AI отримує `[SPATIAL_MEMORY: id=… title=… distance_m=…]` і narrates "торік ти лишив тут нотатку про…".

**Modify:**
- `feature-stream/.../ui/map/MapScreen.kt` — overlay layer для pins
- `feature-stream/.../ui/widget/MapWidget.kt` — same overlay

**Create:**
- `core-memory-palace/.../LocationMemoryBridge.kt` — translate lat/lon ↔ chamber `"earth"` (1m-per-x projection); `Flow<List<MemoryEntity>>` bounded to visible viewport
- `feature-stream/.../ui/map/MemoryPinLayer.kt`

**Reuse:** `SpatialMemoryStore.nearest()` at `core-memory-palace/.../MemoryEntity.kt:33`.

**Depends on:** MAP-AI-2.

---

## Symbiote-tier (тижні 18-36, паралельні треки)

### MAP-AI-8 — Time Machine map rewind (2 тиж)

**Exit:** оператор drag'ає timeline slider в `MapScreen`; breadcrumb trail re-draws за timestamp, кожен stop ≥5 хв carries diary-entry bubble; on tap, AI re-explains через replayed `RollingBuffer` snapshots.

**Create:**
- `:core-location-history` module:
  - Room `LocationHistoryDao` (90d retention, 30s sampling, Douglas-Peucker deflated at write-time)
  - `LocationHistoryTool`
- `feature-stream/.../ui/map/TimelineSlider.kt`

**Modify:**
- `feature-stream/.../ui/map/MapScreen.kt`
- `core-tempo/.../RollingBuffer.kt` — add `snapshot(atMs)` (currently only `last(durationMs)`)

**Reuse:** `RollingBuffer` 60s circular buffer; `DiaryViewModel`.

**Depends on:** MAP-AI-7.

---

### MAP-AI-9 — Constitutional waypoint avoidance (1.5 тиж)

**Exit:** оператор mark'ає address "avoid forever (ex's place)"; subsequent `route` tool calls повертають paths що bypass polygon; audit row в operator-only diary, ніколи в shared surface.

**Create:**
- `:core-routing/.../AvoidanceStore.kt` — Room; polygon + reason string encrypted at rest via SQLCipher
- `AvoidancePolicy` в `core-constitution`

**Modify:**
- `:core-routing/.../ValhallaLocalEngine.kt` — translate to Valhalla `avoid_polygons`
- `:core-routing/.../OsrmCloudEngine.kt` — waypoint-rewriting workaround (OSRM no native avoid; document limitation)

**Reuse:** `DiaryWebSocketSubscriber` for audit channel.

**Depends on:** MAP-AI-5.

---

### MAP-AI-10 — Mood-Arc routing (1.5 тиж)

**Exit:** коли `MoodArc.state == LOW`, питання "куди підемо" пропонує 30-min loop через past mood-tagged ELEVATED coordinates within walking radius.

**Create:**
- `:core-health-mesh/.../MoodTaggedLocationDao.kt` — Room; joins `LocationHistoryDao` rows з `MoodArc` snapshots same minute
- `MoodRecommendationTool`

**Modify:**
- `core-health-mesh/.../MoodArc.kt:14` — expose `Flow<MoodState>` для `[CORE FACTS]` block
- `feature-stream/.../StreamViewModel.kt:737-777` — `[MOOD:…]` block, fed через existing `[CORE FACTS:…]` plumbing

**Reuse:** `LocationHistoryDao` з MAP-AI-8.

**Depends on:** MAP-AI-8.

---

### MAP-AI-11 — Haptic landmark cues (1 тиж)

**Exit:** на active route watch + phone buzzed short pattern 30m before each turn; pattern different left/right/U-turn/destination.

**Modify:**
- `core-embodiment/.../ProprioceptiveTicker.kt:20` — add `RouteWaypointPattern` source feeding same tick channel
- `wear/...` companion mirror

**Create:**
- `:core-routing/.../RouteWaypointDetector.kt` — subscribe to `LocationContextProvider` updates, emit Ahead-30m / Ahead-5m / At events

**Reuse:** existing `ProprioceptiveTicker` runtime; `AnchorRouter` event bus.

**Depends on:** MAP-AI-5, MAP-AI-6.

---

### MAP-AI-12 — Family Presence pins (3 тиж)

**Exit:** trusted peer who granted location share appears як coloured dot на shared map з TTL countdown; revoke одним tap, propagates within WireGuard heartbeat.

**Create:**
- `:core-distributed-self/.../FamilyPresenceCrdt.kt` — LWW-Element-Set CRDT keyed `peerId`, value `LatLonTtl`
- `:core-distributed-self/.../PresenceGossipTransport.kt` — over existing WireGuard mesh
- `:core-distributed-self/.../GrantTtlStore.kt`
- `feature-stream/.../ui/map/FamilyPinLayer.kt`

**Modify:**
- `core-distributed-self/.../SensorChannel.kt` — extend `grant/revoke` cover new "location" channel

**Reuse:** `SensorChannel` permission semantics.

**Depends on:** MAP-AI-7.

---

### MAP-AI-13 — Magnetic-north feel + Echo-location (2 тиж)

**Exit:** low-vision оператор wearing earbuds hears soft chirp pitch-shifted toward next turn; magnetic-north heading felt як continuous-low haptic intensifies коли facing target.

**Create:**
- `:core-extension-senses/.../MagneticNorthFeel.kt` — sensor `TYPE_ROTATION_VECTOR` → pulse intensity
- `:core-extension-senses/.../SonarEngine.kt` — ultrasonic chirp + mic; distance → tone generator
- `:core-extension-senses/.../EchoNavTool.kt`

**Modify:**
- `core-embodiment/.../ProprioceptiveTicker.kt:20` — mix in `MagneticNorthFeel.pulseIntensity`

**Reuse:** `ProprioceptiveTicker` runtime.

**Depends on:** MAP-AI-11.

---

### MAP-AI-14 — Swarm tile pre-render (2 тиж)

**Exit:** on shared route, device з strongest battery + wifi pre-fetches tiles + gossips to peers; offline regions assemble cooperatively <30s for 5km bbox.

**Create:**
- `:core-swarm/.../TilePrefetchOrchestrator.kt`
- `:core-swarm/.../TileFragmentGossip.kt`
- `:core-swarm/.../DistributedJobScheduler.kt` — already stubbed в `core-swarm`, finish bidding logic

**Modify:**
- `feature-stream/.../ui/map/OfflineRegionsManager.kt` — accept tile fragments з gossip (not only HTTP)
- `feature-stream/.../ui/map/TileProvider.kt` — lookup order: memory → disk → swarm → HTTP

**Reuse:** `RouteTileFetcher` для tile-math; WireGuard mesh з MAP-AI-12.

**Depends on:** MAP-AI-5, MAP-AI-12.

---

## Critical files index

Reuse these existing functions / classes:

| File | What | Used by |
|---|---|---|
| `core-ai/.../AIRouter.kt` | `complete(intent): Flow<AIChunk>` | MAP-AI-1 |
| `core-ai/.../AIResponse.kt:8` | sealed `AIChunk` | MAP-AI-1 |
| `core-ai/.../AIIntent.kt` | sealed `AIIntent` | MAP-AI-1 |
| `core-ai/.../route/GeminiCloudRoute.kt:173-208` | Gemini SSE + parts | MAP-AI-1 |
| `core-ai/.../route/GemmaLocalRoute.kt:47-64` | Gemma local inference | MAP-AI-1 |
| `core-ai/.../context/LocationContextProvider.kt` | Pattern для всіх context providers | MAP-AI-2 |
| `feature-stream/.../StreamViewModel.kt:737-810` | Context assembly + AI loop | MAP-AI-1, 2 |
| `feature-godmode/.../engine/AppAction.kt:21-60` | Sealed verbs | MAP-AI-3 |
| `feature-godmode/.../engine/AppActionParser.kt:183-232` | Parser | MAP-AI-3 |
| `feature-godmode/.../engine/AccessibilityActionDispatcher.kt:122-145` | Dispatch | MAP-AI-3 |
| `feature-godmode/.../engine/AppActionAuthorizer.kt` | Risk tiers | MAP-AI-3 |
| `feature-stream/.../ui/map/NominatimClient.kt` | Pattern для Overpass | MAP-AI-4 |
| `feature-stream/.../ui/map/OfflineRegionsManager.kt` | Tile bbox tracking | MAP-AI-5, 14 |
| `feature-stream/.../ui/map/TileProvider.kt` | Style URL resolution | MAP-AI-5, 14 |
| `app/.../data/MapPreferences.kt` | Provider toggle | MAP-AI-5 |
| `core-offload/.../AnchorRouter.kt` | Event bus | MAP-AI-6, 11 |
| `core-memory-palace/.../MemoryEntity.kt:33` | `SpatialMemoryStore.nearest()` | MAP-AI-7 |
| `core-tempo/.../RollingBuffer.kt` | 60s circular buffer | MAP-AI-8 |
| `core-health-mesh/.../MoodArc.kt:14` | Mood classifier | MAP-AI-10 |
| `core-embodiment/.../ProprioceptiveTicker.kt:20` | Haptic runtime | MAP-AI-11, 13 |
| `core-distributed-self/.../SensorChannel.kt` | Grant/revoke semantics | MAP-AI-12 |

## Verification

### Per-phase unit/integration

- **MAP-AI-1**: `core-ai/.../tool/*Test.kt` per tool (pattern: `WeatherToolTest.kt`); `RoutedAIRouterTest` golden ToolCall round-trip; new `ToolCallParseTest` для Gemma streaming JSON sniffer
- **MAP-AI-2**: `*ContextProviderTest.kt` per provider (5 нових тест-файлів). Verify `[BLOCK:…]` deterministic ordering у `enrichedContext`.
- **MAP-AI-3**: `AppActionParserTest.kt` extend з 4 new verbs + authorization matrix
- **MAP-AI-4**: `OverpassClientTest.kt` — rate-limit + cache + retry; `NominatimToolTest.kt` + `OverpassToolTest.kt`
- **MAP-AI-5**: `OsrmCloudEngineTest.kt` (Ktor MockEngine); `ValhallaOfflineRoutingTest.kt` (fixture tile bundle у `assets/`); `TurnByTurnLocalizerTest.kt`
- **MAP-AI-6**: `GeofenceMonitorTest.kt` — fake clock + fake location chain; `MatterCommandToolTest.kt`
- **MAP-AI-7**: `LocationMemoryBridgeTest.kt` — projection math + viewport bounds
- **MAP-AI-8**: `LocationHistoryDouglasPeuckerTest.kt`; `TimelineSliderViewModelTest.kt`
- **MAP-AI-9**: `AvoidanceStoreTest.kt` — SQLCipher key bind; `AvoidancePolicyTest.kt`
- **MAP-AI-10**: `MoodTaggedLocationDaoTest.kt`; `MoodRecommendationToolTest.kt`
- **MAP-AI-11**: `RouteWaypointDetectorTest.kt` — geofence crossing events
- **MAP-AI-12**: `FamilyPresenceCrdtTest.kt` — concurrent grant/revoke convergence
- **MAP-AI-13**: `MagneticNorthFeelTest.kt`; `SonarEngineTest.kt` — chirp emission, mic capture math
- **MAP-AI-14**: `TilePrefetchOrchestratorTest.kt` — bidding logic; `TileFragmentGossipTest.kt`

### End-to-end smoke (manual + scripted)

Per phase, append до `docs/E2E_MANUAL_CHECKLIST.md`:
- Tool-call round-trip: "погода у Львові" → `ToolCall(weather)` → result → AI synthesizes
- Map context blocks visible у logcat у `enrichedContext`
- Navigate-to verb: "відведи мене у бар X" → MapWidget opens із полілінією
- Offline routing: airplane mode + downloaded Lviv tile pack → route works
- Geofence: register "вдома → світло" → fake GPS to home → Matter trigger fires (mock)
- Memory pin: place MemoryEntity at lat/lon → MapScreen pin appears → tap → bubble
- Time rewind: drag slider → breadcrumb trail re-paints
- Avoidance: mark polygon → route bypasses
- Mood walk: force MoodArc.LOW → "куди" → AI proposes scenic loop
- Haptic landmark: simulated route + GPS waypoint cross → ticker fires
- Family pin: mock peer grant → dot appears with TTL → revoke → dot disappears
- North feel: rotate device → pulse intensity changes
- Sonar: enable EchoNav → chirp audible on mic capture
- Swarm prefetch: 2 connected peers + route → tile cache fills < 30s

### Build gates

After each phase:
- `./gradlew :app:assembleDebug` — clean
- `./gradlew :app:lintDebug` — clean
- `./gradlew test` — green
- Manifests audited в Constitution Registry без rejections

### Constitution audit

Every new tool registers a `FeatureManifest` у `:core-constitution`:
- `actsWithoutConsent=false` для read-only (search, route preview)
- `actsWithoutConsent=true` потребує operator gesture (geofence register, family share)
- `abusableAgainstWeak=true` для anything tied до family-presence — extra audit

## Risks

| Ризик | Mitigation |
|---|---|
| Valhalla APK weight ~50MB | Per-region tile downloads via `OfflineRegionsManager`; Play dynamic-feature flavour optional |
| Gemma function-call reliability | Streaming-JSON validator aborts generation on parseable envelope; 3-strike fallback на cloud via `RetryingAIRouter` |
| Nominatim TOS | Room cache (24h fwd, 7d rev) mandatory BEFORE MAP-AI-4 |
| Family-presence CRDT clock skew | `monotonicNs() + ntpOffsetMs()` з `core-tempo`; reject grants older 24h on receipt |
| Constitutional ambiguity для AvoidancePolicy | SQLCipher key bound до operator pattern lock; never replicate до family CRDT (whitelist channels в `SensorChannel`) |
| Battery на continuous magnetic-north pulse | Gate на `MoodArc != CRITICAL` AND (`screen_on` OR `active_route`) |
| Tool-call schema drift Gemma vs Gemini | Universal schema canonical; native `functionCall` translation тільки на outbound Gemini boundary |
| Plan agent recommended OSRM-cloud demo first | Approved by operator — week 1 OSRM, weeks 2-3 Valhalla; gate Valhalla integration tests на CI runner з достатнім disk |

## Calendar summary

- **Foundation tier**: 4 тижні (MAP-AI-1 2w + MAP-AI-2 1w + MAP-AI-3 1w, паралельно)
- **Mid-tier**: 8 тижнів (MAP-AI-4 1.5w + MAP-AI-5 3w + MAP-AI-6 2w + MAP-AI-7 1.5w)
- **Symbiote-tier**: 13 тижнів критичний шлях, ~9 з паралелізмом (MAP-AI-8 2w → MAP-AI-10 1.5w; паралельно MAP-AI-9 1.5w, MAP-AI-11 1w, MAP-AI-12 3w, MAP-AI-13 2w, MAP-AI-14 2w)

**Total: ~25 тижнів solo на critical path. ~17 тижнів з паралелізмом 2-х треків.**

## Що це дасть в кінці

PHANTOM Companion матиме **AI-агент який програмно діє на мапі** через universal tool-call surface:

1. **Parity з конкурентами** — POI search (Overpass), routing (Valhalla+OSRM), geofencing, navigation — все що Google Maps + Gemini вміє
2. **Унікальні symbiote-фічі** яких структурно не може мати конкурент:
   - **Time-tunneled map** — drag slider, "де я був місяць тому?" з memory diary
   - **Memory Palace map** — місця як тригери спогадів
   - **Constitutional avoidance** — phantom тихо обходить твої trauma-zones з audit
   - **Mood-aware routing** — "довга прогулянка для покращення настрою"
   - **Haptic landmark cues** — повороти через вібрацію, не голос
   - **Family Presence без cloud** — mesh peer dots
   - **Magnetic-north feel** + **Echo-location** — accessibility-grade nav
   - **Swarm tile pre-render** — colaborative offline maps

Все це **GHOST-aware** (vault-of-traces сесія не лікає геолокацію), **on-device** (Gemma local fallback), **constitution-audited** (84 манифести → 84+14 нових).

**Не змагаємось на feature count з Google Maps. Володіємо spatial symbiosis category якої не існує.**
