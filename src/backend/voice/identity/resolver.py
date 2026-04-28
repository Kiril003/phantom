"""Speaker resolver — Day-4 Block ID-2 (ADR-ID-002).

Frozen signature for the Day-5 ML resolver drop-in. Day-4 returns
`None` unconditionally (no enrolment table, no embeddings, no model
weights). Day-5 fills in the body with ECAPA-TDNN / WeSpeaker / similar
under `voice/identity/models/` — and the only edit is THIS file's
function body. Every call site (`voice.pipeline.transcribe_blob`,
always-on finalisers in `voice.always_on`) goes unchanged.

Performance budget (ADR-ID-002 §perf): the no-op MUST be ≤ 100 µs/call
on Radxa so it can run inline (or via `asyncio.to_thread`) without
showing up on the chat-turn p95. The body is intentionally one return
statement plus one debug-level log line that's a no-op when the root
logger is at INFO or higher.
"""
from __future__ import annotations

import logging
from typing import Optional

logger = logging.getLogger(__name__)


def resolve_speaker(audio: bytes, sample_rate: int) -> Optional[str]:
    """Resolve `audio` to an enrolled `User.id` UUID, or `None` if no
    match.

    Day-4: unconditional `None`. The signature is the contract — Day-5
    swaps the body without touching any caller.

    Args:
        audio: 16-bit signed-PCM bytes, mono. The pipeline normalises
            every blob through `decode_to_mono16k` before this call.
        sample_rate: integer Hz. Must be 16_000 in practice (everything
            upstream resamples). Day-5 will assert this and refuse
            mismatched rates rather than silently mis-embed.

    Returns:
        An enrolled `User.id` UUID string when matched, or `None` when
        no match / no enrolled users / disabled. Day-4 always returns
        `None`.
    """
    # Debug-only — INFO log levels (the production default) skip the
    # interpolation entirely. Logged for the rare developer who wants
    # to confirm the resolver IS being called from the pipeline before
    # Day-5 ML lands.
    logger.debug(
        "resolve_speaker stub called (audio=%d bytes, sample_rate=%d)",
        len(audio),
        sample_rate,
    )
    return None
