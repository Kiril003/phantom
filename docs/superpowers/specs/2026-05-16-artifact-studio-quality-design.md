# ArtifactStudio — Claude-class Artifact Generation Quality

- **Date:** 2026-05-16
- **Branch context:** `companion-v2-phase-0`
- **Status:** Approved design — ready for implementation plan
- **Author:** brainstorming session (operator: Kiril, ROOT)
- **Builds on:** `2026-05-16-arbitrary-artifact-widgets-design.md` (render
  path, CSP, breakout, expand — all shipped + browser-proven). This spec
  is ONLY about generation *quality*, not the render surface.

## 1. Problem & Goal

Operator: artifacts render but are "дуже слабо" vs. Claude-in-chat
("неймовірне"), and is willing to wait much longer for genuinely useful
output. Three proven root causes:

1. `config.ai_max_tokens = 2048` — a rich self-contained widget is
   8–20K tokens; the HTML is physically truncated.
2. Runtime `config.ai_gemini_model` resolves to `gemini-2.0-flash`
   (a fast/weak model), despite the config comment claiming 2.5-pro.
3. The HTML is produced as one inline `respond_artifact` function-call
   argument in the fast chat round, with a one-sentence tool description
   and no artifact-specialised prompt or revision.

**Goal:** a dedicated generation path that extracts maximum widget
quality from Gemini 2.5 Pro — strongest model, large token budget, an
elite artifact prompt, and a draft → self-critique → rewrite loop —
trading latency (~30–90 s) for quality. Render/security path is
unchanged (already shipped).

## 2. Decisions (locked during brainstorming)

| Decision | Choice |
|---|---|
| Model | Gemini 2.5 Pro only. No Anthropic key (operator declined). Chat keeps its own model; ONLY artifact generation forces 2.5-pro. |
| Quality vs latency | Multi-pass: draft → rubric self-critique → rewrite. Max 2 revision rounds (bounded latency). Operator delegated ("який підхід кращий"). |
| Trigger | `respond_artifact` pick OR B1 salvage → treated as a *brief*, not the final HTML. The fast model's `html` arg is discarded; ArtifactStudio regenerates. |
| Token budget | Artifact generation forces ~32K `max_output_tokens` (vs 2048). `chat_artifact_html_cap_bytes` raised 64KB → 256KB (null-origin sandbox + CSP make size a memory, not security, concern). |
| UX | Synchronous turn with an honest "будую складний віджет, ~хвилину" (v1). Progressive WS placeholder is out of scope (separate follow-up). |
| Render/security | Unchanged. Reuses shipped SceneArtifactPanel (breakout, ⤢ expand, `sandbox=allow-scripts`, hard CSP) and `parse_function_call` cap/caps validation. |

## 3. Architecture & Data Flow

```
chat round picks respond_artifact  ──┐
B1 salvage finds self-contained HTML ─┤→ brief = {title, request, hint}
                                      │
                          ai/artifact_studio.py::build_artifact(brief)
                            Pass 1 (draft):   generate_raw(ELITE_SYSTEM, brief)
                            Pass 2 (critique): generate_raw(CRITIQUE_SYSTEM,
                                                 draft + RUBRIC) → revised HTML
                            (≤2 revision rounds; stop early if critique = OK)
                                      │
                          parse_function_call("respond_artifact",
                              {title, html: final, capabilities})  ← cap/caps
                                      │
                          AIResponse(form='artifact', attachments=[...])
                                      │
                          existing scene channel → SceneArtifactPanel
```

New low-level seam (required — current providers hardcode model+budget
and always attach function tools):

- `ai/provider.py` (and `gemini_provider.py`): add
  `generate_raw(*, system_prompt, user_message, model, max_output_tokens,
  temperature=0.7) -> str`. NO function-call tools, NO data-tool
  roundtrip — returns the model's text body verbatim. `ai_router.
  generate_raw` routes to the Gemini provider (provider_hint="gemini");
  on hard failure it raises (caller degrades — see §7). This keeps the
  chat path byte-unchanged.

## 4. Components

**`ai/artifact_studio.py`** (new, single purpose)
- `Brief` dataclass: `title: str`, `request: str` (the user's ask /
  surrounding prose), `hint: str` (optional draft HTML from the fast
  model, used only as a loose intent signal — never as output).
- `async build_artifact(brief, *, user_id) -> tuple[str, str]` returns
  `(title, html)`.
  - Pass 1: `generate_raw(ELITE_SYSTEM_PROMPT, brief→user message,
    model=config.ai_artifact_model, max_output_tokens=
    config.ai_artifact_max_tokens)`.
  - Pass 2..N (≤2): `generate_raw(CRITIQUE_SYSTEM_PROMPT, current_html +
    RUBRIC)`. The critique pass returns EITHER `OK` (accept current) OR a
    full rewritten document. Stop on `OK` or after 2 rounds.
  - `_strip_to_document(text)`: pull the single HTML document out of the
    model output (reuse the `_extract_artifact_html` fence logic; accept
    bare `<!doctype`/`<html>` too). If no document → raise.

**`ai/chat_pipeline.py`** (modify, minimal)
- `_widget_response`: when `tool_name == "respond_artifact"`, build a
  `Brief` from the tool args (`title`, `content`/user request) and
  delegate to `artifact_studio.build_artifact`; feed its `(title, html)`
  into `parse_function_call` exactly as today.
- B1 salvage branch: instead of passing the raw fenced HTML straight to
  `parse_function_call`, pass it as `Brief.hint` + the prose as
  `request`, and delegate to `build_artifact`. The deterministic salvage
  guarantee (never dump raw code) is preserved — it just gets upgraded.
- Degrade: if `build_artifact` raises or artifacts disabled →
  fall back to the prior behaviour (the fast `hint` HTML for salvage, or
  text) so the path never regresses to "code dump" or a dead bubble.

**`config.py`** (add)
- `ai_artifact_model: str = "gemini-2.5-pro"` (independent of
  `ai_gemini_model`; settings-exposed per project rule).
- `ai_artifact_max_tokens: int = 32768`.
- `ai_artifact_max_revisions: int = 2`.
- `chat_artifact_html_cap_bytes`: 65536 → 262144.

## 5. The Elite Prompt + Critique Rubric

`ELITE_SYSTEM_PROMPT` (the heart — Ukrainian, dense) instructs:
one COMPLETE self-contained HTML document; distinctive, non-generic
visual design (no default-AI look); purposeful motion that conveys
meaning; MUST fill a 1024×600 landscape surface (no tiny centred
element, no host scroll); fully interactive where the brief implies it;
ZERO placeholders/TODO/lorem/"// implement"; ZERO network/CDN/external
libs — inline CSS/JS, `<canvas>`/SVG, `data:` images only; keyboard +
ARIA accessible; resilient JS (no uncaught throws). Output: the document
ONLY, no prose, no markdown fence.

`CRITIQUE_SYSTEM_PROMPT` + `RUBRIC` — score the draft on: visual
richness & originality; completeness (no stubs/dead controls);
interactivity depth; surface fit (fills 1024×600, no overflow);
motion purpose; performance (no jank, bounded loops); self-containment
(no network). If every axis passes → reply exactly `OK`. Otherwise →
output a full improved document addressing the weakest axes.

These two constants are the project's main quality lever; they live in
`ai/artifact_studio.py` (not `personality.py` — they are not chat
guidance and must not bloat the cached chat prefix).

## 6. Security

No new surface. Output still flows through
`parse_function_call("respond_artifact", …)` → existing cap (now 256KB)
+ capability allowlist + `chat_artifacts_enabled` kill switch, then the
shipped null-origin `sandbox="allow-scripts"` iframe + hard CSP
(`connect-src 'none'`, browser-proven to block fetch+WebSocket). A
larger document is still fully sandboxed and network-isolated. The
threat model of the prior spec (untrusted model output) is unchanged;
the studio only changes which model writes the HTML and how many times.

## 7. Error Handling & Degrade

- `generate_raw` provider failure / timeout (cap each pass; total bounded
  by `ai_artifact_max_revisions`) → return the best document so far; if
  Pass 1 itself failed → degrade: salvage path falls back to its fast
  `hint` HTML (still a real panel, never a code dump); `respond_artifact`
  pick with no usable output → plain text explaining the widget could
  not be built (no dead bubble).
- Critique pass returns non-`OK`, non-document garbage → keep the prior
  document, stop revising.
- `chat_artifacts_enabled = false` → studio never invoked (unchanged
  degrade-to-text).
- Output over 256KB cap → `parse_function_call` degrades to text (existing
  behaviour) — studio logs it so the cap can be tuned.

## 8. Non-Goals

- Progressive/streaming "building…" placeholder over WS (separate spec).
- Iterate-until-quality-bar (unbounded latency) — capped at 2 revisions.
- Changing the chat model, or any Anthropic/Claude integration.
- Standard-catalog widgets, mobile companion, save-as-tool changes.
- Tuning the render surface (shipped + browser-proven already).

## 9. Acceptance Criteria

1. A `respond_artifact` pick routes through `artifact_studio.
   build_artifact`; the fast model's `html` arg is NOT used as output.
2. The B1 salvage path also routes through the studio; it still NEVER
   dumps raw code (degrade preserved if the studio fails).
3. Generation forces `config.ai_artifact_model` (gemini-2.5-pro) and
   `config.ai_artifact_max_tokens` (~32K) — independent of chat's model
   and `ai_max_tokens`; the chat path is byte-unchanged.
4. The studio performs a draft pass then ≤2 critique/rewrite passes,
   stopping early on `OK`.
5. Final HTML still passes `parse_function_call` cap (256KB)/capability
   validation and renders via the shipped SceneArtifactPanel.
6. Studio failure degrades safely (fast hint HTML, or text) — no dead
   bubble, no code dump, no chat regression.
7. All existing chat/artifact/scene tests stay green; new tests pass.

## 10. Test Plan (no mocks in product code; tests stub the provider)

- **Backend pytest** (`tests/test_artifact_studio.py`): with a scripted
  `generate_raw` stub —
  - `respond_artifact` pick → `build_artifact` called; tool `html` arg
    ignored; final HTML = studio output.
  - exactly 1 draft call; critique returns `OK` → 2 calls total; critique
    returns a document → it becomes the result; ≥3 non-OK → capped at
    `ai_artifact_max_revisions`.
  - forced model == `config.ai_artifact_model`, budget ==
    `ai_artifact_max_tokens` (assert the stub received them).
  - Pass-1 failure → salvage degrades to `hint` HTML; `respond_artifact`
    with total failure → text, no dead bubble.
  - chat path unchanged: existing `test_phase27` / `test_artifact_widgets`
    / `test_phase10` / `test_phase03` all green.
- **Frontend:** unchanged (render path shipped); existing scene suites
  must stay green.
- **Real-browser eval (manual, no freeze path):** reuse
  `/tmp/artifact-csp-proof.mjs` pattern on a studio sample to confirm a
  rich generated document renders/animates and stays network-isolated.

## 11. Scope Estimate

~2 new files (`ai/artifact_studio.py`, `tests/test_artifact_studio.py`),
3 modified (`ai/provider.py`, `ai/gemini_provider.py`, `ai/chat_pipeline.py`)
+ `config.py`. Zero new subsystems; reuses the shipped render/security
path and `parse_function_call`. No placeholders/mocks in product code
(project rule #1); tests after the phase (rule #10).
