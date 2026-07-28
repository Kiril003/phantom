"""
Multi-tenancy context manager, row-level isolation helpers, and tenant state management for SaaS enterprise deployment.
"""
from __future__ import annotations

import contextvars
import logging
from contextlib import contextmanager
from typing import Any, Generator, Optional
from sqlalchemy import Select

logger = logging.getLogger(__name__)

# Context variable tracking active tenant ID per async task execution context
_CURRENT_TENANT_ID: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "current_tenant_id", default="default_tenant"
)


def get_current_tenant_id() -> str:
    """Return the active tenant_id for current context, defaulting to 'default_tenant'."""
    return _CURRENT_TENANT_ID.get() or "default_tenant"


def set_current_tenant_id(tenant_id: str) -> contextvars.Token[Optional[str]]:
    """Set active tenant_id for current context."""
    return _CURRENT_TENANT_ID.set(tenant_id)


def reset_current_tenant_id(token: contextvars.Token[Optional[str]]) -> None:
    """Reset tenant_id context variable using provided token."""
    _CURRENT_TENANT_ID.reset(token)


@contextmanager
def tenant_context(tenant_id: str) -> Generator[str, None, None]:
    """Context manager to execute code within a specific tenant context."""
    token = set_current_tenant_id(tenant_id)
    try:
        yield tenant_id
    finally:
        reset_current_tenant_id(token)


def apply_tenant_filter(query: Select, model_cls: Any) -> Select:
    """
    Apply automatic row-level tenant isolation filter to SQLAlchemy Select query.
    If the model contains a `tenant_id` attribute, appends `tenant_id == current_tenant_id`.
    """
    if hasattr(model_cls, "tenant_id"):
        current_tenant = get_current_tenant_id()
        return query.where(model_cls.tenant_id == current_tenant)
    return query
