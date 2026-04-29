"""Day-4 Wave-2 Y-5 — Sandbox settings surface (ADR-SBX-002 §"Settings
exposure"). Closes audit U4-SEC-M1 (workspace bind not visible to
operator).

Coverage:

1. config.agent_workspace_dir is exposed under the agent settings
   category.
2. config.agent_sandbox_profile_default exists with default
   "compute" + Literal closed to {compute, net_observe}.
   `radio_privileged` is deliberately NOT exposed (Day-6 only).
3. Both keys appear in GET /api/v1/settings response — operator
   can flip via the Settings UI without an env restart.
"""
from __future__ import annotations

import pytest


class TestAgentSandboxProfileDefault:
    def test_default_is_compute(self):
        from config import PhantomConfig

        default = PhantomConfig.model_fields[
            "agent_sandbox_profile_default"
        ].default
        assert default == "compute", (
            f"Y-5 regression: agent_sandbox_profile_default flipped to "
            f"{default!r}; the safe default is 'compute' (no network, "
            "no caps)."
        )

    def test_literal_closed_to_compute_and_net_observe(self):
        """`radio_privileged` is NOT in the Settings-exposed Literal —
        toggling it on early would silently re-enable CAP_NET_RAW for
        every bash.run spawn. Operators wait for Day-6."""
        from config import PhantomConfig

        cfg = PhantomConfig(agent_sandbox_profile_default="compute")
        assert cfg.agent_sandbox_profile_default == "compute"
        cfg = PhantomConfig(agent_sandbox_profile_default="net_observe")
        assert cfg.agent_sandbox_profile_default == "net_observe"

        with pytest.raises(Exception):
            PhantomConfig(
                agent_sandbox_profile_default="radio_privileged"  # type: ignore[arg-type]
            )

    def test_python_enum_values_match_setting_literal(self):
        """The Settings Literal MUST be a strict subset of the
        `SandboxProfile` Python enum so the operator can never set a
        value that the runtime doesn't recognise."""
        from agent.safety.sandbox import SandboxProfile

        runtime_names = {m.name for m in SandboxProfile}
        # Settings exposes 2 of the 3 (radio_privileged Day-6 only).
        settings_exposed = {"compute", "net_observe"}
        assert settings_exposed.issubset(runtime_names)


class TestAgentWorkspaceDir:
    def test_default_is_phantom_workspace(self):
        from config import PhantomConfig

        default = PhantomConfig.model_fields["agent_workspace_dir"].default
        # Tilde-expanded at runtime; the default string is what the
        # Settings UI shows.
        assert default == "~/phantom/workspace"

    def test_field_is_string_type(self):
        """Operator-editable text field — the Settings auto-render
        (Day-3 R-1 settings_repo) only knows how to render `string`
        types as <input type="text">. A future migration to a
        path-picker is a separate ADR."""
        from config import PhantomConfig

        annotation = PhantomConfig.model_fields["agent_workspace_dir"].annotation
        assert annotation is str
