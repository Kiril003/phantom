"""Day-4 Wave-2 FACTS-1 — `/users/{user_id}/facts` CRUD routes
(ADR-FCT-001..004).

Five endpoints under the existing /api/v1 prefix:

  POST   /users/{user_id}/facts         — ROOT only.       audit row.
  GET    /users/{user_id}/facts         — self-or-ROOT.    no audit.
  GET    /users/{user_id}/facts/{id}    — self-or-ROOT.    no audit.
  PUT    /users/{user_id}/facts/{id}    — ROOT only.       audit row.
  DELETE /users/{user_id}/facts/{id}    — ROOT only.       audit row.

Self-or-ROOT reads let a GUEST user fetch their own profile facts
(so the chat client can render the identity-card scene W-2 panel)
without pivoting to other users — closes U6-ID-G1.

Plaintext is NEVER persisted: every value is encrypted via
`security.crypto.encrypt_pii` (Fernet from CRYPTO-1) before reaching
the DB. The Pydantic `FactRow` decrypts at read time so callers see
plaintext but the audit log + DB store ciphertext only.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_db
from db.models import User, UserFact
from security.crypto import InvalidToken, decrypt_pii, encrypt_pii
from security.permissions import require_root, require_self_or_root

logger = logging.getLogger(__name__)

router = APIRouter(tags=["user_facts"])


# Closed enum mirrors db.models.FactCategory (string column for SQLite
# friendliness). Adding a category requires a hand-edit here + ADR
# amendment.
FactCategory = Literal["email", "phone", "telegram", "discord", "file_pointer"]


# ──────────────────────────────────────────────────── Pydantic shapes ──


class FactCreate(BaseModel):
    category: FactCategory
    value: str = Field(..., min_length=1, max_length=512)
    label: Optional[str] = Field(default=None, max_length=128)


class FactUpdate(BaseModel):
    """Either field optional — caller can rotate value-only or relabel-only."""

    value: Optional[str] = Field(default=None, min_length=1, max_length=512)
    label: Optional[str] = Field(default=None, max_length=128)


class FactRow(BaseModel):
    id: str
    user_id: str
    category: FactCategory
    label: Optional[str]
    value: str  # decrypted at read time
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_orm_row(cls, row: UserFact) -> "FactRow":
        try:
            plaintext = decrypt_pii(row.value_encrypted)
        except InvalidToken:
            # Defensive: a corrupt token (e.g. key rotated without
            # re-encrypt) surfaces as "[corrupt]" so the operator
            # spots the row in the UI without a 500.
            logger.warning(
                "FACTS-1: UserFact id=%s value_encrypted is unreadable "
                "(InvalidToken). Returning '[corrupt]' placeholder.",
                row.id,
            )
            plaintext = "[corrupt]"
        return cls(
            id=row.id,
            user_id=row.user_id,
            category=row.category,  # type: ignore[arg-type]
            label=row.label,
            value=plaintext,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )


class FactsListResponse(BaseModel):
    facts: list[FactRow]
    total: int = Field(..., ge=0)


# ──────────────────────────────────────────────────────── audit helper ──


async def _emit_audit_row(
    db: AsyncSession,
    *,
    actor_user_id: str,
    target_user_id: str,
    action: Literal["fact.created", "fact.updated", "fact.deleted"],
    fact_id: str,
    category: str,
) -> None:
    """Best-effort audit emission. Never crashes the route — a missing
    AgentAuditEntry table (e.g. a fresh test DB) just no-ops with a
    DEBUG log."""
    try:
        from db.models import AgentAuditEntry  # noqa: PLC0415

        entry = AgentAuditEntry(
            action_name="user_fact",
            args_json=json.dumps(
                {
                    "operation": action,
                    "actor_user_id": actor_user_id,
                    "target_user_id": target_user_id,
                    "fact_id": fact_id,
                    "category": category,
                }
            ),
            ok=True,
        )
        db.add(entry)
        await db.flush()
    except Exception as exc:  # noqa: BLE001
        logger.debug(
            "FACTS-1 audit emission skipped (%s): %s", action, exc
        )


# ─────────────────────────────────────────────────────────── routes ──


@router.post("/users/{user_id}/facts", response_model=FactRow, status_code=201)
async def create_fact(
    body: FactCreate,
    user_id: str,
    current_user: User = Depends(require_root),
    db: AsyncSession = Depends(get_db),
) -> FactRow:
    """ROOT-only. Encrypts the value via Fernet before persisting."""
    # Confirm target user exists; 404 keeps the failure mode honest.
    target = (
        await db.execute(select(User).where(User.id == user_id))
    ).scalar_one_or_none()
    if target is None:
        raise HTTPException(status_code=404, detail="user not found")

    fact = UserFact(
        user_id=user_id,
        category=body.category,
        label=body.label,
        value_encrypted=encrypt_pii(body.value),
    )
    db.add(fact)
    await db.flush()  # populate fact.id
    await _emit_audit_row(
        db,
        actor_user_id=current_user.id,
        target_user_id=user_id,
        action="fact.created",
        fact_id=fact.id,
        category=body.category,
    )
    await db.commit()
    await db.refresh(fact)
    return FactRow.from_orm_row(fact)


@router.get("/users/{user_id}/facts", response_model=FactsListResponse)
async def list_facts(
    user_id: str,
    _: User = Depends(require_self_or_root),
    db: AsyncSession = Depends(get_db),
) -> FactsListResponse:
    rows = (
        await db.execute(
            select(UserFact).where(UserFact.user_id == user_id).order_by(UserFact.created_at)
        )
    ).scalars().all()
    facts = [FactRow.from_orm_row(r) for r in rows]
    return FactsListResponse(facts=facts, total=len(facts))


@router.get(
    "/users/{user_id}/facts/{fact_id}", response_model=FactRow
)
async def get_fact(
    user_id: str,
    fact_id: str,
    _: User = Depends(require_self_or_root),
    db: AsyncSession = Depends(get_db),
) -> FactRow:
    row = (
        await db.execute(
            select(UserFact).where(
                UserFact.id == fact_id, UserFact.user_id == user_id
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="fact not found")
    return FactRow.from_orm_row(row)


@router.put("/users/{user_id}/facts/{fact_id}", response_model=FactRow)
async def update_fact(
    body: FactUpdate,
    user_id: str,
    fact_id: str,
    current_user: User = Depends(require_root),
    db: AsyncSession = Depends(get_db),
) -> FactRow:
    """ROOT-only. Either field optional — value-only rotate OR
    relabel-only OR both."""
    if body.value is None and body.label is None:
        raise HTTPException(
            status_code=400,
            detail="PUT body must provide value or label",
        )
    row = (
        await db.execute(
            select(UserFact).where(
                UserFact.id == fact_id, UserFact.user_id == user_id
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="fact not found")
    if body.value is not None:
        row.value_encrypted = encrypt_pii(body.value)
    if body.label is not None:
        row.label = body.label
    await _emit_audit_row(
        db,
        actor_user_id=current_user.id,
        target_user_id=user_id,
        action="fact.updated",
        fact_id=row.id,
        category=row.category,
    )
    await db.commit()
    await db.refresh(row)
    return FactRow.from_orm_row(row)


@router.delete(
    "/users/{user_id}/facts/{fact_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
)
async def delete_fact(
    user_id: str,
    fact_id: str,
    current_user: User = Depends(require_root),
    db: AsyncSession = Depends(get_db),
) -> None:
    row = (
        await db.execute(
            select(UserFact).where(
                UserFact.id == fact_id, UserFact.user_id == user_id
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="fact not found")
    cat = row.category
    await db.delete(row)
    await _emit_audit_row(
        db,
        actor_user_id=current_user.id,
        target_user_id=user_id,
        action="fact.deleted",
        fact_id=fact_id,
        category=cat,
    )
    await db.commit()
    return None
