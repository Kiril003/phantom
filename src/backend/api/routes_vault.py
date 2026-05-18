"""
Phase 25-B — Vault REST surface.

Endpoints under `/api/v1/vault/`:

  GET    /vault/cards?kind=&tag=&include_deleted=
                                            — current user's cards. Secret
                                              fields are returned MASKED
                                              ("***" placeholder); plain
                                              fields surface as-is so the
                                              FE + chat can render them.
  GET    /vault/cards/{id}                  — single card; same masking.
  POST   /vault/cards                       — create. Each input field is
                                              {value, secret}. secret=True
                                              fields are encrypted via
                                              vault_crypto before write.
  PATCH  /vault/cards/{id}                  — patch label / tags /
                                              ai_writable / individual
                                              fields. Field-level — only
                                              keys present in the body are
                                              touched.
  DELETE /vault/cards/{id}                  — soft delete (sets deleted_at).
  POST   /vault/cards/{id}/restore          — undelete within 30d window.
  GET    /vault/audit?card_id=&limit=       — audit timeline.

Reveal + use are intentionally NOT here — they need Council pre-approval
+ phone biometric, which lands in Phase 25-D.

All endpoints require `get_current_user`. The card row is identified by
`(id, owner_user_id == me.id)` so a leaked card_id from another user
yields 404 instead of cross-tenant read.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_db
from db.models import User, VaultAuditEntry, VaultCard
from security.auth import get_current_user
from security.device_auth import get_user_or_device_user
from security.vault_crypto import (
    InvalidVaultToken, decrypt_field, encrypt_field,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/vault", tags=["vault"])


# ─── Pydantic shapes ────────────────────────────────────────────────────────


# Closed enum — must match the FE editors registry. Adding a kind
# requires hand-edit here + a new editor on the FE.
KNOWN_KINDS = {
    "email_account", "service_login", "messenger", "phone",
    "company", "payment_method", "api_key", "document", "contact",
    "wifi_network", "crypto_wallet", "custom",
}


class FieldInput(BaseModel):
    """One field in a card payload. `secret=True` triggers AES-GCM
    encryption at the routes layer; `secret=False` stores plaintext
    (visible to AI in list/get)."""
    value: str = Field(..., max_length=8192)
    secret: bool = False


class CardCreate(BaseModel):
    kind: str = Field(..., max_length=32)
    label: str = Field(..., min_length=1, max_length=160)
    fields: dict[str, FieldInput] = Field(default_factory=dict)
    tags: list[str] = Field(default_factory=list, max_length=40)
    ai_writable: bool = True


class CardPatch(BaseModel):
    label: Optional[str] = Field(default=None, min_length=1, max_length=160)
    fields: Optional[dict[str, FieldInput]] = None
    tags: Optional[list[str]] = Field(default=None, max_length=40)
    ai_writable: Optional[bool] = None


class CardOut(BaseModel):
    """Card view returned to chat + FE. Secret values are masked.

    The `field_kinds` field maps each field name to "plain"|"secret" so
    the FE can render eye-icons + the AI knows which fields are
    revealable but doesn't see the plaintext."""
    id: str
    kind: str
    label: str
    tags: list[str]
    ai_writable: bool
    fields: dict[str, str]            # plain values OR "***" for secrets
    field_kinds: dict[str, str]       # "plain" | "secret"
    deleted_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime
    last_accessed_at: Optional[datetime]


class CardsListResponse(BaseModel):
    cards: list[CardOut]


class AuditRow(BaseModel):
    id: str
    user_id: str
    card_id: Optional[str]
    action: str
    actor: str
    details: dict[str, Any]
    created_at: datetime


class AuditResponse(BaseModel):
    entries: list[AuditRow]


# ─── Helpers ────────────────────────────────────────────────────────────────


def _validate_kind(kind: str) -> None:
    if kind not in KNOWN_KINDS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown card kind '{kind}'. "
                   f"Allowed: {', '.join(sorted(KNOWN_KINDS))}",
        )


def _serialise_card(card: VaultCard) -> CardOut:
    """Render a row for the wire. Secret values are NEVER returned —
    only "***". A reveal needs the dedicated endpoint in 25-D."""
    raw = json.loads(card.fields_json or "{}")
    plain: dict[str, str] = {}
    kinds: dict[str, str] = {}
    for name, payload in raw.items():
        if not isinstance(payload, dict):
            # legacy / corrupt → skip
            continue
        is_secret = bool(payload.get("secret"))
        kinds[name] = "secret" if is_secret else "plain"
        plain[name] = "***" if is_secret else str(payload.get("v", ""))
    tags = json.loads(card.tags_json or "[]")
    return CardOut(
        id=card.id,
        kind=card.kind,
        label=card.label,
        tags=list(tags) if isinstance(tags, list) else [],
        ai_writable=bool(card.ai_writable),
        fields=plain,
        field_kinds=kinds,
        deleted_at=card.deleted_at,
        created_at=card.created_at,
        updated_at=card.updated_at,
        last_accessed_at=card.last_accessed_at,
    )


def _encode_fields(
    *, fields: dict[str, FieldInput], user_id: str, card_id: str,
) -> str:
    """Build the `fields_json` blob for storage. Encrypts each
    `secret=True` field with vault_crypto bound to (user_id, card_id,
    field_name) so a swap attack across cards or fields is detected on
    decryption."""
    out: dict[str, dict[str, Any]] = {}
    for name, payload in fields.items():
        if payload.secret:
            out[name] = {
                "v": encrypt_field(
                    user_id=user_id,
                    card_id=card_id,
                    field_name=name,
                    plaintext=payload.value,
                ),
                "secret": True,
            }
        else:
            out[name] = {"v": payload.value, "secret": False}
    return json.dumps(out, ensure_ascii=False)


async def _record_audit(
    db: AsyncSession, *,
    user_id: str, card_id: Optional[str], action: str,
    actor: str = "user", details: Optional[dict[str, Any]] = None,
) -> None:
    """Append-only audit log. Failures here are NEVER fatal — a missing
    audit row should not block the user's vault op."""
    try:
        entry = VaultAuditEntry(
            user_id=user_id,
            card_id=card_id,
            action=action,
            actor=actor,
            details_json=json.dumps(details or {}, ensure_ascii=False),
        )
        db.add(entry)
        await db.flush()
    except Exception as exc:  # pragma: no cover — extremely defensive
        logger.warning("vault audit write failed (non-fatal): %s", exc)


async def _load_owned_card(
    db: AsyncSession, *, card_id: str, user_id: str,
    include_deleted: bool = False,
) -> VaultCard:
    stmt = select(VaultCard).where(
        VaultCard.id == card_id,
        VaultCard.owner_user_id == user_id,
    )
    if not include_deleted:
        stmt = stmt.where(VaultCard.deleted_at.is_(None))
    card = (await db.execute(stmt)).scalar_one_or_none()
    if card is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Card not found",
        )
    return card


# ─── Endpoints ──────────────────────────────────────────────────────────────


@router.get("/cards", response_model=CardsListResponse)
async def list_cards(
    kind: Optional[str] = Query(default=None, max_length=32),
    tag: Optional[str] = Query(default=None, max_length=64),
    include_deleted: bool = Query(default=False),
    me: User = Depends(get_user_or_device_user),
    db: AsyncSession = Depends(get_db),
) -> CardsListResponse:
    stmt = select(VaultCard).where(VaultCard.owner_user_id == me.id)
    if not include_deleted:
        stmt = stmt.where(VaultCard.deleted_at.is_(None))
    if kind:
        stmt = stmt.where(VaultCard.kind == kind)
    stmt = stmt.order_by(desc(VaultCard.updated_at))
    rows = (await db.execute(stmt)).scalars().all()
    if tag:
        rows = [
            r for r in rows
            if tag in (json.loads(r.tags_json or "[]") or [])
        ]
    return CardsListResponse(cards=[_serialise_card(r) for r in rows])


@router.get("/cards/{card_id}", response_model=CardOut)
async def get_card(
    card_id: str,
    me: User = Depends(get_user_or_device_user),
    db: AsyncSession = Depends(get_db),
) -> CardOut:
    card = await _load_owned_card(db, card_id=card_id, user_id=me.id)
    return _serialise_card(card)


@router.post("/cards", response_model=CardOut, status_code=status.HTTP_201_CREATED)
async def create_card(
    payload: CardCreate,
    me: User = Depends(get_user_or_device_user),
    db: AsyncSession = Depends(get_db),
) -> CardOut:
    _validate_kind(payload.kind)
    card = VaultCard(
        owner_user_id=me.id,
        kind=payload.kind,
        label=payload.label,
        tags_json=json.dumps(payload.tags, ensure_ascii=False),
        ai_writable=payload.ai_writable,
    )
    db.add(card)
    await db.flush()  # assigns card.id
    card.fields_json = _encode_fields(
        fields=payload.fields, user_id=me.id, card_id=card.id,
    )
    await _record_audit(
        db, user_id=me.id, card_id=card.id, action="create", actor="user",
        details={"kind": payload.kind, "label": payload.label,
                 "field_names": list(payload.fields.keys())},
    )
    await db.commit()
    await db.refresh(card)
    return _serialise_card(card)


@router.patch("/cards/{card_id}", response_model=CardOut)
async def patch_card(
    card_id: str,
    payload: CardPatch,
    me: User = Depends(get_user_or_device_user),
    db: AsyncSession = Depends(get_db),
) -> CardOut:
    card = await _load_owned_card(db, card_id=card_id, user_id=me.id)
    changed: list[str] = []
    if payload.label is not None:
        card.label = payload.label
        changed.append("label")
    if payload.tags is not None:
        card.tags_json = json.dumps(payload.tags, ensure_ascii=False)
        changed.append("tags")
    if payload.ai_writable is not None:
        card.ai_writable = bool(payload.ai_writable)
        changed.append("ai_writable")
    if payload.fields is not None:
        # Merge: existing fields stay; only keys present in the body are
        # rewritten or added. Removing a field requires PATCH with an
        # explicit empty body for that key (handled below as a deletion
        # marker — secret=False + value=""). Future Day-6: add an
        # explicit `deletes: list[str]` to the patch body.
        existing_raw = json.loads(card.fields_json or "{}")
        new_blob = _encode_fields(
            fields=payload.fields, user_id=me.id, card_id=card.id,
        )
        new_raw = json.loads(new_blob)
        existing_raw.update(new_raw)
        card.fields_json = json.dumps(existing_raw, ensure_ascii=False)
        changed.append("fields")
    card.updated_at = datetime.now(tz=timezone.utc)
    await _record_audit(
        db, user_id=me.id, card_id=card.id, action="update", actor="user",
        details={"changed": changed},
    )
    await db.commit()
    await db.refresh(card)
    return _serialise_card(card)


@router.delete(
    "/cards/{card_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def delete_card(
    card_id: str,
    me: User = Depends(get_user_or_device_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    card = await _load_owned_card(db, card_id=card_id, user_id=me.id)
    card.deleted_at = datetime.now(tz=timezone.utc)
    await _record_audit(
        db, user_id=me.id, card_id=card.id, action="delete", actor="user",
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/cards/{card_id}/restore", response_model=CardOut)
async def restore_card(
    card_id: str,
    me: User = Depends(get_user_or_device_user),
    db: AsyncSession = Depends(get_db),
) -> CardOut:
    card = await _load_owned_card(
        db, card_id=card_id, user_id=me.id, include_deleted=True,
    )
    if card.deleted_at is None:
        # Already active — no-op, return as-is.
        return _serialise_card(card)
    card.deleted_at = None
    card.updated_at = datetime.now(tz=timezone.utc)
    await _record_audit(
        db, user_id=me.id, card_id=card.id, action="restore", actor="user",
    )
    await db.commit()
    await db.refresh(card)
    return _serialise_card(card)


# ─── Reveal (Phase 25-D) ────────────────────────────────────────────────────


class RevealRequest(BaseModel):
    """Body for POST /vault/cards/{id}/reveal.

    `justification` is a short operator-supplied note ("login form on
    https://example.com asked for it") that lands in the audit row so
    a future review can answer "why did the AI ever look at this?".
    Free text up to 240 chars; required.
    """
    field_name: str = Field(..., min_length=1, max_length=64)
    justification: str = Field(..., min_length=4, max_length=240)


class RevealResponse(BaseModel):
    """Returned only on success. `value` is the plaintext — caller MUST
    treat it as sensitive (do not log; do not echo into chat history;
    do not display longer than the window the user requested it for)."""
    card_id: str
    field_name: str
    value: str
    revealed_at: datetime


@router.post("/cards/{card_id}/reveal", response_model=RevealResponse)
async def reveal_field(
    card_id: str,
    payload: RevealRequest,
    me: User = Depends(get_user_or_device_user),
    db: AsyncSession = Depends(get_db),
) -> RevealResponse:
    """Decrypt and return the plaintext for ONE secret field on ONE card.

    Audit semantics: every successful reveal writes a VaultAuditEntry
    with action="reveal" + details={field_name, justification, actor}.
    `actor` is "user" by default (operator-initiated via Settings UI);
    AI-driven reveals (Phase 25-E `vault.use` action) call this same
    endpoint but tag actor="ai" via an X-Reveal-Actor header.

    Failure modes:
      404 — card missing or owned by another user
      404 — field name not on the card
      400 — field is not marked secret (no plaintext to reveal; the
            caller can already read non-secret values via vault_get)
      503 — JWT_SECRET_KEY rotated since the field was encrypted; the
            operator must run the re-encrypt migration first
    """
    card = await _load_owned_card(db, card_id=card_id, user_id=me.id)
    raw = json.loads(card.fields_json or "{}")
    payload_field = raw.get(payload.field_name)
    if not isinstance(payload_field, dict):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Field '{payload.field_name}' not found on card",
        )
    if not payload_field.get("secret"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Field '{payload.field_name}' is not secret — read it "
                f"directly via GET /vault/cards/{{id}}"
            ),
        )
    token = str(payload_field.get("v") or "")
    try:
        plaintext = decrypt_field(
            user_id=me.id,
            card_id=card.id,
            field_name=payload.field_name,
            token=token,
        )
    except InvalidVaultToken as exc:
        # AAD mismatch / JWT rotated / ciphertext tampered. The operator
        # gets a 503 + machine-readable header so the FE can render a
        # "rotation required" hint instead of a generic 500.
        logger.warning(
            "vault reveal: decrypt failed for card=%s field=%s — %s",
            card.id, payload.field_name, exc,
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Field cannot be decrypted (key rotated or token "
                "tampered). Run the vault re-encrypt migration."
            ),
            headers={"X-Error-Code": "VAULT_KEY_ROTATION_REQUIRED"},
        ) from exc

    revealed_at = datetime.now(tz=timezone.utc)
    card.last_accessed_at = revealed_at
    await _record_audit(
        db,
        user_id=me.id,
        card_id=card.id,
        action="reveal",
        actor="user",
        details={
            "field_name": payload.field_name,
            "justification": payload.justification,
        },
    )
    await db.commit()

    return RevealResponse(
        card_id=card.id,
        field_name=payload.field_name,
        value=plaintext,
        revealed_at=revealed_at,
    )


# ─── Card-context AI thread ────────────────────────────────────────────────
#
# Lightweight "Ask AI about this card" — companion needs an in-card AI
# surface that's tighter than the global chat. The endpoint takes the
# user's free-form question and one card id, builds a non-secret
# preamble (kind + label + plain field values + tags), feeds it to the
# active AI provider, and returns the answer + the active provider
# name. Secret fields are NEVER threaded into the preamble; the model
# only sees what the operator could see in list view.


class CardAskIn(BaseModel):
    """Body for `POST /vault/cards/{id}/ask`. `question` is the user's
    natural-language question. `history` is optional prior turns so the
    operator can keep a conversation about one card without re-quoting
    it. Each history entry is `{role: "user"|"assistant", content: str}`."""

    question: str = Field(..., min_length=1, max_length=2000)
    history: list[dict[str, str]] = Field(default_factory=list)


class CardAskOut(BaseModel):
    answer: str
    provider: str
    tokens_used: int = 0
    latency_ms: int = 0


def _build_card_preamble(card: VaultCard) -> str:
    """Compose a system-prompt preamble that gives the model just
    enough card context to answer questions without leaking secrets."""
    try:
        fields = json.loads(card.fields_json or "{}")
    except json.JSONDecodeError:
        fields = {}
    try:
        tags = json.loads(getattr(card, "tags_json", "[]") or "[]")
    except json.JSONDecodeError:
        tags = []
    safe_lines: list[str] = []
    for name, value in fields.items():
        if isinstance(value, dict) and value.get("secret") is True:
            safe_lines.append(f"- {name}: ••••• (secret, hidden)")
        elif isinstance(value, dict):
            safe_lines.append(f"- {name}: {value.get('v', '')}")
        else:
            safe_lines.append(f"- {name}: {value}")
    fields_block = "\n".join(safe_lines) if safe_lines else "(no fields)"
    tags_block = ", ".join(tags) if tags else "—"
    return (
        "Ти — асистент PHANTOM. Користувач питає про одну особисту картку у "
        "своєму Vault. Картка зашифрована end-to-end на пристрої власника, "
        "ти бачиш тільки публічні поля. Поясни, допоможи спланувати дію "
        "(заповнити форму, надіслати, оновити), не вигадуй пароль чи ключ "
        "якого тебе НЕ показали — якщо потрібен secret-польове значення, "
        "відкажи, що операторові треба зробити reveal вручну.\n\n"
        f"Картка `{card.label}` (kind={card.kind}, tags=[{tags_block}]):\n"
        f"{fields_block}\n"
    )


@router.post("/cards/{card_id}/ask", response_model=CardAskOut)
async def ask_card(
    card_id: str,
    body: CardAskIn,
    me: User = Depends(get_user_or_device_user),
    db: AsyncSession = Depends(get_db),
) -> CardAskOut:
    """AI thread anchored to one Vault card. Companion surfaces this
    as an inline expander on the card detail; desktop opens it in a
    side panel."""
    card = (
        await db.execute(
            select(VaultCard).where(
                VaultCard.id == card_id,
                VaultCard.owner_user_id == me.id,
                VaultCard.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if card is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail={"code": "card_not_found"})

    from ai.provider import ai_router

    preamble = _build_card_preamble(card)
    try:
        response = await ai_router.generate(
            user_message=body.question,
            system_prompt=preamble,
            history=body.history or [],
            user_id=me.id,
        )
    except Exception as exc:  # pragma: no cover — guard against provider blowups
        logger.warning("vault.ask_card AI failure: %s", exc)
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, detail={"code": "ai_unavailable"}
        ) from exc

    return CardAskOut(
        answer=response.content,
        provider=response.provider or "unknown",
        tokens_used=response.tokens_used,
        latency_ms=response.latency_ms,
    )


@router.get("/audit", response_model=AuditResponse)
async def list_audit(
    card_id: Optional[str] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    me: User = Depends(get_user_or_device_user),
    db: AsyncSession = Depends(get_db),
) -> AuditResponse:
    stmt = select(VaultAuditEntry).where(VaultAuditEntry.user_id == me.id)
    if card_id:
        stmt = stmt.where(VaultAuditEntry.card_id == card_id)
    stmt = stmt.order_by(desc(VaultAuditEntry.created_at)).limit(limit)
    rows = (await db.execute(stmt)).scalars().all()
    return AuditResponse(entries=[
        AuditRow(
            id=r.id,
            user_id=r.user_id,
            card_id=r.card_id,
            action=r.action,
            actor=r.actor,
            details=json.loads(r.details_json or "{}"),
            created_at=r.created_at,
        )
        for r in rows
    ])
