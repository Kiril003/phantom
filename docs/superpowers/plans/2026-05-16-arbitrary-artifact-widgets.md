# Arbitrary Artifact Widgets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the chat AI emit an arbitrary, self-contained, animated, interactive widget (Claude-artifacts class) that renders in a hardened sandbox and whose privileged actions are brokered through PHANTOM's existing dispatcher gate.

**Architecture:** New `respond_artifact` function-call tool → `parse_function_call` validates & packs an `artifact` scene panel → existing scene channel → `SceneArtifactPanel` mounts a null-origin `<iframe srcdoc>` with a hard CSP → `artifactBroker` mediates `postMessage` reads (closed allowlist) and actions (proxied to the existing `chat_tool_dispatcher`). Ephemeral by default; optional save to the existing studio card catalog.

**Tech Stack:** Python 3.11 / FastAPI / Pydantic (backend), React 18 + TS strict + Framer Motion (frontend), pytest + vitest + Playwright. Spec: `docs/superpowers/specs/2026-05-16-arbitrary-artifact-widgets-design.md`.

**House rule:** Minimal code comments — dense, self-documenting code. Comment only a genuine security boundary or non-obvious invariant. No section/narrative comments. No mocks/TODO/stubs in product code.

---

### Task 1: Backend config flags

**Files:**
- Modify: `src/backend/config.py`
- Test: `src/backend/tests/test_artifact_widgets.py`

- [ ] **Step 1: Write the failing test**

```python
# src/backend/tests/test_artifact_widgets.py
from config import config

def test_artifact_config_defaults():
    assert config.chat_artifacts_enabled is True
    assert config.chat_artifact_html_cap_bytes == 65536
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/backend && .venv/bin/python -m pytest tests/test_artifact_widgets.py::test_artifact_config_defaults -v`
Expected: FAIL — `AttributeError: 'Settings' object has no attribute 'chat_artifacts_enabled'`

- [ ] **Step 3: Add the fields**

In `src/backend/config.py`, next to the other `chat_*`/`ai_*` fields:

```python
    chat_artifacts_enabled: bool = True
    chat_artifact_html_cap_bytes: int = 65536
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/backend && .venv/bin/python -m pytest tests/test_artifact_widgets.py::test_artifact_config_defaults -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/backend/config.py src/backend/tests/test_artifact_widgets.py
git commit -m "feat(artifact): config flags for arbitrary chat artifacts"
```

---

### Task 2: `respond_artifact` tool + parse_function_call branch

**Files:**
- Modify: `src/backend/ai/response_formatter.py` (`RESPONSE_FORM_TOOLS`, `_FORM_MAP`, `_FORM_TO_SCENE_KIND`, `parse_function_call`, new `_scene_artifact_panel`, `build_scene_envelope` dispatch)
- Test: `src/backend/tests/test_artifact_widgets.py`

- [ ] **Step 1: Read the scene-builder dispatch**

Run: `cd src/backend && sed -n '491,600p' ai/response_formatter.py`
Note how `build_scene_envelope` maps a `response_form`/attachment to a panel via the `_scene_*_panel` builders (the `chart` path is the closest analog). You will add an `artifact` arm to that same dispatch.

- [ ] **Step 2: Write the failing tests**

Append to `src/backend/tests/test_artifact_widgets.py`:

```python
import pytest
from ai.response_formatter import parse_function_call, RESPONSE_FORM_TOOLS, _FORM_MAP

ART = "<!doctype html><body><canvas id=c></canvas><script>1</script></body>"

def test_respond_artifact_in_catalog():
    assert any(t["name"] == "respond_artifact" for t in RESPONSE_FORM_TOOLS)
    assert _FORM_MAP["respond_artifact"] == "artifact"

def test_parse_artifact_builds_panel():
    form, content, atts = parse_function_call(
        "respond_artifact",
        {"title": "Pulse", "html": ART, "capabilities": ["read:context"]},
    )
    assert form == "artifact"
    art = next(a for a in atts if a["type"] == "artifact_data")
    assert art["data"]["html"] == ART
    assert art["data"]["title"] == "Pulse"
    assert art["data"]["capabilities"] == ["read:context"]
    scene = next(a for a in atts if a["type"] == "scene")
    assert scene["data"]["kind"] == "artifact"
    assert scene["data"]["panels"][0]["kind"] == "artifact"

def test_parse_artifact_oversize_degrades_to_text(monkeypatch):
    from config import config
    monkeypatch.setattr(config, "chat_artifact_html_cap_bytes", 10)
    form, _, atts = parse_function_call(
        "respond_artifact", {"title": "x", "html": ART, "capabilities": []})
    assert form == "text"
    assert not any(a["type"] == "artifact_data" for a in atts)

def test_parse_artifact_bad_capability_degrades_to_text():
    form, _, atts = parse_function_call(
        "respond_artifact",
        {"title": "x", "html": ART, "capabilities": ["read:context", "fs:write"]})
    assert form == "text"

def test_parse_artifact_disabled_degrades_to_text(monkeypatch):
    from config import config
    monkeypatch.setattr(config, "chat_artifacts_enabled", False)
    form, _, atts = parse_function_call(
        "respond_artifact", {"title": "x", "html": ART, "capabilities": []})
    assert form == "text"
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd src/backend && .venv/bin/python -m pytest tests/test_artifact_widgets.py -v`
Expected: FAIL — `respond_artifact` absent / `KeyError`.

- [ ] **Step 4: Implement**

In `src/backend/ai/response_formatter.py`:

Add to `RESPONSE_FORM_TOOLS` (mirror the `respond_metrics` entry shape):

```python
    {
        "name": "respond_artifact",
        "description": (
            "Довільний самодостатній інтерактивний віджет (HTML/CSS/JS, "
            "анімації) коли стандартні форми не підходять. Без мережі."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Назва для шапки"},
                "html": {
                    "type": "string",
                    "description": "Повний самодостатній HTML-документ",
                },
                "capabilities": {
                    "type": "array",
                    "description": (
                        "Підмножина: read:context read:sensors read:memory "
                        "read:state action:tools"
                    ),
                    "items": {"type": "string"},
                },
            },
            "required": ["title", "html"],
        },
    },
```

Add mappings:

```python
_FORM_MAP["respond_artifact"] = "artifact"
_FORM_TO_SCENE_KIND["artifact"] = "artifact"

_ARTIFACT_CAPS = frozenset(
    {"read:context", "read:sensors", "read:memory", "read:state", "action:tools"}
)
```

Add the scene-panel builder near `_scene_chart_panel`:

```python
def _scene_artifact_panel(idx: int, raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": f"p{idx}",
        "kind": "artifact",
        "data": {
            "html": raw.get("html", ""),
            "title": raw.get("title", ""),
            "capabilities": raw.get("capabilities", []),
        },
    }
```

Register it in `build_scene_envelope` by adding this arm immediately
after the `elif kind == "diagram":` block and before the
`if not panels:` check (same pattern as the `list`/`chart` arms):

```python
    elif kind == "artifact":
        for att in attachments:
            if isinstance(att, dict) and att.get("type") == "artifact_data":
                data = att.get("data") if isinstance(att.get("data"), dict) else {}
                panels.append(_scene_artifact_panel(idx, data))
                idx += 1
                break
```

Artifact `content` is normally empty, so no leading text panel is
added and the artifact panel is the sole panel — `if not panels` stays
satisfied because `artifact_data` is present.

Add the branch in `parse_function_call`, before the scene auto-attach
block, mirroring `respond_chart`:

```python
    elif fn_name == "respond_artifact":
        from config import config
        html = str(fn_args.get("html", ""))
        caps = fn_args.get("capabilities") or []
        bad = (
            not config.chat_artifacts_enabled
            or len(html.encode("utf-8")) > config.chat_artifact_html_cap_bytes
            or not isinstance(caps, list)
            or not set(caps) <= _ARTIFACT_CAPS
        )
        if bad:
            return "text", content, []
        attachments.append({
            "type": "artifact_data",
            "data": {
                "html": html,
                "title": str(fn_args.get("title", "")),
                "capabilities": [c for c in caps],
            },
        })
```

(`content` is the existing `str(fn_args.get("content", ""))` from the
top of `parse_function_call`; for artifact it is normally empty.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd src/backend && .venv/bin/python -m pytest tests/test_artifact_widgets.py -v`
Expected: PASS (5 tests)

- [ ] **Step 6: Regression — existing formatter/pipeline tests**

Run: `cd src/backend && .venv/bin/python -m pytest tests/test_phase27_chat_pipeline_widgets.py tests/test_phase_2026_05_09_auto_render_envelope.py -q --no-header -p no:cacheprovider`
Expected: PASS (no regressions in the scene system)

- [ ] **Step 7: Commit**

```bash
git add src/backend/ai/response_formatter.py src/backend/tests/test_artifact_widgets.py
git commit -m "feat(artifact): respond_artifact tool + scene panel + validation/degrade"
```

---

### Task 3: `/chat/artifact-action` dispatcher proxy

**Files:**
- Modify: `src/backend/api/routes_chat.py`
- Test: `src/backend/tests/test_artifact_widgets.py`

- [ ] **Step 1: Read the auth dependency + a sibling endpoint**

Run: `cd src/backend && grep -n "get_user_or_device_user\|@router.post\|from ai.chat_tool_dispatcher" api/routes_chat.py | head`
Reuse `get_user_or_device_user` (same as `/chat/message`) and
`chat_tool_dispatcher.dispatch`.

- [ ] **Step 2: Write the failing test**

Append to `src/backend/tests/test_artifact_widgets.py`:

```python
@pytest.mark.asyncio
async def test_artifact_action_proxies_to_dispatcher(monkeypatch):
    import api.routes_chat as rc
    seen = {}

    async def fake_dispatch(name, args, *, user_id, db):
        seen["call"] = (name, args, user_id)
        return {"ok": True, "name": name, "result": {"echo": args}}

    monkeypatch.setattr("ai.chat_tool_dispatcher.dispatch", fake_dispatch)

    class U: id = "u-test"
    out = await rc.artifact_action(
        rc.ArtifactActionRequest(tool="get_system_metrics", args={"x": 1}),
        db=None, user=U(),
    )
    assert out == {"ok": True, "name": "get_system_metrics",
                   "result": {"echo": {"x": 1}}}
    assert seen["call"] == ("get_system_metrics", {"x": 1}, "u-test")
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd src/backend && .venv/bin/python -m pytest tests/test_artifact_widgets.py::test_artifact_action_proxies_to_dispatcher -v`
Expected: FAIL — `artifact_action` / `ArtifactActionRequest` undefined

- [ ] **Step 4: Implement the endpoint**

In `src/backend/api/routes_chat.py` (with the other models/handlers):

```python
class ArtifactActionRequest(BaseModel):
    tool: str
    args: dict = {}


@router.post("/artifact-action")
async def artifact_action(
    req: ArtifactActionRequest,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_user_or_device_user),
) -> dict:
    from ai.chat_tool_dispatcher import dispatch as chat_dispatch
    return await chat_dispatch(req.tool, req.args, user_id=user.id, db=db)
```

This adds no privilege: it is a thin proxy so the iframe never holds a
dispatcher reference. RBAC / dangerous-pattern confirm / audit are the
dispatcher's existing behaviour, unchanged.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd src/backend && .venv/bin/python -m pytest tests/test_artifact_widgets.py::test_artifact_action_proxies_to_dispatcher -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/backend/api/routes_chat.py src/backend/tests/test_artifact_widgets.py
git commit -m "feat(artifact): /chat/artifact-action proxy to existing dispatcher gate"
```

---

### Task 4: Shared types — `artifact` scene kind (ADR amendment)

**Files:**
- Modify: `src/shared/types/chat.ts`
- Test: `src/frontend` typecheck (`tsc`)

- [ ] **Step 1: Extend the closed unions**

In `src/shared/types/chat.ts`:

Add to `SceneKind` and `ScenePanelKind`: `| 'artifact'`.

Add the capability type:

```ts
export type ArtifactCapability =
  | 'read:context'
  | 'read:sensors'
  | 'read:memory'
  | 'read:state'
  | 'action:tools';
```

Add the `ScenePanel` arm (after the `diagram` arm):

```ts
  | {
      id: string;
      kind: 'artifact';
      data: {
        html: string;
        title: string;
        capabilities: ArtifactCapability[];
      };
    }
```

Update the file's closed-enum header note to record the `artifact`
amendment (the header itself mandates documenting new kinds).

- [ ] **Step 2: Typecheck**

Run: `cd src/frontend && npx tsc --noEmit`
Expected: PASS (no consumers broken yet; `SceneComposer` exhaustiveness error is fixed in Task 7 — acceptable to land Task 7 before final typecheck; if `tsc` flags only `SceneComposer.tsx` exhaustiveness, proceed)

- [ ] **Step 3: Commit**

```bash
git add src/shared/types/chat.ts
git commit -m "feat(artifact): add 'artifact' to closed Scene unions (ADR amendment)"
```

---

### Task 5: `artifactBroker` — postMessage mediator

**Files:**
- Create: `src/frontend/src/components/chat/scenes/artifactBroker.ts`
- Test: `src/frontend/src/components/chat/scenes/__tests__/artifactBroker.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// __tests__/artifactBroker.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ArtifactBroker } from '../artifactBroker';

function makeFrame() {
  const posted: any[] = [];
  const contentWindow = { postMessage: (m: any) => posted.push(m) } as any;
  return { contentWindow, posted };
}

describe('ArtifactBroker', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('ignores messages whose source is not the bound iframe', async () => {
    const f = makeFrame();
    const b = new ArtifactBroker(f.contentWindow, ['read:context'], vi.fn());
    b.attach();
    window.dispatchEvent(new MessageEvent('message', {
      source: {} as any,
      data: { type: 'phantom.read', reqId: '1', key: 'context.snapshot' },
    }));
    await Promise.resolve();
    expect(f.posted).toHaveLength(0);
    b.detach();
  });

  it('rejects a read key outside the allowlist', async () => {
    const f = makeFrame();
    const reader = vi.fn();
    const b = new ArtifactBroker(f.contentWindow, ['read:context'], reader);
    b.attach();
    window.dispatchEvent(new MessageEvent('message', {
      source: f.contentWindow,
      data: { type: 'phantom.read', reqId: '7', key: 'os.exec' },
    }));
    await Promise.resolve();
    expect(reader).not.toHaveBeenCalled();
    expect(f.posted[0]).toMatchObject({ reqId: '7', error: 'forbidden' });
    b.detach();
  });

  it('rejects a read whose capability was not declared', async () => {
    const f = makeFrame();
    const reader = vi.fn().mockResolvedValue({ ok: 1 });
    const b = new ArtifactBroker(f.contentWindow, [], reader);
    b.attach();
    window.dispatchEvent(new MessageEvent('message', {
      source: f.contentWindow,
      data: { type: 'phantom.read', reqId: '9', key: 'context.snapshot' },
    }));
    await Promise.resolve();
    expect(reader).not.toHaveBeenCalled();
    expect(f.posted[0]).toMatchObject({ reqId: '9', error: 'forbidden' });
    b.detach();
  });

  it('proxies an action to /chat/artifact-action when action:tools granted', async () => {
    const f = makeFrame();
    const fetchMock = vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue({
      ok: true, json: async () => ({ ok: true, result: { z: 2 } }),
    } as any);
    const b = new ArtifactBroker(f.contentWindow, ['action:tools'], vi.fn());
    b.attach();
    window.dispatchEvent(new MessageEvent('message', {
      source: f.contentWindow,
      data: { type: 'phantom.action', reqId: 'a1',
              tool: 'create_timer', args: { m: 5 } },
    }));
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/chat/artifact-action',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(f.posted[0]).toMatchObject({
      type: 'phantom.action.result', reqId: 'a1', ok: true,
    });
    b.detach();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src/frontend && npx vitest run src/components/chat/scenes/__tests__/artifactBroker.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// src/components/chat/scenes/artifactBroker.ts
import type { ArtifactCapability } from '@shared/types/chat';

const READ_KEYS: Record<string, ArtifactCapability> = {
  'context.snapshot': 'read:context',
  'sensors.latest': 'read:sensors',
  'memory.facts': 'read:memory',
  'system.state': 'read:state',
};

type ReadFn = (key: string) => Promise<unknown>;

export class ArtifactBroker {
  private onMsg = (e: MessageEvent) => this.handle(e);

  constructor(
    private frame: Window,
    private caps: ArtifactCapability[],
    private read: ReadFn,
  ) {}

  attach() { window.addEventListener('message', this.onMsg); }
  detach() { window.removeEventListener('message', this.onMsg); }

  private reply(m: object) { this.frame.postMessage(m, '*'); }

  private async handle(e: MessageEvent) {
    if (e.source !== this.frame) return;
    const d = e.data;
    if (!d || typeof d !== 'object') return;

    if (d.type === 'phantom.read') {
      const need = READ_KEYS[d.key];
      if (!need || !this.caps.includes(need)) {
        this.reply({ type: 'phantom.read.result', reqId: d.reqId, error: 'forbidden' });
        return;
      }
      try {
        this.reply({ type: 'phantom.read.result', reqId: d.reqId, data: await this.read(d.key) });
      } catch {
        this.reply({ type: 'phantom.read.result', reqId: d.reqId, error: 'read_failed' });
      }
      return;
    }

    if (d.type === 'phantom.action') {
      if (!this.caps.includes('action:tools')) {
        this.reply({ type: 'phantom.action.result', reqId: d.reqId, ok: false, error: 'forbidden' });
        return;
      }
      try {
        const r = await fetch('/api/v1/chat/artifact-action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ tool: d.tool, args: d.args ?? {} }),
        });
        const j = await r.json();
        this.reply({ type: 'phantom.action.result', reqId: d.reqId, ok: !!j.ok, result: j.result, error: j.error });
      } catch {
        this.reply({ type: 'phantom.action.result', reqId: d.reqId, ok: false, error: 'dispatch_failed' });
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src/frontend && npx vitest run src/components/chat/scenes/__tests__/artifactBroker.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/frontend/src/components/chat/scenes/artifactBroker.ts src/frontend/src/components/chat/scenes/__tests__/artifactBroker.test.ts
git commit -m "feat(artifact): postMessage broker (source-pinned, allowlisted, dispatcher-proxied)"
```

---

### Task 6: `SceneArtifactPanel` — hardened iframe host

**Files:**
- Create: `src/frontend/src/components/chat/scenes/panels/SceneArtifactPanel.tsx`
- Test: `src/frontend/src/components/chat/scenes/__tests__/SceneArtifactPanel.test.tsx`

- [ ] **Step 1: Find the read-data source + auth header pattern**

Run: `cd src/frontend && grep -rn "context/snapshot\|apiFetch\|Authorization\|/api/v1" src/services 2>/dev/null | head`
Use the existing API client to back the broker `read` fn (curated
read-only slices). If a single context snapshot endpoint exists, map all
read keys onto slices of it.

- [ ] **Step 2: Write the failing tests**

```tsx
// __tests__/SceneArtifactPanel.test.tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SceneArtifactPanel } from '../panels/SceneArtifactPanel';

const data = { html: '<p>hi</p>', title: 'T', capabilities: ['read:context'] as const };

describe('SceneArtifactPanel', () => {
  it('mounts a script-only sandbox with NO allow-same-origin', () => {
    const { container } = render(<SceneArtifactPanel data={data as any} />);
    const f = container.querySelector('iframe')!;
    expect(f.getAttribute('sandbox')).toBe('allow-scripts');
    expect(f.getAttribute('sandbox')).not.toContain('allow-same-origin');
  });

  it('injects a CSP that forbids network', () => {
    const { container } = render(<SceneArtifactPanel data={data as any} />);
    const srcdoc = container.querySelector('iframe')!.getAttribute('srcdoc')!;
    expect(srcdoc).toContain("connect-src 'none'");
    expect(srcdoc).toContain("default-src 'none'");
    expect(srcdoc).toContain('<p>hi</p>');
  });

  it('kill switch unmounts the iframe', async () => {
    const { container, getByLabelText } = render(<SceneArtifactPanel data={data as any} />);
    getByLabelText('зупинити артефакт').click();
    expect(container.querySelector('iframe')).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd src/frontend && npx vitest run src/components/chat/scenes/__tests__/SceneArtifactPanel.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 4: Implement**

```tsx
// src/components/chat/scenes/panels/SceneArtifactPanel.tsx
import { useEffect, useRef, useState } from 'react';
import type { ArtifactCapability } from '@shared/types/chat';
import { ArtifactBroker } from '../artifactBroker';

interface Props {
  data: { html: string; title: string; capabilities: ArtifactCapability[] };
}

const CSP =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; " +
  "img-src data:; font-src data:; connect-src 'none'";

async function readSlice(key: string): Promise<unknown> {
  const r = await fetch('/api/v1/context/snapshot', { credentials: 'include' });
  const snap = await r.json();
  switch (key) {
    case 'context.snapshot': return snap;
    case 'sensors.latest': return snap.sensors ?? null;
    case 'memory.facts': return snap.memory ?? null;
    case 'system.state': return snap.system?.state ?? null;
    default: return null;
  }
}

export function SceneArtifactPanel({ data }: Props) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [alive, setAlive] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const w = ref.current?.contentWindow;
    if (!w || !alive) return;
    const broker = new ArtifactBroker(w, data.capabilities, readSlice);
    broker.attach();
    return () => broker.detach();
  }, [alive, data.capabilities]);

  if (!alive) return null;

  const srcdoc =
    `<!doctype html><meta http-equiv="Content-Security-Policy" content="${CSP}">` +
    data.html;

  return (
    <div className="rounded-xl border border-white/10 overflow-hidden"
         style={{ maxWidth: 1024 }}>
      <div className="flex items-center justify-between px-3 py-1.5 text-xs">
        <span className="opacity-70">{data.title || 'Артефакт'}</span>
        <div className="flex gap-3">
          <button aria-label="зупинити артефакт" onClick={() => setAlive(false)}>✕</button>
        </div>
      </div>
      {failed ? (
        <pre className="p-3 text-xs overflow-auto max-h-[420px]">{data.html}</pre>
      ) : (
        <iframe
          ref={ref}
          title={data.title || 'artifact'}
          sandbox="allow-scripts"
          srcDoc={srcdoc}
          onError={() => setFailed(true)}
          style={{ width: '100%', height: 460, border: 0, background: '#0b0f14' }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd src/frontend && npx vitest run src/components/chat/scenes/__tests__/SceneArtifactPanel.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add src/frontend/src/components/chat/scenes/panels/SceneArtifactPanel.tsx src/frontend/src/components/chat/scenes/__tests__/SceneArtifactPanel.test.tsx
git commit -m "feat(artifact): hardened null-origin iframe panel + CSP + kill switch + fallback"
```

---

### Task 7: Wire `artifact` into `SceneComposer`

**Files:**
- Modify: `src/frontend/src/components/chat/scenes/SceneComposer.tsx`
- Test: `src/frontend/src/components/chat/scenes/__tests__/SceneComposer.artifact.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/SceneComposer.artifact.test.tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SceneComposer } from '../SceneComposer';

it('renders an artifact panel via the composer', () => {
  const scene = {
    kind: 'artifact',
    reveal: { policy: 'instant', staggerMs: 0 },
    panels: [{
      id: 'p0', kind: 'artifact',
      data: { html: '<b>x</b>', title: 'T', capabilities: [] },
    }],
  };
  const { container } = render(
    <SceneComposer scene={scene as any} reduceMotion />,
  );
  expect(container.querySelector('iframe')).not.toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/frontend && npx vitest run src/components/chat/scenes/__tests__/SceneComposer.artifact.test.tsx`
Expected: FAIL — no `iframe` (default/exhaustive branch hit)

- [ ] **Step 3: Implement**

In `SceneComposer.tsx`: add the import and the case before the
`default:` exhaustiveness arm:

```tsx
import { SceneArtifactPanel } from './panels/SceneArtifactPanel';
```

```tsx
    case 'artifact':
      return <SceneArtifactPanel data={panel.data} />;
```

- [ ] **Step 4: Run test + typecheck**

Run: `cd src/frontend && npx vitest run src/components/chat/scenes/__tests__/SceneComposer.artifact.test.tsx && npx tsc --noEmit`
Expected: PASS and `tsc` clean (exhaustiveness satisfied)

- [ ] **Step 5: Commit**

```bash
git add src/frontend/src/components/chat/scenes/SceneComposer.tsx src/frontend/src/components/chat/scenes/__tests__/SceneComposer.artifact.test.tsx
git commit -m "feat(artifact): render artifact panel through SceneComposer"
```

---

### Task 8: Save-as-tool via existing studio cards (thin)

**Files:**
- Modify: `src/backend/agent/studio/models.py` (`AgentCardKind`), studio create/catalog path
- Modify: `src/shared/types/studio.ts` (mirror), `SceneArtifactPanel.tsx` (save button)
- Test: `src/backend/tests/test_artifact_widgets.py`

- [ ] **Step 1: Read studio card create + catalog**

Run: `cd src/backend && grep -n "AgentCardKind\|class AgentCard\|def.*card\|catalog\|payload" agent/studio/models.py agent/studio/*.py | head -30`
Identify the create function and where `kind` is constrained.

- [ ] **Step 2: Write the failing test**

```python
@pytest.mark.asyncio
async def test_save_artifact_as_studio_card(tmp_path, monkeypatch):
    from agent.studio import models as sm
    card = sm.make_artifact_card(
        title="Pulse", html="<b>x</b>", capabilities=["read:context"])
    assert card.kind == "artifact"
    assert card.payload["html"] == "<b>x</b>"
    assert card.payload["capabilities"] == ["read:context"]
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd src/backend && .venv/bin/python -m pytest tests/test_artifact_widgets.py::test_save_artifact_as_studio_card -v`
Expected: FAIL — `make_artifact_card` undefined / `"artifact"` not in `AgentCardKind`

- [ ] **Step 4: Implement**

Add `"artifact"` to the `AgentCardKind` Literal in
`src/backend/agent/studio/models.py` and a constructor:

```python
def make_artifact_card(*, title: str, html: str, capabilities: list[str]) -> AgentCard:
    return AgentCard(
        kind="artifact",
        name=title or "Артефакт",
        payload={"html": html, "capabilities": capabilities},
    )
```

(Match `AgentCard`'s actual required fields discovered in Step 1; add a
`payload: dict = {}` field only if the model lacks an equivalent.)

Mirror `"artifact"` into `AgentCardKind` in `src/shared/types/studio.ts`.

Add a save button in `SceneArtifactPanel.tsx` header next to ✕:

```tsx
<button aria-label="зберегти артефакт" onClick={() => {
  void fetch('/api/v1/studio/cards', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      kind: 'artifact', name: data.title,
      payload: { html: data.html, capabilities: data.capabilities },
    }),
  });
}}>⭳</button>
```

(Confirm the real studio create route path/shape in Step 1 and match it.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd src/backend && .venv/bin/python -m pytest tests/test_artifact_widgets.py -q --no-header`
Expected: PASS (all artifact tests)

- [ ] **Step 6: Commit**

```bash
git add src/backend/agent/studio/models.py src/shared/types/studio.ts src/frontend/src/components/chat/scenes/panels/SceneArtifactPanel.tsx src/backend/tests/test_artifact_widgets.py
git commit -m "feat(artifact): save artifact as a studio card (reuse studio catalog)"
```

---

### Task 9: End-to-end (Playwright)

**Files:**
- Create: `/tmp/artifact-e2e.spec.ts` (Playwright; not committed to product tree per project rule — keep scratch e2e in /tmp)

- [ ] **Step 1: Write the e2e script**

Drive a chat turn where the model is stubbed to return `respond_artifact`
with HTML containing a CSS/JS animation and a button that calls
`window.parent.postMessage({type:'phantom.action',reqId:'e1',tool:'create_timer',args:{minutes:1}},'*')`.

Assertions:
- The iframe renders and the animated element is visible.
- A `fetch('https://example.com')` inside the artifact is blocked
  (console CSP violation; no network entry).
- Clicking the button triggers the existing MEDIUM tap-confirm overlay
  (because `create_timer` routes through the dispatcher gate).

- [ ] **Step 2: Run it**

Run: `cd src/frontend && npx playwright test /tmp/artifact-e2e.spec.ts`
Expected: PASS (render+animate; network blocked; confirm overlay shown)

- [ ] **Step 3: Commit**

(No product files; if the run reveals fixes, commit those with
`fix(artifact): …` and re-run.)

---

## Final Verification

- [ ] `cd src/backend && .venv/bin/python -m pytest tests/test_artifact_widgets.py tests/test_phase27_chat_pipeline_widgets.py tests/test_phase_2026_05_09_auto_render_envelope.py -q --no-header -p no:cacheprovider` — all green
- [ ] `cd src/frontend && npx vitest run src/components/chat/scenes && npx tsc --noEmit` — all green
- [ ] Restart backend; real chat turn that elicits an artifact returns HTTP 200 with a `message.scene` of kind `artifact`; artifact renders and animates on the 1024×600 device; a MEDIUM action raises the existing confirm overlay; an artifact `fetch` is blocked.
- [ ] Spec acceptance criteria §9 (1–9) each map to a passing test or the manual check above.
