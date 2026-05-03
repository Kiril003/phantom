# PHASE 24 — OMNIMAP

> Повне переосмислення мапи PHANTOM OS. З тактичної панелі — у живий, AI-керований географічний інтелект-центр.
> Туристичний навігатор + персональний journal + OSINT-термінал + research-стенд + recon-консоль в одному.

---

## 0. Vision

PHANTOM перестає мати «карту». PHANTOM має **ландшафт**.

Ландшафт — це єдиний просторовий шар реальності, в якому живе агент. Кожен датчик, спогад, факт, IP-адреса, супутник, погода, шум RF, кораблі в Чорному морі, фронтова лінія, тривога повітряної загрози, ціни на електроенергію, фотографії з Mapillary, бункери в OSM, і кожен SSID, який бачив ESP32 — все це шари одного ландшафту, які агент вмикає, гасить, рендерить та тлумачить **сам**, у відповідь на природну мову.

Не «відкрий мапу» — а «PHANTOM, покажи де я був вчора між 19:00 і 22:00 і що там зараз з повітряною тривогою». І PHANTOM:
1. Розуміє наміри.
2. Збирає 4 шари даних з 4 джерел.
3. Перемикає системний стан у `RECON`.
4. Робить flyTo, накладає track, тривогу, погоду, друкує наратив у чат, озвучує українською через StyleTTS2.

Без UI-меню. Без кліків. Без «де ця кнопка». Розмова — інтерфейс. Карта — її візуалізація.

---

## 1. Непорушні принципи (Map Doctrine)

1. **Один ландшафт, багато лінз.** Немає окремих «карт» (тактичної, туристичної, OSINT). Є одна мапа і ≥40 шарів, які агент комбінує під намір.
2. **Розмова — основний інтерфейс.** Кожна функціональність викликається через chat/voice action. UI-кнопки — лише дзеркало того, що вже може агент.
3. **Offline-first.** Жодна базова функція не падає без інтернету. Cloud — підсилення, не залежність. Базовий стек (Protomaps + Photon + BRouter + Overpass-local + MaxMind + OpenCellID + GLO-30 DEM) працює повністю автономно.
4. **Layer registry — це дані, не код.** Кожен шар описаний JSON-маніфестом (id, source, attribution, license, ttl, requires_internet, agent_verbs). Додати шар = додати запис, не міняти UI.
5. **Cache-by-default.** Усе, що приходить ззовні, кешується з осмисленим TTL: super-fresh (повітряна тривога 30 с, ADS-B 5 с) → fresh (погода 30 хв) → stable (фронт 1 день) → archival (Sentinel-2 30 днів). MapCache — окремий сервіс.
6. **Attribution accumulator завжди видимий.** Атрибуція динамічно збирається з активних шарів і друкується в одному місці. Жодна ліцензія не порушена жодного разу.
7. **Privacy-first шари.** GHOST-маркери, sealed traces, encrypted POI — окрема рендер-гілка, ключі у JWT-сесії.
8. **AI як єдина система.** Агент *завжди* має контекст карти (viewport, активні шари, останні маркери) і навпаки — карта *завжди* знає, в якому SystemState агент. SHADOW → приглушений dark, FOCUS → лазерна точність, DIALOGUE → спрощений chrome, RECON → повна тактика, GHOST → чорно-червоний з шифрованими маркерами, DREAM → time-lapse 24h.
9. **44×44 px touch targets, строго 1024×600 без скролу.** Все керування мапою вміщується в HUD на 1024×600 без жодного scroll-overflow.
10. **Tests after every block.** 24-A...24-Z — кожен ship-block має pytest + vitest + screenshot diff.

---

## 2. Архітектура

### 2.1. Backend — нові домени

```
src/backend/
  geo/                              # NEW — головний домен
    __init__.py
    layer_registry.py               # YAML/JSON manifest loader, schema, validation
    layer_manifest.py               # Pydantic models: LayerSource, LayerStyle, LayerAuth
    map_cache.py                    # TTL-aware multi-tier cache (memory + SQLite + disk)
    attribution.py                  # Per-session attribution union, deduplicator
    tile_proxy.py                   # FastAPI proxy + cache for raster/vector tiles
    pmtiles_serve.py                # Range-request server for offline PMTiles
    bounds.py                       # bbox math, viewport calc, geohash, tile coords
    geom_ops.py                     # buffer, simplify, intersect, haversine, bearing
    geofence_engine.py              # Polygon enter/exit detector → events
  geo/sources/                      # NEW — typed adapters per source
    base.py                         # ABC: Source.fetch(bbox, ts, **kwargs) → GeoJSON
    osm_overpass.py                 # Already exists — move + extend
    osm_overpass_local.py           # NEW — local self-host wrapper
    nominatim.py                    # NEW
    photon.py                       # NEW (offline geocoder)
    openrouteservice.py             # NEW
    osrm.py                         # NEW (self-host)
    valhalla.py                     # NEW
    brouter.py                      # NEW (offline)
    open_meteo.py                   # NEW (weather + AQ + marine + pollen + UV)
    met_norway.py                   # NEW (weather fallback)
    noaa_swpc.py                    # NEW (aurora, geomagnetic)
    openweathermap.py               # NEW
    open_topo_data.py               # NEW (DEM)
    open_elevation.py               # NEW
    copernicus_dem.py               # NEW (offline GLO-30)
    nasa_firms.py                   # NEW (active fires)
    nasa_eonet.py                   # NEW
    usgs_eq.py                      # NEW (earthquakes)
    gdacs.py                        # NEW
    sentinel_hub.py                 # NEW (NDVI/NBR/NDWI/Sentinel-5P bands)
    nasa_gibs.py                    # NEW (daily satellite mosaics)
    eox_cloudless.py                # NEW (S2-cloudless)
    opensky.py                      # NEW (live ADS-B)
    aisstream.py                    # NEW (live AIS WebSocket)
    ourairports.py                  # NEW (offline airport DB)
    openaip.py                      # NEW
    openaq.py                       # NEW (air quality)
    waqi.py                         # NEW
    mapillary.py                    # NEW (street imagery)
    kartaview.py                    # NEW
    flickr_geo.py                   # NEW (geo-tagged photos)
    wikipedia_geo.py                # NEW
    wikidata_sparql.py              # NEW
    wigle.py                        # NEW (Wi-Fi DB)
    opencellid.py                   # NEW (offline cell DB)
    radiocells.py                   # NEW
    tor_relays.py                   # NEW (Onionoo)
    bitnodes.py                     # NEW
    shodan_lite.py                  # NEW
    censys_lite.py                  # NEW
    greynoise.py                    # NEW
    threatfox.py                    # NEW
    abuseipdb.py                    # NEW
    urlscan.py                      # NEW
    openinfra_overpass.py           # NEW (power, telecom, oil from OSM)
    wri_powerplants.py              # NEW
    global_solar_atlas.py           # NEW
    global_wind_atlas.py            # NEW
    entsoe.py                       # NEW (grid, prices)
    electricitymaps.py              # NEW
    alarms_ua.py                    # NEW (повітряна тривога)
    deepstatemap.py                 # NEW (фронт)
    privatbank_rates.py             # NEW
    ukrenergo_blackouts.py          # NEW
    ourairports_offline.py          # NEW
    celestrak_tle.py                # NEW (sat tracking, sgp4)
    n2yo.py                         # NEW
    iss_open_notify.py              # NEW
    light_pollution.py              # NEW
    suncalc_local.py                # NEW (offline)
    timezonedb.py                   # NEW
    tz_world_offline.py             # NEW (shapefile-based)
    maxmind_geolite.py              # NEW (offline IP geo)
    ipinfo.py                       # NEW
    worldpop.py                     # NEW
    ghsl.py                         # NEW
    strava_heatmap.py               # NEW (auth-required)
    libretranslate.py               # NEW
    mymemory.py                     # NEW
    deepl_free.py                   # NEW
    lightning_blitzortung.py        # NEW
    aviation_weather_gov.py         # NEW (METAR/TAF/SIGMET)
    geonames.py                     # NEW (oceans, rivers, mountains)
    transit_land.py                 # NEW
  geo/routing/                      # NEW
    router_facade.py                # Strategy: choose ORS/OSRM/Valhalla/BRouter
    profiles.py                     # car, hike, bike, mtb, foot-stealth, drone-loiter
    isochrone.py
    matrix.py
    map_match.py                    # snap GPS trace to roads
    tsp_optimizer.py                # multi-stop visit order
  geo/tilesets/                     # NEW
    pmtiles_manager.py              # download/verify/swap PMTiles bundles
    region_extractor.py             # «дай мені офлайн Львів 50 км» → bbox → fetch
    style_compiler.py               # generate MapLibre style JSON per theme/state
  geo/intelligence/                 # NEW — derived layers (computed)
    change_detection.py             # Sentinel-2 today vs Corona 1968 diff
    cluster_dbscan.py               # cluster wardriving, photos, IOCs
    correlation.py                  # «де PHANTOM фіксував біль і голод» heatmap
    storyteller.py                  # GeoJSON → narrative for Gemini
    annotator.py                    # auto-label POIs with Wikidata facts
    anomaly_detector.py             # «незвично багато ADS-B на 800м тут — варто глянути»
  agent/actions/map/                # NEW — agent verbs (28+ actions)
    open_map.py
    set_view.py
    flyto.py
    add_marker.py
    edit_marker.py
    delete_marker.py
    save_to_journey.py
    list_layers.py
    enable_layer.py
    disable_layer.py
    query_nearby.py
    geocode.py
    reverse_geocode.py
    plan_route.py
    estimate_isochrone.py
    download_offline_region.py
    delete_offline_region.py
    take_screenshot.py
    overlay_track.py
    overlay_heatmap.py
    create_geofence.py
    list_geofences.py
    snapshot_state.py
    measure_distance.py
    measure_area.py
    bearing_to.py
    elevation_profile.py
    sat_pass_predict.py
    air_raid_status.py
    frontline_status.py
    grid_status.py
    nearby_aircraft.py
    nearby_ships.py
    nearby_fires.py
    nearby_pois_osm.py
    nearby_wikipedia.py
    nearby_wifi.py
    nearby_cells.py
    nearby_threats.py
    nearby_substations.py
    explain_view.py                 # «чому ця ділянка червона?»
    compare_dates.py                # change detection
    tour_guide.py                   # tourism narrative
    recon_brief.py                  # OSINT briefing
  api/
    routes_map.py                   # EXISTING — extended з 11 → 60+ ендпоінтів
    routes_geo_layers.py            # NEW
    routes_geo_routing.py           # NEW
    routes_geo_tiles.py             # NEW
    routes_geo_offline.py           # NEW
    routes_geo_intel.py             # NEW
  websocket_hub.py                  # EXTEND — channels: map.viewport, map.layer.<id>, map.poi, map.alert
```

### 2.2. Frontend — нові модулі

```
src/frontend/src/components/map/
  TacticalMap.tsx                   # SHRINK — only orchestration, не моноліт
  OmniMap.tsx                       # NEW — root map shell, registry-driven
  hud/
    HudShell.tsx                    # компонує всі HUD-елементи з registry
    StatusChips.tsx                 # GPS, compass, altitude, speed, heading, battery
    LayerPalette.tsx                # quick toggle, агент-driven
    LayerLibrary.tsx                # повний каталог 40+ шарів, search, favorites
    SearchOmnibar.tsx               # geocode + POI + memory + chat all-in-one
    ChatBridgeChip.tsx              # «PHANTOM, тут є...» mic-attached
    AttributionDrawer.tsx           # accumulator, collapsible
    ScaleBar.tsx
    RulerTool.tsx                   # distance + area
    BearingTool.tsx
    ElevationProfileSheet.tsx
    TimeMachineSlider.tsx           # for change-detection layers
    GeofenceDrawTool.tsx
    OfflineRegionManager.tsx
    LegendPanel.tsx                 # per-layer dynamic legend
    MapStateBadge.tsx               # SHADOW/FOCUS/RECON/GHOST tint indicator
  layers/                           # ONE FILE PER LAYER, declarative
    BaseLayer.tsx
    PresenceLayer.tsx
    WardrivingLayer.tsx
    HeatmapLayer.tsx
    IntelLayer.tsx
    ReconLayer.tsx
    FactMarkerLayer.tsx             # existing
    OverpassDynamicLayer.tsx        # NEW — render будь-який Overpass query
    AirRaidLayer.tsx                # NEW — oblast polygons, red pulse
    FrontlineLayer.tsx              # NEW — DeepStateMap GeoJSON
    AdsbLayer.tsx                   # NEW — live aircraft, animated headings
    AisLayer.tsx                    # NEW — live ships
    FiresLayer.tsx                  # NEW — FIRMS dots
    EarthquakesLayer.tsx            # NEW
    LightningLayer.tsx              # NEW
    WeatherRadarLayer.tsx           # NEW (Open-Meteo + RainViewer)
    AqiLayer.tsx                    # NEW
    No2PlumeLayer.tsx               # NEW (Sentinel-5P)
    AuroraLayer.tsx                 # NEW (NOAA SWPC)
    LightPollutionLayer.tsx         # NEW
    SatellitePassLayer.tsx          # NEW (TLE-based, animated arcs)
    SubstationsLayer.tsx            # NEW (OpenInfraMap)
    PowerLinesLayer.tsx             # NEW
    PowerPlantsLayer.tsx            # NEW (WRI + OSM)
    SolarPotentialLayer.tsx         # NEW (heatmap)
    WindPotentialLayer.tsx          # NEW
    BlackoutScheduleLayer.tsx       # NEW (Yasno/DTEK by oblast)
    TorRelaysLayer.tsx              # NEW
    ShodanIocLayer.tsx              # NEW
    GreynoiseLayer.tsx              # NEW
    ThreatFoxLayer.tsx              # NEW
    BunkersLayer.tsx                # NEW (military=bunker, building=bunker)
    AbandonedLayer.tsx              # NEW (abandoned:* tags)
    UrbexLayer.tsx                  # NEW (ruins, industrial)
    BunkerCorridorLayer.tsx         # NEW (intersect bunkers + roads)
    StreetImageryLayer.tsx          # NEW (Mapillary coverage + photos)
    StravaHeatmapLayer.tsx          # NEW (auth required)
    PopulationDensityLayer.tsx      # NEW (Meta HRSL / WorldPop)
    HillshadeLayer.tsx              # NEW (DEM-derived terrain)
    ContoursLayer.tsx               # NEW (10m, 20m, 50m, 100m)
    Hillshade3DLayer.tsx            # NEW (terrain-rgb + sky)
    HikingTrailsLayer.tsx           # NEW (Waymarked)
    CyclingLayer.tsx                # NEW
    NauticalLayer.tsx               # NEW (OpenSeaMap)
    AirspaceLayer.tsx               # NEW (OpenAIP)
    AirportsLayer.tsx               # NEW (OurAirports)
    TransitLayer.tsx                # NEW (GTFS)
    SunMoonLayer.tsx                # NEW (positions, terminator)
    NightDayTerminatorLayer.tsx     # NEW
    HistoricalImageryLayer.tsx      # NEW (Corona, GIBS time-slider)
    MarsLayer.tsx                   # NEW (Easter egg — NASA Mars tiles)
    GeofencesLayer.tsx              # NEW
    JourneysLayer.tsx               # NEW (saved trips polyline)
    SealedZonesLayer.tsx            # NEW (GHOST mode encrypted)
    AnnotationsLayer.tsx            # NEW (free-form drawings, text, arrows)
  cards/
    MarkerCard.tsx                  # existing
    AircraftCard.tsx
    ShipCard.tsx
    SubstationCard.tsx
    BunkerCard.tsx
    SatPassCard.tsx
    NetworkCard.tsx                 # Wi-Fi or cell
    PhotoCard.tsx                   # Mapillary/Flickr
    EarthquakeCard.tsx
    AlertCard.tsx
    GenericFeatureCard.tsx          # fallback for any GeoJSON feature
  panels/
    NearbyPanel.tsx                 # existing — extended
    LayerLibraryPanel.tsx
    TimelineDrawer.tsx              # existing — extended з time-machine
    AnalysisPanel.tsx               # measure, profile, compare results
    StoryPanel.tsx                  # narrative output from agent
    OfflinePanel.tsx                # downloaded regions, sizes, refresh
    SearchResultsPanel.tsx
    GhostPanel.tsx                  # encrypted-only view
  hooks/
    useLayer.ts
    useViewport.ts
    useGpsHud.ts
    useGeofenceWatcher.ts
    useOfflineCapability.ts
    useMapAgentBridge.ts            # subscribes to /ws map.* events
    useAttribution.ts
    useTileBudget.ts                # dev mode
  state/
    omnimapStore.ts                 # NEW — replaces mapStore (compat shim kept)
    layerRegistryStore.ts           # NEW
    geofenceStore.ts                # NEW
    offlineStore.ts                 # NEW
    annotationStore.ts              # NEW
  utils/
    pmtilesProtocol.ts              # MapLibre custom protocol for pmtiles://
    transliterate.ts                # existing — keep
    mapAnimations.ts                # state-driven
```

### 2.3. Інтеграція AI ↔ Map (єдина система)

**Двонаправлений міст:**

```
ChatStream ──→ Gemini/Ollama ──→ MapAction.execute()
                                        │
                                        ↓
                              MapState mutates ──→ WS broadcast ──→ OmniMap re-renders
                                        │
                                        ↓
                              ContextEngine snapshot includes:
                                - active layers
                                - viewport bbox
                                - selected feature
                                - last 5 user actions on map
                                        │
                                        ↓
                              Next Gemini prompt сприймає мапу як context
```

**Кожна агент-action повертає `MapActionResult`:**
```python
class MapActionResult(BaseModel):
    success: bool
    narrative: str               # для chat + voice (StyleTTS2)
    map_mutation: MapMutation    # what changed in viewport/layers/markers
    artifacts: list[Artifact]    # screenshots, GeoJSON files, route GPX
    follow_ups: list[str]        # «хочеш зберегти у Journey?» suggestions
```

---

## 3. Реєстр шарів (Layer Registry — єдине джерело істини)

Файл: `src/backend/geo/layer_registry/manifests/*.yaml` (1 шар = 1 файл).

Приклад манiфесту:

```yaml
id: air_raid_ua
name_ua: Повітряна тривога (Україна)
name_en: Air-raid alerts (Ukraine)
category: ukraine
license: NC (alarms.in.ua, request)
attribution: "Дані: alarms.in.ua"
source:
  type: rest_polling
  url: https://api.alarms.in.ua/v3/alerts/active.json
  auth: api_key:ALARMS_UA_KEY
  poll_interval_s: 30
  ttl_s: 30
geometry: oblast_polygons        # uses bundled UA admin shapes
style:
  fill: signal/alert
  fill_opacity: 0.35
  stroke: signal/alert
  pulse: true
agent_verbs:
  - air_raid_status
  - nearby_alerts
require_internet: true
require_setting: alerts.air_raid.enabled  # default true
private: false
priority: critical
```

40+ шарів у v1. Реєстр доступний:
- агенту через `list_layers`/`enable_layer` actions;
- UI через `LayerLibrary` (search, фільтри: free/paid, online/offline, license, category);
- settings через `MapLayersSettings` panel (увімкнути/вимкнути категорії).

---

## 4. Каталог шарів (40+ у v1, цільовий 80+)

| # | Шар | Категорія | Джерело | Offline | Use case |
|---|-----|-----------|---------|---------|----------|
| 1 | Base vector | Base | Protomaps PMTiles | ✅ | Основа |
| 2 | Base raster light | Base | Carto Voyager | ❌ | Денний |
| 3 | Base raster dark | Base | Stadia Alidade Dark | ❌ | SHADOW state |
| 4 | Satellite | Base | EOX Cloudless / Esri | ❌ | Тактика |
| 5 | Topo | Base | OpenTopoMap | ❌ | Hike |
| 6 | OSM-Liberty | Base | OpenFreeMap | ❌ | Travel |
| 7 | Hillshade | Terrain | Copernicus GLO-30 | ✅ | 3D |
| 8 | Contours 10/20/50/100m | Terrain | DEM-derived | ✅ | Recon |
| 9 | Terrain-3D | Terrain | terrain-rgb | ✅ | DREAM mode |
| 10 | Wardriving APs | Personal | local DB | ✅ | OSINT |
| 11 | Wi-Fi heatmap | Personal | local DB | ✅ | Coverage |
| 12 | GPS track | Personal | local DB | ✅ | Journey |
| 13 | Memory facts | Personal | ChromaDB+SQLite | ✅ | Журнал |
| 14 | POIs (user) | Personal | local DB | ✅ | Базове |
| 15 | Geofences | Personal | local DB | ✅ | Alerts |
| 16 | Annotations | Personal | local DB | ✅ | Drawing |
| 17 | Sealed (GHOST) | Personal | encrypted local | ✅ | Privacy |
| 18 | Wikipedia POI | Reference | uk.wikipedia | ❌ | Tour |
| 19 | Wikidata POI | Reference | SPARQL | ❌ | Deep info |
| 20 | OSM POIs (Overpass) | Reference | overpass-local | ✅ | Універсал |
| 21 | Mapillary photos | Reference | Mapillary API | ❌ | Street view |
| 22 | Flickr geo | Reference | Flickr | ❌ | Photo |
| 23 | Hiking trails | Tourism | Waymarked | ❌ | Outdoor |
| 24 | Cycling | Tourism | CyclOSM | ❌ | Bike |
| 25 | Nautical | Tourism | OpenSeaMap | ❌ | Marine |
| 26 | Airports | Tourism | OurAirports | ✅ | Aviation |
| 27 | Airspace | Tourism | OpenAIP | ❌ | Drone/Pilot |
| 28 | Transit (GTFS) | Tourism | Transit.land | ❌ | City |
| 29 | Air-raid UA | Ukraine | alarms.in.ua | ❌ | Critical |
| 30 | Frontline | Ukraine | DeepStateMap | ❌ | Critical |
| 31 | Blackout schedule | Ukraine | Yasno/DTEK | ❌ | Daily |
| 32 | Live aircraft | Live | OpenSky | ❌ | Awareness |
| 33 | Live ships | Live | AISStream | ❌ | Marine recon |
| 34 | Active fires | Live | NASA FIRMS | ❌ | War/eco |
| 35 | Earthquakes | Live | USGS | ❌ | Hazard |
| 36 | Lightning | Live | Blitzortung | ❌ | Storms |
| 37 | Weather radar | Live | RainViewer | ❌ | Rain |
| 38 | Forecast overlay | Live | Open-Meteo | ❌ | Plan |
| 39 | AQI | Environment | OpenAQ/WAQI | ❌ | Health |
| 40 | NO2 plume | Environment | Sentinel-5P | ❌ | Recon |
| 41 | Aurora forecast | Astronomy | NOAA SWPC | ❌ | Stargaze |
| 42 | Light pollution | Astronomy | LP map | ❌ | Stargaze |
| 43 | Sun/Moon position | Astronomy | suncalc local | ✅ | Plan |
| 44 | Sat passes | Astronomy | CelesTrak TLE | ✅ | Recon |
| 45 | ISS live | Astronomy | Open-Notify | ❌ | Fun |
| 46 | Substations | Infra | OpenInfraMap | ✅ | OSINT |
| 47 | Power lines | Infra | OSM Overpass | ✅ | OSINT |
| 48 | Power plants | Infra | WRI | ✅ | OSINT |
| 49 | Solar potential | Infra | Global Solar Atlas | ❌ | Research |
| 50 | Wind potential | Infra | Global Wind Atlas | ❌ | Research |
| 51 | Tor relays | OSINT | Onionoo | ❌ | Recon |
| 52 | BTC nodes | OSINT | Bitnodes | ❌ | Recon |
| 53 | Shodan IOCs | OSINT | Shodan | ❌ | Recon |
| 54 | GreyNoise | OSINT | GreyNoise | ❌ | Recon |
| 55 | ThreatFox | OSINT | abuse.ch | ❌ | Recon |
| 56 | URLScan | OSINT | URLScan | ❌ | Recon |
| 57 | Bunkers | Hacker | Overpass military=bunker | ✅ | Recon |
| 58 | Abandoned | Hacker | Overpass abandoned | ✅ | Urbex |
| 59 | Cell towers | Hacker | OpenCellID local | ✅ | RF |
| 60 | WiGLE BSSIDs | Hacker | WiGLE | ❌ | RF |
| 61 | Strava heatmap | Hacker | Strava | ❌ | OSINT |
| 62 | Population density | Research | Meta HRSL | ✅ | Research |
| 63 | Built-up areas | Research | GHSL | ✅ | Research |
| 64 | Historical Corona | Research | USGS Corona | ❌ | Diff |
| 65 | Day-night terminator | Generic | computed | ✅ | UX |
| 66 | Geomagnetic Kp | Astronomy | NOAA | ❌ | RF |
| 67 | METAR/TAF | Aviation | aviationweather.gov | ❌ | Pilot |
| 68 | NDVI/NDWI/NBR | Research | Sentinel Hub | ❌ | Eco |
| 69 | Forest loss | Research | Global Forest Watch | ❌ | Eco |
| 70 | Tides | Marine | NOAA / Open-Meteo | ❌ | Plan |
| 71 | Marine waves | Marine | Open-Meteo Marine | ❌ | Plan |
| 72 | Pollen | Health | Open-Meteo | ❌ | Daily |
| 73 | UV index | Health | Open-Meteo | ❌ | Daily |
| 74 | Time zones | Reference | tz_world offline | ✅ | Plan |
| 75 | IP geo dots | OSINT | MaxMind offline | ✅ | Recon |
| 76 | PrivatBank rates | Ukraine | privatbank.ua | ❌ | Travel |
| 77 | Ukrposhta indexes | Ukraine | local DB | ✅ | Daily |
| 78 | Ocean / mountain names | Reference | GeoNames | ❌ | Tour |
| 79 | Translation overlay | UX | LibreTranslate | ✅ | Travel |
| 80 | Mars (Easter egg) | Fun | NASA Mars tiles | ❌ | Surprise |

Усі шари доступні до підключення з чату: «PHANTOM, увімкни шар бункерів і фронт» → 2 layer manifests активуються одночасно.

---

## 5. Поверхня агент-екшенів (chat-controllable verbs)

**Базове керування viewport:**
- `map.open` — фокусує мапу (UI screen)
- `map.close`
- `map.set_view {center, zoom, bearing, pitch}`
- `map.flyto {target, zoom?, duration?}` — target = address|coords|poi_id|memory_id
- `map.fit_bounds {bbox|features}`
- `map.set_style {style_id|state}` — light/dark/sat/topo/auto
- `map.snapshot {bbox?, layers?, format}` — PNG/SVG для chat artifact
- `map.share {target}` — копіює короткий URL/QR на мобільний

**Маркери та журнал:**
- `map.add_marker {coords|address, name, category, notes, secret?, geofence?}`
- `map.edit_marker {id, ...}`
- `map.delete_marker {id}`
- `map.list_markers {category?, near?}`
- `map.save_to_journey {journey_id, marker_ids}`
- `map.create_journey {name, start, stops[]}`
- `map.export_journey {id, format: gpx|kml|geojson}`

**Запит «що тут»:**
- `map.query_nearby {coords, radius, types[]}` — pois|memory|wifi|cells|aircraft|ships|fires|wikipedia|threats|bunkers
- `map.explain_view {bbox?}` — Gemini генерує наратив про активний viewport з усіх увімкнених шарів
- `map.inspect_feature {layer, feature_id}` — повна довідка з усіх крос-джерел (Wikidata, Wikipedia, Mapillary photos, OSM tags)

**Геокодинг:**
- `map.geocode {query, lang?, near?}`
- `map.reverse_geocode {coords}`
- `map.address_to_journey {addresses[]}` — батч

**Маршрутизація:**
- `map.plan_route {from, to, profile, avoid?, prefer?, alternatives?}`
- `map.optimize_visit {stops[], profile, return_to_start?}`
- `map.isochrone {center, time_minutes, profile}`
- `map.matrix {origins[], destinations[], profile}`
- `map.snap_track {gpx|geojson, profile}`

**Шари:**
- `map.list_layers {category?, available_offline?, requires_setting?}`
- `map.enable_layer {id, params?}`
- `map.disable_layer {id}`
- `map.set_layer_param {id, key, value}`
- `map.layer_legend {id}`

**Геофенси:**
- `map.create_geofence {polygon|circle, name, on_enter[], on_exit[]}`
- `map.list_geofences`
- `map.delete_geofence {id}`
- `map.geofence_history {id, since}`

**Вимірювання:**
- `map.measure_distance {points[]}`
- `map.measure_area {polygon}`
- `map.bearing_to {from, to}`
- `map.elevation_profile {polyline}`

**Time machine / change detection:**
- `map.time_travel {date, layer}`
- `map.compare_dates {layer, date_a, date_b, bbox}`
- `map.compute_change {bbox, since, metric}`

**Live awareness (UA/світ):**
- `map.air_raid_status {oblast?|coords?}`
- `map.frontline_status {since?}`
- `map.blackout_status {oblast, hours_ahead?}`
- `map.grid_frequency`
- `map.nearby_aircraft {radius_km?}`
- `map.nearby_ships {bbox|radius}`
- `map.nearby_fires {radius_km?, since?}`
- `map.nearby_earthquakes {radius_km?, min_mag?}`
- `map.nearby_lightning {radius_km?}`
- `map.weather_now {coords}`
- `map.weather_forecast {coords, hours|days, layers[]}`
- `map.aqi_now {coords}`

**OSINT/recon:**
- `map.nearby_substations {radius_km}`
- `map.nearby_bunkers {radius_km, depth?}`
- `map.nearby_telecom {radius_km}`
- `map.nearby_oil_pipelines`
- `map.nearby_cells {radius, mcc?, mnc?}`
- `map.nearby_wifi {radius, encryption?}`
- `map.lookup_bssid {mac}`
- `map.lookup_cell {mcc, mnc, lac, cid}`
- `map.tor_relays_in {country|bbox}`
- `map.shodan_search {query, near?}`
- `map.threats_near {coords, radius}`

**Astronomy:**
- `map.sat_pass_predict {sat?, hours_ahead}`
- `map.iss_now`
- `map.sun_moon_now`
- `map.golden_hour_today`
- `map.aurora_forecast`
- `map.dark_sky_score {coords}`

**Tour guide:**
- `map.tour_nearby {radius, theme, lang}` — Gemini читає Wikidata+OSM, формує сюжет
- `map.suggest_walk {duration_minutes, theme}` — short walking loop
- `map.suggest_view {coords, time}` — best photo spot now

**Recon brief:**
- `map.recon_brief {bbox, depth: shallow|deep}` — комбінований OSINT report
- `map.threat_brief {coords, radius}`
- `map.infra_brief {coords, radius}`

**Offline:**
- `map.list_offline_regions`
- `map.download_offline_region {bbox, layers[], priority}`
- `map.update_offline_region {id}`
- `map.delete_offline_region {id}`
- `map.offline_capacity` — скільки місця

**Privacy / GHOST:**
- `map.ghost_drop {coords, encrypted_payload}`
- `map.ghost_reveal {id, key}`
- `map.seal_zone {polygon, key}`
- `map.unseal_zone {id, key}`

**Annotation / drawing:**
- `map.annotate_text {coords, text, style?}`
- `map.annotate_arrow {from, to, label?}`
- `map.annotate_polygon {coords[], style?}`
- `map.clear_annotations {layer?}`

**Розрахунки/research:**
- `map.solar_potential {coords}` — кВт·год/рік на 1 кВт пік
- `map.wind_potential {coords, height_m}`
- `map.line_of_sight {from, to}` — LOS analysis з DEM
- `map.viewshed {coords, height_m, radius_km}`
- `map.populated_within {bbox|circle}` — людей у зоні (HRSL/WorldPop)
- `map.area_change {bbox, layer, since}` — Sentinel diff

**Загалом > 100 chat-actions у v1.** Кожна — typed Pydantic, кожна — повертає `MapActionResult` з `narrative` (для голосу/чату) і `map_mutation` (для UI).

---

## 6. Settings (кожний параметр в UI)

`SettingsPanel.tsx` отримує нову гілку **«Карта»** з 12 секціями:

1. **Загальне**: default style, default zoom, units (km/mi), language for labels (uk/en/lat), 24h/AM-PM.
2. **Шари**: ввімкнути/вимкнути категорії; default-active layers per system state.
3. **Базові тайли**: вибір default base + fallback chain (Protomaps → OpenFreeMap → OSM → cache-only).
4. **API ключі**: окремі поля для MapTiler, Mapbox, Stadia, Thunderforest, OpenRouteService, GraphHopper, Sentinel Hub, OpenWeatherMap, Foursquare, alarms.in.ua, WiGLE, OpenCellID, Mapillary, Shodan, Censys, GreyNoise, AbuseIPDB, AISStream, N2YO, OpenAQ, MET Norway (User-Agent contact), Strava token. Кожен — з тестом «🟢 OK / 🔴 invalid / ⚪ no key».
5. **Routing**: профілі за замовчуванням (car/foot/bike), avoid (toll/highway/ford/militaryborder), prefer (scenic/short/fast/quiet), engine preference (BRouter/OSRM/ORS/Valhalla).
6. **Offline**: default download radius, max disk, auto-refresh schedule, prioritized layers.
7. **Privacy**: GHOST mode default, sealed zones master key (PIN+RFID), encrypted POI auto-expire.
8. **Геофенси**: default actions (notify/voice/silent), default radius, dwell time.
9. **AI ↔ Map**: «агент може автоматично підключати шари» (yes/ask/no), default tour-guide depth, voice narrative speed.
10. **Аларми**: повітряна тривога звук/voice/silent, blackout попередження за N хв, землетруси min магнітуда.
11. **Performance**: max markers (1k/5k/20k), clustering threshold, frame budget cap, mobile-companion sync rate.
12. **Дебаг/Dev**: tile budget HUD, source latency overlay, layer load timing, cache hit rate.

Кожен — Pydantic field у `config.py` + `routes_settings.py` GET/PUT + Zustand reactive.

---

## 7. UI/UX (1024×600, без скролу, 44×44 px touch)

### 7.1. Базовий layout

```
┌────────────────────────────────────────────────────────┐
│ MapStateBadge   SearchOmnibar       AttributionDrawer │  ← 56 px top
├──────┬──────────────────────────────────────────┬──────┤
│      │                                          │      │
│ HUD  │              MapLibre canvas             │ HUD  │  ← 488 px middle
│ left │                                          │ right│
│ 56px │                                          │ 56px │
│      │                                          │      │
├──────┴──────────────────────────────────────────┴──────┤
│ ScaleBar   LayerPaletteChip   ChatBridgeChip   GpsHud │  ← 56 px bottom
└────────────────────────────────────────────────────────┘
```

- **HUD-left** (вертикальна колонка, 56 px wide, 44×44 кнопки): style, layers, search, journey, recon, offline, ghost.
- **HUD-right**: ruler, bearing, elevation, geofence-draw, time-machine, screenshot, share, settings.
- **Search omnibar** (top center): pill, autocomplete, agent-аware. Чат-кнопка справа («запитай агента»).
- **Layer Palette chip** (bottom): horizontal scroll з активними layers, double-tap → відкрити Library.
- **Chat bridge chip** (bottom-right): «🎙 PHANTOM, ...» — коли активний voice.
- **State badge** (top-left): кольорова крапка, що відображає поточний SystemState.
- **Attribution drawer** (top-right): collapsible, динамічний.

### 7.2. Стани (SystemState ↔ MapStyle)

| State | Base | Accent | Активні шари за замовч. |
|-------|------|--------|--------------------------|
| SHADOW | dark vector | accent-soft | terminator, GPS-track |
| FOCUS | dark vector | accent-strong | viewport-only, search-focus |
| DIALOGUE | light vector | accent-warm | nearby POI, landmarks |
| RECON | satellite + hillshade | signal-warning | wardriving, frontline, fires, ADS-B |
| SENTINEL | dark vector | signal-alert | air-raid, geofences, threats |
| GHOST | black + red accent | signal-ghost | sealed zones only, no nominatim, no online geo |
| DREAM | dark + 3D terrain | accent-violet | 24h time-lapse history, sat passes |

### 7.3. Картки (per-layer)

Кожен layer має свій `*Card.tsx` (AircraftCard, ShipCard, BunkerCard, ...). Усі — однакова shell, різний body. AI-блок «📡 PHANTOM думає...» автоматично інжектить контекст.

### 7.4. Анімації

- LayerEnter: opacity 0→1 + 200ms scale 0.98→1
- FlyTo: easing cubic-bezier(0.4, 0, 0.2, 1), duration адаптивна (відстань → 600-2200 ms)
- AirRaid pulse: 2s cycle, eased
- ADS-B trail: 30s decaying polyline
- Satellite pass: animated arc with progress dot
- Earthquake: shockwave ripple (concentric, 1.2s)
- Fire: warm glow flicker

Усе — Framer Motion + CSS variables, без декоративних рухів.

---

## 8. Mobile companion (Phase 19 inheritance)

`MobilePairing.tsx` залишається settings-only. **Новий екран** `MobileMap.tsx` (Android Compose сторона, з документа `docs/MOBILE_COMPANION_DESIGN.md`):

- Pair → token → WS subscribe `/ws/mobile/<device_id>`
- Telephone GPS → WS push → backend → GeoLocation source (high-accuracy)
- Backend WS push → mobile renders subset of layers (presence, journey, geofence, air-raid)
- Voice from phone → STT → backend agent → MapAction → result back to phone
- «Send marker to PHANTOM» → POST `/map/pois` from phone with auth token
- Offline: phone cache last viewport tiles for 7 days

API: `routes_pair.py` extend → `/pair/map/sub`, `/pair/map/marker`, `/pair/map/voice`.

---

## 9. Offline-first stack (Radxa storage budget)

| Шар даних | Розмір | Каденс оновлення |
|-----------|--------|------------------|
| Protomaps PMTiles (UA + сусіди) | 6 GB | quarterly |
| Copernicus GLO-30 DEM (UA) | 6 GB | yearly |
| Terrarium PNG cache | 2 GB | on-demand |
| Sentinel-2 cloudless (UA, 10m) | 10 GB | yearly |
| Photon index (UA) | 3 GB | quarterly |
| Nominatim DB (UA) | 6 GB | quarterly |
| Overpass-API (UA extract) | 25 GB | weekly diff |
| BRouter RD5 (UA + сусіди) | 1.5 GB | quarterly |
| Valhalla tiles (UA) | 3 GB | quarterly |
| OurAirports CSV+SQLite | 100 MB | monthly |
| OpenAIP (Europe) | 200 MB | monthly |
| OpenCellID (UA) | 50 MB | weekly |
| MaxMind GeoLite2-City | 70 MB | monthly |
| GHSL UA tiles | 200 MB | yearly |
| Meta HRSL UA | 300 MB | yearly |
| WRI Global Power Plants | 5 MB | yearly |
| OurUkraine admin polygons | 50 MB | static |
| CelesTrak TLE | 5 MB | weekly |
| tz_world shapefile | 80 MB | yearly |
| LibreTranslate models (uk↔en) | 500 MB | static |
| Vosk UA model | 1.8 GB | static |
| **Підсумок** | **~66 GB** | мapped to 256 GB SSD |

Залишок 190 GB: ChromaDB, app, sensor logs, screenshots, Mapillary cache.

---

## 10. Безпека / Privacy / Compliance

- **GHOST mode**: всі outbound запити вимикаються (Tor only через окремий проксі, опційно). Online-only шари автоматично hide. UI стає чорно-червоний.
- **Sealed POI**: AES-256-GCM, master key derived from PIN+RFID hash. Записи не дешифруються до auth.
- **API keys**: всі secrets — у `keyring`/encrypted SQLite, доступ через `routes_settings.py` тільки ROOT.
- **Attribution accumulator**: lift-and-shift no allowed; кожен active layer додає рядок ліцензії до bottom sheet.
- **Rate limit guard**: per-source token bucket, soft fallback на cached, voice notice «Не можу зараз — Overpass пише slow down».
- **Geofence privacy**: дані per-user, JWT-scoped.
- **OSINT actions** (Shodan, GreyNoise) — лише ROOT trust level. OPERATOR не має доступу.

---

## 11. Тести (вимога CLAUDE.md)

Кожен 24-X блок завершується:

- **Backend pytest** — `src/backend/tests/test_phase24_<X>_*.py`:
  - source adapter unit tests (mocked HTTP)
  - registry validation tests
  - agent action contract tests (every action returns MapActionResult)
  - cache TTL behavior
  - geofence enter/exit detector
- **Frontend vitest** — `src/frontend/src/__tests__/phase24_<X>/*.test.tsx`:
  - layer toggle store
  - viewport hook
  - LayerLibrary search/filter
  - SearchOmnibar autocomplete
  - MarkerCard renders for each card type
- **Screenshot diff** (Playwright headless via mobile companion test rig):
  - 1024×600 default
  - кожен SystemState → 1 screenshot
  - кожен new card → 1 screenshot
- **Integration** — full flow:
  - chat «увімкни тривогу і фронт» → 2 layers active → screenshot has red oblasts + frontline polyline
  - chat «прокладай маршрут до Львова, уникаючи трас» → route drawn, isochrone optional
  - voice «що тут поруч цікавого» → narrative produced + ≥3 markers added

CI gates: 24-X не closed без зеленого pytest + vitest + screenshot diff ≤ 0.1%.

---

## 12. Фазове постачання (24-A → 24-Z)

> Виконуємо як stack: кожен блок дає ship-able value, тести зеленi, все merged у trunk.

### 24-A — Layer Registry + Map Cache + Attribution
- Pydantic schema, YAML loader, validator, default 12 manifests (existing шарів).
- MapCache (memory + SQLite + disk).
- AttributionStore + drawer.
- API: `GET /map/layers`, `POST /map/layers/<id>/enable`, `DELETE /map/layers/<id>`.
- Tests: registry validation, cache TTL, attribution dedup.

### 24-B — Agent action surface base (12 actions)
- `open_map`, `set_view`, `flyto`, `add_marker`, `query_nearby` (already partially), `geocode`, `reverse_geocode`, `list_layers`, `enable_layer`, `disable_layer`, `snapshot`, `explain_view`.
- Реєстрація у `agent/actions/registry.py`.
- WebSocket channel `map.*`.
- Tests: each action contract, end-to-end chat→action→map mutation.

### 24-C — Routing facade (BRouter offline + ORS online)
- Backend: `geo/routing/`, profiles, isochrones, matrix, map-match.
- Actions: `plan_route`, `isochrone`, `optimize_visit`, `snap_track`.
- Frontend: route layer, route card, alternative routes selector, elevation profile sheet.
- Offline: BRouter Docker, RD5 UA bundle.
- Tests: route generation per profile, fallback chain, offline-only mode.

### 24-D — OmniMap shell + HUD
- New `OmniMap.tsx` (replaces TacticalMap orchestration; legacy stays as `TacticalMap.tsx` wrapper).
- HUD components: shell, status chips, search omnibar, layer palette, attribution drawer, scale bar, ruler tool, bearing, screenshot.
- Settings гілка «Карта» — секції 1-3.
- Tests: vitest hooks, screenshot diff per state.

### 24-E — Layer Library + 20 нових layer manifests
- LayerLibrary panel: search, filter, favorite, enable/disable.
- 20 manifests: AirRaid, Frontline, ADS-B, AIS, Fires, Earthquakes, Lightning, Weather radar, AQI, NO2, Aurora, Light pollution, Sun/Moon, Sat passes, Substations, Power plants, Bunkers, Cell towers, Tor relays, Mapillary.
- Per-layer card components.
- Tests: each layer renders mock GeoJSON + card opens.

### 24-F — Live awareness layers (UA-critical)
- Adapters: alarms_ua, deepstatemap, ukrenergo_blackouts.
- Polling tasks (asyncio), WS broadcast.
- Voice/sound triggers via existing notification pipeline.
- Settings гілка «Аларми».
- Tests: mock alarms feed, oblast polygon paint, blackout schedule render.

### 24-G — Offline region manager
- `pmtiles_manager.py`, `region_extractor.py`.
- API: `/map/offline/*`.
- UI: `OfflineRegionManager.tsx` (list, download, refresh, delete, capacity bar).
- Action: `download_offline_region`.
- Tests: PMTiles slicing, range request server, capacity calc.

### 24-H — Time machine + change detection
- TimeMachineSlider component.
- Adapters: NASA GIBS daily, Sentinel-2 archive, Corona historical.
- Action: `time_travel`, `compare_dates`, `compute_change`.
- Tests: time-slider URL builder, diff renderer.

### 24-I — Geofence engine
- `geofence_engine.py` polygon detector.
- API: CRUD geofences, history.
- UI: GeofenceDrawTool.
- Actions: `create_geofence`, `list_geofences`, `geofence_history`.
- Notification on enter/exit.
- Tests: enter/exit detector, dwell time, multiple zones.

### 24-J — OSINT/Recon layers (Hacker mode)
- Adapters: opencellid, wigle, shodan_lite, greynoise, threatfox, urlscan, tor_relays, openinfra (substations, lines, masts).
- Settings: API keys section (4).
- Cards: NetworkCard, SubstationCard, ShodanIocCard.
- Actions: `nearby_substations`, `nearby_bunkers`, `nearby_cells`, `nearby_wifi`, `lookup_bssid`, `tor_relays_in`, `shodan_search`, `threats_near`.
- ROOT-only gating.
- Tests: mock responses, permissions, rate-limit fallback.

### 24-K — Tour guide + Recon brief (AI narrative)
- `geo/intelligence/storyteller.py` — collects layers, builds prompt, asks Gemini.
- Actions: `tour_nearby`, `suggest_walk`, `suggest_view`, `recon_brief`, `threat_brief`, `infra_brief`.
- StoryPanel UI з voice playback.
- Tests: narrative quality (snapshot mode), TTS handoff.

### 24-L — Astronomy bundle
- Adapters: celestrak_tle (sgp4), suncalc_local, n2yo, iss_open_notify, noaa_swpc, light_pollution.
- Layers: Sat passes, ISS, Sun/Moon, Aurora, LP.
- Actions: `sat_pass_predict`, `iss_now`, `sun_moon_now`, `golden_hour_today`, `aurora_forecast`, `dark_sky_score`.
- Tests: TLE propagation, suncalc accuracy.

### 24-M — Marine + Aviation bundle
- Adapters: aisstream, opensky, ourairports, openaip, aviation_weather_gov, open-meteo marine.
- Layers: Live ships, Live aircraft, Airports, Airspace, Tides, Waves.
- Actions: `nearby_aircraft`, `nearby_ships`.
- Tests: WS receive, layer animation, callsign lookup.

### 24-N — Energy & infra deep
- Adapters: wri_powerplants, global_solar_atlas, global_wind_atlas, entsoe, electricitymaps.
- Layers: Power plants, Solar potential, Wind potential, Substations (already).
- Actions: `solar_potential`, `wind_potential`, `grid_frequency`, `infra_brief`.
- Tests: per-coords API call, heatmap render.

### 24-O — Mobile map companion
- Android Compose `MobileMap.tsx` (kotlin side via existing companion stack).
- Backend `routes_pair.py` extension: `/pair/map/sub`, `/pair/map/marker`, `/pair/map/voice`.
- Bidirectional WS bridging.
- Phone GPS → backend high-accuracy source.
- Tests: pairing, WS sync, marker echo.

### 24-P — GHOST mode + Sealed zones
- AES-256-GCM encryption pipeline.
- SealedZonesLayer, GhostPanel.
- Actions: `ghost_drop`, `ghost_reveal`, `seal_zone`, `unseal_zone`.
- Auto-disable online layers when GHOST.
- Tests: encryption round-trip, layer hide on state change, key derivation.

### 24-Q — Annotations + Drawing
- Free-form: text, arrow, polygon, ruler-saved.
- AnnotationsLayer, AnnotationsPanel.
- Actions: `annotate_text`, `annotate_arrow`, `annotate_polygon`, `clear_annotations`.
- Persist per-user.
- Tests: annotation CRUD, render order.

### 24-R — Translation + Multilingual labels
- LibreTranslate self-host, Argos models.
- Auto-translate POI names on tap (uk ↔ en ↔ device language).
- Per-layer label language preference.
- Tests: round-trip translation, cache hit.

### 24-S — Wardriving 2.0 (auto-correlate)
- Adapter: opencellid local + wigle online correlation.
- New layer: cell coverage prediction polygons.
- Action: `lookup_bssid`, `lookup_cell`.
- Tests: BSSID→geo, cell→tower lookup.

### 24-T — Photo & street imagery
- Adapters: mapillary, kartaview, flickr_geo, wikimedia_commons.
- Layers: Mapillary coverage, photo-points.
- Cards: PhotoCard з swipe gallery.
- Action: `inspect_feature` shows nearest 5 photos.
- Tests: Mapillary key flow, photo loading mock.

### 24-U — Performance & clustering
- supercluster integration.
- Vector layer migration (FactMarkerLayer, WardrivingLayer → vector source).
- Tile budget HUD (dev mode).
- Frame-budget guard (skip animations under 30 fps).
- Tests: 50k markers smoke test, FPS budget, cluster correctness.

### 24-V — Voice ↔ Map full duplex
- STT-driven map intents: full path mic → text → planner → map action → narrative → TTS.
- Wake-word «PHANTOM, мапа ...» as shortcut.
- All 100+ actions reachable via voice.
- Tests: 30 utterance fixtures → expected actions.

### 24-W — Settings UI complete (12 секцій)
- Final settings panel, всі fields, всі тести API keys.
- Per-state default layers config.
- Performance presets.
- Backup/restore settings JSON.
- Tests: settings round-trip, key validation calls.

### 24-X — Easter eggs + Fun
- Mars layer (NASA tiles).
- «Тут був Тарас Шевченко» — easter overlay для деяких міст.
- Hidden DREAM-mode 24h time-lapse.
- KGB historical map overlay (Corona-derived).
- Tests: layers render, easter trigger conditions.

### 24-Y — Documentation + Wiki integration
- Per-layer wiki entry via OMC `/wiki` skill.
- Action `map.help {topic}` → returns markdown.
- Auto-generate API doc with all 100+ actions.
- Tests: wiki ingest snapshot.

### 24-Z — Polish + Soak
- Visual pass (impeccable:polish skill).
- Edge case hardening (impeccable:harden).
- Accessibility audit (impeccable:audit).
- 7-day soak run on Radxa, telemetry collected.
- Final pytest + vitest + Playwright screenshot diff suite green.
- `docs/PHASE_24_OMNIMAP_ACCEPTANCE.md` written.

---

## 13. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Tile/API rate limits revoke keys | Outage of cloud layers | Per-source token bucket + cached fallback; weekly key health probe |
| 256 GB SSD overflow with offline data | Disk pressure | OfflineRegionManager with capacity bar + LRU eviction policy |
| Strava heatmap requires user cookie | Layer unusable headless | Make optional, fail-soft; instructions in settings |
| WiGLE manual approval delay | Hacker layer blocked | Ship adapter gated, allow OpenCellID-only mode in interim |
| Sentinel-5P plume tiles heavy | UI lag | Pre-tile via Sentinel Hub Process API + cache 7 days |
| AISStream WS bandwidth | Network saturation | bbox-filtered subscription; pause when SHADOW |
| `alarms.in.ua` non-commercial license | Legal risk | Confirm with maintainers; show clear attribution; if denied → fallback to scraping or manual user feed |
| DeepStateMap scraping breaks | UA frontline missing | Use community GeoJSON mirrors; fail-soft |
| ARM64 Overpass-local heavy | RAM pressure | Either limit to PostGIS+osm2pgsql или delegate to LAN server |
| Gemini cost | $$ | Cache `explain_view` outputs by viewport hash; downgrade to Ollama when low complexity |
| Privacy leak of GHOST data | Critical | Mandatory test suite + RBAC test that GHOST never leaves local DB |

---

## 14. Discovery deltas (на що звернути увагу під час реалізації)

З аудиту поточного стану (Phase 6 done):

- **Готове до повторного використання**: TacticalMap.tsx (1126 LOC), 7 layer файлів, mapStore (211 LOC), routes_map.py (500 LOC), MarkerCard (427 LOC), NearbyPanel (262 LOC), TimelineDrawer (148 LOC), ServicesHealthBanner (199 LOC), Overpass adapter, BrowserGeolocation source, geo_extractor + geo_query.
- **Half-built (закрити в 24-D)**: Satellite/Compass/Route HUD кнопки без onClick, FactMarkerLayer hard-coded 5min poll, MarkerCard без cross-source enrichment.
- **Missing (24-B/24-C/24-J)**: жодних агент-actions для мапи; немає WS map.* каналу; немає clustering; немає route engine; немає custom tiles.

---

## 15. Acceptance criteria (PHASE_24 done definition)

PHASE 24 = OMNIMAP ship-ready коли:
1. ≥40 шарів зареєстровано і рендериться, кожен має manifest + card + tests.
2. ≥100 chat-actions реалізовано і покрито pytest contract tests.
3. Voice fully duplex: 30 фікс-фраз з фікстур → правильні actions з ≥95% accuracy.
4. Offline mode: PHANTOM працює в air-plane mode (Wi-Fi off) з повним базовим стеком; всі offline-tagged layers активні; degradation graceful.
5. GHOST mode: zero outbound traffic коли активний; sealed зони не дешифруються без auth.
6. Mobile companion: pair → live map sync ≤500ms latency.
7. Performance: 60 fps на Radxa Dragon Q6A з 5000 markers + 6 active layers + ADS-B live stream.
8. Tests: pytest суцільний 100% pass, vitest 100% pass, Playwright screenshot diff ≤0.1%, no flake у 7-day soak.
9. Documentation: wiki entry per layer (40+); API doc auto-generated з всіма 100+ actions; `PHANTOM_FAMILIAR.md` оновлено з map persona examples.
10. Operator demo: 5-хвилинне відео де голосом українською без жодного кліку проводиться tour-guide + recon-brief + air-raid alert + offline download + ghost drop. Відео — артефакт acceptance.

---

## 16. Естетика та філософія

PHANTOM-карта не показує світ. Вона **думає про світ разом з оператором**.

Кожне натискання — діалог. Кожен шар — питання. Кожна тривога — вибір реакції. Кожна поїздка — спогад, який мапа відсортує і покаже через місяць коли треба.

OMNIMAP — це коли карта пам'ятає, що вчора о 19:42 ти зупинився на цьому повороті і подумав «треба сюди повернутись». І сама нагадує про це — без команди — наступного разу, коли ти близько.

Це не функція. Це поведінка.

---

*Документ створено в межах автономного дня 2026-05-03. Implementation starts at 24-A. Кожен блок — atomic commit + tests + acceptance markdown.*
