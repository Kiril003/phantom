# Cluster `sandbox-runtime` — Phase-2 Architecture

**Owner clusters**: `sandbox-runtime`, `radio-capabilities-reserved`.
**Day-4 blocks**: Y-1, Y-2, Y-3, Y-4, Y-5, Y-6.
**Vision vectors**: 3 (sandbox), 11 (BT/WiFi/serial — reserved for Day-6).
**Baseline**: `53d16bc`. **Author**: Phase-2 cluster architect (3 of 8). **Date**: 2026-04-28.

This file specifies the seven ADRs (six for `sandbox-runtime`, one for `radio-capabilities-reserved`),
the Python interfaces every Phase-3 block consumes, the per-block test plan, and the back-compat
invariants every implementer must preserve. **No code changes are introduced by this document — it
freezes the ADR set so Phase-3 blocks can land in parallel.**

Repo paths cited inline as `<file>:<line>`. Audit references resolve to
`docs/audit-2026-05-01-day4/FINDINGS.md` unless otherwise stated.

---

## Context recap (audit-grounded)

The Day-2 audit (F-58, F-40) and the Day-4 review (`U4-SEC-C1` … `U4-SEC-G1`) converge on five facts
that drive every ADR below:

1. The charter mis-targets `linux/executor.py` — that file does not exist; `routes_linux.py:22-35`
   returns 501 (`U4-SEC-C1`). The actual subprocess attack surface is **four files**:
   `agent/actions/bash.py:46`, `agent/actions/net.py:23`, `agent/actions/notify.py:30`,
   `agent/mcp/adapter.py:64-72` (cited verbatim from `FINDINGS.md:308-315`).
2. `firejail` is not installed on the live Radxa kernel 6.17.1 (`U4-SEC-C2`); today's "sandbox" is a
   no-op fall-through (`agent/safety/sandbox.py:38-43`). `nsjail` not installed; Landlock LSM is
   over-scoped for Day-4.
3. `bwrap` **is** installed (`/usr/bin/bwrap`, bubblewrap 0.9.0 verified at the architect's terminal);
   kernel 6.17 supports user namespaces + cgroup v2 (`U4-SEC-H1`).
4. Three call sites leak parent env wholesale to subprocesses (`agent/actions/net.py:23`,
   `agent/actions/notify.py:30`, `agent/mcp/adapter.py:64-72` — no `env=` kwarg). `JWT_SECRET_KEY`
   (`config.py:262`) and `AI_GEMINI_API_KEY` (`config.py:57`) leak. The env-scrub design at
   `agent/actions/bash.py:36-42` is right but **only applied at `bash.run`** (`U4-SEC-H3`).
5. `agent/actions/fs.py:94` uses `os.path.abspath` not `os.path.realpath`, allowing a symlink at
   `<workspace>/escape -> /etc` to bypass the prefix check at `fs.py:97` (`U4-SEC-H4`, F-40).

---

## ADR-SBX-001 — bubblewrap as the sandbox primitive

**Decision**: `bwrap(1)` is the sole subprocess-isolation primitive. The legacy
`agent/safety/sandbox.py:15-24` `_FIREJAIL_FLAGS` constant and `wrap_shell_cmd` function are deleted
in Y-1; `firejail_available()` survives only as a stale-config detector that returns `False`.

**Rejected alternatives**:

- **firejail** — not on the Radxa target (`which firejail` empty per `FINDINGS.md:316-322`); Day-2
  D2-B-01 already flagged firejail's profile-file escape; SUID binary on a kiosk device is a worse
  attack surface than user-namespace `bwrap`.
- **nsjail** — not packaged for Radxa; depends on protobuf-compiler at build time; one more system
  dependency for negligible feature gain over `bwrap`.
- **Landlock LSM (alone)** — kernel-level path-based access control is desirable Day-6 but lacks
  network/PID/IPC isolation; not a drop-in for `bwrap`'s namespacing. Re-evaluate when
  `radio_privileged` lands.
- **`unshare(1)` alone** — cannot bind-mount RO root without `--mount-proc` gymnastics; lacks
  seccomp; lacks `--die-with-parent` (`U4-SEC-H1`).

**Canonical bwrap argv** (per profile, see ADR-SBX-002):

```
bwrap \
  --unshare-all --share-net=no \
  --die-with-parent --new-session \
  --ro-bind / / \
  --proc /proc --dev /dev \
  --tmpfs /tmp \
  --bind <ctx.workspace_dir> /workspace \
  --setenv PATH /usr/local/bin:/usr/bin:/bin \
  --
```

Memory cap: `prlimit --as=536870912 -- bwrap …` wraps the bwrap invocation (the legacy
`--rlimit-as=536870912` flag at `safety/sandbox.py:19` had no `bwrap` analogue;
`FINDINGS.md:393-394`).

**System dependency**: `bubblewrap` (apt). Documented in the `requirements.txt` header comment in Y-1
(no pip equivalent).

---

## ADR-SBX-002 — `SandboxProfile` enum + per-profile argv builder

**Decision**: Three named profiles live in `agent/safety/sandbox.py`. `wrap_argv()` returns the full
bwrap argv keyed off the profile. The enum is the public API every action and adapter consumes —
**callers never assemble bwrap flags themselves**.

```python
class SandboxProfile(Enum):
    compute = "compute"                  # bash.run, mcp.adapter — net=NO
    net_observe = "net_observe"          # network reads (whois, http GET) — net=YES, no caps
    radio_privileged = "radio_privileged"  # Day-6 only — see ADR-RAD-001
```

**Per-profile differences** (only the deltas from the canonical argv in ADR-SBX-001 are listed):

| Profile | `--share-net` | Caps | Notes |
|---|---|---|---|
| `compute` | `no` | none | Default for `bash.run`, every `mcp.adapter` tool. |
| `net_observe` | `yes` | none (still drops `CAP_NET_RAW`) | For HTTP/DNS reads from sandboxed code. NOT used by `net.scan` (see ADR-SBX-004). |
| `radio_privileged` | `yes` | retains `CAP_NET_RAW` + `CAP_NET_ADMIN` | Day-6 only — `NotImplementedError` Day-4. |

**Why a closed enum, not free-form flags**: closed profiles defeat caller drift (`U4-SEC-G1`). The
moment any caller starts hand-assembling bwrap argv, the policy surface explodes. Adding profiles is
a deliberate ADR amendment, not a parameter.

**Workspace bind path**: bind `ctx.workspace_dir` (per Y-5: `config.agent_workspace_dir`,
`config.py:334` default `~/phantom/workspace`) to `/workspace` inside the namespace. `/tmp` is fresh
tmpfs each call (`U4-SEC-M1`).

**`--unshare-pid` interaction with long-lived MCP servers**: `mcp.adapter` spawns persistent stdio
servers (`mcp/adapter.py:64-72`). Combine `--die-with-parent` + `--unshare-pid` so
`kill(wrapper_pgid)` reaps the whole PID-namespace tree (`U4-SEC-M2`).

---

## ADR-SBX-003 — `clean_env()` allowlist promoted from `bash.py`

**Decision**: The env-scrub allowlist already implemented at `agent/actions/bash.py:36-42` is the
correct shape but lives in the wrong file. Promote to `agent/safety/sandbox.py::clean_env()` and
import from **all four** subprocess sites in Y-2.

**Allowlist** (only these survive into the child env):

| Var | Source | Why kept |
|---|---|---|
| `PATH` | hard-coded `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin` | `bwrap`, `/bin/sh`, `notify-send`, `ping` resolution. |
| `HOME` | `ctx.workspace_dir` | Tools that write dotfiles (e.g. `npm`) target the workspace, not `/home/radxa`. |
| `LANG` | `C.UTF-8` | Avoid garbled output from `locale`-aware tools. |
| `LC_ALL` | `C.UTF-8` | Same. |
| `TERM` | `dumb` | Suppress ANSI escapes that confuse log capture. |

**Explicit blocklist** (audit-grade — these MUST NOT survive scrubbing even if the allowlist drifts):

`JWT_*`, `AI_*`, `PHANTOM_*`, `PYTHON*`, `LD_PRELOAD`, `LD_LIBRARY_PATH`.

`JWT_SECRET_KEY` (`config.py:262`) and `AI_GEMINI_API_KEY` (`config.py:57`) are the named leaks at
`net.py:23`, `notify.py:30`, `mcp/adapter.py:64-72` per `U4-SEC-H3` (`FINDINGS.md:342-349`).

**Implementation contract**:

```python
def clean_env() -> dict[str, str]:
    """Return a fresh env dict — five allowlisted keys only.
    Implementations MUST NOT call os.environ.copy() then pop —
    the construction is start-from-empty, additive."""
```

The "start-from-empty, additive" rule is the test's load-bearing invariant: a future contributor
adding `os.environ.copy()` is the regression to catch.

---

## ADR-SBX-004 — `net.scan` carve-out (sandboxed=False, honest)

**Problem**: `bwrap --share-net=no` breaks `net.scan` by design — the basic-mode `ping -c 1`
(`net.py:23-31`) has no route inside an isolated network namespace (`U4-SEC-H2`,
`FINDINGS.md:335-341`).

**Decision**: `net.scan` runs **OUTSIDE the sandbox** with a strict argv allow-list. No shell, no
user-controlled flags. `wrap_argv()` returns `(argv, False)` for this call site, and the audit log
**honestly** records `sandboxed=False`.

**Allowed argv shape**:

```python
["ping", "-c", "1", "-W", "1", validated_ip]
# validated_ip is the result of ipaddress.ip_address(host) round-trip
# — any input that doesn't survive that round-trip is rejected before exec.
```

`ipaddress.ip_address()` already runs at `net.py:88-92` for `mode == "ports"`. Y-3 promotes the
validation to `mode == "basic"` too, then iterates per host. **No hostname strings ever reach
`ping` argv**; only canonicalised IP literals.

**Why not `--share-net=yes` for `net.scan` instead?** Considered and rejected: ICMP raw socket needs
`CAP_NET_RAW`, which `bwrap` drops by default. Using `--cap-add CAP_NET_RAW` re-introduces a privilege
that the operator explicitly does NOT want bash actions to inherit. Splitting `net.scan` outside
keeps `compute` profile zero-cap for everything else.

**Audit-truth invariant**: every `ActionResult` from `net.scan` carries `sandboxed=False`. The
existing `ActionResult.sandboxed` field at `schemas.py:166` already supports this (no schema change
needed).

---

## ADR-SBX-005 — `notify.desktop` D-Bus carve-out

**Problem**: `notify-send` inside `--unshare-all` cannot reach the user's D-Bus session
(`U4-SEC-M3`, `FINDINGS.md:369-372`).

**Decision**: `notify.desktop` uses a `compute`-derived profile that adds **one** bind:
`--bind /run/user/$UID /run/user/$UID`. No other delta. Net stays dropped, root stays RO, all six
unshare flags stay in place. `clean_env()` still applies; the D-Bus session bus address
(`DBUS_SESSION_BUS_ADDRESS`) is reconstructed from the bind path inside the child via the standard
freedesktop fallback rule (`unix:path=/run/user/$UID/bus`).

**Day-4 trade-off (documented honestly)**: the D-Bus socket is a kernel-mediated IPC channel; an
attacker who pwns `notify-send` can call any D-Bus method the user can. We accept this for Day-4
because (a) `notify-send` argv is two static strings + two user-controlled strings that are already
length-capped at `notify.py:19-21`, and (b) the existing fallback at `notify.py:40-48` is the
WS-toast — if D-Bus fails for any reason (including bwrap rejection), the user still sees the
notification in the frontend.

**Rejected**: running `notify.desktop` fully unsandboxed. The argv has user-controlled string
content; even though the surface is small, "no sandbox at all" is strictly worse than "sandbox + one
bind".

---

## ADR-SBX-006 — F-40 realpath fix for `fs.write`

**Problem**: `agent/actions/fs.py:94` does `os.path.abspath(os.path.expanduser(self.path))`; line 97
does `path.startswith(workspace + os.sep)`. A symlink at `<workspace>/escape -> /etc` passes both
checks; `open(path, "w")` then follows the link and writes to `/etc/...` (`U4-SEC-H4`,
`FINDINGS.md:350-357`).

**Decision** (Y-4):

1. Resolve **both** `path` and `workspace` via `os.path.realpath` (not `os.path.abspath`).
2. Equality check uses `os.path.commonpath([path_real, workspace_real]) == workspace_real`. This is
   strictly stronger than `startswith(workspace + os.sep)` because `commonpath` is OS-canonicalised
   (handles trailing-slash, `..`, double-slash uniformly).
3. **Reject** any **intermediate** directory whose `os.path.realpath` differs from
   `os.path.abspath` (TOCTOU between `os.makedirs` at `fs.py:116` and `open(path, "w")` at line
   117): walk the path components from workspace down, fail closed on the first mismatch.

**Pseudocode** (architecture only — not code):

```python
def realpath_inside(path: str | Path, workspace: str | Path) -> bool:
    path_real = os.path.realpath(os.path.expanduser(str(path)))
    ws_real = os.path.realpath(os.path.expanduser(str(workspace)))
    if os.path.commonpath([path_real, ws_real]) != ws_real:
        return False
    # Walk intermediates: each component's realpath must equal its abspath.
    parts = Path(path_real).relative_to(ws_real).parts
    cur = Path(ws_real)
    for part in parts[:-1]:
        cur = cur / part
        if os.path.realpath(cur) != os.path.abspath(cur):
            return False
    return True
```

**Back-compat**: `fs.write` already returns `requires_confirm` for off-workspace writes
(`fs.py:104-113`). The fix tightens the check; behaviour for legit in-workspace writes is unchanged
(verified in test plan Y-4 below).

---

## ADR-RAD-001 — `radio_privileged` enum slot reserved (Day-6)

**Decision** (Y-6): `SandboxProfile.radio_privileged` is reserved Day-4; `wrap_argv()` raises
`NotImplementedError("radio_privileged profile lands Day-6 — see docs/architecture/sandbox-runtime.md
ADR-RAD-001")` if invoked. The skeleton is 30 LOC and exists solely so Day-6's split is purely
**additive** (no signature changes, no caller migration).

**Day-6 IPC contract (docstring-only, frozen Day-4)**:

- `radio_privileged` will spawn a **separate `phantom-radiod` user** (uid distinct from the agent
  uid).
- `phantom-radiod` listens on `/run/phantom/radiod.sock` (UNIX domain socket, mode 0660, group
  `phantom-radio`).
- The agent process calls `radiod.send(json_request)` over the socket; the daemon validates against a
  closed verb list (`bt_scan`, `wifi_scan`, `serial_open`) and returns JSON.
- Only `phantom-radiod` runs with `CAP_NET_RAW` + `CAP_NET_ADMIN`. Bash actions never inherit those
  caps (`U4-SEC-G1`, `FINDINGS.md:374-384`).

**Why reserve now, not Day-6**: charter mis-targeting (`U4-SEC-C1`) means without an explicit
`radio_privileged` slot, Day-6 will inherit `bwrap`'s `CAP_NET_*=0` permanently (`bluetoothctl`,
`iw`, `hciconfig` are CAP-gated at the kernel level — no bind-mount workaround). Carving the enum
slot Day-4 turns the Day-6 work from "rip-up" into "fill the body of one branch".

---

## Public Python interface (frozen Day-4, lives in `agent/safety/sandbox.py`)

```python
from enum import Enum
from pathlib import Path

from ..actions.base import ActionContext


class SandboxProfile(Enum):
    compute = "compute"
    net_observe = "net_observe"
    radio_privileged = "radio_privileged"


def wrap_argv(
    argv: list[str],
    profile: SandboxProfile,
    ctx: ActionContext,
) -> tuple[list[str], bool]:
    """
    Wrap a bare argv with the bwrap flags for the requested profile.

    Returns (wrapped_argv, sandboxed_actually_True).

    HONESTY CONTRACT: if bwrap is unavailable on the host (e.g. dev macOS,
    container without user-ns), returns (argv, False) WITHOUT raising. The
    caller MUST surface the False value in ActionResult.sandboxed so the
    audit log tells the truth.

    Raises NotImplementedError if profile is radio_privileged (ADR-RAD-001).
    """


def clean_env() -> dict[str, str]:
    """
    Return a fresh, allowlisted env dict for subprocess invocations.

    INVARIANT: implementation MUST NOT start from os.environ.copy(); it MUST
    construct the dict from the empty state and only add the five allowlisted
    keys. Test test_clean_env_no_leak pins this invariant.

    Allowlist: PATH, HOME, LANG, LC_ALL, TERM. See ADR-SBX-003.
    """


def realpath_inside(path: str | Path, workspace: str | Path) -> bool:
    """
    True iff `path` resolves (via os.path.realpath) under `workspace`,
    AND every intermediate directory's realpath equals its abspath
    (TOCTOU defence between makedirs and open). See ADR-SBX-006.
    """


def bubblewrap_available() -> bool:
    """shutil.which('bwrap') is not None. Cached after first call."""
```

**Caller migration map** (Y-2 + Y-3):

| Caller | Before | After |
|---|---|---|
| `agent/actions/bash.py:46` | `wrap_shell_cmd(self.cmd, self.sandboxed)` | `wrap_argv(["/bin/sh","-c",self.cmd], SandboxProfile.compute, ctx)` |
| `agent/actions/net.py:23-31` | `create_subprocess_exec("ping", ...)` raw | `wrap_argv` skipped — see ADR-SBX-004; explicit `env=clean_env()` |
| `agent/actions/notify.py:30-34` | `create_subprocess_exec("notify-send", ...)` raw | `wrap_argv(["notify-send",...], SandboxProfile.compute, ctx)` + D-Bus bind addendum (ADR-SBX-005); `env=clean_env()` |
| `agent/mcp/adapter.py:64-72` | `create_subprocess_exec(*self.command, ...)` raw | `wrap_argv(list(self.command), SandboxProfile.compute, ctx)`; `env=clean_env()` |
| `agent/actions/fs.py:94-97` | `abspath` + `startswith` | `realpath_inside(self.path, ctx.workspace_dir)` |

`ActionResult.sandboxed` (`schemas.py:166`) already exists; **no schema change**. Y-2 only flips the
boolean correctly per call site.

---

## Per-block test plan

Tests live in `src/backend/tests/agent/`. **Concrete pytest names** below — Phase-3 implementer
copies these verbatim, adds bodies.

### Y-1 — `bwrap` retarget + `SandboxProfile` + `clean_env`

- `tests/agent/safety/test_sandbox_bwrap.py`
  - `test_wrap_argv_compute_drops_net()` — assert `--share-net=no` and `--unshare-all` present.
  - `test_wrap_argv_returns_false_when_bwrap_missing(monkeypatch)` — patch
    `bubblewrap_available()` to False; assert `(argv, False)`.
  - `test_wrap_argv_radio_privileged_raises()` — `pytest.raises(NotImplementedError)`.
  - `test_clean_env_only_five_keys()` — exactly `{PATH, HOME, LANG, LC_ALL, TERM}`.
  - `test_clean_env_no_leak(monkeypatch)` — set `JWT_SECRET_KEY=secret`, `AI_GEMINI_API_KEY=k`,
    `LD_PRELOAD=evil.so` in `os.environ`; call `clean_env()`; assert NONE of those keys appear.
  - `test_bwrap_argv_includes_workspace_bind()` — assert
    `--bind <ctx.workspace_dir> /workspace` in argv.
  - `test_bwrap_argv_includes_die_with_parent_and_unshare_pid()` — both flags present (M2).

### Y-2 — `bash` + `mcp.adapter` retarget through `wrap_argv(compute)`

- `tests/agent/actions/test_bash_run_under_bwrap.py`
  - `test_bash_run_no_net_inside_sandbox()` — exec `curl http://1.1.1.1 -m 1`; assert non-zero rc.
  - `test_bash_run_workspace_visible()` — write file via `bash.run` `echo hi > /workspace/x`; assert
    file exists on host at `<ctx.workspace_dir>/x`.
  - `test_bash_run_jwt_secret_not_inherited(monkeypatch)` — `monkeypatch.setenv("JWT_SECRET_KEY",
    "leaked")`; `bash.run "echo $JWT_SECRET_KEY"`; assert stdout strips to empty/whitespace.
  - `test_bash_run_returncode_passthrough()` — `exit 7`; assert `rc == 7` (back-compat invariant).
  - `test_bash_run_timeout_kills_process()` — `sleep 60` with `timeout_s=2`; assert
    `error_class == "timeout"` (back-compat: existing escalation at `bash.py:53-67` preserved).
  - `test_bash_run_sandboxed_flag_true_when_bwrap()` — assert `result.sandboxed is True`.
  - `test_bash_run_sandboxed_flag_false_when_bwrap_missing(monkeypatch)` — assert
    `result.sandboxed is False`.
- `tests/agent/mcp/test_adapter_under_bwrap.py`
  - `test_mcp_subprocess_runs_with_clean_env()` — spawn fake MCP server that prints `os.environ`;
    assert allowlist only.
  - `test_mcp_subprocess_drops_net()` — fake server tries to open socket; expects failure.

### Y-3 — `net.scan` + `notify.desktop` carve-outs

- `tests/agent/actions/test_net_scan_outside_sandbox.py`
  - `test_net_scan_basic_validates_ip()` — `subnet="not-an-ip"` → `bad_subnet` error.
  - `test_net_scan_basic_argv_is_static_allowlist()` — patch `create_subprocess_exec`; assert exact
    argv `["ping","-c","1","-W","1",<ip>]`.
  - `test_net_scan_marks_sandboxed_false()` — assert `result.sandboxed is False`.
  - `test_net_scan_clean_env_applied()` — env passed to ping has only allowlist keys.
- `tests/agent/actions/test_notify_dbus_carveout.py`
  - `test_notify_argv_includes_dbus_bind()` — assert
    `--bind /run/user/<uid> /run/user/<uid>` present.
  - `test_notify_falls_back_to_ws_toast_on_bwrap_failure()` — mock bwrap to fail; assert
    `output["delivered_via"] == "ws_toast"` (back-compat preserved from `notify.py:40-48`).

### Y-4 — F-40 realpath fix in `fs.write`

- `tests/agent/actions/test_fs_write_realpath.py`
  - `test_fs_write_rejects_symlink_escape(tmp_path)` — create
    `tmp_path/workspace/escape -> /etc`; call `fs.write(path="<workspace>/escape/passwd")`; assert
    `error_class == "requires_confirm"`.
  - `test_fs_write_rejects_intermediate_symlink(tmp_path)` — `tmp_path/workspace/sub -> /etc`;
    `fs.write(path="<workspace>/sub/file")`; assert reject.
  - `test_fs_write_allows_real_workspace_path(tmp_path)` — happy path unchanged.
  - `test_realpath_inside_commonpath_equality()` — direct unit test of helper.
  - `test_realpath_inside_rejects_dotdot_escape(tmp_path)` —
    `realpath_inside("<workspace>/../etc", workspace)` is False.

### Y-5 — Sandbox settings surface

- `tests/api/test_settings_sandbox_keys.py`
  - `test_sandbox_profile_default_in_settings()` — `GET /api/settings` includes
    `agent_sandbox_profile_default` with default `"compute"`.
  - `test_agent_workspace_dir_in_settings()` — present, default `~/phantom/workspace`
    (matches `config.py:334`).
  - `test_sandbox_profile_default_validates_enum()` — set to `"banana"` → 422.

### Y-6 — `radio_privileged` enum reservation

- `tests/agent/safety/test_radio_reserved.py`
  - `test_radio_privileged_enum_member_exists()` —
    `SandboxProfile.radio_privileged.value == "radio_privileged"`.
  - `test_wrap_argv_radio_raises_not_implemented()` — covered also in Y-1; pinned again here.
  - `test_docstring_cites_adr_rad_001()` — `assert "ADR-RAD-001" in
    wrap_argv.__doc__` (or the radio branch's `NotImplementedError` message).

### Cross-cutting (lives in Y-1)

- `tests/agent/safety/test_sandbox_perf.py`
  - `test_wrap_argv_pure_python_under_1ms(benchmark)` — `pytest-benchmark`; argv build only
    (no exec).
  - `test_bwrap_overhead_under_30ms(benchmark)` — `bwrap … /bin/true` vs bare `/bin/true`;
    delta ≤ 30 ms median over 50 runs (see budget below).

---

## Performance budgets

| Path | Budget | Measurement |
|---|---|---|
| `wrap_argv()` pure-Python construction | ≤ 1 ms | `pytest-benchmark`; closed enum + list-concat only. |
| `bwrap` fork+exec overhead vs bare `/bin/true` | ≤ 30 ms median over 50 runs on Radxa | One-time per `bash.run` / `mcp.call_tool`. Acceptable because each action already incurs LLM round-trip latency O(seconds). |
| `clean_env()` | ≤ 100 µs | Constant-size dict literal. |
| `realpath_inside()` | ≤ 5 ms (path of depth ≤ 8) | Per-component `realpath`; fail-fast. |

If a Phase-3 implementer hits these budgets and they fail by > 2x, **stop and re-architect** — do
not paper over with caching unless the cache invalidation contract is added to a new ADR.

---

## Back-compat invariants

Every Phase-3 block (Y-1…Y-6) is **additive**. The following must remain true after Y-6 lands:

1. **`bash.run` semantics unchanged**:
   - `returncode`, `stdout`, `stderr`, `truncated` fields keep their meanings (`bash.py:88-103`).
   - `timeout_s` still bounded by `_HARD_TIMEOUT_S = 120` (`bash.py:14`).
   - Timeout escalation (`terminate` → 2 s grace → `kill`) preserved verbatim (`bash.py:53-67`,
     `FINDINGS.md:390-391`).
   - `_OUTPUT_LIMIT_BYTES = 16 * 1024` truncation preserved (`bash.py:15`).
2. **`ActionResult.sandboxed`** is **additive**: existing field at `schemas.py:166` is `bool | None`;
   Y-2 changes the value semantics from "True iff firejail wrapped" to "True iff bwrap actually
   wrapped". External consumers (frontend audit panel) read it as "was this isolated, yes/no" —
   semantic shift is backward-compatible.
3. **`fs.write` happy path** (in-workspace write to a non-symlinked path) returns the same
   `ActionResult` shape (`fs.py:130-135`). Only the rejection branch widens.
4. **`net.scan` API surface** (`subnet`, `mode`, `output["alive"]`, `output["open"]`) unchanged.
   `output["sandboxed"]` is **not** added — the flag rides on `ActionResult.sandboxed`, not in the
   `output` blob.
5. **`notify.desktop` fallback to WS toast** preserved (`notify.py:40-48`). If bwrap rejects the
   D-Bus bind for any reason, the existing fallback handles it — no UX regression.
6. **`mcp.adapter` line-protocol** (`adapter.py:91-119`) unchanged. Only the subprocess spawn at
   `:64-72` adds the `wrap_argv` + `env=clean_env()` wrapping.
7. **No new system deps via pip**. `bubblewrap` is apt-only; documented in `requirements.txt`
   header comment in Y-1 (no `requirements.txt` line item).

---

## Audit-finding closure matrix

| Finding | Closed by ADR | Closed by Block |
|---|---|---|
| F-58 (Day-2) — net subprocess bypasses sandbox | SBX-002 + SBX-003 | Y-2, Y-3 |
| F-40 (Day-2) — fs.write `abspath` not `realpath` | SBX-006 | Y-4 |
| U4-SEC-C1 — Block Y mis-targets non-existent file | SBX-002 (renames target to four real call sites) | Y-1 + Y-2 + Y-3 |
| U4-SEC-C2 — firejail unavailable on Radxa | SBX-001 (drop firejail) | Y-1 |
| U4-SEC-H1 — bwrap is correct primitive | SBX-001 | Y-1 |
| U4-SEC-H2 — drop-net breaks net.scan | SBX-004 | Y-3 |
| U4-SEC-H3 — env scrubbing half-done | SBX-003 | Y-2 + Y-3 |
| U4-SEC-H4 — `fs.py:94` realpath fix | SBX-006 | Y-4 |
| U4-SEC-M1 — workspace bind not ephemeral | SBX-002 (bind `agent_workspace_dir`) | Y-1 + Y-5 |
| U4-SEC-M2 — `--die-with-parent` + long-lived MCP | SBX-002 (adds `--unshare-pid`) | Y-1 + Y-2 |
| U4-SEC-M3 — D-Bus unreachable for `notify-send` | SBX-005 | Y-3 |
| U4-SEC-G1 — Day-6 BT/Wi-Fi split harder | RAD-001 (enum slot reserved) | Y-6 |

---

## Open questions deferred (NOT Day-4 scope)

- Per-action seccomp filters (e.g. `bash.run` could deny `ptrace`, `clone(CLONE_NEWUSER)` in nested
  bwrap). Requires a structured BPF policy DSL — Day-7+.
- Cgroup v2 memory accounting via `bwrap --cgroup-fd` instead of `prlimit --as`. The cgroup approach
  is cleaner but requires the parent process to be in its own cgroup; defer until lifecycle ADR.
- Whether `mcp.adapter` long-lived servers should run under `compute` or a new `mcp_persistent`
  profile that keeps stdin open across many `call_tool` invocations. Out of scope for Day-4 — the
  current `compute` profile + `--die-with-parent` works because the MCP server is one process per
  client lifetime.

---

**End of `docs/architecture/sandbox-runtime.md`.** Phase-3 blocks Y-1…Y-6 may proceed.
