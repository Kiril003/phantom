"""
Face embedding store + similarity math.

The heavy lifting (MediaPipe FaceLandmarker, frame capture, normalization)
happens in the browser. The backend is a pure vector database over
`User.preferences_json["face"]`, gated by `config.face_tracking_enabled`
and the privacy mode.

Privacy contract:
  * Embeddings NEVER leave the device (not sent to Gemini/Ollama, not
    written to Chroma).
  * Embeddings are stored per-user inside the existing JSON blob we
    already use for UI prefs — no new tables, no DB schema changes.
  * `face_tracking_privacy_mode == "off"` OR `face_tracking_enabled is
    False` makes every route return 503; GHOST state does the same via
    a runtime check in `routes_face`.
"""
from __future__ import annotations

import json
import math
import time
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from db.models import User


# ── Math ───────────────────────────────────────────────────────────────────────

def cosine_similarity(a: list[float], b: list[float]) -> float:
    """Bounded cosine similarity in [-1, 1]. Zero-vector safe."""
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = 0.0
    na = 0.0
    nb = 0.0
    for x, y in zip(a, b):
        dot += x * y
        na += x * x
        nb += y * y
    if na <= 0.0 or nb <= 0.0:
        return 0.0
    return dot / (math.sqrt(na) * math.sqrt(nb))


def l2_normalize(vec: list[float]) -> list[float]:
    """Return unit-length copy; zero-vector stays zero."""
    n = math.sqrt(sum(x * x for x in vec))
    if n <= 1e-9:
        return list(vec)
    return [x / n for x in vec]


def average_embeddings(samples: list[list[float]]) -> list[float]:
    """
    Mean across N samples of the same face → stable template.
    Caller is expected to pass 5-10 samples from different frames to
    filter out momentary tracking glitches. Returns L2-normalised vector
    so cosine similarity can skip re-normalising at query time.
    """
    if not samples:
        return []
    dim = len(samples[0])
    for s in samples:
        if len(s) != dim:
            raise ValueError(
                f"embedding length mismatch: {len(s)} vs {dim}"
            )
    mean = [0.0] * dim
    for s in samples:
        for i, x in enumerate(s):
            mean[i] += x
    mean = [x / len(samples) for x in mean]
    return l2_normalize(mean)


# ── Store (wraps User.preferences_json) ────────────────────────────────────────

FACE_KEY = "face"  # sub-key in preferences_json


def _load_prefs(user: User) -> dict[str, Any]:
    try:
        return json.loads(user.preferences_json or "{}")
    except Exception:
        return {}


def _save_prefs(user: User, prefs: dict[str, Any]) -> None:
    # SQLAlchemy column is plain Text; caller is expected to db.commit().
    user.preferences_json = json.dumps(prefs)  # type: ignore[assignment]


def has_embedding(user: User) -> bool:
    prefs = _load_prefs(user)
    face = prefs.get(FACE_KEY) or {}
    emb = face.get("embedding")
    return isinstance(emb, list) and len(emb) > 0


def get_embedding(user: User) -> list[float] | None:
    prefs = _load_prefs(user)
    face = prefs.get(FACE_KEY) or {}
    emb = face.get("embedding")
    if not isinstance(emb, list):
        return None
    # Be strict about the shape — a user could have hand-edited prefs_json.
    try:
        return [float(x) for x in emb]
    except (TypeError, ValueError):
        return None


async def store_embedding(
    db: AsyncSession,
    user: User,
    samples: list[list[float]],
    *,
    dim_min: int = 8,
    dim_max: int = 4096,
) -> list[float]:
    """
    Average `samples` into one template and upsert onto the user row.

    We enforce a dim range to reject obviously bogus clients (empty arrays
    or 1M-float attempts that would OOM SQLite). Returns the stored vector
    so the caller can echo it in the response.
    """
    if not samples:
        raise ValueError("need at least one sample")
    for s in samples:
        if not dim_min <= len(s) <= dim_max:
            raise ValueError(
                f"embedding dim out of bounds: {len(s)} (allowed {dim_min}-{dim_max})"
            )
    template = average_embeddings(samples)

    prefs = _load_prefs(user)
    prefs[FACE_KEY] = {
        "embedding": template,
        "sample_count": len(samples),
        "enrolled_at": int(time.time() * 1000),
    }
    _save_prefs(user, prefs)
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return template


async def delete_embedding(db: AsyncSession, user: User) -> bool:
    prefs = _load_prefs(user)
    if FACE_KEY not in prefs:
        return False
    del prefs[FACE_KEY]
    _save_prefs(user, prefs)
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return True


# ── Recognition ────────────────────────────────────────────────────────────────

async def match_embedding(
    db: AsyncSession,
    query: list[float],
    threshold: float,
) -> tuple[User, float] | None:
    """
    Scan every user that has a stored embedding and return the best match
    if its cosine similarity clears `threshold`. Scales linearly with the
    user count, which for PHANTOM OS is ≤10 — fine.
    """
    from sqlalchemy import select

    result = await db.execute(select(User))
    best: tuple[User, float] | None = None
    for user in result.scalars().all():
        ref = get_embedding(user)
        if ref is None:
            continue
        sim = cosine_similarity(query, ref)
        if best is None or sim > best[1]:
            best = (user, sim)
    if best is None or best[1] < threshold:
        return None
    return best


__all__ = [
    "FACE_KEY",
    "average_embeddings",
    "cosine_similarity",
    "delete_embedding",
    "get_embedding",
    "has_embedding",
    "l2_normalize",
    "match_embedding",
    "store_embedding",
]
