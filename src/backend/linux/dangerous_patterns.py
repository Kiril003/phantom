"""Central blocklist of dangerous shell patterns.

Used by `linux.executor.SandboxExecutor` to reject commands BEFORE the
subprocess is ever spawned. Each rule is an explicit `(label, regex)`
pair so the audit trail can name the offending pattern instead of
echoing the user's command.

The blocklist is intentionally over-broad — false positives are acceptable
because the sandbox is for a ROOT operator running ad-hoc shell, never
for templated automation. False negatives are not.

Kept stable across phases: callers import `is_dangerous` and
`find_violation` only; new patterns are appended to `_RULES`.
"""
from __future__ import annotations

import re
from typing import NamedTuple


class _Rule(NamedTuple):
    label: str
    pattern: re.Pattern[str]


# ── Rules ─────────────────────────────────────────────────────────────────────
#
# Order matters only for human-friendly labelling — the first matching rule
# is what `find_violation` returns. All rules use `re.IGNORECASE` so a
# clever caller cannot bypass with `RM -RF /`.

def _r(label: str, pattern: str) -> _Rule:
    return _Rule(label=label, pattern=re.compile(pattern, re.IGNORECASE))


_RULES: tuple[_Rule, ...] = (
    # Catastrophic recursive deletes against root or absolute paths.
    _r("rm-rf-root", r"\brm\s+(?:-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|-rf|-fr)\s+/(?:\s|$|[^a-zA-Z0-9._-])"),
    _r("rm-rf-anywhere", r"\brm\s+(?:-[a-z]*r[a-z]*f|-rf|-fr|--recursive\s+--force|--force\s+--recursive)\b"),

    # Classic fork bomb. Match the canonical and a few obfuscations.
    _r("fork-bomb", r":\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:"),
    _r("fork-bomb-named", r"\b(\w+)\s*\(\s*\)\s*\{\s*\1\s*\|\s*\1\s*&\s*\}\s*;\s*\1"),

    # Pipe-to-shell from network — the most common single-line RCE.
    _r("curl-pipe-sh", r"\bcurl\b[^|;&]*\|\s*(?:sudo\s+)?(?:ba)?sh\b"),
    _r("wget-pipe-sh", r"\bwget\b[^|;&]*-O-?[^|;&]*\|\s*(?:sudo\s+)?(?:ba)?sh\b"),
    _r("wget-qO-pipe-sh", r"\bwget\b[^|;&]*-q?O-?[^|;&]*\|\s*(?:sudo\s+)?(?:ba)?sh\b"),

    # Block-device wreckers.
    _r("dd-of-device", r"\bdd\b[^;&|]*\bof\s*=\s*/dev/(?:sd[a-z]|nvme|mmcblk|hd[a-z]|disk)"),
    _r("mkfs", r"\bmkfs(?:\.\w+)?\b"),
    _r("fdisk-write", r"\bfdisk\b[^;&|]*-(?:l|d|n|w)?[^;&|]*/dev/"),
    _r("parted", r"\bparted\b[^;&|]*/dev/"),

    # Privilege escalation / kernel surfaces.
    _r("sudo", r"\bsudo\b"),
    _r("su-root", r"\bsu\s+(?:-\s+)?(?:root\b|-c\b)"),
    _r("chmod-777-root", r"\bchmod\s+(?:-R\s+)?7{2,3}7?\s+/(?:\s|$|[^a-zA-Z0-9._-])"),
    _r("chown-root", r"\bchown\b[^;&|]*\s+/(?:\s|$|[^a-zA-Z0-9._-])"),

    # Kernel module / sysctl tampering.
    _r("kernel-module", r"\b(?:insmod|rmmod|modprobe)\b"),
    _r("sysctl-write", r"\bsysctl\b[^;&|]*-w\b"),

    # Process & system-wide kills.
    _r("kill-minus1", r"\bkill\s+(?:-9\s+)?-1\b"),
    _r("killall-init", r"\bkillall\s+(?:-9\s+)?(?:1|init|systemd)\b"),

    # Reboot / poweroff.
    _r("reboot", r"\b(?:reboot|halt|poweroff|shutdown)\b"),

    # Direct writes to host system paths.
    _r("write-to-etc", r"(?:>|>>)\s*/etc/"),
    _r("write-to-boot", r"(?:>|>>)\s*/boot/"),
    _r("write-to-dev", r"(?:>|>>)\s*/dev/(?!null|stderr|stdout|tty\b)"),
    _r("write-to-proc", r"(?:>|>>)\s*/proc/"),
    _r("write-to-sys", r"(?:>|>>)\s*/sys/"),

    # Network shells.
    _r("netcat-listen", r"\b(?:nc|ncat|netcat)\b[^;&|]*-l\b"),
    _r("bash-tcp-shell", r"/dev/tcp/"),
)


def find_violation(cmd: str) -> str | None:
    """Return the first matching rule label, or `None` if the command is clean.

    The check is performed on the raw string — callers MUST pass the
    canonicalised text exactly as it would be handed to `/bin/sh -c`.
    """
    if not isinstance(cmd, str) or not cmd.strip():
        return None
    for rule in _RULES:
        if rule.pattern.search(cmd):
            return rule.label
    return None


def is_dangerous(cmd: str) -> bool:
    """Convenience boolean wrapper around :func:`find_violation`."""
    return find_violation(cmd) is not None


def all_rule_labels() -> tuple[str, ...]:
    """Expose rule labels for diagnostics + tests (immutable)."""
    return tuple(rule.label for rule in _RULES)
