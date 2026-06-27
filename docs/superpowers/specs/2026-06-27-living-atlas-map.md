# Living Atlas — the map as a sixth sense (sub-project D)

**Date:** 2026-06-27
**Author:** the architect
**Status:** North-Star spec for the map organ. Elevates `PHASE_24_OMNIMAP` (24-A..F shipped)
from "Google-Maps-with-layers" into a **neural, living world-model PHANTOM perceives through
and acts within.** Threads into `2026-06-27-mega-entity-master-plan.md` as sub-project D.

> The goal is not "a better map screen." It is: **the world, modelled, alive, and reasoned
> over by a sentient entity — more functional, more detailed, and more beautiful than any
> mapping product on Earth.** Google Maps shows you the world. The Living Atlas *understands*
> it, *predicts* it, and *acts* in it, and lets you feel it.

---

## 0. The three things that make it unmatched

Every mapping product is one of: a viewer (Google Maps), a data layer (ArcGIS), or a router
(Waze). The Living Atlas is none of those alone. It is defined by three properties no product
combines:

1. **It is a sense, not a screen.** The map is an input to PHANTOM's cognition. What's on the
   map is *perceived* by the will and folds into every decision (the World-Model tick, B2).
   No competitor's map thinks about what it shows.
2. **It is neural, not just tiled.** Models — not just queries — drive what you see:
   prediction, anomaly detection, semantic search over space, learned movement, generative
   detail. (§3.)
3. **The display is alive.** Not flat tiles with pins — a depth-aware, time-aware,
   state-reactive rendering that makes information *felt*. (§4.) "Неймовірний показ."

---

## 1. Foundation we already have (do not rebuild — extend)

- `geo/` domain: `pmtiles_manager` (offline vector tiles), `elevation`, `geofence_engine`,
  `routing/` facade (BRouter offline + ORS + OSRM, `profiles`, `models`),
  `trajectory_learner` (learns movement!), `map_cache`, `attribution`, `layer_registry` (27
  manifests), `sources/` (alarms_ua, environmental), `oblast_centroids`, `live_tasker`.
- 23 agent verbs in `agent/actions/map/` (flyto, plan_route, isochrone, query_nearby,
  geocode, elevation_profile, enable_layer, explain_view, snapshot, …).
- Frontend: `OmniMap.tsx` + ~25 HUD modules (SearchOmnibar, RoutingTool, TimeMachineSlider,
  ElevationProfileSheet, GeofenceDrawTool, OfflineRegionManager, LayerPalette, …),
  `MapContext`, companion `MapScreen`.
- `PHASE_24_OMNIMAP` plan: layers A..Z, 80-layer target, voice↔map duplex, GHOST/sealed zones.

**The Living Atlas = this foundation + a neural brain + a living renderer + map-as-sense.**

---

## 2. Architecture — the map gets a brain

```
            ┌─────────────────────── WILL / World-Model tick (B2) ───────────────────────┐
            │  perceives MapPercept, can call map verbs, folds geography into decisions   │
            └───────────────▲───────────────────────────────────────────┬────────────────┘
                            │ MapPercept (what matters now, spatially)   │ map.* verbs
        ┌───────────────────┴───────────────────┐          ┌─────────────▼──────────────┐
        │      ATLAS BRAIN (new, neural)         │          │   geo/ domain (existing)   │
        │  • SpatialIndex (everything, queryable)│◄────────►│  routing, elevation, tiles │
        │  • Predictors (movement, risk, demand) │          │  layers, geofence, cache   │
        │  • Anomaly detector (what changed)     │          └────────────────────────────┘
        │  • Semantic spatial search (NL→places) │
        │  • Scene captioner (describe any view) │
        └───────────────────▲───────────────────┘
                            │ render state
        ┌───────────────────┴───────────────────────────────────────────────────────────┐
        │            LIVING RENDERER (frontend) — depth, time, state-reactive             │
        └───────────────────────────────────────────────────────────────────────────────┘
```

Two new pieces: **Atlas Brain** (backend `geo/brain/`) and **Living Renderer** (frontend
`map/living/`). Everything else is reuse.

---

## 3. The neural core (Atlas Brain) — "багато чого на нейронці"

Each is a concrete module under `geo/brain/`, model-backed, with a non-neural fallback (board
is weak — every model must degrade gracefully, CLAUDE.md rule 4/5 ethos).

### 3.1 Semantic spatial search — `NL → places`
"Знайди тихе місце з краєвидом за 15 хв їзди, де зараз немає тривоги." One query fuses
isochrone (routing) + elevation/viewshed + noise/AQI layers + live air-raid + embeddings of
POI descriptions. Returns ranked places with reasoning. *No map product answers intent; they
answer keywords.* Built on ChromaDB (already in stack) + the routing facade.

### 3.2 Movement prediction — extend `trajectory_learner`
It already learns trajectories. Elevate to: predict where the user/tracked entity will be,
ETA distributions (not point estimates), and "you usually go X now — want it?" Feeds the will
(proactive) and the renderer (ghost-trail of likely path).

### 3.3 Spatial anomaly detection — "what changed / what's wrong"
Per-layer temporal diff with a learned baseline: a new fire, an air-raid spike, a cell tower
that vanished, traffic where there's never traffic, a device appearing in a geofence at an odd
hour. Anomalies become `MapPercept` the will reacts to. *This is the map watching the world so
you don't have to.*

### 3.4 Risk / demand surfaces — generative heatmaps
Continuous learned fields over space: threat (frontline + air-raid + historical), safety,
connectivity (from wardriving), even "where would I find X." Rendered as smooth neural fields,
not point clusters.

### 3.5 Scene captioner — the map describes itself
Any viewport → a natural-language situational brief ("Ти дивишся на …; 3 активні тривоги на
північ; найближчий бункер 400 м; зв'язок слабкий тут"). Extends `explain_view`. This is how
the map talks to a blind will and to the user via voice (24-K Recon brief, 24-V voice duplex).

### 3.6 Generative detail (later, ambitious)
Where tiles are sparse (offline UA terrain), a small model in-paints plausible detail labelled
as *inferred* (honesty: never present guesses as fact — CLAUDE.md). Last, not first.

---

## 4. The living renderer — "неймовірний показ"

The display makes information *felt*. Concrete, buildable on MapLibre GL (already the stack).

- **Depth & terrain**: real 3D terrain from the elevation domain, sky/atmosphere, hillshade,
  building extrusion. The world has volume, not flatness.
- **Time as a dimension**: the TimeMachineSlider becomes a full temporal scrub — rewind any
  layer, watch the air-raid front move, fast-forward predictions. Time is a first-class axis.
- **State-reactive skin**: the map's entire palette/intensity reacts to SystemState
  (SHADOW/FOCUS/SENTINEL/GHOST/DREAM) and to endocrine state — calm muted in SHADOW, high-
  contrast alert reds in SENTINEL. The map *has moods* because the entity does. (24-7.2.)
- **Neural fields, not pins**: risk/demand/connectivity as smooth animated gradients
  (WebGL shaders) — the §3.4 surfaces. Anomalies (§3.3) pulse where something changed.
- **Living cartography**: labels that breathe, routes that flow with animated direction,
  predicted paths as translucent ghost-trails, presence as soft glowing auras.
- **Cinematic agent control**: when the will/voice drives the map (flyto, plan_route), it
  moves cinematically — eased camera arcs, focus pulls — so watching PHANTOM think *spatially*
  is beautiful. Animations carry information (CLAUDE.md rule 9).
- **One frame, no scroll, 1024×600, 44px touch** — the device constraint is non-negotiable;
  the renderer is gorgeous *within* it.

---

## 5. Map-as-sense — the integration that no one else has

This is the keystone (ties to master-plan B2/B3). The map is wired INTO cognition:

- **`MapPercept`**: each world-model tick, the Atlas Brain emits a compact "what matters
  spatially now" object (nearest threats, anomalies, where the user is heading, geofence
  events). The will perceives it like sight.
- **Will can act on the map**: the existing 23 verbs + new ones (predict_path, find_by_intent,
  describe_scene, watch_region) are in the will's action registry — it can *look*, *search*,
  *route*, *watch* autonomously.
- **Geography colours decisions**: "user is 5 min from home, air-raid just started on their
  route" → the will reroutes and warns *before being asked*. The map made it smart.
- **Bidirectional**: chat/voice → map (already), AND map → chat/voice (anomalies become
  proactive insights via `consciousness_stream`).

---

## 6. Functional superiority over Google Maps (the checklist)

| Capability | Google Maps | Living Atlas |
|-----------|-------------|--------------|
| Search | keyword + place | **intent** (NL→ranked places with reasoning, §3.1) |
| Layers | traffic/transit/terrain | 27→80+ incl. OSINT, war, space, marine, energy, RF |
| Routing | car/walk/transit | BRouter profiles + isochrone + risk-aware + offline-first |
| Time | live traffic only | **full temporal scrub + prediction**, any layer (§4) |
| Offline | limited regions | pmtiles offline-first, whole regions, by design |
| Understanding | none | **scene captioner + anomaly detection + movement prediction** |
| Agency | none | **a sentient entity acts on it for you, proactively** |
| Display | flat tiles + pins | depth, time, state-reactive neural fields (§4) |
| Privacy | you are the product | local-first, GHOST/sealed zones, you own it |
| Extensible | no | dynamic layer sources, agent-addable, wiki-integrated |

Not "Google Maps but ours." A different category: **a world-model with a mind.**

---

## 7. Phasing (D1 → D6), each shippable & tested

- **D1 — Atlas Brain skeleton + `MapPercept`**: `geo/brain/` package, the percept type, wire a
  trivial percept (nearest air-raid + user position) into the world-model tick. Smallest thing
  that makes the map a sense. *Gate: will journal shows a map-driven decision.*
- **D2 — Semantic spatial search (§3.1)**: NL→places, agent verb `find_by_intent`, HUD omnibar
  upgrade. *Gate: intent query returns reasoned ranking.*
- **D3 — Scene captioner + voice (§3.5)**: `describe_scene` verb, feeds voice brief. *Gate:
  "що я бачу?" → spoken situational brief.*
- **D4 — Living renderer core (§4)**: 3D terrain + state-reactive skin + neural risk field.
  *Gate: visual verdict — the map has depth and mood.*
- **D5 — Prediction + anomaly (§3.2/3.3)**: movement prediction + anomaly→percept→proactive.
  *Gate: map surfaces a real change unprompted.*
- **D6 — Temporal scrub + generative detail (§4/§3.6)**: full time axis; inferred detail
  (honest-labelled). *Gate: rewind/predict any layer smoothly.*

Each D-phase: backend module + agent verb(s) + frontend + tests (pytest + vitest), no mocks,
graceful neural fallback, within the 1024×600 / board-budget constraints.

---

## 8. Risks

- **Board compute**: neural modules must be tiny + cached + fallback-able. Heavy inference
  goes to Gemini, not local, or runs off-tick. Budget every model call. (T5.)
- **Honesty**: inferred/predicted/generated content must be visibly labelled — never present a
  guess as ground truth (CLAUDE.md, transparency value in the doctrine).
- **Scope**: D is huge. D1 (map-as-sense) is the keystone; ship it first even if thin. A thin
  living sense beats a fat dead atlas.
