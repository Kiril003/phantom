"""Live web harvest for research missions — DDG search + page extracts.

Deliberately tiny: httpx + the existing DDG parser, no Playwright (the
board can't afford a browser per worker). Failures degrade to fewer
sources, never to a crash — a research node still runs offline, just
ungrounded."""
from __future__ import annotations

import asyncio
import ipaddress
import logging
from urllib.parse import urlparse

import httpx

from agent.actions.web import parse_results, _strip_tags

logger = logging.getLogger(__name__)

_DDG_HTML_URL = "https://html.duckduckgo.com/html/"
_UA = "Mozilla/5.0 (X11; Linux aarch64) PhantomOS/1.0 polis-harvester"
_MAX_BODY = 2_000_000


def _url_ok(url: str) -> bool:
    """Public http(s) only — a search result must never aim the harvester
    at localhost or the LAN (this box serves its own admin APIs)."""
    try:
        parsed = urlparse(url)
    except ValueError:
        return False
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return False
    host = parsed.hostname
    if host == "localhost" or host.endswith(".local"):
        return False
    try:
        return ipaddress.ip_address(host).is_global
    except ValueError:
        return True  # a DNS name, not an IP literal — allowed


async def _fetch_extract(client: httpx.AsyncClient, url: str, cap: int) -> str:
    if not _url_ok(url):
        return ""
    try:
        resp = await client.get(url)
        resp.raise_for_status()
        ctype = resp.headers.get("content-type", "")
        if "html" not in ctype and "text" not in ctype:
            return ""
        if len(resp.content) > _MAX_BODY:
            return ""
        return _strip_tags(resp.text)[:cap].strip()
    except Exception as exc:
        logger.debug("harvest fetch failed %s: %s", url, exc)
        return ""


async def harvest(
    query: str,
    *,
    max_sources: int = 4,
    per_page_chars: int = 5000,
) -> list[dict]:
    """Return [{title, url, extract}] for the top live results."""
    try:
        async with httpx.AsyncClient(
            timeout=12.0, headers={"User-Agent": _UA}, follow_redirects=True
        ) as client:
            resp = await client.post(_DDG_HTML_URL, data={"q": query, "kl": "wt-wt"})
            resp.raise_for_status()
            rows = parse_results(resp.text, max_sources * 2)
            picked = rows[: max_sources]
            extracts = await asyncio.gather(
                *(_fetch_extract(client, r["url"], per_page_chars) for r in picked)
            )
    except Exception as exc:
        logger.warning("harvest search failed for %r: %s", query, exc)
        return []
    out = []
    for row, extract in zip(picked, extracts):
        out.append({
            "title": row.get("title", ""),
            "url": row.get("url", ""),
            "extract": extract or row.get("snippet", ""),
        })
    return [s for s in out if s["extract"]]


def render_sources(sources: list[dict], cap_chars: int = 16_000) -> str:
    if not sources:
        return ""
    parts = ["── Живі джерела з мережі (цитуй за [N] і URL) ──"]
    used = 0
    for i, s in enumerate(sources, 1):
        block = f"[{i}] {s['title']}\n{s['url']}\n{s['extract']}"
        if used + len(block) > cap_chars:
            block = block[: max(0, cap_chars - used)]
        parts.append(block)
        used += len(block)
        if used >= cap_chars:
            break
    return "\n\n".join(parts)
