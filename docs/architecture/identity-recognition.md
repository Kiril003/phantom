# PHANTOM OS — Identity-Recognition Cluster Architecture (Day-4 Phase-2)

**Cluster**: identity-recognition (7 of 8)
**Sub-contexts**: `speaker-id-foundation` (ID-1, ID-2, ID-3) + `multi-user-bootstrap` (IDB-1, IDB-2, IDB-3)
**Baseline commit**: `53d16bc`
**Owner**: Phase-2 cluster architect
**References**: `docs/PHASE1_CONTEXTS.md:129-145`, `docs/PHASE1_BLOCK_ORDER.md:44,47,48,52,57,58,92-95,120,121`

---

## 0. Cluster intent (one-paragraph)

Day-4 lays the **plumbing** for two co-evolving identity stories: (a) *who is speaking* (voice → ML embedding → user UUID, **Day-5 actually wires the ML**) and (b) *who is logged in* (multi-user PIN/RFID picker + shared-PIN guard, **Day-4 ships fully**). The two stories share zero runtime code today, but they share a contract: every chat-message row carries an *optional* `speaker_user_id` that may differ from `user_id` (the JWT holder), so the strategic-memory layer can later reconcile "Roman spoke from Kiril's session". Day-4 freezes the dataclass + ORM column + WS payload + React picker so Day-5 only edits one function (`resolve_speaker`) and one ML weight file. No ML weights ship Day-4. No prompt-builder edits Day-4.

---

## 1. ADR-ID-001 — `speaker_id: Optional[str]` on STTResult + Transcript

### Decision
Add a single optional field, default `None`, to the canonical STT response dataclass and to the shared TypeScript transcript type. Today every provider sets it to `None`; Day-5 wires the resolver call in pipeline.py (ADR-ID-003) and the field starts carrying a UUID.

### Why this shape
- The STT subsystem (`src/backend/voice/stt_engine.py:90-115`) already has the canonical dataclass `STTResult(text, confidence, engine, language, engine_error)` consumed by **every** provider (Whisper / Vosk / NPU / MMS / Noop) and by every route. One field added there means every provider benefits the day Day-5 lands, without per-provider edits.
- The shared TS type lives in `src/shared/types/` (today `chat.ts:14-32` carries `ChatMessage`; there is **no** `Transcript` type yet — the cluster owns adding it under `voice.ts`).
- Default `None` (Python) / `null` (TS) keeps the JSON additive: any client that ignores the field keeps working — see Back-compat invariant §10.

### Concrete diff envelope (Day-4)
- `src/backend/voice/stt_engine.py:90-115` — extend `@dataclass STTResult` with `speaker_id: Optional[str] = None`; extend `to_dict` to omit when `None` (mirrors how `engine_error` is handled at line 113-114) so an absent key on the wire still parses on legacy clients.
- `src/shared/types/voice.ts` (NEW file) — add `interface Transcript { text: string; confidence: number; engine: STTEngineName; language: string; speaker_id: string | null; engine_error?: string }`.
- `src/shared/types/index.ts` — re-export `Transcript`.
- No changes to provider classes — `speaker_id` is left at the dataclass default. Day-5 sets it from the resolver, NOT from inside the provider.

### Invariants
- Field is **additive-only**. Day-5 may NOT remove or rename it without a new ADR.
- Field is **not persisted** by `STTResult` itself — persistence is `ChatMessage.speaker_user_id` (ADR-ID-004).
- The `to_dict` shape MUST keep omitting `speaker_id` when `None` so the WS frame size on the hot path doesn't grow for the 99% case.

---

## 2. ADR-ID-002 — `voice/identity/resolver.py` no-op stub with frozen signature

### Decision
A new module `src/backend/voice/identity/resolver.py` exports a single pure function:
```python
def resolve_speaker(audio: bytes, sample_rate: int) -> Optional[str]: ...
```
Day-4 implementation: `logger.debug("identity.resolver: no-op (Day-5 wires ML)")` then `return None`. Day-5 swaps the body for an embedding lookup (ECAPA-TDNN or similar) without touching the call-site or the signature.

### Why this shape
- `bytes` (mono s16le PCM) is the same payload `voice/always_on.py:319,624-650` already passes to Vosk (`_transcribe_full_sync`) and what `voice/pipeline.py:80-83` synthesises after `decode_to_mono16k`. Zero new conversion.
- `sample_rate: int` makes the function self-describing — the resolver in Day-5 may downsample to 8 kHz for embedding extraction without forcing the pipeline to know.
- `Optional[str]` mirrors `STTResult.speaker_id`. UUID string when matched, `None` when no match / no enrolled users / disabled.
- Pure function (no I/O, no `db.Session`) so the Day-5 ML implementation can be unit-tested with synthetic PCM and so it stays runnable inside `asyncio.to_thread`.

### Concrete files (Day-4)
- `src/backend/voice/identity/__init__.py` (NEW, empty + module docstring).
- `src/backend/voice/identity/resolver.py` (NEW, ~40 LOC):
  ```python
  """Speaker-ID resolver — frozen interface for Day-5 ML drop-in.

  Day-4: returns None unconditionally. The signature is pinned by
  ADR-ID-002 — Day-5 must not change it.
  """
  from __future__ import annotations
  import logging
  from typing import Optional

  logger = logging.getLogger(__name__)

  def resolve_speaker(audio: bytes, sample_rate: int) -> Optional[str]:
      logger.debug(
          "identity.resolver: no-op (Day-5 wires ML); audio=%d B sr=%d",
          len(audio) if audio else 0, sample_rate,
      )
      return None
  ```

### Invariants
- The function MUST stay pure (no globals beyond the module logger, no DB, no network) so Day-5 can hot-swap the body without revisiting the call-site.
- Day-5 ML implementation MUST NOT raise on unenrolled audio — `None` is the contract for "no match".

---

## 3. ADR-ID-003 — Hook location: pipeline.py, AFTER STT, BEFORE ContextEngine

### Decision
The single call to `resolve_speaker` lives in `src/backend/voice/pipeline.py:80-83` (`transcribe_blob`). After STT returns `STTResult`, **before** the result is handed to any consumer (route handler, ContextEngine, chat-tool dispatcher), the pipeline calls the resolver and writes the answer onto `result.speaker_id`. Single call site → all providers benefit.

### Why pipeline.py and not per-provider
- Every STT path eventually flows through `pipeline.py::transcribe_blob` (push-to-talk) OR through `always_on.py::_finalise_streaming/_finalise_phase12_utterance` (always-on). Both already do `decode_to_mono16k → provider.transcribe → STTResult`. Hooking once in `transcribe_blob` covers push-to-talk; the always-on orchestrator gets a sibling call inside `_finalise_phase12_utterance` (lines 456-496) and `_finalise_streaming` (lines 500-547) — total of three call sites, all in pipeline-adjacent code, **never** inside provider classes.
- ContextEngine is the canonical consumer (per CLAUDE.md "ContextEngine — central for ALL decisions"). It MUST NOT be the resolver's caller — that would tangle a vision/speaker concern into the cognition layer.

### Concrete diff envelope (Day-5; Day-4 leaves call-sites un-edited but documents them)
- `src/backend/voice/pipeline.py:80-83` will become:
  ```python
  async def transcribe_blob(raw: bytes, language: str) -> STTResult:
      audio = decode_to_mono16k(raw)
      result = await get_stt_provider().transcribe(audio, language)
      # Day-5 wires ADR-ID-002. Day-4 keeps speaker_id=None.
      from voice.identity.resolver import resolve_speaker
      pcm16 = (audio * 32767.0).astype("<i2").tobytes()  # already implemented in stt_engine.to_pcm16_bytes
      result.speaker_id = await asyncio.to_thread(resolve_speaker, pcm16, 16_000)
      return result
  ```
- `voice/always_on.py:_finalise_streaming` and `_finalise_phase12_utterance` get the same pattern keyed on the buffered `audio: bytes`.

### Day-4 actually delivers
- ID-1 (60 LOC): adds the `speaker_id` field to `STTResult` and the shared `Transcript` type — does **not** call the resolver.
- ID-2 (80 LOC): ships the no-op resolver and unit-tests it.
- ID-3 (110 LOC): adds the ORM column + Alembic-style migration but does NOT populate it (writers leave it `NULL`).

### Invariants
- Resolver is **always called inside `asyncio.to_thread`** (Day-5) — the future ML inference is CPU-bound and would block the event loop, mirroring how Vosk and Silero VAD are already off-loaded (`pipeline.py:46`, `always_on.py:229,246,295,302,427`).
- Resolver MUST NOT be called from ContextEngine, prompt_builder, or chat routes. The hook is **STT-layer-only**.

---

## 4. ADR-ID-004 — `ChatMessage.speaker_user_id` sibling column

### Decision
Add a nullable, indexed `speaker_user_id` column to `ChatMessage` (`src/backend/db/models.py:88-101`) as a sibling to the existing `user_id` (which already references `users.id` and represents the JWT-authenticated session owner). Strategic-memory writers populate `speaker_user_id` from `STTResult.speaker_id` when present; otherwise leave NULL.

### Why a sibling column (not a replacement)
- `user_id` MUST remain the JWT-holder — every authorisation check (RBAC, fact-attribution under `MemoryFact.user_id`, geo-fact composite index `ix_memory_facts_user_geo` at `models.py:111-112`) keys on it. Tampering breaks tenancy.
- `speaker_user_id` is **descriptive** (who actually spoke into the mic), not **authoritative** (who the system trusts to act). The two sometimes equal, sometimes differ:
  - Same: Kiril logged in, Kiril spoke → both equal his UUID.
  - Differ: Kiril logged in, his daughter spoke → `user_id` = Kiril, `speaker_user_id` = daughter (if enrolled).
  - NULL: Day-4 (no resolver), or Day-5 with unenrolled speaker, or text-input path.
- Day-4 leaves the column NULL forever. Day-5 will choose the JWT-holder-copy semantics (i.e. whether to default `speaker_user_id := user_id` for text-input + voice-with-no-match) in a separate ADR — not this Day-4 charter.

### Concrete schema (Day-4 ID-3)
```python
class ChatMessage(Base):
    __tablename__ = "chat_messages"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(ForeignKey("chat_sessions.id"), nullable=False)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    speaker_user_id: Mapped[Optional[str]] = mapped_column(    # ← NEW
        ForeignKey("users.id"), nullable=True, index=True
    )
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    # ... unchanged ...
```
Index `ix_chat_messages_speaker_user_id` is implicit via `index=True`. No composite index Day-4 — the use case (filter messages by speaker) is Day-5's strategic-memory query, and even at 100k rows the single-column index is sufficient.

### Migration (Day-4 ID-3)
The cluster does **not** introduce Alembic this phase (project uses raw `init_db` per `db/database.py`). Day-4 ID-3 ships an idempotent `ALTER TABLE chat_messages ADD COLUMN speaker_user_id VARCHAR(36) NULL REFERENCES users(id)` executed at lifespan boot inside `init_db`, with a `try/except OperationalError` (column-already-exists) so the migration is replay-safe. If/when the project adopts Alembic (Day-5+), this column gets a real upgrade revision — Day-4 leaves a `# MIGRATION_NOTE: speaker_user_id added Day-4` comment near the `ChatMessage` declaration.

### Invariants
- The column is **always nullable**. Strategic-memory writers MUST tolerate NULL on read.
- Foreign key MUST allow NULL even after Day-5 — text-input messages have no speaker.
- `user_id` and `speaker_user_id` are **never** assumed equal — Day-5 code that wants "speaker XOR holder" must check explicitly.

---

## 5. ADR-IDB-001 — pytest pinning multi-user under deployment_mode=single

### Decision
Add `src/backend/tests/test_single_mode_allows_multi_user.py` (~90 LOC) that boots the FastAPI app with `deployment_mode=single` (the default) AND `PHANTOM_ALLOW_MULTI_TENANT_PREVIEW` unset, creates two users via `POST /auth/users`, asserts both can authenticate via `POST /auth/login/pin`, and asserts the lifespan `_refuse_unsupported_deployment_mode` (`main.py:177-208`) does **not** raise.

### Why pin this invariant
- The D3-R-2 invariant (`main.py:178-188`) says `deployment_mode='single'` is for **single-tenant**, not **single-user**. Two users in single-mode is allowed and intended (kiosk shared by family / squad). A future tightening that conflated tenancy with cardinality would silently break the multi-user kiosk story.
- U6-ID-H1 + U6-ID-H3 in `docs/PHASE1_CONTEXTS.md:144` flagged the historical risk that the audit's RFC could be misread as "single user only". The test is the executable spec that prevents that misread.
- The `_refuse_unsupported_deployment_mode` guard is invoked at lifespan startup; the test must use `TestClient` with the real lifespan (no `_lifespan_disabled` shim) so the assertion is end-to-end.

### Test sketch (block IDB-1 ships full code)
```python
# src/backend/tests/test_single_mode_allows_multi_user.py
def test_single_mode_creates_two_users_no_invariant_raise(monkeypatch):
    monkeypatch.delenv("PHANTOM_ALLOW_MULTI_TENANT_PREVIEW", raising=False)
    monkeypatch.setattr(config, "deployment_mode", "single")
    with TestClient(app) as client:                 # ← lifespan must run
        # 1) ROOT auto-login is loopback (TestClient passes is_loopback_host)
        root_token = _bootstrap_root(client)
        # 2) create two new users
        u1 = client.post("/api/auth/users", json={"username":"alice","pin":"111111","role":"OPERATOR"},
                         headers={"Authorization": f"Bearer {root_token}"})
        u2 = client.post("/api/auth/users", json={"username":"bob","pin":"222222","role":"OPERATOR"},
                         headers={"Authorization": f"Bearer {root_token}"})
        assert u1.status_code == 201 and u2.status_code == 201
        # 3) both authenticate
        assert client.post("/api/auth/login/pin", json={"username":"alice","pin":"111111"}).status_code == 200
        assert client.post("/api/auth/login/pin", json={"username":"bob","pin":"222222"}).status_code == 200
        # 4) D3-R-2 invariant did NOT raise → app is up
```

### Invariants
- Test runs with the **default** config (no env overrides) so it pins the *as-shipped* behaviour.
- Test MUST NOT use `PHANTOM_ALLOW_MULTI_TENANT_PREVIEW=1` — that's the multi-tenant escape hatch, not the multi-user one. The whole point of IDB-1 is that multi-user works **without** that flag.

---

## 6. ADR-IDB-002 — Shared-PIN guard on `POST /api/auth/users`

### Decision
Before `db.add(user)` at `routes_auth.py:430`, scan all existing users with a non-NULL `pin_hash` and `verify_secret(req.pin, existing.pin_hash)` against each. On match, return HTTP 409 with body `{"error": "shared_pin_forbidden", "existing_username": "<masked>"}` (where the existing username is masked to first character + `***` to avoid revealing enrolled identities to a ROOT user enumerating PIN collisions across tenants). Throws no exception when `req.pin is None` (PIN-less RFID-only users are still allowed).

### Why O(N) bcrypt is fine
- N is small. PHANTOM is a dual-node kiosk; the operator's mental model is 1-5 users, the ceiling is "household / squad" (~50). At ~50 ms per `_bcrypt_lib.checkpw` call (`security/auth.py:34-39`), worst-case scan is 50 × 50 ms = **2.5 s** at user-create time. User creation is a once-per-week ROOT-only flow; latency budget is generous.
- An indexed lookup is impossible by construction: bcrypt salts each hash uniquely, so two identical PINs produce two different hashes. The O(N) scan is the only correct algorithm.
- Above ~50 users, the ROOT operator either (a) accepts the latency or (b) opts into the Day-5 "PIN cardinality vs uniqueness" knob (out of scope this phase).

### Concrete diff envelope (block IDB-2)
```python
# routes_auth.py — inside create_user, after the username-uniqueness check
if req.pin is not None:
    existing_users = (await db.execute(
        select(User).where(User.pin_hash.is_not(None))
    )).scalars().all()
    for existing in existing_users:
        if verify_secret(req.pin, existing.pin_hash):
            masked = (existing.username[:1] + "***") if existing.username else "***"
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"error": "shared_pin_forbidden", "existing_username": masked},
            )
```
Pydantic schema for the error response: `interface SharedPinError { error: "shared_pin_forbidden"; existing_username: string }` mirrored in `src/shared/types/auth.ts` (NEW).

### Why mask the username
- `_user_to_dict` (`routes_auth.py:39-61`) leaks `preferences` + `behavioral_model` to ROOT — ROOT seeing usernames is fine, but an attacker who got ROOT could enumerate "which usernames have which PIN" by iterating PIN strings. Masking limits the leak to *first letter*; combined with the 5-attempt lockout (`config.security_max_pin_attempts`) and bcrypt cost, the attack rate-limits to nothing useful.
- Masking is a single line; full-disclosure mode is operator-configurable Day-5 if needed.

### Invariants
- Guard MUST run BEFORE `db.add` so a colliding row never lands in the DB.
- Guard MUST NOT raise when `req.pin is None` (RFID-only users).
- Guard MUST NOT call itself recursively / from `update_user` Day-4 — `PUT /users/{id}` PIN rotation is out of scope for IDB-2 and is handled by a follow-up block.

---

## 7. ADR-IDB-003 — `GET /api/auth/users/picker` route

### Decision
Add a new public-ish read-only route `GET /api/auth/users/picker` returning `[{ id: str, username: str, avatar_url: str | None }]`. Excludes `pin_hash`, `rfid_uid_hash`, `preferences`, `behavioral_model`, `role`, `last_seen_at`, `created_at` — every field the existing `_user_to_dict` (`routes_auth.py:39-61`) currently returns is **whitelisted out**.

### Why a separate route (not reuse `_user_to_dict`)
- `_user_to_dict` is the FACTS-1 leak source flagged as **U6-ID-C2** in `docs/PHASE1_CONTEXTS.md:186`. The picker route MUST NOT call it.
- The picker is consumed pre-auth (the React `<UserPicker>` shows BEFORE PinPad), so the response must be safe to expose to any LAN client. Today's `/auth/users` requires `require_root` — the picker can't.
- Threat model: an attacker on the LAN can enumerate usernames + avatar URLs. That's acceptable — the kiosk is by design a public-facing piece of furniture, and the avatar URLs are the pictures sitting on the lock screen anyway. **No** PIN hash, **no** RFID hash, **no** behavioral data on the wire.

### Concrete diff envelope (block IDB-2)
```python
@router.get("/users/picker", response_model=None)
async def list_users_picker(db: AsyncSession = Depends(get_db)) -> list[dict]:
    """Public-ish: minimal user tiles for the LoginScreen picker.
    Does NOT require auth (the picker is shown PRE-auth)."""
    # Day-5 toggle deferred: order = last-seen DESC so the operator-most-
    # recent user is the leftmost tile.
    result = await db.execute(select(User).order_by(User.last_seen_at.desc()))
    return [
        {"id": u.id, "username": u.username, "avatar_url": u.avatar_url}
        for u in result.scalars().all()
    ]
```
The route lives on `router` (the public `/auth` prefix), NOT on `users_router` (the ROOT-gated `/auth/users` prefix), so the auth dependency tree stays correct. Endpoint URL is `/api/auth/users/picker` — note the `/users/` segment is part of the path under the `/auth` prefix, not a sibling of `users_router`.

### Rate limiting
- Day-4 ships no rate limit on this route — it's a read of <50 rows, identical idempotent response. If Day-5 enrols the kiosk in a public WAN deployment, the F-15 / D3-A-2 lockout machinery (`routes_auth.py:115-184`) extends naturally.

### Invariants
- Returned dicts MUST contain only `id`, `username`, `avatar_url`. Adding any new field is a breaking ADR.
- Route MUST NOT call `_user_to_dict` (that's the field-leak source).
- Route MUST NOT require auth — that breaks the pre-login picker flow.

---

## 8. ADR-IDB-004 — `<UserPicker>` React component on LoginScreen

### Decision
A new component `src/frontend/src/components/auth/UserPicker.tsx` shows when `users.length > 1` OR `auto_login_user_id` was refused (e.g. default-PIN-rotation case `security/auth.py:142-150`). Surfaces BEFORE `PinPad`. Each tile is a 44×44 minimum touch target (per CLAUDE.md rule #2) showing avatar + username; tap pre-fills the username input and reveals the PinPad. Picker order = last-seen-first (the API already returns this ordering per ADR-IDB-003); a settings toggle is deferred to Day-5.

### Why this UX (not a `<select>`)
- 1024×600 capacitive touch (CLAUDE.md rule #3) — `<select>` dropdowns drop a native menu that's tiny and ergonomically wrong.
- Avatar tiles map to the `avatar_url` already in `_user_to_dict` (and in the picker DTO).
- The `<UserPicker>` is **opt-in** — when only one user exists (default ROOT `phantom`), the picker hides and `LoginScreen.tsx:23` keeps its current `useState('phantom')` default. That preserves the existing single-user kiosk UX for the 70% deployment.

### Verification of "no UserPicker today"
- `grep -rn "UserPicker\|user-picker" src/frontend/` returns zero hits — confirmed.
- `LoginScreen.tsx:23` hard-codes `useState('phantom')` and the username `<input>` (lines 287-306) is the only entry. The picker is genuinely new code.

### Concrete diff envelope (block IDB-3)
- NEW `src/frontend/src/components/auth/UserPicker.tsx` (~140 LOC):
  - Fetches `GET /api/auth/users/picker` on mount.
  - Renders a horizontal scroll-snap row of tiles (each 88×112 px = 44×44 active region + label, well above touch minimum) when `users.length > 1`.
  - On tap, calls a `onSelect(username)` prop that the parent (`LoginScreen`) wires to `setUsername`.
  - Auto-focuses the PinPad first cell after select (UX continuity).
- EDIT `src/frontend/src/components/auth/LoginScreen.tsx`:
  - Replace the hard-coded `useState('phantom')` with `useState<string | null>(null)` and gate the PinPad render on `username !== null`.
  - When `users.length === 1`, auto-set username to that single user's name (preserves single-user UX).
  - When `users.length > 1`, render `<UserPicker onSelect={setUsername} />` ABOVE the PinPad; on select, the picker collapses and the PinPad takes the same screen real-estate.
- EDIT `src/frontend/src/services/api.ts` — add `authApi.usersPicker()` returning `{ id, username, avatar_url }[]`.

### Layout invariant (CLAUDE.md rule #4)
- 1024×600 has zero overflow risk: 5 tiles × 88px = 440px ≤ 460px card width (line 187 of `LoginScreen.tsx`). For 6+ users the row scroll-snaps horizontally (`overflow-x-auto`, `scroll-snap-type: x mandatory`), still no vertical overflow. Settings UI overflow is W-3b's problem; the picker stays clean here.

### Invariants
- Tile tap target MUST be ≥ 44×44 px (CLAUDE.md rule #2). The 88×112 wrapper exceeds the requirement.
- Picker MUST NOT show when `users.length === 1` (preserves single-user kiosk UX).
- Picker MUST NOT call any auth-required endpoint pre-login (only `/auth/users/picker` is allowed before PinPad).

---

## 9. Interfaces (frozen for Day-5)

### Python — `voice/stt_engine.py`
```python
@dataclass
class STTResult:
    text: str
    confidence: float
    engine: STTEngineName  # Literal["whisper","vosk","noop","whisper_npu","mms_npu"]
    language: str
    engine_error: Optional[str] = None
    speaker_id: Optional[str] = None      # ← Day-4 addition (ADR-ID-001)

    def to_dict(self) -> dict:
        out: dict = {
            "text": self.text,
            "confidence": self.confidence,
            "engine": self.engine,
            "language": self.language,
        }
        if self.engine_error:
            out["engine_error"] = self.engine_error
        if self.speaker_id is not None:    # ← additive on the wire
            out["speaker_id"] = self.speaker_id
        return out
```

### Python — `voice/identity/resolver.py` (NEW)
```python
def resolve_speaker(audio: bytes, sample_rate: int) -> Optional[str]:
    """Day-4: returns None unconditionally. Frozen signature per ADR-ID-002."""
```

### Python — `db/models.py` — `ChatMessage`
```python
class ChatMessage(Base):
    __tablename__ = "chat_messages"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(ForeignKey("chat_sessions.id"), nullable=False)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    speaker_user_id: Mapped[Optional[str]] = mapped_column(    # ← NEW
        ForeignKey("users.id"), nullable=True, index=True
    )
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    # … remaining columns unchanged …
```

### TypeScript — `src/shared/types/voice.ts` (NEW)
```typescript
export type STTEngineName = 'whisper' | 'vosk' | 'noop' | 'whisper_npu' | 'mms_npu';

export interface Transcript {
  text: string;
  confidence: number;
  engine: STTEngineName;
  language: string;
  speaker_id: string | null;
  engine_error?: string;
}
```

### TypeScript — `src/shared/types/auth.ts` (NEW or extension)
```typescript
export interface UserPickerEntry {
  id: string;
  username: string;
  avatar_url: string | null;
}

export interface SharedPinError {
  error: 'shared_pin_forbidden';
  existing_username: string;     // first letter + '***'
}
```

---

## 10. Test plan per block

### ID-1 — `STTResult.speaker_id` field + Transcript shared type (60 LOC)
- `tests/test_stt_engine.py` (extend or new): instantiate `STTResult(text="x", confidence=0.5, engine="noop", language="uk")` → assert `speaker_id is None`.
- Same test: assert `to_dict()` does NOT include the key when `None`; assert `to_dict()` DOES include `"speaker_id": "u-123"` when set.
- Frontend: `npm run typecheck` proves the new `Transcript` type imports cleanly.
- Acceptance: existing voice WS test (`test_voice_ws_*` if present, otherwise manual smoke) sees identical JSON payload for the no-op case (back-compat invariant).

### ID-2 — `voice/identity/resolver.py` no-op + frozen interface (80 LOC)
- `tests/test_voice_identity_resolver.py` (NEW): import `resolve_speaker`; assert `resolve_speaker(b"", 16_000) is None`; assert `resolve_speaker(b"\x00" * 32_000, 16_000) is None` (1 s of silence).
- Signature pin test: `inspect.signature(resolve_speaker)` returns `(audio: bytes, sample_rate: int) -> Optional[str]` — fails CI if Day-5 changes the shape without updating this test.
- Performance: see §11 budget — `pytest -k speaker_perf` measures 10k calls and asserts wall-clock < 1 s (i.e. p99 ≤ 100 µs).

### ID-3 — `ChatMessage.speaker_user_id` column + migration (110 LOC)
- `tests/test_chat_message_speaker_column.py` (NEW): boot `init_db`, create a `ChatMessage` with `speaker_user_id=None` → row commits. Create one with `speaker_user_id=<some-user-uuid>` → row commits. Create one with a non-existent UUID → FK violation raises (depends on SQLite FK enforcement; if disabled in test config, assert at insert with explicit foreign-key check).
- Idempotency test: run the lifespan ALTER twice → second run is a no-op (no duplicate-column error).
- Strategic-memory writer regression: existing tests for chat persistence continue to pass — `speaker_user_id` left NULL is the Day-4 contract.

### IDB-1 — pytest pinning multi-user under deployment_mode=single (90 LOC)
- See §5 "Test sketch" — full code in the block delivers it.
- Negative control: a sibling test sets `deployment_mode='multi'` AND no `PHANTOM_ALLOW_MULTI_TENANT_PREVIEW` → `RuntimeError` raised by `_refuse_unsupported_deployment_mode`.
- Acceptance: D3-R-2 invariant remains active for the multi case AND inert for single+multiple-users.

### IDB-2 — shared-PIN guard + `/users/picker` route (140 LOC)
- `tests/test_shared_pin_guard.py` (NEW): create user A with PIN `123456`; attempt to create user B with the same PIN → 409 + body `{"error": "shared_pin_forbidden", "existing_username": "a***"}`.
- Guard absent for RFID-only: create user C with `pin=None, rfid_uid="..."` → 201.
- `tests/test_users_picker.py` (NEW): GET `/api/auth/users/picker` without auth → 200, list of `{id, username, avatar_url}` only. Assert keys do NOT include `pin_hash`, `preferences`, `behavioral_model`, `role`.
- Ordering test: create three users, last-seen each in a known order, assert picker returns in last-seen DESC.

### IDB-3 — `<UserPicker>` React + LoginScreen integration (220 LOC)
- `vitest`: `UserPicker.test.tsx` (NEW) — renders 3 fake users → 3 tiles; tap on second tile invokes `onSelect("bob")`.
- Touch target test: assert each tile's bounding box ≥ 44×44 (via getBoundingClientRect on rendered DOM).
- Single-user case: `UserPicker` does not render when payload returns 1 user.
- Integration: `LoginScreen.test.tsx` updated — when `usersPicker` returns 2 users, picker is visible; PinPad hidden until select; after select, PinPad visible with username pre-filled.

---

## 11. Performance budgets

| Hot path | Target | Justification |
|---|---|---|
| `resolve_speaker` no-op (Day-4) | **p99 ≤ 100 µs** per call | Pure-Python: one `logger.debug` (no-op when level ≥ INFO) + one `return None`. 10k calls in <1 s on Radxa A78 is a safe budget. Day-5 ML will be in the 5-50 ms range and run inside `asyncio.to_thread`. |
| `voice/pipeline.py::transcribe_blob` Day-4 added overhead | **0 ns** | Day-4 doesn't call resolver. Day-5: +50 µs Python overhead before ML inference dominates. |
| `POST /auth/users` shared-PIN scan | **O(N) bcrypt × 50 ms** | At N=50 → 2.5 s worst case. User creation is once-per-week ROOT flow; latency acceptable. Alternative (faster hash) breaks bcrypt's brute-force cost; rejected. |
| `GET /auth/users/picker` | **p99 ≤ 50 ms** | Single `SELECT * FROM users ORDER BY last_seen_at DESC` — at N=50 returns in <5 ms even on SQLite. |
| `STTResult.to_dict` field-add overhead | **+1 dict-key check (≤ 100 ns)** | Mirrors existing `engine_error` pattern at `stt_engine.py:113-114`. |

Measurement harness: `pytest -k speaker_perf` for resolver; existing `tests/test_phase_audit_2026_04_29_h3_h4.py` style for the route latency probes.

---

## 12. Back-compat invariants

1. **Existing voice WS clients ignoring `speaker_id` keep working.** The field is omitted when `None` (`STTResult.to_dict`), and JSON parsers ignore unknown keys when present. Validated by ID-1 acceptance test.
2. **Existing `single`-mode boot with 1 user is unchanged.** `auto_login_user_id` → `get_auto_login_user` (`security/auth.py:126-150`) → still returns the single ROOT when default-PIN is rotated. The picker is gated on `users.length > 1`.
3. **`auto_login_user_id` config knob is unchanged.** No new config keys ship Day-4 in the identity-recognition cluster. Day-5 may add `voice.identity.enabled`, `voice.identity.threshold`, etc. — out of scope.
4. **`deployment_mode='single'` continues to allow N users.** IDB-1 is the executable spec.
5. **`_user_to_dict` is unchanged.** The picker route uses an inline whitelist and does NOT touch the shared serialiser. The U6-ID-C2 leak that FACTS-1 closes is independent of this cluster's work.
6. **ChatMessage existing rows keep working.** `speaker_user_id` is nullable; existing data remains valid; no backfill required Day-4.
7. **No prompt-builder change.** Day-5's "AI knows who is talking" feature is out of scope; Day-4 only persists the identity, doesn't surface it to the model.
8. **No ContextEngine change.** The hook is in `voice/pipeline.py`, never in `core/context_engine.py`.
9. **`STTResult.engine_error` semantics preserved.** `speaker_id` is independent — an engine error still 503s, regardless of speaker resolution.
10. **No ML weight files ship Day-4.** The `voice/identity/` directory contains only the resolver stub (no `models/`, no `weights/`, no `*.onnx`). Day-5 introduces the binary blobs under a new ADR.

---

## 13. Cross-cluster contracts

- **chat-liveness** (Cluster 1): consumes `Transcript.speaker_id` for the future "identity-card scene" in W-2's `ChatScene` composer. Day-4: scene_kind picker (W-2c) is identity-blind. Day-5: the W-2 composer reads `speaker_id` from the WS frame and renders an `identity_card` scene preset.
- **profile-cards** (FACTS-1 cluster): consumes `ChatMessage.speaker_user_id` for `UserFact` attribution. Day-4: writers leave NULL. Day-5: when an LLM-extracted fact lands during a turn where `speaker_user_id != user_id`, the fact attaches to the *speaker*, not the *holder*.
- **ai-hub** (Cluster 4): `prompt_builder.py` (`src/backend/ai/prompt_builder.py`) is **not** edited Day-4. Day-5 may add a `speaker_line` section keyed on `speaker_user_id`.
- **dynamic-source-picker** (W-4): produces a "speaker-id models" dynamic source for the Day-5 settings UI. Day-4 reserves the resolver name `voice.identity.model` but ships no resolver.

---

## 14. Unblock list

- Day-5 ML drop-in: edit ONE function body (`resolve_speaker`) + drop ONE weight file under `voice/identity/models/`. No call-site changes.
- Day-5 strategic memory writer: read `STTResult.speaker_id`, populate `ChatMessage.speaker_user_id` at chat-message-commit. No ORM change.
- Day-5 chat-liveness identity-card scene: read `speaker_id` from the existing voice WS frame. No backend route change.

---

## 15. Out of scope (Day-5+ only)

- Day-5: actual ECAPA-TDNN / WeSpeaker / Resemblyzer model weights + `resolve_speaker` body.
- Day-5: enrolment UX (the Settings → "Enrol my voice" flow that records 3-5 utterances and writes a centroid embedding).
- Day-5: identity-card chat scene (W-2 preset).
- Day-5: prompt-builder `speaker_line` injection.
- Day-5: per-speaker `behavioral_model` updates.
- Day-5: PIN rotation guard on `PUT /auth/users/{id}` (the create-time guard ships Day-4; rotation is a sibling block).
- Day-5: settings toggle for picker order (last-used vs alphabetical).
- Day-5+: the "JWT-holder copy" semantics decision (whether `speaker_user_id := user_id` for text input + voice with no match) — explicitly deferred per ADR-ID-004.
