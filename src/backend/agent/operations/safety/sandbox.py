"""Day-4 Wave-2 Y-1 — bubblewrap sandbox primitive.

Closes audit U4-SEC-C2 (firejail not installed → today's "sandbox" is a
no-op fall-through). Implements ADR-SBX-001 / ADR-SBX-002 / ADR-SBX-003.

`bwrap(1)` is the sole subprocess-isolation primitive on the live Radxa
kernel 6.17.1; firejail is dropped, nsjail is heavyweight overkill,
Landlock is per-thread (wrong granularity).

Public API (callers in Y-2 import only these):

  SandboxProfile         — closed enum (compute | net_observe | radio_privileged).
  wrap_argv(...)         — returns (argv, sandboxed: bool) for a given profile.
  clean_env()            — start-from-empty allowlist; never calls os.environ.copy().
  firejail_available()   — preserved as a STALE-CONFIG DETECTOR returning False.

Cross-cutting invariant (`U4-SEC-G1`): callers NEVER hand-assemble bwrap
flags. The closed enum is the policy-surface boundary. Adding a new
profile is a deliberate ADR amendment, not a parameter.
"""
from __future__ import annotations

import logging
import os
import shutil
from enum import Enum

logger = logging.getLogger(__name__)


# ────────────────────────────────────────────────────────────────── profiles ──


class SandboxProfile(Enum):
    """Closed enum. Adding a value requires an ADR amendment."""

    #: bash.run, mcp.adapter — net dropped, no caps, no PID, no IPC, no UTS,
    #: fresh /tmp tmpfs, RO root.
    compute = "compute"

    #: HTTP/DNS reads from sandboxed code (mcp http GET tools, future
    #: net.fetch). Net retained but CAP_NET_RAW still dropped — no raw
    #: ICMP from this profile.
    net_observe = "net_observe"

    #: Day-6 only — Wi-Fi / BT scan that needs CAP_NET_RAW + CAP_NET_ADMIN.
    #: Day-4 raises NotImplementedError if anyone tries to wrap with it.
    radio_privileged = "radio_privileged"

    #: Day-NN — graduated middle tier between `compute` and full `unsafe_mode`.
    #: Adds READ-ONLY binds for /var, /opt, /home (so the agent can probe
    #: dpkg-query, /var/log, systemd unit files, the operator's dotfiles)
    #: AND keeps host network. Caps still dropped, write paths still tmpfs,
    #: workspace still the only writable bind. Closes audit gap "compute is
    #: too closed; unsafe_mode is too open" — most introspection use cases
    #: live here, not at the extremes.
    read_host = "read_host"


# ────────────────────────────────────────────────────────────── env scrub ──


# ADR-SBX-003: start-from-empty allowlist. NEVER call os.environ.copy() —
# the construction is additive from a known-good baseline.
_ALLOWED_PATH = (
    "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
)
_ALLOWED_LANG = "C.UTF-8"
_ALLOWED_TERM = "dumb"

# Belt-and-braces blocklist for the env audit test — these MUST NEVER
# appear in clean_env() output even if the allowlist drifts.
SENSITIVE_ENV_PREFIXES: tuple[str, ...] = (
    "JWT_",
    "AI_",
    "PHANTOM_",
    "PYTHON",
    # Day-4 Wave-2 audit (security #M-3): close the
    # Day-5-extension-class — direct provider env keys (OPENAI_API_KEY,
    # ANTHROPIC_API_KEY, GOOGLE_API_KEY, etc.) MUST never leak into a
    # bwrap'd subprocess. Adding now means a future config that
    # adopts these names doesn't silently regress the audit.
    "OPENAI_",
    "ANTHROPIC_",
    "GOOGLE_",
    "GEMINI_",
    "HF_",
    "HUGGINGFACE_",
)
SENSITIVE_ENV_EXACT: frozenset[str] = frozenset(
    {"LD_PRELOAD", "LD_LIBRARY_PATH"}
)


def clean_env(workspace_dir: str | None = None) -> dict[str, str]:
    """Return a fresh env dict — five allowlisted keys only.

    Implementations MUST NOT call ``os.environ.copy()`` then pop. The
    construction is start-from-empty, additive — that's the load-bearing
    invariant the W-Y env-audit test enforces.

    ``HOME`` is the caller-provided ``workspace_dir`` when available
    (per ADR-SBX-003 §"Why kept" — npm + dotfile-writing tools should
    target the workspace, not ``/home/radxa``).
    """
    env: dict[str, str] = {
        "PATH": _ALLOWED_PATH,
        "LANG": _ALLOWED_LANG,
        "LC_ALL": _ALLOWED_LANG,
        "TERM": _ALLOWED_TERM,
    }
    if workspace_dir:
        env["HOME"] = str(workspace_dir)
    return env


def host_env_unsafe() -> dict[str, str]:
    """Return a copy of the *host* environment minus our secret allowlist.

    For Day-NN "no-leash" mode ONLY. The closed ``clean_env`` allowlist
    breaks too many real-world host workflows (nvm/pyenv PATH overlays,
    git wanting ``HOME``, npm/cargo cache dirs, GPG_TTY, SSH_AUTH_SOCK,
    DBUS_SESSION_BUS_ADDRESS, XDG_*, etc.) — denying them all defeats
    the purpose of unsafe_mode entirely.

    This function instead does the inverse: start from `os.environ`,
    DROP anything matching the same deny-lists used by
    `assert_env_safe`. The result still passes `assert_env_safe`, so
    the defence-in-depth invariant holds.

    Concretely, the agent gets the host PATH, HOME, USER, SHELL,
    XDG_*, SSH_AUTH_SOCK, GPG_TTY, DBUS_SESSION_BUS_ADDRESS, locale,
    etc. — but NOT JWT_SECRET_KEY, AI_GEMINI_API_KEY, ANTHROPIC_API_KEY,
    OPENAI_API_KEY, HUGGINGFACE_TOKEN, LD_PRELOAD, or any other secret
    the daemon carries.
    """
    env: dict[str, str] = {}
    for key, value in os.environ.items():
        if key in SENSITIVE_ENV_EXACT:
            continue
        if any(key.startswith(prefix) for prefix in SENSITIVE_ENV_PREFIXES):
            continue
        env[key] = value
    return env


# ──────────────────────────────────────────────────────── bwrap argv builder ──


def bwrap_available() -> bool:
    """Return True if `bwrap` is on PATH. Operator visibility — used by
    Y-5 Settings to surface a red banner when the binary isn't present."""
    return shutil.which("bwrap") is not None


def firejail_available() -> bool:
    """Stale-config detector. Per ADR-SBX-001 firejail is no longer the
    primitive; this function survives ONLY so a Day-3-or-earlier deploy
    that still references the legacy flag prints a clear no-op."""
    return False


# Per ADR-SBX-001: canonical flags every profile shares.
_BWRAP_BASE_FLAGS: tuple[str, ...] = (
    "--die-with-parent",
    "--unshare-pid",
    "--unshare-ipc",
    "--unshare-uts",
    "--unshare-cgroup",
    "--ro-bind", "/usr", "/usr",
    "--ro-bind", "/etc", "/etc",
    "--symlink", "usr/lib", "/lib",
    "--symlink", "usr/lib", "/lib64",
    "--symlink", "usr/bin", "/bin",
    "--symlink", "usr/sbin", "/sbin",
    "--proc", "/proc",
    "--dev", "/dev",
    "--tmpfs", "/tmp",
    "--clearenv",
    "--new-session",
    "--cap-drop", "ALL",
)


def _profile_flags(profile: SandboxProfile, workspace_dir: str | None) -> list[str]:
    """Per-profile delta flags layered on top of `_BWRAP_BASE_FLAGS`."""
    if profile is SandboxProfile.radio_privileged:
        # Day-6 only.
        raise NotImplementedError(
            "SandboxProfile.radio_privileged is reserved for Day-6 BT/Wi-Fi "
            "scan work; no caller should wrap with it on Day-4."
        )

    flags: list[str] = []

    # Workspace bind: per ADR-SBX-002 §"Workspace bind path".
    if workspace_dir:
        flags.extend(["--bind", str(workspace_dir), "/workspace"])
        flags.extend(["--chdir", "/workspace"])

    # Day-NN read_host: layer extra read-only host binds + retain net.
    # /var → dpkg/apt/log/cache. /opt → third-party installs. /home → operator
    # dotfiles (.gitconfig, .ssh public keys, .config/*). Caps still dropped,
    # workspace still the only writable bind, env still cleared.
    if profile is SandboxProfile.read_host:
        flags.extend([
            "--ro-bind-try", "/var", "/var",
            "--ro-bind-try", "/opt", "/opt",
            "--ro-bind-try", "/home", "/home",
            "--ro-bind-try", "/srv", "/srv",
        ])

    # Network gating.
    if profile in (SandboxProfile.net_observe, SandboxProfile.read_host):
        # Net retained, but the base flags do NOT unshare-net so we
        # explicitly NO-OP here. The caller still gets host-network access.
        pass
    else:
        # Default: drop network entirely.
        flags.append("--unshare-net")
    return flags


def wrap_argv(
    profile: SandboxProfile,
    cmd_argv: list[str],
    *,
    workspace_dir: str | None = None,
    memory_limit_bytes: int | None = 536_870_912,
) -> tuple[list[str], bool]:
    """Wrap a child argv with bwrap per `profile`.

    Returns ``(argv, sandboxed)``. ``sandboxed=False`` is returned (and
    logged WARN once) when ``bwrap`` is missing — the caller is
    responsible for surfacing that flag in the audit trail so the log
    tells the truth (`agent.kernel.audit.ActionResult.sandboxed`).

    Memory cap: per ADR-SBX-001 §"Memory cap" we wrap the bwrap call
    with ``prlimit --as=N -- bwrap …`` (not a bwrap flag — bubblewrap
    has no rlimit-as analogue). Default 512 MiB matches the legacy
    firejail rlimit; pass ``memory_limit_bytes=None`` to opt out.
    """
    if not isinstance(cmd_argv, list) or not cmd_argv:
        raise ValueError("wrap_argv requires a non-empty cmd_argv list")

    if not bwrap_available():
        logger.warning(
            "agent.operations.safety.sandbox: bwrap missing on PATH — running %s "
            "UNSANDBOXED. Audit will record sandboxed=False so the log "
            "tells the truth. Install `apt install bubblewrap` to fix.",
            cmd_argv[0],
        )
        return (list(cmd_argv), False)

    base = list(_BWRAP_BASE_FLAGS)
    profile_extra = _profile_flags(profile, workspace_dir)
    bwrap_argv = ["bwrap", *base, *profile_extra, "--", *cmd_argv]

    if memory_limit_bytes is not None and memory_limit_bytes > 0:
        # Wrap with prlimit so the address-space cap applies to the
        # entire bwrap subtree.
        if shutil.which("prlimit") is not None:
            return (
                [
                    "prlimit",
                    f"--as={int(memory_limit_bytes)}",
                    "--",
                    *bwrap_argv,
                ],
                True,
            )
        # prlimit absent — log once and still return sandboxed=True
        # because bwrap itself isolated the call. The memory cap is
        # the only loss.
        logger.debug(
            "agent.operations.safety.sandbox: prlimit missing — proceeding without "
            "memory cap (the namespace isolation still holds)."
        )

    return (bwrap_argv, True)


# ───────────────────────────────────────────────────────── env audit util ──


def assert_env_safe(env: dict[str, str]) -> None:
    """Raise AssertionError if `env` contains any sensitive variable.

    Used as a defence-in-depth check at every Y-2 subprocess call site
    after building a child env: even if a refactor accidentally widens
    the allowlist, the audit fires.
    """
    leaks: list[str] = []
    for key in env.keys():
        if key in SENSITIVE_ENV_EXACT:
            leaks.append(key)
            continue
        for prefix in SENSITIVE_ENV_PREFIXES:
            if key.startswith(prefix):
                leaks.append(key)
                break
    if leaks:
        raise AssertionError(
            f"sandbox.assert_env_safe: child env contains sensitive "
            f"variable(s) {leaks!r} — clean_env() allowlist drifted."
        )


# ────────────────────────────────────────────────────────────── legacy compat ──


def wrap_shell_cmd(cmd: str, sandboxed: bool) -> tuple[list[str], bool]:
    """Y-1 back-compat shim. Old callers (Day-3 bash.py before Y-2 retarget)
    pass a /bin/sh -c command string; route through the new builder under
    the ``compute`` profile. Y-2 retargets every caller to ``wrap_argv()``
    directly + this shim is removed in Day-5.

    The original signature is preserved so the test suite continues to
    pin the (argv, sandboxed) shape during the Y-1 → Y-2 transition.
    """
    if not sandboxed:
        return (["/bin/sh", "-c", cmd], False)
    # Per ADR-SBX-002, callers never hand-assemble flags. Route through
    # wrap_argv with the canonical compute profile; let the new
    # primitive handle the bwrap-missing fallthrough.
    workspace = os.environ.get("PHANTOM_AGENT_WORKSPACE_DIR")
    return wrap_argv(
        SandboxProfile.compute,
        ["/bin/sh", "-c", cmd],
        workspace_dir=workspace,
    )
