"""Day-4 Wave-2 Y-1 — bubblewrap sandbox primitive (closes U4-SEC-C2).

ADR-SBX-001 / ADR-SBX-002 / ADR-SBX-003. Tests the SandboxProfile enum,
wrap_argv builder, clean_env start-from-empty allowlist, and
assert_env_safe defence-in-depth check.

Coverage:

1. SandboxProfile is a closed enum — only {compute, net_observe,
   radio_privileged}.
2. clean_env() returns ONLY the 4-5 allowlisted keys (no os.environ
   leak).
3. clean_env(workspace_dir=...) sets HOME to that path.
4. clean_env() never returns sensitive keys even when os.environ has
   JWT_SECRET_KEY / AI_GEMINI_API_KEY / PHANTOM_PACKAGED set.
5. assert_env_safe raises on JWT_*/AI_*/PHANTOM_*/PYTHON*/LD_PRELOAD/
   LD_LIBRARY_PATH leaks; passes on a fresh clean_env().
6. wrap_argv(compute, ...) when bwrap available → returns ('bwrap', ...,
   '--unshare-net', ...) with sandboxed=True.
7. wrap_argv(net_observe, ...) skips '--unshare-net' (network retained).
8. wrap_argv(radio_privileged, ...) raises NotImplementedError on Day-4.
9. wrap_argv when bwrap missing → unwrapped argv + sandboxed=False +
   WARN log.
10. wrap_argv with workspace_dir adds --bind <dir> /workspace +
    --chdir /workspace.
11. wrap_argv with memory_limit_bytes wraps under prlimit (when
    available).
12. firejail_available() returns False (stale-config detector).
13. Legacy wrap_shell_cmd shim routes through wrap_argv on sandboxed=True.
"""
from __future__ import annotations

import logging
import os
import shutil
from unittest.mock import patch

import pytest


# ─────────────────────────────────────────────────────────── enum closed ──


class TestSandboxProfileEnum:
    def test_closed_to_three_values(self):
        from agent.safety.sandbox import SandboxProfile

        names = {m.name for m in SandboxProfile}
        assert names == {"compute", "net_observe", "radio_privileged"}, (
            f"Y-1: SandboxProfile drifted; got {names!r}. Adding a "
            "profile requires an ADR amendment."
        )

    def test_radio_privileged_unimplemented_on_day4(self):
        from agent.safety.sandbox import SandboxProfile, wrap_argv

        with pytest.raises(NotImplementedError):
            wrap_argv(SandboxProfile.radio_privileged, ["true"])


# ─────────────────────────────────────────────────────── clean_env contract ──


class TestCleanEnv:
    def test_returns_only_allowlisted_keys(self):
        from agent.safety.sandbox import clean_env

        env = clean_env()
        assert set(env.keys()) == {"PATH", "LANG", "LC_ALL", "TERM"}
        assert env["LANG"] == "C.UTF-8"
        assert env["LC_ALL"] == "C.UTF-8"
        assert env["TERM"] == "dumb"

    def test_workspace_dir_sets_home(self, tmp_path):
        from agent.safety.sandbox import clean_env

        env = clean_env(workspace_dir=str(tmp_path))
        assert env["HOME"] == str(tmp_path)
        # Still no JWT/AI/PHANTOM survivors.
        assert "JWT_SECRET_KEY" not in env
        assert "AI_GEMINI_API_KEY" not in env

    def test_does_not_leak_secrets_even_when_set_in_parent(self, monkeypatch):
        """Defensive: even if os.environ has all the audit-named leaks
        set, clean_env starts from empty and never carries them."""
        from agent.safety.sandbox import clean_env

        monkeypatch.setenv("JWT_SECRET_KEY", "super-secret-leak-canary")
        monkeypatch.setenv("AI_GEMINI_API_KEY", "leak-canary-2")
        monkeypatch.setenv("PHANTOM_PACKAGED", "1")
        monkeypatch.setenv("LD_PRELOAD", "/tmp/evil.so")
        monkeypatch.setenv("PYTHONPATH", "/etc")

        env = clean_env()
        assert "JWT_SECRET_KEY" not in env
        assert "AI_GEMINI_API_KEY" not in env
        assert "PHANTOM_PACKAGED" not in env
        assert "LD_PRELOAD" not in env
        assert "PYTHONPATH" not in env


class TestAssertEnvSafe:
    def test_passes_on_clean_env(self):
        from agent.safety.sandbox import assert_env_safe, clean_env

        # Must not raise.
        assert_env_safe(clean_env())

    @pytest.mark.parametrize(
        "leaked_key",
        [
            "JWT_SECRET_KEY",
            "JWT_ALGORITHM",
            "AI_GEMINI_API_KEY",
            "AI_PRIMARY_PROVIDER",
            "PHANTOM_PACKAGED",
            "PHANTOM_DATA_DIR",
            "PYTHONPATH",
            "LD_PRELOAD",
            "LD_LIBRARY_PATH",
        ],
    )
    def test_raises_on_sensitive_keys(self, leaked_key):
        from agent.safety.sandbox import assert_env_safe

        bad_env = {"PATH": "/usr/bin", leaked_key: "x"}
        with pytest.raises(AssertionError):
            assert_env_safe(bad_env)


# ────────────────────────────────────────────────────────── wrap_argv shape ──


class TestWrapArgvBwrapPresent:
    @pytest.fixture(autouse=True)
    def _bwrap_stub(self, monkeypatch):
        """Pretend bwrap is installed; the test environment may not
        actually have it. The pin is on the *argv* the builder produces,
        not on a real subprocess invocation."""
        import agent.safety.sandbox as sb

        def _which(cmd, *_a, **_kw):
            if cmd == "bwrap":
                return "/usr/bin/bwrap"
            if cmd == "prlimit":
                return "/usr/bin/prlimit"
            return shutil.which(cmd)

        monkeypatch.setattr(sb.shutil, "which", _which)

    def test_compute_profile_drops_network(self):
        from agent.safety.sandbox import SandboxProfile, wrap_argv

        argv, sandboxed = wrap_argv(
            SandboxProfile.compute,
            ["/bin/echo", "hi"],
            memory_limit_bytes=None,
        )
        assert sandboxed is True
        assert argv[0] == "bwrap"
        assert "--unshare-net" in argv
        assert "--cap-drop" in argv and "ALL" in argv
        # Canonical container flags.
        assert "--die-with-parent" in argv
        assert "--unshare-pid" in argv
        assert "--clearenv" in argv
        # User argv lands at the tail after `--`.
        assert "/bin/echo" in argv and argv.index("/bin/echo") > argv.index("--")
        assert argv[-1] == "hi"

    def test_net_observe_profile_keeps_network(self):
        from agent.safety.sandbox import SandboxProfile, wrap_argv

        argv, sandboxed = wrap_argv(
            SandboxProfile.net_observe,
            ["/usr/bin/curl", "https://example.com"],
            memory_limit_bytes=None,
        )
        assert sandboxed is True
        assert "--unshare-net" not in argv, (
            "net_observe profile must keep network — --unshare-net "
            "leaked from base flags."
        )

    def test_workspace_dir_binds_and_chdirs(self, tmp_path):
        from agent.safety.sandbox import SandboxProfile, wrap_argv

        argv, _ = wrap_argv(
            SandboxProfile.compute,
            ["/bin/true"],
            workspace_dir=str(tmp_path),
            memory_limit_bytes=None,
        )
        assert "--bind" in argv
        # The bind pair should be: --bind <tmp_path> /workspace
        idx = argv.index("--bind")
        assert argv[idx + 1] == str(tmp_path)
        assert argv[idx + 2] == "/workspace"
        # And chdir to /workspace must follow.
        assert "--chdir" in argv
        chdir_idx = argv.index("--chdir")
        assert argv[chdir_idx + 1] == "/workspace"

    def test_memory_limit_wraps_with_prlimit(self):
        from agent.safety.sandbox import SandboxProfile, wrap_argv

        argv, _ = wrap_argv(
            SandboxProfile.compute,
            ["/bin/true"],
            memory_limit_bytes=536_870_912,
        )
        assert argv[0] == "prlimit"
        assert "--as=536870912" in argv
        # bwrap follows after `--`.
        assert "bwrap" in argv
        assert argv.index("bwrap") > argv.index("--")


class TestWrapArgvBwrapMissing:
    def test_returns_unwrapped_with_sandboxed_false(self, monkeypatch, caplog):
        import agent.safety.sandbox as sb

        monkeypatch.setattr(sb.shutil, "which", lambda *_a, **_kw: None)
        with caplog.at_level(logging.WARNING):
            argv, sandboxed = sb.wrap_argv(
                sb.SandboxProfile.compute, ["/bin/true"]
            )
        assert sandboxed is False
        assert argv == ["/bin/true"]
        assert any(
            "bwrap missing" in rec.message for rec in caplog.records
        )


# ─────────────────────────────────────────────────────────────── stale ──


class TestFirejailStaleDetector:
    def test_always_returns_false(self):
        from agent.safety.sandbox import firejail_available

        assert firejail_available() is False, (
            "Y-1: firejail_available() must always return False post-Y-1; "
            "it survives only as a stale-config detector for old deploys."
        )


# ─────────────────────────────────────────────────────── wrap_shell_cmd shim ──


class TestWrapShellCmdShim:
    def test_unsandboxed_bypass_unchanged(self):
        from agent.safety.sandbox import wrap_shell_cmd

        argv, sandboxed = wrap_shell_cmd("echo hi", sandboxed=False)
        assert sandboxed is False
        assert argv == ["/bin/sh", "-c", "echo hi"]

    def test_sandboxed_routes_through_wrap_argv(self, monkeypatch):
        """Sandbox=True should produce a bwrap-wrapped argv via the
        new compute profile (when bwrap is available)."""
        import agent.safety.sandbox as sb

        monkeypatch.setattr(
            sb.shutil,
            "which",
            lambda cmd, *_a, **_kw: "/usr/bin/bwrap" if cmd == "bwrap" else None,
        )
        argv, sandboxed = sb.wrap_shell_cmd("echo hi", sandboxed=True)
        assert sandboxed is True
        assert argv[0] == "bwrap"
        # The user command at the tail.
        assert "/bin/sh" in argv
        assert argv[-1] == "echo hi"
