"""Multi-modal identity fusion (phase-5-R3-BE-IDN-1).

Replaces the operator-flagged "тупа і діє в лоб" single-threshold
matcher with a four-modality weighted fusion that returns an
``IdentityResolution`` per ``docs/CONTRACTS_R1.md``:

    voice  (0.35)  cosine sim of an STT voiceprint against each
                   enrolled user's stored embedding
    face   (0.30)  cv2 / dlib landmark match against each user's
                   stored face encoding
    rfid   (0.20)  presence bonus when a known card was tapped in the
                   last 30 s (binary 0 or 0.9)
    context(0.15)  prior probability from time-of-day + location +
                   biosignal pattern, sourced from the user's
                   ``behavioral_model_json``

Fusion: weighted sum, missing modalities contribute 0 weight and the
remaining weights are re-normalised so a single-modality resolve is
still well-defined. ``confidence < 0.65 → rejected = True``. The PIN
``000000`` fallback path stays in ``security.auth`` and is gated on
``confidence < 0.5`` per the BE-IDENTITY constraint sheet.

This module is **independent** of the frozen ADR-ID-002 stub at
``voice/identity/resolver.py`` (which still returns ``Optional[str]``
for the always-on speaker labelling on STTResult). The stub is the
fast pre-tag for chat metadata; the fusion resolver below is the slow
trust gate for auth + per-user memory routing.
"""
from __future__ import annotations

import json
import logging
import math
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Iterable, Mapping, Optional, Sequence

logger = logging.getLogger(__name__)


# ── Public dataclasses (mirror src/shared/types) ──────────────────────────────


@dataclass(frozen=True)
class IdentityCandidate:
    """One enrolled user, with the artefacts the fusion resolver needs.

    Carrying these as a frozen dataclass means callers (the auth route,
    the always-on listener) build the candidate list once per chat
    turn from SQL + cache and pass it in — the resolver itself does
    no I/O. Keeps the resolve() body pure and trivially unit-testable.

    ``voice_embedding`` and ``face_encoding`` are the **enrolled**
    references. Probe vectors come in via ``IdentityProbe``.
    """

    user_id: str
    username: str
    voice_embedding: Optional[Sequence[float]] = None
    face_encoding: Optional[Sequence[float]] = None
    rfid_uid_hash: Optional[str] = None
    behavioral_model: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class IdentityProbe:
    """The four "what we just saw" signals for a single resolve() call.

    All fields are optional — a voice-only login passes only
    ``voice_embedding``; a kiosk RFID tap passes only ``rfid_uid_hash``
    (and optionally ``rfid_tapped_at``); the auth route fills as many
    as the upstream pipeline produced. ``location`` is a (lat, lon)
    tuple to keep this layer free of an extra geo type.
    """

    voice_embedding: Optional[Sequence[float]] = None
    face_encoding: Optional[Sequence[float]] = None
    rfid_uid_hash: Optional[str] = None
    rfid_tapped_at: Optional[float] = None  # epoch seconds
    location: Optional[tuple[float, float]] = None
    biosignal: Optional[Mapping[str, float]] = None  # {"breathing_bpm":…, …}
    now: Optional[datetime] = None  # injected for determinism in tests


@dataclass(frozen=True)
class IdentityResolution:
    """Wire shape — matches ``CONTRACTS_R1.md`` § Identity confidence."""

    user_id: str
    confidence: float
    modalities: list[str]
    rejected: bool
    reasons: list[str]

    def to_dict(self) -> dict[str, Any]:
        return {
            "user_id": self.user_id,
            "confidence": round(self.confidence, 4),
            "modalities": list(self.modalities),
            "rejected": self.rejected,
            "reasons": list(self.reasons),
        }


# ── Tunables — kept module-level so a future Settings panel can wire them ────

#: Modality weight table (must sum to 1.0). Re-normalised per-call when a
#: modality is missing so a single-modality resolve still produces a usable
#: 0..1 score.
MODALITY_WEIGHTS: dict[str, float] = {
    "voice": 0.35,
    "face": 0.30,
    "rfid": 0.20,
    "context": 0.15,
}

#: Trust threshold per CONTRACTS_R1.md.
CONFIDENCE_THRESHOLD: float = 0.65

#: PIN-fallback gate per BE-IDENTITY sheet — auth.py consults this when
#: deciding whether to honour a supplied PIN as a tiebreaker.
PIN_FALLBACK_THRESHOLD: float = 0.50

#: RFID presence is binary: a tap within the window scores 0.9, anything
#: older scores 0. 30 s is the "one-tap-then-walk-up" budget — long
#: enough for the operator to set the device down and start talking,
#: short enough that a stale tap can't authorise a different person.
RFID_PRESENCE_WINDOW_S: float = 30.0
RFID_PRESENCE_SCORE: float = 0.90


# ── Per-modality scorers ──────────────────────────────────────────────────────


def _cosine_similarity(a: Sequence[float], b: Sequence[float]) -> float:
    """Cosine similarity → mapped to 0..1 (so a perpendicular pair
    scores 0.5, opposite scores 0). Returns 0.0 if either vector is
    empty or has zero norm — a stale/uninitialised embedding can't
    contribute trust."""
    if not a or not b:
        return 0.0
    if len(a) != len(b):
        # Mismatched dimensionality is a corruption signal; refuse it
        # rather than silently picking the prefix.
        logger.debug(
            "cosine: dim mismatch (a=%d, b=%d) — returning 0.0",
            len(a), len(b),
        )
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
    raw = dot / (math.sqrt(na) * math.sqrt(nb))
    # Map cosine [-1, 1] → [0, 1]. Clamp first so floating-point fuzz
    # never escapes the unit interval.
    raw = max(-1.0, min(1.0, raw))
    return (raw + 1.0) / 2.0


def _score_voice(probe: IdentityProbe, cand: IdentityCandidate) -> Optional[float]:
    if probe.voice_embedding is None or cand.voice_embedding is None:
        return None
    return _cosine_similarity(probe.voice_embedding, cand.voice_embedding)


def _score_face(probe: IdentityProbe, cand: IdentityCandidate) -> Optional[float]:
    """Face encodings are also vectors (dlib's 128-D, FaceNet's 512-D,
    OpenCV LBPH histograms). We use the same cosine reduction so the
    fusion math is uniform — the exact encoder is the enrolment path's
    concern, not the resolver's."""
    if probe.face_encoding is None or cand.face_encoding is None:
        return None
    return _cosine_similarity(probe.face_encoding, cand.face_encoding)


def _score_rfid(probe: IdentityProbe, cand: IdentityCandidate) -> Optional[float]:
    """Binary presence bonus. Returns ``None`` if no card was tapped
    OR the candidate has no enrolled card — both cases mean RFID
    contributes nothing. A non-matching tap returns ``0.0`` (NOT
    ``None``) because the modality fired and disconfirmed this
    candidate; missing-tap returns ``None`` so the weight is reclaimed
    by re-normalisation."""
    if probe.rfid_uid_hash is None or cand.rfid_uid_hash is None:
        return None
    if probe.rfid_tapped_at is None:
        return None
    # Compare against the probe's own clock if supplied so tests are
    # deterministic; otherwise wall clock.
    now_s = (
        probe.now.timestamp() if probe.now is not None else time.time()
    )
    age = now_s - probe.rfid_tapped_at
    if age < 0 or age > RFID_PRESENCE_WINDOW_S:
        return None
    if probe.rfid_uid_hash != cand.rfid_uid_hash:
        return 0.0
    return RFID_PRESENCE_SCORE


def _score_context(
    probe: IdentityProbe, cand: IdentityCandidate
) -> Optional[float]:
    """Prior probability from the candidate's behavioural model.

    The behavioural model is a JSON object on ``User.behavioral_model_json``.
    It carries (any subset of):

        ``hour_histogram``       list[24] of 0..1 weights — when this
                                 user is typically present.
        ``home_location``        {"lat": float, "lon": float, "radius_m": int}
                                 — where they're "home". Inside-radius
                                 is a +1 prior, outside is +0.
        ``breathing_baseline``   {"mean_bpm": float, "stddev_bpm": float}
                                 — Gaussian likelihood from probe.biosignal.
        ``base_prior``           float 0..1 — fall-back when nothing
                                 else lines up (e.g. a freshly-enrolled
                                 user has no histogram yet).

    Empty-model candidates contribute ``None`` (modality not active);
    populated models contribute the mean of whichever sub-priors fired.
    """
    bm = cand.behavioral_model or {}
    if not isinstance(bm, Mapping) or not bm:
        return None

    parts: list[float] = []

    # ── Time-of-day prior ─────────────────────────────────────────────
    hour_hist = bm.get("hour_histogram")
    when = probe.now or datetime.now(tz=timezone.utc)
    if isinstance(hour_hist, (list, tuple)) and len(hour_hist) == 24:
        try:
            parts.append(max(0.0, min(1.0, float(hour_hist[when.hour]))))
        except (TypeError, ValueError):
            pass

    # ── Location prior ────────────────────────────────────────────────
    home = bm.get("home_location")
    if isinstance(home, Mapping) and probe.location is not None:
        try:
            home_lat = float(home["lat"])
            home_lon = float(home["lon"])
            radius_m = float(home.get("radius_m", 100.0))
            d = _haversine_m(home_lat, home_lon, probe.location[0], probe.location[1])
            # Soft falloff: inside-radius = 1.0, 2× radius = 0.5,
            # 4× radius = 0.0. Square root keeps the "near home"
            # plateau wide while still rewarding being right on the
            # spot more than just nearby.
            if d <= radius_m:
                parts.append(1.0)
            elif d >= 4 * radius_m:
                parts.append(0.0)
            else:
                parts.append(max(0.0, 1.0 - (d - radius_m) / (3 * radius_m)))
        except (KeyError, TypeError, ValueError):
            pass

    # ── Biosignal prior ───────────────────────────────────────────────
    base = bm.get("breathing_baseline")
    if (
        isinstance(base, Mapping)
        and probe.biosignal is not None
        and "breathing_bpm" in probe.biosignal
    ):
        try:
            mean = float(base["mean_bpm"])
            stddev = max(1e-3, float(base.get("stddev_bpm", 2.0)))
            obs = float(probe.biosignal["breathing_bpm"])
            # Standard Gaussian likelihood, normalised so a perfect
            # match = 1.0 and 3σ away = ~0.011.
            z = (obs - mean) / stddev
            parts.append(math.exp(-0.5 * z * z))
        except (KeyError, TypeError, ValueError):
            pass

    if not parts:
        # Fall back to the explicit base prior if any.
        try:
            base_prior = float(bm.get("base_prior", 0.0))
        except (TypeError, ValueError):
            return None
        if base_prior <= 0.0:
            return None
        return max(0.0, min(1.0, base_prior))

    return sum(parts) / len(parts)


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in metres."""
    r = 6_371_000.0
    a1 = math.radians(lat1)
    a2 = math.radians(lat2)
    da = math.radians(lat2 - lat1)
    do = math.radians(lon2 - lon1)
    h = (
        math.sin(da / 2) ** 2
        + math.cos(a1) * math.cos(a2) * math.sin(do / 2) ** 2
    )
    return 2 * r * math.asin(math.sqrt(h))


# ── Public fusion entry point ────────────────────────────────────────────────


def resolve(
    probe: IdentityProbe,
    candidates: Iterable[IdentityCandidate],
) -> Optional[IdentityResolution]:
    """Fuse the four modalities across ``candidates`` and return the
    best ``IdentityResolution``, or ``None`` if there are no candidates.

    The "best" candidate is the one with the highest weighted fused
    score; the resolution's ``rejected`` flag is set when that score
    falls below ``CONFIDENCE_THRESHOLD``. Auth-side fallback (PIN
    `000000`, lockout) is the route handler's responsibility, NOT this
    resolver's — keeping the fusion math pure means tests don't have
    to stand up the FastAPI app.
    """
    candidates = list(candidates)
    if not candidates:
        logger.debug("resolve: no enrolled candidates — returning None")
        return None

    best: Optional[IdentityResolution] = None
    for cand in candidates:
        scores: dict[str, float] = {}
        reasons: list[str] = []

        v = _score_voice(probe, cand)
        if v is not None:
            scores["voice"] = v
            reasons.append(f"voice={v:.2f}")

        f = _score_face(probe, cand)
        if f is not None:
            scores["face"] = f
            reasons.append(f"face={f:.2f}")

        r = _score_rfid(probe, cand)
        if r is not None:
            scores["rfid"] = r
            if r >= RFID_PRESENCE_SCORE:
                reasons.append(f"rfid=tap<{int(RFID_PRESENCE_WINDOW_S)}s")
            else:
                reasons.append("rfid=foreign-card")

        c = _score_context(probe, cand)
        if c is not None:
            scores["context"] = c
            reasons.append(f"context={c:.2f}")

        if not scores:
            # No modality fired for this candidate at all — skip them
            # entirely so they don't pollute the "best" search with a
            # zero-confidence result.
            continue

        # Re-normalise the weights of the modalities that fired.
        active_total = sum(MODALITY_WEIGHTS[m] for m in scores)
        if active_total <= 0.0:
            continue
        confidence = sum(
            scores[m] * MODALITY_WEIGHTS[m] / active_total for m in scores
        )
        confidence = max(0.0, min(1.0, confidence))

        modalities = [m for m in ("voice", "face", "rfid", "context") if m in scores]
        candidate_res = IdentityResolution(
            user_id=cand.user_id,
            confidence=confidence,
            modalities=modalities,
            rejected=confidence < CONFIDENCE_THRESHOLD,
            reasons=reasons,
        )

        if best is None or candidate_res.confidence > best.confidence:
            best = candidate_res

    if best is None:
        logger.debug(
            "resolve: %d candidates examined, none had any active modality",
            len(candidates),
        )
        return None

    logger.info(
        "resolve: best=%s confidence=%.3f modalities=%s rejected=%s",
        best.user_id, best.confidence, best.modalities, best.rejected,
    )
    return best


# ── ORM → IdentityCandidate adapter ───────────────────────────────────────────


def candidate_from_user_row(
    user_row: Any,
    *,
    voice_embedding: Optional[Sequence[float]] = None,
    face_encoding: Optional[Sequence[float]] = None,
) -> IdentityCandidate:
    """Adapter so callers don't repeat the ``behavioral_model_json``
    JSON parsing dance everywhere. ``user_row`` is a SQLAlchemy
    ``User`` ORM object (duck-typed; we touch ``id``, ``username``,
    ``rfid_uid_hash``, ``behavioral_model_json``).

    Voice / face references are passed in explicitly because they live
    outside the SQL row in the current iteration (filesystem blobs,
    or a future ``user_voice_embeddings`` side table).
    """
    bm: Mapping[str, Any] = {}
    raw = getattr(user_row, "behavioral_model_json", None)
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, Mapping):
                bm = parsed
        except (TypeError, ValueError):
            logger.warning(
                "candidate_from_user_row: behavioral_model_json malformed for "
                "user %s — treating as empty",
                getattr(user_row, "id", "?"),
            )
    return IdentityCandidate(
        user_id=str(getattr(user_row, "id")),
        username=str(getattr(user_row, "username", "")),
        voice_embedding=voice_embedding,
        face_encoding=face_encoding,
        rfid_uid_hash=getattr(user_row, "rfid_uid_hash", None),
        behavioral_model=bm,
    )


__all__ = [
    "IdentityCandidate",
    "IdentityProbe",
    "IdentityResolution",
    "MODALITY_WEIGHTS",
    "CONFIDENCE_THRESHOLD",
    "PIN_FALLBACK_THRESHOLD",
    "RFID_PRESENCE_WINDOW_S",
    "RFID_PRESENCE_SCORE",
    "resolve",
    "candidate_from_user_row",
]
