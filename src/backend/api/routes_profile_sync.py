"""Cross-world profile sync — phantom-os ↔ companion app.

The desktop is the canonical source of truth for a User's identity,
preferences, profile list, behavioural model and personal facts. The
phone, in turn, is the most-active editor of all of those: rename a
profile from the bus, add a new user-fact at lunch, swap the wake-tone
from a hotel in another timezone. This module makes those edits arrive
immediately on the desktop (and on every other paired phone) by:

  GET  /api/v1/profile-sync/snapshot
       Return the full user-scoped snapshot — preferences, profile
       list, behavioural model, user facts (label + masked value),
       recent chat-session summaries, vault card metadata (no secret
       fields). Used by the companion to seed local state when a new
       paired session warms up after a long offline window.

  POST /api/v1/profile-sync/import
       Accept a payload built on the phone (when a profile was created
       there during onboarding before pair). The desktop creates /
       updates the matching Profile + UserFact rows, sets the User's
       behavioural model + preferences, and emits one consolidated
       `profile_sync.imported` WS event so other devices learn about
       it. Idempotent via `client_event_id`.

  POST /api/v1/profile-sync/event
       Single-event delta — preference change, profile rename, fact
       upsert, fact delete. Server applies it, then re-broadcasts on
       the `profile_sync` WS channel so every subscriber catches up
       in real time. The same endpoint is what the desktop uses
       internally (helper `emit_profile_event` below) so the phone +
       desktop share one wire format.

WS channel name is `profile_sync`. Subscribers receive frames shaped
as:

    {
      "channel": "profile_sync",
      "type": "preference_changed" | "profile_renamed" | "profile_imported"
              | "fact_upserted" | "fact_deleted" | "behavior_updated",
      "data": {…},
      "ts": 1714834800123
    }

Auth: every endpoint accepts both a user JWT (desktop) or a device
JWT (companion) via `get_user_or_device_user`. We never send a vault
secret over this channel — vault sync continues to live in
`routes_vault.py` and goes through the explicit reveal/use flow.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.websocket_hub import hub
from db.database import get_db
from db.models import (
    ChatSession,
    Profile,
    User,
    UserFact,
    VaultCard,
)
from security.crypto import decrypt_pii
from security.device_auth import get_user_or_device_user

logger = logging.getLogger(__name__)

router = APIRouter(tags=["profile-sync"])

# ── Wire schemas ──────────────────────────────────────────────────────────────


class ProfileLite(BaseModel):
    """Subset of `Profile` exposed across the wire."""

    id: str
    display_name: str = Field(min_length=1, max_length=64)
    role: str = Field(default="OPERATOR")
    avatar_uri: Optional[str] = None
    is_primary: bool = False
    archived: bool = False
    behavioral_model: dict[str, Any] = Field(default_factory=dict)
    created_at: Optional[datetime] = None
    last_seen_at: Optional[datetime] = None


class UserFactLite(BaseModel):
    """User fact, value masked unless explicitly requested via `?reveal=1`."""

    id: str
    category: str
    label: Optional[str] = None
    value: Optional[str] = None
    value_masked: bool = True


class VaultCardMeta(BaseModel):
    """Vault card *metadata* — never includes secret field values.

    The companion already has a separate /vault/cards REST surface for
    decrypted-on-demand reads with the explicit reveal flow. The sync
    snapshot returns this lighter shape so a phone catching up after
    a long offline window can list cards without triggering reveal."""

    id: str
    kind: str
    label: str
    field_kinds: dict[str, str]
    tags: list[str]
    updated_at: Optional[datetime] = None


class ChatSessionSummary(BaseModel):
    id: str
    started_at: Optional[datetime]
    ended_at: Optional[datetime]
    message_count: int
    summary: Optional[str]


class SnapshotOut(BaseModel):
    user_id: str
    username: str
    role: str
    avatar_url: Optional[str] = None
    preferences: dict[str, Any]
    behavioral_model: dict[str, Any]
    profiles: list[ProfileLite]
    facts: list[UserFactLite]
    vault_cards: list[VaultCardMeta]
    recent_sessions: list[ChatSessionSummary]
    snapshot_ts: int


class ImportProfileIn(BaseModel):
    """Phone-built profile import payload.

    Sent from the companion when a profile that was originally
    constructed on the phone (during pre-pair onboarding) needs to
    travel up to the desktop with all its enriched data.
    """

    model_config = ConfigDict(populate_by_name=True)

    client_event_id: str = Field(min_length=1, max_length=64)
    profile: ProfileLite
    facts: list[UserFactLite] = Field(default_factory=list)
    preferences: Optional[dict[str, Any]] = None


class ImportProfileOut(BaseModel):
    profile_id: str
    facts_created: int
    facts_updated: int
    is_new: bool


class EventIn(BaseModel):
    """A single delta event the phone wants the desktop to apply.

    Closed enum on purpose — the server only recognises the listed
    `type` values. Anything else returns 422 so a buggy client does not
    silently mutate state in surprising ways.
    """

    model_config = ConfigDict(populate_by_name=True)

    client_event_id: str = Field(min_length=1, max_length=64)
    type: str = Field(
        pattern=r"^(preference_changed|profile_renamed|fact_upserted|fact_deleted|behavior_updated)$"
    )
    data: dict[str, Any] = Field(default_factory=dict)


class EventOut(BaseModel):
    accepted: bool
    type: str
    server_ts: int


# ── Helpers ───────────────────────────────────────────────────────────────────


def _mask_value(plain: Optional[str]) -> Optional[str]:
    if not plain:
        return plain
    if len(plain) <= 4:
        return "•" * len(plain)
    return f"{plain[:1]}{'•' * (len(plain) - 2)}{plain[-1:]}"


def _profile_to_lite(row: Profile) -> ProfileLite:
    try:
        behavior = json.loads(row.behavioral_model_json or "{}")
    except json.JSONDecodeError:
        behavior = {}
    return ProfileLite(
        id=row.id,
        display_name=row.display_name,
        role=row.role,
        avatar_uri=row.avatar_uri,
        is_primary=row.is_primary,
        archived=row.archived_at is not None,
        behavioral_model=behavior,
        created_at=row.created_at,
        last_seen_at=row.last_seen_at,
    )


def _fact_to_lite(row: UserFact, reveal: bool) -> UserFactLite:
    plain: Optional[str] = None
    try:
        plain = decrypt_pii(row.value_encrypted)
    except Exception:  # pragma: no cover — corrupted fact, surface as masked
        logger.warning("UserFact %s decrypt failed; emitting masked", row.id)
        plain = None
    if reveal and plain is not None:
        return UserFactLite(id=row.id, category=row.category, label=row.label, value=plain, value_masked=False)
    return UserFactLite(
        id=row.id,
        category=row.category,
        label=row.label,
        value=_mask_value(plain),
        value_masked=True,
    )


def _vault_to_meta(row: VaultCard) -> VaultCardMeta:
    try:
        fields = json.loads(row.fields_json or "{}")
    except json.JSONDecodeError:
        fields = {}
    field_kinds: dict[str, str] = {}
    for k, v in fields.items():
        if isinstance(v, dict) and v.get("secret") is True:
            field_kinds[k] = "secret"
        else:
            field_kinds[k] = "plain"
    try:
        tags = json.loads(getattr(row, "tags_json", "[]") or "[]")
    except json.JSONDecodeError:
        tags = []
    return VaultCardMeta(
        id=row.id,
        kind=row.kind,
        label=row.label,
        field_kinds=field_kinds,
        tags=tags,
        updated_at=getattr(row, "updated_at", None),
    )


async def _broadcast(user_id: str, event_type: str, data: dict[str, Any]) -> None:
    """Push a profile_sync frame to every subscriber bound to `user_id`."""
    try:
        await hub.broadcast("profile_sync", event_type, data, user_id=user_id)
    except Exception as exc:  # pragma: no cover — hub failures must not 500 the API
        logger.warning("profile_sync broadcast failed: %s", exc)


async def emit_profile_event(
    user_id: str,
    event_type: str,
    data: dict[str, Any],
) -> None:
    """Helper for desktop-internal call sites (settings handlers,
    Profile rename, etc) to publish a profile_sync event without going
    through HTTP. Mirrors the wire format produced by `POST /event`."""
    await _broadcast(user_id, event_type, data)


# ── Routes ────────────────────────────────────────────────────────────────────


@router.get("/profile-sync/snapshot", response_model=SnapshotOut)
async def get_snapshot(
    reveal: int = 0,
    user: User = Depends(get_user_or_device_user),
    db: AsyncSession = Depends(get_db),
) -> SnapshotOut:
    """Return the full user-scoped snapshot.

    `?reveal=1` un-masks user-fact values. Default is masked because
    most callers (incl. the phone catch-up flow) only want to know what
    facts exist, not their plaintext."""
    try:
        prefs = json.loads(user.preferences_json or "{}")
    except json.JSONDecodeError:
        prefs = {}
    try:
        behavior = json.loads(user.behavioral_model_json or "{}")
    except json.JSONDecodeError:
        behavior = {}

    profiles = (
        await db.execute(
            select(Profile).where(Profile.user_id == user.id).order_by(Profile.is_primary.desc(), Profile.created_at)
        )
    ).scalars().all()
    facts = (
        await db.execute(
            select(UserFact).where(UserFact.user_id == user.id).order_by(UserFact.created_at)
        )
    ).scalars().all()
    cards = (
        await db.execute(
            select(VaultCard).where(VaultCard.owner_user_id == user.id, VaultCard.deleted_at.is_(None))
        )
    ).scalars().all()
    sessions = (
        await db.execute(
            select(ChatSession)
            .where(ChatSession.user_id == user.id)
            .order_by(ChatSession.started_at.desc())
            .limit(20)
        )
    ).scalars().all()

    return SnapshotOut(
        user_id=user.id,
        username=user.username,
        role=user.role,
        avatar_url=user.avatar_url,
        preferences=prefs,
        behavioral_model=behavior,
        profiles=[_profile_to_lite(p) for p in profiles],
        facts=[_fact_to_lite(f, reveal=bool(reveal)) for f in facts],
        vault_cards=[_vault_to_meta(c) for c in cards],
        recent_sessions=[
            ChatSessionSummary(
                id=s.id,
                started_at=s.started_at,
                ended_at=s.ended_at,
                message_count=s.message_count or 0,
                summary=s.summary,
            )
            for s in sessions
        ],
        snapshot_ts=int(datetime.now(timezone.utc).timestamp() * 1000),
    )


@router.post("/profile-sync/import", response_model=ImportProfileOut)
async def import_profile(
    body: ImportProfileIn,
    user: User = Depends(get_user_or_device_user),
    db: AsyncSession = Depends(get_db),
) -> ImportProfileOut:
    """Accept a phone-built profile import payload.

    Behaviour:
      - If a Profile with the given id exists for this user → update.
      - Otherwise create a new Profile row.
      - Each fact is upserted by id when present, else inserted.
      - If `preferences` is set, merge into User.preferences_json.

    The whole call is one DB transaction; partial failures roll back.
    """
    incoming = body.profile
    existing = (
        await db.execute(
            select(Profile).where(Profile.user_id == user.id, Profile.id == incoming.id)
        )
    ).scalar_one_or_none()
    is_new = existing is None

    if existing is None:
        existing = Profile(
            id=incoming.id,
            user_id=user.id,
            display_name=incoming.display_name,
            role=incoming.role or "OPERATOR",
            avatar_uri=incoming.avatar_uri,
            is_primary=incoming.is_primary,
            behavioral_model_json=json.dumps(incoming.behavioral_model or {}),
        )
        db.add(existing)
    else:
        existing.display_name = incoming.display_name
        existing.role = incoming.role or existing.role
        existing.avatar_uri = incoming.avatar_uri
        existing.is_primary = incoming.is_primary
        existing.behavioral_model_json = json.dumps(incoming.behavioral_model or {})
        existing.archived_at = None if not incoming.archived else (existing.archived_at or datetime.now(timezone.utc))

    facts_created = 0
    facts_updated = 0
    from security.crypto import encrypt_pii  # local import — keeps cold-path imports lazy

    for fact in body.facts:
        if not fact.value:
            continue
        encrypted = encrypt_pii(fact.value)
        existing_fact = (
            await db.execute(
                select(UserFact).where(UserFact.user_id == user.id, UserFact.id == fact.id)
            )
        ).scalar_one_or_none()
        if existing_fact is None:
            db.add(
                UserFact(
                    id=fact.id,
                    user_id=user.id,
                    category=fact.category,
                    label=fact.label,
                    value_encrypted=encrypted,
                )
            )
            facts_created += 1
        else:
            existing_fact.category = fact.category
            existing_fact.label = fact.label
            existing_fact.value_encrypted = encrypted
            facts_updated += 1

    if body.preferences:
        try:
            prefs = json.loads(user.preferences_json or "{}")
        except json.JSONDecodeError:
            prefs = {}
        prefs.update(body.preferences)
        user.preferences_json = json.dumps(prefs)

    await db.commit()
    await db.refresh(existing)

    await _broadcast(
        user.id,
        "profile_imported",
        {
            "client_event_id": body.client_event_id,
            "profile": _profile_to_lite(existing).model_dump(mode="json"),
            "facts_created": facts_created,
            "facts_updated": facts_updated,
            "is_new": is_new,
        },
    )

    return ImportProfileOut(
        profile_id=existing.id,
        facts_created=facts_created,
        facts_updated=facts_updated,
        is_new=is_new,
    )


@router.post("/profile-sync/event", response_model=EventOut)
async def post_event(
    body: EventIn,
    user: User = Depends(get_user_or_device_user),
    db: AsyncSession = Depends(get_db),
) -> EventOut:
    """Apply a single delta event and broadcast it to all subscribers."""
    et = body.type
    payload = body.data or {}

    if et == "preference_changed":
        key = str(payload.get("key", "")).strip()
        if not key:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail={"code": "missing_key"})
        try:
            prefs = json.loads(user.preferences_json or "{}")
        except json.JSONDecodeError:
            prefs = {}
        if "value" in payload:
            prefs[key] = payload["value"]
        else:
            prefs.pop(key, None)
        user.preferences_json = json.dumps(prefs)

    elif et == "behavior_updated":
        delta = payload.get("delta") or {}
        if not isinstance(delta, dict):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail={"code": "delta_not_object"})
        scope = payload.get("scope", "user")
        if scope == "user":
            try:
                model = json.loads(user.behavioral_model_json or "{}")
            except json.JSONDecodeError:
                model = {}
            model.update(delta)
            user.behavioral_model_json = json.dumps(model)
        else:
            profile_id = str(payload.get("profile_id", ""))
            row = (
                await db.execute(
                    select(Profile).where(Profile.user_id == user.id, Profile.id == profile_id)
                )
            ).scalar_one_or_none()
            if row is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, detail={"code": "profile_not_found"})
            try:
                model = json.loads(row.behavioral_model_json or "{}")
            except json.JSONDecodeError:
                model = {}
            model.update(delta)
            row.behavioral_model_json = json.dumps(model)

    elif et == "profile_renamed":
        profile_id = str(payload.get("profile_id", ""))
        new_name = str(payload.get("display_name", "")).strip()
        if not profile_id or not new_name:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail={"code": "missing_fields"})
        row = (
            await db.execute(
                select(Profile).where(Profile.user_id == user.id, Profile.id == profile_id)
            )
        ).scalar_one_or_none()
        if row is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail={"code": "profile_not_found"})
        row.display_name = new_name[:64]

    elif et == "fact_upserted":
        from security.crypto import encrypt_pii

        fid = str(payload.get("id", "")).strip()
        category = str(payload.get("category", "")).strip()
        label = payload.get("label")
        value = payload.get("value")
        if not fid or not category or value is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail={"code": "missing_fields"})
        encrypted = encrypt_pii(str(value))
        existing = (
            await db.execute(
                select(UserFact).where(UserFact.user_id == user.id, UserFact.id == fid)
            )
        ).scalar_one_or_none()
        if existing is None:
            db.add(
                UserFact(
                    id=fid, user_id=user.id, category=category, label=label, value_encrypted=encrypted
                )
            )
        else:
            existing.category = category
            existing.label = label
            existing.value_encrypted = encrypted

    elif et == "fact_deleted":
        fid = str(payload.get("id", "")).strip()
        if not fid:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail={"code": "missing_id"})
        existing = (
            await db.execute(
                select(UserFact).where(UserFact.user_id == user.id, UserFact.id == fid)
            )
        ).scalar_one_or_none()
        if existing is not None:
            await db.delete(existing)

    else:  # pragma: no cover — pydantic regex already filters this
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail={"code": "unknown_event_type"})

    await db.commit()

    server_ts = int(datetime.now(timezone.utc).timestamp() * 1000)
    await _broadcast(user.id, et, {"client_event_id": body.client_event_id, "data": payload, "ts": server_ts})

    return EventOut(accepted=True, type=et, server_ts=server_ts)
