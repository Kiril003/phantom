# ArtifactStudio Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate Claude-class artifacts by routing artifact generation through a dedicated Gemini 2.5 Pro multi-pass studio (elite prompt, ~32K budget, draft→critique→rewrite) instead of the truncated 2048-token Flash inline tool-call.

**Architecture:** A new `ai/artifact_studio.py` owns generation. A new no-tools `generate_raw` seam on the Gemini provider + `ai_router` lets the studio force model/budget without touching the chat path. Both the `respond_artifact` tool pick and the B1 HTML-salvage become a *brief*; the studio regenerates the HTML; output still flows through the shipped `parse_function_call` validation + SceneArtifactPanel render/CSP.

**Tech Stack:** Python 3.11, FastAPI, google-genai async SDK, pytest. Spec: `docs/superpowers/specs/2026-05-16-artifact-studio-quality-design.md`.

**House rule:** Minimal code comments — dense self-documenting code. Comment only a security boundary or non-obvious invariant. No mocks/TODO/stubs in product code. Ukrainian for user-facing strings.

---

### Task 1: Config flags

**Files:**
- Modify: `src/backend/config.py`
- Test: `src/backend/tests/test_artifact_studio.py`

- [ ] **Step 1: Write the failing test**

```python
# src/backend/tests/test_artifact_studio.py
from config import config


def test_artifact_studio_config_defaults():
    assert config.ai_artifact_model == "gemini-2.5-pro"
    assert config.ai_artifact_max_tokens == 32768
    assert config.ai_artifact_max_revisions == 2
    assert config.chat_artifact_html_cap_bytes == 262144
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/backend && .venv/bin/python -m pytest tests/test_artifact_studio.py::test_artifact_studio_config_defaults -v -p no:cacheprovider`
Expected: FAIL — `AttributeError: 'Settings' object has no attribute 'ai_artifact_model'`

- [ ] **Step 3: Add the fields**

In `src/backend/config.py`, next to the existing `ai_gemini_model` / `chat_artifact_*` fields, add:

```python
    ai_artifact_model: str = "gemini-2.5-pro"
    ai_artifact_max_tokens: int = 32768
    ai_artifact_max_revisions: int = 2
```

And change the existing line `chat_artifact_html_cap_bytes: int = 65536` to:

```python
    chat_artifact_html_cap_bytes: int = 262144
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/backend && .venv/bin/python -m pytest tests/test_artifact_studio.py::test_artifact_studio_config_defaults -v -p no:cacheprovider`
Expected: PASS

- [ ] **Step 5: Update the existing cap assertion (cap changed)**

`tests/test_artifact_widgets.py` line ~11 currently has:

```python
    assert config.chat_artifact_html_cap_bytes == 65536
```

Replace that exact line with:

```python
    assert config.chat_artifact_html_cap_bytes == 262144
```

Run: `cd src/backend && .venv/bin/python -m pytest tests/test_artifact_widgets.py -q --no-header -p no:cacheprovider`
Expected: PASS (all artifact-widget tests, with the updated cap)

- [ ] **Step 6: Commit**

```bash
git add src/backend/config.py src/backend/tests/test_artifact_studio.py src/backend/tests/test_artifact_widgets.py
git commit -m "feat(artifact-studio): config (gemini-2.5-pro, 32K budget, 256KB cap)

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

### Task 2: `generate_raw` seam (no tools, forced model/budget)

**Files:**
- Modify: `src/backend/ai/gemini_provider.py`
- Modify: `src/backend/ai/provider.py`
- Test: `src/backend/tests/test_artifact_studio.py`

- [ ] **Step 1: Write the failing test**

Append to `src/backend/tests/test_artifact_studio.py`:

```python
import pytest


@pytest.mark.asyncio
async def test_ai_router_generate_raw_routes_to_gemini(monkeypatch):
    from ai.provider import ai_router

    seen = {}

    async def fake_raw(*, system_prompt, user_message, model, max_output_tokens,
                        temperature=0.7):
        seen.update(
            system_prompt=system_prompt, user_message=user_message,
            model=model, max_output_tokens=max_output_tokens,
            temperature=temperature,
        )
        return "<!doctype html><body>ok</body>"

    prov = ai_router.get_provider("gemini")
    assert prov is not None
    monkeypatch.setattr(prov, "generate_raw", fake_raw)

    out = await ai_router.generate_raw(
        system_prompt="SYS", user_message="BRIEF",
        model="gemini-2.5-pro", max_output_tokens=32768,
    )
    assert out == "<!doctype html><body>ok</body>"
    assert seen["model"] == "gemini-2.5-pro"
    assert seen["max_output_tokens"] == 32768
    assert seen["system_prompt"] == "SYS"


@pytest.mark.asyncio
async def test_generate_raw_unavailable_raises(monkeypatch):
    from ai.provider import ai_router

    monkeypatch.setattr(ai_router, "get_provider", lambda name: None)
    with pytest.raises(RuntimeError):
        await ai_router.generate_raw(
            system_prompt="s", user_message="u",
            model="gemini-2.5-pro", max_output_tokens=100,
        )
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src/backend && .venv/bin/python -m pytest tests/test_artifact_studio.py -k generate_raw -v -p no:cacheprovider`
Expected: FAIL — `AttributeError: 'GeminiProvider' object has no attribute 'generate_raw'` / `'AIRouter' object has no attribute 'generate_raw'`

- [ ] **Step 3: Add `generate_raw` to GeminiProvider**

In `src/backend/ai/gemini_provider.py`, add this method to `class GeminiProvider` (after `generate`, mirroring its client/call pattern but with NO tools and an overridable model/budget):

```python
    async def generate_raw(
        self,
        *,
        system_prompt: str,
        user_message: str,
        model: str,
        max_output_tokens: int,
        temperature: float = 0.7,
    ) -> str:
        """Single-turn, NO function-call tools, caller-forced model and
        token budget. Returns the model's text body verbatim. Used by
        ArtifactStudio so artifact generation is independent of the
        chat model/budget — the chat path is untouched."""
        from google.genai import types

        client = _get_client()
        contents = _build_contents(user_message, [])
        gen_config = types.GenerateContentConfig(
            system_instruction=system_prompt,
            temperature=temperature,
            top_p=config.ai_top_p,
            top_k=40,
            max_output_tokens=max_output_tokens,
            safety_settings=[types.SafetySetting(**s) for s in _SAFETY_OFF],
        )
        response = await client.aio.models.generate_content(
            model=model,
            contents=contents,
            config=gen_config,
        )
        parts: list[str] = []
        candidate = response.candidates[0] if response.candidates else None
        if candidate and candidate.content and candidate.content.parts:
            for part in candidate.content.parts:
                if getattr(part, "text", None):
                    parts.append(part.text)
        return " ".join(parts).strip() or (getattr(response, "text", "") or "").strip()
```

- [ ] **Step 4: Add `generate_raw` passthrough to AIRouter**

In `src/backend/ai/provider.py`, add this method to `class AIRouter` (after `get_provider`):

```python
    async def generate_raw(
        self,
        *,
        system_prompt: str,
        user_message: str,
        model: str,
        max_output_tokens: int,
        temperature: float = 0.7,
    ) -> str:
        """Raw no-tools generation on the Gemini provider with a forced
        model/budget. Raises if the provider is unavailable — callers
        degrade (ArtifactStudio falls back; never a dead bubble)."""
        prov = self.get_provider("gemini")
        if prov is None or not hasattr(prov, "generate_raw"):
            raise RuntimeError("generate_raw: gemini provider unavailable")
        return await prov.generate_raw(
            system_prompt=system_prompt,
            user_message=user_message,
            model=model,
            max_output_tokens=max_output_tokens,
            temperature=temperature,
        )
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd src/backend && .venv/bin/python -m pytest tests/test_artifact_studio.py -k generate_raw -v -p no:cacheprovider`
Expected: PASS (2 tests)

- [ ] **Step 6: Regression — chat path byte-unchanged**

Run: `cd src/backend && .venv/bin/python -m pytest tests/test_phase10_tool_use.py tests/test_phase27_chat_pipeline_widgets.py -q --no-header -p no:cacheprovider`
Expected: PASS (generate_raw is additive; existing `generate` untouched)

- [ ] **Step 7: Commit**

```bash
git add src/backend/ai/gemini_provider.py src/backend/ai/provider.py src/backend/tests/test_artifact_studio.py
git commit -m "feat(artifact-studio): generate_raw seam (no tools, forced model/budget)

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

### Task 3: ArtifactStudio core (brief → multi-pass HTML)

**Files:**
- Create: `src/backend/ai/artifact_studio.py`
- Test: `src/backend/tests/test_artifact_studio.py`

- [ ] **Step 1: Write the failing tests**

Append to `src/backend/tests/test_artifact_studio.py`:

```python
DOC = "<!doctype html><html><body><canvas id=c></canvas><script>1</script></body></html>"


def test_strip_to_document_handles_fence_and_bare():
    from ai.artifact_studio import _strip_to_document

    assert _strip_to_document(f"бла\n```html\n{DOC}\n```\nкінець").strip() == DOC
    assert _strip_to_document(f"prefix {DOC} suffix").strip().startswith("<!doctype")
    assert _strip_to_document("просто текст без html") is None


@pytest.mark.asyncio
async def test_build_artifact_draft_then_ok_stops_at_two_calls(monkeypatch):
    from ai import artifact_studio
    from ai.artifact_studio import Brief

    calls = []

    async def fake_raw(*, system_prompt, user_message, model, max_output_tokens,
                        temperature=0.7):
        calls.append((system_prompt[:24], model, max_output_tokens))
        return DOC if len(calls) == 1 else "OK"

    monkeypatch.setattr(artifact_studio.ai_router, "generate_raw", fake_raw)

    title, html = await artifact_studio.build_artifact(
        Brief(title="Pulse", request="зроби пульс", hint=""), user_id="u",
    )
    assert title == "Pulse"
    assert html.strip() == DOC
    assert len(calls) == 2  # draft + one critique that returned OK
    assert calls[0][1] == "gemini-2.5-pro"
    assert calls[0][2] == 32768


@pytest.mark.asyncio
async def test_build_artifact_critique_rewrites_then_caps(monkeypatch):
    from ai import artifact_studio
    from ai.artifact_studio import Brief

    better = "<!doctype html><html><body><main>better</main></body></html>"
    calls = []

    async def fake_raw(**kw):
        calls.append(kw)
        if len(calls) == 1:
            return DOC
        return better  # every critique returns a NEW doc, never "OK"

    monkeypatch.setattr(artifact_studio.ai_router, "generate_raw", fake_raw)

    _t, html = await artifact_studio.build_artifact(
        Brief(title="X", request="r", hint=""), user_id="u",
    )
    assert html.strip() == better
    # draft + ai_artifact_max_revisions critique passes, then stop
    assert len(calls) == 1 + 2


@pytest.mark.asyncio
async def test_build_artifact_pass1_failure_raises(monkeypatch):
    from ai import artifact_studio
    from ai.artifact_studio import Brief, ArtifactStudioError

    async def boom(**kw):
        raise RuntimeError("provider down")

    monkeypatch.setattr(artifact_studio.ai_router, "generate_raw", boom)
    with pytest.raises(ArtifactStudioError):
        await artifact_studio.build_artifact(
            Brief(title="X", request="r", hint=""), user_id="u",
        )
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src/backend && .venv/bin/python -m pytest tests/test_artifact_studio.py -k "build_artifact or strip_to_document" -v -p no:cacheprovider`
Expected: FAIL — `ModuleNotFoundError: No module named 'ai.artifact_studio'`

- [ ] **Step 3: Create `src/backend/ai/artifact_studio.py`**

```python
"""Dedicated artifact generation — Gemini 2.5 Pro, big budget, draft →
rubric self-critique → rewrite. Independent of the chat model/budget."""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass

from ai.provider import ai_router
from config import config

logger = logging.getLogger(__name__)


class ArtifactStudioError(Exception):
    """Raised when the draft pass yields no usable document — callers
    degrade (never a dead bubble / never a raw code dump)."""


@dataclass
class Brief:
    title: str
    request: str
    hint: str = ""


_FENCE_RE = re.compile(r"```(?:[a-zA-Z0-9_+-]*)\n(.*?)\n?```", re.DOTALL)
_DOC_RE = re.compile(r"<!doctype html.*?</html\s*>", re.IGNORECASE | re.DOTALL)


def _strip_to_document(text: str) -> str | None:
    if not text:
        return None
    for m in _FENCE_RE.finditer(text):
        body = m.group(1).strip()
        if re.search(r"<!doctype html|<html[\s>]|<body[\s>]", body, re.IGNORECASE):
            return body
    m = _DOC_RE.search(text)
    if m:
        return m.group(0).strip()
    if re.search(r"<body[\s>]", text, re.IGNORECASE):
        return text.strip()
    return None


ELITE_SYSTEM_PROMPT = (
    "Ти — елітний інженер-дизайнер інтерактивних артефактів рівня Claude. "
    "Згенеруй ОДИН повний самодостатній HTML-документ — закінчений продукт, "
    "не демо.\n"
    "ВИМОГИ:\n"
    "• Виразний, оригінальний візуал — НЕ генеричний AI-вигляд. Продумана "
    "типографіка, простір, кольорова система, глибина.\n"
    "• Заповни поверхню 1024×600 landscape повністю. Без крихітних "
    "елементів по центру, без скролу хост-екрана.\n"
    "• Осмислена анімація що несе сенс (стан, перехід, дані) — не "
    "декоративна.\n"
    "• Повна інтерактивність якщо бриф це передбачає: робочі контролі, "
    "стан, зворотний звʼязок.\n"
    "• НУЛЬ заглушок: жодних TODO, lorem, '// implement', порожніх "
    "обробників, мертвих кнопок.\n"
    "• НУЛЬ мережі: inline CSS/JS, <canvas>/SVG, зображення лише data:. "
    "Жодних CDN/зовнішніх бібліотек/fetch/WebSocket.\n"
    "• Доступність: клавіатура + ARIA. Стійкий JS — жодних неперехоплених "
    "виключень.\n"
    "ВИВІД: ТІЛЬКИ документ (від <!doctype html> до </html>). Без прози, "
    "без markdown-огорожі, без пояснень."
)

CRITIQUE_SYSTEM_PROMPT = (
    "Ти — суворий арт-директор. Оціни HTML-артефакт за рубрикою. Якщо "
    "КОЖНА вісь проходить — відповідай РІВНО `OK` (два символи, нічого "
    "більше). Інакше — поверни ПОВНІСТЮ переписаний кращий документ "
    "(тільки документ, без прози, без огорожі), що усуває найслабші осі.\n"
    "РУБРИКА:\n"
    "1. Візуальна насиченість і оригінальність (не генерично).\n"
    "2. Повнота — нуль заглушок/мертвих контролів.\n"
    "3. Глибина інтерактивності відповідно до брифа.\n"
    "4. Влучання в поверхню 1024×600 без overflow.\n"
    "5. Осмисленість анімації.\n"
    "6. Продуктивність — без jank, обмежені цикли.\n"
    "7. Самодостатність — нуль мережі/CDN."
)


def _brief_message(b: Brief) -> str:
    parts = [f"НАЗВА: {b.title}".strip(), f"ЗАПИТ КОРИСТУВАЧА:\n{b.request}".strip()]
    if b.hint.strip():
        parts.append(
            "ЧЕРНЕТКА-НАТЯК (лише як сигнал наміру, НЕ копіюй, зроби "
            f"набагато краще):\n{b.hint[:4000]}"
        )
    return "\n\n".join(p for p in parts if p)


async def build_artifact(brief: Brief, *, user_id: str) -> tuple[str, str]:
    """Return (title, html). Draft pass then ≤ ai_artifact_max_revisions
    critique/rewrite passes; stop early on `OK`. Raises
    ArtifactStudioError if the draft pass yields no document."""
    try:
        draft_text = await ai_router.generate_raw(
            system_prompt=ELITE_SYSTEM_PROMPT,
            user_message=_brief_message(brief),
            model=config.ai_artifact_model,
            max_output_tokens=config.ai_artifact_max_tokens,
            temperature=0.8,
        )
    except Exception as exc:  # provider down / timeout
        raise ArtifactStudioError(f"draft pass failed: {exc}") from exc

    html = _strip_to_document(draft_text)
    if not html:
        raise ArtifactStudioError("draft pass produced no HTML document")

    for _ in range(max(0, int(config.ai_artifact_max_revisions))):
        try:
            verdict = await ai_router.generate_raw(
                system_prompt=CRITIQUE_SYSTEM_PROMPT,
                user_message=html,
                model=config.ai_artifact_model,
                max_output_tokens=config.ai_artifact_max_tokens,
                temperature=0.4,
            )
        except Exception as exc:
            logger.warning("artifact_studio critique pass failed: %s", exc)
            break
        if verdict.strip() == "OK":
            break
        improved = _strip_to_document(verdict)
        if not improved:
            break
        html = improved

    return brief.title, html
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src/backend && .venv/bin/python -m pytest tests/test_artifact_studio.py -k "build_artifact or strip_to_document" -v -p no:cacheprovider`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/backend/ai/artifact_studio.py src/backend/tests/test_artifact_studio.py
git commit -m "feat(artifact-studio): brief→multi-pass HTML (draft+critique+rewrite)

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

### Task 4: Route `respond_artifact` tool pick through the studio

**Files:**
- Modify: `src/backend/ai/chat_pipeline.py` (`_widget_response`)
- Test: `src/backend/tests/test_artifact_studio.py`

The current `_widget_response` body is exactly:

```python
async def _widget_response(choice: ToolCallResult, user_id: str, db: AsyncSession) -> AIResponse:
    """..."""
    form, content, attachments = response_formatter.parse_function_call(
        choice.tool_name, choice.arguments or {}
    )
    sanitized = await output_safety.sanitize(content, user_id=user_id, db=db)
    return AIResponse(
        content=sanitized.text,
        response_form=form,
        attachments=attachments,
        provider=choice.provider,
    )
```

- [ ] **Step 1: Write the failing test**

Append to `src/backend/tests/test_artifact_studio.py`:

```python
@pytest.mark.asyncio
async def test_widget_response_routes_artifact_through_studio(monkeypatch):
    from ai import chat_pipeline
    from ai.tool_use import ToolCallResult

    async def fake_build(brief, *, user_id):
        assert brief.request  # the user's ask carried as the brief
        return "Pulse", "<!doctype html><html><body><main>STUDIO</main></body></html>"

    monkeypatch.setattr("ai.artifact_studio.build_artifact", fake_build)

    choice = ToolCallResult(
        tool_name="respond_artifact",
        arguments={"title": "Pulse", "content": "зроби пульсуючий віджет",
                   "html": "<p>weak flash html</p>", "capabilities": []},
        provider="gemini", model="stub",
    )
    out = await chat_pipeline._widget_response(choice, "u", None)  # type: ignore[arg-type]
    assert out.response_form == "artifact"
    art = [a for a in out.attachments if a.get("type") == "artifact_data"][0]
    assert "STUDIO" in art["data"]["html"]
    assert "weak flash html" not in art["data"]["html"]  # flash arg discarded


@pytest.mark.asyncio
async def test_widget_response_artifact_studio_failure_degrades_to_text(monkeypatch):
    from ai import chat_pipeline
    from ai.artifact_studio import ArtifactStudioError
    from ai.tool_use import ToolCallResult

    async def boom(brief, *, user_id):
        raise ArtifactStudioError("down")

    monkeypatch.setattr("ai.artifact_studio.build_artifact", boom)
    choice = ToolCallResult(
        tool_name="respond_artifact",
        arguments={"title": "X", "content": "зроби віджет", "html": "", "capabilities": []},
        provider="gemini", model="stub",
    )
    out = await chat_pipeline._widget_response(choice, "u", None)  # type: ignore[arg-type]
    assert out.response_form == "text"
    assert not any(a.get("type") == "artifact_data" for a in (out.attachments or []))
    assert out.content  # explains, no dead bubble


@pytest.mark.asyncio
async def test_widget_response_non_artifact_unchanged(monkeypatch):
    from ai import chat_pipeline
    from ai.tool_use import ToolCallResult

    choice = ToolCallResult(
        tool_name="respond_metrics",
        arguments={"content": "показники",
                   "metrics": [{"label": "CPU", "value": 9, "unit": "%"}]},
        provider="gemini", model="stub",
    )
    out = await chat_pipeline._widget_response(choice, "u", None)  # type: ignore[arg-type]
    assert out.response_form == "metric_cards"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src/backend && .venv/bin/python -m pytest tests/test_artifact_studio.py -k widget_response -v -p no:cacheprovider`
Expected: FAIL — artifact `html` still the flash arg / no degrade branch

- [ ] **Step 3: Implement — replace `_widget_response` body**

In `src/backend/ai/chat_pipeline.py`, replace the entire `_widget_response` function with:

```python
async def _widget_response(choice: ToolCallResult, user_id: str, db: AsyncSession) -> AIResponse:
    """Round-1 `respond_*` widget pick. For `respond_artifact` the fast
    model's `html` arg is a weak draft — discard it and regenerate via
    ArtifactStudio (Gemini 2.5 Pro, multi-pass). On studio failure
    degrade to text (never a dead bubble). All other `respond_*` forms
    go through `parse_function_call` unchanged."""
    if choice.tool_name == "respond_artifact" and config.chat_artifacts_enabled:
        from ai.artifact_studio import Brief, build_artifact, ArtifactStudioError

        args = choice.arguments or {}
        brief = Brief(
            title=str(args.get("title", "") or "Артефакт"),
            request=str(args.get("content") or args.get("title") or ""),
            hint=str(args.get("html", "") or ""),
        )
        caps = args.get("capabilities") or []
        try:
            title, html = await build_artifact(brief, user_id=user_id)
        except ArtifactStudioError as exc:
            logger.warning("artifact_studio failed, degrading to text: %s", exc)
            sanitized = await output_safety.sanitize(
                "Не зміг зібрати віджет потрібної якості — переформулюй, "
                "будь ласка, або спробуй ще раз.",
                user_id=user_id, db=db,
            )
            return AIResponse(
                content=sanitized.text, response_form="text",
                provider=choice.provider,
            )
        form, content, attachments = response_formatter.parse_function_call(
            "respond_artifact",
            {"title": title, "html": html, "capabilities": caps},
        )
        chat_tool_calls_total.inc(success="true", tool="respond_artifact_studio")
        sanitized = await output_safety.sanitize(content, user_id=user_id, db=db)
        return AIResponse(
            content=sanitized.text, response_form=form,
            attachments=attachments, provider=choice.provider,
        )

    form, content, attachments = response_formatter.parse_function_call(
        choice.tool_name, choice.arguments or {}
    )
    sanitized = await output_safety.sanitize(content, user_id=user_id, db=db)
    return AIResponse(
        content=sanitized.text,
        response_form=form,
        attachments=attachments,
        provider=choice.provider,
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src/backend && .venv/bin/python -m pytest tests/test_artifact_studio.py -k widget_response -v -p no:cacheprovider`
Expected: PASS (3 tests)

- [ ] **Step 5: Regression — widget short-circuit suite**

Run: `cd src/backend && .venv/bin/python -m pytest tests/test_phase27_chat_pipeline_widgets.py tests/test_artifact_widgets.py -q --no-header -p no:cacheprovider`
Expected: PASS — non-artifact widgets unchanged; `test_artifact_widgets` parse-path tests still green (studio not on the pure parse path)

- [ ] **Step 6: Commit**

```bash
git add src/backend/ai/chat_pipeline.py src/backend/tests/test_artifact_studio.py
git commit -m "feat(artifact-studio): respond_artifact pick regenerates via studio + degrade

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

### Task 5: Route the B1 HTML-salvage through the studio

**Files:**
- Modify: `src/backend/ai/chat_pipeline.py` (no-tool salvage branch, lines ~244-273)
- Test: `src/backend/tests/test_artifact_studio.py`

The current salvage block (inside `if not tool_choice.tool_name:`) is exactly:

```python
            if salvage is not None:
                html, prose = salvage
                form, _c, attachments = response_formatter.parse_function_call(
                    "respond_artifact",
                    {
                        "html": html,
                        "title": _artifact_title(prose),
                        "capabilities": [],
                    },
                )
                if form == "artifact":
                    chat_tool_calls_total.inc(
                        success="true", tool="respond_artifact_salvage"
                    )
                    sanitized = await output_safety.sanitize(
                        prose or "Ось віджет.", user_id=user_id, db=db
                    )
                    return AIResponse(
                        content=sanitized.text,
                        response_form=form,
                        attachments=attachments,
                        provider=tool_choice.provider,
                    )
```

- [ ] **Step 1: Write the failing test**

Append to `src/backend/tests/test_artifact_studio.py`:

```python
@pytest.mark.asyncio
async def test_salvage_upgrades_via_studio(monkeypatch):
    from ai import chat_pipeline
    from ai.tool_use import ToolCallResult

    async def fake_build(brief, *, user_id):
        assert "<canvas" in brief.hint  # raw fenced html carried as hint
        return brief.title, "<!doctype html><html><body><main>UPGRADED</main></body></html>"

    monkeypatch.setattr("ai.artifact_studio.build_artifact", fake_build)

    async def _stub_cwt(**kw):
        return ToolCallResult(
            tool_name="", arguments={}, provider="gemini", model="s",
            raw_reasoning="ось віджет\n```html\n<!doctype html><body>"
                          "<canvas></canvas></body>\n```\n",
        )

    monkeypatch.setattr(chat_pipeline.ai_router, "call_with_tools", _stub_cwt)
    result = await chat_pipeline.run(
        user_message="зроби віджет", system_prompt="s", history=[],
        user_id="u", db=None,  # type: ignore[arg-type]
    )
    assert result.response_form == "artifact"
    art = [a for a in result.attachments if a.get("type") == "artifact_data"][0]
    assert "UPGRADED" in art["data"]["html"]


@pytest.mark.asyncio
async def test_salvage_studio_failure_falls_back_to_fast_html(monkeypatch):
    from ai import chat_pipeline
    from ai.artifact_studio import ArtifactStudioError
    from ai.tool_use import ToolCallResult

    async def boom(brief, *, user_id):
        raise ArtifactStudioError("down")

    monkeypatch.setattr("ai.artifact_studio.build_artifact", boom)

    async def _stub_cwt(**kw):
        return ToolCallResult(
            tool_name="", arguments={}, provider="gemini", model="s",
            raw_reasoning="прев\n```html\n<!doctype html><body><b>FAST</b></body>\n```\n",
        )

    monkeypatch.setattr(chat_pipeline.ai_router, "call_with_tools", _stub_cwt)
    result = await chat_pipeline.run(
        user_message="x", system_prompt="s", history=[],
        user_id="u", db=None,  # type: ignore[arg-type]
    )
    # Degrade preserves the B1 guarantee: a real panel, NEVER a code dump.
    assert result.response_form == "artifact"
    art = [a for a in result.attachments if a.get("type") == "artifact_data"][0]
    assert "FAST" in art["data"]["html"]
    assert "```" not in result.content
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src/backend && .venv/bin/python -m pytest tests/test_artifact_studio.py -k salvage -v -p no:cacheprovider`
Expected: FAIL — salvage still uses the fast html directly, no studio call

- [ ] **Step 3: Implement — replace the salvage block**

In `src/backend/ai/chat_pipeline.py`, replace the `if salvage is not None:` block shown above with:

```python
            if salvage is not None:
                fast_html, prose = salvage
                from ai.artifact_studio import (
                    Brief, build_artifact, ArtifactStudioError,
                )

                title = _artifact_title(prose)
                try:
                    title, html = await build_artifact(
                        Brief(title=title, request=prose or "інтерактивний віджет",
                              hint=fast_html),
                        user_id=user_id,
                    )
                    tool = "respond_artifact_salvage_studio"
                except ArtifactStudioError as exc:
                    logger.warning(
                        "artifact_studio salvage failed, using fast html: %s", exc
                    )
                    html = fast_html
                    tool = "respond_artifact_salvage"
                form, _c, attachments = response_formatter.parse_function_call(
                    "respond_artifact",
                    {"html": html, "title": title, "capabilities": []},
                )
                if form == "artifact":
                    chat_tool_calls_total.inc(success="true", tool=tool)
                    sanitized = await output_safety.sanitize(
                        prose or "Ось віджет.", user_id=user_id, db=db
                    )
                    return AIResponse(
                        content=sanitized.text,
                        response_form=form,
                        attachments=attachments,
                        provider=tool_choice.provider,
                    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src/backend && .venv/bin/python -m pytest tests/test_artifact_studio.py -k salvage -v -p no:cacheprovider`
Expected: PASS (2 tests)

- [ ] **Step 5: Make the existing salvage test deterministic, then regress**

`tests/test_artifact_widgets.py::TestArtifactSalvage::test_run_salvages_raw_html_into_artifact` asserts `arts[0]["data"]["html"].strip() == ART`. The salvage now routes through the studio, so make that test deterministic (independent of provider availability) by mocking `build_artifact` to echo its hint. Add these two lines inside that test, immediately AFTER the `monkeypatch.setattr(chat_pipeline.ai_router, "call_with_tools", _stub_cwt)` line:

```python
        async def _echo_build(brief, *, user_id):
            return brief.title, brief.hint
        monkeypatch.setattr("ai.artifact_studio.build_artifact", _echo_build)
```

(With `_echo_build`, the studio returns the salvaged ART html verbatim, so the existing `== ART` and `"віджет" in result.content` assertions still hold and the test no longer depends on a live provider.)

Run: `cd src/backend && .venv/bin/python -m pytest tests/test_artifact_widgets.py tests/test_phase27_chat_pipeline_widgets.py tests/test_phase09_3_chatfix_empty_response.py -q --no-header -p no:cacheprovider`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/backend/ai/chat_pipeline.py src/backend/tests/test_artifact_studio.py src/backend/tests/test_artifact_widgets.py
git commit -m "feat(artifact-studio): B1 salvage upgrades via studio, degrades to fast html

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

### Task 6: Full regression + real-browser quality eval

**Files:** none (verification only)

- [ ] **Step 1: Backend regression sweep**

Run: `cd src/backend && .venv/bin/python -m pytest tests/test_artifact_studio.py tests/test_artifact_widgets.py tests/test_phase27_chat_pipeline_widgets.py tests/test_phase10_tool_use.py tests/test_phase03.py tests/test_phase_2026_05_09_auto_render_envelope.py tests/test_phase09_3_chatfix_empty_response.py -q --no-header -p no:cacheprovider`
Expected: ALL PASS

- [ ] **Step 2: Frontend render path unchanged**

Run: `cd src/frontend && npx vitest run src/components/chat/scenes src/__tests__/MessageBubble.artifact.test.tsx && npx tsc --noEmit`
Expected: ALL PASS (this plan is backend-only; render path must stay green)

- [ ] **Step 3: Real-browser quality eval (no freeze path — Chromium only)**

Generate one sample document by running ArtifactStudio against the live provider for a representative brief (operator-run, requires backend up):
`cd src/backend && .venv/bin/python -c "import asyncio; from ai.artifact_studio import Brief, build_artifact; print(asyncio.run(build_artifact(Brief(title='Дихання 4-7-8', request='красивий повноекранний дихальний таймер з фазами і дихаючим колом', hint=''), user_id='u'))[1])" > /tmp/studio-sample.html`
Then reuse the `/tmp/artifact-csp-proof.mjs` harness pattern, swapping `MODEL_HTML` for `/tmp/studio-sample.html`, and confirm: rich render, animation advances, CSP blocks fetch+WebSocket, zero egress. (Operator's hardware-freeze call for the live provider call — same caveat as the prior spec.)

- [ ] **Step 4: Update memory + final report**

Append a closure note to `handoff_2026-05-16_artifact_widgets.md` memory (commits, studio architecture, restart caveat: chat_pipeline lazy per-request so studio active without restart; `ai_artifact_*` config read live).

---

## Final Verification

- [ ] `cd src/backend && .venv/bin/python -m pytest tests/test_artifact_studio.py tests/test_artifact_widgets.py tests/test_phase27_chat_pipeline_widgets.py tests/test_phase10_tool_use.py tests/test_phase03.py -q --no-header -p no:cacheprovider` — all green
- [ ] `cd src/frontend && npx vitest run src/components/chat/scenes src/__tests__/MessageBubble.artifact.test.tsx && npx tsc --noEmit` — all green
- [ ] Spec §9 acceptance criteria 1–7 each map to a passing test above
- [ ] A live `respond_artifact` turn (backend up) returns a markedly richer widget that fills the 1024 breakout, expands via ⤢, animates, and stays network-isolated
