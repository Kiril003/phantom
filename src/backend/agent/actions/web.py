"""
web.search — DuckDuckGo HTML interface, no API key required.

Returns up to `max_results` of {title, url, snippet}. Phase 9.2 unlocks
"find X on the internet" flows without spinning up the full Playwright
browser when a couple of links + snippets is all the agent needs.
"""
from __future__ import annotations

import re
import time
from html import unescape
from typing import ClassVar
from urllib.parse import parse_qs, unquote, urlparse

import httpx
from pydantic import Field

from ..schemas import ActionResult, Precondition, RiskLevel
from .base import Action, ActionContext


_DDG_HTML_URL = "https://html.duckduckgo.com/html/"
_USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

# Result row regex — DDG HTML wraps each hit in <div class="result results_links_deep">
# with an <a class="result__a" href="..."> for title and a snippet block.
_RESULT_BLOCK_RE = re.compile(
    r'<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>(.*?)</a>'
    r'.*?<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>(.*?)</a>',
    re.DOTALL,
)
_TAG_RE = re.compile(r"<[^>]+>")


def _strip_tags(html: str) -> str:
    return unescape(_TAG_RE.sub("", html or "")).strip()


def _decode_ddg_url(href: str) -> str:
    """DDG wraps links via /l/?uddg=<encoded-url>. Unwrap when present."""
    if href.startswith("//"):
        href = "https:" + href
    parsed = urlparse(href)
    if parsed.path == "/l/" or parsed.path.endswith("/l/"):
        params = parse_qs(parsed.query)
        if "uddg" in params:
            return unquote(params["uddg"][0])
    return href


def parse_results(html: str, max_results: int) -> list[dict]:
    """Extract up to `max_results` rows from a DuckDuckGo HTML response."""
    rows: list[dict] = []
    for m in _RESULT_BLOCK_RE.finditer(html or ""):
        href = _decode_ddg_url(m.group(1))
        title = _strip_tags(m.group(2))
        snippet = _strip_tags(m.group(3))
        if not title or not href:
            continue
        rows.append({"title": title[:300], "url": href, "snippet": snippet[:500]})
        if len(rows) >= max_results:
            break
    return rows


class WebSearch(Action):
    """DuckDuckGo HTML search — returns title/url/snippet rows."""

    name: ClassVar[str] = "web.search"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE

    # Block B — resource declarations.
    requires_network: ClassVar[bool] = True

    query: str = Field(..., description="search query")
    max_results: int = Field(default=5, ge=1, le=15)

    def preconditions(self) -> list[Precondition]:
        return [Precondition(key="network.online", required=None, failure_mode="reflect")]

    async def execute(self, ctx: ActionContext) -> ActionResult:
        t0 = time.monotonic()
        try:
            async with httpx.AsyncClient(
                timeout=15.0,
                headers={"User-Agent": _USER_AGENT},
                follow_redirects=True,
            ) as client:
                resp = await client.post(
                    _DDG_HTML_URL,
                    data={"q": self.query, "kl": "wt-wt"},
                )
                resp.raise_for_status()
                html = resp.text
        except Exception as exc:
            return ActionResult(
                ok=False, error=f"web_search_failed: {exc}",
                error_class=type(exc).__name__,
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        rows = parse_results(html, self.max_results)
        return ActionResult(
            ok=True,
            output={
                "query": self.query,
                "count": len(rows),
                "results": rows,
            },
            elapsed_ms=int((time.monotonic() - t0) * 1000),
        )


__all__ = ["WebSearch", "parse_results"]
