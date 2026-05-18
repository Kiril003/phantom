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
    const reader = vi.fn();
    const b = new ArtifactBroker(f.contentWindow, ['read:context'], reader);
    b.attach();
    window.dispatchEvent(new MessageEvent('message', {
      source: {} as any,
      data: { type: 'phantom.read', reqId: '1', key: 'context.snapshot' },
    }));
    await Promise.resolve();
    expect(f.posted).toHaveLength(0);
    expect(reader).not.toHaveBeenCalled();
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
