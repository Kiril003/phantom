"""
Phase 9.2 — visual grounding + web.search tests.

Mocks Playwright pages and httpx HTTP response so the test suite is hermetic.
"""
from __future__ import annotations

import os
import textwrap
from unittest.mock import AsyncMock, MagicMock

import pytest

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase09-2-grw")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-api-key-for-tests")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


# ═════════════════════════════════════════════════════════════════════════════
# 1. ParsedElement + DOM parser fallback
# ═════════════════════════════════════════════════════════════════════════════


class TestParsedElement:
    def test_parsed_element_center(self):
        from vision.grounding import ParsedElement
        e = ParsedElement(type="button", bbox=(10, 20, 50, 80), text="OK", confidence=0.9)
        assert e.center() == (30, 50)

    def test_score_overlap_jaccard_weighting(self):
        from vision.grounding import ParsedElement, _score
        btn = ParsedElement(type="button", bbox=(0, 0, 1, 1),
                            text="Sign In", confidence=0.9)
        assert _score("the sign in button", btn) > 0.0
        cancel = ParsedElement(type="button", bbox=(0, 0, 1, 1),
                               text="Cancel", confidence=0.9)
        assert _score("the sign in button", cancel) == 0.0


# ═════════════════════════════════════════════════════════════════════════════
# 2. DomAccessibilityParser
# ═════════════════════════════════════════════════════════════════════════════


def _stub_page(dom_eval_result: list[dict] | None = None,
               a11y_snapshot: dict | None = None):
    page = MagicMock()
    page.accessibility = MagicMock()
    if a11y_snapshot is None:
        page.accessibility.snapshot = AsyncMock(return_value=None)
    else:
        page.accessibility.snapshot = AsyncMock(return_value=a11y_snapshot)
    page.evaluate = AsyncMock(return_value=dom_eval_result or [])
    page.mouse = MagicMock()
    page.mouse.click = AsyncMock(return_value=None)
    page.wait_for_load_state = AsyncMock(return_value=None)
    page.url = "http://test.local/after"
    return page


class TestDomParser:
    @pytest.mark.asyncio
    async def test_dom_walk_finds_button(self):
        from vision.grounding import DomAccessibilityParser
        page = _stub_page(dom_eval_result=[
            {"tag": "button", "text": "Submit", "x": 20, "y": 30, "w": 60, "h": 30},
            {"tag": "a", "text": "About", "x": 0, "y": 100, "w": 50, "h": 20},
        ])
        elements = await DomAccessibilityParser().parse(page=page)
        assert len(elements) == 2
        kinds = {e.type for e in elements}
        assert "button" in kinds and "link" in kinds

    @pytest.mark.asyncio
    async def test_dom_parser_unavailable_without_page(self):
        from vision.grounding import DomAccessibilityParser, GroundingUnavailable
        with pytest.raises(GroundingUnavailable):
            await DomAccessibilityParser().parse(page=None)


# ═════════════════════════════════════════════════════════════════════════════
# 3. OmniParserGrounder
# ═════════════════════════════════════════════════════════════════════════════


class TestGrounder:
    @pytest.mark.asyncio
    async def test_grounder_resolves_to_best_candidate(self):
        from vision.grounding import OmniParserGrounder
        page = _stub_page(dom_eval_result=[
            {"tag": "button", "text": "Submit", "x": 20, "y": 30, "w": 60, "h": 30},
            {"tag": "button", "text": "Cancel", "x": 100, "y": 30, "w": 60, "h": 30},
        ])
        g = OmniParserGrounder(min_confidence=0.0)
        x, y = await g.resolve_coords(
            description="the submit button",
            expected_type="button",
            page=page,
        )
        # center of the Submit button: (20+80)/2, (30+60)/2 = 50, 45
        assert (x, y) == (50, 45)

    @pytest.mark.asyncio
    async def test_grounder_raises_when_no_candidate_clears_floor(self):
        from vision.grounding import GroundingFailed, OmniParserGrounder
        page = _stub_page(dom_eval_result=[
            {"tag": "button", "text": "Cancel", "x": 0, "y": 0, "w": 10, "h": 10},
        ])
        g = OmniParserGrounder(min_confidence=0.5)
        with pytest.raises(GroundingFailed):
            await g.resolve_coords(
                description="the submit button",
                expected_type="button",
                page=page,
            )

    @pytest.mark.asyncio
    async def test_grounder_raises_when_no_page_and_omni_missing(self, monkeypatch):
        from vision.grounding import GroundingFailed, GroundingUnavailable, OmniParserGrounder
        g = OmniParserGrounder()
        with pytest.raises((GroundingFailed, GroundingUnavailable)):
            await g.resolve_coords(
                description="anything",
                expected_type="button",
                page=None,
            )


# ═════════════════════════════════════════════════════════════════════════════
# 4. browser.click_by_description action
# ═════════════════════════════════════════════════════════════════════════════


class TestBrowserClickByDescription:
    @pytest.mark.asyncio
    async def test_click_by_description_happy_path(self):
        from agent.actions.browser import BrowserClickByDescription
        from agent.actions.base import ActionContext
        from vision.grounding import OmniParserGrounder

        page = _stub_page(dom_eval_result=[
            {"tag": "button", "text": "Submit", "x": 20, "y": 30, "w": 60, "h": 30},
        ])
        runtime = MagicMock()
        runtime.browser_page = page
        # Permissive grounder so the DOM-walk's 0.7 weight times the
        # one-token Jaccard still resolves.
        runtime.grounder = OmniParserGrounder(min_confidence=0.1)

        action = BrowserClickByDescription(
            description="the submit button", expected_type="button"
        )
        ctx = ActionContext(task_id="t", step_idx=0, workspace_dir="/tmp", runtime=runtime)
        result = await action.execute(ctx)
        assert result.ok is True
        assert result.output["description"] == "the submit button"
        assert result.output["new_url"] == "http://test.local/after"
        assert page.mouse.click.await_count == 1

    @pytest.mark.asyncio
    async def test_click_by_description_no_active_page(self):
        from agent.actions.browser import BrowserClickByDescription
        from agent.actions.base import ActionContext

        runtime = MagicMock()
        runtime.browser_page = None
        action = BrowserClickByDescription(description="x")
        ctx = ActionContext(task_id="t", step_idx=0, workspace_dir="/tmp", runtime=runtime)
        result = await action.execute(ctx)
        assert result.ok is False
        assert result.error_class == "no_active_page"

    @pytest.mark.asyncio
    async def test_click_by_description_grounding_failed_propagates(self):
        from agent.actions.browser import BrowserClickByDescription
        from agent.actions.base import ActionContext
        from vision.grounding import GroundingFailed

        page = _stub_page(dom_eval_result=[])
        runtime = MagicMock()
        runtime.browser_page = page
        # Inject a grounder that always raises GroundingFailed
        class _Failer:
            async def resolve_coords(self, **_kw):
                raise GroundingFailed("nothing matched")
        runtime.grounder = _Failer()
        action = BrowserClickByDescription(description="missing")
        ctx = ActionContext(task_id="t", step_idx=0, workspace_dir="/tmp", runtime=runtime)
        result = await action.execute(ctx)
        assert result.ok is False
        assert result.error_class == "grounding_failed"


# ═════════════════════════════════════════════════════════════════════════════
# 5. web.search action
# ═════════════════════════════════════════════════════════════════════════════


_DDG_HTML_FIXTURE = textwrap.dedent("""
<!DOCTYPE html>
<html><body>
  <div class="result results_links results_links_deep">
    <a class="result__a" href="//html.duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa">Example A</a>
    <a class="result__snippet" href="https://example.com/a">First snippet about example A.</a>
  </div>
  <div class="result results_links results_links_deep">
    <a class="result__a" href="https://example.com/b">Example B</a>
    <a class="result__snippet" href="https://example.com/b">Second snippet B.</a>
  </div>
</body></html>
""")


class TestWebSearch:
    def test_parse_results_extracts_rows(self):
        from agent.actions.web import parse_results
        rows = parse_results(_DDG_HTML_FIXTURE, max_results=5)
        assert len(rows) == 2
        assert rows[0]["title"] == "Example A"
        assert rows[0]["url"] == "https://example.com/a"
        assert "First snippet" in rows[0]["snippet"]
        assert rows[1]["title"] == "Example B"

    @pytest.mark.asyncio
    async def test_web_search_returns_results(self, monkeypatch):
        from agent.actions.web import WebSearch
        from agent.actions.base import ActionContext

        class _Resp:
            text = _DDG_HTML_FIXTURE
            def raise_for_status(self):
                return None

        class _Client:
            async def __aenter__(self): return self
            async def __aexit__(self, *a): return None
            async def post(self, *a, **k): return _Resp()

        monkeypatch.setattr("agent.actions.web.httpx.AsyncClient",
                            lambda *a, **k: _Client())

        action = WebSearch(query="example", max_results=5)
        ctx = ActionContext(task_id="t", step_idx=0, workspace_dir="/tmp", runtime=None)
        result = await action.execute(ctx)
        assert result.ok is True
        assert result.output["count"] == 2
        assert result.output["results"][0]["title"] == "Example A"

    @pytest.mark.asyncio
    async def test_web_search_handles_network_error(self, monkeypatch):
        from agent.actions.web import WebSearch
        from agent.actions.base import ActionContext

        class _BadClient:
            async def __aenter__(self): return self
            async def __aexit__(self, *a): return None
            async def post(self, *a, **k):
                raise RuntimeError("network down")

        monkeypatch.setattr("agent.actions.web.httpx.AsyncClient",
                            lambda *a, **k: _BadClient())

        action = WebSearch(query="x", max_results=2)
        ctx = ActionContext(task_id="t", step_idx=0, workspace_dir="/tmp", runtime=None)
        result = await action.execute(ctx)
        assert result.ok is False
        assert "network down" in (result.error or "")
