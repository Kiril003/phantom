# PHANTOM OS — `ai-hub` Cluster Architecture (Day-4 Phase-2)

**Cluster owner**: `ai-hub` + `npu-utilisation` (PHASE1_CONTEXTS.md:89-101).
**Day-4 blocks**: Z-1 (skel), Z-2 (skel), Z-3 (skel), Z-4 (skel), Z-5 (skel) — see PHASE1_BLOCK_ORDER.md:60-69.
**Default posture**: hub registry online from Day-4, **routing decisions are observational** until consumers opt in. The chat hot-path (`api/routes_chat.py` → `ai/chat_pipeline.run` → `ai_router.generate`) is **not** rerouted Day-4. The single integration seam is the new `chat_orchestrator` (cluster `agent-orchestration`, X-1) which is itself behind `chat_orchestrator_enabled=False`.
**Threat coverage**: closes nothing critical Day-4 (this is *capability surface*); enables Day-5 NPU-embedding offload (`src/backend/memory/strategic_memory.py:234-241` MiniLM-on-CPU → MiniLM-on-NPU) without touching call sites.

The cluster lives entirely under `src/backend/ai/hub.py` (NEW), `src/backend/ai/hub_telemetry.py` (NEW), `src/backend/api/routes_hub.py` (NEW). It does **not** import from `agent.runtime`, `agent.proactive`, `agent.actions` — keeps TM-17B-E4 invariant.

---

## ADR-HUB-001 — AIHub is a PEER of AIRouter (not a wrapper) on Day-4

**Decision**. `AIHub` is a *capability registry + dispatch router* that sits **alongside** `AIRouter` (`src/backend/ai/provider.py:100-129`), not in front of it. The hub registers `gemini` and `ollama` as **two of N** providers in its capability table; when the hub picks one of those, dispatch delegates back to the existing `ai_router.generate` / `ai_router.call_with_tools` so the cooling/quota/backoff state machine (`src/backend/ai/provider.py:653-740`) remains the single source of truth for provider health.

**Rationale**. The router's resilience policy (cooling 60 s post-rate-limit, quota lock until UTC midnight, per-provider backoff) is encoded across `_mark_cooling`, `_mark_quota_exhausted`, `_is_provider_available`, `_compute_backoff` (`src/backend/ai/provider.py:711-740`). Wrapping the router would either:
1. Force the hub to mirror this state — guaranteed drift the moment the router gains a new error class (we already saw this risk in `_classify_provider_exception`, `src/backend/ai/provider.py:794-830`), or
2. Make the hub a thin pass-through, which adds latency without adding routing power.

A **peer** layout means the hub owns provider *capabilities* (what tasks each can do, at what locality / latency tier), and the router owns provider *availability* (cooling, quota, last-call summary). The hub's `pick()` consults router state via the read-only `ai_router.router_state_snapshot()` accessor (`src/backend/ai/provider.py:756-772`) before returning a handle, but never mutates it.

**Consequences**.
- `AIHub.dispatch(task_class="chat" | "chat_subtask", payload, ...)` for a Gemini/Ollama pick returns a handle that calls `ai_router.generate(...)` — preserving `task_id`, `user_id`, `BlockedQuotaError` propagation (`src/backend/ai/provider.py:37-47`).
- `AIHub.dispatch(task_class="stt", ...)` for an `npu` pick (Day-5) calls a different backend (`MMSNPUProvider` / `WhisperNPUProvider` from `src/backend/voice/mms_npu_provider.py:88-310` and `src/backend/voice/whisper_npu_provider.py:155-425`). The router is never invoked for STT.
- The existing `phantom_ai_router_fallthrough_total` counter (`src/backend/observability.py:289-294`) is **unchanged** — it still increments only when the router itself falls through primary→fallback (`src/backend/ai/provider.py:253-258`). Hub-level decisions get their own counter family (ADR-HUB-004).
- The lazy singleton pattern in `src/backend/ai/provider.py:921-933` is mirrored: `from ai.hub import ai_hub` materialises a module-level `AIHub` on first attribute access.

---

## ADR-HUB-002 — `ProviderCapability` is the registration unit

**Decision**. The hub's registry stores immutable `ProviderCapability` records. One provider may register multiple capabilities (e.g. Gemini for `chat` AND `chat_subtask`). The schema is intentionally small Day-4 — every field is needed by the locality-first policy (ADR-HUB-003) or by `/api/v1/hub/providers` (ADR-HUB-005).

**Schema**.

| field | type | notes |
|---|---|---|
| `provider` | `str` | Stable name (`gemini`, `ollama`, `npu`, `mms_npu`, `whisper_npu`). Matches `AIRouter._providers` keys for LLM cases. |
| `task_class` | `Literal["chat", "chat_subtask", "embeddings", "stt", "vision"]` | What kind of work this entry advertises. `chat_subtask` is the X-1 orchestrator's leaf-call slot (`docs/architecture/agent-orchestration.md:13-27`). `vision` is reserved for Day-5+. |
| `modality` | `Literal["text", "audio", "image", "embeddings"]` | Coarse I/O type. Lets a future picker reject "ask Gemini to do CTC on raw audio" mismatches. |
| `latency_ms_p50` | `float` | **Estimated** Day-4 (`gemini=1200`, `ollama=400` text generation; `mms_npu=80`, `whisper_npu=900` STT-encoder; `npu-embeddings=15`). Day-5 replaces the constants with measured EMA from `hub_telemetry.observe_dispatch(elapsed_ms=...)`. |
| `quality_tier` | `Literal["fast", "balanced", "best"]` | Operator-visible knob. `best` = quality-prioritised (Gemini chat, Whisper STT). `fast` = latency-prioritised (Ollama chat, MMS STT). `balanced` = the default fallback. |
| `locality` | `Literal["local", "remote"]` | The keystone of ADR-HUB-003. `gemini` = `remote`; `ollama` / all NPU paths = `local`. |
| `available` | `bool` | Static availability — toggled by registration logic, not by per-call cooling. NPU-embeddings registers `available=False` Day-4 (ADR-NPU-001). |

**Rationale**. The schema is a `@dataclass(frozen=True)` so it is hashable and shareable across threads. We resist the temptation to pack mutable runtime fields (current cooldown, last error) into it — those live with `AIRouter` (LLM) or with the provider object itself (STT). Capability records describe *what is true at registration*; *what is true now* is queried separately at `pick()` time.

**Anti-pattern rejected**. We do not collapse `task_class` and `modality` into a single field. Two providers can share modality (`gemini` and `ollama` both `text`) but advertise different `task_class`es — Gemini may register `chat` + `chat_subtask`, while Ollama registers only `chat` Day-4 because of the TM-17B-S2 Gemini-only gate on the orchestrator boundary (`docs/architecture/agent-orchestration.md:13-27`).

---

## ADR-HUB-003 — Locality-first policy stub for Day-4

**Decision**. `AIHub.pick(task_class, *, prefer="auto")` walks the registry filtered to `task_class` and `available=True`, and applies this rule:

1. If `prefer="local"`: return the cheapest `locality="local"` capability by `latency_ms_p50`. Raise `NoCapabilityError` if none.
2. If `prefer="remote"`: return the cheapest `locality="remote"` capability by `latency_ms_p50`. Raise if none.
3. If `prefer="auto"` (default):
   1. Prefer any `locality="local"` capability whose underlying provider is *currently* available. For `provider in {"gemini","ollama"}` "currently available" means `ai_router._is_provider_available(provider)` is True (`src/backend/ai/provider.py:685-701`); for NPU providers it means the registration-time `available=True` (no per-call cooling state Day-4).
   2. Otherwise return the cheapest **available** capability by `latency_ms_p50`, regardless of locality.
   3. If no capability is currently available, raise `NoCapabilityError` rather than handing back a known-broken handle.

**Rationale**. The product principle is "live AI on custom hardware" (CLAUDE.md "Що це"). Locality-first is the architectural expression of that — when the NPU bundle for embeddings lands Day-5, it inherits routing for free without any chat or memory call site changing. Day-4 the policy has no NPU consumers (`npu-embeddings` registers `available=False`), so all `task_class="chat" | "chat_subtask"` picks resolve to Gemini or Ollama via the router's *own* primary/fallback choice — the hub *honours* the router rather than overriding it. The policy is intentionally a **stub**: it does not yet weight `quality_tier` or per-user trust state. Day-5 will add `prefer="quality"` once measured latency replaces the constants.

**Tie-break**. Equal `latency_ms_p50` + equal `available` → registration order. Stable, easy to explain in `/api/v1/hub/route_state` decisions.

**Consequences**.
- The `chat_orchestrator` (Z-4) calls `hub.pick(task_class="chat_subtask")`. Day-4 the registry guarantees this returns a Gemini handle when Gemini is up (the only `chat_subtask` registrant), and either an Ollama handle or `NoCapabilityError` when Gemini is cooling. The orchestrator's existing Gemini-only gate (`docs/architecture/agent-orchestration.md:13-27`) interprets the latter as "fall through to single-turn", so the hub does not need to know about TM-17B-S2 itself.
- `pick()` is **read-only** w.r.t. `AIRouter` state. A user-driven `/api/v1/hub/providers` GET does not perturb cooling.

---

## ADR-HUB-004 — Telemetry counters

**Decision**. Two new counters in `src/backend/observability.py`, shaped like the existing `ai_provider_used_total` / `ai_router_fallthrough_total` (lines 283-294):

```python
ai_hub_dispatch_total = Counter(
    "phantom_ai_hub_dispatch_total",
    "AIHub dispatch count by provider, task_class, decision.",
)
# labels: provider in {gemini, ollama, npu, mms_npu, whisper_npu}
#         task_class in {chat, chat_subtask, embeddings, stt, vision}
#         decision in {pick_local, pick_remote, pick_auto_local,
#                       pick_auto_remote, no_capability, blocked_router}

ai_hub_route_decision_total = Counter(
    "phantom_ai_hub_route_decision_total",
    "AIHub route changes — picked from→to with reason.",
)
# labels: from in {none, gemini, ollama, npu, ...}
#         to   in same set
#         reason in {first_pick, locality_preference, router_unavailable,
#                    quality_tier_match, fallback_local}
```

**Rationale**. `dispatch_total` answers "how often did each provider serve each task class" — operational. `route_decision_total` answers "how often did the picker change its mind from one call to the next" — diagnostic. The two counters together let an operator distinguish "Gemini is serving 95 % of chats" (dispatch) from "the hub flips between Gemini and Ollama on every other call" (route_decision). The `reason` label is closed (six values) so PromQL queries don't explode in cardinality.

**Increment sites**. `ai/hub.py:dispatch()` increments `ai_hub_dispatch_total{provider, task_class, decision}` exactly once per call (success or blocked). `ai/hub.py:pick()` increments `ai_hub_route_decision_total{from, to, reason}` only when the chosen provider differs from the previous call for that `task_class` (tracked per-process in `_last_pick_by_class: dict[str, str]`).

**Anti-cardinality clamp**. Counters are not labelled with `task_id` or `user_id` — those would explode the metric. Per-call detail is in `route_state` (ADR-HUB-005), not in `/metrics`.

**Hooks**. Increments are imported lazily inside `dispatch()` exactly as `_sync_context` does in `src/backend/ai/provider.py:786-791` — so an `observability` import error never breaks a chat turn.

---

## ADR-HUB-005 — REST surface: `/api/v1/hub/providers` + `/api/v1/hub/route_state`

**Decision**. Two new GET endpoints under `src/backend/api/routes_hub.py` (NEW). Both require `get_current_user` (the project standard, see `src/backend/api/routes_settings.py:471-484` Day-2 D2-A2 closure of audit F-09).

### `GET /api/v1/hub/providers`
Returns the live registry snapshot — every `ProviderCapability` row + the *current* `available_now` field computed by re-checking router state at request time.

```jsonc
{
  "providers": [
    {
      "provider": "gemini",
      "task_class": "chat",
      "modality": "text",
      "latency_ms_p50": 1200.0,
      "quality_tier": "best",
      "locality": "remote",
      "registered_available": true,
      "available_now": true,       // re-evaluates ai_router cooling/quota
      "unavailable_reason": null   // mirrors AIRouter._unavailable_reason
    },
    { "provider": "ollama", "task_class": "chat", ... },
    { "provider": "gemini", "task_class": "chat_subtask", ... },
    { "provider": "npu", "task_class": "embeddings",
      "registered_available": false, "available_now": false,
      "unavailable_reason": "bundle_not_compiled" },
    ...
  ],
  "snapshot_at": "2026-04-29T03:11:00+00:00"
}
```

### `GET /api/v1/hub/route_state?limit=50`
Returns the last N pick decisions (default 50, max 200). Acts as the operator-visible debug log for routing.

```jsonc
{
  "decisions": [
    {
      "at": "2026-04-29T03:11:42.114+00:00",
      "task_class": "chat_subtask",
      "prefer": "auto",
      "picked": "gemini",
      "reason": "locality_preference",
      "fallback_chain": ["gemini", "ollama"],
      "task_id": "chat-7f...",     // pass-through if caller supplied it
      "elapsed_ms": null            // filled by dispatch's matching observe()
    },
    ...
  ],
  "ring_capacity": 200,
  "ring_used": 50
}
```

**Rationale**. Mirrors the `/api/v1/agent/router_state` design (the existing AIRouter snapshot accessor at `src/backend/ai/provider.py:756-772`). An operator reading `/hub/route_state` immediately after a complaint of "wrong provider" can see the last 50 picks without parsing logs. Cardinality is bounded by an in-memory `collections.deque(maxlen=200)` — no DB write, no log shipping.

**Storage shape**. The decision ring is a `deque[dict]` on the `AIHub` instance — same memory cost class as `_last_call_summary` in the router (`src/backend/ai/provider.py:128`). It is reset on process restart; this is intentional, not a regression — operators wanting persistent decision history should subscribe to the `/metrics` counters.

**Auth**. Both routes are `Depends(get_current_user)`. They expose registry info that, while not a secret, would let an unauthenticated probe enumerate the deployment's NPU posture — explicitly avoided per the project's "secret features = native behaviour" principle (CLAUDE.md rule 6).

---

## ADR-HUB-006 — Single integration seam: chat_orchestrator (Z-4)

**Decision**. The only Day-4 caller of `hub.pick()` is the X-1 `chat_orchestrator` at the leaf-allocation site. Specifically, `ai/agents/orchestrator.py` (NEW per `docs/architecture/agent-orchestration.md:13-27`) consumes `hub.pick(task_class="chat_subtask")` once per leaf when allocating sub-agent runners. **No other Day-4 call site calls the hub.**

**Why this is safe**. `chat_orchestrator_enabled` defaults to `False` (PHASE1_CONTEXTS.md:77, agent-orchestration.md ADR-ORC-001), so the orchestrator does not run on the chat hot-path Day-4. The hub is therefore *registered, instrumented, and reachable via `/api/v1/hub/*`* but is **not in any production request path**. This is the productisation discipline: ship the seam, gate the consumer.

**Rationale**. Trying to retrofit `chat_pipeline.run` (`src/backend/ai/chat_pipeline.py:82-199`) to call `hub.pick(task_class="chat")` Day-4 would:
1. Require a uniform `dispatch(payload=...)` envelope across `chat`, `chat_subtask`, `stt`, etc. — premature given that `chat_pipeline.run` already passes `system_prompt`, `user_message`, `history`, `tools`, `task_id`, `user_id` directly to `ai_router.call_with_tools`.
2. Open a regression surface for the Day-3 chat-tool dispatcher hardening (`docs/architecture/agent-orchestration.md` ADR-ORC-003 leaf-then-merge sanitize) before Day-4 has any value to add.

Z-4 is **30-40 LOC** because it is a single import + a single call-site swap inside `ai/agents/orchestrator.py:run()` — the orchestrator already needs to choose a provider per leaf, and `hub.pick(...)` simply replaces a hard-coded `ai_router.get_provider(config.ai_primary_provider)`.

**Consequences**.
- Day-5 work to route embeddings (`memory/strategic_memory.py:234-241`) through the hub is a *separate* integration block. It will replace `_get_ef()`'s `SentenceTransformerEmbeddingFunction(model_name=config.embedding_model)` with `await hub.dispatch(task_class="embeddings", payload={"texts": [...]})`.
- The chat hot-path retains its direct `ai_router.generate` invariant. The hub is observable via `/api/v1/hub/providers` from Day-4 even though only the orchestrator consumes it — this is intentional so Day-5 work has a populated registry to inspect in dev/staging.

---

## ADR-NPU-001 — Reserve NPU-embeddings slot Day-4 (`available=False`)

**Decision**. At hub bootstrap, register exactly one NPU capability:

```python
ProviderCapability(
    provider="npu",
    task_class="embeddings",
    modality="embeddings",
    latency_ms_p50=15.0,        # estimate from MiniLM-L6-v2 INT8 on Hexagon
    quality_tier="fast",
    locality="local",
    available=False,            # bundle does not exist Day-4
)
```

**Rationale**. `npu-utilisation` cluster (PHASE1_CONTEXTS.md:98-101) ships **30 LOC of skeleton** Day-4. The whole point is to **reserve the slot in the registry** so Day-5's NPU-embedding bundle becomes a one-liner flip (`available=True`) plus a real dispatch handler. Today the call:

```python
hub.pick(task_class="embeddings", prefer="local")  # Day-4 → NoCapabilityError
hub.pick(task_class="embeddings", prefer="auto")    # Day-4 → NoCapabilityError
```

raises `NoCapabilityError` — which is explicitly the right answer Day-4 because **no Day-4 caller asks the hub for embeddings**. The current MiniLM CPU path in `src/backend/memory/strategic_memory.py:234-241` is unchanged.

**Anti-pattern rejected**. We do not register a CPU MiniLM fallback as `provider="cpu"` Day-4. That would:
1. Rebuild the singleton at `_get_ef` (`memory/strategic_memory.py:234-241`) which is already module-level.
2. Make Day-5 feel like "we replaced CPU with NPU" rather than "we *added* NPU"; the locality-first policy is then philosophically muddled.

When Day-5 lands, two registrations co-exist: `provider="npu"` (`available=True`) AND `provider="minilm_cpu"` (`available=True`, latency `~80`, `locality="local"`). `pick(prefer="auto")` returns NPU; if NPU encounters a runtime error the dispatch layer handles fall-through to the CPU registrant — same shape as `AIRouter._available_sequence`.

**Consequences**.
- The Day-4 `/api/v1/hub/providers` response includes the NPU row with `available_now=false, unavailable_reason="bundle_not_compiled"`. This is operator-visible documentation that "embeddings on NPU" is a known *intended* slot, not an accidental omission.
- Z-5 (PHASE1_BLOCK_ORDER.md:69, 30 LOC) is exactly: declare the dataclass instance, call `hub.register(...)` from a Z-1 bootstrap function, write a single `tests/test_hub_npu_slot.py` asserting the slot exists with `available=False`. No code path actually dispatches to it.

---

## Interfaces (Python)

```python
# src/backend/ai/hub.py
from __future__ import annotations
from dataclasses import dataclass
from typing import Literal, Protocol


class NoCapabilityError(RuntimeError):
    """Raised by AIHub.pick() when no registered capability matches the
    requested task_class/preference. Distinct from BlockedQuotaError
    (ai/provider.py:37) — the hub cannot retroactively make a capability
    appear; the caller must downgrade or surface the error."""


@dataclass(frozen=True)
class ProviderCapability:
    provider: str
    task_class: Literal["chat", "chat_subtask", "embeddings", "stt", "vision"]
    modality: Literal["text", "audio", "image", "embeddings"]
    latency_ms_p50: float
    quality_tier: Literal["fast", "balanced", "best"]
    locality: Literal["local", "remote"]
    available: bool


class ProviderHandle(Protocol):
    """Returned by AIHub.pick(). Opaque to callers; AIHub.dispatch() is
    the supported invocation surface. Exposed only so type-aware tests
    can assert non-None without importing internal classes."""
    capability: ProviderCapability
    def __repr__(self) -> str: ...


class AIHub:
    def __init__(self) -> None: ...

    def register(self, capability: ProviderCapability) -> None:
        """Idempotent registration. Re-registering a (provider, task_class)
        pair overwrites — supports Day-5 'flip available=True' without a
        process restart. Raises ValueError on schema-invalid records."""

    def pick(
        self,
        task_class: str,
        *,
        prefer: Literal["auto", "local", "remote"] = "auto",
    ) -> ProviderHandle:
        """Resolve a capability for `task_class` per ADR-HUB-003. Raises
        NoCapabilityError if no available match. Mutates the
        per-task_class last-pick tracker so route_decision_total fires
        only on changes."""

    async def dispatch(
        self,
        task_class: str,
        payload: dict,
        *,
        task_id: str | None = None,
        prefer: Literal["auto", "local", "remote"] = "auto",
    ) -> dict:
        """Single dispatch entry-point. Internally:
            handle = self.pick(task_class, prefer=prefer)
            result = await self._invoke(handle, payload, task_id=task_id)
            self._record_dispatch(handle, result)
            return result
        For provider in {gemini, ollama} delegates to ai_router.generate /
        call_with_tools (preserves cooling, BlockedQuotaError, task_id
        budget). For NPU/STT providers calls the corresponding provider
        object's transcribe/encode method."""

    def list_providers(self) -> list[ProviderCapability]:
        """Snapshot of every registered ProviderCapability. Used by
        GET /api/v1/hub/providers."""

    def route_state(self, *, limit: int = 50) -> list[dict]:
        """Last N decisions from the in-memory ring (max 200). Used by
        GET /api/v1/hub/route_state."""


# Lazy module-level singleton — same pattern as ai/provider.py:921-933
_AI_HUB_SINGLETON: AIHub | None = None
def __getattr__(name: str):
    global _AI_HUB_SINGLETON
    if name == "ai_hub":
        if _AI_HUB_SINGLETON is None:
            _AI_HUB_SINGLETON = AIHub()
            _bootstrap_default_capabilities(_AI_HUB_SINGLETON)
        return _AI_HUB_SINGLETON
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
```

**Bootstrap registrations Day-4** (called from `_bootstrap_default_capabilities`):

| provider | task_class | modality | latency_ms_p50 | quality_tier | locality | available |
|---|---|---|---|---|---|---|
| `gemini` | `chat` | `text` | 1200 | `best` | `remote` | `True` |
| `gemini` | `chat_subtask` | `text` | 1200 | `best` | `remote` | `True` |
| `ollama` | `chat` | `text` | 400 | `balanced` | `local` | `True` |
| `npu` | `embeddings` | `embeddings` | 15 | `fast` | `local` | **`False`** (ADR-NPU-001) |

`mms_npu` and `whisper_npu` STT slots are **not** registered Day-4 — STT routing already lives in `voice/stt_engine.build_stt_provider` and the hub does not yet have a consumer for `task_class="stt"`. Z-5 is strictly the embeddings slot.

---

## Test plan per block

### Z-1 — `AIHub` class + `ProviderCapability` + locality-first stub (220 LOC, skel)
- `tests/test_hub_registration.py`:
  - `register` accepts a valid `ProviderCapability`; rejects bad `task_class` / `quality_tier` literals via `dataclass`+`Literal` runtime check.
  - Re-registration overwrites and does not double-emit `route_decision_total`.
  - `list_providers()` returns the bootstrap rows in registration order.
- `tests/test_hub_pick.py`:
  - Empty registry → `pick("chat")` → `NoCapabilityError`.
  - With Gemini+Ollama for `chat`, `prefer="local"` returns Ollama; `prefer="remote"` returns Gemini; `prefer="auto"` returns Ollama (locality-first).
  - With Gemini available + Ollama `available=False`, `prefer="auto"` returns Gemini — fallback past locality preference.
  - Monkey-patch `ai_router._is_provider_available` to return `False` for `gemini` → `pick(task_class="chat_subtask", prefer="auto")` raises `NoCapabilityError` (Gemini is the only `chat_subtask` registrant Day-4).
- `tests/test_hub_pick_perf.py`:
  - 10 000 `pick("chat")` calls complete in < 10 ms total → confirms the < 1 ms p99 budget is comfortable.

### Z-2 — `/api/v1/hub/providers` + `/hub/route_state` routes (110 LOC, skel)
- `tests/test_routes_hub.py` (uses the authenticated TestClient fixture from `tests/conftest.py`, see commit `fdb28f7` H-1+H-2):
  - Unauthed call → 401.
  - Authed `GET /api/v1/hub/providers` → 200, contains four bootstrap rows with `available_now` reflecting current router state.
  - `GET /api/v1/hub/route_state?limit=200` → 200, `ring_capacity=200`, decisions list bounded by limit.
  - `limit=999` → 422 (FastAPI validator on the Query param `le=200`).
  - After two `pick()` calls in-process, `/hub/route_state` reflects exactly two entries, newest-first.

### Z-3 — Settings UI placeholder card "AI Hub" (180 LOC, skel)
- `tests/test_settings_ai_hub_card.py`:
  - `CATEGORY_SPEC` (`src/backend/api/routes_settings.py:101-285`) contains a new `id="ai_hub"` entry with `label="AI Hub"`, icon, and `keys=[]` (virtual category, like `"about"` at line 280-284).
  - `GET /api/v1/settings` returns the new category in its response with `settings=[]`.
- Frontend test (`src/frontend/src/components/settings/__tests__/AIHubCard.test.tsx`):
  - Card renders provider rows fetched from `/api/v1/hub/providers` with `available_now` indicator and `unavailable_reason` tooltip.
  - "Refresh" button re-issues the GET; loading state visible.

### Z-4 — Orchestrator consumes `hub.pick(task_class)` (40 LOC, skel)
- `tests/test_orchestrator_hub_seam.py`:
  - With `chat_orchestrator_enabled=False` (default), `chat_pipeline.run` does NOT touch the hub — assert via `unittest.mock` that `ai_hub.pick` is not called for a normal chat turn.
  - With `chat_orchestrator_enabled=True` and Gemini available, `orchestrator.run()` calls `hub.pick(task_class="chat_subtask")` once per leaf; the returned handle's `capability.provider == "gemini"`.
  - With `chat_orchestrator_enabled=True` and Gemini cooling (router state mocked), `hub.pick` raises `NoCapabilityError` and the orchestrator gracefully degrades to single-turn (interaction with the Gemini-only gate from `docs/architecture/agent-orchestration.md` ADR-ORC-001).
- `tests/test_chat_pipeline_unchanged.py`:
  - Hot-path regression — chat turn end-to-end still calls `ai_router.generate` directly (count==1 via mock). The router fall-through counter `phantom_ai_router_fallthrough_total` is still the source of truth for primary→fallback.

### Z-5 — NPU-embeddings capability slot, `available=False` (30 LOC, skel)
- `tests/test_hub_npu_slot.py`:
  - After bootstrap, `list_providers()` contains exactly one row with `provider="npu" AND task_class="embeddings"`.
  - That row has `available=False AND locality="local" AND modality="embeddings"`.
  - `pick(task_class="embeddings", prefer="auto")` raises `NoCapabilityError` (no available embeddings provider).
  - `/api/v1/hub/providers` exposes the row with `available_now=false` and `unavailable_reason="bundle_not_compiled"`.

---

## Performance budgets

| operation | budget | rationale |
|---|---|---|
| `AIHub.register()` | p99 ≤ 50 µs | dict insertion + hashable dataclass. Called only at bootstrap (4 times Day-4) and Day-5 NPU flip (1 time). |
| `AIHub.pick()` | **p99 ≤ 1 ms** | linear scan over ≤ 8 capability rows, single read of `ai_router.router_state_snapshot()` (in-memory dict copy). Verified by `tests/test_hub_pick_perf.py` (Z-1). |
| `AIHub.list_providers()` | p99 ≤ 0.5 ms | `[dataclasses.asdict(c) for c in rows]` over ≤ 8 rows. |
| `AIHub.route_state(limit=50)` | p99 ≤ 0.5 ms | `list(islice(deque, 50))`. |
| `AIHub.dispatch()` | overhead **≤ 5 ms** vs direct `ai_router.generate(...)` | `pick()` (≤ 1 ms) + `_record_dispatch` increment (≤ 100 µs). Network/inference cost is the same — the hub does not add a hop. |

**Counter cost**. `Counter.inc(**labels)` (`src/backend/observability.py:224-228`) is `tuple(sorted(...))` + dict assignment — sub-microsecond per call. Two increments per dispatch = noise in the 5 ms budget.

**Ring memory**. `route_state` ring at maxlen=200 with ~250 bytes/dict ≈ 50 KB resident — negligible against the existing `_last_call_summary` and `_cooling` dicts in `AIRouter` (`src/backend/ai/provider.py:123-128`).

---

## Back-compat invariants

The hub is *additive*. Day-4 ship MUST preserve every one of these:

1. **Chat hot-path direct call**. `routes_chat.py` → `chat_pipeline.run` → `ai_router.generate` / `ai_router.call_with_tools` is unchanged. The hub is NOT inserted between `chat_pipeline.run` and `ai_router` Day-4. Z-4 only modifies the orchestrator branch (gated by `chat_orchestrator_enabled=False`).
2. **`phantom_ai_router_fallthrough_total` is unchanged**. The counter still increments only at the router's primary→fallback site (`src/backend/ai/provider.py:253-258`). The hub's own counters (ADR-HUB-004) are *additive*; they do not replace nor double-count the router fall-through metric. Operators with existing dashboards on `phantom_ai_router_fallthrough_total` see no regression.
3. **`phantom_ai_provider_used_total` is unchanged**. Still incremented in `AIRouter._sync_context` (`src/backend/ai/provider.py:786-791`). The hub neither competes with this counter nor invalidates it.
4. **`AIRouter.router_state_snapshot()` is unchanged**. The `/api/v1/agent/router_state` route continues to expose router-level cooling/quota/last-call state. The new `/api/v1/hub/route_state` is a SEPARATE concept (hub *picks*, not router *attempts*).
5. **`BlockedQuotaError` propagation is unchanged**. When the hub dispatches to a Gemini/Ollama handle and the router raises `BlockedQuotaError` (`src/backend/ai/provider.py:37-47`), the hub re-raises unchanged — the agent loop's catch in `agent.runtime` still sees the same exception type.
6. **ChromaDB embeddings remain on CPU MiniLM Day-4**. `memory/strategic_memory.py:234-241` `_get_ef()` is not touched. NPU-embeddings is a *Day-5* migration.
7. **Settings UI`CATEGORY_SPEC` ordering**. The new `ai_hub` category appends after `about` (or wherever the UI team places it) — does not reshuffle existing category indices, which are stable surfaces for the SettingsStore.
8. **No new ESP32 / firmware / serial dependencies**. The hub is pure backend Python.
9. **No new top-level Python deps**. `dataclasses`, `typing`, `collections.deque` are stdlib. The route module reuses FastAPI, Pydantic, and the auth dependency that already ship with `routes_settings`.
10. **Lifespan startup is non-blocking on hub bootstrap**. `_bootstrap_default_capabilities` is a synchronous dict-build — it does not import heavy modules (no `onnxruntime`, no `chromadb`). Cold-start cost is dominated by the singleton's first attribute access, which we expect after `/readyz` already serves green.
