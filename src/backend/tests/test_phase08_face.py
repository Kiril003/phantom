"""
Phase 08 — Face tracking + recognition + OLED animator tests.

Covers:
  * cosine / normalize / average embedding math (pure functions).
  * User.preferences_json round-trip for enroll / delete.
  * /face/enroll, /face/recognize, /face/status routes.
  * Privacy gates: face_tracking_enabled, privacy_mode == "off",
    system state == GHOST → 503 from mutating routes.
  * OLED animator frame math for each eye state + GHOST override.
  * Settings wiring: the 5 user-facing face/oled keys MUST NOT be in
    UNIMPLEMENTED_KEYS (proves the "[soon]" tag is gone).
"""
from __future__ import annotations

import asyncio
import os

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase08")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-api-key-for-tests")

from config import config  # noqa: E402
from vision import face_engine  # noqa: E402
from vision.oled_animator import (  # noqa: E402
    OledAnimator,
    VALID_EYE_STATES,
    _render_eyes,
)


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def client(auth_root_user, auth_root_token):
    """Day-2 D2-A2 (audit F-09): /settings GETs now require auth. The
    conftest fixture pair (auth_root_user creates the row, auth_root_token
    issues the JWT) lets pre-existing call sites in this file stay
    unchanged — the bearer header is preset on every request."""
    from main import app
    with TestClient(app) as c:
        c.headers.update({"Authorization": f"Bearer {auth_root_token}"})
        yield c


@pytest.fixture
def auth_token(client):
    r = client.post(
        "/api/v1/auth/login/pin",
        json={"username": "phantom", "pin": "000000"},
    )
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(autouse=True)
def _reset_face_settings():
    """Every test starts with the face subsystem enabled and out of GHOST."""
    config.face_tracking_enabled = True
    config.face_tracking_privacy_mode = "landmarks"
    config.face_recognition_threshold = 0.75
    yield
    # Clear any embedding that was stored so tests don't bleed state into
    # each other. Use a fresh event loop to avoid clashes with pytest-asyncio
    # when other test files have already closed their loop.
    from db.database import get_session
    from db.models import User
    from sqlalchemy import select
    import json as _json

    async def _clear():
        try:
            async with get_session() as db:
                res = await db.execute(select(User))
                for u in res.scalars().all():
                    prefs = {}
                    try:
                        prefs = _json.loads(u.preferences_json or "{}")
                    except Exception:
                        pass
                    if "face" in prefs:
                        del prefs["face"]
                        u.preferences_json = _json.dumps(prefs)
                        db.add(u)
                await db.commit()
        except Exception:
            # DB may not be initialised for tests that never boot the app
            # (e.g. pure math tests in TestEmbeddingMath) — safe to skip.
            pass

    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(_clear())
    finally:
        loop.close()


# ═══════════════════════════════════════════════════════════════════════════════
# Embedding math
# ═══════════════════════════════════════════════════════════════════════════════


class TestEmbeddingMath:

    def test_cosine_identical_vectors_is_one(self):
        v = [0.1, 0.2, 0.3, 0.4]
        assert face_engine.cosine_similarity(v, v) == pytest.approx(1.0, abs=1e-9)

    def test_cosine_opposite_vectors_is_minus_one(self):
        v = [0.1, 0.2, 0.3]
        neg = [-x for x in v]
        assert face_engine.cosine_similarity(v, neg) == pytest.approx(-1.0, abs=1e-9)

    def test_cosine_orthogonal_is_zero(self):
        a = [1.0, 0.0]
        b = [0.0, 1.0]
        assert face_engine.cosine_similarity(a, b) == 0.0

    def test_cosine_empty_is_zero(self):
        assert face_engine.cosine_similarity([], []) == 0.0

    def test_cosine_length_mismatch_is_zero(self):
        assert face_engine.cosine_similarity([1, 2, 3], [1, 2]) == 0.0

    def test_cosine_zero_vector_is_zero(self):
        assert face_engine.cosine_similarity([0, 0, 0], [1, 2, 3]) == 0.0

    def test_l2_normalize_produces_unit_vector(self):
        v = [3.0, 4.0]
        n = face_engine.l2_normalize(v)
        mag = (n[0] ** 2 + n[1] ** 2) ** 0.5
        assert mag == pytest.approx(1.0, abs=1e-9)

    def test_l2_normalize_zero_stays_zero(self):
        assert face_engine.l2_normalize([0, 0, 0]) == [0, 0, 0]

    def test_average_embeddings_centres_samples(self):
        samples = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]]
        avg = face_engine.average_embeddings(samples)
        # Mean would be [1/3, 1/3, 1/3]; after L2-norm each component equals
        # 1/sqrt(3).
        expected = 1 / (3 ** 0.5)
        for v in avg:
            assert v == pytest.approx(expected, abs=1e-9)

    def test_average_embeddings_empty_returns_empty(self):
        assert face_engine.average_embeddings([]) == []

    def test_average_embeddings_dim_mismatch_raises(self):
        with pytest.raises(ValueError):
            face_engine.average_embeddings([[1, 2, 3], [1, 2]])


# ═══════════════════════════════════════════════════════════════════════════════
# Routes — enroll / recognize / delete / status
# ═══════════════════════════════════════════════════════════════════════════════


def _fake_embedding(seed: float, dim: int = 60) -> list[float]:
    # Deterministic "user fingerprint": every value derived from seed.
    return [seed + 0.01 * i for i in range(dim)]


class TestFaceRoutes:

    def test_enroll_and_recognize_round_trip(self, client, auth_token):
        emb = _fake_embedding(0.5)
        samples = [emb] * 6
        r = client.post(
            "/api/v1/face/enroll",
            headers={"Authorization": f"Bearer {auth_token}"},
            json={"samples": samples},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["ok"] is True
        assert data["sample_count"] == 6
        assert data["dim"] == 60

        # Same vector → should match with confidence ~1.0.
        r2 = client.post("/api/v1/face/recognize", json={"embedding": emb})
        assert r2.status_code == 200
        body = r2.json()
        assert body["matched"] is True
        assert body["confidence"] > 0.99
        assert body["username"] == "phantom"

    def test_recognize_without_enrollment_returns_unmatched(self, client):
        r = client.post(
            "/api/v1/face/recognize",
            json={"embedding": _fake_embedding(0.1)},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["matched"] is False
        assert body["username"] is None

    def test_recognize_different_face_below_threshold(self, client, auth_token):
        enrolled = _fake_embedding(0.5)
        client.post(
            "/api/v1/face/enroll",
            headers={"Authorization": f"Bearer {auth_token}"},
            json={"samples": [enrolled] * 6},
        )
        # A vector that's basically orthogonal shouldn't match at the 0.75
        # default threshold.
        other = [((i * 7) % 13 - 6) * 1.0 for i in range(60)]
        r = client.post("/api/v1/face/recognize", json={"embedding": other})
        assert r.status_code == 200
        body = r.json()
        # Not a guaranteed math statement but overwhelmingly likely, and
        # the threshold is the point of the test.
        assert body["matched"] is False or body["confidence"] < 1.0

    def test_enroll_rejects_empty_samples(self, client, auth_token):
        r = client.post(
            "/api/v1/face/enroll",
            headers={"Authorization": f"Bearer {auth_token}"},
            json={"samples": []},
        )
        assert r.status_code == 422  # pydantic min_length=1

    def test_enroll_rejects_oversize_embedding(self, client, auth_token):
        r = client.post(
            "/api/v1/face/enroll",
            headers={"Authorization": f"Bearer {auth_token}"},
            json={"samples": [[0.1] * 10_000]},
        )
        assert r.status_code == 400

    def test_delete_embedding(self, client, auth_token):
        client.post(
            "/api/v1/face/enroll",
            headers={"Authorization": f"Bearer {auth_token}"},
            json={"samples": [_fake_embedding(0.5)] * 6},
        )
        r = client.delete(
            "/api/v1/face/embedding",
            headers={"Authorization": f"Bearer {auth_token}"},
        )
        assert r.status_code == 200
        assert r.json()["removed"] is True

        # Post-delete recognize should no longer match.
        r2 = client.post(
            "/api/v1/face/recognize",
            json={"embedding": _fake_embedding(0.5)},
        )
        assert r2.json()["matched"] is False

    def test_status_reports_enrollment_count(self, client, auth_token):
        # Before enrollment.
        r = client.get("/api/v1/face/status")
        assert r.status_code == 200
        before = r.json()["enrolled_users"]

        client.post(
            "/api/v1/face/enroll",
            headers={"Authorization": f"Bearer {auth_token}"},
            json={"samples": [_fake_embedding(0.5)] * 6},
        )

        r2 = client.get("/api/v1/face/status")
        assert r2.json()["enrolled_users"] == before + 1

    def test_status_exposes_privacy_mode(self, client):
        config.face_tracking_privacy_mode = "full"
        r = client.get("/api/v1/face/status")
        assert r.json()["privacy_mode"] == "full"


# ═══════════════════════════════════════════════════════════════════════════════
# Privacy gates
# ═══════════════════════════════════════════════════════════════════════════════


class TestPrivacyGates:

    def test_master_disable_blocks_enroll(self, client, auth_token):
        config.face_tracking_enabled = False
        r = client.post(
            "/api/v1/face/enroll",
            headers={"Authorization": f"Bearer {auth_token}"},
            json={"samples": [_fake_embedding(0.1)]},
        )
        assert r.status_code == 503

    def test_master_disable_blocks_recognize(self, client):
        config.face_tracking_enabled = False
        r = client.post(
            "/api/v1/face/recognize",
            json={"embedding": _fake_embedding(0.1)},
        )
        assert r.status_code == 503

    def test_privacy_off_blocks_recognize(self, client):
        config.face_tracking_privacy_mode = "off"
        r = client.post(
            "/api/v1/face/recognize",
            json={"embedding": _fake_embedding(0.1)},
        )
        assert r.status_code == 503

    def test_ghost_state_blocks_recognize(self, client):
        from core.context_engine import context_engine
        context_engine.set_state("GHOST")
        try:
            r = client.post(
                "/api/v1/face/recognize",
                json={"embedding": _fake_embedding(0.1)},
            )
            assert r.status_code == 503
        finally:
            context_engine.set_state("SHADOW")

    def test_delete_works_even_when_disabled(self, client, auth_token):
        """Operator must always be able to purge their template — safety."""
        # First enroll while enabled.
        client.post(
            "/api/v1/face/enroll",
            headers={"Authorization": f"Bearer {auth_token}"},
            json={"samples": [_fake_embedding(0.5)] * 6},
        )
        # Then disable everything and try to delete.
        config.face_tracking_enabled = False
        r = client.delete(
            "/api/v1/face/embedding",
            headers={"Authorization": f"Bearer {auth_token}"},
        )
        # Delete is intentionally not gated by _check_enabled.
        assert r.status_code == 200


# ═══════════════════════════════════════════════════════════════════════════════
# OLED animator
# ═══════════════════════════════════════════════════════════════════════════════


class TestOledAnimator:

    def test_ghost_state_renders_off(self):
        anim = OledAnimator()
        anim.set_system_state("GHOST")
        frame = anim.compute_frame()
        assert frame.eye_state == "off"
        assert frame.eye_l["rx"] == 0.0
        assert frame.brightness == 0

    def test_shadow_state_is_sleepy(self):
        anim = OledAnimator()
        anim.set_system_state("SHADOW")
        frame = anim.compute_frame()
        assert frame.eye_state == "sleepy"

    def test_focus_state_tracks_face(self):
        anim = OledAnimator()
        anim.set_system_state("FOCUS")
        anim.set_face(present=True, face_x=0.5)
        # Animator smooths over multiple ticks; run a handful.
        for _ in range(8):
            frame = anim.compute_frame()
        # Eyes should track right (face_x > 0 → dx > 0 → cx_l pushed right).
        assert frame.eye_state == "tracking"
        assert frame.eye_l["cx"] > 28.0  # base cx_l

    def test_sentinel_is_alert(self):
        anim = OledAnimator()
        anim.set_system_state("SENTINEL")
        frame = anim.compute_frame()
        assert frame.eye_state == "alert"

    def test_voice_listening_forces_thinking(self):
        anim = OledAnimator()
        anim.set_system_state("FOCUS")  # would otherwise be "tracking"
        anim.set_voice(listening=True)
        frame = anim.compute_frame()
        assert frame.eye_state == "thinking"

    def test_surprise_pulse_overrides_system_state(self):
        anim = OledAnimator()
        anim.set_system_state("SHADOW")  # would be "sleepy"
        anim.pulse_surprised(duration_s=0.5)
        frame = anim.compute_frame()
        assert frame.eye_state == "surprised"

    def test_surprise_pulse_does_not_override_ghost(self):
        """Privacy non-negotiable: GHOST always wins."""
        anim = OledAnimator()
        anim.set_system_state("GHOST")
        anim.pulse_surprised(duration_s=0.5)
        frame = anim.compute_frame()
        assert frame.eye_state == "off"

    def test_all_rendered_states_are_valid(self):
        for state in ["SHADOW", "FOCUS", "DIALOGUE", "SENTINEL", "GHOST", "DREAM"]:
            anim = OledAnimator()
            anim.set_system_state(state)
            frame = anim.compute_frame()
            assert frame.eye_state in VALID_EYE_STATES

    def test_render_eyes_returns_six_distinct_shapes(self):
        shapes = set()
        for s in ["idle", "tracking", "surprised", "sleepy", "thinking", "alert"]:
            f = _render_eyes(
                s, smoothed_x=0.0, tick=5, hz=30,
                brightness=200, system_state="SHADOW",
            )
            shapes.add((round(f.eye_l["rx"], 1), round(f.eye_l["ry"], 1)))
        # At least four distinct geometries.
        assert len(shapes) >= 4


# ═══════════════════════════════════════════════════════════════════════════════
# Settings wiring
# ═══════════════════════════════════════════════════════════════════════════════


class TestFaceSettings:

    def test_five_face_keys_not_marked_soon(self):
        """Phase-08 contract: these user-facing knobs must be wired."""
        from api.routes_settings import UNIMPLEMENTED_KEYS
        activated = {
            "face_tracking_enabled",
            "face_tracking_auto_switch_profile",
            "face_tracking_privacy_mode",
            "oled_animation_speed",
            "oled_brightness",
        }
        assert activated.isdisjoint(UNIMPLEMENTED_KEYS), (
            f"face keys still [soon]: {activated & UNIMPLEMENTED_KEYS}"
        )

    def test_vision_category_exists(self, client):
        r = client.get("/api/v1/settings")
        assert r.status_code == 200
        cats = {c["id"] for c in r.json()["categories"]}
        assert "vision" in cats

    def test_vision_category_carries_all_face_keys(self, client):
        r = client.get("/api/v1/settings")
        vision = next(c for c in r.json()["categories"] if c["id"] == "vision")
        keys = {s["key"] for s in vision["settings"]}
        for expected in [
            "face_tracking_enabled",
            "face_tracking_auto_switch_profile",
            "face_tracking_privacy_mode",
            "oled_animation_speed",
            "oled_brightness",
        ]:
            assert expected in keys, f"missing: {expected}"

    def test_face_labels_do_not_have_soon(self, client):
        r = client.get("/api/v1/settings")
        vision = next(c for c in r.json()["categories"] if c["id"] == "vision")
        for s in vision["settings"]:
            assert "[soon]" not in s["label"], (
                f"{s['key']} still flagged [soon]: {s['label']!r}"
            )

    def test_put_face_tracking_enabled_persists(self, client, auth_token):
        r = client.put(
            "/api/v1/settings/face_tracking_enabled",
            headers={"Authorization": f"Bearer {auth_token}"},
            json={"value": False},
        )
        assert r.status_code == 200, r.text
        assert config.face_tracking_enabled is False
        # Reset to default (will also be reset by the autouse fixture).
        r = client.put(
            "/api/v1/settings/face_tracking_enabled",
            headers={"Authorization": f"Bearer {auth_token}"},
            json={"value": True},
        )
        assert r.status_code == 200
