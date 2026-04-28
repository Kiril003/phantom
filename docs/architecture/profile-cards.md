# PHANTOM OS — Day-4 Phase-2 Architecture: `profile-cards`

**Cluster**: `profile-cards` (cluster 6 of 8)
**Bounded contexts in scope**: `crypto-primitive`, `user-facts`, `dynamic-source-picker`
**Phase-3 blocks owned**: `CRYPTO-1` (80 LOC, must), `FACTS-1` (320 LOC, must, blocks_by [CRYPTO-1]), `W-4` (380 LOC, must)
**Baseline commit**: `53d16bc`
**Author**: Phase-2 cluster architect (autonomous-run, Day-4)
**Audit findings closed**: U6-ID-C1, U6-ID-C2, U6-ID-M1, U6-ID-M2, U6-ID-G1, U1-UX-C2, U1-UX-G1, U1-UX-M2

---

## 1. Cluster intent

`profile-cards` makes the operator's identity surface persistent, encrypted, and operator-controllable. Three contexts compose:

1. `crypto-primitive` — single in-process Fernet helper everything else builds on.
2. `user-facts` — first persistent, encrypted-at-rest user PII store with self-or-root RBAC.
3. `dynamic-source-picker` — a typed picker that ends the per-key special-case branches in
   `src/frontend/src/components/settings/SettingsPanel.tsx:466-470` and unblocks the W-2 ChatScene
   "identity card" preset (consumed by chat-scenes via `_user_to_dict` and the new fact registry).

**Charter must-have**: per-user identity store + dynamic settings pickers — both required by the
Day-4 charter to bring SaaS polish on top of phase-18.

---

## 2. ADRs — `crypto-primitive`

### ADR-CRP-001 — Use Fernet (AES-128-CBC + HMAC-SHA256) Day-4; defer AES-256-GCM

**Status**: Accepted Day-4. Re-evaluation gate Day-5.

**Context**. `cryptography==43.0.0` is already pinned (see `src/backend/requirements.txt:42`).
Fernet ships with a self-contained token format: 1-byte version + 8-byte timestamp + 16-byte IV +
ciphertext + 32-byte HMAC. Tokens are URL-safe base64 strings — easy to shove in a `Text` column.

**Decision**. Day-4 `encrypt_pii`/`decrypt_pii` wraps `cryptography.fernet.Fernet`. AES-256-GCM
with explicit nonce + AAD (per-row context: `b"user_facts:" + fact_id`) is **not** built today.

**Consequences**.
- Day-4 wins on time-to-ship: `security/crypto.py` lands in 80 LOC vs ~180 LOC for an AAD scheme
  + per-row binding test suite. CRYPTO-1 stays in the Wave-1 budget.
- We accept AES-128 strength (128-bit key, 256-bit MAC) for v0.20. Threat model remains Radxa-local
  — disk encryption is the perimeter; PII-at-rest is defense-in-depth, not the only line.
- Day-5 hardening migrates to AES-256-GCM with `aad = fact_id.encode()`. Migration is lossless
  because `decrypt_pii` will sniff the version byte (`0x80` = Fernet, `0x81` = our v2 envelope).

**Rejected alternatives**.
- AES-256-GCM today: ~2× LOC, blocks `FACTS-1` start.
- libsodium / pynacl: adds a second crypto dependency; pinning hassle on Radxa ARM64 wheels.
- Application-layer XOR with `JWT_SECRET_KEY`: not encryption; rejected on sight.

### ADR-CRP-002 — HKDF-SHA256 derives the Fernet key from `JWT_SECRET_KEY`

**Status**: Accepted.

**Context**. The operator already manages exactly one server secret (`config.jwt_secret_key` —
`src/backend/config.py:262`). Adding a second secret (`PII_ENCRYPTION_KEY`) doubles the rotation
ceremony and operator confusion. The audit U6-ID-C1 finding explicitly calls out the missing
`crypto.py` and assumes derivation, not a new env var.

**Decision**. `derive_data_key()` does:

```python
HKDF(algorithm=SHA256(),
     length=32,
     salt=b"phantom-pii-v1",
     info=b"phantom-os/pii-encryption").derive(jwt_secret_key.encode())
```

Salt is **static** and **versioned** (`-v1`). Info is domain-separated. The 32-byte output is fed
to `Fernet(base64.urlsafe_b64encode(key))`. Same `JWT_SECRET_KEY` → same Fernet key across restarts
→ rows decrypt deterministically.

**Consequences**.
- Single-secret operator UX preserved.
- HKDF salt versioning lets us bump derivation params Day-5 without re-encrypting (we just add
  `salt=b"phantom-pii-v2"` and a one-shot migration script).
- The static salt is **not** secret. It is a domain separator. If the `JWT_SECRET_KEY` leaks, the
  PII key is derivable — same blast radius as JWT forgery, which is already game-over. Acceptable.

**Rejected alternatives**.
- PBKDF2-SHA256 with a per-install random salt persisted to disk: adds a second persistence concern
  and a chicken-and-egg with first-boot.
- Argon2id: KDFs designed against weak password input — `JWT_SECRET_KEY` is already 256-bit
  random; KDF stretching is wasted CPU.

### ADR-CRP-003 — Refuse-to-decrypt on `JWT_SECRET_KEY` rotation

**Status**: Accepted.

**Context**. If the operator rotates `JWT_SECRET_KEY` without first running a re-encrypt
migration, every Fernet token in `user_facts.value_encrypted` becomes undecryptable. The system
has two choices: (a) silently quarantine — return `null` + log warning, or (b) hard fail —
raise `cryptography.fernet.InvalidToken` to the caller.

**Decision**. (b) hard fail. `decrypt_pii` raises `InvalidToken` on tamper or wrong-key. The
`/users/{id}/facts` GET route catches the exception, logs at WARNING, and returns
`HTTP 503 Service Unavailable` with `X-Error-Code: PII_KEY_ROTATION_REQUIRED`. The maintenance
script `scripts/rotate_pii_key.py` (Day-5 deliverable, **not** built in CRYPTO-1) handles
re-encryption.

**Consequences**.
- Operator gets loud, immediate feedback that rotation needs a migration step. Silent loss of PII
  is the worst possible outcome — choose noise.
- A single corrupted row (disk error, bad write) takes down a whole `/facts` GET. Mitigation:
  per-row try/except in the route, return `value: null, decrypt_error: "tamper"` for the bad row,
  serve the rest. CRYPTO-1 itself is route-agnostic — this is a FACTS-1 concern.

**Rejected alternatives**.
- Silent quarantine: looks like data deletion to the operator; failure mode is invisible until
  somebody notices a fact is gone.
- Auto-derive a "previous key" via key-history: KDF is not designed for that; would need a real
  key store.

---

## 3. ADRs — `user-facts`

### ADR-FCT-001 — `UserFact` ORM model (5 columns + audit timestamps)

**Status**: Accepted.

**Schema**:

```python
# db/models.py — appended after MemoryFact (line 137 anchor)

class FactCategory(str, enum.Enum):
    EMAIL = "email"
    PHONE = "phone"
    TELEGRAM = "telegram"
    DISCORD = "discord"
    FILE_POINTER = "file_pointer"  # path or URI to user-uploaded asset


class UserFact(Base):
    __tablename__ = "user_facts"
    __table_args__ = (
        Index("ix_user_facts_user_category", "user_id", "category"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    label: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    value_encrypted: Mapped[str] = mapped_column(Text, nullable=False)  # Fernet token
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)

    user: Mapped["User"] = relationship("User")
```

**Why these columns**:
- `category` as `String(32)` not `Mapped[FactCategory]` — keeps SQLite-friendly, matches
  `MemoryFact.category` pattern at `src/backend/db/models.py:118`. The Pydantic schema enforces
  the enum at the API boundary.
- `label` is operator-provided ("дім", "робота") — optional. NOT encrypted — labels are not PII.
- `ondelete="CASCADE"` — `User` is canonical; deleting a user vacates their facts. Mirrors the
  `cascade="all, delete-orphan"` already used by the `User.memory_facts` relation at
  `src/backend/db/models.py:58-60`.
- Composite index on `(user_id, category)` — the dominant query is "show all phones for user X".

**Migration**. Hand-written Alembic revision `phase4_001_user_facts.py` against current head.
Idempotent `op.create_table` + `op.create_index`. Down-migration drops both.

### ADR-FCT-002 — `/users/{id}/facts` route — POST/GET/DELETE with split RBAC

**Status**: Accepted.

**Routes** (new file `src/backend/api/routes_user_facts.py`, mounted on the existing
`users_router` at `src/backend/api/routes_auth.py:397`):

| Method | Path | Auth dep | Audit row |
|---|---|---|---|
| POST | `/users/{user_id}/facts` | `Depends(require_root)` | yes (`fact.created`) |
| GET | `/users/{user_id}/facts` | `Depends(require_self_or_root)` | no (read) |
| GET | `/users/{user_id}/facts/{fact_id}` | `Depends(require_self_or_root)` | no |
| PUT | `/users/{user_id}/facts/{fact_id}` | `Depends(require_root)` | yes (`fact.updated`) |
| DELETE | `/users/{user_id}/facts/{fact_id}` | `Depends(require_root)` | yes (`fact.deleted`) |

**Why this split**:
- ROOT-only writes: a fact represents identity material; only the operator may add/change/remove.
  Mirrors the `require_root` gate already in place on `POST /users` at
  `src/backend/api/routes_auth.py:413`.
- Self-or-root reads: a guest user sees their own facts (so the chat client can render the
  identity-card scene), but cannot pivot to others'. Closes U6-ID-G1.

**Audit emission**. Every write emits a `agent_audit`-shape row via the existing
`AgentAuditEntry` table (`src/backend/db/models.py:340`) with `action_name="user_fact"` so the
existing audit pipeline picks them up without a new table. `args_json` captures
`{"category": ..., "fact_id": ..., "actor_user_id": ...}` — never the plaintext value.

### ADR-FCT-003 — `_user_to_dict` field-leak patch

**Status**: Accepted. **Closes audit U6-ID-C2**.

**Problem**. `src/backend/api/routes_auth.py:39-61` (`_user_to_dict`) currently returns
`preferences` and `behavioral_model` to **every** caller of `GET /auth/me`,
`GET /auth/users` (root-only, fine), and `_user_to_dict(...)` calls inside login flows. The
behavioral_model leaks pattern data — `last_seen_pattern`, `risk_score`, `trust_axis`. A guest's
own `/auth/me` legitimately needs these, but they MUST NOT appear in:
- `GET /auth/users` rows for *other* users (a ROOT call lists 5 users → currently leaks all 5
  behavioral models, which is fine for ROOT but wrong for any future scope reduction).
- Internal serializers that compose into broadcast WS payloads.

**Fix**.

```python
def _user_to_dict(
    user: User,
    *,
    include_private: bool = False,  # set True for self-or-root callers only
) -> dict[str, Any]:
    base = {
        "id": user.id,
        "username": user.username,
        "role": user.role,
        "avatar_url": user.avatar_url,
        "has_rfid": user.rfid_uid_hash is not None,
        "has_pin": user.pin_hash is not None,
        "created_at": user.created_at.isoformat(),
        "last_seen_at": user.last_seen_at.isoformat(),
    }
    if include_private:
        base["preferences"] = json.loads(user.preferences_json or "{}")
        base["behavioral_model"] = json.loads(user.behavioral_model_json or "{}")
    return base
```

Call sites change as follows:
- `routes_auth.py:218,281` (login responses) — `include_private=True` (caller IS the user).
- `routes_auth.py:385` (`get_me`) — `include_private=True`.
- `routes_auth.py:407` (`list_users`) — `include_private=True` ONLY when `current_user.id == row.id`
  OR `current_user.role == "ROOT"`. List-broad ROOT keeps `True`, but the per-row check is the
  right primitive for the future when `OPERATOR` may list users.
- `routes_auth.py:433,459,501` (create/update/setrole responses) — `include_private=True`
  (ROOT did the write; full echo back is fine).

**Back-compat note**. The frontend `useAuthStore` consumes `preferences` + `behavioral_model` from
`/auth/me`. Adding `include_private` gated on the same caller does NOT change the public
`/auth/me` contract — that path always sets `True` because the caller IS the user. **The W-4
identity-card scene MUST consume `/auth/me`, never `/auth/users/{id}` from a guest context.**

### ADR-FCT-004 — `require_self_or_root` FastAPI dependency

**Status**: Accepted.

**Definition** (added at the bottom of `src/backend/security/permissions.py:39`):

```python
from fastapi import Path

async def require_self_or_root(
    user_id: str = Path(..., description="Path-param user id"),
    current_user: User = Depends(get_current_user),
) -> User:
    if current_user.role == "ROOT" or current_user.id == user_id:
        return current_user
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Requires ROOT role or matching user id",
        headers={"X-Error-Code": "RBAC_NOT_SELF_OR_ROOT"},
    )
```

**Pattern fit**. Matches the `RoleChecker` shape at `src/backend/security/permissions.py:15-32`
(`async def __call__(...) -> User`), so the existing `Depends(require_root)` ergonomics carry over
1:1. Returns the resolved `User` so route handlers don't re-resolve.

**Why a function, not a class**. `require_self_or_root` needs `Path(...)` injection — FastAPI's
dependency resolver only injects `Path`/`Query`/`Header` parameters for plain async functions, not
class `__call__` methods. The class style works for `RoleChecker` (no path param needed) but fails
here. Documented inline.

---

## 4. ADRs — `dynamic-source-picker`

### ADR-DSP-001 — `dynamic_source` field on `SettingDefinitionOut`

**Status**: Accepted. **Closes audit U1-UX-C2**.

**Problem**. `SettingsPanel.tsx:466-470` hard-codes `if (def.key === 'ai_ollama_model')` to swap
in the `OllamaModelEditor`. Adding a TTS voice picker, MMS language picker, serial-port picker,
or per-user speaker picker either:
- requires a frontend code change per addition (current pattern), or
- ships with an opaque "freeform string" UX (current state for `voice_tts_voice`,
  `voice_stt_mms_lang`, `sensor_serial_port`).

**Fix**. Add an optional `dynamic_source` discriminator to `SettingDefinitionOut` at
`src/backend/api/routes_settings.py:41-56`:

```python
class SettingDefinitionOut(BaseModel):
    key: str
    label: str
    # ... existing fields unchanged ...
    dynamic_source: Optional[
        Literal["ollama_models", "voice_voices", "mms_languages",
                "serial_ports", "tts_speakers"]
    ] = None
```

The field is optional — every existing setting that omits it renders identically to today.
**Back-compat invariant**: `_build_definition` at `src/backend/api/routes_settings.py:411` adds
the field via a new `DYNAMIC_SOURCE_REGISTRY` lookup; settings not in the registry get `None`.

**Wired keys (Day-4)**:

| Setting key | `dynamic_source` |
|---|---|
| `ai_ollama_model` | `ollama_models` |
| `voice_tts_voice` | `voice_voices` |
| `voice_stt_mms_lang` | `mms_languages` |
| `sensor_serial_port` | `serial_ports` |
| (deferred Day-5) `voice_tts_speaker_id` | `tts_speakers` |

### ADR-DSP-002 — Single `<DynamicPicker>` React component

**Status**: Accepted.

**Replacement contract**. `SettingsPanel.tsx:466-470` becomes:

```tsx
if (def.dynamic_source) {
  return <DynamicPicker source={def.dynamic_source} value={value} onChange={onChange} />;
}
```

The legacy `OllamaModelEditor` is renamed `DynamicPicker` and its hard-coded
`aiApi.listModels()` call routes through a `RESOLVERS` map keyed by `dynamic_source`. The
graceful-offline UX from `SettingsPanel.tsx:737-810` is preserved verbatim — same loading state,
same fallback to `<input type="text">` on resolver failure with an inline "X offline, enter
manually" hint.

**Resolver map** (frontend, `src/frontend/src/services/dynamic_sources.ts` — NEW):

```typescript
type DynamicSource = "ollama_models" | "voice_voices" | "mms_languages"
                   | "serial_ports" | "tts_speakers";

interface SourceOption { value: string; label: string; }

const RESOLVERS: Record<DynamicSource, () => Promise<SourceOption[]>> = {
  ollama_models: async () => (await aiApi.listModels()).models.map(m => ({
    value: m.name, label: `${m.name} (${m.size_mb} MB)`
  })),
  voice_voices: async () => (await voiceApi.listVoices()).voices,
  mms_languages: async () => (await voiceApi.listMmsLanguages()).languages,
  serial_ports: async () => (await sensorsApi.listSerialPorts()).ports,
  tts_speakers: async () => [],  // Day-5 wiring
};
```

**Performance**. Resolver fetch fires `useEffect`-on-mount with a 50 ms timeout; on timeout the
fallback input renders so the operator can type. Mirrors `SettingsPanel.tsx:763-770` `.catch`
pattern.

### ADR-DSP-003 — Backend resolver registry

**Status**: Accepted.

**Definition** (`src/backend/api/dynamic_sources.py` — NEW, 80 LOC of the W-4 380 LOC budget):

```python
from typing import Awaitable, Callable

DynamicSourceResolver = Callable[[], Awaitable[list[dict[str, str]]]]
_REGISTRY: dict[str, DynamicSourceResolver] = {}

def register_dynamic_source(source_id: str, resolver: DynamicSourceResolver) -> None:
    if source_id in _REGISTRY:
        raise ValueError(f"dynamic_source already registered: {source_id}")
    _REGISTRY[source_id] = resolver

async def resolve_dynamic_source(source_id: str) -> list[dict[str, str]]:
    fn = _REGISTRY.get(source_id)
    if fn is None:
        raise KeyError(f"Unknown dynamic_source: {source_id}")
    return await fn()
```

Day-4 resolvers are registered at module import (`src/backend/api/__init__.py` adds the chain).
Day-5 plugs `tts_speakers` (per-user voice profile) by calling `register_dynamic_source` from
`voice/identity/resolver.py` — **no edit to `routes_settings.py` needed**.

**Route**: `GET /api/v1/settings/dynamic_source/{source_id}` — gated by
`Depends(get_current_user)` (matches the `/settings` family at
`src/backend/api/routes_settings.py:472`). Returns
`{"source": "<id>", "options": [{"value": "...", "label": "..."}, ...]}`.

The frontend resolver map (ADR-DSP-002) is **a thin proxy over this single endpoint**, NOT one
endpoint per source. This keeps the frontend agnostic and lets Day-5 add a `tts_speakers` source
with zero TypeScript changes.

---

## 5. Interfaces (frozen for Phase-3)

### Python — `security/crypto.py` (CRYPTO-1)

```python
"""PII encryption — Fernet-over-HKDF(JWT_SECRET_KEY).

ADR-CRP-001/002/003 (docs/architecture/profile-cards.md).
"""
from __future__ import annotations

import base64
from cryptography.fernet import Fernet, InvalidToken  # re-exported
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

__all__ = ["encrypt_pii", "decrypt_pii", "derive_data_key", "InvalidToken"]

_HKDF_SALT = b"phantom-pii-v1"
_HKDF_INFO = b"phantom-os/pii-encryption"


def derive_data_key() -> bytes:
    """32-byte key derived from config.jwt_secret_key. Re-derives every call —
    cheap (~5 µs) and keeps the secret rotation story honest (no cached key)."""
    from config import config
    if not config.jwt_secret_key:
        raise RuntimeError("jwt_secret_key is unset; cannot derive PII key")
    return HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=_HKDF_SALT,
        info=_HKDF_INFO,
    ).derive(config.jwt_secret_key.encode("utf-8"))


def _fernet() -> Fernet:
    return Fernet(base64.urlsafe_b64encode(derive_data_key()))


def encrypt_pii(plaintext: bytes | str) -> str:
    if isinstance(plaintext, str):
        plaintext = plaintext.encode("utf-8")
    return _fernet().encrypt(plaintext).decode("ascii")


def decrypt_pii(token: str) -> str:
    """Raises cryptography.fernet.InvalidToken on tamper or wrong key."""
    return _fernet().decrypt(token.encode("ascii")).decode("utf-8")
```

### Python — `db/models.py` UserFact append (FACTS-1)

(See ADR-FCT-001 above — append immediately after the `MemoryFact` block ending at
`src/backend/db/models.py:137`.)

### Python — `security/permissions.py` `require_self_or_root` (FACTS-1)

(See ADR-FCT-004 above — append after line 39.)

### Python — `api/routes_user_facts.py` (FACTS-1, NEW file)

```python
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_db
from db.models import User, UserFact
from security.auth import get_current_user
from security.crypto import encrypt_pii, decrypt_pii, InvalidToken
from security.permissions import require_root, require_self_or_root

router = APIRouter(prefix="/users/{user_id}/facts", tags=["user_facts"])

class FactCreateRequest(BaseModel):
    category: str = Field(..., pattern="^(email|phone|telegram|discord|file_pointer)$")
    label: str | None = Field(None, max_length=128)
    value: str = Field(..., min_length=1, max_length=4096)

class FactOut(BaseModel):
    id: str
    user_id: str
    category: str
    label: str | None
    value: str | None  # plaintext; None if decrypt failed
    decrypt_error: str | None = None
    created_at: str
    updated_at: str

# POST → require_root, GET/list → require_self_or_root, PUT/DELETE → require_root.
# Audit row emitted on every write via AgentAuditEntry table.
```

### TypeScript — `shared/types/settings.ts`

```typescript
export type DynamicSource =
  | "ollama_models"
  | "voice_voices"
  | "mms_languages"
  | "serial_ports"
  | "tts_speakers";

export interface SettingDefinitionOut {
  key: string;
  label: string;
  description: string;
  type: "string" | "number" | "boolean" | "select" | "range" | "color" | "text" | "password";
  default: unknown;
  value: unknown;
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  requires_restart: boolean;
  category: string;
  visible_to: string[];
  /** ADR-DSP-001 — when set, frontend swaps in <DynamicPicker source={dynamic_source} /> */
  dynamic_source?: DynamicSource;
}

export interface UserFact {
  id: string;
  user_id: string;
  category: "email" | "phone" | "telegram" | "discord" | "file_pointer";
  label: string | null;
  value: string | null;
  decrypt_error: string | null;
  created_at: string;
  updated_at: string;
}
```

---

## 6. Test plan

### CRYPTO-1 — `tests/test_crypto.py` (NEW)

- `test_round_trip_str()` — `decrypt_pii(encrypt_pii("Київ"))` returns `"Київ"` (Cyrillic).
- `test_round_trip_bytes()` — `decrypt_pii(encrypt_pii(b"\xff\x00\x01"))` returns `"ÿ\x00\x01"`.
- `test_tamper_raises_invalid_token()` — flip last byte of token → `InvalidToken`.
- `test_wrong_key_raises_invalid_token()` — monkeypatch `config.jwt_secret_key`, decrypt token
  encrypted under previous secret → `InvalidToken`.
- `test_deterministic_key_across_calls()` — `derive_data_key()` returns equal bytes on two calls
  with the same secret (no caching ambiguity).
- `test_changing_jwt_secret_changes_key()` — derived keys are unequal for different secrets.
- `test_unset_secret_raises()` — `jwt_secret_key=""` → `RuntimeError`.
- **Performance**: `test_round_trip_under_100us()` — 1000-iter loop, `(t_total / 1000) < 100e-6`
  on Radxa CPU. Marked `@pytest.mark.perf` so CI can skip on slow runners.

### FACTS-1 — `tests/test_user_facts.py` (NEW)

- `test_root_can_create_fact()` — POST as ROOT, fetch via GET, plaintext matches.
- `test_guest_cannot_create_fact()` — POST as GUEST → 403.
- `test_self_can_read_own_facts()` — GUEST POST denied; ROOT seeds, GUEST GETs own facts → 200.
- `test_other_user_cannot_read()` — GUEST A tries GET on user B → 403 with
  `X-Error-Code: RBAC_NOT_SELF_OR_ROOT`.
- `test_root_can_read_any_user_facts()` — ROOT GET on guest's facts → 200.
- `test_delete_cascades_on_user_delete()` — delete user → facts gone (FK CASCADE).
- `test_value_encrypted_at_rest()` — raw row's `value_encrypted` column does NOT contain plaintext
  (substring check).
- `test_decrypt_error_returned_on_tamper()` — manually corrupt one row → GET returns 200 with
  `value: null, decrypt_error: "tamper"`; sibling rows still readable.
- `test_audit_row_on_create()` — after POST, `AgentAuditEntry` has a row with
  `action_name="user_fact"` and `args_json` mentioning fact_id but NEVER plaintext.
- `test_user_to_dict_omits_private_when_not_self_or_root()` — `_user_to_dict(user, include_private=False)` lacks `preferences` and `behavioral_model` keys (closes U6-ID-C2).
- `test_get_me_still_carries_private()` — back-compat: `/auth/me` response shape unchanged.
- **Performance**: `test_crud_round_trip_under_30ms()` — POST→GET→DELETE measured median over 50
  iterations, < 30 ms on Radxa SQLite.

### W-4 — `tests/test_dynamic_sources.py` + `frontend/__tests__/DynamicPicker.test.tsx` (NEW)

Backend:
- `test_register_dynamic_source_idempotent_collision()` — re-registering same id raises.
- `test_resolve_unknown_source_raises()` — `resolve_dynamic_source("nope")` → `KeyError`.
- `test_resolver_returns_options()` — register a stub returning `[{"value":"a","label":"A"}]`,
  GET `/settings/dynamic_source/stub` → 200 with that body.
- `test_setting_definition_carries_dynamic_source()` — `GET /settings` payload for
  `ai_ollama_model` includes `"dynamic_source": "ollama_models"`; arbitrary other key includes no
  `dynamic_source` field (back-compat).
- `test_unauthenticated_resolver_call_is_401()` — matches the `/settings` family RBAC.

Frontend (Vitest):
- `<DynamicPicker source="ollama_models">` mounts, mocks `RESOLVERS.ollama_models` → renders
  `<select>` with returned options.
- Mock resolver rejects → component falls back to `<input type="text">` + offline hint.
- 50 ms timeout — resolver pending past 50 ms → renders fallback input (operator can type).
- Picker forwards `onChange` calls verbatim with the new value (string passthrough).
- `<ValueEditor def={{ ...def, dynamic_source: undefined }}>` does NOT mount `<DynamicPicker>`
  (back-compat: existing settings render as today's `<input type="text">`).

---

## 7. Performance budgets

| Operation | Budget | Measurement | Source ADR |
|---|---:|---|---|
| `encrypt_pii` + `decrypt_pii` round-trip | ≤ 100 µs | `tests/test_crypto.py::test_round_trip_under_100us` | CRP-001 |
| `derive_data_key()` single call | ≤ 50 µs | inline benchmark in same test | CRP-002 |
| UserFact POST→GET→DELETE round-trip | ≤ 30 ms | `tests/test_user_facts.py::test_crud_round_trip_under_30ms` | FCT-001/002 |
| `<DynamicPicker>` first-render fetch | ≤ 200 ms (online) | Vitest fake-timers + resolved promise | DSP-002 |
| `<DynamicPicker>` offline fallback timeout | ≤ 50 ms | Vitest fake-timers + pending promise | DSP-002 |
| `GET /settings/dynamic_source/{id}` server-side | ≤ 50 ms (Ollama tag-list excluded) | route latency Histogram (V-6) | DSP-003 |

The Day-4 V-6 Histogram primitive (runtime-perf cluster) gets three new histogram series:
`pii_encrypt_ms`, `user_facts_crud_ms`, `dynamic_source_resolve_ms` — wired post-FACTS-1 land.

---

## 8. Back-compat invariants

The cluster is a new feature surface, but it touches three back-compat-sensitive seams.

### 8.1 `/auth/users` POST/PUT contract

`CreateUserRequest` and `UpdateUserRequest` at `src/backend/api/routes_auth.py:84-95` carry
`preferences: Optional[dict]`. The W-4 + FACTS-1 work does NOT change this — `preferences` stays
on `User.preferences_json`; `UserFact` is an **additive** PII channel, not a replacement. The
frontend `useUsersStore` and `UserManagement.tsx` continue to call the same routes with the same
shape.

**Test**: `tests/test_auth_user_management.py::test_create_user_with_preferences_unchanged`.

### 8.2 Settings without `dynamic_source` render unchanged

Every existing setting that the operator sees today renders **byte-identically** because:
- `_build_definition` at `src/backend/api/routes_settings.py:411-439` only fills `dynamic_source`
  for keys present in `DYNAMIC_SOURCE_REGISTRY` — for everything else the field is `None` (omitted
  from JSON via Pydantic's `exclude_none` default).
- `<ValueEditor>` at `SettingsPanel.tsx:457-465` checks `def.dynamic_source` first, then falls
  through to the existing `def.type` switch — the boolean toggle (line 472), select dropdown,
  range slider, color picker etc. all keep their exact code paths.

**Test**: `tests/test_settings_back_compat.py::test_existing_keys_have_no_dynamic_source` runs
against every key in `CATEGORY_SPEC` and asserts `"dynamic_source" not in payload[key]` unless
explicitly registered.

### 8.3 `_user_to_dict` keep-the-keys contract

The frontend `useAuthStore` reads `user.preferences` and `user.behavioral_model` from `/auth/me`.
The `include_private` flag MUST default to `True` for `/auth/me` so the frontend keeps working.
A `False` default would silently break the StatusBar trust-axis indicator (`behavioral_model.trust`
read at frontend StatusBar).

**Test**: `tests/test_auth.py::test_get_me_still_carries_behavioral_model` — explicit assertion
that `behavioral_model` key is present and an object.

### 8.4 `archive_memory.py:6-8` placeholder

`crypto.py` lands today (CRYPTO-1) but `archive_memory.py:6` reads
`TODO(phase-12): when AES-256 sealing lands, consult ...`. Day-4 does NOT delete this comment —
the GHOST sealing pipeline is a separate dataflow (encrypted file blobs, not in-row Fernet
tokens). CRYPTO-1 narrows the comment scope:

```
# TODO(phase-12): GHOST file-blob sealing — separate from security/crypto.py
# (which handles in-row PII via Fernet, see ADR-CRP-001).
```

Functional behavior of `archive_memory.py` is unchanged.

---

## 9. Block-level execution contract (Phase-3 hand-off)

| Block | LOC | Order | Blockers cleared by | Audit IDs closed |
|---|---:|---|---|---|
| **CRYPTO-1** | 80 | Wave 1, parallel-safe | none | U6-ID-C1 |
| **FACTS-1** | 320 | Wave 2, after CRYPTO-1 | CRYPTO-1 | U6-ID-C2, M1, M2, G1 |
| **W-4** | 380 | Wave 2, parallel-safe | none | U1-UX-C2, G1, M2 |

Every block runs `pytest -q` green before commit (per `RUFLO_EXECUTION_PLAN.md §3`). W-4 also runs
`npm run typecheck && npm run build`. Commit subjects:
- `phase-3-CRYPTO-1: Fernet PII helper + HKDF derivation (closes U6-ID-C1)`
- `phase-3-FACTS-1: UserFact CRUD + require_self_or_root (closes U6-ID-C2,M1,M2,G1)`
- `phase-3-W-4: dynamic_source schema + 5 resolvers + DynamicPicker (closes U1-UX-C2,G1,M2)`

After each block lands, write `memory store --namespace day4-phase3-impl --key <blockID>`
(commit-sha + 3-line summary).

---

## 10. Day-5 deferral list (NOT in CRYPTO-1/FACTS-1/W-4 scope)

- AES-256-GCM with per-row AAD migration (`v2_envelope`) — CRP-001 follow-up.
- `scripts/rotate_pii_key.py` re-encrypt-all maintenance script — CRP-003 operator tooling.
- `tts_speakers` resolver wiring — DSP-001 last entry, requires Day-5 `voice/identity/resolver.py`.
- Per-user `voice_tts_speaker_id` setting key registration in `CATEGORY_SPEC` — DSP-001 follow-up.
- ChromaDB blob encryption for `strategic_memory` — separate dataflow, separate ADR (Day-6+).
- Frontend `<UserFactsPanel>` with category-grouped cards + "Add fact" affordance — chat-scenes
  W-2 identity-card scene already consumes the model; standalone profile UI is Day-5.

---

**End of Phase-2 architecture for `profile-cards`.**
