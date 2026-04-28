"""Day-4 Wave-1 — Block V-4: `_refuse_lan_bind_in_packaged_mode`.

Closes audit-2026-05-01-day4 finding U5-PKG-H4 (default `host=0.0.0.0`
exposes the backend to the LAN inside a packaged desktop build).
Implements ADR-DSH-003 (`docs/architecture/desktop-shell.md` §3).

The contract:

* `PHANTOM_PACKAGED=1` AND `config.host != "127.0.0.1"` →
  `RuntimeError`. The exception message is actionable (names both env
  variables and the ADR) so an operator hitting it once knows exactly
  what to set.
* Loopback variants (`127.0.0.1`, `::1`, `localhost`, empty string)
  pass through silently.
* `PHANTOM_PACKAGED` unset → no raise regardless of host (dev parity).
* `PHANTOM_ALLOW_PACKAGED_LAN_BIND=1` → passes through with a WARN log
  (operator-acknowledged risk).
* The pytest-exempt path mirrors `_refuse_ci_default_secret`'s pattern;
  tests that need to *exercise* the refuse path set
  `PHANTOM_TEST_PACKAGED_BIND=1` to opt out of the exemption.

Lifespan integration is asserted by `inspect.getsource(lifespan)`
substring check — keeps this file decoupled from the asgi/asyncio
plumbing while still catching a regression that drops the call.
"""
from __future__ import annotations

import inspect

import pytest

from config import config as live_config


_DEV_HOST = "0.0.0.0"


# ─────────────────────────────────────────────── refuse path ──


class TestRefuseLanBindInPackagedMode:
    def test_packaged_lan_bind_refused(self, monkeypatch):
        """The audit's hard requirement: PHANTOM_PACKAGED=1 +
        host=0.0.0.0 must abort startup, not silently expose."""
        from main import _refuse_lan_bind_in_packaged_mode

        monkeypatch.setenv("PHANTOM_PACKAGED", "1")
        monkeypatch.setenv("PHANTOM_TEST_PACKAGED_BIND", "1")
        monkeypatch.setattr(live_config, "host", _DEV_HOST)

        with pytest.raises(RuntimeError) as excinfo:
            _refuse_lan_bind_in_packaged_mode()
        msg = str(excinfo.value)
        # Actionable error: names BOTH env knobs + the ADR.
        assert "PHANTOM_ALLOW_PACKAGED_LAN_BIND" in msg
        assert "127.0.0.1" in msg
        assert "ADR-DSH-003" in msg

    def test_packaged_explicit_lan_ip_refused(self, monkeypatch):
        """A non-default but still-public IP (e.g. operator pinned
        ``host=192.168.1.50`` for some reason) is also refused — the
        check is "not loopback" not "not 0.0.0.0"."""
        from main import _refuse_lan_bind_in_packaged_mode

        monkeypatch.setenv("PHANTOM_PACKAGED", "1")
        monkeypatch.setenv("PHANTOM_TEST_PACKAGED_BIND", "1")
        monkeypatch.setattr(live_config, "host", "192.168.1.50")

        with pytest.raises(RuntimeError):
            _refuse_lan_bind_in_packaged_mode()


# ─────────────────────────────────────────────── allowed paths ──


class TestAllowedPaths:
    @pytest.mark.parametrize("host", ["127.0.0.1", "::1", "localhost", ""])
    def test_packaged_loopback_variants_allowed(self, monkeypatch, host):
        """All four loopback spellings pass through silently. Empty
        string is included because uvicorn coerces it to loopback."""
        from main import _refuse_lan_bind_in_packaged_mode

        monkeypatch.setenv("PHANTOM_PACKAGED", "1")
        monkeypatch.setenv("PHANTOM_TEST_PACKAGED_BIND", "1")
        monkeypatch.setattr(live_config, "host", host)

        # Should NOT raise.
        _refuse_lan_bind_in_packaged_mode()

    def test_dev_mode_lan_bind_allowed(self, monkeypatch):
        """PHANTOM_PACKAGED unset (the dev / Radxa-headless mode) →
        host=0.0.0.0 stays legitimate. This is the back-compat
        invariant from ADR-DSH-003 §5."""
        from main import _refuse_lan_bind_in_packaged_mode

        monkeypatch.delenv("PHANTOM_PACKAGED", raising=False)
        monkeypatch.setattr(live_config, "host", _DEV_HOST)

        _refuse_lan_bind_in_packaged_mode()  # no raise

    def test_packaged_with_explicit_override_allowed(self, monkeypatch, caplog):
        """PHANTOM_ALLOW_PACKAGED_LAN_BIND=1 is the operator-acknowledged
        escape hatch. Logs WARN but does not raise."""
        import logging

        from main import _refuse_lan_bind_in_packaged_mode

        monkeypatch.setenv("PHANTOM_PACKAGED", "1")
        monkeypatch.setenv("PHANTOM_ALLOW_PACKAGED_LAN_BIND", "1")
        monkeypatch.setenv("PHANTOM_TEST_PACKAGED_BIND", "1")
        monkeypatch.setattr(live_config, "host", _DEV_HOST)

        with caplog.at_level(logging.WARNING, logger="main"):
            _refuse_lan_bind_in_packaged_mode()  # no raise

        # The WARN line names the override env so operator can grep it.
        assert any(
            "PHANTOM_ALLOW_PACKAGED_LAN_BIND" in r.message
            for r in caplog.records
        ), [r.message for r in caplog.records]


# ─────────────────────────────────────────────── pytest exemption ──


class TestPytestExemption:
    def test_pytest_run_without_test_flag_is_exempt(self, monkeypatch):
        """Mirrors `_refuse_ci_default_secret`'s exemption pattern.
        The conftest never sets PHANTOM_PACKAGED, but if some future
        env-leakage does, pytest must remain bootable. The exemption
        is bypassed only when a test explicitly opts in via
        PHANTOM_TEST_PACKAGED_BIND=1 (this file's pattern)."""
        from main import _refuse_lan_bind_in_packaged_mode

        monkeypatch.setenv("PHANTOM_PACKAGED", "1")
        monkeypatch.delenv("PHANTOM_TEST_PACKAGED_BIND", raising=False)
        monkeypatch.setattr(live_config, "host", _DEV_HOST)

        # Even though host is non-loopback, pytest exemption lets us
        # boot — the V-4 guard fires only in production-like contexts.
        _refuse_lan_bind_in_packaged_mode()  # no raise


# ─────────────────────────────────────────────── lifespan wiring ──


class TestLifespanWiring:
    def test_lifespan_calls_refuse_lan_bind(self):
        """Source-level pin: V-4 must be wired into the lifespan
        sequence. Catches a regression that adds the function but
        forgets the call site."""
        import main

        src = inspect.getsource(main.lifespan)
        assert "_refuse_lan_bind_in_packaged_mode()" in src, (
            "V-4 regression: lifespan() does not call "
            "_refuse_lan_bind_in_packaged_mode. Restore the call after "
            "_refuse_unsupported_deployment_mode()."
        )

    def test_refuse_triple_ordering_preserved(self):
        """The three refuse-functions run in a fixed order at the top
        of lifespan: secret → deployment-mode → packaged-bind. ADR-RTP-001
        G1 (`docs/architecture/desktop-shell.md`) treats them as a
        single bundle — pin the order so a refactor that splits them
        across the future G1/G2 boundary is forced to revisit this
        test (and the ADR)."""
        import main

        src = inspect.getsource(main.lifespan)
        # Order check via index ordering.
        i_secret = src.find("_refuse_ci_default_secret(")
        i_mode = src.find("_refuse_unsupported_deployment_mode(")
        i_bind = src.find("_refuse_lan_bind_in_packaged_mode(")
        assert i_secret >= 0 and i_mode >= 0 and i_bind >= 0, (
            f"missing call: secret={i_secret} mode={i_mode} bind={i_bind}"
        )
        assert i_secret < i_mode < i_bind, (
            "refuse triple out of order in lifespan(); see ADR-RTP-001"
        )
