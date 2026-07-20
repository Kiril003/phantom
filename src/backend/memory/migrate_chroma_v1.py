"""Compatibility shim for a Chroma v1 migration that never shipped.

Audit D-3: ``lifespan_warmup._lane_chroma_eager`` imports
``migrate_old_collections`` from this module, but the module itself was
never committed — every lifespan boot threw ``ImportError`` on this
import, which took the *entire* Chroma-eager lane down with it
(including ``init_chroma_eager()``, which has nothing to do with the
migration). See ``lifespan_warmup.py`` for the fix that decouples the
two so a failure here can never block eager init again.

There is currently no legacy "v1" Chroma collection layout to migrate
away from — this module exists purely so the import succeeds and the
lane's migration step is a documented, deliberate no-op rather than a
crash. If a real migration is ever needed, implement it here and this
docstring should go.
"""
from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


async def migrate_old_collections(db: Any = None) -> dict[str, Any]:
    """No-op placeholder for a legacy Chroma collection migration.

    Accepts (and ignores) an optional async DB session, matching the
    call shape ``lifespan_warmup._lane_chroma_eager`` already uses, so
    it can be swapped for a real implementation later without touching
    the call site.

    Returns a stats dict shaped like a real migration would, with
    everything at zero, so callers that log/inspect the result don't
    need a special case for "no migration ran".
    """
    logger.debug("migrate_old_collections: no-op shim, nothing to migrate")
    return {"migrated": 0, "skipped": 0, "errors": 0}
