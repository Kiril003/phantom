
## 2026-04-22 — Map sidebar buttons: scope unclear

Left sidebar on Map view has 10 icon buttons (top to bottom):
1. Layers
2. Presence target
3. Wifi
4. Flame (heatmap)
5. Pin (intel/POI)
6. Route line
7. Sparkle — confirmed working: toggles FactMarkerLayer
8. Compass with sparkle
9. Compass
10. Clock — confirmed working: toggles TimelineDrawer

Buttons 1-6, 8, 9 have unclear runtime behavior during live session on 2026-04-22.
User did not know what they do, couldn't distinguish "empty state" from "broken handler".

Not blocking. Core map functionality (BROWSER · 90%, Nearby, Timeline, FactMarkers) works.

**Scope decision deferred.** Requires product owner session — decide per button:
- What should it do?
- Is it needed?
- Keep / modify / remove?

After that session, a scoped fix or UI simplification phase can be planned.

This is tracked as technical debt from the 2026-04-20 full audit — "test-count-vs-
live-acceptance asymmetry" — shipping features without live use reveals scope gaps
only when a user finally touches the surface.
