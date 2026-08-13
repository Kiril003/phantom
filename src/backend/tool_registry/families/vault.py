"""Vault family — secret CRUD.

``vault_reveal`` is the only HIGH-gate read here: it returns plaintext.
"""
from __future__ import annotations

from ..spec import ToolSpec, family_specs

TOOLS: list[ToolSpec] = family_specs([
    "vault_list",
    "vault_get",
    "vault_create",
    "vault_update",
    "vault_delete",
    "vault_restore",
    "vault_reveal",
])

__all__ = ["TOOLS"]
