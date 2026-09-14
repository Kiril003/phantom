"""
Authentication routes — RFID login, PIN login, JWT refresh, user management.
"""
from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, not_, select
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_db
from db.models import User
from security.auth import (
    authenticate_pin,
    authenticate_rfid,
    get_current_user,
    hash_secret,
    is_default_pin,
    is_loopback_host,
    require_auth,
    verify_secret,
)
from security.client_ip import resolve_client_ip
from security.device_auth import get_user_or_device_user
from security.jwt_manager import TokenPayload, create_token, refresh_token as jwt_refresh
from security.permissions import require_operator, require_root

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])


# 2026-05-03 — UX cap for the pre-login profile grid. The 1024×600
# panel fits ~12 tiles before the grid wraps off-screen and the PIN
# pad becomes unreachable. See `list_users_picker` for the rationale.
_PICKER_MAX_TILES = 12


# ── Pydantic schemas ───────────────────────────────────────────────────────────

def _user_to_dict(user: User) -> dict[str, Any]:
    prefs: dict = {}
    try:
        prefs = json.loads(user.preferences_json)
    except Exception:
        pass
    bm: dict = {}
    try:
        bm = json.loads(user.behavioral_model_json)
    except Exception:
        pass
    return {
        "id": user.id,
        "username": user.username,
        "role": user.role,
        "avatar_url": user.avatar_url,
        "has_rfid": user.rfid_uid_hash is not None,
        "has_pin": user.pin_hash is not None,
        "created_at": user.created_at.isoformat(),
        "last_seen_at": user.last_seen_at.isoformat(),
        "preferences": prefs,
        "behavioral_model": bm,
    }


class RFIDLoginRequest(BaseModel):
    uid: str = Field(..., description="Raw RFID UID string (e.g. 'AB:CD:EF:01')")


class PINLoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    pin: str = Field(..., min_length=1, max_length=32)


class ClaimRequest(BaseModel):
    """Перший запуск: людина називає себе і ставить СВІЙ PIN."""

    display_name: str = Field(..., min_length=1, max_length=64)
    pin: str = Field(..., min_length=4, max_length=12)


class AuthResponse(BaseModel):
    user: dict
    token: str
    expires_at: str


class RefreshResponse(BaseModel):
    token: str
    expires_at: str


class CreateUserRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    role: str = Field("GUEST", pattern="^(ROOT|OPERATOR|GUEST)$")
    pin: Optional[str] = Field(None, min_length=1, max_length=32)
    rfid_uid: Optional[str] = None


class UpdateUserRequest(BaseModel):
    avatar_url: Optional[str] = None
    pin: Optional[str] = None
    rfid_uid: Optional[str] = None
    preferences: Optional[dict] = None


class SetRoleRequest(BaseModel):
    role: str = Field(..., pattern="^(ROOT|OPERATOR|GUEST)$")


# ── Helpers ────────────────────────────────────────────────────────────────────

async def _touch_last_seen(db: AsyncSession, user: User) -> None:
    user.last_seen_at = datetime.now(tz=timezone.utc)  # type: ignore[assignment]
    try:
        await db.commit()
    except Exception:
        logger.warning("Failed to update last_seen_at for user %s", user.id)
        await db.rollback()


# ── Auth routes ────────────────────────────────────────────────────────────────

# ── Day-2 F-15 — login lockout enforcement ────────────────────────────────────
#
# Two keys are tracked independently so neither IP-rotation NOR username-
# spray bypass the gate. The IP key uses the X-Forwarded-For-aware
# `request.client.host` fallback chain; behind a trusted reverse proxy
# the operator sets ``security_trust_xff`` (existing config knob) so
# the right value lands here.


# Day-3 D3-A-2 XFF-aware resolution now lives in ``security/client_ip.py`` so
# the SaaS rate limiter keys callers exactly the same way this gate does. The
# module-local alias keeps the historical import path working.
_resolve_client_ip = resolve_client_ip


def _ip_key(request: Request) -> str:
    return f"ip:{_resolve_client_ip(request)}"


def _user_key(username: str) -> str:
    return f"user:{(username or '').strip().lower()}"


def _lockout_response(remaining_s: int) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail=(
            f"Too many failed login attempts. Try again in "
            f"{max(1, remaining_s)} s."
        ),
        headers={
            "Retry-After": str(max(1, remaining_s)),
            "X-Error-Code": "LOCKED_OUT",
        },
    )


@router.post("/login/rfid", response_model=AuthResponse)
async def login_rfid(
    req: RFIDLoginRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> AuthResponse:
    """Authenticate using raw RFID UID. Verifies against stored bcrypt hash."""
    from security import login_lockout

    ip_key = _ip_key(request)
    locked, remaining = login_lockout.is_locked(ip_key)
    if locked:
        raise _lockout_response(remaining)

    user = await authenticate_rfid(db, req.uid)
    if user is None:
        login_lockout.register_failure(ip_key)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unknown RFID",
            headers={"X-Error-Code": "RFID_UNKNOWN"},
        )
    login_lockout.register_success(ip_key)
    token, expires_at = create_token(user.id, user.username, user.role)
    await _touch_last_seen(db, user)
    response.set_cookie(
        "phantom_token", token,
        httponly=True, samesite="lax",
        max_age=config_session_timeout_s(),
    )
    return AuthResponse(user=_user_to_dict(user), token=token, expires_at=expires_at)


@router.post("/login/pin", response_model=AuthResponse)
async def login_pin(
    req: PINLoginRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> AuthResponse:
    """Authenticate using username + PIN."""
    from security import login_lockout

    ip_key = _ip_key(request)
    user_key = _user_key(req.username)
    for key in (ip_key, user_key):
        locked, remaining = login_lockout.is_locked(key)
        if locked:
            raise _lockout_response(remaining)

    user = await authenticate_pin(db, req.username, req.pin)
    if user is None:
        # Record on BOTH keys so an attacker can't dodge by switching
        # IPs (username gate fires) or by spraying usernames (IP gate
        # fires).
        login_lockout.register_failure(ip_key)
        login_lockout.register_failure(user_key)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or PIN",
            headers={"X-Error-Code": "PIN_INVALID"},
        )
    # Day-3 D3-A-1: bootstrap default-PIN login is loopback-only.
    # `phantom`/`000000` MUST NOT be reachable from a remote host even
    # though the underlying password hash matches — operator rotates
    # via the console, then remote login resumes. D3-A-2 makes this
    # reverse-proxy-aware: resolved IP (post-XFF) is what we judge.
    client_host = _resolve_client_ip(request)
    if is_default_pin(user.pin_hash) and not is_loopback_host(client_host):
        login_lockout.register_failure(ip_key)
        login_lockout.register_failure(user_key)
        logger.warning(
            "Default-PIN login refused from %r (user=%s) — rotate via "
            "console before allowing remote login.",
            client_host, user.username,
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Bootstrap default PIN cannot be used from a remote "
                "host. Rotate via console first."
            ),
            headers={"X-Error-Code": "PIN_DEFAULT_REMOTE_FORBIDDEN"},
        )
    login_lockout.register_success(ip_key)
    login_lockout.register_success(user_key)
    token, expires_at = create_token(user.id, user.username, user.role)
    await _touch_last_seen(db, user)
    response.set_cookie(
        "phantom_token", token,
        httponly=True, samesite="lax",
        max_age=config_session_timeout_s(),
    )
    return AuthResponse(user=_user_to_dict(user), token=token, expires_at=expires_at)


# Тут був `POST /auth/quick-join` — «швидкий вхід для десктопа й демо-стенда
# без складної реєстрації». Знято 29.08.2026, бо він робив екран входу з ПІНом
# декоративним. Три діри в одному обробнику:
#   1. ім'я `kiril`/`root`/`admin` (і будь-яке перше на порожній базі) давало
#      роль ROOT без пароля й без ключа;
#   2. наявний користувач із НЕПРАВИЛЬНИМ ПІНом усе одно входив — перевірка
#      була, але вердикт її ігнорував: `logger.warning(... "continuing")`, і
#      виконання тривало до видачі токена;
#   3. без `pin` у тілі звірки не було взагалі.
# Тобто будь-хто, хто дотягнувся до порту, входив ким завгодно. Прикривала лише
# прив'язка до петлі — а весь сенс вузла в тому, щоб бути досяжним із телефона.
#
# Знято ЦІЛКОМ, а не прикрито автентифікацією: маршрут, що лишився б у
# поверхні, наступного разу знову втратив би замок. Викликів не було — у фронті
# лежала невживана обгортка `api.quickJoin`, її прибрано разом.
# Сторож: tests/test_quick_join_is_not_a_way_past_the_pin.py


@router.get("/bootstrap")
async def bootstrap_state(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Чи цей вузол ще нічий — тобто чи перший запуск не завершено.

    **Вада, заради якої це існує.** Пакована збірка заводить власника
    `phantom` сама і мінтить йому випадковий шестизначний PIN. Той PIN
    лягає у файл `identity/bootstrap_pin` (на Windows це
    `%LOCALAPPDATA%\\PHANTOM-OS\\PHANTOM\\…`) і друкується в журнал
    запуску. У портативного застосунку немає ані консолі, ані причини
    здогадатись про цей шлях — тож людина, яка щойно розпакувала архів,
    бачить запит PIN, якого ніде не існує для неї. Це не «забув пароль»,
    це замок без ключа з коробки: застосунок неможливо відкрити взагалі.

    Сам PIN звідси НЕ повертається і не повертатиметься. Замість
    «покажи мені секрет» тут «двері ще не замкнено» — а замкнути їх
    своїм PIN дає [claim_bootstrap] нижче. Секрет, якого не віддають,
    не можна ані підслухати, ані лишити в журналі проксі.
    """
    from security.auth import read_bootstrap_pin

    client_host = _resolve_client_ip(request)
    if not is_loopback_host(client_host):
        # Не 403: чужому взагалі не варто знати, що такий стан буває.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    result = await db.execute(select(User).where(User.username == "phantom"))
    owner = result.scalars().first()
    unclaimed = (
        owner is not None
        and read_bootstrap_pin() is not None
        and is_default_pin(owner.pin_hash)
    )
    return {"unclaimed": unclaimed}


@router.post("/bootstrap/claim", response_model=AuthResponse)
async def claim_bootstrap(
    req: ClaimRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> AuthResponse:
    """Перший запуск: людина заводить СЕБЕ — ім'я і власний PIN.

    Три перевірки, і кожна звужує вікно до однієї миті:
      1. лише з петлі — тобто з екрана самої машини;
      2. лише поки вузол нічий: PIN власника ще той, що намінтило ядро,
         і маркер на місці. Після цього виклику маркера немає, і двері
         зачинені назавжди — повторний виклик дістане 409;
      3. PIN мусить бути новий: лишити той самий бутстрап-PIN означало б
         вийти з цього стану, не вийшовши з нього.

    Хто дотягнувся до петлі в цю мить, уже сидить за цією машиною і вже
    може прочитати `identity/bootstrap_pin` очима. Тобто ручка не додає
    доступу — вона прибирає потребу шукати файл.
    """
    from security.auth import discard_bootstrap_pin, read_bootstrap_pin

    client_host = _resolve_client_ip(request)
    if not is_loopback_host(client_host):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    result = await db.execute(select(User).where(User.username == "phantom"))
    owner = result.scalars().first()
    marker = read_bootstrap_pin()
    if owner is None or marker is None or not is_default_pin(owner.pin_hash):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This node already has an owner.",
            headers={"X-Error-Code": "ALREADY_CLAIMED"},
        )

    pin = req.pin.strip()
    if not pin.isdigit():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="PIN must be digits only.",
            headers={"X-Error-Code": "PIN_NOT_NUMERIC"},
        )
    if pin == marker:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Choose a PIN of your own, not the one the core minted.",
            headers={"X-Error-Code": "PIN_UNCHANGED"},
        )

    name = req.display_name.strip()
    owner.pin_hash = hash_secret(pin)
    try:
        prefs = json.loads(owner.preferences_json or "{}")
    except (ValueError, TypeError):
        prefs = {}
    prefs["display_name"] = name
    owner.preferences_json = json.dumps(prefs)
    await db.commit()
    await db.refresh(owner)

    # Маркер знімається ПІСЛЯ запису: якщо коміт не вдасться, вузол
    # лишається нічиїм і людина може спробувати ще, а не опиниться
    # замкненою з обох боків.
    discard_bootstrap_pin()
    logger.warning("Вузол прийнято власником: %s (PIN замінено, маркер знято)", name)

    token, expires_at = create_token(owner.id, owner.username, owner.role)
    await _touch_last_seen(db, owner)
    response.set_cookie(
        "phantom_token", token,
        httponly=True, samesite="lax",
        max_age=config_session_timeout_s(),
    )
    return AuthResponse(user=_user_to_dict(owner), token=token, expires_at=expires_at)

@router.post("/refresh", response_model=RefreshResponse)
async def refresh(
    request: Request,
    response: Response,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(HTTPBearer(auto_error=False)),
) -> RefreshResponse:
    """
    Issue a new JWT with fresh TTL.
    Accepts tokens expired within the 1-hour grace period (uses jwt_refresh).
    Does NOT require a valid (non-expired) token — this is intentional so
    the client can silently refresh shortly after expiry.

    Day-3 D3-A-3: lockout enforced here too. F-15's Day-2 closure missed
    this third unauthenticated auth route, so an attacker who'd burned
    through the `/login/pin` lockout could pivot to spraying tokens
    against `/refresh` (signature-only failures cost the same as PIN
    failures from the attacker's perspective). We register failures on
    BOTH the IP key and the token's `sub` claim when extractable.
    """
    from jose import JWTError, jwt
    from security import login_lockout
    from security.jwt_manager import _ALGORITHM, _secret

    ip_key = _ip_key(request)
    locked, remaining = login_lockout.is_locked(ip_key)
    if locked:
        raise _lockout_response(remaining)

    # Extract raw token the same way require_auth does
    raw: Optional[str] = None
    if creds:
        raw = creds.credentials
    if not raw:
        raw = request.query_params.get("token")
    if not raw:
        raw = request.cookies.get("phantom_token")
    if not raw:
        # No token at all → IP-only attempt (no user to attribute).
        login_lockout.register_failure(ip_key)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No token provided",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Best-effort user-key extraction — verify signature + algorithm,
    # skip exp so we can attribute failures even when the token is just
    # expired. A signature-invalid token still attributes to ip_key
    # only (we cannot trust the embedded `sub`).
    user_key: Optional[str] = None
    try:
        sig_ok = jwt.decode(
            raw, _secret(),
            algorithms=[_ALGORITHM],
            options={"verify_exp": False},
        )
        sub = sig_ok.get("sub")
        if sub:
            user_key = f"user_id:{sub}"
            locked, remaining = login_lockout.is_locked(user_key)
            if locked:
                raise _lockout_response(remaining)
    except JWTError:
        user_key = None  # signature invalid → cannot trust `sub`

    try:
        new_token, expires_at = jwt_refresh(raw)
    except JWTError as exc:
        login_lockout.register_failure(ip_key)
        if user_key:
            login_lockout.register_failure(user_key)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Cannot refresh token: {exc}",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    login_lockout.register_success(ip_key)
    if user_key:
        login_lockout.register_success(user_key)
    response.set_cookie(
        "phantom_token", new_token,
        httponly=True, samesite="lax",
        max_age=config_session_timeout_s(),
    )
    return RefreshResponse(token=new_token, expires_at=expires_at)


# ── Вхідні двері (механіка — security/door.py) ────────────────────────────────


class DoorTicketRequest(BaseModel):
    ticket: str = Field(..., min_length=8, max_length=128)


class DoorIssueResponse(BaseModel):
    ticket: str
    expires_in: int


def _door_or_404() -> None:
    from security import door

    if not door.enabled():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")


@router.post("/door/issue", response_model=DoorIssueResponse)
async def issue_door_ticket(request: Request) -> DoorIssueResponse:
    """Скрипт запуску міняє ключ дверей на одноразовий квиток."""
    from security import door

    _door_or_404()
    client_host = _resolve_client_ip(request)
    # Тільки заголовок: у рядку запиту ключ осів би в логах доступу.
    presented = request.headers.get("X-Phantom-Door-Key", "")
    if not is_loopback_host(client_host) or not door.key_matches(presented):
        logger.warning("двері: відмовлено у квитку для %r", client_host)
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    return DoorIssueResponse(
        ticket=door.issue_ticket(), expires_in=door.TICKET_TTL_S
    )


@router.post("/door", response_model=AuthResponse)
async def enter_by_door(
    req: DoorTicketRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> AuthResponse:
    """Обміняти квиток на сесію власника. Квиток згорає тут-таки."""
    from security import door
    from security import login_lockout

    _door_or_404()
    ip_key = _ip_key(request)
    locked, remaining = login_lockout.is_locked(ip_key)
    if locked:
        raise _lockout_response(remaining)

    client_host = _resolve_client_ip(request)
    if not is_loopback_host(client_host) or not door.redeem_ticket(req.ticket):
        login_lockout.register_failure(ip_key)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Door ticket is not valid",
            headers={"X-Error-Code": "DOOR_TICKET_INVALID"},
        )
    login_lockout.register_success(ip_key)

    # Тільки до власника — найстарішого ROOT, не до випадкового гостя.
    result = await db.execute(
        select(User).where(User.role == "ROOT").order_by(User.created_at)
    )
    user = result.scalars().first()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Node has no owner yet",
        )
    token, expires_at = create_token(user.id, user.username, user.role)
    await _touch_last_seen(db, user)
    response.set_cookie(
        "phantom_token", token,
        httponly=True, samesite="lax",
        max_age=config_session_timeout_s(),
    )
    logger.info("двері: впущено власника %s", user.username)
    return AuthResponse(user=_user_to_dict(user), token=token, expires_at=expires_at)


@router.get("/config")
async def get_auth_config() -> dict:
    """Return public auth config (limits) needed by the login screen before auth."""
    from config import config
    return {
        "max_pin_attempts": config.security_max_pin_attempts,
        "lockout_duration_m": config.security_lockout_duration_m,
        "session_timeout_m": config.security_session_timeout_m,
    }


@router.get("/me")
async def get_me(current_user: User = Depends(get_current_user)) -> dict:
    """Return full current user object."""
    return _user_to_dict(current_user)


# Phase 19-8 (Mobile Companion design §5) — preference sync whitelist.
# These are the ONLY keys a `PATCH /auth/me` request may write. The
# whitelist is a hard wall: anything else (pin_hash, rfid_uid_hash,
# behavioral_model_json, role, etc.) is silently dropped, NOT 400'd —
# clients across multiple versions get a forward-compatible API
# without leaking which fields are sensitive.
#
# Nested keys (e.g. `voice.profile_id`) are expressed as dotted paths;
# the merger walks the JSON tree and applies the new leaf without
# nuking sibling subtrees.
_PREFS_WHITELIST: frozenset[str] = frozenset(
    {
        "language",
        "theme",
        "voice.profile_id",
        "voice.wake_word",
        "voice.bilingual_mode",
        "familiar.rarity",
        "familiar.manifest_frequency",
        "notifications",
        "map.default_layer",
        "co_pilot.auto_enable",
    }
)


def _set_dotted(obj: dict[str, Any], dotted: str, value: Any) -> None:
    """Mutate `obj` so `dotted` (e.g. 'voice.profile_id') points at `value`,
    creating intermediate dicts as needed. Bare keys (no dot) write the
    value at the top level."""
    parts = dotted.split(".")
    cursor = obj
    for p in parts[:-1]:
        nxt = cursor.get(p)
        if not isinstance(nxt, dict):
            nxt = {}
            cursor[p] = nxt
        cursor = nxt
    cursor[parts[-1]] = value


def _filter_whitelist(patch: dict[str, Any]) -> dict[str, Any]:
    """Return a copy of `patch` containing ONLY whitelisted top-level
    keys + dotted paths. Unknown keys are dropped silently."""
    out: dict[str, Any] = {}
    for k, v in patch.items():
        if k in _PREFS_WHITELIST:
            out[k] = v
        # Allow nested-dict shorthand: client may send
        # `{"voice": {"profile_id": "x"}}` — accept the leaf if its
        # dotted form is whitelisted.
        elif isinstance(v, dict):
            for sub_k, sub_v in v.items():
                dotted = f"{k}.{sub_k}"
                if dotted in _PREFS_WHITELIST:
                    out[dotted] = sub_v
    return out


class PatchMeRequest(BaseModel):
    """Loose: any preference patch. Whitelist is enforced server-side."""

    preferences: dict[str, Any] = Field(default_factory=dict)


@router.patch("/me")
async def patch_me(
    req: PatchMeRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_user_or_device_user),
) -> dict:
    """Phase 19-8 — self-service preference update.

    Mobile and desktop both call this. The whitelist gate guarantees
    the phone cannot escalate role or modify auth secrets even if a
    rogue build sends those fields. After commit, broadcasts a
    `context/preferences_changed` event on the `context` channel scoped
    to the owning user — so every other paired surface (other tab,
    paired phone, future watch) sees the change without polling.
    """
    safe_patch = _filter_whitelist(req.preferences or {})
    if not safe_patch:
        # Nothing to do — return current state. Don't 400; keeps
        # forward-compat for clients that send only unknown fields.
        return _user_to_dict(current_user)

    try:
        prefs = json.loads(current_user.preferences_json or "{}")
        if not isinstance(prefs, dict):
            prefs = {}
    except json.JSONDecodeError:
        prefs = {}

    for key, value in safe_patch.items():
        _set_dotted(prefs, key, value)

    current_user.preferences_json = json.dumps(prefs)
    await db.commit()
    await db.refresh(current_user)

    # Broadcast the *applied* delta (not the raw input) so listeners
    # know exactly which leaves changed. Scoped to user_id so other
    # users' tabs/phones don't receive private prefs.
    try:
        from api.websocket_hub import hub

        await hub.broadcast(
            "context",
            "preferences_changed",
            {"changes": safe_patch, "preferences": prefs},
            user_id=current_user.id,
        )
    except Exception as exc:
        logger.debug("preferences_changed broadcast failed: %s", exc)

    return _user_to_dict(current_user)


@router.post("/logout")
async def logout(response: Response) -> dict:
    """Clear auth cookie."""
    response.delete_cookie("phantom_token")
    return {"ok": True}


# ── Day-4 Wave-2 IDB-2 (ADR-IDB-003): user picker for the LoginScreen ─────────


@router.get("/users/picker", response_model=None)
async def list_users_picker(db: AsyncSession = Depends(get_db)) -> list[dict]:
    """Public-ish: minimal user tiles for the pre-login `<UserPicker>`.

    Returned dicts MUST contain ONLY {id, username, avatar_url}. This
    is consumed BEFORE auth (the picker shows ahead of the PinPad), so
    pin_hash / rfid_uid_hash / preferences / behavioral_model / role
    / last_seen_at / created_at / sensitive auth-related fields MUST
    be whitelisted out — every field that `_user_to_dict` (the
    FACTS-1 leak source flagged at U6-ID-C2) returns is excluded here.

    Order = last-seen DESC so the operator-most-recent user is the
    leftmost tile (a Day-5 Settings toggle can flip this).

    The route MUST NOT call `_user_to_dict`; that would re-introduce
    the leak. The route MUST NOT require auth; that breaks the
    pre-login picker flow.

    2026-05-03 — exclude test/ephemeral usernames AND cap to
    `_PICKER_MAX_TILES`. Two motivations, both load-bearing:

    * pytest fixtures historically wrote to the dev DB
      (`tests/conftest.py::_make_user_row` minted `phantom_test_*`,
      `test_phase17a_chat_tool_dispatcher.py` minted `phase17a_user_*`,
      etc.). Stale fixture rows polluted the LoginScreen's profile
      grid with 70+ tiles, which on the 1024×600 panel meant the
      operator literally could not reach the PIN pad. The conftest
      isolation patch lands in the same commit, but defence-in-depth
      keeps the picker honest even if a future test escapes again.
    * 1024×600 fits ~12 tiles before the grid overflows. The cap is
      a UX guard, not a security one.
    """
    rows = (
        await db.execute(
            select(User)
            .where(
                and_(
                    not_(User.username.like("phantom\\_test\\_%", escape="\\")),
                    not_(User.username.like("phase17a\\_user\\_%", escape="\\")),
                    not_(User.username.like("t\\_%", escape="\\")),
                )
            )
            .order_by(User.last_seen_at.desc())
            .limit(_PICKER_MAX_TILES)
        )
    ).scalars().all()
    return [
        {"id": u.id, "username": u.username, "avatar_url": u.avatar_url}
        for u in rows
    ]


# ── User management (ROOT only) ────────────────────────────────────────────────

users_router = APIRouter(prefix="/users", tags=["users"])


@users_router.get("")
async def list_users(
    _: User = Depends(require_root),
    db: AsyncSession = Depends(get_db),
) -> dict:
    result = await db.execute(select(User))
    users = result.scalars().all()
    return {"users": [_user_to_dict(u) for u in users]}


@users_router.post("", status_code=status.HTTP_201_CREATED)
async def create_user(
    req: CreateUserRequest,
    _: User = Depends(require_root),
    db: AsyncSession = Depends(get_db),
) -> dict:
    # Check username uniqueness
    existing = await db.execute(select(User).where(User.username == req.username))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Username '{req.username}' already exists",
        )
    # Day-4 Wave-2 IDB-2 (ADR-IDB-002) — shared-PIN guard. bcrypt salts
    # so two identical PINs hash to different ciphertexts; the only
    # correct algorithm is an O(N) verify_secret scan over every user
    # whose `pin_hash` is set.
    #
    # Day-4 Wave-2 audit fix (security #H-1): the original implementation
    # early-broke on first hit, leaking PIN-collision INDEX through
    # response timing. Replaced with full-iterate-and-collect so timing
    # is constant w.r.t. which row matches. Per-user bcrypt cost (~80 ms
    # on Q6A) bounds N at ~50 (capped below); past 50 users we reject
    # with 503 to prevent worker-starvation DoS.
    if req.pin is not None:
        import asyncio as _asyncio
        from security.auth import verify_secret

        existing_pin_users = (
            await db.execute(select(User).where(User.pin_hash.is_not(None)))
        ).scalars().all()
        # Cap at 200 to bound the bcrypt walk to ~16s worst case on
        # Q6A; past that, reject with 503 to prevent worker starvation.
        # Day-5 ships an HMAC-pepper PIN-collision index that flips
        # the algorithm to O(1) and removes the cap entirely.
        if len(existing_pin_users) > 200:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail={
                    "error": "too_many_pin_users",
                    "limit": 200,
                    "remediation": (
                        "operator must rotate to RFID-only or use the "
                        "Day-5 HMAC-pepper PIN-collision index"
                    ),
                },
            )

        def _walk_collisions(req_pin: str) -> str | None:
            """Constant-time-w.r.t.-position walk: NO early break.
            Returns the masked first-letter username on collision (or
            None). Runs in a worker thread via asyncio.to_thread so
            the event loop isn't blocked for ~N×80 ms.

            verify_secret raises on a malformed bcrypt hash (e.g. the
            literal "x" sentinel test fixtures use). Wrap the call so
            those rows count as non-match and the walk continues —
            keeps the existing test fixtures green AND keeps the
            timing guarantee (every row contributes the same fixed
            try/except cost)."""
            collision_username: str | None = None
            for u in existing_pin_users:
                if not u.pin_hash:
                    continue
                try:
                    matched = verify_secret(req_pin, u.pin_hash)
                except Exception:  # noqa: BLE001
                    matched = False
                if matched and collision_username is None:
                    collision_username = (
                        (u.username[:1] + "***")
                        if u.username
                        else "***"
                    )
                # NB: do NOT break — full walk equalises timing.
            return collision_username

        masked = await _asyncio.to_thread(_walk_collisions, req.pin)
        if masked is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "error": "shared_pin_forbidden",
                    "existing_username": masked,
                },
            )
    user = User(
        id=str(uuid.uuid4()),
        username=req.username,
        role=req.role,
        pin_hash=hash_secret(req.pin) if req.pin else None,
        rfid_uid_hash=hash_secret(req.rfid_uid) if req.rfid_uid else None,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return _user_to_dict(user)


@users_router.put("/{user_id}")
async def update_user(
    user_id: str,
    req: UpdateUserRequest,
    current_user: User = Depends(require_root),
    db: AsyncSession = Depends(get_db),
) -> dict:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if req.avatar_url is not None:
        user.avatar_url = req.avatar_url  # type: ignore[assignment]
    if req.pin is not None:
        # Rotating away from the bootstrap credential retires the marker
        # file (see security.auth) — plaintext PIN leaves the disk and the
        # loopback-only gate lifts.
        was_bootstrap = is_default_pin(user.pin_hash)
        user.pin_hash = hash_secret(req.pin)  # type: ignore[assignment]
        if was_bootstrap:
            from security.auth import discard_bootstrap_pin
            discard_bootstrap_pin()
    if req.rfid_uid is not None:
        user.rfid_uid_hash = hash_secret(req.rfid_uid)  # type: ignore[assignment]
    if req.preferences is not None:
        user.preferences_json = json.dumps(req.preferences)  # type: ignore[assignment]

    await db.commit()
    await db.refresh(user)
    return _user_to_dict(user)


@users_router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def delete_user(
    user_id: str,
    current_user: User = Depends(require_root),
    db: AsyncSession = Depends(get_db),
) -> Response:
    if user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete your own account",
        )
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    await db.delete(user)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@users_router.put("/{user_id}/role")
async def set_user_role(
    user_id: str,
    req: SetRoleRequest,
    current_user: User = Depends(require_root),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot change your own role",
        )
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    user.role = req.role  # type: ignore[assignment]
    await db.commit()
    await db.refresh(user)
    return _user_to_dict(user)


# ── Utility ────────────────────────────────────────────────────────────────────

def config_session_timeout_s() -> int:
    from config import config
    return config.security_session_timeout_m * 60
