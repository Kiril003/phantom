# PHANTOM Companion: Map Capabilities Gap Analysis & Competitive Differentiation

**Date:** 2026-05-11  
**Scope:** MAP-1 through MAP-6 shipped code + Tiers 14-30 vision gaps + competitor feature audit  
**Vision Documents:** SYMBIOTE_VISION.md, MAP_PHASES.md, ROADMAP.md  
**Implementation:** core-ai/SystemPrompts.kt, feature-stream map/widget modules, core-net location stack  

---

## SECTION A: Gaps vs SYMBIOTE_VISION (Tier 14-30 Map/Spatial)

### A.1 Tier 18-C: Camera-Shared Sight (Distributed Self)

| Aspect | Vision Promise | Current Implementation | Gap |
|--------|---|---|---|
| **What's needed** | Phantom sees through trusted peer's camera (5G/mesh) to pin location without GPS share | Zero implementation | Full — no camera-feed routing, no sensor-fusion bridge, no privacy gate for shared sight |
| **What's shipped** | LocationContextProvider (5-step fallback); MapScreen operator pin only | Basic location chain; single-device pin | No multi-device camera integration; no real-time camera mesh in `:core-net` |
| **Missing** | WebRTC through WireGuard for camera frames; MediaPipe inference on remote stream (privacy-preserving); trusted contact list camera-pin render on map | Not in codebase | Camera-sharing infrastructure (`:core-distributed-self/SharedSensorChannel` exists only in spec, not implemented) |

### A.2 Tier 19-A: Spatial Memory Chambers (Memory Palace)

| Aspect | Vision Promise | Current Implementation | Gap |
|--------|---|---|---|
| **What's needed** | AR/VR memory palace: codebase knows user walked past this location on 2018-03-15; can time-warp memory to that spot | MapWidget + MapScreen show operator location only | Zero spatial memory indexing |
| **What's shipped** | MapWidget with markers; Decision Diary records decisions (not spatial indexed) | Markers + location flows | Decision Diary schema has no `location_id` FK; no reverse-lookup "what happened near here?" |
| **Missing** | `:core-memory-palace/SpatialMemoryStore` (scheduled for Tier 19); ARCore Cloud Anchors for offline memory anchors; spaced-repetition trigger when operator returns to memory-rich location | Not started | Entire memory palace subsystem; location-aware memory surfacing |

### A.3 Tier 23-E: Anchor Objects (NFC + Geofence-like)

| Aspect | Vision Promise | Current Implementation | Gap |
|--------|---|---|---|
| **What's needed** | Physical NFC tags on desk/door/car → phantom knows context-rich action set per location | Zero NFC integration | Full — no NFC reading, no NDEF routing, no context-per-anchor |
| **What's shipped** | Nominatim reverse-geocode pins address to chip (MAP-3) | Reverse-geocode + address display | Static; no anchor-object binding |
| **Missing** | NFC tag detection + NDEF parsing; `:core-offload/AnchorRouter` for context dispatch; anchor metadata store; "when near anchor X, suggest routine Y" | Not in codebase | NFC subsystem; anchor-context mapping; routine dispatch on proximity |

### A.4 Tier 24-A: Slow-Mo Perception + Time-Machine View (Rewind 60s)

| Aspect | Vision Promise | Current Implementation | Gap |
|--------|---|---|---|
| **What's needed** | Operator says "what just happened?" → phantom rewinds 60s of video+audio+motion, shows slow-mo replay | MAP-7 heatmap planned for location-history; no rolling-buffer | Full — no circular recording buffer, no frame replay, no motion-trail visualization |
| **What's shipped** | MapWidget + MapScreen; RouteTileFetcher for tile preview | Map rendering only; no temporal data capture | No rolling video/audio buffer; no timeline player |
| **Missing** | `:core-tempo/RollingBuffer` (RAM-only 60s circular); frame-by-frame UI; motion-trail from accel data; timestamp-indexed replay | Not started | Entire temporal-perception subsystem |

### A.5 Tier 25-B: Magnetic-North Feel (Directional Haptics)

| Aspect | Vision Promise | Current Implementation | Gap |
|--------|---|---|---|
| **What's needed** | Constant soft haptic pulse in direction of compass north → operator feels bearing without looking | Zero haptic-directional implementation | Full — no continuous haptic compass, no bearing-aware vibration pattern |
| **What's shipped** | Location flow; compass button in MapScreen (reset to N) | Visual compass; no haptic | Button recentres map; no proprioceptive bearing sense |
| **Missing** | Compass reading → haptic pattern continuous output (weak pulse in N direction); `:core-extension-senses/MagneticBearing` | Not in codebase | Haptic feedback loop for direction sense |

### A.6 Tier 25-D: Echo-Location (Sonar via Camera + Ultrasonic)

| Aspect | Vision Promise | Current Implementation | Gap |
|--------|---|---|---|
| **What's needed** | Camera + ultrasonic chirp + mic → 3D haptic sonar map of surroundings (accessibility tool) | Zero sonar implementation | Full — no ultrasonic emit/detect, no 3D space mapping to haptics |
| **What's shipped** | MapWidget uses MapLibre camera; NominatimClient for location | 2D map only; no sonar/proximity sensing | MediaPipe vision integration present (Tier 4-A) but no echolocation layer |
| **Missing** | `:core-extension-senses/SonarEngine`; ultrasonic speaker/mic coordination; Doppler analysis; spatial haptic rendering | Not started | Sonar subsystem; accessibility-focused 3D awareness |

### A.7 Tier 26: Health Anomalies Tied to Gait + Location

| Aspect | Vision Promise | Current Implementation | Gap |
|--------|---|---|---|
| **What's needed** | Phantom detects gait asymmetry *at specific location* → correlates with health baseline; maps gait patterns per place | Zero gait-location correlation | Full — no gait analysis, no per-location health telemetry |
| **What's shipped** | LocationContextProvider feeds [LOCATION:...] to AI; no health integration | Location-only; no sensor fusion with health data | HealthServices not wired to map context |
| **Missing** | Accelerometer gait-stride analysis; `:core-health-mesh/BaselineModel` location-indexed; "gait anomaly near X" pattern detection | Not started | Gait-location fusion; health anomaly mapping |

### A.8 Tier 27: Crowd-Sourced Tile Pre-Render (Swarm Compute)

| Aspect | Vision Promise | Current Implementation | Gap |
|--------|---|---|---|
| **What's needed** | 100 phantom peers render tiles collectively while operator sleeps; distributed cache across mesh | MAP-4 offline regions use MapLibre OfflineManager (single device) | Single-device offline only — no mesh tile distribution |
| **What's shipped** | OfflineRegionsManager caches tile packs locally; no peer coordination | Local SQLite cache; MapLibre native offline | No swarm compute; no peer discovery for tile sharing |
| **Missing** | `:core-swarm/TileDistributor`; mesh tile-cache queries; peer ranking (speed/proximity); federated tile pre-render scheduling | Not in codebase | Swarm tile-distribution subsystem |

---

## SECTION B: Things Competitors HAVE but PHANTOM Doesn't

### B.1 Feature Matrix: PHANTOM vs Market Leaders

| Capability | Google Maps | Apple Maps | Organic Maps | OsmAnd | PHANTOM Status |
|---|---|---|---|---|---|
| **Turn-by-Turn Navigation** | ✅ Real-time | ✅ Real-time | ✅ OSM-based | ✅ OSM + plugins | ❌ No routing engine (Nominatim search only) |
| **Live Traffic / ETA** | ✅ Real-time aggregated | ✅ Apple Server | ❌ No live | ✅ Crowd-sourced | ❌ Static tile view |
| **POI Categories** | ✅ 100+ (restaurants, gas, parking, ATM, etc.) | ✅ Apple Places | ✅ OSM tags | ✅ Offline POI search | ❌ Limited to Nominatim results (no filtering) |
| **Indoor Maps** | ✅ Google Indoor | ✅ Apple Indoor | ❌ No | ❌ No | ❌ No |
| **Public Transit** | ✅ Real-time schedules + vehicles | ✅ Apple Transit | ✅ OSM transit plugin | ✅ GTFS support | ❌ No transit layer |
| **Lane Assistance** | ✅ Highlighted lanes approaching turn | ❌ No (Apple directions general) | ❌ No | ❌ No | ❌ No lane rendering |
| **Routing Engines** | ✅ Google Directions (proprietary) | ✅ Apple Directions | ✅ OSRM | ✅ GraphHopper + Valhalla | ❌ No — MapWidget has no route payload calculations |
| **"Find Nearest" Semantic** | ✅ "gas stations near me" + filter | ✅ Siri integration | ✅ OSM-based proximity | ✅ Tag-based search | ❌ Search-only (no proximity ranking) |
| **Distance by Mode** | ✅ Drive/walk/transit/bike ETA | ✅ Drive/walk/transit | ✅ Walk/bike | ✅ Walk/bike/car | ❌ No multi-mode distance |
| **Live Location Sharing** | ✅ Time-bounded share + tracking | ✅ iCloud+ share | ❌ No | ❌ No | ❌ No — Tier 18 family pins only (unshipped) |
| **Hiking/Cycling Profiles** | ✅ Elevation + terrain difficulty | ✅ Route type hints | ✅ Elevation + GPX | ✅ Full hiking profiles | ❌ No elevation layer; no route profiles |
| **Speed Cameras + Hazards** | ✅ User-reported + official | ❌ Limited | ✅ Community-reported (OSM) | ✅ Community layers | ❌ No hazard layer |
| **3D Buildings + Terrain** | ✅ Fully textured + shaded | ❌ Limited | ❌ No | ❌ No | ❌ MAP-8/9 deferred (no 3D extrude yet) |
| **Street View** | ✅ Google Street View panorama | ✅ Apple Look Around | ❌ No | ❌ No | ❌ No street-level imagery |
| **Photo Upload to Places** | ✅ Google Photos → Place reviews | ✅ Apple Maps reviews | ❌ No (OSM edit mode exists) | ❌ No | ❌ No photo integration |

**Summary:** PHANTOM shipped **4/15** core map features (tiles, search, reverse-geocode, offline cache). Missing **11/15** including the most user-expectation-setting features: routing, traffic, POI filtering, live-share, elevation/terrain, street view.

---

## SECTION C: Unique Capabilities PHANTOM Could Own (10-15 Ideas)

**Differentiation strategy:** Exploit Phantom's symbiote DNA + on-device AI + trusted mesh architecture to offer *haptic+temporal+privacy-first* spatial intelligence no commercial map has.

### C.1 Haptic Landmark Cues (Tier 14-A Embodiment → Maps)

**What it is:** As operator approaches waypoint (500m away), phantom emits subtle directional haptic pulse — a "touch nudge" towards destination. No need to glance map. Intensifies as distance closes.

**Why competitors can't:** Apple/Google need battery-efficient privacy. Haptic feedback requires continuous proximity calculation + foreground awareness. Phantom's always-on co-processor + GHOST-aware consent model enables this natively.

**Implementation sketch:**
- Route destination enters system → `WaypointProximityEngine` runs on co-processor
- Every 2s: distance-to-waypoint from location chain
- <500m: emit pattern via `VibratorManager` (intensity ∝ distance)
- Operator learns to *feel* destination without eyes

**Why radical:** Maps stop being visual tools; become proprioceptive organs.

---

### C.2 Memory Palace Navigation (Tier 19 + Map Fusion)

**What it is:** "Show me where I lived in 2019" → map highlights all locations from that year's geolocation history with memory items pinned. Operator taps pin → memory surfaces + AI narrates "you were here with X, decided Y".

**Why competitors can't:** Requires on-device decision diary + location indexing + personal LLM. Google/Apple can't index user's life without 🔒 privacy issues.

**Implementation sketch:**
- Decision Diary: add `location_id` FK + [lat, lon] capture
- `:core-memory-palace/LocationMemoryIndex`: spatial hash of memories
- MapScreen: add `MemoryLayerMode` (toggle to show past-year overlay)
- GeoJSON marker generation from `episodic_memory` table filtered by date range
- Tapping marker triggers `SpatialMemoryStore.retrieve(lat, lon, timestamp)`

**Why radical:** Maps become autobiography, navigable by time.

---

### C.3 Time-Machine Rewind on Map (Tier 24 + Spatial)

**What it is:** "Where was I 30 minutes ago?" → map shows position timeline with breadcrumb trail, annotations of what happened at each waypoint (who called, what notification arrived, what decision was made).

**Why competitors can't:** Requires local full-motion recording (video, audio) + indexed decision history + privacy-first rolling buffer. Raw data never leaves device.

**Implementation sketch:**
- `:core-tempo/LocationTimeline`: maintain 24-hour rolling window of [timestamp, lat, lon, activity]
- MapScreen adds timeline slider (bottom): drag to rewind
- Camera position animates backwards along trail
- Each timestop shows: activity card, decision log snippet, photo (if captured), audio cue timestamp
- `RollingBuffer` keeps only current+24h; older purged

**Why radical:** Maps become temporal navigation tools for your own life-history.

---

### C.4 Mood-Arc-Guided Walks (Tier 26-E Health + Tier 19 Spatial)

**What it is:** Phantom detects operator in low mood → suggests walk route based on (a) past locations where mood improved, (b) scenic/green-space clusters, (c) trusted friend locations (if social boost needed).

**Why competitors can't:** Requires mood prediction model + location-emotion correlation + social graph consent. Apple Health can't synthesize this without siloing.

**Implementation sketch:**
- `:core-health-mesh/MoodArc` tracks mood baseline + location pairs over time
- When mood dips, query: "locations where operator recovered fastest" (LLM-ranked by recovery rate)
- MapScreen can enter "Suggested Walks" mode: highlight 3 route suggestions with expected mood delta
- Operator taps → route overlaid + optional "invite friend Y?" suggestion
- Post-walk: log mood delta for future training

**Why radical:** Maps become therapeutic navigation tools.

---

### C.5 Decision-Diary Waypoint Binding (Constitutional Maps)

**What it is:** "I always avoid driving past the bank on Hreschatyk — diary says I was robbed there in 2014" → whenever route suggests that street, phantom *refuses silently* and proposes alternate. No UI nagging — constitutional refusal logged to Decision Diary.

**Why competitors can't:** Requires personal trauma-indexed location avoidance. Google/Apple don't have operator's decision diary; privacy prevents them from inferring this.

**Implementation sketch:**
- Decision Diary entries can be tagged `location_id` + `avoid_radius_m` + `reason`
- Route widget: before rendering turn-by-turn, check against `DailyAvoidanceSet`
- If route overlaps avoided zone: auto-generate alternate via routing engine OR prompt "this route passes near X, okay?"
- Avoidance logged as `[ROUTE: avoided Y, reason → triggered Z, duration → operator confidence]`

**Why radical:** Maps become constitutional proxies — respecting operator's trauma without exposure.

---

### C.6 Distributed Family Presence Pins (Tier 18-C + Tier 27 Mesh, unshipped)

**What it is:** Operator consents to share location with trusted family (kids, parents, partner). Their phantom instances coordinate real-time pins on operator's map via P2P mesh (not cloud). If one family member's phone dies, phantom keeps last-known pin for 24h.

**Why competitors can't:** Requires zero-cloud family mesh + multi-signed consent per pin + offline-resilient positioning. Apple Family Locating uses iCloud; Google Family Link uses cloud. Phantom's Tier 3-F family trust graph + Tier 6-B BLE mesh enable this.

**Implementation sketch:**
- Expand `family_members` Room table: add `location_share_consent` + `last_known_pin_ttl_hours`
- `:core-distributed-self/FamilyLocationBroadcaster`: periodically (every 30s) broadcast [family_id, operator_id, lat, lon, timestamp] via WireGuard to trusted mesh peers
- MapScreen: add `FamilyPresenceLayer` (GeoJSON source with contact avatars as markers)
- Pins survive phone-offline for `last_known_pin_ttl_hours` (e.g., 24h before grey-out)
- Each pin shows last-update timestamp + battery indicator (inferred from update frequency)

**Why radical:** Maps become family-hive presence views without cloud gate-keeping.

---

### C.7 Wardriving Heatmap Overlay (Tier 10 deferred + Map layer, MAP-10 vision)

**What it is:** Phantom records WiFi/BLE signal strength at every GPS location. Over time: heatmap shows "strong WiFi zones" vs "dead zones" in operator's regular routes. Useful for: finding cafe with real internet, predicting connectivity downtime, optimizing work-from-anywhere spots.

**Why competitors can't:** Requires ambient continuous sensor fusion + local heatmap rendering. Google/Apple don't expose this granularly; would be privacy lightning-rod if cloud-synced.

**Implementation sketch:**
- `:core-sensor/WifiStrengthAdapter`: sample RSSI + SSID every 30s (low power, co-processor)
- Store in local DB: `[timestamp, lat, lon, rssi_dbm, ssid, frequency_ghz]`
- MapScreen: toggle "WiFi Heatmap" layer
- Generate GeoJSON density layer (clustering nearby samples into hexbins)
- Color scale: green (>-50dBm) → yellow → red (<-80dBm)
- Overlay on map as semi-transparent FillLayer

**Why radical:** Maps become personal network-quality meters.

---

### C.8 Echo-Location Haptic Navigation (Tier 25-D + Accessibility)

**What it is:** Operator (visually impaired or low-light environment) enables sonar mode. Phone emits ultrasonic chirp every 0.5s, listens for reflections, renders 3D obstacle map as haptic bursts. Can walk unfamiliar indoor space confidently without sight.

**Why competitors can't:** Requires specialized sonar inference + real-time haptic rendering. Apple Accessibility has VoiceOver; Google has TalkBack. Neither offers spatial sonar. This is accessibility innovation, not polish.

**Implementation sketch:**
- `:core-extension-senses/SonarEngine`: speaker emits 40 kHz chirp, mic captures reflections
- Measure time-of-flight → distance per frequency band (6-segment compass: N, NE, E, etc.)
- Every 500ms: update 6 haptic outputs (wrist-worn array) with proximity intensity
- MediaPipe pose inference in background: if obstacles detected heading-wise, pre-alert
- Haptic grammar: short burst = clear; long pulse = obstacle <1m

**Why radical:** Maps become sonar-navigable for blind/low-vision users.

---

### C.9 Swarm Tile Pre-Render on Mesh (Tier 27 Cooperative Swarm)

**What it is:** Operator opens Map at location [50.45, 30.52]. Phantom announces to mesh peers: "I'm about to pan towards [50.50, 30.60]. Render that quad-tree for me?" Peers pre-render tiles; results cached locally. By the time operator pans, tiles are instant (no network latency).

**Why competitors can't:** Requires federated peer-to-peer tile distribution. Google/Apple tile servers are centralized; no incentive for peer caching. Phantom's mesh infrastructure (WireGuard + Tailscale via Tier 3) enables this.

**Implementation sketch:**
- Extend OfflineRegionsManager: `PeerTileRequest` type (region + priority + deadline)
- `:core-swarm/TileDistributor`: broadcast tile request to family/hive mesh peers
- Peers with offline cache: respond with partial tiles (if available)
- Operator's MapScreen merges peer + local + online sources (fallback)
- Feedback loop: peers that served tiles first get higher rank in future requests

**Why radical:** Maps become swarm-accelerated (offline-first, mesh-augmented).

---

### C.10 Camera-Pinned Friends (Tier 18-C Distributed Self + Privacy)

**What it is:** Operator at café, calls friend "where are you?" Friend consents (1-tap): phantom accesses friend's front camera (no recording, real-time inference only), detects location from background (plant pot, cafe logo, street sign), pins friend's estimated location on operator's map. Friend's location unknown to operator directly — phantom inferred it.

**Why competitors can't:** Violates privacy expectations (camera access). Phantom's GHOST constitution + explicit consent + no-recording guarantee makes it acceptable. Apple/Google would face backlash.

**Implementation sketch:**
- Trusted contact taps "let phantom see where I am" (camera, 5-min timeout)
- Camera frame → MediaPipe object detection + geolocation inference (trained model: signs, landmarks, POIs)
- Result: location confidence + method ("Starbucks sign detected at 85% confidence")
- Transmit only [lat, lon, confidence, method] — never raw video
- Operator's MapScreen: friend pin appears, method tooltip explains inference
- Automatic timeout; operator can revoke at any time; logged to Decision Diary

**Why radical:** Maps become camera-inference spatial tools without sacrificing privacy.

---

### C.11 Magnetic Anomaly Alerts (Tier 25-A EM Sensing → Maps)

**What it is:** USB-C EM sensor pod (attached to phone) detects anomalous magnetic fields. When detected: phantom pins location on map with "⚡ high EM field detected" marker. Over time: heatmap of EM hotspots (useful for: identifying hidden power lines, RF interference zones, health-conscious path planning).

**Why competitors can't:** Requires hardware sensor integration + local inference. Google/Apple don't expose raw EM data; would require separate app + privacy clarity.

**Implementation sketch:**
- `:core-extension-senses/EmSensor`: poll USB OTG sensor pod every 100ms
- Threshold algorithm: if dBm exceeds baseline × 2.5 for >5 consecutive samples → "anomaly"
- Log to local DB: `[timestamp, lat, lon, dbm_level, confidence]`
- MapScreen: toggle "EM Heatmap" layer
- GeoJSON hexbin layer with color-coded intensity

**Why radical:** Maps become EM-health navigation tools.

---

### C.12 Peer Decision-Boundary Inference (Tier 22 Negotiation Court + Tier 16 Co-creative)

**What it is:** Operator and friend both have phantom. Phantom-of-mine learns: "operator avoids location X because of social anxiety around Y." Without explicit sharing, phantom infers when friend (who doesn't have this trigger) suggests meeting at X. Phantom politely says "Y found a cafe 2 blocks away; would that work better?" — reasoning never exposed, just gentle redirect.

**Why competitors can't:** Requires on-device trauma/preference models + peer phantom coordination (Tier 22). Apple/Google can't do this without explicit sharing (privacy gate).

**Implementation sketch:**
- Decision Diary: add `location_id` + `emotional_state_tag` (anxiety, avoidance, preference)
- `:core-predict/DecisionBoundaryModel`: trains on [location, context, decision] to infer preferences
- When friend suggests location: query model → if trigger detected, phantom counter-suggests (via Tier 22 encrypted negotiation channel) alternative
- Operator sees: "I suggested coffee at X, but phantom thought Y might be better — okay?"
- Zero exposure of underlying reason (anxiety, past trauma, etc.)

**Why radical:** Maps become emotionally-intelligent meeting planners.

---

### C.13 Decision Diary Geofence Trigger (Tier 23-E Anchor Objects + Constitutional Maps)

**What it is:** Operator journals "I spent 3 years learning to code in the library on Oak St. Whenever I go back, I feel ready to solve hard problems." Phantom *detects* operator near Oak St library → surfaces relevant memories + cognitive state ("you're in a learning place; phantom knows you solve hard problems here").

**Why competitors can't:** Requires personal decision-emotion-location indexing + proactive surfacing. Google Maps doesn't have decision diary; can't infer cognitive boost from place.

**Implementation sketch:**
- Decision Diary: add `location_cluster` tag (grouping nearby decision entries)
- When operator within 100m of historical cluster → phantom proactively surfaces summary ("you've made 14 decisions here, mostly positive outcomes; here's the pattern")
- MapScreen can show "decision-rich locations" as colored zones (intensity = decision density)
- Tapping zone shows summary: "19 decisions, 73% positive outcome, primary theme: creativity"

**Why radical:** Maps become decision-history visualizations.

---

### C.14 Temporal Presence Mesh (Tier 24 Time-Dilation + Family Hive)

**What it is:** Family members' phantoms sync location timeline asynchronously. Operator sees family's location trails not just *now* but *when they were there* (6 months ago, grandmother visited this café every Tuesday; timeline shows her pattern). Useful for: finding favorite spots family loved, understanding shared history, async presence over time.

**Why competitors can't:** Requires temporal location history sharing + family consent + privacy-first aggregation. Live-share (Apple/Google) is real-time only; phantom's time-dilation layer (Tier 24) + family mesh (Tier 3) enables this.

**Implementation sketch:**
- Family Location Store: `[family_id, member_id, lat, lon, timestamp, decision_diary_link]`
- MapScreen: toggle "Family Timeline" mode (timeline slider at bottom, like C.3 but across multiple people)
- Dragging timeline back 6 months shows where each family member was
- Heatmap of "places we've all been" (spatial intersection analysis)

**Why radical:** Maps become family-history time machines.

---

### C.15 Constitutional Routing (Tier 29 Constitution + Maps)

**What it is:** Phantom's constitution includes axioms: "never route through war zones," "prefer renewable energy sources when charging," "respect Sabbath (no work locations 6pm-8pm Friday)." Routes automatically respect these without operator's runtime choice — they're baked into phantom's decision-making.

**Why competitors can't:** Requires on-device ethical reasoning + route engine integration. Google/Apple can't bake moral axioms into routing without controversial decisions.

**Implementation sketch:**
- `:core-constitution/RouteEthicsLayer`: reads axioms from constitution
- Before rendering route: evaluate against [war-zone-geozone, charging-source-type, time-restricted-location]
- If constraint violated: silently offer alternative; log reasoning to Decision Diary
- Operator learns: "phantom routed me 10 min longer; constitution says—" (transparency)

**Why radical:** Maps become constitutional proxies (ethical reasoning embedded in navigation).

---

## SUMMARY: Strategic Positioning

**Shipped (MAP-1 to MAP-6):** 4 core features (tiles, search, reverse-geocode, offline cache) representing **26% feature parity** with competitors on basic map UI.

**Deferred (MAP-7 to MAP-11):** 5 planned features (heatmap, 3D buildings, terrain, wardriving, family pins) — if executed, would push to ~45% parity.

**UNIQUE OPPORTUNITY:** Competitors fight on feature parity (routing, traffic, POI filtering). Phantom can own **spatial symbiosis** — maps that are haptic, temporal, memory-indexed, constitutional, family-synchronized, and privacy-first. These 15 ideas exploit Tier 14-30 symbiote DNA in ways Google/Apple cannot match *without violating user trust*.

**Recommended Near-Term Wins (6-month roadmap):**
1. **C.2 Memory Palace Navigation** (Tier 19) — links Decision Diary → Map
2. **C.4 Mood-Arc Walks** (Tier 26) — health → spatial coaching
3. **C.6 Family Presence Pins** (Tier 18) — mesh-based location sharing
4. **C.5 Decision-Diary Waypoint Avoidance** (Constitutional) — privacy-first route rejection

These four unlock "maps as symbiote organs" narrative while staying on-device and privacy-native.

