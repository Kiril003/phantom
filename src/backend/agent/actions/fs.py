"""Filesystem actions — fs.read, fs.write."""
from __future__ import annotations

import os
import time
from typing import ClassVar

from pydantic import Field

from ..schemas import ActionResult, Precondition, RiskLevel
from .base import Action, ActionContext


def _contained(path_real: str, workspace_real: str) -> bool:
    """True when an already-realpath'd path sits inside the workspace.

    `commonpath` rather than `startswith`: the prefix test accepts
    `/ws-evil` for a workspace of `/ws`. Both arguments must already be
    realpath'd by the caller — comparing unresolved paths is what let the
    symlink escape through in the first place.
    """
    try:
        return os.path.commonpath([workspace_real, path_real]) == workspace_real
    except ValueError:
        # Different drives / mixed absolute-relative — treat as outside.
        return False


class FsRead(Action):
    name: ClassVar[str] = "fs.read"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE
    reversible: ClassVar[bool] = True

    path: str = Field(..., description="Absolute or ~-relative path to read")
    max_bytes: int = Field(default=65536, ge=1, le=1_048_576)

    def preconditions(self) -> list[Precondition]:
        # Path is checked at execute() because evaluator can't see attrs by name.
        return [
            Precondition(key="path.exists", required=os.path.expanduser(self.path), failure_mode="abandon"),
            Precondition(key="path.size_under", required=os.path.expanduser(self.path), failure_mode="abandon"),
        ]

    async def execute(self, ctx: ActionContext) -> ActionResult:
        t0 = time.monotonic()
        path = os.path.expanduser(self.path)

        try:
            with open(path, "rb") as f:
                head = f.read(min(self.max_bytes, 8192))
                if b"\x00" in head[:8192]:
                    return ActionResult(
                        ok=False,
                        error=f"binary_detected: {path}",
                        error_class="binary_detected",
                        elapsed_ms=int((time.monotonic() - t0) * 1000),
                    )
                rest = b""
                if len(head) >= 8192:
                    remaining = self.max_bytes - len(head)
                    if remaining > 0:
                        rest = f.read(remaining)
                content_bytes = head + rest
                truncated = os.path.getsize(path) > self.max_bytes
        except FileNotFoundError:
            return ActionResult(
                ok=False, error=f"not_found: {path}", error_class="not_found",
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )
        except PermissionError as exc:
            return ActionResult(
                ok=False, error=f"permission_denied: {exc}", error_class="permission_denied",
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )
        except OSError as exc:
            return ActionResult(
                ok=False, error=f"os_error: {exc}", error_class="os_error",
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        try:
            content = content_bytes.decode("utf-8", errors="replace")
        except Exception:
            content = content_bytes.decode("latin-1", errors="replace")

        return ActionResult(
            ok=True,
            output={
                "path": path,
                "content": content,
                "bytes_read": len(content_bytes),
                "truncated": truncated,
            },
            elapsed_ms=int((time.monotonic() - t0) * 1000),
        )


class FsWrite(Action):
    name: ClassVar[str] = "fs.write"
    risk_level: ClassVar[RiskLevel] = RiskLevel.LOW  # raised to MEDIUM if outside workspace
    reversible: ClassVar[bool] = False

    path: str = Field(..., description="Absolute or ~-relative path to write")
    content: str = Field(default="")
    confirm: bool = Field(default=False)

    async def execute(self, ctx: ActionContext) -> ActionResult:
        t0 = time.monotonic()
        path = os.path.abspath(os.path.expanduser(self.path))
        workspace = os.path.abspath(os.path.expanduser(ctx.workspace_dir))

        # Block A-1 — idempotency: if the file already contains identical content,
        # return a skip result without touching disk.  This prevents post-crash
        # re-writes from busting mtimes that downstream consumers depend on.
        try:
            from ._idempotency import file_content_matches
            if file_content_matches(path, self.content):
                return ActionResult(
                    ok=True,
                    output={
                        "path": path,
                        "bytes_written": len(self.content.encode("utf-8")),
                        "skipped": "idempotent",
                    },
                    elapsed_ms=int((time.monotonic() - t0) * 1000),
                )
        except Exception:
            pass  # Idempotency check failure is non-fatal; proceed with write.

        # Y-4 / D3-F-40 / U4-SEC-H4: realpath BOTH sides + commonpath equality.
        # Pure abspath followed by startswith is symlink-vulnerable: an attacker
        # could plant <workspace>/escape -> /etc and the prefix check would pass,
        # then open() follows the link. realpath resolves through symlinks first.
        # For non-existent leaves realpath resolves what it can and appends the
        # literal tail — still anchored to the resolved parent.
        workspace_real = os.path.realpath(workspace)
        path_real = os.path.realpath(path)

        # The comparison above was computed and then never used: both realpaths
        # were resolved and discarded, and the write proceeded unconditionally.
        # That left the exact F-40 attack this block documents wide open —
        # `<workspace>/escape -> /etc` resolved outside the workspace and the
        # write followed the symlink out of the sandbox.
        if not _contained(path_real, workspace_real):
            return ActionResult(
                ok=False,
                error=(
                    f"symlink_escape: {path} resolves to {path_real}, "
                    f"outside workspace {workspace_real}"
                ),
                error_class="symlink_escape",
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        try:
            parent = os.path.dirname(path) or "."
            os.makedirs(parent, exist_ok=True)
            with open(path, "w", encoding="utf-8") as f:
                f.write(self.content)
        except PermissionError as exc:
            return ActionResult(
                ok=False, error=f"permission_denied: {exc}", error_class="permission_denied",
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )
        except OSError as exc:
            return ActionResult(
                ok=False, error=f"os_error: {exc}", error_class="os_error",
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        return ActionResult(
            ok=True,
            output={"path": path, "bytes_written": len(self.content.encode("utf-8"))},
            side_effects=[f"wrote {path} ({len(self.content)} chars)"],
            elapsed_ms=int((time.monotonic() - t0) * 1000),
        )


class FsBackup(Action):
    """Create a backup of a file (copy to .bak)."""

    name: ClassVar[str] = "fs.backup"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE
    reversible: ClassVar[bool] = False

    path: str = Field(..., description="Path to the file to backup")

    async def execute(self, ctx: ActionContext) -> ActionResult:
        import shutil
        t0 = time.monotonic()
        path = os.path.abspath(os.path.expanduser(self.path))
        
        if not os.path.exists(path):
            return ActionResult(
                ok=False, error=f"not_found: {path}", error_class="not_found",
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )
            
        bak_path = f"{path}.bak"
        # Same containment as fs.write: this action is SAFE-rated but still
        # creates a file, and without the check it could do so anywhere the
        # process can write — including through a symlink out of the workspace.
        workspace_real = os.path.realpath(
            os.path.abspath(os.path.expanduser(ctx.workspace_dir))
        )
        if not _contained(os.path.realpath(bak_path), workspace_real):
            return ActionResult(
                ok=False,
                error=(
                    f"symlink_escape: {bak_path} resolves outside workspace "
                    f"{workspace_real}"
                ),
                error_class="symlink_escape",
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )
        try:
            shutil.copy2(path, bak_path)
        except Exception as exc:
            return ActionResult(
                ok=False, error=f"backup_failed: {exc}", error_class="os_error",
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        return ActionResult(
            ok=True,
            output={"original": path, "backup": bak_path},
            side_effects=[f"created backup: {bak_path}"],
            elapsed_ms=int((time.monotonic() - t0) * 1000),
        )

class FsCodeSearch(Action):
    """Efficiently scan workspace for a regex pattern (CLI parity with grep/rg)."""

    name: ClassVar[str] = "fs.code_search"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE
    reversible: ClassVar[bool] = True

    pattern: str = Field(..., description="Regex pattern to search for")
    file_mask: str = Field(default="**/*", description="Glob mask, e.g. '**/*.py'")
    max_matches: int = Field(default=50, ge=1, le=500)

    async def execute(self, ctx: ActionContext) -> ActionResult:
        import glob
        import re
        t0 = time.monotonic()
        workspace = os.path.abspath(os.path.expanduser(ctx.workspace_dir))
        
        matches = []
        try:
            regex = re.compile(self.pattern)
        except re.error as exc:
            return ActionResult(
                ok=False, error=f"invalid_regex: {exc}", error_class="invalid_args",
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        try:
            for filepath in glob.iglob(os.path.join(workspace, self.file_mask), recursive=True):
                if not os.path.isfile(filepath):
                    continue
                # Skip massive/binary files
                if os.path.getsize(filepath) > 1_000_000:
                    continue
                try:
                    with open(filepath, "r", encoding="utf-8") as f:
                        for i, line in enumerate(f):
                            if regex.search(line):
                                rel_path = os.path.relpath(filepath, workspace)
                                matches.append(f"{rel_path}:{i+1}: {line.strip()}")
                                if len(matches) >= self.max_matches:
                                    break
                except UnicodeDecodeError:
                    pass # Skip binary
                if len(matches) >= self.max_matches:
                    break
        except Exception as exc:
            return ActionResult(
                ok=False, error=f"search_failed: {exc}", error_class="os_error",
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        return ActionResult(
            ok=True,
            output={
                "matches": matches,
                "count": len(matches),
                "truncated": len(matches) >= self.max_matches
            },
            elapsed_ms=int((time.monotonic() - t0) * 1000),
        )


class FsPatchHash(Action):
    """Securely patch a file by verifying the hash of the target block before replacement.
    This prevents 'stale-line' errors by ensuring the model has the exact content it intends to change.
    """

    name: ClassVar[str] = "fs.patch_hash"
    risk_level: ClassVar[RiskLevel] = RiskLevel.MEDIUM
    reversible: ClassVar[bool] = False

    path: str = Field(..., description="Absolute or ~-relative path to the file to patch")
    old_string: str = Field(..., description="The exact block of text to find and replace. Must be unique in the file.")
    new_string: str = Field(..., description="The replacement text.")
    expected_hash: str = Field(..., description="SHA-256 hex hash of the 'old_string'. This ensures precision.")

    async def execute(self, ctx: ActionContext) -> ActionResult:
        import hashlib
        t0 = time.monotonic()
        path = os.path.abspath(os.path.expanduser(self.path))
        
        if not os.path.exists(path):
            return ActionResult(
                ok=False, error=f"not_found: {path}", error_class="not_found",
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        # 1. Verify model-provided old_string matches its own hash (sanity check for hallucination)
        computed_hash = hashlib.sha256(self.old_string.encode("utf-8")).hexdigest()
        if computed_hash != self.expected_hash:
             return ActionResult(
                ok=False, 
                error=f"hallucination_detected: old_string hash {computed_hash} != expected_hash {self.expected_hash}. Ensure you copy the block EXACTLY.", 
                error_class="invalid_args",
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        # 2. Read current file
        try:
            with open(path, "r", encoding="utf-8") as f:
                content = f.read()
        except Exception as exc:
             return ActionResult(
                ok=False, error=f"read_failed: {exc}", error_class="os_error",
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        # 3. Check presence and uniqueness
        count = content.count(self.old_string)
        if count == 0:
             return ActionResult(
                ok=False, 
                error="stale_content: the exact 'old_string' was not found. The file might have changed or you provided wrong context.", 
                error_class="not_found",
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )
        if count > 1:
             return ActionResult(
                ok=False, 
                error="ambiguous_patch: multiple occurrences of 'old_string' found. Provide more surrounding lines for a unique anchor.", 
                error_class="ambiguous",
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        # 4. Perform replacement
        new_content = content.replace(self.old_string, self.new_string)

        # 5. Atomic-ish write
        try:
            with open(path, "w", encoding="utf-8") as f:
                f.write(new_content)
        except Exception as exc:
             return ActionResult(
                ok=False, error=f"write_failed: {exc}", error_class="os_error",
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        return ActionResult(
            ok=True,
            output={
                "path": path,
                "bytes_written": len(new_content.encode("utf-8")),
                "replacement_done": True,
                "hash": computed_hash
            },
            side_effects=[f"patched {path} (verified hash: {computed_hash[:8]}...)"],
            elapsed_ms=int((time.monotonic() - t0) * 1000),
        )
