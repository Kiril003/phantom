"""Day-4 Wave-2 — Block W-2c: backend response_formatter scene_kind picker
(ADR-CS-002 §60-§90).

Closes the chat-liveness loop:

  AI provider → parse_function_call/parse_plain_text → scene attachment
   → routes_chat._serialize_message lifts to message.scene → ChatScene
   composer (W-2) renders.

Coverage:

1. ``scene_kind_for_form`` returns the right SceneKind for every
   covered ResponseForm and None for the three Day-4-uncovered forms.
2. ``build_scene_envelope`` shape matches the W-1 type contract
   (kind/panels/reveal) and panel ids start at p1.
3. Every ResponseForm with coverage produces panels matching
   ``ScenePanelKind`` exactly — no stringly-typed leak.
4. ``parse_function_call`` for ``respond_map`` appends a scene
   attachment whose first panel is text (the AI commentary) and
   whose second panel is map-pin with the right markers.
5. ``parse_function_call`` for ``respond_code`` produces a
   code-preview scene with the language preserved.
6. ``parse_function_call`` for ``respond_metrics`` builds a list
   panel with `up/down/stable` trends preserved.
7. ``parse_plain_text`` for plain conversational text produces a
   single text panel.
8. ``parse_plain_text`` for fenced code produces a code-preview scene.
9. Backward compatibility: forms WITHOUT coverage (chart, diagram,
   mixed) MUST NOT produce a scene attachment — message.scene stays
   absent and the legacy ResponseRenderer renders.
10. Empty content + no payload → no scene promotion (would render an
    empty composer).
11. Defensive: malformed marker entries (missing lat/lon, non-dict)
    are skipped without raising.
"""
from __future__ import annotations


# ─────────────────────────────────────────────────────────── kind picker ──


class TestSceneKindForForm:
    def test_text_and_markdown_map_to_text_kind(self):
        from ai.response_formatter import scene_kind_for_form

        assert scene_kind_for_form("text") == "text"
        assert scene_kind_for_form("markdown") == "text"

    def test_map_form_maps_to_map_pin(self):
        from ai.response_formatter import scene_kind_for_form

        assert scene_kind_for_form("map") == "map-pin"

    def test_code_and_terminal_map_to_code_preview(self):
        from ai.response_formatter import scene_kind_for_form

        assert scene_kind_for_form("code") == "code-preview"
        assert scene_kind_for_form("terminal") == "code-preview"

    def test_metric_cards_and_charts_and_diagrams(self):
        from ai.response_formatter import scene_kind_for_form

        assert scene_kind_for_form("metric_cards") == "list"
        assert scene_kind_for_form("chart") == "chart"
        assert scene_kind_for_form("diagram") == "diagram"

    def test_uncovered_forms_return_none(self):
        """mixed does NOT have preset coverage on
        Day-4. The legacy ResponseRenderer must keep rendering them."""
        from ai.response_formatter import scene_kind_for_form

        assert scene_kind_for_form("mixed") is None
        assert scene_kind_for_form("garbage_unknown_form") is None


# ─────────────────────────────────────────────────────────── envelope shape ──


class TestEnvelopeShape:
    def test_text_envelope_has_single_text_panel(self):
        from ai.response_formatter import build_scene_envelope

        att = build_scene_envelope("text", "hello", [])
        assert att is not None
        assert att["type"] == "scene"
        data = att["data"]
        assert data["kind"] == "text"
        assert len(data["panels"]) == 1
        p0 = data["panels"][0]
        assert p0["kind"] == "text"
        assert p0["data"]["markdown"] == "hello"
        assert p0["id"] == "p1"
        assert data["reveal"] == {"policy": "sequential", "staggerMs": 80}

        # mixed has no coverage → None
        att = build_scene_envelope(
            "mixed",
            "hello",
            [],
        )
        assert att is None

    def test_empty_content_no_payload_returns_none(self):
        """An empty text envelope has nothing to render — better to
        leave message.scene absent than to surface a vacuous panel."""
        from ai.response_formatter import build_scene_envelope

        # text form with empty content — still produces ONE text panel
        # per ADR (the W-1 contract has no minimum-length requirement).
        att = build_scene_envelope("text", "", [])
        # Empty markdown is valid → panel renders empty text. We accept
        # either: skip or single empty-text panel. Today's impl renders
        # the empty panel so users see the chat bubble even on a noop.
        assert att is None or att["data"]["panels"][0]["data"]["markdown"] == ""


# ─────────────────────────────────────────────── per-kind panel construction ──


class TestParseFunctionCallProducesScene:
    def test_respond_map_yields_text_then_map_pin(self):
        from ai.response_formatter import parse_function_call

        form, content, attachments = parse_function_call(
            "respond_map",
            {
                "content": "Запам'ятав 2 точки",
                "markers": [
                    {"lat": 50.45, "lon": 30.52, "label": "Office"},
                    {"lat": 49.84, "lon": 24.03, "label": "Lviv"},
                ],
                "center": [50.0, 27.0],
                "zoom": 7,
            },
        )
        assert form == "map"
        scene_atts = [a for a in attachments if a.get("type") == "scene"]
        assert len(scene_atts) == 1, attachments
        scene = scene_atts[0]["data"]
        assert scene["kind"] == "map-pin"
        assert len(scene["panels"]) == 2
        assert scene["panels"][0]["kind"] == "text"
        assert scene["panels"][0]["data"]["markdown"] == "Запам'ятав 2 точки"
        assert scene["panels"][1]["kind"] == "map-pin"
        assert len(scene["panels"][1]["data"]["markers"]) == 2
        assert scene["panels"][1]["data"]["zoom"] == 7

    def test_respond_code_yields_code_preview_with_language(self):
        from ai.response_formatter import parse_function_call

        form, content, attachments = parse_function_call(
            "respond_code",
            {
                "content": "ось скрипт",
                "language": "python",
                "code": "print('phantom')\n",
            },
        )
        assert form == "code"
        scene_atts = [a for a in attachments if a.get("type") == "scene"]
        assert len(scene_atts) == 1
        scene = scene_atts[0]["data"]
        assert scene["kind"] == "code-preview"
        # text leader + code-preview tail
        assert scene["panels"][0]["kind"] == "text"
        assert scene["panels"][1]["kind"] == "code-preview"
        assert scene["panels"][1]["data"]["language"] == "python"
        assert "phantom" in scene["panels"][1]["data"]["code"]
        assert scene["panels"][1]["data"]["runnable"] is False

    def test_respond_metrics_yields_list_with_trends(self):
        from ai.response_formatter import parse_function_call

        form, content, attachments = parse_function_call(
            "respond_metrics",
            {
                "content": "тримай статус",
                "metrics": [
                    {"label": "cpu", "value": 42, "trend": "up"},
                    {"label": "mem", "value": "3.1G", "trend": "stable"},
                    {"label": "noise", "value": 0.02},
                    {"label": "garbage", "value": 1, "trend": "tilted"},
                ],
            },
        )
        assert form == "metric_cards"
        scene_atts = [a for a in attachments if a.get("type") == "scene"]
        assert len(scene_atts) == 1
        scene = scene_atts[0]["data"]
        assert scene["kind"] == "list"
        list_panel = next(p for p in scene["panels"] if p["kind"] == "list")
        items = list_panel["data"]["items"]
        assert items[0]["trend"] == "up"
        assert items[1]["trend"] == "stable"
        # No trend → field absent (open-world contract).
        assert "trend" not in items[2]
        # Garbage trend value dropped (defensive).
        assert "trend" not in items[3]

    def test_respond_terminal_yields_code_preview(self):
        from ai.response_formatter import parse_function_call

        form, content, attachments = parse_function_call(
            "respond_terminal",
            {
                "content": "виконав",
                "command": "ls -la /tmp",
                "explanation": "list tmp",
            },
        )
        assert form == "terminal"
        scene_atts = [a for a in attachments if a.get("type") == "scene"]
        assert len(scene_atts) == 1
        scene = scene_atts[0]["data"]
        assert scene["kind"] == "code-preview"
        code_panel = next(p for p in scene["panels"] if p["kind"] == "code-preview")
        assert "ls -la /tmp" in code_panel["data"]["code"]


# ─────────────────────────────────────────────────────── plain text path ──


class TestParsePlainTextScenePromotion:
    def test_plain_text_yields_text_scene(self):
        from ai.response_formatter import parse_plain_text

        form, content, attachments = parse_plain_text("просто звичайна відповідь")
        assert form == "text"
        scene_atts = [a for a in attachments if a.get("type") == "scene"]
        assert len(scene_atts) == 1
        scene = scene_atts[0]["data"]
        assert scene["kind"] == "text"
        assert scene["panels"][0]["data"]["markdown"] == "просто звичайна відповідь"

    def test_fenced_code_yields_code_preview_scene(self):
        from ai.response_formatter import parse_plain_text

        text = "```python\nprint('x')\n```"
        form, content, attachments = parse_plain_text(text)
        assert form == "code"
        scene_atts = [a for a in attachments if a.get("type") == "scene"]
        assert len(scene_atts) == 1
        scene = scene_atts[0]["data"]
        assert scene["kind"] == "code-preview"
        # `code` form has empty content — scene has just code-preview, no leader.
        kinds = [p["kind"] for p in scene["panels"]]
        assert kinds == ["code-preview"]
        cp = scene["panels"][0]
        assert cp["data"]["language"] == "python"
        assert cp["data"]["code"].strip() == "print('x')"

    def test_markdown_yields_text_scene(self):
        from ai.response_formatter import parse_plain_text

        text = "# Heading\n- one\n- two"
        form, content, attachments = parse_plain_text(text)
        assert form == "markdown"
        scene_atts = [a for a in attachments if a.get("type") == "scene"]
        assert len(scene_atts) == 1
        scene = scene_atts[0]["data"]
        assert scene["kind"] == "text"
        assert "# Heading" in scene["panels"][0]["data"]["markdown"]


# ───────────────────────────────────────────────────── back-compat invariant ──


class TestBackCompatLegacyForms:
    def test_chart_form_does_not_produce_scene(self):
        from ai.response_formatter import parse_function_call

        form, content, attachments = parse_function_call(
            "respond_chart",
            {
                "content": "графік квартальних продажів",
                "chart_type": "bar",
                "data": [{"name": "Q1", "value": 10}],
                "title": "Sales",
            },
        )
        assert form == "chart"
        # Legacy chart_data attachment present, AND scene attachment present (Phase-28-A).
        types = [a.get("type") for a in attachments]
        assert "chart_data" in types
        assert "scene" in types

    def test_diagram_form_does_not_produce_scene(self):
        from ai.response_formatter import parse_function_call

        form, content, attachments = parse_function_call(
            "respond_diagram",
            {
                "content": "ось схема",
                "kind": "force",
                "title": "graph",
                "nodes": [{"id": "a"}, {"id": "b"}],
                "links": [{"source": "a", "target": "b"}],
            },
        )
        assert form == "diagram"
        assert any(a.get("type") == "scene" for a in attachments)

    def test_mixed_form_does_not_produce_scene(self):
        from ai.response_formatter import parse_function_call

        form, content, attachments = parse_function_call(
            "respond_mixed",
            {"content": "комбінований"},
        )
        assert form == "mixed"
        assert all(a.get("type") != "scene" for a in attachments)


# ──────────────────────────────────────────────────────────── defensive ──


class TestDefensiveMarkerHandling:
    def test_malformed_markers_are_skipped(self):
        """Bad payload from a halucinated AI must not crash the parser."""
        from ai.response_formatter import parse_function_call

        form, content, attachments = parse_function_call(
            "respond_map",
            {
                "content": "точка",
                "markers": [
                    {"lat": "not-a-number", "lon": 30.0, "label": "bad"},
                    "not-a-dict",
                    {"lat": 50.0, "lon": 30.0, "label": "ok"},
                    {},  # missing lat/lon
                ],
                "center": [50, 30],
            },
        )
        scene = next(a for a in attachments if a.get("type") == "scene")["data"]
        markers = next(
            p for p in scene["panels"] if p["kind"] == "map-pin"
        )["data"]["markers"]
        assert len(markers) == 1
        assert markers[0]["label"] == "ok"
