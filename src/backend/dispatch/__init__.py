"""PHANTOM OS — `dispatch/` package.

Day-3 audit-2026-04-30 Block P (Tier B): the Day-2 architect plan
`docs/audit-2026-04-29-day2/architecture.md` proposed a separate
package (outside `core/`) that holds the EventBus subscribers /
broadcasters. Day-2 didn't ship it; the inline broadcast at
`main.py:69-75 + 105-111` was duplicated verbatim across the two
context-loop entry points (background sensor batch + active serial
batch) — F-02 + F-03 in the Day-2 audit FINDINGS.

Day-3 lands the package in three lanes:

* **B-1** (this commit) — package skeleton + `state_broadcaster`
  module + tests, NOT yet wired into `main.py`.
* **B-2** — F-44 layering inversion fix (`agent/localization/lifecycle.py`
  → `ContextEngine.set_localization()` setter, `_refresh_nearby` →
  `set_nearby_features()` setter — N-arch revision flagged the
  second writer site the Day-2 plan missed).
* **B-3** — wire the subscribers into `main.py` lifespan + emit the
  events from the two state-transition sites, deleting the inline
  broadcasts.

The package has no public side effects on import; callers use
`wire_subscribers(bus, *deps)` to attach handlers explicitly so the
test seam stays clean (no module-level `event_bus.subscribe(...)` at
import time).
"""

from dispatch.standing_order_broadcaster import (
    register_standing_order_broadcaster,
    topic_to_ws_type,
)
from dispatch.state_broadcaster import (
    StateBroadcaster,
    register_state_broadcaster,
)

__all__ = [
    "StateBroadcaster",
    "register_standing_order_broadcaster",
    "register_state_broadcaster",
    "topic_to_ws_type",
]
