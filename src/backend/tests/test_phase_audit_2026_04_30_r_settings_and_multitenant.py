"""Day-3 audit-2026-04-30 — Block R commits R-1 + R-2.

* **R-1 (D2-FE1)** — Settings UI auto-render of the Day-2 + Day-3
  config keys the front-end was missing. The frontend
  `SettingsPanel.tsx` reads `routes_settings.CATEGORY_SPEC` to pick
  category buckets; before this commit, `chat_tool_call_timeout_s`,
  `chat_tool_max_total_ms`, `chat_tool_max_calls_per_turn`,
  `log_json_enabled`, `security_trust_xff`,
  `security_trusted_proxies`, and `deployment_mode` were defined on
  the backend but NEVER surfaced as UI rows.

* **R-2 (NEW-OPS-03 / D2-I2)** — multi-tenant deploys were
  forbidden in OPERATIONS.md but not enforced in code. New
  `deployment_mode` config field + lifespan guard refuses to boot
  in `multi` mode unless `PHANTOM_ALLOW_MULTI_TENANT_PREVIEW=1`
  acknowledges the leakage risk. Single-tenant default unchanged.
"""

from __future__ import annotations

from typing import Any, Iterable

import pytest


# ── R-1 — every Day-2/Day-3 key surfaces in CATEGORY_SPEC ────────────────────


REQUIRED_NEW_KEYS: tuple[str, ...] = (
    "chat_tools_enabled",
    "chat_tool_call_timeout_s",
    "chat_tool_max_total_ms",
    "chat_tool_max_calls_per_turn",
    "log_json_enabled",
    "security_trust_xff",
    "security_trusted_proxies",
    "deployment_mode",
)


def _all_spec_keys() -> set[str]:
    from api.routes_settings import CATEGORY_SPEC
    out: set[str] = set()
    for cat in CATEGORY_SPEC:
        out.update(cat["keys"])
    return out


class TestR1SettingsAutoRender:
    @pytest.mark.parametrize("key", REQUIRED_NEW_KEYS)
    def test_key_present_in_some_category(self, key: str):
        keys = _all_spec_keys()
        assert key in keys, (
            f"D3-R-1 regression: backend config key '{key}' is "
            f"defined in PhantomConfig but not surfaced in any "
            f"CATEGORY_SPEC bucket. The SettingsPanel won't render "
            f"a row for it."
        )

    def test_chat_category_exists(self):
        from api.routes_settings import CATEGORY_SPEC
        chat_cat = next((c for c in CATEGORY_SPEC if c["id"] == "chat"), None)
        assert chat_cat is not None, (
            "D3-R-1 regression: 'chat' category missing — chat tool "
            "knobs would be unreachable to the operator."
        )
        assert "label" in chat_cat
        assert chat_cat["label"]  # non-empty Ukrainian label
        # Chat category MUST contain at least the tool-use knobs.
        for k in (
            "chat_tools_enabled",
            "chat_tool_call_timeout_s",
            "chat_tool_max_total_ms",
        ):
            assert k in chat_cat["keys"], k


# ── R-2 — multi-tenant runtime guard ──────────────────────────────────────────


class TestR2MultiTenantGuard:
    def test_default_deployment_mode_is_single(self):
        from config import PhantomConfig
        v = PhantomConfig.model_fields["deployment_mode"].default
        assert v == "single", (
            f"D3-R-2 regression: deployment_mode default flipped to "
            f"{v!r} — out-of-the-box deploys would skip the multi-"
            f"tenant guardrail."
        )

    def test_single_mode_boots_normally(self):
        from main import _refuse_unsupported_deployment_mode
        # Default config — must be a no-op (no exception).
        _refuse_unsupported_deployment_mode()

    def test_multi_mode_refused_without_override(self):
        from config import config
        from main import _refuse_unsupported_deployment_mode

        prev = config.deployment_mode
        config.deployment_mode = "multi"
        try:
            with pytest.raises(RuntimeError, match="multi"):
                _refuse_unsupported_deployment_mode()
        finally:
            config.deployment_mode = prev

    def test_multi_mode_allowed_with_explicit_override(self, monkeypatch):
        from config import config
        from main import _refuse_unsupported_deployment_mode

        monkeypatch.setenv(
            "PHANTOM_ALLOW_MULTI_TENANT_PREVIEW", "1"
        )
        prev = config.deployment_mode
        config.deployment_mode = "multi"
        try:
            # Must NOT raise — explicit acknowledgement is the escape
            # hatch documented in the function docstring.
            _refuse_unsupported_deployment_mode()
        finally:
            config.deployment_mode = prev
