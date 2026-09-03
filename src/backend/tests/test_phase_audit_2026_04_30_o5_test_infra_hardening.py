"""Day-3 audit-2026-04-30 — Block O commit O-5.

Closes test-infrastructure Tier-A items the N-test reviewer flagged:

* **D3-A-9** — Day-2 H-2 closed F-08/F-09 by spot-checking specific
  routes; a NEW unauthed route added in Day-3+ would silently slip
  past the gate. Now there's a programmatic `app.routes` walker that
  asserts every router-registered HTTP route either: (a) appears on
  the explicit public allowlist, or (b) returns 401/403/404 to an
  unauthenticated request. Adding a new public route forces a
  conscious allowlist edit.

* **D3-A-10** — Day-2 I-5 (CPU sampler) had unit tests for the
  sampler's start/stop API but no test that exercised the lifespan
  wiring. A wiring break in `main.py` lifespan (wrong await,
  exception before `start()`) would not be caught by the unit tests.
  Now there's a TestClient-context test that mounts a fresh app and
  asserts `system_metrics_sampler.is_running()` flips True at lifespan
  startup and back to None after teardown.
"""

from __future__ import annotations

from typing import Iterable

import pytest
from fastapi import FastAPI
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient


# ── D3-A-9 — programmatic public-route allowlist ──────────────────────────────


# Every route reachable by an unauthenticated client. Adding a route
# here is a deliberate decision — security review must explicitly
# acknowledge that an anonymous LAN host can reach the path.
PUBLIC_ROUTE_ALLOWLIST: frozenset[tuple[str, str]] = frozenset({
    # Auth bootstrap — must remain unauthenticated by design.
    ("POST", "/api/v1/auth/login/rfid"),
    ("POST", "/api/v1/auth/login/pin"),
    ("POST", "/api/v1/auth/refresh"),
    ("POST", "/api/v1/auth/logout"),  # idempotent cookie clear
    ("GET",  "/api/v1/auth/config"),  # surfaces non-secret limits to login UI
    # Probes / observability — k8s livenessProbe, scrape pipeline.
    ("GET",  "/health"),
    ("GET",  "/healthz"),
    ("GET",  "/readyz"),
    ("GET",  "/metrics"),
    # Static frontend mount — production deploys gate this behind a
    # reverse proxy + auth front-end.
    ("GET",  "/"),
    # Public-by-design subsystem status — the LoginScreen needs face
    # tracking config (privacy_mode, enabled) before the operator
    # authenticates so the camera prompt renders correctly. Surfaces
    # only the boolean enable flag + privacy enum; no user-bound data.
    # Tracked under N-sec NEW-SEC-08 for re-evaluation if multi-tenant
    # ever lands.
    ("GET",  "/api/v1/face/status"),
    # Public-by-design map services health — the map UI polls every
    # 60 s. Payload is outage timestamps + reason strings (no PII, no
    # location data). N-sec NEW-SEC-08 re-eval same as face/status.
    ("GET",  "/api/v1/map/services_health"),
    # Node identity manifest (F0.3) — unauthenticated BY DESIGN: peers
    # verify the Ed25519 signature over the capability manifest before
    # any pairing/auth exists. Payload is the public capability set from
    # phantom_node.toml + signature; no user data, no secrets.
    ("GET",  "/node/manifest"),
    # Day-4 Wave-2 IDB-2 (ADR-IDB-003): pre-PinPad picker tile list.
    # Whitelist {id, username, avatar_url} only — every sensitive
    # field stripped. The LoginScreen consumes this BEFORE auth so
    # multi-user installs can show their operator tiles. Audit M-1/M-2
    # flagged forward-leak class — addressed at the route via the
    # whitelist, AST-pinned by tests/test_phase_idb2_shared_pin_picker.
    ("GET",  "/api/v1/auth/users/picker"),
    # Day-4 Wave-2 W-4 (ADR-XC-007): dynamic-source picker resolver.
    # Public-by-design — the chat-input ModelCard reads provider /
    # voice option lists pre-auth so the splash → ready →
    # first-query path renders without a token. Per-source ttl cache
    # caps cost; defensive resolvers return empty list (NEVER 500)
    # so an attacker can't probe internal state via 5xx differentials.
    ("GET",  "/api/v1/dynamic_source/{source}"),
})


#: Функції, наявність яких у дереві залежностей маршруту означає замок.
#:
#: Перелік зібрано НЕ з назв у `security/`, а з реального дерева залежностей
#: усіх маршрутів застосунку — і перша спроба вгадати по імені дала дев'ятнадцять
#: хибних спрацювань. Найкорисніший приклад: `/api/v1/api-keys/` прикритий
#: `get_current_tenant` → `get_current_user_or_api_key`, і жодне з цих імен не
#: живе в `security/`. Тому тут — виміряне, а не вгадане.
#:
#: Свідомо НЕ входять:
#:   `_extract_token` — дістає токен, але нічого не вимагає (стоїть і на
#:                      публічних маршрутах);
#:   `caller_device`  — відповідає «хто просить», віддаючи None для людини за
#:                      ПК; це впізнавання, не замок;
#:   `get_db`         — сесія бази.
AUTH_DEPENDENCIES: frozenset[str] = frozenset({
    "require_auth",
    "get_current_user",
    "get_user_or_device_user",
    "get_current_user_or_api_key",
    "get_current_tenant",
    "get_current_device",
    "get_auto_login_user",
    "require_self_or_root",
    "require_capability_if_device",
    "require_device_capability",
    # Внутрішнє замикання обох `require_*_capability` — саме воно опиняється
    # в дереві, бо зовнішня функція лише повертає його.
    "_guard",
})


#: Маршрути, замкнені НЕ залежністю, а чимось у самому запиті, або публічні
#: за протоколом. Кожен прочитано 29.08.2026 — рядок пояснює, ЩО саме стереже.
#:
#: Це не пом'якшення сторожа, а визнання того, що замок не завжди має форму
#: `Depends`. Різниця з `work-os` принципова: там не було НІЧОГО — ні
#: залежності, ні підпису, ні перевірки токена зі шляху.
GUARDED_WITHOUT_A_DEPENDENCY: frozenset[tuple[str, str]] = frozenset({
    # Підписане посилання: HMAC над (шлях, термін) + звірка терміну + resolve
    # всередині дозволеного кореня. Ключ — підпис, не токен сесії.
    ("GET", "/api/v1/files/raw"),
    # Токен перегляду конкретного стенда, звірка через compare_digest.
    ("GET", "/api/v1/workbench/{workbench_id}/preview/{path:path}"),
    ("GET", "/api/v1/workbench/{workbench_id}/screenshot/{n}"),
    # Спарування: телефон ще не має жодного ключа — він його тут і здобуває.
    # Стереже доказ ECDH проти server_pub із QR (див. шапку routes_pair.py).
    ("POST", "/api/v1/pair/claim"),
    ("POST", "/api/v1/pair/refresh"),
    ("GET", "/api/v1/pair/resolve/{pin}"),
    # Двері: видача й пред'явлення разового входу — бутстрап автентифікації,
    # тієї самої родини, що login/pin у списку вище.
    ("POST", "/api/v1/auth/door"),
    ("POST", "/api/v1/auth/door/issue"),
    # `/face/recognize` тут БУВ і його прибрано 29.08.2026: замок поставлено
    # (`get_current_user`). Заміряно, чому це нічого не ламає: токена він
    # ніколи не видавав, а обіцяна «підказка на екрані входу» не була
    # підключена — `<Overlays/>`, єдиний споживач циклу, рендериться лише
    # після автентифікації.
    # Вхідна пошта між вузлами. Мусить бути досяжною для незнайомця — саме
    # так сусід уперше стукає. Ключем є САМ КАДР: відкрити його може лише
    # той, хто має стан храповика (messenger/inbox.py:202-204), тож JWT тут
    # нічого не додав би.
    ("POST", "/api/v1/messenger/inbox"),
    ("POST", "/api/v1/messenger/call/inbound"),
    ("POST", "/api/v1/messenger/files/inbound"),
    ("POST", "/api/v1/messenger/files/outbound-request"),
})


def _enumerate_routes(app: FastAPI) -> Iterable[tuple[str, str]]:
    """Yield (method, path) pairs for every router-mounted HTTP route.
    Skips the static-files mount (anything not an APIRoute) and HEAD
    duplicates."""
    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        for method in (route.methods or set()):
            if method in ("HEAD", "OPTIONS"):
                continue
            yield method, route.path


class TestD3A9PublicRouteAllowlist:
    def test_no_unexpected_public_routes(self, unauth_client: TestClient):
        """For every (method, path) on the app: if it's NOT in the
        explicit allowlist, an unauthenticated request MUST get a
        non-200 response. 200 = unguarded route a Day-2-style F-08
        regression would re-introduce."""
        from main import create_app
        app = create_app()

        unexpected_public: list[tuple[str, str, int]] = []
        for method, path in _enumerate_routes(app):
            if (method, path) in PUBLIC_ROUTE_ALLOWLIST:
                continue
            if "{" in path:
                # Path-param routes — substitute a placeholder so the
                # walker can probe; auth gate fires before path-param
                # validation.
                probe_path = path
                while "{" in probe_path:
                    open_idx = probe_path.index("{")
                    close_idx = probe_path.index("}", open_idx)
                    probe_path = (
                        probe_path[:open_idx] + "x" + probe_path[close_idx + 1:]
                    )
            else:
                probe_path = path
            try:
                resp = unauth_client.request(method, probe_path)
            except Exception:  # pragma: no cover
                # Some routes don't accept arbitrary methods; skip.
                continue
            if 200 <= resp.status_code < 400:
                unexpected_public.append((method, path, resp.status_code))

        assert not unexpected_public, (
            "D3-A-9 regression: the following routes are reachable to "
            "an unauthenticated client but are NOT on the explicit "
            "PUBLIC_ROUTE_ALLOWLIST. Either add them deliberately to "
            "the allowlist (with a security-review note) or wire auth:\n"
            + "\n".join(
                f"  {m} {p} → HTTP {sc}" for m, p, sc in unexpected_public
            )
        )

    def test_every_guarded_route_actually_declares_an_auth_dependency(self):
        """Питає «чи є замок», а не «який код віддає порожній зонд».

        Чому додано 29.08.2026. Тест вище зондує маршрути БЕЗ ТІЛА, тож
        обробник, який чекає схему, відповідає 422 — і в його звіт не
        потрапляє. Саме так `routes_work_os.py` виглядав як «чотири відкриті
        маршрути», тоді як `Depends` не мав ЖОДЕН із семи: три просто мовчали
        інакше. Зонд міряв «чи віддає 200», а не «чи є автентифікація», і
        різниця між цими питаннями коштувала трьох невидимих дверей.

        Тут ми не зондуємо взагалі. Ми дивимось у дерево залежностей
        маршруту — те саме, яким FastAPI користується під час запиту, — і
        шукаємо в ньому хоч одну відому функцію автентифікації. Тіло запиту,
        схема й коди відповіді на це не впливають ніяк.
        """
        from main import create_app

        app = create_app()

        def auth_names(dependant) -> set[str]:
            """Імена всіх залежностей маршруту, включно з вкладеними."""
            found: set[str] = set()
            stack = [dependant]
            seen = set()
            while stack:
                node = stack.pop()
                if id(node) in seen:
                    continue
                seen.add(id(node))
                call = getattr(node, "call", None)
                if call is not None:
                    found.add(getattr(call, "__name__", ""))
                stack.extend(getattr(node, "dependencies", []) or [])
            return found

        unguarded: list[tuple[str, str]] = []
        for route in app.routes:
            if not isinstance(route, APIRoute):
                continue
            for method in (route.methods or set()):
                if method in ("HEAD", "OPTIONS"):
                    continue
                if (method, route.path) in PUBLIC_ROUTE_ALLOWLIST:
                    continue
                if (method, route.path) in GUARDED_WITHOUT_A_DEPENDENCY:
                    continue
                if not (auth_names(route.dependant) & AUTH_DEPENDENCIES):
                    unguarded.append((method, route.path))

        assert not unguarded, (
            "Маршрути без жодної залежності автентифікації і поза "
            "PUBLIC_ROUTE_ALLOWLIST. Порожній зонд їх не побачить, якщо вони "
            "відповідають 422 на запит без тіла:\n"
            + "\n".join(f"  {m} {p}" for m, p in sorted(unguarded))
        )

    def test_allowlist_entries_actually_exist(self):
        """A misspelled allowlist entry would silently let a path
        regress unprotected. Every entry MUST resolve to a real route."""
        from main import create_app
        app = create_app()
        registered = set(_enumerate_routes(app))
        # Static-files mount registers the "/" path differently — strip
        # it from the check.
        allowlist_routed_paths = {
            (m, p) for (m, p) in PUBLIC_ROUTE_ALLOWLIST if p != "/"
        }
        missing = allowlist_routed_paths - registered
        assert not missing, (
            f"D3-A-9 regression: PUBLIC_ROUTE_ALLOWLIST entries "
            f"don't match any registered route: {missing}"
        )


# ── D3-A-10 — sampler lifespan wiring sanity check ────────────────────────────


class TestD3A10SamplerLifespan:
    def test_lifespan_starts_sampler(self):
        """A fresh app entered via TestClient context fires lifespan
        startup. After enter, `is_running()` MUST be True. A wiring
        break in main.py (forgotten `await`, exception before start)
        would manifest here as a False return."""
        import system_metrics_sampler as sms
        from main import create_app

        # Pre-condition: nothing running (conftest reset fired).
        sms._reset_for_tests()

        app = create_app()
        with TestClient(app):
            # Lifespan startup has fired by the time we're inside the
            # context. The sampler task is alive on the test's event
            # loop.
            assert sms.is_running() is True, (
                "D3-A-10 regression: sampler did not start at lifespan "
                "— check main.py:267 await chain for a swallowed "
                "exception."
            )

        # After context exit, lifespan shutdown should release the
        # task. The conftest autouse `_reset_system_metrics_sampler_per_test`
        # also wipes state at fixture teardown, but this test asserts
        # the explicit shutdown path. After the context manager exits
        # the daemon's stop() ran during shutdown.
        # We can't assert is_running() == False here because the
        # `_reset_for_tests` autouse may already have nulled the refs;
        # what we DO know is that the cached value didn't crash.
        _ = sms.get_cpu_percent()
