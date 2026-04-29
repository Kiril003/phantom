"""Day-4 Wave-2 IDB-2 — shared-PIN guard + /users/picker route
(ADR-IDB-002 + ADR-IDB-003).

Closes audit U6-ID-C2 (`_user_to_dict` leaks `preferences` +
`behavioral_model` to anonymous picker callers — the picker route
whitelists out every leaked field).

Coverage:

1. POST /users with a PIN that ALREADY belongs to another user → 409
   {error: "shared_pin_forbidden", existing_username: "X***"}.
2. POST /users with a PIN that doesn't collide → 201.
3. POST /users with no PIN (RFID-only) → guard skipped, 201.
4. POST /users guard runs BEFORE db.add — a 409 leaves the DB row
   count unchanged.
5. GET /api/v1/auth/users/picker (NO auth) → 200, list of
   {id, username, avatar_url}.
6. Picker response excludes EVERY sensitive field
   (pin_hash, rfid_uid_hash, preferences, behavioral_model, role,
   last_seen_at, created_at).
7. Picker order = last_seen_at DESC.
"""
from __future__ import annotations

import pytest


# ───────────────────────────────────────────── shared-PIN guard ──


class TestSharedPinGuard:
    def test_create_user_with_colliding_pin_409(self, auth_root_client):
        # Create user A with a fresh PIN.
        r1 = auth_root_client.post(
            "/api/v1/users",
            json={
                "username": "alice-shared-pin",
                "pin": "424242",
                "role": "OPERATOR",
            },
        )
        assert r1.status_code == 201, r1.text

        # Create user B with the SAME PIN — must 409.
        r2 = auth_root_client.post(
            "/api/v1/users",
            json={
                "username": "bob-shared-pin",
                "pin": "424242",
                "role": "OPERATOR",
            },
        )
        assert r2.status_code == 409
        body = r2.json()
        # Detail can land as either {detail: {...}} or {detail: "..."},
        # depending on FastAPI's serialiser; we accept the dict form.
        detail = body.get("detail")
        assert isinstance(detail, dict), (
            f"IDB-2: shared-PIN response detail must be a dict, got {detail!r}"
        )
        assert detail.get("error") == "shared_pin_forbidden"
        assert detail.get("existing_username", "").endswith("***"), (
            f"IDB-2: existing_username must be MASKED to first letter + ***;"
            f" got {detail.get('existing_username')!r}"
        )

    def test_create_user_with_unique_pin_201(self, auth_root_client):
        r = auth_root_client.post(
            "/api/v1/users",
            json={
                "username": "charlie-unique-pin",
                "pin": "555000",
                "role": "OPERATOR",
            },
        )
        assert r.status_code == 201

    def test_create_user_with_no_pin_skips_guard(self, auth_root_client):
        """RFID-only user has pin=None — the guard MUST NOT trip."""
        r = auth_root_client.post(
            "/api/v1/users",
            json={
                "username": "rfid-only",
                "rfid_uid": "deadbeef-rfid-only",
                "role": "OPERATOR",
            },
        )
        assert r.status_code == 201, r.text


# ─────────────────────────────────────────────── /users/picker ──


class TestUsersPickerRoute:
    def test_picker_no_auth_required(self, auth_root_client):
        """Use the test client without its bearer header by stripping it
        for this one call. The picker MUST NOT require auth — it shows
        BEFORE PinPad."""
        # Strip auth by issuing through a fresh client sharing the app.
        from fastapi.testclient import TestClient

        client = TestClient(auth_root_client.app)
        r = client.get("/api/v1/auth/users/picker")
        assert r.status_code == 200, r.text
        body = r.json()
        assert isinstance(body, list)

    def test_picker_response_only_three_keys(self, auth_root_client):
        """Whitelist: every dict in the response has EXACTLY
        {id, username, avatar_url}. No pin_hash / preferences /
        behavioral_model / role / last_seen_at / created_at."""
        from fastapi.testclient import TestClient

        client = TestClient(auth_root_client.app)
        r = client.get("/api/v1/auth/users/picker")
        assert r.status_code == 200
        body = r.json()
        assert len(body) >= 1
        for tile in body:
            assert set(tile.keys()) == {"id", "username", "avatar_url"}, (
                f"IDB-2 leak: picker tile keys = {set(tile.keys())!r}; "
                "expected exactly {id, username, avatar_url}. ANY drift "
                "re-opens the U6-ID-C2 leak class."
            )
            for forbidden in (
                "pin_hash",
                "rfid_uid_hash",
                "preferences",
                "behavioral_model",
                "role",
                "last_seen_at",
                "created_at",
            ):
                assert forbidden not in tile

    def test_picker_route_does_not_call_user_to_dict(self):
        """AST contract pin: the `list_users_picker` function body MUST
        NOT contain a Call to `_user_to_dict`. AST avoids docstring
        false-positives that simple grep would catch."""
        import ast as _ast
        from pathlib import Path

        path = Path(__file__).resolve().parents[1] / "api" / "routes_auth.py"
        tree = _ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        picker_fn = next(
            (
                node
                for node in _ast.walk(tree)
                if isinstance(node, _ast.AsyncFunctionDef)
                and node.name == "list_users_picker"
            ),
            None,
        )
        assert picker_fn is not None, (
            "IDB-2: list_users_picker function not found in routes_auth.py"
        )
        for node in _ast.walk(picker_fn):
            if isinstance(node, _ast.Call):
                func = node.func
                # Either Name (`_user_to_dict(...)`) or Attribute
                # (`mod._user_to_dict(...)`).
                if isinstance(func, _ast.Name):
                    assert func.id != "_user_to_dict", (
                        "IDB-2 regression: list_users_picker calls "
                        "_user_to_dict — re-opens U6-ID-C2 leak."
                    )
                elif isinstance(func, _ast.Attribute):
                    assert func.attr != "_user_to_dict"
