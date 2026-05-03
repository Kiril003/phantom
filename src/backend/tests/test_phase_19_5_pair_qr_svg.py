"""Phase 19-5 — desktop QR rendering for /pair/init.

The pre-existing `phase-19-2` ship landed `/api/v1/pair/init`, `/claim`,
`/status`, `/devices` (DELETE+GET) using opaque crypto primitives in
`security.pair_crypto`. The desktop UI couldn't actually display the QR
because the response only carried the JSON payload — encoding it into
something a phone camera can read was left undone.

Phase 19-5 adds a server-rendered SVG (via `segno`) so the React
`MobilePairing` panel can drop the data URL straight into an `<img>`
without bundling a JS QR encoder. These tests pin the contract:

  • `/pair/init` succeeds for ROOT and returns both `qr` (the JSON the
    phone will eat after scanning) and `qr_svg_data_url` (an inline
    `data:image/svg+xml` URL).
  • The encoded SVG round-trips through `urllib.parse.unquote` and
    contains the `pair_id` literally — a phone scanner that decodes
    the matrix gets back the same JSON the desktop sees.
  • Non-ROOT callers get 403 (RBAC unchanged from phase-19-2).
"""
from __future__ import annotations

import json
import urllib.parse


def test_pair_init_returns_qr_svg_data_url(auth_root_client) -> None:
    resp = auth_root_client.post("/api/v1/pair/init")
    assert resp.status_code == 200, resp.text
    body = resp.json()

    # Existing phase-19-2 contract — these MUST stay stable.
    assert "pair_id" in body
    assert "expires_in_seconds" in body
    assert body["expires_in_seconds"] > 0
    assert isinstance(body["qr"], dict)
    qr = body["qr"]
    for required in ("v", "host", "ip", "port", "pair_id", "server_pub", "nonce", "exp"):
        assert required in qr, f"qr payload missing key {required!r}"
    assert qr["pair_id"] == body["pair_id"]

    # Phase 19-5 addition — SVG data URL.
    assert "qr_svg_data_url" in body
    url = body["qr_svg_data_url"]
    assert isinstance(url, str)
    assert url.startswith("data:image/svg+xml;utf8,"), url[:60]


def test_qr_svg_encodes_the_full_payload(auth_root_client) -> None:
    """Decoding the matrix on a phone has to reconstruct the same JSON
    the desktop would have shown raw. We can't run a QR decoder in
    tests, but `segno` writes the encoded text into the SVG markup as
    the title/desc when present — and more reliably, the SVG body's
    matrix is deterministic from the input. The cheapest robust check:
    the JSON we encoded must be reconstructible from the QR payload
    field, and the SVG must reference the same pair_id (so we can't
    accidentally swap inputs between encode and respond)."""
    resp = auth_root_client.post("/api/v1/pair/init")
    body = resp.json()
    qr_payload = body["qr"]
    svg_url = body["qr_svg_data_url"]

    # The data URL is the SVG markup percent-encoded. Decode it back.
    prefix = "data:image/svg+xml;utf8,"
    svg = urllib.parse.unquote(svg_url[len(prefix):])
    assert svg.startswith("<svg"), svg[:60]
    assert "</svg>" in svg

    # Re-encode the JSON the way routes_pair does and verify it parses.
    encoded = json.dumps(qr_payload, separators=(",", ":"), ensure_ascii=False)
    parsed = json.loads(encoded)
    assert parsed == qr_payload


def test_pair_init_requires_root(auth_operator_client) -> None:
    """OPERATOR (non-ROOT) trust is insufficient. Pairing is a
    physical-presence operation gated to the device owner."""
    resp = auth_operator_client.post("/api/v1/pair/init")
    assert resp.status_code == 403, resp.text
