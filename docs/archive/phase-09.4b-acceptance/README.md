# Phase 9.4b — Map as Spatial Intelligence Acceptance

- **Date:** 2026-04-20
- **Branch:** `autonomous-run`
- **Base tag:** `v0.9.4a-multitrack`
- **Target tag:** `v0.9.4b-spatial-intelligence`
- **Status:** **COMPLETE**

## Scope

Phase 9.4b turns PHANTOM's MAP section from an OSM-tiles viewer into a
spatial intelligence surface. Four parts, each fully additive — no
pre-9.4b behaviour changed.

1. **Multi-source localization** — pluggable `LocalizationSource` chain
   with trust hierarchy (GPS 95 > user-stated 80 > browser geo 70 >
   IP 30) and velocity-based sanity rejection.
2. **Memory-to-geo bridge** — spaCy NER + regex fallback extracts place
   entities from chat messages, forward-geocodes via Nominatim, stores
   `MemoryFact` rows with `place_*` columns. Explicit self-location
   statements ("я в Одесі", "I'm in Kyiv") feed the `UserStatedSource`.
   Country changes emit `REGION_CHANGED` proactive triggers.
3. **LocationHistory** — persistent position log with writer (>50 m or
   >5 min between entries) + hourly reverse-geocode enricher. Timeline
   drawer UI lists entries click-to-fly.
4. **Nearby places** — `/map/nearby` combines remembered memories, OSM
   features via Overpass, and saved POIs into one response. NearbyPanel
   auto-surfaces at zoom ≥ 14. `NEAR_REMEMBERED_PLACE` trigger fires when
   the user approaches a previously mentioned location.

## Parts

### Part 1 — Localization infrastructure (commits `ce181ce`, `26b7821`)

Files:
- `src/backend/agent/localization/__init__.py` — public surface
- `src/backend/agent/localization/base.py` — `LocationEstimate`,
  `LocalizationSource`, `haversine_km`
- `src/backend/agent/localization/resolver.py` — `LocalizationResolver`
  with trust-sorted sources + sanity gate
- `src/backend/agent/localization/lifecycle.py` — `wire_default_sources()`
- `src/backend/agent/localization/sources/gps_hardware.py` — trust 95
- `src/backend/agent/localization/sources/browser_geolocation.py` — trust 70
- `src/backend/agent/localization/sources/ip_estimate.py` — trust 30
- `src/backend/agent/localization/sources/user_stated.py` — trust 80
- `src/backend/agent/localization/adapters/ipapi.py` — ipapi.co adapter
- `src/backend/agent/localization/adapters/rate_limiter.py` — `DailyRateLimiter`,
  `PerSecondRateLimiter`
- `src/backend/core/context_engine.py` — `resolve_localization()` publishes
  `{source, confidence, accuracy_m}` provenance on every snapshot
- `src/backend/api/routes_map.py::submit_geolocation` — browser geo intake
- `src/frontend/src/services/geolocation.ts` — `BrowserGeolocationService`
- `src/frontend/src/components/map/TacticalMap.tsx` — starts the geolocation
  service on mount

Core surface:
```python
class LocalizationSource(ABC):
    name: str
    trust_level: int  # 0..100, higher = tried first
    def is_available(self) -> bool: ...
    async def get_position(self) -> Optional[LocationEstimate]: ...
```

**Sanity gate:** reject any accepted fix that would require >1080 km/h
velocity from the last accepted fix within a 5 s window. Past 5 s, any
motion is physically plausible (10 min covers intercontinental flights).
Backwards-clock timestamps are rejected unconditionally.

**ContextEngine snapshot change:**
```json
"where": {
  "lat": 50.4501, "lon": 30.5234, "fix": true,
  "satellites": 8, "speed_kmh": 0.0,
  "source": "gps_hardware",       // ← NEW
  "confidence": 0.9,               // ← NEW
  "accuracy_m": 15.0,              // ← NEW
  "place_known": false, "place_name": null, "first_visit": false
}
```

### Part 2 — Memory-to-geo bridge (commit `7968e6f`)

Files:
- `src/backend/memory/geo_extractor.py` — spaCy NER + regex fallback
- `src/backend/memory/geo_integration.py` — chat-handler hook
- `src/backend/memory/geo_query.py` — `find_memories_near`
- `src/backend/agent/localization/adapters/nominatim.py` — forward + reverse
- `src/backend/db/models.py` — `MemoryFact` gains `place_*` columns
- `src/backend/db/migrations/002_memory_facts_geo.py` — idempotent ALTER
- `src/backend/api/routes_chat.py` — REST + WS paths both call
  `process_chat_message_for_places`
- `src/backend/agent/proactive_triggers.py` — adds `REGION_CHANGED`,
  `NEAR_REMEMBERED_PLACE`

Pipeline per user message:
1. `GeoExtractor.detect_self_location(text)` — regex-first "я в {Place}" /
   "I'm in {Place}" parse. No false-positive on bare place mentions.
2. If self-location match: forward-geocode → `set_user_stated(...)` +
   reverse-geocode → compare country → emit `REGION_CHANGED` when it flips.
3. `GeoExtractor.extract(text, lang)` — spaCy GPE/LOC/FAC if model
   available, else Title-Case regex fallback.
4. Geocode up to 3 entities, store each as a `MemoryFact` with
   `place_source="ner_extracted"`, `place_confidence=0.6`.

### Part 3 — LocationHistory + timeline UI (commit `db49d68`)

Files:
- `src/backend/db/models.py::LocationHistory` — new table
- `src/backend/db/migrations/003_location_history.py` — idempotent CREATE
- `src/backend/agent/localization/history_writer.py` —
  `LocationHistoryWriter` + `LocationHistoryEnricher`
- `src/backend/api/routes_map.py::get_location_history` — paged endpoint
- `src/frontend/src/components/map/TimelineDrawer.tsx` — UI

Writer cadence: poll every 10 s, append only when
`move > agent_location_history_min_distance_m` OR
`elapsed > agent_location_history_min_interval_s`. Prune rows older than
`agent_location_history_retention_days` every ~50 writes.

Enricher cadence: every `agent_location_history_enricher_interval_s` (default
1 h). Batches up to 100 rows per cycle through Nominatim reverse at 1 req/s.

### Part 4 — Overpass + nearby panel (commit `ed55999`)

Files:
- `src/backend/agent/localization/adapters/overpass.py` — OverpassQuery
- `src/backend/agent/localization/nearby_watch.py` —
  `NEAR_REMEMBERED_PLACE` emitter with 1-hour dedup
- `src/backend/api/routes_map.py::get_nearby` — unified three-source endpoint
- `src/frontend/src/components/map/NearbyPanel.tsx` — UI

```json
GET /api/v1/map/nearby?lat=50.45&lon=30.52&radius_m=500
{
  "remembered": [ { "id": "...", "place_name": "...", "distance_m": 120, ... } ],
  "osm":        [ { "osm_id": 123, "name": "Парк", "type": "leisure=park", "distance_m": 250 } ],
  "pois":       [ { "id": "...", "name": "Home", "distance_m": 80, ... } ]
}
```

NearbyPanel auto-fetches when zoom ≥ 14 and a position is known; renders a
collapsed pill at low activity and expands to three sections on click.

## External services — cheat sheet

| Service       | Purpose            | Free tier    | Auth      | Rate limit (enforced) |
|---------------|--------------------|--------------|-----------|-----------------------|
| ipapi.co      | IP-based fallback  | 1000/day     | none      | 900/day (cap)        |
| Nominatim     | Forward + reverse  | unlimited\*  | UA header | 1 req/s               |
| Overpass API  | Nearby OSM nodes   | unlimited\*  | none      | 1 req/s               |

\* *Fair-use policy; cache aggressively.* Nominatim caches 7 days
(forward) + 7 days (reverse ~11 m key). Overpass caches 24 h keyed on
`(lat, lon, radius, feature_types)`.

## Config keys (hot-reloadable via AD-02)

```
agent_localization_enabled              = True
agent_localization_sanity_max_speed_kmh = 1080.0

agent_browser_geolocation_enabled       = True
agent_browser_geolocation_freshness_s   = 60.0

agent_ip_locator_enabled                = True
agent_ip_locator_rate_per_day           = 900

agent_user_stated_ttl_s                 = 86400

agent_nominatim_enabled                 = True
agent_nominatim_user_agent              = "PHANTOM-OS/0.9 (localhost)"
agent_nominatim_cache_ttl_s             = 604800

agent_overpass_enabled                  = True
agent_overpass_cache_ttl_s              = 86400

agent_geo_extractor_enabled             = True
agent_geo_extractor_min_entity_length   = 3

agent_location_history_enabled          = True
agent_location_history_min_distance_m   = 50.0
agent_location_history_min_interval_s   = 300
agent_location_history_retention_days   = 90
agent_location_history_enricher_interval_s = 3600

agent_near_remembered_dedup_s           = 3600
agent_near_remembered_radius_m          = 200.0
```

## Test counts

| Suite             | Before 9.4b | After 9.4b | Δ    |
|-------------------|------------:|-----------:|-----:|
| Backend (pytest)  | 600         | 659        | +59  |
| Frontend (vitest) | 142         | 154        | +12  |

Per-file backend additions:
- `test_phase09_4b_localization.py` — 24 tests (resolver, sources, ipapi, wiring)
- `test_phase09_4b_geolocation_endpoint.py` — 3 tests (submit API)
- `test_phase09_4b_memory_geo.py` — 16 tests (NER, Nominatim, chat hook, find_memories_near)
- `test_phase09_4b_location_history.py` — 6 tests (writer + enricher)
- `test_phase09_4b_overpass_nearby.py` — 10 tests (Overpass, /nearby, /location_history, trigger)

Per-file frontend additions:
- `NearbyPanel.test.tsx` — 6 tests
- `TimelineDrawer.test.tsx` — 6 tests

## Live smoke test

**Status: DEFERRED.** Live verification requires Gemini quota + Nominatim /
Overpass live reachability + a real GPS fix or browser-geolocation session.
At tag time the focus is correctness of the abstraction and its test
coverage; all external adapters are extensively stubbed in CI.

The unit tests validate trust-order dispatch, sanity rejection, rate-limit
behaviour under adapter saturation, chat-handler geo ingest, writer gating
on distance/time, enricher reverse-geocode updates, Overpass cache hits,
three-source `/nearby` composition, and both new proactive triggers.

## Known limits

1. **spaCy models optional.** If `en_core_web_sm` / `uk_core_news_sm` are
   not installed the extractor falls back to a regex that identifies
   Title-Cased place-like tokens. False positives are bounded by the
   3-entity-per-message geocoding cap.
2. **Single-user.** All localization state (user-stated cache, browser
   submission slot, nearby dedup) is module-level; PHANTOM is single-tenant
   by design.
3. **Nominatim forward cache is text-keyed**, not place-ID-keyed, so
   "Київ" and "Киев" geocode separately. Cost: two cache slots; not a
   correctness issue.
4. **Overpass is rate-limited globally.** During the first nearby query
   in a fresh cache the user may wait up to ~1 s. Subsequent queries in
   the same ~50 m cell are free for 24 h.
5. **LocationHistory retention is a periodic prune**, not a row-by-row
   TTL. A very busy session (many writes) triggers prunes more often;
   an idle session may hold expired rows a few hours past their TTL.
6. **Browser geolocation submission is best-effort.** Network errors
   from the client fail silently; the source goes stale after its
   freshness window and the resolver falls through to IP estimate.
7. **REGION_CHANGED needs two reverse-geocode hits** (prior + current).
   The first "я в Одесі" after a restart establishes a baseline but
   doesn't fire. Second stated-location in a different country fires.
8. **NEAR_REMEMBERED_PLACE dedup is per-memory-id**. Moving away and
   returning to the same memory won't re-fire within the 1 h window.
9. **Proactive stays default OFF.** 9.3b OVERRIDE unchanged.

## Foundation for future phases

- The `LocalizationSource` interface is the plug-point for Phase 10
  hardware events (cell-tower, WiFi trilateration) — add a subclass,
  call `resolver.add_source(MySource())` in `wire_default_sources`.
- `ExternalGeocoder` / `IPLocator` / `NearbyFeatureQuery` interfaces
  let future commercial providers (Mapbox, Google Maps) swap in via
  config without touching callers.
- `NEAR_REMEMBERED_PLACE` and `REGION_CHANGED` are decoupled from the
  proactive LLM — the triggers accumulate even when proactive is
  disabled; flipping it on surfaces the accumulated context.

## Honest assessment

PHANTOM now understands space with memory. Chat messages seed geo-tagged
memories; the resolver maintains a trust-ordered position estimate with
provenance; the UI surfaces nearby context automatically; the proactive
loop has two new kinds of "something worth saying" signals.

Concerns to monitor in production:
- **Nominatim caching is aggressive but unbounded in memory.** A chat
  session that mentions hundreds of unique places accumulates cache
  entries. Consider LRU eviction in 9.5 if it becomes an issue.
- **spaCy-less environments degrade to regex quality.** Ukrainian-heavy
  text especially benefits from `uk_core_news_sm`; document in README.
- **LocationHistory writer polls every 10 s.** On battery-sensitive
  deployments (future mobile variant?) this may be too frequent; gate
  on a config key or make event-driven via resolver notifications.
- **ContextEngine tick now awaits `resolve_localization`.** All sources
  are cheap (cached), but the IP adapter does a 5 s network timeout on
  cold cache. Initial boot may pay one 5 s IP lookup before the tick
  loop settles. Acceptable.

Overall: 9.4b delivers the architectural backbone the map section was
missing. Every external service is a swappable adapter, every geo object
carries provenance, and the proactive brain now has spatial awareness on
tap. The implementation is bounded and additive — all 600 prior-phase
tests still pass.
