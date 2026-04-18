"""Browser actions — Playwright chromium, shared per-task instance."""
from __future__ import annotations

import logging
import time
from typing import ClassVar
from urllib.parse import urlparse

from pydantic import Field

from config import config

from ..schemas import ActionResult, Precondition, RiskLevel
from .base import Action, ActionContext

logger = logging.getLogger(__name__)


async def _ensure_browser(ctx: ActionContext, headless: bool):
    """Lazy-init a chromium browser + context + page on the runtime singleton."""
    runtime = ctx.runtime
    if runtime is None:
        raise RuntimeError("browser actions require a runtime instance in ActionContext")

    try:
        from playwright.async_api import async_playwright
    except ImportError as exc:
        raise RuntimeError("playwright not installed; pip install playwright") from exc

    if runtime.browser is None:
        runtime._playwright = await async_playwright().start()
        runtime.browser = await runtime._playwright.chromium.launch(headless=headless)
        runtime.browser_context = await runtime.browser.new_context(
            viewport={"width": 1440, "height": 900},
            user_agent=config.agent_browser_user_agent,
        )
        runtime.browser_page = await runtime.browser_context.new_page()
    return runtime.browser_page


class BrowserNavigate(Action):
    name: ClassVar[str] = "browser.navigate"
    risk_level: ClassVar[RiskLevel] = RiskLevel.LOW

    url: str = Field(..., description="http or https only")
    headed_debug: bool = Field(default=False)

    def preconditions(self) -> list[Precondition]:
        return [Precondition(key="network.online", required=None, failure_mode="reflect")]

    async def execute(self, ctx: ActionContext) -> ActionResult:
        t0 = time.monotonic()
        scheme = (urlparse(self.url).scheme or "").lower()
        if scheme not in {"http", "https"}:
            return ActionResult(
                ok=False,
                error=f"invalid_scheme: '{scheme}'; only http/https allowed",
                error_class="invalid_scheme",
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        if self.headed_debug:
            logger.warning("browser.navigate started in HEADED debug mode for %s", self.url)

        try:
            page = await _ensure_browser(ctx, headless=not self.headed_debug)
            await page.goto(self.url, timeout=15_000, wait_until="domcontentloaded")
            title = await page.title()
            url_final = page.url
            try:
                text = await page.inner_text("body")
            except Exception:
                text = ""
            text_truncated = text[:2000]
        except Exception as exc:
            return ActionResult(
                ok=False, error=f"navigate_failed: {exc}",
                error_class=type(exc).__name__,
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        return ActionResult(
            ok=True,
            output={
                "title": title,
                "url_final": url_final,
                "text_truncated_2000": text_truncated,
            },
            side_effects=[f"navigated to {url_final}"],
            elapsed_ms=int((time.monotonic() - t0) * 1000),
        )


class BrowserExtract(Action):
    name: ClassVar[str] = "browser.extract"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE

    selector: str = Field(..., description="CSS selector")
    mode: str = Field(default="text")
    attr_name: str | None = Field(default=None)

    def preconditions(self) -> list[Precondition]:
        return [Precondition(key="browser.page_active", required=None, failure_mode="abandon")]

    async def execute(self, ctx: ActionContext) -> ActionResult:
        t0 = time.monotonic()
        runtime = ctx.runtime
        if runtime is None or runtime.browser_page is None:
            return ActionResult(
                ok=False, error="no_active_page",
                error_class="no_active_page",
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )
        page = runtime.browser_page

        try:
            element = await page.query_selector(self.selector)
            if element is None:
                return ActionResult(
                    ok=False,
                    error=f"selector_no_match: {self.selector}",
                    error_class="selector_no_match",
                    elapsed_ms=int((time.monotonic() - t0) * 1000),
                )
            if self.mode == "text":
                value = await element.inner_text()
            elif self.mode == "html":
                value = await element.inner_html()
            elif self.mode == "attr":
                if not self.attr_name:
                    return ActionResult(
                        ok=False, error="attr_name required for mode='attr'",
                        error_class="bad_args",
                        elapsed_ms=int((time.monotonic() - t0) * 1000),
                    )
                value = await element.get_attribute(self.attr_name)
            else:
                return ActionResult(
                    ok=False, error=f"unknown_mode: {self.mode}",
                    error_class="bad_args",
                    elapsed_ms=int((time.monotonic() - t0) * 1000),
                )
        except Exception as exc:
            return ActionResult(
                ok=False, error=f"extract_failed: {exc}",
                error_class=type(exc).__name__,
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        return ActionResult(
            ok=True,
            output={"selector": self.selector, "mode": self.mode, "value": value},
            elapsed_ms=int((time.monotonic() - t0) * 1000),
        )
