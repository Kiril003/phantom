"""
Phase 17a.5 — Iterative WebResearch.

A persistence-grade research action: keeps querying with rephrased terms
until either (a) ≥`min_sources` distinct sources corroborate the answer
shape, or (b) `max_iterations` queries have been issued. Returns a digest
with provenance (URL list) and a confidence score so the caller can decide
whether to escalate to AskUser.

Default behaviour:
  * Initial query = `query` arg.
  * On each round, generate up to 3 query variants (LLM if available, else
    deterministic synonym/expansion templates).
  * Dedup URLs across rounds; track per-domain counts so a single SEO farm
    can't fake corroboration.
  * Stop early if min_sources distinct *domains* hit.

The implementation deliberately re-uses the existing `web.search` parser
(`agent.actions.web.parse_results`) and `httpx`-based fetch path so we don't
fork the search logic.
"""
from __future__ import annotations

import asyncio
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any, ClassVar
from urllib.parse import urlparse

import httpx
from pydantic import Field

from ..schemas import ActionResult, Precondition, RiskLevel
from .base import Action, ActionContext
from .web import _DDG_HTML_URL, _USER_AGENT, parse_results

logger = logging.getLogger(__name__)


_DETERMINISTIC_QUERY_TEMPLATES = [
    "{q}",
    "{q} review",
    "{q} 2025 update",
    "{q} pros and cons",
    '"{q}" site:wikipedia.org',
    "best {q}",
    "{q} how to",
]


_LLM_REPHRASE_PROMPT = """\
Перетвори запит у 3 коротші пошукові варіанти, що покриють тему з різних
кутів. Поверни ЛИШЕ JSON-масив рядків, без коментарів.

Базовий запит: {query}
Додатковий контекст: {context}

JSON:"""


@dataclass
class _SourceHit:
    title: str
    url: str
    snippet: str
    domain: str
    rank: float = 0.0


@dataclass
class _ResearchState:
    queries_used: list[str] = field(default_factory=list)
    hits: list[_SourceHit] = field(default_factory=list)
    seen_urls: set[str] = field(default_factory=set)
    domain_counts: dict[str, int] = field(default_factory=dict)
    iterations: int = 0


def _domain_of(url: str) -> str:
    try:
        host = urlparse(url).netloc.lower()
        if host.startswith("www."):
            host = host[4:]
        return host
    except Exception:
        return ""


def _rank_hit(hit: _SourceHit, query_terms: list[str]) -> float:
    blob = f"{hit.title} {hit.snippet}".lower()
    score = 0.0
    for term in query_terms:
        if not term:
            continue
        if term.lower() in blob:
            score += 1.0
    # Bonus for diverse domains.
    if hit.domain and (
        "wikipedia" in hit.domain
        or "github" in hit.domain
        or hit.domain.endswith(".gov")
        or hit.domain.endswith(".edu")
    ):
        score += 0.5
    return score


def _split_query_terms(query: str) -> list[str]:
    return [t for t in re.split(r"[\s,;]+", query.lower()) if len(t) >= 3]


async def _generate_variants(
    query: str,
    context: str,
    *,
    ai_router: Any | None,
) -> list[str]:
    if ai_router is None:
        return _deterministic_variants(query)
    try:
        response = await asyncio.wait_for(
            ai_router.generate(
                user_message=_LLM_REPHRASE_PROMPT.format(
                    query=query[:300], context=context[:600],
                ),
                system_prompt="Ти стислий редактор. Поверни ЛИШЕ JSON-масив.",
                history=[],
            ),
            timeout=4.0,
        )
    except Exception as exc:
        logger.debug("research variant LLM failed: %s", exc)
        return _deterministic_variants(query)
    text = (response.content or "").strip()
    if not text:
        return _deterministic_variants(query)
    if text.startswith("```"):
        text = text.strip("` \n")
        if text.lower().startswith("json"):
            text = text[4:].strip()
    import json as _json
    try:
        data = _json.loads(text)
    except Exception:
        start = text.find("[")
        end = text.rfind("]")
        if start < 0 or end <= start:
            return _deterministic_variants(query)
        try:
            data = _json.loads(text[start:end + 1])
        except Exception:
            return _deterministic_variants(query)
    if not isinstance(data, list):
        return _deterministic_variants(query)
    out: list[str] = []
    for it in data:
        if isinstance(it, str) and it.strip():
            out.append(it.strip()[:200])
    if not out:
        return _deterministic_variants(query)
    return out[:3]


def _deterministic_variants(query: str) -> list[str]:
    out: list[str] = []
    for tmpl in _DETERMINISTIC_QUERY_TEMPLATES[:3]:
        v = tmpl.format(q=query)
        if v not in out:
            out.append(v)
    return out


async def _search_one(query: str, max_results: int) -> list[dict]:
    try:
        async with httpx.AsyncClient(
            timeout=15.0,
            headers={"User-Agent": _USER_AGENT},
            follow_redirects=True,
        ) as client:
            resp = await client.post(_DDG_HTML_URL, data={"q": query, "kl": "wt-wt"})
            resp.raise_for_status()
            html = resp.text
    except Exception as exc:
        logger.debug("research _search_one failed: %s", exc)
        return []
    return parse_results(html, max_results)


class WebResearch(Action):
    """Iterative web search with corroboration + provenance."""

    name: ClassVar[str] = "web.research"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE

    query: str = Field(..., description="initial search query")
    context: str = Field(default="", description="extra terms to bias variants")
    min_sources: int = Field(default=3, ge=1, le=10)
    max_iterations: int = Field(default=8, ge=1, le=12)
    per_query_results: int = Field(default=6, ge=3, le=12)

    def preconditions(self) -> list[Precondition]:
        return [Precondition(key="network.online", required=None, failure_mode="reflect")]

    async def execute(self, ctx: ActionContext) -> ActionResult:
        t0 = time.monotonic()
        ai_router = None
        try:
            from ai.provider import ai_router as _router
            ai_router = _router
        except Exception:
            ai_router = None

        state = _ResearchState()
        seed_query = self.query.strip()
        if not seed_query:
            return ActionResult(
                ok=False, error="empty query", elapsed_ms=0,
            )
        query_terms = _split_query_terms(seed_query)

        # Round 1: the original query as-is.
        await self._search_round(state, [seed_query], query_terms)

        while (
            state.iterations < self.max_iterations
            and len(state.domain_counts) < self.min_sources
        ):
            variants = await _generate_variants(
                query=seed_query,
                context=self.context,
                ai_router=ai_router,
            )
            # Drop already-used queries to avoid repeats.
            variants = [v for v in variants if v and v not in state.queries_used]
            if not variants:
                # Emergency fallback to deterministic templates if all variants
                # collide with previous rounds.
                variants = [
                    v for v in _deterministic_variants(seed_query)
                    if v not in state.queries_used
                ]
            if not variants:
                break
            await self._search_round(state, variants[:2], query_terms)

        # Sort hits by rank desc, take top N for the digest.
        state.hits.sort(key=lambda h: -h.rank)
        top_hits = state.hits[: max(self.min_sources * 2, 6)]

        confidence = min(1.0, len(state.domain_counts) / max(self.min_sources, 1))
        digest = self._compose_digest(seed_query, top_hits)

        return ActionResult(
            ok=True,
            output={
                "query": seed_query,
                "iterations": state.iterations,
                "queries_used": state.queries_used,
                "distinct_domains": len(state.domain_counts),
                "confidence": confidence,
                "digest": digest,
                "sources": [
                    {
                        "title": h.title,
                        "url": h.url,
                        "snippet": h.snippet,
                        "domain": h.domain,
                        "rank": h.rank,
                    }
                    for h in top_hits
                ],
            },
            elapsed_ms=int((time.monotonic() - t0) * 1000),
        )

    async def _search_round(
        self,
        state: _ResearchState,
        queries: list[str],
        query_terms: list[str],
    ) -> None:
        for q in queries:
            state.queries_used.append(q)
            state.iterations += 1
            rows = await _search_one(q, self.per_query_results)
            for r in rows:
                url = r.get("url") or ""
                if not url or url in state.seen_urls:
                    continue
                state.seen_urls.add(url)
                domain = _domain_of(url)
                hit = _SourceHit(
                    title=str(r.get("title") or ""),
                    url=url,
                    snippet=str(r.get("snippet") or ""),
                    domain=domain,
                )
                hit.rank = _rank_hit(hit, query_terms)
                state.hits.append(hit)
                if domain:
                    state.domain_counts[domain] = state.domain_counts.get(domain, 0) + 1
            # Early stop if we already have enough distinct domains.
            if len(state.domain_counts) >= self.min_sources:
                return

    def _compose_digest(self, query: str, hits: list[_SourceHit]) -> str:
        if not hits:
            return f"Не вдалось знайти джерел для запиту '{query[:120]}'."
        # Compose a deterministic 2-paragraph digest from snippets — LLM-free
        # so the action is offline-safe.
        bullets = []
        for h in hits[:5]:
            line = f"• [{h.domain or 'web'}] {h.title.strip()}: {h.snippet.strip()}"
            bullets.append(line[:300])
        return (
            f"Дослідження за запитом '{query[:120]}':\n\n"
            + "\n".join(bullets)
        )


__all__ = ["WebResearch"]
