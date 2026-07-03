"""Atelier — the seeing build loop (FORGE Law 6: creation must see).

Each pass: generate/patch files → render preview headless → screenshot →
multimodal critique against the brief → verdict SHIP or patch list for the
next pass. When no headless browser or vision model is available the loop
degrades to source-level critique and the journal records the pass as
blind — honesty over theater.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import time
from typing import Any, Awaitable, Callable, Optional

from config import config
from ai.json_response import strip_json_fences
from workbench.service import WorkbenchError, workbench_service

logger = logging.getLogger(__name__)

PhaseCB = Callable[[str, dict[str, Any]], Awaitable[None]]

MAX_PASSES = 3
GEN_TIMEOUT_S = 120.0
CRITIQUE_TIMEOUT_S = 60.0
SCREENSHOT_TIMEOUT_S = 30.0
VIEWPORT = {"width": 1024, "height": 600}

_GENERATE_SYSTEM = """Ти — PHANTOM Atelier, майстер фронтенд-інженерії.
Побудуй ПОВНИЙ багатофайловий веб-проєкт за брифом. Без плейсхолдерів,
без TODO — кожен файл завершений і працює одразу. Сучасний ES-модульний
JavaScript, семантичний HTML, виразний CSS. Все self-contained (без CDN).
Дозволені файли: .html .css .js .mjs .json .svg .md.
Відповідай СТРОГО одним JSON-обʼєктом:
{"title": "...", "entry": "index.html",
 "files": [{"path": "index.html", "content": "..."}, ...]}"""

_PATCH_SYSTEM = """Ти — PHANTOM Atelier у режимі правки. Тобі дано бриф,
поточні файли проєкту і критику. Поверни ТІЛЬКИ файли, які треба замінити
(повний новий вміст кожного), СТРОГО одним JSON-обʼєктом:
{"files": [{"path": "...", "content": "..."}, ...]}"""

_CRITIQUE_PROMPT = """Це скріншот веб-проєкту, який ти щойно збудував.
Бриф: {brief}

Оціни рендер проти брифу: композиція, читабельність, чи все видно у
1024×600, чи нічого не зламано/не перекрито/не порожнє. Відповідай СТРОГО
одним JSON-обʼєктом:
{{"verdict": "SHIP" або "REVISE", "score": 1-10,
  "critique": "конкретні проблеми або чому готово",
  "fix_instructions": "точні вказівки що змінити (порожньо якщо SHIP)"}}"""

_SOURCE_CRITIQUE_PROMPT = """Скріншот недоступний — оціни за кодом.
Бриф: {brief}

Файли проєкту:
{files_block}

Знайди реальні дефекти: незакриті теги, посилання на неіснуючі файли,
JS-помилки, порожні секції, речі що не влізуть у 1024×600. Відповідай
СТРОГО одним JSON-обʼєктом:
{{"verdict": "SHIP" або "REVISE", "score": 1-10,
  "critique": "...", "fix_instructions": "..."}}"""


def _parse_manifest(raw: str) -> dict[str, Any]:
    data = json.loads(strip_json_fences(raw))
    files = data.get("files")
    if not isinstance(files, list) or not files:
        raise WorkbenchError("bad_manifest", "model returned no files")
    for f in files:
        if not isinstance(f, dict) or not f.get("path") or "content" not in f:
            raise WorkbenchError("bad_manifest", f"malformed file entry: {f!r}")
    return data


async def _generate(brief: str, system: str, *, prior: str = "") -> dict[str, Any]:
    from ai.provider import ai_router
    prompt = brief if not prior else f"{brief}\n\n{prior}"
    resp = await asyncio.wait_for(
        ai_router.generate(prompt, system, []),
        timeout=GEN_TIMEOUT_S,
    )
    return _parse_manifest(resp.text)


async def _screenshot(url: str) -> Optional[bytes]:
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        return None

    async def _shot() -> bytes:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True)
            try:
                page = await browser.new_page(viewport=VIEWPORT)
                await page.goto(url, wait_until="networkidle", timeout=15_000)
                await page.wait_for_timeout(600)
                return await page.screenshot(type="png")
            finally:
                await browser.close()

    try:
        return await asyncio.wait_for(_shot(), timeout=SCREENSHOT_TIMEOUT_S)
    except Exception as exc:
        logger.warning("atelier screenshot failed: %s", exc)
        return None


async def _critique_visual(png: bytes, brief: str) -> Optional[dict[str, Any]]:
    try:
        from google import genai
        from google.genai import types
    except ImportError:
        return None
    api_key = getattr(config, "ai_gemini_api_key", "") or ""
    if not api_key:
        return None
    try:
        client = genai.Client(api_key=api_key)
        image_part = types.Part.from_bytes(data=png, mime_type="image/png")
        resp = await asyncio.wait_for(
            client.aio.models.generate_content(
                model=config.ai_gemini_model,
                contents=[_CRITIQUE_PROMPT.format(brief=brief), image_part],
            ),
            timeout=CRITIQUE_TIMEOUT_S,
        )
        return json.loads(strip_json_fences(resp.text or ""))
    except Exception as exc:
        logger.warning("atelier visual critique failed: %s", exc)
        return None


async def _critique_source(files: list[dict], brief: str) -> dict[str, Any]:
    from ai.provider import ai_router
    block = "\n".join(
        f"── {f['path']} ──\n{f['content'][:3000]}" for f in files[:12]
    )
    resp = await asyncio.wait_for(
        ai_router.generate(
            _SOURCE_CRITIQUE_PROMPT.format(brief=brief, files_block=block),
            "Ти — суворий рецензент фронтенду.",
            [],
        ),
        timeout=CRITIQUE_TIMEOUT_S,
    )
    try:
        return json.loads(strip_json_fences(resp.text))
    except json.JSONDecodeError:
        return {"verdict": "SHIP", "score": 5,
                "critique": "critique unparseable — accepting as-is",
                "fix_instructions": ""}


def _preview_url(workbench_id: str, token: str, entry: str) -> str:
    host = getattr(config, "host", "127.0.0.1")
    bind = "127.0.0.1" if host in ("0.0.0.0", "::") else host
    return (f"http://{bind}:{config.port}/api/v1/workbench/"
            f"{workbench_id}/preview/{entry}?t={token}")


async def build(workbench_id: str, *, refine_instruction: str = "",
                on_phase: Optional[PhaseCB] = None,
                max_passes: int = MAX_PASSES) -> dict[str, Any]:
    """Run the full seeing loop for a workspace. Returns the final meta dict."""
    svc = workbench_service

    async def phase(name: str, data: dict[str, Any]) -> None:
        svc.journal(workbench_id, f"phase.{name}", data)
        if on_phase is not None:
            try:
                await on_phase(name, data)
            except Exception as exc:
                logger.debug("atelier phase cb failed: %s", exc)

    ws = svc.get(workbench_id)
    svc.set_status(workbench_id, "building")
    started = time.monotonic()
    try:
        if refine_instruction or not svc.tree(workbench_id):
            await phase("generate", {"pass": 0})
            if refine_instruction:
                current = [
                    {"path": t["path"],
                     "content": svc.read_file(workbench_id, t["path"])}
                    for t in svc.tree(workbench_id)
                ]
                prior = ("Поточні файли:\n" + json.dumps(
                    current, ensure_ascii=False)[:24_000]
                    + f"\n\nВказівка оператора: {refine_instruction}")
                manifest = await _generate(ws.brief, _PATCH_SYSTEM, prior=prior)
            else:
                manifest = await _generate(ws.brief, _GENERATE_SYSTEM)
            svc.write_files(workbench_id, manifest["files"])
            if manifest.get("entry"):
                ws = svc.get(workbench_id)
                ws.entry = str(manifest["entry"])
                svc._save_meta(ws)

        for pass_n in range(1, max_passes + 1):
            ws = svc.get(workbench_id)
            url = _preview_url(ws.id, ws.preview_token, ws.entry)
            await phase("see", {"pass": pass_n})
            png = await _screenshot(url)
            blind = png is None
            if png is not None:
                svc.screenshot_path(workbench_id, pass_n).write_bytes(png)

            await phase("critique", {"pass": pass_n, "blind": blind})
            verdict: Optional[dict[str, Any]] = None
            if png is not None:
                verdict = await _critique_visual(png, ws.brief)
            if verdict is None:
                files = [
                    {"path": t["path"],
                     "content": svc.read_file(workbench_id, t["path"])}
                    for t in svc.tree(workbench_id)
                ]
                verdict = await _critique_source(files, ws.brief)
                blind = True

            entry = {
                "n": pass_n,
                "verdict": str(verdict.get("verdict", "SHIP")),
                "score": int(verdict.get("score", 5) or 5),
                "critique": str(verdict.get("critique", ""))[:1000],
                "blind": blind,
                "has_screenshot": png is not None,
            }
            svc.add_pass(workbench_id, entry)
            await phase("verdict", entry)

            if entry["verdict"] != "REVISE" or pass_n == max_passes:
                break

            await phase("patch", {"pass": pass_n})
            fix = str(verdict.get("fix_instructions", "")) or entry["critique"]
            current = [
                {"path": t["path"],
                 "content": svc.read_file(workbench_id, t["path"])}
                for t in svc.tree(workbench_id)
            ]
            prior = ("Поточні файли:\n"
                     + json.dumps(current, ensure_ascii=False)[:24_000]
                     + f"\n\nКритика: {entry['critique']}\nВиправ: {fix}")
            patch = await _generate(ws.brief, _PATCH_SYSTEM, prior=prior)
            svc.write_files(workbench_id, patch["files"])

        final = svc.set_status(workbench_id, "ready")
        await phase("ready", {
            "elapsed_s": round(time.monotonic() - started, 1),
            "passes": len(final.passes),
        })
        return final.meta_dict()
    except Exception as exc:
        logger.exception("atelier build failed for %s", workbench_id)
        svc.journal(workbench_id, "failed", {"error": str(exc)[:500]})
        svc.set_status(workbench_id, "failed")
        await phase("failed", {"error": str(exc)[:300]})
        raise
