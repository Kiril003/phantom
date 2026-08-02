"""Комерційна модель має тримати три обіцянки, і кожну тут перевіряємо.

1. Безпека не коштує грошей — навігація, тривоги, мапа і сховище відкриті на
   БУДЬ-ЯКОМУ рівні, включно з відсутністю ключа.
2. Безстроково — значить безстроково: кінець вікна оновлень не гасить ліцензію,
   він лише не покриває новіші збірки.
3. Життя без мережі: ліцензія тримається пільговий строк від останнього
   вдалого дотику до сервера, а не від «зараз».
"""
from __future__ import annotations

import json
from datetime import date, timedelta

import pytest

from licensing import entitlements as ent
from licensing.verifier import LicenseStatus

SAFETY = ("core.nav", "core.alerts", "core.map", "core.vault", "core.chat", "core.voice")


@pytest.fixture(autouse=True)
def isolate(tmp_path, monkeypatch):
    """Проба і мітка сервера — файли на диску. Тест не має їх торкатись
    у домівці власника: саме така витік уже коштував нам одного разу входу."""
    monkeypatch.setattr(ent, "TRIAL_FILE", tmp_path / "trial.json")
    monkeypatch.setattr(ent, "LAST_SEEN_FILE", tmp_path / "seen.json")
    ent.invalidate()
    yield
    ent.invalidate()


def _days_ago(n: int) -> date:
    # Модуль живе в UTC. Місцева дата тут дала б розбіжність у добу щоночі —
    # рівно ту, що спершу зловив цей тест.
    return ent._today() - timedelta(days=n)


def _seen(days_ago: int) -> None:
    ent.LAST_SEEN_FILE.write_text(json.dumps({"seen": _days_ago(days_ago).isoformat()}))


def _trial_started(days_ago: int) -> None:
    ent.TRIAL_FILE.write_text(
        json.dumps({"started": _days_ago(days_ago).isoformat()})
    )


def _valid(tier: str = "personal", updates_until: str = "2099-01-01") -> LicenseStatus:
    return LicenseStatus(
        valid=True,
        reason="ok",
        tier=tier,
        license_id="lic-1",
        serial="SN-1",
        updates_until=updates_until,
        fingerprint="f" * 64,
    )


def _invalid(reason: str = "not_activated") -> LicenseStatus:
    return LicenseStatus(valid=False, reason=reason, fingerprint="f" * 64)


class TestSafetyIsNeverGated:
    def test_no_licence_still_opens_every_safety_feature(self):
        _trial_started(999)  # проба давно скінчилась
        _seen(0)  # і ключ колись був — жодних піддавків
        e = ent.resolve(_invalid())
        assert e.tier == "free"
        for feature in SAFETY:
            assert e.has(feature), feature

    def test_broken_certificate_does_not_take_navigation_away(self):
        _trial_started(999)
        _seen(0)
        e = ent.resolve(_invalid("bad_signature"))
        assert e.tier == "free"
        assert e.has("core.nav") and e.has("core.alerts")

    def test_every_free_feature_is_a_safety_feature(self):
        # Захист від тихого перенесення чогось платного у вільний рівень і навпаки.
        free = {k for k, v in ent.FEATURES.items() if v == "free"}
        assert free == set(SAFETY)


class TestTrial:
    def test_fresh_install_gets_the_personal_tier(self):
        e = ent.resolve(_invalid())
        assert e.tier == "personal"
        assert e.reason == "trial"
        assert e.trial_days_left == ent.TRIAL_DAYS

    def test_expired_trial_falls_back_to_free(self):
        _trial_started(ent.TRIAL_DAYS + 1)
        e = ent.resolve(_invalid())
        assert e.tier == "free"
        assert e.trial_days_left == 0

    def test_deleting_the_licence_file_does_not_hand_out_a_second_trial(self):
        # Ключ уже колись підтверджувався — проба більше не належить.
        _seen(1)
        e = ent.resolve(_invalid())
        assert e.reason == "not_activated"
        assert e.tier == "free"


class TestUpdatesWindow:
    def test_build_inside_the_window_keeps_the_paid_tier(self, monkeypatch):
        _seen(0)
        monkeypatch.setattr(ent, "BUILD_DATE", "2026-06-01")
        e = ent.resolve(_valid(updates_until="2026-12-31"))
        assert e.tier == "personal"
        assert e.reason == "ok"

    def test_build_past_the_window_drops_to_free_without_calling_it_invalid(
        self, monkeypatch
    ):
        _seen(0)
        monkeypatch.setattr(ent, "BUILD_DATE", "2027-03-01")
        e = ent.resolve(_valid(updates_until="2026-12-31"))
        assert e.tier == "free"
        assert e.reason == "updates_expired"
        # Ліцензія жива — інтерфейс мусить могти це сказати людині.
        assert e.license_tier == "personal"
        assert e.updates_until == "2026-12-31"


class TestOfflineGrace:
    def test_licence_survives_a_long_stretch_without_network(self, monkeypatch):
        _seen(ent.OFFLINE_GRACE_DAYS - 1)
        monkeypatch.setattr(ent, "BUILD_DATE", "2026-01-01")
        e = ent.resolve(_valid())
        assert e.tier == "personal"
        assert e.grace_days_left == 1

    def test_past_the_grace_window_it_drops_to_free_not_to_nothing(self, monkeypatch):
        _seen(ent.OFFLINE_GRACE_DAYS + 5)
        monkeypatch.setattr(ent, "BUILD_DATE", "2026-01-01")
        e = ent.resolve(_valid())
        assert e.tier == "free"
        assert e.reason == "offline_too_long"
        for feature in SAFETY:
            assert e.has(feature), feature

    def test_grace_counts_from_the_last_success_not_from_now(self):
        ent.mark_server_seen()
        assert ent.grace_days_left() == ent.OFFLINE_GRACE_DAYS


class TestTierLadder:
    def test_higher_tiers_contain_everything_below(self):
        _seen(0)
        seen: set[str] = set()
        for tier in ent.TIER_ORDER:
            e = ent.Entitlement(tier=tier, reason="ok")
            features = set(e.features)
            assert seen <= features, f"{tier} втратив право з нижчого рівня"
            seen = features

    def test_unknown_feature_is_not_a_gate(self):
        e = ent.Entitlement(tier="free", reason="ok")
        assert e.has("something.we.never.declared")

    def test_unknown_tier_on_a_valid_certificate_does_not_lock_the_owner_out(self):
        _seen(0)
        e = ent.resolve(_valid(tier="atelier"))
        # Старий словник рівнів не має перетворювати куплений ключ на нічого.
        assert e.tier == "personal"
