"""Filesystem actions — fs.read, fs.write."""
from __future__ import annotations

import os
import time
from typing import ClassVar

from pydantic import Field

from ..schemas import ActionResult, Precondition, RiskLevel
from .base import Action, ActionContext


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

        # Y-4 / D3-F-40 / U4-SEC-H4: realpath BOTH sides + commonpath equality.
        # Pure abspath followed by startswith is symlink-vulnerable: an attacker
        # could plant <workspace>/escape -> /etc and the prefix check would pass,
        # then open() follows the link. realpath resolves through symlinks first.
        # For non-existent leaves realpath resolves what it can and appends the
        # literal tail — still anchored to the resolved parent.
        workspace_real = os.path.realpath(workspace)
        path_real = os.path.realpath(path)
        try:
            common = os.path.commonpath([path_real, workspace_real])
        except ValueError:
            common = ""
        in_workspace = path_real == workspace_real or common == workspace_real

        # SECURITY: LLM-supplied confirm always overridden to False — only the
        # workspace check determines whether the write proceeds without
        # explicit user-side approval. This is the hard rule from the spec.
        confirm_effective = False  # noqa: F841 — kept for explicit reasoning

        if not in_workspace:
            return ActionResult(
                ok=False,
                error=(
                    f"requires_confirm: refusing to write outside workspace ({workspace_real}). "
                    f"Pick a path under the workspace or ask the user."
                ),
                error_class="requires_confirm",
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        try:
            parent = os.path.dirname(path) or "."
            os.makedirs(parent, exist_ok=True)
            # Y-4: re-check parent realpath after makedirs to catch an attacker
            # who swapped an intermediate dir to a symlink between our first
            # realpath() and now (TOCTOU). Bulletproof closure would require
            # O_NOFOLLOW per path component (openat dance) — Day-4 ships this
            # narrower mitigation; the residual race is documented.
            parent_real = os.path.realpath(parent)
            try:
                parent_common = os.path.commonpath([parent_real, workspace_real])
            except ValueError:
                parent_common = ""
            if parent_common != workspace_real and parent_real != workspace_real:
                return ActionResult(
                    ok=False,
                    error=(
                        f"symlink_escape: parent {parent_real!r} resolved outside "
                        f"workspace {workspace_real!r} after makedirs"
                    ),
                    error_class="symlink_escape",
                    elapsed_ms=int((time.monotonic() - t0) * 1000),
                )
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
